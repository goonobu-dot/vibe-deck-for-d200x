/**
 * Unit tests for app/frames.js — state→frame arithmetic for Phase A animations.
 * Run: node --test tests/  (from the plugin directory)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const frames = require("../app/frames.js");
const {
  frameFor,
  STATE_INDEX,
  FRAME,
  THINKING_PERIOD_MS,
  NEEDS_INPUT_PERIOD_MS,
  DONE_POP_MS,
} = frames;

// ---------------------------------------------------------------------------
// Constants — frame layout must match manifest.json States order
// ---------------------------------------------------------------------------

describe("frame layout constants", () => {
  test("base state indexes are 0..5", () => {
    assert.deepEqual(STATE_INDEX, {
      idle: 0,
      thinking: 1,
      done: 2,
      needs_input: 3,
      error: 4,
      empty: 5,
    });
  });

  test("animation frames are 6..9", () => {
    assert.equal(FRAME.THINKING_DIM, 6);
    assert.equal(FRAME.NEEDS_INPUT_OFF, 7);
    assert.equal(FRAME.DONE_POP, 8);
    assert.equal(FRAME.BLOCKED, 9);
  });

  test("periods match plan.md", () => {
    assert.equal(THINKING_PERIOD_MS, 1600);
    assert.equal(NEEDS_INPUT_PERIOD_MS, 500);
    assert.equal(DONE_POP_MS, 600);
  });

  test("manifest agent States cover every frame index", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    );
    const agent = manifest.Actions.find(
      (a) => a.UUID === "com.vibe.deck.status.agent",
    );
    assert.ok(agent, "agent action missing from manifest");
    assert.equal(agent.States.length, 10);
    assert.equal(agent.States[6].Image, "Images/agent-thinking-dim.png");
    assert.equal(agent.States[7].Image, "Images/agent-needs_input-off.png");
    assert.equal(agent.States[8].Image, "Images/agent-done-pop.png");
    assert.equal(agent.States[9].Image, "Images/agent-blocked.png");
    const verb = manifest.Actions.find(
      (a) => a.UUID === "com.vibe.deck.status.verb",
    );
    assert.ok(verb, "verb action missing from manifest");
    assert.equal(verb.States.length, 2);
    assert.equal(verb.States[0].Image, "Images/agent-empty.png");
    assert.equal(verb.States[1].Image, "Images/agent-blocked.png");
  });
});

// ---------------------------------------------------------------------------
// Static states
// ---------------------------------------------------------------------------

describe("static states", () => {
  test("idle / error / empty are time-independent", () => {
    for (const nowMs of [0, 1, 799, 12345678, Date.now()]) {
      assert.equal(frameFor("idle", nowMs), 0);
      assert.equal(frameFor("error", nowMs), 4);
      assert.equal(frameFor("empty", nowMs), 5);
    }
  });

  test("unknown or missing state falls back to empty", () => {
    assert.equal(frameFor("bogus", 1000), 5);
    assert.equal(frameFor("", 1000), 5);
    assert.equal(frameFor(undefined, 1000), 5);
    assert.equal(frameFor(null, 1000), 5);
  });
});

// ---------------------------------------------------------------------------
// done — pop window
// ---------------------------------------------------------------------------

describe("done pop window", () => {
  const t0 = 100000;

  test("no transition timestamp -> plain done", () => {
    assert.equal(frameFor("done", t0), 2);
    assert.equal(frameFor("done", t0, undefined), 2);
    assert.equal(frameFor("done", t0, NaN), 2);
  });

  test("pops for exactly [0, 600) ms after transition", () => {
    assert.equal(frameFor("done", t0, t0), 8); // elapsed 0
    assert.equal(frameFor("done", t0 + 1, t0), 8);
    assert.equal(frameFor("done", t0 + 599, t0), 8); // last pop tick
    assert.equal(frameFor("done", t0 + 600, t0), 2); // window closed
    assert.equal(frameFor("done", t0 + 601, t0), 2);
    assert.equal(frameFor("done", t0 + 60000, t0), 2);
  });

  test("clock skew (doneAt in the future) never pops", () => {
    assert.equal(frameFor("done", t0, t0 + 1000), 2);
  });
});

// ---------------------------------------------------------------------------
// thinking — 1600ms breathing (800ms per frame)
// ---------------------------------------------------------------------------

describe("thinking breathing", () => {
  test("alternates 1 <-> 6 every half period", () => {
    assert.equal(frameFor("thinking", 0), 1);
    assert.equal(frameFor("thinking", 799), 1);
    assert.equal(frameFor("thinking", 800), 6);
    assert.equal(frameFor("thinking", 1599), 6);
    assert.equal(frameFor("thinking", 1600), 1); // full period wraps
    assert.equal(frameFor("thinking", 2399), 1);
    assert.equal(frameFor("thinking", 2400), 6);
  });

  test("phase is anchored to the clock, not the caller (slot-independent)", () => {
    const now = 987654321;
    const a = frameFor("thinking", now);
    const b = frameFor("thinking", now);
    assert.equal(a, b);
    assert.ok([1, 6].includes(a));
  });
});

// ---------------------------------------------------------------------------
// needs_input — 500ms blink (250ms per frame)
// ---------------------------------------------------------------------------

describe("needs_input blink", () => {
  test("alternates 3 <-> 7 every half period", () => {
    assert.equal(frameFor("needs_input", 0), 3);
    assert.equal(frameFor("needs_input", 249), 3);
    assert.equal(frameFor("needs_input", 250), 7);
    assert.equal(frameFor("needs_input", 499), 7);
    assert.equal(frameFor("needs_input", 500), 3); // full period wraps
    assert.equal(frameFor("needs_input", 750), 7);
  });
});

// ---------------------------------------------------------------------------
// Defensive: bad clocks must never crash the paint loop
// ---------------------------------------------------------------------------

describe("non-finite nowMs", () => {
  test("treated as time 0 for every state", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined]) {
      assert.equal(frameFor("thinking", bad), 1);
      assert.equal(frameFor("needs_input", bad), 3);
      assert.equal(frameFor("idle", bad), 0);
      assert.equal(frameFor("done", bad), 2);
      assert.equal(frameFor("empty", bad), 5);
    }
  });

  test("frameFor always returns a valid frame index 0..9", () => {
    const states = [
      "idle",
      "thinking",
      "done",
      "needs_input",
      "error",
      "empty",
      "junk",
    ];
    for (const state of states) {
      for (const now of [0, 123, 800, 250, 99999]) {
        const f = frameFor(state, now, now - 100);
        assert.ok(Number.isInteger(f) && f >= 0 && f <= 9, `${state}@${now}=${f}`);
      }
    }
  });
});
