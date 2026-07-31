/**
 * Vibe Deck — pure helpers for the Phase B dynamic lane cards.
 *
 * No I/O, no timers, no globals — fully unit-testable (tests/lanecards.test.mjs).
 * The renderer process management lives in plugin.js; everything decidable
 * from plain data (content keys, format detection, statelist items) lives here.
 */
"use strict";

/** States the lane renderer knows how to draw. Anything else → Phase A frames. */
const RENDERABLE_STATES = new Set([
  "idle",
  "thinking",
  "done",
  "needs_input",
  "error",
  "empty",
]);

/** How long the done-pop GIF stays before settling to the static card. */
const POP_WINDOW_MS = 8000;

/** Unit separator — cannot appear in titles/details, so keys never collide. */
const KEY_SEP = "";

function isRenderableState(state) {
  return typeof state === "string" && RENDERABLE_STATES.has(state);
}

/** Minutes spent in the current state; bad clocks / missing data → 0. */
function elapsedMinutes(nowMs, sinceMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(sinceMs)) return 0;
  const delta = nowMs - sinceMs;
  if (delta <= 0) return 0;
  return Math.floor(delta / 60000);
}

/** Should the done card use the pop GIF? Only briefly after entering done. */
function wantsPop(state, nowMs, doneAtMs) {
  if (state !== "done") return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(doneAtMs)) return false;
  const elapsed = nowMs - doneAtMs;
  return elapsed >= 0 && elapsed < POP_WINDOW_MS;
}

/**
 * Content key for the diff: re-render only when it changes.
 * Fields per plan.md Phase B: tool | slot | state | title | elapsed-min | detail
 * (+ pop, because pop expiry must trigger the static re-render).
 */
function buildContentKey({ tool, slot, state, title, elapsedMin, detail, pop }) {
  return [
    String(tool || ""),
    String(slot ?? ""),
    String(state || ""),
    String(title || ""),
    String(elapsedMin ?? 0),
    String(detail || ""),
    pop ? "pop" : "",
  ].join(KEY_SEP);
}

/**
 * Detect the image format of a renderer reply from its base64 prefix.
 * "R0lGOD" = GIF87a/89a, "iVBORw" = PNG. Anything else → null (reject).
 */
function detectImageFormat(b64) {
  if (typeof b64 !== "string") return null;
  if (b64.startsWith("R0lGOD")) return "gif";
  if (b64.startsWith("iVBORw")) return "png";
  return null;
}

/**
 * Parse one stdout line from the renderer.
 * @returns {{ok: true, format: "png"|"gif", data: string} | {ok: false, error: string}}
 */
function parseRendererLine(line) {
  const text = typeof line === "string" ? line.trim() : "";
  if (!text) return { ok: false, error: "empty renderer reply" };
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text);
      return { ok: false, error: String(obj?.error || "renderer error") };
    } catch {
      return { ok: false, error: "unparseable renderer reply" };
    }
  }
  const format = detectImageFormat(text);
  if (!format) return { ok: false, error: "unknown image format" };
  return { ok: true, format, data: text };
}

/**
 * Build the statelist element for a dynamic card (plan.md Phase B wire format):
 *   PNG: { ..., type: 1, data: <b64>, textData: "", showtext: false }
 *   GIF: { ..., type: 3, gifdata: <b64> }
 */
function buildCardItem(meta, format, b64) {
  const base = {
    actionid: meta.actionid,
    key: meta.key,
    uuid: meta.uuid,
    controller: meta.controller || "Keypad",
    device: meta.device || "D200X",
    textData: "",
    showtext: false,
  };
  if (format === "gif") return { ...base, type: 3, gifdata: b64 };
  return { ...base, type: 1, data: b64 };
}

/** Build the renderer request payload for a lane. */
function buildRenderRequest({ state, title, elapsedMin, detail, pop }) {
  return {
    state: String(state || ""),
    title: String(title || ""),
    elapsed: Number.isFinite(elapsedMin) ? elapsedMin : 0,
    detail: String(detail || ""),
    frames: pop ? "pop" : "",
  };
}

module.exports = {
  RENDERABLE_STATES,
  POP_WINDOW_MS,
  isRenderableState,
  elapsedMinutes,
  wantsPop,
  buildContentKey,
  detectImageFormat,
  parseRendererLine,
  buildCardItem,
  buildRenderRequest,
};
