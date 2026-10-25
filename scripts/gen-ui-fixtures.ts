/** Run with UPDATE_UI_FIXTURES=1 pnpm exec vitest run --config tests/vitest.config.ts tests/ui/generated.test.tsx.
 * Uses the production public API and W2-1 bootstrap; never writes backend tables.
 */
import { convexTest } from 'convex-test';
import { vi } from 'vitest';
import schema from '../convex/schema';
import { modules } from '../tests/convex-helpers/setup';
import { seedRoom } from '../tests/convex-helpers/seed';
import { drainDue } from '../tests/convex-helpers/scheduler';
import { api } from '../convex/_generated/api';
import { main } from '../core/scenarios/scope-change/fixtures/main';
import { canaryFixture } from '../core/scenarios/scope-change/fixtures/variants';

import type { FunctionReturnType } from 'convex/server';

export const roles = ['customer', 'provider', 'finance'] as const;
export type Role = typeof roles[number];
export type Projection = {
 room: NonNullable<FunctionReturnType<typeof api.rooms.view>>;
 timeline: NonNullable<FunctionReturnType<typeof api.timeline.page>>;
 execution: FunctionReturnType<typeof api.executions.forRoom>;
 brief: FunctionReturnType<typeof api.briefs.mine>;
 catalog: FunctionReturnType<typeof api.catalog.list>;
 inbox: NonNullable<FunctionReturnType<typeof api.rooms.listMine>>;
 metadata?: string;
 request?: FunctionReturnType<typeof api.humanRequests.get>;
};
export async function generateUiFixtures(canary = false, zeroDisclosures = false, capUndisclosed = false, closeRequest = false, infeasible = false) {
 vi.useFakeTimers();
 vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('AGENTS_ENABLED', 'true');
 try {
  const t = convexTest(schema, modules);
  const fx = canary ? canaryFixture : main;
  const s = await seedRoom(t, fx, { until: 'two_briefs', ...(zeroDisclosures ? { disclosures: { customer: {}, finance: {}, provider: {} } } : {}) });
  const output: Record<string, Record<Role, Projection>> = {};
  const capture = async (state: string) => {
   const projected = {} as Record<Role, Projection>;
   const requestViews = await Promise.all(roles.map(role => s.actors[role].query(api.rooms.view, {roomId:s.roomId})));
   const ownRequest = requestViews.map(room => room?.openRequest).find(request => request?.mine);
   const openId = ownRequest?.mine ? ownRequest.requestId : null;
   for (const role of roles) {
    const actor = s.actors[role]; const args = { roomId: s.roomId };
    const room = (await actor.query(api.rooms.view, args))!;
    const entry: Projection = {
     room, timeline: (await actor.query(api.timeline.page, { ...args, paginationOpts: { numItems: 100, cursor: null } }))!,
     execution: await actor.query(api.executions.forRoom, args), brief: await actor.query(api.briefs.mine, args),
     catalog: await actor.query(api.catalog.list, args), inbox: (await actor.query(api.rooms.listMine, { paginationOpts: { numItems: 50, cursor: null } }))!,
    };
    if (openId) entry.request = await actor.query(api.humanRequests.get, { requestId: openId });
    projected[role] = entry;
   }
   output[state] = projected;
  };
  const approve = async (role: Role, decision: 'approve' | 'withdraw' = 'approve') => {
   const view = (await s.actors[role].query(api.rooms.view, { roomId: s.roomId }))!;
   const proposal = view.currentProposal!;
   await s.actors[role].mutation(api.approvals.record, { proposalId: proposal.proposalId, decision, expectedConstraintsVersion: view.header.constraintsVersion, expectedTermsKey: proposal.termsKey, reasonKey: null, note: null });
  };
  await capture('setup');
  await s.actors.finance.mutation(api.briefs.confirm, { roomId: s.roomId, expectedConstraintsVersion: 0, hardFields: { schemaKey: 'scope_change.finance.v1', capCents: fx.briefs.finance.hardFields.capCents }, softFields: { schemaKey: 'scope_change.finance.v1', notes: fx.briefs.finance.softFields.notes }, disclosures: zeroDisclosures || capUndisclosed ? {} : Object.fromEntries(Object.entries(fx.briefs.finance.disclosures).map(([key, value]) => [key, [...value]])) });
  await capture('negotiating');
  await drainDue(t);
  await capture('initial-request');
  for (let step = 0; step < 5; step++) {
   const view = (await s.actors.customer.query(api.rooms.view, { roomId: s.roomId }))!;
   if (!view.openRequest?.mine) break;
   const option = view.openRequest.options.find(o => o.answerable && ('amountCents' in o.effectView));
   if (!option) throw new Error(JSON.stringify(view.openRequest));
   await s.actors.customer.mutation(api.humanRequests.answer, { requestId: view.openRequest.requestId, optionKey: option.optionKey });
   await drainDue(t);
  }
  await capture('pending');
  await approve('customer'); await capture('one-approved');
  await approve('customer', 'withdraw'); await capture('withdrawn');
  await approve('customer'); await approve('provider'); await capture('two-approved');
  await s.actors.finance.mutation(api.budget.setCap, { roomId: s.roomId, expectedConstraintsVersion: 1, capCents: infeasible ? 470000 : canary ? 481237 : 480000 });
  await capture('stale');
  await drainDue(t); await capture('revised');
  let current = (await s.actors.customer.query(api.rooms.view, { roomId: s.roomId }))!;
  const revisedRequestId = current.openRequest?.mine ? current.openRequest.requestId : null;
  if (closeRequest && revisedRequestId) {
   await s.actors.finance.mutation(api.budget.setCap, { roomId: s.roomId, expectedConstraintsVersion: current.header.constraintsVersion, capCents: 480001 });
   await capture('request-closed');
   for (const role of roles) output['request-closed']![role].request = await s.actors[role].query(api.humanRequests.get, {requestId: revisedRequestId});
   return stableIds(t, output);
  }
  if (current.openRequest?.mine) {
   const option = current.openRequest.options.find(o => o.answerable && o.effectView.amountCents != null);
   if (!option) throw new Error('Expected a selectable candidate');
   await s.actors.customer.mutation(api.humanRequests.answer, { requestId: current.openRequest.requestId, optionKey: option.optionKey });
   current = (await s.actors.customer.query(api.rooms.view, { roomId: s.roomId }))!;
  }
  if (revisedRequestId) {
   await capture('request-closed');
   for (const role of roles) output['request-closed']![role].request = await s.actors[role].query(api.humanRequests.get, { requestId: revisedRequestId });
  }
  if (current.currentProposal?.myAction.canDecide) {
   await approve('customer'); await capture('reapproved');
   await approve('provider'); await capture('last-vote');
   await approve('finance'); await capture('executed');
   const execution = (await s.actors.provider.query(api.executions.forRoom, { roomId: s.roomId }))!;
   for (const task of execution.tasks) await s.actors[task.assigneeRole].mutation(api.tasks.markDone, { taskId: task.taskId });
   await capture('tasks-done');
   await s.actors.customer.mutation(api.rooms.startFollowUp, { executionId: execution.executionId });
   await capture('follow-up');
  }
  return stableIds(t, output);
 } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
}

