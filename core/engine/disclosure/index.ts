import type { ApprovalSetResult } from '../rules/approvals';
import type { FieldDecl, RoleDecl, ProtocolDecl } from '../plugin';
import { ITEM_KEY_RE } from '../keys';
import { isIsoDate } from '../dates';
import { isProjected, pickExact, type Projected } from '../projection';
import { audienceParams, REASON_CODE_META, type ReasonCode } from '../reasonCodes';

export const ROLES = ['customer', 'provider', 'finance'] as const;
export type Role = typeof ROLES[number];
export type Audience = 'room' | 'self' | 'creator' | 'system' | 'buyersOrSelf' | readonly Role[];
export type FieldTransformContext = {
  readonly viewer: Role;
  readonly owner?: Role;
  readonly roomStatus?: Disclosures['roomStatus'];
  readonly humanReasonKeys: readonly HumanReasonKey[];
  readonly side: RoleDecl['side'] | undefined;
};
export type FieldRule = {
  readonly audience: Audience;
  readonly agent: 'same' | 'never' | 'untrusted';
  readonly variant?: '●′' | '●‴' | '●″' | '●⁗';
  /** Lazy reads ensure masked values (including non-target request kind) are never read. */
  readonly transform?: (read: () => unknown, context: FieldTransformContext) => unknown;
  readonly derivedFrom?: readonly string[];
};
export const PROVIDER_WAITING = 'run_waiting';
const DEFAULT_SIDES: Readonly<Record<Role, RoleDecl['side']>> = { customer: 'buyer', provider: 'seller', finance: 'buyer' };
export function roleSide(role: Role, plugin?: DisclosurePlugin): RoleDecl['side'] | undefined {
  return plugin ? plugin.roles.find(r => r.role === role)?.side : DEFAULT_SIDES[role];
}
export function isFitOnlyRole(role: Role, plugin?: DisclosurePlugin): boolean {
  return roleSide(role, plugin) !== 'buyer';
}
const OMIT_FIELD = Symbol('omitted projection field');
const nonOwnerNull = (read: () => unknown, c: FieldTransformContext): unknown => c.viewer === c.owner ? read() : null;
export const turnStatus = (read: () => unknown, c: FieldTransformContext): unknown => {
  const value = read();
  return c.viewer === c.owner ? value : value === 'scheduled' || value === 'running' ? value : 'done';
};
const briefMetadata = (read: () => unknown, c: FieldTransformContext): unknown => c.viewer !== c.owner && c.side !== 'buyer' && c.roomStatus !== 'setup' ? null : read();
const reasonKey = (read: () => unknown, c: FieldTransformContext): unknown => {
  const value = read();
  const declaration = c.humanReasonKeys.find(k => k.key === value);
  return declaration && (declaration.audience === 'room' || c.side === 'buyer') ? value : null;
};
const runStatus = (read: () => unknown, c: FieldTransformContext): unknown => {
  const value = read();
  return value === 'needs_input' && c.side !== 'buyer' ? PROVIDER_WAITING : value;
};
const requestKind = (read: () => unknown, c: FieldTransformContext): unknown => c.viewer === c.owner || c.side === 'buyer' ? read() : PROVIDER_WAITING;
const targetOnly = (read: () => unknown, c: FieldTransformContext): unknown => c.viewer === c.owner ? read() : OMIT_FIELD;
const room = (agent: FieldRule['agent'] = 'same'): FieldRule => ({ audience: 'room', agent });
const self: FieldRule = { audience: 'self', agent: 'same' };
const system: FieldRule = { audience: 'system', agent: 'never' };
function fields(names: string, rule: FieldRule): Record<string, FieldRule> {
  return Object.fromEntries(names.split(' ').map(name => [name, rule]));
}
/** Closed DTO registry. Unregistered fields are never read or copied. */
export const DISCLOSURE = {
  rooms: { ...fields('id status constraintsVersion localDate timeZone scenarioKey scenarioVersion currentRunId nextProposalVersion provenance followsExecutionId isCreator', room()), title: room('never'), createdBy: system, nextRunNo: system, writeSeq: system, executionId: room('never'), createdAt: room('never'), openedAt: room('never'), executedAt: room('never'), closedAt: room('never') },
  users: { email: { audience: 'self', agent: 'never' }, tokenIdentifier: system, clerkUserId: system, displayName: { audience: 'self', agent: 'never' }, isTestAccount: system, createdAt: system, updatedAt: system },
  members: { ...fields('id role joinedAt isMe', room()), displayName: room('never'), userId: system, roomId: room('never'), joinedVia: system, inviteId: system },
  invites: { ...fields('id role status expiresAt invitedEmail', { audience: 'creator', agent: 'never' }), tokenHash: system, roomId: system, mode: { audience: 'creator', agent: 'never' }, createdBy: system, acceptedBy: system, acceptedAt: { audience: 'creator', agent: 'never' }, createdAt: { audience: 'creator', agent: 'never' } },
  briefs: { ...fields('role confirmed', room('never')), ...fields('version confirmedAt', { ...room('never'), variant: '●′', transform: briefMetadata }), hardFields: self, softFields: self, disclosures: { audience: 'self', agent: 'never' }, confirmedBy: system, roomId: system, source: self, humanRequestId: self, provenance: self },
  sharedFacts: { ...fields('fromRole field value briefVersion', self), createdBy: system, source: system, roomId: system, seq: system, audience: system, humanRequestId: system, provenance: system, createdAt: system },
  catalogItems: { ...fields('id itemKey revision kind priceCents leadDays taskTemplates status', room()), title: room('untrusted'), roomId: system, editNo: room('never'), assigneeRole: room('never'), confirmedBy: system, confirmedAt: room('never'), createdBy: system, provenance: room('never'), createdAt: room('never') },
  budget: { ...fields('overByCents shortfallCents minAllowedCapCents', self) },
  ledgerEntries: { ...fields('id kind amountCents executionId provenance', { audience: ['finance'], agent: 'same' }), roomId: system, recordedByUserId: system, createdAt: { audience: ['finance'], agent: 'never' } },
  proposals: { ...fields('id version terms termsKey lines plannedTasks status origin authorRole createdAtConstraintsVersion requiredApprovals runId fit', room()), notIncludedItemKeys: { audience: ['customer'], agent: 'same' }, checks: { audience: ['customer', 'finance'], agent: 'same' }, roomId: system, sourceTurnId: system, sourceRequestId: system, chosenBy: system, candidateKey: system, statusChangedAt: room('never'), provenance: room('never'), createdAt: room('never') },
  approvals: { ...fields('id role decision seq boundConstraintsVersion boundTermsKey _creationTime effective memberId isMe', room()), reasonKey: { ...room('never'), variant: '●‴', transform: reasonKey }, note: self, userId: system, roomId: system, proposalId: room('never'), runId: system, kind: room('never'), decidedAt: room('never') },
  runs: { status: { ...room(), variant: '●′', transform: runStatus }, ...fields('id roundNo maxRounds activeTurnSeq currentProposalId cause constraintsVersionAtStart endedReason', room()), maxAttempts: system, reservedMicroUsd: system, roomId: system, runNo: room('never'), agentMode: room('never'), roundsExtended: system, nextTurnSeq: system, attemptCount: system, spentMicroUsd: system, spendCapMicroUsd: system, previousRunId: system, startedBy: system, lastFailure: system, provenance: room('never'), startedAt: room('never'), endedAt: room('never') },
  turns: { ...fields('role turnSeq kind constraintsVersion', room('never')), status: { ...room('never'), variant: '●⁗', transform: turnStatus }, currentAttemptNo: { ...room('never'), variant: '●⁗', transform: nonOwnerNull }, ...fields('candidateSnapshot action optionKey proposalVersion reasonKey topicKey toRole rationale', self), roomId: system, runId: system, roundNo: { ...room('never'), variant: '●⁗', transform: nonOwnerNull }, baseProposalId: self, baseProposalVersion: self, allowedActions: self, promptVersion: system, waitingReason: self, beginFnId: system, retryOfTurnId: system, result: self, outcome: self, ...fields('createdAt completedAt', { ...room('never'), variant: '●⁗', transform: nonOwnerNull }) },
  attempts: { ...fields('status attemptNo stopReason', { audience: 'self', agent: 'never' }), ...fields('usage requestId schemaVersion rawOutputRef watchdogFnId', system), roomId: system, runId: system, turnId: system, role: { ...self, agent: 'never' }, origin: { ...self, agent: 'never' }, provenance: system, model: system, effort: system, maxTokens: system, actionFnId: system, watchdogArmCount: system, deadlineAt: system, reservedMicroUsd: system, stopCategory: system, messageId: system, responseModel: system, latencyMs: system, costMicroUsd: system, priceTableAsOf: system, lateUsage: system, errorCode: { ...self, agent: 'never' }, issuePaths: { ...self, agent: 'never' }, move: { ...self, agent: 'never' }, protocolVersion: system, promptVersion: system, reservedDay: system, httpStatus: system, retryAfterMs: system, ...fields('retryNote staleGuard rationaleTruncated', { ...self, agent: 'never' }), outputBytes: system, startedAt: system, finishedAt: system },
  humanRequests: { kind: { ...room('never'), variant: '●″', transform: requestKind }, toRole: { audience: 'buyersOrSelf', agent: 'never', variant: '●″', transform: read => read() }, ...fields('id status expiresAt', { audience: 'buyersOrSelf', agent: 'never', variant: '●″', transform: targetOnly }), options: self, ...fields('effect answerOptionKey', { audience: 'self', agent: 'never' }), answeredBy: system, roomId: system, runId: system, questionKey: self, topicKey: self, sourceTurnId: system, constraintsVersion: self, answeredAt: self, closedReason: self, closedAt: self, provenance: self, createdAt: self },
  constraintRevisions: { constraintsVersion: room(), cause: { audience: ['customer', 'finance'], agent: 'same' }, actorUserId: system, sourceRefs: system, roomId: system, version: room('never'), previousVersion: room('never'), localDate: system, supersededRunId: system, staleProposalId: system, createdAt: system },
  executions: { ...fields('id proposalId proposalVersion constraintsVersion termsKey approvalIds amountCents executedAt scenarioKey scenarioVersion provenance', room('never')), ...fields('committedBeforeCents committedAfterCents capCentsAtExecution', { audience: ['finance'], agent: 'never' }), ...fields('executionKey executedByUserId runId', system), roomId: system },
  changeOrders: { ...fields('id number executionId proposalId proposalVersion terms lines termsKey deltaCents constraintsVersion followsExecutionId provenance createdAt', room('never')), ...fields('baselineCents priorApprovedDeltaCents amountBeforeCents amountAfterCents', { audience: ['finance'], agent: 'never' }), roomId: system },
  tasks: { ...fields('taskKey itemKey title assigneeRole status', room('never')), roomId: system, executionId: room('never'), templateIndex: room('never'), dueDate: room('never'), doneByUserId: system, doneAt: room('never'), provenance: room('never'), createdAt: room('never') },
  events: { ...fields('id type at actorLabel text refs', room('never')), rateUser: system, payload: system, restrictedRef: system, commitTs: system, roomId: system, actor: system, actorUserId: system, seq: system, provenance: system, createdAt: system },
  rawOutputs: { ...fields('attemptId roomId text createdAt expiresAt truncated', system) },
  opsFlags: { ...fields('key draining changedAt changedBy', system) },
  spendCounters: { ...fields('scope day reservedMicroUsd spentMicroUsd attempts unknownCostAttempts', system) },
} as const satisfies Record<string, Record<string, FieldRule>>;
export type Family = keyof typeof DISCLOSURE;
export type HumanReasonKey = { readonly key: string; readonly audience: 'room' | 'buyers' };
export type DisclosurePlugin = { readonly fields: readonly FieldDecl[]; readonly roles: readonly RoleDecl[]; readonly protocol: Pick<ProtocolDecl, 'reasonKeys'>; readonly humanReasonKeys?: readonly HumanReasonKey[] };
export type Disclosures = { readonly plugin?: DisclosurePlugin; readonly sharedFacts?: readonly SharedFact[]; readonly roomStatus?: 'setup' | 'open' | 'executed' | 'closed'; readonly isCreator?: boolean; readonly atVersion?: number; readonly snapshot?: { readonly briefVersion: number; readonly facts: readonly SharedFact[] }; readonly requiredItemKeys?: readonly string[] };
export type DTO = { readonly family: Family; readonly data: Readonly<Record<string, unknown>> };
export function canSee(role: Role, audience: Audience, ownerRole?: Role, isCreator = false, side: RoleDecl['side'] | null = roleSide(role) ?? null): boolean {
  return audience === 'buyersOrSelf' && (side === 'buyer' || role === ownerRole) || audience === 'room' || audience === 'self' && role === ownerRole || audience === 'creator' && isCreator || Array.isArray(audience) && audience.includes(role);
}
/** Audience intersection is the strictest-input rule, including incomparable self classes. */
export function derivedAudience(inputs: readonly (readonly Role[])[]): readonly Role[] {
  if (inputs.length === 0) return Object.freeze([]);
  return Object.freeze(ROLES.filter(role => inputs.every(input => input.includes(role))));
}
/** Input lineage for non-declassified derived fields (§7.8.5). */
export const DERIVED_FROM = Object.freeze({
  'budget.committedCents': ['ledgerEntries.amountCents'],
  'budget.headroomCents': ['budget.capCents', 'ledgerEntries.amountCents'],
  'budget.overByCents': ['proposals.terms.amountCents', 'budget.headroomCents'],
  'budget.shortfallCents': ['proposals.terms.amountCents', 'budget.headroomCents'],
  'executions.committedBeforeCents': ['ledgerEntries.amountCents'],
  'executions.committedAfterCents': ['ledgerEntries.amountCents', 'proposals.terms.amountCents'],
  'executions.capCentsAtExecution': ['budget.capCents'],
  'changeOrders.baselineCents': ['ledgerEntries.amountCents'],
  'changeOrders.priorApprovedDeltaCents': ['ledgerEntries.amountCents'],
  'changeOrders.amountBeforeCents': ['ledgerEntries.amountCents'],
  'changeOrders.amountAfterCents': ['ledgerEntries.amountCents', 'proposals.terms.amountCents'],
  'turns.candidateSnapshot': ['viewFor(turns.role)'],
  'humanRequests.options': ['viewFor(humanRequests.toRole)'],
  'proposals.notIncludedItemKeys': ['briefs.hardFields.requiredItemKeys', 'proposals.terms.itemKeys'],
  'turns.action': ['viewFor(turns.role)'],
  'turns.reasonKey': ['viewFor(turns.role)'],
  'approvals.effective': ['approvals.decision', 'rooms.constraintsVersion'],
} as const);
export { DECLASSIFIED, DECLASSIFIERS, declassified } from './declassifiers';
export function shareableFields(plugin?: DisclosurePlugin): readonly FieldDecl[] {
  return plugin?.fields.filter(field => field.class !== 'note' && field.disclosableTo.length > 0) ?? [];
}
/** Scenario-owned budget keys are declared by semantic, not copied into the engine matrix. */
export function disclosureRules(family: Family, plugin?: DisclosurePlugin): Readonly<Record<string, FieldRule>> {
  if (family === 'proposals' && plugin) return { ...DISCLOSURE.proposals, checks: { audience: plugin.roles.filter(r => r.side === 'buyer').map(r => r.role as Role), agent: 'same' } };
  if (family !== 'budget') return DISCLOSURE[family];
  const owner = plugin?.roles.find(r => r.budgetOwner)?.role as Role | undefined;
  const rule: FieldRule = { audience: owner ? [owner] : 'system', agent: 'same' };
  return Object.fromEntries([...Object.keys(DISCLOSURE.budget), ...(plugin?.fields ?? []).filter(f => f.semantic).map(f => f.key)].map(key => [key, rule]));
}
function budgetOwner(d: Disclosures): Role | undefined {
  return d.plugin?.roles.find(role => role.budgetOwner)?.role as Role | undefined;
}
function disclosedFields(role: Role, d: Disclosures): string[] {
  return projectSharedFacts(role, d.sharedFacts ?? [], d.atVersion, d.plugin).filter(row => row.fromRole !== role).map(row => row.field as string);
}
function hasField(role: Role, field: string, d: Disclosures): boolean {
  if (['amountCents', 'itemKeys', 'localDate', 'constraintsVersion'].includes(field)) return true;
  const declarations = d.plugin?.fields ?? [];
  const headroom = declarations.find(f => f.semantic === 'ledger_headroom')?.key;
  if (field === 'overByCents' || field === 'shortfallCents') return !!headroom && hasField(role, headroom, d);
  const owned = declarations.some(f => f.owner === role && f.key === field);
  const visible = disclosedFields(role, d);
  const cap = declarations.find(f => f.semantic === 'budget_cap')?.key;
  const committed = declarations.find(f => f.semantic === 'ledger_committed')?.key;
  return owned || visible.includes(field) || field === headroom && !!cap && !!committed && visible.includes(cap) && visible.includes(committed);
}
function snapshotVisible(role: Role, semantic: FieldDecl['semantic'], d: Disclosures): boolean {
  if (role === budgetOwner(d)) return true;
  if (!d.snapshot) return false;
  const field = d.plugin?.fields.find(f => f.semantic === semantic)?.key;
  return projectSharedFacts(role, d.snapshot.facts, d.snapshot.briefVersion, d.plugin).some(fact => fact.fromRole === budgetOwner(d) && fact.field === field);
}
/** Nested records must already have passed their own explicit projection. */
function safe(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isProjected(value)) return value;
  if (Array.isArray(value)) return value.map(safe);
  throw new TypeError('Nested DTO must be projected');
}
export function projectForRole(role: Role, dto: DTO, disclosures: Disclosures = {}): Projected<Record<string, unknown>> | undefined {
  if (!ROLES.includes(role)) throw new TypeError('Unknown role');
  const { family, data } = dto;
  if (family === 'budget' && (!budgetOwner(disclosures) || role !== budgetOwner(disclosures) && !disclosures.plugin?.roles.some(r => r.role === role && r.side === 'buyer')) || family === 'ledgerEntries' && role !== budgetOwner(disclosures)) return undefined;
  if (family === 'budget' && role !== budgetOwner(disclosures)) {
    const out: Record<string, unknown> = {};
    for (const fact of projectSharedFacts(role, disclosures.sharedFacts ?? [], disclosures.atVersion, disclosures.plugin)) {
      if (fact.fromRole !== budgetOwner(disclosures)) continue;
      const declaration = disclosures.plugin?.fields.find(f => f.key === fact.field && f.owner === fact.fromRole && f.semantic);
      if (declaration) out[declaration.key] = (fact.value as { cents: number }).cents;
    }
    const key = (semantic: FieldDecl['semantic']) => disclosures.plugin?.fields.find(f => f.semantic === semantic)?.key;
    const cap = key('budget_cap'), committed = key('ledger_committed'), headroom = key('ledger_headroom');
    if (headroom && !(headroom in out) && cap && committed && typeof out[cap] === 'number' && typeof out[committed] === 'number') out[headroom] = (out[cap] as number) - (out[committed] as number);
    // overBy/shortfall require proposal inputs; projectChecks owns that projection.
    return projectConstructed(out);
  }
  if (family === 'catalogItems' && data.status === 'draft' && roleSide(role, disclosures.plugin) !== 'seller') return undefined;
  // Collection callers first resolve the ledger with projectSharedFacts; a DTO row is its latest eligible row.
  if (family === 'sharedFacts') return projectSharedFacts(role, [data as unknown as SharedFact], disclosures.atVersion, disclosures.plugin)[0];
  const owner = family === 'budget' ? budgetOwner(disclosures) : (['briefs', 'approvals', 'turns', 'attempts'].includes(family) ? data.role as Role : family === 'humanRequests' ? data.toRole as Role : family === 'ledgerEntries' ? budgetOwner(disclosures) : undefined);
  const context: FieldTransformContext = {
    viewer: role, owner, roomStatus: disclosures.roomStatus, side: roleSide(role, disclosures.plugin),
    humanReasonKeys: disclosures.plugin?.humanReasonKeys ?? disclosures.plugin?.protocol.reasonKeys.filter(k => k.usableBy.includes('human')).map(k => ({ key: k.reasonKey, audience: 'room' as const })) ?? [],
  };
  const out: Record<string, unknown> = {};
  if (family === 'proposals' && isFitOnlyRole(role, disclosures.plugin) && data.status === 'active' && 'checks' in data) out.fit = projectChecks(role, data.checks as readonly CheckResult[], disclosures).fit;
  for (const [key, rule] of Object.entries(disclosureRules(family, disclosures.plugin)) as [string, FieldRule][]) {
    const moneySnapshot = family === 'executions' && ['committedBeforeCents', 'committedAfterCents', 'capCentsAtExecution'].includes(key) || family === 'changeOrders' && ['baselineCents', 'priorApprovedDeltaCents', 'amountBeforeCents', 'amountAfterCents'].includes(key);
    const allowed = moneySnapshot ? snapshotVisible(role, key === 'capCentsAtExecution' ? 'budget_cap' : 'ledger_committed', disclosures)
      : family === 'budget' ? key === 'minAllowedCapCents' ? role === budgetOwner(disclosures) : hasField(role, key, disclosures)
      : canSee(role, rule.audience, owner, disclosures.isCreator, context.side ?? null);
    if (!allowed || key === 'notIncludedItemKeys' || !(key in data)) continue;
    if (rule.transform) {
      const value = rule.transform(() => data[key], context);
      if (value !== OMIT_FIELD) out[key] = safe(value);
    } else if (family === 'proposals' && (key === 'fit' || key === 'checks')) {
      if (data.status !== 'active') continue;
      if (key === 'checks') {
        const checks = projectChecks(role, data.checks as readonly CheckResult[], disclosures);
        out.fit = checks.fit;
        if (isFitOnlyRole(role, disclosures.plugin)) out.fit = checks.fit;
        else out.checks = checks;
      }
      else if (!('checks' in data)) out.fit = data.fit === 'ok' ? 'ok' : 'blocked';
    } else if (family === 'attempts' && key === 'stopReason') {
      const reason = data.stopReason;
      out.stopReason = ['timeout', 'invalid_output', 'refused'].includes(reason as string) ? reason : 'error';
    } else {
      if (family === 'humanRequests' && key === 'options') assertOptionsProjected(role, data[key]);
      out[key] = safe(data[key]);
    }
  }
  if (family === 'proposals' && role === 'customer' && disclosures.requiredItemKeys) {
    const terms = data.terms as { itemKeys?: readonly string[] } | undefined;
    out.notIncludedItemKeys = disclosures.requiredItemKeys.filter(key => !terms?.itemKeys?.includes(key));
  }
  // Each nested object has passed safe(); reuse W0-2b's immutable projection brand.
  return projectConstructed(out);
}
export type SharedFact = { fromRole: Role; field: string; value: unknown; audience: readonly Role[]; briefVersion: number; seq: number };
export function projectSharedFacts(role: Role, rows: readonly SharedFact[], atVersion?: number, plugin?: DisclosurePlugin): readonly Projected<Record<string, unknown>>[] {
  const latest = new Map<string, SharedFact>();
  for (const row of rows) {
    const declaration = shareableFields(plugin).find(f => f.owner === row.fromRole && f.key === row.field);
    if (!declaration) continue;
    if (atVersion !== undefined && row.briefVersion > atVersion) continue;
    const key = `${row.fromRole}:${row.field}`;
    if (!latest.has(key) || latest.get(key)!.seq < row.seq) latest.set(key, row);
  }
  return [...latest.values()].filter(row => (row.fromRole === role || row.audience.includes(role) && shareableFields(plugin).some(f => f.owner === row.fromRole && f.key === row.field && f.disclosableTo.includes(role))) && row.value !== null && !(isFitOnlyRole(role, plugin) && row.fromRole === plugin?.roles.find(r => r.budgetOwner)?.role)).sort((a,b) => `${a.fromRole}:${a.field}` < `${b.fromRole}:${b.field}` ? -1 : `${a.fromRole}:${a.field}` > `${b.fromRole}:${b.field}` ? 1 : 0).map(row => projectConstructed({ fromRole: row.fromRole, field: row.field, value: projectFactValue(row.value, shareableFields(plugin).find(f => f.owner === row.fromRole && f.key === row.field)!.valueKind), asOfBriefVersion: row.briefVersion }));
}
/** Shared-fact union projection reads only the value discriminator's declared fields. */
function projectFactValue(value: unknown, valueKind: FieldDecl['valueKind']): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid shared fact value');
  const record = value as Readonly<Record<string, unknown>>;
  const expectedKind = valueKind === 'isoDate' ? 'date' : valueKind === 'cents' || valueKind === 'itemKeys' ? valueKind : undefined;
  if (!expectedKind || record.kind !== expectedKind) throw new TypeError('Shared fact kind does not match field declaration');
  const valueFields: Readonly<Record<string, string>> = { date: 'date', itemKeys: 'itemKeys', enum: 'value', cents: 'cents' };
  const key = Object.hasOwn(valueFields, record.kind as string) ? valueFields[record.kind as string] : undefined;
  if (!key) throw new TypeError('Unknown shared fact value');
  const payload = record[key];
  const valid = record.kind === 'date' ? isIsoDate(payload)
    : record.kind === 'cents' ? typeof payload === 'number' && Number.isSafeInteger(payload) && payload >= 0
    : record.kind === 'itemKeys' ? Array.isArray(payload) && payload.every(item => typeof item === 'string' && ITEM_KEY_RE.test(item))
    : typeof payload === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(payload);
  if (!valid) throw new TypeError('Invalid shared fact payload');
  return projectConstructed({ kind: record.kind, [key]: safe(payload) });
}
export type CheckResult = { checkId: string; code: ReasonCode; ownerRole: Role | null; inputs: readonly string[]; params: Readonly<Record<string, unknown>>; passed: boolean };
export function projectChecks(role: Role, checks: readonly CheckResult[], disclosures: Disclosures = {}) {
  const fit = checks.some(check => !check.passed) ? 'blocked' as const : 'ok' as const;
  if (isFitOnlyRole(role, disclosures.plugin)) return projectConstructed({ kind: 'fit' as const, fit });
  const headroom = disclosures.plugin?.fields.find(f => f.semantic === 'ledger_headroom')?.key;
  const items: object[] = [];
  let masked = false;
  for (const check of checks) {
    if (check.passed) continue;
    const owner = check.ownerRole ?? REASON_CODE_META[check.code]?.ownerRole ?? null;
    const visibleInputs = check.inputs.every(field => hasField(role, field, disclosures));
    if (!visibleInputs || owner !== null && owner !== role && check.inputs.length === 0) { masked = true; continue; }
    const allowedParams = audienceParams(check.code, role, { isOwner: role === owner, disclosedFields: [...disclosedFields(role, disclosures), ...(headroom && hasField(role, headroom, disclosures) ? [headroom] : [])] });
    const params = Object.fromEntries(allowedParams.filter(key => key in check.params).map(key => [key, check.params[key]]));
    items.push(projectConstructed({ code: check.code, params: projectConstructed(Object.fromEntries(Object.entries(params).map(([key,value]) => [key, safe(value)]))) }));
  }
  if (masked) items.push(projectConstructed({ code: 'private.constraint_unmet' }));
  return projectConstructed({ kind: 'checks' as const, fit, items });
}
export type RequestEffect =
  | { readonly type: 'pass_to_next'; readonly toRole: Role }
  | { readonly type: 'raise_cap'; readonly amountCents: number }
  | { readonly type: 'drop_items'; readonly itemKeys: readonly string[] }
  | { readonly type: 'extend_deadline'; readonly date: string }
  | { readonly type: 'choose_candidate'; readonly candidateKey: string }
  | { readonly type: 'disclose'; readonly field: string; readonly toRoles: readonly Role[] }
  | { readonly type: 'retry_turn' | 'keep_as_is' | 'end_run' | 'blocked' };
