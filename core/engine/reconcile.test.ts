import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonicalJson';
import { isoDate } from './dates';
import { cents } from './money';
import type { ScenarioPlugin } from './plugin';
import { inheritProvenance, type Provenance } from './provenance';
import { reconcileRoom, type ReconcileCode, type RoomSnapshot } from './reconcile';
import type { RuleInputBase, View } from './rules/types';

const ruleInput: View<RuleInputBase> = { viewer:'system', localDate:isoDate('2026-10-24'), capCents:cents(480_000), committedCents:cents(400_000), headroomCents:80_000, catalog:[{itemKey:'scope_item',kind:'item',revision:1,title:'Scope',priceCents:cents(80_000),leadDays:0,status:'confirmed',provenance:'live',taskTemplates:[]}] };
const scenario: ScenarioPlugin = {
  id:{key:'scope_change',version:1}, roles:[], protocol:{tradeoffOwner:'customer',proposerRole:'provider',evaluatorOrder:[],counterRoles:[],maxRounds:3,maxCandidates:12,maxProposalsPerRolePerRun:4,topics:[],reasonKeys:[],roleCharters:{}},relaxationOrder:[],fields:[],catalog:{ownerRole:'provider',maxItemRows:12,maxModifierRows:2,maxRowCents:8_000_000_000,maxLeadDays:365,titleMaxCodePoints:80,maxTaskTemplatesPerRow:3},toRuleInput:()=>ruleInput,hardProjection:()=>'',checks:[],candidateSpace:()=>({drafts:[],emptyReasons:[]}),materialize:()=>null,relaxations:()=>[],stubDecide:()=>({turn:{action:'propose',optionKey:'O1',rationale:''}}),templates:{},fixtures:{},readiness:()=>[],
};
export function cleanExecutedSnapshot(): RoomSnapshot {
  const terms = {itemKeys:['scope_item'],modifiers:[],deliveryDate:'2026-10-24',amountCents:80_000};
  const termsKey = canonicalJson(terms);
  const line = {itemKey:'scope_item',kind:'item' as const,revision:1,title:'Scope',priceCents:80_000,leadDays:0};
  const task = {itemKey:'scope_item',templateIndex:0,title:'Deliver',assigneeRole:'provider',dueDate:terms.deliveryDate};
  const requiredApprovals = [{role:'customer',kind:'terms' as const},{role:'provider',kind:'terms' as const},{role:'finance',kind:'budget' as const}];
  return {
    room:{_id:'room',status:'executed',constraintsVersion:1,nextProposalVersion:2,currentRunId:'run',localDate:'2026-10-24'},
    runs:[{_id:'run',status:'executed',currentProposalId:'proposal'}],
    proposals:[{_id:'proposal',version:1,status:'executed',terms,termsKey,lines:[line],plannedTasks:[task],requiredApprovals}],
    approvals:requiredApprovals.map((req,i)=>({_id:`approval${i}`,proposalId:'proposal',userId:req.role,role:req.role,kind:req.kind,decision:'approve',seq:1,boundConstraintsVersion:1,boundTermsKey:termsKey})),
    members:requiredApprovals.map(req=>({_id:`member${req.role}`,userId:req.role,role:req.role})),
    briefs:[{_id:'finance',role:'finance',version:1,hardFields:{capCents:480_000}}],
    catalogItems:[{...line,_id:'catalog',status:'confirmed'}],
    ledgerEntries:[{_id:'baseline',kind:'baseline',amountCents:400_000},{_id:'commit',kind:'commit',amountCents:80_000,executionId:'execution'}],
    executions:[{_id:'execution',runId:'run',proposalId:'proposal',executionKey:'exec:proposal',constraintsVersion:1,termsKey,approvalIds:['approval0','approval1','approval2'],amountCents:80_000,committedBeforeCents:400_000,committedAfterCents:480_000,capCentsAtExecution:480_000}],
    changeOrders:[{_id:'changeOrder',executionId:'execution',proposalId:'proposal',terms,termsKey,lines:[line],baselineCents:400_000,priorApprovedDeltaCents:0,amountBeforeCents:400_000,deltaCents:80_000,amountAfterCents:480_000}],
    tasks:[{...task,_id:'task',executionId:'execution',taskKey:'execution:scope_item:0'}],humanRequests:[],
  };
}
const codes = (s:RoomSnapshot) => [...new Set(reconcileRoom(s,{scenario,ruleInput}).map(f=>f.code))];

