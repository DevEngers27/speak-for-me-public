import { describe, expect, it } from 'vitest';
import { cents } from '../../../core/engine/money';
import type { Cents } from '../../../core/engine/money';
import { addDays, isoDate } from '../../../core/engine/dates';
import { defineScenario } from '../../../core/engine/plugin';
import type { ScenarioPlugin } from '../../../core/engine/plugin';
import { checkProposal, materializeTerms, staleSource, projectEvaluation, viewFor, hardProjection, enumerateCandidates, isExecutable, validateCapChange, checkBudget, latestDecisionsByUser, evaluateApprovalSet, buildHumanRequests, PluginContractError } from '../../../core/engine/rules';
import type { CandidateDraft, RequestOption, View } from '../../../core/engine/rules';
import { input, plugin, proposal, type Input } from './fixture';

const opts = { mode: 'snapshot' as const, limit: 12, anchor: true, exclude: [], mustInclude: [] };
// A complete test candidate space, independent of the two-draft smoke fixture.
const exhaustive: ScenarioPlugin<Input> = { ...plugin, candidateSpace: i => {
  const rows = i.catalog.filter(r => r.kind === 'item' && r.status === 'confirmed');
  if (i.requiredItemKeys?.some(k => !rows.some(r => r.itemKey === k))) return { drafts: [], emptyReasons: ['item.required_missing'] };
  const drafts: CandidateDraft[] = [];
  for (let bits = 1; bits < 2 ** rows.length; bits++) {
    const itemKeys = rows.filter((_, n) => bits & (1 << n)).map(r => r.itemKey).sort();
    if (i.requiredItemKeys?.some(k => !itemKeys.includes(k))) continue;
    const base = plugin.materialize({ itemKeys, modifiers: [] }, i.catalog, i.localDate)!;
    drafts.push({ itemKeys, modifiers: [] });
    if (!i.deadline || base.terms.deliveryDate > i.deadline) for (const m of i.catalog.filter(r => r.kind === 'modifier' && r.status === 'confirmed')) drafts.push({ itemKeys, modifiers: [m.itemKey] });
  }
  return { drafts, emptyReasons: [] };
} };

describe('r01/r02: structural validation', () => {
  it('rejects the same key in both lists in both entry points', () => {
    const p = proposal(); p.terms.modifiers = ['sso_login'];
    expect(checkProposal(plugin, input, p)).toMatchObject({ terms: null, blocking: ['item.duplicate'] });
    expect(() => materializeTerms({ itemKeys: ['sso_login'], modifiers: ['sso_login'] }, input.catalog, input.localDate, () => 1)).toThrow(new PluginContractError('invalid_candidate'));
  });
  it.each(['item', 'modifier'])('validates %s kind independently', kind => {
    const d = kind === 'item' ? { itemKeys: ['rush'], modifiers: [] } : { itemKeys: ['sso_login'], modifiers: ['audit_log_export'] };
    const p = proposal(); p.terms.itemKeys = d.itemKeys; p.terms.modifiers = d.modifiers;
    expect(checkProposal(plugin, input, p).blocking).toContain('item.unknown');
    expect(() => plugin.materialize(d, input.catalog, input.localDate)).toThrow('invalid_candidate');
  });
  it.each(['itemKeys', 'modifiers'] as const)('non-array %s returns structural failure', field => {
    for (const bad of [null, undefined, 42, {}, 'sso_login']) {
      const p = proposal(); Object.assign(p.terms, { [field]: bad });
      const r = checkProposal(plugin, input, p);
      expect(r.terms).toBeNull(); expect(r.blocking).toContain('item.unknown');
    }
  });
  it.each(['Invalid Key', 'a', 'bad+key', 'a'.repeat(41)])('non-slug %s is unknown', key => {
    const p = proposal(); p.terms.itemKeys = [key];
    const r = checkProposal(plugin, input, p);
    expect(r.blocking).toContain('item.unknown'); expect(r.blocking).not.toContain('item.duplicate');
  });
  it.each([0, 1])('empty/truncated lines (%s) cannot pass source_current', length => {
    const p = proposal(); p.lines = p.lines.slice(0, length);
    expect(staleSource(p, input.catalog)).toMatchObject({ ok: false, code: 'version.stale_source' });
    const r = checkProposal(plugin, input, p);
    expect(r.checks.find(c => c.checkId === 'source_current')?.status).toBe('fail'); expect(r.terms).toBeNull();
  });
  it.each(['retired', 'line_price', 'claim'])('null terms for %s integrity failure', kind => {
    const p = proposal(); let i = input;
    if (kind === 'retired') i = { ...i, catalog: i.catalog.map(r => ({ ...r, status: 'retired' })) };
    if (kind === 'line_price') p.lines[0]!.priceCents = 1.5 as Cents;
    if (kind === 'claim') p.terms.amountCents = cents(1);
    expect(checkProposal(plugin, i, p).terms).toBeNull();
  });
});