async function stableIds<T>(t: import('../tests/convex-helpers/scheduler').RuntimeTest, value: T): Promise<T> {
  // Stable aliases replace database identity only, never amounts, roles, text, or versions.
  const ids = new Map<string, string>();
  const tables = ['rooms','users','members','invites','briefs','catalogItems','ledgerEntries','sharedFacts','constraintRevisions','runs','turns','attempts','proposals','approvals','executions','changeOrders','tasks','events','humanRequests'] as const;
  for (const table of tables) {
   const rows = await t.run(ctx => ctx.db.query(table).collect());
   rows.forEach((row, index) => ids.set(String(row._id), `${table}_${index + 1}`));
  }
 return JSON.parse(JSON.stringify(value, (_key, value: unknown) => typeof value === 'string' ? ids.get(value) ?? value : value)) as T;
}

/** Privacy metamorphic pair: identical public history, different private bump author. */
export async function generatePrivacyFixtures() {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('AGENTS_ENABLED', 'true');
 try {
  const output: Record<string, unknown> = {};
  for (const actor of ['finance', 'customer'] as const) {
   const t = convexTest(schema, modules);
   const s = await seedRoom(t, canaryFixture, { until: 'run_started', disclosures: { customer: {}, finance: {}, provider: {} } });
   if (actor === 'finance') await s.actors.finance.mutation(api.budget.setCap, { roomId: s.roomId, expectedConstraintsVersion: 1, capCents: 481237 });
   else {
    const brief = (await s.actors.customer.query(api.briefs.mine, { roomId: s.roomId }))!.latest!;
    if (brief.hardFields.schemaKey !== 'scope_change.customer.v1') throw new Error('Expected customer brief');
    await s.actors.customer.mutation(api.briefs.confirm, { roomId: s.roomId, expectedConstraintsVersion: 1, hardFields: { ...brief.hardFields, deadline: '2026-11-21' }, softFields: { schemaKey: 'scope_change.customer.v1', preferredItemKeys: [], notes: canaryFixture.briefs.customer.softFields.notes }, disclosures: {} });
   }
   const room = await s.actors.provider.query(api.rooms.view, { roomId: s.roomId });
   const timeline = await s.actors.provider.query(api.timeline.page, { roomId: s.roomId, paginationOpts: { numItems: 100, cursor: null } });
   output[actor] = await stableIds(t, { room, timeline });
  }
  return output;
 } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
}

