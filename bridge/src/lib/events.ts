import type { AgentSnapshot, ToolId } from "../types.js";

/**
 * Push-style state events from tool hooks (e.g. Claude Code Notification /
 * Stop hooks). Transcript inference cannot distinguish "about to run a tool"
 * from "waiting for permission to run it" — the hook can, so a fresh event
 * overrides the inferred state for its session.
 */

type ToolEvent = {
  state: "needs_input" | "done";
  at: number;
  sessionId: string;
};

const TTL_MS = 10 * 60 * 1000;
/** Adapter activity newer than the event by this margin supersedes it. */
const SUPERSEDE_MS = 2000;

const events = new Map<ToolId, ToolEvent[]>();

export function recordEvent(
  tool: ToolId,
  state: ToolEvent["state"],
  sessionId: string,
): void {
  const list = events.get(tool) ?? [];
  const kept = list.filter(
    (e) => e.sessionId !== sessionId && Date.now() - e.at < TTL_MS,
  );
  kept.push({ state, at: Date.now(), sessionId });
  events.set(tool, kept);
}

/** Mutates agent states where a live hook event outranks inference. */
export function applyEvents(tool: ToolId, agents: AgentSnapshot[]): void {
  const list = events.get(tool);
  if (!list?.length) return;
  const now = Date.now();
  const live: ToolEvent[] = [];
  for (const ev of list) {
    if (now - ev.at >= TTL_MS) continue;
    const agent = ev.sessionId
      ? agents.find((a) => String(a.id).includes(ev.sessionId))
      : undefined;
    if (!agent) {
      live.push(ev);
      continue;
    }
    if (agent.updatedAt > ev.at + SUPERSEDE_MS) {
      // The session moved on after the event — inference wins again.
      continue;
    }
    if (agent.state !== "error") agent.state = ev.state;
    live.push(ev);
  }
  events.set(tool, live);
}
