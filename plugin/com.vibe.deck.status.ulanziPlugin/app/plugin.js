/**
 * Vibe Deck Status — Ulanzi Studio JavaScript plugin
 * Handshake/protocol aligned with official Ulanzi Discord plugin.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, execFile } = require("child_process");
const WebSocket = require("ws");
const verbs = require("./verbs.js");
const frames = require("./frames.js");
const lanecards = require("./lanecards.js");

const PLUGIN_UUID = "com.vibe.deck.status";
const BRIDGE = process.env.VIBE_DECK_BRIDGE || "http://127.0.0.1:17823";
const LOG = `${process.env.HOME}/Library/Logs/vibe-deck-plugin.log`;
const PROFILES_DIR = path.join(
  process.env.HOME,
  "Library/Application Support/Ulanzi/UlanziDeck/ProfilesV2",
);
const SETTING_PATH = path.join(
  process.env.HOME,
  "Library/Application Support/Ulanzi/UlanziDeck/config/setting.json",
);
const RING_OVERRIDE = path.join(
  process.env.HOME,
  "Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.vibe.deck.status.ulanziPlugin/profile-ring.json",
);
const PAINT_MS = 150;

// Frame arithmetic lives in frames.js (single source of truth, unit-tested).
const STATE_INDEX = frames.STATE_INDEX;

const STATE_LABEL = {
  idle: "白",
  thinking: "青",
  done: "緑",
  needs_input: "橙",
  error: "赤",
  empty: "灰",
};

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}\n`;
  try {
    fs.appendFileSync(LOG, line);
  } catch {
    // ignore
  }
}

class UlanziClient {
  constructor(uuid) {
    this.uuid = uuid;
    this.ws = null;
    this.handlers = new Map();
  }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
  }

  emit(evt, payload) {
    for (const fn of this.handlers.get(evt) || []) {
      try {
        fn(payload);
      } catch (err) {
        log("handler error", String(err));
      }
    }
  }

  connect(host, port) {
    const url = `ws://${host}:${port}`;
    log("connecting", url);
    this.ws = new WebSocket(url);
    this.ws.on("open", () => {
      this.ws.send(
        JSON.stringify({ uuid: this.uuid, cmd: "connected", code: 0 }),
      );
      log("sent connected handshake");
      this.emit("open");
    });
    this.ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const cmd = msg.cmd || msg.event || msg.type;
      if (cmd && cmd !== "state") log("message", msg);
      if (cmd) this.emit(cmd, msg);
      if (msg.uuid && cmd) this.emit(`${msg.uuid}.${cmd}`, msg);
    });
    this.ws.on("close", () => {
      // Studio is gone. Exit instead of lingering: an orphaned instance keeps
      // polling the bridge and steals /profile/pending from the live plugin.
      log("ws close — exiting");
      setTimeout(() => process.exit(0), 500);
    });
    this.ws.on("error", (err) => log("ws error", String(err)));
  }

  send(uuid, cmd, extra = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ uuid, cmd, ...extra }));
  }

  setState(statelist) {
    this.send(this.uuid, "state", { param: { statelist } });
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function activateApp(name) {
  spawn("osascript", ["-e", `tell application "${name}" to activate`], {
    stdio: "ignore",
    detached: true,
  }).unref();
}

/** Fire-and-forget `open <url>`（cursor:// ディープリンク等）。絶対に throw しない。 */
function openUrl(url) {
  try {
    const child = spawn("open", [url], { stdio: "ignore", detached: true });
    child.on("error", (err) => log("open url spawn error", String(err)));
    child.unref();
  } catch (err) {
    log("open url threw", String(err));
  }
}

const OSA_TIMEOUT_MS = 4000;

/**
 * Run an osascript source string and resolve its stdout (trimmed).
 * Rejects on non-zero exit / timeout; callers must catch and log.
 */
