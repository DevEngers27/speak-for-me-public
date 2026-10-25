# 08 审批与执行（part9）：8.9 测试清单

> 分层沿用 16（L0 纯函数 / L1 convex-test / L2 真实部署 / L3 端到端）。纯函数单测 U1–U18 见 part8 §8.8.4。convex-test 一次只跑一个函数，**不能**证明 OCC；用 `Promise.all` 发起的多个 mutation 只能记为"串行证据"，证据文件里必须写 `[serial]`（idempotent-execution part4 §4.1、spikes §1）。所有 L1 用例都受 part8 的 R1–R11 `afterEach` 约束。

## 8.9.1 能证明什么、不能证明什么

| convex-test 能证明（进 CI） | 只能在真实部署上证明（L2） |
| --- | --- |
| 单事务内的全部逻辑：守卫顺序、错误码、集合判定、去重、执行派生、事件写与不写 | OCC 冲突检测本身；**索引区间读进入读集**、并发插入落入区间时触发冲突（K2 / K3 / K24 的核心，V1 / V2） |
| 串行重复调用的幂等：双击（串行）、执行后再点、执行后 reject / withdraw | 持续冲突的重试次数与最终错误形态（V3） |
| 任意串行顺序下的不变量（模型测试） | 客户端断线重发的后端去重（V4） |
| 抛错回滚（spikes B1 已在 convex-test 证实 `ConvexError` 后三表皆空、`runAfter` 一并回滚） | 事务限额与实际读写量（`getTransactionMetrics()`，V9） |
| 披露：provider 拿不到 `params`；非成员与不存在同码 | `logLines` / `ConvexError` 在 prod 的下发形态（D16，待验证） |

## 8.9.2 convex-test 集成用例（L1，串行）

fixture 用 14 的主 fixture 经 `seed.fromFixture` 走生产写入口（D18），再由 stub 驱动跑到相应状态；cv 与提案编号直接采用 14 §10（开房 cv 1，finance 下调后 cv 2；v1 $900、v2 $800）。

