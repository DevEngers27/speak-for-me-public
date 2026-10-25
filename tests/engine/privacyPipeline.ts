import { projectFixture } from './projectFixture';
import { buildAgentContext, type AgentView } from '../../core/engine';
import { projectForRole, projectSharedFacts, projectRequestOptions, ROLES, type Role, type DTO, type CheckResult } from './privacyDisclosure';
import { pickExact, type Projected } from '../../core/engine';
import { publicText } from '../../core/engine';
const { definePublicTemplates, renderPublicText, slot } = publicText;
import { daysBetween, isoDate } from '../../core/engine';
import { isEventPayload } from '../../core/engine';

export type PrivateState = {
  capCents: number; committedCents: number; headroomCents: number;
  deadline: string; requiredItemKeys: string[]; preferredItemKeys: string[];
  customerNotes: string; financeNotes: string; providerNotes: string; title: string;
};
export const initialState: PrivateState = {
  capCents: 512347, committedCents: 400219, headroomCents: 112128,
  deadline: '2026-11-20', requiredItemKeys: ['audit', 'sso'], preferredItemKeys: ['sso'],
  customerNotes: 'CANARY-CUS', financeNotes: 'CANARY-FIN', providerNotes: 'CANARY-PRO', title: 'Audit export',
};
const eventTemplates = definePublicTemplates({
  constraints_changed: { reads: ['version'], slots: { version: slot.integer({ min: 1, max: 99 }) }, variants: {
    room: 'Constraints changed (v{version}).', buyer: 'Constraints changed (v{version}).', owner: 'Constraints changed (v{version}).',
  } },
});
/** Model the complete pure projection boundary from raw party records, with disclosure switches off.
 * DX values (cv, fit, request target, public proposal and progress) remain fixed across mutations.
 */
