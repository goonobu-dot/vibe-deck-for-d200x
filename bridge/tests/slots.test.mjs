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
