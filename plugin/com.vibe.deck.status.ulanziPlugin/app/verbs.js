/**
 * Vibe Deck — verb translation table, state guards, osascript builders.
 *
 * Pure logic only (no I/O, no child_process, no timers) so it can be unit
 * tested with `node --test`. plugin.js owns all side effects.
 *
 * Key steps are described declaratively and compiled to an osascript
 * (AppleScript / System Events) source string:
 *   - { type: "keycode",  code: 36, modifiers: ["command"] }
 *   - { type: "keystroke", chars: "a", modifiers: ["shift", "command"] }
 *   - { type: "text", text: "/plan", pressReturn: true }
 */
"use strict";

const TOOLS = Object.freeze(["claude", "codex", "cursor"]);

const TOOL_APP = Object.freeze({
  claude: "Claude",
  codex: "ChatGPT",
  cursor: "Cursor",
});

// System Events key codes (US ANSI, layout independent).
const KEY_CODE = Object.freeze({
  RETURN: 36,
  ESC: 53,
  DELETE: 51, // backspace (⌫)
  SPACE: 49,
  BACKTICK: 50, // ` / ~ physical key
  CAPS_LOCK: 57,
  DOWN: 125,
  UP: 126,
});

const MODIFIER_SUFFIX = Object.freeze({
  command: "command down",
  shift: "shift down",
  option: "option down",
  control: "control down",
});

function keycode(code, modifiers = []) {
  return { type: "keycode", code, modifiers };
}

function keystroke(chars, modifiers = []) {
  return { type: "keystroke", chars, modifiers };
}

function text(str) {
  return { type: "text", text: str, pressReturn: true };
}

/**
 * Multi-step macro inside ONE osascript (menu → arrow → confirm).
 * items: { step, delayAfter } — delayAfter in seconds after that step.
 */
function seq(...items) {
  return { type: "sequence", items };
}

/**
 * verb × tool → key step. Source of truth: plan.md「翻訳テーブル」.
 * Every verb must define all three tools (verified by tests).
 */
const VERB_TABLE = Object.freeze({
  accept: {
    claude: keycode(KEY_CODE.RETURN),
    codex: keystroke("a"),
    cursor: keycode(KEY_CODE.RETURN),
  },
  reject: {
    claude: keycode(KEY_CODE.ESC),
    codex: keystroke("d"),
    cursor: keycode(KEY_CODE.DELETE, ["command"]),
  },
  stop: {
    claude: keycode(KEY_CODE.ESC),
    codex: keycode(KEY_CODE.ESC),
    cursor: keycode(KEY_CODE.DELETE, ["command", "shift"]),
  },
  diff: {
    claude: keystroke("d", ["shift", "command"]),
    codex: keystroke("b", ["command", "option"]),
    cursor: keystroke("e", ["command"]),
  },
  new: {
    claude: keystroke("n", ["command"]),
    codex: keystroke("n", ["command"]),
    cursor: keystroke("n", ["command"]),
  },
  voice: {
    claude: keycode(KEY_CODE.CAPS_LOCK), // ⇪ — 環境依存で不安定（既知・plan.md）
    codex: keystroke("d", ["control", "shift"]),
    cursor: keycode(KEY_CODE.SPACE, ["command", "shift"]),
  },
  terminal: {
    claude: keycode(KEY_CODE.BACKTICK, ["control"]),
    codex: keycode(KEY_CODE.BACKTICK, ["control"]),
    cursor: keycode(KEY_CODE.BACKTICK, ["control"]),
  },
  mode: {
    claude: keystroke("m", ["shift", "command"]),
    codex: text("/permissions"),
    cursor: keystroke(".", ["command"]),
  },
  autonomy_fast: {
    claude: keystroke("e", ["shift", "command"]),
    codex: text("/fast"),
    cursor: keystroke("/", ["command"]),
  },
  autonomy_deep: {
    claude: keystroke("e", ["shift", "command"]),
    codex: text("/plan"),
    cursor: keystroke("/", ["command"]),
  },
  // Press-to-cycle: open the picker, step to the next entry, confirm.
  // Dials cannot run macros (Studio limits knobs to single hotkeys), so
  // real switching lives on keys. Codex has no discrete picker hotkey —
  // its key opens the command menu instead (documented).
  cycle_model: {
    claude: seq(
      { step: keystroke("i", ["shift", "command"]), delayAfter: 0.35 },
      { step: keycode(KEY_CODE.DOWN), delayAfter: 0.12 },
      { step: keycode(KEY_CODE.RETURN) },
    ),
    codex: keystroke("p", ["shift", "command"]),
    cursor: seq(
      { step: keystroke("/", ["command"]), delayAfter: 0.35 },
      { step: keycode(KEY_CODE.DOWN), delayAfter: 0.12 },
      { step: keycode(KEY_CODE.RETURN) },
    ),
  },
  cycle_effort: {
    claude: seq(
      { step: keystroke("e", ["shift", "command"]), delayAfter: 0.35 },
      { step: keycode(KEY_CODE.DOWN), delayAfter: 0.12 },
      { step: keycode(KEY_CODE.RETURN) },
    ),
    codex: keystroke("p", ["shift", "command"]),
    cursor: keystroke("/", ["command"]),
  },
});

