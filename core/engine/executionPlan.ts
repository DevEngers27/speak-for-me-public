import { canonicalJson } from './canonicalJson';
import { committedCents, type ChangeOrderChain } from './ledger';
import type { Terms, Line, Materialized } from './rules/types';
type PlannedTask = Materialized['plannedTasks'][number];

export interface ExecutionPlan {
  changeOrder: { terms: Terms; lines: Line[]; termsKey: string; chain: ChangeOrderChain };
  ledgerCommit: { amountCents: number };
  tasks: Array<PlannedTask & { taskKeySuffix: string }>;   // `${itemKey}:${templateIndex}`
}
export class ExecutionPlanError extends Error {}           // 调用方转 internal + critical opsLog

export function planExecutionRecords(
  p: { terms: Terms; termsKey: string; lines: readonly Line[]; plannedTasks: readonly PlannedTask[] },
  chain: ChangeOrderChain,
): ExecutionPlan {
  if (canonicalJson(p.terms) !== p.termsKey) throw new ExecutionPlanError('terms_drift');
  if (committedCents(p.lines.map(l => ({ kind: 'commit' as const, amountCents: l.priceCents }))) !== p.terms.amountCents) throw new ExecutionPlanError('amount_claim');
  if (chain.deltaCents !== p.terms.amountCents) throw new ExecutionPlanError('delta_drift');
  if (p.plannedTasks.length > MAX_TASKS_PER_EXECUTION) throw new ExecutionPlanError('too_many_tasks');
  const keys = p.plannedTasks.map((t) => `${t.itemKey}:${t.templateIndex}`);
  if (new Set(keys).size !== keys.length) throw new ExecutionPlanError('task_key_duplicate');
  const scope = new Set([...p.terms.itemKeys, ...p.terms.modifiers]);
  if (p.plannedTasks.some((t) => !scope.has(t.itemKey))) throw new ExecutionPlanError('task_out_of_scope');
  return { changeOrder: { terms: p.terms, lines: [...p.lines], termsKey: p.termsKey, chain },
           ledgerCommit: { amountCents: p.terms.amountCents },
           tasks: p.plannedTasks.map((t, i) => ({ ...t, taskKeySuffix: keys[i]! })) };
}

export const MAX_TASKS_PER_EXECUTION = 50;   // 与目录条目上限一致（14）

