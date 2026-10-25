import {builderOptionPrivacy} from '../convex-helpers/requestOptions.w2-14.fixture';
import {describe,it,expect} from 'vitest';
import {api} from '../../convex/_generated/api';
import type {Doc} from '../../convex/_generated/dataModel';
import {privacy} from '../../core/engine';
import {customRequest} from '../convex-helpers/request.fixture';

type Effect = Doc<'humanRequests'>['options'][number]['effect'];
const cases: {effect:Effect;role:'customer'|'finance'|'provider';details:object}[] = [
 {effect:{type:'disclose',field:'deadline',toRoles:['provider']},role:'customer',details:{disclose:{field:'deadline',toRoles:['provider']}}},
 {effect:{type:'pass_to_next',toRole:'finance'},role:'customer',details:{toRole:'finance'}},
 {effect:{type:'raise_cap',amountCents:280000},role:'finance',details:{effect:{amountCents:280000}}},
 {effect:{type:'drop_items',itemKeys:['sso_login']},role:'customer',details:{effect:{itemKeys:['sso_login']}}},
 {effect:{type:'extend_deadline',date:'2026-12-01'},role:'customer',details:{effect:{date:'2026-12-01'}}},
 ...(['choose_candidate','keep_as_is','end_run','blocked','retry_turn'] as const).map(type=>({effect:(type==='choose_candidate'?{type,candidateKey:'PRIVATE-CANDIDATE'}:{type}) as Effect,role:'customer' as const,details:{}})),
];
it('clarify-origin and infeasible fallback: zero-disclosure canary remains unchanged except own option metadata',builderOptionPrivacy);

describe('W2-14 D11/D15 DX-3 target-only stored option payloads',()=>{
 for(const c of cases) it(`${c.effect.type} × every viewer: shared room/permalink DTO and byte-identical non-target branches`,async()=>{
  const s=await customRequest(c.effect,c.role,c.effect.type==='disclose'?'clarify':'infeasible');
  const read=async(role:'customer'|'finance'|'provider')=>({get:await s.as(role).query(api.humanRequests.get,{requestId:s.requestId}),room:(await s.as(role).query(api.rooms.view,{roomId:s.roomId}))!.openRequest});
  const before=await Promise.all((['customer','finance','provider'] as const).map(read));
  const target=before[(['customer','finance','provider'] as const).indexOf(c.role)]!;
  expect(target.get).toMatchObject({mine:true,options:[{type:c.effect.type,...c.details}, {type:'end_run'}]});
  if(!target.get?.mine||!target.room?.mine)throw new Error('missing target request');
  expect(target.get.options).toEqual(target.room.options);
  const option=target.get.options[0]!;
  expect(option.shown).toEqual({});
  expect(option.effectView).toEqual({});
  expect(option.answerable).toBe(c.effect.type!=='blocked');
  expect(Object.keys(option).sort()).toEqual(['optionKey','text','type','shown','effectView','answerable',...Object.keys(c.details)].sort());
  // Changing the private payload leaves every non-target network branch byte-identical.
  await s.t.run(async ctx=>{await ctx.db.patch(s.requestId,{options:[{optionKey:'A',templateKey:'changed',effect:{type:'disclose',field:'requiredItemKeys',toRoles:['finance']}},{optionKey:'E',templateKey:'end_run',effect:{type:'end_run'}}]});});
  for(const [index,role] of (['customer','finance','provider'] as const).entries())if(role!==c.role){
   expect(JSON.stringify(await read(role))).toBe(JSON.stringify(before[index]));
   if(role==='provider')expect(before[index]).toEqual({get:{mine:false,kind:'run_waiting'},room:{mine:false,kind:'run_waiting'}});
  }
 });
 it('infeasible fallback disclose exposes only its own field and recipients; non-target core projection stays empty',async()=>{
  const s=await customRequest({type:'disclose',field:'requiredItemKeys',toRoles:['finance']},'customer','infeasible');
  const request=(await s.t.run(ctx=>ctx.db.get(s.requestId)))!;
  expect(privacy.projectStoredRequestOptions('provider','customer',request.options)).toEqual([]);
  expect(privacy.projectStoredRequestOptions('finance','customer',request.options)).toEqual([]);
  expect(await s.as('customer').query(api.humanRequests.get,{requestId:s.requestId})).toMatchObject({options:[{disclose:{field:'requiredItemKeys',toRoles:['finance']}},{type:'end_run'}]});
 });
});
