import {visibleEvents} from './visibleEvents';
import {buildRoomView as buildDecisionRoomView, decisionNotice, proposalCardV} from './decisionView';
export {buildExecutionView, buildProposalCard, buildProposalDetail, executionViewV, proposalDetailV, proposalCardV} from './decisionView';
import {provenanceV} from '../../lib/sourceValidators';
// W2-1: setup-owned room view. Later lanes append their projected builders.
import {v} from 'convex/values';
import type {Doc} from '../../_generated/dataModel';
import type {MemberCtx} from '../../lib/functions';
import {roleV,roomStatusV} from '../../lib/validators';

import {privacy,derivePhase,deriveTodos,deriveInboxSection} from '../../../core/engine';
import {factValueV} from '../../lib/sourceValidators';
import {phaseV,todoV,sharedFactViewV,inboxCardV,nullableNumberV as nn,nullableStringV as ns} from './validators';
import {scenarioOf} from '../../scenarios/registry';
import {latestBrief,catalogRows,currentCatalog,ledgerState,type Role} from '../common';
import {factRows} from '../sharedFacts';
import {loadApprovalSet} from '../approvalHelpers';
import {readinessGaps} from '../constraints';
export const budgetViewV=v.union(v.object({visibility:v.literal('none')}),v.object({visibility:v.literal('finance'),capCents:v.number(),committedCents:v.number(),headroomCents:v.number(),baselineRecorded:v.boolean(),baselineSuggestionCents:nn,proposalCents:nn,totalAfterCents:nn,overByCents:nn,status:v.union(v.literal('within'),v.literal('over'),v.literal('no_proposal'))}),v.object({visibility:v.literal('customer'),capCents:nn,committedCents:nn,headroomCents:nn}));
export const roomViewV=v.object({
 header:v.object({roomId:v.id('rooms'),title:v.string(),scenarioKey:v.literal('scope_change'),status:roomStatusV,phase:phaseV,constraintsVersion:v.number(),proposalVersion:nn,viewingAs:roleV,isCreator:v.boolean(),provenanceBadge:provenanceV}),
 members:v.array(v.object({role:roleV,displayName:v.string(),isMe:v.boolean(),joinedVia:v.union(v.literal('creator'),v.literal('invite'),v.literal('follow_up')),briefConfirmed:v.boolean(),briefVersion:nn})),
 seats:v.union(v.null(),v.array(v.object({role:roleV,state:v.union(v.literal('filled'),v.literal('invited'),v.literal('empty')),inviteMode:v.union(v.literal('email'),v.literal('link'),v.null()),invitedEmail:ns,inviteExpiresAt:nn}))),todos:v.array(todoV),catalog:v.array(v.object({itemKey:v.string(),kind:v.union(v.literal('item'),v.literal('modifier')),title:v.string(),priceCents:v.number(),leadDays:v.number(),revision:v.number()})),sharedFacts:v.array(sharedFactViewV),budget:budgetViewV,currentProposal:v.union(v.null(),proposalCardV),
 proposalHistory:v.union(v.null(),v.array(v.object({proposalId:v.id('proposals'),version:v.number(),status:v.string(),amountCents:v.number(),deliveryDate:v.string(),createdAtConstraintsVersion:v.number()}))),
 run:v.union(v.null(),v.object({runId:v.id('runs'),runNo:v.number(),status:v.string(),roundNo:v.number(),maxRounds:v.number(),activeRole:v.union(roleV,v.null()),turnStatus:ns,attemptStatus:ns,waiting:v.union(v.literal('backoff'),v.literal('spend_deferred'),v.literal('draining'),v.literal('run_cap'),v.null()),staleDiscarded:v.number(),cause:v.string(),endedReason:ns,agentMode:v.union(v.literal('live'),v.literal('stub'))})),
 openRequest:v.union(v.null(),v.object({mine:v.literal(true),requestId:v.id('humanRequests'),kind:v.string(),options:v.array(openRequestOptionV),expiresAt:v.number()}),v.object({mine:v.literal(false),waitingOnRole:roleV,kind:v.string()}),v.object({mine:v.literal(false),kind:v.literal('run_waiting')})),
 execution:v.union(v.null(),v.object({executionId:v.id('executions'),proposalVersion:v.number(),executedAt:v.number(),changeOrderNumber:v.number(),approvalsSnapshot:v.array(v.object({role:roleV,displayName:v.string(),decidedAt:v.number()})),followUpRoomId:ns})),
 followUpOf:v.union(v.null(),v.object({previousRoomId:v.id('rooms'),changeOrderNumber:v.number(),deliveredItems:v.array(v.object({itemKey:v.string(),title:v.string()}))})),
});
export {inboxCardV};
export function memberBriefVersion(viewer:Role,owner:Role,status:Doc<'rooms'>['status'],version:number|null){return viewer!==owner&&status!=='setup'&&privacy.isFitOnlyRole(viewer)?null:version;}
export async function phaseParts(ctx:MemberCtx,providedCard?:import('convex/values').Infer<typeof proposalCardV>|null){
 const gaps=ctx.room.status==='setup'?await readinessGaps(ctx,ctx.room):[];
 const run=ctx.room.currentRunId?await ctx.db.get(ctx.room.currentRunId):null;
 const request=run?await ctx.db.query('humanRequests').withIndex('by_run_status',q=>q.eq('runId',run._id).eq('status','open')).first():null;
 const active=run?.activeTurnSeq?await ctx.db.query('turns').withIndex('by_run_turnSeq',q=>q.eq('runId',run._id).eq('turnSeq',run.activeTurnSeq!)).unique():null;
 const proposal=run?.currentProposalId?await ctx.db.get(run.currentProposalId):null;
 const projectedRequest=request?(ctx.member.role==='provider'?{mine:request.toRole===ctx.member.role}:{mine:request.toRole===ctx.member.role,waitingOnRole:request.toRole}):null;
 const approvalSet=proposal?await loadApprovalSet(ctx,ctx.room,proposal):null;
 const pendingRoles=approvalSet?privacy.projectPendingApprovalRoles(approvalSet):[];
 // INV-SM-05: inbox reads stored approval state without evaluating proposal checks.
 const passesChecks=providedCard===undefined?run?.status==='pending_approval':providedCard?.fit?.audience==='buyer'?providedCard.fit.passesChecks:providedCard?.fit?.value==='ok';
 const mySlot=approvalSet?.slots.find(slot=>slot.role===ctx.member.role)?.slot;
 const phase=derivePhase({room:ctx.room,viewerRole:ctx.member.role,isCreator:ctx.member.isCreator,gaps,run,request:projectedRequest,activeRole:active?.role,proposalVersion:proposal?.version,pendingRoles});
 const todos=deriveTodos(phase,ctx.member.role,ctx.member.isCreator,{passesChecks,state:mySlot?.state}).map((todo):import('convex/values').Infer<typeof todoV>=>({kind:todo.kind,priority:todo.priority,refs:todo.kind==='answer_request'&&request?{requestId:request._id,runId:request.runId}:proposal&&(todo.kind==='decide_proposal'||todo.kind==='redecide_proposal')?{proposalId:proposal._id,proposalVersion:proposal.version}:todo.refs}));
 return {phase,todos,proposalVersion:proposal?.version??null};
}
export async function toRoomView(ctx:MemberCtx){
 const member=await ctx.db.get(ctx.member.memberId);if(!member)throw new Error("Missing member");
 const decisions=await buildDecisionRoomView(ctx,ctx.room,member);
 const plugin=scenarioOf(ctx.room),role=ctx.member.role,parts=await phaseParts(ctx,decisions.currentProposal);
 const lifecycle=await runSections(ctx,ctx.room,role);
 const members=await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',ctx.room._id)).collect();
 const memberViews=[];
 for(const member of members){const brief=await latestBrief(ctx,ctx.room._id,member.role);const projected=privacy.projectForRole(role,{family:'briefs',data:{role:member.role,confirmed:!!brief,version:brief?.version??null}},{plugin,roomStatus:ctx.room.status})!;memberViews.push({role:member.role,displayName:member.displayName,isMe:member.userId===ctx.viewer.userId,joinedVia:member.joinedVia,briefConfirmed:!!brief,briefVersion:typeof projected.version==='number'?projected.version:null});}
 let seats:null|{role:Role;state:'filled'|'invited'|'empty';inviteMode:'email'|'link'|null;invitedEmail:string|null;inviteExpiresAt:number|null}[]=null;
 if(ctx.member.isCreator){seats=[];for(const seatRole of ['customer','provider','finance'] as const){const invites=await ctx.db.query('invites').withIndex('by_room_role',q=>q.eq('roomId',ctx.room._id).eq('role',seatRole)).collect();const invite=invites.find(i=>i.status==='open');const filled=members.some(m=>m.role===seatRole);seats.push({role:seatRole,state:filled?'filled':invite?'invited':'empty',inviteMode:!filled&&invite?invite.mode:null,invitedEmail:!filled&&invite?invite.invitedEmail??null:null,inviteExpiresAt:!filled&&invite?invite.expiresAt:null});}}
 const facts=await factRows(ctx,ctx.room._id),projectedFacts=privacy.projectSharedFacts(role,facts,undefined,plugin);
 const sharedFacts=projectedFacts.map(f=>({fromRole:f.fromRole as Role,field:f.field as string,value:f.value as import('convex/values').Infer<typeof factValueV>,asOfBriefVersion:memberBriefVersion(role,f.fromRole as Role,ctx.room.status,f.asOfBriefVersion as number)}));
 let budget:import('convex/values').Infer<typeof budgetViewV>={visibility:'none'};
 if(role==='finance'){const brief=await latestBrief(ctx,ctx.room._id,role),ledger=await ledgerState(ctx,ctx.room._id);const cap=brief?.hardFields.schemaKey==='scope_change.finance.v1'?brief.hardFields.capCents:0;budget={visibility:'finance',capCents:cap,committedCents:ledger.committedCents,headroomCents:cap-ledger.committedCents,baselineRecorded:!!ledger.baseline,baselineSuggestionCents:null,proposalCents:null,totalAfterCents:null,overByCents:null,status:'no_proposal'};}
 if(role==='customer'){const projected:Readonly<Record<string,unknown>>=privacy.projectForRole(role,{family:'budget',data:{}},{plugin,sharedFacts:facts})??{};budget={visibility:'customer',capCents:typeof projected.capCents==='number'?projected.capCents:null,committedCents:typeof projected.committedCents==='number'?projected.committedCents:null,headroomCents:typeof projected.headroomCents==='number'?projected.headroomCents:null};}
 const catalog=currentCatalog(await catalogRows(ctx,ctx.room._id)).filter(r=>r.status==='confirmed').map(r=>({itemKey:r.itemKey,kind:r.kind,title:r.title,priceCents:r.priceCents,leadDays:r.leadDays,revision:r.revision}));
 return {header:{roomId:ctx.room._id,title:ctx.room.title,scenarioKey:ctx.room.scenarioKey,status:ctx.room.status,phase:parts.phase,constraintsVersion:ctx.room.constraintsVersion,proposalVersion:decisions.header.proposalVersion,viewingAs:role,isCreator:ctx.member.isCreator,provenanceBadge:ctx.room.provenance},members:memberViews,seats,todos:parts.todos,catalog,sharedFacts,budget:role==='finance'&&budget.visibility==='finance'&&decisions.budget.visibility==='finance'?{visibility:budget.visibility,capCents:budget.capCents,committedCents:budget.committedCents,headroomCents:budget.headroomCents,baselineRecorded:budget.baselineRecorded,baselineSuggestionCents:decisions.budget.baselineSuggestionCents,proposalCents:decisions.budget.proposalCents,totalAfterCents:decisions.budget.totalAfterCents,overByCents:decisions.budget.overByCents,status:decisions.budget.status}:budget,currentProposal:decisions.currentProposal,proposalHistory:decisions.proposalHistory,run:lifecycle.run,openRequest:lifecycle.openRequest,execution:decisions.execution,followUpOf:decisions.followUpOf};
}
export async function toInboxCard(ctx:MemberCtx){const parts=await phaseParts(ctx),top=parts.todos[0];const notice=await decisionNotice(ctx,ctx.room,ctx.viewer.userId,ctx.member.role);const latest=await visibleEvents(ctx).order('desc').first();return {roomId:ctx.room._id,title:ctx.room.title,myRole:ctx.member.role,status:ctx.room.status,phase:parts.phase,inboxSection:deriveInboxSection(parts.phase,parts.todos),topTodo:top?{kind:top.kind,proposalVersion:top.refs.proposalVersion??null,constraintsVersion:ctx.room.constraintsVersion}:null,waitingOn:top?null:parts.phase.phase==='needs_input'&&!parts.phase.you?(ctx.member.role==='provider'?'others' as const:parts.phase.waitingOn?[parts.phase.waitingOn]:null):parts.phase.phase==='awaiting_approval'?(parts.phase.pendingRoles??[]).filter(role=>role!==ctx.member.role):null,notice,provenanceBadge:ctx.room.provenance,updatedAt:latest?._creationTime??ctx.room.closedAt??ctx.room.executedAt??ctx.room.openedAt??ctx.room.createdAt};}
// End W2-1.

