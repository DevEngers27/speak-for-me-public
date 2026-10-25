/**
 * ILLUSTRATIVE example templates for negotiation events.
 *
 * Status: examples, not a contract. Event names, slot names, role labels,
 * reason codes and wording are placeholders until the design documents
 * (protocol, disclosure matrix, first-scenario templates) are final. They
 * exist to show the intended shape and to prove, in tests, that a private
 * field cannot reach room-visible text.
 *
 * How these resist leaks:
 *  - No slot is free text. Item keys are `token`s, actors and reasons are
 *    `enum`s whose display labels are authored here. A private value (a cap,
 *    a floor, brief prose) has no slot to travel in.
 *  - Every slot is required and no other field is accepted: passing
 *    `capCents`, `budgetCents`, `notes`... fails to compile and throws
 *    UNKNOWN_SLOT at runtime.
 *  - The "blocked" text deliberately has no amount slot: the room learns that
 *    a constraint blocked a version and why (a reason code), never the limit.
 *    An audience-specific variant with numbers would be a separate template
 *    chosen by the disclosure layer, not a flag on this one.
 */
import { defineTemplate, slot } from '../index.ts';

/** Example role vocabulary of the first scenario. */
export const exampleRoleLabels = {
  customer: 'Customer',
  provider: 'Provider',
  finance: 'Finance',
} as const;

/** Example reason-code vocabulary (room-visible wording, no numbers). */
export const exampleBlockReasonLabels = {
  OVER_BUDGET: 'exceeds the finance limit',
  MISSING_REQUIRED_ITEM: 'a required item is missing',
  DATE_CONFLICT: 'the delivery date conflicts with a deadline',
} as const;

const role = slot.enum(exampleRoleLabels);
const itemKey = slot.token({ pattern: /[A-Z][A-Z0-9_]{0,31}/ });
const version = slot.integer({ min: 1 });

/** "; EXPORT + AUDIT deferred" — the optional clause of a proposal summary. */
export const deferredItemsClause = defineTemplate({
  id: 'example.negotiation.deferred_items',
  slots: { items: slot.list(itemKey) },
  text: '; {items} deferred',
});

/** "Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred." */
export const proposalSummary = defineTemplate({
  id: 'example.negotiation.proposal_summary',
  slots: {
    actor: role,
    items: slot.list(itemKey),
    amount: slot.amount(),
    deliveryDate: slot.date(),
    deferred: slot.optionalFragment([deferredItemsClause]),
  },
  text: '{actor} proposes {items} for {amount}, delivery {deliveryDate}{deferred}.',
});

/** "Finance constraint changed (v2); proposal v3 blocked: exceeds the finance limit." */
export const blockedByConstraint = defineTemplate({
  id: 'example.negotiation.blocked_by_constraint',
  slots: {
    constraintOwner: role,
    constraintsVersion: version,
    proposalVersion: version,
    reason: slot.enum(exampleBlockReasonLabels),
  },
  text: '{constraintOwner} constraint changed (v{constraintsVersion}); proposal v{proposalVersion} blocked: {reason}.',
});

/** "Finance approved proposal v3 under constraints v2 (2 of 3 required approvals)." */
export const approvalRecorded = defineTemplate({
  id: 'example.negotiation.approval_recorded',
  slots: {
    approver: role,
    proposalVersion: version,
    constraintsVersion: version,
    approvalsReceived: slot.integer({ min: 1 }),
    approvalsRequired: slot.integer({ min: 1 }),
  },
  text: '{approver} approved proposal v{proposalVersion} under constraints v{constraintsVersion} ({approvalsReceived} of {approvalsRequired} required approvals).',
});

/** "Proposal v3 executed: change order for $900, tasks created: 2, delivery 2026-11-14." */
export const executionCompleted = defineTemplate({
  id: 'example.negotiation.execution_completed',
  slots: {
    proposalVersion: version,
    amount: slot.amount(),
    taskCount: slot.integer({ min: 0 }),
    deliveryDate: slot.date(),
  },
  text: 'Proposal v{proposalVersion} executed: change order for {amount}, tasks created: {taskCount}, delivery {deliveryDate}.',
});

export const exampleNegotiationTemplates = [
  deferredItemsClause,
  proposalSummary,
  blockedByConstraint,
  approvalRecorded,
  executionCompleted,
] as const;
