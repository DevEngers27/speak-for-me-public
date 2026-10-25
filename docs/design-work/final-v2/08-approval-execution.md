# 08 审批与执行（part1）：目标、范围、决定 A1–A6

> 分片（共 11 片，按顺序阅读）：
> - **part1（本文件 `08-approval-execution.md`）**：8.0 目标与范围、8.1 一句话方案、8.2 决定 A1–A6
> - `08-approval-execution-part2.md`：8.2 决定 A7–A13
> - `08-approval-execution-part3.md`：8.3 数据形状（`approvals` / `executions` / `changeOrders` / `ledgerEntries` / `tasks` 的字段、索引、唯一性落点、唯一写入口白名单）
> - `08-approval-execution-part4.md`：8.4 纯函数（`latestDecisionsByUser`、`evaluateApprovalSet`、`passesChecks` / `isExecutable`、`computeChangeOrderChain`、`planExecutionRecords`、`inheritProvenance`）
> - `08-approval-execution-part5.md`：8.5 `approvals.record` 签名、返回值与错误码、分步时序 S0–S14、reject / withdraw 分支
> - `08-approval-execution-part6.md`：8.6 `executeIfComplete` 分步 X1–X17、记录派生、执行边界、执行之后（`tasks.markDone`、`rooms.startFollowUp`）、查询与按角色投影
> - `08-approval-execution-part7.md`：8.7 并发论证、读写集、反例表 K1–K32（K = 本章反例编号，区别于 canon 冲突编号 C1–C42）、限额
> - `08-approval-execution-part8.md`：8.8 对账检查器 R1–R11（convex-test 每个场景 `afterEach` 断言）、纯函数单测 U1–U18
> - `08-approval-execution-part9.md`：8.9 测试清单（convex-test I1–I23、模型测试、真实部署并发探针、结构测试、端到端）
> - `08-approval-execution-part10.md`：8.10 走查（D27 数字：主线、保留分支、变体 V1–V8）
> - `08-approval-execution-part11.md`：8.11 不变量 E1–E14、8.12 备选与否决汇总、8.13 开放问题、8.14 与 canon 的对照
>
> 底稿：`candidates/product/08-*`（执行 17 步时序、签核区间读触发 OCC）与 `deepdives/idempotent-execution*`（分步守卫、反例表、`checkExecutionInvariants`）。已按 `idempotent-execution-review` r01–r10、`versioned-approvals-review` r01–r15 修正；R1–R11 取自 `candidates2/finance/08-approval-execution-part2.md` §10 并改写到 canon 的表结构。命名、状态、函数名一律以 00-canon 为准；本章发现的 canon 缺口只在返回值 `canon_objections` 中提出，正文按 canon 写。

## 8.0 目标与范围

**目标**（每条在 8.11 有对应不变量，8.9 有测试）：

| # | 目标 | 核心 |
| --- | --- | --- |
| G1 | 双击、重连重发、OCC 重试、并发最后两票、迟到回合与看门狗，都不会产生第二条 `executions` / `ledgerEntries(kind: commit)` / `changeOrders` / `tasks` | 5 |
| G2 | 只计 `boundConstraintsVersion === room.constraintsVersion` 且 `boundTermsKey === proposal.termsKey` 的 approve；人没看过的约束版本上不会有他的签字 | 3 |
| G3 | 每个必需角色恰好一位**当前**成员的有效 approve，被选中的 userId 两两不同（同一人不满足两个必需角色） | 3、D24 |
| G4 | 执行事务内按当前台账与当前上限重算，`committedCents + amountCents <= capCents`（恰等于通过） | 4、5 |
| G5 | 不存在"审批已齐但未执行"或"已执行但最后一票未落库"的半完成态 | 5 |
| G6 | 已承诺金额只有一个真相源：`committedCents = Σ ledgerEntries.amountCents`，任何表都不存计数器 | 4 |
| G7 | 审批只追加；执行后审批有效性由 `executions.approvalIds` 冻结快照显示，不随后续任何变化改写 | 6 |
| G8 | 执行只写内部表；执行代码路径不出现 action、`fetch`、外部 SDK、调度 | 7 |
| G9 | 所见即所写：审批前预览的变更单、台账增量与任务，与执行写入逐字段相同（同一纯函数 + 提案快照） | 3 |
| G10 | 活性：任何时刻"当前提案 active ∧ run 为 `pending_approval` ∧ 当前 cv 上集合已齐"都不会持续存在而不执行 | 5 |

