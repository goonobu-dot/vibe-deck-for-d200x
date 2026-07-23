import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProfileInfo = { name: string; uuid: string };

const PROFILES = join(
  homedir(),
  "Library/Application Support/Ulanzi/UlanziDeck/ProfilesV2",
);
const SETTING = join(
  homedir(),
  "Library/Application Support/Ulanzi/UlanziDeck/config/setting.json",
);
const SETTING_SOURCE = join(
  homedir(),
  "Library/Application Support/Ulanzi/UlanziDeck/config/setting_source.json",
);
const RING_OVERRIDE = join(
  homedir(),
  "Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.vibe.deck.status.ulanziPlugin/profile-ring.json",
);

type Pending = {
  name: string;
  uuid: string;
  direction: "prev" | "next";
  at: number;
} | null;

let pending: Pending = null;

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function scanProfiles(): ProfileInfo[] {
  if (!existsSync(PROFILES)) return [];
  const out: ProfileInfo[] = [];
  for (const dir of readdirSync(PROFILES)) {
    if (!dir.endsWith(".ulanziProfile")) continue;
    const manifest = join(PROFILES, dir, "manifest.json");
    const j = readJson<{ Name?: string } | null>(manifest, null);
    if (!j?.Name) continue;
    out.push({ name: j.Name, uuid: dir.replace(/\.ulanziProfile$/, "") });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return out;
}

export function listProfiles(): ProfileInfo[] {
  const override = readJson<{ names?: string[] } | null>(RING_OVERRIDE, null);
  if (override?.names?.length) {
    // Ring override narrows the cycle; keep real UUIDs so host switch
    // payloads stay functional.
    const scanned = scanProfiles();
    return override.names.map((name) => ({
      name,
      uuid: scanned.find((p) => p.name === name)?.uuid ?? "",
    }));
  }
  return scanProfiles();
}

export function currentProfileName(): string {
  const setting = readJson<Record<string, unknown>>(SETTING, {});
  return String(setting.CurrentProfile || "");
}

export function writeCurrentProfile(name: string): void {
  const setting = readJson<Record<string, unknown>>(SETTING, {});
  setting.CurrentProfile = name;
  writeFileSync(SETTING, `${JSON.stringify(setting, null, "\t")}\n`);

  const src = readJson<{ Devices?: Array<Record<string, unknown>> } | null>(
    SETTING_SOURCE,
    null,
  );
  if (src?.Devices) {
    for (const d of src.Devices) {
      if (d.DeviceType === "D200X" || d.DeviceType === "D200" || "CurrentProfile" in d) {
        d.CurrentProfile = name;
      }
    }
    writeFileSync(SETTING_SOURCE, JSON.stringify(src));
  }
}

export function cycleProfile(direction: "prev" | "next"): ProfileInfo | null {
  const profiles = listProfiles();
  if (!profiles.length) return null;
  const cur = currentProfileName();
  let idx = profiles.findIndex((p) => p.name === cur);
  if (idx < 0) idx = 0;
  const next =
    profiles[
      (idx + (direction === "prev" ? -1 : 1) + profiles.length) % profiles.length
    ];
  writeCurrentProfile(next.name);
  pending = {
    name: next.name,
    uuid: next.uuid,
    direction,
    at: Date.now(),
  };
  return next;
}

/** Plugin consumes this; cleared on read. */
export function takePendingProfile(): Pending {
  const p = pending;
  pending = null;
  return p;
}

export function peekPendingProfile(): Pending {
  return pending;
}
