import { openRoomTx } from './model/runtimeTx';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { reasonCodeV } from './lib/validators';
import { sysMutation } from './lib/functions';
import { agentMoveV } from './schema';
import { actorV, originV, modelResponseV, failOutcomeV, beginResultV } from './model/runtimeValidators';
import { beginAttemptTx, commitAttempt, reconcileRun } from './model/runs';
import {memberQuery} from './lib/functions';
export const beginAttempt = sysMutation('turns.beginAttempt')({ args: { turnId: v.id('turns'), origin: originV, actorUserId: actorV, retryNote: v.optional(reasonCodeV) }, returns: beginResultV, handler: async (ctx, args) => {
  const turn = await ctx.db.get(args.turnId);
  const room = turn ? await ctx.db.get(turn.roomId) : null;
  if (!turn || !room) return { kind: 'stale' as const };
  const tx = await openRoomTx(ctx, room._id, [room.status], args.actorUserId);
  if (!['scheduled', 'running'].includes(turn.status)) { await reconcileRun(tx, turn.runId); return { kind: 'stale' as const }; }
  const result = await beginAttemptTx(tx, turn._id, { origin: args.origin, delayMs: 0, retryNote: args.retryNote });
  if (result.kind === 'stale') await reconcileRun(tx, turn.runId);
  return result;
} });
export const complete = sysMutation('turns.complete')({ args: { attemptId: v.id('attempts'), actorUserId: actorV, move: agentMoveV, response: modelResponseV, schemaVersion: v.string(), latencyMs: v.number(),rationaleTruncated:v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => { await commitAttempt(ctx, args); return null; } });
export const fail = sysMutation('turns.fail')({ args: { attemptId: v.id('attempts'), actorUserId: actorV, outcome: failOutcomeV, schemaVersion: v.optional(v.string()), latencyMs: v.number() }, returns: v.null(), handler: async (ctx, args) => { await commitAttempt(ctx, args); return null; } });
export const mine = memberQuery('turns.mine')({ returns:v.union(v.null(),paginationResultValidator(v.object({turnSeq:v.number(),roundNo:v.number(),kind:v.union(v.literal('propose'),v.literal('evaluate')),status:v.string(),action:v.union(v.string(),v.null()),proposalVersion:v.union(v.number(),v.null()),rationale:v.union(v.string(),v.null()),outcome:v.union(v.string(),v.null()),attempts:v.array(v.object({attemptNo:v.number(),status:v.string(),errorCode:v.union(v.string(),v.null()),inputTokens:v.number(),outputTokens:v.number(),latencyMs:v.union(v.number(),v.null()),provenance:v.union(v.literal('live'),v.literal('stub'),v.literal('seeded'))}))}))),args: { roomId: v.id('rooms'), runId: v.union(v.id('runs'), v.null()), paginationOpts: paginationOptsValidator }, handler: async (ctx, { roomId, runId, paginationOpts }) => {
  const m={room:ctx.room,role:ctx.member.role};
  const selectedRunId = runId ?? m.room.currentRunId;
  const run = selectedRunId ? await ctx.db.get(selectedRunId) : null;
  if (!run || run.roomId !== roomId) return null;
  const page = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).order('desc').paginate(paginationOpts);
  return { ...page, page: await Promise.all(page.page.filter(t => t.role === m.role).map(async t => ({
    turnSeq: t.turnSeq, roundNo: t.roundNo, kind: t.kind, status: t.status,
    action: t.result?.action ?? null, proposalVersion: t.baseProposalVersion ?? null,
    rationale: t.result?.rationale ?? null, outcome: t.outcome?.blockedCandidateKey ? 'blocked' : t.outcome?.proposalId ? 'proposed' : null,
    attempts: (await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', t._id)).collect()).map(a => ({ attemptNo: a.attemptNo, status: a.status, errorCode: a.errorCode ?? null, inputTokens: a.usage?.inputTokens ?? 0, outputTokens: a.usage?.outputTokens ?? 0, latencyMs: a.latencyMs ?? null, provenance: a.provenance })),
  }))) };
} });
