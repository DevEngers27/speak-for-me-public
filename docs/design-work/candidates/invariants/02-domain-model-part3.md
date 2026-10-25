# 02 领域模型 · part3：实体、关系、所有权、版本化对象与守卫矩阵

> 不变量见 part1–part2。本片说明"为了让那些不变量可被守住，需要哪些实体、哪些字段必须不可变、哪些量只能派生"。字段与索引的精确写法见 03。

## 1. 实体总览

| 实体 | 表 | 可变性 | 所有者 / 写者 | 它解决的问题（为什么需要它） |
| --- | --- | --- | --- | --- |
| 用户 | `users` | 仅 displayName 可变 | `users.ensure` | 把 Clerk 的 tokenIdentifier 映射为内部 id（ID-1、ID-2），显示名有落点 |
| 房间 | `rooms` | 指针与计数器可变 | 引擎 | 聚合根：当前版本指针、序号计数器、房间聚合写锁（M-ROOM） |
| 参与方（席位） | `participants` | 指针可变 | `rooms.create`、`invites.accept` | 把"用户"与"房间内角色"分开（ID-3–ID-5） |
| 邀请 | `invites` | 状态机 | 房主 | 角色只能由服务端按邀请授予（ID-6） |
| 简报草稿 | `briefDrafts` | 可变 | 本人 | 自动保存、抽取结果落点；永不进入规则（BR-2） |
| 简报版本 | `briefVersions` | 只追加 | `commitBriefVersion` | 确认即不可变；历史可解析（核心 6）；披露决定随版本保存 |
| 约束集 | `constraintSets` | 只追加 | `bumpConstraints` | 约束版本的实体：一次 bump = 一行，指向当时各方确认版本与已承诺快照（CS-1–CS-4） |
| 协商运行 | `runs` | 状态机 | 引擎 | 一次协商尝试的生命周期、轮次与待完成回合（RN-1–RN-3） |
| 代理回合 | `agentTurns` | 状态机 | 引擎 | 每次代理调用（含重试）的输入版本、输出、结果；迟到结果拒收的依据 |
| 提案 | `proposals` | 只追加 | `insertProposal` | 被人批准的不可变内容（PR-1–PR-7） |
| 审批决定 | `decisions` | 只追加 | `decisions.record` | 人的 approve / reject / withdraw，绑定 (proposalId, constraintsVersion)（DE-1–DE-5） |
| 人工请求 | `humanRequests` | 状态机 | `openRequests` | 向具体的人请求取舍或披露（HR-1–HR-4） |
| 执行（变更单） | `executions` | 只追加 | `executeIfReady` | 一次原子执行的主记录；场景把它渲染为 Change order（EX-1–EX-3） |
| 预算承诺 | `commitments` | 只追加 | `executeIfReady` | 内部金额台账，已承诺金额的唯一真相源（CS-4、EX-5） |
| 任务 | `tasks` | 仅 status 可变 | `executeIfReady` 插入；被指派角色改状态 | 执行派生的内部工作项（EX-4） |
| 事件 | `events` | 只追加 | `emitEvent` | 可追溯时间线（EV-1–EV-4） |
| 模型调用 | `modelCalls` | 只追加 | 代理 action 经 internal mutation | 用量、延迟、成本的唯一来源（不事后估算） |

刻意**没有**的实体及理由：
- 没有独立的 `budgets` / `budgetChanges` 表：预算上限与外部已承诺金额是 finance 简报的结构化规则字段，随 briefVersions 版本化；变更原因写在版本上。这样"约束变化"只有一条路径（`commitBriefVersion`），不会出现"改了预算忘了 bump"的第二入口。
- 没有 `sharedFacts` 表：共享事实 = 各方当前确认版本中对查看者披露的字段，读取时派生，历史由版本保留。
- 没有独立的 `changeOrders` 表：变更单与执行 1:1 且都不可变，`executions` 即变更单。
- 没有 `rejections` 表：拒绝是 `decisions.kind = reject`。
- 没有 `catalog / offerItems` 表：provider 的报价行是 provider 简报的结构化规则字段（见 14），随版本不可变；提案引用的是"约束集里那一版 provider 简报的某一行"。

