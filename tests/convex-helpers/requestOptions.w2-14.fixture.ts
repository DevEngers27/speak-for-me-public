import {expect} from 'vitest';
import {api} from '../../convex/_generated/api';
import type {Doc} from '../../convex/_generated/dataModel';
import {buildHumanRequests} from '../../core/engine/protocol/humanRequests';
import {viewFor} from '../../core/engine/rules/view';
import {input,plugin} from '../engine/rules/fixture';
import {customRequest} from './request.fixture';

export async function builderOptionPrivacy() {
 for(const kind of ['clarify','infeasible'] as const){
  // An empty candidate space means no budget relaxation can work:
  // the builder must fall back to disclosure of the recipient's own hard fields.
  const p=kind==='infeasible'?{...plugin,candidateSpace:()=>({drafts:[],emptyReasons:[]})}:plugin;
  const draft=buildHumanRequests(kind,'customer',role=>viewFor(p,input,{},role),{
   plugin:p,excludedCandidateKeys:[],providerExcludedCandidateKeys:[],openRequestCount:0,keepAsIsUsed:false,canContinue:true,
   clarify:{field:'deadline',askerRole:'provider'},
  });
  const options:Doc<'humanRequests'>['options']=draft.options.map(o=>{
   const {kind,...payload}=o.effect;
   return {optionKey:o.optionKey,templateKey:o.templateKey,shown:o.shown,effect:{type:kind,...payload} as Doc<'humanRequests'>['options'][number]['effect']};
  });
  expect(options[0]!.effect.type).toBe('disclose');
  if(kind==='clarify')expect(options[0]!.effect).toEqual({type:'disclose',field:'deadline',toRoles:['provider']});
  const s=await customRequest(options[0]!.effect,'customer',kind);
  await s.t.run(ctx=>ctx.db.patch(s.requestId,{options}));
  const stored=(await s.t.run(ctx=>ctx.db.get(s.requestId)))!;
  const facts=await s.t.run(ctx=>ctx.db.query('sharedFacts').collect());
  expect(facts.every(f=>f.value===null||f.audience.length===0)).toBe(true);
  const target=await s.as('customer').query(api.humanRequests.get,{requestId:s.requestId});
  if(!target?.mine)throw new Error('missing target');
  // Reproduce the pre-W2-14 projection byte for byte; the only additions are
  // the explicit metadata on this zero-disclosure canary's own options.
  const legacy=stored.options.map(o=>({optionKey:o.optionKey,text:target.options.find(v=>v.optionKey===o.optionKey)!.text,type:o.effect.type,shown:o.shown??{},effectView:o.shown??{},answerable:o.effect.type!=='blocked'}));
  const stripped=target.options.map(o=>({optionKey:o.optionKey,text:o.text,type:o.type,shown:o.shown,effectView:o.effectView,answerable:o.answerable}));
  expect(JSON.stringify(stripped)).toBe(JSON.stringify(legacy));
  for(const option of target.options)if(option.type==='disclose'){
   const declared=plugin.fields.find(f=>f.key===option.disclose.field)!;
   expect(declared.owner).toBe('customer');
   expect(option.disclose.toRoles.every(role=>declared.disclosableTo.includes(role))).toBe(true);
   expect(option).not.toHaveProperty('effect');
  }
  const room=await s.as('customer').query(api.rooms.view,{roomId:s.roomId});
  expect(room!.openRequest).toMatchObject({mine:true,options:target.options});
  expect(JSON.stringify(target)).not.toMatch(/PRIVATE-CUSTOMER|PRIVATE-FINANCE|PRIVATE-PROVIDER/);
  expect(await s.as('provider').query(api.humanRequests.get,{requestId:s.requestId})).toEqual({mine:false,kind:'run_waiting'});
  expect(await s.t.run(ctx=>ctx.db.query('sharedFacts').collect())).toEqual(facts);
 }
}