| # | 用例 | 断言 |
| --- | --- | --- |
| I1 | 主线：v2 $800 在 cv 2，三方依次 approve | 第三票返回 `executed{alreadyExecuted:false}`；`executions` 1、`changeOrders` 1、`ledgerEntries(commit)` 1、`tasks` = `plannedTasks.length`；`Σ ledgerEntries = 480_000`；cv 仍为 2；room / run / 提案均 `executed` |
| I2 | 重复 approve | 执行前第二次 `unchanged` 且事件数不变；执行后任一人再 approve → `executed{alreadyExecuted:true}`，所有表行数不变 |
| I3 | 执行后 reject、withdraw | 均为 `approval.already_executed`；行数不变 |
| I4 | 陈旧页面：保留分支（I5）中 v1 已在 cv 2 被新 run 沿用，以 `expectedConstraintsVersion = 1` approve | 抛 `approval.stale`（`params.currentConstraintsVersion === 2`）；`approvals` 行数不变；以错的 `expectedTermsKey` 同样 `approval.stale` |
| I5 | 保留分支：v1 $900 时 C、Pr 已在 cv 1 批准，F `budget.setCap(495_000)` | cv 2；旧 run `superseded`、新 run `pending_approval` 且 `currentProposalId` 为同一 v1；C、Pr 槽位 `stale_approve`；三方以 cv 2 重批后执行一次，`execution.constraintsVersion === 2`，cv 1 的两行保留 |
| I6 | 失效分支：同上但 `setCap(480_000)` | v1 `stale`、新 run `negotiating`；对 v1 approve → `approval.not_current`；不写行 |
| I7 | 纵深防御（故障注入，`expectFindings`）：`t.run` 绕过 `catalog.confirm` 直接改 `sso_login` 价格 | provider approve → `error.data` 恰为 `{ code: 'approval.not_executable' }`（无 `params`）；finance approve → `params.reasonCodes` 含 `version.stale_source` 或 `amount.claim_mismatch`；不写行 |
| I8 | reject（`roundNo < maxRounds`） | 提案 `rejected`；run `negotiating`、`roundNo + 1`；恰一个 provider propose 回合已调度，其上下文含 "v1 rejected"，**不含**拒绝者角色、`reasonKey`、`note`（05 §5.12）；customer 时间线可见 `reasonKey`；其 `candidateKey` 不在新 `candidateSnapshot`；第二次 reject → `approval.not_current` |
| I9 | reject 在 `roundNo === maxRounds` | run `needs_input`；恰一个 open `rounds_exhausted` 请求给 customer；选项不含被拒 `candidateKey` |
| I10 | 被拒不复活：reject v1 后 F 上调上限 | bump 后新 run 不处于 `pending_approval` 沿用 v1；v1 仍 `rejected` |
| I11 | withdraw | approve → withdraw → 槽位 `withdrawn`、集合不齐；再 withdraw → `unchanged`；无 approve 时 withdraw → `unchanged`（不写行）；第 11 次 withdraw → `run.rate_limited` |
| I12 | 执行失败回滚（故障注入：fixture 目录给某 item 51 个任务模板） | 最后一票 → `internal`；`approvals` 行数仍为 2；无执行、无台账 commit |
| I13 | 成员唯一性被破坏（故障注入：`t.run` 插入第二个 finance 成员） | 集合永不 `complete`（`vacant`）；不执行；`expectFindings` 只允许预期码 |
| I14 | 执行后房间终态 | `budget.setCap` / `briefs.confirm` / `runs.start` → `run.invalid_state`；`tasks.markDone` 被指派人成功、再调 `unchanged`、他人 `auth.role_forbidden` |
| I15 | 场景版本不符（测试注册表把版本改为 2） | approve → `run.invalid_state{guard:'scenario_version'}`，不写；同一状态下 withdraw 照常（`unchanged` 或写行），reject 成功（提案 `rejected`），随后 run 按 04/10 进入 `needs_input`、不建回合（invariants-16） |
| I16 | 跨午夜（假时钟）：房间 `localDate` 为前一天，approve 时已过本地午夜 | cron 未跑时 approve 以 `room.localDate`（前一日）判定并执行；另一用例先跑 `clock.rollLocalDate`，使交付日恰为前一天的待批提案结论翻转 → cv + 1、新 run 已建，之后以旧 cv approve → `approval.stale`、不写行 |
| I17 | provenance | seed 房间执行 → 四类产物全部 `seeded`；live 房间 stub 提案 → `stub` |
| I18 | 事件 | `approval_recorded` payload 字段白名单（无 `note`）；`room_executed` payload 只含 03 §3.11 白名单（`amountCents` 为公开目录价之和），无 baseline / committed / cap / headroom；`timeline.page` 对 provider 不出现 baseline / committed / cap |
| I19 | 金丝雀（16 harness）：canary 变体（奇数美分 481_237 等）执行后，以 provider 身份扫描 `rooms.view`、`proposals.get`、`executions.forRoom`、时间线、错误 `data` | 多写法金额正则零命中 |
| I20 | 所见即所写 | 执行前 `rooms.view.recordsPreview`（finance 视角）与执行后的 `changeOrders` / `tasks` / 台账增量逐字段相等（除 id 与时间） |
| I21 | `proposals.get` 的 `decisions` 与 `executions.forRoom` | `note` 只在本人行、`reasonKey` 按受众（`room` 的键全员可见，`buyers` 的键对 provider 为 `null`）、DTO 无 `userId`；provider 的 `amountChain` 为 `null`；非成员 → `null` |
| I22 | reject 永远可写（invariants-01、CE-056）：经循环"改价 → bump → 预检沿用 → provider 重批"（假时钟跨过 `price_writes` 桶）让 provider 在同一提案上积满 60 行 approve；另让 customer 交替 approve / withdraw 到第 11 次 withdraw | provider 第 61 次 approve → `run.rate_limited`；customer 第 11 次 withdraw → `run.rate_limited`；finance 的 approve 不受影响；此后任一方 reject 成功、提案 `rejected`；全程无 `internal` |
| I23 | 人类拒绝理由的受众（privacy-07）：finance 以 `over_our_limit` reject v1 | customer / finance 的 `rooms.view`、`proposals.get`、时间线可见该键与 "over our limit"；provider 的上述各面与 `approval_recorded` 事件 payload 都不含该键及其文案（只见 "Finance rejected v1."）；provider 代理下一回合上下文只有 "v1 rejected"；对照：customer 以 `scope_insufficient` reject 时 provider 可见理由 |