describe('r05: projection contract', () => {
  it('rejects unknown viewers in both projection functions', () => {
    expect(() => viewFor(plugin, input, {}, 'unknown')).toThrow('unknown_viewer');
    expect(() => projectEvaluation(checkProposal(plugin, input, proposal()), 'unknown', plugin, {})).toThrow('unknown_viewer');
  });
  it.each(['duplicate', 'invalid_date', 'date_window', 'amount'])('public %s parameters survive for buyers only', kind => {
    const p = proposal();
    if (kind === 'duplicate') p.terms.itemKeys.push('sso_login');
    if (kind === 'invalid_date') p.terms.deliveryDate = 'invalid' as typeof p.terms.deliveryDate;
    if (kind === 'date_window') p.terms.deliveryDate = addDays(input.localDate, 366);
    if (kind === 'amount') p.terms.amountCents = -1 as Cents;
    const ev = checkProposal(plugin, input, p);
    for (const role of ['customer', 'finance']) {
      const projected = projectEvaluation(ev, role, plugin, {});
      if (projected.audience !== 'buyer') throw new Error('expected buyer');
      const check = projected.checks.find(c => c.checkId === (kind === 'date_window' ? 'date_window' : 'terms_shape'))!;
      expect(check.params).toEqual(ev.checks.find(c => c.checkId === check.checkId)!.params);
      expect(Object.keys(check.params).length).toBeGreaterThan(0);
    }
    expect(projectEvaluation(ev, 'provider', plugin, {})).toEqual({ audience: 'provider', fit: 'blocked' });
  });
  it('private owner-only params remain private', () => {
    const ev = checkProposal(plugin, { ...input, capCents: cents(399999) }, proposal());
    const projected = projectEvaluation(ev, 'customer', plugin, { headroomCents: ['customer'] });
    if (projected.audience !== 'buyer') throw new Error('expected buyer');
    expect(projected.checks.find(c => c.checkId === 'budget_state')?.params).toEqual({});
  });
});

