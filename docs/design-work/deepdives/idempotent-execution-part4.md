# 专题深潜：Convex 上的原子幂等执行（part 4/4）：测试、接口、待验证

## 4.1 convex-test 能证明什么、不能证明什么

| 能证明（确定性，进 CI） | 不能证明（必须在真实部署上验证） |
| --- | --- |
| 单个事务内的全部逻辑：守卫、错误码、集合判定、upsert 语义、计划派生、事件写入与否 | OCC 冲突检测本身：两个事务的读写集冲突时后提交者确实回滚并重试（inputs/04 §1.12：convex-test 串行执行，不模拟并发——待验证） |
| 串行重复调用的幂等：双击（串行到达）、执行后再点、执行后 reject | **索引区间读**是否进入读集、并发插入落入该区间是否触发冲突（C2/C3 的核心，inputs/04 §1.6 标为推论/待验证） |
| 任意**串行顺序**下的不变量（模型测试：随机生成 approve/reject/updateBudget/迟到回合/看门狗序列，每步后跑 `checkExecutionInvariants`） | 持续冲突时的重试次数、最终报错形态、延迟（C20） |
| 抛错后的回滚（"最后一票 + 计划失败"不留审批）——前提是 convex-test 实现了 mutation 失败回滚（待验证；若未实现，该用例只能在真实部署上跑） | 客户端断线重发的后端去重（C7） |
| 披露：provider 得不到 reasonCodes；非成员与不存在同码 | 事务限额与真实的读写量（可用 `ctx.meta.getTransactionMetrics()` 在 dev 部署打印） |
| `Promise.all` 发起的多个 mutation 结果——**只能作为串行证据记录**，不能写成"并发测试通过"（F08.5） | 默认运行时与 `"use node"` 的差异（本专题不涉及 action，影响小） |

**论证链（D10）**：①模型测试证明"任意串行顺序下 G1–G7 成立"；②Convex 承诺 mutation 可串行化；③真实部署上的并发冒烟（§4.2）检验②在本应用的读写形状（尤其区间读）下确实成立。三者合起来才是"并发下不重复执行"的证据。缺③时，16 的测试报告必须写明"并发未验证"。

模型测试的粒度：每个 mutation 是一个原子步。action 不是原子的，所以回合 action 被建模为它最终调用的 `completeTurn` mutation（可以在任意时刻、以旧 turnSeq 到达），这正好覆盖"action 迟到写回"。

## 4.2 真实部署上的并发冒烟（`race.sh`）

- 环境：独立 dev 部署（15 的环境分离），`ENABLE_TEST_FUNCTIONS=1`。`convex/testing.ts` 的每个函数第一行检查该变量，prod 部署上该变量不存在，函数直接抛错；CI 断言 prod 部署 env 中没有它。
- 入口：`testing:decideAs`（internalMutation，参数带 `userId`，内部调用 `decideCore`，与公共 `decide` 共用全部鉴权后逻辑）。用它而不是公共 `decide` 的原因：并发脚本不必持有三个真实 Clerk 会话。另在预发布环境跑一次三浏览器会话快速双击的端到端用例，覆盖公共入口与 Clerk（AC-G5、AC-11）。
- 场景：C3 最后两票并发、C1/C2 同一人 10 连发、C5 预算与最后一票并发、C6 撤回与最后一票并发；每个场景 30 次以上，各用独立房间。
- 判据：`checkExecutionInvariants` 恒为空；C3/C1 每个房间恰好 1 条 execution、1 条 change_order 承诺、3 条任务；C5 的结果只出现两种合法终态；C6 不出现"已执行且撤回者最新决定为 reject"。
- 证据纪律（AC-09）：记录部署名、commit、TRIALS、结果分布、失败样本的 requestId；保留失败记录，不只报通过。

## 4.3 `checkExecutionInvariants(roomId)`（internalQuery，测试与运维共用）

