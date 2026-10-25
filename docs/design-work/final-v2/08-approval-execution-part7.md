# 08 审批与执行（part7）：8.7 并发论证、读写集、反例表、限额

## 8.7.1 论证方式

Convex mutation 是 OCC 事务：读过的文档或索引区间被并发提交修改时，后提交者回滚并自动重试（review 核实：`database.ts` 原子提交、`insights` 有 `occRetried` / `occFailedPermanently`；区间读与并发插入冲突有 `meta.ts` / `registration.ts` 源码注释佐证，仍须实测，V2）。因此**只需证明任意串行顺序下 8.11 的不变量成立**，再在真实部署上证明本应用的读写形状确实触发冲突（spikes §8 #1）。为此，影响判定的状态必须全部在同一事务里**读到**；少读一份就可能写偏斜（K4）。此外，按 03 SC-05 的房间写锁（M-ROOM），任何写本房间业务状态的 mutation 都先经 `openRoomTx` 把 `rooms.writeSeq + 1`：同房间的两个写事务因此必然在 `rooms` 文档上冲突，正确性不再押在"区间读进入读集"（V2）上；区间读保留为第二个冲突点，并仍在 L2 实测。

## 8.7.2 最后一票事务的读集与写集

| 读（全部进入读集） | 写 |
| --- | --- |
| `rooms[roomId]`；`members.by_room_user`（调用者）与 `by_room_role`（每个必需角色 `take(2)`）；`proposals[proposalId]`；`runs[room.currentRunId]`；`approvals.by_proposal_user` 前缀 `proposalId` 的**整个区间**；`loadRuleInput`：finance / customer 最新简报（按版本倒序 `first()`）、本房 `catalogItems` 区间、`ledgerEntries.by_room_kind` 前缀 `roomId` 的整个区间；`executions.by_room`、`executions.by_executionKey`（空区间读）；本房 open `humanRequests` 区间；跟进房间时前序 `changeOrders.by_execution` | `approvals`（insert）；`events`（`approval_recorded`、`room_executed`）；`executions`、`ledgerEntries(commit)`、`changeOrders`、`tasks` × N（insert）；`rooms.writeSeq`（M-ROOM）；`proposals` / `runs` / `rooms` 的 `status`，`rooms.executionId` / `executedAt`（patch）；防御性 `humanRequests.status`（审批事务不写 `rooms.localDate`：规则读已推进的 `localDate`，就地滚动已在 A12 否决） |

会与之冲突的并发写者：`constraints.bump`（写 `rooms`）；`budget.setCap` / `briefs.confirm`（插入新简报版本落入简报区间，并写 `rooms`）；`catalog.confirm` / `catalog.retire`（插入目录行，写 `rooms`）；另一个 `approvals.record`（插入落入审批区间）；`runs.requestRenegotiation` / `runs.cancel` / `rooms.close`（写 `runs` / `rooms`）；`clock.rollLocalDate`（写 `rooms.localDate`，良性）；`seed.reset`（dev，先 patch 房间）。迟到的 `turns.complete` / `agents.watchdog` 只写 `attempts` / `turns` / `events`，不在审批事务读集内——它们由 G1 自行拒收，与审批不冲突也不需要冲突。非最后一票的 approve / withdraw 不写 `runs`，但经 M-ROOM 写 `rooms.writeSeq`，所以与最后一票在 `rooms` 上确定冲突；审批区间读是第二道冲突面（K2、K3、K24）。两者都要在 L2 探针里观察到重试证据（part9 §8.9.4）。

## 8.7.3 反例表

编号 K 为本章反例（与 canon 的冲突编号 C1–C42 无关）。记号：T1、T2 为两个 mutation 事务；"→ 冲突"指 OCC 让后提交者回滚重试。P = 当前提案（fixture 中 v1 $900 或 v2 $800），C / Pr / F = customer / provider / finance。

