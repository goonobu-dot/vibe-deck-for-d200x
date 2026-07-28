#!/usr/bin/env node
/**
 * Vibe Deck OS — unified layout spec (single source of truth for wiring).
 *
 * Shared between wire-deck.mjs (installs into ProfilesV2) and
 * build-presets.mjs (repo-bundled presets). The layout is IDENTICAL for the
 * three tools; the only tool-specific parts are:
 *   - Page 3 bottom row (toolKeys zone)
 *   - ActionParam.tool on every vibe plugin action
 *
 * Action UUIDs / ActionParam shapes here must match plan.md exactly —
 * the plugin (plugin.js) implements the same contract.
 */
import { randomUUID } from "node:crypto";

export const VIBE_PLUGIN = Object.freeze({
  Name: "Vibe Deck Status",
  UUID: "com.vibe.deck.status",
  Version: "1.2.0",
});

export const ACTIONS = Object.freeze({
  agent: "com.vibe.deck.status.agent",
  verb: "com.vibe.deck.status.verb",
  refresh: "com.vibe.deck.status.refresh",
  dialTool: "com.vibe.deck.status.dial.tool",
  dialLane: "com.vibe.deck.status.dial.lane",
  dialAutonomy: "com.vibe.deck.status.dial.autonomy",
});

/** Profile ring the tool dial (2_3) cycles through — written to profile-ring.json. */
export const PROFILE_RING = Object.freeze([
  "Vibe · Claude Code",
  "Codex_D200X",
  "Vibe · Cursor",
]);

export const TOOLS = Object.freeze({
  claude: {
    app: "/Applications/Claude.app",
    theme: "claude",
    profile: "Vibe · Claude Code",
  },
  codex: {
    app: "/Applications/ChatGPT.app",
    theme: "codex",
    profile: "Codex_D200X",
  },
  cursor: {
    app: "/Applications/Cursor.app",
    theme: "cursor",
    profile: "Vibe · Cursor",
  },
});

/** Agent lane — top row y=0 on EVERY page, slots 1..5. */
export const AGENT_SLOTS = Object.freeze([1, 2, 3, 4, 5]);

/** Tool-specific Help hotkey (Page 3 / 3_1). */
export const HELP_HOTKEYS = Object.freeze({
  cursor: "⇧  ⌘  P",
  codex: "⇧  ⌘  /",
  claude: "⌘  /",
});

/** Tool-specific Model-menu hotkey (Page 3 / 4_1 — common position). */
export const MODEL_HOTKEYS = Object.freeze({
  cursor: "⌘  /",
  codex: "⇧  ⌘  P",
  claude: "⇧  ⌘  I",
});

/**
 * Unified pages. Key spec types:
 *   verb     — plugin verb key    { verb, icon, name }
 *   prompt   — system.text, NO Enter (user keeps typing)
 *   pageNext — Studio stock page.next (→Skills)
 *   focus    — system.open the tool's .app
 *   refresh  — plugin refresh
 *   hotkey   — system.hotkey      { hotkey }
 *   text     — system.text        { text, enter }
 *   help     — system.hotkey from HELP_HOTKEYS[tool]
 */
