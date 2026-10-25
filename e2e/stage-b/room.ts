import { ConvexHttpClient } from 'convex/browser';
import type { Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { api } from '../../convex/_generated/api';
import { main } from '../../core/scenarios/scope-change/fixtures';
import { addDays, isoDate } from '../../core/engine';
import { expect, type HarnessTestFixtures } from '../src/fixtures';
import { ROLE_SLOTS } from '../src/roles';
export { api };

/** Arrange each scenario in a fresh room using the same public API as the UI. */
export async function roomFixture(roles: HarnessTestFixtures['roles']) {
 const url = process.env.NEXT_PUBLIC_CONVEX_URL;
 if (!url) throw new Error('Stage B E2E requires NEXT_PUBLIC_CONVEX_URL');
 const clients = {} as Record<typeof ROLE_SLOTS[number], ConvexHttpClient>;
 for (const role of ROLE_SLOTS) {
  await roles[role].page.goto('./rooms');
  await clerk.loaded({ page: roles[role].page });
  await roles[role].page.waitForFunction(() => !!(window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session);
  const token = await roles[role].page.evaluate(async () => {
   const clerk = (window as unknown as { Clerk: { session: { getToken(args: { template: string }): Promise<string | null> } } }).Clerk;
   return clerk.session.getToken({ template: 'convex' });
  });
  if (!token) throw new Error(`Missing Convex JWT for ${role}`);
  const client = new ConvexHttpClient(url); client.setAuth(token); clients[role] = client;
  await client.mutation(api.users.ensureViewer, {});
 }
 const { roomId } = await clients.customer.mutation(api.rooms.create, { title: 'Stage B E2E', scenarioKey: 'scope_change', timeZone: 'UTC', myRole: 'customer' });
 for (const role of ['provider', 'finance'] as const) {
  const email = process.env[`E2E_ROLE_${role.toUpperCase()}_IDENTIFIER`];
  if (!email) throw new Error(`Missing ${role} test identity`);
  const { inviteId } = await clients.customer.mutation(api.invites.create, { roomId, role, invitedEmail: email });
  await clients[role].mutation(api.invites.accept, { invite: { by: 'email', inviteId } });
 }
 await clients.finance.mutation(api.ledger.recordBaseline, { roomId, amountCents: 400000 });
 await clients.provider.mutation(api.catalog.confirm, { roomId, expectedConstraintsVersion: 0, rows: main.catalog.map(row => ({ itemKey: row.itemKey, kind: row.kind, title: row.title, priceCents: row.priceCents, leadDays: row.leadDays, taskTemplates: row.taskTemplates.map(task => ({ ...task })) })) });
 const localDate = isoDate(new Date().toISOString().slice(0, 10));
 for (const role of ROLE_SLOTS) {
  const hardFields = role === 'customer' ? { schemaKey: 'scope_change.customer.v1' as const, requiredItemKeys: ['audit_log_export', 'sso_login'], deadline: addDays(localDate, 18) } : role === 'finance' ? { schemaKey: 'scope_change.finance.v1' as const, capCents: 500000 } : { schemaKey: 'scope_change.provider.v1' as const };
  const softFields = role === 'customer' ? { schemaKey: 'scope_change.customer.v1' as const, preferredItemKeys: ['usage_dashboard'], notes: 'CANARY-CUS-2219' } : role === 'finance' ? { schemaKey: 'scope_change.finance.v1' as const, notes: 'CANARY-FIN-7731' } : { schemaKey: 'scope_change.provider.v1' as const, notes: 'CANARY-PRV-5582' };
  await clients[role].mutation(api.briefs.confirm, { roomId, expectedConstraintsVersion: 0, hardFields, softFields, disclosures: role === 'customer' ? { requiredItemKeys: ['provider'], deadline: ['provider'] } : {} });
 }
 const view = (role: typeof ROLE_SLOTS[number]) => clients[role].query(api.rooms.view, { roomId });
 const pending = async () => { await expect.poll(async () => (await view('customer'))?.run?.status).toBe('pending_approval'); };
 const approve = async (role: typeof ROLE_SLOTS[number]) => {
  const current = (await view(role))!;
  const proposal = current.currentProposal!;
  return clients[role].mutation(api.approvals.record, { proposalId: proposal.proposalId, decision: 'approve', expectedConstraintsVersion: current.header.constraintsVersion, expectedTermsKey: proposal.termsKey, reasonKey: null, note: null });
 };
 const open = async (page: Page, suffix = '') => page.goto(`./rooms/${roomId}${suffix}`);
 return { clients, roomId, view, pending, approve, open };
}