1. 每个 `status === 'executed'` 的提案恰好有 1 条 execution；没有 execution 指向非 executed 的提案（E1）。
2. 每条 execution 恰好 1 张变更单、恰好 1 条 `kind: 'change_order'` 且 `operationId` 相同的承诺，金额等于 `execution.amountCents`；任务数等于按 `planVersion` 重算的计划任务数。
3. `operationId` 在 executions 与 commitments 中各不重复；每条 change_order 承诺都有 execution。
4. 每个 (proposalId, userId) 的审批 `seq` 为 1..n 连续，相邻行的 (decision, constraintsVersion) 不同（E2、E3）。
5. `execution.approvalIds` 与提案 `requiredApprovals` 一一对应：每行是 approve、proposalId 相同、`constraintsVersion` 等于 `execution.constraintsVersion`、该用户在此提案上的最新行、userId 两两不同（E4）；`execution.operationId === exec:${proposalId}`。
6. `execution.committedAfterCents <= execution.totalBudgetCents`（执行时预算成立，G4）；`committedAfterCents === committedBeforeCents + amountCents`。
7. 承诺只读 `commitments`：`getCommittedCents` = baseline + 全部 change_order 承诺之和；rooms/budgets 上不存在 committed 字段（schema 层面保证）。
8. `run.status === 'confirmed'` ⇔ 该 run 有一个 executed 提案。

## 4.4 与其他专题的接口（任务书 §5 文件编号）

| 文件 | 本专题提供 | 本专题需要对方保证 |
| --- | --- | --- |
| 02-domain-model | 不变量 E1–E4（并入 I4/I5/I7）；executions 作为引擎实体；proposals 的版本字段改名 `createdAtConstraintsVersion` | I1（提案只追加，只有 status 可变）、I3（cv 只经 bumpConstraints） |
| 03-schema | `approvals`（只追加 + seq）、`executions`、`changeOrders`、`commitments`、`tasks` 的字段与索引（schema-fragment.ts）；唯一性落点表（part2 §2.1.1） | `users` 以 tokenIdentifier 为键（若 03 改用 tokenIdentifier 字符串作 userId，同步替换类型）；事件表 `appendEvent` 形状与 commitTs 决定 |
| 04-state-machines | 要求迁移 `pending_approval → confirmed`（仅 `executeIfComplete`）、`pending_approval → negotiating/needs_input`（仅 `onProposalRejected`）；审批没有独立状态，invalidated 读取时派生 | `assertTransition`；进入 `pending_approval` 时 `nextTurnSeq` 前进且不再调度回合；`completeTurn` 与 watchdog 增加守卫 `run.status === 'negotiating'`（C10、C21） |
| 05-protocol | reject 的 `reasonKey` 词表（模板化，I8） | 拒绝后重新协商时如何把 reasonKey 放进各方代理上下文 |
| 06-rules-engine | `ScenarioExecutionPlugin.validateForExecution` 与 `validateProposal` 共用规则；`checkBudget` 用 `<=` | 规则是纯函数、同输入同输出；reasonCode 词表 |
| 07-permissions-privacy | 错误码中 reasonCodes 的角色过滤点；非成员与不存在同码；结果查询中执行前后快照的投影要求 | `canSeeBudgetReasons(role)`；成员替换流程（C13）；provider 结果视图只含条款与本人任务 |
| 08-approval-execution | 本专题即其主体：D1–D10、分步时序、错误码、反例表 | — |
| 09-constraint-changes | 要求所有硬约束变更 patch `rooms.constraintsVersion`；reset 必须先 patch 房间（C19）；`updateBudget` 读 `getCommittedCents` 判断 `BUDGET_BELOW_COMMITTED` | `bumpConstraints` 单一入口；`reconcileAfterBump` 对仍合规提案保留 pending_approval、对不合规提案 supersede run（RA-R11，D11）；预算上调同样 bump（C22，列入 18） |
| 10-agent-runtime | 执行路径不使用 action 与 scheduler；reject 后的调度通过 `onProposalRejected` 在同事务 `runAfter(0, …)` | 回合持久化守卫；进入 pending_approval 后不存在可提交的在途回合 |
| 12-api | `approvals.decide`（public mutation，参数/返回/错误码）、`internal.testing.decideAs / checkExecutionInvariants / roomCounts / applyOp`（仅 dev） | 函数命名与模块归属 |
| 13-frontend | 按钮文案 "Accept terms" / "Approve budget commitment"；返回值→界面映射（part2 §2.3）；审批前展示 `planExecution` 预览 | mutation 在途时禁用按钮（体验，不是正确性依赖） |
| 14-scenario-scope-change | 场景必须提供 `requiredApprovals`、`validateForExecution`、`planExecution`、`planVersion`；标准走查数字 5000/4000/+900、降到 4800 | 任务模板、目录上限 50、`simulated` 标注规则 |
| 15-operations | `INVARIANT_VIOLATION` 与 `approve_on_unexecutable_proposal` 日志需要告警；`checkExecutionInvariants` 可作为定时巡检 | 环境分离、`ENABLE_TEST_FUNCTIONS` 只在 dev |
| 16-testing | §4.1–4.3 全部 | 测试运行器选型、convex-test 安装 |
| 17-roadmap | 已执行变更单的修订 = 新 run；跨房间共享预算的迁移路径（part3 §3.3）；大计划改为调度执行的退路（D1） | — |
| 18-decisions-open-questions | ADR：D1、D2（与 F03.7 的取舍）、D5（命中即 fail closed；operationId 改为 `exec:${proposalId}`，均偏离 F08.4）、D8、D11（采纳 RA-R11，偏离 F09.3 的 `proposal.constraintsVersion === room.constraintsVersion` 公式） | 开放问题：预算上调是否必须作废审批（C22）；执行后 reject 的产品语义 |

