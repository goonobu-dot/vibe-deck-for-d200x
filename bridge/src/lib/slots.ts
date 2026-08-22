import {
  type AgentSnapshot,
  type AgentState,
  type RawAgent,
  STATE_PRIORITY,
} from "../types.js";

export const MAX_SLOTS = 8;
/** The deck only paints five lanes — anything past this is invisible. */
export const VISIBLE_SLOTS = 5;

/** Lower = more deserving of a visible lane. */
function laneRank(a: RawAgent): number {
  return STATE_PRIORITY[a.state];
}

function isBusy(a: RawAgent): boolean {
  return a.state === "thinking" || a.state === "needs_input" || a.state === "error";
}

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

  // Stickiness must never hide live work: a busy session parked outside the
  // visible lanes trades places with the least important visible one.
  const visible = Math.min(VISIBLE_SLOTS, maxSlots);
  for (const agent of picked) {
    if (!isBusy(agent)) continue;
    const slot = lanes.get(agent.id);
    if (slot && slot <= visible) continue;
    let victimSlot = 0;
    let victim: RawAgent | undefined;
    for (let s = 1; s <= visible; s += 1) {
      const held = bySlot.get(s);
      if (!held) {
        victimSlot = s;
        victim = undefined;
        break;
      }
      if (isBusy(held)) continue;
      if (
        !victim ||
        laneRank(held) > laneRank(victim) ||
        (laneRank(held) === laneRank(victim) && held.updatedAt < victim.updatedAt)
      ) {
        victim = held;
        victimSlot = s;
      }
    }
    if (!victimSlot) continue; // every visible lane is busy — leave as is
    if (victim) {
      if (slot) {
        bySlot.set(slot, victim);
        lanes.set(victim.id, slot);
      } else {
        bySlot.delete(victimSlot);
        lanes.delete(victim.id);
      }
    }
    bySlot.set(victimSlot, agent);
    lanes.set(agent.id, victimSlot);
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