it('T06-P4: equal hard projection implies equal blocking and feasibility across 2000 input pairs', () => {
  const candidates = exhaustive.candidateSpace({ ...input, requiredItemKeys: [], deadline: undefined }).drafts.map(d => plugin.materialize(d, input.catalog, input.localDate)!);
  let blocked = 0;
  for (let n = 0; n < 2000; n++) {
    const a: View<Input> = { ...input, capCents: cents(470000 + n % 4 * 10000), deadline: addDays(input.localDate, 10 + n % 25) };
    const b = { ...a, catalog: [...a.catalog].reverse().map(r => ({ ...r, title: `edit${n}`, taskTemplates: [], provenance: n % 2 ? 'live' as const : 'stub' as const })), requiredItemKeys: [...a.requiredItemKeys!].reverse(), softFields: { note: `${n}` }, disclosures: { capCents: ['customer'] } };
    expect(hardProjection(plugin, a)).toBe(hardProjection(plugin, b));
    for (const p of candidates) {
      const blocks = checkProposal(plugin, a, p).blocking;
      if (blocks.length) blocked++;
      expect(checkProposal(plugin, b, p).blocking).toEqual(blocks);
    }
    const oa = enumerateCandidates(exhaustive, a, { ...opts, mode: 'feasibility' });
    const ob = enumerateCandidates(exhaustive, b, { ...opts, mode: 'feasibility' });
    // Titles/tasks are snapshots rather than rule outputs, so compare candidate identities/terms.
    expect(ob.items).toEqual(oa.items);
    expect(ob.emptyReasons).toEqual(oa.emptyReasons);
  }
  expect(blocked).toBeGreaterThan(0);
}, 30_000); // Preserve all 2,000 pairs on shared CI/worktree runners.
it('setting the same cap through validation preserves projection', () => {
  const cap = cents(Number(input.capCents));
  expect(validateCapChange(cap, input.committedCents!)).toEqual({ ok: true });
  expect(hardProjection(plugin, { ...input, capCents: cap })).toBe(hardProjection(plugin, input));
});
it('CE-053: a cv1 proposal executes when all current checks and cv3 approvals pass', () => {
  const p = { ...proposal(), _id: 'p', status: 'active', createdAtConstraintsVersion: 1 };
  const room = { status: 'open', currentRunId: 'r', constraintsVersion: 3 };
  const r = isExecutable(plugin, { room, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'p' }, proposal: p, input });
  expect(r.ok).toBe(true);
  const required = plugin.roles.map(r => ({ role: r.role, kind: r.approvalKind }));
  // Creation cv is deliberately unrelated to binding cv.
  const rows = required.map((r, n) => ({ ...r, id: `a${n}`, userId: r.role, seq: 1, decision: 'approve' as const, boundConstraintsVersion: 3, boundTermsKey: p.termsKey }));
  expect(evaluateApprovalSet({ required, members: required.map(r => ({ role: r.role, userId: r.role })), rows, roomConstraintsVersion: 3, termsKey: p.termsKey }).complete).toBe(true);
});

it('14 §12 full-scope parameters and variants D/E/F arithmetic', () => {
  const full = proposal(input.catalog.filter(r => r.kind === 'item').map(r => r.itemKey));
  const ev = checkProposal(plugin, input, full);
  expect(ev.checks.find(c => c.code === 'date.after_deadline')?.params).toMatchObject({ daysLate: 14 });
  expect(ev.checks.find(c => c.code === 'budget.over')?.params).toMatchObject({ overByCents: 40000 });
  expect(proposal(['sso_login']).terms).toMatchObject({ amountCents: 50000, deliveryDate: '2026-11-13' });
  expect(proposal(['sso_login', 'usage_dashboard']).terms).toMatchObject({ amountCents: 60000, deliveryDate: '2026-11-18' });
  for (const [modifiers, date] of [[[], '2026-12-03'], [['rush'], '2026-11-29']] as const) expect(plugin.materialize({ itemKeys: ['audit_log_export', 'sso_login'], modifiers: [...modifiers] }, input.catalog, isoDate('2026-11-19'))?.terms.deliveryDate).toBe(date);
  const p = proposal(['audit_log_export', 'sso_login', 'usage_dashboard']);
  const odd = { ...input, committedCents: cents(400219), capCents: cents(512347), headroomCents: 112128 };
  expect(checkProposal(plugin, odd, p).blocking).toEqual([]);
  expect(checkProposal(plugin, { ...odd, capCents: cents(481237), headroomCents: 81018 }, p).checks.find(c => c.code === 'budget.over')?.params.overByCents).toBe(8982);
  expect(checkProposal(plugin, { ...odd, capCents: cents(481237), headroomCents: 81018 }, proposal()).amounts).toMatchObject({ committedAfterCents: 480219, headroomCents: 81018 });
  expect(481237 - checkProposal(plugin, odd, proposal()).amounts.committedAfterCents!).toBe(1018);
});

