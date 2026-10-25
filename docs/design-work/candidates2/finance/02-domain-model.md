# 02 领域模型

## 1. 实体与归属

| 实体 | 表 | 归属/写入者 | 可变性 | 解决什么问题 |
| --- | --- | --- | --- | --- |
| 用户 | `users` | 本人（首次访问 upsert） | displayName 可改 | tokenIdentifier → 内部 id，显示名 |
| 房间 | `rooms` | owner 建；系统维护计数与指针 | 计数/指针/状态 | 协商容器、约束版本、当前 run/提案指针 |
| 邀请 | `roomInvites` | owner | accepted/revoked 一次性 | 角色只能由服务端按邀请授予 |
| 成员 | `members` | 系统（acceptInvite） | 不可变 | (room, role) 与 (room, user) 双唯一 |
| 简报草稿 | `briefDrafts` | 本人 | 可变 | 编辑中，不参与任何计算 |
| 简报版本 | `briefVersions` | 本人确认 | 只追加 | 约束与披露的权威来源 |
| 报价条目修订 | `catalogItems` | provider | 只追加（修订） | 价格来源；提案引用具体修订 |
| 预算 | `budgets` | 系统 | 仅计数器 | 每房间一行；台账写入的 OCC 锚点 |
| 预算上限修订 | `budgetRevisions` | finance | 只追加 | 上限的唯一真相与变更分录 |
| 承诺 | `commitments` | 系统（执行）/ finance（期初） | 只追加 | 已承诺的唯一真相 |
| 协商运行 | `runs` | 系统 | 状态经迁移表 | 每房间至多一个活动 run |
| 代理回合 | `agentTurns` | 系统 | running→终态一次 | 输入快照、输出、用量、失败原因 |
| 提案 | `proposals` | 系统（代理回合或人工选择后由代码生成） | 内容不可变，status 经迁移表 | 被签字的对象 |
| 签字 | `decisions` | 人 | 只追加 | approve / reject / withdraw |
| 变更单 | `changeOrders` | 系统（执行） | 不可变 | 一次执行的记录与快照 |
| 任务 | `tasks` | 系统派生；provider 改状态 | status 可变 | 执行后的工作项 |
| 人工请求 | `humanRequests` | 系统生成；targetRole 回答 | open→终态一次 | 向具体的人请求取舍 |
| 约束变更 | `constraintChanges` | 系统（bumpConstraints） | 只追加 | 每次版本递增的原因与引用 |
| 事件 | `events` | 系统 | 只追加 | 公共时间线与按角色时间线 |

## 2. 关系图（文字）

```text
rooms 1─* members, roomInvites, briefVersions, catalogItems, runs, proposals, events, constraintChanges
rooms 1─1 budgets 1─* budgetRevisions
                  1─* commitments ──(kind=change_order)──1 changeOrders
runs 1─* agentTurns 1─0..1 proposals
proposals 1─* decisions
proposals 1─0..1 changeOrders 1─* tasks
changeOrders.authorizingDecisionIds ─* decisions
proposals.lines[].catalogItemId ─ catalogItems（具体修订）
proposals.customerBriefVersionId ─ briefVersions
```

## 3. 账务模型

### 3.1 两本账
- **上限账** `budgetRevisions`：每次设定上限追加一行 `{revision, limitCents, previousLimitCents, reasonCode, note}`。`limitCents(budget) = revision 最大的那一行`。
- **承诺账** `commitments`：每笔承诺一行 `{seq, kind, amountCents}`，`amountCents > 0`。`committedCents(budget) = Σ amountCents`。
- 余额全部派生，不在任何文档里存 `committedCents`/`totalBudgetCents`。函数 `ledgerBalance(ctx, budgetId)` 是唯一读取入口（06）。

### 3.2 分录种类

| 分录 | 表 | kind / reasonCode | 写入入口 | 递增约束版本 |
| --- | --- | --- | --- | --- |
| 初始上限 | budgetRevisions | `initial` | `budget.setLimit`（revision 1） | 是 |
| 上调 / 下调 | budgetRevisions | `increase` / `decrease` | `budget.setLimit`、`requests.answer`(raise_limit) | 是 |
| 期初承诺 | commitments | `opening_balance` | `budget.recordOpeningBalance`（setup 阶段一次） | 是 |
| 变更承诺 | commitments | `change_order` | 执行（`decisions.approve` 最后一票） | 是（`commitment_recorded`） |

