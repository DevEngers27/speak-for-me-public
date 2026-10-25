import { openRoomTx } from '../../convex/model/runtimeTx';
import { seedRoom } from './seedRoom.fixture';

import { openHumanRequestTx } from '../../convex/model/runs';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
export async function customRequest(effect: Doc<'humanRequests'>['options'][number]['effect'], role: 'customer' | 'provider' | 'finance', kind: Doc<'humanRequests'>['kind'] = 'agent_failed') {
  const s = await seedRoom();
  const requestId = await s.t.run(async ctx => {
    const a = (await ctx.db.query('attempts').first())!;
    await ctx.db.patch(a._id, { status: 'error' });
    await ctx.db.patch(a.turnId, { status: 'failed' });
    const tx = await openRoomTx(ctx, s.roomId, ['open']);
    const requestId = await openHumanRequestTx(tx, a.runId, { kind: 'agent_failed', toRole: role, sourceTurnId: a.turnId });
    await ctx.db.patch(requestId, { kind, options: [{ optionKey: 'A', templateKey: effect.type, effect }, { optionKey: 'E', templateKey: 'end_run', effect: { type: 'end_run' } }] });
    return requestId;
  });
  return { ...s, requestId, answer: () => s.as(role).mutation(api.humanRequests.answer, { requestId, optionKey: 'A' }) };
}
