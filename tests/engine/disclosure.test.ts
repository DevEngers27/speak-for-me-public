import { sharing } from './privacyDisclosure';
import { describe, expect, it } from 'vitest';
import { projectSharedFacts, DISCLOSURE } from './privacyDisclosure';
import { isEventPayload, isRestrictedRef } from '../../core/engine';
import { privacyChecks, budgetChecks, nonInterference, optionsChecks, contextChecks } from './privacyAssertions';
describe('disclosure boundary', () => {
  it('masks checks and drops undeclared params', privacyChecks);
  it('scans all budget disclosure configurations', budgetChecks);
  it('never reads private fields and preserves non-interference', nonInterference);
  it('requires projected human options', optionsChecks);
  it('whitelists agent context and delimits catalog titles', contextChecks);
  it('keeps historical disclosure version-scoped and applies revocation', () => {
    const rows = [{ fromRole: 'finance' as const, field: 'capCents', value: { kind: 'cents', cents: 99112233 }, audience: [] , briefVersion: 1, seq: 1 }, { fromRole: 'finance' as const, field: 'capCents', value: { kind: 'cents', cents: 100 }, audience: ['customer' as const], briefVersion: 2, seq: 2 }];
    expect(projectSharedFacts('customer', rows, 1)).toEqual([]);
    expect(projectSharedFacts('customer', rows)).toHaveLength(1);
    expect(projectSharedFacts('provider', rows)).toEqual([]);
  });
  it('covers every DTO family and rejects event payload escape fields', () => {
    expect(isEventPayload({ type: 'constraints_changed', fromVersion: 1, toVersion: 2 })).toBe(true);
    for (const key of ['capCents', 'reasonCodes', 'rationale', 'visibility', 'checkId']) expect(isEventPayload({ type: 'room_closed', [key]: 'CANARY' })).toBe(false);
    expect(isRestrictedRef({ table: 'briefs', id: 'b1' })).toBe(true);
    expect(isRestrictedRef({ table: 'users', id: 'u1' })).toBe(false);
  });
});

describe('adversarial records', () => {
  it('does not touch any hidden field in any registered DTO family', async () => {
    const { canSee, projectForRole, ROLES } = await import('./privacyDisclosure');
    for (const family of Object.keys(DISCLOSURE) as (keyof typeof DISCLOSURE)[]) {
      if (family === 'sharedFacts' || family === 'budget') continue;
      for (const role of ROLES) {
        const reads: string[] = [];
        const data = new Proxy({ role: 'finance', toRole: 'finance', status: 'confirmed' } as Record<string, unknown>, {
          has: (_target, key) => key !== 'options',
          get(target, key) { reads.push(String(key)); return key in target ? target[key as string] : 'CANARY'; },
        });
        projectForRole(role, { family, data });
        for (const [key, rule] of Object.entries(DISCLOSURE[family])) {
          if (!canSee(role, rule.audience, 'finance') && !['status', 'toRole', 'role'].includes(key)) expect(reads, `${role}:${family}.${key}`).not.toContain(key);
        }
      }
    }
  });
  it('scans projected views and contexts for another party’s private canaries', async () => {
    const { projectForRole, ROLES } = await import('./privacyDisclosure');
    for (const role of ROLES) for (const ownerRole of ROLES) {
      if (role === ownerRole) continue;
      for (const family of ['briefs', 'approvals', 'turns', 'attempts'] as const) {
        const data = { role: ownerRole, note: 'PRIVATE_NOTE_CANARY', rationale: 'PRIVATE_RATIONALE_CANARY', hardFields: { capCents: 99112233 }, softFields: { notes: 'PRIVATE_SOFT_CANARY' }, usage: { inputTokens: 99112233 }, candidateSnapshot: [{ capCents: 99112233 }], rawOutputRef: 'PRIVATE_RAW_CANARY' };
        const json = JSON.stringify(projectForRole(role, { family, data }));
        for (const canary of ['99112233', 'PRIVATE_NOTE_CANARY', 'PRIVATE_RATIONALE_CANARY', 'PRIVATE_SOFT_CANARY', 'PRIVATE_RAW_CANARY']) expect(json).not.toContain(canary);
      }
    }
  });
  it('omits historical fit and checks without reading them', async () => {
    const { projectForRole } = await import('./privacyDisclosure');
    for (const status of ['rejected', 'stale', 'superseded', 'executed']) {
      const data = { status, get fit(): never { throw new Error('Historical fit was read'); }, get checks(): never { throw new Error('Historical checks were read'); } };
      expect(projectForRole('provider', { family: 'proposals', data })).toEqual({ status });
    }
  });
  it('collapses multiple secret failures and does not read their params', async () => {
    const { projectChecks } = await import('./privacyDisclosure');
    const check = { checkId: 'CANARY', code: 'budget.over' as const, ownerRole: 'finance' as const, inputs: ['headroomCents'], passed: false, get params(): never { throw new Error('Hidden params read'); } };
    expect(projectChecks('customer', [check, check])).toEqual({ kind: 'checks', fit: 'blocked', items: [{ code: 'private.constraint_unmet' }] });
    expect(projectChecks('provider', [check])).toEqual({ kind: 'fit', fit: 'blocked' });
  });
  it('reads only declared visible check parameters', async () => {
    const { projectChecks } = await import('./privacyDisclosure');
    const params = { overByCents: 17, get capCents(): never { throw new Error('Undeclared param read'); } };
    expect(projectChecks('finance', [{ checkId: 'budget', code: 'budget.over', ownerRole: 'finance', inputs: ['headroomCents'], passed: false, params }])).toEqual({ kind: 'checks', fit: 'blocked', items: [{ code: 'budget.over', params: { overByCents: 17 } }] });
  });
  it('checks the full event catalog and rejects extra payload fields', async () => {
    const { EVENT_FIELDS } = await import('../../core/engine');
    function sample(spec: string): unknown {
      if (spec === 'boolean') return true;
      if (spec === 'itemKey') return 'item_key';
      if (spec.startsWith('id:')) return 'room1';
      if (spec === 'number') return 1;
      if (spec === 'role') return 'customer';
      if (spec === 'date') return '2026-10-24';
      if (spec === 'key') return 'key1';
      if (spec === 'keys') return ['item1'];
      if (spec === 'items') return [{ itemKey: 'item1', kind: 'item', revision: 1, priceCents: 100, leadDays: 1 }];
      return spec.split('|')[0];
    }
    for (const [type, fields] of Object.entries(EVENT_FIELDS)) {
      const payload = Object.fromEntries([['type', type], ...Object.entries(fields).map(([key, spec]) => [key.replace(/\?$/, ''), sample(spec)])]);
      expect(isEventPayload(payload), type).toBe(true);
      expect(isEventPayload({ ...payload, capCents: 99112233 }), type).toBe(false);
    }
  });
});

