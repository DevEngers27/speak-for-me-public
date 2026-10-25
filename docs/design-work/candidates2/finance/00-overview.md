# 00 概览（候选设计：资金正确性与账务优先）

> 视角：把 Speak for Me 当作一个**小型账务系统**来设计。预算、承诺、变更单、基线支出、余量都有精确定义和不变式；审批是对不可变内容的签字；所有余额都是只追加台账的函数。schema、mutation 守卫和测试都从这些不变式反推。

## 1. 一句话

三方（customer / provider / finance）把私密目标交给各自的代理；代理只能在**代码枚举、价格来自已确认报价**的候选方案中挑选与表态；人对具体版本签字；签字到齐的那一个 mutation 原子地写入变更单、预算承诺和任务；任何约束变化让旧签字自然失效。

## 2. 设计原则

| # | 原则 | 落点 |
| --- | --- | --- |
| P1 | 余额不存储，只派生：`limit = 最新 budgetRevisions`，`committed = Σ commitments` | 02 §3、03 budgets、06 `ledgerBalance` |
| P2 | 金额一律整数美分，0 ≤ n ≤ `MAX_CENTS`(1e8)，没有负数分录 | 06 `assertCents`、03 横切规则 |
| P3 | 余量（headroom）永不为负：任何会让 `committed > limit` 的写入都被拒 | 08 执行守卫、09 `setBudgetLimit` 守卫 |
| P4 | 每一笔 change_order 承诺可追溯到：变更单 → 提案版本（含价格快照与 contentKey）→ 签字集合（不同 userId，同一约束版本） | 02 不变式 L4、08 §5、`budget.reconcile` |
| P5 | 审批 = 对 `(proposalId, constraintsVersion, contentKey)` 的签字；只追加，撤回也是一条分录 | 03 decisions、08 §2 |
| P6 | constraintsVersion 标识一个**完整约束快照**（预算上限、已承诺、确认简报、当前报价）；只经 `bumpConstraints` 递增 | 09 §1 |
| P7 | 模型只能选 `candidateKey`；候选的条目、价格、日期由代码从已确认数据算出 | 05 §3、06 `enumerateCandidates` |
| P8 | 硬约束由代码"规则闸门"判定，不交给任何代理（包括 finance 代理） | 05 §5、06 §4 |
| P9 | 对他方可见的一切文本由模板从结构化字段渲染；按查看者投影 | 07 §4 |
| P10 | 反对过度设计：一房一预算、无预占、无冲销、无自动修订链；都留扩展点 | 17、18 |

## 3. 任务书第 3 节 8 条核心如何保证

| 核心 | 由哪些设计点保证 |
| --- | --- |
| 1 私密委托 | 07 字段×角色矩阵；所有房间读取经 `rooms.view` 的 `projectFor(viewerRole)`，声明 `returns` 校验器；`briefDrafts/briefVersions` 只按 (roomId, 当前 userId) 读；`buildAgentContext` 显式白名单；shareableFields 逐项披露；预算数字只给买方（finance、customer），provider 只见 `FINANCE_LIMIT` 一类投影码 |
| 2 代理只建议 | 05 动作集没有 approve；`recommend_accept` 只写 agentTurns 与事件；decisions 只能由 public mutation 以人的 ctx.auth 写入；humanRequests 只能由 targetRole 的人回答 |
| 3 人批准具体版本 | decisions 绑定 `(proposalId, constraintsVersion, contentKey)`；proposals 只插入；签字完整性按当前 constraintsVersion 计算；任何约束变化（含执行后已承诺变化）都递增版本，旧签字派生为 stale |
| 4 代码负责校验 | 06 纯函数 `validateProposal / enumerateCandidates / checkSignatures / ledgerBalance`；金额由 `priceLines` 从 catalogItems 当前修订求和；模型输出只含 candidateKey 与本方 rationale；mutation 入口 `assertCents`、日期校验、角色守卫 |
| 5 执行幂等且原子 | 执行在最后一次 approve 的同一 mutation 内；主守卫 `run.status==='pending_approval' && room.currentProposalId===proposalId`；辅守卫 `operationKey = exec:{proposalId}:cv{n}` 的 by_operationKey 查重；budgets 文档作为 OCC 锚点串行化所有台账写入 |
| 6 历史不可篡改 | proposals、decisions、budgetRevisions、commitments、changeOrders、briefVersions、catalogItems（修订）、constraintChanges、events 全部只追加；可变字段仅限状态指针（run.status、proposal.status、request.status、task.status）且都经迁移表 |
| 7 执行边界 | 执行只写 changeOrders / commitments / tasks 三张内部表；没有任何出站集成；UI 文案 "Internal record only — no payment or contract is created" |
| 8 不伪造 | 每张业务表有 `simulated: boolean`；seed 写的期初承诺、报价、简报均为 true，界面显示 "Simulated" 徽章；stub 代理回合 `simulated: true`；无可行解时代码生成 humanRequest，不让模型编造一致意见 |