function runOsascript(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: OSA_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`osascript failed: ${err.message} ${String(stderr).trim()}`));
          return;
        }
        resolve(String(stdout).trim());
      },
    );
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function scanProfilesDir() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  const out = [];
  for (const dir of fs.readdirSync(PROFILES_DIR)) {
    if (!dir.endsWith(".ulanziProfile")) continue;
    const manifest = path.join(PROFILES_DIR, dir, "manifest.json");
    const j = readJson(manifest, null);
    if (!j?.Name) continue;
    // Prefer D200X profiles; keep unknowns too so ring matches Studio list.
    out.push({
      name: j.Name,
      uuid: dir.replace(/\.ulanziProfile$/, ""),
      model: j.Device?.Model || "",
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return out;
}

function listProfiles() {
  const override = readJson(RING_OVERRIDE, null);
  if (Array.isArray(override?.names) && override.names.length) {
    // Ring override narrows the cycle; resolve real UUIDs so host
    // switch payloads keep working (missing profiles resolve to null).
    const scanned = scanProfilesDir();
    return override.names.map((name) => ({
      name,
      uuid: scanned.find((p) => p.name === name)?.uuid || null,
    }));
  }
  return scanProfilesDir();
}

function currentProfileName() {
  const setting = readJson(SETTING_PATH, {});
  return String(setting.CurrentProfile || "");
}

function writeCurrentProfile(name) {
  const setting = readJson(SETTING_PATH, {});
  setting.CurrentProfile = name;
  fs.writeFileSync(SETTING_PATH, JSON.stringify(setting, null, "\t") + "\n");
  // Also update setting_source device entry when present
  const srcPath = SETTING_PATH.replace("setting.json", "setting_source.json");
  const src = readJson(srcPath, null);
  if (src && Array.isArray(src.Devices)) {
    for (const d of src.Devices) {
      if (d.DeviceType === "D200X" || d.CurrentDevice) {
        d.CurrentProfile = name;
      }
    }
    fs.writeFileSync(srcPath, JSON.stringify(src));
  }
}

// Studio exposes no host API for switching profiles: stock plugins declare
// none, every WS payload shape is ignored, and the Qt window publishes no
// accessible controls to click. The one reliable path is writing
// CurrentProfile to the settings and relaunching Studio, which honors it at
// boot. Rotation ticks are debounced so a multi-step turn restarts once.
const SWITCH_SETTLE_MS = 1200;
let pendingSwitch = null; // { name, uuid }
let switchTimer = null;

function toolFromProfileName(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("claude")) return "claude";
  if (n.includes("codex")) return "codex";
  if (n.includes("cursor")) return "cursor";
  return null;
}

/** The profile Studio is really showing = whichever lanes registered last. */
function activeToolFromKeys() {
  for (const meta of keys.values()) {
    if (String(meta.uuid || "").includes(".agent")) return meta.tool;
  }
  return null;
}

function notify(text, subtitle) {
  runOsascript(verbs.buildNotificationScript(text, subtitle)).catch((err) =>
    log("notify failed", String(err)),
  );
}

function commitProfileSwitch() {
  const target = pendingSwitch;
  pendingSwitch = null;
  if (!target?.name) return;
  if (toolFromProfileName(target.name) === activeToolFromKeys()) {
    log("profile switch: target already live, skip restart", target.name);
    return;
  }
  writeCurrentProfile(target.name);
  log("host profile switch ->", target.name, target.uuid || "", "(relaunch)");
  // Kill Studio by PID (our grandparent): macOS pkill refuses to signal its
  // own ancestors, so a pattern-based pkill from inside Studio's process tree
  // silently spares Studio. Detached so the sequence survives us dying too.
  const studioPid = process.ppid;
  const swLog = `${process.env.HOME}/Library/Logs/vibe-deck-switch.log`;
  const sh =
    `exec >> '${swLog}' 2>&1; echo "[$(date)] relaunch start ppid=${studioPid}"; ` +
    `/bin/sleep 0.4; kill ${studioPid}; echo "kill rc=$?"; ` +
    `/bin/sleep 2; kill -0 ${studioPid} 2>/dev/null && { kill -9 ${studioPid}; echo "kill9"; }; ` +
    '/bin/sleep 0.5; /usr/bin/open -a "Ulanzi Studio"; echo "open rc=$?"';
  try {
    const child = spawn("/bin/sh", ["-c", sh], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => log("relaunch spawn error", String(err)));
    child.unref();
    log("relaunch spawned pid", child.pid);
  } catch (err) {
    log("relaunch spawn threw", String(err));
  }
}

function applyHostProfileSwitch(target) {
  if (!target?.name) return;
  pendingSwitch = { name: target.name, uuid: target.uuid || "" };
  if (switchTimer) clearTimeout(switchTimer);
  switchTimer = setTimeout(() => {
    switchTimer = null;
    commitProfileSwitch();
  }, SWITCH_SETTLE_MS);
  notify(`→ ${target.name}`, "Vibe Deck — Tool");
  log("profile switch queued", target.name);
}

function switchProfile(direction) {
  const profiles = listProfiles();
  if (!profiles.length) {
    log("profile ring empty");
    return;
  }
  // Walk the ring from the pending pick (mid-debounce) or the live profile.
  const cur = pendingSwitch?.name || currentProfileName();
  let idx = profiles.findIndex((p) => p.name === cur);
  if (idx < 0) {
    const live = activeToolFromKeys();
    idx = profiles.findIndex((p) => toolFromProfileName(p.name) === live);
    if (idx < 0) idx = 0;
  }
  const next =
    profiles[
      (idx + (direction === "prev" ? -1 : 1) + profiles.length) % profiles.length
    ];
  if (!next) return;
  applyHostProfileSwitch(next);
  log("profile switch", direction, cur, "->", next.name, `(${profiles.length})`);
}

async function pollPendingProfile() {
  try {
    const data = await fetchJson(`${BRIDGE}/profile/pending?consume=1`);
    if (data?.pending?.name) {
      applyHostProfileSwitch(data.pending);
    }
  } catch {
    // bridge may be briefly down
  }
}

function findProfileDirByName(name) {
  if (!fs.existsSync(PROFILES_DIR)) return null;
  for (const dir of fs.readdirSync(PROFILES_DIR)) {
    if (!dir.endsWith(".ulanziProfile")) continue;
    const manifest = path.join(PROFILES_DIR, dir, "manifest.json");
    const j = readJson(manifest, null);
    if (j?.Name === name) return path.join(PROFILES_DIR, dir);
  }
  return null;
}

function requestPage(direction) {
  const name = currentProfileName();
  const dir = findProfileDirByName(name);
  if (dir) {
    const manifestPath = path.join(dir, "manifest.json");
    const root = readJson(manifestPath, null);
    const pages = root?.Pages?.Pages || [];
    if (pages.length >= 2) {
      let idx = pages.indexOf(root.Pages.Current);
      if (idx < 0) idx = 0;
      const nextIdx =
        (idx + (direction === "prev" ? -1 : 1) + pages.length) % pages.length;
      root.Pages.Current = pages[nextIdx];
      fs.writeFileSync(manifestPath, JSON.stringify(root, null, 2) + "\n");
      log("page file switch", name, idx, "->", nextIdx, pages[nextIdx]);
    }
  }

  if (client.ws && client.ws.readyState === WebSocket.OPEN) {
    const uuid =
      direction === "prev"
        ? "com.ulanzi.ulanzideck.page.prev"
        : "com.ulanzi.ulanzideck.page.next";
    client.ws.send(JSON.stringify({ uuid, cmd: "run", param: {} }));
    client.ws.send(
      JSON.stringify({
        event: direction === "prev" ? "previousPage" : "nextPage",
      }),
    );
  }

  // Nudge Studio to reload current profile page
  const script = `
    try
      tell application "Ulanzi Studio" to activate
    end try
  `;
  spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
  log("page request", direction);
}

const client = new UlanziClient(PLUGIN_UUID);
/** @type {Map<string, any>} */
const keys = new Map();
/** Last painted frame index per agent key (差分送信の基準). @type {Map<string, number>} */
const lastKeyState = new Map();
/** Last logical bridge state per agent key ("thinking" 等). @type {Map<string, string>} */
const lastLogicalState = new Map();
/** Time (ms) each agent key transitioned INTO done — drives the pop frame. @type {Map<string, number>} */
const doneAt = new Map();
/** Time (ms) each agent key entered its CURRENT logical state (経過時間表示用). @type {Map<string, number>} */
const stateSince = new Map();
/** Last dynamic-card content key per agent key (差分レンダの基準). @type {Map<string, string>} */
const lastCardKey = new Map();
/** Agent keys currently showing a dynamic card (フォールバック時の強制再描画対象). @type {Set<string>} */
const cardActive = new Set();
/** Registered verb keys (guard-blocked flash targets). @type {Map<string, any>} */
const verbKeys = new Map();
/** 機能1a — レーン押下（既読）時刻 per agent key. @type {Map<string, number>} */
const ackAt = new Map();
/** OFFLINE カード用に保持する最後の正常タイトル per agent key. @type {Map<string, string>} */
const lastTitle = new Map();
/** 機能2 — ツールごとの最新 /status agents スナップショット. @type {Map<string, any[]>} */
const lastAgents = new Map();
/** bridge fetch の連続全滅パス数（成功で 0 リセット）. */
let bridgeFailStreak = 0;
let paintInFlight = false;
let needsEmptyFlash = true;

function forgetAgentKey(id) {
  keys.delete(id);
  lastKeyState.delete(id);
  lastLogicalState.delete(id);
  doneAt.delete(id);
  stateSince.delete(id);
  lastCardKey.delete(id);
  cardActive.delete(id);
  ackAt.delete(id);
  lastTitle.delete(id);
}

/** Record a verb key registration so guard feedback can flash the right tile. */
function rememberVerbKey(actionid, msg, param) {
  const key = msg.key || param.key;
  // Same-coordinate re-registration (profile/page switch) replaces the entry.
  for (const [id, meta] of verbKeys) {
    if (id !== String(actionid) && String(meta.key) === String(key)) {
      verbKeys.delete(id);
    }
  }
  verbKeys.set(String(actionid), {
    actionid,
    key,
    uuid: "com.vibe.deck.status.verb",
    device: msg.device,
    controller: msg.controller,
    verb: String(param.verb || param.Verb || "").toLowerCase(),
    tool: String(param.tool || param.Tool || "").toLowerCase(),
  });
  log("remember verb key", actionid, key, param.verb || param.Verb || "");
}

function remember(msg) {
  if (msg.cmd && msg.cmd !== "add") return;
  const param = msg.param || {};
  const slot = Number(param.slot || param.Slot || 1);
  const tool = String(param.tool || param.Tool || "cursor").toLowerCase();
  const actionid = msg.actionid || msg.ActionID || param.actionid;
  const key = msg.key || param.key;
  const uuid = msg.uuid || PLUGIN_UUID;
  if (!actionid) return;
  if (uuid === "com.vibe.deck.status.verb") {
    rememberVerbKey(actionid, msg, param);
    return;
  }
  if (uuid !== "com.vibe.deck.status.agent") return;
  // Unified layout paints five lanes at once, so never wipe the whole set.
  // A profile/page switch re-registers a lane at the same physical key with a
  // new actionid — replace only the entry occupying that coordinate.
  for (const [id, meta] of keys) {
    if (
      id !== String(actionid) &&
      String(meta.uuid || "").includes(".agent") &&
      String(meta.key) === String(key)
    ) {
      forgetAgentKey(id);
    }
  }
  keys.set(String(actionid), {
    slot: Math.min(8, Math.max(1, slot || 1)),
    tool: ["claude", "codex", "cursor"].includes(tool) ? tool : "cursor",
    key,
    actionid,
    uuid,
    device: msg.device,
    controller: msg.controller,
  });
  log("remember", actionid, key, slot, tool);
  needsEmptyFlash = true;
}

function item(meta, state) {
  return {
    actionid: meta.actionid,
    key: meta.key,
    uuid: meta.uuid,
    controller: meta.controller || "Keypad",
    device: meta.device || "D200X",
    type: 0,
    state,
  };
}

// Boot wave: after (re)registration the lanes light up slot by slot.
const BOOT_WAVE_STEP_MS = 80;

// ---------------------------------------------------------------------------
// Phase B — dynamic lane cards (plan.md「Phase B — 動的レーンカード」)
// ---------------------------------------------------------------------------

/** Master switch: false = Phase A frames only (fallback path stays live). */
const ENABLE_LANE_CARDS = true;
/** A render taking longer than this counts as a dead renderer (spec: 2s). */
const LANE_RENDER_TIMEOUT_MS = 2000;
/** Backoff before respawning a dead renderer (spec: 30s). */
const LANE_RENDERER_RESPAWN_MS = 30000;

/**
 * Resident Pillow renderer (scripts/lane-renderer.py) over stdin/stdout.
 * One JSON request line in → one base64 (or {"error":...}) line out.
 * Strictly single-flight: a timeout kills the process (a late reply would
 * desync the request/response pairing) and schedules a 30s-backoff respawn.
 * Every failure path resolves null so paint() can fall back to Phase A.
 */
class LaneRenderer {
  constructor() {
    this.proc = null;
    this.buf = "";
    this.pending = null; // { resolve, timer }
    this.blockedUntil = 0;
    this.missingLogged = false;
  }

  /** Locate lane-renderer.py at runtime (deployed copy first, then repo). */
  resolveScript() {
    const candidates = [
      process.env.VIBE_DECK_LANE_RENDERER,
      path.join(__dirname, "lane-renderer.py"),
      path.join(__dirname, "..", "..", "..", "scripts", "lane-renderer.py"),
    ];
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c)) return c;
      } catch {
        // ignore — treat as missing
      }
    }
    return null;
  }

  /** Can a request be served right now (alive, or spawnable outside backoff)? */
  available() {
    if (!ENABLE_LANE_CARDS) return false;
    if (this.proc) return true;
    if (Date.now() < this.blockedUntil) return false;
    const found = this.resolveScript() !== null;
    if (!found && !this.missingLogged) {
      this.missingLogged = true;
      log("lane-renderer script not found — Phase A frames only");
    }
    return found;
  }

  /** Spawn if needed. Returns true when a live process is ready. */
  ensure() {
    if (this.proc) return true;
    if (Date.now() < this.blockedUntil) return false;
    const script = this.resolveScript();
    if (!script) {
      this.block("script not found");
      return false;
    }
    try {
      const proc = spawn("python3", [script], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;
      this.buf = "";
      // An unhandled stream "error" (EPIPE on a dying renderer) would crash
      // the whole plugin — swallow it; proc "exit" drives the real cleanup.
      proc.stdin.on("error", (err) =>
        log("lane-renderer stdin error", String(err)),
      );
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => this.onData(proc, chunk));
      proc.stderr.on("data", (chunk) =>
        log("lane-renderer stderr", String(chunk).trim().slice(0, 300)),
      );
      proc.on("error", (err) => this.onDeath(proc, `spawn error: ${err}`));
      proc.on("exit", (code, signal) =>
        this.onDeath(proc, `exit code=${code} signal=${signal}`),
      );
      log("lane-renderer spawned", script, "pid", proc.pid);
      return true;
    } catch (err) {
      this.block(`spawn threw: ${err}`);
      return false;
    }
  }

  block(reason) {
    this.blockedUntil = Date.now() + LANE_RENDERER_RESPAWN_MS;
    log("lane-renderer blocked 30s:", reason);
  }

  onDeath(proc, reason) {
    if (this.proc !== proc) return; // stale event from an already-replaced proc
    this.proc = null;
    this.buf = "";
    this.finishPending(null);
    this.block(reason);
  }

  onData(proc, chunk) {
    if (this.proc !== proc) return;
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (this.pending) {
        this.finishPending(line);
      } else if (line.trim()) {
        log("lane-renderer unexpected reply dropped", line.slice(0, 60));
      }
    }
  }

  finishPending(value) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  /** Kill the process (timeout / desync) and enter the respawn backoff. */
  kill(reason) {
    const proc = this.proc;
    this.proc = null;
    this.buf = "";
    this.finishPending(null);
    this.block(reason);
    if (proc) {
      try {
        proc.kill();
      } catch (err) {
        log("lane-renderer kill failed", String(err));
      }
    }
  }

  /**
   * Render one card. Resolves the raw stdout line, or null on any failure
   * (dead renderer, busy, timeout, write error) — callers fall back to frames.
   */
  request(payload) {
    if (!this.ensure()) return Promise.resolve(null);
    if (this.pending) {
      log("lane-renderer busy, dropping request");
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        resolve(null);
        this.kill(`no reply in ${LANE_RENDER_TIMEOUT_MS}ms`);
      }, LANE_RENDER_TIMEOUT_MS);
      this.pending = { resolve, timer };
      try {
        this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (err) {
        this.finishPending(null);
        this.kill(`stdin write failed: ${err}`);
      }
    });
  }
}

