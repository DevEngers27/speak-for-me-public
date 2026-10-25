import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {api} from '../_generated/api';
import {openRoomTx} from '../lib/db';
import {appendEvents} from './events';
import {customRequest} from '../../tests/convex-helpers/request.fixture';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));vi.stubEnv('AGENT_MODE','stub');vi.stubEnv('DEPLOYMENT_TIER','dev');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
test('TC-PRIV-04 request owner receives immutable shown options and closing version',async()=>{
 const s=await customRequest({type:'raise_cap',amountCents:999999},'finance','infeasible');
 await s.t.run(async ctx=>{const r=(await ctx.db.get(s.requestId))!;await ctx.db.patch(s.requestId,{options:r.options.map(o=>({...o,shown:{deltaCents:12345}}))});});
 const value=await s.as('finance').query(api.humanRequests.get,{requestId:s.requestId});
 expect(value).toMatchObject({mine:true,status:'open',options:[{optionKey:'A',effectView:{deltaCents:12345},answerable:true},{optionKey:'E',effectView:{deltaCents:12345},answerable:true}]});
 expect(value).toMatchObject({options:[{type:'raise_cap',effect:{amountCents:999999}},{type:'end_run'}]});
 const r=(await s.t.run(ctx=>ctx.db.get(s.requestId)))!;
 await s.t.run(ctx=>ctx.db.patch(s.requestId,{status:'superseded',closedReason:'constraints_changed'}));
 expect(await s.as('finance').query(api.humanRequests.get,{requestId:s.requestId})).toMatchObject({mine:true,status:'superseded',closedReason:'constraints_changed',closedAtConstraintsVersion:r.constraintsVersion+1,options:[{answerable:false},{answerable:false}]});
 await s.t.run(ctx=>ctx.db.patch(s.requestId,{status:'open',closedReason:undefined}));
});
test('TC-PRIV-04 other buyer receives request metadata only',async()=>{const s=await customRequest({type:'raise_cap',amountCents:999999},'finance','infeasible');expect(await s.as('customer').query(api.humanRequests.get,{requestId:s.requestId})).toEqual({mine:false,requestId:s.requestId,waitingOnRole:'finance',kind:'infeasible',status:'open'});});
test('TC-PRIV-04 provider request DTO contains no role, request kind, status or private numbers',async()=>{const s=await customRequest({type:'raise_cap',amountCents:999999},'finance','infeasible');expect(await s.as('provider').query(api.humanRequests.get,{requestId:s.requestId})).toEqual({mine:false,kind:'run_waiting'});const other=await s.as('customer').mutation(api.rooms.create,{title:'Other',scenarioKey:'scope_change',timeZone:'UTC',myRole:'customer'});expect(await s.as('customer').query(api.humanRequests.get,{requestId:s.requestId,roomId:other.roomId})).toBeNull();});

test('TC-VER-16 guidance preserves a pending proposal with two approvals',async()=>{
 const {seedRoom}=await import('../../tests/convex-helpers/seedRoom.fixture');
 const {drainDue}=await import('../../tests/convex-helpers/scheduler');
 const s=await seedRoom();await drainDue(s.t);
 const proposal=(await s.t.run(ctx=>ctx.db.query('proposals').first()))!;
 const room=(await s.t.run(ctx=>ctx.db.get(s.roomId)))!;
 await s.t.run(async ctx=>{const tx=await openRoomTx(ctx,s.roomId,{allow:['open']});for(const role of ['customer','provider'] as const){const member=(await ctx.db.query('members').withIndex('by_room_role',q=>q.eq('roomId',s.roomId).eq('role',role)).unique())!;await ctx.db.insert('approvals',{roomId:s.roomId,proposalId:proposal._id,runId:proposal.runId,userId:member.userId,role,kind:'terms',decision:'approve',seq:1,boundConstraintsVersion:room.constraintsVersion,boundTermsKey:proposal.termsKey,decidedAt:room.createdAt});await appendEvents(tx,[{payload:{type:'approval_recorded',proposalVersion:proposal.version,role,decision:'approve',boundConstraintsVersion:room.constraintsVersion},actor:{kind:'user',role},actorUserId:member.userId}]);}});
 const snapshot=()=>s.t.run(async ctx=>({runs:await ctx.db.query('runs').collect(),proposals:await ctx.db.query('proposals').collect(),approvals:await ctx.db.query('approvals').collect(),requests:await ctx.db.query('humanRequests').collect()}));
 const before=await snapshot();expect(before.approvals).toHaveLength(2);expect(before.runs[0]!.status).toBe('pending_approval');
 await s.as('customer').mutation(api.briefs.updateSoft,{roomId:s.roomId,notes:'Updated while awaiting final approval'});
 expect(await snapshot()).toEqual(before);
});
