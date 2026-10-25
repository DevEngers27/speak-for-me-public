import {v} from 'convex/values';
import {memberMutation} from './lib/functions';
import {recordBaselineCore} from './model/ledger';
export const recordBaseline=memberMutation('ledger.recordBaseline')({args:{roomId:v.id('rooms'),amountCents:v.number()},returns:v.object({status:v.union(v.literal('recorded'),v.literal('unchanged')),ledgerEntryId:v.id('ledgerEntries')}),roles:['finance'],handler:async(ctx,args)=>await recordBaselineCore(ctx,{userId:ctx.viewer.userId},args)});
