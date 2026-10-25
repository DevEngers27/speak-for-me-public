# 反驳评审：Convex 上的原子幂等执行（idempotent-execution）

> 评审对象：deepdives/idempotent-execution.md、part2–4、idempotent-execution/{decide,pure,schema-fragment,tests}.ts、race.sh。
> 对照：00-brief §3 核心 3/5/6、inputs/04 §1.3–1.12、node_modules/convex 1.48.0 源码，以及 versioned-approvals、run-lifecycle、rules-engine 三个专题的代码稿。
> 结论先行：主干是对的。"最后一票与执行在同一个 mutation 里"、只追加审批加 seq、服务端派生 `exec:${proposalId}`、承诺台账作为唯一真相源，这几条都成立。最关键的平台假设（索引区间读会和并发插入冲突）这次在源码注释里找到了佐证。主要问题出在和其他专题的接缝上：采纳 RA-R11 之后，回合守卫会把 run 卡死；执行产物依赖的可变输入没有被约束版本覆盖。另外，并发冒烟脚本大概率测不出真正的并发。

## 1. 待验证声明逐条核对

| # | 声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | mutation 是 OCC，冲突时自动重试，handler 可能执行多次 | **成立**（"可串行化"这个隔离级别名称本地源码没有写，但原子性和 OCC 重试都有证据） | `convex/src/server/database.ts:190-192` 写明 mutation 内读写原子提交；`cli/insights.ts:12-17` 有 `occRetried` / `occFailedPermanently` 两类指标 |
| 2 | 索引区间读进入读集，并发插入落入区间会冲突 | **基本成立，由"推论"升级为"源码注释佐证"** | `server/meta.ts:166-172`（getSnapshotTs）说用它作上界可以"prevent conflicting with racing inserts"；`server/registration.ts:1249-1254`（useStaleSnapshot）说 append-only 表上"the only read conflicts are from concurrent appends"。两处都说明区间读会和并发插入冲突。仍建议实测（见 r05） |
| 3 | 索引没有唯一约束，`.unique()` 只是读取时的断言 | **成立** | `server/query.ts:264-282`；inputs/04 §1.6 |
| 4 | 持续冲突有重试上限，耗尽后报错 | **部分成立**：确实存在"永久 OCC 失败"；具体次数和错误形态仍待验证 | `cli/insights.ts:17`、`cli/lib/mcp/tools/insights.ts:104-113` |
| 5 | 断线重连时重发在途 mutation，后端去重 | **部分成立**："客户端会重发"已证实；"后端去重"只来自注释"safe since mutations are idempotent"的推论 | `browser/sync/request_manager.ts:205-210` |
| 6 | 抛出 ConvexError 会整体回滚，客户端能拿到 `data` | **成立**；普通 Error 的消息在生产环境是否被隐藏，本地没有证据，仍待验证 | `browser/sync/client.ts:883-889` 用 `forwardData` 构造 ConvexError；`request_manager.ts:125-131` 读 errorData |
| 7 | mutation 内 `Date.now()` 可用，每次执行可能不同 | **成立** | `server/meta.ts:174-175`："the timestamp differs on every execution … the same way Date.now() does" |
| 8 | 1.48 有 `db.get/patch("table", id)` 新签名，query 支持 `for await` | **成立** | `server/database.ts:30-45, 271-293`；`server/query.ts:186`（extends AsyncIterable） |
| 9 | `_creationTime` 是墙钟，不保证与提交顺序一致 | **成立** | `server/meta.ts:177-179` |
| 10 | convex-test 0.0.65 的行为 | **无法核对**：两个仓库都没有安装，维持待验证 | `ls node_modules` 中没有 convex-test |
| 11 | `npx convex run` 能调用 internal 函数、接收 JSON 位置参数 | **成立**；另外还支持 `--identity`（见 r05） | `cli/lib/command.ts:417-432`；`cli/lib/run.ts:41-47` 用 `setAdminAuth`；`browser/http_client.ts:166-172` 注释："allow calling internal … and acting as an identity" |
| 12 | 事务限额远高于约 58 写、约 130 读 | **方法成立，数值待验证**：`getTransactionMetrics()` 确实返回 documentsRead / documentsWritten / bytes* 等字段 | `server/meta.ts:21-33, 150` |
| 13 | mutation 内的 `runAfter(0)` 随 mutation 原子提交 | **成立**（源码注释加原子性推论） | `server/scheduler.ts:57`、`registration.ts:114` 都写"after this mutation commits" |
| 14 | 被调度的函数不带调用者身份 | **未核实**；但本设计显式传 actorUserId，不依赖这一点，风险低 | 本地没有证据 |
| 15 | bumpConstraints 是唯一写 cv 的入口；reconcile 会让不合规提案的 run 被 supersede | **结构上成立，但推不出 D4"理论上不会失败"**（见 r02） | `versioned-approvals/constraints.ts:72-150`：bumpConstraints 不导出，只能经 withConstraintChange 调用 |
| 16 | completeTurn / 看门狗拒收非 negotiating 的 run；进入 pending_approval 前 nextTurnSeq 已前进 | **实质成立**：接受集合是 `{negotiating, failed}`，pending_approval 和 confirmed 都被拒；看门狗走同一组守卫后 discardStale；nextTurnSeq 在 applyDecision 之前就 +1。但 G3 守卫与 D11 冲突（见 r01） | `run-lifecycle/state.ts:25`；`lifecycle.ts:28-38`；`mutations.ts:113-130, 177-183` |

