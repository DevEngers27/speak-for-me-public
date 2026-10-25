/** W2-1: pure phase/todo/inbox derivation from already projected inputs (04 §4.10). */
export type PhaseRole='customer'|'provider'|'finance';
export type PhaseInput={room:{status:'setup'|'open'|'executed'|'closed'};viewerRole:PhaseRole;isCreator?:boolean;gaps?:readonly {gap:string;ownerRole:PhaseRole}[];run?:{status:string;roundNo:number}|null;activeRole?:PhaseRole;request?:{mine:boolean;waitingOnRole?:PhaseRole}|null;proposalVersion?:number;pendingRoles?:PhaseRole[]};
export type PhaseView={phase:'setup'|'negotiating'|'needs_input'|'awaiting_approval'|'stopped'|'executed'|'closed';gaps?:{gap:string;ownerRole:PhaseRole}[];reason?:'ended_no_agreement'|'canceled';activeRole?:PhaseRole;roundNo?:number;you?:boolean;waitingOn?:PhaseRole;proposalVersion?:number;pendingRoles?:PhaseRole[];youPending?:boolean};
export function derivePhase(i:PhaseInput):PhaseView{
  if(i.room.status==='closed'||i.room.status==='executed')return {phase:i.room.status};
  if(i.room.status==='setup')return {phase:'setup',gaps:(i.gaps??[]).map(g=>({gap:g.gap,ownerRole:g.ownerRole}))};
  if(!i.run||i.run.status==='ended_no_agreement')return {phase:'stopped',reason:'ended_no_agreement'};
  if(i.run.status==='canceled')return {phase:'stopped',reason:'canceled'};
  if(i.run.status==='negotiating')return {phase:'negotiating',roundNo:i.run.roundNo,...(i.activeRole?{activeRole:i.activeRole}:{})};
  if(i.run.status==='needs_input')return {phase:'needs_input',you:i.request?.mine??false,...(!i.request?.mine&&i.viewerRole!=='provider'&&i.request?.waitingOnRole?{waitingOn:i.request.waitingOnRole}:{})};
  const pending=i.pendingRoles??[];return {phase:'awaiting_approval',proposalVersion:i.proposalVersion,pendingRoles:pending,youPending:pending.includes(i.viewerRole)};
}
export type Todo={kind:string;priority:number;refs:{proposalVersion?:number}};
export function deriveTodos(phase:PhaseView,viewer:PhaseRole,isCreator=false,approval?:{passesChecks:boolean;state?:string}):Todo[]{
  if(phase.phase==='setup')return [...new Map((phase.gaps??[]).filter(g=>g.gap==='seat_vacant'?isCreator:g.ownerRole===viewer).map((g,index)=>({kind:g.gap==='seat_vacant'?'invite_member':g.gap==='catalog_empty'?'confirm_catalog':g.gap==='baseline_missing'?'record_baseline':'confirm_brief',priority:index,refs:{}})).map(todo=>[todo.kind,todo])).values()].map((todo,priority)=>({...todo,priority}));
  if(phase.phase==='needs_input'&&phase.you)return [{kind:'answer_request',priority:0,refs:{}}];
  if(phase.phase==='awaiting_approval'&&approval?.passesChecks&&approval.state?.startsWith('stale_'))return [{kind:'redecide_proposal',priority:0,refs:{proposalVersion:phase.proposalVersion}}];
  if(phase.phase==='awaiting_approval'&&approval?.passesChecks&&(approval.state==='pending'||approval.state==='withdrawn'))return [{kind:'decide_proposal',priority:0,refs:{proposalVersion:phase.proposalVersion}}];
  return [];
}
export function deriveInboxSection(phase:PhaseView,todos:readonly Todo[]):'needs_you'|'agents_working'|'waiting'|'done'{
  if(todos.length)return 'needs_you';if(phase.phase==='negotiating')return 'agents_working';return ['stopped','executed','closed'].includes(phase.phase)?'done':'waiting';
}
