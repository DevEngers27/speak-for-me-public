# 专题深潜：Convex 上的原子幂等执行（part 1/4）

> 依据：00-brief §3 核心 3/4/5/6、inputs/02 F08.1–F08.6、F09.1–F09.3、F02.3、F02.9（I4/I5/I7/I10）、F03.3/F03.7/F03.8/F03.12、F04.2/F04.4/F04.5、F07.1；inputs/03 RA-D12/RA-D13/RA-D14、RA-R08；inputs/04 §1.3–1.6、§1.11–1.12。
> 分片：part1 目标与决定 → part2 具体设计（表、函数、步骤、返回与错误） → part3 反例与边界 → part4 测试、接口、待验证。代码在 `deepdives/idempotent-execution/*.ts`。

## 0. 目标与范围

**目标**：把"人对一个具体版本做出决定 → 必需审批到齐 → 一次事务写入执行记录"这条路径设计到可以直接实现的程度，并证明在双击、并发审批、约束并发变更、action 迟到写回、各层重试下都不会出现：

- G1 重复的执行记录、承诺或任务（核心 5）；
- G2 在旧约束版本或非当前提案上执行（核心 3）；
- G3 缺任何一个必需审批人、或同一人顶替两个角色时执行（I7）；
- G4 执行时预算不满足（I5：`committed + amount <= total` 在执行事务内重算）；
- G5 "审批已记录但执行丢失"或"执行已发生但审批被撤回"这类半完成状态；
- G6 已承诺金额出现两个真相源（F02.3）；
- G7 篡改历史：旧审批被删除或覆盖（核心 6）。

**范围内**：`approvals.decide` 公共 mutation（批准与拒绝共用一个入口）、审批记录的写入语义、必需审批人集合判定、执行前预算重算、状态守卫、operationId 派生、去重、同事务派生 executions / changeOrders / commitments / tasks、`getCommittedCents` 唯一事实来源、错误码与返回形状、测试策略。

**范围外（只给接口）**：run 状态机全表（04）、拒绝之后如何重新协商（05/10）、`bumpConstraints` 与 `updateBudget` 的完整步骤（09）、字段×角色披露（07）、场景插件的目录与任务模板内容（14）。

**一句话方案**：执行不是一个独立步骤，而是 `decide` 的尾部分支——最后一张必需的 approve 和执行在**同一个 mutation 事务**里提交；状态守卫是主防线，服务端派生的 `operationId` 是第二道防线兼审计键；整个事务依赖 Convex mutation 的可串行化（OCC）来消除并发交错，所以只要证明"任意串行顺序下不变量成立"，再在真实部署上验证串行化假设即可。

## 1. 决定与理由

### D1 执行放在最后一次 approve 的同一个 mutation 里
- **决定**：`approvals.decide` 在写入本人决定后立即做集合判定；齐了就在同一事务里执行。没有单独的 "Execute" 按钮，没有 action，没有 scheduler 中转。
- **理由**：消除"审批齐了但还没执行"这一中间态（G5）；审批与执行同生共死——执行任何一步抛错，本次审批也回滚，用户看到错误，状态不变，可安全重试。
- **否决**：①客户端在审批齐后调用 `execute`：多一个状态、需要有人点、窗口期内约束可能变化；②`decide` 里 `runAfter(0, internal.execution.execute)`：调度的 mutation 虽 exactly-once，但中间态仍存在，执行 mutation 必须重做全部守卫且可能失败，失败后无人收到错误。
- **保留的退路**：执行逻辑写成 helper `executeIfComplete(ctx, input)`，不依赖调用方式。若第二个场景的执行计划大到逼近事务限额（数值待验证），可以把它挂到一个 internal mutation 上改为调度，守卫原样复用。
- **不变量**：E1 `proposal.status === 'executed'` ⇔ 存在且仅存在一条 `executions` 记录其 `proposalId` 等于它。

### D2 审批记录只追加；"upsert"是逻辑语义，不是 patch
- **冲突**：F03.7 建议同一 (proposalId, userId) 先查后 patch、撤回即改成 reject；RA-D12 要求只追加。核心 6 要求旧审批全部保留，patch 会把"先批准后撤回"抹成一条 reject。
- **决定**：`approvals` 表每次决定插入一行，永不 patch、永不 delete。写入口按 (proposalId, userId) 读出**最新一行**：若新决定的 (decision, constraintsVersion) 与最新一行完全相同 → 不写（幂等，返回 `unchanged`）；否则插入新行，`seq = latest.seq + 1`（跨约束版本不重置）。"当前有效决定"= 每人 `seq` 最大的一行且其 `constraintsVersion === room.constraintsVersion`。只比 decision 是错的：cv5 上的 approve 在约束变为 cv6 后必须能重新写入（见 D11）。对外仍称"审批 upsert"，因为对每个 (proposal, user) 的可观察效果就是"只保留最新决定"。
- **为什么用 `seq` 而不按 `_creationTime` 取最新**：inputs/04 §1.6 指出 `_creationTime` 是墙钟、不保证与提交顺序一致。`seq` 由"读到上一行再 +1"产生，OCC 保证后一个事务一定读到前一个事务的行（否则冲突重试），所以 `seq` 严格反映提交顺序。不用 `v.commitTs()`：同事务读回是占位符，且对本需求是多余的新特性。
- **不变量**：E2 每个 (proposalId, userId) 的 `seq` 从 1 连续递增无重复；E3 相邻两行的 (decision, constraintsVersion) 不同（否则第二行不会被写入）。decision 枚举为 approve / reject / withdraw（withdraw = 撤回本人批准、不触发重谈；与 versioned-approvals 一致）。

