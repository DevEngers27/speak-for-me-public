# 专题深潜：Convex 上的原子幂等执行（part 3/4）：并发与重试反例

> 记号：T1、T2 是两个 mutation 事务；"→ 冲突"指 OCC 检测到读写集冲突，后提交者回滚并由 Convex 自动重试（inputs/04 §1.3）。P = 当前提案 v3（cv=5），C/Pr/F = customer/provider/finance。每行给出：交错、本设计的结果、依赖的机制、缺了这个机制会怎样。

## 3.1 反例表

| # | 场景与交错 | 本设计的结果 | 依赖的机制 | 缺了会怎样 |
| --- | --- | --- | --- | --- |
| C1 | **同一人双击 approve，串行到达**：T1 插 seq1 提交；T2 读到最新 = approve | T2 不写，返回 `recorded{changed:false}`（若 T1 已执行则 `executed{alreadyExecuted:true}`） | D2 "相同则不写" | 追加两行 approve；计数式判定会提前算齐 |
| C2 | **同一人双击，并发**：T1、T2 都读到 `by_proposalId` 区间里没有本人的行，都准备插 seq1 | T1 先提交；T2 读过的区间被 T1 写入 → 冲突 → 重试时读到 seq1 → 不写 | OCC + 整区间读 | 两行 seq1，E2 被破坏，`latestDecisionsByUser` 无法定序 |
| C3 | **两个审批人同时投最后两票**：C 已批；Pr 的 T1 与 F 的 T2 并发，各自读到"对方还没批" | 若无冲突检测：两边都返回"未齐"，执行永远丢失（G5）。本设计：T1 插入落在 T2 读过的 `by_proposalId` 区间 → T2 冲突重试 → 重试时看到 Pr 的 approve → 集合齐 → T2 执行。结果恰好一次执行，执行者是 F | 可串行化 + 第 6 步读**整个**提案的审批区间 | 丢失执行，或（若用"先判定后写"的两步 API）双方各执行一次 |
| C4 | **写偏斜陷阱（错误设计示例）**：完成判定改为读 `proposal.approvedRoles` 冗余字段、或只按本人键查询再信任前端传来的"已批角色" | 两个事务读写的文档不相交 → 不冲突 → 都看到"差一票"→ 都不执行 | ——（这是要禁止的写法） | 禁止任何不读 approvals 区间的完成判定；代码审查清单与 part4 的模型测试覆盖 |
| C5 | **updateBudget 与最后一票并发**：F 把预算 5000→4800（T1：patch budgets、bump room.cv）；C 投最后一票（T2：读 room、budgets、commitments） | 串行序 A（T2 先）：执行成功，committed=4900；随后 T1 读 committed 发现 4800<4900 → `BUDGET_BELOW_COMMITTED` → needs_input（09）。序 B（T1 先）：T2 冲突重试 → `expectedConstraintsVersion` 不再相等 → `CONSTRAINTS_CHANGED`，不写审批 | 两边都读写 `rooms`；D4 在执行事务内重算 | 在旧约束上执行（G2），或"审批已记录、版本已过期"的悬空状态 |
| C6 | **撤回与最后一票并发**：Pr 改为 reject（T1），F 投最后一票（T2） | 序 A（T1 先）：run → negotiating；T2 重试 → `RUN_NOT_AWAITING_APPROVAL`。序 B（T2 先）：已执行；T1 → `PROPOSAL_ALREADY_EXECUTED`。不存在"已执行但 Pr 的最新决定是 reject"的状态 | run 文档是共同读写点 | 执行了一个已被撤回签字的方案（核心 3） |
| C7 | **网络重发**：客户端在 T 提交后、收到响应前断线，重连后重发同一请求 | Convex 客户端重发在途 mutation，后端去重（inputs/04 §1.11）；即使去重失效，重发也等价于 C1 | 平台去重 + D2/D6 业务幂等 | 依赖单层保护；业务幂等是兜底 |
| C8 | **用户手动重试**：收到网络错误后再点一次（新的一次调用） | 等价于 C1/C16，返回 `recorded{changed:false}` 或 `executed{alreadyExecuted:true}` | 服务端派生 operationId，客户端不传幂等键 | 客户端每次生成新 uuid → 查重失效（F08.4） |
| C9 | **OCC 重试让 handler 跑多次** | handler 无外部副作用（mutation 不能 fetch）；`Date.now()` 每次可能不同但只写进本次提交的行 | mutation 确定性约束 | 若在 mutation 里发通知会重复发送；通知只能在提交后由调度的 action 发送 |
| C10 | **action 迟到写回（回合）**：run R 在 negotiating 时调度了 turn k；turn k 的 action 还在调 Claude，期间另一回合产出 v3、run → pending_approval，甚至已执行；turn k 返回后调 `completeTurn(R, k)` | `completeTurn` 的持久化守卫（F04.2：`room.currentRunId === runId`、`run.nextTurnSeq === turnSeq`、`room.constraintsVersion === run.constraintsVersionAtStart`）+ 本专题要求的补充守卫 `run.status === 'negotiating'` → 写 `turn_rejected_stale`、丢弃结果；不触碰 approvals/proposals | 进入 pending_approval 时 `nextTurnSeq` 已前进；两组守卫分离 | 迟到结果插入 v4、改 `currentProposalId` → v3 的审批被作废（不会错执行，但人的签字白费）；若它还改 run.status，会把 confirmed 改回 negotiating |
| C11 | **双击 reject** | 第一次：追加 reject、run → negotiating、调度 runTurn 一次。第二次：run 不在 pending_approval → `RUN_NOT_AWAITING_APPROVAL`，前端视为已处理 | 第 8 步只在 changed 时迁移；守卫 | 调度两个 runTurn，回合序号竞争（由 10 的 turnSeq 守卫兜底，但浪费一次模型调用） |
| C12 | **执行中途抛错**（planExecution 的 bug、限额超出） | 整个事务回滚，包括最后一票；用户看到错误；修复后重点 approve 即可 | D1 同生共死 | "审批已记录但执行丢失"，需要恢复任务 |
| C13 | **成员替换**：F 已批，之后 finance 角色换成 F'（07 的流程） | 判定按当前成员取 holder，F 的 approve 不再算；需要 F' 批准 | `evaluateApprovalSet` 读当前 members | 已离开的人的签字被用于执行 |
| C14 | **一人两角色**（成员唯一性被破坏） | `holders.length !== 1` 或 `usedUsers` 重复 → 不算齐 | 集合判定要求不同 userId | 一个人凑齐两票（I7） |
| C15 | **旧页面上的 approve**：用户页面停在 cv=5（`expectedConstraintsVersion=5`），cv 已变为 6 且 v3 仍合规 | `CONSTRAINTS_CHANGED`，不写；实时查询刷新后用户看到新约束下的评估，再以 cv=6 批准 | `expectedConstraintsVersion` 守卫 | 用户对没看过的约束版本"签了字"（核心 3） |
| C16 | **执行后其他人再点 approve**（实时订阅尚未刷新） | `executed{alreadyExecuted:true}`，不写 | D6 快速路径在守卫之前 | 报 `RUN_NOT_AWAITING_APPROVAL` 吓到用户（不危险但体验差） |
| C17 | **执行后 reject** | `PROPOSAL_ALREADY_EXECUTED` | D6 | 已执行记录被"撤回"，与核心 6 冲突 |
| C18 | **预算恰好等于余量**：committed 4000 + 800 = 4800 | 可执行（`<=`） | `checkBudget` | 边界错一分 |
| C19 | **seed/reset 与执行并发** | reset（15）必须先 patch 房间（`status: 'closed'` 或 bump cv），使在途 decide 冲突并在重试时失败；reset 只删 `simulated` 演示数据 | 共同读写 rooms | 执行写到正被删除的房间，留下孤儿记录 |
| C20 | **热点冲突持续**：三人 + 回合同时写同一 room/run | 冲突只导致重试；重试耗尽时客户端收到错误（次数与形态待验证），用户再点等价于 C8 | 业务幂等 | — |
| C21 | **看门狗迟到**：10 的 watchdog 针对一个旧回合在 pending_approval 期间触发 | watchdog 走与 completeTurn 相同的持久化守卫；run 不在 negotiating 时只把该 turn 标 stale，不改 run | 守卫分组 | watchdog 把 pending_approval 的 run 改成 failed，审批被打断 |
| C22 | **预算上调**（对当前方案有利） | 同样 bump cv，旧审批派生为 stale；v3 仍合规 → 保留，三方对同一 proposalId 重新批准（D11） | 规则统一：所有硬约束变化都 bump（F09.1） | 若"有利变更不 bump"，就需要逐条判断哪些变更不影响已批内容，规则复杂且易错。代价：多一轮审批（列入 18 开放问题） |
| C23 | **同一提案跨版本**：v3 在 cv5 上缺 finance，bump 到 cv6 后在 cv6 上集齐 | 只计 cv6 的 approve；cv5 的行不算；执行一次，`operationId = exec:<v3>`。若某个 bug 让 v3 在 cv5 已执行，cv6 上的 approve 走快速路径返回 alreadyExecuted | 集合判定按 cv 过滤；键不含 cv | 含 cv 的键会让 v3 在 cv5、cv6 各执行一次（I5） |

