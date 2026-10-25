# 09 约束变更

## 9.1 什么是"硬约束"
能改变"某个候选是否可执行"的输入。首个场景：预算总额、customer 的 required / desired / deferrable / hardDeadline、provider 的 rushAvailable、目录（价格、工期、条目增删）。软偏好（preferredDate、tradeoffPreference、softHeadroomCents、notes）只影响协商，不使旧审批失效、不递增版本。

## 9.2 唯一入口 `bumpConstraints`

```ts
// convex/lib/constraints.ts —— 只能在 mutation 内调用；lint 规则禁止其他代码写 rooms.constraintsVersion
export async function bumpConstraints(ctx: MutationCtx, room: Doc<"rooms">, cause: ConstraintCause,
  opts: { autoRenegotiate: boolean }): Promise<{ constraintsVersion: number; newRunId?: Id<"runs"> }>;
type ConstraintCause =
  | { kind: "budget_updated"; actorUserId: Id<"users"> }
  | { kind: "brief_confirmed"; roleKey: string; actorUserId: Id<"users"> }
  | { kind: "catalog_confirmed"; actorUserId: Id<"users"> }
  | { kind: "human_answer"; requestId: Id<"humanRequests">; actorUserId: Id<"users"> };
```

步骤（同一事务）：
1. `room.constraintsVersion += 1`。
2. 若 `currentRunId` 指向非终态 run：记下 `wasActive = true`；run → superseded（R13）；清空 `currentRunId`、`currentProposalId`。
3. 该 run 的 running turns → canceled；对每个 turn 的已调度函数尽力 `scheduler.cancel`：先读 `_scheduled_functions` 状态，只取消 `pending`（已在运行的 action 跑完后会被 G-T 拒收，结果记 `stale_discarded`）。
4. 房间所有 open humanRequests → canceled（`cancelReason: "constraints_changed"`）。
5. 写事件 `constraints.changed`（audience room；payload：cause.kind、actorRole、新版本号、被阻断的提案版本；**不含任何数字**）。
6. 若 `opts.autoRenegotiate && wasActive && readiness`：调用 `startRunInternal(trigger: "constraint_change")`（含 analyzeFeasibility → R1 或 R2）。

不做的事：不删除、不修改旧 decisions；不改旧提案状态；不复制提案（否决 Role A RA-R11 revalidated）。

## 9.3 递增点清单

| mutation | 何时调用 bump | autoRenegotiate |
| --- | --- | --- |
| `budgets.update` | `newTotalCents !== totalCents` | true |
| `briefs.confirm` | 新 confirmed 的 `hardHash` ≠ 上一 confirmed（首次确认不 bump：房间尚未开始协商时 constraintsVersion 保持 1） | true |
| `catalog.confirm` / `catalog.retire` | 任一 confirmed 条目新增、价格 / 工期变化、退役 | true |
| `humanRequests.answer` | 选项效果是 set_budget / extend_deadline / make_deferrable / enable_rush | true（新 run trigger = human_answer） |
| 其他所有写入 | 从不 | — |

"首次确认不 bump"的理由：版本号的意义是"让已有审批失效"；房间开始协商前没有审批。规则统一表述为：**`hasAnyRun(room)` 为真后，任何硬约束变化都 bump**。

## 9.4 派生可执行性（读时）

```ts
isExecutable(p, room, sys) =
  p.constraintsVersion === room.constraintsVersion
  && room.currentProposalId === p._id
  && validateProposal(p.terms, sys).length === 0;
```
`rooms.view` 每次订阅刷新都重算，所以 finance 一提交预算，三个窗口在同一次查询失效中翻转为 Blocked——阻断是即时的，重新协商随后异步出现。

## 9.5 `budgets.update` 完整时序

| 步 | 动作 | 失败 / 分支 |
| --- | --- | --- |
| 1 | `requireRole(finance)`；`assertCents(newTotalCents)`；reason 非空 ≤ 300 | 抛错 |
| 2 | 读 budget 与 `committed = Σ commitments` | — |
| 3 | `newTotal < committed` → `ConvexError({code:"BUDGET_BELOW_COMMITTED"})` | 无写入（ADR-12） |
| 4 | 未变化 → 返回 `{changed:false}` | — |
| 5 | patch budget；插入 budgetChanges（old、new、reason、actor、constraintsVersionAfter） | — |
| 6 | `bumpConstraints(cause: budget_updated, autoRenegotiate: true)` | — |
| 7 | 返回 `{changed:true, constraintsVersion, newRunId?, feasibility: "feasible" | "needs_input" | "idle"}` | — |

## 9.6 重新协商的上下文
- 新 run 的代理上下文包含：新约束（本角色可见部分）、旧提案的派生阻断（按角色投影的原因码）、`history` 中一条模板记录 "Constraints changed (v1 → v2); proposal v1 is blocked."。
- 每回合无状态重建上下文，不回放旧 assistant 轮次与 thinking 块，因此"保留思考"约束不会在约束变化这一刻触发 400（inputs/04 §4.2）。

## 9.7 历史保留
budgetChanges、旧 brief 的 superseded 行、目录 retired 修订、旧 run（superseded）、旧 proposals 与 decisions、`constraints.changed` 事件全部保留。结果页按约束版本分组显示："v1: proposal v1 approved by customer and provider; blocked by budget change (v2)"。

## 9.8 必测场景（16）
回合进行中降预算 → 迟到结果 stale；改硬截止日 / 必需条目 / 价格同样使旧审批失效；降到恰好等于新提案的余量边界；降到无解（$4,400）→ 零模型调用 + finance 请求；降到低于已承诺（$3,900）→ 拒绝且无写入。