**本章负责**：公开 mutation `approvals.record`（approve / reject / withdraw 的唯一写入口）、审批绑定与去重、必需审批人集合判定 `evaluateApprovalSet`（**全系统唯一实现**，rules-engine 的 readiness 与前端审批面板都只是它的投影）、`isExecutable` 的定义、内部 helper `executions.executeIfComplete`、变更单（AIA G701 金额链）/ 台账提交 / 任务的派生、`tasks.markDone`、对账检查器 R1–R11、本章测试清单。

**只给接口**（归属他章）：run 状态机全表与 reject 之后的回合调度 helper（04、10）；`constraints.bump`、`react()` 与 `clock.rollLocalDate`（09、15）；`checkProposal` 与 `RuleInput` 装载（06）；字段 × 角色矩阵与 `projectForRole`（07）；`plannedTasks` / `lines` 在提案插入时的快照派生（06、14）；函数目录（12）；页面（13）。

## 8.1 一句话方案

执行不是独立步骤，而是 `approvals.record` 的尾部分支：最后一张必需 approve 与执行在**同一个 mutation 事务**里提交（D03）。主防线是同一事务读到的状态守卫（room、run、proposal、本提案全部审批区间、成员、台账区间、目录与简报），并由 03 的房间写锁 M-ROOM（每个写事务先 `rooms.writeSeq + 1`）保证同房间写事务在 `rooms` 上确定冲突；第二道防线是服务端派生的 `executionKey = exec:${proposalId}` 先查后插（命中即 fail closed，抛 `internal` 并告警）。正确性论证分三环：①模型测试证明"任意串行顺序下不变量成立"；②Convex mutation 是 OCC 可串行化事务；③真实部署上的并发探针证明本应用的读写形状（特别是索引区间读）确实触发冲突重试（spikes §8 #1）。缺第③环时，16 的报告必须写"并发未验证"，不得写"并发测试通过"。

## 8.2 决定（A1–A6）

### A1 审批绑定 `(proposalId, boundConstraintsVersion, boundTermsKey)`，入参必须带 `expectedConstraintsVersion` / `expectedTermsKey`

- **决定**：`approvals` 每行写入 `boundConstraintsVersion = room.constraintsVersion` 与 `boundTermsKey = proposal.termsKey`（取自服务端读到的文档，不取自客户端）。`approvals.record` 的入参必须带 `expectedConstraintsVersion` 与 `expectedTermsKey`，两者都与服务端当前值相等才继续；任一不等抛 `approval.stale`（`params.currentConstraintsVersion`），**不写审批行**。三种决定（approve / reject / withdraw）一律要求这两个参数。
- **理由**：提案行不可变（D25），`proposalId` 已证明"批准的是哪份条款"；`termsKey`（`canonicalJson(terms)` 规范串）是可读、可复核的证据，让"人看到的卡片"与"被签的条款"在服务端做一次相等比较；`constraintsVersion` 证明"批准时看到的是哪套约束下的评估"。没有 `expected*`，用户停在 cv 3 的页面点击会被记成"在 cv 4 下批准"（TOCTOU，inputs/07 第 18 行反例）。客户端传入的只是陈旧检查值，不是授权依据：恶意客户端照抄当前值等价于"不看就批"，得不到任何额外权限。
- **否决**：①只用服务端当前版本（上述竞态）；②sha256 `contentHash`（`crypto.subtle` 在 Convex 运行时待验证，且提案不可变时哈希无收益，D25）；③客户端传 `proposalVersion`（`proposalId` 已足够）。
- **不变量**：E3。

### A2 只追加 + `seq`；"当前决定"= seq 最大行；同 cv 相同决定不插行