describe('r04: candidate enumeration branches', () => {
  it('anchor puts the cheapest ahead of the lexicographically first candidate', () => {
    const i = { ...input, requiredItemKeys: [], deadline: undefined, catalog: input.catalog.map(r => ({ ...r, priceCents: cents(r.itemKey === 'sso_login' ? 1 : r.priceCents) })) };
    const p = { ...plugin, candidateSpace: () => ({ drafts: [{ itemKeys: ['audit_log_export'], modifiers: [] }, { itemKeys: ['sso_login'], modifiers: [] }], emptyReasons: [] }) };
    expect(enumerateCandidates(p, i, opts).items.map(i => i.candidateKey)).toEqual(['sso_login', 'audit_log_export']);
    expect(enumerateCandidates(p, i, { ...opts, anchor: false }).items.map(i => i.candidateKey)).toEqual(['audit_log_export', 'sso_login']);
  });
  it('mustInclude retains a more expensive candidate despite truncation', () => {
    const key = proposal(['audit_log_export', 'sso_login', 'usage_dashboard']).candidateKey;
    expect(enumerateCandidates(plugin, input, { ...opts, anchor: false, limit: 1, mustInclude: [key, key, 'absent'] }).items.map(i => i.candidateKey)).toEqual([key]);
    expect(() => enumerateCandidates(plugin, input, { ...opts, limit: 1, mustInclude: [key] })).toThrow('must_include_exceeds_limit');
  });
  it('16 candidates truncate to the 14 §11 F golden snapshot', () => {
    const i = viewFor(exhaustive, input, { requiredItemKeys: ['provider'] }, 'provider');
    expect(enumerateCandidates(exhaustive, i, { ...opts, mode: 'feasibility' }).items).toHaveLength(16);
    expect(enumerateCandidates(exhaustive, i, opts).items.map(i => i.candidateKey)).toEqual([
      'audit_log_export+sso_login',
      'audit_log_export+custom_theme+slack_alerts+sso_login',
      'audit_log_export+custom_theme+sso_login',
      'audit_log_export+custom_theme+sso_login+usage_dashboard',
      'audit_log_export+custom_theme+sso_login+usage_dashboard@rush',
      'audit_log_export+custom_theme+sso_login@rush',
      'audit_log_export+slack_alerts+sso_login',
      'audit_log_export+slack_alerts+sso_login+usage_dashboard',
      'audit_log_export+slack_alerts+sso_login@rush',
      'audit_log_export+sso_login+usage_dashboard',
      'audit_log_export+sso_login+usage_dashboard@rush',
      'audit_log_export+sso_login@rush',
    ]);
  });
  it('retired required item yields the declared empty reason', () => {
    const i = { ...input, catalog: input.catalog.map(r => r.itemKey === 'audit_log_export' ? { ...r, status: 'retired' as const } : r) };
    expect(enumerateCandidates(exhaustive, i, opts)).toEqual({ items: [], materialized: [], emptyReasons: ['item.required_missing'] });
  });
  it('deduplicates drafts, skips overflow, and filters blocked candidates', () => {
    const drafts = exhaustive.candidateSpace({ ...input, deadline: undefined }).drafts;
    const p = { ...exhaustive, candidateSpace: () => ({ drafts: [...drafts, ...drafts], emptyReasons: [] }) };
    const r = enumerateCandidates(p, input, { ...opts, mode: 'feasibility' });
    expect(r.items.map(i => i.amountCents)).toEqual([80000, 90000, 95000]);
    expect(enumerateCandidates({ ...p, materialize: () => null }, input, opts).items).toEqual([]);
  });
  it.each([0, 13, 1.5])('rejects invalid candidate limit %s', limit => expect(() => enumerateCandidates(plugin, input, { ...opts, limit })).toThrow('invalid_limit'));
});

