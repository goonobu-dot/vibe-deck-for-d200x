import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lanecards = require("../app/lanecards.js");

// --- content key diff -------------------------------------------------------

test("content key changes on every relevant field", () => {
  const base = {
    tool: "claude",
    slot: 1,
    state: "thinking",
    title: "セッションA",
    elapsedMin: 3,
    detail: "",
    pop: false,
  };
  const key = lanecards.buildContentKey(base);
  assert.equal(key, lanecards.buildContentKey({ ...base }));
  for (const patch of [
    { tool: "codex" },
    { slot: 2 },
    { state: "done" },
    { title: "セッションB" },
    { elapsedMin: 4 },
    { detail: "Bash: git push" },
    { pop: true },
    { urgent: true },
  ]) {
    assert.notEqual(
      lanecards.buildContentKey({ ...base, ...patch }),
      key,
      `patch ${JSON.stringify(patch)} must change the key`,
    );
  }
});

test("content key is not fooled by delimiter-looking titles", () => {
  // "a|b" + "c" vs "a" + "b|c" style collision must not happen
  const a = lanecards.buildContentKey({
    tool: "claude",
    slot: 1,
    state: "done",
    title: "x|3",
    elapsedMin: 0,
    detail: "",
  });
  const b = lanecards.buildContentKey({
    tool: "claude",
    slot: 1,
    state: "done",
    title: "x",
    elapsedMin: 3,
    detail: "",
  });
  assert.notEqual(a, b);
});

test("content key tolerates missing fields", () => {
  assert.doesNotThrow(() => lanecards.buildContentKey({}));
  assert.equal(typeof lanecards.buildContentKey({}), "string");
});

// --- elapsed minutes --------------------------------------------------------

test("elapsedMinutes floors to whole minutes and clamps bad input", () => {
  const t0 = 1_000_000;
  assert.equal(lanecards.elapsedMinutes(t0 + 59_000, t0), 0);
  assert.equal(lanecards.elapsedMinutes(t0 + 60_000, t0), 1);
  assert.equal(lanecards.elapsedMinutes(t0 + 60 * 60_000 + 5_000, t0), 60);
  // clock skew (since in the future) → 0, never negative
  assert.equal(lanecards.elapsedMinutes(t0, t0 + 5_000), 0);
  assert.equal(lanecards.elapsedMinutes(NaN, t0), 0);
  assert.equal(lanecards.elapsedMinutes(t0, undefined), 0);
});

// --- pop window -------------------------------------------------------------

test("wantsPop only inside the window and only for done", () => {
  const t0 = 1_000_000;
  assert.equal(lanecards.wantsPop("done", t0 + 100, t0), true);
  assert.equal(
    lanecards.wantsPop("done", t0 + lanecards.POP_WINDOW_MS, t0),
    false,
  );
  assert.equal(lanecards.wantsPop("thinking", t0 + 100, t0), false);
  assert.equal(lanecards.wantsPop("done", t0, undefined), false);
  // clock skew: doneAt in the future → no pop (safe)
  assert.equal(lanecards.wantsPop("done", t0, t0 + 5_000), false);
});

// --- renderable states ------------------------------------------------------

test("isRenderableState accepts known states only", () => {
  for (const s of [
    "idle",
    "thinking",
    "done",
    "done_old",
    "needs_input",
    "error",
    "empty",
    "offline",
  ]) {
    assert.equal(lanecards.isRenderableState(s), true, s);
  }
  assert.equal(lanecards.isRenderableState("bogus"), false);
  assert.equal(lanecards.isRenderableState(undefined), false);
  assert.equal(lanecards.isRenderableState(3), false);
});

// --- 機能1a: 既読 / done_old -------------------------------------------------

test("effectiveLaneState keeps fresh done as done", () => {
  const t0 = 1_000_000;
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0,
      ackAt: undefined,
      nowMs: t0 + 10_000,
    }),
    "done",
  );
  // exactly at the boundary stays done; just past it goes done_old
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0,
      nowMs: t0 + lanecards.DONE_OLD_AFTER_MS,
    }),
    "done",
  );
});

test("effectiveLaneState flips unacked done to done_old after 90s", () => {
  const t0 = 1_000_000;
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0,
      nowMs: t0 + lanecards.DONE_OLD_AFTER_MS + 1,
    }),
    "done_old",
  );
});

