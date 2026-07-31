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
  "done_old",
  "needs_input",
  "error",
  "empty",
  "offline",
]);

/** How long the done-pop GIF stays before settling to the static card. */
const POP_WINDOW_MS = 8000;

/** done がこの時間を超えたら「未確認の完了」= done_old（深緑）表示。 */
const DONE_OLD_AFTER_MS = 90_000;

/** thinking がこの時間続いたら長考アラート（呼吸を速く・明暗差強く）。 */
const URGENT_THINKING_MS = 15 * 60_000;

/** bridge fetch がこの回数連続で失敗したら全レーン OFFLINE 表示。 */
const OFFLINE_AFTER_FAILURES = 3;

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

/**
 * 機能1a — 表示上の論理状態を決める純関数。
 * done レーンだけが変換対象:
 *   - レーン押下（ackAt）が updatedAt 以降なら既読 → "idle"
 *   - 未読のまま DONE_OLD_AFTER_MS を超えたら → "done_old"（深緑）
 *   - それ以外は "done" のまま
 * done 以外の state はそのまま返す（ack は他状態に影響しない）。
 *
 * @param {{state: string, updatedAt?: number, ackAt?: number, nowMs: number}} p
 * @returns {string}
 */
function effectiveLaneState({ state, updatedAt, ackAt, nowMs }) {
  if (state !== "done") return state;
  const updated = Number.isFinite(updatedAt) ? updatedAt : null;
  if (updated !== null && Number.isFinite(ackAt) && updated <= ackAt) {
    return "idle"; // 押下時点より古い完了 = 既読
  }
  if (updated !== null && Number.isFinite(nowMs)) {
    const age = nowMs - updated;
    if (age > DONE_OLD_AFTER_MS) return "done_old";
  }
  return "done";
}

/**
 * 機能1b — 長考アラート判定の純関数。thinking が URGENT_THINKING_MS 以上
 * 続いたら true。時計異常・欠損は false（安全側）。
 */
function isUrgentThinking(state, nowMs, sinceMs) {
  if (state !== "thinking") return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(sinceMs)) return false;
  const elapsed = nowMs - sinceMs;
  return elapsed >= URGENT_THINKING_MS;
}

/**
 * 機能1c — OFFLINE 判定の純関数。連続失敗回数が閾値以上なら true。
 * 非数・負数は 0 扱い（安全側 = オンライン表示のまま）。
 */
function isBridgeOffline(consecutiveFailures) {
  const n = Number.isFinite(consecutiveFailures) ? consecutiveFailures : 0;
  return n >= OFFLINE_AFTER_FAILURES;
}

/**
 * 機能2 — レーン押下時の focusAction を最新スナップショットから解決する純関数。
 * 検証済みの action だけ返し、不正・欠損は null（呼び出し側が従来の
 * アプリ前面化へフォールバック）。
 *
 * @param {Array<object>|null|undefined} agents 最新 /status の agents
 * @param {number} slot 押されたレーンの slot (1..)
 * @returns {{kind: "open_url"|"activate_app", payload: string} | null}
 */
function resolveFocusAction(agents, slot) {
  if (!Array.isArray(agents)) return null;
  const agent = agents.find((a) => a && Number(a.slot) === Number(slot));
  const focus = agent && agent.focusAction;
  if (!focus || typeof focus !== "object") return null;
  const payload = typeof focus.payload === "string" ? focus.payload : "";
  if (!payload) return null;
  if (focus.kind === "open_url") {
    // `open <arg>` に渡すため、明確な URL スキームのみ許可（パス偽装対策）。
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(payload)) return null;
    return { kind: "open_url", payload };
  }
  if (focus.kind === "activate_app") {
    return { kind: "activate_app", payload };
  }
  return null; // shortcut 等はレーン押下では扱わない
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
 * (+ pop, because pop expiry must trigger the static re-render;
 *  + urgent, so the 15-min alert re-renders exactly once when it flips).
 */
function buildContentKey({
  tool,
  slot,
  state,
  title,
  elapsedMin,
  detail,
  pop,
  urgent,
}) {
  return [
    String(tool || ""),
    String(slot ?? ""),
    String(state || ""),
    String(title || ""),
    String(elapsedMin ?? 0),
    String(detail || ""),
    pop ? "pop" : "",
    urgent ? "urgent" : "",
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
function buildRenderRequest({ state, title, elapsedMin, detail, pop, urgent }) {
  return {
    state: String(state || ""),
    title: String(title || ""),
    elapsed: Number.isFinite(elapsedMin) ? elapsedMin : 0,
    detail: String(detail || ""),
    frames: pop ? "pop" : "",
    urgent: urgent === true,
  };
}

module.exports = {
  RENDERABLE_STATES,
  POP_WINDOW_MS,
  DONE_OLD_AFTER_MS,
  URGENT_THINKING_MS,
  OFFLINE_AFTER_FAILURES,
  isRenderableState,
  effectiveLaneState,
  isUrgentThinking,
  isBridgeOffline,
  resolveFocusAction,
  elapsedMinutes,
  wantsPop,
  buildContentKey,
  detectImageFormat,
  parseRendererLine,
  buildCardItem,
  buildRenderRequest,
};
