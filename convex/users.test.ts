import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { modules } from '../tests/convex-helpers/setup';

const identity = { subject: 'alice', issuer: 'https://example.clerk.accounts.dev', name: '  A\u0301lice  ', emailVerified: true };
test('12.5 users.viewer anonymous / unprovisioned / ready branches', async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.users.viewer, {})).toBeNull();
  const actor = t.withIdentity(identity);
  expect(await actor.query(api.users.viewer, {})).toEqual({ status: 'unprovisioned' });
  const { userId } = await actor.mutation(api.users.ensureViewer, {});
  expect(await actor.query(api.users.viewer, {})).toEqual({ status: 'ready', userId, displayName: 'Álice', emailVerified: true });
});
test('12.5 users.ensureViewer auth.unauthenticated writes nothing', async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.users.ensureViewer, {})).rejects.toThrow(/auth.unauthenticated/);
  expect(await t.run(async ctx => await ctx.db.query('users').collect())).toEqual([]);
});
test('12.5 users.ensureViewer unchanged writes no rows or timestamps', async () => {
  const t = convexTest(schema, modules);
  const actor = t.withIdentity(identity);
  const first = await actor.mutation(api.users.ensureViewer, {});
  const before = await t.run(async ctx => await ctx.db.get(first.userId));
  expect(await actor.mutation(api.users.ensureViewer, {})).toEqual({ userId: first.userId, changed: false });
  expect(await t.run(async ctx => await ctx.db.get(first.userId))).toEqual(before);
  expect(await t.run(async ctx => await ctx.db.query('events').collect())).toEqual([]);
});
test('12.5 users.ensureViewer changed claims update the same user', async () => {
  const t = convexTest(schema, modules);
  const first = await t.withIdentity(identity).mutation(api.users.ensureViewer, {});
  const changed = await t.withIdentity({ ...identity, name: 'Changed' }).mutation(api.users.ensureViewer, {});
  expect(changed).toEqual({ userId: first.userId, changed: true });
  expect((await t.run(async ctx => await ctx.db.get(first.userId)))!.displayName).toBe('Changed');
});
test('12.5 users.ensureViewer fallback name and issuer-based test flag', async () => {
  const t = convexTest(schema, modules);
  const { userId } = await t.withIdentity({ subject: 'prod', issuer: 'https://auth.example.com', name: '', email: 'fake+clerk_test@example.com' }).mutation(api.users.ensureViewer, {});
  expect(await t.run(async ctx => await ctx.db.get(userId))).toMatchObject({ displayName: 'Member', isTestAccount: false });
  const { userId: devId } = await t.withIdentity(identity).mutation(api.users.ensureViewer, {});
  expect(await t.run(async ctx => await ctx.db.get(devId))).toMatchObject({ isTestAccount: true });
});
test('12.5 users.ensureViewer duplicate token rows fail closed without writes', async () => {
  const t = convexTest(schema, modules);
  const actor = t.withIdentity(identity);
  const { userId } = await actor.mutation(api.users.ensureViewer, {});
  await t.run(async ctx => {
    const { _id, _creationTime, ...fields } = (await ctx.db.get(userId))!;
    void _id; void _creationTime;
    await ctx.db.insert('users', fields);
  });
  await expect(actor.mutation(api.users.ensureViewer, {})).rejects.toThrow(/internal/);
  expect(await t.run(async ctx => (await ctx.db.query('users').collect()).length)).toBe(2);
});

test('TC-AUTH-06 public args have no identity keys (snapshot)', async () => {
  const users = await import('./users');
  const health = await import('./health');
  const args: Record<string, unknown> = {};
  for (const [name, entry] of [['users.viewer', users.viewer], ['users.ensureViewer', users.ensureViewer], ['health.ping', health.ping]] as const) {
    const exported = entry as unknown as {exportArgs(): string};
    args[name] = JSON.parse(exported.exportArgs());
  }
  expect(args).toMatchInlineSnapshot(`
    {
      "health.ping": {
        "type": "object",
        "value": {},
      },
      "users.ensureViewer": {
        "type": "object",
        "value": {},
      },
      "users.viewer": {
        "type": "object",
        "value": {},
      },
    }
  `);
});
test('SC-T15 public returns omit commit timestamps and restricted history', async () => {
  const users = await import('./users');
  const health = await import('./health');
  for (const entry of [users.viewer, users.ensureViewer, health.ping]) {
    const exported = entry as unknown as {exportReturns(): string};
    expect(exported.exportReturns()).not.toMatch(/commitTs|int64|rawOutputs|ledgerEntries|constraintRevisions/);
  }
});