- **决定**：`approvals` 每次决定插入一行，永不 patch、永不 delete。`seq` 在 `(proposalId, userId)` 内从 1 连续递增、跨约束版本不重置，取值为本人最大 seq + 1：approve 从同事务读出的本提案整区间里取（集合判定本来就要读它），reject 只读本人最新一行、withdraw 只读本人区间（S9），二者都不读他人行、不受任何全提案行数上限约束；同房间并发由 M-ROOM（`rooms.writeSeq`）确定冲突。"当前决定"= 该 `(proposalId, userId)` 的 seq 最大行。去重：本人最新行的 `(decision, boundConstraintsVersion)` 与本次相同 → 不插行、不写事件，返回 `unchanged`（approve 的 `unchanged` 仍会做集合判定，见 A6）。
- **理由**：patch 式 upsert 会把"先批后撤"抹成一行，违反核心 6（spikes B3 实测）。不用 `_creationTime` 定序：它是墙钟，不保证与提交顺序一致（inputs/04 §1.6，review 核实）；`seq` 由 OCC 保证后一个事务必读到前一个事务的行，否则冲突重试。只比 `decision` 是错的：cv 3 上的 approve 在 cv 4 上必须能再次写入。
- **否决**：patch upsert；两表分存 approve / reject；`v.commitTs()` 定序（同事务读回为占位符，且多余）；唯一索引 `by_proposalId_and_userId_and_seq` 作为"覆盖索引"（Convex 索引不唯一，review r09 指出该索引从未被查询）——改用一个索引 `by_proposal_user`（`proposalId, userId, seq`）同时服务"整提案区间读"与"本人最新行"。
- **不变量**：E2。

### A3 必需审批人：场景声明角色 → 插入提案时快照 `{role, kind}` → 判定时取当前成员、要求 userId 两两不同

- **决定**：场景插件以 `roles: RoleDecl[]` 声明角色与各自的 `approvalKind`（06 §12.1；首个场景 customer / provider = `terms`，finance = `budget`），注册时断言角色两两不同；`kind` 只影响文案。引擎在插入提案时快照 `proposal.requiredApprovals = roles.map(r => ({ role: r.role, kind: r.approvalKind }))`（插件不能覆盖，06 §12.3）；判定只读快照，不读任何可改字段（不存在 `members.approvalRequired`）。`evaluateApprovalSet` 对快照中每个 `{role, kind}` 取**当前** `members` 中该角色的成员：0 人或 > 1 人 → 该槽 `vacant`（不算齐）；同一 userId 已被前一个槽使用 → `self_conflict`（不算齐）；该人的当前决定须为 approve、`role` / `kind` 与快照一致、`boundConstraintsVersion === room.constraintsVersion`、`boundTermsKey === proposal.termsKey`。**禁止计数式判定**（`approvals.length >= 3`）。
- **理由**：计数会被重复点击或一人多角色提前凑满；"当前成员"语义让已离开的人留下的批准自然不计（v1 不支持换人，D24，此条是防御）。快照存角色而不存 userId：rules-engine 草稿存 userId（review r04 指出与本语义冲突），按 canon D02 统一为"角色快照 + 当前成员"，rules-engine 的 `evaluateExecutionReadiness` 改为本函数的 UI 投影。
- **同一人不满足两个必需角色**：第一道防线是事务 helper `addMember`（`rooms.create`、`invites.accept`、`rooms.startFollowUp` 三处共用）的一人一房一席（D24）；第二道防线是本函数的 distinct userId；第三道是对账 R7。
- **否决**：可兼任但"同人不计两票"（PD-09b，D24 否决：审批守卫要多一套例外路径）；userId 快照（成员语义冲突）。
- **不变量**：E4。

### A4 approve 的前提是"此刻通过全部检查"（`passesChecks`）；reject 永远可做；withdraw 只撤本人当前 approve

- **决定**：
  - **approve**：在同一事务里装载 `RuleInput`（当前 cv 下三方硬字段、当前目录、台账求和、`today`）跑 `checkProposal`；有阻断项 → 抛 `approval.not_executable`，**不写审批**，并 `publicOpsLog('approval.not_executable', { fn: 'approvals.record' })`（公开路径的闭集三键 logger，15 §15.6.2）。第一、第二、最后一张 approve 都做同样检查。这就是 canon D02 所说的"approve 前跑 `isExecutable`"：`isExecutable = isCurrentForApproval ∧ passesChecks`（§8.4.2 的唯一定义，**不含**审批集合，因此在第一张 approve 前就有意义）；审批是否齐全另名 `allApproved = evaluateApprovalSet().complete`，执行条件 `canExecuteNow = isExecutable ∧ allApproved`。
  - **reject**：不要求 `passesChecks`（永远可以说不），但要通过状态守卫与 `expected*`；也不受场景版本守卫（S5 只拦 approve）与任何行数上限约束（S9 只读本人最新一行），排空期间照常成功（K30）——reject 是 run 的唯一逃生口（E14）。
  - **withdraw**：只能撤回本人在**当前 cv** 上的 approve，且只在执行前；本人没有当前 cv 上的 approve（含已撤回、旧 cv 上的 approve）→ 返回 `unchanged`，不写行、不另设错误码（与 12 一致）。withdraw 不改 run（仍 `pending_approval`）。
