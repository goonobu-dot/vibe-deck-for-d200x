import { existsSync, watch, type FSWatcher } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { AgentState, RawAgent } from "../types.js";
import { invalidateStatus } from "../lib/cache.js";
import type { AdapterResult, ToolAdapter } from "./types.js";

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const SESSIONS = join(CODEX_HOME, "sessions");
/** Codex desktop / CLI sessions grow large — only need the recent tail. */
const TAIL_BYTES = 512_000;
const TAIL_LINES = 80;

let watchBooted = false;
let watcher: FSWatcher | null = null;
let reindexTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleInvalidate(): void {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    reindexTimer = null;
    invalidateStatus("codex");
  }, 80);
}

function ensureWatcher(): void {
  if (watchBooted || !existsSync(SESSIONS)) return;
  watchBooted = true;
  try {
    watcher = watch(SESSIONS, { recursive: true }, (_evt, filename) => {
      if (filename && !String(filename).endsWith(".jsonl")) return;
      scheduleInvalidate();
    });
  } catch {
    // recursive watch unsupported on some volumes — polling via paint is enough
  }
}

/** Only explicit session event names — never free-text word matches. */
function mapEventType(raw: string): Exclude<AgentState, "empty"> | null {
  const s = raw.toLowerCase();
  if (
    s === "task_complete" ||
    s === "turn_aborted" ||
    s === "context_compacted"
  ) {
    return "done";
  }
  if (
    s === "task_started" ||
    s === "reasoning" ||
    s === "agent_reasoning" ||
    s === "custom_tool_call" ||
    s === "function_call" ||
    s === "web_search_end" ||
    s === "sub_agent_activity" ||
    s === "agent_message" ||
    s === "message"
  ) {
    return "thinking";
  }
  if (
    s === "needs_input" ||
    s === "waiting_for_user" ||
    s === "awaiting_approval" ||
    s === "approval_requested"
  ) {
    return "needs_input";
  }
  if (s === "error" || s === "failed") return "error";
  if (s === "user_message") return "thinking";
  return null;
}

function ageState(
  state: Exclude<AgentState, "empty">,
  ageSec: number,
): Exclude<AgentState, "empty"> {
  if (state === "done" && ageSec > 90) return "idle";
  // Active Codex desktop sessions keep writing; only idle out after a long pause.
  if (state === "thinking" && ageSec > 300) return "idle";
  if (state === "needs_input" && ageSec > 60 * 30) return "idle";
  return state;
}

async function walkSessionJsonl(
  dir: string,
  out: { file: string; mtime: number; size: number }[],
  depth = 0,
): Promise<void> {
  if (depth > 5 || !existsSync(dir)) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSessionJsonl(full, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const st = await stat(full);
        out.push({ file: full, mtime: st.mtimeMs, size: st.size });
      } catch {
        // ignore
      }
    }
  }
}

function eventName(obj: Record<string, unknown>): string {
  const payload = obj.payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.type === "string") return p.type;
    if (typeof p.status === "string") return p.status;
  }
  if (
    typeof obj.type === "string" &&
    obj.type !== "event_msg" &&
    obj.type !== "response_item"
  ) {
    return obj.type;
  }
  if (typeof obj.event === "string") return obj.event;
  if (typeof obj.status === "string") return obj.status;
  return "";
}

/** Read only the end of a session file (Codex desktop rollouts can be 10MB+). */
async function readSessionTail(file: string): Promise<string> {
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

async function parseSession(
  file: string,
  mtime: number,
): Promise<RawAgent | null> {
  let text: string;
  try {
    text = await readSessionTail(file);
  } catch {
    return null;
  }

  const lines = text.trim().split(/\n+/).slice(-TAIL_LINES);
  let state: Exclude<AgentState, "empty"> = "idle";
  // Unnamed sessions fall back to the rollout timestamp id — compress
  // "2026-07-31T10-19-…" into a readable "7/31 10:19" for the lane cards.
  const raw = basename(file).replace(/^rollout-/, "");
  const ts = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  let title = ts
    ? `${Number(ts[2])}/${Number(ts[3])} ${ts[4]}:${ts[5]}`
    : raw.slice(0, 36);
  let sawEvent = false;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const name = eventName(obj);
    if (
      !name ||
      name === "token_count" ||
      name === "session_meta" ||
      name === "turn_context" ||
      name === "world_state"
    ) {
      // session_meta may still carry a title
      const payload = obj.payload;
      if (payload && typeof payload === "object") {
        const p = payload as Record<string, unknown>;
        if (typeof p.thread_name === "string") title = p.thread_name.slice(0, 40);
        else if (typeof p.title === "string") title = p.title.slice(0, 40);
      }
      continue;
    }

    const mapped = mapEventType(name);
    if (mapped) {
      state = mapped;
      sawEvent = true;
    }

    const payload = obj.payload;
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (typeof p.thread_name === "string") title = p.thread_name.slice(0, 40);
      else if (typeof p.title === "string") title = p.title.slice(0, 40);
    }
    if (typeof obj.thread_name === "string") title = obj.thread_name.slice(0, 40);
  }

  if (!sawEvent) state = "idle";
  const ageSec = (Date.now() - mtime) / 1000;
  state = ageState(state, ageSec);

  return {
    id: file,
    title,
    state,
    updatedAt: mtime,
    // Codex desktop on macOS is packaged as ChatGPT.app (Application Support/Codex).
    focusAction: { kind: "activate_app", payload: "ChatGPT" },
  };
}

export const codexAdapter: ToolAdapter = {
  tool: "codex",
  async collect(): Promise<AdapterResult> {
    ensureWatcher();

    if (!existsSync(SESSIONS)) {
      return {
        tool: "codex",
        agents: [],
        health: "degraded",
        note: "~/.codex/sessions not found; start Codex / ChatGPT app",
      };
    }

    const ranked: { file: string; mtime: number; size: number }[] = [];
    await walkSessionJsonl(SESSIONS, ranked);
    ranked.sort((a, b) => b.mtime - a.mtime);

    const agents: RawAgent[] = [];
    for (const item of ranked.slice(0, 8)) {
      const agent = await parseSession(item.file, item.mtime);
      if (agent) agents.push(agent);
    }

    return {
      tool: "codex",
      agents,
      health: agents.length ? "ok" : "degraded",
      note: agents.length
        ? undefined
        : "No Codex session signals yet; commands still work",
    };
  },
};

export function stopCodexWatcher(): void {
  watcher?.close();
  watcher = null;
  watchBooted = false;
}
