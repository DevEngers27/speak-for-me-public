import {v} from 'convex/values';
import {memberMutation,memberQuery} from './lib/functions';
import {roleV} from './lib/validators';
import {hardFieldsV,softFieldsV,disclosuresV,confirmResultV,briefSourceV,factValueV} from './lib/sourceValidators';
import {confirmCore} from './model/briefs';
import {mineView} from './model/views/briefView';
export const confirm=memberMutation('briefs.confirm')({args:{roomId:v.id('rooms'),expectedConstraintsVersion:v.number(),hardFields:hardFieldsV,softFields:softFieldsV,disclosures:disclosuresV},returns:confirmResultV,handler:async(ctx,args)=>await confirmCore(ctx,{userId:ctx.viewer.userId},args)});
export const mine=memberQuery('briefs.mine')({args:{roomId:v.id('rooms')},returns:v.union(v.null(),v.object({role:roleV,latest:v.union(v.null(),v.object({version:v.number(),hardFields:hardFieldsV,softFields:softFieldsV,disclosures:disclosuresV,confirmedAt:v.number(),source:briefSourceV})),versions:v.array(v.object({version:v.number(),confirmedAt:v.number(),source:briefSourceV,notes:v.string(),changedHardFields:v.array(v.string())})),othersSee:v.array(v.object({role:roleV,fields:v.array(v.object({field:v.string(),value:factValueV,asOfBriefVersion:v.number()}))})),finance:v.union(v.null(),v.object({committedCents:v.number(),baselineRecorded:v.boolean(),baselineSuggestionCents:v.union(v.number(),v.null())}))})),handler:async ctx=>await mineView(ctx)});

import {appError} from './lib/errors';
import {openRoomTx} from './lib/db';
import {assertWithinRate} from './lib/rateLimit';
import {latestBrief,assertStatus} from './model/common';
import {insertBriefVersion} from './model/briefs';
import {appendEvents} from './model/events';
import {validateNotes} from '../core/scenarios/scope-change';
export const updateSoft=memberMutation('briefs.updateSoft')({
 args:{roomId:v.id('rooms'),notes:v.string()},returns:v.object({briefVersion:v.number()}),
 handler:async(ctx,args)=>{
  assertStatus(ctx.room);
  const old=await latestBrief(ctx,args.roomId,ctx.member.role);
  if(!old)throw appError('run.invalid_state',{guard:'brief_missing'});
  const notes=args.notes.normalize('NFC');
  if(!validateNotes(notes).ok)throw appError('input.invalid',{field:'notes'});
  if(notes===old.softFields.notes)return {briefVersion:old.version};
  await assertWithinRate(ctx,{kind:'soft_writes',roomId:args.roomId,actorUserId:ctx.viewer.userId});
  const tx=await openRoomTx(ctx,args.roomId,{allow:['setup','open']});
  const brief=await insertBriefVersion(tx,{userId:ctx.viewer.userId},{role:ctx.member.role,hardFields:old.hardFields,softFields:{...old.softFields,notes},disclosures:old.disclosures,source:'soft_update'});
  await appendEvents(tx,[{payload:{type:'brief_soft_updated',briefVersion:brief.version},actor:{kind:'user',role:ctx.member.role},actorUserId:ctx.viewer.userId,restrictedRef:{table:'briefs',id:brief._id}}]);
  return {briefVersion:brief.version};
 }
});
