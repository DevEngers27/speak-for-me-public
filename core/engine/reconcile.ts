import { canonicalJson } from './canonicalJson';
import { cents, isCents } from './money';
import { isoDate } from './dates';
import { committedCents } from './ledger';
import type { ScenarioPlugin } from './plugin';
import { evaluateApprovalSet, type RequiredApproval, type Decision } from './rules/approvals';
import { checkProposal } from './rules/checkProposal';
import type { RuleInputBase, View, Terms, Line } from './rules/types';

export type ReconcileCode = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11';
export interface Finding { code: ReconcileCode; check: string; ref?: { table: string; id: string } }
type Identified = { _id: string };
export type SnapshotTerms = { itemKeys: string[]; modifiers: string[]; deliveryDate: string; amountCents: number };
export type SnapshotLine = { itemKey: string; revision: number; title: string; priceCents: number; leadDays: number; kind?: 'item' | 'modifier' };
export type SnapshotTask = { itemKey: string; templateIndex: number; title: string; assigneeRole: string; dueDate: string };
export interface RoomSnapshot {
  room: Identified & { status: string; constraintsVersion: number; nextProposalVersion: number; currentRunId?: string; localDate: string };
  runs: Array<Identified & { status: string; currentProposalId?: string }>;
  proposals: Array<Identified & { version: number; status: string; terms: SnapshotTerms; termsKey: string; lines: SnapshotLine[]; plannedTasks: SnapshotTask[]; requiredApprovals: RequiredApproval[] }>;
  approvals: Array<Identified & { proposalId: string; userId: string; role: string; kind: 'terms' | 'budget'; decision: Decision; seq: number; boundConstraintsVersion: number; boundTermsKey: string }>;
  members: Array<Identified & { userId: string; role: string }>;
  briefs: Array<Identified & { role: string; version: number; hardFields: { capCents?: number; requiredItemKeys?: string[]; deadline?: string; schemaKey?: string } }>;
  catalogItems: Array<Identified & SnapshotLine & { status: string; editNo?: number; provenance?: 'live' | 'seeded' | 'stub'; taskTemplates?: readonly { title: string; assigneeRole: string }[] }>;
  ledgerEntries: Array<Identified & { kind: 'baseline' | 'commit'; amountCents: number; executionId?: string }>;
  executions: Array<Identified & { runId?: string; proposalId: string; executionKey: string; constraintsVersion: number; termsKey: string; approvalIds: string[]; amountCents: number; committedBeforeCents: number; committedAfterCents: number; capCentsAtExecution: number }>;
  changeOrders: Array<Identified & { executionId: string; proposalId: string; terms: SnapshotTerms; lines: SnapshotLine[]; termsKey: string; baselineCents: number; priorApprovedDeltaCents: number; amountBeforeCents: number; deltaCents: number; amountAfterCents: number }>;
  tasks: Array<Identified & SnapshotTask & { executionId: string; taskKey: string }>;
  humanRequests: Array<Identified & { status: string }>;
}

function snapshotJson(value: Parameters<typeof canonicalJson>[0]): string | null {
  try { return canonicalJson(value); } catch { return null; }
}

