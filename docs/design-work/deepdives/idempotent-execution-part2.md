# 专题深潜：Convex 上的原子幂等执行（part 2/4）：具体设计

> 代码：`deepdives/idempotent-execution/schema-fragment.ts`（表）、`pure.ts`（纯函数与场景接口）、`decide.ts`（mutation）、`tests.ts`（测试草图）、`race.sh`（并发冒烟）。本文只写结构、步骤与理由，不重复代码。

## 2.1 表与职责

| 表 | 本专题中的角色 | 写入口（唯一） | 可变性 |
| --- | --- | --- | --- |
| `proposals` | 被批准的不可变内容；`requiredApprovals`、`constraintsVersion` 是插入时快照 | 回合提交（10）插入；`decide`/执行只 patch `status` | 只有 `status` 可变（I1） |
| `approvals` | 每次决定一行，"当前决定"按 `seq` 派生 | `approvals.decide` | 只追加 |
| `executions` | 幂等锚点 + 审计（approvalIds、执行前后快照、planVersion） | `executeIfComplete` | 不可变 |
| `changeOrders` | 冻结的条款快照（场景产物） | `executeIfComplete` | 不可变 |
| `commitments` | 已承诺金额台账（唯一真相源） | seed（baseline）、`executeIfComplete` | 不可变 |
| `tasks` | 由计划派生的内部任务 | `executeIfComplete` 插入；`tasks.setStatus`（被指派角色）只改 `status` | 只有 `status` 可变 |
| `rooms`/`runs` | 守卫的读来源；执行把 run → `confirmed` | 各自状态机入口 | 见 04 |

### 2.1.1 逻辑唯一性落点（F03.12 要求"每条唯一性写明由哪个 mutation 守"）

| 逻辑唯一性 | 覆盖索引 | 守护 mutation | 机制 |
| --- | --- | --- | --- |
| 每 (proposalId, userId, seq) 一行 | `by_proposalId_and_userId_and_seq` | `approvals.decide` | 读整个 `by_proposalId` 区间求最新 seq，再 +1 插入；并发同键由 OCC 冲突重试 |
| 每 proposal 至多一条 execution（E1） | `by_proposalId`、`by_operationId` | `executeIfComplete`（只能经 `decide` 到达） | 守卫（proposal.status/run.status）为主，`by_operationId` 查重为辅 |
| 每 execution 恰好一条 change_order 承诺、一张变更单 | `commitments.by_operationId`、`changeOrders.by_executionId` | `executeIfComplete` | 与 execution 同事务插入，没有其他写路径 |
| 每 (roomId, role) 一名成员 | `members.by_roomId_and_role` | `acceptInvite`（07） | 先查后写；本专题只依赖其结果，并在 `evaluateApprovalSet` 中对 `holders.length !== 1` 拒绝算齐 |

代码审查清单：全仓库 `ctx.db.insert("executions" | "commitments" | "changeOrders" | "tasks" | "approvals"` 只允许出现在上表的入口与 seed 中（可用一条 grep 规则放进 CI）。

## 2.2 `approvals.decide` 分步时序

参数：`{ proposalId: Id<"proposals">, decision: "approve" | "reject" | "withdraw", expectedConstraintsVersion: number, reasonKey?: RejectReasonKey }`。客户端**不传** role、kind、operationId 或任何幂等键；`expectedConstraintsVersion` 只用于相等比较（D5、D11）。

