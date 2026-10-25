# 02 · 领域模型（part7）：守卫 × 不变量矩阵、反例映射、开放问题、与 canon 的对照

> 分片清单见 `02-domain-model.md` 顶部。

## 2.12 守卫 × 不变量矩阵（函数 → 它守住的不变量）

| 函数 / 机制（定义章） | 守住 |
| --- | --- |
| 构造器 `userQuery` / `userMutation` / `memberQuery` / `memberMutation` + `requireRole` / `requireCreator`（07、11） | INV-14、INV-17、INV-44 |
| `users.ensureViewer`（12） | INV-17 |
| `addMember`，经 `rooms.create` / `invites.accept` / `rooms.startFollowUp`（03、07） | INV-15、INV-16 |
| `openRoomTx` / `RoomTx`（03） | INV-M1、INV-52；为 INV-27、INV-29、INV-46、INV-67 的"先查后写"提供确定的冲突点 |
| `insertBriefVersion` → `materializeDisclosures` → `appendSharedFact`（03、07） | INV-01、INV-02、INV-18、INV-19、INV-39、INV-43 |
| `appendCatalogRow`（03、09） | INV-05、INV-24、INV-37、INV-38、INV-43 |
| `appendLedgerEntry`（03、08） | INV-39、INV-50 |
| `withConstraintChange` → `constraints.bump` → `react()`（09） | INV-24、INV-32、INV-33、INV-57、INV-75 |
| `clock.rollLocalDate`（09、15） | INV-36、INV-77 |
| `startRunTx`（04） | INV-33、INV-64、INV-67、INV-75 |
| `createTurnTx`（04） | INV-09、INV-22、INV-68 |
| `turns.beginAttempt`（04、10） | INV-68、INV-70、INV-72 |
| `agents.loadTurnContext` / `buildAgentContext`（07、10） | INV-03、INV-08 |
| `agents.runAttempt` / `modelGateway`（10） | INV-04、INV-40、INV-42、INV-66 |
| `turns.complete` / `turns.fail` / `agents.watchdog`（04、05、10） | INV-23、INV-40、INV-41、INV-69、INV-71 |
| `runs.reconcile`（04） | INV-69、INV-70 |
| `advanceRun` / `resolveRound` / `setStatus`（04、05） | INV-74、INV-76 |
| `insertProposal`（03、05、06） | INV-28、INV-36、INV-37、INV-55 |
| `openHumanRequestTx`（04、05） | INV-10、INV-34、INV-64 |
| `humanRequests.answer` / `humanRequests.expireDue`（04、05） | INV-34、INV-65、INV-73 |
| `approvals.record`（08） | INV-20、INV-25、INV-27、INV-29、INV-30、INV-31 |
| `passesChecks` / `isExecutable` / `evaluateApprovalSet`（06、08） | INV-26、INV-27、INV-35 |
| `executions.executeIfComplete`（08） | INV-21、INV-46 – INV-49、INV-53、INV-60 |
| `appendEvents` / `timeline.page`（03、07） | INV-12、INV-56 |
| `projectForRole` / `projectChecks` / `renderPublicText`（07） | INV-01、INV-05、INV-06、INV-08、INV-11 |
| `assertWithinRate`（03、12） | INV-11、INV-72 |
| `privacy.redact`（运维人工发起，03、15） | INV-54；`REDACTABLE_FIELDS ∩ termsKey = ∅` 保 INV-07 / INV-55 |
| `seed.fromFixture` / `seed.reset`（14、15） | INV-62、INV-63 |
| CI 结构测试与 lint（11、16） | INV-20、INV-21、INV-51、INV-54、INV-59、INV-60 |

## 2.13 反例电池映射（实体 → 最关键的反例，编号取自 00-invariants part7–part11）

