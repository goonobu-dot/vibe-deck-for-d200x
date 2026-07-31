/**
 * Vibe Deck — pure frame arithmetic for the agent-state animations (Phase A).
 *
 * Maps a logical agent state + wall-clock time to a manifest States index.
 * No I/O, no timers, no globals — fully unit-testable (tests/frames.test.mjs).
 *
 * Frame layout (manifest.json "agent" action States):
 *   0 idle / 1 thinking / 2 done / 3 needs_input / 4 error / 5 empty
 *   6 thinking-dim (breathing)  7 needs_input-off (blink)
 *   8 done-pop (check pops for 600ms after entering done)  9 blocked (red X)
 */
"use strict";

const STATE_INDEX = {
  idle: 0,
  thinking: 1,
  done: 2,
  needs_input: 3,
  error: 4,
  empty: 5,
};

const FRAME = {
  THINKING_DIM: 6,
  NEEDS_INPUT_OFF: 7,
  DONE_POP: 8,
  BLOCKED: 9,
};

// Full blink cycles (bright + dim). Half of each period is spent per frame.
const THINKING_PERIOD_MS = 1600;
const NEEDS_INPUT_PERIOD_MS = 500;
// How long the "pop" frame shows after a lane transitions into done.
const DONE_POP_MS = 600;

/**
 * Phase helper: alternate between two frames on a fixed period anchored to
 * epoch time (nowMs), so the phase is identical for every slot by design.
 */
function blinkFrame(nowMs, periodMs, onFrame, offFrame) {
  const half = periodMs / 2;
  return Math.floor(nowMs / half) % 2 === 0 ? onFrame : offFrame;
}

/**
 * Compute the States index to display for a logical agent state.
 *
 * @param {string} state    logical state ("idle" | "thinking" | "done" |
 *                          "needs_input" | "error" | "empty"); anything else
 *                          falls back to empty, matching the paint loop.
 * @param {number} nowMs    current time (ms). Non-finite values are treated
 *                          as 0 so a bad clock can never crash the paint loop.
 * @param {number} [doneAtMs] time (ms) the lane transitioned INTO done.
 *                          Optional; only meaningful for state === "done".
 * @returns {number} frame index 0..9
 */
function frameFor(state, nowMs, doneAtMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  switch (state) {
    case "idle":
      return STATE_INDEX.idle;
    case "error":
      return STATE_INDEX.error;
    case "empty":
      return STATE_INDEX.empty;
    // Phase A には専用フレームが無い論理状態のフォールバック:
    // done_old（未確認の完了）は done の緑、offline は empty の灰で近似する。
    case "done_old":
      return STATE_INDEX.done;
    case "offline":
      return STATE_INDEX.empty;
    case "done": {
      if (Number.isFinite(doneAtMs)) {
        const elapsed = now - doneAtMs;
        // Negative elapsed = clock skew; treat as "not popping" (safe frame).
        if (elapsed >= 0 && elapsed < DONE_POP_MS) return FRAME.DONE_POP;
      }
      return STATE_INDEX.done;
    }
    case "thinking":
      return blinkFrame(
        now,
        THINKING_PERIOD_MS,
        STATE_INDEX.thinking,
        FRAME.THINKING_DIM,
      );
    case "needs_input":
      return blinkFrame(
        now,
        NEEDS_INPUT_PERIOD_MS,
        STATE_INDEX.needs_input,
        FRAME.NEEDS_INPUT_OFF,
      );
    default:
      return STATE_INDEX.empty;
  }
}

module.exports = {
  frameFor,
  STATE_INDEX,
  FRAME,
  THINKING_PERIOD_MS,
  NEEDS_INPUT_PERIOD_MS,
  DONE_POP_MS,
};
