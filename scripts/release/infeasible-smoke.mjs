#!/usr/bin/env node
/** Deployed $4,700 precheck and explicit end-run verification. Synthetic admin identities,
 * not Clerk/browser evidence. Creates one isolated fixture; never resets data or selects
 * a budget increase. The deterministic precheck must stop before the first model attempt.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { makeFunctionReference as ref } from 'convex/server';
import { validateTarget, sanitizedErrorCode, ROLES } from './live-smoke.mjs';
import { cliClientFactory, readIdentityConfiguration } from './cli-session.mjs';

const { values } = parseArgs({ options: { execute: { type: 'boolean' }, 'confirm-deployment': { type: 'string' }, output: { type: 'string' } }, strict: true });
const target = values['confirm-deployment'];
assert(values.execute && target && process.env.CONVEX_DEPLOYMENT === `dev:${target}`, 'Explicit matching development deployment required.');
const env = { ...process.env, CONVEX_URL: process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL, ...await readIdentityConfiguration(target) };
validateTarget(env, target, true);
const factory = cliClientFactory(target), admin = factory();
const clients = Object.fromEntries(ROLES.map(role => {
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN.trim(), subject = env[`E2E_${role.toUpperCase()}_SUBJECT`]?.trim() || `seed_${role}`;
  return [role, factory({ issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${role}@seed.invalid`, emailVerified: true, name: role })];
}));
const q = (client, name, args) => client.query(ref(name), args);
const m = (client, name, args) => client.mutation(ref(name), args);
const evidence = { version: 1, deployment: target, startedAt: new Date().toISOString(), pass: false, roomId: null,
  authEvidence: 'Synthetic seed identities via logged-in Convex CLI admin impersonation; NOT Clerk/browser login evidence.',
  scope: 'Canonical $4,000 commitment plus $800 required scope exceeds a $4,700 cap. Verify precheck, private Finance request, and explicit end without agreement.', stages: [], errorCode: null };
const record = (stage, fields = {}) => { const row = { stage, at: new Date().toISOString(), ...fields }; evidence.stages.push(row); console.log(JSON.stringify(row)); };
try {
  const health = await q(admin, 'ops:configHealth', {});
  assert.equal(health.tier, 'dev'); assert.equal(health.agentMode, 'live'); assert.equal(health.configValid, true);
  const { roomId } = await m(admin, 'seed:fromFixture', { fixtureKey: 'main', stopBeforeRole: 'finance' }); evidence.roomId = roomId;
  const before = await q(clients.finance, 'rooms:view', { roomId });
  assert.equal(before.header.status, 'setup'); assert.equal(before.run, null); assert.equal(before.budget.committedCents, 400000);
  await m(clients.finance, 'briefs:confirm', { roomId, expectedConstraintsVersion: before.header.constraintsVersion,
    hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 470000 },
    softFields: { schemaKey: 'scope_change.finance.v1', notes: 'Synthetic release verification: do not increase this cap automatically.' },
    disclosures: { capCents: ['customer'], committedCents: [], headroomCents: [] } });
  const view = await q(clients.finance, 'rooms:view', { roomId });
  assert.equal(view.run.status, 'needs_input'); assert.equal(view.run.agentMode, 'live'); assert.equal(view.currentProposal, null); assert.equal(view.execution, null);
  assert.equal(view.openRequest.mine, true);
  const request = view.openRequest;
  const ending = request.options.find(option => option.type === 'end_run' && option.answerable); assert(ending, 'Explicit end-run option missing.');
  assert(request.options.some(option => option.type === 'raise_cap'), 'Finance budget tradeoff missing.');
  const provider = await q(clients.provider, 'rooms:view', { roomId });
  assert.equal(provider.openRequest.kind, 'run_waiting'); assert.equal(provider.openRequest.mine, false);
  assert(!/"(?:capCents|committedCents|headroomCents)"/.test(JSON.stringify(provider)), 'Provider received private budget fields.');
  const counts = await q(admin, 'devProbes:observeConcurrency', { roomId });
  for (const key of ['firstAttempts', 'executions', 'ledgerCommits', 'changeOrders', 'tasks']) assert.equal(counts[key], 0);
  record('infeasible_precheck', { capCents: 470000, committedCents: 400000, requiredScopeCents: 80000, status: view.run.status, requestKind: request.kind, addressedTo: 'finance', optionTypes: request.options.map(option => option.type), firstTurnAttempts: counts.firstAttempts, proposalPresent: false, executionPresent: false, providerSeesGenericWait: true, providerBudgetFieldsAbsent: true });
  const result = await m(clients.finance, 'humanRequests:answer', { requestId: request.requestId, optionKey: ending.optionKey });
  assert.equal(result.outcome, 'applied'); assert.equal(result.effect, 'end_run');
  const after = await q(clients.finance, 'rooms:view', { roomId });
  assert.equal(after.run.status, 'ended_no_agreement'); assert.equal(after.execution, null); assert.equal(after.budget.capCents, 470000); assert.equal(after.budget.committedCents, 400000);
  const finalCounts = await q(admin, 'devProbes:observeConcurrency', { roomId });
  for (const key of ['activeRuns', 'firstAttempts', 'executions', 'ledgerCommits', 'changeOrders', 'tasks']) assert.equal(finalCounts[key], 0);
  assert.deepEqual(await q(admin, 'executions:checkInvariants', { roomId }), []);
  record('explicit_end_without_agreement', { status: after.run.status, capUnchanged: true, committedAmountUnchanged: true, firstTurnAttempts: 0, executions: 0, ledgerCommits: 0, tasks: 0, invariantFindings: 0 });
  evidence.pass = true;
} catch (error) {
  evidence.errorCode = sanitizedErrorCode(error);
  record('stopped', { code: evidence.errorCode, check: error instanceof assert.AssertionError && !error.generatedMessage ? error.message.split('\n')[0] : 'Acceptance check failed; no private error payload exported.' });
}
evidence.finishedAt = new Date().toISOString();
const output = values.output || `probe-results/${new Date().toISOString().slice(0, 10)}-release-infeasible-smoke.json`;
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ evidence: output, pass: evidence.pass }));
if (!evidence.pass) process.exitCode = 1;
