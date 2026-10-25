# 02 · 领域模型（part2）：实体总览、被删除的概念、关系

> 分片清单见 `02-domain-model.md` 顶部。字段与索引见 03；"默认披露类"由 07 §7.9 定最终矩阵。

## 2.2 实体总览

| 实体 | 表 | 可变性 | 唯一写者（插入 / 可变字段） | 所有者与默认披露类 | 解决的问题（不要它行不行） |
| --- | --- | --- | --- | --- | --- |
| user | `users` | 仅 `displayName` 等资料 | `users.ensureViewer` | system | 把 Clerk `tokenIdentifier` 映射为内部 id；其他表只引用 `Id<"users">`，Clerk 实例迁移只改一处。不要它：tokenIdentifier 散落各表、进入 DTO |
| room | `rooms` | 指针与计数器 | `rooms.create` / `startFollowUp`；状态 `setStatus`；cv `constraints.bump`；`localDate` `clock.rollLocalDate` | room（标题、状态、cv、localDate） | 聚合根：场景版本、时区与"今天"、约束版本、当前 run、房间写锁。不要它：无处承载版本与写锁 |
| member | `members` | 无（v1 不换人） | `addMember`（`rooms.create` / `invites.accept` / `startFollowUp`） | room（角色、显示名）；userId system | 把"人"和"房间内角色"分开，角色只能由服务端授予（INV-15/16）。不要它：角色只能放在用户上，无法一人多房 |
| invite | `invites` | 状态 `open → accepted / superseded` | `invites.create`、`invites.insertLink`；`invites.accept` | creator（邮箱另对被邀请人可见） | 角色只经邀请授予；邮箱定向默认、链接 token 只存哈希（D24）。不要它：席位预建会让未认领席位持有凭据 |
| brief | `briefs` | 只追加版本 | `insertBriefVersion`（`briefs.confirm` / `budget.setCap` / `humanRequests.answer`） | self（所有者角色）；版本号与确认状态 room | 私密委托的载体与硬约束来源；确认即版本，历史可解析。不要它：约束无处版本化 |
| sharedFact | `sharedFacts` | 只追加 | `appendSharedFact`（经 `materializeDisclosures` / `sharedFacts.add` / `humanRequests.answer(disclose)`） | 行级受众 `audience ∪ {fromRole}` | 跨角色私密值的唯一披露账本，过闸门、按值所属版本判定（DM-08）。不要它：投影只能直接读他方简报 |
| catalogItem | `catalogItems` | 只追加行 | `appendCatalogRow`（`catalog.confirm` / `catalog.retire` / `startFollowUp`） | 非草稿行 room；草稿 self(provider) | 价格与工期的唯一来源（核心 4）；rush 是 `kind: modifier` 行；定价修订号 `revision` + 展示修订号 `editNo`。不要它：价格只能来自模型或插件常量 |
| ledgerEntry | `ledgerEntries` | 只追加 | `appendLedgerEntry`（`ledger.recordBaseline` / `executeIfComplete`） | roles: [finance] | 已承诺额的唯一真相（DM-07）。不要它：需要计数器，与执行漂移 |
| constraintRevision | `constraintRevisions` | 只追加 | `constraints.bump` | 版本号 room；cause 与变更角色给买方；来源 system | 回答"cv 为什么是 N、谁改的、改了哪些来源"，可重放（核心 6）。不要它：cv 只是一个没有来历的数字 |
| run | `runs` | 状态机 | `startRunTx`；`setStatus` / `advanceRun` / `beginAttempt` / 结算 | room（状态、轮次、原因）；美元与 attempt 计数 system（实时花费是他方简报长度的侧信道；creator 只在 run 终态后见整 run 汇总，03 §3.8） | 一次协商的生命周期、单活跃、上限与预留（D17）。不要它：回合与提案没有归属，取代无从表达 |
| turn | `turns` | 状态机 | `createTurnTx`；`setStatus` / `beginAttempt` / `turns.complete` | 元数据 room；候选快照与结果 self(role) | 可被守卫拒收的逻辑槽位：cv 快照 + 候选快照 + 允许动作，重试不改快照（D07/D10）。不要它：重试与守卫只能挂在 attempt 上，快照会随重试漂移 |
| attempt | `attempts` | 状态机；用量字段写一次 | `turns.beginAttempt`；`turns.complete / fail`、`agents.watchdog` | 状态 room；用量、move、错误 self(role)；requestId system | 一次计费调用 = 一行用量账本，含 stub、迟到与被拒收的调用（DM-05）。不要它：迟到结果的费用无处可记 |
| rawOutput | `rawOutputs` | 不可变，到期删除 | `turns.complete / fail`；`ops.purgeRawOutputs` | system（无任何 query） | 模型原文只存内部表、设保留期（D16）。不要它：原文会进日志或业务表 |
| proposal | `proposals` | 只有 `status` | `insertProposal`（`turns.complete` / `humanRequests.answer`）；`setStatus` | room（条款、快照、版本） | 被人批准的不可变内容（核心 3、6）。不要它：审批没有对象 |
| approval | `approvals` | 只追加 | `approvals.record` | room（角色、决定、绑定版本、reasonKey）；note self(作者) | 人对具体版本的决定（核心 2、3）。不要它：无法区分建议与批准 |
| humanRequest | `humanRequests` | 状态机 | `openHumanRequestTx`；`humanRequests.answer` / `expireDue` / bump | 存在与状态 room；kind / toRole 买方；选项 self(toRole) | 向具体的人请求取舍，恰一个出口集合（D15）。不要它：`needs_input` 没有收件人，死路 |
| execution | `executions` | 只追加 | `executeIfComplete` | 引用与金额 room；已承诺前后 finance 类 | 原子执行的锚点、幂等键与审批快照（D03/D04）。不要它：幂等只能靠客户端键（spikes 证伪） |
| changeOrder | `changeOrders` | 只追加 | `executeIfComplete` | 文档 room；G701 基线 / 前后金额 finance 类 | 执行派生的变更单文档（AIA G701 金额链）。并入 executions 也可，但"幂等锚点"与"给人看的文档"分开后，后者的字段可随场景变化而前者不动 |
| task | `tasks` | 只有完成字段 | `executeIfComplete`；`tasks.markDone`（被指派角色） | room | 执行派生的内部工作项，来自提案快照（所见即所写）。不要它：执行没有可交付物 |
| event | `events` | 只追加 | `appendEvents` | room（payload 只含房间可见字段）；restrictedRef 按查看者连接 | 可追溯时间线（核心 6）与节流计数源。不要它：时间线只能由多表拼接，排序依赖墙钟 |
| opsFlags / spendCounters | 同名 | 单行 / 每日一行 | `ops.setDraining` / `turns.beginAttempt` 与结算 | system | 排空开关、全局日美元上限（D17）。不要它们：部署会打断在途回合、花费无全局闸门 |