const option = (effect: RequestOption['effect'], shown: RequestOption['shown'] = {}): RequestOption => ({ optionKey: 'plugin_key', templateKey: effect.kind, effect, shown });
const run = { excludedCandidateKeys: [], providerExcludedCandidateKeys: [], keepAsIsUsed: false, openRequestCount: 0, canContinue: true };
const request = (p: ScenarioPlugin<Input>, i: View<Input>, disclosures: Record<string, string[]> = {}) => ({ kind: 'infeasible' as const, full: i, viewOf: (role: string) => viewFor(p, i, disclosures, role), run, disclosures });
describe('r04: human request branches', () => {
  it('skips a feasible buyer and asks budget owner with raise-cap options', () => {
    const i = { ...input, capCents: cents(470000), headroomCents: 70000 };
    const p = { ...exhaustive, relaxations: (role: string) => role === 'finance' ? [option({ kind: 'raise_cap', amountCents: cents(480000) }), option({ kind: 'raise_cap', amountCents: cents(490000) })] : [] };
    const r = buildHumanRequests(p, request(p, i, { requiredItemKeys: ['finance'], deadline: ['finance'] }));
    expect(r.toRole).toBe('finance');
    expect(r.options.map(o => o.effect)).toEqual([{ kind: 'raise_cap', amountCents: 480000 }, { kind: 'raise_cap', amountCents: 490000 }, { kind: 'end_run' }]);
    expect(r.options.map(o => o.optionKey)).toEqual(['A', 'B', 'C']);
  });
  it('asks the scope owner to drop a retired required item', () => {
    const i = { ...input, catalog: input.catalog.map(r => r.itemKey === 'audit_log_export' ? { ...r, status: 'retired' as const } : r) };
    const p = { ...exhaustive, relaxations: (role: string) => role === 'customer' ? [option({ kind: 'drop_items', itemKeys: ['audit_log_export'] })] : [] };
    const r = buildHumanRequests(p, request(p, i));
    expect(r.toRole).toBe('customer'); expect(r.options.map(o => o.effect.kind)).toEqual(['drop_items', 'pass_to_next', 'end_run']);
  });
  it('falls back to disclosure when each individual view is feasible', () => {
    const i = { ...input, deadline: isoDate('2026-11-15'), capCents: cents(480000), headroomCents: 80000 };
    expect(enumerateCandidates(exhaustive, i, opts).items).toHaveLength(0);
    const r = buildHumanRequests(exhaustive, request(exhaustive, i, { requiredItemKeys: ['finance'] }));
    expect(r.toRole).toBe('customer');
    expect(r.options.map(o => o.effect)).toEqual([{ kind: 'disclose', field: 'deadline', toRoles: ['finance'] }, { kind: 'pass_to_next', toRole: 'finance' }, { kind: 'end_run' }]);
  });
  it('infeasible escalation uses the relaxation owner rather than the suggested role', () => {
    const i = { ...input, deadline: isoDate('2026-11-01'), capCents: cents(470000), headroomCents: 70000 };
    const p = { ...exhaustive, relaxations: (role: string) => [option(role === 'finance' ? { kind: 'raise_cap', amountCents: cents(480000) } : { kind: 'extend_deadline', date: isoDate('2026-11-16') })] };
    const x = request(p, i, { requiredItemKeys: ['finance'] });
    expect(buildHumanRequests(p, { ...x, kind: 'agent_escalated', run: { ...run, escalation: { kind: 'infeasible', toRole: 'finance' } } }).toRole).toBe('customer');
    const feasibleBudget = { ...i, capCents: cents(500000), headroomCents: 100000 };
    expect(buildHumanRequests(p, { ...request(p, feasibleBudget, { requiredItemKeys: ['finance'] }), kind: 'agent_escalated', run: { ...run, escalation: { kind: 'infeasible', toRole: 'finance' } } }).toRole).toBe('customer');
  });
  it.each([false, true])('rounds exhausted respects keepAsIsUsed=%s and excludes failed choices', keepAsIsUsed => {
    const excluded = proposal().candidateKey;
    const p: ScenarioPlugin<Input> = { ...exhaustive, relaxations: (_role, view, ctx) => enumerateCandidates(exhaustive, view, { ...opts, mode: 'feasibility', exclude: ctx.excludedCandidateKeys }).items.slice(0, 3).map(m => option({ kind: 'choose_candidate', candidateKey: m.candidateKey }, { amountCents: m.amountCents, deliveryDate: m.deliveryDate })) };
    const x = { ...request(p, input), kind: 'rounds_exhausted' as const, run: { ...run, excludedCandidateKeys: [excluded], keepAsIsUsed } };
    const r = buildHumanRequests(p, x);
    expect(r.options.some(o => o.effect.kind === 'keep_as_is')).toBe(!keepAsIsUsed);
    expect(r.options.filter(o => o.effect.kind === 'choose_candidate').length).toBeGreaterThan(0);
    expect(r.options.some(o => o.effect.kind === 'choose_candidate' && o.effect.candidateKey === excluded)).toBe(false);
    const escalated = buildHumanRequests(p, { ...x, kind: 'agent_escalated', run: { ...x.run, escalation: { kind: 'needs_tradeoff', toRole: 'customer' } } });
    expect(escalated.options.some(o => o.effect.kind === 'keep_as_is')).toBe(true);
  });
  it('requires escalation data and permits agent_failed without a relaxation order', () => {
    expect(() => buildHumanRequests(plugin, { ...request(plugin, input), kind: 'agent_escalated' })).toThrow('missing_escalation');
    const p = { ...plugin, relaxationOrder: [] };
    expect(buildHumanRequests(p, { ...request(p, input), kind: 'agent_failed', run: { ...run, failedRole: 'provider' } }).options.map(o => o.effect.kind)).toEqual(['retry_turn', 'end_run']);
  });
});