## 2. 问题清单

### r01（high）采纳 RA-R11 后，"被拒→同 run 重谈"这条路会被回合守卫 G3 永久拒收
- **反例**：v3 在 cv5 进入 pending_approval；随后发生一次合规的 bump（cv→6，`kept_pending_approval`，run 的 `constraintsVersionAtStart` 仍是 5）；provider 在 cv6 上 reject；第 8 步调 `onProposalRejected`，实际函数是 run-lifecycle 的 `resumeRun(rejected)`，在**同一个 run** 上回到 negotiating。此后每个回合在持久化时，G3 都会因为 `room.constraintsVersion(6) !== run.constraintsVersionAtStart(5)` 被判为 stale，run 卡死，直到看门狗或次数上限把它判失败。
- **证据**：本专题 C10 引用的正是这条旧守卫；`run-lifecycle/lifecycle.ts:35-36`；versioned-approvals-part3 第 77 行（D8）已经指出这个问题，并给出新守卫 `turn.constraintsVersion === room.constraintsVersion`。
- **建议**：C10 和 §4.4 改为采用 versioned-approvals D8 的回合级守卫。或者在 `onProposalRejected` 里判断：若 `room.cv !== run.constraintsVersionAtStart`，就 supersede 当前 run，按当前 cv 起一个新 run。二选一后写进 04/10。模型测试补一个操作序列："合规 bump → reject → completeTurn"。

### r02（medium）执行产物依赖的可变输入不在约束版本覆盖范围内
- D4 说"理论上不会失败"，RA-D14 要求"所见即所写"。两者成立的前提是：`validateForExecution` 和 `planExecution` 读到的输入都会触发 bump。实际上 versioned-approvals 的 `HardProjection.catalog` 只有 `itemKey / catalogItemId / priceCents / deliveryDate`，而本专题的 `ExecutionInputs.catalog` 还读 `status`、`simulated`、`title`、`taskTemplates`。
- **反例 1**：三方看过预览后，provider 修改任务模板，不触发 bump。最后一票执行时生成的任务与预览不一致，旧审批照样计入。人批准的不再是将要写入的东西，违背核心 3 的精神。
- **反例 2**：条目 status 变化而 catalogItemId 不变（是否会这样，待 06 确认）。D4 触发 `PROPOSAL_NOT_EXECUTABLE`，此后 run 只能等有人 reject，文档没有写恢复路径。
- **建议**：让 `planExecution` 只依赖"提案快照 + 硬投影"。具体做法：提案插入时把 `plannedTasks`（或 `planHash`）冻结进提案，执行时断言一致；或者把 taskTemplates、status 并入 hardProjection。另外写明 D4 触发后由系统 supersede run，不能指望人去 reject。

### r03（medium）全局 `TOO_MANY_DECISIONS` 会让提案永久卡住，并且连 reject 也被挡住
- `take(61)` 统计的是整个提案的所有行，第 6 步对 approve、reject、withdraw 一律适用。只要一个参与方反复 approve/withdraw，或者经历多次合规 bump（每次 3 行重批），就会耗尽额度。此后任何人都无法决定，包括唯一的逃生口 reject，run 停在 pending_approval。另有差一错误：实际允许写到 61 行。
- **建议**：上限改为按人计（内存中统计本人的行数）；reject 永远放行；**整区间读保留**，C3 依赖它。

### r04（medium）三个专题各有一套"审批齐否"实现，命名也互相冲突
- 完成判定有三份：本专题 `evaluateApprovalSet`（快照存 role，判定时按当前成员解析）；versioned-approvals `summarizeApprovals`；rules-engine `evaluateExecutionReadiness`（`requiredApprovers` 快照存的是 userId，executionId 按 (proposalId, constraintsVersion) 取）。存 role 还是存 userId 会直接决定 C13（成员替换）的结果，是语义冲突，不只是名字不同。
- 名字冲突：
  - 函数：`approvals.decide` / `executeIfComplete` 对 `decideOnProposal` / `executeProposalInTx`；`onProposalRejected` 对 `resumeRun`。
  - 错误码与 reasonCode：`PROPOSAL_NOT_CURRENT` 对 `NOT_CURRENT_PROPOSAL`；`EXCEEDS_BUDGET` 对 `OVER_BUDGET`（rules-engine/codes.ts）。
  - 返回值：`recorded{changed:false}` 对 `{status:'unchanged'}`。
  - 状态与原因：`endedReason:"executed"` 对 `approved_and_executed`；`runStatusV` 缺 `cancelled`（run-lifecycle/schema.ts:16-25）。
  - 审批字段：`reasonKey` 对 `reasonCode/note/proposalVersion`。
  - 锚点：versioned-approvals 把 operationId 放在 changeOrders 上，本专题设了 executions 表。
- **建议**：由 08 统一归口。只保留一个纯函数判定，rules-engine 的 readiness 改为它的 UI 投影；明确选定"role 快照 + 当前成员"，并回改 rules-engine；用一张错误码表；"要不要 executions 锚点"记入 18。

> 续：r05–r10 与过度设计检查见 idempotent-execution-review-part2.md。
