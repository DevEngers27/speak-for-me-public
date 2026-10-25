import {constraintBudgetDetail,constraintRoleDetail,factDetail,renderTimelineEvent} from './timelineTemplates';
import {scenarioOf} from '../../scenarios/registry';
import {provenanceV} from '../../lib/sourceValidators';
import {v} from 'convex/values';
import type {Doc} from '../../_generated/dataModel';
import type {MemberCtx} from '../../lib/functions';
import {privacy,publicText} from '../../../core/engine';
import {roleV} from '../../lib/validators';
export const timelineItemV=v.object({eventId:v.id('events'),type:v.string(),at:v.number(),actorKind:v.union(v.literal('human'),v.literal('agent'),v.literal('rules'),v.literal('system')),actorRole:v.union(roleV,v.literal('system')),text:v.string(),refs:v.object({proposalVersion:v.union(v.number(),v.null()),constraintsVersion:v.union(v.number(),v.null()),runNo:v.union(v.number(),v.null())}),privateToYou:v.boolean(),provenance:provenanceV});
export async function timelineView(ctx:MemberCtx,events:Doc<'events'>[]){
 const out:import('convex/values').Infer<typeof timelineItemV>[]=[];
 const batches=new Map<Doc<'events'>['commitTs'],Doc<'events'>[]>();
 for(const event of events){if(!batches.has(event.commitTs))batches.set(event.commitTs,await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',ctx.room._id).eq('commitTs',event.commitTs)).collect());}
 for(const event of events){
  const p=event.payload,batch=batches.get(event.commitTs)!,provider=ctx.member.role==='provider';
  const changed=batch.some(e=>e.payload.type==='constraints_changed');
  const neutral=provider&&changed&&!batch.some(e=>e.actorUserId===ctx.viewer.userId);
  let privateToYou=false,recipient=false,requestMine=false;
  let disclosure:publicText.Fragment|null=null,amount:number|null=null,cause:string|null=null,requestKind:string|null=null,constraintDetail:publicText.Fragment|null=null;
  if(event.restrictedRef){const row=await ctx.db.get(event.restrictedRef.id);if(row&&'roomId'in row&&row.roomId===ctx.room._id){if(event.restrictedRef.table==='sharedFacts'&&'audience'in row){
       const previous=await ctx.db.query('sharedFacts').withIndex('by_room_from_field',q=>q.eq('roomId',ctx.room._id).eq('fromRole',row.fromRole).eq('field',row.field).lt('seq',row.seq)).order('desc').first();
       recipient=row.audience.includes(ctx.member.role)||previous?.audience.includes(ctx.member.role)===true||row.fromRole===ctx.member.role;privateToYou=recipient;
       const projected=privacy.projectSharedFacts(ctx.member.role,[row],row.briefVersion,scenarioOf(ctx.room))[0];
       if(recipient){const removed=row.fromRole!==ctx.member.role&&!row.audience.includes(ctx.member.role);if(removed)disclosure=factDetail(row.field,null,true);else if(row.value===null)disclosure=factDetail(row.field,null,false);else if(projected)disclosure=factDetail(row.field,projected.value as Doc<'sharedFacts'>['value'],false);}
      }else if(event.restrictedRef.table==='humanRequests'&&'toRole'in row){requestMine=row.toRole===ctx.member.role;privateToYou=requestMine;const projected=privacy.projectForRole(ctx.member.role,{family:'humanRequests',data:{kind:row.kind,toRole:row.toRole,status:row.status}},{plugin:scenarioOf(ctx.room)});if(projected?.kind&&projected.kind!=='run_waiting')requestKind=String(projected.kind);}
      else if(event.restrictedRef.table==='constraintRevisions'&&'cause'in row){
       const projected=privacy.projectForRole(ctx.member.role,{family:'constraintRevisions',data:row},{plugin:scenarioOf(ctx.room)});if(typeof projected?.cause==='string')cause=projected.cause;
       const source=row.sourceRefs.find(s=>s.kind==='brief');
       if(!provider&&source?.kind==='brief'){
        constraintDetail=constraintRoleDetail(source.role);
        if(source.role==='finance'){
         const brief=await ctx.db.get(source.briefId);
         const prior=await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',ctx.room._id).eq('role','finance').lt('version',source.version)).order('desc').first();
         let before:number|undefined,after:number|undefined;
         if(ctx.member.role==='finance'){
          before=prior?.hardFields.schemaKey==='scope_change.finance.v1'?prior.hardFields.capCents:undefined;
          after=brief?.hardFields.schemaKey==='scope_change.finance.v1'?brief.hardFields.capCents:undefined;privateToYou=true;
         }else{
          // CN-004 #7: use version-bound facts that existed at this commit.
          // New sharing cannot retroactively expose the preceding private cap.
          const committed=await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',ctx.room._id).lte('commitTs',event.commitTs)).collect();
          const facts:Doc<'sharedFacts'>[]=[];
          for(const change of committed)if(change.restrictedRef?.table==='sharedFacts'){const fact=await ctx.db.get(change.restrictedRef.id);if(fact)facts.push(fact);}
          const capAt=(version:number)=>{const fact=privacy.projectSharedFacts(ctx.member.role,facts,version,scenarioOf(ctx.room)).find(f=>f.fromRole==='finance'&&f.field==='capCents');const value=fact?.value as Doc<'sharedFacts'>['value']|undefined;return value?.kind==='cents'?value.cents:undefined;};
          before=prior?capAt(prior.version):undefined;after=capAt(source.version);privateToYou=before!==undefined||after!==undefined;
         }
         constraintDetail=constraintBudgetDetail(before,after)??constraintDetail;
        }
       }
      }
      else if('role'in row)privateToYou=row.role===ctx.member.role;
      else if(event.restrictedRef.table==='ledgerEntries'&&'amountCents'in row){
       privateToYou=ctx.member.role==='finance';
       if(privateToYou)amount=row.amountCents;
       else if(ctx.member.role==='customer') {
        // PV-12: resolve disclosure rows present at this commit, never today's
        // disclosure settings; a later share cannot expose an earlier ledger event.
        const changes=await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',ctx.room._id).lte('commitTs',event.commitTs)).collect();
        const facts:Doc<'sharedFacts'>[]=[];
        for(const change of changes)if(change.restrictedRef?.table==='sharedFacts'){const fact=await ctx.db.get(change.restrictedRef.id);if(fact)facts.push(fact);}
        const fact=privacy.projectSharedFacts(ctx.member.role,facts,undefined,scenarioOf(ctx.room)).find(f=>f.fromRole==='finance'&&f.field==='committedCents');
        const value=fact?.value as Doc<'sharedFacts'>['value']|undefined;
        if(value?.kind==='cents'){amount=value.cents;privateToYou=true;}
       }
      }
}}
  if(p.type==='brief_soft_updated'&&!privateToYou)continue;
  if(provider&&changed&&ctx.room.status!=='setup'&&(
   p.type==='brief_confirmed'&&p.role!==ctx.member.role||p.type==='human_request_answered'&&event.actorUserId!==ctx.viewer.userId||p.type==='human_request_closed'&&p.status==='superseded'||p.type==='disclosure_changed'&&!recipient&&p.fromRole!==ctx.member.role
  ))continue;
  let type:string=p.type;
  if((p.type==='run_needs_input'||p.type==='human_request_opened')&&provider&&!requestMine)type='run_waiting';
  if(p.type==='turn_failed'&&p.role!==ctx.member.role)type='turn_completed';
  const owner=p.type==='brief_confirmed'||p.type==='turn_failed'?p.role===ctx.member.role:p.type==='disclosure_changed'?p.fromRole===ctx.member.role:p.type==='run_needs_input'||p.type==='human_request_opened'?requestMine:event.actor.kind!=='system'&&event.actor.role===ctx.member.role;
  const text=renderTimelineEvent(p,ctx.member.role,{owner,fact:disclosure,amount,cause,requestKind,constraintDetail});
  const actorKind=neutral?'system' as const:event.actor.kind==='user'?'human' as const:event.actor.kind==='agent'?'agent' as const:p.type==='constraints_changed'?'rules' as const:'system' as const;
  const actorRole=neutral||event.actor.kind==='system'?'system' as const:event.actor.role;
  out.push({eventId:event._id,type,at:event._creationTime,actorKind,actorRole,text,refs:{proposalVersion:'proposalVersion'in p?p.proposalVersion:null,constraintsVersion:p.type==='constraints_changed'?p.toVersion:'constraintsVersion'in p?p.constraintsVersion:null,runNo:'runNo'in p?p.runNo:null},privateToYou,provenance:event.provenance});
 }
 return out;
}
