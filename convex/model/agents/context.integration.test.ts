import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { expect, test } from 'vitest';
import type { Id } from '../../_generated/dataModel';
import { api } from '../../_generated/api';
import schema from '../../schema';
import { modules } from '../../../tests/convex-helpers/setup';
import { seedRoom } from '../../../tests/convex-helpers/seed';
import { asRole } from '../../../tests/convex-helpers/roles';
import { main } from '../../../core/scenarios/scope-change/fixtures/main';
import { addDays, isoDate, type AgentTurnInput } from '../../../core/engine';
import { openRoomTx } from '../../lib/db';
import { appendCatalogRow } from '../catalog';

const load = makeFunctionReference<'query', { roomId: Id<'rooms'> }, { inputJson: string; promptJson: string; optionKey: string | null } | null>('test/agentContext.fixture:load');
async function setup() {
  const t = convexTest(schema, { ...modules, './test/agentContext.fixture.ts': () => import('../../../tests/convex-helpers/agentContext.fixture') });
  const seeded = await seedRoom(t, main, { until: 'catalog' });
  await seeded.actors.provider.mutation(api.briefs.confirm, {
    roomId: seeded.roomId, expectedConstraintsVersion: 0,
    hardFields: { schemaKey: 'scope_change.provider.v1' },
    softFields: { schemaKey: 'scope_change.provider.v1', notes: 'PROVIDER_OWN_NOTE' }, disclosures: {},
  });
  await seeded.actors.customer.mutation(api.briefs.confirm, {
    roomId: seeded.roomId, expectedConstraintsVersion: 0,
    hardFields: { schemaKey: 'scope_change.customer.v1', requiredItemKeys: ['audit_log_export'], deadline: addDays(isoDate(seeded.localDate), 21) },
    softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: ['usage_dashboard'], notes: 'CUSTOMER_PRIVATE_CANARY' }, disclosures: {},
  });
  await seeded.actors.finance.mutation(api.briefs.confirm, {
    roomId: seeded.roomId, expectedConstraintsVersion: 0,
    hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 480_000 },
    softFields: { schemaKey: 'scope_change.finance.v1', notes: 'FINANCE_PRIVATE_CANARY' },
    disclosures: { capCents: ['customer'], committedCents: ['customer'], headroomCents: ['customer'] },
  });
  return { t, ...seeded };
}

test('W2-1 loaded agent input respects fact disclosure and withdrawal; sharedSoft changes stub ranking', async () => {
  const s = await setup();
  const read = async () => (await s.actors.provider.query(load, { roomId: s.roomId }))!;
  const hidden = await read();
  expect(hidden.optionKey).toBe('O1');
  expect(hidden.inputJson).toContain('PROVIDER_OWN_NOTE');
  expect(hidden.inputJson).not.toMatch(/CUSTOMER_PRIVATE_CANARY|FINANCE_PRIVATE_CANARY|480000|400000/);
  await s.actors.customer.mutation(api.sharedFacts.add, { roomId: s.roomId, field: 'preferredItemKeys', audience: ['provider'], confirmOwnDisclosure: true });
  const disclosed = await read();
  expect(disclosed.optionKey).toBe('O2');
  const input = JSON.parse(disclosed.inputJson) as AgentTurnInput;
  expect(input.sharedFacts).toContainEqual({ fromRole: 'customer', field: 'preferredItemKeys', value: { kind: 'itemKeys', itemKeys: ['usage_dashboard'] }, asOfBriefVersion: null });
  const customer = JSON.parse((await s.actors.customer.query(load, { roomId: s.roomId }))!.inputJson) as AgentTurnInput;
  expect(customer.budget).toEqual({ capCents: 480_000, committedCents: 400_000, headroomCents: 80_000 });
  expect(customer.principal.notes).toBe('CUSTOMER_PRIVATE_CANARY');
  await s.actors.customer.mutation(api.sharedFacts.add, { roomId: s.roomId, field: 'preferredItemKeys', audience: [], confirmOwnDisclosure: true });
  expect((await read()).optionKey).toBe('O1');
});

test('W2-1 confirmed catalog revisions supply prompt titles; reads preserve the room lock and events', async () => {
  const s = await setup();
  const row = main.catalog.find(r => r.itemKey === 'sso_login')!;
  await s.actors.provider.mutation(api.catalog.confirm, { roomId: s.roomId, expectedConstraintsVersion: (await s.t.run(ctx=>ctx.db.get(s.roomId)))!.constraintsVersion, rows: [{ itemKey: row.itemKey, kind: row.kind, title: 'Confirmed revision two', priceCents: row.priceCents + 1, leadDays: row.leadDays, taskTemplates: [] }] });
  await s.t.run(async ctx => {
    const tx = await openRoomTx(ctx, s.roomId, { allow: ['open'] });
    await appendCatalogRow(tx, { userId: s.users.provider.userId }, { itemKey: 'secret_draft', kind: 'item', title: 'DRAFT_TITLE_CANARY', priceCents: 1, leadDays: 1, taskTemplates: [] }, undefined, 'draft');
  });
  const state = async () => await s.t.run(async ctx => ({ room: await ctx.db.get(s.roomId), events: await ctx.db.query('events').collect() }));
  const before = await state();
  const result = (await s.actors.provider.query(load, { roomId: s.roomId }))!;
  const input = JSON.parse(result.inputJson) as AgentTurnInput;
  expect(input.catalog.filter(r => r.itemKey === row.itemKey)).toHaveLength(1);
  expect(input.catalog.find(r => r.itemKey === row.itemKey)?.revision).toBe(2);
  expect(input.catalogTitlesMap?.[row.itemKey]).toBe('Confirmed revision two');
  expect(result.promptJson).not.toContain('DRAFT_TITLE_CANARY');
  expect(result.promptJson).not.toContain(row.title);
  expect(await state()).toEqual(before);
  await asRole(s.t, 'outsider').mutation(api.users.ensureViewer, {});
  expect(await asRole(s.t, 'outsider').query(load, { roomId: s.roomId })).toBeNull();
  expect(await s.t.query(load, { roomId: s.roomId })).toBeNull();
});

test('TC-PRIV-26 latest guidance reaches only its principal prompt', async () => {
 const s=await setup();
 for(const owner of ['customer','finance'] as const){
  const needle=`CANARY-${owner}-GUIDANCE-2219`;
  await s.actors[owner].mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:`<${needle}>`});
  for(const role of ['customer','finance','provider'] as const){
   const value=(await s.actors[role].query(load,{roomId:s.roomId}))!;
   expect(value.inputJson.includes(needle)).toBe(role===owner);
   expect(value.promptJson.includes(needle)).toBe(role===owner);
   if(role===owner)expect(value.promptJson).not.toContain(`<${needle}>`);
  }
 }
});
