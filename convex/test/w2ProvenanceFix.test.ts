import { describe, expect, it } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import type { Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { roomViewV } from '../model/views/roomView';
import { harness } from '../../tests/convex-helpers/w2Execution.fixture';

const followUpRef = makeFunctionReference<'mutation', { executionId: Id<'executions'> }, { roomId: Id<'rooms'>; created: boolean }>('rooms:startFollowUp');
const viewRef = makeFunctionReference<'query', { roomId: Id<'rooms'> }, Infer<typeof roomViewV> | null>('rooms:view');

describe('W2-2 fix F1 follow-up provenance', () => {
  it('INV-62 stub execution in live room makes follow-up room and derived drafts/events stub', async () => {
    const h = await harness();
    await h.t.run(ctx => ctx.db.patch(h.proposalId, { provenance: 'stub' }));
    const result = await h.execute();
    const initial = await h.t.run(async ctx => ({ room: await ctx.db.get(h.roomId), execution: await ctx.db.get(result.executionId!) }));
    expect(initial.room?.provenance).toBe('live');
    expect(initial.execution?.provenance).toBe('stub');
    const followUp = await h.as('customer').mutation(followUpRef, { executionId: result.executionId! });
    const data = await h.t.run(async ctx => ({
      room: await ctx.db.get(followUp.roomId),
      drafts: await ctx.db.query('catalogItems').withIndex('by_room_item', q => q.eq('roomId', followUp.roomId)).collect(),
      events: await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', followUp.roomId)).collect(),
      ledger: await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', followUp.roomId)).collect(),
    }));
    expect(data.room?.provenance).toBe('stub');
    expect(data.room?.writeSeq).toBe(0); // Genesis uses createRoomTx, without a second lock.
    expect(await h.t.run(async ctx=>(await ctx.db.get(h.roomId))?.writeSeq)).toBe(initial.room!.writeSeq+1);
    expect(data.drafts).toHaveLength(1);
    expect(data.drafts[0]).toMatchObject({ itemKey: 'extra_item', status: 'draft', provenance: 'stub' });
    expect(data.events).toHaveLength(4);
    expect(data.events.every(event => event.provenance === 'stub')).toBe(true);
    expect(data.events.map(event=>event.seq)).toEqual([0,1,2,3]);
    const confirmRef=makeFunctionReference<'mutation',{roomId:Id<'rooms'>;expectedConstraintsVersion:number;rows:{itemKey:string;kind:'item';title:string;priceCents:number;leadDays:number;taskTemplates:never[]}[]},unknown>('catalog:confirm');
    await expect(h.as('provider').mutation(confirmRef,{roomId:followUp.roomId,expectedConstraintsVersion:0,rows:[{itemKey:'scope_item',kind:'item',title:'Already delivered',priceCents:100,leadDays:1,taskTemplates:[]}]})).rejects.toThrow(/item.duplicate/);
    expect(await h.t.run(async ctx=>(await ctx.db.get(followUp.roomId))?.writeSeq)).toBe(0);
    // The baseline remains a finance confirmation, but its suggestion shares the stub room badge.
    expect(data.ledger).toEqual([]);
    const view = await h.as('finance').query(viewRef, { roomId: followUp.roomId });
    expect(view?.header.provenanceBadge).toBe('stub');
    expect(view?.budget).toMatchObject({ visibility: 'finance', baselineSuggestionCents: 480000, baselineRecorded: false });
    expect(await h.as('provider').mutation(followUpRef, { executionId: result.executionId! })).toEqual({ roomId: followUp.roomId, created: false });
  });
});
