import test from "node:test";
import assert from "node:assert/strict";

// Real implementation from the compiled module (npm run build first).
import {
  decodeProjectDir,
  MAX_DEPTH,
} from "../dist/lib/projectpath.js";

/** exists stub backed by a fixed set of absolute paths (no real FS). */
function fsOf(...paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

test("decodes a plain dash-separated project dir", () => {
  const exists = fsOf(
    "/Users/admin",
    "/Users/admin/cursor",
    "/Users/admin/cursor/skill",
  );
  assert.equal(
    decodeProjectDir("Users-admin-cursor-skill", exists),
    "/Users/admin/cursor/skill",
  );
});

test("decodes folder names that themselves contain dashes", () => {
  // /Users/admin/claude-work/vibe-deck : both "claude-work" and "vibe-deck"
  // contain a dash, so naive dash→slash would fail.
  const exists = fsOf(
    "/Users/admin",
    "/Users/admin/claude-work",
    "/Users/admin/claude-work/vibe-deck",
  );
  assert.equal(
    decodeProjectDir("Users-admin-claude-work-vibe-deck", exists),
    "/Users/admin/claude-work/vibe-deck",
  );
});

test("backtracks when the greedy short segment is a dead end", () => {
  // "/Users/admin/a" exists but has no "b" child; the true path is
  // "/Users/admin/a-b". Greedy tries /a first, must backtrack to /a-b.
  const exists = fsOf("/Users/admin", "/Users/admin/a", "/Users/admin/a-b");
  assert.equal(decodeProjectDir("Users-admin-a-b", exists), "/Users/admin/a-b");
});

test("prefers the shallow split when both interpretations exist", () => {
  const exists = fsOf(
    "/Users/admin",
    "/Users/admin/a",
    "/Users/admin/a/b",
    "/Users/admin/a-b",
  );
  assert.equal(decodeProjectDir("Users-admin-a-b", exists), "/Users/admin/a/b");
});

test("returns null when no candidate path exists", () => {
  const exists = fsOf("/Users/admin");
  assert.equal(decodeProjectDir("Users-admin-nope-nada", exists), null);
});

test("returns null when the user home does not exist", () => {
  assert.equal(decodeProjectDir("Users-ghost-proj", fsOf()), null);
});

test("returns null for non-Users-prefixed or malformed names", () => {
  const exists = () => true;
  assert.equal(decodeProjectDir("1721452800000", exists), null);
  assert.equal(decodeProjectDir("Users-admin", exists), null); // no tail
  assert.equal(decodeProjectDir("", exists), null);
  assert.equal(decodeProjectDir(undefined, exists), null);
});

test("enforces the depth limit", () => {
  // exists() accepts only dash-free folder names, so segments cannot be
  // merged: an N-token name needs exactly N directory levels.
  const singleTokenDirs = (p) => !String(p.split("/").pop()).includes("-");
  const okTokens = Array.from({ length: MAX_DEPTH }, (_, i) => `d${i}`);
  assert.equal(
    decodeProjectDir(`Users-admin-${okTokens.join("-")}`, singleTokenDirs),
    `/Users/admin/${okTokens.join("/")}`,
  );
  const tooDeep = [...okTokens, "extra"];
  assert.equal(
    decodeProjectDir(`Users-admin-${tooDeep.join("-")}`, singleTokenDirs),
    null,
  );
});

test("a throwing exists() yields null, never an exception", () => {
  const bomb = () => {
    throw new Error("EPERM");
  };
  assert.equal(decodeProjectDir("Users-admin-x", bomb), null);
});

test("double dashes (folder names containing '--') survive", () => {
  const exists = fsOf("/Users/admin", "/Users/admin/my--dir");
  assert.equal(
    decodeProjectDir("Users-admin-my--dir", exists),
    "/Users/admin/my--dir",
  );
});