## 2. 关系

```text
users 1─* participants *─1 rooms 1─* invites
rooms 1─* briefDrafts(每个 participant 一份)    participants 1─* briefVersions
rooms 1─* constraintSets ──引用──> briefVersions(每个角色当时的确认版本)
rooms 1─* runs 1─* agentTurns ─0..1─> modelCalls
runs 1─* proposals(由回合或人工选择产生) ──引用──> constraintSets(创建时)
proposals 1─* decisions(按 constraintsVersion 分组)
proposals 1─0..1 executions 1─1 commitments ; executions 1─* tasks
rooms 1─* humanRequests ─0..1─> runs ; rooms 1─* events
rooms.currentConstraintSetId / currentRunId / currentProposalId 是三个"当前指针"
```

## 3. 版本化对象与"批准的到底是什么"

1. **简报版本**：某参与方在某时刻确认的完整结构化内容 + 私密备注 + 披露决定 + acknowledgements。不可变。
2. **约束集**：`{ version, briefVersionIds: 每个角色一项, committedCents }`。它是一个"指针元组"：知道它就知道当时全部规则输入。约束版本号就是它的 version。
3. **提案**：不可变条款 `terms` + 创建时的 `constraintSetId` + 必需审批角色快照。提案不随约束变化而复制（否决 Role A 的 revalidated）。
4. **决定**：绑定 `(proposalId, constraintsVersion)`。因为提案不可变，绑定 proposalId 就等于绑定条款内容，不需要内容哈希；`proposals.contentKey`（规范化条款串）只用于展示"与 vN 条款相同"和去重。
5. **执行**：绑定 `(proposalId, constraintsVersion)`，并记录用到的 decisionIds 与执行前后的预算快照。

于是"人批准的具体版本" = (不可变条款, 当时约束集)。任一侧变化都使旧批准不再计数（DE-4），记录保留。

## 4. 可变性分类与 db 门面（守住 PR-1、DE-1、EV-1、ID-5 的机械手段）

`convex/engine/db.ts` 是业务代码访问写操作的唯一入口；ESLint `no-restricted-properties` 禁止在该文件之外调用 `ctx.db.patch / replace / delete`。

```ts
export const APPEND_ONLY = ["briefVersions", "constraintSets", "proposals", "decisions",
  "executions", "commitments", "events", "modelCalls"] as const;
export const MUTABLE_FIELDS = {
  users: ["displayName"],
  rooms: ["status", "title", "goal", "constraintsVersion", "currentConstraintSetId",
          "currentRunId", "currentProposalId", "proposalSeq", "eventSeq", "runSeq",
          "executionSeq", "modelCallsUsed", "modelCallBudget", "closedAt"],
  participants: ["currentBriefVersionId", "briefVersionCount", "displayName"],
  invites: ["status", "acceptedByUserId", "acceptedAt"],
  briefDrafts: ["content", "origin", "baseVersionNo", "updatedAt"],
  runs: ["status", "endReason", "round", "step", "pendingTurnIds", "clarifyUsedBy",
         "lastValidProposalId", "failedTurnId", "endedAt"],
  agentTurns: ["status", "output", "resultProposalId", "modelCallId", "errorCode", "finishedAt"],
  humanRequests: ["status", "answer", "answeredByUserId", "closedAt"],
  tasks: ["status", "updatedByUserId", "updatedAt"],
} as const;
export function insert<T extends TableName>(ctx: MutationCtx, t: T, doc: Doc<T>) {/*…*/}
export function patchMutable<T extends keyof typeof MUTABLE_FIELDS>(
  ctx: MutationCtx, t: T, id: Id<T>,
  patch: Partial<Pick<Doc<T>, (typeof MUTABLE_FIELDS)[T][number]>>) {/*…*/}
```

类型层面 `patchMutable` 只接受白名单字段；运行时再断言一次。删除只有一个入口 `ops.purgeSimulatedRoom`（仅非生产环境、仅 `rooms.isSimulated = true`，见 15）。

## 5. 只派生、不存储的量