const laneRenderer = new LaneRenderer();

/** Drop all card bookkeeping so the next paint redraws from scratch. */
function resetCardState() {
  lastCardKey.clear();
  cardActive.clear();
}

/**
 * Phase A behavior for a single lane while cards are unavailable for it.
 * Also evicts any stale card so the frame actually overwrites the tile.
 */
function paintFrameFallback(meta, logical, now) {
  if (cardActive.delete(meta.actionid)) {
    lastCardKey.delete(meta.actionid);
    lastKeyState.delete(meta.actionid);
  }
  const frame = frames.frameFor(logical, now, doneAt.get(meta.actionid));
  if (lastKeyState.get(meta.actionid) !== frame) {
    client.setState([item(meta, frame)]);
    lastKeyState.set(meta.actionid, frame);
  }
}

/**
 * Phase A frame painting for one tool (boot wave + frame diff), unchanged
 * behavior from before Phase B. `lanes` = [{ meta, agent, logical }].
 */
async function paintToolFrames(tool, lanes, now) {
  const changed = [];
  const labels = [];
  for (const { meta, logical } of lanes) {
    // Falling back from card mode: force a frame send over the stale card.
    if (cardActive.delete(meta.actionid)) {
      lastCardKey.delete(meta.actionid);
      lastKeyState.delete(meta.actionid);
    }
    const frame = frames.frameFor(logical, now, doneAt.get(meta.actionid));
    const prevFrame = lastKeyState.get(meta.actionid);
    labels.push(STATE_LABEL[logical] || "?");
    // Diff on the frame index: animated states re-send only when their
    // frame flips; static states stay silent — no constant traffic.
    if (prevFrame !== frame || needsEmptyFlash) {
      changed.push({ meta, state: frame });
      lastKeyState.set(meta.actionid, frame);
    }
  }
  if (!changed.length) return;

  if (needsEmptyFlash) {
    // Boot wave: everything to empty, then light lanes slot by slot.
    needsEmptyFlash = false;
    const ordered = [...changed].sort(
      (a, b) => (a.meta.slot || 0) - (b.meta.slot || 0),
    );
    client.setState(ordered.map((t) => item(t.meta, STATE_INDEX.empty)));
    for (const t of ordered) {
      await sleep(BOOT_WAVE_STEP_MS);
      client.setState([item(t.meta, t.state)]);
    }
    log("boot wave", tool, `${ordered.length}keys`, labels.join(""));
    return;
  }
  client.setState(changed.map((t) => item(t.meta, t.state)));
  log("painted", tool, `${changed.length}keys`, labels.join(""));
}

