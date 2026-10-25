#!/usr/bin/env node
/**
 * Actual cloud release verification using existing production APIs and canonical seed.
 * Auth is ADMIN-IMPERSONATED SYNTHETIC IDENTITIES, not evidence of Clerk login.
 * Run only on an explicitly selected isolated development deployment:
 * node --env-file=.env.release.local scripts/release/live-smoke.mjs --execute --confirm-deployment <name>
 * For the existing authenticated CLI session, add --use-cli-session (no admin key needed).
 * Required: CONVEX_URL, CONVEX_DEPLOYMENT=dev:<name>, CONVEX_ADMIN_KEY,
 * CLERK_JWT_ISSUER_DOMAIN (matches target); optional E2E_{ROLE}_SUBJECT.
 * Target must already have DEPLOYMENT_TIER=dev and AGENT_MODE=live configured.
 * No deployment, key configuration, reset, deletion, or simulated agent fallback.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

export const ROLES = ['customer', 'provider', 'finance'];
export function validateTarget(env, confirmed, cliSession = false) {
  const selected = env.CONVEX_DEPLOYMENT || '';
  const match = /^dev:([a-z0-9-]+)$/.exec(selected);
  assert(match && confirmed === match[1], 'Explicit matching development deployment required.');
  assert(env.CONVEX_URL === `https://${match[1]}.convex.cloud`, 'CONVEX_URL must match the confirmed deployment.');
  assert(cliSession || env.CONVEX_ADMIN_KEY?.trim(), 'CONVEX_ADMIN_KEY is required.');
  assert(!env.CONVEX_DEPLOY_KEY && !env.CONVEX_SELF_HOSTED_URL && !env.CONVEX_PREVIEW_DEPLOY_KEY, 'Remove competing deployment selectors.');
  assert(/^https:\/\/[^\s/]+\/?$/.test(env.CLERK_JWT_ISSUER_DOMAIN || ''), 'Supply the target Clerk issuer.');
  return match[1];
}
export function approvalArgs(view, decision = 'approve') {
  const proposal = view.currentProposal;
  assert(proposal, 'A current proposal is required.');
  return { proposalId: proposal.proposalId, decision, expectedConstraintsVersion: view.header.constraintsVersion, expectedTermsKey: proposal.termsKey, reasonKey: null, note: null };
}
export function assertPrivateProjection(role, result, markers) {
  const serialized = JSON.stringify(result);
  for (const other of ROLES.filter(value => value !== role)) assert(!serialized.includes(markers[other]), 'Cross-role private canary found.');
  if (role === 'provider') {
    assert(!/"(?:capCents|committedCents|headroomCents|committedBeforeCents|committedAfterCents|capCentsAtExecution|baselineCents)"/.test(serialized), 'Provider received private financial fields.');
  }
}
export function assertExecutionCounts(observed, taskCount) {
  assert.equal(observed.executions, 1); assert.equal(observed.ledgerCommits, 1);
  assert.equal(observed.changeOrders, 1); assert.equal(observed.executedEvents, 1);
  assert.equal(observed.tasks, taskCount); assert.equal(observed.unsafeExecutedDecision, false);
}
export function sanitizedErrorCode(error) {
  let data = error && typeof error === 'object' && 'data' in error ? error.data : null;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  return data && typeof data === 'object' && typeof data.code === 'string' && /^[a-z_]+\.[a-z_]+$/.test(data.code) ? data.code : 'verification.failed';
}
function clientFor(env, role, factory) {
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN.trim();
  const subject = env[`E2E_${role.toUpperCase()}_SUBJECT`]?.trim() || `seed_${role}`;
  return factory({ issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${role}@seed.invalid`, emailVerified: true, name: role });
}
const query = (client, name, args = {}) => client.query(makeFunctionReference(name), args);
const mutation = (client, name, args = {}) => client.mutation(makeFunctionReference(name), args);
const action = (client, name, args = {}) => client.action(makeFunctionReference(name), args);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function runLiveSmoke(env, confirmed, options = {}) {
  const deployment = validateTarget(env, confirmed, Boolean(options.cliClientFactory));
  const startedAt = Date.now();
  const evidence = {
    version: 1, deployment, startedAt: new Date(startedAt).toISOString(), finishedAt: null,
    authEvidence: 'Convex admin impersonation with synthetic seed identities; NOT Clerk sign-in or browser/WebSocket verification.',
    inputProvenance: 'Canonical main fixture through seed.fromFixture and production mutation helpers; seeded synthetic inputs.',
    modelEvidence: 'Live runtime required; no simulated fallback, no fabricated proposals or human-request answers.',
    pass: false, stages: [], roomId: null, followUpRoomId: null, errorCode: null,
  };
  const record = (stage, fields = {}) => {
    const item = { stage, at: new Date().toISOString(), ...fields }; evidence.stages.push(item);
    options.onProgress?.(item);
  };
  const factory = options.cliClientFactory || (identity => { const client = new ConvexHttpClient(env.CONVEX_URL, { logger: false }); client.setAdminAuth(env.CONVEX_ADMIN_KEY, identity); return client; });
  const admin = factory();
  const actors = Object.fromEntries(ROLES.map(role => [role, clientFor(env, role, factory)]));
  const anonymous = new ConvexHttpClient(env.CONVEX_URL, { logger: false });
  const outsider = clientFor({ ...env, E2E_CUSTOMER_SUBJECT: `release_outsider_${crypto.randomUUID()}` }, 'customer', factory);
  const markers = Object.fromEntries(ROLES.map(role => [role, `PRIVATE_RELEASE_${role.toUpperCase()}_${crypto.randomUUID().replaceAll('-', '')}`]));
  try {
    const health = await query(admin, 'ops:configHealth');
    assert.equal(health.tier, 'dev'); assert.equal(health.agentMode, 'live'); assert.equal(health.configValid, true);
    assert.equal(health.agentsEnabled, true); assert.equal(health.draining, false); assert.equal(health.modelFallbacks, false);
    assert.equal(health.clerkIssuerConfigured, true); assert.equal(health.anthropicKeyConfigured, true);
    const model = await action(admin, 'ops:checkModelConfig'); assert.equal(model.ok, true, 'Pinned model check failed.');
    record('configuration', { agentMode: health.agentMode, tier: health.tier, pinnedModelAvailable: true });

    const seeded = await mutation(admin, 'seed:fromFixture', { fixtureKey: 'main', stopBeforeRole: 'finance' });
    const roomId = seeded.roomId; evidence.roomId = roomId;
    const room = () => query(actors.finance, 'rooms:view', { roomId });
    let current = await room(); assert(current && current.header.status === 'setup'); assert.equal(current.run, null);
    assert.equal(current.budget.committedCents, 400000); assert.equal(current.members.length, 3);
    record('canonical_setup', { roomId, status: current.header.status, existingCommitmentCents: current.budget.committedCents });

    for (const role of ['customer', 'provider']) {
      const brief = await query(actors[role], 'briefs:mine', { roomId }); assert(brief?.latest);
      await mutation(actors[role], 'briefs:updateSoft', { roomId, notes: `${brief.latest.softFields.notes}\nPrivate verification marker: ${markers[role]}` });
    }
    await mutation(outsider, 'users:ensureViewer');
    for (const client of [anonymous, outsider]) {
      assert.equal(await query(client, 'rooms:view', { roomId }), null);
      assert.equal(await query(client, 'briefs:mine', { roomId }), null);
    }
    try { await mutation(actors.provider, 'budget:setCap', { roomId, capCents: 480000, expectedConstraintsVersion: current.header.constraintsVersion }); assert.fail('Provider changed finance budget.'); }
    catch (error) { assert.equal(sanitizedErrorCode(error), 'auth.role_forbidden'); }
    record('authorization', { anonymousAndNonmemberReadDenied: true, providerBudgetWriteDenied: true });

    await mutation(actors.finance, 'briefs:confirm', {
      roomId, expectedConstraintsVersion: current.header.constraintsVersion,
      hardFields: { schemaKey: 'scope_change.finance.v1', capCents: 500000 },
      softFields: { schemaKey: 'scope_change.finance.v1', notes: `Q4 forecast is tight; keep a reserve.\nPrivate verification marker: ${markers.finance}` },
      disclosures: { capCents: ['customer'], committedCents: [], headroomCents: [] },
    });
    const waitForProposal = async (afterVersion = 0) => {
      const deadline = Date.now() + (options.timeoutMs || 600000);
      let lastStatus = '';
      while (Date.now() < deadline) {
        const view = await room(); assert(view?.run?.agentMode === 'live', 'Run is not live.');
        const status = `${view.run.runNo}:${view.run.status}:${view.run.activeRole || ''}`;
        if (status !== lastStatus) { record('run_progress', { runNo: view.run.runNo, status: view.run.status, activeRole: view.run.activeRole }); lastStatus = status; }
        if (view.run.status === 'pending_approval' && view.currentProposal?.version > afterVersion) return view;
        if (['needs_input', 'ended_no_agreement', 'canceled', 'executed'].includes(view.run.status)) {
          record('requires_human_attention', { runNo: view.run.runNo, status: view.run.status, requestKind: view.openRequest?.kind || null });
          assert.fail('Live run needs human attention; no automatic answer or simulated agreement was supplied.');
        }
        await delay(2000);
      }
      assert.fail('Timed out waiting for actual model negotiation.');
    };
    const checkPrivacy = async view => {
      for (const role of ROLES) {
        const own = await query(actors[role], 'briefs:mine', { roomId });
        assert(JSON.stringify(own).includes(markers[role]), 'Own private brief missing.');
        const outputs = [own, await query(actors[role], 'rooms:view', { roomId }), await query(actors[role], 'timeline:page', { roomId, paginationOpts: { numItems: 100, cursor: null } })];
        if (view.currentProposal) outputs.push(await query(actors[role], 'proposals:get', { proposalId: view.currentProposal.proposalId }));
        if (view.execution) outputs.push(await query(actors[role], 'executions:forRoom', { roomId }));
        assertPrivateProjection(role, outputs, markers);
      }
    };
    current = await waitForProposal(); assert.equal(current.currentProposal.terms.amountCents, 90000, 'Live model did not choose the expected $900 fixture outcome.');
    await checkPrivacy(current);
    const oldArgs = approvalArgs(current); const oldVersion = current.currentProposal.version;
    await mutation(actors.customer, 'approvals:record', oldArgs);
    await mutation(actors.provider, 'approvals:record', oldArgs);
    current = await room(); assert.equal(current.currentProposal.approvals.filter(row => row.state === 'approved').length, 2); assert.equal(current.execution, null);
    record('initial_proposal', { proposalVersion: oldVersion, amountCents: 90000, humanApprovals: 2, privacyChecks: 'passed' });

    await mutation(actors.finance, 'budget:setCap', { roomId, capCents: 480000, expectedConstraintsVersion: current.header.constraintsVersion });
    const changed = await room(); assert(changed.header.constraintsVersion > oldArgs.expectedConstraintsVersion);
    try { await mutation(actors.finance, 'approvals:record', oldArgs); assert.fail('Stale approval was accepted.'); }
    catch (error) { assert(['approval.not_current', 'approval.stale'].includes(sanitizedErrorCode(error)), 'Stale approval did not fail with an expected version guard.'); }
    const stale = await query(actors.customer, 'proposals:get', { proposalId: oldArgs.proposalId });
    assert.equal(stale.card.approvals.filter(row => row.state === 'stale_approve').length, 2);
    record('budget_change', { capCents: 480000, constraintsVersion: changed.header.constraintsVersion, staleApprovalRejected: true, staleApprovalCount: 2 });

    current = await waitForProposal(oldVersion); assert.equal(current.currentProposal.terms.amountCents, 80000);
    assert.equal(current.currentProposal.approvals.filter(row => row.state === 'approved').length, 0);
    await checkPrivacy(current);
    const freshArgs = approvalArgs(current); const finalVersion = current.currentProposal.version;
    await mutation(actors.customer, 'approvals:record', freshArgs);
    await Promise.all(['provider', 'finance'].map(role => mutation(actors[role], 'approvals:record', freshArgs)));
    current = await room(); assert.equal(current.header.status, 'executed'); assert(current.execution);
    const retry = await mutation(actors.finance, 'approvals:record', freshArgs);
    assert.equal(retry.status, 'executed'); assert.equal(retry.alreadyExecuted, true); assert.equal(retry.executionId, current.execution.executionId);
    const execution = await query(actors.finance, 'executions:forRoom', { roomId });
    assert.equal(execution.changeOrder.terms.amountCents, 80000); assert.equal(execution.changeOrder.amountChain.committedAfterCents, 480000);
    assert.equal(execution.tasks.length, 2); assert.equal(execution.approvalsSnapshot.length, 3);
    const counts = await query(admin, 'devProbes:observeConcurrency', { roomId, proposalId: freshArgs.proposalId }); assertExecutionCounts(counts, 2);
    assert.deepEqual(await query(admin, 'executions:checkInvariants', { roomId }), []);
    await checkPrivacy(current);
    record('automatic_execution', { proposalVersion: finalVersion, amountCents: 80000, committedAfterCents: 480000, executionId: execution.executionId, executionCount: counts.executions, commitmentCount: counts.ledgerCommits, taskCount: counts.tasks, retryIdempotent: true, privacyChecks: 'passed' });

    const next = await mutation(actors.customer, 'rooms:startFollowUp', { executionId: execution.executionId });
    const same = await mutation(actors.customer, 'rooms:startFollowUp', { executionId: execution.executionId });
    assert.equal(same.roomId, next.roomId); assert.equal(same.created, false);
    evidence.followUpRoomId = next.roomId;
    const followUp = await query(actors.finance, 'rooms:view', { roomId: next.roomId });
    assert.equal(followUp.followUpOf.previousRoomId, roomId);
    assert.equal(followUp.header.status, 'setup'); assert.equal(followUp.run, null);
    assert.equal(followUp.budget.committedCents, 0); assert.equal(followUp.budget.baselineRecorded, false);
    assert.equal(followUp.budget.baselineSuggestionCents, 480000);
    record('follow_up', { roomId: next.roomId, createdOnce: true, baselineSuggestionCents: 480000, baselineRecorded: false, requiresHumanConfirmation: true });
    evidence.pass = true;
  } catch (error) {
    evidence.errorCode = sanitizedErrorCode(error);
    // Assertion text originates in this file. Do not expose transport messages,
    // request bodies, stack traces, private data, or arbitrary upstream errors.
    record('stopped', { code: evidence.errorCode, check: error instanceof assert.AssertionError ? (error.generatedMessage ? 'Acceptance assertion failed.' : error.message.split('\n')[0]) : 'Backend verification failed; inspect safe server error codes.' });
  }
  try {
    const metrics = await query(admin, 'ops:metrics', { sinceMs: startedAt, untilMs: Date.now() + 1 });
    record('measured_usage', { scope: 'Deployment-wide measurement window; not a provider-facing export.', tokens: metrics.tokens, estimate: metrics.spendEstimate, turnLatency: metrics.turnLatency });
  } catch { record('usage_unavailable', { estimate: null }); }
  evidence.finishedAt = new Date().toISOString();
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const parsed = parseArgs({ options: { execute: { type: 'boolean', default: false }, 'confirm-deployment': { type: 'string' }, output: { type: 'string' }, 'use-cli-session': { type: 'boolean', default: false } }, strict: true });
  assert(parsed.values.execute, 'No action performed. Pass --execute and --confirm-deployment to run paid live verification.');
  let env = { ...process.env, CONVEX_URL: process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL };
  let factory;
  if (parsed.values['use-cli-session']) {
    const target = parsed.values['confirm-deployment'];
    assert(target && env.CONVEX_DEPLOYMENT === `dev:${target}`, 'Explicit matching dev deployment required before using CLI auth.');
    const cli = await import('./cli-session.mjs');
    env = { ...env, ...await cli.readIdentityConfiguration(target) };
    factory = cli.cliClientFactory(target);
  }
  const evidence = await runLiveSmoke(env, parsed.values['confirm-deployment'], { cliClientFactory: factory, onProgress: item => console.log(JSON.stringify(item)) });
  const output = parsed.values.output || `probe-results/${new Date().toISOString().slice(0, 10)}-release-live-smoke.json`;
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ evidence: output, pass: evidence.pass }));
  if (!evidence.pass) process.exitCode = 1;
}
