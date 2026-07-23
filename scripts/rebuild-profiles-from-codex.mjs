#!/usr/bin/env node
/**
 * Clone the working official Codex_D200X profile into three Vibe profiles
 * with correct D200X 5x3 layout, icons, and tool-specific hotkeys.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const PROFILES =
  process.env.ULANZI_PROFILES ||
  join(homedir(), "Library/Application Support/Ulanzi/UlanziDeck/ProfilesV2");

function findProfileByName(name) {
  for (const dir of readdirSync(PROFILES)) {
    if (!dir.endsWith(".ulanziProfile")) continue;
    const manifest = join(PROFILES, dir, "manifest.json");
    if (!existsSync(manifest)) continue;
    const j = JSON.parse(readFileSync(manifest, "utf8"));
    if (j.Name === name) return join(PROFILES, dir);
  }
  return null;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function remapHotkeys(pageManifest, mapByText) {
  const out = deepClone(pageManifest);
  for (const controller of out.Controllers || []) {
    const actions = controller.Actions || {};
    for (const key of Object.keys(actions)) {
      const action = actions[key];
      const text = (action.ViewParam || [])[0]?.Text || "";
      const spec = mapByText[text];
      if (!spec) continue;
      if (spec.text) {
        action.ViewParam = action.ViewParam || [{}];
        action.ViewParam[0] = { ...action.ViewParam[0], Text: spec.text };
      }
      if (spec.hotkey != null) {
        action.ActionParam = {
          ...(action.ActionParam || {}),
          Action: action.Action || "com.ulanzi.ulanzideck.system.hotkey",
          Hotkey: spec.hotkey,
        };
      }
      if (spec.encoder) {
        action.ActionParam = {
          Action: "com.ulanzi.ulanzideck.system.hotkey",
          knob_hold_left: {},
          knob_hold_right: {},
          ...spec.encoder,
        };
      }
    }
  }
  return out;
}

/** Top-row Agent Slot keys (0_0..4_0) for live color tiles. */
function wireAgentSlots(pageManifest, tool) {
  const out = deepClone(pageManifest);
  for (const controller of out.Controllers || []) {
    if (controller.Type !== "Keypad") continue;
    const actions = controller.Actions || {};
    for (let i = 0; i < 5; i++) {
      const key = `${i}_0`;
      const slot = i + 1;
      actions[key] = {
        Action: "com.vibe.deck.status.agent",
        ActionID: randomUUID(),
        ActionParam: { slot, tool },
        LinkedTitle: true,
        Name: `Agent ${slot}`,
        Plugin: {
          Name: "Vibe Deck Status",
          UUID: "com.vibe.deck.status",
          Version: "1.0.0",
        },
        State: 0,
        ViewParam: [{ Icon: "", IconRel: "", Text: `A${slot}` }],
      };
    }
    controller.Actions = actions;
  }
  return out;
}