| 步 | 读 | 写 | 失败 → 结果（事务回滚，状态不变） |
| --- | --- | --- | --- |
| 0 | `ctx.auth` → `users`（tokenIdentifier） | — | `UNAUTHENTICATED` |
| 1 | `proposals[proposalId]`、`members.by_roomId_and_userId`、`rooms`、`runs` | — | 提案不存在或调用者非本房间成员 → 都返回 `PROPOSAL_NOT_FOUND`（防探测） |
| 2 | 若 `proposal.status === 'executed'`：`executions.by_proposalId` | — | approve → 返回 `executed{alreadyExecuted:true}`；reject → `PROPOSAL_ALREADY_EXECUTED`；找不到 execution → `INVARIANT_VIOLATION` |
| 3 | 守卫：`room.status`、`room.currentRunId`、`room.currentProposalId`、`proposal.status`、`expectedConstraintsVersion === room.constraintsVersion`、`run.status` | — | `ROOM_CLOSED` / `PROPOSAL_NOT_CURRENT` / `CONSTRAINTS_CHANGED` / `RUN_NOT_AWAITING_APPROVAL` |
| 4 | `proposal.requiredApprovals` 中按 `member.role` 找 {role, kind} | — | `NOT_A_REQUIRED_APPROVER` |
| 5 | 仅 approve：`budgets.by_roomId`、`commitments.by_roomId`（求和）、目录、customer 已确认简报 → `validateForExecution` | — | `PROPOSAL_NOT_EXECUTABLE`（reasonCodes 只给 customer/finance） |
| 6 | `approvals.by_proposalId` 全区间（≤ 60 行） | — | 超过上限 → `TOO_MANY_DECISIONS` |
| 7 | 本人最新行 | (decision, cv) 任一不同 → 插入 `approvals`（seq+1，cv 取自 room）+ 事件 `approval_recorded` | 都相同 → 不写（`changed:false`） |
| 8 | reject（且 changed）：交给 `onProposalRejected`；withdraw：只记录，run 不动 | run → `negotiating` 或 `needs_input`；同事务 `runAfter(0, internal.agents.runTurn)`（10） | 返回 `recorded{decision:'reject'}` |
| 9 | `members.by_roomId_and_role`（房间全部成员） → `evaluateApprovalSet` | — | 未齐 → 返回 `recorded{missingRoles}` |
| 10 | `executions.by_operationId` | 插入 `executions`、`changeOrders`、`commitments`、N×`tasks`；run → `confirmed`；proposal → `executed`；事件 `executed` | 查重命中 / 计划漂移 → `INVARIANT_VIOLATION` |

要点：
- **第 9 步在 unchanged 时也执行**。这使 approve 成为收敛操作：任何一次成功返回的 approve 之后，若集合已齐则执行必已发生。正常情况下不会出现"齐了但没执行"（D1 保证），这一条是对未来代码变更的保险，代价只是一次有界读取。
- **reject 不做第 5 步**：拒绝不需要提案可执行；但第 3 步的守卫照做——对旧提案或已失效版本的拒绝没有意义，直接报错，前端据此刷新。
- **第 8 步只在 changed 时触发 run 迁移**：重复的 reject（双击）不会让 run 迁移两次（第二次时 run 已不在 `pending_approval`，第 3 步就会报 `RUN_NOT_AWAITING_APPROVAL`；前端把它当作"已处理"）。
- **事件**：重复调用不写事件（RA-R08）。`approval_recorded` 的 payload 只含 decision、kind、reasonKey；`executed` 不含金额，金额在查询时按 07 投影。

## 2.3 返回值与错误码

返回（判别联合，`returns` validator 见 decide.ts）：

| 返回 | 含义 | 前端处理 |
| --- | --- | --- |
| `recorded{decision, changed:true, missingRoles}` | 新决定已记录，未齐 | 显示"等待：finance"等 |
| `recorded{changed:false}` | 与最新决定相同，未写 | 静默；按钮保持禁用 |
| `executed{executionId, alreadyExecuted:false}` | 本次调用完成执行 | 跳转结果页 |
| `executed{alreadyExecuted:true}` | 之前已执行（双击、重试、他人先执行） | 同上，不提示错误 |

错误（`ConvexError<{ code: DecideErrorCode; reasonCodes?: ReasonCode[]; which?: string }>`）：

| code | 触发 | 用户可见文案（模板） | 是否可重试 |
| --- | --- | --- | --- |
| `UNAUTHENTICATED` | 无身份 | Sign in again | 登录后 |
| `PROPOSAL_NOT_FOUND` | 不存在 / 非成员 | Not found | 否 |
| `ROOM_CLOSED` | 房间关闭 | This room is closed | 否 |
| `PROPOSAL_NOT_CURRENT` | 不是当前提案 | A newer proposal replaced this one | 刷新后对新提案操作 |
| `CONSTRAINTS_CHANGED` | 约束已递增 | Constraints changed; this version needs a new proposal | 否（等新提案） |
| `RUN_NOT_AWAITING_APPROVAL` | run 不在待批（被拒、被取代、已执行中） | This proposal is no longer awaiting approval | 否 |
| `NOT_A_REQUIRED_APPROVER` | 角色不在快照中 | You are not an approver for this proposal | 否 |
| `PROPOSAL_NOT_EXECUTABLE` | D4 纵深防御触发 | Blocked: {reason by role} | 否；同时写错误日志 |
| `PROPOSAL_ALREADY_EXECUTED` | 执行后 reject | Already executed; start a revision instead | 否 |
| `TOO_MANY_DECISIONS` | 切换次数超上限 | Too many changes on this proposal | 否 |
| `INVARIANT_VIOLATION` | E1/E2/计划漂移 | Something went wrong (ref: requestId) | 否；告警（15） |