| 实体 / 机制 | 反例 | 层 |
| --- | --- | --- |
| members / invites | CE-020（同一人两席）、CE-021（同 token 二次接受）、CE-022（邮箱不符 / 未验证）、CE-023（token 出现在路径）、CE-120（并发抢同一席） | CT / RD / E2E |
| briefs / sharedFacts | CE-001、CE-003、CE-029（把他方上限写成共享事实）、CE-030、CE-032（事后披露泄露历史值）、CE-034、CE-044、CE-045 | CT / P |
| catalogItems | CE-011（改价零成本预言机）、CE-014（草稿预言机）、CE-024（标题注入）、CE-043、CE-046（只改标题不 bump）、CE-087、CE-089、CE-091（rush 常量） | CT / P |
| ledgerEntries / 预算 | CE-016、CE-017、CE-073（恰等于上限）、CE-074（减一分）、CE-113、CE-117（双击录基线）、CE-155（seed 伪造低于已承诺） | P / CT |
| constraintRevisions / bump | CE-042、CE-057（绕过唯一写入口）、CE-059（上调也 bump）、CE-062、CE-064、CE-065、CE-066、CE-067（react 深度）、CE-069 / CE-070（跨午夜） | CT |
| runs / turns / attempts | CE-121 – CE-127（迟到、看门狗、积压、纵深 G3）、CE-133 – CE-137（单活跃、节流、上限、排空、日美元）、CE-140、CE-157、CE-160、CE-161 | CT / RD |
| proposals | CE-003、CE-004、CE-053（不比较创建时 cv）、CE-078、CE-088（重复阻断键）、CE-092、CE-132（被拒提案复活） | CT / P |
| approvals | CE-036、CE-041、CE-047 – CE-056、CE-058、CE-095 / CE-096（双击）、CE-097（并发最后两票）、CE-100、CE-101（withdraw 与最后一票并发）、CE-105 | CT / RD |
| humanRequests | CE-007、CE-008、CE-033、CE-060、CE-061、CE-138（needs_input 无请求）、CE-139、CE-142、CE-144、CE-145 | CT |
| executions / changeOrders / tasks | CE-097、CE-099、CE-106 – CE-112、CE-114 – CE-116、CE-118、CE-150、CE-152 | CT / RD / E2E |
| events | CE-015、CE-016、CE-033（provider 只见 `run_waiting`） | CT / E2E |
| 房间写锁 M-ROOM | CE-096、CE-097、CE-099 – CE-101、CE-119、CE-120（全部 RD，`maxOverlap >= 2` 才算有效样本） | RD |
| 核心 7 / 核心 8 | CE-147、CE-148、CE-151；CE-152、CE-153、CE-155、CE-156 | CI / CT / E2E |
| 端到端组合 | CE-165 – CE-170（D27 主线、$4,700、follow-up、双击最后一票、断线重连） | E2E |

## 2.14 开放问题

| # | 问题 | 本章当前处理 | 需要对齐的章 |
| --- | --- | --- | --- |
| Q1 | （已关闭）`isExecutable` 不含审批集合：canon §1.3 / C44 已定义 `isExecutable = 当前性 ∧ passesChecks`、`canExecuteNow = isExecutable ∧ allApproved`，04 / 08 / 12 / 13 已同口径 | 2.8 | — |
| Q2 | （已关闭）`rooms.currentRunId` 指向最新 run（任何状态，终态不清空），只由 `startRunTx` 写：canon §1.2 / C49 与 00-invariants INV-67 已改写 | 按 04 | — |
| Q3 | （已关闭）撤回时没有可撤回的 approve：返回 `unchanged`、不插行（08 §8.5.5、12 §12.15） | INV-29 已按此写 | — |
| Q4 | （已关闭）INV-M1 已并入 00-invariants-part6 §1.11，canon §1.2 已登记 `writeSeq`；16 的 RD 套件以"移除写锁"为变异对照（16 TC-EXE-12） | 本章与 03 §3.3 | — |
| Q5 | 原因与事件名的别名：INV-57 `request_answered` vs 09 `human_answer`；INV-75 `briefs_confirmed` vs 04 `room_opened`；`execution_completed` vs `room_executed` | （已关闭）以 09 §9.3 与 03 §3.11.1 为准；00-invariants 的 cause 名已由 canon 包改写（names-18），10 / 14 / 15 / 16 的旧事件名已在跨章核对阶段回改 | — |
| Q6 | 第二场景若不是"目录子集选择"形状（如排期协调） | `terms` 改为以 `schemaKey` 判别的联合，05 / 06 的 TurnSpec 与 `enumerateCandidates` 需随之泛化；v1 不预建（DM-13） | 17 |
| Q7 | 一角色多人、跨房间共享预算 | `self` 以角色为单位、台账按房间；二者都需要重新建模（`budgetAccounts`、席位 1..n） | 17 |
| Q8 | provider 将来若有硬约束（如最早开工日） | 必须进入 `RuleInput` 与硬投影，否则成为"已声明却未校验"的硬约束（INV-39） | 06、09、14 |

