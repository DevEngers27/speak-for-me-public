import {v} from 'convex/values';
import {memberMutation} from './lib/functions';
import {roleV} from './lib/validators';
import {addCore} from './model/sharedFacts';
export const add=memberMutation('sharedFacts.add')({args:{roomId:v.id('rooms'),field:v.string(),audience:v.array(roleV),confirmOwnDisclosure:v.boolean()},returns:v.object({status:v.union(v.literal('shared'),v.literal('withdrawn'),v.literal('unchanged')),sharedFactId:v.union(v.id('sharedFacts'),v.null())}),handler:async(ctx,args)=>await addCore(ctx,{userId:ctx.viewer.userId},args)});
