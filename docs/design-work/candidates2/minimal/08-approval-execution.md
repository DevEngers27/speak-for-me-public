# 08 审批与执行

## 1. 决定

| 目标 | 决定 | 被否决 |
| --- | --- | --- |
| 审批绑定具体版本 | approval 引用不可变 `proposalId`；proposal 固定 `constraintsVersion`；approval 冗余存 `constraintsVersion` 并在插入时断言相等 | termsHash（提案不可变，id 即内容证明）；只存版本号 |
| 必需审批人不可绕过 | 场景常量 `approverRoles` 快照进 `proposal.requiredApproverRoles` | `members.approvalRequired` 可改字段 |
| 历史不丢 | approvals 只追加；当前决定 = 最新一行；撤回 = 追加 reject | upsert 最新决定（丢历史） |
| 无悬空的"已全批未执行" | 最后一票的同一 mutation 内执行 | 单独的 execute mutation / action / scheduler |
| 幂等 | 主防线：run 状态守卫；辅防线：`changeOrders.by_proposal` 先查后写；`proposalId` 即幂等键 | 客户端生成 uuid；`operationId` 字符串（与 proposalId 等价） |
| terms vs budget 签核 | 数据层不区分；由角色决定文案（provider/customer "Accept terms"，finance "Approve budget commitment"） | `approvals.kind` 字段（可由 role 推出） |

## 2. `approvals.decide({ proposalId, decision, reasonCode? })` 事务步骤

```text
 1. viewer = getViewer(ctx) ?? throw UNAUTHENTICATED
 2. proposal = db.get(proposalId) ?? throw NOT_FOUND
    room = db.get(proposal.roomId); seat = requireSeat(ctx, room._id)
 3. GA 守卫（04 §2）：
      seat.role ∈ proposal.requiredApproverRoles            else NOT_AN_APPROVER
      room.currentRunId === proposal.runId                    ┐
      run.status === "pending_approval"                       │ else 若 run.status === "executed" 且
      run.currentProposalId === proposal._id                  │      存在 changeOrder(by_proposal) → 返回 {status:"already_executed", changeOrderId}
      proposal.constraintsVersion === room.constraintsVersion ┘ 否则 STALE_PROPOSAL
 4. decision === "reject": 要求 reasonCode ∈ scenario.rejectCodes
    decision === "approve": c = loadConstraints(room)；codes = validateProposal(proposal, c)；codes ≠ [] → throw NOT_EXECUTABLE（code 不带数字）
 5. 读本提案全部 approvals（by_proposal，上界 = 角色数 × 少量）；
    若该席位最新决定 === decision → 无操作，跳到 7（双击幂等）
    否则 insert approvals{ proposalId, seatId, role: seat.role, userId, decision, reasonCode, constraintsVersion: proposal.constraintsVersion }
 6. reject → run: round < maxRounds ? R7（round+1，scheduleTurn(provider)）: R8（buildRequests）；返回 {status:"rejected"}
 7. approve → isFullyApproved(proposal, approvals')? 否 → 返回 {status:"approved", waitingOn: 未批角色}
 8. 执行（同一事务）：
    a. existing = changeOrders.by_proposal(proposalId).unique()；存在 → 返回 {status:"already_executed", changeOrderId}
    b. 再次 validateProposal（步骤 4 的结果在同一快照内，复用即可）
    c. fig = budgetFigures(proposal, c)
    d. coId = insert changeOrders{ …proposal 条款快照, approvalIds: 每个必需角色的最新 approve 行 id,
         commitment: { amountCents, committedBeforeCents: fig.committedCents, committedAfterCents: fig.committedAfterCents, totalBudgetCents }, simulated: proposal.simulated || room.simulated }
    e. for t of deriveTasks(…) insert tasks{ changeOrderId: coId, … }
    f. assertRunTransition("pending_approval","executed"); patch run{ status:"executed", endedReason:"executed", endedAt }
    g. 返回 {status:"executed", changeOrderId: coId}
```
所有读写在一个 mutation 中原子提交；任何一步抛错，全部回滚（含审批行）。

## 3. 并发与重复

| 场景 | 发生什么 |
| --- | --- |
| 同一人双击 approve（非最后一票） | 第二次：最新决定相同 → 无操作，返回同样的 waitingOn |
| 同一人双击 approve（最后一票） | 第一次执行；第二次 GA 看到 run executed → 返回 already_executed + 同一 changeOrderId |
| 最后两票（customer、finance）并发 | 两个事务都读 run 与 approvals；先提交者若不是最后一票则只插审批；OCC 使后者重试，重试时看到对方审批 → 执行。若两者都以为自己是最后一票，读写集冲突（同一 run 文档、同一 by_proposal 区间），后者重试时看到 executed → already_executed |
| 执行时 finance 同时降预算 | `briefs.confirm` 写 room.constraintsVersion；`decide` 读了 room → OCC 串行化：要么先执行再降预算（降预算校验 total ≥ 新 committed，否则拒绝），要么先降预算，decide 重试时 GA 失败 STALE_PROPOSAL |
| 断线重连重发 mutation | Convex 客户端对同一次调用去重；业务层仍由上表保证 |

convex-test 串行执行，不能证明 OCC（inputs/04 §1.12）：并发用例在真实 dev 部署上用脚本并行调用公共 `decide`（16 号）。

## 4. 审批撤回与过期

- 撤回：执行前可以对当前提案追加 `reject`（必须选 reasonCode），这会让 run 回到协商（R7/R8）。不存在"撤回但不拒绝"的中间态（ADR-10，极简：少一种决定类型，语义已覆盖）。
- 执行后不可撤回；修订 = 新 run 产生新变更单（17 号路线定义"修订链"）。
- 自动过期：任何约束变化使旧审批 invalidated（派生）；v1 没有按时间过期（报价/审批有效期见 18 号 Q）。

## 5. 派生执行记录

| 记录 | 内容 | 来源 |
| --- | --- | --- |
| `changeOrders` | 被批准条款快照、提案版本、约束版本、触发执行的审批 id、内嵌承诺快照 | 提案 + 当前约束 |
| 预算承诺 | `changeOrders.commitment`：本次金额、执行前后已承诺、当时上限 | `budgetFigures`；之后 `committedCents` 汇总把它计入 |
| `tasks` | 每个已批准条目一项，标题来自 provider 目录 `taskTitle`，指派 provider，截止 = 交付日 | `deriveTasks`（不调模型） |

变更单页面展示"执行时"的承诺快照（RA-B09）：之后预算再变，旧变更单显示的执行前/后不变。

## 6. 执行边界（核心 7）

- 只写 `changeOrders`、`tasks` 两张内部表；不转账、不签合同、不调用任何外部 API。界面在变更单上标注 "Internal record — no payment or contract is created"。
- 外部集成（ERP、工单系统）是后续扩展点：由 `changeOrders` 插入后的 internal 调度触发出站同步，幂等键 = `changeOrderId`（17 号）。

## 7. 返回类型

```ts
type DecideResult =
  | { status: "approved"; waitingOn: string[] }
  | { status: "rejected" }
  | { status: "executed"; changeOrderId: Id<"changeOrders"> }
  | { status: "already_executed"; changeOrderId: Id<"changeOrders"> };
// 错误：ConvexError({ code: "UNAUTHENTICATED" | "NOT_A_MEMBER" | "NOT_AN_APPROVER" | "STALE_PROPOSAL" | "NOT_EXECUTABLE" | "INVALID_REASON" })
```
界面不做乐观更新，以订阅回推为准（inputs/04 §5）。