/**
 * Phase B card painting for one tool. Re-renders a lane only when its
 * content key (tool|slot|state|title|elapsed-min|detail|pop) changed; any
 * render failure degrades that lane to Phase A frames for this pass.
 */
async function paintToolCards(tool, lanes, now) {
  const sent = [];
  for (const { meta, agent, logical } of lanes) {
    if (!lanecards.isRenderableState(logical)) {
      paintFrameFallback(meta, logical, now);
      continue;
    }
    const title = typeof agent.title === "string" ? agent.title : "";
    const detail = typeof agent.detail === "string" ? agent.detail : "";
    const pop = lanecards.wantsPop(logical, now, doneAt.get(meta.actionid));
    // 長考アラート: thinking 15分継続で呼吸を速く（content key に含めるので
    // フリップ時の再レンダは1回だけ）。
    const urgent = lanecards.isUrgentThinking(
      logical,
      now,
      stateSince.get(meta.actionid),
    );
    const elapsedMin = lanecards.elapsedMinutes(
      now,
      stateSince.get(meta.actionid),
    );
    const contentKey = lanecards.buildContentKey({
      tool,
      slot: meta.slot,
      state: logical,
      title,
      elapsedMin,
      detail,
      pop,
      urgent,
    });
    if (lastCardKey.get(meta.actionid) === contentKey) continue;

    const reply = await laneRenderer.request(
      lanecards.buildRenderRequest({
        state: logical,
        title,
        elapsedMin,
        detail,
        pop,
        urgent,
      }),
    );
    const parsed =
      reply === null
        ? { ok: false, error: "renderer unavailable" }
        : lanecards.parseRendererLine(reply);
    if (!parsed.ok) {
      log("lane card render failed", `slot=${meta.slot}`, parsed.error);
      paintFrameFallback(meta, logical, now);
      continue;
    }
    client.setState([lanecards.buildCardItem(meta, parsed.format, parsed.data)]);
    lastCardKey.set(meta.actionid, contentKey);
    cardActive.add(meta.actionid);
    // The card owns the tile now — drop the frame diff so a later fallback
    // (or blink) is guaranteed to repaint instead of assuming its old frame.
    lastKeyState.delete(meta.actionid);
    sent.push(`${meta.slot}:${logical}${parsed.format === "gif" ? "*" : ""}`);
  }
  if (sent.length) log("painted cards", tool, sent.join(" "));
}

