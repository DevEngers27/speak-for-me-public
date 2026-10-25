import {v} from 'convex/values';
import {memberMutation,memberQuery} from './lib/functions';
import {catalogInputV} from './lib/sourceValidators';
import {catalogRowViewV} from './model/views/validators';
import {confirmCore,retireCore} from './model/catalog';
import {listView} from './model/views/catalogView';
export const confirm=memberMutation('catalog.confirm')({args:{roomId:v.id('rooms'),expectedConstraintsVersion:v.number(),rows:v.array(catalogInputV)},returns:v.object({status:v.union(v.literal('confirmed'),v.literal('unchanged')),rows:v.array(v.object({itemKey:v.string(),revision:v.number(),editNo:v.number(),changed:v.boolean()})),constraintsVersion:v.number(),bumped:v.boolean()}),roles:['provider'],handler:async(ctx,args)=>await confirmCore(ctx,{userId:ctx.viewer.userId},args)});
export const retire=memberMutation('catalog.retire')({args:{roomId:v.id('rooms'),itemKey:v.string(),expectedConstraintsVersion:v.number()},returns:v.object({status:v.union(v.literal('retired'),v.literal('unchanged')),revision:v.number(),constraintsVersion:v.number(),bumped:v.boolean()}),roles:['provider'],handler:async(ctx,args)=>await retireCore(ctx,{userId:ctx.viewer.userId},args)});
export const list=memberQuery('catalog.list')({args:{roomId:v.id('rooms')},returns:v.union(v.null(),v.object({items:v.array(catalogRowViewV),mine:v.union(v.null(),v.object({drafts:v.array(catalogRowViewV),history:v.array(catalogRowViewV)}))})),handler:async ctx=>await listView(ctx)});