test("effectiveLaneState acks done/done_old to idle when pressed after updatedAt", () => {
  const t0 = 1_000_000;
  // ack after the completion → idle, even long past the done_old threshold
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0,
      ackAt: t0 + 5_000,
      nowMs: t0 + 600_000,
    }),
    "idle",
  );
  // ack exactly at updatedAt counts as read
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0,
      ackAt: t0,
      nowMs: t0 + 200_000,
    }),
    "idle",
  );
  // a NEW completion after the ack shows done again (未読に戻る)
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: t0 + 10_000,
      ackAt: t0 + 5_000,
      nowMs: t0 + 11_000,
    }),
    "done",
  );
});

test("effectiveLaneState leaves non-done states untouched (ack has no effect)", () => {
  const t0 = 1_000_000;
  for (const s of ["idle", "thinking", "needs_input", "error", "empty"]) {
    assert.equal(
      lanecards.effectiveLaneState({
        state: s,
        updatedAt: t0,
        ackAt: t0 + 999_999,
        nowMs: t0 + 999_999,
      }),
      s,
    );
  }
});

test("effectiveLaneState tolerates missing/bad timestamps", () => {
  assert.equal(
    lanecards.effectiveLaneState({ state: "done", nowMs: 1000 }),
    "done",
  );
  assert.equal(
    lanecards.effectiveLaneState({
      state: "done",
      updatedAt: NaN,
      ackAt: NaN,
      nowMs: NaN,
    }),
    "done",
  );
});

// --- 機能1b: 長考アラート ----------------------------------------------------

test("isUrgentThinking fires only for thinking past 15 minutes", () => {
  const t0 = 1_000_000;
  const limit = lanecards.URGENT_THINKING_MS;
  assert.equal(lanecards.isUrgentThinking("thinking", t0 + limit - 1, t0), false);
  assert.equal(lanecards.isUrgentThinking("thinking", t0 + limit, t0), true);
  assert.equal(lanecards.isUrgentThinking("thinking", t0 + limit * 2, t0), true);
  assert.equal(lanecards.isUrgentThinking("done", t0 + limit, t0), false);
  assert.equal(lanecards.isUrgentThinking("thinking", t0, undefined), false);
  assert.equal(lanecards.isUrgentThinking("thinking", NaN, t0), false);
  // clock skew: since in the future → not urgent
  assert.equal(lanecards.isUrgentThinking("thinking", t0, t0 + limit), false);
});

// --- 機能1c: OFFLINE 判定 ----------------------------------------------------

test("isBridgeOffline needs 3 consecutive failures", () => {
  assert.equal(lanecards.isBridgeOffline(0), false);
  assert.equal(lanecards.isBridgeOffline(2), false);
  assert.equal(lanecards.isBridgeOffline(3), true);
  assert.equal(lanecards.isBridgeOffline(10), true);
  assert.equal(lanecards.isBridgeOffline(NaN), false);
  assert.equal(lanecards.isBridgeOffline(undefined), false);
  assert.equal(lanecards.isBridgeOffline(-5), false);
});

// --- 機能2: focusAction 解決 -------------------------------------------------

test("resolveFocusAction returns validated open_url for the pressed slot", () => {
  const agents = [
    { slot: 1, focusAction: { kind: "activate_app", payload: "Cursor" } },
    {
      slot: 2,
      focusAction: {
        kind: "open_url",
        payload: "cursor://file/Users/admin/cursor/skill",
      },
    },
  ];
  assert.deepEqual(lanecards.resolveFocusAction(agents, 2), {
    kind: "open_url",
    payload: "cursor://file/Users/admin/cursor/skill",
  });
  assert.deepEqual(lanecards.resolveFocusAction(agents, 1), {
    kind: "activate_app",
    payload: "Cursor",
  });
});

