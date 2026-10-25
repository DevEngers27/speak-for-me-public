// Compile-time proofs, checked by `npm run typecheck` (this file is never executed).
// Every `@ts-expect-error` line MUST be an error; if one stops being an error,
// tsc fails with "Unused '@ts-expect-error' directive".
import { createReferenceFormatters, createRenderer, defineTemplate, emptyFragment, fragment, slot, type ValuesOf } from '../src/index.ts';
import {
  approvalRecorded,
  blockedByConstraint,
  deferredItemsClause,
  executionCompleted,
  proposalSummary,
} from '../src/examples/negotiation.ts';

const r = createRenderer({ formatters: createReferenceFormatters() });

// --- 1. Template text must match the declared slots exactly -----------------
defineTemplate({ id: 't.ok', slots: { a: slot.integer() }, text: 'a={a}' });
// @ts-expect-error placeholder {b} is not a declared slot
defineTemplate({ id: 't.unknown_placeholder', slots: { a: slot.integer() }, text: 'a={a} b={b}' });
// @ts-expect-error slot b is declared but unused
defineTemplate({ id: 't.unused_slot', slots: { a: slot.integer(), b: slot.integer() }, text: 'a={a}' });
const widened: string = 'a={a}';
// @ts-expect-error non-literal text cannot be checked, so it is refused
defineTemplate({ id: 't.widened', slots: { a: slot.integer() }, text: widened });

// --- 2. Missing, unknown and extra fields are compile errors -----------------
const okValues = { proposalVersion: 3, amount: 90000, taskCount: 2, deliveryDate: '2026-11-14' };
r.render(executionCompleted, okValues);
r.render(executionCompleted, { proposalVersion: 3, amount: 90000, taskCount: 2, deliveryDate: '2026-11-14' });
// @ts-expect-error missing slot deliveryDate
r.render(executionCompleted, { proposalVersion: 3, amount: 90000, taskCount: 2 });
// @ts-expect-error extra field on a literal: private cap rejected
r.render(executionCompleted, { proposalVersion: 3, amount: 90000, taskCount: 2, deliveryDate: '2026-11-14', capCents: 480000 });

// A wider NON-literal object: plain TS assignability would accept it; Exact<> does not.
const privateRow = { ...okValues, capCents: 480000, briefNotes: 'CANARY-FIN-7731' };
// @ts-expect-error extra fields on a non-literal object are rejected too
r.render(executionCompleted, privateRow);
// @ts-expect-error wrong slot type (string where an integer is declared)
r.render(executionCompleted, { ...okValues, taskCount: 'two' });

// --- 3. Enum slots accept only their vocabulary -------------------------------
r.render(blockedByConstraint, { constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: 'OVER_BUDGET' });
// @ts-expect-error free text is not a reason code
r.render(blockedByConstraint, { constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: 'cap is $4,800' });
// @ts-expect-error "admin" is not a role in the vocabulary
r.render(approvalRecorded, { approver: 'admin', proposalVersion: 3, constraintsVersion: 2, approvalsReceived: 1, approvalsRequired: 3 });
// @ts-expect-error the blocked template has no amount slot, so the limit cannot be passed
r.render(blockedByConstraint, { constraintOwner: 'finance', constraintsVersion: 2, proposalVersion: 3, reason: 'OVER_BUDGET', capCents: 480000 });

// --- 4. Fragment slots accept only fragments of the listed templates ----------
const deferred = fragment(deferredItemsClause, { items: ['EXPORT'] });
r.render(proposalSummary, { actor: 'provider', items: ['LOGIN', 'REPORTS'], amount: 90000, deliveryDate: '2026-11-14', deferred });
r.render(proposalSummary, { actor: 'provider', items: ['LOGIN'], amount: 50000, deliveryDate: '2026-11-14', deferred: emptyFragment });
const otherFragment = fragment(executionCompleted, okValues);
// @ts-expect-error a fragment of a different template is not accepted
r.render(proposalSummary, { actor: 'provider', items: ['LOGIN'], amount: 50000, deliveryDate: '2026-11-14', deferred: otherFragment });
// @ts-expect-error a plain string is not a fragment
r.render(proposalSummary, { actor: 'provider', items: ['LOGIN'], amount: 50000, deliveryDate: '2026-11-14', deferred: '; cap $4,800' });
// @ts-expect-error fragment() checks extra fields as well
fragment(deferredItemsClause, { items: ['EXPORT'], capCents: 1 });

const required = defineTemplate({ id: 't.required_fragment', slots: { f: slot.fragment([deferredItemsClause]) }, text: 'x{f}' });
// @ts-expect-error emptyFragment is accepted only by optional fragment slots
r.render(required, { f: emptyFragment });

// --- 5. Branded value types via the builder type parameter -------------------
declare const publicBrand: unique symbol;
type PublicAmountCents = number & { readonly [publicBrand]: true };
const branded = defineTemplate({ id: 't.branded', slots: { amount: slot.amount<PublicAmountCents>() }, text: '{amount}' });
const fromCatalog = 90000 as PublicAmountCents;
const capFromPrivateBrief = 480000;
r.render(branded, { amount: fromCatalog });
// @ts-expect-error a plain (private) number cannot fill a branded public-amount slot
r.render(branded, { amount: capFromPrivateBrief });

// --- 6. ValuesOf exposes the exact payload type for callers ------------------
const payload: ValuesOf<typeof approvalRecorded> = {
  approver: 'customer', proposalVersion: 3, constraintsVersion: 2, approvalsReceived: 1, approvalsRequired: 3,
};
r.render(approvalRecorded, payload);
// @ts-expect-error ValuesOf is exact for literals too
const payloadExtra: ValuesOf<typeof approvalRecorded> = { ...payload, budgetCents: 500000 };
void payloadExtra;