/**
 * 機能1c — bridge 不達時の全レーン OFFLINE 表示。タイトルは最後に見えた
 * ものを維持。レンダラが死んでいれば Phase A フォールバック（empty 灰）に
 * 落ちる — bridge 不達とレンダラ死亡は独立に起こるため両対応。
 */
async function paintToolOffline(tool, now) {
  const useCards = !needsEmptyFlash && laneRenderer.available();
  const sent = [];
  for (const meta of keys.values()) {
    if (meta.tool !== tool) continue;
    if (!useCards) {
      paintFrameFallback(meta, "offline", now);
      continue;
    }
    const title = lastTitle.get(meta.actionid) || "";
    const contentKey = lanecards.buildContentKey({
      tool,
      slot: meta.slot,
      state: "offline",
      title,
      elapsedMin: 0,
      detail: "",
      pop: false,
      urgent: false,
    });
    if (lastCardKey.get(meta.actionid) === contentKey) continue;
    const reply = await laneRenderer.request(
      lanecards.buildRenderRequest({
        state: "offline",
        title,
        elapsedMin: 0,
        detail: "",
        pop: false,
        urgent: false,
      }),
    );
    const parsed =
      reply === null
        ? { ok: false, error: "renderer unavailable" }
        : lanecards.parseRendererLine(reply);
    if (!parsed.ok) {
      log("offline card render failed", `slot=${meta.slot}`, parsed.error);
      paintFrameFallback(meta, "offline", now);
      continue;
    }
    client.setState([lanecards.buildCardItem(meta, parsed.format, parsed.data)]);
    lastCardKey.set(meta.actionid, contentKey);
    cardActive.add(meta.actionid);
    lastKeyState.delete(meta.actionid);
    sent.push(String(meta.slot));
  }
  if (sent.length) log("painted offline", tool, sent.join(" "));
}

