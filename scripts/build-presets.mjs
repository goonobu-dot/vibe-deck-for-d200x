#!/usr/bin/env node
/**
 * Build repo-bundled preset profiles (presets/<profile name>/) from the SAME
 * unified layout spec as wire-deck.mjs (scripts/layout-spec.mjs, per plan.md).
 *
 * A preset is an importable D200X profile folder: manifest.json + one folder
 * per page with its own manifest.json and Images/. Icons are referenced via
 * IconRel only (absolute paths are machine-specific and resolved on import).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  PAGES,
  DIALS,
  TOOLS,
  agentAction,
  dialAction,
  buildKeyAction,
  resolvePageKeys,
  stockPageAction,
} from "./layout-spec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const THEMES = join(ROOT, "assets/themes");
const OUT_ROOT = join(ROOT, "presets");

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

/** Copy a theme icon into the page Images dir; IconRel only (portable). */
function presetIcon(theme, id, imagesDir) {
  if (!id) return { abs: "", rel: "" }; // icon-less specs (e.g. background)
  const src = join(THEMES, theme, `${id}.png`);
  if (!existsSync(src)) {
    console.warn(`warn: missing theme icon ${theme}/${id}.png`);
    return { abs: "", rel: "" };
  }
  mkdirSync(imagesDir, { recursive: true });
  const name = `theme_${theme}_${id}.png`;
  cpSync(src, join(imagesDir, name));
  return { abs: "", rel: `Images/${name}` };
}

function buildPage(base, pageId, pageIndex, tool, theme) {
  const pageDir = join(base, "Profiles", pageId);
  const images = join(pageDir, "Images");
  mkdirSync(images, { recursive: true });

  const actions = {};
  for (let x = 0; x < 5; x++) {
    actions[`${x}_0`] = agentAction(x + 1, tool);
  }
  for (const [key, spec] of Object.entries(resolvePageKeys(pageIndex, tool))) {
    actions[key] = buildKeyAction(spec, tool, presetIcon(theme, spec.icon, images));
  }
  // Physical bottom buttons: Studio stock page prev/next (icons resolved by
  // Studio's own page plugin after import).
  actions["0_3"] = stockPageAction("com.ulanzi.ulanzideck.page.prev", "上一页");
  actions["1_3"] = stockPageAction("com.ulanzi.ulanzideck.page.next", "下一页");

  const encoders = {};
  for (const key of Object.keys(DIALS)) {
    encoders[key] = dialAction(key, tool);
  }

  writeJson(join(pageDir, "manifest.json"), {
    Controllers: [
      { Actions: encoders, Type: "Encoder" },
      { Actions: actions, Type: "Keypad" },
    ],
    Icon: "",
    Name: PAGES[pageIndex].name,
  });
}

function buildPreset(tool) {
  const def = TOOLS[tool];
  const base = join(OUT_ROOT, def.profile);
  rmSync(base, { recursive: true, force: true });
  const pageIds = PAGES.map(() => randomUUID());

  for (let i = 0; i < PAGES.length; i++) {
    buildPage(base, pageIds[i], i, tool, def.theme);
  }

  const badge = join(THEMES, def.theme, "badge.png");
  const iconName = `Vibe_${def.theme}_badge.png`;
  if (existsSync(badge)) cpSync(badge, join(base, iconName));

  writeJson(join(base, "manifest.json"), {
    Device: { Model: "D200X", UUID: "" },
    Icon: existsSync(badge) ? iconName : "",
    Name: def.profile,
    Version: "2.0",
    Pages: { Current: pageIds[0], Pages: pageIds },
  });

  writeFileSync(
    join(base, "README.txt"),
    "Import this folder as a D200X profile in Ulanzi Studio, or run scripts/install.sh\n" +
      `Tool=${tool}\nLayout=unified (plan.md): y0 agents / P1 verbs / P2 skills / P3 system, dials tool·lane·autonomy\n`,
  );

  console.log("built preset", def.profile, "->", base);
}

mkdirSync(OUT_ROOT, { recursive: true });
for (const tool of Object.keys(TOOLS)) buildPreset(tool);
console.log("done");
