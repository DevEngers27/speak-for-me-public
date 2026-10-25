import { harness } from './w2Execution.fixture';
import type { Doc } from '../../convex/_generated/dataModel';
import { bump as bumpConstraints, makeConstraintTx } from '../../convex/model/constraints';
import { openRoomTx } from '../../convex/lib/db';
import { insertBriefVersion } from '../../convex/model/briefs';
/** Exercise the real constraint disposal/react chain under one held room lock. */
export async function bump(h: Awaited<ReturnType<typeof harness>>, options: { cap?: number; deadline?: string; localDate?: string } = {}) {
  return h.t.run(async ctx => {
    const room = (await ctx.db.get(h.roomId))!;
    if (room.status !== 'open') return room.constraintsVersion;
    const tx = await openRoomTx(ctx, room._id, {allow:['open']});
    const sourceRefs: Doc<'constraintRevisions'>['sourceRefs'] = [];
    if (options.localDate) {
      await tx.patch('rooms',room._id,{localDate:options.localDate});
      sourceRefs.push({kind:'clock',localDate:options.localDate});
    } else {
      const role = options.deadline !== undefined ? 'customer' : 'finance';
      const brief = (await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',room._id).eq('role',role)).order('desc').first())!;
      const hardFields = brief.hardFields.schemaKey === 'scope_change.finance.v1' ? {...brief.hardFields,capCents:options.cap ?? brief.hardFields.capCents+1} : brief.hardFields.schemaKey === 'scope_change.customer.v1' ? {...brief.hardFields,deadline:options.deadline!} : brief.hardFields;
      const next = await insertBriefVersion(tx,{userId:h.users[role]},{role,hardFields,softFields:brief.softFields,disclosures:brief.disclosures,source:'form'});
      sourceRefs.push({kind:'brief',briefId:next._id,role,version:next.version});
    }
    return bumpConstraints(makeConstraintTx({...ctx,tx},room._id),{cause:options.localDate?'clock':'brief_confirmed',sourceRefs,actorUserId:options.deadline!==undefined?h.users.customer:h.users.finance,depth:0});
  });
}
