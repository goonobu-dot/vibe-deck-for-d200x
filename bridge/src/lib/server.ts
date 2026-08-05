import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { collectTool } from "../adapters/index.js";
import type { StatusPayload, ToolId } from "../types.js";
import { demoAgents } from "./demo.js";
import { assignSlots } from "./slots.js";
import { getCachedStatus, invalidateStatus, setCachedStatus } from "./cache.js";
import {
  cycleProfile,
  listProfiles,
  peekPendingProfile,
  takePendingProfile,
  currentProfileName,
} from "./profiles.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { applyEvents, recordEvent } from "./events.js";

const TOOLS = new Set<ToolId>(["claude", "codex", "cursor"]);
const STATUS_TTL_MS = 300;
/** A wedged collector must not wedge the whole HTTP server (seen after
 * multi-day uptime across sleep/wake): cap each collect and fall back. */
const COLLECT_TIMEOUT_MS = 4000;
/** Cache older than this is reported as degraded (but still served). */
const STALE_OK_MS = 5000;
/** Cold start only — stay under the plugin's own 2s fetch timeout. */
const FIRST_COLLECT_WAIT_MS = 1500;
/** Background refresh cadence: keeps /status a pure cache read. */
const REFRESH_MS = 700;

const lastGood = new Map<ToolId, StatusPayload>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function parseTool(url: URL): ToolId {
  const tool = (url.searchParams.get("tool") || "codex") as ToolId;
  return TOOLS.has(tool) ? tool : "codex";
}

/** One in-flight collection per tool; /status never waits on a second one. */
const refreshing = new Set<ToolId>();

async function refresh(tool: ToolId): Promise<StatusPayload | null> {
  if (refreshing.has(tool)) return null;
  refreshing.add(tool);
  try {
    const result = await withTimeout(collectTool(tool), COLLECT_TIMEOUT_MS);
    if (!result) return null;
    const agents = assignSlots(result.agents, undefined, {
      prioritize: true,
      tool,
    });
    applyEvents(tool, agents);
    const payload: StatusPayload = {
      tool,
      bridge: result.health,
      agents,
      updatedAt: Date.now(),
      note: result.note,
    };
    setCachedStatus(tool, payload);
    lastGood.set(tool, payload);
    return payload;
  } catch {
    return null;
  } finally {
    refreshing.delete(tool);
  }
}

/**
 * Serve from cache and refresh in the background. A wedged collector (seen
 * after long uptime across sleep/wake, or a slow filesystem walk) must never
 * make the deck wait — the plugin gives up after 2s and the lanes freeze.
 */
export async function buildStatus(tool: ToolId): Promise<StatusPayload> {
  if (process.env.VIBE_DECK_DEMO === "1") {
    const demo = demoAgents(tool);
    return {
      tool,
      bridge: demo.health,
      agents: assignSlots(demo.agents, undefined, { prioritize: false }),
      updatedAt: Date.now(),
      note: demo.note,
    };
  }

  const cached = getCachedStatus(tool, STATUS_TTL_MS);
  if (cached) return cached;

  const stale = lastGood.get(tool);
  if (stale) {
    void refresh(tool); // warm the cache for the next poll
    const ageMs = Date.now() - stale.updatedAt;
    if (ageMs < STALE_OK_MS) return stale;
    return {
      ...stale,
      bridge: "degraded",
      note: `collector slow (${Math.round(ageMs / 1000)}s stale) — last known state`,
    };
  }

  // Cold start only: wait, but never longer than the plugin's own timeout.
  const fresh = await withTimeout(refresh(tool), FIRST_COLLECT_WAIT_MS);
  return (
    fresh ?? {
      tool,
      bridge: "degraded",
      agents: [],
      updatedAt: Date.now(),
      note: "collecting…",
    }
  );
}

/** Keep every tool's snapshot warm so /status is always a cache hit. */
export function startRefreshLoop(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (process.env.VIBE_DECK_DEMO === "1") return;
    for (const tool of TOOLS) void refresh(tool);
  }, REFRESH_MS);
  timer.unref?.();
  return timer;
}

export function startServer(port: number): ReturnType<typeof createServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, demo: process.env.VIBE_DECK_DEMO === "1" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/dashboard") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(DASHBOARD_HTML);
        return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        const tool = parseTool(url);
        if (url.searchParams.get("fresh") === "1") invalidateStatus(tool);
        sendJson(res, 200, await buildStatus(tool));
        return;
      }
      if (
        (req.method === "GET" || req.method === "POST") &&
        url.pathname === "/event"
      ) {
        const tool = parseTool(url);
        const state = url.searchParams.get("state");
        const session = url.searchParams.get("session") || "";
        if (state !== "needs_input" && state !== "done") {
          sendJson(res, 400, { error: "bad_state" });
          return;
        }
        recordEvent(tool, state, session);
        invalidateStatus(tool);
        sendJson(res, 200, { ok: true, tool, state });
        return;
      }
      if (req.method === "POST" && url.pathname === "/invalidate") {
        const tool = parseTool(url);
        invalidateStatus(tool);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (
        (req.method === "GET" || req.method === "POST") &&
        (url.pathname === "/profile/next" || url.pathname === "/profile/prev")
      ) {
        const direction = url.pathname.endsWith("prev") ? "prev" : "next";
        const next = cycleProfile(direction);
        if (!next) {
          sendJson(res, 404, { error: "no_profiles" });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          direction,
          current: next.name,
          uuid: next.uuid,
          ring: listProfiles().map((p) => p.name),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/profile/pending") {
        const consume = url.searchParams.get("consume") !== "0";
        const p = consume ? takePendingProfile() : peekPendingProfile();
        sendJson(res, 200, { pending: p, current: currentProfileName() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/profile/list") {
        sendJson(res, 200, {
          current: currentProfileName(),
          profiles: listProfiles(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        sendJson(res, 200, {
          name: "vibe-deck-bridge",
          endpoints: [
            "/health",
            "/status?tool=codex|claude|cursor",
            "/profile/next",
            "/profile/prev",
            "/profile/pending",
          ],
        });
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      sendJson(res, 500, {
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}