`requestId` 取自 `ctx.meta.getRequestMetadata().requestId`（inputs/04 §1.10），写进错误日志，便于追溯。

## 2.4 必需审批人集合：首个场景实例

| role | kind | UI 按钮 | 签的是什么 |
| --- | --- | --- | --- |
| customer | terms | Accept terms | 变更单条款（范围、金额、交付日） |
| provider | terms | Accept terms | 同上；provider 视图只显示条款与自己的任务，不显示预算数字 |
| finance | budget | Approve budget commitment | 预算承诺（同一 proposalId、同一约束版本） |

- 场景注册时断言：`requiredApprovals` 中 role 两两不同（`evaluateApprovalSet` 依赖"一个角色一项"）。
- terms 与 budget 是同一流程上的两种签核（F08.3），不是两套流程：都绑定 (proposalId, constraintsVersion)，都在同一个集合判定里。
- 旧审批"失效"不落库，读取时派生：`approval.constraintsVersion !== room.constraintsVersion || approval.proposalId !== room.currentProposalId` → 显示 invalidated（F04.5、F09.3）。

## 2.5 正常流程时序（三人依次批准）

1. 回合提交（10，`internal.runs.completeTurn`）插入 proposal v3（`createdAtConstraintsVersion=5`，requiredApprovals 快照），run → `pending_approval`，`room.currentProposalId = v3`。各方以 `expectedConstraintsVersion=5` 调用 `decide`。
2. customer 调 `decide(v3, approve)`：守卫通过 → 可执行 → 插 approvals(seq 1) → 集合缺 provider、finance → `recorded`。
3. provider 同上 → 缺 finance。
4. finance 调 `decide(v3, approve)`：守卫通过 → 可执行（committed 400000 + 90000 ≤ 500000）→ 插 approvals → 集合齐 → `operationId = exec:<v3>` 未命中 → 插 execution、changeOrder、commitment(90000)、3×task → run → `confirmed`、v3 → `executed` → 事件 → 返回 `executed`。
5. 三个窗口的实时查询同时看到 executed；`getCommittedCents` 现在返回 490000。

## 2.6 与约束变更的交点（09 的入口在本专题中必须满足的条件）

- `bumpConstraints` 必须 patch `rooms.constraintsVersion`。`decide` 读 `rooms`，所以任何并发的约束递增都会与正在进行的审批事务冲突（part3 C5）。
- 改预算的 `updateBudget` 同时 patch `budgets`；即使有人漏调 `bumpConstraints`，`decide` 第 5 步读了 `budgets` 与 `commitments` 区间，冲突仍会发生、重试时规则重算——这是 D4 纵深防御的落点。
- 约束递增后由 `reconcileAfterBump`（09，versioned-approvals D6）决定提案去向：在新约束下仍合规 → 提案保持 active、run 保持 `pending_approval`，旧版本上的审批派生为 stale，三方以新的 `expectedConstraintsVersion` 对**同一 proposalId** 重新审批即可执行（RA-R11，D11）；不合规 → run → superseded，新 run 重谈或进入 needs_input，旧提案不再是当前提案，`decide` 在第 3 步报 `PROPOSAL_NOT_CURRENT`。
- 走查（降到 4950）：cv 5→6，v3（490000）仍合规 → 三方以 cv=6 重新批准 → 执行，`executions.constraintsVersion = 6`，`operationId = exec:<v3>`；cv=5 上的两条旧 approve 保留为历史。降到 4800：v3 不合规 → run superseded → 09 的重谈流程。