const VERBS = Object.freeze(Object.keys(VERB_TABLE));

/**
 * Guard rules (plan.md「状態ガード」):
 *  - accept / reject : allowed only when some agent is `needs_input`
 *                      (cursor additionally allows `done`)
 *  - stop            : allowed only when some agent is `thinking` or `needs_input`
 *  - everything else : always allowed (still auto-focused by the caller)
 *  - bridge unreachable (agentStates == null): guarded verbs are DENIED.
 */
const GUARDED_VERBS = Object.freeze(["accept", "reject", "stop"]);

function isValidTool(tool) {
  return TOOLS.includes(tool);
}

function isValidVerb(verb) {
  return Object.prototype.hasOwnProperty.call(VERB_TABLE, verb);
}

function appForTool(tool) {
  return TOOL_APP[tool] || null;
}

/** Normalize agentStates input into an array of state strings. */
function normalizeStates(agentStates) {
  if (agentStates == null) return null; // bridge unreachable / unknown
  const list = Array.isArray(agentStates) ? agentStates : [agentStates];
  const out = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      out.push(entry);
    } else if (entry && typeof entry === "object" && typeof entry.state === "string") {
      out.push(entry.state);
    }
    // silently skip malformed entries — they can never satisfy a guard
  }
  return out;
}

function allowedStatesFor(verb, tool) {
  if (verb === "accept" || verb === "reject") {
    return tool === "cursor" ? ["needs_input", "done"] : ["needs_input"];
  }
  if (verb === "stop") {
    return ["thinking", "needs_input"];
  }
  return null; // unguarded
}

/**
 * Detailed guard evaluation.
 * @param {string} verb
 * @param {string} tool
 * @param {Array|null|undefined} agentStates - array of state strings or
 *   objects with a `state` field; null/undefined means bridge unreachable.
 * @returns {{ allowed: boolean, reason: string }}
 */
function evaluateVerbGuard(verb, tool, agentStates) {
  if (!isValidVerb(verb)) {
    return { allowed: false, reason: `unknown verb "${verb}"` };
  }
  if (!isValidTool(tool)) {
    return { allowed: false, reason: `unknown tool "${tool}"` };
  }
  const allowedStates = allowedStatesFor(verb, tool);
  if (allowedStates === null) {
    return { allowed: true, reason: "unguarded verb" };
  }
  const states = normalizeStates(agentStates);
  if (states === null) {
    return {
      allowed: false,
      reason: `bridge unreachable — guarded verb "${verb}" suppressed`,
    };
  }
  const hit = states.find((s) => allowedStates.includes(s));
  if (hit) {
    return { allowed: true, reason: `agent state "${hit}" permits "${verb}"` };
  }
  return {
    allowed: false,
    reason: `no agent in [${allowedStates.join(", ")}] (saw: ${
      states.length ? states.join(", ") : "none"
    })`,
  };
}

