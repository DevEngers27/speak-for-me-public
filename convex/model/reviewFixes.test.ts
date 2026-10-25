import * as lifecycle from './runs';
import {test,expect,vi} from 'vitest';
import * as constraints from './constraints';
import {api} from '../_generated/api';
import {setup,customerBrief,financeBrief} from '../../tests/convex-helpers/workflows.fixture';
import {TIMELINE_TEMPLATES,renderTimelineEvent,factDetail} from './views/timelineTemplates';
import {EVENT_FIELDS} from '../../core/engine';
async function disclosureCounts(s:Awaited<ReturnType<typeof setup>>){return await s.t.run(async ctx=>({facts:await ctx.db.query('sharedFacts').collect(),events:(await ctx.db.query('events').collect()).filter(e=>e.payload.type==='disclosure_changed')}));}
test('F2 notes-only reconfirm writes no shared rows or disclosure events',async()=>{
 const s=await setup('catalog');await customerBrief(s,{requiredItemKeys:['provider'],preferredItemKeys:['provider'],deadline:['provider']});const before=await disclosureCounts(s);expect(before.facts).toHaveLength(3);
 const brief=(await s.actors.customer.query(api.briefs.mine,{roomId:s.roomId}))!.latest!;
 const result=await s.actors.customer.mutation(api.briefs.confirm,{roomId:s.roomId,expectedConstraintsVersion:0,hardFields:brief.hardFields,softFields:{...brief.softFields,notes:'Only notes changed'},disclosures:brief.disclosures});expect(result.status).toBe('confirmed');expect(await disclosureCounts(s)).toEqual(before);
});
test('F2 first undisclosed brief and empty withdrawal write no shared rows or events',async()=>{
 const s=await setup('catalog');await financeBrief(s);expect(await disclosureCounts(s)).toEqual({facts:[],events:[]});expect(await s.actors.finance.mutation(api.sharedFacts.add,{roomId:s.roomId,field:'capCents',audience:[],confirmOwnDisclosure:false})).toEqual({status:'unchanged',sharedFactId:null});expect(await disclosureCounts(s)).toEqual({facts:[],events:[]});
});
test('F2 one audience change writes exactly one fact row and disclosure event',async()=>{
 const s=await setup('catalog');await customerBrief(s,{deadline:['provider']});const before=await disclosureCounts(s);await s.actors.customer.mutation(api.sharedFacts.add,{roomId:s.roomId,field:'deadline',audience:['provider','finance'],confirmOwnDisclosure:true});const after=await disclosureCounts(s);expect(after.facts).toHaveLength(before.facts.length+1);expect(after.events).toHaveLength(before.events.length+1);
});
test('F4 inbox paginates beyond fifty newest memberships without duplicates',async()=>{
 const s=await setup();await s.t.run(async ctx=>{for(let i=0;i<52;i++){const roomId=await ctx.db.insert('rooms',{scenarioKey:'scope_change',scenarioVersion:1,title:`Inbox ${i}`,timeZone:'UTC',localDate:s.localDate,status:'closed',constraintsVersion:0,nextProposalVersion:1,nextRunNo:1,writeSeq:0,createdBy:s.users.customer.userId,provenance:'live',createdAt:i});await ctx.db.insert('members',{roomId,userId:s.users.customer.userId,role:'customer',displayName:'Customer',joinedVia:'creator',joinedAt:i});}});
 let cursor:string|null=null;const cards:{roomId:string;title:string}[]=[];let done=false;
 while(!done){const result:{page:{roomId:string;title:string}[];isDone:boolean;continueCursor:string}=(await s.actors.customer.query(api.rooms.listMine,{paginationOpts:{numItems:13,cursor}}))!;cards.push(...result.page);cursor=result.continueCursor;done=result.isDone;}
 expect(cards).toHaveLength(53);expect(new Set(cards.map(c=>c.roomId)).size).toBe(53);expect(cards[0]!.title).toBe('Inbox 51');expect(cards[51]!.title).toBe('Inbox 0');
});
test('F5 catalog is static and complete; buyer brief metadata uses a typed version',()=>{
 expect(Object.keys(TIMELINE_TEMPLATES).sort()).toEqual(Object.keys(EVENT_FIELDS).sort());const payload={type:'brief_confirmed' as const,role:'customer' as const,version:4,hardChanged:false};const details={owner:false,fact:null,amount:null,cause:null,requestKind:null};expect(renderTimelineEvent(payload,'finance',details)).toBe('customer confirmed brief v4');expect(renderTimelineEvent(payload,'provider',details)).toBe('customer confirmed a brief');
 expect(()=>factDetail('deadline', {kind:'date',date:'not a date'},false)).toThrow();expect(()=>factDetail('UNKNOWN_FIELD',{kind:'cents',cents:10},false)).toThrow();
});
test('F5 removed audience gets no-longer-shared text without the replacement value',async()=>{
 const s=await setup('catalog');await financeBrief(s,{capCents:['customer']});await s.actors.finance.mutation(api.sharedFacts.add,{roomId:s.roomId,field:'capCents',audience:[],confirmOwnDisclosure:false});const page=(await s.actors.customer.query(api.timeline.page,{roomId:s.roomId,paginationOpts:{numItems:100,cursor:null}}))!;expect(page.page[0]!.text).toBe('capCents is no longer shared with you');expect(page.page[0]!.text).not.toMatch(/500000|5,000/);
});