| 量 | 派生规则 | 为什么不存 |
| --- | --- | --- |
| 提案展示状态 | `rules_blocked`（creationVerdict = blocked）/ `current` / `executed`（有 execution）/ `superseded`（其余） | 存了就会与指针漂移（Role A RA-B17） |
| 可执行性 | PR-5 | 依赖"今天"与当前约束集 |
| 各角色审批状态 | `approved / rejected / pending / stale_approve / stale_reject`：当前 cv 上的最新决定；无则看同一提案在更早 cv 上的最新决定，标 stale | 同上 |
| 共享事实 | 各方当前确认版本中对查看者披露的字段 | 版本即历史 |
| 房间阶段 | `setup`（缺席位或简报）/ `ready` / `negotiating` / `awaiting_input` / `pending_approval` / `failed` / `idle`（执行后无活动 run）/ `closed` | 只存 `rooms.status = open/closed` |
| 邀请过期 | `now ≥ expiresAt` | 时间推移不应需要写入 |

`constraintSets.committedCents` 例外地被存储，因为它是**快照**而不是当前值：它让历史评估可复现（CS-2），并由 CS-4 约束与台账一致。`proposals.terms.deferredItemKeys` 也被存储，因为它是被批准内容的一部分（延后什么也是同意的对象）。

## 6. 金额量的命名（统一全篇，解决 GAP-03）

| 名称 | 含义 | 由谁算 |
| --- | --- | --- |
| `amountCents`（提案 terms） | 本次变更金额 = Σ 选中报价行价格，例 90000 | `materializeTerms` |
| `committedCents` | 某约束集下的已承诺金额 = 外部已承诺 + Σ 台账 | `bumpConstraints` |
| `committedAfterCents` | `committedCents + amountCents`（原文的 "$4,900 proposal"） | `evaluateProposal` |
| `capCents` | finance 版本中的 `budgetCapCents` | 读取 |
| `headroomCents` / `overByCents` | `capCents − committedCents` / `max(0, committedAfterCents − capCents)` | `evaluateProposal`；可见性按派生闭包 |

## 7. 守卫 × 不变量矩阵（函数 → 它守住的不变量）

| 函数（12） | 守住 |
| --- | --- |
| `requireViewer` / `requireParticipant` / `requireRoomOwner` | ID-1、ID-7 |
| `users.ensure` | ID-2 |
| `rooms.create` / `invites.accept` | ID-3、ID-4、ID-6 |
| `db.insert` / `db.patchMutable` | ID-5、BR-1、PR-1、DE-1、EV-1（只追加） |
| `commitBriefVersion` | BR-1、BR-5、CS-3、EX-5（预算下限）、VAL-1/2 |
| `bumpConstraints` + `onConstraintsChanged` | CS-1、CS-2、CS-4、CS-5、CS-6 |
| `loadRuleInputs` / `evaluateProposal` / `isExecutable` | BR-2、PR-5、VAL-3 |
| `startRun` / `transitionRun` | RN-1、RN-2、PR-4、SIM-2 |
| `scheduleTurn` | RN-4、RN-5 |
| `buildAgentContext` / `projectFor` | BR-3、BR-4、RN-6 |
| `completeTurn` / `failTurn` / `turnWatchdog`（`assertTurnLive`） | RN-3、RN-7、PR-3、SIM-2 |
| `insertProposal` | PR-2、PR-6、PR-7 |
| `decisions.record` / `approvalState` | DE-2–DE-5 |
| `executeIfReady` | EX-1–EX-6、CS-3、CS-4 |
| `openRequests` / `requests.answer` / `closeRequest` / `settleStep` | HR-1–HR-4 |
| `emitEvent` + `EVENT_SPECS` | EV-1–EV-3 |
| 模板渲染、`turns.mine` | EV-4 |
| `ops.auditRoom`（每日 cron + 测试） | 复核 CS-1、CS-4、EX-1、EX-4、EV-1、RN-1、PR-2、BR-1 |

`ops.auditRoom` 是运行时的第二道防线：它不阻止违规，但能在违规出现后一天内报警（15）。
