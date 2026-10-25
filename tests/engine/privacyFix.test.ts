import { expect, it } from 'vitest';
import { privacy } from '../../core/engine';
const { projectForRole, projectSharedFacts, projectRequestOptions, projectEngineRequestOptions, DISCLOSURE, DECLASSIFIED, DECLASSIFIERS, ROLES } = privacy;
type Disclosures = privacy.Disclosures;
type Role = privacy.Role;
type SharedFact = privacy.SharedFact;
import { buildAgentContext, type AgentView } from '../../core/engine';
import { plugin } from './rules/fixture';
import { projectFixture } from './projectFixture';
import { projectPrivacyState } from './privacyPipeline';

const financeFields = plugin.fields.filter(f => f.owner === 'finance');
function fact(field: string, audience: Role[] = ['customer'], value: unknown = { kind: 'cents', cents: 100 }, seq = 1): SharedFact {
  return { fromRole: 'finance', field, audience, value, seq, briefVersion: seq };
}
for (const { key: field } of financeFields) for (const state of ['shared', 'not shared', 'withdrawn']) {
  it(`PV-05 ${field} visible to customer only via latest sharedFacts row (${state})`, () => {
    const rows = [fact(field, state === 'not shared' ? [] : ['customer'])];
    if (state === 'withdrawn') rows.push(fact(field, ['customer'], null, 2));
    const d = { plugin, sharedFacts: [...rows].reverse() };
    const result = projectForRole('customer', { family: 'budget', data: { [field]: 100 } }, d);
    expect(result?.[field]).toBe(state === 'shared' ? 100 : undefined);
    expect(projectForRole('customer', { family: 'budget', data: { [field]: 100 } }, { plugin, fields: [field] } as Disclosures)).toEqual({});
  });
}
it('PV-05 ownerRole = viewer cannot widen self fields', () => {
  for (const role of ROLES) for (const owner of ROLES.filter(r => r !== role)) for (const family of ['briefs', 'turns', 'attempts', 'approvals', 'humanRequests'] as const) {
    const data = { role: owner, toRole: owner, hardFields: projectFixture({ secret: 123 }), rationale: 'SECRET', move: projectFixture({ secret: 123 }), note: 'SECRET', options: [{ secret: 123 }] };
    const result = projectForRole(role, { family, data }, { plugin, ownerRole: role } as Disclosures);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|123/);
  }
});
it('DX-7 provider sees null briefVersion after open', () => {
  for (const roomStatus of ['open', 'executed', 'closed'] as const) for (const owner of ROLES) {
    const result = projectForRole('provider', { family: 'briefs', data: { role: owner, version: 2, confirmedAt: 99, confirmed: true } }, { roomStatus });
    expect(result).toMatchObject({ version: owner === 'provider' ? 2 : null, confirmedAt: owner === 'provider' ? 99 : null, confirmed: true });
  }
});
it('DX-7 provider sees briefVersion in setup', () => {
  expect(projectForRole('provider', { family: 'briefs', data: { role: 'finance', version: 2, confirmedAt: 99 } }, { roomStatus: 'setup' })).toMatchObject({ version: 2, confirmedAt: 99 });
  expect(projectForRole('customer', { family: 'briefs', data: { role: 'finance', version: 2, confirmedAt: 99 } }, { roomStatus: 'open' })).toMatchObject({ version: 2, confirmedAt: 99 });
});
it('TC-PRIV-21 customer- vs finance-caused re-confirm gives byte-identical provider projections', () => {
  const view = (changed: Role) => ROLES.map(role => projectForRole('provider', { family: 'briefs', data: { role, confirmed: true, version: role === changed ? 2 : 1, confirmedAt: role === changed ? 200 : 100 } }, { roomStatus: 'open' }));
  expect(JSON.stringify(view('customer'))).toBe(JSON.stringify(view('finance')));
});
const humanReasonKeys = [
  { key: 'terms_not_acceptable', audience: 'room' }, { key: 'scope_insufficient', audience: 'room' },
  { key: 'needs_earlier_delivery', audience: 'room' }, { key: 'other', audience: 'room' }, { key: 'over_our_limit', audience: 'buyers' },
] as const;
for (const { key: reasonKey, audience } of humanReasonKeys) for (const role of ROLES) it(`DX-6 ${reasonKey} seen by ${role}`, () => {
  expect(projectForRole(role, { family: 'approvals', data: { role: 'finance', reasonKey } }, { plugin: { ...plugin, humanReasonKeys } })).toEqual({ role: 'finance', reasonKey: role === 'provider' && audience === 'buyers' ? null : reasonKey });
  expect(projectForRole(role, { family: 'approvals', data: { reasonKey: 'UNKNOWN' } }, { plugin: { ...plugin, humanReasonKeys } })).toEqual({ reasonKey: null });
});
it('DX-6 defaults to human protocol room keys', () => {
  const protocolPlugin = { ...plugin, protocol: { ...plugin.protocol, reasonKeys: [{ reasonKey: 'human', usableBy: ['human'] }, { reasonKey: 'agent', usableBy: ['customer'] }] } };
  for (const reasonKey of ['human', 'agent']) expect(projectForRole('provider', { family: 'approvals', data: { reasonKey } }, { plugin: protocolPlugin })?.reasonKey).toBe(reasonKey === 'human' ? reasonKey : null);
});
for (const status of ['scheduled', 'running', 'completed', 'failed', 'stale', 'rejected_stale']) for (const who of ['owner', 'other']) it(`07-7.9.4 turn ${status} seen by ${who}`, () => {
  for (const owner of ROLES) for (const role of ROLES.filter(r => who === 'owner' ? r === owner : r !== owner)) {
    const result = projectForRole(role, { family: 'turns', data: { role: owner, status, currentAttemptNo: 2 } });
    expect(result).toMatchObject({ status: who === 'owner' ? status : ['scheduled', 'running'].includes(status) ? status : 'done', currentAttemptNo: who === 'owner' ? 2 : null });
    expect(DISCLOSURE.turns.status.transform(() => status, { viewer: role, owner, side: plugin.roles.find(r => r.role === role)!.side, humanReasonKeys: [] })).toBe(result?.status);
  }
});
it('DX-3 provider cannot tell a failed customer turn', () => {
  const view = (status: string) => projectForRole('provider', { family: 'turns', data: { role: 'customer', status, currentAttemptNo: status === 'failed' ? 2 : 1 } });
  expect(JSON.stringify(view('failed'))).toBe(JSON.stringify(view('completed')));
});
it('D12-7 provider run status is run_waiting', () => {
  expect(projectForRole('provider', { family: 'runs', data: { status: 'needs_input' } })).toEqual({ status: 'run_waiting' });
  expect(projectForRole('provider', { family: 'humanRequests', data: { toRole: 'finance', kind: 'agent_failed' } })).toEqual({ kind: 'run_waiting' });
});
for (const field of plugin.fields) for (const role of field.disclosableTo as Role[]) it(`07-7.8.4 ${field.owner}.${field.key} allowed to ${role}`, () => {
  const row: SharedFact = { fromRole: field.owner as Role, field: field.key, audience: [role], value: field.valueKind === 'cents' ? { kind: 'cents', cents: 100 } : field.valueKind === 'isoDate' ? { kind: 'date', date: '2026-11-20' } : { kind: 'itemKeys', itemKeys: ['audit'] }, briefVersion: 1, seq: 1 };
  expect(projectSharedFacts(role, [row], undefined, plugin)).toHaveLength(1);
  const denied = ROLES.find(r => r !== field.owner && !field.disclosableTo.includes(r));
  if (denied) expect(projectSharedFacts(denied, [{ ...row, audience: [denied] }], undefined, plugin)).toEqual([]);
  else expect(projectSharedFacts(role, [{ ...row, audience: [] }], undefined, plugin)).toEqual([]);
});
it('07-7.8.4 preferredDate not shareable', () => {
  expect(projectSharedFacts('provider', [{ ...fact('preferredDate', ['provider']), fromRole: 'customer' }], undefined, plugin)).toEqual([]);
  expect(() => projectRequestOptions('customer', [{ optionKey: 'A', templateKey: 'disclose', effect: { type: 'disclose', field: 'preferredDate', toRoles: ['provider'] } }], projectFixture({ role: 'customer' }), plugin)).toThrow();
});
it('D12-4 finance budget never reaches provider', () => {
  expect(projectSharedFacts('provider', financeFields.map(f => fact(f.key, ['provider'])), undefined, plugin)).toEqual([]);
  expect(projectForRole('provider', { family: 'budget', data: { capCents: 100 } }, { plugin, sharedFacts: [fact('capCents', ['provider'])] })).toBeUndefined();
});
for (const role of ROLES) it(`D12-3 context omits option_fits_constraints for ${role}`, () => {
  const context = projectPrivacyState(role).context;
  expect((context.protocol as { clarifyTopics: string[] }).clarifyTopics).toEqual(['deadline_value']);
});
it('TC-PRIV-04 agent context excludes every §7.14.1 exclusion', () => {
  const excluded = ['briefs', 'disclosures', 'turns', 'rationale', 'reasonKey', 'candidateSnapshot', 'note', 'displayName', 'title', 'userId', 'tokenIdentifier', 'email', 'invites', 'attempts', 'attemptNo', 'stopReason', 'usage', 'rawOutput', 'rawOutputRef', 'rawOutputs', 'events', 'humanRequests'];
  for (const role of ROLES) {
    const poison = Object.fromEntries([...excluded, 'secret'].map(key => [key, 'EXCLUDED']));
    const projected = <T extends object>(allowed: T) => projectFixture({ ...poison, ...allowed });
    const view: AgentView = {
      ...poison, role,
      protocol: projected({ role, clarifyTopics: ['deadline_value'] }),
      principal: projected({ briefVersion: 1, hard: projectFixture({}), soft: projectFixture({}), notes: 'Own note', ownApprovalNotes: [] }),
      sharedFacts: [projected({ fromRole: 'customer', field: 'requiredItemKeys', value: projectFixture({ kind: 'itemKeys', itemKeys: ['audit'] }), asOfBriefVersion: 1 })],
      budget: projected({ capCents: 100, committedCents: 40, headroomCents: 60, minAllowedCapCents: 40 }),
      catalog: [{ ...poison, itemKey: 'audit', kind: 'item', priceCents: 100, leadDays: 1, title: 'Safe catalog', status: 'confirmed' }, { itemKey: 'draft', kind: 'item', priceCents: 100, leadDays: 1, title: 'EXCLUDED', status: 'draft' }],
      currentProposal: projected({ version: 1, terms: projectFixture({ itemKeys: ['audit'] }), fit: 'ok' }),
      recentProposals: [projected({ version: 1, status: 'superseded', itemKeys: ['audit'], amountCents: 100 })],
      feedback: { ...poison, proposalVersion: 1, outcome: 'blocked' },
      candidates: [projected({ optionKey: 'O1', candidateKey: 'audit', itemKeys: ['audit'], modifiers: [], amountCents: 100, deliveryDate: '2026-11-20' })],
      openRequestForMe: projected({ kind: 'infeasible', toRole: role, status: 'open', options: [projected({ optionKey: 'A', templateKey: 'end_run' })] }),
    };
    const context = buildAgentContext(role, view, plugin);
    expect(JSON.stringify(context)).not.toContain('EXCLUDED');
    expect(projectPrivacyState(role).context.catalog.every(row => !('status' in row))).toBe(true);
    if (role === 'provider') expect(projectPrivacyState(role).context).not.toHaveProperty('budget');
  }
  for (const key of ['status', 'attemptNo', 'stopReason'] as const) expect((DISCLOSURE.attempts as Record<string, import('../../core/engine').privacy.FieldRule>)[key]!.agent).toBe('never');
});
it('TC-PRIV-05 Object.keys(DECLASSIFIERS) equals DECLASSIFIED', () => {
  expect(Object.keys(DECLASSIFIERS)).toEqual(DECLASSIFIED);
  expect(DECLASSIFIED).toEqual(Array.from({ length: 13 }, (_, i) => `DX-${i + 1}`));
});
const dxExamples = {
  'DX-1': [{ view: { proposal: { fit: 'blocked' } }, context: { feedback: { outcome: 'blocked' } } }, ['blocked', 'blocked']],
  'DX-2': [{ view: { run: { status: 'run_waiting' } } }, ['run_waiting']],
  'DX-3': [{ view: { request: { kind: 'run_waiting' } } }, ['run_waiting', undefined]],
  'DX-4': [{ view: { run: { roundNo: 2 } } }, [2]],
  'DX-5': [{ view: { room: { constraintsVersion: 3 } } }, [3]],
  'DX-6': [{ view: { approvals: [{ role: 'finance', decision: 'reject', boundConstraintsVersion: 3, boundTermsKey: 'terms', reasonKey: null, note: 'SECRET' }] } }, [['finance'], ['reject'], [3], ['terms'], [null]]],
  'DX-7': [{ view: { briefs: [{ role: 'finance', confirmed: true, version: null, confirmedAt: null, hardFields: 'SECRET' }] } }, [['finance'], [true], [null], [null]]],
  'DX-8': [{ view: { run: { endedReason: 'room_closed' } } }, ['room_closed']],
  'DX-9': [{ counter: { private: 'SECRET' } }, []],
  'DX-10': [{ view: { changeOrder: { number: 1, deltaCents: 100, baselineCents: 'SECRET' }, execution: { amountCents: 100 } } }, [1, 100, 100, undefined]],
  'DX-11': [{ view: { ownTurn: { result: { counterForwarded: true } } }, context: { feedback: { outcome: 'countered' } } }, [true, 'countered']],
  'DX-12': [{ answer: { status: 'regenerated', capCents: 'SECRET' } }, ['regenerated']],
  'DX-13': [{ context: { forwardedCandidate: { optionKey: 'O4', terms: 'PUBLIC', private: 'SECRET' } } }, ['O4', 'PUBLIC']],
} as const;
for (const dx of DECLASSIFIED) it(`TC-PRIV-05 ${dx} extractor`, () => {
  const [boundary, expected] = dxExamples[dx];
  expect(DECLASSIFIERS[dx].extract(boundary)).toEqual(expected);
  expect(JSON.stringify(DECLASSIFIERS[dx].extract(boundary))).not.toContain('SECRET');
});
it('07-7.8.4 budget keys and disclose options come from plugin semantics', () => {
  const renamed = { ...plugin, fields: plugin.fields.map(field => ({ ...field, key: `custom_${field.key}` })) };
  const data = { custom_capCents: 100, custom_committedCents: 40, custom_headroomCents: 60, capCents: 999, overByCents: 5 };
  expect(projectForRole('finance', { family: 'budget', data }, { plugin: renamed })).toEqual({ custom_capCents: 100, custom_committedCents: 40, custom_headroomCents: 60, overByCents: 5 });
  const rows = [fact('custom_capCents'), fact('custom_committedCents', ['customer'], { kind: 'cents', cents: 40 })];
  expect(projectForRole('customer', { family: 'budget', data }, { plugin: renamed, sharedFacts: rows })).toEqual({ custom_capCents: 100, custom_committedCents: 40, custom_headroomCents: 60 });
  const options = projectRequestOptions('finance', [{ optionKey: 'A', templateKey: 'disclose', effect: { type: 'disclose', field: 'custom_capCents', toRoles: ['customer'] } }], projectFixture({ role: 'finance' }), renamed);
  expect(options[0]?.effect).toEqual({ type: 'disclose', field: 'custom_capCents', toRoles: ['customer'] });
});
it('07-7.8.4 budgetOwner determines the budget audience', () => {
  const moved: import('../../core/engine').privacy.DisclosurePlugin = {
    ...plugin,
    roles: plugin.roles.map(role => ({ ...role, approvalKind: role.role === 'customer' ? 'budget' : 'terms', budgetOwner: role.role === 'customer' ? true : undefined })),
    fields: plugin.fields.map(field => field.semantic ? { ...field, owner: 'customer', disclosableTo: ['finance'] } : field),
  };
  const dto = { family: 'budget' as const, data: { capCents: 100, committedCents: 40, headroomCents: 60 } };
  expect(projectForRole('customer', dto, { plugin: moved })).toEqual(dto.data);
  expect(projectForRole('finance', dto, { plugin: moved })).toEqual({});
});

