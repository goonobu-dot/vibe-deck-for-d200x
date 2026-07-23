import {
  type AgentSnapshot,
  type AgentState,
  type RawAgent,
  STATE_PRIORITY,
} from "../types.js";

export const MAX_SLOTS = 8;

export function assignSlots(
  agents: RawAgent[],
  maxSlots: number = MAX_SLOTS,
  opts: { prioritize?: boolean } = {},
): AgentSnapshot[] {
  const prioritize = opts.prioritize !== false;
  const sorted = prioritize
    ? [...agents].sort((a, b) => {
        const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
        if (byState !== 0) return byState;
        return b.updatedAt - a.updatedAt;
      })
    : [...agents];

  const picked = sorted.slice(0, maxSlots);
  const now = Date.now();
  const out: AgentSnapshot[] = [];

  // Prefer keeping lanes useful: unused slots become Ready (idle) mirrors of
  // the most recent agent / app focus, instead of dim "empty" tiles.
  const seed = picked[0];
  for (let i = 0; i < maxSlots; i += 1) {
    const agent = picked[i];
    if (!agent) {
      out.push({
        slot: i + 1,
        id: `ready-${i + 1}`,
        title: seed?.title ? `Ready · ${seed.title}` : `Ready ${i + 1}`,
        state: "idle",
        updatedAt: now,
        focusAction: seed?.focusAction,
      });
      continue;
    }
    out.push({
      slot: i + 1,
      id: agent.id,
      title: agent.title,
      state: agent.state,
      updatedAt: agent.updatedAt,
      focusAction: agent.focusAction,
    });
  }

  return out;
}

export function emptyBoard(maxSlots: number = MAX_SLOTS): AgentSnapshot[] {
  return assignSlots([], maxSlots);
}

export function isActiveState(state: AgentState): boolean {
  return state !== "empty" && state !== "idle";
}
