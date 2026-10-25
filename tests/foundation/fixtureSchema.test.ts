import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {loadFixture, safeLoadFixture, parseFixtureJson, privateValuesOf, ScenarioFixtureSchema,
  scenarioFixtureJsonSchema, constraintSetForStep, deepFreeze, FixtureValidationError,
  type ScenarioFixtureInput, type ScenarioFixture, type ScenarioFixtureData} from '../../convex/lib/fixtureSchema';
import {isIsoDate, isoDate, toEpochDay, fromEpochDay} from '../../core/engine/dates';
import type {Cents} from '../../core/engine/money';
import type {IsoDate} from '../../core/engine/dates';
function sample(): ScenarioFixtureInput {
  return {
    schemaVersion: 1, id: 'example', scenarioKey: 'example', title: 'Example', provenance: 'seeded', localDate: '2026-01-01',
    roles: [{id: 'customer', label: 'Customer'}, {id: 'provider', label: 'Provider'}, {id: 'finance', label: 'Finance'}],
    members: [{userId: 'a', role: 'customer', displayName: 'A'}, {userId: 'b', role: 'provider', displayName: 'B'}, {userId: 'c', role: 'finance', displayName: 'C'}],
    briefs: {finance: {hardFields: {capCents: 500}, softFields: {notes: 'PRIVATE_CANARY'}, disclosures: {capCents: ['customer']}}},
    ledgerEntries: [{kind: 'baseline', amountCents: 100, provenance: 'seeded'}],
    catalogItems: [{itemKey: 'sso_login', kind: 'item', title: 'Login', priceCents: 200, leadDays: 3, taskTemplates: [{title: 'Build login'}], status: 'draft'}],
    constraintSets: [{version: 1, constraints: [{id: 'limit', kind: 'cap', ownerRole: 'finance', visibility: 'private', amountCents: 500}]}],
    steps: [{id: 'initial', label: 'Initial', constraintSetVersion: 1, expectations: [{id: 'one', description: 'Test metadata', candidate: {itemKeys: ['sso_login']}, outcome: {feasible: true, itemsTotalCents: 200}}]}],
  };
}
function checks(value: unknown): string[] {
  const result = safeLoadFixture(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map(i => i.check ?? i.code);
}
describe('canon fixtures', () => {
  it('loads, brands, clones, and deeply freezes canon data without import-time examples', () => {
    const input = sample();
    const fixture = loadFixture(input);
    const price: Cents = fixture.catalogItems[0]!.priceCents;
    const date: IsoDate = fixture.localDate;
    expect([price, date]).toEqual([200, '2026-01-01']);
    expect(Object.isFrozen(fixture.briefs.finance!.hardFields)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    input.briefs.finance!.hardFields.capCents = 1;
    expect(fixture.briefs.finance!.hardFields.capCents).toBe(500);
    expect(parseFixtureJson(JSON.stringify(sample())).ok).toBe(true);
    expect(constraintSetForStep(fixture, 'initial').version).toBe(1);
    expect(() => constraintSetForStep(fixture, 'unknown')).toThrow();
  });
  it('rejects canon naming mistakes, invalid money, impossible dates, and unmarked provenance', () => {
    for (const value of [-1, 1.5, NaN, Infinity, 1e11 + 1]) {
      const input = sample(); input.catalogItems[0]!.priceCents = value;
      expect(safeLoadFixture(input).ok).toBe(false);
    }
    for (const patch of [{localDate: '2026-02-30'}, {provenance: 'live'}, {privateBriefs: {}}, {scenarioKey: 'not-plugin'}]) {
      expect(safeLoadFixture({...sample(), ...patch}).ok).toBe(false);
    }
    expect(() => loadFixture(null)).toThrow(FixtureValidationError);
    expect(parseFixtureJson('PRIVATE_CANARY').ok).toBe(false);
  });
  it('checks identities, roles, references, versions, and candidate totals', () => {
    const duplicate = sample(); duplicate.catalogItems.push({...duplicate.catalogItems[0]!});
    expect(checks(duplicate)).toContain('duplicate_id');
    const unknown = sample(); unknown.steps[0]!.expectations[0]!.candidate.itemKeys = ['missing_item'];
    expect(checks(unknown)).toContain('unknown_item');
    const total = sample(); total.steps[0]!.expectations[0]!.outcome.itemsTotalCents = 201;
    expect(checks(total)).toContain('total_mismatch');
    const role = sample(); role.briefs.finance!.disclosures.capCents = ['missing'];
    expect(checks(role)).toContain('unknown_role');
    const identity = sample(); identity.constraintSets.push({version: 2, constraints: [{...identity.constraintSets[0]!.constraints[0]!, visibility: 'shared'}]});
    expect(checks(identity)).toContain('constraint_identity_changed');
    const versions = sample(); versions.constraintSets[0]!.version = 2;
    expect(checks(versions)).toContain('constraint_version_sequence');
  });
  it('avoids secondary total and regression errors', () => {
    const duplicate = sample(); duplicate.steps[0]!.expectations[0]!.candidate.itemKeys = ['sso_login', 'sso_login'];
    expect(checks(duplicate)).toEqual(['duplicate_id']);
    const version = sample(); version.steps = [{...version.steps[0]!, id: 'unknown', constraintSetVersion: 5}, version.steps[0]!];
    expect(checks(version)).toEqual(['unknown_constraint_version']);
    const generic = sample(); delete generic.steps[0]!.expectations[0]!.outcome.itemsTotalCents;
    expect(safeLoadFixture(generic).ok).toBe(true);
  });
  it('keeps all brief and private constraint leaves available for canary scanning', () => {
    const input = sample(); input.canaries = {finance: 'SECOND_CANARY'};
    expect(privateValuesOf(loadFixture(input))).toEqual(expect.arrayContaining(['PRIVATE_CANARY', 'SECOND_CANARY', 500]));
  });
  it('validates synchronous plugin briefs fail closed and suppresses custom messages and key names', () => {
    const input = sample();
    const schema = z.strictObject({hardFields: z.strictObject({capCents: z.int()}), softFields: z.record(z.string(), z.json()), disclosures: z.record(z.string(), z.array(z.string()))});
    expect(safeLoadFixture(input, {expectedScenarioKey: 'example', briefSchemas: {finance: schema}}).ok).toBe(true);
    expect(safeLoadFixture(input, {expectedScenarioKey: 'other'}).ok).toBe(false);
    expect(checksWithOptions(input, {briefSchemas: {}})).toContain('missing_brief_schema');
    expect(checksWithOptions(input, {briefSchemas: {customer: schema}})).toContain('missing_brief');
    for (const broken of [z.any().refine(() => {throw Error('PRIVATE_CANARY');}), z.any().refine(async () => false), z.any().refine(() => false, 'PRIVATE_CANARY')]) {
      const result = safeLoadFixture(input, {briefSchemas: {finance: broken}});
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');
    }
    input.briefs.finance!.hardFields['PRIVATE_KEY_CANARY'] = 9;
    const failed = safeLoadFixture(input, {briefSchemas: {finance: schema}});
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_KEY_CANARY');
    expect(safeLoadFixture(JSON.parse(JSON.stringify(sample()).replace('"capCents":500', '"__proto__":{"secret":1}'))).ok).toBe(false);
  });
  it('exports deterministic input JSON schema and handles frozen parents and cycles in deepFreeze', () => {
    expect(scenarioFixtureJsonSchema()).toEqual(scenarioFixtureJsonSchema());
    expect(scenarioFixtureJsonSchema().additionalProperties).toBe(false);
    const child = {x: 1}; const parent = Object.freeze({child}); deepFreeze(parent);
    expect(Object.isFrozen(child)).toBe(true);
    const cyclic: {self?: unknown} = {}; cyclic.self = cyclic;
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(safeLoadFixture(cyclic).ok).toBe(false);
  });
});
function checksWithOptions(input: unknown, options: Parameters<typeof safeLoadFixture>[1]): string[] {
  const result = safeLoadFixture(input, options);
  return result.ok ? [] : result.issues.map(i => i.code);
}
it('pins fixture readonly and validation brands at compile time', () => {
  function compileOnly(fixture: ScenarioFixture, input: ScenarioFixtureInput, parsed: ScenarioFixtureData) {
    // @ts-expect-error deeply readonly catalog
    fixture.catalogItems[0]!.priceCents = 1;
    // @ts-expect-error deeply readonly arrays
    fixture.steps.push(fixture.steps[0]!);
    // @ts-expect-error deeply readonly briefs
    fixture.briefs.finance!.hardFields.capCents = 1;
    // @ts-expect-error loaded fixture cannot be forged from structurally parsed data
    const forged: ScenarioFixture = parsed;
    // @ts-expect-error canon provenance closed enum
    input.provenance = 'live';
    // @ts-expect-error schema version is literal
    input.schemaVersion = 2;
    // @ts-expect-error amounts are numbers
    input.catalogItems[0]!.priceCents = '1';
    void forged;
  }
  void compileOnly;
  expect(ScenarioFixtureSchema.safeParse(sample()).success).toBe(true);
});
it('agrees with Zod and a UTC calendar oracle across edge years', () => {
  for (const year of [0, 5, 99, 100, 400, 1900, 2000, 2026, 2028, 2100, 9999]) {
    for (let month = 1; month <= 12; month++) for (let day = 1; day <= 32; day++) {
      const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      expect(isIsoDate(text)).toBe(z.iso.date().safeParse(text).success);
      if (isIsoDate(text)) {
        const oracle = new Date(0); oracle.setUTCFullYear(year, month - 1, day);
        expect(toEpochDay(isoDate(text))).toBe(oracle.getTime() / 86400000);
        expect(fromEpochDay(toEpochDay(text))).toBe(text);
      }
    }
  }
});
it('enforces one member per role and reports unsafe aggregate totals without values', () => {
  const members = sample(); members.members.push({userId: 'd', role: 'finance', displayName: 'D'});
  expect(checks(members)).toContain('duplicate_id');
  const total = sample();
  total.catalogItems = Array.from({length: 3}, (_, i) => ({itemKey: `ITEM${i}`, kind: 'item', title: 'Item', priceCents: 1e11, leadDays: 0, taskTemplates: []}));
  total.steps[0]!.expectations[0]!.candidate.itemKeys = total.catalogItems.map(row => row.itemKey);
  total.steps[0]!.expectations[0]!.outcome.itemsTotalCents = 1e11;
  const result = safeLoadFixture(total);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('300000000000');
});
