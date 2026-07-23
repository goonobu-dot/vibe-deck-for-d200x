export type AgentState =
  | "idle"
  | "thinking"
  | "done"
  | "needs_input"
  | "error"
  | "empty";

export type ToolId = "claude" | "codex" | "cursor";

export type BridgeHealth = "ok" | "degraded" | "offline";

export interface FocusAction {
  kind: "activate_app" | "shortcut";
  payload: string;
}

export interface AgentSnapshot {
  slot: number;
  id: string;
  title: string;
  state: AgentState;
  updatedAt: number;
  focusAction?: FocusAction;
}

/** Pre-slot agent reported by an adapter (slot assigned later). */
export interface RawAgent {
  id: string;
  title: string;
  state: Exclude<AgentState, "empty">;
  updatedAt: number;
  focusAction?: FocusAction;
}

export interface StatusPayload {
  tool: ToolId;
  bridge: BridgeHealth;
  agents: AgentSnapshot[];
  updatedAt: number;
  note?: string;
}

export const STATE_PRIORITY: Record<AgentState, number> = {
  error: 0,
  needs_input: 1,
  thinking: 2,
  done: 3,
  idle: 4,
  empty: 5,
};

export const STATE_INDEX: Record<AgentState, number> = {
  idle: 0,
  thinking: 1,
  done: 2,
  needs_input: 3,
  error: 4,
  empty: 5,
};
