import { describe, expect, it } from 'vitest';
import { cents, MAX_CENTS } from '../../../core/engine/money';
import type { Cents } from '../../../core/engine/money';
import { isoDate, addDays } from '../../../core/engine/dates';
import { canonicalJson } from '../../../core/engine/canonicalJson';
import { checkBudget, checkProposal, claimMismatch, evaluateApprovalSet, hardProjection, isExecutable, materializeTerms, enumerateCandidates, validateCapChange, buildHumanRequests } from '../../../core/engine/rules';
import type { ApprovalRow } from '../../../core/engine/rules';
import { input, plugin, proposal } from './fixture';

describe('budget: spike cases adapted to canon cents and reason codes', () => {
  it.each([
    [500000, 400000, 90000, null], [500000, 400000, 100000, null], [500000, 400000, 100001, 'budget.over'], [500000, 400000, 140000, 'budget.over'], [480000, 400000, 90000, 'budget.over'], [400000, 400000, 0, null], [380000, 400000, 0, 'budget.below_committed'], [380000, 400000, 10000, 'budget.below_committed'], [500000, 400000, 100.5, 'amount.out_of_range'], [500000, -1, 0, 'amount.out_of_range'], [NaN, 0, 0, 'amount.out_of_range'], [2 ** 53, 0, 0, 'amount.out_of_range'], [MAX_CENTS, MAX_CENTS, 1, 'amount.out_of_range'], [480000, 400000, 80000, null], [479999, 400000, 80000, 'budget.over'], [470000, 400000, 80000, 'budget.over'],
  ])('cap %s committed %s amount %s', (cap, committed, amount, code) => {
    const r = checkBudget({ capCents: cap as Cents, committedCents: committed as Cents, amountCents: amount as Cents });
    expect(r.ok).toBe(code === null);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it.each([-1, 0, 1, 79999, 80000, 80001, MAX_CENTS])('headroom %s', headroomCents => {
    const r = checkBudget({ headroomCents, amountCents: cents(80000) });
    expect(r.ok).toBe(headroomCents >= 80000);
  });
  it('below committed uses owner-only minimum at write boundary', () => {
    expect(validateCapChange(cents(399999), cents(400000))).toEqual({ ok: false, code: 'budget.below_committed', params: { minAllowedCapCents: 400000 } });
    expect(validateCapChange(cents(400000), cents(400000))).toEqual({ ok: true });
  });
});

describe('proposal snapshot and independent checks', () => {
  it('collects late and over together in check order', () => {
    const p = proposal(input.catalog.filter(r => r.kind === 'item').map(r => r.itemKey));
    expect(checkProposal(plugin, input, p).blocking).toEqual(['date.after_deadline', 'budget.over']);
  });
  it.each(['', '2026/11/18', '2026-11-8', '2026-02-30', '2026-13-01', '2026-11-18T00:00:00Z', '2027-02-29', '0000-01-01'])('rejects malformed date %s', d => {
    const p = proposal(); p.terms.deliveryDate = d as typeof p.terms.deliveryDate;
    const r = checkProposal(plugin, input, p);
    expect(r.blocking).toContain('date.invalid'); expect(r.terms).toBeNull();
  });
  it.each([-1, 0.5, NaN, Infinity, 2 ** 53, MAX_CENTS + 1])('rejects amount %s', n => {
    const p = proposal(); p.terms.amountCents = n as Cents;
    expect(checkProposal(plugin, input, p).terms).toBeNull();
  });
  it.each([['2026-11-02', null], ['2026-11-03', null], ['2026-11-16', null], ['2026-11-17', 'date.in_past']])('absolute date at %s', (d, code) => {
    const p = proposal(); const r = checkProposal(plugin, { ...input, localDate: isoDate(d!) }, p);
    expect(r.blocking).toEqual(code ? [code] : []); expect(p.terms.deliveryDate).toBe('2026-11-16');
  });
  it.each([0, 1, 364, 365, 366])('date window offset %s', days => {
    const p = proposal(); p.terms.deliveryDate = addDays(input.localDate, days);
    const r = checkProposal(plugin, { ...input, deadline: undefined }, p);
    expect(r.blocking.includes('date.out_of_range')).toBe(days > 365);
  });
  it.each([0, 1])('deadline plus %s days', days => {
    const p = proposal(); p.terms.deliveryDate = addDays(input.deadline!, days);
    expect(checkProposal(plugin, input, p).blocking).toEqual(days ? ['date.after_deadline'] : []);
  });
  it('retirement skips source comparison and still reports missing required', () => {
    const i = { ...input, catalog: input.catalog.map(r => r.itemKey === 'audit_log_export' ? { ...r, status: 'retired' as const, revision: 2 } : r) };
    const r = checkProposal(plugin, i, proposal());
    expect(r.blocking).toEqual(['item.retired', 'item.required_missing']);
    expect(r.checks.find(c => c.checkId === 'source_current')?.status).toBe('not_evaluated');
  });
  it('revision change does not reprice snapshots', () => {
    const i = { ...input, catalog: input.catalog.map(r => ({ ...r, priceCents: cents(r.priceCents + 1), revision: 2 })) };
    expect(checkProposal(plugin, i, proposal()).blocking).toEqual(['version.stale_source']);
  });
  it('title changes do not invalidate', () => {
    expect(checkProposal(plugin, { ...input, catalog: input.catalog.map(r => ({ ...r, title: 'Changed' })) }, proposal()).blocking).toEqual([]);
  });
  it.each(['empty', 'duplicate', 'unsorted', 'unknown', 'wrong_kind', 'missing', 'amount', 'line_duplicate', 'line_missing'])('structural case %s', kind => {
    const p = proposal(); let code = '';
    if (kind === 'empty') { p.terms.itemKeys = []; code = 'item.unknown'; }
    if (kind === 'duplicate') { p.terms.itemKeys.push('sso_login'); code = 'item.duplicate'; }
    if (kind === 'unsorted') { p.terms.itemKeys.reverse(); code = 'item.duplicate'; }
    if (kind === 'unknown') { p.terms.itemKeys = ['unknown_key']; code = 'item.unknown'; }
    if (kind === 'wrong_kind') { p.terms.itemKeys = ['rush']; code = 'item.unknown'; }
    if (kind === 'missing') { p.terms.itemKeys = ['sso_login']; code = 'item.required_missing'; }
    if (kind === 'amount') { p.terms.amountCents = cents(85000); code = 'amount.claim_mismatch'; }
    if (kind === 'line_duplicate') { p.lines.push(p.lines[0]!); code = 'amount.claim_mismatch'; }
    if (kind === 'line_missing') { p.lines.pop(); code = 'amount.claim_mismatch'; }
    expect(checkProposal(plugin, input, p).blocking).toContain(code);
  });
  it('below committed blocks B2 without reporting over', () => {
    const r = checkProposal(plugin, { ...input, capCents: cents(399999) }, proposal());
    expect(r.blocking).toEqual(['budget.below_committed']);
  });
  it.each(['seller', 'cap_only', 'headroom'])('partial view %s', kind => {
    const i = { ...input, viewer: 'observer', capCents: kind === 'cap_only' ? input.capCents : undefined, committedCents: undefined, headroomCents: kind === 'headroom' ? 80000 : undefined };
    const r = checkProposal(plugin, i, proposal());
    expect(r.checks.find(c => c.checkId === 'budget_fit')?.status).toBe(kind === 'headroom' ? 'pass' : 'unknown');
  });
});

describe('materialization and hard projection', () => {
  it('modifier price is a catalog line and date is absolute', () => {
    const p = proposal(undefined, ['rush']);
    expect(p.terms.amountCents).toBe(95000); expect(p.terms.deliveryDate).toBe('2026-11-12'); expect(p.termsKey).toBe(canonicalJson(p.terms));
    expect(claimMismatch(p)).toEqual({ ok: true });
  });
  it.each(['title', 'tasks', 'clock', 'ledger', 'reorder', 'reorder_required'])('projection excludes %s changes', kind => {
    const i = { ...input };
    if (kind === 'title') i.catalog = i.catalog.map(r => ({ ...r, title: 'New' }));
    if (kind === 'tasks') i.catalog = i.catalog.map(r => ({ ...r, taskTemplates: [] }));
    if (kind === 'clock') i.localDate = addDays(i.localDate, 1);
    if (kind === 'ledger') i.committedCents = cents(0);
    if (kind === 'reorder') i.catalog = [...i.catalog].reverse();
    if (kind === 'reorder_required') i.requiredItemKeys = [...i.requiredItemKeys!].reverse();
    expect(hardProjection(plugin, i)).toBe(hardProjection(plugin, input));
  });
  it.each(['priceCents', 'leadDays', 'revision', 'status', 'capCents', 'deadline', 'requiredItemKeys'])('projection includes %s', field => {
    const i = { ...input };
    if (field === 'capCents') i.capCents = cents(480000);
    else if (field === 'deadline') i.deadline = addDays(i.deadline!, 1);
    else if (field === 'requiredItemKeys') i.requiredItemKeys = [];
    else i.catalog = i.catalog.map((r, n) => n ? r : { ...r, [field]: field === 'status' ? 'retired' : (r[field as 'leadDays'] as number) + 1 });
    expect(hardProjection(plugin, i)).not.toBe(hardProjection(plugin, input));
  });
  it('rejects projection on a partial view', () => expect(() => hardProjection(plugin, { ...input, viewer: 'observer' })).toThrow());
  it('drops overflow candidates', () => {
    const rows = input.catalog.map(r => ({ ...r, priceCents: MAX_CENTS }));
    expect(materializeTerms({ itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] }, rows, input.localDate, () => 1)).toBeNull();
  });
  it.each([-1, 1.5, NaN])('plugin invalid amount %s throws', n => {
    expect(() => materializeTerms({ itemKeys: ['sso_login'], modifiers: [] }, input.catalog.map(r => ({ ...r, priceCents: n as Cents })), input.localDate, () => 1)).toThrow();
  });
});

describe('approval set and execution guards', () => {
  const required = plugin.roles.map(r => ({ role: r.role, kind: r.approvalKind }));
  const members = required.map(r => ({ role: r.role, userId: r.role }));
  const rows: ApprovalRow[] = required.map((r, n) => ({ ...r, userId: r.role, id: `a${n}`, seq: 1, decision: 'approve', boundConstraintsVersion: 1, boundTermsKey: 'terms' }));
  it.each(['complete', 'vacant', 'duplicate_holder', 'self_conflict', 'stale_cv', 'stale_key', 'wrong_kind', 'withdraw', 'reject', 'newer_withdraw', 'replaced'])('approval %s', kind => {
    let ms = [...members]; const rs = rows.map(r => ({ ...r }));
    if (kind === 'vacant') ms.pop();
    if (kind === 'duplicate_holder') ms.push(ms[0]!);
    if (kind === 'self_conflict') ms = ms.map(m => ({ ...m, userId: 'same' }));
    if (kind === 'stale_cv') rs[0]!.boundConstraintsVersion = 0;
    if (kind === 'stale_key') rs[0]!.boundTermsKey = 'old';
    if (kind === 'wrong_kind') rs[0]!.kind = 'budget';
    if (kind === 'withdraw') rs[0]!.decision = 'withdraw';
    if (kind === 'reject') rs[0]!.decision = 'reject';
    if (kind === 'newer_withdraw') rs.push({ ...rs[0]!, id: 'later', seq: 2, decision: 'withdraw' });
    if (kind === 'replaced') ms[0] = { ...ms[0]!, userId: 'replacement' };
    const r = evaluateApprovalSet({ required, members: ms, rows: rs, roomConstraintsVersion: 1, termsKey: 'terms' });
    expect(r.complete).toBe(kind === 'complete'); expect(r.approvalIds).toEqual(kind === 'complete' ? rows.map(r => r.id) : null);
  });
  it('rejects tied historical seq even after a later row', () => expect(() => evaluateApprovalSet({ required, members, rows: [{ ...rows[0]!, seq: 2 }, rows[0]!, rows[0]!], roomConstraintsVersion: 1, termsKey: 'terms' })).toThrow());
  it.each(['active', 'stale', 'executed', 'rejected', 'superseded'])('proposal state %s', status => {
    const p = proposal();
    const r = isExecutable(plugin, { room: { status: 'open', currentRunId: 'run' }, run: { _id: 'run', status: 'pending_approval', currentProposalId: 'p' }, proposal: { ...p, _id: 'p', status }, input });
    expect(r.ok).toBe(status === 'active');
  });
  it('T06-U37 superseded run and stale proposal retain every rule block', () => {
    const p = proposal(['audit_log_export', 'sso_login', 'usage_dashboard']);
    const r = isExecutable(plugin, { room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'superseded', currentProposalId: 'p' }, proposal: { ...p, _id: 'p', status: 'stale' }, input: { ...input, capCents: cents(480000) } });
    expect(r).toEqual({ ok: false, reasons: [{ code: 'version.stale_constraints' }, { code: 'budget.over' }] });
  });
  it('terms key tampering fails loudly', () => {
    expect(() => isExecutable(plugin, { room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'p' }, proposal: { ...proposal(), termsKey: 'wrong', _id: 'p', status: 'active' }, input })).toThrow('terms_key');
  });
});
it('candidate snapshot exclusion, stable ordering and anchor', () => {
  const opts = { mode: 'snapshot' as const, limit: 12, anchor: true, exclude: [], mustInclude: [] };
  expect(enumerateCandidates(plugin, input, opts).items.map(i => i.amountCents)).toEqual([80000, 90000]);
  expect(enumerateCandidates(plugin, input, { ...opts, exclude: [proposal().candidateKey] }).items.map(i => i.amountCents)).toEqual([90000]);
});
it('failed agent request names the failed role and always offers end run', () => {
  const r = buildHumanRequests(plugin, { kind: 'agent_failed', full: input, viewOf: () => ({ ...input, viewer: 'provider' }), run: { openRequestCount: 0, canContinue: true, failedRole: 'provider', keepAsIsUsed: false, excludedCandidateKeys: [], providerExcludedCandidateKeys: [] }, disclosures: {} });
  expect(r.toRole).toBe('provider'); expect(r.options.map(o => o.effect.kind)).toEqual(['retry_turn', 'end_run']);
});