test("resolveFocusAction rejects malformed or unsafe actions", () => {
  // no scheme → not a URL → reject (open would treat it as a file path)
  assert.equal(
    lanecards.resolveFocusAction(
      [{ slot: 1, focusAction: { kind: "open_url", payload: "/etc/passwd" } }],
      1,
    ),
    null,
  );
  assert.equal(
    lanecards.resolveFocusAction(
      [{ slot: 1, focusAction: { kind: "open_url", payload: "" } }],
      1,
    ),
    null,
  );
  assert.equal(
    lanecards.resolveFocusAction(
      [{ slot: 1, focusAction: { kind: "shortcut", payload: "cmd+1" } }],
      1,
    ),
    null,
  );
  assert.equal(
    lanecards.resolveFocusAction(
      [{ slot: 1, focusAction: { kind: "open_url", payload: 42 } }],
      1,
    ),
    null,
  );
  assert.equal(lanecards.resolveFocusAction([{ slot: 1 }], 1), null);
  assert.equal(lanecards.resolveFocusAction([], 1), null);
  assert.equal(lanecards.resolveFocusAction(null, 1), null);
  assert.equal(lanecards.resolveFocusAction(undefined, 1), null);
  // slot mismatch
  assert.equal(
    lanecards.resolveFocusAction(
      [{ slot: 2, focusAction: { kind: "activate_app", payload: "Cursor" } }],
      1,
    ),
    null,
  );
});

// --- renderer reply parsing -------------------------------------------------

test("parseRendererLine detects PNG and GIF payloads", () => {
  const png = lanecards.parseRendererLine("iVBORw0KGgoAAAANSUhEUg==\n");
  assert.deepEqual(png, { ok: true, format: "png", data: "iVBORw0KGgoAAAANSUhEUg==" });
  const gif = lanecards.parseRendererLine("R0lGODlhkACQAIcAAP8=");
  assert.equal(gif.ok, true);
  assert.equal(gif.format, "gif");
});

test("parseRendererLine surfaces renderer errors and garbage", () => {
  const err = lanecards.parseRendererLine('{"error": "unknown state: bogus"}');
  assert.equal(err.ok, false);
  assert.match(err.error, /unknown state/);
  assert.equal(lanecards.parseRendererLine("").ok, false);
  assert.equal(lanecards.parseRendererLine("   ").ok, false);
  assert.equal(lanecards.parseRendererLine("QUJD").ok, false); // valid b64, not an image
  assert.equal(lanecards.parseRendererLine("{not json").ok, false);
  assert.equal(lanecards.parseRendererLine(null).ok, false);
});

// --- statelist wire items ---------------------------------------------------

const META = {
  actionid: "aid-1",
  key: "2_1",
  uuid: "com.vibe.deck.status.agent",
  controller: "Keypad",
  device: "D200X",
};

test("buildCardItem emits type:1 data for PNG", () => {
  const item = lanecards.buildCardItem(META, "png", "iVBORw==");
  assert.deepEqual(item, {
    actionid: "aid-1",
    key: "2_1",
    uuid: "com.vibe.deck.status.agent",
    controller: "Keypad",
    device: "D200X",
    textData: "",
    showtext: false,
    type: 1,
    data: "iVBORw==",
  });
});

test("buildCardItem emits type:3 gifdata for GIF", () => {
  const item = lanecards.buildCardItem(META, "gif", "R0lGOD==");
  assert.equal(item.type, 3);
  assert.equal(item.gifdata, "R0lGOD==");
  assert.equal(item.data, undefined);
  assert.equal(item.showtext, false);
});

test("buildCardItem defaults controller/device when missing", () => {
  const item = lanecards.buildCardItem(
    { actionid: "a", key: "k", uuid: "u" },
    "png",
    "iVBORw==",
  );
  assert.equal(item.controller, "Keypad");
  assert.equal(item.device, "D200X");
});

// --- render request ---------------------------------------------------------

test("buildRenderRequest normalizes fields for the daemon", () => {
  assert.deepEqual(
    lanecards.buildRenderRequest({
      state: "needs_input",
      title: "承認待ち",
      elapsedMin: 5,
      detail: "Bash: git push",
      pop: false,
    }),
    {
      state: "needs_input",
      title: "承認待ち",
      elapsed: 5,
      detail: "Bash: git push",
      frames: "",
      urgent: false,
    },
  );
  const bad = lanecards.buildRenderRequest({ state: "done", elapsedMin: NaN, pop: true });
  assert.equal(bad.elapsed, 0);
  assert.equal(bad.frames, "pop");
  assert.equal(bad.title, "");
  assert.equal(bad.urgent, false);
});

test("buildRenderRequest passes urgent through strictly", () => {
  assert.equal(
    lanecards.buildRenderRequest({ state: "thinking", urgent: true }).urgent,
    true,
  );
  // truthy-but-not-true never leaks to the renderer
  assert.equal(
    lanecards.buildRenderRequest({ state: "thinking", urgent: 1 }).urgent,
    false,
  );
});
