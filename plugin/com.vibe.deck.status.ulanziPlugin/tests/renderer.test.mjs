import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// tests/ → plugin dir → app/lane-renderer.py (ships inside the plugin)
const RENDERER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "app",
  "lane-renderer.py",
);

const REPLY_TIMEOUT_MS = 15000; // first render loads .ttc fonts — be generous

const pillowOk =
  spawnSync("python3", ["-c", "import PIL"], { timeout: 20000 }).status === 0;

/** Minimal line-oriented client for the resident renderer daemon. */
class RendererProc {
  constructor() {
    this.proc = spawn("python3", [RENDERER], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buf = "";
    this.waiters = [];
    this.stderr = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        const w = this.waiters.shift();
        if (w) w.resolve(line);
      }
    });
    this.proc.stderr.on("data", (c) => (this.stderr += String(c)));
  }

  /** Write one raw line and await one reply line. */
  requestRaw(rawLine) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`renderer reply timeout; stderr: ${this.stderr}`));
      }, REPLY_TIMEOUT_MS);
      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
      });
      this.proc.stdin.write(`${rawLine}\n`);
    });
  }

  request(obj) {
    return this.requestRaw(JSON.stringify(obj));
  }

  close() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}

function decode(line) {
  assert.ok(!line.startsWith("{"), `expected image, got: ${line.slice(0, 120)}`);
  return Buffer.from(line, "base64");
}

function assertPng144(buf) {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "PNG magic",
  );
  // IHDR width/height: big-endian uint32 at offsets 16 / 20
  assert.equal(buf.readUInt32BE(16), 144, "PNG width");
  assert.equal(buf.readUInt32BE(20), 144, "PNG height");
}

function assertGif144(buf, { minFrames = 2 } = {}) {
  const magic = buf.subarray(0, 6).toString("ascii");
  assert.ok(magic === "GIF89a" || magic === "GIF87a", `GIF magic (${magic})`);
  // logical screen size: little-endian uint16 at offsets 6 / 8
  assert.equal(buf.readUInt16LE(6), 144, "GIF width");
  assert.equal(buf.readUInt16LE(8), 144, "GIF height");
  // frame count = number of Graphic Control Extension blocks (21 F9)
  let frames = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++;
  }
  assert.ok(frames >= minFrames, `expected >=${minFrames} frames, got ${frames}`);
}

/** Per-frame delays (ms) from the Graphic Control Extension blocks. */
function gifFrameDelaysMs(buf) {
  const delays = [];
  // GCE: 21 F9 04 <flags> <delay lo> <delay hi> <transp idx> 00
  // (delay in 1/100 s; trailing 00 block terminator filters false positives)
  for (let i = 0; i < buf.length - 7; i++) {
    if (
      buf[i] === 0x21 &&
      buf[i + 1] === 0xf9 &&
      buf[i + 2] === 0x04 &&
      buf[i + 7] === 0x00
    ) {
      delays.push(buf.readUInt16LE(i + 4) * 10);
    }
  }
  return delays;
}

test("lane renderer daemon", { skip: !pillowOk && "python3/Pillow not available" }, async (t) => {
  const renderer = new RendererProc();
  t.after(() => renderer.close());

  await t.test("thinking renders a 144x144 2-frame looping GIF", async () => {
    const line = await renderer.request({
      state: "thinking",
      title: "Phase B 動的レーンカード",
      elapsed: 12,
      detail: "",
    });
    assertGif144(decode(line));
  });

  await t.test("needs_input renders a blink GIF with Japanese detail", async () => {
    const line = await renderer.request({
      state: "needs_input",
      title: "ビジュアル強化セッション",
      elapsed: 75,
      detail: "Bash: git push origin main",
    });
    assertGif144(decode(line));
  });

  await t.test("done pop renders a GIF, plain done a PNG", async () => {
    const pop = await renderer.request({
      state: "done",
      title: "done",
      elapsed: 1,
      frames: "pop",
    });
    assertGif144(decode(pop));
    const plain = await renderer.request({
      state: "done",
      title: "done",
      elapsed: 1,
    });
    assertPng144(decode(plain));
  });

  await t.test("static states render PNGs", async () => {
    for (const state of ["idle", "error", "empty"]) {
      const line = await renderer.request({ state, title: state, elapsed: 0 });
      assertPng144(decode(line));
    }
  });

  await t.test("done_old (未確認の完了) renders a static deep-green PNG", async () => {
    const line = await renderer.request({
      state: "done_old",
      title: "終わってから放置中",
      elapsed: 12,
    });
    assertPng144(decode(line));
    // pop hint must NOT animate a done_old card
    const withPop = await renderer.request({
      state: "done_old",
      title: "終わってから放置中",
      elapsed: 12,
      frames: "pop",
    });
    assertPng144(decode(withPop));
  });

  await t.test("offline renders a static PNG and keeps the title", async () => {
    const line = await renderer.request({
      state: "offline",
      title: "ブリッジ停止中のセッション",
      elapsed: 0,
    });
    assertPng144(decode(line));
  });

  await t.test("urgent thinking speeds up the breathing GIF (800ms→350ms)", async () => {
    const normal = decode(
      await renderer.request({ state: "thinking", title: "考え中", elapsed: 3 }),
    );
    assertGif144(normal);
    assert.deepEqual(gifFrameDelaysMs(normal), [800, 800]);

    const urgent = decode(
      await renderer.request({
        state: "thinking",
        title: "考え中",
        elapsed: 16,
        urgent: true,
      }),
    );
    assertGif144(urgent);
    assert.deepEqual(gifFrameDelaysMs(urgent), [350, 350]);
  });

  await t.test("hostile urgent values fall back to the normal cadence", async () => {
    for (const bad of ["true", 1, {}, null]) {
      const line = decode(
        await renderer.request({
          state: "thinking",
          title: "x",
          elapsed: 1,
          urgent: bad,
        }),
      );
      assert.deepEqual(gifFrameDelaysMs(line), [800, 800], `urgent=${bad}`);
    }
  });

  await t.test("bad input returns {error} and the daemon keeps serving", async () => {
    const notJson = await renderer.requestRaw("this is not json");
    assert.match(notJson, /^\{.*"error"/);

    const badState = await renderer.request({ state: "bogus", title: "x" });
    assert.match(badState, /^\{.*"error".*unknown state/);

    const notObject = await renderer.request([1, 2, 3]);
    assert.match(notObject, /^\{.*"error"/);

    // still alive and rendering after three bad requests
    const line = await renderer.request({
      state: "idle",
      title: "survived",
      elapsed: 0,
    });
    assertPng144(decode(line));
  });

  await t.test("hostile field types are clamped, not fatal", async () => {
    const line = await renderer.request({
      state: "thinking",
      title: 12345, // non-string → ""
      elapsed: "not-a-number", // → 0
      detail: { nested: true }, // non-string → ""
      frames: null,
    });
    assertGif144(decode(line));
  });
});
