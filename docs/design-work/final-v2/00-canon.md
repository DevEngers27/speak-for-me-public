# 00 · 统一口径（canon）— Speak for Me final-v2（重写版）

> 本文件是 final-v2 全部 19 章的最高口径：命名、关键决定、冲突裁决以它为准。优先级：任务书 > 本 canon > inputs/05（实测）> inputs/04 > 专题深潜 > 候选设计 > techstack / spike 原文。本版在读完 inputs/05–07、三份限时草稿、10 个专题的全部反驳、两份评委 JSON、九份候选的 00/18、spikes §0.1/§7/§8、research §7、CRITIQUES、techstack 决策表后重写；与草稿（旧 canon、00-invariants、00-product-decisions）不同之处一律标注 **修正草稿**。
>
> 分片：`00-canon.md`（§1 术语与命名）→ `00-canon-part2.md`（§2 裁决表 D01–D11）→ `00-canon-part3.md`（§2 裁决表 D12–D19）→ `00-canon-part4.md`（§2 裁决表 D20–D27）→ `00-canon-part5.md`（§3 已知冲突清单 C1–C60）→ `00-canon-part6.md` / `00-canon-part7.md`（§4 各章底稿与素材清单）。
>
> 对草稿的总体裁定：`00-invariants*.md` 的 R-A（执行键不含 cv）、R-B（预算低于已承诺拒绝）、R-C（守卫命中必 reconcile）、R-F（删除 deferred 派生字段）、R-G（请求选项按目标视图）、R-J（执行后审批快照冻结）采纳；R-D（并行屏障）、R-H 的"确认简报不自动 startRun"、R-I（today 进投影）否决，理由见 D08、D12、D22。`00-product-decisions*.md`：PD-01/03/13 的推荐原样采纳为默认值；PD-02 只采纳限流与"clarify 不问金额"，可见度取 (i) 只有 ok / blocked（U2），"目录变更不自动重算"否决（D12）；PD-04 采纳"出口由场景声明、选项按受众过滤、7 天"，`close_room` 选项与"过期 run 置 expired"否决（D15）；PD-08 只采纳"可撤回本人 approve"，"撤回需公开原因"与 7 天审批过期否决（D02、D15、U7）；PD-10 改为"默认邮箱定向、不知道邮箱时用单次链接"（D24）；PD-11 采纳"仅该方本人重试、拒绝类不自动重试"，自动重试次数改为每回合链 1 次（D17）；PD-05 否决（见 D04）；PD-09 的"可兼任"否决（见 D24）；PD-06/07/12/14–16 保留为用户决策（默认值见 part4 U5/U6/U9/U12）。逐条对照见 `00-product-decisions-part2.md` 末节。
>
> **canon 包修订（2026-10-24）**：本版吸收了各章作者提出的 62 条 canon 异议与 11 条 canon 问题（处置记录 `_fix/canon-log.md`），改动集中在：§1.1 补 `constraintRevisions` / `rawOutputs` 与目录 `editNo`；§1.3 定义 `passesChecks` / `isExecutable` / `canExecuteNow` 与提案 `stale → active`；§1.5 补录 API 层错误码；§1.6 补函数与事务 helper 名；D04 执行后两项豁免；D06 保留提案只限被取代 run 处于 `pending_approval`；D15 新增 `pass_to_next` 与 `keep_as_is` 按 kind 的含义；D27 主线改写；冲突 C43–C60。**核对者文字同步（2026-10-24，跨章核对阶段）**：D04 后续房间的目录复制过滤、D10 剔除集合 `excludedCandidateKeys(run)`、D12 ② / ⑥ 与末句措辞、D15 `disclose.toRoles`、D18 清理范围与 `privacy.redact` 豁免、D25 `lines[].kind`、§1.2 `writeSeq`、§1.6 `beginAttemptTx` / `rollLocalDateTx` / `scenarioOf`——只把各章已统一的实现写回 canon，不新增决定，逐条记录见 `99-review-log.md`。**编号单一来源**：不变量 INV-01…79、INV-M1 与反例电池 CE-001…170 以 `00-invariants*.md` 为准，16 章新增的反例从 CE-171 起编号（C43）。

## 1. 术语与命名表

### 1.1 实体与表（规范名 → 表名；括号内为废弃别名）

