import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReferenceFormatters, createRenderer, emptyFragment, fragment, type SlotSpec } from '../src/index.ts';
import {
  approvalRecorded, blockedByConstraint, deferredItemsClause, exampleNegotiationTemplates, executionCompleted, proposalSummary,
} from '../src/examples/negotiation.ts';
import { assertTemplateError, loose } from './helpers.ts';

const r = createRenderer({ formatters: createReferenceFormatters() });
const CANARY = 'CANARY-FIN-7731';
/** Fields that exist on private rows (finance constraints, briefs) and must never reach room-visible text. */
const PRIVATE_FIELDS = { capCents: 480000, budgetCents: 500000, floorCents: 70000, briefNotes: CANARY };

describe('example negotiation templates', () => {
  it('render the expected room-visible text', () => {
    assert.equal(
      r.render(proposalSummary, {
        actor: 'provider', items: ['LOGIN', 'REPORTS'], amount: 90000, deliveryDate: '2026-11-14',
        deferred: fragment(deferredItemsClause, { items: ['EXPORT'] }),
      }),
      'Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred.',
    );
    assert.equal(
      r.render(proposalSummary, { actor: 'provider', items: ['LOGIN'], amount: 50000, deliveryDate: '2026-11-14', deferred: emptyFragment }),
      'Provider proposes LOGIN for $500, delivery 2026-11-14.',
    );
    assert.equal(
      r.render(blockedByConstraint, { constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: 'OVER_BUDGET' }),
      'Finance constraint changed (v2); proposal v3 blocked: exceeds the finance limit.',
    );
    assert.equal(
      r.render(approvalRecorded, { approver: 'customer', proposalVersion: 3, constraintsVersion: 2, approvalsReceived: 2, approvalsRequired: 3 }),
      'Customer approved proposal v3 under constraints v2 (2 of 3 required approvals).',
    );
    assert.equal(
      r.render(executionCompleted, { proposalVersion: 3, amount: 90000, taskCount: 2, deliveryDate: '2026-11-14' }),
      'Proposal v3 executed: change order for $900, tasks created: 2, delivery 2026-11-14.',
    );
  });

  it('reject every private field at runtime, without echoing the value', () => {
    const base = {
      [blockedByConstraint.id]: { constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: 'OVER_BUDGET' },
      [approvalRecorded.id]: { approver: 'finance', proposalVersion: 3, constraintsVersion: 2, approvalsReceived: 1, approvalsRequired: 3 },
      [executionCompleted.id]: { proposalVersion: 3, amount: 90000, taskCount: 2, deliveryDate: '2026-11-14' },
    } as const;
    for (const t of [blockedByConstraint, approvalRecorded, executionCompleted]) {
      for (const [field, value] of Object.entries(PRIVATE_FIELDS)) {
        const e = assertTemplateError(() => r.render(t, loose({ ...base[t.id], [field]: value })), 'UNKNOWN_SLOT', String(value));
        assert.equal(e.slot, field);
      }
    }
  });

  it('reject private text smuggled into a vocabulary slot', () => {
    assertTemplateError(
      () => r.render(blockedByConstraint, loose({ constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: `cap ${CANARY}` })),
      'INVALID_SLOT_VALUE', CANARY,
    );
    assertTemplateError(
      () => r.render(proposalSummary, loose({ actor: 'provider', items: [CANARY], amount: 1, deliveryDate: '2026-11-14', deferred: emptyFragment })),
      'INVALID_SLOT_VALUE', CANARY,
    );
  });

  it('have no free-text slots and the blocked template has no amount slot (structural guarantee)', () => {
    const kinds = (spec: SlotSpec): string[] => (spec.kind === 'list' ? [spec.item.kind] : [spec.kind]);
    for (const t of exampleNegotiationTemplates) {
      for (const spec of Object.values(t.slots as Record<string, SlotSpec>)) {
        assert.ok(!kinds(spec).includes('text'), `${t.id} has a free-text slot`);
      }
    }
    assert.ok(!Object.values(blockedByConstraint.slots as Record<string, SlotSpec>).some((s) => s.kind === 'amount'));
  });
});