## 3.2 边界与限额

- **读集大小**：一次 approve 读 1 房间 + 1 run + 1 提案 + ≤60 审批 + ≤16 成员 + 1 预算 + 全部承诺 + ≤50 目录项 + 1 简报。承诺行数 = 1 + 执行次数，单房间通常是个位数；若某个场景允许无限次修订，`getCommittedCents` 改为读"最近一次执行的 `committedAfterCents` + 之后的行"之前，先在 17 重新评估（不要提前做）。
- **写集大小**：1 审批 + 1 事件 + 1 execution + 1 变更单 + 1 承诺 + ≤50 任务 + 2 patch + 1 事件 ≈ 58 次写。远低于常见事务限额（具体数值待验证，可用 `ctx.meta.getTransactionMetrics()` 在测试中打印实际用量）。
- **审批切换上限**：`MAX_DECISIONS_PER_PROPOSAL = 60`，既防滥用也保证 `take(61)` 有界。
- **金额**：`assertCents` 在 `getCommittedCents` 求和后与计划金额上再断言一次（安全整数、0 ≤ n ≤ 上限）。
- **时间**：`decidedAt`/`executedAt` 用 `Date.now()`，只用于展示；任何排序都不依赖它（审批用 seq，事件全序见 03 的 commitTs 决定）。
- **可见性**：`executions.committedBeforeCents / totalBudgetCents` 只在 customer/finance 的结果查询中返回；provider 的结果视图只含变更单条款与本人任务（F07.1 文案陷阱）。
- **执行边界**（F08.6、核心 7）：执行只写内部记录。若将来需要通知或外部集成，在执行事务内 `runAfter(0, internal.notify.*)`，该 action 至多一次、自身幂等（以 operationId 为外部幂等键），失败不回滚执行。

## 3.3 明确不保证的事

- 不保证"每个人的点击都产生一条记录"：相同决定的重复点击被吞掉（这是设计目标）。
- 不保证执行者是谁：并发的最后两票中由哪一票触发执行取决于提交顺序；`executions.executedBy` 如实记录。
- 不保证跨房间的预算一致：v1 一房间一预算（F02.4 已知限制）。多个房间共享一个预算时，必须把预算行与承诺台账移到共享实体上，执行事务读它即可沿用同一套论证。