| 实体 | 表 | 含义与关键约束 | 废弃别名 |
| --- | --- | --- | --- |
| `room` | `rooms` | 一件需三方同意的事；`status`、`constraintsVersion`、`localDate`、`timeZone`、`currentRunId`、`nextProposalVersion`、`scenarioKey`、`scenarioVersion`、`createdBy`、`provenance`、`followsExecutionId?` | workspace / negotiation |
| `user` | `users` | `tokenIdentifier` 唯一映射；其他表引用 `v.id("users")` | — |
| `member` | `members` | `(roomId, userId, role)`；一人一房一席、一席一人；唯一写入 helper `addMember`（被 `rooms.create`、`invites.accept`、`rooms.startFollowUp` 调用，D24） | participants / seats / roomMembers |
| `invite` | `invites` | 邮箱定向邀请（默认，`invitedEmail`）或单次链接（`tokenHash`，fragment 传递）；72h；绑定 `role` | roomInvites / invitations |
| `brief` | `briefs` | 某角色的私密简报，**只追加版本**：`(roomId, role, version)`；含 `hardFields`、`softFields`、`disclosures`（逐字段受众）、`confirmedBy`；草稿不入库 | briefVersions / privateBrief / briefDrafts |
| `sharedFact` | `sharedFacts` | 经披露闸门写入的结构化共享事实 `{fromRole, field, value}`，值只能是日期 / itemKey[] / 枚举 / 整数分，无自由文本 | shareableFacts / publicFact |
| `catalogItem` | `catalogItems` | provider 确认的报价项或修饰项（rush 也是 catalogItem，`kind: 'item' \| 'modifier'`）；纯只追加，逻辑唯一 `(roomId, itemKey, revision, editNo)`：`revision` 是**定价修订号**、`editNo` 是同一 revision 内的展示修订号（规则见 §1.2）；`status: draft \| confirmed \| retired`；`priceCents`、`leadDays`、`title`、`taskTemplates`；唯一写入 helper `appendCatalogRow` | offerItems / offerLines / listItems / quote / 插件常量 / catalogRevision |
| `ledgerEntry` | `ledgerEntries` | 预算承诺账本，只追加：`kind: baseline \| commit`；`committedCents = Σ amountCents`，不存计数器 | commitments / budgets.committedCents / encumbrance / budgetRevisions |
| 预算上限 | finance `briefs.hardFields.capCents` | 上限是 finance 简报的硬字段，改上限 = 确认新简报版本（`budget.setCap` 是便捷入口） | budgets 表 / totalBudgetCents / limitCents |
| `proposal` | `proposals` | 不可变条款 `terms` + `termsKey` + `lines[]` 快照 + `plannedTasks[]` 快照；`version` 房间内单调；`createdAtConstraintsVersion` 只作来历 | offer / draft / proposalVersions / candidate（候选指未落库选项） |
| `approval` | `approvals` | 对 `(proposalId, userId)` 的只追加决定行：`decision`、`role`、`seq`、`boundConstraintsVersion`、`boundTermsKey`、`reasonKey?`、`note?`（只给本方） | decisions / signoffs / votes / endorsements |
| `humanRequest` | `humanRequests` | 向具体角色提出的结构化请求：`kind`、`toRole`、`options[]`、`status`、`expiresAt`、`runId` | tradeoffRequest / escalation / inputRequest |
| `run` | `runs` | 一次协商运行；`constraintsVersionAtStart`、`roundNo`、`activeTurnSeq`、`currentProposalId`、`cause`、`endedReason` | negotiation / session |
| `turn` | `turns` | run 内第 `turnSeq` 个回合，属于一个角色：`kind: propose \| evaluate`、`constraintsVersion`（快照）、`currentAttemptNo`、`candidateSnapshot[]`、`status` | step / slot / job / agentTurns |
| `attempt` | `attempts` | turn 的第 `attemptNo` 次调用，**同时是用量账本**：`status`、`usage`、`stopReason`、`requestId`、`schemaVersion`、`rawOutputRef?`（→ `rawOutputs`）、`watchdogFnId` | modelCalls / agentAttempts / invocation（**修正草稿**：不再单设 modelCalls 表） |
| `rawOutput` | `rawOutputs` | 内部表：模型原文（D16），无任何 query 暴露，按 `expiresAt` 由 `ops.purgeRawOutputs` 删除（dev 30 天 / prod 7 天） | rawOutputRef 内联 / outputSha256 |
| `constraintRevision` | `constraintRevisions` | 每个 cv 恰一行，只追加：`{ version, previousVersion, cause, actorUserId?, sourceRefs[], localDate }`；`cause` 枚举见 §1.2；不存任何约束值，"版本 N 的输入"由 `sourceRefs` 重放（`replayRuleInput`）；唯一写者 `constraints.bump` | producedConstraintsVersion 回填 |
| `execution` | `executions` | 一次原子执行：`executionKey`、`proposalId`、`constraintsVersion`、`approvalIds[]`（冻结快照）、`committedBeforeCents` / `committedAfterCents`、`provenance` | operation / commit |
| `changeOrder` | `changeOrders` | 执行派生的变更单文档（AIA G701 金额链） | outcomeDocument |
| `task` | `tasks` | 执行派生任务，`taskKey` 唯一 | workItem |
| `event` | `events` | 只追加审计事件：`(roomId, commitTs, seq)` 排序；`type`；`payload` 只含房间可见字段；`restrictedRef?` 指向私密行 | log / timeline entry（timeline 是视图名） |
| `opsFlags` / `spendCounters` | 同名表 | 运维布尔（`draining`）/ 全局日美元计数 | usageCounters |