## 4.5 待验证清单

| # | 事项 | 本设计依赖之处 | 验证方式 |
| --- | --- | --- | --- |
| V1 | Convex mutation 提供可串行化隔离；读过的文档被并发提交修改时后提交者回滚并自动重试 | D5、D10、C3/C5/C6 | 文档确认 + race.sh |
| V2 | 索引区间读（`withIndex(...).take/collect/for await`）进入读集，并发插入落入区间会触发冲突 | D2 的 seq、C2、C3 | race.sh 的 C1/C3 场景 |
| V3 | 持续 OCC 冲突的最大重试次数与最终错误形态 | C20 的前端处理 | 构造热点压测 |
| V4 | 客户端重连重发在途 mutation 时后端去重（inputs/04 §1.11 源码注释） | C7 | 读源码 + 断网实验 |
| V5 | mutation 中 `Date.now()` 的语义（是否在一次执行内固定、重试时是否变化） | C9 仅展示用途，影响小 | 文档确认 |
| V6 | 抛出 `ConvexError` 后全部写入回滚，客户端收到 `data`；普通 `Error` 的消息在生产环境是否被隐藏 | D9、错误码设计 | dev/prod 各测一次 |
| V7 | convex-test 0.0.65：`withIdentity` 参数形状、mutation 失败是否回滚、`Promise.all` 是否串行、`t.run` 是否可直接写库 | tests.ts | 安装后读类型与源码 |
| V8 | `npx convex run` 能否调用 internal 函数并接收 JSON 位置参数 | race.sh | `npx convex run --help` |
| V9 | 单事务读写文档数/字节数限额 | §3.2 读写集估算 | limits 文档 + `getTransactionMetrics()` |
| V10 | `ctx.db.get/patch("table", id)` 新签名在 1.48 中可用于 `get`（inputs/04 §1.1 列出 get/patch/replace/delete） | decide.ts | 编译 |
| V11 | 被调度函数不带调用者身份（`onProposalRejected` 调度 runTurn 时显式传参） | 10 的接口 | 实验 |