export type RequestOption = { readonly optionKey: string; readonly templateKey: string; readonly effect: RequestEffect };
export type RequestOptionView = {
  readonly role: Role;
  readonly capCents?: number;
  readonly committedCents?: number;
  readonly deadline?: string;
  readonly requiredItemKeys?: readonly string[];
  readonly candidates?: readonly { readonly candidateKey: string; readonly amountCents: number; readonly deliveryDate: string; readonly itemKeys?: readonly string[]; readonly modifiers?: readonly string[] }[];
};
const optionRoles = new WeakMap<object, Role>();
/** Construct options using only values available in the target role's projected view. */
export function projectRequestOptions(toRole: Role, options: readonly RequestOption[], view: Projected<RequestOptionView>, plugin?: DisclosurePlugin): readonly Projected<RequestOption>[] {
  if (!isProjected(view) || view.role !== toRole) throw new TypeError('Option view role mismatch');
  const candidates = view.candidates ?? [];
  return Object.freeze(options.map(option => {
    const { effect } = option;
    let projectedEffect: RequestEffect;
    switch (effect.type) {
      case 'raise_cap': {
        const allowedAmounts = [view.capCents, ...candidates.map(candidate => view.committedCents === undefined ? undefined : view.committedCents + candidate.amountCents)];
        if (toRole !== 'finance' || !Number.isSafeInteger(effect.amountCents) || effect.amountCents < 0 || !allowedAmounts.includes(effect.amountCents)) throw new TypeError('Budget option unavailable in target view');
        projectedEffect = { type: effect.type, amountCents: effect.amountCents }; break;
      }
      case 'drop_items':
        if (toRole !== 'customer' || !effect.itemKeys.every(key => view.requiredItemKeys?.includes(key))) throw new TypeError('Items unavailable in target view');
        projectedEffect = { type: effect.type, itemKeys: [...effect.itemKeys] }; break;
      case 'extend_deadline':
        if (toRole !== 'customer' || ![view.deadline, ...candidates.map(candidate => candidate.deliveryDate)].includes(effect.date)) throw new TypeError('Date unavailable in target view');
        projectedEffect = { type: effect.type, date: effect.date }; break;
      case 'choose_candidate':
        if (toRole !== 'customer' || !candidates.some(candidate => candidate.candidateKey === effect.candidateKey)) throw new TypeError('Candidate unavailable in target view');
        projectedEffect = { type: effect.type, candidateKey: effect.candidateKey }; break;
      case 'disclose': {
        const declaration = shareableFields(plugin).find(f => f.owner === toRole && f.key === effect.field);
        if (!declaration) throw new TypeError('Field cannot be disclosed');
        if (!Array.isArray(effect.toRoles) || !effect.toRoles.length || !effect.toRoles.every(role => ROLES.includes(role) && declaration.disclosableTo.includes(role))) throw new TypeError('Disclose audience not allowed');
        projectedEffect = { type: effect.type, field: effect.field, toRoles: [...effect.toRoles] }; break;
      }
      case 'pass_to_next':
        if (!ROLES.includes(effect.toRole) || effect.toRole === toRole) throw new TypeError('Invalid reroute role');
        projectedEffect = { type: effect.type, toRole: effect.toRole }; break;
      case 'retry_turn': case 'keep_as_is': case 'end_run': case 'blocked':
        projectedEffect = { type: effect.type }; break;
      default: throw new TypeError('Unknown option effect');
    }
    const projected = projectConstructed({ optionKey: option.optionKey, templateKey: option.templateKey, effect: projectConstructed(projectedEffect) });
    optionRoles.set(projected, toRole);
    return projected;
  }));
}
/** The role-specific option constructor is the only source of accepted options. */
export function assertOptionsProjected(toRole: Role, options: readonly import('../rules/types').RequestOption[]): asserts options is readonly Projected<import('../rules/types').RequestOption>[];
export function assertOptionsProjected(toRole: Role, options: unknown): asserts options is readonly Projected<RequestOption>[];
export function assertOptionsProjected(toRole: Role, options: unknown): void {
  if (!ROLES.includes(toRole) || !Array.isArray(options) || !options.every(option => isProjected(option) && optionRoles.get(option) === toRole)) throw new TypeError('Options must be projected for target role');
}