describe('r06/r07: cheap validation fixes', () => {
  it.each(['empty_order', 'catalog_owner', 'multiple_owners', 'topic_role', 'seller_probe', 'reason_role'])('rejects invalid %s declaration', kind => {
    const p = { ...plugin };
    if (kind === 'empty_order') p.relaxationOrder = [];
    if (kind === 'catalog_owner') p.catalog = { ...p.catalog, ownerRole: 'absent' };
    if (kind === 'multiple_owners') { p.fields = []; p.roles = p.roles.map(r => ({ ...r, budgetOwner: true, approvalKind: 'budget' })); }
    if (kind === 'topic_role') p.protocol = { ...p.protocol, topics: [{ topicKey: 'status', toRole: 'absent', askableBy: ['customer'], field: 'deadline', answer: 'human', questionTemplateKey: 'request.clarify.deadline_value' }] };
    if (kind === 'seller_probe') p.protocol = { ...p.protocol, topics: [{ topicKey: 'option_fits_constraints', toRole: 'finance', askableBy: ['customer'], field: 'headroomCents', answer: 'human', questionTemplateKey: 'request.clarify.budget_room' }] };
    if (kind === 'reason_role') p.protocol = { ...p.protocol, reasonKeys: [{ reasonKey: 'no', usableBy: ['absent'] }] };
    expect(() => defineScenario(p)).toThrow();
  });
  it.each(['amountCents', 'capCents', 'committedCents'] as const)('budget reports invalid %s', field => {
    const x = { amountCents: cents(1), capCents: cents(10), committedCents: cents(1), [field]: NaN as Cents };
    expect(checkBudget(x)).toMatchObject({ ok: false, code: 'amount.out_of_range', params: { field } });
  });
  it('cap validation identifies invalid ledger amount', () => expect(validateCapChange(cents(1), NaN as Cents)).toMatchObject({ params: { field: 'committedCents' } }));
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('invalid approval seq %s throws', seq => {
    expect(() => latestDecisionsByUser([{ id: 'a', userId: 'u', role: 'r', kind: 'terms', decision: 'approve', seq, boundConstraintsVersion: 1, boundTermsKey: 't' }])).toThrow('approval.seq_invalid');
  });
});
