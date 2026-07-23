#!/usr/bin/env node
/**
 * Thin wrapper — real generator is generate-icons.py (Pillow + Hiragino).
 * Kept so older docs / muscle memory (`node scripts/generate-icons.mjs`) still work.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = join(root, "scripts", "generate-icons.py");
const r = spawnSync("python3", [py], { stdio: "inherit" });
process.exit(r.status ?? 1);