describe('derived values and target options', () => {
  it('intersects every possible pair of role audiences without widening', async () => {
    const { derivedAudience, ROLES } = await import('./privacyDisclosure');
    for (let left = 0; left < 8; left++) for (let right = 0; right < 8; right++) {
      const a = ROLES.filter((_, i) => left & 1 << i);
      const b = ROLES.filter((_, i) => right & 1 << i);
      expect(derivedAudience([a, b])).toEqual(ROLES.filter((_, i) => (left & right) & 1 << i));
    }
  });
  it('independently gates committed and headroom and inherits headroom for over-by', async () => {
    const { projectForRole } = await import('./privacyDisclosure');
    const dto = { family: 'budget' as const, data: { capCents: 5000, committedCents: 4000, headroomCents: 1000, overByCents: 10, shortfallCents: 10, minAllowedCapCents: 4000 } };
    expect(projectForRole('customer', dto, sharing(['capCents'], dto.data))).toEqual({ capCents: 5000 });
    expect(projectForRole('customer', dto, sharing(['headroomCents'], dto.data))).toEqual({ headroomCents: 1000 });
    expect(projectForRole('customer', dto, sharing(['capCents', 'committedCents'], dto.data))).toEqual({ capCents: 5000, committedCents: 4000, headroomCents: 1000 });
  });
  it('derives raise-cap only from the finance view and strips blocked numbers', async () => {
    const { projectRequestOptions, assertOptionsProjected } = await import('./privacyDisclosure');
    const { projectFixture } = await import('./projectFixture');
    const view = projectFixture({ role: 'finance' as const, committedCents: 4000, candidates: [{ candidateKey: 'a', amountCents: 900, deliveryDate: '2026-10-24' }] });
    const options = projectRequestOptions('finance', [{ optionKey: 'A', templateKey: 'raise_cap', effect: { type: 'raise_cap', amountCents: 4900 } }, { optionKey: 'B', templateKey: 'blocked', effect: { type: 'blocked', amountCents: 99112233 } as { type: 'blocked' } }], view);
    expect(options[1]!.effect).toEqual({ type: 'blocked' });
    expect(() => assertOptionsProjected('finance', options)).not.toThrow();
    expect(() => assertOptionsProjected('customer', options)).toThrow();
    expect(() => assertOptionsProjected('finance', [projectFixture({ optionKey: 'A', effect: { type: 'raise_cap', amountCents: 99112233 } })])).toThrow();
  });
  it('projects shared-fact values by discriminator and never reads invisible values', async () => {
    const { projectSharedFacts } = await import('./privacyDisclosure');
    const base = { fromRole: 'finance' as const, field: 'capCents', audience: ['customer' as const], briefVersion: 1, seq: 1 };
    const value = { kind: 'cents', cents: 100, get secret(): never { throw new Error('Unknown fact field'); } };
    expect(projectSharedFacts('customer', [{ ...base, value }])).toEqual([{ fromRole: 'finance', field: 'capCents', value: { kind: 'cents', cents: 100 }, asOfBriefVersion: 1 }]);
    expect(projectSharedFacts('provider', [{ ...base, get value(): never { throw new Error('Hidden value'); } }])).toEqual([]);
  });
});

describe('scenario fixture canaries', () => {
  it('keeps every fixture secret out of non-owner private-record projections', async () => {
    const { canarySecrets } = await import('../../core/scenarios/scope-change/fixtures/canaries');
    const { projectForRole, ROLES } = await import('./privacyDisclosure');
    const { isoDate } = await import('../../core/scenarios/scope-change/fixtures/anchor');
    for (const secret of canarySecrets(isoDate('2026-11-20'))) {
      for (const role of ROLES) {
        if (role === secret.ownerRole) continue;
        const data = { role: secret.ownerRole, hardFields: { private: secret.value }, softFields: { notes: secret.value }, note: secret.value, rationale: secret.value, usage: secret.value };
        for (const family of ['briefs', 'approvals', 'turns', 'attempts'] as const) {
          const json = JSON.stringify(projectForRole(role, { family, data }));
          expect(json, `${role}:${family}:${secret.id}`).not.toContain(String(secret.value));
        }
      }
    }
  });
});
