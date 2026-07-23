import type { ToolId } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import type { AdapterResult, ToolAdapter } from "./types.js";

const adapters: Record<ToolId, ToolAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
};

export function getAdapter(tool: ToolId): ToolAdapter {
  return adapters[tool];
}

export async function collectTool(tool: ToolId): Promise<AdapterResult> {
  return getAdapter(tool).collect();
}

export type { AdapterResult, ToolAdapter };
