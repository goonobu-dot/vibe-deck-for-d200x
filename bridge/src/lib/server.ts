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

export async function buildStatus(tool: ToolId): Promise<StatusPayload> {
  const demo = process.env.VIBE_DECK_DEMO === "1";
  if (!demo) {
    const cached = getCachedStatus(tool, STATUS_TTL_MS);
    if (cached) return cached;
  }

  const result = demo
    ? demoAgents(tool)
    : await withTimeout(collectTool(tool), COLLECT_TIMEOUT_MS);
  if (!result) {
    const stale = lastGood.get(tool);
    if (stale) {
      return {
        ...stale,
        bridge: "degraded",
        note: "collector timeout — showing last known state",
      };
    }
    return {
      tool,
      bridge: "degraded",
      agents: [],
      updatedAt: Date.now(),
      note: "collector timeout",
    };
  }
  const agents = assignSlots(result.agents, undefined, {
    prioritize: !demo,
    tool, // sticky lanes are per tool
  });
  if (!demo) applyEvents(tool, agents);
  const payload: StatusPayload = {
    tool,
    bridge: result.health,
    agents,
    updatedAt: Date.now(),
    note: result.note,
  };
  if (!demo) {
    setCachedStatus(tool, payload);
    lastGood.set(tool, payload);
  }
  return payload;
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