// W2-4: lifecycle sections composed into the platform DTO.
import type {QueryCtx} from '../../_generated/server';
import {projectOpenRequestOptions,openRequestOptionV} from './requestOptions';
export function turnForRole(turn: Doc<'turns'>, role: Role, attempt: Doc<'attempts'> | null) {
  const own = turn.role === role;
  const status=own?turn.status:['scheduled','running'].includes(turn.status)?turn.status:'done';
  if(own)return {turnSeq:turn.turnSeq,role:turn.role,kind:turn.kind,status,attemptStatus:attempt?.status??null,waiting:turn.waitingReason??null,result:turn.result??null,candidateSnapshot:turn.candidateSnapshot,completedAt:turn.completedAt??null};
  return {turnSeq:turn.turnSeq,role:turn.role,kind:turn.kind,status,attemptStatus:null,waiting:null};
}
export async function runSections(ctx: QueryCtx, room: Doc<'rooms'>, role: Role) {
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const request = run ? await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', run._id).eq('status', 'open')).unique() : null;
  const turns = run ? await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect() : [];
  const active = turns.find(t => t.turnSeq === run?.activeTurnSeq) ?? null;
  const attempt = active ? await ctx.db.query('attempts').withIndex('by_turn', q => q.eq('turnId', active._id)).order('desc').first() : null;
  const own = active?.role === role;
  const providerWaiting = role === 'provider' && run?.status === 'needs_input' && request?.toRole !== 'provider';
  const history = await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', room._id)).order('desc').collect();
  return {
    run: run ? { runId: run._id, runNo: run.runNo, status: providerWaiting ? 'run_waiting' : run.status, roundNo: run.roundNo, maxRounds: run.maxRounds, activeRole: providerWaiting ? null : active?.role ?? (request?.toRole === role ? role : null), turnStatus: active ? turnForRole(active, role, attempt).status : null, attemptStatus: own ? attempt?.status ?? null : null, waiting: own ? active?.waitingReason ?? null : null, staleDiscarded: turns.filter(t => t.status === 'stale').length, cause: run.cause, endedReason: run.endedReason ?? null, agentMode: run.agentMode } : null,
    openRequest: request ? request.toRole === role ? { mine: true as const, requestId: request._id, kind: request.kind, options: projectOpenRequestOptions(role,request), expiresAt: request.expiresAt } : role === 'provider' ? { mine: false as const, kind: 'run_waiting' as const } : { mine: false as const, kind: request.kind, waitingOnRole: request.toRole } : null,
    proposalHistory: history.map(p => ({ proposalId: p._id, version: p.version, status: role === 'provider' && p.status === 'stale' ? 'superseded' : p.status, amountCents: p.terms.amountCents, deliveryDate: p.terms.deliveryDate, createdAtConstraintsVersion: p.createdAtConstraintsVersion })),
  };
}
