import { describe, expect, it } from 'vitest';
import { buildAgentContext } from '../src/agent.ts';
import { makeFixture, secretsOf } from '../src/fixture.ts';
import { collectSurfaces, execute, newRoom, processTurn, projectRoomFor } from '../src/pipeline.ts';
import { formatHit, scan } from '../src/scanner.ts';
import { leakyRoleAConstraintsChanged } from '../src/templates.ts';

describe('agent context isolation (buildAgentContext)', () => {
  const fx = makeFixture();
  const secrets = secretsOf(fx);
  it('provider context contains no finance or customer secret in any spelling', () => {
    const ctx = buildAgentContext(fx, 'provider');
    const r = scan(secrets, [{ id: 'ctx:provider', kind: 'agent_context', audience: ['provider'], content: ctx }]);
    expect(r.violations).toEqual([]);
    expect(new Set(r.hits.map((h) => h.secretId))).toEqual(new Set(['provider.canary', 'provider.floorCents', 'provider.internalCostCents']));
    expect(JSON.stringify(ctx)).not.toContain('CANARY-FIN-7731');
  });
  it('customer context has budget only when customerSeesBudget', () => {
    const on = scan(secrets, [{ id: 'c', kind: 'agent_context', audience: ['customer'], content: buildAgentContext(fx, 'customer') }]);
    expect(on.violations).toEqual([]);
    expect(on.hits.some((h) => h.secretId === 'finance.capCents.v2')).toBe(true);
    const fx2 = makeFixture({ customerSeesBudget: false });
    const off = scan(secretsOf(fx2), [{ id: 'c', kind: 'agent_context', audience: ['customer'], content: buildAgentContext(fx2, 'customer') }]);
    expect(off.hits.some((h) => h.secretId.startsWith('finance.'))).toBe(false);
  });
  it('finance canary never appears in customer context even though customer sees the budget', () => {
    expect(JSON.stringify(buildAgentContext(fx, 'customer'))).not.toContain('CANARY-FIN-7731');
  });
});

describe('end-to-end round: propose -> cap cut -> re-propose -> execute; scan everything', () => {
  it('zero violations across DTOs, contexts, records and logs', () => {
    const fx = makeFixture();
    const st = newRoom(fx);
    fx.constraints = { version: 1, capCents: 500000, committedCents: 400000 };
    const p1 = processTurn(st, 'provider', JSON.stringify({ action: 'propose', itemKeys: ['LOGIN', 'REPORTS'], deferredItemKeys: ['EXPORT'], deliveryDate: '2026-11-14', rationale: 'Our floor $817 is covered.' }));
    expect(p1.reasonCodes).toContain('FITS_BUDGET');
    // finance lowers the cap (constraint v2)
    fx.constraints = { version: 2, capCents: 480000, committedCents: 400000 };
    st.events.push({ type: 'constraints_changed', actorRole: 'finance', payload: { fromCapCents: 500000, toCapCents: 480000, committedCents: 400000, constraintsVersion: 2, blockedProposalVersion: 1, blockedAmountCents: 90000 } });
    const p2 = processTurn(st, 'provider', JSON.stringify({ action: 'propose', itemKeys: ['LOGIN', 'EXPORT'], deferredItemKeys: ['REPORTS'], deliveryDate: '2026-11-14', rationale: 'Swap to cheaper scope.' }));
    expect(p2.reasonCodes).toContain('FITS_BUDGET');
    processTurn(st, 'finance', JSON.stringify({ action: 'recommend_accept', itemKeys: [], deferredItemKeys: [], deliveryDate: null, rationale: 'Headroom $800 covers $750.' }));
    execute(st, 2);
    execute(st, 2); // idempotent

    const surfaces = collectSurfaces(st);
    const r = scan(secretsOf(fx), surfaces);
    console.log(`surfaces=${r.scannedSurfaces} leaves=${r.scannedLeaves} hits=${r.hits.length} violations=${r.violations.length}`);
    for (const role of ['customer', 'provider', 'finance'] as const) console.log(role, 'events:', JSON.stringify(projectRoomFor(st, role).events));
    console.log('public summaries:', st.proposals.map((p) => p.publicSummary));
    console.log('logs:', JSON.stringify(st.logs));
    expect(r.violations.map(formatHit)).toEqual([]);
    expect(st.commitments).toHaveLength(1);
    expect(st.approvals).toHaveLength(0);
  });

  it('negative control: injecting a Role-A style event into the provider DTO is caught', () => {
    const fx = makeFixture();
    const st = newRoom(fx);
    const payload = { fromCapCents: 500000, toCapCents: 480000, committedCents: 400000, constraintsVersion: 2, blockedProposalVersion: 1, blockedAmountCents: 90000 };
    const surfaces = collectSurfaces(st);
    const dto = surfaces.find((s) => s.id === 'rooms.view:provider')!;
    (dto.content as { events: string[] }).events.push(leakyRoleAConstraintsChanged(payload));
    const r = scan(secretsOf(fx), surfaces);
    console.log(r.violations.map(formatHit).join('\n'));
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations.every((v) => v.surfaceId === 'rooms.view:provider')).toBe(true);
  });
});
