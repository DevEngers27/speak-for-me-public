import { makeFunctionReference } from 'convex/server';
import { ConvexError, type Value } from 'convex/values';
import type { ProbeFixture, ProbeObservation } from './types.ts';
import { PROBE_TABLE, PROBE_ROUNDS, buildConcurrencyEvidence, writeEvidence, type ProbeName } from './lib/evidence.ts';
import { maxConcurrentIntervals } from './lib/overlap.ts';
import { runProbeMain } from './lib/run.ts';
import { refuseProbeEnvironment } from './lib/target.ts';
import { probeClient } from './lib/client.ts';
export { PROBE_TABLE, PROBE_ROUNDS, maxConcurrentIntervals };
export interface ProbeTransport { mutation(name: string, args: Record<string, Value>): Promise<Value>; query(name: string, args: Record<string, Value>): Promise<Value> }
export type ClientFactory = (identity?: { subject: string; issuer: string }) => ProbeTransport;
type Call = { client: ProbeTransport; name: string; args: Record<string, Value> };
type Result = { ok: boolean; code: string | null; value: Value; t0: number; t1: number };
function codeOf(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'code' in error.data && typeof error.data.code === 'string') return error.data.code;
  return 'unknown';
}
async function race(calls: Call[]): Promise<Result[]> {
  return Promise.all(calls.map(async ({ client, name, args }) => {
    const t0 = performance.now();
    try { return { ok: true, code: null, value: await client.mutation(name, args), t0, t1: performance.now() }; }
    catch (error) { return { ok: false, code: codeOf(error), value: null, t0, t1: performance.now() }; }
  }));
}
const record = (value: Value): Record<string, Value> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Value> : {};
const sameId = (results: Result[], field: string) => results.every(r => r.ok && typeof record(r.value)[field] === 'string') && new Set(results.map(r => record(r.value)[field])).size === 1;
const exactlyExecuted = (o: ProbeObservation, f: ProbeFixture) => o.executions === 1 && o.ledgerCommits === 1 && o.changeOrders === 1 && o.tasks === f.plannedTasks && o.executedEvents === 1 && !o.unsafeExecutedDecision;
export async function runConcurrencyRound(probe: Exclude<ProbeName, 'complete_vs_bump'>, key: string, factory: ClientFactory) {
  const admin = factory();
  const mode = probe === 'join_same_role' ? 'join' : probe === 'start_run_repeat' ? 'ended' : 'approval';
  const fixture = await admin.mutation('devProbes:prepareConcurrency', { key, mode }) as unknown as ProbeFixture;
  const as = (index: number) => factory({ issuer: fixture.issuer, subject: fixture.subjects[index]! });
  const args = (decision = 'approve') => ({ proposalId: fixture.proposalId!, decision, expectedConstraintsVersion: fixture.constraintsVersion, expectedTermsKey: fixture.termsKey, reasonKey: decision === 'reject' ? 'other' : null, note: null });
  const approve = (index: number) => as(index).mutation('approvals:record', args());
  const observe = (f = fixture) => admin.query('devProbes:observeConcurrency', { roomId: f.roomId, ...(f.proposalId ? { proposalId: f.proposalId } : {}) }) as unknown as Promise<ProbeObservation>;
  const findings = async (f = fixture) => admin.query('executions:checkInvariants', { roomId: f.roomId }) as Promise<Value[]>;
  if (probe === 'approve_last_two') await approve(0);
  if (['approve_last_repeat', 'cap_vs_last_approval', 'reject_vs_last_approval', 'withdraw_vs_last_approval', 'start_follow_up_twice'].includes(probe)) { await approve(0); await approve(1); }
  let executionId: Value = null;
  if (probe === 'start_follow_up_twice') executionId = record(await approve(2)).executionId ?? null;
  const before = await observe();
  const calls: Call[] = [];
  const approvalCall = (index: number, decision = 'approve'): Call => ({ client: as(index), name: 'approvals:record', args: args(decision) });
  if (probe === 'approve_last_two') for (const index of [1, 2]) for (let i = 0; i < 3; i++) calls.push(approvalCall(index));
  if (probe === 'approve_last_repeat' || probe === 'approve_same_user') for (let i = 0; i < 5; i++) calls.push(approvalCall(probe === 'approve_last_repeat' ? 2 : 0));
  if (probe === 'start_follow_up_twice') for (const index of [0, 1]) for (let i = 0; i < 3; i++) calls.push({ client: as(index), name: 'rooms:startFollowUp', args: { executionId } });
  if (probe === 'start_run_repeat') for (let i = 0; i < 5; i++) calls.push({ client: as(0), name: 'runs:start', args: { roomId: fixture.roomId } });
  if (probe === 'join_same_role') for (let i = 0; i < 5; i++) calls.push({ client: as(i), name: 'invites:accept', args: { invite: { by: 'link', token: fixture.tokens[0]! } } });
  if (probe === 'cap_vs_last_approval') calls.push({ client: as(2), name: 'budget:setCap', args: { roomId: fixture.roomId, capCents: fixture.capCents - 1, expectedConstraintsVersion: fixture.constraintsVersion } }, approvalCall(2));
  if (probe === 'reject_vs_last_approval' || probe === 'withdraw_vs_last_approval') calls.push(approvalCall(1, probe.startsWith('reject') ? 'reject' : 'withdraw'), approvalCall(2));
  const results = await race(calls);
  const overlaps = [maxConcurrentIntervals(results.map(r => [r.t0, r.t1]))];
  const after = await observe();
  let audit = await findings();
  let pass = after.writeSeq > before.writeSeq && audit.length === 0;
  if (probe === 'approve_last_two' || probe === 'approve_last_repeat') pass &&= exactlyExecuted(after, fixture) && results.every(r => r.ok) && (probe !== 'approve_last_repeat' || sameId(results, 'executionId'));
  if (probe === 'approve_same_user') pass &&= after.maxApprovalsPerUser === 1 && after.executions === 0 && results.every(r => r.ok);
  if (probe === 'start_follow_up_twice') pass &&= after.followUps === 1 && sameId(results, 'roomId');
  if (probe === 'start_run_repeat') pass &&= after.activeRuns === 1 && after.firstAttempts === 1 && sameId(results, 'runId');
  let variant: ProbeObservation | null = null;
  if (probe === 'join_same_role') {
    pass &&= after.providerMembers === 1 && after.members === 2 && after.maxMembersPerUser === 1 && results.filter(r => r.ok).length === 1 && results.filter(r => !r.ok).every(r => r.code === 'invite.invalid' || r.code === 'invite.seat_taken');
    const second = await admin.mutation('devProbes:prepareConcurrency', { key: `${key}_v`, mode: 'join' }) as unknown as ProbeFixture;
    const variantResults = await race(second.tokens.map(token => ({ client: factory({ issuer: second.issuer, subject: second.subjects[0]! }), name: 'invites:accept', args: { invite: { by: 'link', token } } })));
    overlaps.push(maxConcurrentIntervals(variantResults.map(r => [r.t0, r.t1])));
    results.push(...variantResults);
    variant = await observe(second);
    audit = [...audit, ...await findings(second)];
    pass &&= variant.members === 2 && variant.maxMembersPerUser === 1 && variantResults.filter(r => r.ok).length === 1 && variantResults.filter(r => !r.ok).every(r => r.code === 'invite.already_member') && audit.length === 0;
  }
  if (probe === 'cap_vs_last_approval') {
    const cap = results[0]!, approval = results[1]!;
    pass &&= (cap.ok && !approval.ok && approval.code === 'approval.stale' && after.executions === 0)
      || (!cap.ok && cap.code === 'run.invalid_state' && approval.ok && exactlyExecuted(after, fixture));
  }
  if (probe === 'reject_vs_last_approval' || probe === 'withdraw_vs_last_approval') pass &&= !after.unsafeExecutedDecision && after.executions <= 1 && results.some(r => r.ok) && results.filter(r => !r.ok).every(r => ['approval.already_executed', 'approval.not_current', 'approval.stale'].includes(r.code ?? ''));
  return { pass, overlaps, before, after, variant, findings: audit, results };
}
export async function runConcurrencyProbe(env: Record<string, string | undefined>, probe: ProbeName, factory?: ClientFactory): Promise<void> {
  const refusal = refuseProbeEnvironment(env);
  if (refusal) throw new Error(refusal.message);
  if (probe === 'complete_vs_bump') throw new Error('not implemented: complete_vs_bump requires the dev/preview STUB_DELAY_MS action barrier, which the integrated stub driver does not implement; an HTTP request overlap cannot prove completion happened after the bump');
  const create: ClientFactory = factory ?? (identity => {
    const client = probeClient(identity ?? { issuer: 'https://probe.invalid', subject: 'probe_admin' }, env);
    return { mutation: (name, args) => client.mutation(makeFunctionReference<'mutation'>(name), args), query: (name, args) => client.query(makeFunctionReference<'query'>(name), args) };
  });
  const startedAt = new Date().toISOString();
  const rounds: Awaited<ReturnType<typeof runConcurrencyRound>>[] = [];
  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  let preparationError: string | null = null;
  for (let i = 0; i < PROBE_ROUNDS; i++) {
    try { rounds.push(await runConcurrencyRound(probe, `p_${nonce}_${i}`, create)); }
    catch (error) { preparationError = codeOf(error); break; }
  }
  const results = rounds.flatMap(round => round.results);
  const errorCodes: Record<string, number> = {};
  for (const result of results) if (!result.ok) errorCodes[result.code ?? 'unknown'] = (errorCodes[result.code ?? 'unknown'] ?? 0) + 1;
  const validRounds = rounds.filter(round => round.overlaps.every(overlap => overlap >= 2)).length;
  const pass = preparationError === null && rounds.length === PROBE_ROUNDS && validRounds >= 10 && rounds.every(round => round.pass);
  const evidence = buildConcurrencyEvidence({ probe, method: 'multi_http_client', deployment: env.CONVEX_DEPLOYMENT ?? 'dev', gitSha: env.GIT_SHA ?? 'unknown', n: Math.max(0, ...rounds.map(r => r.results.length)), rounds: PROBE_ROUNDS, validRounds,
    maxOverlapPerRound: rounds.map(round => Math.max(...round.overlaps)), results: { ok: results.filter(r => r.ok).length, rejected: results.filter(r => !r.ok).length, errorCodes },
    invariant: { name: probe, expected: 1, observed: rounds.map(round => Number(round.pass)), pass }, startedAt, finishedAt: new Date().toISOString() });
  await writeEvidence(probe, { ...evidence, preparationError, observations: rounds.map(({ before, after, variant, findings, overlaps }) => ({ before, after, variant, findings, overlaps })) });
  if (!pass) throw new Error('concurrency probe failed: inspect recorded evidence (requires 20 correct rounds and at least 10 overlapping rounds)');
}
runProbeMain(import.meta.url, () => runConcurrencyProbe(process.env, PROBE_TABLE.find(name => name === process.argv[2]) ?? 'approve_last_two'));
