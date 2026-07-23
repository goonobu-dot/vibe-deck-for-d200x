import { existsSync, watch, type FSWatcher } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentState, RawAgent } from "../types.js";
import { invalidateStatus } from "../lib/cache.js";
import type { AdapterResult, ToolAdapter } from "./types.js";

const CLAUDE_HOME = process.env.CLAUDE_HOME || join(homedir(), ".claude");
const PROJECTS = join(CLAUDE_HOME, "projects");
const SESSIONS_META = join(CLAUDE_HOME, "sessions");
const DESKTOP_SESSIONS = join(
  homedir(),
  "Library/Application Support/Claude/claude-code-sessions",
);

/** Parent / subagent rollouts can be huge — only need the recent tail. */
const TAIL_BYTES = 512_000;
const TAIL_LINES = 80;

let watchBooted = false;
let watcher: FSWatcher | null = null;
let reindexTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleInvalidate(): void {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    reindexTimer = null;
    invalidateStatus("claude");
  }, 80);
}

function ensureWatcher(): void {
  if (watchBooted || !existsSync(PROJECTS)) return;
  watchBooted = true;
  // ~/.claude/projects is huge — avoid recursive watch (EMFILE).
  // Paint polling already refreshes every few seconds; shallow watch is enough
  // to notice new project folders / top-level session files.
  try {
    watcher = watch(PROJECTS, (_evt, filename) => {
      if (
        filename &&
        !String(filename).endsWith(".jsonl") &&
        !String(filename).includes(".")
      ) {
        // directory change — still invalidate
        scheduleInvalidate();
        return;
      }
      if (filename && !String(filename).endsWith(".jsonl")) return;
      scheduleInvalidate();
    });
    watcher.on("error", () => {
      // EMFILE / unsupported — rely on paint polling
      try {
        watcher?.close();
      } catch {
        // ignore
      }
      watcher = null;
    });
  } catch {
    // watch unsupported — paint polling is enough
  }
}

function ageState(
  state: Exclude<AgentState, "empty">,
  ageSec: number,
): Exclude<AgentState, "empty"> {
  if (state === "done" && ageSec > 90) return "idle";
  if (state === "thinking" && ageSec > 300) return "idle";
  if (state === "needs_input" && ageSec > 60 * 30) return "idle";
  return state;
}

async function walkJsonl(
  dir: string,
  out: { file: string; mtime: number; size: number }[],
  depth = 0,
): Promise<void> {
  if (depth > 6 || !existsSync(dir)) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(full, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const st = await stat(full);
        // Ignore stale history (keep active desktop + recent CLI work).
        if (Date.now() - st.mtimeMs > 1000 * 60 * 60 * 12) continue;
        out.push({ file: full, mtime: st.mtimeMs, size: st.size });
      } catch {
        // ignore
      }
    }
  }
}

/** Group parent + subagent jsonl under one Claude session id. */
function sessionKey(file: string): string {
  const name = basename(file, ".jsonl");
  if (name.startsWith("agent-")) {
    // .../<sessionId>/subagents/agent-xxx.jsonl
    return basename(dirname(dirname(file)));
  }
  return name;
}

async function readTail(file: string): Promise<string> {
  const st = await stat(file);
  if (st.size <= TAIL_BYTES) {
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      return buf.toString("utf8");
    } finally {
      await fh.close();
    }
  }
  const start = st.size - TAIL_BYTES;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(TAIL_BYTES);
    await fh.read(buf, 0, TAIL_BYTES, start);
    const text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(nl + 1) : text;
  } finally {
    await fh.close();
  }
}

type Parsed = {
  state: Exclude<AgentState, "empty">;
  title: string;
};

function inferFromLines(lines: string[], fallbackTitle: string): Parsed {
  let state: Exclude<AgentState, "empty"> = "idle";
  let title = fallbackTitle;
  let saw = false;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = String(obj.type || "");

    if (type === "custom-title" && typeof obj.customTitle === "string") {
      title = obj.customTitle.slice(0, 40);
      continue;
    }
    if (
      type === "last-prompt" ||
      type === "mode" ||
      type === "queue-operation" ||
      type === "system" ||
      type === "attachment"
    ) {
      continue;
    }

    const message =
      obj.message && typeof obj.message === "object"
        ? (obj.message as Record<string, unknown>)
        : null;
    const stop = message && typeof message.stop_reason === "string"
      ? message.stop_reason
      : "";
    const content = message?.content;
    const contentTypes = Array.isArray(content)
      ? content
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => String(c.type || ""))
      : [];
    const toolNames = Array.isArray(content)
      ? content
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .filter((c) => c.type === "tool_use")
          .map((c) => String(c.name || ""))
      : [];

    if (type === "assistant") {
      saw = true;
      if (
        toolNames.some((n) => /AskUserQuestion|AskUser|Permission/i.test(n))
      ) {
        state = "needs_input";
      } else if (
        stop === "tool_use" ||
        contentTypes.includes("tool_use") ||
        contentTypes.includes("thinking")
      ) {
        state = "thinking";
      } else if (stop === "end_turn" || contentTypes.includes("text")) {
        state = "done";
      } else {
        state = "thinking";
      }
      continue;
    }

    if (type === "user") {
      saw = true;
      // toolUseResult = tool finished; agent usually continues → thinking.
      // bare user prompt also means a turn is starting.
      if (obj.toolUseResult !== undefined) {
        state = "thinking";
      } else {
        state = "thinking";
      }
    }
  }

  if (!saw) state = "idle";
  return { state, title };
}

