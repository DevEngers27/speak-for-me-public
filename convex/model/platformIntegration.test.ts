import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api} from '../_generated/api';
import {seedRoom} from '../../tests/convex-helpers/seedRoom.fixture';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));vi.stubEnv('AGENT_MODE','stub');vi.stubEnv('DEPLOYMENT_TIER','dev');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
for(const writer of ['briefs.confirm','catalog.confirm','catalog.retire','invites.accept','ledger.recordBaseline','budget.setCap'] as const)it(`04-M2 ${writer} uses one real RoomTx through the opening fixpoint`,async()=>{
 const s=await seedRoom({until:'setup'});
 let inviteId:import('../_generated/dataModel').Id<'invites'>|undefined;
 await s.t.run(async ctx=>{
  if(writer==='briefs.confirm') {const b=await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',s.roomId).eq('role','customer')).first();await ctx.db.delete(b!._id);}
  if(writer==='ledger.recordBaseline'){const b=await ctx.db.query('ledgerEntries').first();await ctx.db.delete(b!._id);}
  if(writer==='catalog.confirm'){const c=await ctx.db.query('catalogItems').first();await ctx.db.delete(c!._id);}
  if(writer==='catalog.retire'){const c=(await ctx.db.query('catalogItems').first())!;const {_id,_creationTime,...row}=c;void _id;void _creationTime;await ctx.db.insert('catalogItems',{...row,itemKey:'optional_item'});}
  if(writer==='invites.accept'){const m=await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',s.roomId).eq('role','finance')).unique();await ctx.db.delete(m!._id);}
 });
 if(writer==='invites.accept')inviteId=(await s.as('customer').mutation(api.invites.create,{roomId:s.roomId,role:'finance',invitedEmail:'finance@example.com'})).inviteId;
 const before=(await s.t.run(ctx=>ctx.db.get(s.roomId)))!;
 const old=new Set((await s.t.run(ctx=>ctx.db.query('events').collect())).map(e=>e._id));
 if(writer==='briefs.confirm')expect(await s.as('customer').mutation(api.briefs.confirm,{roomId:s.roomId,expectedConstraintsVersion:0,hardFields:{schemaKey:'scope_change.customer.v1',requiredItemKeys:['sso_login'],deadline:'2026-11-24'},softFields:{schemaKey:'scope_change.customer.v1',preferredItemKeys:[],notes:''},disclosures:{}})).toMatchObject({constraintsVersion:1,bumped:true});
 if(writer==='catalog.confirm')await s.as('provider').mutation(api.catalog.confirm,{roomId:s.roomId,expectedConstraintsVersion:0,rows:[{itemKey:'sso_login',kind:'item',title:'SSO login',priceCents:80000,leadDays:3,taskTemplates:[]}]});
 if(writer==='catalog.retire')await s.as('provider').mutation(api.catalog.retire,{roomId:s.roomId,expectedConstraintsVersion:0,itemKey:'optional_item'});
 if(writer==='invites.accept')await s.as('finance').mutation(api.invites.accept,{invite:{by:'email',inviteId:inviteId!}});
 if(writer==='ledger.recordBaseline')await s.as('finance').mutation(api.ledger.recordBaseline,{roomId:s.roomId,amountCents:100000});
 if(writer==='budget.setCap')await s.as('finance').mutation(api.budget.setCap,{roomId:s.roomId,expectedConstraintsVersion:0,capCents:250000});
 const room=(await s.t.run(ctx=>ctx.db.get(s.roomId)))!;
 expect(room).toMatchObject({status:'open',constraintsVersion:1,nextRunNo:2,writeSeq:before.writeSeq+1});
 const events=(await s.t.run(ctx=>ctx.db.query('events').collect())).filter(e=>!old.has(e._id));
 expect(new Set(events.map(e=>e.commitTs)).size).toBe(1);
 expect(events.map(e=>e.seq)).toEqual(events.map((_,i)=>i));
 expect(events.map(e=>e.payload.type)).toEqual(expect.arrayContaining(['room_opened','constraints_changed','run_started','turn_scheduled']));
 const run=(await s.t.run(ctx=>ctx.db.query('runs').first()))!;
 expect(run).toMatchObject({runNo:1,constraintsVersionAtStart:1,status:'negotiating',activeTurnSeq:1});
 const turns=await s.t.run(ctx=>ctx.db.query('turns').collect());expect(turns).toHaveLength(1);
 const attempts=await s.t.run(ctx=>ctx.db.query('attempts').collect());expect(attempts).toHaveLength(1);
 const jobs=await s.t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
 expect(jobs.filter(j=>j.name==='agents:runAttempt')).toHaveLength(1);
 expect(jobs.filter(j=>j.name==='agents:watchdog')).toHaveLength(1);
 expect(jobs.find(j=>j.name==='agents:watchdog')!.scheduledTime).toBeGreaterThan(jobs.find(j=>j.name==='agents:runAttempt')!.scheduledTime);
 const revision=(await s.t.run(ctx=>ctx.db.query('constraintRevisions').first()))!;
 expect(revision.sourceRefs.filter(r=>r.kind==='brief')).toHaveLength(3);
 const catalogRefs=revision.sourceRefs.filter(r=>r.kind==='catalogItem');expect(catalogRefs).toHaveLength(writer==='catalog.retire'?2:1);
 if(writer==='catalog.retire')expect(catalogRefs).toEqual(expect.arrayContaining([expect.objectContaining({itemKey:'optional_item',revision:2})]));
 expect(catalogRefs).toEqual(expect.arrayContaining([expect.objectContaining({itemKey:'sso_login'})]));
});
