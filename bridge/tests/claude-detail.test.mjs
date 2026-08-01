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

test("live subagent files mark the session busy", async () => {
  const { countLiveSubagents } = await import("../dist/adapters/claude.js");
  const now = 1_000_000;
  const files = [
    { file: "/p/sess.jsonl", mtime: now - 60_000 },
    { file: "/p/sess/subagents/agent-a.jsonl", mtime: now - 5_000 },
    { file: "/p/sess/subagents/agent-b.jsonl", mtime: now - 1_000 },
    { file: "/p/sess/subagents/agent-old.jsonl", mtime: now - 90_000 },
  ];
  assert.equal(countLiveSubagents(files, now), 2);
  assert.equal(countLiveSubagents([files[0]], now), 0);
  assert.equal(countLiveSubagents([], now), 0);
});
