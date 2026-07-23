#!/usr/bin/env node
/**
 * Wire the three AI profiles (Claude Code / Codex / Cursor) with the unified
 * Vibe Deck OS layout defined in scripts/layout-spec.mjs (source: plan.md).
 *
 * Same key = same meaning on every tool; the only tool-specific parts are the
 * Page 3 bottom zone and ActionParam.tool. Tool identity shows via theme color.
 *
 * Physical bottom buttons 0_3 / 1_3 stay on Studio stock page prev/next.
 * Dials 2_3 / 3_3 / 4_3 get the vibe dial actions (tool / lane / autonomy).
 *
 * Sandbox testing: set VIBE_DECK_HOME to a fixture root (a directory that
 * contains "Library/Application Support/Ulanzi/UlanziDeck/…") and the script
 * writes there instead of the real $HOME.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  PAGES,
  DIALS,
  PROFILE_RING,
  agentAction,
  dialAction,
  buildKeyAction,
  resolvePageKeys,
  stockPageAction,
} from "./layout-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const HOME = process.env.VIBE_DECK_HOME || homedir();
if (process.env.VIBE_DECK_HOME && !existsSync(HOME)) {
  console.error(
    `VIBE_DECK_HOME points to a missing directory: ${HOME}\n` +
      "Create the fixture first (Library/Application Support/Ulanzi/UlanziDeck/ProfilesV2/…) or unset VIBE_DECK_HOME.",
  );
  process.exit(1);
}

const ULANZI = join(HOME, "Library/Application Support/Ulanzi/UlanziDeck");
const PROFILES = join(ULANZI, "ProfilesV2");
const PLUGIN_SRC = join(ROOT, "plugin/com.vibe.deck.status.ulanziPlugin");
const PLUGIN_DST = join(
  ULANZI,
  "Plugins/com.vibe.deck.status.ulanziPlugin",
);
const PROFILE_RING_PATH = join(PLUGIN_DST, "profile-ring.json");
const PAGE_PLUGIN_IMAGES = join(
  ULANZI,
  "System/Plugins/com.ulanzi.deck.page/Images",
);
const SETTING_PATH = join(ULANZI, "config/setting.json");
const THEMES = join(ROOT, "assets/themes");

/** Profile name -> tool/theme. Rename handled in main() before wiring. */
const AI = {
  Codex_D200X: { tool: "codex", theme: "codex" },
  "Vibe · Cursor": { tool: "cursor", theme: "cursor" },
  "Vibe · Claude Code": { tool: "claude", theme: "claude" },
};

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

/** Copy the themed icon into the page Images dir; empty icon when missing. */
function themeIcon(theme, id, pageImagesDir) {
  if (!id) return { abs: "", rel: "" }; // icon-less specs (e.g. background)
  const src = join(THEMES, theme, `${id}.png`);
  if (!existsSync(src)) {
    console.warn(`warn: missing theme icon ${theme}/${id}.png`);
    return { abs: "", rel: "" };
  }
  mkdirSync(pageImagesDir, { recursive: true });
  const name = `theme_${theme}_${id}.png`;
  const dest = join(pageImagesDir, name);
  copyFileSync(src, dest);
  return { abs: dest, rel: `Images/${name}` };
}

function ensurePageIcon(pageDir, fileName) {
  const src = join(PAGE_PLUGIN_IMAGES, fileName);
  const dest = join(pageDir, "Images", fileName);
  if (!existsSync(src)) return { abs: "", rel: "" };
  mkdirSync(join(pageDir, "Images"), { recursive: true });
  copyFileSync(src, dest);
  return { abs: dest, rel: `Images/${fileName}` };
}

/**
 * Legacy/custom bottom-control detector. The unified vibe dial actions
 * (com.vibe.deck.status.dial.*) are part of the new layout and must be KEPT —
 * everything else vibe/nav-custom on the bottom row gets stripped.
 */
