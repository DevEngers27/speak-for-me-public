import {test,expect} from 'vitest';
import {derivePhase,deriveTodos,deriveInboxSection,type PhaseInput} from './phase';
for(const [name,input,phase]of [
 ['setup seat',{room:{status:'setup'},gaps:[{gap:'seat_vacant',ownerRole:'finance'}]},'setup'],['setup input',{room:{status:'setup'},gaps:[{gap:'baseline_missing',ownerRole:'finance'}]},'setup'],['closed',{room:{status:'closed'}},'closed'],['executed',{room:{status:'executed'}},'executed'],['negotiating',{room:{status:'open'},run:{status:'negotiating',roundNo:1},activeRole:'provider'},'negotiating'],['needs input',{room:{status:'open'},run:{status:'needs_input',roundNo:1},request:{mine:false,waitingOnRole:'finance'}},'needs_input'],['awaiting',{room:{status:'open'},run:{status:'pending_approval',roundNo:1},pendingRoles:['finance'],proposalVersion:2},'awaiting_approval'],['ended',{room:{status:'open'},run:{status:'ended_no_agreement',roundNo:1}},'stopped'],['canceled',{room:{status:'open'},run:{status:'canceled',roundNo:1}},'stopped'],
]as const)test(`SM-26 derivePhase ${name} and role-safe todo/inbox`,()=>{for(const viewerRole of ['customer','provider','finance']as const){const projected=derivePhase({...input,viewerRole}as PhaseInput);expect(projected.phase).toBe(phase);if(viewerRole==='provider'){expect(projected).not.toHaveProperty('toRole');expect(projected).not.toHaveProperty('waitingOn');}const todos=deriveTodos(projected,viewerRole,true);const section=deriveInboxSection(projected,todos);expect(['needs_you','agents_working','waiting','done']).toContain(section);}});
test('W2-11 i08 setup todos deduplicate by kind',()=>{
 expect(deriveTodos({phase:'setup',gaps:[{gap:'brief_missing',ownerRole:'customer'},{gap:'brief_unconfirmed',ownerRole:'customer'}]},'customer')).toEqual([{kind:'confirm_brief',priority:0,refs:{}}]);
});
test('W2-11 every required role gets fit-gated decide or redecide from its own slot',()=>{
 const phase={phase:'awaiting_approval' as const,youPending:true,proposalVersion:1};
 for(const role of ['customer','provider','finance'] as const){
  for(const state of ['pending','withdrawn','stale_approve','stale_reject','approved','rejected','vacant','self_conflict']){
   expect(deriveTodos(phase,role,false,{passesChecks:false,state})).toEqual([]);
   const kind=state.startsWith('stale_')?'redecide_proposal':['pending','withdrawn'].includes(state)?'decide_proposal':null;
   expect(deriveTodos(phase,role,false,{passesChecks:true,state}).map(todo=>todo.kind)).toEqual(kind?[kind]:[]);
  }
 }
});
test('DX-6 W2-11 pending roles are the approval set missingRoles in required order',async()=>{
 const {projectPendingApprovalRoles}=await import('./disclosure');
 const {evaluateApprovalSet}=await import('./rules/approvals');
 for(const state of ['pending','withdrawn','approved','rejected','stale_approve','stale_reject','vacant','self_conflict'] as const){
  const members=state==='vacant'?[]:[{role:'finance',userId:'f'},{role:'provider',userId:state==='self_conflict'?'f':'p'}];
  const rows=['pending','vacant','self_conflict'].includes(state)?[]:[{id:'a',userId:'f',role:'finance',kind:'budget' as const,seq:1,decision:state==='withdrawn'?'withdraw' as const:state.includes('reject')?'reject' as const:'approve' as const,boundConstraintsVersion:state.startsWith('stale_')?1:2,boundTermsKey:'terms'}];
  const set=evaluateApprovalSet({required:[{role:'finance',kind:'budget'},{role:'provider',kind:'terms'}],members,rows,roomConstraintsVersion:2,termsKey:'terms'});
  expect(projectPendingApprovalRoles(set)).toEqual(set.missingRoles);
  expect(projectPendingApprovalRoles(set)).toEqual(state==='approved'?['provider']:['finance','provider']);
 }
});
