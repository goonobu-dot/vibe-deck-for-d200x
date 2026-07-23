import type { StatusPayload, ToolId } from "../types.js";

type Entry = { at: number; payload: StatusPayload };

const store = new Map<ToolId, Entry>();
const invalid = new Set<ToolId>();

export function invalidateStatus(tool?: ToolId): void {
  if (tool) {
    invalid.add(tool);
    store.delete(tool);
    return;
  }
  for (const t of store.keys()) invalid.add(t);
  store.clear();
}

export function getCachedStatus(
  tool: ToolId,
  ttlMs: number,
): StatusPayload | null {
  if (invalid.has(tool)) {
    invalid.delete(tool);
    store.delete(tool);
    return null;
  }
  const hit = store.get(tool);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    store.delete(tool);
    return null;
  }
  return hit.payload;
}

export function setCachedStatus(tool: ToolId, payload: StatusPayload): void {
  invalid.delete(tool);
  store.set(tool, { at: Date.now(), payload });
}
