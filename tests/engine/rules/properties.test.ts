import { expect, it } from 'vitest';
import { addDays, candidateKey, canonicalJson, cents, materializeTerms } from '../../../core/engine';
import { CHECK_ORDER, buildHumanRequests, checkProposal, enumerateCandidates, passesChecks, projectEvaluation, viewFor } from '../../../core/engine/rules';
import type { CatalogRow, View } from '../../../core/engine/rules';
import { candidateSpace, effectiveLeadDays, scopeChangePlugin } from '../../../core/scenarios/scope-change';
import { input, plugin, proposal, type Input } from './fixture';

// Reproducible xorshift32; each property has its own seed and 2,000 independent instances.
function random(seed: number) {
  let state = seed;
  return (max: number) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % max; };
}
function shuffle<T>(values: readonly T[], next: (max: number) => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = next(i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
const scenario = { ...plugin, relaxations: scopeChangePlugin.relaxations, candidateSpace, materialize: (draft: Parameters<typeof plugin.materialize>[0], rows: readonly CatalogRow[], today: typeof input.localDate) => materializeTerms(draft, rows, today, effectiveLeadDays) };
const opts = { mode: 'snapshot' as const, limit: 12, anchor: true, exclude: [], mustInclude: [] };
function instance(next: (max: number) => number, sparse = false): View<Input> {
  const count = sparse ? next(6) : 1 + next(5);
  const catalog: CatalogRow[] = Array.from({ length: count + next(3) }, (_, i) => ({
    itemKey: `row_${i}`, kind: i < count ? 'item' : 'modifier', revision: 1 + next(4), title: `Row ${i}`,
    priceCents: cents(1 + next(1000)), leadDays: next(20), status: sparse && next(4) === 0 ? 'retired' : 'confirmed',
    taskTemplates: [], provenance: 'live',
  }));
  const requiredItemKeys = catalog.filter(r => r.kind === 'item' && next(3) === 0).map(r => r.itemKey);
  if (sparse && next(4) === 0) requiredItemKeys.push('absent_item');
  const committedCents = cents(next(2000));
  const capCents = cents(next(8000));
  return { ...input, catalog, requiredItemKeys, deadline: addDays(input.localDate, next(30)), committedCents, capCents, headroomCents: capCents - committedCents };
}
function request(full: View<Input>, role: string) {
  const kind = role === 'customer' ? 'rounds_exhausted' : role === 'finance' ? 'infeasible' : 'agent_failed';
  return buildHumanRequests(scenario, { kind, full, viewOf: r => viewFor(scenario, full, {}, r), disclosures: {}, run: { failedRole: role, reroutedToRole: role === 'finance' ? role : undefined, openRequestCount: 0, canContinue: true, keepAsIsUsed: false, excludedCandidateKeys: [], providerExcludedCandidateKeys: [] } });
}
it('T06-P1 shuffled catalog rows and arrays preserve Evaluation, candidateKey and termsKey (2000 cases)', () => {
  const next = random(0x6101);
  for (let n = 0; n < 2000; n++) {
    const a = instance(next);
    const draft = { itemKeys: a.catalog.filter(r => r.kind === 'item').map(r => r.itemKey), modifiers: a.catalog.filter(r => r.kind === 'modifier').map(r => r.itemKey) };
    const b = { ...a, catalog: shuffle(a.catalog, next), requiredItemKeys: shuffle(a.requiredItemKeys ?? [], next) };
    const x = scenario.materialize(draft, a.catalog, a.localDate)!;
    const y = scenario.materialize({ itemKeys: shuffle(draft.itemKeys, next), modifiers: shuffle(draft.modifiers, next) }, b.catalog, b.localDate)!;
    expect(y).toEqual(x);
    expect(y.candidateKey).toBe(candidateKey(draft.itemKeys, draft.modifiers));
    expect(y.termsKey).toBe(canonicalJson(x.terms));
    expect(checkProposal(scenario, b, { ...y, lines: shuffle(y.lines, next) })).toEqual(checkProposal(scenario, a, x));
  }
}, 30000);
it('T06-P2 passesChecks iff blocking is empty; CHECK_ORDER has no duplicates (2000 cases)', () => {
  const next = random(0x6102);
  for (let n = 0; n < 2000; n++) {
    const full = instance(next, true);
    const evaluation = checkProposal(scenario, full, proposal());
    expect(passesChecks(evaluation)).toBe(evaluation.blocking.length === 0);
    expect(evaluation.passesChecks).toBe(passesChecks(evaluation));
    expect(new Set(evaluation.blocking).size).toBe(evaluation.blocking.length);
    expect(evaluation.checks.map(c => c.checkId)).toEqual([...CHECK_ORDER, ...scenario.checks.map(c => c.checkId), 'budget_state', 'budget_fit']);
    expect(evaluation.blocking).toEqual([...new Set(evaluation.checks.flatMap(c => c.status === 'fail' && c.code ? [c.code] : []))]);
  }
}, 30000);
it('T06-P6 private changes preserve projected checks, viewer candidates and request options (2000 cases)', () => {
  const next = random(0x6106);
  for (let n = 0; n < 2000; n++) {
    const base = instance(next);
    const value = scenario.materialize({ itemKeys: base.catalog.filter(r => r.kind === 'item').map(r => r.itemKey), modifiers: [] }, base.catalog, base.localDate)!;
    for (const role of ['provider', 'customer', 'finance']) {
      const a = { ...base, capCents: cents(0), committedCents: cents(50000), headroomCents: -50000, deadline: addDays(base.localDate, role === 'finance' ? -1 : 30) };
      const b = role === 'finance' ? { ...a, deadline: addDays(base.localDate, -2) } : { ...a, capCents: cents(1), headroomCents: -49999 };
      expect(projectEvaluation(checkProposal(scenario, b, value), role, scenario, {})).toEqual(projectEvaluation(checkProposal(scenario, a, value), role, scenario, {}));
      expect(enumerateCandidates(scenario, viewFor(scenario, b, {}, role), opts)).toEqual(enumerateCandidates(scenario, viewFor(scenario, a, {}, role), opts));
      expect(request(b, role)).toEqual(request(a, role));
      const output = JSON.stringify([viewFor(scenario, b, {}, role), request(b, role)]);
      if (role !== 'finance') expect(output).not.toContain('49999');
    }
  }
}, 60000);
it('T06-P7 snapshot entries pass in their view, are bounded, unique and ordered (2000 cases)', () => {
  const next = random(0x6107);
  for (let n = 0; n < 2000; n++) {
    const full = instance(next);
    const role = ['customer', 'provider', 'finance'][next(3)]!;
    const view = viewFor(scenario, full, {}, role);
    const result = enumerateCandidates(scenario, view, opts);
    expect(result.items.length).toBeLessThanOrEqual(12);
    const keys = result.items.map(c => c.candidateKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(1)).toEqual(keys.slice(1).sort());
    for (const value of result.materialized) expect(checkProposal(scenario, view, value).blocking).toEqual([]);
    if (result.items.length) {
      const all = enumerateCandidates(scenario, view, { ...opts, mode: 'feasibility', limit: Infinity });
      expect(result.items[0]!.amountCents).toBe(Math.min(...all.items.map(c => c.amountCents)));
    }
  }
}, 30000);
it('T06-P8 feasibility matches independent brute force and omitted modifiers are dominated (2000 cases)', () => {
  const next = random(0x6108);
  for (let n = 0; n < 2000; n++) {
    const full = instance(next, true);
    const items = full.catalog.filter(r => r.kind === 'item' && r.status === 'confirmed');
    const mods = full.catalog.filter(r => r.kind === 'modifier' && r.status === 'confirmed');
    expect(full.catalog.length).toBeLessThanOrEqual(8);
    const expected: string[] = [];
    for (let mask = 1; mask < 2 ** items.length; mask++) {
      const itemKeys = items.filter((_, i) => (mask & 2 ** i) !== 0).map(r => r.itemKey);
      if (full.requiredItemKeys?.some(k => !itemKeys.includes(k))) continue;
      const base = scenario.materialize({ itemKeys, modifiers: [] }, full.catalog, full.localDate)!;
      const basePasses = passesChecks(checkProposal(scenario, full, base));
      if (basePasses) expected.push(base.candidateKey);
      for (const mod of mods) {
        const modified = scenario.materialize({ itemKeys, modifiers: [mod.itemKey] }, full.catalog, full.localDate)!;
        if (full.deadline !== undefined && base.terms.deliveryDate <= full.deadline) {
          expect(modified.terms.amountCents).toBeGreaterThan(base.terms.amountCents);
          if (passesChecks(checkProposal(scenario, full, modified))) expect(basePasses).toBe(true);
        } else if (passesChecks(checkProposal(scenario, full, modified))) expected.push(modified.candidateKey);
      }
    }
    expect(enumerateCandidates(scenario, full, { ...opts, mode: 'feasibility', limit: Infinity }).items.map(c => c.candidateKey)).toEqual(expected.sort());
  }
}, 30000);
it('T06-P9 random sparse catalogs and briefs do not throw and requests contain end_run (2000 cases)', () => {
  const next = random(0x6109);
  const relaxationKinds = new Set<string>();
  for (let n = 0; n < 2000; n++) {
    const full = instance(next, true);
    expect(() => checkProposal(scenario, full, proposal())).not.toThrow();
    expect(() => enumerateCandidates(scenario, full, { ...opts, mode: 'feasibility', limit: Infinity })).not.toThrow();
    const result = buildHumanRequests(scenario, { kind: 'infeasible', full, viewOf: r => viewFor(scenario, full, {}, r), disclosures: {}, run: { openRequestCount: 0, canContinue: true, keepAsIsUsed: false, excludedCandidateKeys: [], providerExcludedCandidateKeys: [] } });
    expect(typeof result.toRole).toBe('string');
    expect(result.options.filter(o => o.effect.kind === 'end_run')).toHaveLength(1);
    for (const { effect } of result.options) {
      if (effect.kind === 'raise_cap') {
        relaxationKinds.add(effect.kind);
        expect(effect.amountCents).toBeGreaterThan(full.capCents!);
      }
      if (effect.kind === 'extend_deadline') {
        relaxationKinds.add(effect.kind);
        expect(effect.date > full.deadline!).toBe(true);
      }
      if (effect.kind === 'drop_items') {
        relaxationKinds.add(effect.kind);
        expect(effect.itemKeys.length).toBeGreaterThan(0);
        expect(effect.itemKeys.every(key => full.requiredItemKeys?.includes(key))).toBe(true);
      }
    }
  }
  expect([...relaxationKinds].sort()).toEqual(['drop_items', 'extend_deadline', 'raise_cap']);
}, 30000);
it('T06-P10 materialize sums lines, computes lead dates and ignores unrelated rows (2000 cases)', () => {
  const next = random(0x6110);
  for (let n = 0; n < 2000; n++) {
    const full = instance(next);
    const selected = full.catalog.filter(r => r.kind === 'item').slice(0, 1 + next(5));
    const draft = { itemKeys: selected.map(r => r.itemKey), modifiers: [] };
    const value = scenario.materialize(draft, full.catalog, full.localDate)!;
    expect(value.terms.amountCents).toBe(selected.reduce((sum, row) => sum + row.priceCents, 0));
    expect(value.terms.deliveryDate).toBe(addDays(full.localDate, effectiveLeadDays(selected)));
    const changed = full.catalog.map(r => draft.itemKeys.includes(r.itemKey) ? r : { ...r, revision: r.revision + 1, title: 'UNRELATED_CANARY', priceCents: cents(next(9999)), leadDays: next(365) });
    expect(scenario.materialize(draft, changed, full.localDate)).toEqual(value);
  }
}, 30000);