/** Read-only, deterministic invariant audit. Findings never contain input values. */
export function reconcileRoom<RI extends RuleInputBase>(s: RoomSnapshot, opts: { scenario: ScenarioPlugin<RI>; ruleInput?: View<RI> }): Finding[] {
  const findings: Finding[] = [];
  const add = (code: ReconcileCode, check: string, table?: string, id?: string) => {
    const finding: Finding = { code, check: `${code}.${check}` };
    if (table !== undefined && id !== undefined) finding.ref = { table, id };
    if (!findings.some(f => f.code === finding.code && f.check === finding.check && f.ref?.id === finding.ref?.id)) findings.push(finding);
  };
  const groups = <T>(rows: readonly T[], key: (r: T) => string): T[][] => {
    const map = new Map<string, T[]>();
    for (const row of rows) { const k = key(row); const group = map.get(k) ?? []; group.push(row); map.set(k, group); }
    return [...map.values()];
  };
  const contiguous = (numbers: number[]) => [...numbers].sort((a,b) => a-b).every((n,i) => n === i+1);
  for (const rows of groups(s.approvals, r => `${r.proposalId}\u0000${r.userId}`)) {
    const sorted = [...rows].sort((a,b) => a.seq-b.seq);
    if (!contiguous(sorted.map(r => r.seq)) || sorted.some((r,i) => i > 0 && r.decision === sorted[i-1]!.decision && r.boundConstraintsVersion === sorted[i-1]!.boundConstraintsVersion)) add('R1', 'approval_sequence', 'approvals', sorted[0]!._id);
  }
  for (const rows of groups(s.briefs, r => r.role)) if (!contiguous(rows.map(r => r.version))) add('R1', 'brief_sequence', 'briefs', rows[0]!._id);
  if (!contiguous(s.proposals.map(r => r.version))) add('R1', 'proposal_sequence');
  if (s.room.nextProposalVersion !== Math.max(0, ...s.proposals.map(p => p.version)) + 1) add('R2', 'proposal_counter', 'rooms', s.room._id);

  const amounts = [...s.ledgerEntries.flatMap(r => [r.amountCents]), ...s.executions.flatMap(r => [r.amountCents,r.committedBeforeCents,r.committedAfterCents,r.capCentsAtExecution]), ...s.changeOrders.flatMap(r => [r.baselineCents,r.priorApprovedDeltaCents,r.amountBeforeCents,r.deltaCents,r.amountAfterCents]), ...s.proposals.flatMap(r => [r.terms.amountCents,...r.lines.map(l => l.priceCents)]), ...s.briefs.flatMap(r => r.role === 'finance' && r.hardFields.capCents !== undefined ? [r.hardFields.capCents] : [])];
  const validAmounts = amounts.every(n => isCents(n));
  if (!validAmounts) add('R3', 'amount_range');
  const finance = [...s.briefs].filter(r => r.role === 'finance').sort((a,b) => b.version-a.version)[0];
  const cap = finance?.hardFields.capCents;
  const total = committedCents(s.ledgerEntries);
  const baseline = s.ledgerEntries.filter(r => r.kind === 'baseline');
  const commits = s.ledgerEntries.filter(r => r.kind === 'commit');
  const orphanCommit = commits.some(c => c.executionId === undefined || !s.executions.some(x => x._id === c.executionId));
  if (validAmounts) {
    if (total !== null && cap !== undefined && total > cap) add('R4', 'ledger_over_cap');
    for (const e of s.executions) {
      const before = committedCents(s.ledgerEntries.filter(r => r.executionId !== e._id));
      if (!orphanCommit && (e.committedAfterCents !== total || e.committedBeforeCents !== before)) add('R2', 'commit_counter', 'executions', e._id);
      if (e.committedAfterCents > e.capCentsAtExecution || cap === undefined || e.capCentsAtExecution !== cap) add('R4', 'execution_cap', 'executions', e._id);
    }
  }
  for (const p of s.proposals) {
    if (validAmounts && (snapshotJson(p.terms) !== p.termsKey || committedCents(p.lines.map(l => ({ kind: 'commit', amountCents: l.priceCents }))) !== p.terms.amountCents)) add('R8', 'proposal_terms', 'proposals', p._id);
  }
  for (const row of s.ledgerEntries) {
    const e = s.executions.find(e => e._id === row.executionId);
    const co = e && s.changeOrders.find(c => c.executionId === e._id);
    if (row.kind === 'baseline' ? row.executionId !== undefined : !e || (validAmounts && (row.amountCents !== e.amountCents || (co && row.amountCents !== co.deltaCents)))) add('R5', 'orphan_commitment', 'ledgerEntries', row._id);
  }
  for (const co of s.changeOrders) if (!s.executions.some(e => e._id === co.executionId)) add('R6', 'orphan_change_order', 'changeOrders', co._id);
  for (const t of s.tasks) if (!s.executions.some(e => e._id === t.executionId)) add('R6', 'orphan_task', 'tasks', t._id);
  for (const e of s.executions) {
    const p = s.proposals.find(p => p._id === e.proposalId);
    const orders = s.changeOrders.filter(c => c.executionId === e._id);
    const ownCommits = commits.filter(c => c.executionId === e._id);
    if (orders.length !== 1 || orders.some(co => co.proposalId !== e.proposalId) || (!orphanCommit && ownCommits.length !== 1)) add('R6', 'record_count', 'executions', e._id);
    if (!p) { add('R11', 'execution_proposal_missing', 'executions', e._id); continue; }
    const tasks = s.tasks.filter(t => t.executionId === e._id);
    const keys = tasks.map(t => t.taskKey);
    if (tasks.length !== p.plannedTasks.length || new Set(keys).size !== keys.length || p.plannedTasks.some(t => tasks.filter(w => w.itemKey === t.itemKey && w.templateIndex === t.templateIndex && w.taskKey === `${e._id}:${t.itemKey}:${t.templateIndex}` && w.title === t.title && w.assigneeRole === t.assigneeRole && w.dueDate === t.dueDate).length !== 1)) add('R6', 'task_snapshot', 'executions', e._id);
    const signatures = e.approvalIds.map(id => s.approvals.find(a => a._id === id));
    if (!p.requiredApprovals.length || new Set(p.requiredApprovals.map(r => r.role)).size !== p.requiredApprovals.length || signatures.length !== p.requiredApprovals.length || new Set(signatures.map(a => a?.userId)).size !== signatures.length || signatures.some((a,i) => {
      const req = p.requiredApprovals[i];
      if (!a || !req) return true;
      const holders = s.members.filter(m => m.role === req.role);
      return a.proposalId !== p._id || a.decision !== 'approve' || a.role !== req.role || a.kind !== req.kind || a.boundConstraintsVersion !== e.constraintsVersion || a.boundTermsKey !== p.termsKey || s.approvals.some(other => other.proposalId === p._id && other.userId === a.userId && other.seq > a.seq) || holders.length !== 1 || holders[0]!.userId !== a.userId;
    })) add('R7', 'signature_set', 'executions', e._id);
    for (const co of orders) {
      if (validAmounts && (snapshotJson(p.terms) !== p.termsKey || p.termsKey !== e.termsKey || p.termsKey !== co.termsKey || snapshotJson(co.terms) !== snapshotJson(p.terms) || snapshotJson(co.lines) !== snapshotJson(p.lines) || committedCents(p.lines.map(l => ({kind:'commit',amountCents:l.priceCents}))) !== p.terms.amountCents)) add('R8', 'terms_snapshot', 'changeOrders', co._id);
      for (const line of co.lines) {
        const rows = s.catalogItems.filter(r => r.itemKey === line.itemKey);
        const latest = [...rows].sort((a,b) => b.revision-a.revision || (b.editNo ?? 0)-(a.editNo ?? 0))[0];
        if (!latest || latest.status !== 'confirmed' || latest.revision !== line.revision || latest.priceCents !== line.priceCents || latest.leadDays !== line.leadDays) add('R9', 'price_source', 'changeOrders', co._id);
      }
      if (validAmounts && !orphanCommit && baseline.length === 1) {
        const prior = committedCents(commits.filter(c => c.executionId !== e._id));
        if (co.baselineCents !== baseline[0]!.amountCents || co.priorApprovedDeltaCents !== prior || co.amountBeforeCents !== co.baselineCents + co.priorApprovedDeltaCents || co.amountAfterCents !== co.amountBeforeCents + co.deltaCents || e.committedBeforeCents !== co.amountBeforeCents || e.committedAfterCents !== co.amountAfterCents) add('R10', 'chain', 'changeOrders', co._id);
      }
    }
    if (e.executionKey !== `exec:${p._id}` || s.executions.filter(other => other.executionKey === e.executionKey).length !== 1) add('R11', 'execution_key', 'executions', e._id);
  }
  if ((s.room.constraintsVersion >= 1 ? baseline.length !== 1 : baseline.length > 1) || commits.length > 1) add('R10', 'baseline_count');
  for (const p of s.proposals) if ((p.status === 'executed') !== (s.executions.filter(e => e.proposalId === p._id).length === 1)) add('R11', 'proposal_status', 'proposals', p._id);
  if ((s.room.status === 'executed') !== (s.executions.length === 1) || s.executions.length > 1) add('R11', 'room_status', 'rooms', s.room._id);
  // A D06 kept proposal can remain referenced by superseded runs. Only the run
  // captured by the execution becomes executed; proposal.runId is provenance.
  for (const run of s.runs) {
    const executedHere = s.executions.some(e => e.proposalId === run.currentProposalId && (e.runId === run._id || (e.runId === undefined && run.status !== 'superseded')));
    if ((run.status === 'executed') !== executedHere) add('R11', 'run_status', 'runs', run._id);
  }
  if (s.room.status === 'executed' && s.humanRequests.some(r => r.status === 'open')) add('R11', 'open_request');
  const run = s.runs.find(r => r._id === s.room.currentRunId);
  const p = s.proposals.find(p => p._id === run?.currentProposalId);
  if (s.room.status === 'open' && run?.status === 'pending_approval' && p?.status === 'active' && validAmounts) {
    try {
      const set = evaluateApprovalSet({ required: p.requiredApprovals, members: s.members, rows: s.approvals.filter(a => a.proposalId === p._id).map(a => ({ ...a, id:a._id })), roomConstraintsVersion:s.room.constraintsVersion, termsKey:p.termsKey });
      if (set.complete) {
        const input = opts.ruleInput ?? opts.scenario.toRuleInput({ room:s.room, briefs:s.briefs, catalogItems:s.catalogItems, ledgerEntries:s.ledgerEntries, localDate:s.room.localDate });
        const todayInput = { ...input, localDate: isoDate(s.room.localDate) };
        const proposal = { terms: { ...p.terms, amountCents:cents(p.terms.amountCents), deliveryDate:isoDate(p.terms.deliveryDate) } as Terms, lines:p.lines.map(l => ({...l,priceCents:cents(l.priceCents)})) as Line[] };
        const evaluation = checkProposal(opts.scenario,todayInput,proposal);
        if (evaluation.passesChecks) add('R11', 'complete_but_not_executed', 'proposals', p._id);
      }
    } catch { add('R11', 'liveness_input_invalid', 'proposals', p._id); }
  }
  return findings;
}
