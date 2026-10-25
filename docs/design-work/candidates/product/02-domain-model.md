# 02 领域模型（part1）：实体、关系、所有权、版本化

> 本章分 2 片：part1（本文件）实体、关系、所有权、可变性与版本化、金额口径；part2 不变量清单与落点。字段级定义见 03。

## 2.1 实体总览

```text
users ──< seats >── rooms ──< invites
                     │
   ┌─────────────────┼──────────────────────────────┬───────────────┐
briefDrafts(1/seat)  listItems(按 listKey 版本化)   commitments(台账)   constraintRevisions(每版本一行)
briefVersions(只追加)        │                         │
                     runs ──< turns                   │
                     │  └──> proposals(只追加) ──< decisions(只追加)
                     │              └──> executions(每提案×约束版本至多一条) ──< tasks
                     └──> humanRequests                 └──> commitments(kind execution)
events(只追加，覆盖以上全部动作)
```

| 实体（表） | 是什么 | 引擎 / 场景 | 载荷是否由场景定型 |
| --- | --- | --- | --- |
| User `users` | 一个 Clerk 身份在本系统的映射（`tokenIdentifier` 唯一） | 引擎 | 否 |
| Room `rooms` | 一次多方协商的容器，绑定一个场景与版本、时区、币种；持有版本计数器与"当前"指针 | 引擎 | 否 |
| Seat `seats` | 房间里的一个角色席位；至多一个用户 | 引擎（角色由场景声明） | 否 |
| Invite `invites` | 指向某个席位的一次性邀请（只存令牌哈希） | 引擎 | 否 |
| BriefDraft `briefDrafts` | 席位的可变私密草稿，每席位一条 | 引擎 | `fields` |
| BriefVersion `briefVersions` | 确认后的不可变简报：规则字段、偏好字段、私密备注、共享说明、披露决定 | 引擎 | `fields` |
| ListItem `listItems` | 共享清单中的一项的一个版本（scope_change：范围项、报价行） | 引擎（清单由场景声明） | `data` |
| ConstraintRevision `constraintRevisions` | 约束版本 N 的不可变快照：原因、操作者、当时生效的简报版本与清单项、台账序号 | 引擎 | 否 |
| Commitment `commitments` | 金额台账条目：基线或执行产生的承诺 | 引擎（是否启用由场景声明） | 否 |
| Run `runs` | 一次有界的代理协商过程 | 引擎 | 否 |
| Turn `turns` | 某代理在 run 中的一次尝试（每次 attempt 一行），含校验后的模型输出与用量 | 引擎 | 输出动作中的候选键是字符串 |
| Proposal `proposals` | 一份不可变的条款（含 `termsKey`）、必需签核快照与创建时检查快照 | 引擎 | `terms`、`selection` |
| Decision `decisions` | 一个席位对"提案 × 约束版本"的一次签核动作：approve / reject / withdraw | 引擎 | 否 |
| Execution `executions` | 一次原子执行的主记录（场景称"变更单"），冻结条款与签核引用 | 引擎 | `terms`（冻结副本） |
| Task `tasks` | 执行派生的内部任务，指派给席位 | 引擎（派生规则由场景给出） | 否 |
| HumanRequest `humanRequests` | 发给具体席位的结构化请求：`tradeoff` / `preference` / `disclosure` | 引擎（选项由场景生成） | 选项中的补丁 |
| Event `events` | 只追加的结构化事件，带受众，读时渲染 | 引擎（模板分引擎/场景） | 否（payload 由引擎定型） |

**派生概念（不存储）**：RuleView（规则视图）、ScopedRuleView（作用域视图）、Candidate（候选）、CheckOutcome（检查结果）、FeasibilityReport、SharedFact（披露给我的事实）、SignoffState（每席位签核状态）、Phase（房间派生阶段）、Stance（代理立场，存于 turn 输出，按需提取）。

## 2.2 关系与基数

| 关系 | 基数 | 说明 |
| --- | --- | --- |
| room — seats | 1 : 场景角色数（scope_change 为 3） | 建房时一次性创建，按 `roleKey` 唯一 |
| seat — user | 0..1 : 1 | 邀请接受后绑定，v1 不可更换 |
| user — seats（同房间） | 1 : 0..1 | 一人一席 |
| seat — briefDraft | 1 : 1 | 建房时创建 |
| seat — briefVersions | 1 : 0..n | `version` 从 1 连续递增 |
| room — listItems | 1 : n | `(listKey, itemKey)` 下多个版本，至多一个 confirmed、至多一个 draft |
| room — constraintRevisions | 1 : n | 每个约束版本恰好一行（版本 0 是建房时的空快照） |
| room — runs | 1 : n | 同时至多一个 running/stalled |
| run — turns | 1 : n | `(seq, attempt)` 唯一 |
| run — proposals | 1 : 0..n | 每轮至多一个；人提出的提案 `runId` 为空 |
| proposal — decisions | 1 : n | 按 `(proposalId, seatId)` 追加，读最新 |
| proposal — executions | 1 : 0..1 | 由 `operationKey` 与 `status` 双重保证 |
| execution — commitments | 1 : 0..1 | 金额为 0 的场景不写承诺 |
| execution — tasks | 1 : n | 派生 |
| room — humanRequests | 1 : n | 同一约束版本下的一组取舍请求共享 `groupKey` |