| # | 场景与交错 | 本设计的结果 | 依赖的机制 | 缺了会怎样 |
| --- | --- | --- | --- | --- |
| K1 | 同一人双击 approve，串行到达 | 第二次 `unchanged`（若第一次已完成执行则 `executed{alreadyExecuted:true}`） | A2 去重；S3 快速路径 | 追加两行 approve；计数式判定提前算齐 |
| K2 | 同一人双击 approve，并发：T1、T2 都读到区间内无本人行 | T1 提交；T2 读过的区间被写入 → 冲突 → 重试读到 seq 1 → `unchanged` | M-ROOM（`rooms.writeSeq`）+ 整区间读 + OCC（V2） | 两行 seq 1，E2 破坏，当前决定无法定序 |
| K3 | C 已批；Pr（T1）与 F（T2）并发投最后两票，各自读到"对方未批" | T1 的插入落在 T2 读过的区间 → T2 冲突重试 → 看到 Pr 的 approve → 集合齐 → T2 执行；恰一次执行，`executedByUserId` 为 F | 可串行化 + M-ROOM + 整区间读（S9） | 丢失执行（G5），或两步 API 下双方各执行一次 |
| K4 | **禁止的写法**：完成判定读冗余字段 `proposal.approvedRoles`，或只读本人行再信任客户端传来的"已批角色" | 两事务读写集不相交 → 不冲突 → 都看到差一票 → 都不执行 | ——（代码审查清单 + 模型测试禁止） | 永久丢执行 |
| K5 | F 调 `budget.setCap(480_000)`（T1）与 C 的最后一票（T2，P = v1 $900，committed 400_000）并发 | 序 A（T2 先）：执行，room `executed`；T1 重试 → `run.invalid_state`（房间终态，A9）。序 B（T1 先）：cv+1，v1 `budget.over` → 旧 run `superseded`、v1 `stale`、新 run `negotiating`；T2 重试 → S6 `approval.not_current`（若预检保留同提案则 S8 `approval.stale`） | 两边都读写 `rooms`；S11 在执行事务内重算 | 在旧约束上执行（G2），或"审批已记录、版本已过期"的悬空态 |
| K6 | Pr reject（T1）与 F 最后一票（T2）并发 | 序 A：v `rejected`、run `negotiating` → T2 重试 S6 `approval.not_current`。序 B：已执行 → T1 重试 S3 `approval.already_executed`。不存在"已执行但 Pr 当前决定为 reject" | run 与审批区间是共同读写点 | 执行一个已被拒绝的方案（核心 3） |
| K7 | 网络重发：提交后、响应前断线，重连重发同一请求 | Convex 客户端重发在途 mutation（源码证实），后端去重为推论（V4）；即使未去重也等价于 K1 | 平台 + 业务幂等 | 依赖单层保护 |
| K8 | 用户收到网络错误后手动再点（新调用） | 等价于 K1 / K16 | 服务端派生 `executionKey`，客户端无幂等键 | 客户端 uuid → 查重失效（spikes B2） |
| K9 | OCC 重试让 handler 跑多次 | 无外部副作用；`Date.now()` 每次可能不同但只写进最终提交的行 | mutation 确定性（G8） | 若事务内发通知会重复发送 |
| K10 | 迟到回合写回：run 已 `pending_approval` 或 `executed` 时某 attempt 的 action 返回 | `turns.complete` G1 失败 → attempt `stale`、用量照记、`runs.reconcile` 对非 `negotiating` run 为空操作；不触碰 approvals / proposals | D07 两组守卫分离 | 迟到结果插入新提案、改 `currentProposalId`，人的签字白费或 run 被改回 `negotiating` |
| K11 | 双击 reject | 第一次：v `rejected`、run → `negotiating`、调度一个回合；第二次 S6 `approval.not_current`（前端视为已处理） | 守卫 + reject 只在写入新行时迁移 | 调度两个回合，浪费调用 |
| K12 | 执行中途抛错（计划漂移、超限、bug） | 整个事务回滚，包括最后一票；用户看到错误；修复后再点即可 | A6 同生共死 | 悬空态 + 需要"重试执行" |
| K13 | 成员替换（v1 不可达，D24） | 判定按当前成员取 holder，被替换者的 approve 不计 | `evaluateApprovalSet` 读当前 `members` | 已离开的人的签字被用于执行 |
| K14 | 一人两角色（唯一性被破坏） | 第二个槽 `self_conflict`，集合不齐；R7 报警 | distinct userId | 一人凑齐两票（NIST AC-5） |
| K15 | 页面停在 cv 3，房间已 cv 4 且提案被预检保留 | S8 抛 `approval.stale{4}`，不写；刷新后以 cv 4 重批 | `expected*` | 对没看过的约束签字（核心 3） |
| K16 | 执行后其他人再点 approve（订阅未刷新） | `executed{alreadyExecuted:true}`，不写 | S3 快速路径在守卫之前 | 报 `approval.not_current` 吓到用户 |
| K17 | 执行后 reject / withdraw | `approval.already_executed` | S3 | 已执行记录被"撤回"（核心 6） |
| K18 | 恰等于余量：400_000 + 80_000 = 480_000 | 可执行（`<=`） | `checkBudget`、`computeChangeOrderChain` | 边界错一分 |
| K19 | `seed.reset` 与执行并发（dev） | reset 先把房间 patch 为 `closed` 再删；在途审批重试 → `run.invalid_state`；reset 只作用于 `provenance !== 'live'` 的房间 | 共同读写 `rooms` | 执行写进正在删除的房间，留下孤儿行 |
| K20 | 热点持续冲突（三人 + 约束同时写同一房间） | 只导致重试；重试耗尽时客户端收到错误（次数与形态待验证，V3），用户再点等价于 K8 | 业务幂等 | — |
| K21 | 看门狗迟到：旧回合的 `agents.watchdog` 在 `pending_approval` 期间触发 | 走同一组持久化守卫，只把 attempt 标 `stale`，不改 run | D07 | 看门狗把待批 run 改成失败，打断审批 |
| K22 | 预算**上调**（对当前提案有利） | 同样 bump（D05）→ 新 run 预检保留同提案 → 旧审批 `stale_approve` → 三方以新 cv 重批 | 一切硬约束变化统一 bump | "有利变更不 bump"需逐条证明无关，易错；代价是多一轮审批（开放问题 O1） |
| K23 | 同一提案跨 cv：cv 3 缺 F，bump 到 cv 4 被保留，cv 4 上集齐 | 只计 cv 4 的 approve；`executionKey = exec:<P>`；cv 3 的行保留为历史 | 判定按 cv 过滤；键不含 cv | 含 cv 的键让同一提案在两个 cv 各执行一次 |
| K24 | C withdraw（T1）与 F 最后一票（T2）并发 | 两者都写 `rooms.writeSeq` 并读写审批区间 → 串行。序 A：T2 重试见 C 为 `withdrawn` → `recorded{missingRoles:['customer']}`。序 B：已执行 → T1 重试 S3 `approval.already_executed`。不存在"已执行但 C 当前为 withdraw" | M-ROOM + 区间读冲突（V2，race S5） | 执行一个签字已撤回的方案 |
| K25 | 预检保留的提案被新 run 沿用后审批 | S6 看 `run.currentProposalId`（新 run）而不看 `proposal.runId` → 可批 | `isCurrentForApproval` | 守卫按 `proposal.runId` 比较 → 永远批不了（X24） |
| K26 | C reject v1 后，F 上调上限触发 bump | 预检只看 `active` 提案 → v1（`rejected`）不复活；同 run 内 proposer 快照已剔除其 `candidateKey`；新 run 可以重新提出同样条款，但那是新版本、须全新审批 | A5；D06；04 R2 | 被拒提案被放回 `pending_approval`（inputs/07 第 47 行） |
| K27 | 跨午夜：23:59 打开审批面板，00:01（房间时区）点 approve，cron 尚未推进 `localDate` | 规则读 `room.localDate`（仍为前一日），与审批人屏幕一致 → 正常执行；cron 推进后若结论翻转（如交付日已过）→ bump → 之后以旧 cv 的 approve 抛 `approval.stale` | A12；09 §9.6.7；D22 | 用真实日期判出 `date.in_past` 而界面显示可批，approve 被纵深防御拒绝且无出口 |
| K28 | 部署了新场景版本、房间未迁移 | approve：S5 `run.invalid_state{guard:'scenario_version'}`，不写；reject / withdraw 照常记录（不跑规则，S5 跳过），reject 后 run 进 `needs_input`（04/10 的 `createTurnTx` 版本守卫）；运维按 15 迁移（`constraints.bump(cause: 'scenario_migrated')` 后重批） | 场景版本守卫只拦 approve | 在 v2 规则下执行 v1 规则下给出的签字（candidates1 判词）；或守卫拦住 reject，旧版本房间全部失去逃生口（invariants-16） |
| K29 | 客户端带错的 `expectedTermsKey`（bug 或篡改） | S8 抛 `approval.stale`，不写 | A1 | 人看到的卡片与被签条款不一致 |
| K30 | reject 时 `opsFlags.draining` 已置位 | reject 成功；run `negotiating`，`beginAttempt` 返回 `run.draining` 不建 attempt；排空结束后 `runs.reconcile` 补调度 | reject 永远可做；D17 | 排空期间无法拒绝，或 run 卡在无在途回合 |
| K31 | 绕过 `constraints.bump` 的 bug（如直接 patch 目录价）后有人 approve | S11 `approval.not_executable`，不写；`publicOpsLog('approval.not_executable')` 计数告警；运维以 `constraints.bump` 修复后 D06 正常处置 | A4 纵深防御 | 在不合规提案上记下"已批准" |
| K32 | provider 反复改一个无关条目的价格 → bump → 预检沿用同一提案（04 R2）→ 自己再批，循环数十次，企图写满审批区间、冻结所有人的决定 | 只有 provider 本人的 approve 在第 60 行后得到 `run.rate_limited`；他人的 approve 只受各自上限；任何人的 reject 只读本人最新一行，永远可写；改价本身受 12 B7 的 `price_writes` 桶约束 | 按人限额（S9）；reject 不读整区间（E14） | 全提案读上限把所有决定变成 `internal`，reject 被挡住，冻结随每次 bump 延续（invariants-01） |

