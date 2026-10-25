import { canonicalJson } from '../canonicalJson';
import type { JsonValue } from '../canonicalJson';
import type { ScenarioPlugin } from '../plugin';
import type { RuleInputBase, View } from './types';
import { PluginContractError } from './types';
/** Project declared hard fields and rule-relevant catalog columns only. */
export function hardProjection<RI extends RuleInputBase>(p: Pick<ScenarioPlugin<RI>, 'fields'>, input: View<RI>): string {
  if (input.viewer !== 'system') throw new PluginContractError('projection_on_view');
  const out: Record<string, JsonValue> = {};
  for (const f of p.fields) if (f.class === 'hard') {
    const v = (input as unknown as Record<string, JsonValue | undefined>)[f.key];
    out[f.key] = Array.isArray(v) ? [...v].sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0) : v ?? null;
  }
  out.catalog = [...input.catalog].sort((a, b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0).map(r => ({ itemKey: r.itemKey, revision: r.revision, status: r.status, priceCents: r.priceCents, leadDays: r.leadDays }));
  return canonicalJson(out);
}