export async function generateTerminalUiFixtures() {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('AGENTS_ENABLED', 'true');
 try {
  const t = convexTest(schema, modules);
  const s = await seedRoom(t, main, { until: 'run_started' });
  const run = (await s.actors.customer.query(api.rooms.view, { roomId: s.roomId }))!.run!;
  await s.actors.customer.mutation(api.runs.cancel, { runId: run.runId });
  const output: Record<string, Record<string, unknown>> = {};
  for (const state of ['stopped', 'closed']) {
   if (state === 'closed') await s.actors.customer.mutation(api.rooms.close, { roomId: s.roomId });
   const views: Record<string, unknown> = {};
   for (const role of roles) {
    views[role] = {
     room: await s.actors[role].query(api.rooms.view, { roomId: s.roomId }),
     timeline: await s.actors[role].query(api.timeline.page, { roomId: s.roomId, paginationOpts: { numItems: 100, cursor: null } }),
     execution: await s.actors[role].query(api.executions.forRoom, { roomId: s.roomId }),
    };
   }
   output[state] = views;
  }
  return stableIds(t, output);
 } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
}

/** Request payloads arranged solely through public room/catalog/brief mutations. */
export async function generateOptionFixtures() {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE', 'stub'); vi.stubEnv('DEPLOYMENT_TIER', 'dev'); vi.stubEnv('AGENTS_ENABLED', 'true');
 try {
  const output: Record<string, unknown> = {};
  for (const scenario of ['customer', 'finance', 'fallback'] as const) {
   const t = convexTest(schema, modules);
   const fx = {...main, catalog: scenario === 'fallback' ? main.catalog.filter(row=>row.kind==='item').map(row=>({...row,leadDays:365})) : main.catalog, briefs: {...main.briefs,
    customer: {...main.briefs.customer, hardFields: {...main.briefs.customer.hardFields, deadline: {offsetDays: scenario === 'finance' ? 18 : 7}}},
    finance: {...main.briefs.finance, hardFields: {capCents: scenario === 'fallback' ? 400000 : scenario === 'finance' ? 470000 : 500000}},
   }};
   const s = await seedRoom(t, fx, {until:'run_started', disclosures: scenario === 'customer' ? {customer:{},finance:{},provider:{}} : {customer:{requiredItemKeys:scenario === 'fallback' ? [] : ['finance'],deadline:['finance']},finance:{capCents:['customer'],committedCents:['customer'],headroomCents:['customer']},provider:{}}});
   await drainDue(t);
   if (scenario === 'finance') {
    const room=(await s.actors.customer.query(api.rooms.view,{roomId:s.roomId}))!;
    if (!room.openRequest?.mine) throw new Error('Expected Customer request');
    const pass=room.openRequest.options.find(o=>o.type==='pass_to_next')!;
    await s.actors.customer.mutation(api.humanRequests.answer,{requestId:room.openRequest.requestId,optionKey:pass.optionKey});
   }
   const target = (await Promise.all(roles.map(role => s.actors[role].query(api.rooms.view,{roomId:s.roomId})))).find(room=>room?.openRequest?.mine)?.openRequest;
   if (!target?.mine) throw new Error(`Missing ${scenario} request`);
   const projections: Record<string, unknown> = {};
   for (const role of roles) {
    const actor=s.actors[role];
    projections[role]={room:await actor.query(api.rooms.view,{roomId:s.roomId}),brief:await actor.query(api.briefs.mine,{roomId:s.roomId}),request:await actor.query(api.humanRequests.get,{requestId:target.requestId})};
   }
   output[scenario]=await stableIds(t,projections);
  }
  return output;
 } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
}

/** Caller supplies one scripted Provider clarify turn; all persistence uses public mutations. */
export async function generateClarifyFixture() {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
 vi.stubEnv('AGENT_MODE','live'); vi.stubEnv('DEPLOYMENT_TIER','dev'); vi.stubEnv('ANTHROPIC_API_KEY','scripted-key');
 try {
  const {seedRoom: seed}=await import('../tests/convex-helpers/seedRoom.fixture');
  const s=await seed({agentMode:'live'}); await drainDue(s.t);
  const own=(await s.as('customer').query(api.rooms.view,{roomId:s.roomId}))!.openRequest;
  if(!own?.mine)throw new Error('Expected clarify');
  const output:Record<string,unknown>={};
  for(const role of roles) output[role]={room:await s.as(role).query(api.rooms.view,{roomId:s.roomId}),brief:await s.as(role).query(api.briefs.mine,{roomId:s.roomId}),request:await s.as(role).query(api.humanRequests.get,{requestId:own.requestId})};
  return stableIds(s.t,output);
 } finally {vi.useRealTimers();vi.unstubAllEnvs();}
}