## 2.3 所有权与写入者

| 对象 | 拥有者 | 可写入者 | 读者（细节见 07） |
| --- | --- | --- | --- |
| room 元数据（title、goal、timeZone） | 房主 | 房主（仅 setup 阶段可改 goal 文案，不影响规则） | 全体成员 |
| seat 绑定 | 系统 | `invites.accept`、`rooms.create` | 全体成员（显示名） |
| briefDraft / briefVersion | 席位本人 | 本人；`requests.answer` 以本人身份写补丁版本 | 本人；本人代理；他方只见披露字段与版本号 |
| listItem（scope 清单） | customer 席位 | 有 `list.author:scope` 能力的席位 | draft 仅作者；confirmed 全体 |
| listItem（quote 清单） | provider 席位 | 有 `list.author:quote` 能力的席位 | 同上 |
| commitment（baseline） | finance 席位 | 有 `ledger.manage` 能力的席位 | 金额按 `committedCents` 的披露决定 |
| commitment（execution） | 系统 | 执行事务 | 同上 |
| proposal | 作者（代理所属席位或人） | `runtime.completeTurn`、`requests.answer`、`proposals.proposeCandidate` | 条款全体可见；检查按投影 |
| decision | 签核席位本人 | `decisions.record` | 决定类型与时间全体可见；备注仅本人 |
| execution / task | 系统 | 执行事务；任务状态由被指派席位改 | 条款与任务全体；预算影响按投影 |
| run / turn | 系统 | 运行时 internal 函数 | run 进度全体；turn 输出（含 rationale）仅本席位 |
| humanRequest | 系统 | 生成：internal；回答：目标席位本人 | 详情仅目标席位；他人只见"在等谁" |
| event | 系统 | 各 mutation 同事务写入 | 按 `audience` |

## 2.4 可变性与版本化

| 类别 | 对象 | 规则 |
| --- | --- | --- |
| 不可变、只追加 | briefVersions、constraintRevisions、proposals（条款）、decisions、executions、turns、events | 写入后内容不改；纠错 = 追加新记录 |
| 版本化 | listItems | 每次确认新版本，旧版本 `superseded`；数据不改，只改 `status` |
| 有限可变（只改状态字段） | proposals.status、listItems.status、commitments.status（仅基线可作废）、tasks.status、humanRequests.status、runs.status、invites.status | 每次状态变化都有迁移表（04）与事件 |
| 可变指针与计数器 | rooms：`constraintsVersion`、`proposalSeq`、`runSeq`、`executionSeq`、`ledgerSeq`、`currentProposalId`、`activeRunId`、`lastExecutionId`、`negotiationOpen` | 只由指定函数修改（03 第 3.22 节写明每个字段的唯一写入口） |
| 自由可变 | briefDrafts | 仅本人；乐观并发 `basedOnVersion` |

两个版本概念：**提案版本**（`proposals.version`，房间内单调，来自 `rooms.proposalSeq`，永不重置）与**约束版本**（`rooms.constraintsVersion`，只经 `bumpConstraints` 递增）。约束变化**不复制提案**：同一提案可在新约束版本下重新签核（否决 Role A 的 revalidated 复制，18 ADR-09）。

## 2.5 金额口径（解决 GAP-03）

| 名称 | 含义 | 谁计算 | 何时快照 | 可见性（scope_change 默认） |
| --- | --- | --- | --- | --- |
| `amountCents` | 本次变更金额（提案增量），例如 +$750 | 插件 `toTerms`，从报价行求和 | 存于提案条款（不可变） | 全体（来自公开报价） |
| `committedCents` | 台账中 active 条目之和，例如 $4,000 | 引擎汇总 `commitments` | 执行时存 `ledgerBeforeCents`/`ledgerAfterCents` | finance；默认披露给 customer |
| `committedAfterCents` | `committedCents + amountCents`，例如 $4,750 | 读时派生 | 执行记录 `ledgerAfterCents` | 同上 |
| `budgetCapCents` | finance 简报中的上限 | 简报字段 | 执行记录 `budgetCapCents` 快照 | finance；默认披露给 customer |
| `headroomCents` | `budgetCapCents − committedCents` | 读时派生 | 不存 | 同上 |
| `overByCents` | `committedAfterCents − budgetCapCents`（> 0 时） | 预算检查 `params` | 不存 | 同上；provider 只见 `BUDGET_EXCEEDED` |

原 README 所说的 "$4,900 proposal" 在本设计中写作"+$900 变更（批准后已承诺 $4,900）"，两者从不混用。
