import type { AgentState, RawAgent, ToolId } from "../types.js";
import type { AdapterResult } from "../adapters/types.js";

const CYCLE: Exclude<AgentState, "empty">[] = [
  "idle",
  "thinking",
  "needs_input",
  "done",
  "error",
  "thinking",
];

const APP: Record<ToolId, string> = {
  claude: "Claude",
  codex: "ChatGPT",
  cursor: "Cursor",
};

export function demoAgents(tool: ToolId, now = Date.now()): AdapterResult {
  // All keys share one color so changes are obvious on the deck.
  const tick = Math.floor(now / 2500);
  const state = CYCLE[tick % CYCLE.length]!;
  const agents: RawAgent[] = Array.from({ length: 5 }, (_, i) => ({
    id: `${tool}-demo-${i + 1}`,
    title: state.toUpperCase(),
    state,
    updatedAt: now,
    focusAction: { kind: "activate_app", payload: APP[tool] },
  }));

  return {
    tool,
    agents,
    health: "ok",
    note: `DEMO MODE — all keys ${state} (changes every 2.5s)`,
  };
}