// Official Codex_D200X is kept as-is. We only build Claude / Cursor variants.
const VARIANTS = [
  {
    name: "Vibe · Claude",
    tool: "claude",
    map: {
      ペットを起こす: { text: "Side Chat", hotkey: "⌘  ;" },
      新しい会話: { text: "New Session", hotkey: "⌘  N" },
      検索: { text: "Shortcuts", hotkey: "⌘  /" },
      設定: { text: "Settings", hotkey: "⌘  ," },
      ターミナル切替: { text: "Terminal", hotkey: "⌃  `" },
      リクエストを承認: { text: "Send/Accept", hotkey: "⌘  ⌅" },
      リクエストを拒否: { text: "Stop", hotkey: "⎋" },
      サイドパネル切替: { text: "Diff", hotkey: "⇧  ⌘  D" },
      モデル選択: { text: "Model", hotkey: "⇧  ⌘  I" },
      閉じる: { text: "Close", hotkey: "⌘  W" },
      ディクテーション開始: { text: "Dictation", hotkey: "⌃  ⇧  D" },
      音声モード: { text: "Effort", hotkey: "⇧  ⌘  E" },
      キーボードショートカットを表示: { text: "Help", hotkey: "⌘  /" },
      会話切替: {
        text: "Sessions",
        encoder: {
          knob_press: { Hotkey: "⌘  N" },
          knob_rotate_left: { Hotkey: "⌃  ⇧  Tab" },
          knob_rotate_right: { Hotkey: "⌃  Tab" },
        },
      },
    },
  },
  {
    name: "Vibe · Cursor",
    tool: "cursor",
    map: {
      ペットを起こす: { text: "Composer", hotkey: "⌘  I" },
      新しい会話: { text: "Chat", hotkey: "⌘  L" },
      検索: { text: "Command", hotkey: "⌘  ⇧  P" },
      設定: { text: "Settings", hotkey: "⌘  ," },
      ターミナル切替: { text: "Terminal", hotkey: "⌃  `" },
      リクエストを承認: { text: "Accept", hotkey: "⌘  ⌅" },
      リクエストを拒否: { text: "Reject", hotkey: "⌘  ⌫" },
      サイドパネル切替: { text: "Sidebar", hotkey: "⌘  B" },
      モデル選択: { text: "Model", hotkey: "⌘  /" },
      閉じる: { text: "Close", hotkey: "⌘  W" },
      ディクテーション開始: { text: "Dictation", hotkey: "Fn Fn" },
      音声モード: { text: "Agent", hotkey: "⌘  ." },
      キーボードショートカットを表示: { text: "Keys", hotkey: "⌘  K  ⌘  S" },
      会話切替: {
        text: "Tabs",
        encoder: {
          knob_press: { Hotkey: "⌘  L" },
          knob_rotate_left: { Hotkey: "⇧  ⌘  [" },
          knob_rotate_right: { Hotkey: "⇧  ⌘  ]" },
        },
      },
    },
  },
];

const source = findProfileByName("Codex_D200X");
if (!source) {
  console.error("Codex_D200X profile not found. Open Ulanzi Studio marketplace and install Codex For D200X first.");
  process.exit(1);
}
console.log("source", source);

// Remove previously broken Vibe profiles
for (const dir of readdirSync(PROFILES)) {
  if (!dir.endsWith(".ulanziProfile")) continue;
  const manifest = join(PROFILES, dir, "manifest.json");
  if (!existsSync(manifest)) continue;
  const j = JSON.parse(readFileSync(manifest, "utf8"));
  if (String(j.Name || "").startsWith("Vibe ·")) {
    console.log("remove old", j.Name, dir);
    rmSync(join(PROFILES, dir), { recursive: true, force: true });
  }
}

for (const variant of VARIANTS) {
  const id = randomUUID();
  const dest = join(PROFILES, `${id}.ulanziProfile`);
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });

  const rootManifestPath = join(dest, "manifest.json");
  const root = JSON.parse(readFileSync(rootManifestPath, "utf8"));
  root.Name = variant.name;
  root.Device = {
    Model: "D200X",
    UUID: "02d23a045u3671258",
  };
  if (!root.Icon) root.Icon = "Codex For D200X.png";
  writeFileSync(rootManifestPath, JSON.stringify(root, null, 2));

  for (const pageId of root.Pages.Pages) {
    const pagePath = join(dest, "Profiles", pageId, "manifest.json");
    if (!existsSync(pagePath)) continue;
    const page = JSON.parse(readFileSync(pagePath, "utf8"));
    let remapped = remapHotkeys(page, variant.map);
    if (variant.tool && root.Pages.Pages[0] === pageId) {
      remapped = wireAgentSlots(remapped, variant.tool);
    }
    writeFileSync(pagePath, JSON.stringify(remapped, null, 2));
  }

  console.log("created", variant.name, "->", dest);
}

// Point Studio at Vibe · Cursor
const settingPath = join(
  homedir(),
  "Library/Application Support/Ulanzi/UlanziDeck/config/setting.json",
);
if (existsSync(settingPath)) {
  const setting = JSON.parse(readFileSync(settingPath, "utf8"));
  setting.CurrentProfile = "Vibe · Cursor";
  writeFileSync(settingPath, JSON.stringify(setting, null, "\t"));
  console.log("CurrentProfile -> Vibe · Cursor");
}

console.log("\nDone. Quit Ulanzi Studio completely and reopen it.");
console.log("Then open the profile menu (top) and choose: Vibe · Claude / Vibe · Cursor");
console.log("Official Codex_D200X is left untouched.");
