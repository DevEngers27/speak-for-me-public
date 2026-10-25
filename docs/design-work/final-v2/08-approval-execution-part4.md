# 08 审批与执行（part4）：8.4 纯函数

> 全部位于 `core/engine/`（零依赖纯 TS，禁 `Date` / `Intl` / `Math.random` / `fetch` / `convex/*` / `zod`，D21）。同一份实现服务三处：`approvals.record` 与 `executeIfComplete`（写路径）、`rooms.view` 的审批面板与"将创建的记录"预览（读路径）、对账检查器 R1–R11（测试与运维）。rules-engine 的 `evaluateExecutionReadiness` 与前端审批槽位一律改为调用本节函数（review r04）。

## 8.4.1 当前决定与集合判定（`core/engine/approvals.ts`）

```ts
export type Decision = 'approve' | 'reject' | 'withdraw';
export type ApprovalKind = 'terms' | 'budget';
export interface RequiredApproval { role: string; kind: ApprovalKind }
export interface ApprovalRow {
  id: string; userId: string; role: string; kind: ApprovalKind; decision: Decision;
  seq: number; boundConstraintsVersion: number; boundTermsKey: string;
}
export interface MemberRow { userId: string; role: string }
export class ApprovalInvariantError extends Error {} // 调用方转为 internal + publicOpsLog('invariant.approval_seq_duplicate', { fn })（公开路径只用闭集 logger，15 §15.6.2）

/** 每个 userId 取 seq 最大的一行；seq 相等说明 E2 被破坏，大声失败而不是静默挑一行。 */
export function latestDecisionsByUser(rows: readonly ApprovalRow[]): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  for (const r of rows) {
    const cur = latest.get(r.userId);
    if (cur !== undefined && cur.seq === r.seq) throw new ApprovalInvariantError('approval.seq_duplicate');
    if (cur === undefined || r.seq > cur.seq) latest.set(r.userId, r);
  }
  return latest;
}

export type SlotState =
  | { state: 'vacant' }                                  // 当前 0 人或 >1 人持有该角色
  | { state: 'self_conflict'; userId: string }           // 同一 userId 已占用前一个必需槽
  | { state: 'pending'; userId: string }                 // 无决定；或最新行是旧 cv 上的 withdraw
  | { state: 'approved' | 'rejected' | 'withdrawn'; userId: string; approvalId: string }
  | { state: 'stale_approve' | 'stale_reject'; userId: string; approvalId: string;
      boundConstraintsVersion: number };

export interface ApprovalSetResult {
  slots: Array<{ role: string; kind: ApprovalKind; slot: SlotState }>; // 与 required 同序
  complete: boolean;                    // = allApproved（D19：与 passesChecks 分开命名）
  approvalIds: string[] | null;         // complete 时与 required 一一对应，写入 executions.approvalIds
  missingRoles: string[];               // 非 approved 的角色（"等谁"，07 显式解密）
  rejectedBy: string[];
  reasons: Array<{ code: 'approval.missing_role' | 'approval.self_conflict' | 'approval.stale'; role: string }>;
}

export function evaluateApprovalSet(input: {
  required: readonly RequiredApproval[];  // proposal.requiredApprovals 快照
  members: readonly MemberRow[];          // 当前成员（不是快照）
  rows: readonly ApprovalRow[];           // 本提案 by_proposal_user 全区间
  roomConstraintsVersion: number;
  termsKey: string;                       // proposal.termsKey
}): ApprovalSetResult {
  const latest = latestDecisionsByUser(input.rows);
  const used = new Set<string>();
  const out: ApprovalSetResult = { slots: [], complete: false, approvalIds: null,
    missingRoles: [], rejectedBy: [], reasons: [] };
  const ids: string[] = [];
  for (const req of input.required) {
    const holders = input.members.filter((m) => m.role === req.role);
    let slot: SlotState;
    if (holders.length !== 1) slot = { state: 'vacant' };
    else if (used.has(holders[0].userId)) slot = { state: 'self_conflict', userId: holders[0].userId };
    else {
      used.add(holders[0].userId);
      slot = classify(latest.get(holders[0].userId), req, holders[0].userId,
        input.roomConstraintsVersion, input.termsKey);
    }
    out.slots.push({ role: req.role, kind: req.kind, slot });
    if (slot.state === 'approved') { ids.push(slot.approvalId); continue; }
    out.missingRoles.push(req.role);
    if (slot.state === 'rejected') out.rejectedBy.push(req.role);
    out.reasons.push({ role: req.role, code:
      slot.state === 'self_conflict' ? 'approval.self_conflict'
      : slot.state === 'stale_approve' || slot.state === 'stale_reject' ? 'approval.stale'
      : 'approval.missing_role' });
  }
  out.complete = out.missingRoles.length === 0;
  out.approvalIds = out.complete ? ids : null;
  return out;
}

function classify(row: ApprovalRow | undefined, req: RequiredApproval, userId: string,
                  cv: number, termsKey: string): SlotState {
  if (row === undefined) return { state: 'pending', userId };
  if (row.role !== req.role || row.kind !== req.kind) return { state: 'pending', userId }; // 防御
  const current = row.boundConstraintsVersion === cv && row.boundTermsKey === termsKey;
  if (row.decision === 'withdraw')
    return current ? { state: 'withdrawn', userId, approvalId: row.id } : { state: 'pending', userId };
  if (current) return { state: row.decision === 'approve' ? 'approved' : 'rejected', userId, approvalId: row.id };
  return { state: row.decision === 'approve' ? 'stale_approve' : 'stale_reject', userId,
           approvalId: row.id, boundConstraintsVersion: row.boundConstraintsVersion };
}
```

