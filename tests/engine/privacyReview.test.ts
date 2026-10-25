import { plugin } from './rules/fixture';
import { sharing } from './privacyDisclosure';
import { projectFixture } from './projectFixture';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE, disclosureRules, DERIVED_FROM, DECLASSIFIERS, derivedAudience, canSee, ROLES, projectForRole, projectChecks, projectSharedFacts, type FieldRule, type CheckResult, type SharedFact } from './privacyDisclosure';
import { buildAgentContext, type AgentView } from '../../core/engine';
import { verifyUntrustedBlock } from '../../core/engine';
import { isEventPayload } from '../../core/engine';
import { initialState, projectPrivacyState } from './privacyPipeline';

describe('Gemini privacy regressions', () => {
  it('gates G701 and execution snapshots by the disclosure active at the value version', () => {
    const facts: SharedFact[] = [
      { fromRole: 'finance', field: 'committedCents', value: { kind: 'cents', cents: 400219 }, audience: [], briefVersion: 1, seq: 1 },
      { fromRole: 'finance', field: 'committedCents', value: { kind: 'cents', cents: 400219 }, audience: ['customer'], briefVersion: 2, seq: 2 },
      { fromRole: 'finance', field: 'capCents', value: { kind: 'cents', cents: 512347 }, audience: ['customer'], briefVersion: 1, seq: 1 },
    ];
    const execution = { family: 'executions' as const, data: { amountCents: 90000, committedBeforeCents: 400219, committedAfterCents: 490219, capCentsAtExecution: 512347 } };
    const order = { family: 'changeOrders' as const, data: { deltaCents: 90000, baselineCents: 400219, priorApprovedDeltaCents: 0, amountBeforeCents: 400219, amountAfterCents: 490219 } };
    expect(projectForRole('customer', execution, sharing(['committedCents', 'capCents']))).toEqual({ amountCents: 90000 });
    expect(projectForRole('customer', execution, { snapshot: { facts, briefVersion: 1 } })).toEqual({ amountCents: 90000, capCentsAtExecution: 512347 });
    expect(projectForRole('customer', order, { snapshot: { facts, briefVersion: 1 } })).toEqual({ deltaCents: 90000 });
    for (const dto of [execution, order]) {
      expect(projectForRole('customer', dto, { snapshot: { facts, briefVersion: 2 } })).toEqual(dto.data);
      expect(projectForRole('finance', dto)).toEqual(dto.data);
      const provider = projectForRole('provider', dto, { ...sharing(['capCents', 'committedCents']), snapshot: { facts, briefVersion: 2 } });
      expect(provider).toEqual(dto === execution ? { amountCents: 90000 } : { deltaCents: 90000 });
    }
  });
  it('computes notIncludedItemKeys only from the customer private list, never stored hints', () => {
    const dto = { family: 'proposals' as const, data: { status: 'active', terms: projectFixture({ itemKeys: ['audit'] }), notIncludedItemKeys: ['FORGED'] } };
    expect(projectForRole('customer', dto, { requiredItemKeys: ['audit', 'sso'] })).toHaveProperty('notIncludedItemKeys', ['sso']);
    for (const role of ['finance', 'provider'] as const) expect(projectForRole(role, dto, { requiredItemKeys: ['audit', 'sso'] })).not.toHaveProperty('notIncludedItemKeys');
  });
  it('resolves null owners canonically, validates disclosure names, and masks cross-owner inputs', () => {
    for (const [code, input] of [['budget.over', 'headroomCents'], ['date.after_deadline', 'deadline'], ['item.required_missing', 'requiredItemKeys']] as const) {
      const role = code === 'budget.over' ? 'customer' : 'finance';
      const check: CheckResult = { code, checkId: 'SECRET', ownerRole: null, inputs: [input], passed: false, params: {} };
      expect(projectChecks(role, [check])).toMatchObject({ items: [{ code: 'private.constraint_unmet' }] });
      expect(projectChecks(role, [{ ...check, inputs: ['privateNotes'] }], sharing(['privateNotes']))).toMatchObject({ items: [{ code: 'private.constraint_unmet' }] });
      expect(projectChecks(role, [{ ...check, ownerRole: role, inputs: ['privateNotes'] }])).toMatchObject({ items: [{ code: 'private.constraint_unmet' }] });
    }
    expect(projectChecks('customer', [{ code: 'budget.over', checkId: 'SECRET', ownerRole: null, inputs: ['headroomCents'], passed: false, params: { overByCents: 12 } }], sharing(['headroomCents']))).toMatchObject({ items: [{ code: 'budget.over', params: { overByCents: 12 } }] });
    const boundary = projectPrivacyState('provider');
    expect(boundary.view.proposal.fit).toBe('blocked'); // raw fit was deliberately 'ok'
    expect(boundary.context.currentProposal).toHaveProperty('fit', 'blocked');
  });
  it('rejects primitive and malformed shared-fact values and permits the owner', () => {
    const row = { fromRole: 'finance' as const, field: 'capCents', audience: ['customer' as const], briefVersion: 1, seq: 1 };
    for (const value of ['free text', 100, true, [], { kind: 'date', date: '2026-02-30' }, { kind: 'cents', cents: -1 }, { kind: 'itemKeys', itemKeys: [5] }, { kind: 'enum', value: 'arbitrary free text' }]) {
      expect(() => projectSharedFacts('customer', [{ ...row, value }])).toThrow();
    }
    expect(projectSharedFacts('finance', [{ ...row, value: { kind: 'cents', cents: 100 } }])).toHaveLength(1);
  });
  it('enforces the request audience, system identity, and nested-value boundary', () => {
    const data = { kind: 'agent_failed', toRole: 'finance', status: 'open', answeredBy: 'SECRET-USER' };
    expect(projectForRole('provider', { family: 'humanRequests', data })).toEqual({ kind: 'run_waiting' });
    expect(projectForRole('customer', { family: 'humanRequests', data })).toEqual({ kind: 'agent_failed', toRole: 'finance' });
    expect(projectForRole('finance', { family: 'humanRequests', data })).not.toHaveProperty('answeredBy');
    expect(() => projectForRole('customer', { family: 'humanRequests', data: { ...data, kind: { private: 'secret' } } })).toThrow();
  });
  it('rejects unprojected and non-target request contexts and bounds agent inputs', () => {
    const base: AgentView = { role: 'customer', protocol: projectFixture({}), principal: projectFixture({}), sharedFacts: [], budget: projectFixture({ capCents: 5, minAllowedCapCents: 123 }), catalog: [], currentProposal: null, recentProposals: [], feedback: null, candidates: [], openRequestForMe: null };
    expect(buildAgentContext('customer', base).budget).not.toHaveProperty('minAllowedCapCents');
    for (const request of [{ kind: 'run_waiting' }, { kind: 'infeasible', toRole: 'finance', status: 'open' }, { kind: 'infeasible', toRole: 'customer', status: 'answered' }]) expect(() => buildAgentContext('customer', { ...base, openRequestForMe: projectFixture(request) })).toThrow();
    expect(() => buildAgentContext('customer', { ...base, openRequestForMe: { toRole: 'customer', status: 'open' } as unknown as AgentView['openRequestForMe'] })).toThrow();
    expect(() => projectPrivacyState('provider', { ...initialState, title: '😀'.repeat(90) })).toThrow();
    const provider = projectPrivacyState('provider', { ...initialState, title: '😀'.repeat(80) }).context;
    expect(provider.protocol).toHaveProperty('clarifyTopics', ['deadline_value']);
    const title = verifyUntrustedBlock(provider.catalogTitles);
    expect(title.ok).toBe(true);
    if (title.ok) expect(Object.values(JSON.parse(title.decoded) as Record<string, string>)[0]).toBe('😀'.repeat(80));
  });
  it('validates every lineage and declassification entry against the matrix', () => {
    const registry = DISCLOSURE as Readonly<Record<string, Readonly<Record<string, FieldRule>>>>;
    function rule(path: string): FieldRule {
      const [family, field] = path.split('.');
      const entry = family === 'budget' ? disclosureRules('budget', plugin)[field!] : registry[family!]?.[field!];
      expect(entry, path).toBeDefined();
      return entry!;
    }
    expect(derivedAudience([])).toEqual([]);
    for (const entry of Object.values(DECLASSIFIERS)) expect(entry.extract).toBeTypeOf('function');
    for (const [path, sources] of Object.entries(DERIVED_FROM)) {
      const target = rule(path);
      for (const owner of ROLES) {
        const audiences = sources.map(source => {
          if (source.startsWith('viewFor(')) return [owner];
          const sourceRule = rule(source);
          const sourceOwner = source.startsWith('briefs.') ? 'customer' : owner;
          return ROLES.filter(role => canSee(role, sourceRule.audience, sourceOwner));
        });
        const permitted = derivedAudience(audiences);
        for (const role of ROLES) if (canSee(role, target.audience, owner)) expect(permitted, `${path}:${role}`).toContain(role);
      }
    }
  });
  it('rejects impossible dates, oversized keys and non-enumerated event values', () => {
    const proposal = { type: 'proposal_created', proposalVersion: 1, origin: 'agent', authorRole: 'provider', itemKeys: ['audit'], modifiers: [], amountCents: 90000, deliveryDate: '2026-02-30' };
    expect(isEventPayload(proposal)).toBe(false);
    expect(isEventPayload({ ...proposal, deliveryDate: '2026-02-28' })).toBe(true);
    expect(isEventPayload({ type: 'task_completed', taskKey: 'a'.repeat(129) })).toBe(false);
    expect(isEventPayload({ type: 'room_created', scenarioKey: 'SECRET', scenarioVersion: 1 })).toBe(false);
    expect(isEventPayload({ type: 'pii_redacted', table: 'users', field: 'title' })).toBe(false);
    expect(isEventPayload({ type: 'pii_redacted', table: 'briefs', field: 'softFields.notes' })).toBe(true);
    expect(isEventPayload({ type: 'approval_recorded', proposalVersion: 1, role: 'customer', decision: 'reject', boundConstraintsVersion: 1, reasonKey: 'SECRET' })).toBe(false);
  });
});