## 2.15 与 canon 的对照

| canon | 本章落实 |
| --- | --- |
| §1.1 实体与表 | 2.2 逐一列出 canon 全部实体（含 `constraintRevisions`、运维表），可变性、唯一写者、所有者与"不要它行不行"；2.3 登记全部废弃别名与职责去向 |
| §1.2 关键字段 | `constraintsVersion` / `constraintsVersionAtStart` / 回合快照 / `localDate` / `termsKey` / `boundConstraintsVersion` / `boundTermsKey` / `executionKey` / 三段 `taskKey` / `candidateKey` / `optionKey` / `provenance` / `actorUserId` / `toRole` / `reasonKey`、金额 `*Cents` 与 `IsoDate` 命名（2.9） |
| §1.3 状态与派生 | DM-01；2.8 把可执行性、审批有效性、`committedCents`、`headroomCents`、阶段、待办全部定义为派生 |
| D02 审批只追加 | DM-04；INV-25 – INV-31 |
| D03 执行键与时机 | `executionKey = exec:${proposalId}`、最后一票同事务执行、执行不 bump（INV-46、INV-47、INV-53） |
| D04 一房一执行 | DM-06；INV-52、INV-58；`followsExecutionId`（每个 execution 至多一个后续房间，只复制未执行条目为草稿） |
| D05 递增矩阵与硬投影 | DM-02；INV-24；目录定价修订号（2.5、2.6） |
| D06 约束变化后 run | INV-32；2.7.4 走查；"当前提案"属于当前 run（`runs.currentProposalId`） |
| D07 / D08 守卫与串行 | INV-68 – INV-71；三层中 turn 持快照、attempt 持身份（2.7.1） |
| D09 / D16 模型输出与日志 | INV-04、INV-13、INV-40、INV-42；原文只在 `rawOutputs` |
| D10 只选 optionKey | INV-09、INV-23、INV-41 |
| D11 / D13 派生字段与公共文本 | DM-08；INV-05 – INV-08、INV-10；删除 `deferredItemKeys`，customer 视图现算；他方可见性只读 `sharedFacts` 最新行（版本绑定，INV-01 / INV-19）；掩码投影 `projectChecks`（07 §7.11，INV-06）；解密清单 DX-1…DX-13（INV-08） |
| D12 fit 与预言机政策 | INV-11；provider `fit` 只对当前提案（2.8）；简报与共享事实里的 itemKey 必须属于本房间曾确认过的 item 键（INV-18，写入时闸门 ⑧） |
| D14 事件 | INV-12、INV-56；payload 只含房间字段 + `restrictedRef`；`restrictedRef` 目标为 canon D14 列出的八表（含 `approvals` / `constraintRevisions` / `sharedFacts` / `executions`，C59，03 §3.11） |
| D15 人工请求 | INV-34、INV-64、INV-65、INV-73；没有 `paused`；`disclose` 效果带 `toRoles`（受众显式化，与 canon D15 现文一致，03 §3.9），infeasible 回退请求以 `disclose` 回答后重跑预检（INV-73、04 R20）；`pass_to_next` 只在 infeasible 请求、按位置提供（04 R21） |
| D17 上限与排空 | INV-72；attempt 即用量账本（2.7.2）；stub 不受排空与 `AGENTS_ENABLED` 影响（INV-66）；美元与 attempt 计数为 system 类（2.2） |
| D18 seed / reset | INV-62、INV-63；`privacy.redact` 是运维人工发起、只覆写 `REDACTABLE_FIELDS` 的 PII 抹除，不删行（INV-54；canon D18 原文未写此豁免，03 §3.20 Q11） |
| D21 单包布局 | 派生函数与规则在 `core/engine` / `core/scenarios/scope-change`，Convex 只做读写与鉴权（2.8 实现列） |
| D22 时间 | DM-12；INV-36、INV-77 |
| D23 预算低于已承诺 | DM-07；INV-39 |
| D24 成员与邀请 | DM-11；INV-15 – INV-17 |
| D25 提案不可变与快照 | DM-03；INV-37、INV-55；rush 为目录修饰项 |
| D26 v1 范围 | 无简报草稿与抽取、无外部集成实体（DM-14、2.3） |
| 核心 7 新增不变量（canon part6 must_absorb） | INV-59 – INV-61：外部 ERP / 支付 / 签署 / 邮件 SDK 零依赖、执行只写内部表、变更单固定免责声明 |
