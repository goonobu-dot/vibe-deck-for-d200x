import {
  type AgentSnapshot,
  type AgentState,
  type RawAgent,
  STATE_PRIORITY,
} from "../types.js";

export const MAX_SLOTS = 8;

/**
 * Sticky lane assignment: a session keeps the same physical key for as long
 * as it is present. Re-ranking every poll made cards shift sideways whenever
 * another session woke up — the deck looked like it was misbehaving.
 * Priority only decides which sessions get a lane and where NEW ones land.
 */
const sticky = new Map<string, Map<string, number>>(); // tool -> id -> slot

function laneMap(tool: string): Map<string, number> {
  let m = sticky.get(tool);
  if (!m) {
    m = new Map();
    sticky.set(tool, m);
  }
  return m;
}

/** Test seam: forget remembered lanes. */
export function resetStickySlots(): void {
  sticky.clear();
}

export function assignSlots(
  agents: RawAgent[],
  maxSlots: number = MAX_SLOTS,
  opts: { prioritize?: boolean; tool?: string } = {},
): AgentSnapshot[] {
  const prioritize = opts.prioritize !== false;
  const ranked = prioritize
    ? [...agents].sort((a, b) => {
        const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
        if (byState !== 0) return byState;
        return b.updatedAt - a.updatedAt;
      })
    : [...agents];

  const picked = ranked.slice(0, maxSlots);
  const now = Date.now();

  const lanes = opts.tool ? laneMap(opts.tool) : new Map<string, number>();
  const present = new Set(picked.map((a) => a.id));
  for (const id of [...lanes.keys()]) {
    if (!present.has(id)) lanes.delete(id); // free the lane when it drops out
  }

  const bySlot = new Map<number, RawAgent>();
  const needsLane: RawAgent[] = [];
  for (const agent of picked) {
    const slot = lanes.get(agent.id);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, agent);
    else needsLane.push(agent);
  }
  // New sessions fill the lowest free lane, in priority order.
  for (const agent of needsLane) {
    for (let s = 1; s <= maxSlots; s += 1) {
      if (bySlot.has(s)) continue;
      bySlot.set(s, agent);
      lanes.set(agent.id, s);
      break;
    }
  }

  const seed = picked[0];
  const out: AgentSnapshot[] = [];
  for (let i = 1; i <= maxSlots; i += 1) {
    const agent = bySlot.get(i);
    if (!agent) {
      out.push({
        slot: i,
        id: `ready-${i}`,
        title: seed?.title ? `Ready · ${seed.title}` : `Ready ${i}`,
        state: "idle",
        updatedAt: now,
        focusAction: seed?.focusAction,
      });
      continue;
    }
    out.push({
      slot: i,
      id: agent.id,
      title: agent.title,
      state: agent.state,
      updatedAt: agent.updatedAt,
      focusAction: agent.focusAction,
      ...(agent.detail ? { detail: agent.detail } : {}),
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