function isCustomBottomAction(action) {
  const id = String(action?.Action || "");
  const path = String(action?.ActionParam?.Path || "");
  if (id.startsWith("com.vibe.deck.status.dial.")) return false;
  return (
    id.includes("vibe.deck") ||
    id.includes("page.switch") ||
    id.includes("page.dial") ||
    id.includes("profile.") ||
    path.includes("VibeProfilePrev") ||
    path.includes("VibeProfileNext") ||
    path.includes("switch-profile")
  );
}

/** Restore bottom keys to stock page prev/next; strip stale custom dial nav. */
function restoreStandardBottomControls(page, pageDir) {
  const keypad = page.Controllers?.find((c) => c.Type === "Keypad");
  const encoder = page.Controllers?.find((c) => c.Type === "Encoder");
  if (!keypad) return;
  keypad.Actions = keypad.Actions || {};

  const prevIcon = ensurePageIcon(pageDir, "btn_previousPage.png");
  const nextIcon = ensurePageIcon(pageDir, "btn_nextPage.png");
  // Match stock Ulanzi labels (as on AI Solutions / factory page keys).
  keypad.Actions["0_3"] = stockPageAction(
    "com.ulanzi.ulanzideck.page.prev",
    "上一页",
    prevIcon,
  );
  keypad.Actions["1_3"] = stockPageAction(
    "com.ulanzi.ulanzideck.page.next",
    "下一页",
    nextIcon,
  );

  if (!encoder) return;
  encoder.Actions = encoder.Actions || {};
  for (const key of ["2_3", "3_3", "4_3"]) {
    if (isCustomBottomAction(encoder.Actions[key])) {
      delete encoder.Actions[key];
    }
  }
}

/** Wire the three dials (tool / lane / autonomy) on this page's encoder. */
function wireDials(page, tool) {
  const encoder = page.Controllers?.find((c) => c.Type === "Encoder");
  if (!encoder) return;
  encoder.Actions = encoder.Actions || {};
  for (const key of Object.keys(DIALS)) {
    encoder.Actions[key] = dialAction(key, tool);
  }
}

/** Build one unified page manifest (agent lane + spec keys) from scratch. */
function buildUnifiedPage(profileDir, pageId, pageIndex, ai) {
  const pageDir = join(profileDir, "Profiles", pageId);
  const images = join(pageDir, "Images");
  mkdirSync(images, { recursive: true });

  const actions = {};
  // Agent lane — top row y=0 on every page.
  for (let x = 0; x < 5; x++) {
    actions[`${x}_0`] = agentAction(x + 1, ai.tool);
  }
  for (const [key, spec] of Object.entries(resolvePageKeys(pageIndex, ai.tool))) {
    const icon = themeIcon(ai.theme, spec.icon, images);
    actions[key] = buildKeyAction(spec, ai.tool, icon);
  }

  const page = {
    Controllers: [
      { Actions: {}, Type: "Encoder" },
      { Actions: actions, Type: "Keypad" },
    ],
    Icon: "",
    Name: PAGES[pageIndex].name,
  };
  writeJson(join(pageDir, "manifest.json"), page);
}

/** Profiles with fewer than 3 pages get an empty third page appended. */
function ensureThirdPage(rootManifest, profileDir) {
  const pages = rootManifest.Pages.Pages;
  if (pages.length >= 3) return pages[2];
  const id = randomUUID();
  const pageDir = join(profileDir, "Profiles", id);
  mkdirSync(join(pageDir, "Images"), { recursive: true });
  const page = {
    Controllers: [
      { Actions: {}, Type: "Encoder" },
      { Actions: {}, Type: "Keypad" },
    ],
    Icon: "",
    Name: "System",
  };
  writeJson(join(pageDir, "manifest.json"), page);
  pages.push(id);
  rootManifest.Pages.Pages = pages;
  return id;
}

function stripTitles(page) {
  for (const c of page.Controllers || []) {
    for (const action of Object.values(c.Actions || {})) {
      if (!action.ViewParam?.[0]) continue;
      // Keep titles empty when an icon is present (icon has English label).
      const hasIcon = action.ViewParam[0].Icon || action.ViewParam[0].IconRel;
      const isAgent = String(action.Action || "").includes("status.agent");
      if (hasIcon || isAgent) {
        action.LinkedTitle = false;
        action.ViewParam[0].Text = "";
      }
    }
  }
}

