import { existsSync, watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FocusAction, RawAgent } from "../types.js";
import { invalidateStatus } from "../lib/cache.js";
import { decodeProjectDirCached } from "../lib/projectpath.js";
import type { AdapterResult, ToolAdapter } from "./types.js";

const execFileAsync = promisify(execFile);
const CURSOR_HOME = join(homedir(), ".cursor");
const PROJECTS = join(CURSOR_HOME, "projects");

type FileCache = {
  mtime: number;
  lines: string[];
  state: RawAgent["state"];
  title: string;
};

const fileCache = new Map<string, FileCache>();
let transcriptIndex: { file: string; mtime: number }[] = [];
let indexAt = 0;
let watchers: FSWatcher[] = [];
let watchBooted = false;
let reindexTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReindex(): void {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    reindexTimer = null;
    void rebuildIndex().then(() => invalidateStatus("cursor"));
  }, 80);
}

async function cursorRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-lf", "Cursor"], {
      timeout: 800,
    });
    return /Cursor\.app|Cursor Helper/i.test(stdout);
  } catch {
    return false;
  }
}

async function walkJsonl(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 3) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkJsonl(full, out, depth + 1);
    else if (e.name.endsWith(".jsonl")) out.push(full);
  }
}

async function rebuildIndex(): Promise<void> {
  if (!existsSync(PROJECTS)) {
    transcriptIndex = [];
    indexAt = Date.now();
    return;
  }
  const files: string[] = [];
  let projects: string[] = [];
  try {
    projects = (await readdir(PROJECTS)).slice(0, 80);
  } catch {
    transcriptIndex = [];
    indexAt = Date.now();
    return;
  }
  for (const proj of projects) {
    const dir = join(PROJECTS, proj, "agent-transcripts");
    if (!existsSync(dir)) continue;
    await walkJsonl(dir, files);
  }

  const ranked: { file: string; mtime: number }[] = [];
  const live = new Set<string>();
  for (const file of files) {
    try {
      const st = await stat(file);
      if (Date.now() - st.mtimeMs > 1000 * 60 * 60 * 6) continue;
      ranked.push({ file, mtime: st.mtimeMs });
      live.add(file);
    } catch {
      // ignore
    }
  }
  ranked.sort((a, b) => b.mtime - a.mtime);
  transcriptIndex = ranked;
  indexAt = Date.now();

  for (const key of fileCache.keys()) {
    if (!live.has(key)) fileCache.delete(key);
  }
}

function ensureWatchers(): void {
  if (watchBooted) return;
  watchBooted = true;
  if (!existsSync(PROJECTS)) return;
  try {
    const root = watch(PROJECTS, { recursive: true }, (_evt, filename) => {
      if (filename && !String(filename).endsWith(".jsonl")) return;
      scheduleReindex();
    });
    watchers.push(root);
  } catch {
    // recursive watch unsupported — fall back to periodic reindex
  }
}

/** done を維持する時間（未確認の完了を残す — plugin 側が 90 秒超を深緑表示）。 */
const DONE_HOLD_SEC = 60 * 30;

