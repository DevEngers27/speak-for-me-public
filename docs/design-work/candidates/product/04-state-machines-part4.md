# 04 状态机（part4）：房间派生阶段、人工请求、任务与台账条目

## 4.9 房间派生阶段 phase（不存储）

`engine/phase.ts#derivePhase` 是纯函数，`rooms.workspace` 与 `rooms.listMine` 都调用它：

```ts
export type Phase = "setup" | "negotiating" | "stalled" | "needs_input"
                  | "awaiting_approval" | "blocked" | "executed" | "closed";
export type BlockedReason = "proposal_blocked" | "requests_declined" | "agents_unavailable"
                          | "call_budget_exhausted" | "awaiting_trigger";

export function derivePhase(i: {
  room: RoomDoc; readiness: { ready: boolean };
  activeRun: RunDoc | null; openRequestCount: number;
  current: { executable: boolean } | null;
  agentsAvailable: boolean; callBudgetLeft: boolean; lastRequestsDeclined: boolean;
}): { phase: Phase; blockedReason?: BlockedReason } {
  if (i.room.status === "closed") return { phase: "closed" };
  if (!i.readiness.ready) return { phase: "setup" };
  if (i.activeRun?.status === "running") return { phase: "negotiating" };
  if (i.activeRun?.status === "stalled") return { phase: "stalled" };
  if (i.openRequestCount > 0) return { phase: "needs_input" };
  if (i.current) return i.current.executable
    ? { phase: "awaiting_approval" } : { phase: "blocked", blockedReason: "proposal_blocked" };
  if (i.room.lastExecutionId && !i.room.negotiationOpen) return { phase: "executed" };
  if (!i.agentsAvailable) return { phase: "blocked", blockedReason: "agents_unavailable" };
  if (!i.callBudgetLeft) return { phase: "blocked", blockedReason: "call_budget_exhausted" };
  if (i.lastRequestsDeclined) return { phase: "blocked", blockedReason: "requests_declined" };
  return { phase: "blocked", blockedReason: "awaiting_trigger" };
}
```

- `negotiating` 期间若当前提案可执行，签核照样可用（run 可能产出更好的方案，但人不必等）。
- `blocked/proposal_blocked` 通常是瞬态：约束变化后 `afterConstraintChange` 被调度、尚未执行的极短窗口；若持续存在（例如代理被关闭），原因会显示为后几种。
- 每个阶段都对应界面上的"下一步"与负责人（13）：

| 阶段 | 谁需要行动 | 界面主行动 |
| --- | --- | --- |
| setup | 未接受邀请的席位、未确认简报/清单的席位 | Accept invite / Confirm brief / Confirm quote |
| negotiating | 无（等待代理） | 回合进度；可选 "Choose an option myself" |
| stalled | 任一成员 | Retry / Stop / Choose an option myself |
| needs_input | 请求的目标席位 | 回答请求卡 |
| awaiting_approval | 状态为 pending / stale 的必需签核席位 | Accept terms / Approve budget commitment / Reject |
| blocked | 见 `blockedReason`：修改约束、手动选择、联系运维 | 对应说明 |
| executed | provider（任务） | 任务、"Start a follow-up change" |
| closed | 无 | 只读历史 |

## 4.10 人工请求 humanRequest

| 从 | 到 | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| — | `open`（tradeoff） | `openTradeoffRequests`（helper，`startRun` 预检无解、`afterRejection`、`negotiation.requestRun`） | 系统 | 本约束版本尚无同组 open 请求（幂等） | `groupKey = "tradeoff:cv{n}"`；每个有选项的目标席位一条；事件 `request_opened`（房间版只含目标角色与类型） |
| — | `open`（preference） | `runtime.completeTurn`（代理 `reject`、提出方 a2 全部被阻断）、`afterRejection`（第 4 次） | 系统 | 选项中的候选必须在目标席位作用域内且当前可执行 | 目标 = 代理所属席位本人 |
| — | `open`（disclosure） | `runtime.completeTurn`（代理 `clarify`） | 系统 | 话题 ∈ `turn.allowedTopicKeys`；同约束版本内同（发问角色, 话题）未被拒过 | 目标 = 话题声明的目标角色席位 |
| `open` | `answered` | `requests.answer` | 目标席位本人 | G-REQ；按意图再校验（补丁通过简报校验；候选通过 G-EVAL） | 按意图：`patch_brief` → 新简报版本（可能递增约束版本）；`choose_candidate` → 人提出的提案（可选同时 approve）；`share_fields` → 新简报版本（只改披露，不递增）→ `startRun(trigger:"request_answered")` |
| `open` | `answered` | `bumpConstraints` | 系统 | 约束变化由目标席位造成，且该请求含与该变化类型匹配的意图（`patch_brief` ↔ 简报确认，`edit_list` ↔ 同清单确认） | `result.constraintsVersion` |
| `open` | `declined` | `requests.answer`（`decline`）/ `requests.decline` | 目标席位本人 | G-REQ | 若同组全部关闭且无一 answered → `blockedReason: requests_declined`；disclosure 被拒 → 记入"同版本不再问" |
| `open` | `superseded` | `bumpConstraints`（其他原因）；人提出新提案（同组 preference） | 系统 | — | — |
| `open` | `cancelled` | `rooms.close`；`finishRun(cancelled)`（该 run 产生的请求） | 系统 | — | — |

除 open 外全部是终态。请求不会"重开"：需要时生成新请求。

**同时发给多人**（Q8 的决定）：一组取舍请求同时发给所有有可行动选项的席位；每个人只看到自己的选项和 "Also asked: <角色>"；任何一个人造成的约束变化都会关闭整组，然后重新预检。理由：顺序询问会让结果取决于固定顺序并拖长时间；并行时"先到先得"的副作用只是其他请求被 superseded，没有一致性风险。

## 4.11 任务与台账条目

**任务 task**：

| 从 | 到 | 触发函数 | 守卫 |
| --- | --- | --- | --- |
| — | `todo` | `executeIfComplete` | 只在执行事务内 |
| `todo` / `in_progress` / `done` | 另两者之一 | `records.updateTask` | G-AUTH（调用者席位 = `assigneeSeatId`）；G-OPEN |

**台账条目 commitment**：

| 从 | 到 | 触发函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| — | `active`（baseline） | `ledger.addBaseline` | G-AUTH（`ledger.manage`）；G-OPEN；`assertCents`；场景守卫：加入后总额 ≤ 当前上限（`CAP_BELOW_COMMITTED`） | `appendCommitment`；`bumpConstraints(cause:"ledger_changed")`；事件 `ledger_changed` |
| — | `active`（execution） | `executeIfComplete` | — | 同事务 |
| `active`（baseline） | `voided` | `ledger.voidBaseline` | G-AUTH；G-OPEN；`room.lastExecutionId` 为空（否则 `BASELINE_LOCKED`）；原因必填 | `bumpConstraints`；事件 |

执行条目永不作废（v1 无冲销，17）。