it('i01 caller-level humanReasonKeys cannot widen a buyers-only key', () => {
  const disclosures = { plugin: { ...plugin, humanReasonKeys }, humanReasonKeys: [{ key: 'over_our_limit', audience: 'room' }] } as Disclosures;
  expect(projectForRole('provider', { family: 'approvals', data: { role: 'finance', reasonKey: 'over_our_limit' } }, disclosures)?.reasonKey).toBeNull();
});

it('r02 shared fact kinds must match their declaration', () => {
  for (const field of plugin.fields) for (const value of [{ kind: 'cents', cents: 100 }, { kind: 'date', date: '2026-11-20' }, { kind: 'itemKeys', itemKeys: ['audit'] }]) {
    const row = { fromRole: field.owner as Role, field: field.key, audience: [field.disclosableTo[0] as Role], value, briefVersion: 1, seq: 1 };
    const run = () => projectSharedFacts(row.audience[0]!, [row], undefined, plugin);
    const expected = field.valueKind === 'isoDate' ? 'date' : field.valueKind;
    if (value.kind === expected) expect(run()).toHaveLength(1);
    else expect(run).toThrow('kind does not match');
  }
});
it('i10 declared disclosableTo independently denies a buyer named in the row', () => {
  const custom = { ...plugin, fields: [{ key: 'buyerSelection', owner: 'customer', class: 'hard' as const, valueKind: 'itemKeys' as const, disclosableTo: ['provider'] }] };
  const row: SharedFact = { fromRole: 'customer', field: 'buyerSelection', audience: ['provider', 'finance'], value: { kind: 'itemKeys', itemKeys: ['audit'] }, briefVersion: 1, seq: 1 };
  expect(projectSharedFacts('provider', [row], undefined, custom)).toHaveLength(1);
  expect(projectSharedFacts('finance', [row], undefined, custom)).toEqual([]);
});
it('r03 engine disclose options reject seller, unknown and empty audiences', () => {
  const make = (toRoles: string[]) => projectEngineRequestOptions('finance', [{ optionKey: 'A', templateKey: 'disclose', effect: { kind: 'disclose', field: 'capCents', toRoles }, shown: {} }], projectFixture({ role: 'finance' }), plugin);
  expect(make(['customer'])[0]?.effect).toEqual({ kind: 'disclose', field: 'capCents', toRoles: ['customer'] });
  for (const roles of [['provider'], ['customer', 'provider'], ['UNKNOWN'], []]) expect(() => make(roles)).toThrow('audience not allowed');
});
it('i02 non-owner budget values come from shared rows, never a newer raw DTO', () => {
  const raw = { capCents: 900, committedCents: 800, headroomCents: 100, overByCents: 666 };
  const sharedFacts = [fact('capCents', ['customer'], { kind: 'cents', cents: 100 }), fact('committedCents', ['customer'], { kind: 'cents', cents: 40 })];
  expect(projectForRole('customer', { family: 'budget', data: raw }, { plugin, sharedFacts })).toEqual({ capCents: 100, committedCents: 40, headroomCents: 60 });
  expect(projectForRole('finance', { family: 'budget', data: raw }, { plugin, sharedFacts })).toEqual(raw);
  expect(projectForRole('customer', { family: 'budget', data: new Proxy({}, { get() { throw new Error('Non-owner read raw budget'); } }) }, { plugin, sharedFacts })).toEqual({ capCents: 100, committedCents: 40, headroomCents: 60 });
});
it('i07 XP-3 masks non-owner timing and round metadata on their rules', () => {
  for (const owner of ROLES) for (const viewer of ROLES) {
    const result = projectForRole(viewer, { family: 'turns', data: { role: owner, roundNo: 2, createdAt: 100, completedAt: 200 } }, { plugin });
    expect(result).toMatchObject(viewer === owner ? { roundNo: 2, createdAt: 100, completedAt: 200 } : { roundNo: null, createdAt: null, completedAt: null });
  }
});
it('i08 i12 one plugin seller set governs checks, requests, run status and context', () => {
  const swapped = { ...plugin, roles: plugin.roles.map(r => ({ ...r, side: r.role === 'customer' ? 'seller' as const : 'buyer' as const })) };
  const dto = { family: 'humanRequests' as const, data: { toRole: 'finance', kind: 'infeasible', status: 'open', id: 'request', expiresAt: 100 } };
  expect(projectForRole('customer', dto, { plugin: swapped })).toEqual({ kind: 'run_waiting' });
  expect(projectForRole('provider', dto, { plugin: swapped })).toEqual({ kind: 'infeasible', toRole: 'finance' });
  expect(projectForRole('finance', dto, { plugin: swapped })).toMatchObject(dto.data);
  expect(projectForRole('customer', { family: 'runs', data: { status: 'needs_input' } }, { plugin: swapped })).toEqual({ status: 'run_waiting' });
  expect(projectForRole('provider', { family: 'runs', data: { status: 'needs_input' } }, { plugin: swapped })).toEqual({ status: 'needs_input' });
  const data = { status: 'active', checks: [] };
  expect(projectForRole('customer', { family: 'proposals', data }, { plugin: swapped })).not.toHaveProperty('checks');
  expect(projectForRole('provider', { family: 'proposals', data }, { plugin: swapped })).toHaveProperty('checks');
  const view: AgentView = { role: 'customer', protocol: projectFixture({}), principal: projectFixture({}), sharedFacts: [], budget: projectFixture({ capCents: 100 }), catalog: [], currentProposal: projectFixture({ version: 1, fit: 'ok', checks: projectFixture({ kind: 'checks' }) }), recentProposals: [], feedback: null, candidates: [], openRequestForMe: null };
  const context = buildAgentContext('customer', view, swapped);
  expect(context).not.toHaveProperty('budget');
  expect(context.currentProposal).not.toHaveProperty('checks');
});
it('r04 missing brief metadata stays absent and masked values are never read', () => {
  expect(projectForRole('provider', { family: 'briefs', data: { role: 'finance' } }, { plugin, roomStatus: 'open' })).toEqual({ role: 'finance' });
  const data = { role: 'finance', get version(): never { throw new Error('Masked metadata read'); } };
  expect(projectForRole('provider', { family: 'briefs', data }, { plugin, roomStatus: 'open' })).toEqual({ role: 'finance', version: null });
});
it('merge W1-7 disclose wire projection preserves only declared recipient roles', () => {
  const view = projectFixture({ role: 'finance' as const });
  const make = (toRoles: readonly Role[]) => projectRequestOptions('finance', [{ optionKey: 'A', templateKey: 'disclose', effect: { type: 'disclose', field: 'capCents', toRoles } }], view, plugin);
  expect(make(['customer'])[0]?.effect).toEqual({ type: 'disclose', field: 'capCents', toRoles: ['customer'] });
  for (const recipients of [['provider'], ['customer', 'provider'], ['UNKNOWN'], []]) expect(() => make(recipients as Role[])).toThrow('Disclose audience not allowed');
});