关系：`room 1—n run`，`run 1—n turn`，`turn 1—n attempt`，`attempt 0—1 rawOutput`，`run 1—n proposal`（`proposal.version` 按房间递增），`proposal 1—n approval`，`run 0—1 humanRequest(open)`，`room 1—n constraintRevision`（`(roomId, version)` 从 1 连续），`room 0—1 execution`（v1 一房一执行，D04）。

### 1.2 关键字段

| 字段 | 位置 | 规范 |
| --- | --- | --- |
| `constraintsVersion` | rooms | 硬约束版本，唯一写入口 `constraints.bump`，递增矩阵见 D05；`setup` 期为 0，`setup → open` 时由 `bump(cause: 'room_opened')` 置 1 |
| `currentRunId` | rooms | 指向房间**最新**的 run（任何状态，终态时**不**清空），只由 `startRunTx` 写；非终态 run 至多一个，若存在必为 `currentRunId` 所指（D06 / 04 依赖它取刚被取代的旧 run） |
| `writeSeq` | rooms | 房间写锁计数（M-ROOM）：每个房间作用域的写事务经 `openRoomTx` 先 `writeSeq + 1`，把同房间的并发写入变成确定的 OCC 冲突；不进任何 DTO（03 §3.3、18 ADR-X01、INV-M1） |
| `cause` | runs | `room_opened \| constraints_changed \| renegotiation_requested \| manual_start`（废弃别名：briefs_confirmed / initial / restart） |
| `cause` | constraintRevisions | `room_opened \| brief_confirmed \| catalog_changed \| human_answer \| clock \| scenario_migrated`（废弃别名：request_answered / budget） |
| `constraintsVersionAtStart` | runs | run 绑定版本；D06 保证它恒等于 `room.constraintsVersion`（否则 run 已被 supersede） |
| `constraintsVersion` | turns | 回合创建时的快照；持久化守卫比较它（D07） |
| `revision` / `editNo` | catalogItems | `revision` = 定价修订号：新键 1；改 `priceCents` / `leadDays`、`catalog.retire`、重新上架各 +1（`editNo` 归 0）；`startFollowUp` 复制的 `draft` 行为 0。`editNo`：只改 `title` / `taskTemplates` 时同一 revision 内 +1。硬投影与 `proposals.lines[].revision` 只读 `revision`，所以改标题不 bump、不触发 `version.stale_source`（D05、D25） |
| `localDate` / `timeZone` | rooms | 房间时区下的"今天"（`YYYY-MM-DD`），只由 `rooms.create` 与 `clock.rollLocalDate`（及其事务 helper `rollLocalDateTx`）写；规则检查与物化在 query 与普通 mutation 中**一律读 `rooms.localDate`**，只有推进日期处用 `todayInTimeZone(Date.now(), timeZone)` 计算（物化条款的 mutation 发现真实日期已过 `localDate` 时先同事务推进，D22）；query 永不读 `Date.now()` |
| `termsKey` | proposals | **修正草稿**：规范化 JSON 字符串（`canonicalJson(terms)`），不是哈希；v1 不依赖 `crypto.subtle`（废弃别名：contentHash / contentKey / proposalHash） |
| `boundConstraintsVersion` / `boundTermsKey` | approvals | 审批绑定快照；`approvals.record` 入参 `expectedConstraintsVersion` / `expectedTermsKey` 必须相等 |
| `executionKey` | executions | **修正草稿**：`` `exec:${proposalId}` ``，不含 cv、不做哈希；索引 `by_executionKey` 唯一写入口 `executions.executeIfComplete` |
| `taskKey` | tasks | `` `${executionId}:${itemKey}:${templateIndex}` `` |
| `candidateKey` | turns.candidateSnapshot / proposals | 规范字符串 `canonical(itemKeys, modifiers)`：itemKey 码点序以 `+` 连接，修饰项以 `@` 追加，如 `audit_log_export+sso_login@rush`；itemKey 满足 `^[a-z][a-z0-9_]{1,39}$`；服务端身份 |
| `optionKey` | 模型输出 | 位置标签 `O1..On`，只在本回合的 `candidateSnapshot` 内解析（D10） |
| `provenance` | rooms / proposals / executions / ledgerEntries / changeOrders / tasks / attempts | `'live' \| 'seeded' \| 'stub'`，数据级标注（核心 8）（废弃别名：simulated / isSimulated） |
| `actorUserId` | 所有 internal mutation / action 参数 | 被调度函数无身份，必须显式传；鉴权在调度前完成 |
| `toRole` | humanRequests、模型 `clarify` / `escalate` | 收件人字段；不用 targetRole / addressee / targetRoleKey |
| `reasonKey` | approvals.reject、模型 `reject` | 人类与模型拒绝理由的封闭枚举（场景声明），不是 reasonCode |
| 金额 | 全部 | 整数分，后缀 `Cents`；`assertCents`（0 ≤ n ≤ 1e11，安全整数）；禁止 priceUsd / total |
| 日期 | 全部 | `IsoDate` 字符串 `YYYY-MM-DD`，字典序比较；禁止 `new Date("YYYY-MM-DD")` |