describe('CE-044…059 pure-function counterexamples', () => {
  it.each([44, 45, 46])('CE-%s non-rule edits preserve hard projection', id => {
    const modified = { ...input, softFields: { preferredDate: 'later' }, disclosures: {}, catalog: id === 46 ? input.catalog.map(r => ({ ...r, title: 'Edited', taskTemplates: [] })) : input.catalog };
    expect(hardProjection(plugin, modified)).toBe(hardProjection(plugin, input));
    expect(checkProposal(plugin, modified, proposal()).blocking).toEqual([]);
  });
  it('CE-048 obsolete current proposal cannot execute', () => {
    const p = proposal();
    expect(isExecutable(plugin, { room: { status: 'open', currentRunId: 'r' }, run: { _id: 'r', status: 'pending_approval', currentProposalId: 'new' }, proposal: { ...p, _id: 'old', status: 'active' }, input })).toEqual({ ok: false, reasons: [{ code: 'approval.not_current' }] });
  });
  it.each([49, 50, 51, 52, 56, 58, 59])('CE-%s approval binding and current membership', id => {
    const required = [{ role: 'one', kind: 'terms' as const }, { role: 'two', kind: 'budget' as const }];
    let members = [{ role: 'one', userId: 'u1' }, { role: 'two', userId: 'u2' }];
    const base: ApprovalRow = { id: 'a1', userId: 'u1', role: 'one', kind: 'terms', decision: 'approve', seq: 1, boundConstraintsVersion: 3, boundTermsKey: 't' };
    const second: ApprovalRow = { ...base, id: 'a2', userId: 'u2', role: 'two', kind: 'budget' };
    let rows = [base, second];
    if (id === 49) rows = [base, { ...base, id: 'withdraw', seq: 2, decision: 'withdraw' }, { ...base, id: 'again', seq: 3 }, second];
    if (id === 50) rows[0] = { ...base, boundConstraintsVersion: 2, decision: 'reject' };
    if (id === 51) members[1] = { role: 'two', userId: 'replacement' };
    if (id === 52) members = members.map(m => ({ ...m, userId: 'u1' }));
    if (id === 56) rows = [...Array.from({ length: 60 }, (_, n): ApprovalRow => ({ ...base, id: `row${n}`, seq: n + 1, decision: n % 2 ? 'withdraw' : 'approve' })), { ...second, decision: 'reject' }];
    if (id === 58 || id === 59) rows = rows.map(r => ({ ...r, boundConstraintsVersion: 2 }));
    const r = evaluateApprovalSet({ required, members, rows, roomConstraintsVersion: 3, termsKey: 't' });
    expect(r.complete).toBe(id === 49);
    if (id === 50) expect(r.slots[0]?.slot.state).toBe('stale_reject');
    if (id === 52) expect(r.reasons.some(r => r.code === 'approval.self_conflict')).toBe(true);
    if (id === 56) expect(r.rejectedBy).toEqual(['two']);
  });
});

it('budget monotonicity across 2000 deterministic boundary pairs', () => {
  for (let n = 0; n < 2000; n++) {
    const committed = cents(n * 197 + 1); const amount = cents(n * 31 + 1);
    expect(checkBudget({ amountCents: amount, committedCents: committed, capCents: cents(committed + amount) }).ok).toBe(true);
    expect(checkBudget({ amountCents: amount, committedCents: committed, capCents: cents(committed + amount - 1) })).toMatchObject({ ok: false, code: 'budget.over', params: { overByCents: 1 } });
  }
});
