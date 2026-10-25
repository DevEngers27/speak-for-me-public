import {convexTest} from 'convex-test';
import {expect,test,vi} from 'vitest';
import {api} from '../_generated/api';
import schema from '../schema';
import {modules} from '../../tests/convex-helpers/setup';
import {seedRoom} from '../../tests/convex-helpers/seed';
import {asRole} from '../../tests/convex-helpers/roles';
import {main} from '../../core/scenarios/scope-change/fixtures/main';
async function setup(until:'members'|'run_started'='run_started') {const t=convexTest(schema,modules);return {t,...await seedRoom(t,main,{until})};}
const state=async(s:Awaited<ReturnType<typeof setup>>)=>s.t.run(async ctx=>({room:await ctx.db.get(s.roomId),briefs:await ctx.db.query('briefs').collect(),events:await ctx.db.query('events').collect(),facts:await ctx.db.query('sharedFacts').collect(),revisions:await ctx.db.query('constraintRevisions').collect(),runs:await ctx.db.query('runs').collect(),proposals:await ctx.db.query('proposals').collect(),approvals:await ctx.db.query('approvals').collect(),requests:await ctx.db.query('humanRequests').collect()}));
test('TC-AUTH-16 missing confirmed brief and membership fail without writes',async()=>{const s=await setup('members');const before=await state(s);await expect(s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'new'})).rejects.toThrow('brief_missing');await expect(asRole(s.t,'outsider').mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'new'})).rejects.toThrow('auth.not_member');expect(await state(s)).toEqual(before);});
test('TC-VER-16 guidance appends one private event without changing constraints or lifecycle',async()=>{const s=await setup();const before=await state(s);const old=before.briefs.filter(b=>b.role==='customer').at(-1)!;const result=await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'new guidance'});const after=await state(s);expect(result).toEqual({briefVersion:old.version+1});expect(after.room).toEqual({...before.room,writeSeq:before.room!.writeSeq+1});for(const key of ['facts','revisions','runs','proposals','approvals','requests'] as const)expect(after[key]).toEqual(before[key]);const brief=after.briefs.at(-1)!;expect(brief).toMatchObject({source:'soft_update',hardFields:old.hardFields,disclosures:old.disclosures,softFields:{...old.softFields,notes:'new guidance'}});expect(after.events.slice(before.events.length)).toMatchObject([{payload:{type:'brief_soft_updated',briefVersion:result.briefVersion},rateUser:'soft_writes',restrictedRef:{table:'briefs',id:brief._id}}]);expect(after.events.length).toBe(before.events.length+1);const mine=await s.actors.customer.query(api.briefs.mine,{roomId:s.roomId});expect(mine!.versions.at(-1)!.notes).toBe('new guidance');for(const role of ['customer','finance','provider'] as const){const page=await s.actors[role].query(api.timeline.page,{roomId:s.roomId,paginationOpts:{numItems:100,cursor:null}});expect(page!.page.some(e=>e.type==='brief_soft_updated')).toBe(role==='customer');}});
test('TC-AUTH-17 NFC code point length, supplementary characters, markup, clearing and idempotence',async()=>{const s=await setup();const update=(notes:string)=>s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes});const before=await state(s);await expect(update('😀'.repeat(2001))).rejects.toThrow('input.invalid');expect(await state(s)).toEqual(before);await update('e\u0301'.repeat(2)+'a'.repeat(1998));expect((await s.actors.customer.query(api.briefs.mine,{roomId:s.roomId}))!.latest!.softFields.notes).toBe('éé'+'a'.repeat(1998));await update('😀'.repeat(2000));await update('<guide>');await update('');const cleared=await state(s);await update('');expect(await state(s)).toEqual(cleared);});
test('TC-AUTH-18 terminal room guard precedes input validation',async()=>{for(const status of ['executed','closed'] as const){const s=await setup();await s.t.run(ctx=>ctx.db.patch(s.roomId,{status}));const before=await state(s);await expect(s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'x'.repeat(2001)})).rejects.toThrow('room_status');expect(await state(s)).toEqual(before);}});
test('TC-AUTH-19 thirty soft writes allow no-op but reject thirty-first; other users independent',async()=>{const s=await setup();for(let i=0;i<30;i++)await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:String(i)});const before=await state(s);await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'29'});await expect(s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'31'})).rejects.toThrow('run.rate_limited');expect(await state(s)).toEqual(before);await s.actors.finance.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'independent'});const b=(await s.actors.customer.query(api.briefs.mine,{roomId:s.roomId}))!.latest!;await expect(s.actors.customer.mutation(api.briefs.confirm,{roomId:s.roomId,expectedConstraintsVersion:before.room!.constraintsVersion,hardFields:b.hardFields,softFields:{...b.softFields,notes:'confirm'},disclosures:b.disclosures})).resolves.toMatchObject({status:'confirmed'});});

test('TC-AUTH-19 soft write bucket recovers after one hour',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
 try{const s=await setup();for(let i=0;i<30;i++)await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:String(i)});
 vi.setSystemTime(new Date('2026-10-24T13:00:01Z'));
 await expect(s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'recovered'})).resolves.toHaveProperty('briefVersion');
 }finally{vi.useRealTimers();}
});

test('TC-PRIV-26 i01 hidden guidance does not consume other viewers timeline pages',async()=>{
 const s=await setup();
 const read=async(role:'provider'|'finance')=>(await s.actors[role].query(api.timeline.page,{roomId:s.roomId,paginationOpts:{numItems:5,cursor:null}}))!;
 const before={provider:await read('provider'),finance:await read('finance')};
 for(let i=0;i<5;i++)await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:`private-${i}`});
 for(const role of ['provider','finance'] as const){const after=await read(role);expect(after.page).toEqual(before[role].page);expect(after.isDone).toBe(before[role].isDone);}
 const own=(await s.actors.customer.query(api.timeline.page,{roomId:s.roomId,paginationOpts:{numItems:5,cursor:null}}))!;
 expect(own.page).toHaveLength(5);expect(own.page.every(e=>e.type==='brief_soft_updated')).toBe(true);
});

test('TC-PRIV-26 i02 hidden guidance does not advance other viewers inbox activity',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
 try{
  const s=await setup();
  const read=async(role:'customer'|'provider'|'finance')=>(await s.actors[role].query(api.rooms.listMine,{paginationOpts:{numItems:10,cursor:null}}))!.page.find(r=>r.roomId===s.roomId)!;
  const before={customer:await read('customer'),provider:await read('provider'),finance:await read('finance')};
  vi.setSystemTime(new Date('2026-10-24T12:01:00Z'));
  await s.actors.customer.mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'hidden activity'});
  for(const role of ['provider','finance'] as const)expect((await read(role)).updatedAt).toBe(before[role].updatedAt);
  expect((await read('customer')).updatedAt).toBeGreaterThan(before.customer.updatedAt);
 }finally{vi.useRealTimers();}
});
