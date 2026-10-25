import type {MemberCtx} from '../../lib/functions';
import {privacy,type ProposalLike} from '../../../core/engine';
import {scenarioOf} from '../../scenarios/registry';
import {currentRunProposal,evaluateProposal,loadRuleInput,effectiveApprovals} from '../constraintInput';
import {factRows} from '../sharedFacts';
import type {roomViewV} from './roomView';
type Result=Pick<import('convex/values').Infer<typeof roomViewV>,'currentProposal'>;
export async function constraintRunView(ctx:MemberCtx):Promise<Result>{
 const room=ctx.room,role=ctx.member.role,roomId=room._id;
 const {run,proposal:linked}=await currentRunProposal(ctx,roomId);
 const proposal=linked?.status==='active'?linked:null;
 const members=await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',roomId)).collect();
 const input=await loadRuleInput(ctx,roomId),facts=await factRows(ctx,roomId);
 const evaluation=proposal?evaluateProposal(input,proposal as unknown as ProposalLike):null;
 const checks=evaluation?privacy.projectChecks(role,evaluation.checks.filter(c=>c.status==='fail'&&c.code!==null).map(c=>({checkId:c.checkId,code:c.code!,ownerRole:c.owner as 'finance'|'customer'|'provider'|null,inputs:c.owner==='finance'?['capCents','committedCents']:c.owner==='customer'?['requiredItemKeys','deadline']:[],params:c.params,passed:false})),{plugin:scenarioOf(room),sharedFacts:facts}):null;
 const approvals=proposal?await effectiveApprovals(ctx,roomId,proposal):null;
 return{
 currentProposal:proposal?{proposalId:proposal._id,version:proposal.version,termsKey:proposal.termsKey,origin:proposal.origin,provenance:proposal.provenance,createdAtConstraintsVersion:proposal.createdAtConstraintsVersion,terms:proposal.terms,lines:proposal.lines.map(l=>({itemKey:l.itemKey,kind:l.kind,title:l.title,priceCents:l.priceCents})),summaryText:`Proposal ${proposal.version}`,diffFromPrevious:null,
 fit:role==='provider'?{audience:'provider',value:evaluation?.passesChecks?'ok':'blocked'}:{audience:'buyer',passesChecks:evaluation?.passesChecks??false,checks:checks?.kind==='checks'?checks.items.map(item=>{const c=item as {code:string};return{code:c.code,owner:c.code==='private.constraint_unmet'?'other':'self',text:c.code};}):[]},
 notIncludedForMe:role==='customer'?(input.requiredItemKeys??[]).filter(k=>!proposal.terms.itemKeys.includes(k)):null,
 approvals:approvals!.slots.map(s=>({role:s.role as typeof role,kind:s.kind,displayName:members.find(m=>m.role===s.role)?.displayName??'',isMe:s.role===role,state:s.slot.state==='vacant'||s.slot.state==='self_conflict'?'pending':s.slot.state,boundConstraintsVersion:'boundConstraintsVersion'in s.slot?s.slot.boundConstraintsVersion:null,reasonKey:null})),allApproved:approvals!.complete,
 myAction:{canDecide:run?.status==='pending_approval'&&!!evaluation?.passesChecks,kind:role==='finance'?'budget':'terms',disabledReasonCode:null,current:null,completesSet:false,canWithdraw:false},recordsPreview:{changeOrderNumber:1,taskCount:proposal.plannedTasks.length,myTaskTitles:proposal.plannedTasks.filter(t=>t.assigneeRole===role).map(t=>t.title),commitCents:proposal.terms.amountCents},myAgentSuggestion:null}:null,
 };
}
