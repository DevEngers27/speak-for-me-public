import { afterEach,expect,it,vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import { fixture,LOGIN } from '../battery/w2-3.cases';
afterEach(()=>vi.useRealTimers());
it('CC-18 setup confirmations do not consume open-phase daily buckets',async()=>{
  const f=await fixture();vi.setSystemTime(Date.now()+2*3_600_000);
  for(let n=1;n<=6;n++)await f.setCap(500000+n);
  await expect(f.setCap(510000)).rejects.toThrow(/run.rate_limited/);
  expect(await f.cv()).toBe(7);
});
it('CC-19 setup catalog batches are excluded from the open price bucket',async()=>{
  const f=await fixture();vi.setSystemTime(Date.now()+2*3_600_000);
  for(let n=1;n<=3;n++)await f.provider.mutation(api.catalog.confirm,{roomId:f.roomId,expectedConstraintsVersion:await f.cv(),rows:[{...LOGIN,priceCents:50000+n}]});
  await expect(f.provider.mutation(api.catalog.confirm,{roomId:f.roomId,expectedConstraintsVersion:await f.cv(),rows:[{...LOGIN,priceCents:50004}]})).rejects.toThrow(/run.rate_limited/);
});
it('CC-04 title edit after run start does not consume first reprice',async()=>{
  const f=await fixture();vi.setSystemTime(Date.now()+2*3_600_000);
  await f.provider.mutation(api.catalog.confirm,{roomId:f.roomId,expectedConstraintsVersion:1,rows:[{...LOGIN,title:'Updated title'}]});
  await expect(f.provider.mutation(api.catalog.confirm,{roomId:f.roomId,expectedConstraintsVersion:1,rows:[{...LOGIN,title:'Updated title',priceCents:51000}]})).resolves.toMatchObject({bumped:true,constraintsVersion:2});
});
it('TC-PRIV-14 CC-21 shared budget history uses each source version audience',async()=>{
  const f=await fixture();
  const confirm=async(capCents:number,disclosures:Record<string,('customer')[]>)=>f.finance.mutation(api.briefs.confirm,{roomId:f.roomId,expectedConstraintsVersion:await f.cv(),hardFields:{schemaKey:'scope_change.finance.v1',capCents},softFields:{schemaKey:'scope_change.finance.v1',notes:''},disclosures});
  const timeline=()=>f.customer.query(api.timeline.page,{roomId:f.roomId,paginationOpts:{numItems:100,cursor:null}});
  await confirm(510000,{capCents:['customer']});
  const newlyShared=(await timeline())!.page.find(e=>e.type==='constraints_changed')!;
  expect(newlyShared.text).toContain('$5,100');expect(newlyShared.text).not.toContain('$5,000');
  expect((await f.customer.query(api.rooms.view,{roomId:f.roomId}))!.budget).toMatchObject({visibility:'customer',capCents:510000});
  await confirm(520000,{capCents:['customer']});
  const both=(await timeline())!.page.find(e=>e.type==='constraints_changed')!;expect(both.text).toContain('$5,100');expect(both.text).toContain('$5,200');
  await confirm(530000,{});
  const current=(await timeline())!.page.find(e=>e.type==='constraints_changed')!;expect(current.text).toContain('$5,200');expect(current.text).not.toContain('$5,300');
  expect((await timeline())!.page.find(e=>e.eventId===newlyShared.eventId)).toEqual(newlyShared);
  const provider=await f.provider.query(api.rooms.view,{roomId:f.roomId});expect(provider!.budget).toEqual({visibility:'none'});
});
it('CC-09 constraint answers drop items and extend deadline bump once with answered source',async()=>{
  const f=await fixture();await f.confirmCustomer('2026-11-20',['login','reports']);
  for(const effect of [{type:'drop_items' as const,itemKeys:['reports']},{type:'extend_deadline' as const,date:'2026-11-22'}]){
    const before=await f.cv();const requestId=await f.t.run(async ctx=>{
      const room=(await ctx.db.get(f.roomId))!;await ctx.db.patch(room.currentRunId!,{status:'needs_input',activeTurnSeq:null});
      return ctx.db.insert('humanRequests',{roomId:f.roomId,runId:room.currentRunId!,kind:'infeasible',toRole:'customer',questionKey:'relax',constraintsVersion:before,options:[{optionKey:'A',templateKey:'relax',effect}],status:'open',expiresAt:Date.now()+86400000,provenance:'stub',createdAt:Date.now()});
    });
    await expect(f.customer.mutation(api.humanRequests.answer,{requestId,optionKey:'A'})).resolves.toMatchObject({outcome:'applied',constraintsVersion:before+1});
    expect((await f.revisions()).at(-1)!.sourceRefs).toContainEqual({kind:'humanRequest',humanRequestId:requestId});
    expect(await f.t.run(ctx=>ctx.db.get(requestId))).toMatchObject({status:'answered'});
  }
});
it('TC-PRIV-14 CN-004-7 timeline uses manual version-bound facts, never brief disclosure flags or later sharing',async()=>{
 const f=await fixture();
 await f.finance.mutation(api.sharedFacts.add,{roomId:f.roomId,field:'capCents',audience:['customer'],confirmOwnDisclosure:true});
 expect((await f.finance.query(api.briefs.mine,{roomId:f.roomId}))!.latest!.disclosures).toEqual({});
 await f.setCap(510000);
 const timeline=()=>f.customer.query(api.timeline.page,{roomId:f.roomId,paginationOpts:{numItems:100,cursor:null}});
 const changed=(await timeline())!.page.find(e=>e.type==='constraints_changed')!;
 expect(changed.text).toContain('$5,000');expect(changed.text).not.toContain('$5,100');
 await f.finance.mutation(api.sharedFacts.add,{roomId:f.roomId,field:'capCents',audience:['customer'],confirmOwnDisclosure:true});
 expect((await f.customer.query(api.rooms.view,{roomId:f.roomId}))!.budget).toMatchObject({visibility:'customer',capCents:510000});
 expect((await timeline())!.page.find(e=>e.eventId===changed.eventId)).toEqual(changed);
 const provider=await f.provider.query(api.timeline.page,{roomId:f.roomId,paginationOpts:{numItems:100,cursor:null}});
 expect(JSON.stringify(provider!.page)).not.toMatch(/\$5,000|\$5,100|500000|510000/);
});
it('CC-17 real source writes share one RoomTx lock and contiguous event sequence with each bump',async()=>{
 const f=await fixture();
 const check=async(write:()=>Promise<unknown>)=>{
  const before=await f.room();const ids=new Set(await f.t.run(async ctx=>(await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',f.roomId)).collect()).map(e=>e._id)));
  await write();const after=await f.room();expect(after.writeSeq).toBe(before.writeSeq+1);expect(after.constraintsVersion).toBe(before.constraintsVersion+1);
  const events=await f.t.run(async ctx=>(await ctx.db.query('events').withIndex('by_room_order',q=>q.eq('roomId',f.roomId)).collect()).filter(e=>!ids.has(e._id)));
  expect(new Set(events.map(e=>e.commitTs)).size).toBe(1);expect(events.map(e=>e.seq)).toEqual(events.map((_,i)=>i));
  expect(events.filter(e=>e.payload.type==='constraints_changed')).toHaveLength(1);
 };
 await check(()=>f.setCap(510000));await check(()=>f.confirmCustomer('2026-11-21'));
 await check(async()=>f.provider.mutation(api.catalog.confirm,{roomId:f.roomId,expectedConstraintsVersion:await f.cv(),rows:[{...LOGIN,priceCents:55000}]}));
 await check(async()=>f.provider.mutation(api.catalog.retire,{roomId:f.roomId,expectedConstraintsVersion:await f.cv(),itemKey:'reports'}));
 const requestId=await f.t.run(async ctx=>{const room=(await ctx.db.get(f.roomId))!;await ctx.db.patch(room.currentRunId!,{status:'needs_input',activeTurnSeq:null});return ctx.db.insert('humanRequests',{roomId:f.roomId,runId:room.currentRunId!,kind:'infeasible',toRole:'finance',questionKey:'raise_cap',constraintsVersion:room.constraintsVersion,options:[{optionKey:'A',templateKey:'raise_cap',effect:{type:'raise_cap',amountCents:520000}}],status:'open',expiresAt:Date.now()+86400000,provenance:'stub',createdAt:Date.now()});});
 await check(()=>f.finance.mutation(api.humanRequests.answer,{requestId,optionKey:'A'}));
});