export function projectPrivacyState(role: Role, state: PrivateState = initialState) {
  const project = (family: DTO['family'], data: Record<string, unknown>) => projectForRole(role, { family, data }, {});
  const catalog = [project('catalogItems', { itemKey: 'audit', kind: 'item', priceCents: 200000, leadDays: 3, status: 'confirmed', title: state.title })!, project('catalogItems', { itemKey: 'sso', kind: 'item', priceCents: 50000, leadDays: 2, status: 'confirmed', title: 'SSO login' })!];
  const rawBriefs = ROLES.map(owner => {
    const hardFields = owner === 'finance' ? { capCents: state.capCents } : owner === 'customer' ? { deadline: state.deadline, requiredItemKeys: state.requiredItemKeys } : {};
    const softFields = { notes: state[`${owner}Notes`], preferredItemKeys: state.preferredItemKeys };
    // Only the owner's nested fields enter a DTO. Other parties' raw records reach the projector unchanged.
    const ownHard = owner !== role ? hardFields : owner === 'finance' ? pickExact({ capCents: state.capCents }, ['capCents']) : owner === 'customer' ? pickExact({ deadline: state.deadline, requiredItemKeys: state.requiredItemKeys }, ['deadline', 'requiredItemKeys']) : pickExact({}, []);
    const ownSoft = owner !== role ? softFields : pickExact(softFields, owner === 'customer' ? ['notes', 'preferredItemKeys'] : ['notes']);
    return { role: owner, version: 1, confirmed: true, hardFields: ownHard, softFields: ownSoft };
  });
  const briefs = rawBriefs.map(brief => project('briefs', brief)!);
  const mine = briefs[ROLES.indexOf(role)]!;
  const budget = project('budget', { capCents: state.capCents, committedCents: state.committedCents, headroomCents: state.headroomCents, overByCents: 200000 - state.headroomCents, minAllowedCapCents: state.committedCents });
  const sharedFacts = projectSharedFacts(role, [
    { fromRole: 'finance', field: 'capCents', value: { kind: 'cents', cents: state.capCents }, audience: [], briefVersion: 1, seq: 1 },
    { fromRole: 'finance', field: 'headroomCents', value: { kind: 'cents', cents: state.headroomCents }, audience: [], briefVersion: 1, seq: 1 },
    { fromRole: 'customer', field: 'deadline', value: { kind: 'date', date: state.deadline }, audience: [], briefVersion: 1, seq: 1 },
    { fromRole: 'customer', field: 'requiredItemKeys', value: { kind: 'itemKeys', itemKeys: state.requiredItemKeys }, audience: [], briefVersion: 1, seq: 1 },
  ]);
  const checks: CheckResult[] = [
    { checkId: 'budget-private', code: 'budget.over', ownerRole: null, inputs: ['headroomCents'], params: { overByCents: 200000 - state.headroomCents }, passed: 200000 <= state.headroomCents },
    { checkId: 'deadline-private', code: 'date.after_deadline', ownerRole: null, inputs: ['deadline'], params: { deadline: state.deadline, daysLate: daysBetween(isoDate(state.deadline), isoDate('2026-12-31')) }, passed: '2026-12-31' <= state.deadline },
    { checkId: 'scope-private', code: 'item.required_missing', ownerRole: null, inputs: ['requiredItemKeys'], params: { missingItemKeys: state.requiredItemKeys.filter(key => key !== 'audit') }, passed: state.requiredItemKeys.every(key => key === 'audit') },
  ];
  const proposal = projectForRole(role, { family: 'proposals', data: { version: 1, status: 'active', terms: pickExact({ itemKeys: ['audit'], amountCents: 200000, deliveryDate: '2026-12-31' }, ['itemKeys', 'amountCents', 'deliveryDate']), checks, fit: 'ok' } }, role === 'customer' ? { requiredItemKeys: state.requiredItemKeys } : {} )!;
  // Snapshot inputs depend exclusively on this projected view. No cross-party input is used to filter candidates.
  const candidates = catalog.map((item, index) => pickExact({ optionKey: `O${index + 1}`, candidateKey: item.itemKey as string, itemKeys: [item.itemKey as string], modifiers: [] as string[], amountCents: item.priceCents as number, deliveryDate: '2026-12-31' }, ['optionKey', 'candidateKey', 'itemKeys', 'modifiers', 'amountCents', 'deliveryDate']));
  const turns = ROLES.map(owner => project('turns', { role: owner, kind: 'propose', status: 'completed', turnSeq: 1, candidateSnapshot: owner === role ? candidates : [{ private: state[`${owner}Notes`] }], rationale: state[`${owner}Notes`] })!);
  const options = projectRequestOptions(role, [{ optionKey: 'A', templateKey: 'keep_as_is', effect: { type: 'keep_as_is' } }, { optionKey: 'B', templateKey: 'end_run', effect: { type: 'end_run' } }], projectFixture({ role, ...budget, candidates }));
  const request = project('humanRequests', { kind: 'rounds_exhausted', toRole: role, status: 'open', options, answeredBy: 'SECRET-USER' })!;
  const approvals = ROLES.map(owner => project('approvals', { role: owner, decision: 'reject', note: state[`${owner}Notes`] })!);
  const view = projectFixture({
    room: project('rooms', { status: 'open', constraintsVersion: 2, localDate: '2026-11-02', scenarioKey: 'scope_change', scenarioVersion: 1 }),
    members: ROLES.map(owner => project('members', { role: owner, displayName: owner })), briefs, budget, sharedFacts, catalog, proposal, approvals, turns, request,
    run: project('runs', { status: 'needs_input', roundNo: 3 }),
    ledger: project('ledgerEntries', { kind: 'baseline', amountCents: state.committedCents }),
    execution: project('executions', { proposalVersion: 1, committedBeforeCents: state.committedCents, committedAfterCents: state.committedCents + 200000, capCentsAtExecution: state.capCents }),
    changeOrder: project('changeOrders', { number: 1, deltaCents: 200000, baselineCents: state.committedCents, amountBeforeCents: state.committedCents, amountAfterCents: state.committedCents + 200000 }),
    attempts: ROLES.map(owner => project('attempts', { role: owner, status: 'completed', rawOutputRef: state[`${owner}Notes`] })),
  });
  const payload = { type: 'constraints_changed', fromVersion: 1, toVersion: 2 };
  if (!isEventPayload(payload)) throw new Error('Invalid test event');
  const events = [project('events', { id: 'event1', type: payload.type, text: renderPublicText(eventTemplates.constraints_changed, { version: payload.toVersion }, 'room'), payload, restrictedRef: { table: 'briefs', id: 'private' }, commitTs: 17, restrictedDetails: state, capCents: state.capCents, headroomCents: state.headroomCents, deadline: state.deadline, requiredItemKeys: state.requiredItemKeys })];
  const principal = projectFixture({ briefVersion: mine.version, hard: mine.hardFields, soft: mine.softFields, notes: (mine.softFields as { notes: string }).notes, ownApprovalNotes: approvals.filter(approval => approval.role === role).map(approval => approval.note) });
  const context = buildAgentContext(role, {
    role, protocol: pickExact({ role, scenarioKey: 'scope_change', scenarioVersion: 1, roundNo: 3, maxRounds: 3, clarifyTopics: ['deadline_value', 'option_fits_constraints'] }, ['role', 'scenarioKey', 'scenarioVersion', 'roundNo', 'maxRounds', 'clarifyTopics']),
    principal, sharedFacts, budget, catalog: catalog as unknown as AgentView['catalog'], currentProposal: proposal,
    recentProposals: [], feedback: { proposalVersion: 1, outcome: 'blocked' }, candidates: turns[ROLES.indexOf(role)]!.candidateSnapshot as readonly Projected<object>[], openRequestForMe: request,
  });
  return { view, events, context };
}