## 2.3 被删除或合并的概念：为什么不需要、职责由谁承担

| 候选概念（出处） | 删除理由 | 职责转移到 |
| --- | --- | --- |
| `budgets` / `budgetChanges` / `totalBudgetCents`（Role A、多份候选） | 上限是 finance 的硬约束，历史就是 finance 简报的版本链；第二入口导致漏 bump | `briefs.hardFields.capCents`（`budget.setCap` 是便捷入口） |
| `constraintSets` 指针元组 + `committedCents` 快照（invariants 底稿） | 已承诺额在 `open` 期间恒定，无需快照；"版本 N 的输入"可由来源引用折叠 | `constraintRevisions.sourceRefs` + 09 `replayRuleInput` |
| 外部已承诺 `externalCommittedCents`（invariants 底稿） | 可编辑会让 committed > cap（评委 EX-5 反例） | `ledgerEntries(kind: baseline)`，setup 期一次 |
| `commitments`（多份候选） | 名字与语义并入账本 | `ledgerEntries(kind: commit)` |
| `modelCalls` / `usageCounters`（run-lifecycle、runtime 候选） | 与 attempt 一一对应，两处存同一事实；房间累计计数每 run 归零形同虚设 | `attempts`（用量账本）+ `spendCounters(global, day)` + 每用户节流（D17） |
| `briefDrafts`（invariants / runtime 候选） | 草稿是表单状态；入库多一个私密数据面 | 浏览器表单，预填当前已确认版本；LLM 抽取列入 17 |
| `participants` / `seats`（候选） | 与邀请混在一起时未认领席位持有凭据 | `members` + `invites` |
| `decisions` / `signoffs` / `approvalRounds` | "轮"就是 (提案, cv)，已由绑定字段表达 | `approvals.boundConstraintsVersion / boundTermsKey` |
| `offerItems` / 插件常量 `RUSH_FEE`（eventsourcing 候选） | 价格必须来自 provider 确认（核心 4，C38） | `catalogItems(kind: 'modifier')` |
| `deferredItemKeys` / `deferredClause`（9 份候选） | 由客户私密集合减去条款得到，16 条评委反例 | 只在 customer 自己的投影里现算（D11） |
| `proposals.endorsed / approved / blocked / creationVerdict` | 分别由 run 状态、审批集合、读时规则派生；阻断候选根本不插提案 | `runs.status`、`evaluateApprovalSet`、`passesChecks` |
| `rooms.currentProposalId` | "当前提案"是当前 run 的属性；D06 沿用时提案的 `runId` 与当前 run 不同 | `runs.currentProposalId` |
| `rooms.catalogRevision`（agentquality 候选） | 只改标题就冻结协商（C8） | 行级定价修订号 `catalogItems.revision` |
| `runs.pendingTurnSeqs / openTurnCount / pendingEvaluations`、`paused` | 并行屏障 5 份候选各有一个永久卡死反例；`paused` 无人负责 | 串行回合 + `runs.activeTurnSeq`；`needs_input` + `agent_failed` 请求 |
| 事件 `visibility` / `audience` 字段、双写事件、哈希链 | 分页后过滤、漏写即泄露；哈希链不防有写权限者 | payload 只含房间字段 + `restrictedRef`（D14）；外部锚点列入 17 |
| 客户端 `operationId` | spikes 实测两次点击两条 execution | 服务端派生 `executionKey = exec:${proposalId}` |
| 自由文本 `shareableFacts`、`publicRationale`、`clarify.question: string` | 泄露通道兼注入通道 | `sharedFacts` 结构化值、模板化公共文本、`topicKey` |
| `executedItemKeys`、同房间追加轮 | 每一处都被打出重复承诺反例 | 一房一执行 + `startFollowUp` |
| 存储的投影哈希 `constraintsHash`（versioned-approvals 草稿） | 小值域可被枚举反推 | 同事务前后比较，不持久化（09 §9.1.1） |
| `users.email` | 邀请匹配可直接读 identity claim | 不存（PII 最小化） |