test('F6 source changes carry the actual actor and appended source references',async()=>{
 const s=await setup('catalog');const spy=vi.spyOn(constraints,'withConstraintChange');
 try {
  await financeBrief(s);
  await s.actors.provider.mutation(api.catalog.confirm,{roomId:s.roomId,expectedConstraintsVersion:0,rows:[{itemKey:'review_item',kind:'item',title:'Review item',priceCents:1,leadDays:1,taskTemplates:[]}]});
  await s.actors.provider.mutation(api.catalog.retire,{roomId:s.roomId,expectedConstraintsVersion:0,itemKey:'review_item'});
  expect(spy.mock.calls).toHaveLength(3);
  for(const [index,call] of spy.mock.calls.entries()){
   expect(call[1]).toBe(s.roomId);const change=call[2];expect(change.cause).toBe(index===0?'brief_confirmed':'catalog_changed');expect(change.actorUserId).toBe(index===0?s.users.finance.userId:s.users.provider.userId);expect(change.sourceRefs).toHaveLength(1);
   const ref=change.sourceRefs[0]!;if(ref.kind==='brief'){expect(await s.t.run(async ctx=>await ctx.db.get(ref.briefId))).toMatchObject({roomId:s.roomId,role:ref.role,version:ref.version});}else if(ref.kind==='catalogItem'){expect(await s.t.run(async ctx=>await ctx.db.get(ref.catalogItemId))).toMatchObject({roomId:s.roomId,itemKey:ref.itemKey,revision:ref.revision});}else throw new Error('Unexpected source ref');
  }
 }finally{spy.mockRestore();}
});
test('F6 ready-room integration retains roomId and actor who supplied the last source',async()=>{
 const s=await setup('two_briefs');await financeBrief(s);
 await s.actors.finance.mutation(api.ledger.recordBaseline,{roomId:s.roomId,amountCents:400000});
 const room=await s.t.run(ctx=>ctx.db.get(s.roomId));expect(room).toMatchObject({status:'open',constraintsVersion:1});
 const revisions=await s.t.run(ctx=>ctx.db.query('constraintRevisions').withIndex('by_room_version',q=>q.eq('roomId',s.roomId)).collect());
 expect(revisions).toHaveLength(1);expect(revisions[0]).toMatchObject({roomId:s.roomId,actorUserId:s.users.finance.userId,cause:'room_opened'});
});

test('W2-1-r01 provider audience receives typed deadline and withdrawal; outsiders receive room text',async()=>{
 const s=await setup('catalog');await customerBrief(s,{deadline:['provider']});
 const timeline=async()=> (await s.actors.provider.query(api.timeline.page,{roomId:s.roomId,paginationOpts:{numItems:100,cursor:null}}))!.page;
 const brief=(await s.actors.customer.query(api.briefs.mine,{roomId:s.roomId}))!.latest!;
 if(brief.hardFields.schemaKey!=='scope_change.customer.v1')throw new Error('Expected customer brief');
 expect((await timeline()).find(e=>e.type==='disclosure_changed')!.text).toBe(`deadline: ${brief.hardFields.deadline}`);
 await s.actors.customer.mutation(api.sharedFacts.add,{roomId:s.roomId,field:'deadline',audience:['finance'],confirmOwnDisclosure:true});
 expect((await timeline())[0]!.text).toBe('deadline is no longer shared with you');
 await s.actors.customer.mutation(api.sharedFacts.add,{roomId:s.roomId,field:'deadline',audience:[],confirmOwnDisclosure:false});
 expect((await timeline())[0]!.text).toBe('customer updated what they share');
 await financeBrief(s,{capCents:['customer']});
 expect((await timeline()).filter(e=>e.type==='disclosure_changed')[0]!.text).toBe('finance updated what they share');
});

test('F6 ready-room lifecycle reuses the final setup writer transaction',async()=>{
 const s=await setup('two_briefs');await financeBrief(s);
 const before=await s.t.run(async ctx=>(await ctx.db.get(s.roomId))!);
 const eventsBefore=await s.t.run(ctx=>ctx.db.query('events').collect());
 const spy=vi.spyOn(lifecycle,'openIfReady');
 try {
  await s.actors.finance.mutation(api.ledger.recordBaseline,{roomId:s.roomId,amountCents:400000});
  expect(spy).toHaveBeenCalledOnce();
  expect(spy.mock.calls[0]![0].room._id).toBe(s.roomId);
  expect(spy.mock.calls[0]![0].actorUserId).toBe(s.users.finance.userId);
  const room=(await s.t.run(ctx=>ctx.db.get(s.roomId)))!;
  expect(room).toMatchObject({status:'open',constraintsVersion:1,writeSeq:before.writeSeq+1});
  const added=(await s.t.run(ctx=>ctx.db.query('events').collect())).filter(e=>!eventsBefore.some(old=>old._id===e._id));
  expect(new Set(added.map(e=>e.commitTs)).size).toBe(1);
  expect(added.map(e=>e.seq)).toEqual(added.map((_,i)=>i));
  expect(added.map(e=>e.payload.type)).toEqual(expect.arrayContaining(['baseline_recorded','room_opened','constraints_changed','run_started','turn_scheduled']));
 }finally{spy.mockRestore();}
});
