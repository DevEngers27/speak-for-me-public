export type Decision = 'approve' | 'reject' | 'withdraw';
export type ApprovalKind = 'terms' | 'budget';
export interface RequiredApproval { role: string; kind: ApprovalKind }
export interface ApprovalRow {
  id: string; userId: string; role: string; kind: ApprovalKind; decision: Decision;
  seq: number; boundConstraintsVersion: number; boundTermsKey: string;
}
export interface MemberRow { userId: string; role: string }
export class ApprovalInvariantError extends Error {} // 调用方转为 internal + critical opsLog

/** 每个 userId 取 seq 最大的一行；seq 相等说明 E2 被破坏，大声失败而不是静默挑一行。 */
export function latestDecisionsByUser(rows: readonly ApprovalRow[]): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  const seen = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.seq) || r.seq < 1) throw new ApprovalInvariantError('approval.seq_invalid');
    const seqs = seen.get(r.userId) ?? new Set<number>();
    if (seqs.has(r.seq)) throw new ApprovalInvariantError('approval.seq_duplicate');
    seqs.add(r.seq);
    seen.set(r.userId, seqs);
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
  if (!input.required.length || new Set(input.required.map(r => r.role)).size !== input.required.length) throw new ApprovalInvariantError('approval.required_invalid');
  const latest = latestDecisionsByUser(input.rows);
  const used = new Set<string>();
  const out: ApprovalSetResult = { slots: [], complete: false, approvalIds: null,
    missingRoles: [], rejectedBy: [], reasons: [] };
  const ids: string[] = [];
  for (const req of input.required) {
    const holders = input.members.filter((m) => m.role === req.role);
    let slot: SlotState;
    if (holders.length !== 1) slot = { state: 'vacant' };
    else if (used.has(holders[0]!.userId)) slot = { state: 'self_conflict', userId: holders[0]!.userId };
    else {
      used.add(holders[0]!.userId);
      slot = classify(latest.get(holders[0]!.userId), req, holders[0]!.userId,
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