### D3 必需审批人：场景常量 → 插入提案时快照 → 执行时按集合判定
- **决定**：场景插件导出 `requiredApprovals: readonly { role, kind }[]`（首个场景：customer/terms、provider/terms、finance/budget，对应 F08.3 的 "Accept terms" / "Approve budget commitment"）。插入提案时快照进 `proposal.requiredApprovals`；判定只看快照，不看任何可改字段（删掉 `members.approvalRequired`）。
- **集合判定**（纯函数 `evaluateApprovalSet`，见 pure.ts）：对快照中的每个 {role, kind}，取**当前** `members` 中该角色的成员 m；要求 m 对本提案的最新决定为 `approve`，且这行的 `role`、`kind` 与快照一致、`constraintsVersion === room.constraintsVersion`；所有被选中的 `userId` 两两不同。禁止计数式判定（`approvals.length >= 3`）。
- **理由**：计数会被重复点击或一人多角色提前凑满；按"当前成员"判定使被替换的成员留下的旧批准自动失效。
- **不变量**：E4 执行时 `executions.approvalIds` 恰好对应快照中每个 {role, kind} 一行，且 userId 两两不同。

### D4 approve 的前提是"此刻可执行"；校验在写审批之前
- **决定**：`decision === 'approve'` 时，先在同一事务里调用场景的 `validateForExecution`（与 F06 `validateProposal` 共用同一组纯规则，输入为当前预算、`getCommittedCents`、目录、已确认简报）；不通过就抛 `PROPOSAL_NOT_EXECUTABLE`，**不写**审批。第一张、第二张、最后一张 approve 都做同样的检查。
- **理由**：避免"审批已记录但执行被阻断"这一需要额外状态和恢复路径的中间态（G5）。同一事务、同一快照，所以最后一张 approve 的检查结果就是执行时的结果，F08.4 第 4 步"执行前重算预算"由此自然满足（G4）。
- **推论**：提案是当前提案且 run 处于 `pending_approval` 时，这个检查理论上不会失败——能改变预算、目录、硬约束的写入都必须经 `bumpConstraints`（F09.1），而 bump 之后的 `reconcileAfterBump`（09）已在新约束下重算：不合规的提案会被取代、不再是当前提案；已承诺金额只会被本房间的执行改变（一个房间同时只有一个 active 提案）。所以它是纵深防御；一旦失败说明有绕过 `bumpConstraints` 的写路径，按 bug 处理（写结构化错误日志）。
- reject 不要求校验通过（可以拒绝任何当前提案），但仍要通过状态守卫。

### D5 状态守卫为主，operationId 为辅
- **主防线（守卫，全部来自同一事务读到的文档）**：`room.status === 'open'`；`room.currentRunId === proposal.runId`；`room.currentProposalId === proposal._id`；`args.expectedConstraintsVersion === room.constraintsVersion`（人看到的约束版本就是当前版本）；`proposal.status === 'active'`；`run.status === 'pending_approval'`。这是 F04.2 的"审批/执行守卫"组，与回合持久化守卫（completeTurn）是两组，不混用。
- **为什么守卫足以防重复执行**：执行事务把 `run.status` 改为 `confirmed`、`proposal.status` 改为 `executed`。任何并发的第二个执行事务都读过这两份文档，OCC 让它冲突重试，重试时守卫失败或命中"已执行"快速路径。
- **第二道防线**：执行前按 `by_operation` 查 `executions`；命中但守卫却通过，说明 E1 已被破坏 → 抛 `INVARIANT_VIOLATION`、整个事务回滚、不再写任何东西（fail closed）。与 F08.4"命中则返回已有结果"的差别：已执行的正常重复请求在第 3 步就被快速路径接住并返回已有结果；能走到这里的只有 bug，静默返回会掩盖它。
- **operationId 服务端派生**：`exec:${proposalId}`。客户端不传任何幂等键（F08.4：客户端 uuid 会让查重失效——两次点击生成两个 uuid）。**偏离 F08.4 的 `exec:${proposalId}:${constraintsVersion}`**：采纳 RA-R11 后同一提案可能在 cv5、cv6 先后进入审批，含 cv 的键会允许它在两个版本下各执行一次，削弱 I5"每个提案至多执行一次"；按 proposalId 取键与 I5 一一对应（与 versioned-approvals D12 一致）。执行时的约束版本另存于 `executions.constraintsVersion`。
- `expectedConstraintsVersion` 是客户端唯一需要传的版本信息：它不是幂等键，而是"我批准时看到的约束版本"的声明，服务端只做相等比较，写入的 `approvals.constraintsVersion` 取自 `room`。

