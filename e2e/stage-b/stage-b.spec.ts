import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ciEnabled, domSample, eachRole, expect, expectNoMarkers, test } from '../src/index';
import type { Id } from '../../convex/_generated/dataModel';
import { roomFixture, api } from './room';

const configured = !!process.env.BASE_URL && process.env.E2E_AUTH === 'clerk' && !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CONVEX_URL;
if (!configured && ciEnabled()) throw new Error('Stage B E2E requires BASE_URL, Clerk test environment, and NEXT_PUBLIC_CONVEX_URL');
test.skip(!configured, 'Stage B needs BASE_URL and Clerk test environment');

test.beforeEach(({ baseURL, harnessConfig }) => {
 const ready = baseURL && harnessConfig.auth.mode === 'clerk' && process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CONVEX_URL;
 if (ready) return;
 if (ciEnabled()) throw new Error('Stage B E2E requires BASE_URL, Clerk test environment, and NEXT_PUBLIC_CONVEX_URL');
 test.skip(true, 'Stage B needs BASE_URL and Clerk test environment');
});

test('E2E-01 main flow: three sessions observe proposal, approvals, and execution', async ({ roles }) => {
 const h = await roomFixture(roles);
 await test.step('16.9 E2E-01 three parties confirm and see the stub proposal', async () => {
  await h.pending(); await eachRole(roles, role => h.open(role.page));
  await eachRole(roles, async role => { await expect(role.page.getByTestId('pane-decide')).toBeVisible(); });
 });
 await test.step('16.9 E2E-01 approval progress reaches one internal execution without refresh', async () => {
  for (const role of ['customer', 'provider', 'finance'] as const) await h.approve(role);
  await eachRole(roles, async role => { await expect(role.page.getByText('Agreement executed', { exact: true })).toBeVisible(); });
 });
});

test('E2E-02 budget cut flips all sessions and invalidates the open decision dialog', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending(); await h.approve('customer'); await h.approve('provider');
 const proposal = (await h.view('finance'))!.currentProposal!;
 await h.open(roles.finance.page, `/proposals/${proposal.proposalId}`);
 await roles.finance.page.getByTestId('reject-button').click();
 await eachRole(roles, async role => { if (role.slot !== 'finance') await h.open(role.page); });
 await test.step('13.16 three-window and dialog flip', async () => {
  await h.clients.finance.mutation(api.budget.setCap, { roomId: h.roomId, capCents: 480000, expectedConstraintsVersion: 1 });
  await expect.poll(async () => { const button = roles.finance.page.getByTestId('confirm-reject-button'); return await button.count() === 0 || await button.getAttribute('aria-disabled') === 'true'; }).toBe(true);
  await expect(roles.finance.page.getByTestId('stale-banner')).toContainText('Constraints changed to v2 while you were reviewing. Review again before deciding.');
  await expect(roles.finance.page.getByText(/No longer applies/).first()).toBeVisible();
  for (const role of ['customer', 'provider'] as const) await expect(roles[role].page.getByText(/Constraints v2/i).first()).toBeVisible();
  expect(await domSample(roles.provider.page)).not.toMatch(/\$4,900|\$4,800|\$100/);
 });
});

test('E2E-03 repeated final vote yields the same single execution', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending(); await h.approve('customer'); await h.approve('provider');
 const proposal = (await h.view('finance'))!.currentProposal!;
 await h.open(roles.finance.page, `/proposals/${proposal.proposalId}`);
 await roles.finance.page.getByTestId('approval-button').dblclick();
 await expect.poll(async () => (await h.view('finance'))?.header.status).toBe('executed');
 const first = await h.clients.finance.query(api.executions.forRoom, { roomId: h.roomId });
 await h.clients.finance.mutation(api.approvals.record, { proposalId: proposal.proposalId, decision: 'approve', expectedConstraintsVersion: 1, expectedTermsKey: proposal.termsKey, reasonKey: null, note: null });
 expect(await h.clients.finance.query(api.executions.forRoom, { roomId: h.roomId })).toEqual(first);
});

test('E2E-04 refresh and reconnect restore server progress', async ({ roles }) => {
 const h = await roomFixture(roles);
 await eachRole(roles, async role => { await h.open(role.page); await role.page.reload(); });
 await h.pending();
 const before = (await h.view('customer'))!.run!.runId;
 await eachRole(roles, async role => { await role.context.setOffline(true); await role.context.setOffline(false); await role.page.reload(); });
 expect((await h.view('customer'))!.run!.runId).toBe(before);
});