- v1 没有冲销、退款、负数分录；已执行变更单不可撤销（17 给出 `reversal` 扩展形状）。
- 待批提案**不预占**预算：每房间一个预算、同时只有一个当前提案，执行事务内重算即可（ADR-12）。

### 3.3 签字即对不可变内容的确认
- 提案内容 = 条目价格快照 `lines[]` + 费用 `fees[]` + `amountCents` + `deliveryDate` + `deferredItemKeys` + 引用的 `customerBriefVersionId`。
- `contentKey` 是内容的规范化字符串（06 §6），写入提案，签字时复制到 decision。执行时重算并比对，三者一致才执行。
- 签字的有效性 = `decision.constraintsVersion === room.constraintsVersion` 且 `proposalId === room.currentProposalId` 且该用户在该 (proposal) 上的**最新**分录是 approve。全部派生，不回写。

## 4. 版本化对象

| 对象 | 版本号 | 递增者 | 唯一性落点 |
| --- | --- | --- | --- |
| 约束快照 | `rooms.constraintsVersion` | 只有 `bumpConstraints` | rooms 文档单行 |
| 提案 | `proposals.version`（房间内单调） | `insertProposal` 读 `rooms.nextProposalVersion` | 同一 mutation 读改写 rooms |
| 上限 | `budgetRevisions.revision` | `budget.setLimit` 读 `budgets.nextRevision` | budgets 文档 |
| 承诺 | `commitments.seq` | 执行 / 期初录入读 `budgets.nextCommitmentSeq` | budgets 文档 |
| 简报 | `briefVersions.version`（每 room×role） | `briefs.confirm` | by_room_role_version 先查后写 |
| 报价条目 | `catalogItems.revision`（每 room×itemKey） | `catalog.saveItem` | by_room_item_revision 先查后写 |
| run | `runs.seq`（房间内） | `startRunInternal` | rooms.currentRunId 指针 + rooms 文档 |
| 签字 | `decisions.seq`（每 proposal×user） | `decisions.*` | by_proposal_user 先查后写 |

## 5. 不变量清单

### 5.1 账务不变量（L 系列）
- **L1** 所有金额字段是安全整数美分，`0 ≤ n ≤ MAX_CENTS`；承诺金额 `> 0`。
- **L2** `committedCents` 与 `limitCents` 只由台账派生，任何文档不存副本。
- **L3** 任何时刻 `committedCents ≤ limitCents`（余量非负）。守卫：执行事务重算；`setBudgetLimit` 拒绝 `newLimit < committed`；`recordOpeningBalance` 拒绝 `amount > limit`。
- **L4** 每条 `change_order` 承诺恰好对应一张变更单，金额相等；变更单引用的签字集合覆盖 `requiredSignatures`、userId 互不相同、`constraintsVersion` 等于变更单的 constraintsVersion、`contentKey` 等于提案 contentKey。
- **L5** 每个预算至多一条 `opening_balance`，且只能在房间 `setup` 状态写入。
- **L6** `commitments.seq`、`budgetRevisions.revision` 在预算内从 1 连续递增、无空洞。
- **L7** 每个 `operationKey` 至多一张变更单、一条承诺；每个提案至多执行一次。
- **L8** 台账写入只经 3 个入口：`budget.setLimit`、`budget.recordOpeningBalance`、`executeProposal`（内部 helper，仅由 `decisions.approve` 的最后一票调用；`choose_candidate` 回答只生成提案，不执行）。

### 5.2 流程不变量（I 系列）
- **I1** 提案、签字、简报版本、报价修订、约束变更、事件只追加；内容字段永不 patch。
- **I2** constraintsVersion 只经 `bumpConstraints`；每次递增恰好写一条 constraintChanges。
- **I3** 每房间至多一个活动 run（status ∈ negotiating / pending_approval / needs_input / failed）；由 `rooms.currentRunId` 指针 + 同一 mutation 守卫。
- **I4** 每房间至多一个 `active` 提案，且等于 `rooms.currentProposalId`。
- **I5** 代理回合结果只在回合持久化守卫通过时落库（04 §3）。
- **I6** 必需签字集合在提案插入时快照；执行以快照为准。
- **I7** 一个用户在一个房间只占一个角色；不同签字类型必须来自不同 userId。
- **I8** 对他方可见的文本只由模板从结构化字段渲染。
- **I9** 可执行性 `isExecutable` 永远实时计算（06 `validateProposal` + 版本/指针比较），不入库。
- **I10** 约束变化取消全部 open 的 humanRequests。