### 1.3 状态值（存储的状态只有这些；其余一律派生）

| 对象 | 状态 |
| --- | --- |
| room | `setup` → `open` → `executed` \| `closed`（`executed`、`closed` 终态）。`setup → open` 只由 helper `openIfReady` 在就绪条件全部满足时触发（04 §4.2.1：三席齐；三方各有已确认简报且硬字段齐；≥ 1 个 `confirmed` 的 `kind: item` 目录行；已录 `baseline`）：同事务 `bump(cause: 'room_opened')`（cv 0 → 1）并 `react()` 开首个 run（cause `room_opened`）。`setup` 期的写入只写来源、不 bump、不开 run，每个来源写入末尾调用 `openIfReady` |
| run | `negotiating` → `pending_approval` → `executed`；旁路 `needs_input`；终态 `executed` / `superseded` / `ended_no_agreement` / `canceled`。**修正草稿**：没有 `paused`，回合失败走 `needs_input` + `humanRequest(kind: agent_failed)`（D15） |
| turn | `scheduled` → `running` → `completed` \| `failed` \| `stale` |
| attempt | `running` → `completed` \| `invalid_output` \| `timeout` \| `error` \| `refused` \| `stale` |
| proposal | `active` → `executed`；`active → superseded`（同 run 被新版本替代，或所属 run **非因约束变化**而结束：`runs.cancel` / `rooms.close` / `runs.requestRenegotiation` / `end_run` / 轮次用尽 / 请求过期）/ `active → rejected`（人拒绝，终局）/ `active → stale`（bump）；`stale → active` 只允许在**同一个** bump 事务内经 D06 预检保留（被取代 run 处于 `pending_approval`、提案在新约束下 `passesChecks`），`rejected` 永不回到 `active`。**修正草稿**：删除 `endorsed`、`approved`（分别由 `run.status === 'pending_approval'` 与审批集合派生） |
| approval.decision | `approve` \| `reject` \| `withdraw` |
| humanRequest | `open` → `answered` \| `expired` \| `superseded`（`closedReason` ∈ `constraints_changed` / `renegotiation_requested` / `run_canceled` / `room_closed` / `regenerated`；`regenerated` 照记 `answerOptionKey`） |
| catalogItem | `draft` → `confirmed` → `retired`（→ 重新上架为 `confirmed`）；表纯只追加，每次状态变化都是插入新行，`draft` 行从不修改（03 §3.7） |
| task | `open` → `done`（只有被指派人可勾选） |