test('E2E-06 stub proposal, catalog, change order, and tasks carry Simulated labels', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending();
 await eachRole(roles, async role => { await h.open(role.page); await expect(role.page.getByText('Simulated', { exact: true }).first()).toBeVisible(); });
 for (const role of ['customer', 'provider', 'finance'] as const) await h.approve(role);
 await eachRole(roles, async role => { await h.open(role.page, '/results'); await expect(role.page.getByTestId('change-order-disclaimer')).toContainText('Internal record only.'); await expect(role.page.getByText('Simulated', { exact: true }).first()).toBeVisible(); });
});

test('E2E-07 S7 transport and DOM privacy scan across buyer and provider sessions', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending();
 await eachRole(roles, role => h.open(role.page));
 await h.clients.finance.mutation(api.budget.setCap, { roomId: h.roomId, capCents: 470000, expectedConstraintsVersion: 1 });
 await expect.poll(async () => (await h.view('customer'))?.run?.status).toBe('needs_input');
 for (const role of ['customer', 'provider'] as const) {
  const forbidden = role === 'provider' ? ['CANARY-CUS-2219', 'CANARY-FIN-7731', '500000', '470000', '400000', '$4,700', '$4,000'] : ['CANARY-PRV-5582', 'CANARY-FIN-7731', '500000', '470000', '400000'];
  expectNoMarkers(roles[role].transport, await domSample(roles[role].page), forbidden);
  expect(roles[role].consoleErrors).toEqual([]); expect(roles[role].pageErrors).toEqual([]);
 }
});

test('E2E-09 decision wording binds versions and final-vote consequences', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending();
 const view = (await h.view('customer'))!;
 const proposal = view.currentProposal!;
 await h.open(roles.customer.page, `/proposals/${proposal.proposalId}`);
 await expect(roles.customer.page.getByTestId('approval-button')).toHaveText(`Approve v${proposal.version} under constraints v${view.header.constraintsVersion}`);
 await expect(roles.customer.page.getByText('Suggestion only, never counted as approval')).toBeVisible();
 await h.approve('provider'); await h.approve('finance');
 await expect(roles.customer.page.getByText(/Your approval completes the set/)).toBeVisible();
});

test('E2E-10 rooms and room accessibility: serious and critical violations are absent', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending();
 // axe-core 4.14.0 is already in the frozen lockfile/store; no dependency install.
 const axe = readFileSync(resolve('node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js'), 'utf8');
 for (const route of ['./rooms', `./rooms/${h.roomId}`]) {
  await roles.customer.page.goto(route);
  await expect(roles.customer.page.getByRole('main')).toBeVisible();
  await roles.customer.page.addScriptTag({ content: axe });
  const violations = await roles.customer.page.evaluate(async () => {
   const engine = (window as unknown as { axe: { run(): Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
   return (await engine.run()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  });
  expect(violations).toEqual([]);
 }
});

test('E2E-11 follow-up room preserves seats, draft catalog, and read-only executed source', async ({ roles }) => {
 const h = await roomFixture(roles); await h.pending();
 for (const role of ['customer', 'provider', 'finance'] as const) await h.approve(role);
 await h.open(roles.customer.page, '/results');
 await roles.customer.page.getByTestId('start-follow-up-btn').click();
 await expect(roles.customer.page).not.toHaveURL(new RegExp(`${h.roomId}/results`));
 const followUpId = new URL(roles.customer.page.url()).pathname.match(/\/rooms\/([^/]+)/)?.[1] as Id<'rooms'> | undefined;
 expect(followUpId).toBeTruthy();
 const next = (await h.clients.finance.query(api.rooms.view, { roomId: followUpId! }))!;
 expect(next.members).toHaveLength(3);
 const catalog = (await h.clients.provider.query(api.catalog.list, { roomId: followUpId! }))!;
 expect(catalog.mine!.drafts.length).toBeGreaterThan(0);
 expect(catalog.mine!.drafts.some(row => row.itemKey === 'sso_login')).toBe(false);
 await h.clients.finance.mutation(api.ledger.recordBaseline, { roomId: followUpId!, amountCents: 490000 });
 expect((await h.view('customer'))!.header.status).toBe('executed');
 await h.open(roles.provider.page, '/results');
 await expect(roles.provider.page.getByTestId('change-order-disclaimer')).toBeVisible();
});