### D6 已执行是终态：重复 approve 返回已有结果，执行后的 reject 报错
- 快速路径：`proposal.status === 'executed'` 时，approve 返回 `{ kind: 'already_executed', executionId }`，不写审批、不写事件（RA-R08："重复调用返回同一 executionId，不新增房间事件"）；reject 抛 `PROPOSAL_ALREADY_EXECUTED`——执行后不可撤回，修订走新 run（F04.1、17）。

### D7 已承诺金额只有一个真相源：commitments 台账
- **决定**：committed = `getCommittedCents(ctx, roomId)` 按 `commitments.by_room` 求和，不在 rooms/budgets 上存计数器（F02.3）。基线是一条 `kind: 'baseline', simulated: true` 的承诺（seed 写入）。
- `commitments` 只有两个写入口：seed/reset（只作用于 `simulated` 的演示数据，15）与 `executeIfComplete`；不 patch、不 delete。
- `executions.committedBeforeCents / committedAfterCents` 是**执行时的不可变快照**，只用于结果页"执行前 / 后"展示（RA-D13，替代 Role A 用减法推算），不参与任何计算；文档与代码注释都要写明这一点，防止被当作第二真相源。

### D8 执行产物：引擎锚点 + 场景计划
- **决定**：引擎表 `executions`（幂等锚点与审计记录，`by_operation` 唯一）+ 三张派生表 `changeOrders`、`commitments`、`tasks`，都带 `executionId`。派生内容由场景插件的纯函数 `planExecution(proposal, catalog, templates)` 计算，不调模型，返回 `ExecutionPlan`；引擎负责插入。`executions.planVersion` 记录模板版本（RA-D14）。
- **否决**："以 changeOrder 作锚点、不设 executions"：v1 能用，但第二个场景的产物不一定叫变更单；审批快照（approvalIds）与执行前后快照需要一个与场景无关的家。代价是多一张表，换来引擎接口稳定（任务书 §2 要求引擎能容纳第二场景）。
- 审批界面用同一个 `planExecution` 渲染"批准后将创建的记录"预览（RA-D14），保证"所见即所写"。

### D9 错误用 ConvexError 抛出且整体回滚；可预期的非错误结果用返回值
- 守卫失败、未授权、不可执行 → `throw new ConvexError({ code, ... })`，事务回滚，审批不落库。
- 记录成功但未齐、重复相同决定、已执行 → 返回判别联合（part2 §2.5）。
- 披露纪律（F07.1）：错误对象只带 `code`；`PROPOSAL_NOT_EXECUTABLE` 的 `reasonCodes` 只对有权看预算的角色（customer/finance）返回，provider 只得到 code 本身。

### D11 约束变化后仍合规的提案可在新版本上重新审批（采纳 RA-R11）
- **输入冲突**：F08.4/F09.3 的守卫 `proposal.constraintsVersion === room.constraintsVersion` 让任何约束变化后提案永久不可执行；inputs/03 §10 回归 RA-R11 要求"降上限后当前提案仍可行时不产生新提案版本，旧审批 stale，对同一 proposalId 重新批准后可执行"。
- **决定**：采纳 RA-R11（与 versioned-approvals D6/D7 一致）。提案上的版本字段改名 `createdAtConstraintsVersion`，只作来历；约束绑定由审批行的 `constraintsVersion` 承担；可执行性 = 提案当前且 active ∧ run 为 pending_approval ∧ 在当前约束下 `validateForExecution` 通过 ∧ 集合判定只计 `constraintsVersion === room.constraintsVersion` 的 approve。
- **理由**：核心 3 要求的是"约束变了必须重新审批"，不是"必须换提案"；条款不变却复制一个新版本没有信息量（RA-R11 否决复制的理由）。
- **带来的要求**：客户端必须传 `expectedConstraintsVersion`（D5）；逻辑 upsert 比较 (decision, constraintsVersion)（D2）；operationId 不含 cv（D5）。

### D10 并发正确性的论证方式
- Convex mutation 可串行化（OCC，inputs/04 §1.3；严格隔离级别与区间读冲突"待验证"）⇒ 任何并发执行都等价于某个串行顺序 ⇒ 只需证明**任意串行顺序**下 G1–G7 成立。convex-test 可以穷举/随机生成串行顺序做模型测试；"真实部署确实可串行化"由并发冒烟脚本验证（part4）。
- 为此所有影响判定的状态都必须在同一事务中**读到**：room、run、proposal、该提案的全部 approvals（按 `by_proposal` 区间）、members、budgets、commitments（按 `by_room` 区间）、目录与简报。少读一份就可能出现写偏斜（write skew），见 part3 反例 C4。