/** Boolean guard wrapper (plan.md §プラグイン新機能 4). */
function isVerbAllowed(verb, tool, agentStates) {
  return evaluateVerbGuard(verb, tool, agentStates).allowed;
}

/** Escape a JS string for embedding inside an AppleScript double-quoted literal. */
function escapeAppleScriptString(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function modifiersClause(modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return "";
  const parts = modifiers.map((m) => {
    const suffix = MODIFIER_SUFFIX[m];
    if (!suffix) throw new Error(`unknown modifier "${m}"`);
    return suffix;
  });
  return parts.length === 1
    ? ` using ${parts[0]}`
    : ` using {${parts.join(", ")}}`;
}

/** Compile one key step into System Events statement line(s). */
function stepToLines(step) {
  if (!step || typeof step !== "object") {
    throw new Error("invalid key step");
  }
  if (step.type === "keycode") {
    if (!Number.isInteger(step.code) || step.code < 0) {
      throw new Error(`invalid key code: ${step.code}`);
    }
    return [`key code ${step.code}${modifiersClause(step.modifiers)}`];
  }
  if (step.type === "keystroke") {
    if (typeof step.chars !== "string" || step.chars.length === 0) {
      throw new Error("keystroke requires non-empty chars");
    }
    return [
      `keystroke "${escapeAppleScriptString(step.chars)}"${modifiersClause(step.modifiers)}`,
    ];
  }
  if (step.type === "text") {
    if (typeof step.text !== "string" || step.text.length === 0) {
      throw new Error("text step requires non-empty text");
    }
    const lines = [`keystroke "${escapeAppleScriptString(step.text)}"`];
    if (step.pressReturn) {
      lines.push("delay 0.05", `key code ${KEY_CODE.RETURN}`);
    }
    return lines;
  }
  if (step.type === "sequence") {
    if (!Array.isArray(step.items) || step.items.length === 0) {
      throw new Error("sequence requires items");
    }
    const lines = [];
    for (const item of step.items) {
      lines.push(...stepToLines(item.step));
      const d = Number(item.delayAfter);
      if (Number.isFinite(d) && d > 0) lines.push(`delay ${d}`);
    }
    return lines;
  }
  throw new Error(`unknown key step type "${step.type}"`);
}

/** Wrap System Events statements into a complete osascript source string. */
function buildSystemEventsScript(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("buildSystemEventsScript requires at least one line");
  }
  return [
    'tell application "System Events"',
    ...lines.map((l) => `  ${l}`),
    "end tell",
  ].join("\n");
}

/** Look up the key step for verb×tool. Returns null when undefined. */
function getVerbSpec(verb, tool) {
  if (!isValidVerb(verb) || !isValidTool(tool)) return null;
  return VERB_TABLE[verb][tool] || null;
}

/**
 * Build the full osascript source that sends the key(s) for verb×tool.
 * Returns null for unknown verb/tool (caller logs and aborts).
 */
function buildVerbScript(verb, tool) {
  const spec = getVerbSpec(verb, tool);
  if (!spec) return null;
  return buildSystemEventsScript(stepToLines(spec));
}

/** osascript source returning the frontmost application process name. */
function buildFrontmostScript() {
  return 'tell application "System Events" to get name of first application process whose frontmost is true';
}

/** osascript source showing a macOS notification (dial.lane session display). */
function buildNotificationScript(message, title) {
  const msg = escapeAppleScriptString(message == null ? "" : String(message));
  const ttl = escapeAppleScriptString(title == null ? "Vibe Deck" : String(title));
  return `display notification "${msg}" with title "${ttl}"`;
}

module.exports = {
  TOOLS,
  VERBS,
  GUARDED_VERBS,
  VERB_TABLE,
  KEY_CODE,
  appForTool,
  isValidTool,
  isValidVerb,
  allowedStatesFor,
  normalizeStates,
  evaluateVerbGuard,
  isVerbAllowed,
  escapeAppleScriptString,
  getVerbSpec,
  buildVerbScript,
  buildSystemEventsScript,
  buildFrontmostScript,
  buildNotificationScript,
};