派生而不存储：审批有效性（`effective` / `stale_approve` / `stale_reject` / `withdrawn`）、`committedCents`、`headroomCents`、房间阶段 `phase`、待办 `todos`，以及下面三个**命名固定**的判定（全仓各只有一个实现，归 06 / 08）：

- `passesChecks(p, RuleInput@cv, localDate)`：规则检查全部通过（`checkProposal(...).blocking = ∅`），只看规则；
- `isExecutable(p)` = **当前性** ∧ `passesChecks`：当前性 = `room.status === 'open'` ∧ `run` 是 `room.currentRunId` 且 `pending_approval` ∧ `run.currentProposalId === p._id` ∧ `p.status === 'active'`；**不含**审批集合，**不**比较 `createdAtConstraintsVersion`；
- `allApproved(p)` = `evaluateApprovalSet` 判定集合已齐（D02）；`canExecuteNow(p)` = `isExecutable(p) ∧ allApproved(p)`，是 `executeIfComplete` 的执行条件。D02 的"approve 前同事务跑 `isExecutable`"指上面的定义（最后一票之前它就可以为真）。

### 1.4 动作枚举与模型输出根

模型输出根固定为 `{ turn: AgentModelOutput }`（strictObject，全部 required，`nullable` 代替 optional，无 `z.record`、无 `.default()`；schema 中不得出现任何金额、约束版本 / 目录修订号等快照字段、身份（userId / role / memberId）属性名——写成属性名白名单测试；**显式例外**只有三个引用字段：提案引用 `proposalVersion` / `baseProposalVersion`（小整数，服务端只在本 run 的提案历史内解析）与收件人枚举 `toRole`）。`AgentModelOutput.action` ∈：

| action | 载荷 | 角色 × 回合 |
| --- | --- | --- |
| `propose` | `{ optionKey, rationale }` | proposer（provider）propose 回合 |
| `counter` | `{ optionKey, baseProposalVersion, rationale }` | customer evaluate 回合（finance 不能 counter） |
| `clarify` | `{ toRole, topicKey, rationale }` | 任一回合；topicKey 来自场景话题表，无自由文本问题；**任何角色**的话题表都没有 `option_fits_constraints`（D12 ③） |
| `recommend_accept` | `{ proposalVersion, rationale }` | evaluate 回合 |
| `reject` | `{ proposalVersion, reasonKey, rationale }` | evaluate 回合；provider 在 propose 回合可用 `reasonKey: 'cannot_deliver'` |
| `escalate` | `{ kind: 'infeasible' \| 'needs_tradeoff', toRole, rationale }` | 任一回合；是否真的打扰人由代码判定 |

废弃：`request_tradeoff`、`approve`、`accept`、`decline`、`object`、`ask_principal`、`addressee`、`baseProposalId`、`question: string`。`rationale` 只给本方（≤ 1,200 码点），永不进入他方上下文。模型只能引用它见过的 `optionKey`、提案 `version`（小整数）、`topicKey`、`reasonKey`、`toRole`。

### 1.5 reasonCode 风格

小写点分、按域分组，单一来源 `core/engine/reasonCodes.ts`，Convex validator 与 Zod enum 由同一数组派生：`output.*`（`not_json` / `schema_violation` / `truncated` / `refusal` / `unknown_reference`）、`action.*`（`not_allowed_for_role` / `option_not_in_snapshot` / `repeats_blocked`）、`item.*`（`unknown` / `unconfirmed` / `retired` / `required_missing` / `duplicate` / `limit_exceeded`——目录超过 12 个 item 或 2 个 modifier）、`date.*`（`invalid` / `in_past` / `after_deadline` / `before_lead_time` / `out_of_range`）、`budget.*`（`over` / `below_committed`——新上限 < 已承诺、基线 > 已确认上限、`raise_cap` 目标 < 已承诺三处同码，D23）、`amount.*`（`claim_mismatch` / `out_of_range`）、`version.*`（`stale_constraints`——规则检查里表示提案落后于当前 cv，写入时表示约束写入的 `expectedConstraintsVersion` 与房间不符 / `stale_source`）、`approval.*`（`stale` / `missing_role`——只作 `evaluateApprovalSet` 的槽位原因，不用于"调用者不是必需审批人" / `self_conflict` / `not_current` / `already_executed` / `not_executable`）、`disclosure.*`（`blocked` / `needs_own_confirmation`）、`run.*`（`call_limit`——run 的 attempt 或美元上限，二者靠请求的 `questionKey` 区分 / `draining` / `invalid_state`，`params.guard` ∈ `room_status` \| `run_status` \| `run_changed` \| `not_ready` \| `baseline_exists` \| `brief_missing` \| `no_failed_turn` \| `scenario_version` / `rate_limited`——D12 ⑥ 的任一节流桶）、`private.*`（`constraint_unmet`——对非所有者的掩码码，不带 checkId）。

