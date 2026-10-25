export const ITEM_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export function assertItemKey(value: string): string {
  if (typeof value !== "string" || !ITEM_KEY_RE.test(value)) throw new TypeError("Invalid itemKey");
  return value;
}

/** Server-derived plain keys. Inputs must already be visible to every key reader. */
function segment(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid key segment");
  }
  return value;
}
export function executionKey(proposalId: string): string {
  return `exec:${segment(proposalId)}`;
}
export function taskKey(executionId: string, itemKey: string, templateIndex: number): string {
  if (!Number.isSafeInteger(templateIndex) || templateIndex < 0) throw new TypeError("Invalid template index");
  return `${segment(executionId)}:${assertItemKey(itemKey)}:${templateIndex}`;
}
export function candidateKey(itemKeys: readonly string[], modifiers: readonly string[] = []): string {
  function sorted(values: readonly string[]): string[] {
    const result = Array.from(values, assertItemKey).sort();
    if (new Set(result).size !== result.length) throw new TypeError("Duplicate key segment");
    return result;
  }
  if (itemKeys.length === 0) throw new TypeError("Candidate requires an item");
  const items = sorted(itemKeys).join("+");
  const suffix = sorted(modifiers).join("+");
  return suffix ? `${items}@${suffix}` : items;
}