async function loadDesktopTitles(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!existsSync(DESKTOP_SESSIONS)) return map;
  const files: string[] = [];
  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".json")) files.push(full);
    }
  }
  await walk(DESKTOP_SESSIONS);
  for (const file of files.slice(0, 200)) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
      const cliId = String(raw.cliSessionId || "");
      const title = String(raw.title || "");
      if (cliId && title) map.set(cliId, title.slice(0, 40));
    } catch {
      // ignore
    }
  }
  return map;
}

async function loadSessionMetaNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!existsSync(SESSIONS_META)) return map;
  let entries;
  try {
    entries = await readdir(SESSIONS_META);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        await readFile(join(SESSIONS_META, name), "utf8"),
      ) as Record<string, unknown>;
      const id = String(raw.sessionId || "");
      const label = String(raw.name || raw.cwd || "");
      if (id && label) map.set(id, label.slice(0, 40));
    } catch {
      // ignore
    }
  }
  return map;
}

async function parseGroupedSessions(): Promise<RawAgent[]> {
  const ranked: { file: string; mtime: number; size: number }[] = [];
  await walkJsonl(PROJECTS, ranked);
  if (!ranked.length) return [];

  type Group = {
    id: string;
    mtime: number;
    files: { file: string; mtime: number }[];
  };
  const groups = new Map<string, Group>();
  for (const item of ranked) {
    const id = sessionKey(item.file);
    const g = groups.get(id) || { id, mtime: 0, files: [] };
    g.files.push({ file: item.file, mtime: item.mtime });
    if (item.mtime > g.mtime) g.mtime = item.mtime;
    groups.set(id, g);
  }

  const ordered = [...groups.values()].sort((a, b) => b.mtime - a.mtime);
  const [desktopTitles, metaNames] = await Promise.all([
    loadDesktopTitles(),
    loadSessionMetaNames(),
  ]);

  const agents: RawAgent[] = [];
  for (const g of ordered.slice(0, 8)) {
    // Prefer the hottest file in the group (often a live subagent).
    const hottest = [...g.files].sort((a, b) => b.mtime - a.mtime)[0];
    let text: string;
    try {
      text = await readTail(hottest.file);
    } catch {
      continue;
    }
    const lines = text.trim().split(/\n+/).slice(-TAIL_LINES);
    const fallback =
      desktopTitles.get(g.id) ||
      metaNames.get(g.id) ||
      g.id.slice(0, 36);
    const parsed = inferFromLines(lines, fallback);
    const ageSec = (Date.now() - g.mtime) / 1000;
    const state = ageState(parsed.state, ageSec);
    agents.push({
      id: g.id,
      title: parsed.title || fallback,
      state,
      updatedAt: g.mtime,
      focusAction: { kind: "activate_app", payload: "Claude" },
    });
  }
  return agents;
}

export const claudeAdapter: ToolAdapter = {
  tool: "claude",
  async collect(): Promise<AdapterResult> {
    ensureWatcher();

    if (!existsSync(PROJECTS)) {
      return {
        tool: "claude",
        agents: [],
        health: "degraded",
        note: "~/.claude/projects not found; open Claude Code desktop",
      };
    }

    const agents = await parseGroupedSessions();
    const active = agents.some((a) => a.state !== "idle");
    return {
      tool: "claude",
      agents,
      health: agents.length ? (active ? "ok" : "degraded") : "degraded",
      note: agents.length
        ? active
          ? "Claude Code activity from local session transcripts"
          : "Claude sessions found; no active turn detected"
        : "No recent Claude Code session signals",
    };
  },
};

export function stopClaudeWatcher(): void {
  watcher?.close();
  watcher = null;
  watchBooted = false;
}
