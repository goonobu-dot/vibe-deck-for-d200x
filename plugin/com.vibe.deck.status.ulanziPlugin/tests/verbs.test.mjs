/**
 * Unit tests for app/verbs.js — translation table + state guards + script builders.
 * Run: node --test tests/  (from the plugin directory)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const verbs = require("../app/verbs.js");

const ALL_TOOLS = ["claude", "codex", "cursor"];
const ALL_VERBS = [
  "accept",
  "reject",
  "stop",
  "diff",
  "new",
  "voice",
  "terminal",
  "mode",
  "autonomy_fast",
  "autonomy_deep",
];

// ---------------------------------------------------------------------------
// Translation table — full verb × tool matrix
// ---------------------------------------------------------------------------

describe("translation table coverage", () => {
  test("exports exactly the planned verbs", () => {
    assert.deepEqual([...verbs.VERBS].sort(), [...ALL_VERBS].sort());
  });

  test("every verb defines every tool", () => {
    for (const verb of ALL_VERBS) {
      for (const tool of ALL_TOOLS) {
        const spec = verbs.getVerbSpec(verb, tool);
        assert.ok(spec, `missing spec for ${verb}×${tool}`);
        assert.ok(
          ["keycode", "keystroke", "text"].includes(spec.type),
          `bad spec type for ${verb}×${tool}: ${spec.type}`,
        );
      }
    }
  });

  test("every verb×tool builds a valid System Events script", () => {
    for (const verb of ALL_VERBS) {
      for (const tool of ALL_TOOLS) {
        const script = verbs.buildVerbScript(verb, tool);
        assert.equal(typeof script, "string", `${verb}×${tool}`);
        assert.match(script, /^tell application "System Events"/);
        assert.match(script, /end tell$/);
      }
    }
  });
});

describe("translation table exact mappings (plan.md)", () => {
  const expectContains = (verb, tool, fragments) => {
    const script = verbs.buildVerbScript(verb, tool);
    for (const f of fragments) {
      assert.ok(
        script.includes(f),
        `${verb}×${tool}: expected "${f}" in:\n${script}`,
      );
    }
  };

  test("accept: claude/cursor Return, codex 'a'", () => {
    expectContains("accept", "claude", ["key code 36"]);
    expectContains("accept", "cursor", ["key code 36"]);
    expectContains("accept", "codex", ['keystroke "a"']);
    assert.ok(!verbs.buildVerbScript("accept", "codex").includes("using"));
  });

  test("reject: claude Esc, codex 'd', cursor cmd-delete", () => {
    expectContains("reject", "claude", ["key code 53"]);
    expectContains("reject", "codex", ['keystroke "d"']);
    expectContains("reject", "cursor", ["key code 51 using command down"]);
  });

  test("stop: claude/codex Esc, cursor cmd-shift-delete", () => {
    expectContains("stop", "claude", ["key code 53"]);
    expectContains("stop", "codex", ["key code 53"]);
    expectContains("stop", "cursor", [
      "key code 51 using {command down, shift down}",
    ]);
  });

  test("diff: shift-cmd-D / cmd-opt-B / cmd-E", () => {
    expectContains("diff", "claude", [
      'keystroke "d" using {shift down, command down}',
    ]);
    expectContains("diff", "codex", [
      'keystroke "b" using {command down, option down}',
    ]);
    expectContains("diff", "cursor", ['keystroke "e" using command down']);
  });

  test("new: cmd-N on all tools", () => {
    for (const tool of ALL_TOOLS) {
      expectContains("new", tool, ['keystroke "n" using command down']);
    }
  });

  test("voice: caps lock / ctrl-shift-D / cmd-shift-space", () => {
    expectContains("voice", "claude", ["key code 57"]);
    expectContains("voice", "codex", [
      'keystroke "d" using {control down, shift down}',
    ]);
    expectContains("voice", "cursor", [
      "key code 49 using {command down, shift down}",
    ]);
  });

  test("terminal: ctrl-backtick (key code 50) on all tools", () => {
    for (const tool of ALL_TOOLS) {
      expectContains("terminal", tool, ["key code 50 using control down"]);
    }
  });

  test("mode: shift-cmd-M / text '/permissions'+Return / cmd-period", () => {
    expectContains("mode", "claude", [
      'keystroke "m" using {shift down, command down}',
    ]);
    expectContains("mode", "codex", ['keystroke "/permissions"', "key code 36"]);
    expectContains("mode", "cursor", ['keystroke "." using command down']);
  });

  test("autonomy_fast: shift-cmd-E / '/fast'+Return / cmd-slash", () => {
    expectContains("autonomy_fast", "claude", [
      'keystroke "e" using {shift down, command down}',
    ]);
    expectContains("autonomy_fast", "codex", [
      'keystroke "/fast"',
      "key code 36",
    ]);
    expectContains("autonomy_fast", "cursor", [
      'keystroke "/" using command down',
    ]);
  });

  test("autonomy_deep: shift-cmd-E / '/plan'+Return / cmd-slash", () => {
    expectContains("autonomy_deep", "claude", [
      'keystroke "e" using {shift down, command down}',
    ]);
    expectContains("autonomy_deep", "codex", [
      'keystroke "/plan"',
      "key code 36",
    ]);
    expectContains("autonomy_deep", "cursor", [
      'keystroke "/" using command down',
    ]);
  });

  test("text verbs press Return AFTER typing the text", () => {
    const script = verbs.buildVerbScript("mode", "codex");
    const typeIdx = script.indexOf('keystroke "/permissions"');
    const returnIdx = script.indexOf("key code 36");
    assert.ok(typeIdx >= 0 && returnIdx > typeIdx);
  });
});

// ---------------------------------------------------------------------------
// Guard evaluation
// ---------------------------------------------------------------------------

describe("isVerbAllowed — accept/reject", () => {
  for (const verb of ["accept", "reject"]) {
    test(`${verb}: allowed only on needs_input (claude/codex)`, () => {
      for (const tool of ["claude", "codex"]) {
        assert.equal(verbs.isVerbAllowed(verb, tool, ["needs_input"]), true);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["done"]), false);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["thinking"]), false);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["idle"]), false);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["error"]), false);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["empty"]), false);
      }
    });

    test(`${verb}: cursor additionally allows done`, () => {
      assert.equal(verbs.isVerbAllowed(verb, "cursor", ["needs_input"]), true);
      assert.equal(verbs.isVerbAllowed(verb, "cursor", ["done"]), true);
      assert.equal(verbs.isVerbAllowed(verb, "cursor", ["thinking"]), false);
      assert.equal(verbs.isVerbAllowed(verb, "cursor", ["idle"]), false);
    });

    test(`${verb}: any matching agent among several is enough`, () => {
      assert.equal(
        verbs.isVerbAllowed(verb, "claude", ["idle", "thinking", "needs_input"]),
        true,
      );
    });
  }
});

describe("isVerbAllowed — stop", () => {
  test("allowed on thinking and needs_input for every tool", () => {
    for (const tool of ALL_TOOLS) {
      assert.equal(verbs.isVerbAllowed("stop", tool, ["thinking"]), true);
      assert.equal(verbs.isVerbAllowed("stop", tool, ["needs_input"]), true);
      assert.equal(verbs.isVerbAllowed("stop", tool, ["done"]), false);
      assert.equal(verbs.isVerbAllowed("stop", tool, ["idle"]), false);
      assert.equal(verbs.isVerbAllowed("stop", tool, ["error"]), false);
    }
  });
});

describe("isVerbAllowed — unguarded verbs", () => {
  const unguarded = [
    "diff",
    "new",
    "voice",
    "terminal",
    "mode",
    "autonomy_fast",
    "autonomy_deep",
  ];
  test("always allowed, even with bridge down or no agents", () => {
    for (const verb of unguarded) {
      for (const tool of ALL_TOOLS) {
        assert.equal(verbs.isVerbAllowed(verb, tool, null), true, `${verb}×${tool}`);
        assert.equal(verbs.isVerbAllowed(verb, tool, []), true);
        assert.equal(verbs.isVerbAllowed(verb, tool, ["idle"]), true);
      }
    }
  });
});

describe("isVerbAllowed — bridge unreachable (null/undefined states)", () => {
  test("accept/reject/stop are suppressed when states are unknown", () => {
    for (const verb of ["accept", "reject", "stop"]) {
      for (const tool of ALL_TOOLS) {
        assert.equal(verbs.isVerbAllowed(verb, tool, null), false, `${verb}×${tool}`);
        assert.equal(verbs.isVerbAllowed(verb, tool, undefined), false);
      }
    }
  });

  test("empty agent list (0 agents) also blocks guarded verbs", () => {
    for (const verb of ["accept", "reject", "stop"]) {
      assert.equal(verbs.isVerbAllowed(verb, "claude", []), false);
    }
  });

  test("evaluateVerbGuard reports a bridge-unreachable reason", () => {
    const res = verbs.evaluateVerbGuard("accept", "claude", null);
    assert.equal(res.allowed, false);
    assert.match(res.reason, /bridge unreachable/);
  });
});

describe("guard input robustness", () => {
  test("accepts bridge agent objects ({slot,state,...})", () => {
    const agents = [
      { slot: 1, state: "idle", title: "a" },
      { slot: 2, state: "needs_input", title: "b" },
    ];
    assert.equal(verbs.isVerbAllowed("accept", "claude", agents), true);
    assert.equal(verbs.isVerbAllowed("stop", "codex", agents), true);
  });

  test("ignores malformed entries without crashing", () => {
    const junk = [null, 42, {}, { state: 7 }, "needs_input"];
    assert.equal(verbs.isVerbAllowed("accept", "claude", junk), true);
    assert.equal(verbs.isVerbAllowed("accept", "claude", [null, {}, 42]), false);
  });

  test("unknown verb or tool is never allowed", () => {
    assert.equal(verbs.isVerbAllowed("explode", "claude", ["needs_input"]), false);
    assert.equal(verbs.isVerbAllowed("accept", "emacs", ["needs_input"]), false);
    assert.equal(verbs.isVerbAllowed("", "", null), false);
  });
});

// ---------------------------------------------------------------------------
// Script builders & helpers
// ---------------------------------------------------------------------------

describe("script builders", () => {
  test("getVerbSpec returns null for unknown verb/tool", () => {
    assert.equal(verbs.getVerbSpec("nope", "claude"), null);
    assert.equal(verbs.getVerbSpec("accept", "vim"), null);
    assert.equal(verbs.buildVerbScript("nope", "claude"), null);
    assert.equal(verbs.buildVerbScript("accept", "vim"), null);
  });

  test("appForTool maps to the desktop app names", () => {
    assert.equal(verbs.appForTool("claude"), "Claude");
    assert.equal(verbs.appForTool("codex"), "ChatGPT");
    assert.equal(verbs.appForTool("cursor"), "Cursor");
    assert.equal(verbs.appForTool("emacs"), null);
    assert.equal(verbs.appForTool(undefined), null);
  });

  test("frontmost script queries System Events frontmost process", () => {
    const s = verbs.buildFrontmostScript();
    assert.match(s, /System Events/);
    assert.match(s, /frontmost/);
  });

  test("escapeAppleScriptString escapes quotes and backslashes", () => {
    assert.equal(verbs.escapeAppleScriptString('a"b'), 'a\\"b');
    assert.equal(verbs.escapeAppleScriptString("a\\b"), "a\\\\b");
    assert.equal(verbs.escapeAppleScriptString('\\"'), '\\\\\\"');
  });

  test("notification script embeds escaped message and title", () => {
    const s = verbs.buildNotificationScript('sess "1"', "Vibe");
    assert.match(s, /^display notification /);
    assert.ok(s.includes('sess \\"1\\"'));
    assert.ok(s.includes('with title "Vibe"'));
  });

  test("notification script tolerates null/undefined message", () => {
    const s = verbs.buildNotificationScript(null, undefined);
    assert.match(s, /^display notification ""/);
    assert.ok(s.includes('with title "Vibe Deck"'));
  });

  test("multibyte session names survive escaping (日本語/emoji)", () => {
    const s = verbs.buildNotificationScript("セッション🚀", "Vibe Deck");
    assert.ok(s.includes("セッション🚀"));
  });
});