要点：
- **判定的输入必须是本提案的整区间**，不得读任何冗余字段（如 `proposal.approvedRoles`）或客户端传来的"已批角色"——那会让并发的最后两票读写不相交的文档、互不冲突，都看到"差一票"而丢失执行（反例 K4，写偏斜）。
- canon §1.3 的四种派生有效性与槽位状态的映射：`approved` / `rejected` = `effective`；`stale_approve`；`stale_reject`；`withdrawn`。旧 cv 上的 withdraw 视为"没有决定"（versioned-approvals-review r13）。
- 旧 cv 上的 reject 显示为 `stale_reject`，不显示为 `pending`（RA-B30 回归）。由于 reject 是终局（A5），`stale_reject` 只会出现在历史提案上（被拒提案不会再成为当前提案）。
- 执行后不再调用本函数渲染已执行提案：面板读 `executions.approvalIds`（A9）。

## 8.4.2 规则部分与可执行性（`core/engine/executable.ts`）

```ts
export type RuleVerdict = Pick<Evaluation, 'checks' | 'blocking'>;   // 06 §7.1 的 Evaluation 原样传入：blocking 是 ReasonCode[]（按 CHECK_ORDER 去重）；需要 checkId / params 时读 checks
// RuleVerdict 由 06 的 checkProposal(ruleInput, proposal, today) 产生；ruleInput 由 loadRuleInput 在当前 cv 下装载；
// today 一律取 room.localDate（09 §9.6.7），query 与 mutation 结论一致

export const passesChecks = (v: RuleVerdict): boolean => v.blocking.length === 0;

export function isCurrentForApproval(i: {
  room: { status: string; currentRunId: string | null };
  run: { id: string; status: string; currentProposalId: string | null } | null;
  proposal: { id: string; status: string };
}): boolean {
  return i.room.status === 'open' && i.run !== null && i.run.id === i.room.currentRunId
    && i.run.status === 'pending_approval' && i.run.currentProposalId === i.proposal.id
    && i.proposal.status === 'active';
}

/** 全仓对 canon "isExecutable" 的唯一定义（06 §9.1 只引用）；= 当前性 ∧ 规则通过，**不含**审批集合；派生、永不入库（I10）。 */
export function isExecutable(i: Parameters<typeof isCurrentForApproval>[0] & { verdict: RuleVerdict })
  : { ok: true } | { ok: false; reasons: ReadonlyArray<{ code: string }> } {
  const reasons: Array<{ code: string }> = [];
  if (!isCurrentForApproval(i)) reasons.push({ code: i.proposal.status === 'stale' ? 'version.stale_constraints'
    : i.proposal.status === 'executed' ? 'approval.already_executed' : 'approval.not_current' });
  for (const code of i.verdict.blocking) reasons.push({ code });            // 一次说全
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** 审批集合另名；执行条件只在最后一张必需 approve 的事务里成立（D03）。 */
export const allApproved = (s: ApprovalSetResult): boolean => s.complete;
export function canExecuteNow(i: Parameters<typeof isExecutable>[0] & { approvalSet: ApprovalSetResult })
  : { ok: true } | { ok: false; reasons: ReadonlyArray<{ code: string; role?: string }> } {
  const e = isExecutable(i);
  const reasons: Array<{ code: string; role?: string }> = e.ok ? [] : [...e.reasons];
  for (const r of i.approvalSet.reasons) reasons.push(r);                    // approval.missing_role / self_conflict
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
```

`reasons` 在离开服务端前经 `projectForRole`（D11）：provider 只得 `fit: 'ok' | 'blocked'`；customer 看到自己拥有的检查码，他方私密检查一律掩码为 `private.constraint_unmet`（不带 checkId，通过的掩码检查省略）；finance 看到全部。

## 8.4.3 台账与 G701 金额链（`core/engine/ledger.ts`）