function inferState(lines: string[], ageSec: number): RawAgent["state"] {
  const last = (lines[lines.length - 1] || "").toLowerCase();
  const prev = (lines[lines.length - 2] || "").toLowerCase();

  if (/turn_ended/.test(last) && /error|fail/.test(last)) return "error";
  // Explicit field/event only — avoid free-text words like "question"/"approval".
  if (
    /"needs_input"|needs_input|waiting_for_user|awaiting_approval|approval_requested/.test(
      last,
    )
  ) {
    return "needs_input";
  }

  if (/role":"user"|user_query/.test(last)) {
    return ageSec <= 60 * 30 ? "thinking" : "idle";
  }

  if (/role":"assistant"|tool_call|function_call/.test(last) && ageSec <= 15) {
    return "thinking";
  }

  if (/turn_ended/.test(last)) {
    if (ageSec <= DONE_HOLD_SEC) return "done";
    return "idle";
  }

  if (/role":"assistant"/.test(last) && ageSec <= DONE_HOLD_SEC) return "done";
  if (
    /role":"assistant"/.test(prev) &&
    /turn_ended/.test(last) &&
    ageSec <= DONE_HOLD_SEC
  ) {
    return "done";
  }

  return "idle";
}

/** Project folder name first (user preference); query words only when the
 * project dir is an anonymous epoch id. */
function titleFromTranscript(lines: string[], file: string): string {
  const proj = file.split("/projects/")[1]?.split("/")[0] ?? "";
  if (proj && !/^\d{13}$/.test(proj)) {
    return proj.replace(/^Users-[^-]+-/, "").slice(0, 28) || "Cursor";
  }
  for (const line of lines.slice(0, 3)) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.role !== "user") continue;
      const msg = obj.message as Record<string, unknown> | undefined;
      const content = Array.isArray(msg?.content) ? msg.content : [];
      for (const c of content) {
        const text = typeof c?.text === "string" ? c.text : "";
        const q = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
        const words = (q ? q[1] : text).replace(/\s+/g, " ").trim();
        if (words) return [...words].slice(0, 28).join("");
      }
    } catch {
      // not JSON — keep looking
    }
  }
  if (/^\d{13}$/.test(proj)) {
    const d = new Date(Number(proj));
    return `${d.getMonth() + 1}/${d.getDate()} session`;
  }
  return "Cursor";
}

/**
 * レーン押下時のジャンプ先: プロジェクト dir 名を実パスへ復号できたら
 * cursor:// ディープリンク（Cursor がそのフォルダを開く）、できなければ
 * 従来どおりアプリ前面化。
 */
function focusActionForFile(file: string): FocusAction {
  const proj = file.split("/projects/")[1]?.split("/")[0] ?? "";
  if (proj) {
    const real = decodeProjectDirCached(proj);
    if (real) return { kind: "open_url", payload: `cursor://file${real}` };
  }
  return { kind: "activate_app", payload: "Cursor" };
}

async function readCached(file: string, mtime: number): Promise<FileCache | null> {
  const hit = fileCache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  try {
    const text = await readFile(file, "utf8");
    const lines = text.trim().split(/\n+/);
    const ageSec = (Date.now() - mtime) / 1000;
    const state = inferState(lines, ageSec);
    const entry: FileCache = {
      mtime,
      lines,
      state,
      title: titleFromTranscript(lines, file),
    };
    fileCache.set(file, entry);
    return entry;
  } catch {
    return null;
  }
}

async function agentsFromTranscripts(): Promise<RawAgent[]> {
  ensureWatchers();
  if (Date.now() - indexAt > 5000 || !transcriptIndex.length) {
    await rebuildIndex();
  }

  const agents: RawAgent[] = [];
  for (const item of transcriptIndex.slice(0, 8)) {
    const cached = await readCached(item.file, item.mtime);
    if (!cached) continue;
    // Recompute state from age even if file unchanged (done→idle expiry).
    const ageSec = (Date.now() - item.mtime) / 1000;
    const state = inferState(cached.lines, ageSec);
    agents.push({
      id: item.file,
      title: cached.title,
      state,
      updatedAt: item.mtime,
      focusAction: focusActionForFile(item.file),
    });
  }
  return agents;
}

export const cursorAdapter: ToolAdapter = {
  tool: "cursor",
  async collect(): Promise<AdapterResult> {
    const [running, fromTranscripts] = await Promise.all([
      cursorRunning(),
      agentsFromTranscripts(),
    ]);

    if (fromTranscripts.length) {
      const active = fromTranscripts.some((a) => a.state !== "idle");
      return {
        tool: "cursor",
        agents: fromTranscripts,
        health: active ? "ok" : "degraded",
        note: active
          ? "Cursor agent activity from local transcripts"
          : "Cursor transcripts found; no active turn detected",
      };
    }

    if (running) {
      return {
        tool: "cursor",
        agents: [
          {
            id: "cursor-app",
            title: "Cursor",
            state: "idle",
            updatedAt: Date.now(),
            focusAction: { kind: "activate_app", payload: "Cursor" },
          },
        ],
        health: "degraded",
        note: "Cursor running; no recent agent transcripts",
      };
    }

    return {
      tool: "cursor",
      agents: [],
      health: "degraded",
      note: "Cursor not detected",
    };
  },
};