## 8.9.3 模型测试（L1，随机串行调度）

- 200 个种子 × 每个 25 步，操作集：每个角色的 approve / reject / withdraw（`expected*` 随机取当前值或陈旧值）、`budget.setCap ∈ {500_000, 495_000, 480_000, 479_999}`、`catalog.confirm` 改价、假时钟跨一天、旧 attempt 的迟到 `turns.complete` 与 `agents.watchdog`、creator 的 `runs.requestRenegotiation`、`tasks.markDone`。
- **每一步之后**跑 R1–R11；同时断言该操作要么成功，要么只抛出它的**允许错误集**中的码（例：approve 允许 `approval.not_current` / `approval.already_executed` / `auth.role_forbidden` / `run.invalid_state` / `run.rate_limited` / `approval.stale`）。出现 `internal` 或非 `ConvexError` → 用例失败（review r10：禁止 `.catch(() => undefined)` 吞掉一切错误）。reject 的允许错误集不含 `run.rate_limited`、`run.invalid_state{guard:'scenario_version'}` 与 `internal`（E14）。
- 活性：R11(e)。
- 回合 action 建模为它最终调用的 `turns.complete` / `turns.fail` mutation，可在任意时刻以旧 `attemptId` 到达（覆盖 K10 / K21）。

## 8.9.4 真实部署并发探针（L2，spikes §8 #1）

- **装置**：dev 部署；单个 Node 进程内建 N 个 `ConvexHttpClient`，各自 `setAdminAuth(adminKey, identity)` 扮演 fixture 的三位用户，调用**公开** `api.approvals.record`（走真实鉴权路径，review r05；不设 `testing:decideAs`）；起跑栅栏后 `Promise.all` 发出。每个请求记录客户端发出 / 收到时间，计算 `maxOverlap`；试验窗口内抓 `npx convex insights` 的 `occRetried`。
- **场景**（每个 ≥ 30 次，每次独立房间）：S1 最后两票并发（K3）；S2 同一人 10 连发最后一票（K1 / K2）；S3 `budget.setCap(480_000)` 与最后一票（K5，v1 $900）；S4 reject 与最后一票（K6）；S5 withdraw 与最后一票（K24）；S6 同一人 10 连发非最后一票（K2）。
- **判据**：每次试验后 R1–R11 为空；S1 / S2 每房恰 1 执行、1 commit、1 变更单、任务数 = `plannedTasks.length`；S6 该用户恰 1 行；S3 只出现两种合法终态；S4 / S5 不出现"已执行且撤回者 / 拒绝者当前为 withdraw / reject"。
- **证据纪律**：记录部署名、commit、TRIALS、结果分布、`maxOverlap` 分布、`occRetried`、失败样本的 `requestId`；`maxOverlap ≥ 2` 的试验占比 < 90% 或 `occRetried === 0` 时结论只能写"未观察到并发"，不得写"并发通过"。

## 8.9.5 结构测试（CI）与端到端（L3）

- **结构**：part3 §8.3.5 的写入口白名单；`approvals` / `executions` / `changeOrders` / `ledgerEntries` 零 patch；`convex/model/executions.ts` 不 import `constraints`、action、`fetch`、外部 SDK、不调用 `ctx.scheduler`；调用图：`executeIfComplete` 只被 `approvals.ts` 调用（TC-AUTH-06）；internal 函数与 `agents/*` 不 import 审批写入 helper（核心 2）；schema 中 `rooms` / `briefs` 无 `committed*` 字段；模型输出 schema 无 `approve` 动作。
- **端到端**（三个浏览器会话）：最后一票后另两窗无需刷新同时看到 "Executed · CO-1"；finance 降上限后其余窗口同时出现 stale 横幅与 "No longer applies · approved under constraints v1"；按钮文案 "Approve v2 under constraints v2"（保留分支为 "Approve v1 under constraints v2"）；最后一位审批人看到 "Your approval completes the set — this executes now"；对最后一票快速双击只产生一条执行；agent 的 `recommend_accept` 显示在虚线框内且不计入槽位。
