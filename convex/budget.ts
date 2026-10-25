import {v} from 'convex/values';
import {memberMutation} from './lib/functions';
import {confirmResultV} from './lib/sourceValidators';
import {setCapCore} from './model/briefs';
export const setCap=memberMutation('budget.setCap')({args:{roomId:v.id('rooms'),capCents:v.number(),expectedConstraintsVersion:v.number()},returns:confirmResultV,roles:['finance'],handler:async(ctx,args)=>await setCapCore(ctx,{userId:ctx.viewer.userId},args)});