function listProfiles() {
  const out = [];
  for (const dir of readdirSync(PROFILES)) {
    if (!dir.endsWith(".ulanziProfile")) continue;
    const rootPath = join(PROFILES, dir, "manifest.json");
    if (!existsSync(rootPath)) continue;
    const root = readJson(rootPath);
    if (!root?.Name) continue;
    out.push({
      name: root.Name,
      uuid: dir.replace(/\.ulanziProfile$/, ""),
      dir: join(PROFILES, dir),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return out;
}

function main() {
  if (!existsSync(PROFILES)) {
    console.error(
      `ProfilesV2 not found: ${PROFILES}\n` +
        "Nothing to wire — check VIBE_DECK_HOME / Ulanzi Studio installation.",
    );
    process.exit(1);
  }

  mkdirSync(dirname(PLUGIN_DST), { recursive: true });
  cpSync(PLUGIN_SRC, PLUGIN_DST, { recursive: true });
  console.log("plugin ->", PLUGIN_DST);

  // Tool dial cycles only these three profiles (read by plugin.js).
  writeJson(PROFILE_RING_PATH, { names: [...PROFILE_RING] });
  console.log("profile ring ->", PROFILE_RING_PATH);

  // Refresh names first so wiring below sees the final names.
  for (const dir of readdirSync(PROFILES)
    .filter((d) => d.endsWith(".ulanziProfile"))
    .map((d) => join(PROFILES, d))) {
    const rootPath = join(dir, "manifest.json");
    if (!existsSync(rootPath)) continue;
    const root = readJson(rootPath);
    if (root.Name === "Vibe · Claude") {
      root.Name = "Vibe · Claude Code";
      writeJson(rootPath, root);
      console.log("renamed ->", root.Name);
    }
  }

  const wired = new Set();
  for (const me of listProfiles()) {
    const dir = me.dir;
    const rootPath = join(dir, "manifest.json");
    const root = readJson(rootPath);
    const ai = AI[me.name];

    if (ai) {
      ensureThirdPage(root, dir);
      writeJson(rootPath, root);
      const pageIds = root.Pages?.Pages || [];
      if (pageIds.length < 3) {
        console.warn(`warn: ${me.name} still has ${pageIds.length} pages — skipped`);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        buildUnifiedPage(dir, pageIds[i], i, ai);
      }
      console.log(`unified layout -> ${me.name} (${ai.tool})`);

      const badge = join(THEMES, ai.theme, "badge.png");
      if (existsSync(badge)) {
        const iconName = `Vibe_${ai.theme}_badge.png`;
        copyFileSync(badge, join(dir, iconName));
        root.Icon = iconName;
        writeJson(rootPath, root);
      }
      wired.add(me.name);
    }

    // All profiles: bottom hardware back to stock; AI profiles also get dials.
    for (const pid of root.Pages?.Pages || []) {
      const pageDir = join(dir, "Profiles", pid);
      const pagePath = join(pageDir, "manifest.json");
      if (!existsSync(pagePath)) continue;
      const page = readJson(pagePath);
      restoreStandardBottomControls(page, pageDir);
      if (ai) wireDials(page, ai.tool);
      stripTitles(page);
      writeJson(pagePath, page);
    }
    console.log("restored bottom controls:", me.name);
  }

  for (const name of PROFILE_RING) {
    if (!wired.has(name)) {
      console.warn(`warn: ring profile "${name}" not found in ProfilesV2`);
    }
  }

  if (existsSync(SETTING_PATH)) {
    const setting = readJson(SETTING_PATH);
    if (setting.CurrentProfile === "Vibe · Claude") {
      setting.CurrentProfile = "Vibe · Claude Code";
      writeFileSync(SETTING_PATH, JSON.stringify(setting, null, "\t") + "\n");
    }
  }

  console.log(
    "\nDone. Restart Ulanzi Studio once. Layout: y0=agents / P1 verbs / P2 skills / P3 system; dials=tool·lane·autonomy.",
  );
}

main();