export const PAGES = Object.freeze([
  {
    name: "Control",
    keys: {
      "0_1": { type: "verb", verb: "accept", icon: "accept", name: "Accept" },
      "1_1": { type: "verb", verb: "reject", icon: "reject", name: "Reject" },
      "2_1": { type: "verb", verb: "stop", icon: "stop", name: "Stop" },
      "3_1": { type: "verb", verb: "diff", icon: "diff", name: "Diff" },
      "4_1": { type: "verb", verb: "new", icon: "new", name: "New" },
      "0_2": { type: "verb", verb: "voice", icon: "voice", name: "Voice" },
      "1_2": {
        type: "verb",
        verb: "terminal",
        icon: "terminal",
        name: "Terminal",
      },
      "2_2": { type: "verb", verb: "mode", icon: "mode", name: "Mode" },
      // 3_2 sits under the hardware small-window strip (clock) — a key icon
      // there is painted over by the widget, so the slot stays reserved.
      "3_2": { type: "background", name: "Background" },
    },
  },
  {
    name: "Skills",
    keys: {
      "0_1": {
        type: "prompt",
        name: "Plan",
        icon: "plan",
        text: "Plan this feature before coding: ",
      },
      "1_1": {
        type: "prompt",
        name: "Implement",
        icon: "implement",
        text: "Implement this: ",
      },
      "2_1": {
        type: "prompt",
        name: "Review",
        icon: "review",
        text: "Review this code: ",
      },
      "3_1": { type: "prompt", name: "Fix", icon: "fix", text: "Fix this bug: " },
      "4_1": {
        type: "prompt",
        name: "Test",
        icon: "test",
        text: "Write tests for: ",
      },
      "0_2": {
        type: "prompt",
        name: "Explain",
        icon: "explain",
        text: "Explain this: ",
      },
      "1_2": {
        type: "prompt",
        name: "Commit",
        icon: "commit",
        text: "Write a commit message for: ",
      },
      "2_2": {
        type: "prompt",
        name: "Summary",
        icon: "summary",
        text: "Summarize the diff: ",
      },
      "3_2": { type: "background", name: "Background" },
    },
  },
  {
    name: "System",
    keys: {
      // Lanes already focus on press — this slot cycles the tool instead
      // (plugin actions DO work on Keypad; Studio never routes Encoder events
      // to third-party plugins, so the tool switch lives on a key).
      "0_1": { type: "toolCycle", icon: "tool", name: "Tool" },
      "1_1": { type: "refresh", icon: "refresh", name: "Refresh" },
      "2_1": { type: "hotkey", icon: "settings", name: "Settings", hotkey: "⌘  ," },
      "3_1": { type: "help", icon: "help", name: "Help" },
      "4_1": { type: "model", icon: "model", name: "Model" },
      "3_2": { type: "background", name: "Background" },
    },
    /** The ONLY tool-specific zone in the whole layout (Page 3 / 0_2..2_2). */
    toolKeys: {
      cursor: {
        "0_2": { type: "hotkey", icon: "composer", name: "Composer", hotkey: "⌘  I" },
        "1_2": { type: "hotkey", icon: "context", name: "Context", hotkey: "⇧  ⌘  L" },
        "2_2": { type: "hotkey", icon: "inline", name: "Inline", hotkey: "⌘  K" },
      },
      codex: {
        "0_2": { type: "text", icon: "plan", name: "Plan", text: "/plan", enter: true },
        "1_2": { type: "text", icon: "fast", name: "Fast", text: "/fast", enter: true },
        "2_2": { type: "hotkey", icon: "quick", name: "Quick", hotkey: "⌘  ⌥  N" },
      },
      claude: {
        "0_2": { type: "hotkey", icon: "browser", name: "Browser", hotkey: "⇧  ⌘  B" },
        "1_2": { type: "hotkey", icon: "sidechat", name: "SideChat", hotkey: "⌘  ;" },
        "2_2": { type: "hotkey", icon: "effort", name: "Effort", hotkey: "⇧  ⌘  E" },
      },
    },
  },
]);

/**
 * Dials — wired as STOCK hotkey actions with knob_* params.
 * Verified on-device: Ulanzi Studio never delivers Encoder events to
 * third-party plugin actions (no add/rotate/press ever arrives), while the
 * stock system.hotkey knob wiring is proven to work. Per-tool hotkeys keep
 * one meaning per dial: Scroll / Session / Autonomy.
 */
