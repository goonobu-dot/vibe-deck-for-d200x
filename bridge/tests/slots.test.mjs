import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Compile-independent copy of slot logic for unit tests
const STATE_PRIORITY = {
  error: 0,
  needs_input: 1,
  thinking: 2,
  done: 3,
  idle: 4,
  empty: 5,
};

function assignSlots(agents, maxSlots = 8) {
  const sorted = [...agents].sort((a, b) => {
    const byState = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    if (byState !== 0) return byState;
    return b.updatedAt - a.updatedAt;
  });
  const picked = sorted.slice(0, maxSlots);
  const now = Date.now();
  const out = [];
  for (let i = 0; i < maxSlots; i += 1) {
    const agent = picked[i];
    if (!agent) {
      out.push({
        slot: i + 1,
        id: `empty-${i + 1}`,
        title: `Slot ${i + 1}`,
        state: "empty",
        updatedAt: now,
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

test("notification priority puts error and needs_input first", () => {
  const now = Date.now();
  const agents = assignSlots([
    { id: "1", title: "idle", state: "idle", updatedAt: now },
    { id: "2", title: "err", state: "error", updatedAt: now },
    { id: "3", title: "ask", state: "needs_input", updatedAt: now },
    { id: "4", title: "think", state: "thinking", updatedAt: now },
  ]);
  assert.equal(agents[0].state, "error");
  assert.equal(agents[1].state, "needs_input");
  assert.equal(agents[2].state, "thinking");
  assert.equal(agents[3].state, "idle");
  assert.equal(agents.length, 8);
  assert.equal(agents[7].state, "empty");
});

test("pads to eight empty slots", () => {
  const agents = assignSlots([]);
  assert.equal(agents.length, 8);
  assert.ok(agents.every((a) => a.state === "empty"));
});

// silence unused
createRequire(import.meta.url);

test("lanes stick to a session even when another one outranks it", async () => {
  const { assignSlots, resetStickySlots } = await import("../dist/lib/slots.js");
  resetStickySlots();
  const mk = (id, state, t) => ({ id, title: id, state, updatedAt: t, focusAction: undefined });
  const first = assignSlots([mk("A", "thinking", 200), mk("B", "idle", 100)], 8, { tool: "x" });
  assert.equal(first[0].id, "A");
  assert.equal(first[1].id, "B");
  // B becomes the hottest and a brand new session appears: A and B keep lanes.
  const second = assignSlots(
    [mk("B", "needs_input", 400), mk("A", "done", 300), mk("C", "thinking", 350)],
    8,
    { tool: "x" },
  );
  assert.equal(second[0].id, "A");
  assert.equal(second[1].id, "B");
  assert.equal(second[2].id, "C"); // newcomer takes the first free lane
  // A disappears → its lane is freed and reused by the next newcomer.
  const third = assignSlots([mk("B", "idle", 500), mk("D", "thinking", 500)], 8, { tool: "x" });
  assert.equal(third[1].id, "B");
  assert.equal(third[0].id, "D");
  resetStickySlots();
});