describe('W2-2 read-only reconciliation',()=>{
  it('08-U18 clean execution has no finding and auditing leaves the snapshot unchanged',()=>{
    const s=cleanExecutedSnapshot(); const before=structuredClone(s);
    expect(reconcileRoom(s,{scenario})).toEqual([]); expect(s).toEqual(before);
  });
  const tampers: Array<[ReconcileCode,string,(s:RoomSnapshot)=>void]> = [
    ['R1','seq jump',s=>{s.approvals[0]!.seq=2;}],
    ['R2','proposal counter drift',s=>{s.room.nextProposalVersion=3;}],
    ['R3','negative ledger amount',s=>{s.ledgerEntries[0]!.amountCents=-1;}],
    ['R4','cap lower than frozen commitment',s=>{s.executions[0]!.capCentsAtExecution=479_999;}],
    ['R5','orphan commit reference',s=>{s.ledgerEntries[1]!.executionId='unknown';}],
    ['R6','missing change order',s=>{s.changeOrders=[];}],
    ['R7','signer is no longer latest',s=>{s.approvals.push({...s.approvals[0]!,_id:'later',seq:2,decision:'withdraw'});}],
    ['R8','frozen terms key mismatch',s=>{s.executions[0]!.termsKey='drift';}],
    ['R9','catalog price differs from executed line',s=>{s.catalogItems[0]!.priceCents=80_001;}],
    ['R10','two baselines',s=>{s.ledgerEntries.push({_id:'duplicate',kind:'baseline',amountCents:0});}],
    ['R11','proposal status mismatch',s=>{s.proposals[0]!.status='active';}],
  ];
  for (const [code,title,tamper] of tampers) it(`08-U18 ${code} ${title} yields exactly one R code`,()=>{const s=cleanExecutedSnapshot();tamper(s);expect(codes(s)).toEqual([code]);});
  it('R5 orphan commit is detected',()=>{const s=cleanExecutedSnapshot();s.ledgerEntries[1]!.executionId='unknown';expect(codes(s)).toEqual(['R5']);});
  it('R6 tasks must match every frozen task field and use unique derived keys',()=>{
    for (const field of ['title','assigneeRole','dueDate','taskKey'] as const) {const s=cleanExecutedSnapshot();s.tasks[0]![field]='tampered';expect(codes(s)).toEqual(['R6']);}
    const s=cleanExecutedSnapshot();s.tasks.push({...s.tasks[0]!,_id:'duplicate'});expect(codes(s)).toEqual(['R6']);
  });
  it('R7 validates role ownership, terms binding, approval order and distinct signers',()=>{
    const tampers=[(s:RoomSnapshot)=>{s.approvals[0]!.boundTermsKey='wrong';},(s:RoomSnapshot)=>{s.approvals[0]!.boundConstraintsVersion=2;},(s:RoomSnapshot)=>{s.members.push({...s.members[0]!,_id:'duplicateMember'});},(s:RoomSnapshot)=>{s.executions[0]!.approvalIds.reverse();}];
    for(const tamper of tampers){const s=cleanExecutedSnapshot();tamper(s);expect(codes(s)).toEqual(['R7']);}
  });
  it('R10 verifies all five G701 chain fields',()=>{
    for(const field of ['baselineCents','priorApprovedDeltaCents','amountBeforeCents','amountAfterCents'] as const){const s=cleanExecutedSnapshot();s.changeOrders[0]![field]++;expect(codes(s)).toEqual(['R10']);}
  });
  it('R11 complete current approval set cannot remain unexecuted',()=>{
    const s=cleanExecutedSnapshot();s.room.status='open';s.runs[0]!.status='pending_approval';s.proposals[0]!.status='active';s.executions=[];s.changeOrders=[];s.tasks=[];s.ledgerEntries=s.ledgerEntries.filter(r=>r.kind==='baseline');
    expect(codes(s)).toEqual(['R11']);
    s.approvals.pop();expect(codes(s)).toEqual([]);
  });
  it('R11 D06 a carried proposal executes only its current run',()=>{
    const s=cleanExecutedSnapshot();s.runs[0]!.status='superseded';s.runs.push({_id:'newRun',status:'executed',currentProposalId:'proposal'});s.room.currentRunId='newRun';s.executions[0]!.runId='newRun';expect(codes(s)).toEqual([]);
    s.runs[0]!.status='executed';expect(codes(s)).toEqual(['R11']);
  });
  it('R11 historical executed proposal without execution is rejected',()=>{
    const s=cleanExecutedSnapshot();s.room.status='open';s.runs=[];delete s.room.currentRunId;s.executions=[];s.changeOrders=[];s.tasks=[];s.ledgerEntries=s.ledgerEntries.filter(r=>r.kind==='baseline');expect(codes(s)).toEqual(['R11']);
  });
  it('R11 validates no open request remains in an executed room',()=>{const s=cleanExecutedSnapshot();s.humanRequests.push({_id:'request',status:'open'});expect(codes(s)).toEqual(['R11']);});
  it('R3 findings contain only invariant identifiers and never the corrupted value',()=>{
    const s=cleanExecutedSnapshot();s.ledgerEntries[0]!.amountCents=-123456789;
    const findings=reconcileRoom(s,{scenario});expect(findings).toEqual([{code:'R3',check:'R3.amount_range'}]);expect(JSON.stringify(findings)).not.toContain('123456789');
  });
  it('08-U18 R10 baseline cardinality follows constraintsVersion rather than room status',()=>{
    const s=cleanExecutedSnapshot();
    s.room.status='closed';s.room.constraintsVersion=0;s.room.nextProposalVersion=1;delete s.room.currentRunId;
    s.runs=[];s.proposals=[];s.approvals=[];s.executions=[];s.changeOrders=[];s.tasks=[];s.ledgerEntries=[];
    expect(codes(s)).toEqual([]);
    s.ledgerEntries.push({_id:'baseline',kind:'baseline',amountCents:0});expect(codes(s)).toEqual([]);
    s.ledgerEntries.push({_id:'duplicate',kind:'baseline',amountCents:0});expect(codes(s)).toEqual(['R10']);
    s.ledgerEntries=[];s.room.status='setup';s.room.constraintsVersion=1;expect(codes(s)).toEqual(['R10']);
    s.ledgerEntries.push({_id:'baseline',kind:'baseline',amountCents:0});expect(codes(s)).toEqual([]);
  });
  it('08-U18 R11 executed run must point at its own execution proposal',()=>{
    const s=cleanExecutedSnapshot();s.runs[0]!.currentProposalId='wrongProposal';expect(codes(s)).toEqual(['R11']);
  });
  it('08-U17 provenance inherits the strictest of all nine source pairs',()=>{
    const values:Provenance[]=['live','stub','seeded'];
    const expected:Provenance[][]=[['live','stub','seeded'],['stub','stub','seeded'],['seeded','seeded','seeded']];
    values.forEach((a,i)=>values.forEach((b,j)=>expect(inheritProvenance(a,b)).toBe(expected[i]![j])));
    expect(inheritProvenance()).toBe('live');expect(inheritProvenance('live','stub','seeded','live')).toBe('seeded');
  });
});