export const ENCODERS = Object.freeze({
  "2_3": {
    name: "Scroll",
    perTool: {
      claude: { rotL: "下スクロール", rotR: "上スクロール" },
      codex: { rotL: "下スクロール", rotR: "上スクロール" },
      cursor: { rotL: "下スクロール", rotR: "上スクロール" },
    },
  },
  "3_3": {
    name: "Session",
    perTool: {
      claude: { rotL: "⌃  ⇧  Tab", rotR: "⌃  Tab" },
      codex: { rotL: "⌘  [", rotR: "⌘  ]", press: "⌘  G" },
      cursor: { rotL: "⌘  [", rotR: "⌘  ]" },
    },
  },
  "4_3": {
    name: "Autonomy",
    perTool: {
      claude: { rotL: "⇧  ⌘  E", rotR: "⇧  ⌘  E", press: "⇧  ⌘  M" },
      codex: { rotL: "⇧  ⌘  P", rotR: "⇧  ⌘  P", press: "⇧  ⌘  P" },
      cursor: { rotL: "⌘  /", rotR: "⌘  /", press: "⌘  ." },
    },
  },
});

export function encoderAction(key, tool) {
  const enc = ENCODERS[key];
  const t = enc?.perTool?.[tool];
  if (!t) throw new Error(`encoderAction: no spec for "${key}" / "${tool}"`);
  return {
    Action: "com.ulanzi.ulanzideck.system.hotkey",
    ActionID: randomUUID(),
    ActionParam: {
      Action: "com.ulanzi.ulanzideck.system.hotkey",
      knob_hold_left: {},
      knob_hold_right: {},
      knob_press: t.press ? { Hotkey: t.press } : {},
      knob_rotate_left: t.rotL ? { Hotkey: t.rotL } : {},
      knob_rotate_right: t.rotR ? { Hotkey: t.rotR } : {},
    },
    LinkedTitle: false,
    Name: enc.name,
    Plugin: { Name: "系统", UUID: "com.ulanzi.deck.system", Version: "1.0" },
    State: 0,
    ViewParam: viewNoTitle(),
  };
}

/** All icon ids the layout needs (used to sanity-check the theme dirs). */
export function requiredIconIds() {
  const ids = new Set();
  for (const page of PAGES) {
    for (const spec of Object.values(page.keys)) {
      if (spec.icon) ids.add(spec.icon);
    }
    for (const zone of Object.values(page.toolKeys || {})) {
      for (const spec of Object.values(zone)) {
        if (spec.icon) ids.add(spec.icon);
      }
    }
  }
  return [...ids].sort();
}

/** Merged keys map for one page of one tool (common keys + tool zone). */
export function resolvePageKeys(pageIndex, tool) {
  const page = PAGES[pageIndex];
  if (!page) throw new Error(`resolvePageKeys: no page at index ${pageIndex}`);
  if (!TOOLS[tool]) throw new Error(`resolvePageKeys: unknown tool "${tool}"`);
  return { ...page.keys, ...(page.toolKeys?.[tool] || {}) };
}

// ---------------------------------------------------------------------------
// Action factories — shared so wire-deck and build-presets emit identical JSON.
// ---------------------------------------------------------------------------

/** Icon carries the English label — keep the Studio title empty. */
export function viewNoTitle(iconAbs = "", iconRel = "") {
  return [{ Icon: iconAbs || "", IconRel: iconRel || "", Text: "" }];
}

export function vibePluginAction(actionUuid, name, actionParam, icon = {}) {
  return {
    Action: actionUuid,
    ActionID: randomUUID(),
    ActionParam: actionParam,
    LinkedTitle: false,
    Name: name,
    Plugin: { ...VIBE_PLUGIN },
    State: 0,
    ViewParam: viewNoTitle(icon.abs, icon.rel),
  };
}

export function agentAction(slot, tool) {
  return vibePluginAction(ACTIONS.agent, `Agent ${slot}`, { slot, tool });
}