- **理由**：approve 前检查消除"审批已记录但执行被阻断"这一需要额外状态和恢复路径的中间态（G5）；同一事务、同一快照，所以最后一票的检查结果就是执行时的结果。正常路径不会触发：能改变规则输入的写入都经 `constraints.bump`（D05：目录价格 / 工期 / 增删 / retire、三方硬字段都在硬投影内；标题与任务模板由提案快照承载），bump 后 `react()` 已在新约束下处理当前提案；跨午夜由 `clock.rollLocalDate` 的结论翻转 bump 处理，且规则一律读 `room.localDate`（A12、09 §9.6.7）。所以它一旦触发就是绕过 `constraints.bump` 的 bug（review r02 的两个反例已由 D05 与 A10 关闭）。
- **否决**：approve 不检查、只在最后一票检查（第一、二票可能落在不可执行提案上，界面显示"已批准"而实际不可执行）；"审批已记录、执行被阻断"留作中间态（需要恢复路径，review r02）。
- **不变量**：E9。

### A5 reject 是该提案的终局；withdraw 只撤 approve

- **决定**：一次有效 reject（守卫通过且写入新行）在同一事务把提案 `active → rejected`（终态），并交给 04/10 的 helper `onProposalRejected` 处置 run：`run.roundNo < maxRounds` → run 回到 `negotiating`（`roundNo + 1`，同事务经 `turns.beginAttempt` 接缝调度 proposer 回合，代理反馈按 05 §5.12：provider 代理只见 "vN rejected"，买方代理见 "vN rejected by {role}"，任何他方代理都拿不到 `reasonKey` 与 `note`）；否则 → `needs_input` 并经 `buildHumanRequests` 恰好开一个 customer 的 `rounds_exhausted` 请求（D15）。被拒提案的 `candidateKey` 加入本 run 的已阻断集合（与 `action.repeats_blocked` 同一来源），proposer 下一回合的 `candidateSnapshot` 不再包含它。之后对该提案的任何决定都被守卫拒绝（`approval.not_current`）；被拒提案不参与 D06 的"仍通过则保留"预检，任何约束变化都不会复活它。
- **理由**：reject 立刻改变 run，"先拒后撤再批"在集成层根本走不到（versioned-approvals-review r07）；若允许撤回拒绝，就需要"拒绝冷静期"（延迟迁移），复杂度明显上升。审批聚合语义按"每个必需角色都批准同一 termsKey；任一角色拒绝，该版本即终止"（research §5.5）。
- **否决**：可撤回拒绝（冷静期，v1 不做）；reject 后提案保持 active 直到新提案插入（inputs/07 第 47 行：随后的无关 bump 会让预检把刚被拒的提案放回 `pending_approval`）。
- **不变量**：E10、E14。

### A6 执行与最后一张 approve 同事务；approve 是收敛操作

- **决定**：`approvals.record(approve)` 写入本人决定后（或判定为 `unchanged` 后）立即在同一事务里调用 `executeIfComplete`：它重读全部判定输入并调用 `evaluateApprovalSet`，未齐返回 `not_complete`，齐了就执行（canon D03 要求重读，不信任调用方的中间结果）。没有 "Execute" 按钮、没有 action、没有 scheduler 中转、没有客户端重试执行的入口。`unchanged` 时也做集合判定：任何一次成功返回的 approve 之后，若集合已齐则执行必已发生（G10）。`executeIfComplete` 写成事务内 helper（12 §12.19），自带当前性断言（X1），可被未来 internal mutation 复用（review r07 的"守卫原样复用"由重读 + 断言实现）。
- **理由**：消除"齐了但还没执行"的中间态（G5）；审批与执行同生共死——执行任一步抛错，本次审批也回滚，用户收到错误，状态不变，可安全重试。
- **否决**：①客户端在齐后调 `execute`（多一个状态、需要有人点、窗口期内约束可能变）；②`runAfter(0, internal.executions.execute)`（中间态仍在，执行 mutation 必须重做全部守卫，失败后无人收到错误）；③`humanRequests.answer` 带 `alsoApprove`（把"取舍"与"签字"两个动作合并，违背"一次点击一个决定"）。
- **退路**：若第二场景的执行计划逼近事务限额（V9 待验证），把 `executeIfComplete` 挂到 internal mutation 上改为调度，守卫原样复用；届时必须新增"已齐待执行"派生态并写进 04。
- **不变量**：E1、E11。
