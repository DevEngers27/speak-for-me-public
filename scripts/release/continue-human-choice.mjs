#!/usr/bin/env node
/** Continue an existing real run only after a human explicitly selects an existing option.
 * Uses authenticated CLI admin impersonation; never claims real Clerk login or autonomous agreement.
 * Does not start new model turns. Safe summary exports exclude briefs, prompts and private notes.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { makeFunctionReference as ref } from 'convex/server';
import { validateTarget, approvalArgs, assertPrivateProjection, assertExecutionCounts, sanitizedErrorCode, ROLES } from './live-smoke.mjs';
import { cliClientFactory, readIdentityConfiguration } from './cli-session.mjs';

const { values } = parseArgs({ options: { execute: { type: 'boolean' }, 'confirm-deployment': { type: 'string' }, 'room-id': { type: 'string' }, 'request-id': { type: 'string' }, 'option-key': { type: 'string' }, output: { type: 'string' } }, strict: true });
assert(values.execute && values['room-id'] && values['request-id'] && values['option-key'], 'Explicit room, request and authorized option required.');
const target = values['confirm-deployment'];
assert(target && process.env.CONVEX_DEPLOYMENT === `dev:${target}`, 'Explicit matching dev deployment required.');
const env = { ...process.env, CONVEX_URL: process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL, ...await readIdentityConfiguration(target) };
validateTarget(env, target, true);
const factory = cliClientFactory(target); const admin = factory();
const clients = Object.fromEntries(ROLES.map(role => {
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN.trim(), subject = env[`E2E_${role.toUpperCase()}_SUBJECT`]?.trim() || `seed_${role}`;
  return [role, factory({ issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${role}@seed.invalid`, emailVerified: true, name: role })];
}));
const roomId = values['room-id'];
const q = (client, name, args = { roomId }) => client.query(ref(name), args);
const m = (client, name, args) => client.mutation(ref(name), args);
const evidence = { version: 1, deployment: target, roomId, startedAt: new Date().toISOString(), pass: false,
  authEvidence: 'Synthetic identities through logged-in Convex CLI admin impersonation; NOT Clerk/browser login evidence.',
  outcome: 'Human resolves real agent disagreement by selecting existing $800 essentials proposal; not autonomous model agreement.',
  stages: [], errorCode: null };
const record = (stage, fields = {}) => { const row = { stage, at: new Date().toISOString(), ...fields }; evidence.stages.push(row); console.log(JSON.stringify(row)); };
try {
  const health = await q(admin, 'ops:configHealth', {}); assert.equal(health.agentMode, 'live'); assert.equal(health.tier, 'dev'); assert.equal(health.configValid, true);
  const before = await q(clients.customer, 'rooms:view');
  assert.equal(before.run.agentMode, 'live'); assert.equal(before.run.status, 'needs_input');
  assert.equal(before.openRequest.requestId, values['request-id']); assert.equal(before.openRequest.mine, true);
  const option = before.openRequest.options.find(o => o.optionKey === values['option-key']);
  assert(option?.answerable && option.type === 'choose_candidate'); assert.equal(option.effectView.amountCents, 80000);
  assert.deepEqual([...option.effectView.itemKeys].sort(), ['audit_log_export', 'sso_login']);
  assert.equal(before.currentProposal.terms.amountCents, 80000);
  const liveProposalId = before.currentProposal.proposalId;
  const old = before.proposalHistory.find(p => p.version === 1); assert(old);
  const stale = await q(clients.customer, 'proposals:get', { proposalId: old.proposalId });
  assert.equal(stale.card.approvals.filter(a => a.state === 'stale_approve').length, 2);
  record('prior_approvals_invalid', { oldProposalVersion: 1, staleApprovalCount: 2, constraintsVersion: before.header.constraintsVersion });
  const markers = {};
  for (const role of ROLES) {
    const brief = await q(clients[role], 'briefs:mine');
    markers[role] = /PRIVATE_RELEASE_[A-Z]+_[a-f0-9]+/.exec(brief.latest.softFields.notes)?.[0];
    assert(markers[role], 'Private verification marker missing.');
  }
  const checkPrivacy = async execution => {
    for (const role of ROLES) {
      const outputs = [await q(clients[role], 'rooms:view'), await q(clients[role], 'timeline:page', { roomId, paginationOpts: { numItems: 100, cursor: null } }), await q(clients[role], 'proposals:get', { proposalId: liveProposalId })];
      if (execution) outputs.push(await q(clients[role], 'executions:forRoom'));
      assertPrivateProjection(role, outputs, markers);
    }
  };
  await checkPrivacy(false);
  const answer = await m(clients.customer, 'humanRequests:answer', { requestId: values['request-id'], optionKey: values['option-key'] });
  assert.equal(answer.outcome, 'applied'); assert.equal(answer.effect, 'choose_candidate'); assert.equal(answer.proposalId, liveProposalId);
  let current = await q(clients.customer, 'rooms:view');
  assert.equal(current.run.status, 'pending_approval'); assert.equal(current.run.runId, before.run.runId);
  assert.equal(current.currentProposal.approvals.filter(a => a.state === 'approved').length, 0);
  record('authorized_human_choice', { requestId: values['request-id'], optionKey: values['option-key'], amountCents: 80000, itemKeys: [...option.effectView.itemKeys].sort(), deliveryDate: option.effectView.deliveryDate, reusedLiveModelProposal: true, newModelRunStarted: false });
  const approval = approvalArgs(current);
  await m(clients.customer, 'approvals:record', approval);
  await m(clients.provider, 'approvals:record', approval);
  const finance = await q(clients.finance, 'rooms:view');
  assert.equal(finance.currentProposal.approvals.filter(a => a.state === 'approved').length, 2); assert.equal(finance.execution, null);
  assert.equal(finance.budget.capCents, 480000); assert.equal(finance.budget.committedCents, 400000);
  record('finance_before_final_approval', { proposalVersion: finance.currentProposal.version, amountCents: 80000, humanApprovals: 2, executionPresent: false, financeOnlyBudget: { capCents: 480000, committedCents: 400000, totalAfterCents: finance.budget.totalAfterCents } });
  const approvals = await Promise.all([m(clients.finance, 'approvals:record', approval), m(clients.finance, 'approvals:record', approval)]);
  current = await q(clients.finance, 'rooms:view'); assert.equal(current.header.status, 'executed'); assert(current.execution);
  assert(approvals.every(a => a.status === 'executed' && a.executionId === current.execution.executionId));
  assert.equal(approvals.filter(a => a.alreadyExecuted).length, 1);
  const execution = await q(clients.finance, 'executions:forRoom');
  assert.equal(execution.changeOrder.terms.amountCents, 80000); assert.equal(execution.changeOrder.amountChain.committedAfterCents, 480000);
  assert.equal(execution.tasks.length, 2); assert.equal(execution.approvalsSnapshot.length, 3);
  const counts = await q(admin, 'devProbes:observeConcurrency', { roomId, proposalId: approval.proposalId }); assertExecutionCounts(counts, 2);
  assert.deepEqual(await q(admin, 'executions:checkInvariants'), []);
  await checkPrivacy(true);
  record('automatic_execution', { executionId: execution.executionId, proposalVersion: execution.proposalVersion, amountCents: 80000, signatureRoles: execution.approvalsSnapshot.map(s => s.role), executionCount: counts.executions, ledgerCommitCount: counts.ledgerCommits, changeOrderCount: counts.changeOrders, executedEventCount: counts.executedEvents, taskCount: counts.tasks, concurrentFinalApprovalIdempotent: true, invariantFindings: 0, privateProjection: 'passed' });
  const providerResult = await q(clients.provider, 'executions:forRoom'); assert.equal(providerResult.changeOrder.amountChain, null);
  record('public_result', { changeOrderNumber: providerResult.changeOrder.number, amountCents: providerResult.changeOrder.terms.amountCents, deliveryDate: providerResult.changeOrder.terms.deliveryDate, lines: providerResult.changeOrder.lines, tasks: providerResult.tasks.map(t => ({ title: t.title, assigneeRole: t.assigneeRole, dueDate: t.dueDate, status: t.status })), privateFinanceChainOmitted: true });
  const next = await m(clients.customer, 'rooms:startFollowUp', { executionId: execution.executionId });
  const same = await m(clients.customer, 'rooms:startFollowUp', { executionId: execution.executionId });
  assert.equal(same.roomId, next.roomId); assert.equal(same.created, false);
  const follow = await q(clients.finance, 'rooms:view', { roomId: next.roomId });
  assert.equal(follow.header.status, 'setup'); assert.equal(follow.run, null); assert.equal(follow.followUpOf.previousRoomId, roomId);
  assert.equal(follow.budget.committedCents, 0); assert.equal(follow.budget.baselineRecorded, false); assert.equal(follow.budget.baselineSuggestionCents, 480000);
  record('follow_up', { roomId: next.roomId, previousRoomId: roomId, createdOnce: true, status: 'setup', baselineSuggestionCents: 480000, baselineRecorded: false, requiresFinanceConfirmation: true });
  evidence.pass = true;
} catch (error) {
  evidence.errorCode = sanitizedErrorCode(error);
  record('stopped', { code: evidence.errorCode, check: error instanceof assert.AssertionError && !error.generatedMessage ? error.message.split('\n')[0] : 'Acceptance check failed; no private error payload exported.' });
}
evidence.finishedAt = new Date().toISOString();
const output = values.output || `probe-results/${new Date().toISOString().slice(0, 10)}-release-human-recovery.json`;
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ evidence: output, pass: evidence.pass }));
if (!evidence.pass) process.exitCode = 1;
