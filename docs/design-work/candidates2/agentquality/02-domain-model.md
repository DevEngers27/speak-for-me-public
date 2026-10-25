# 02 领域模型

## 2.1 实体与归属

| 实体 | 归属 / 写入者 | 可变性 | 解决什么问题 |
| --- | --- | --- | --- |
| User | 系统（首次登录时 upsert） | displayName 可改 | tokenIdentifier → 内部 id，承载显示名 |
| Room | owner 创建；版本计数由系统维护 | status、计数器、两个指针 | 协商容器、约束版本锚点 |
| Member | 系统（接受邀请时） | 不可变（v1 不支持移除） | 用户 × 房间 × 角色 |
| Invite | owner | status | 角色只能经邀请绑定 |
| Brief | 本人 | draft 可改；confirmed 只追加 | 私密委托的结构化输入与披露决定 |
| CatalogItem | provider | 每个修订只追加 | 价格与工期的唯一来源 |
| Budget | finance（经 `budgets.update`） | totalCents 可改，变更进 BudgetChange | 预算上限，独立于 room |
| BudgetChange | 系统 | 只追加 | 预算历史（仅 finance 可读） |
| Commitment | 系统（seed 基线 / 执行） | 只追加 | 已承诺金额的唯一真相源（台账汇总） |
| Run | 系统 | status、计数器 | 一次协商运行 |
| Turn | 系统 | status、结果字段写一次 | 一个角色代理的一次决策 |
| ModelCall | 系统 | 写一次 | 每次模型（或 stub）调用的用量与结局 |
| Proposal | 系统（由 turn 物化） | 条款不可变，只有 status 可变 | 被审批的不可变内容 |
| Decision | 人（经 `decisions.submit`） | 只追加 | 审批 / 拒绝 / 撤回 |
| HumanRequest | 系统生成；目标角色的人回答 | status、answer 写一次 | 向具体的人请求取舍 / 澄清 |
| ChangeOrder | 系统（执行） | 不可变 | 执行产物，引用 proposal 与 decisions |
| Task | 系统派生；assignee 可改 status | status | 执行产物 |
| Event | 系统 | 只追加 | 公共与分角色时间线、审计 |

## 2.2 关系

```text
User 1─* Member *─1 Room 1─1 Budget
Room 1─* Invite, Brief(versions), CatalogItem(revisions), Commitment, BudgetChange, Event
Room 1─* Run 1─* Turn 1─* ModelCall
Run 1─* Proposal (authoredByTurnId)   Proposal *─1 Turn
Proposal 1─* Decision                 Room.currentProposalId → Proposal
Run 1─* HumanRequest                  Room.currentRunId → Run
Proposal 1─0..1 ChangeOrder 1─1 Commitment, 1─* Task
```

## 2.3 版本化对象

| 对象 | 版本键 | 规则 |
| --- | --- | --- |
| Room 硬约束 | `rooms.constraintsVersion`（从 1 起） | 只经 `bumpConstraints` 递增（09） |
| Proposal | `proposals.version`（房间内单调） | 读 `rooms.proposalVersion` +1 后插入，同一 mutation；新 run 不重置 |
| Brief | `(roomId, roleKey, version)` | 每次确认插入新 confirmed 行，旧 confirmed → superseded |
| CatalogItem | `(roomId, itemKey, revision)` + 房间级 `catalogRevision` | 修订只追加；`rooms.catalogRevision` 在每次 `catalog.confirm` +1 |
| Prompt | `promptVersion` 常量（代码） | 写入每个 turn，评测报告按它分组 |
| Scenario | `scenarioVersion` 常量 | 写入 room 与 turn |

## 2.4 值对象

```ts
type Cents = number;           // 0 ≤ n ≤ MAX_CENTS(=1e11)，Number.isSafeInteger
type IsoDate = string;         // "YYYY-MM-DD"，按 room.timeZone 解释的日历日
type CandidateKey = string;    // 规范化："LOGIN+REPORTS|rush"（条目键字典序 + 交付模式）
type ProposalTerms = {
  candidateKey: CandidateKey;
  itemKeys: string[];          // 已排序
  deferredItemKeys: string[];  // = requestedItemKeys − itemKeys（代码计算）
  deliveryMode: "standard" | "rush";
  deliveryDate: IsoDate;       // 代码按目录工期计算
  priceCents: Cents;           // 代码按目录求和（含 fee）
  sourceRefs: { catalogItemId: string; itemKey: string; revision: number; priceCents: Cents }[];
  catalogRevision: number;
};
type ReasonCode = "OK" | "UNKNOWN_ITEM" | "ITEM_NOT_CONFIRMED" | "MISSING_REQUIRED_ITEM"
  | "DATE_AFTER_DEADLINE" | "DATE_IN_PAST" | "RUSH_UNAVAILABLE" | "OVER_BUDGET"
  | "BUDGET_BELOW_COMMITTED" | "STALE_CONSTRAINTS" | "STALE_CATALOG";
```

## 2.5 不变量清单（编号全篇引用）

| # | 不变量 | 落点 |
| --- | --- | --- |
| I1 | proposal 条款写后不变；只有 `status` 经迁移表改变 | 03 无 patch 条款的写路径；04 |
| I2 | `proposal.version` 房间内唯一且单调 | `internal.proposals.insert` 单入口 |
| I3 | `constraintsVersion` 只经 `bumpConstraints` 改变 | lint 规则 + 代码审查清单 |
| I4 | decision 绑定 `(proposalId, constraintsVersion, contentHash)`；每 (proposal, constraintsVersion, user) 以最新一条为准 | 08 |
| I5 | 每个 (proposalId, constraintsVersion) 至多执行一次 | 状态守卫 + `changeOrders.by_operationId` |
| I6 | 每房间至多一个非终态 run；迟到的 turn 结果被拒收 | `runs.start` 单入口 + 回合持久化守卫 |
| I7 | `requiredApprovals` 在提案插入时快照；不同角色由不同 userId 满足 | 08 |
| I8 | 对他方可见文本只由模板从结构化字段生成 | 07 §6、14 §5 |
| I9 | 金额是安全整数美分，`committed + price ≤ total` 在执行事务内重算 | 06 `checkBudget` |
| I10 | 可执行性、阻断、共享事实、已承诺额读时派生，不存 | 06、09 |
| I11 | 模型输出的 candidateKey 必须属于该 turn 快照的候选集 | 05 `checkDecision` |
| I12 | 任何代理上下文只来自 `buildRoleView(snapshot, roleKey)` | 07 §4 |
| I13 | 每个 (roomId, roleKey) 恰有一名成员，每个 (roomId, userId) 至多一个角色 | `invites.accept` 单入口 |
| I14 | 每 run 的模型调用数 ≤ `modelCallLimit`；计数在调用前原子 +1 | `agents.beginAttempt` |
| I15 | 硬约束 reasonCode 只由 `validateProposal` 产生，模型输出不能包含 | 05 输出 schema |

## 2.6 角色由场景声明

引擎不定义全局角色枚举：场景导出 `roles: RoleSpec[]`（roleKey、显示名、是否提议方、审批 kind、可问的澄清话题）。Convex 存储用 `v.string()` 并在写入口按场景校验；首个场景的 TypeScript 类型仍是字面量联合 `"customer" | "provider" | "finance"`，供 UI 与测试使用。