async function paint() {
  if (!keys.size || paintInFlight) return;
  paintInFlight = true;
  try {
    const tools = new Set([...keys.values()].map((k) => k.tool));
    let successCount = 0;
    let failureCount = 0;
    for (const tool of tools) {
      let status = null;
      try {
        status = await fetchJson(
          `${BRIDGE}/status?tool=${encodeURIComponent(tool)}`,
        );
        successCount += 1;
      } catch (err) {
        failureCount += 1;
        log("bridge fetch failed", String(err));
      }
      const now = Date.now();
      if (!status) {
        // 3回連続で全滅したら OFFLINE 表示（復帰時は state 差分で自動再描画）。
        if (lanecards.isBridgeOffline(bridgeFailStreak)) {
          await paintToolOffline(tool, now);
        }
        continue;
      }
      bridgeFailStreak = 0;
      const agents = status.agents || [];
      // 機能2: レーン押下時の focusAction 解決用に最新スナップショットを保持。
      lastAgents.set(tool, agents);
      /** @type {{ meta: any, agent: any, logical: string }[]} */
      const lanes = [];
      for (const meta of keys.values()) {
        if (meta.tool !== tool) continue;
        const agent = agents.find((a) => a.slot === meta.slot) || {
          state: "empty",
        };
        const bridgeState =
          typeof agent.state === "string" ? agent.state : "empty";
        const prevLogical = lastLogicalState.get(meta.actionid);
        // Track when the lane entered its current state (経過時間の起点).
        // done→done_old は表示上の変換なので起点はブリッジ状態で数える。
        if (bridgeState !== prevLogical) {
          stateSince.set(meta.actionid, now);
        }
        // Track the moment a lane ENTERS done — drives the pop frame/GIF.
        if (bridgeState === "done" && prevLogical !== "done") {
          doneAt.set(meta.actionid, now);
        } else if (bridgeState !== "done") {
          doneAt.delete(meta.actionid);
        }
        lastLogicalState.set(meta.actionid, bridgeState);
        if (typeof agent.title === "string" && agent.title) {
          lastTitle.set(meta.actionid, agent.title);
        }
        // 機能1a: 既読(ack)・90秒経過を織り込んだ表示上の状態に変換。
        const logical = lanecards.effectiveLaneState({
          state: bridgeState,
          updatedAt: Number(agent.updatedAt),
          ackAt: ackAt.get(meta.actionid),
          nowMs: now,
        });
        lanes.push({ meta, agent, logical });
      }
      if (!lanes.length) continue;

      // Boot wave always runs on Phase A frames; cards take over next tick.
      if (!needsEmptyFlash && laneRenderer.available()) {
        await paintToolCards(tool, lanes, now);
      } else {
        await paintToolFrames(tool, lanes, now);
      }
      paintArmedVerbs(tool, lanes, now);
    }
    if (successCount === 0 && failureCount > 0) {
      bridgeFailStreak += 1;
    }
  } finally {
    paintInFlight = false;
  }
}

// When an approval is pending, the Accept key itself blinks orange so the
// eye lands on the choice: Accept / Reject / Stop. State 2 = "Armed".
const ENABLE_ARMED_BLINK = true;
const ARMED_BLINK_MS = 500;
const ARMED_STATE_INDEX = 2;
const armedSent = new Map(); // verb actionid -> last sent state index

function paintArmedVerbs(tool, lanes, now) {
  if (!ENABLE_ARMED_BLINK) return;
  const anyInput = lanes.some((l) => l.logical === "needs_input");
  for (const meta of verbKeys.values()) {
    if (meta.verb !== "accept") continue;
    if (meta.tool && meta.tool !== tool) continue;
    const want = anyInput
      ? Math.floor(now / ARMED_BLINK_MS) % 2 === 0
        ? ARMED_STATE_INDEX
        : 0
      : 0;
    const prev = armedSent.get(meta.actionid) ?? 0;
    if (want !== prev) {
      client.setState([item(meta, want)]);
      armedSent.set(meta.actionid, want);
    }
  }
}

