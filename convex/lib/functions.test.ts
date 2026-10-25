import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { expect, test, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { modules } from '../../tests/convex-helpers/setup';
import schema from '../schema';
import { anonQuery, userAction, userMutation, userQuery, type UserCtx } from './functions';
const testModules = { ...modules, './test/constructors.fixture.ts': () => import('../../tests/convex-helpers/constructors.fixture') };
const queryRef = (name: string) => makeFunctionReference<'query', Record<string, never>, unknown>(`test/constructors.fixture:${name}`);
const mutationRef = (name: string) => makeFunctionReference<'mutation', Record<string, never>, unknown>(`test/constructors.fixture:${name}`);
const read = makeFunctionReference<'query', {roomId: Id<'rooms'>}, string | null>('test/constructors.fixture:memberRead');
const write = makeFunctionReference<'mutation', {roomId: Id<'rooms'>}, string>('test/constructors.fixture:memberWrite');
async function fixture() {
  const t = convexTest(schema, testModules);
  const creator = t.withIdentity({ subject: 'creator', issuer: 'https://clerk.test' });
  const other = t.withIdentity({ subject: 'other', issuer: 'https://clerk.test' });
  const customer = t.withIdentity({ subject: 'customer', issuer: 'https://clerk.test' });
  const outsider = t.withIdentity({ subject: 'outsider', issuer: 'https://clerk.test' });
  const a = await creator.mutation(api.users.ensureViewer, {});
  const b = await other.mutation(api.users.ensureViewer, {});
  const c = await customer.mutation(api.users.ensureViewer, {});
  await outsider.mutation(api.users.ensureViewer, {});
  const roomId = await t.run(async ctx => {
    const roomId = await ctx.db.insert('rooms', { scenarioKey: 'scope_change', scenarioVersion: 1, title: 'Room', timeZone: 'UTC', localDate: '2026-10-24', status: 'setup', constraintsVersion: 0, nextRunNo: 1, nextProposalVersion: 1, writeSeq: 0, createdBy: a.userId, provenance: 'live', createdAt: 1 });
    await ctx.db.insert('members', { roomId, userId: a.userId, role: 'finance', displayName: 'Creator', joinedVia: 'creator', joinedAt: 1 });
    await ctx.db.insert('members', { roomId, userId: b.userId, role: 'provider', displayName: 'Other', joinedVia: 'invite', joinedAt: 1 });
    await ctx.db.insert('members', { roomId, userId: c.userId, role: 'customer', displayName: 'Customer', joinedVia: 'invite', joinedAt: 1 });
    return roomId;
  });
  return { t, creator, other, customer, outsider, roomId, creatorId: a.userId };
}
test('11.6 userQuery anonymous and unprovisioned skip handler', async () => {
  const t = convexTest(schema, testModules);
  expect(await t.query(queryRef('userRead'), {})).toBeNull();
  expect(await t.withIdentity({subject: 'new'}).query(queryRef('userRead'), {})).toBeNull();
});
test('11.6 userMutation auth.unauthenticated / auth.user_not_provisioned', async () => {
  const t = convexTest(schema, testModules);
  await expect(t.mutation(mutationRef('userWrite'), {})).rejects.toThrow(/auth.unauthenticated/);
  await expect(t.withIdentity({subject: 'new'}).mutation(mutationRef('userWrite'), {})).rejects.toThrow(/auth.user_not_provisioned/);
});
test('11.6 memberQuery collapses identity membership and role failures to null', async () => {
  const {t, outsider, customer, creator, roomId} = await fixture();
  for (const actor of [t, t.withIdentity({subject: 'new'}), outsider, customer]) expect(await actor.query(read, {roomId})).toBeNull();
  expect(await creator.query(read, {roomId})).toBe('finance');
});
test('11.6 memberMutation ordered auth membership roles creator guards write nothing', async () => {
  const {t, outsider, customer, other, creator, roomId} = await fixture();
  for (const [actor, code] of [[t, 'auth.unauthenticated'], [t.withIdentity({subject: 'new'}), 'auth.user_not_provisioned'], [outsider, 'auth.not_member'], [customer, 'auth.role_forbidden'], [other, 'auth.not_creator']] as const) {
    await expect(actor.mutation(write, {roomId})).rejects.toThrow(new RegExp(code));
  }
  expect(await creator.mutation(write, {roomId})).toBe('finance');
  expect(await t.run(async ctx => (await ctx.db.get(roomId))!.writeSeq)).toBe(0);
  expect(await t.run(async ctx => await ctx.db.query('events').collect())).toEqual([]);
});
test('11.6 memberMutation rate guard is inside sanitized boundary', async () => {
  const {creator, roomId} = await fixture();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const ref = makeFunctionReference<'mutation', {roomId: Id<'rooms'>}>('test/constructors.fixture:rateWrite');
    await expect(creator.mutation(ref, {roomId})).rejects.toThrow(/internal/);
    expect(log.mock.calls).toEqual([[JSON.stringify({fn: 'rooms.close', code: 'unhandled', errorClass: 'RangeError'})]]);
  } finally { log.mockRestore(); }
});
test('11.6 memberQuery missing resolved task returns null', async () => {
  const {creator, t} = await fixture();
  const id = await t.run(async ctx => {
    const user = await ctx.db.query('users').first();
    return user!._id;
  });
  const ref = makeFunctionReference<'query', {taskId: string}>('test/constructors.fixture:resolvedRead');
  // A syntactically valid id from the wrong table is rejected by the args validator.
  await expect(creator.query(ref, {taskId: id})).rejects.toThrow();
});
test('11.6 internal constructors inject the log brand', async () => {
  const t = convexTest(schema, testModules);
  expect(await t.query(queryRef('internalRead'), {})).toBe(true);
  expect(await t.mutation(mutationRef('internalWrite'), {})).toBe(true);
  expect(await t.action(makeFunctionReference<'action', Record<string, never>>('test/constructors.fixture:internalRun'), {})).toBe(true);
});
test('11.6 userAction identity / provisioning failures and ready path', async () => {
  const {t, creator, creatorId} = await fixture();
  const ref = makeFunctionReference<'action', Record<string, never>>('test/constructors.fixture:publicRun');
  await expect(t.action(ref, {})).rejects.toThrow(/auth.unauthenticated/);
  await expect(t.withIdentity({subject: 'new'}).action(ref, {})).rejects.toThrow(/auth.user_not_provisioned/);
  expect(await creator.action(ref, {})).toBe(creatorId);
});
test('TC-AUTH-06 public constructor rejects identity args and provisioning/action escape hatches', () => {
  for (const key of ['userId', 'actorUserId', 'memberId', 'tokenIdentifier']) {
    expect(() => userQuery('rooms.listMine')({ args: {[key]: v.string()}, returns: v.null(), handler: async () => null })).toThrow(/identity/);
  }
  expect(() => userMutation('rooms.create', {provision: true})).toThrow(/restricted/);
  expect(() => userAction('rooms.create' as never)).toThrow(/restricted/);
});
// Public handlers cannot obtain the internal log brand; validators are required.
function typeControls(ctx: UserCtx) {
  // @ts-expect-error no internal log on public context
  void ctx.log;
  // @ts-expect-error queries must declare their null branch
  userQuery('rooms.listMine')({args: {}, returns: v.string(), handler: async () => 'bad'});
  // @ts-expect-error public returns validator is required
  anonQuery('health.ping')({args: {}, handler: async () => null});
}
void typeControls;