export function hotkeyAction(hotkey, icon = {}, name = "hotkey") {
  return {
    Action: "com.ulanzi.ulanzideck.system.hotkey",
    ActionID: randomUUID(),
    ActionParam: {
      Action: "com.ulanzi.ulanzideck.system.hotkey",
      Hotkey: hotkey,
    },
    LinkedTitle: false,
    Name: name,
    Plugin: { Name: "系统", UUID: "com.ulanzi.deck.system", Version: "1.0" },
    State: 0,
    ViewParam: viewNoTitle(icon.abs, icon.rel),
  };
}

export function textAction(text, icon = {}, name = "text", enter = false) {
  return {
    Action: "com.ulanzi.ulanzideck.system.text",
    ActionID: randomUUID(),
    ActionParam: { Text: text, Enter: Boolean(enter) },
    LinkedTitle: false,
    Name: name,
    Plugin: { Name: "システム", UUID: "com.ulanzi.deck.system", Version: "1.0" },
    State: 0,
    ViewParam: viewNoTitle(icon.abs, icon.rel),
  };
}

export function openAppAction(appPath, icon = {}, name = "Focus") {
  return {
    Action: "com.ulanzi.ulanzideck.system.open",
    ActionID: randomUUID(),
    ActionParam: { Path: appPath },
    LinkedTitle: false,
    Name: name,
    Plugin: { Name: "システム", UUID: "com.ulanzi.deck.system", Version: "1.0" },
    State: 0,
    ViewParam: viewNoTitle(icon.abs, icon.rel),
  };
}

export function stockPageAction(uuid, name, icon = {}) {
  return {
    Action: uuid,
    ActionID: randomUUID(),
    ActionParam: {},
    LinkedTitle: false,
    Name: name,
    Plugin: { Name: "ページ", UUID: "com.ulanzi.deck.page", Version: "1.0" },
    State: 0,
    ViewParam: [
      {
        Icon: icon.abs || "",
        IconEx: icon.rel || "",
        IconRel: icon.rel || "",
        Text: "",
      },
    ],
  };
}

/** Reserves the slot under the hardware small-window strip (clock widget). */
export function backgroundAction() {
  return {
    Action: "com.ulanzi.ulanzideck.smallwindow.window",
    ActionID: randomUUID(),
    ActionParam: { SmallViewMode: 1 },
    LinkedTitle: false,
    Name: "Background",
    Plugin: {},
    State: 0,
    ViewParam: viewNoTitle(),
  };
}

/** Build the keypad action for one key spec. Fails fast on unknown specs. */
export function buildKeyAction(spec, tool, icon = {}) {
  const toolDef = TOOLS[tool];
  if (!toolDef) throw new Error(`buildKeyAction: unknown tool "${tool}"`);
  switch (spec.type) {
    case "background":
      return backgroundAction();
    case "model":
      return hotkeyAction(MODEL_HOTKEYS[tool], icon, spec.name);
    case "toolCycle":
      // Key press → plugin cycles the AI profile ring (mode: "cycle").
      return vibePluginAction(
        ACTIONS.dialTool,
        spec.name,
        { tool, mode: "cycle" },
        icon,
      );
    case "verb":
      return vibePluginAction(
        ACTIONS.verb,
        spec.name,
        { verb: spec.verb, tool },
        icon,
      );
    case "prompt":
      // system.text WITHOUT Enter — user continues typing after the prompt.
      return textAction(spec.text, icon, spec.name, false);
    case "pageNext":
      return stockPageAction("com.ulanzi.ulanzideck.page.next", spec.name, icon);
    case "focus":
      return openAppAction(toolDef.app, icon, spec.name);
    case "refresh":
      return vibePluginAction(ACTIONS.refresh, spec.name, {}, icon);
    case "hotkey":
      return hotkeyAction(spec.hotkey, icon, spec.name);
    case "help":
      return hotkeyAction(HELP_HOTKEYS[tool], icon, spec.name);
    case "text":
      return textAction(spec.text, icon, spec.name, Boolean(spec.enter));
    default:
      throw new Error(`buildKeyAction: unknown key spec type "${spec.type}"`);
  }
}
