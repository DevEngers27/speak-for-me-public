import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonicalJson';
import { cents, MAX_CENTS } from './money';
import { isoDate } from './dates';
import { committedCents, computeChangeOrderChain } from './ledger';
import { ExecutionPlanError, planExecutionRecords } from './executionPlan';

export function executionFixture(amount = 80_000) {
  const terms = { itemKeys: ['scope_item'], modifiers: [], deliveryDate: isoDate('2026-10-24'), amountCents: cents(amount) };
  const proposal = { terms, termsKey: canonicalJson(terms), lines: [{ itemKey: 'scope_item', revision: 1, title: 'Scope', priceCents: cents(amount), leadDays: 0 }], plannedTasks: [{ itemKey: 'scope_item', templateIndex: 0, title: 'Deliver', assigneeRole: 'provider', dueDate: terms.deliveryDate }] };
  const result = computeChangeOrderChain({ entries: [{ kind: 'baseline', amountCents: 400_000 }], deltaCents: amount, capCents: 400_000 + amount });
  if (!result.ok) throw new Error('Invalid fixture');
  return { proposal, chain: result.chain };
}

describe('W2-2 execution planning', () => {
  it('08-U14 exact headroom, prior commits, baseline count and invalid cents', () => {
    const input = { entries: [{ kind: 'baseline' as const, amountCents: 400_000 }], deltaCents: 80_000, capCents: 480_000 };
    expect(computeChangeOrderChain(input)).toMatchObject({ ok: true, chain: { headroomAfterCents: 0 } });
    expect(computeChangeOrderChain({ ...input, capCents: 479_999 })).toEqual({ ok: false, code: 'budget.over' });
    for (const entries of [[], [...input.entries, ...input.entries]]) expect(computeChangeOrderChain({ ...input, entries })).toEqual({ ok: false, invariant: 'baseline_count' });
    for (const amountCents of [-1, 0.1, Infinity, MAX_CENTS + 1]) {
      expect(committedCents([{ kind: 'baseline', amountCents }])).toBeNull();
      expect(computeChangeOrderChain({ ...input, deltaCents: amountCents })).toEqual({ ok: false, invariant: 'cents_out_of_range' });
    }
    expect(committedCents([{ kind: 'baseline', amountCents: MAX_CENTS }, { kind: 'commit', amountCents: 1 }])).toBeNull();
    expect(computeChangeOrderChain({ ...input, entries: [...input.entries, { kind: 'commit', amountCents: 1 }], capCents: 480_001 })).toMatchObject({ ok: true, chain: { priorApprovedDeltaCents: 1, amountBeforeCents: 400_001 } });
  });

  it('08-U15 snapshot plan and every execution-plan failure', () => {
    const { proposal: p, chain } = executionFixture();
    expect(planExecutionRecords(p, chain)).toEqual({ changeOrder: { terms: p.terms, termsKey: p.termsKey, lines: p.lines, chain }, ledgerCommit: { amountCents: p.terms.amountCents }, tasks: [{ ...p.plannedTasks[0], taskKeySuffix: 'scope_item:0' }] });
    const cases = [
      { p: { ...p, termsKey: 'drift' }, chain, reason: 'terms_drift' },
      { p: { ...p, lines: [] }, chain, reason: 'amount_claim' },
      { p, chain: { ...chain, deltaCents: 1 }, reason: 'delta_drift' },
      { p: { ...p, plannedTasks: Array.from({ length: 51 }, () => p.plannedTasks[0]!) }, chain, reason: 'too_many_tasks' },
      { p: { ...p, plannedTasks: [...p.plannedTasks, ...p.plannedTasks] }, chain, reason: 'task_key_duplicate' },
      { p: { ...p, plannedTasks: [{ ...p.plannedTasks[0]!, itemKey: 'outside' }] }, chain, reason: 'task_out_of_scope' },
    ];
    for (const c of cases) {
      expect(() => planExecutionRecords(c.p, c.chain)).toThrow(ExecutionPlanError);
      expect(() => planExecutionRecords(c.p, c.chain)).toThrow(c.reason);
    }
  });

  it('08-U16 seeded 2000-case preview equals execution records and preserves snapshots', () => {
    let seed = 0x220026;
    for (let i = 0; i < 2000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const { proposal, chain } = executionFixture(seed % 8_000_000);
      const before = canonicalJson(proposal);
      const preview = planExecutionRecords(proposal, chain);
      const written = planExecutionRecords(structuredClone(proposal), structuredClone(chain));
      expect(written).toEqual(preview);
      expect(written.ledgerCommit.amountCents).toBe(proposal.terms.amountCents);
      expect(written.tasks.map(t => t.taskKeySuffix)).toEqual(proposal.plannedTasks.map(t => `${t.itemKey}:${t.templateIndex}`));
      expect(canonicalJson(proposal)).toBe(before);
    }
  });
});