function handleNavAction(action, msg) {
  const a = String(action || "");
  const param = msg.param || {};
  const ticks = Number(param.ticks || param.Steps || param.steps || 1);
  const dir =
    param.direction ||
    param.Direction ||
    (ticks < 0 || param.pressed === false ? "left" : null);

  if (a.includes("profile.prev")) {
    switchProfile("prev");
    return true;
  }
  if (a.includes("profile.next")) {
    switchProfile("next");
    return true;
  }
  if (a.includes("page.prev")) {
    requestPage("prev");
    return true;
  }
  if (a.includes("page.next") && !a.includes("page.dial")) {
    requestPage("next");
    return true;
  }
  if (a.includes("page.dial") || a.includes("page")) {
    if (dir === "left" || ticks < 0) {
      requestPage("prev");
      return true;
    }
    if (dir === "right" || ticks > 0) {
      requestPage("next");
      return true;
    }
    // press cycles forward
    requestPage("next");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Unified verb layer (plan.md「プラグイン新機能」)
// ---------------------------------------------------------------------------

const FOCUS_SETTLE_MS = 250;
const FOCUS_MAX_ATTEMPTS = 2; // bounded retry — never loop forever
let verbInFlight = false;

// --- Guard feedback (Phase A) ----------------------------------------------
// Experimental: flash the pressed verb key to its "Blocked" state (index 1).
// The profile wires verb keys with ViewParam icons whose interaction with
// setState is unverified on-device — flip to false to fall back to sound only.
const ENABLE_VERB_FLASH = true;
const VERB_FLASH_MS = 400;
const GUARD_SOUND = "/System/Library/Sounds/Basso.aiff";

/** Fire-and-forget warning sound. Never throws, never blocks the verb path. */
function playGuardSound() {
  try {
    const child = spawn("afplay", [GUARD_SOUND], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => log("guard sound spawn error", String(err)));
    child.unref();
  } catch (err) {
    log("guard sound threw", String(err));
  }
}

/** Flash the blocked frame on the verb key that was pressed, then restore. */
async function flashVerbKey(actionid) {
  if (!actionid) return;
  const meta = verbKeys.get(String(actionid));
  if (!meta) {
    log("verb flash: key not registered, skip", actionid);
    return;
  }
  client.setState([item(meta, 1)]); // States[1] = Blocked
  await sleep(VERB_FLASH_MS);
  client.setState([item(meta, 0)]); // States[0] = default
}

/** Infer the tool from ActionParam, falling back to the current profile name. */
function toolFromContext(param) {
  const raw = String(param?.tool || param?.Tool || "").toLowerCase();
  if (verbs.isValidTool(raw)) return raw;
  const profile = currentProfileName().toLowerCase();
  if (profile.includes("claude")) return "claude";
  if (profile.includes("codex")) return "codex";
  if (profile.includes("cursor")) return "cursor";
  return null;
}

/** Fetch agent states from the bridge. Returns null when unreachable (= guard fails safe). */
async function fetchAgentStates(tool) {
  try {
    const status = await fetchJson(
      `${BRIDGE}/status?tool=${encodeURIComponent(tool)}`,
    );
    return Array.isArray(status?.agents) ? status.agents : [];
  } catch (err) {
    log("verb: bridge unreachable", String(err));
    return null;
  }
}

/**
 * Auto-focus: activate the tool's app, wait, then verify frontmost.
 * Returns true only when the expected app is verified frontmost.
 */
async function focusAndVerify(tool) {
  const app = verbs.appForTool(tool);
  if (!app) {
    log("verb: no app mapping for tool", tool);
    return false;
  }
  for (let attempt = 1; attempt <= FOCUS_MAX_ATTEMPTS; attempt++) {
    activateApp(app);
    await sleep(FOCUS_SETTLE_MS);
    let front;
    try {
      front = await runOsascript(verbs.buildFrontmostScript());
    } catch (err) {
      log("verb: frontmost check failed", String(err));
      continue;
    }
    if (front === app) return true;
    log("verb: frontmost mismatch", `expected=${app}`, `actual=${front}`, `attempt=${attempt}`);
  }
  return false;
}

/**
 * Full verb pipeline: bridge status → guard → activate → settle →
 * frontmost verify → keystroke send. Logs every branch.
 */
async function handleVerbAction(verbName, tool, actionid) {
  if (!verbs.isValidVerb(verbName)) {
    log("verb: unknown verb, ignoring", verbName);
    return;
  }
  if (!tool) {
    log("verb: tool could not be determined, ignoring", verbName);
    return;
  }
  if (verbInFlight) {
    log("verb: busy, dropping", verbName, tool);
    return;
  }
  verbInFlight = true;
  try {
    // Guarded verbs need bridge state; unguarded ones skip the round-trip.
    const needsGuard = verbs.GUARDED_VERBS.includes(verbName);
    const agentStates = needsGuard ? await fetchAgentStates(tool) : [];
    const guard = verbs.evaluateVerbGuard(verbName, tool, agentStates);
    if (!guard.allowed) {
      log("verb: guard blocked", verbName, tool, guard.reason);
      playGuardSound();
      if (ENABLE_VERB_FLASH) {
        await flashVerbKey(actionid).catch((err) =>
          log("verb flash error", String(err)),
        );
      }
      return;
    }
    log("verb: guard ok", verbName, tool, guard.reason);

    if (!(await focusAndVerify(tool))) {
      log("verb: focus verification failed, not sending", verbName, tool);
      return;
    }

    const script = verbs.buildVerbScript(verbName, tool);
    if (!script) {
      log("verb: no key mapping", verbName, tool);
      return;
    }
    try {
      await runOsascript(script);
      log("verb: sent", verbName, tool);
    } catch (err) {
      log("verb: send failed", verbName, tool, String(err));
    }
  } finally {
    verbInFlight = false;
  }
}

// --- Dials -----------------------------------------------------------------

const LANE_COUNT = 5;
let selectedLane = 1;
let laneBusy = false;

/** Blink the selected lane key (empty ↔ current state, 2 round trips). */
async function blinkLane(meta) {
  const restore = lastKeyState.get(meta.actionid) ?? STATE_INDEX.empty;
  for (let i = 0; i < 2; i++) {
    client.setState([item(meta, STATE_INDEX.empty)]);
    await sleep(150);
    client.setState([item(meta, restore)]);
    await sleep(150);
  }
  // Force a repaint so the tile settles on the true bridge state
  // (frame mode AND card mode — the blink overwrote any dynamic card).
  lastKeyState.delete(meta.actionid);
  lastCardKey.delete(meta.actionid);
  cardActive.delete(meta.actionid);
}

/** Rotate handler for dial.lane: select lane, blink it, notify session name. */
async function handleLaneRotate(direction, param) {
  if (laneBusy) {
    log("dial.lane: busy, dropping tick");
    return;
  }
  laneBusy = true;
  try {
    const delta = direction === "left" ? -1 : 1;
    selectedLane = ((selectedLane - 1 + delta + LANE_COUNT) % LANE_COUNT) + 1;
    const tool = toolFromContext(param);
    log("dial.lane: selected", selectedLane, tool || "tool-unknown");

    let sessionLabel = `Lane ${selectedLane}`;
    if (tool) {
      const agents = await fetchAgentStates(tool);
      if (agents) {
        const agent = agents.find((a) => Number(a?.slot) === selectedLane);
        if (agent) {
          sessionLabel = String(agent.title || agent.id || sessionLabel);
          if (agent.state) sessionLabel += ` (${agent.state})`;
        } else {
          sessionLabel += " (empty)";
        }
      } else {
        sessionLabel += " (bridge offline)";
      }
    }
    try {
      await runOsascript(
        verbs.buildNotificationScript(sessionLabel, "Vibe Deck — Lane"),
      );
    } catch (err) {
      log("dial.lane: notification failed", String(err));
    }

    const meta = [...keys.values()].find(
      (k) =>
        k.slot === selectedLane &&
        (!tool || k.tool === tool) &&
        String(k.uuid || "").includes(".agent"),
    );
    if (meta) {
      await blinkLane(meta);
    } else {
      log("dial.lane: no key registered for lane", selectedLane);
    }
  } finally {
    laneBusy = false;
  }
}

/** Route dial rotation events. Returns true when handled. */
function handleDialRotate(action, direction, param) {
  const a = String(action || "");
  if (a.includes("dial.tool")) {
    switchProfile(direction === "left" ? "prev" : "next");
    return true;
  }
  if (a.includes("dial.lane")) {
    handleLaneRotate(direction, param).catch((e) =>
      log("dial.lane rotate error", String(e)),
    );
    return true;
  }
  if (a.includes("dial.autonomy")) {
    const verbName = direction === "left" ? "autonomy_fast" : "autonomy_deep";
    handleVerbAction(verbName, toolFromContext(param)).catch((e) =>
      log("dial.autonomy rotate error", String(e)),
    );
    return true;
  }
  return false;
}

/**
 * Route a `run` cmd on a dial action. Some hosts deliver rotation as `run`
 * with ticks/direction params — detect that and forward; otherwise it's a press.
 */
function handleDialRun(action, param) {
  const a = String(action || "");
  if (!a.includes("dial.")) return false;
  const ticks = Number(param?.ticks ?? param?.Steps ?? param?.steps ?? 0);
  const dir = param?.direction || param?.Direction || null;
  if ((Number.isFinite(ticks) && ticks !== 0) || dir === "left" || dir === "right") {
    return handleDialRotate(
      a,
      ticks < 0 || dir === "left" ? "left" : "right",
      param,
    );
  }
  return handleDialPress(a, param);
}

/** Route dial press (run) events. Returns true when handled. */
function handleDialPress(action, param) {
  const a = String(action || "");
  if (a.includes("dial.tool")) {
    // Keypad "Tool" key (mode: "cycle") — Studio never routes Encoder events
    // to plugins, so tool switching lives on a key that cycles the ring.
    if (String(param?.mode || "") === "cycle") {
      switchProfile("next");
      log("dial.tool key: cycle next");
      return true;
    }
    const tool = toolFromContext(param);
    const app = tool ? verbs.appForTool(tool) : null;
    if (app) {
      activateApp(app);
      log("dial.tool press: activate", app);
    } else {
      log("dial.tool press: tool unknown, ignoring");
    }
    return true;
  }
  if (a.includes("dial.lane")) {
    const tool = toolFromContext(param);
    const app = tool ? verbs.appForTool(tool) : null;
    if (app) {
      activateApp(app);
      log("dial.lane press: activate", app, "lane", selectedLane);
    } else {
      log("dial.lane press: tool unknown, ignoring");
    }
    return true;
  }
  if (a.includes("dial.autonomy")) {
    handleVerbAction("mode", toolFromContext(param)).catch((e) =>
      log("dial.autonomy press error", String(e)),
    );
    return true;
  }
  return false;
}

client.on("add", remember);
client.on("run", async (msg) => {
  const action = msg.action || msg.Action || msg.uuid || "";
  const param = msg.param || {};
  const a = String(action);
  if (a.includes(".verb")) {
    const verbName = String(param.verb || param.Verb || "");
    const actionid = msg.actionid || msg.ActionID || param.actionid;
    handleVerbAction(verbName, toolFromContext(param), actionid).catch((e) =>
      log("verb run error", String(e)),
    );
    return;
  }
  if (handleDialRun(a, param)) return;
  if (handleNavAction(action, msg)) return;
  if (a.includes("refresh")) {
    lastKeyState.clear();
    resetCardState();
    needsEmptyFlash = true;
    await paint();
    return;
  }
  if (a.includes("agent") || a.includes("focus")) {
    handleAgentPress(msg, param);
  }
});

/**
 * レーン（agent キー）押下: 既読処理（機能1a）と焦点実行（機能2）を同時に行う。
 * focusAction は最新 /status スナップショットから解決し、
 * open_url → `open <url>`、activate_app → 従来どおり、解決不能 → ツール既定アプリ。
 */
function handleAgentPress(msg, param) {
  const tool = String(param.tool || "cursor");
  const actionid = String(
    msg.actionid || msg.ActionID || param.actionid || "",
  );
  const meta = actionid ? keys.get(actionid) : undefined;
  // 既読は押された該当レーンのみ（updatedAt が押下時刻より古い done を idle 化）。
  if (actionid) {
    ackAt.set(actionid, Date.now());
  }
  const laneTool = meta?.tool || tool;
  const slot = meta?.slot ?? Number(param.slot || param.Slot || 0);
  const focus = lanecards.resolveFocusAction(lastAgents.get(laneTool), slot);
  if (focus?.kind === "open_url") {
    openUrl(focus.payload);
    log("agent press: open_url", `slot=${slot}`, focus.payload);
    return;
  }
  if (focus?.kind === "activate_app") {
    activateApp(focus.payload);
    log("agent press: activate", `slot=${slot}`, focus.payload);
    return;
  }
  // フォールバック: 従来のツール→アプリ前面化。
  const app =
    laneTool === "claude" ? "Claude" : laneTool === "codex" ? "ChatGPT" : "Cursor";
  activateApp(app);
  log("agent press: activate fallback", `slot=${slot}`, app);
}

for (const evt of [
  "dialRotate",
  "rotate",
  "knob_rotate",
  "dial-rotate",
  "encoder",
]) {
  client.on(evt, (msg) => {
    const action = msg.action || msg.Action || msg.uuid || "";
    const param = msg.param || msg.payload || {};
    const ticks = Number(param.ticks ?? param.Steps ?? param.steps ?? msg.ticks ?? 0);
    const direction =
      ticks < 0 || param.direction === "left" || param.Direction === "left"
        ? "left"
        : "right";
    if (handleDialRotate(action, direction, param)) return;
    if (String(action).includes("page")) {
      requestPage(direction === "left" ? "prev" : "next");
      return;
    }
    if (String(action).includes("profile")) {
      switchProfile(direction === "left" ? "prev" : "next");
    }
  });
}

const host = process.argv[2] || "127.0.0.1";
const port = process.argv[3] || "2394";
log("boot", { host, port, argv: process.argv.slice(2), paintMs: PAINT_MS });
client.connect(host, port);
setInterval(() => {
  pollPendingProfile().catch(() => {});
  paint().catch((e) => log("paint error", String(e)));
}, PAINT_MS);
