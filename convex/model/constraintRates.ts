import type {MutationCtx} from '../_generated/server';
import type {Doc} from '../_generated/dataModel';
import {assertWithinRate} from '../lib/rateLimit';
export async function assertDailyConstraintBucket(ctx:MutationCtx,room:Doc<'rooms'>,kind:'price_writes'|'hard_fields'){
 if(room.status!=='open')return;
 const opened=await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',room._id)).filter(q=>q.eq(q.field('payload.type'),'room_opened')).first();
 await assertWithinRate(ctx,{kind,roomId:room._id,windowMs:86400000,limit:kind==='price_writes'?3:6,afterCommitTs:opened?.commitTs,
  matches:p=>kind==='price_writes'?(p.type==='catalog_item_retired'||p.type==='catalog_item_confirmed'&&p.priceChanged):(p.type==='brief_confirmed'&&p.hardChanged)});
}