API 层的码与上面同一文件、同一风格（12 §12.4 是触发条件与前端处理的唯一表）：`auth.*`（`unauthenticated` / `user_not_provisioned` / `not_member`——非成员与目标不存在不可区分 / `role_forbidden`——角色不在允许集，含非必需审批人调 `approvals.record`、非 `toRole` 回答请求、非被指派人勾选任务 / `not_creator`）、`invite.*`（`invalid`——不存在、过期、被取代、已被使用、邮箱或哈希不符统一一个码防探测 / `email_unverified` / `seat_taken` / `already_member`）、`request.*`（`not_open` / `option_unknown`）、`input.*`（`invalid`——长度 / 字符集 / 枚举 / 条数，含 `reasonKey` 不在场景枚举）与顶层 `internal`（非 `ConvexError` 异常或内部不变量被破坏）。**不是错误**的重复调用返回成功值 `{ status: 'unchanged' }`，不写行、不写事件、不计节流：同一决定双击、本人无当前 cv 上的 approve 时 `withdraw`、投影不变的约束写入、已终态 run 的 `runs.cancel`。场景版本未注册不另设 `config.*`，用 `run.invalid_state{ guard: 'scenario_version' }`。废弃大写下划线（`OVER_BUDGET`、`STALE_CATALOG`、`DATE_MISMATCH`、`NOT_FOUND`、`INVITE_USED` 等）与 `approval.nothing_to_withdraw` / `approval.invalid_reason` / `config.invalid` / `run.spend_limit`。`params` 按受众裁剪，未标注受众的参数一律丢弃（fail-closed）；provider 永不收到 `overByCents` / `headroomCents` / `deadline`。

