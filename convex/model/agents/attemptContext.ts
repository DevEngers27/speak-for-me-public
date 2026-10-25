/** Scheduler guards plus W2-5's role-scoped context loader. No write lock is taken. */
import {v} from 'convex/values';
import type {QueryCtx} from '../../_generated/server';
import type {Id} from '../../_generated/dataModel';
import type {MemberCtx} from '../../lib/functions';
import {attemptGuard,exclusions} from '../runs';
import {loadTurnContext} from './context';
import {roleView} from '../runtimeSources';
import {checkStored} from '../_parallelStubs.w2-4';
import {cents,isoDate,type AgentTurnInput,type TurnSpec,type TurnSemanticsView,type ReasonCode} from '@core/engine';

export const attemptContextV=v.union(v.null(),v.object({agentMode:v.union(v.literal('stub'),v.literal('live')),inputJson:v.string(),semanticsJson:v.string()}));
export type AttemptInput=AgentTurnInput&{spec:TurnSpec};
export async function loadAttemptContext(ctx:QueryCtx,attemptId:Id<'attempts'>){
 const g=await attemptGuard(ctx,attemptId);
 if(!g.g0||g.guard||!g.attempt||!g.turn||!g.run||!g.room||g.room.scenarioVersion!==1)return null;
 const turn=g.turn,run=g.run,room=g.room;
 const seat=await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',room._id).eq('role',turn.role)).unique();
 const user=seat?await ctx.db.get(seat.userId):null;
 if(!seat||!user)return null;
 const memberCtx:MemberCtx={...ctx,room,viewer:{userId:user._id,tokenIdentifier:user.tokenIdentifier,emailVerified:true},member:{memberId:seat._id,role:seat.role,isCreator:room.createdBy===user._id}};
 const ex=await exclusions(ctx,run._id);
 const requests=await ctx.db.query('humanRequests').withIndex('by_run_status',q=>q.eq('runId',run._id)).collect();
 const {view}=await roleView(ctx,room,turn.role);
 const base=turn.baseProposalId?await ctx.db.get(turn.baseProposalId):null;
 const currentProposal=base?{...base,fit:checkStored(view,base).passesChecks?'ok' as const:'blocked' as const}:null;
 const previous=ex.turns.findLast(t=>t.role==='provider'&&t.kind==='propose'&&t.roundNo<turn.roundNo);
 const counter=ex.turns.findLast(t=>t.roundNo<turn.roundNo&&t.result?.action==='counter'&&t.outcome?.candidateKey);
 const selected=counter?turn.candidateSnapshot.find(c=>c.candidateKey===counter.outcome?.candidateKey):null;
 const feedback=turn.role==='provider'&&previous?(previous.outcome?.blockedCandidateKey?{fit:'blocked' as const}:{kind:'not_accepted' as const,...(selected?{counter:selected}:{})}):null;
 const input=await loadTurnContext(memberCtx,{run,turn:{...turn,candidateSnapshot:turn.candidateSnapshot.map(c=>({...c,amountCents:cents(c.amountCents),deliveryDate:isoDate(c.deliveryDate)}))},currentProposal,proposals:ex.proposals,humanRequests:requests,
  feedback,proposalCounts:Object.fromEntries(['customer','provider','finance'].map(role=>[role,ex.turns.filter(t=>t.role===role&&(t.result?.action==='propose'||t.result?.action==='counter')).length])),maxProposalsPerRole:4,
  clarifyUsed:ex.turns.some(t=>t.role===turn.role&&t.result?.action==='clarify'),escalateUsed:ex.turns.some(t=>t.role===turn.role&&t.result?.action==='escalate'),
  providerRejectLocked:requests.some(r=>r.status==='answered'&&r.kind==='agent_escalated'&&r.toRole==='provider'&&r.options.find(o=>o.optionKey===r.answerOptionKey)?.effect.type==='keep_as_is'),
  ...(g.attempt.retryNote?{retryNote:g.attempt.retryNote as ReasonCode}:{}),turnSalt:turn._id});
 const semantics:TurnSemanticsView={role:turn.role,turnKind:turn.kind,allowedActions:turn.allowedActions,snapshot:turn.candidateSnapshot.map(c=>({...c,amountCents:cents(c.amountCents),deliveryDate:isoDate(c.deliveryDate)})),excludedCandidateKeys:turn.role==='provider'?ex.provider:ex.rejected,
  ...(turn.baseProposalVersion?{currentProposalVersion:turn.baseProposalVersion}:{}),reasonKeys:input.spec.reasonKeys,clarifyTargets:input.spec.clarifyTargets,escalationRoles:input.spec.escalationRoles};
 // Serializing here strips projection brands; only plain Convex strings cross the query boundary.
 return {agentMode:run.agentMode,inputJson:JSON.stringify(input),semanticsJson:JSON.stringify(semantics)};
}
export type TurnContext=NonNullable<Awaited<ReturnType<typeof loadAttemptContext>>>;
