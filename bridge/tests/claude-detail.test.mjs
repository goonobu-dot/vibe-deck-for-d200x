import test from "node:test";
import assert from "node:assert/strict";

// Real implementation from the compiled adapter (npm run build first).
import {
  inferFromLines,
  summarizeToolUse,
} from "../dist/adapters/claude.js";

const line = (obj) => JSON.stringify(obj);

function assistantLine({ content, stop = null }) {
  return line({
    type: "assistant",
    message: {
      ...(stop ? { stop_reason: stop } : {}),
      content,
    },
  });
}

test("needs_input attaches detail from the trailing AskUserQuestion", () => {
  const parsed = inferFromLines(
    [
      assistantLine({
        content: [
          {
            type: "tool_use",
            name: "AskUserQuestion",
            input: { questions: [{ question: "デプロイしますか?" }] },
          },
        ],
      }),
    ],
    "fallback",
  );
  assert.equal(parsed.state, "needs_input");
  assert.equal(parsed.detail, "AskUserQuestion: デプロイしますか?");
});

test("needs_input via Permission tool summarizes the command input", () => {
  const parsed = inferFromLines(
    [
      assistantLine({
        content: [
          {
            type: "tool_use",
            name: "PermissionRequest",
            input: { command: "git push" },
          },
        ],
      }),
    ],
    "fallback",
  );
  assert.equal(parsed.state, "needs_input");
  assert.equal(parsed.detail, "PermissionRequest: git push");
});

test("detail is capped at 30 chars with an ellipsis", () => {
  const parsed = inferFromLines(
    [
      assistantLine({
        content: [
          {
            type: "tool_use",
            name: "AskUserQuestion",
            input: { command: "x".repeat(100) },
          },
        ],
      }),
    ],
    "fallback",
  );
  assert.equal(parsed.state, "needs_input");
  assert.equal([...parsed.detail].length, 30);
  assert.ok(parsed.detail.endsWith("…"));
});

test("thinking keeps the pending tool_use detail (hook may flip it to needs_input)", () => {
  const thinking = inferFromLines(
    [
      assistantLine({
        stop: "tool_use",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      }),
    ],
    "fallback",
  );
  assert.equal(thinking.state, "thinking");
  assert.equal(thinking.detail, "Bash: ls");

  const done = inferFromLines(
    [
      assistantLine({
        stop: "end_turn",
        content: [{ type: "text", text: "finished" }],
      }),
    ],
    "fallback",
  );
  assert.equal(done.state, "done");
  assert.equal(done.detail, undefined);
});

test("a later tool-less assistant line clears the remembered tool_use", () => {
  const parsed = inferFromLines(
    [
      assistantLine({
        content: [
          { type: "tool_use", name: "Bash", input: { command: "rm -rf x" } },
        ],
      }),
      // Same turn ends with a question but no tool_use → no stale detail.
      assistantLine({
        content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
      }),
    ],
    "fallback",
  );
  assert.equal(parsed.state, "needs_input");
  // detail comes from the LAST assistant tool_use, not the earlier Bash one
  assert.equal(parsed.detail, "AskUserQuestion");
});

test("summarizeToolUse survives hostile inputs", () => {
  assert.equal(summarizeToolUse("Bash", null), "Bash");
  assert.equal(summarizeToolUse("Bash", "not an object"), "Bash");
  assert.equal(summarizeToolUse("Bash", { command: "  " }), "Bash");
  assert.equal(
    summarizeToolUse("Bash", { command: "echo\n  hi\t there" }),
    "Bash: echo hi there",
  );
  // surrogate pairs (emoji) are never split by the cap
  const emoji = summarizeToolUse("T", { command: "😀".repeat(50) });
  assert.equal([...emoji].length, 30);
  assert.doesNotThrow(() => encodeURIComponent(emoji));
});

test("subagent liveness needs growth, not a fresh mtime", async () => {
  const { countLiveSubagents, resetGrowthTracking } = await import(
    "../dist/adapters/claude.js"
  );
  resetGrowthTracking();
  const t0 = 1_000_000;
  const snap = (a, b) => [
    { file: "/p/sess.jsonl", mtime: t0, size: 100 },
    { file: "/p/sess/subagents/agent-a.jsonl", mtime: t0, size: a },
    { file: "/p/sess/subagents/agent-b.jsonl", mtime: t0, size: b },
  ];
  // first sighting proves nothing
  assert.equal(countLiveSubagents(snap(10, 10), t0), 0);
  // only agent-a grew; agent-b was merely re-touched (same size)
  assert.equal(countLiveSubagents(snap(20, 10), t0 + 1000), 1);
  // nothing grew → the session is finished even though mtime is "now"
  assert.equal(countLiveSubagents(snap(20, 10), t0 + 2000), 0);
  resetGrowthTracking();
});