### 1.6 核心函数名（12 章以此为准）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `rooms.create` / `rooms.close` / `rooms.view` / `rooms.listMine` / `rooms.startFollowUp` | mutation / query | `close` 仅 creator；`startFollowUp` 见 D04（只能从 `executed` 房间发起） |
| `rooms.previewChange` | query（memberQuery） | 约束变更前的影响预览，按角色分支（D12 ②）：只有 finance 改上限得 `verdictAfter`（只含当前提案的预算检查），其他变更得 `recheck`，变更种类不属于查看者 → `null`；返回形状以 12 §12.17 为唯一定义 |
| `invites.create` / `invites.listMine` / `invites.accept` | mutation / query | `create` 为邮箱定向邀请（creator）；单一 accept 写入口，经 `addMember` 做一人一席检查 |
| `invites.createLink` | action（**唯一公开 action**） | 不知道邮箱时的单次链接：action 内生成随机 token 与 `tokenHash`，经 internal `invites.authorizeLink` / `invites.insertLink` 写入（mutation 内随机数确定性播种，不宜做令牌，D24） |
| `briefs.confirm` / `briefs.mine` | mutation / query | 确认即新版本；含披露勾选；硬字段变化经 `constraints.bump` |
| `budget.setCap` | mutation | finance 便捷入口 → 新 finance 简报版本；`newCap >= committedCents` 否则 `budget.below_committed` 拒绝 |
| `ledger.recordBaseline` | mutation | finance 在 `setup` 阶段录入一次（可为 0）；上限已确认时要求 `baseline ≤ capCents`（D23） |
| `sharedFacts.add` | mutation | `{ roomId, field, audience, confirmOwnDisclosure }`，**没有 value 参数**：值只从调用者本人当前已确认简报复制（finance 的 `committedCents` / `headroomCents` 取自台账派生值），`audience: []` 表示撤回；闸门 = 字段在 `SHAREABLE_FIELDS` 且受众在允许集内（否则 `disclosure.blocked`）+ 本人硬字段对他方披露须二次确认（否则 `disclosure.needs_own_confirmation`）；不把值与他方秘密比对（比对结果本身是预言机，07 LP-3） |
| `catalog.confirm` / `catalog.retire` | mutation | `confirm` 一次确认一批 `rows[]`（≤ 14 行，计一次节流）；价格 / 工期 / 增删 / 下架触发 bump；仅标题 / 任务模板不触发 |
| `proposals.get` / `catalog.list` / `turns.mine` / `executions.forRoom` | query（memberQuery） | 按查看者投影；`proposals.get` 含审批历史 `decisions`（`reasonKey` 按 D13 受众裁剪） |
| `tasks.markDone` | mutation | 只有被指派角色的成员可勾选（`auth.role_forbidden`）；`executed` 房间里允许（D04 豁免之一）；已 `done` → `unchanged` |
| `runs.start` / `runs.retryTurn` / `runs.requestRenegotiation` / `runs.cancel` | mutation | 守卫见 04；`runs.start` 任一成员（已有非终态 run 时幂等返回、不计节流）；`requestRenegotiation` / `cancel` 仅 creator；前三者受 `rate_limited` 节流 |
| `turns.beginAttempt` / `turns.complete` / `turns.fail` / `runs.reconcile` | internal mutation | 守卫 D07；`reconcile` 保证活性 |
| `agents.runAttempt` | internal action | 调模型；schema 在 action 内按 role 构造 |
| `agents.watchdog` | internal mutation | 参数 `{ attemptId }` |
| `approvals.record` | mutation | 只追加；含 `expectedConstraintsVersion`、`expectedTermsKey` |
| `executions.executeIfComplete` | internal helper | 由 `approvals.record` 同事务调用 |
| `humanRequests.answer` | mutation | 仅 `toRole` 成员；`request.not_open` / `request.option_unknown` |
| `humanRequests.expireDue` | internal mutation（cron） | 到期请求 → `expired`，其 run → `ended_no_agreement`（D15） |
| `constraints.bump` | internal helper | 唯一递增入口，含 `react()` 不动点循环 |
| `clock.rollLocalDate` | internal mutation（cron） | 推进 `rooms.localDate`，必要时 `constraints.bump(cause: 'clock')` |
| `events.append` | internal helper | 唯一写事件入口，分配 `(commitTs, seq)` |
| `timeline.page` | query | 按查看者渲染模板 |
| `ops.setDraining` / `ops.livenessSweep` / `ops.activeAttemptCount` / `ops.purgeRawOutputs` | internal mutation / query | **全部层级（含 prod）**可用，只经 CLI 与部署 admin 权限调用（发布排空需要在 prod 置位，D17）；`livenessSweep` 为 cron 兜底（对无在途 attempt 的 `negotiating` run 调 `runs.reconcile`） |
| `seed.fromFixture` / `seed.reset` | internal mutation | 仅 dev / preview / test（`assertTier`）；reset 按部署名守卫；prod 不存在（D18） |
| 事务内 helper（不注册为 Convex 函数；名字以此为准） | — | `openRoomTx`（房间写锁 + 状态白名单 `allow`）/ `addMember` / `roomReadiness` / `openIfReady` / `withConstraintChange` / `disposeCurrentRun` / `startRunTx`（创建 run 的唯一 helper，公开 `runs.start` 与 `react()` 共用）/ `createTurnTx` / `beginAttemptTx`（`turns.beginAttempt` 的事务内形态，唯一调度接缝，D01；10 §10.5）/ `rollLocalDateTx`（`clock.rollLocalDate` 与物化前推进共用，D22）/ `scenarioOf(room)`（`convex/scenarios/registry.ts`：按房间钉住的 `scenarioKey@scenarioVersion` 取插件，未注册 → `run.invalid_state{ guard: 'scenario_version' }`，11 §11.3）/ `replaceTurnTx` / `advanceRun` / `openHumanRequestTx` / `insertProposal` / `appendCatalogRow` / `setStatus`（迁移表断言）；internal query `agents.loadTurnContext` / `replayRuleInput`。废弃别名：`startRunInternal` / `scheduleTurn` / `openHumanRequest` / `finishRun` / `assertAttemptLive` / `replayRuleView` / `tasks.complete` / `humanRequests.expire` |
| 纯函数（core/engine） | — | `checkBudget` / `checkProposal` / `passesChecks` / `isExecutable` / `canExecuteNow` / `enumerateCandidates` / `evaluateApprovalSet` / `resolveRound` / `allowedActions` / `projectForRole` / `renderPublicText` / `toStrictOutputSchema`（JSON Schema → 严格 JSON Schema 的纯变换，D09 / D21） / `canonicalJson` / `buildHumanRequests`；场景插件 `hardProjection` |