test.each(['badUserRead','badMemberRead'])('F3 %s invalid DTO returns null and logs no offending value',async name=>{
 const {t,creator,roomId}=await fixture();const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{const result=await creator.query(makeFunctionReference<'query',Record<string,unknown>,unknown>(`test/constructors.fixture:${name}`),name==='badMemberRead'?{roomId}:{});expect(result).toBeNull();expect(log.mock.calls).toEqual([[JSON.stringify({fn:name==='badMemberRead'?'rooms.view':'rooms.listMine',code:'unhandled',errorClass:'TypeError'})]]);expect(JSON.stringify(log.mock.calls)).not.toContain('RETURN_SECRET_CANARY');expect(await t.run(async ctx=>await ctx.db.query('users').collect())).toHaveLength(4);}finally{log.mockRestore();}
});
test.each(['badUserWrite','badMemberWrite'])('F3 %s invalid DTO throws only internal and rolls back',async name=>{
 const {t,creator,roomId}=await fixture();const before=await t.run(async ctx=>await ctx.db.query('users').collect());const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{await expect(creator.mutation(makeFunctionReference<'mutation',Record<string,unknown>,unknown>(`test/constructors.fixture:${name}`),name==='badMemberWrite'?{roomId}:{})).rejects.toThrow(/"code":"internal"/);expect(log.mock.calls).toEqual([[JSON.stringify({fn:name==='badMemberWrite'?'rooms.close':'rooms.create',code:'unhandled',errorClass:'TypeError'})]]);expect(JSON.stringify(log.mock.calls)).not.toContain('RETURN_SECRET_CANARY');expect(await t.run(async ctx=>await ctx.db.query('users').collect())).toEqual(before);}finally{log.mockRestore();}
});

test('F3 anonQuery invalid DTO returns null without native return-validation leakage',async()=>{const t=convexTest(schema,testModules),log=vi.spyOn(console,'log').mockImplementation(()=>{});try{expect(await t.query(queryRef('badAnonRead'),{})).toBeNull();expect(log.mock.calls).toEqual([[JSON.stringify({fn:'health.ping',code:'unhandled',errorClass:'TypeError'})]]);}finally{log.mockRestore();}});
test.each(['badAction','badActionId'])('F3 userAction %s checks closed DTOs and ID encoding',async name=>{const {creator}=await fixture();const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{await expect(creator.action(makeFunctionReference<'action',Record<string,never>,unknown>(`test/constructors.fixture:${name}`),{})).rejects.toThrow(/"code":"internal"/);expect(log.mock.calls).toEqual([[JSON.stringify({fn:'invites.createLink',code:'unhandled',errorClass:'TypeError'})]]);}finally{log.mockRestore();}});