```ts
export interface LedgerEntryLite { kind: 'baseline' | 'commit'; amountCents: number }
export interface ChangeOrderChain {
  baselineCents: number; priorApprovedDeltaCents: number; amountBeforeCents: number;
  deltaCents: number; amountAfterCents: number; capCents: number; headroomAfterCents: number;
}
export type ChainResult =
  | { ok: true; chain: ChangeOrderChain }
  | { ok: false; code: 'budget.over' }                                    // 规则结论（调用方视上下文处理）
  | { ok: false; invariant: 'baseline_count' | 'cents_out_of_range' };    // 数据损坏 → internal

export function committedCents(entries: readonly LedgerEntryLite[]): number | null {
  return sumCents(entries.map((e) => e.amountCents));                       // 溢出 / 非法 → null
}

export function computeChangeOrderChain(i: {
  entries: readonly LedgerEntryLite[]; deltaCents: number; capCents: number;
}): ChainResult {
  const baselines = i.entries.filter((e) => e.kind === 'baseline');
  if (baselines.length !== 1) return { ok: false, invariant: 'baseline_count' };
  const prior = sumCents(i.entries.filter((e) => e.kind === 'commit').map((e) => e.amountCents));
  const before = prior === null ? null : addCents(baselines[0].amountCents, prior);
  const after = before === null ? null : addCents(before, i.deltaCents);
  if (prior === null || before === null || after === null || !isCents(i.deltaCents) || !isCents(i.capCents))
    return { ok: false, invariant: 'cents_out_of_range' };
  if (after > i.capCents) return { ok: false, code: 'budget.over' };       // 恰等于上限通过（K18）
  return { ok: true, chain: { baselineCents: baselines[0].amountCents, priorApprovedDeltaCents: prior,
    amountBeforeCents: before, deltaCents: i.deltaCents, amountAfterCents: after,
    capCents: i.capCents, headroomAfterCents: i.capCents - after } };
}
```

链连续性由构造保证并在 R4 / R10 复核：`amountBeforeCents === baselineCents + priorApprovedDeltaCents`、`amountAfterCents === amountBeforeCents + deltaCents`、`amountAfterCents <= capCents`。`sumCents` / `addCents` / `isCents` 取自 `core/engine/money.ts`（foundation money-dates）。

## 8.4.4 执行计划：预览与执行共用（`core/engine/executionPlan.ts`）

```ts
export interface ExecutionPlan {
  changeOrder: { terms: Terms; lines: Line[]; termsKey: string; chain: ChangeOrderChain };
  ledgerCommit: { amountCents: number };
  tasks: Array<PlannedTask & { taskKeySuffix: string }>;   // `${itemKey}:${templateIndex}`
}
export class ExecutionPlanError extends Error {}           // 调用方转 internal + publicOpsLog('invariant.execution_plan', { fn })（同上）

export function planExecutionRecords(
  p: { terms: Terms; termsKey: string; lines: readonly Line[]; plannedTasks: readonly PlannedTask[] },
  chain: ChangeOrderChain,
): ExecutionPlan {
  if (canonicalJson(p.terms) !== p.termsKey) throw new ExecutionPlanError('terms_drift');
  if (sumCents(p.lines.map((l) => l.priceCents)) !== p.terms.amountCents) throw new ExecutionPlanError('amount_claim');
  if (chain.deltaCents !== p.terms.amountCents) throw new ExecutionPlanError('delta_drift');
  if (p.plannedTasks.length > MAX_TASKS_PER_EXECUTION) throw new ExecutionPlanError('too_many_tasks');
  const keys = p.plannedTasks.map((t) => `${t.itemKey}:${t.templateIndex}`);
  if (new Set(keys).size !== keys.length) throw new ExecutionPlanError('task_key_duplicate');
  const scope = new Set([...p.terms.itemKeys, ...p.terms.modifiers]);
  if (p.plannedTasks.some((t) => !scope.has(t.itemKey))) throw new ExecutionPlanError('task_out_of_scope');
  return { changeOrder: { terms: p.terms, lines: [...p.lines], termsKey: p.termsKey, chain },
           ledgerCommit: { amountCents: p.terms.amountCents },
           tasks: p.plannedTasks.map((t, i) => ({ ...t, taskKeySuffix: keys[i] })) };
}

export const MAX_TASKS_PER_EXECUTION = 50;   // 与目录条目上限一致（14）

// provenance 继承使用 03 §3.3.3 的 inheritProvenance(...src)：seeded > stub > live；
// 执行产物 = inheritProvenance(room, proposal, ...lines 所引用目录行)（任一非 live 输入 → 产物非 live，核心 8）
```

"所见即所写"的落点：`rooms.view` 用**同一个** `planExecutionRecords(proposal, computeChangeOrderChain(...))` 生成 `recordsPreview`（再按角色投影，part6 §8.6.6）；执行时用同一快照、同一函数，唯一差别是执行时把 `taskKeySuffix` 前缀上 `executionId`。由于 `plannedTasks` / `lines` / `terms` 都是提案快照，且台账只能被本次执行改变，预览与写入逐字段相同（性质测试见 part8 U16）。