## 4. 术语表

| 术语 | 英文标识 | 定义 |
| --- | --- | --- |
| 预算上限 | `limitCents` | 最新一条 `budgetRevisions.limitCents` |
| 已承诺 | `committedCents` | 本预算全部 `commitments.amountCents` 之和 |
| 余量 | `headroomCents` | `limitCents - committedCents`，恒 ≥ 0 |
| 期初承诺（基线支出） | `opening_balance` commitment | 房间建立前已发生的承诺，房间 setup 阶段由 finance 录入一次（seed 中标 simulated） |
| 变更金额 | `proposal.amountCents` | 提案条目价格快照与费用之和；本次变更的增量 |
| 批准后已承诺 | `committedAfterCents` | `committedCents + amountCents`，只给买方显示 |
| 缺口 | `shortfallCents` | `max(0, amountCents - headroomCents)`，只给买方显示 |
| 报价目录 | `catalogItems` | provider 确认的条目修订（价格、工期、加急工期、有效期） |
| 候选 | `candidate` | 代码枚举出的完整方案（条目、交付选项、金额、日期），带 `candidateKey` |
| 提案 | `proposal` | 某个候选在某轮被提出后的不可变记录 |
| 签字 | `decision` | 人对提案的 approve / reject / withdraw 分录 |
| 签字类型 | `signatureKind` | `terms`（customer、provider）或 `budget`（finance） |
| 约束版本 | `constraintsVersion` | 房间级计数，标识完整约束快照 |
| 变更单 | `changeOrder` | 一次执行的记录；与 1 条承诺、N 条任务互相引用 |
| 执行键 | `operationKey` | `exec:{proposalId}:cv{constraintsVersion}` |
| 规则闸门 | rule gate | 提案落库前后由代码做的硬约束判定 |
| 人工请求 | `humanRequest` | 代码生成、指向具体角色的问题与选项 |

## 5. 与原方案的主要差异（详见 18 ADR）

1. 预算与已承诺从 rooms 移出，变成只追加的两本账（`budgetRevisions`、`commitments`），余额全派生（ADR-01）。
2. 不允许把预算上限降到已承诺以下（`BUDGET_BELOW_COMMITTED` 直接拒绝），而非进入 needs_input（ADR-04）。
3. 执行也递增 constraintsVersion（cause `commitment_recorded`），使版本号覆盖"已承诺"这一约束（ADR-05）。
4. 约束变化不复制提案；当前提案在新快照下仍有效时，新 run 直接进入 `pending_approval`，各方对同一 proposalId 重新签字（ADR-06）。
5. 模型只选 `candidateKey`，连交付日期也不填（ADR-07）。
6. 签字分 terms / budget 两类，finance 签的是"预算承诺"（ADR-08）。
7. 审批单表只追加（approve/reject/withdraw），不 patch（ADR-09）。
8. provider 的候选只按公开约束过滤，买方私密约束由规则闸门逐个判定，避免一次性泄露可行集（ADR-10）。
9. 编排自建（scheduler + watchdog），不用 workflow/agent 组件（ADR-11）。

## 6. 文件索引

00 概览 · 01 产品 · 02 领域模型 · 03 schema（part1/part2）· 04 状态机 · 05 协议 · 06 规则引擎 · 07 权限隐私 · 08 审批执行（part1/part2）· 09 约束变更 · 10 代理运行时 · 11 架构 · 12 API · 13 前端 · 14 场景（part1/part2）· 15 运维 · 16 测试 · 17 路线 · 18 决策与开放问题。