## 2.4 关系

```text
users 1─* members *─1 rooms 1─* invites
rooms 1─* briefs（按 role 只追加版本）            rooms 1─* sharedFacts（按 (fromRole, field) 只追加）
rooms 1─* catalogItems（按 itemKey 只追加行）      rooms 1─* ledgerEntries（baseline 恰 1 + commit 0..1）
rooms 1─* constraintRevisions（每个 cv ≥ 1 恰一行）──sourceRefs──> briefs / catalogItems / ledgerEntries / humanRequests
rooms 1─* runs 1─* turns 1─* attempts 0..1─> rawOutputs
runs 1─* proposals（proposal.runId = 创建它的 run）  runs.currentProposalId ─> proposals（可指向更早 run 创建的提案，D06）
proposals 1─* approvals                             runs 1─* humanRequests（每 run 至多 1 个 open）
proposals 1─0..1 executions 1─1 changeOrders；executions 1─1 ledgerEntries(commit)；executions 1─* tasks
rooms 1─0..1 executions（v1 一房一执行）             rooms(新).followsExecutionId ─> executions(旧)（每个 execution 至多一个后续房间）
rooms 1─* events ──restrictedRef──> briefs / humanRequests / attempts / ledgerEntries / approvals / constraintRevisions / sharedFacts / executions
全局：opsFlags（恰 1 行）、spendCounters（每 UTC 日 1 行）
```

"当前"指针只有五个，各有唯一写者：`rooms.currentRunId`（最新 run，任何状态；`startRunTx`）、`runs.currentProposalId`（`insertProposal`、`startRunTx` 的 R2 分支）、`runs.activeTurnSeq`（`createTurnTx`、`advanceRun`）、`turns.currentAttemptNo`（`turns.beginAttempt`）、`rooms.executionId`（`executeIfComplete`）。其余"当前值"（当前简报版本、当前目录行、当前共享事实、本人当前审批决定）都是"按索引取最后一行"，不存指针。