// Registry rules are immutable just like their resulting views.
freezeRegistry(DISCLOSURE);
freezeRegistry(DERIVED_FROM);


/** Only receives locally constructed records after the role whitelist pass.
 * The runtime picker still rejects every unprojected nested object.
 */
function projectConstructed<T extends object>(value: T): Projected<T> {
  const copy = pickExact as unknown as (source: T, keys: readonly string[]) => Projected<T>;
  return copy(value, Object.keys(value));
}

function freezeRegistry(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === 'object') freezeRegistry(child);
  Object.freeze(value);
}

/** Engine option adapter: use the same effect projector and retain validated display fields. */
export function projectEngineRequestOptions(toRole: Role, options: readonly import('../rules/types').RequestOption[], view: Projected<RequestOptionView>, plugin?: DisclosurePlugin): import('../rules/types').RequestOption[] {
  const candidates = view.candidates ?? [];
  for (const option of options) if (option.effect.kind === 'disclose') {
    const effect = option.effect;
    const declaration = shareableFields(plugin).find(f => f.owner === toRole && f.key === effect.field);
    if (!declaration || !effect.toRoles.length || !effect.toRoles.every(role => ROLES.includes(role as Role) && declaration.disclosableTo.includes(role))) throw new TypeError('Disclose audience not allowed');
  }
  const effects = projectRequestOptions(toRole, options.map(o => ({ optionKey: o.optionKey, templateKey: o.templateKey, effect: { ...o.effect, type: o.effect.kind } as RequestEffect })), view, plugin);
  assertOptionsProjected(toRole, effects);
  return options.map((o, n) => {
    const shown = o.shown;
    if (Object.keys(shown).some(k => !['itemKeys', 'modifiers', 'amountCents', 'deliveryDate', 'deltaCents'].includes(k))) throw new TypeError('Unknown shown option field');
    const candidate = o.effect.kind === 'choose_candidate' ? candidates.find(c => c.candidateKey === (o.effect as { candidateKey: string }).candidateKey) : undefined;
    const availableItems = new Set([...(view.requiredItemKeys ?? []), ...candidates.flatMap(c => [...(c.itemKeys ?? []), ...(c.modifiers ?? [])])]);
    if (shown.itemKeys?.some(k => !availableItems.has(k)) || shown.modifiers?.some(k => !availableItems.has(k)) ||
      shown.amountCents !== undefined && !(candidate ? [candidate.amountCents] : candidates.map(c => c.amountCents)).includes(shown.amountCents) ||
      shown.deliveryDate !== undefined && !(candidate ? [candidate.deliveryDate] : [view.deadline, ...candidates.map(c => c.deliveryDate)]).includes(shown.deliveryDate) ||
      shown.deltaCents !== undefined && !(o.effect.kind === 'raise_cap' && view.capCents !== undefined && shown.deltaCents === o.effect.amountCents - view.capCents)) throw new TypeError('Shown option unavailable in target view');
    const { type, ...payload } = effects[n]!.effect;
    const effect = { ...payload, kind: type, ...(o.effect.kind === 'disclose' ? { toRoles: [...o.effect.toRoles] } : {}) } as import('../rules/types').Effect;
    const projected = projectConstructed({ optionKey: o.optionKey, templateKey: o.templateKey, effect: projectConstructed(effect), shown: projectConstructed({ ...shown, ...(shown.itemKeys ? { itemKeys: [...shown.itemKeys] } : {}), ...(shown.modifiers ? { modifiers: [...shown.modifiers] } : {}) }) });
    optionRoles.set(projected, toRole);
    return projected;
  });
}