## 8.7.4 边界与限额

- **读集**：1 房间 + 1 run + 1 提案 + 审批行（approve：本提案全部行，按构造 ≤ 3 × (60 + 10 + 1) = 213；withdraw：本人区间 ≤ 71 行；reject：只读本人最新一行）+ ≤ 7 成员行 + 2 份最新简报 + 本房目录区间（≤ 50 项 × 修订数，由 14 的目录上限约束）+ ≤ 2 台账行 + ≤ 2 执行行 + ≤ 1 open 请求。
- **写集**：1 审批 + 2 事件 + 1 执行 + 1 台账 + 1 变更单 + ≤ 50 任务 + 3 个状态 patch + ≤ 1 请求 patch ≈ 60 次写。远低于事务限额（research 记为 16,000 文档 / 16 MiB，待验证 V9）；dev 部署用 `(await ctx.meta.getTransactionMetrics()).documentsWritten.used` 等实测值写入 16 的证据（该方法返回 Promise）。
- **审批行上界**（按人、只限 approve）：`MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL = 60`，超过时只对该人的 approve 抛 `run.rate_limited`；每人 withdraw ≤ 10 次（`run.rate_limited`）；**reject 不读整区间、不计入任何上限**（它是唯一的逃生口，canon D02 否决的"全局决定上限"不得以读上限的形式复活：provider 每小时 6 次改价 + R2 沿用 + 自己重批，约 33 小时就能填满一个全提案上限，invariants-01）。approve 行只能来自"每次 cv 变化后重批一次"，bump 受 D12⑥ 与 07 §7.13 的 `price_writes` 桶约束，60 行意味着同一保留提案经历数十次 bump，15 对接近上限的房间告警。
- **金额**：`assertCents` 在台账求和后、链的每一步、计划金额上各断言一次；任何溢出 → `internal`（代码缺陷，不是业务失败）。
- **时间**：`decidedAt` / `executedAt` / `createdAt` 只用于展示；排序一律用 `seq`（审批）与 `(commitTs, seq)`（事件，D14）。
- **明确不保证**：不保证每次点击都产生一行（相同决定被吞掉是设计目标）；不保证执行者是谁（取决于提交顺序，`executedByUserId` 如实记录）；不保证跨房间预算一致（v1 一房一预算，共享预算列入 17）。
