import {v} from 'convex/values';
import {requestOptionShownV} from '../../schema';
import {roleV} from '../../lib/validators';
export const openRequestOptionV=v.union(
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('disclose'),disclose:v.object({field:v.string(),toRoles:v.array(roleV)})}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('pass_to_next'),toRole:roleV}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('raise_cap'),effect:v.object({amountCents:v.number()})}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('drop_items'),effect:v.object({itemKeys:v.array(v.string())})}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('extend_deadline'),effect:v.object({date:v.string()})}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('choose_candidate')}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('keep_as_is')}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('end_run')}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('blocked')}),
 v.object({optionKey:v.string(),text:v.string(),shown:requestOptionShownV,effectView:requestOptionShownV,answerable:v.boolean(),type:v.literal('retry_turn')}),
);
import {privacy} from '@core/engine';
import type {Doc} from '../../_generated/dataModel';
import type {Role} from '../common';
import {requestOptionText} from '../_parallelStubs.w2-4';

/** Shared live-room/permalink DTO from immutable, target-projected stored options. */
export function projectOpenRequestOptions(viewer:Role,request:Pick<Doc<'humanRequests'>,'toRole'|'options'|'status'>) {
 return privacy.projectStoredRequestOptions(viewer,request.toRole,request.options).map(option=>{
  switch(option.type) {
   case 'disclose': return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type,disclose:option.disclose};
   case 'pass_to_next': return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type,toRole:option.toRole};
   case 'raise_cap': return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type,effect:option.effect};
   case 'drop_items': return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type,effect:option.effect};
   case 'extend_deadline': return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type,effect:option.effect};
   case 'choose_candidate': case 'keep_as_is': case 'end_run': case 'blocked': case 'retry_turn':
    return {optionKey:option.optionKey,text:requestOptionText(option.type),shown:option.effectView,effectView:option.effectView,answerable:request.status==='open'&&option.answerable,type:option.type};
  }
 });
}