/** Stored effects were validated against the recipient's view before persistence (D11).
 * Explicitly pick payloads; never forward candidate keys or arbitrary stored fields.
 */
function storedOptionDetails(effect: RequestEffect) {
 switch (effect.type) {
  case 'disclose': return {type: effect.type, disclose: projectConstructed({field: effect.field, toRoles: [...effect.toRoles]})};
  case 'pass_to_next': return {type: effect.type, toRole: effect.toRole};
  case 'raise_cap': return {type: effect.type, effect: projectConstructed({amountCents: effect.amountCents})};
  case 'drop_items': return {type: effect.type, effect: projectConstructed({itemKeys: [...effect.itemKeys]})};
  case 'extend_deadline': return {type: effect.type, effect: projectConstructed({date: effect.date})};
  case 'choose_candidate': case 'keep_as_is': case 'end_run': case 'blocked': case 'retry_turn': return {type: effect.type};
 }
}

/** Read immutable display snapshots; never reconstruct historical options from current state. */
export function projectStoredRequestOptions(viewer: Role, toRole: Role, options: readonly {optionKey:string;templateKey:string;shown?:{itemKeys?:string[];modifiers?:string[];amountCents?:number;deliveryDate?:string;deltaCents?:number};effect:RequestEffect}[]) {
 if(viewer!==toRole)return [];
 return options.map(o=>projectConstructed({optionKey:o.optionKey,templateKey:o.templateKey,...storedOptionDetails(o.effect),effectView:projectConstructed({
  ...(o.effect.type==='blocked'?{}:{
  ...(o.shown?.itemKeys ? {itemKeys:[...o.shown.itemKeys]} : {}),
  ...(o.shown?.modifiers ? {modifiers:[...o.shown.modifiers]} : {}),
  ...(o.shown?.amountCents===undefined?{}:{amountCents:o.shown.amountCents}),
  ...(o.shown?.deliveryDate===undefined?{}:{deliveryDate:o.shown.deliveryDate}),
  ...(o.shown?.deltaCents===undefined?{}:{deltaCents:o.shown.deltaCents}),
  }),
 }),answerable:o.effect.type!=='blocked'}));
}

/** DX-6: approval effectiveness and the roles still to decide are room-visible. */
export function projectPendingApprovalRoles(set: ApprovalSetResult): Role[] {
  return set.missingRoles.flatMap(role => ROLES.filter(knownRole => knownRole === role));
}

/** Customer-only derived scope projection (D11). */
export function projectNotIncludedForMe(viewer:Role, wanted:readonly string[], included:readonly string[]):string[]|null {
 return viewer==='customer' ? [...new Set(wanted)].filter(key=>!included.includes(key)) : null;
}
