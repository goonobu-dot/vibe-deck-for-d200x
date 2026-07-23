import type { BridgeHealth, RawAgent, ToolId } from "../types.js";

export interface AdapterResult {
  tool: ToolId;
  agents: RawAgent[];
  health: BridgeHealth;
  note?: string;
}

export interface ToolAdapter {
  tool: ToolId;
  collect(): Promise<AdapterResult>;
}
