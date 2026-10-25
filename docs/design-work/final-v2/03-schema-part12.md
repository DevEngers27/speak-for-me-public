# 03 · Convex schema v1（part12）：演进、测试清单、开放问题与待验证、与 canon 的对照

> 分片清单见 `03-schema.md` 顶部。

## 3.18 schema 演进

1. **扩展 → 回填 → 收缩**（techstack D10）：新字段先以 `v.optional` 推送，用 internal mutation 分批回填（首个需要回填的变更时安装 `@convex-dev/migrations` 0.3.7），最后收紧；大表新索引用 `.staged()`。新增可变字段必须同步改 `MUTABLE_FIELDS`（11 §11.7 以本章为准，CI 类型断言 `MUTABLE_FIELDS[t] ⊆ keyof Doc<t>`）。
2. **只追加表永不做破坏性迁移**：修正历史 = 追加一条修正记录并写事件，而不是改旧行；唯一例外是 `privacy.redact`（3.16.2）。
3. **场景版本钉住**：房间固定 `scenarioVersion`，旧版本的规则、模板、任务派生保留在场景模块里，直到没有房间引用；第二场景 = `briefs.hardFields / softFields` 与 `scenarioKey` 联合加成员、`terms` 若不再是"目录子集选择"形状则改为以 `schemaKey` 判别的联合（17），引擎表结构不变。
4. **四包拆分**（canon D21 的触发条件出现时）不改 schema：`convex/schema.ts` 原样移入 `@sfm/backend`。
5. **新表的准入**：只有当某职责无法由现有表承担时才建表（本章 3.1 的每条否决都是这条规则的应用）；新表必须同时登记写门面分类、`DISCLOSURE`、唯一写入口与 3.14 / 3.15 两表。

## 3.19 测试清单（层：P 纯函数 / CT convex-test `[serial]` / RD 真实部署 / CI 静态）

| # | 断言 | 层 |
| --- | --- | --- |
| SC-T1 | `convex codegen --system-udfs --typecheck disable` 离线生成的 `_generated` 与提交版本一致；`tsc --noEmit` 通过（canon D20） | CI |
| SC-T2 | 每个 `*V` 与 `core` 常量双向类型相等（3.2 第 1 条）；`agentMoveV` 与 05 的 Zod 双向可赋值；`requestEffectV` 与 05 §5.11.1、06 §11.1 的 `Effect` 双向可赋值（含 `disclose.toRoles`）；`requestOptionShownV` 与 06 §11.1 的 `RequestOption.shown` 双向可赋值；`testFaultV` 与 10 §10.18.2 的故障词表相等 | CI |
| SC-T3 | 经每个写入口写入负数、小数、`NaN`、超上限金额、空串、`2026-02-30`、窗口外日期、超长文本、非法 itemKey → 精确失败码且零写入；格式合法但不属于本房间曾确认过的 item 键（如 `cap_480000`）写入简报或共享事实 → `item.unknown`（大写 `CAP_480000` 先因键格式得 `input.invalid`）；披露一个已 retired 的必需项成功 | CT |
| SC-T4 | 结构测试：门面外无 `ctx.db.patch / replace / delete`；关键表的 `insert` 只出现在 3.13 白名单文件；`commitTs` 只在 `appendEvents` | CI |
| SC-T5 | 房间作用域表的写入必须持有 `RoomTx`（类型测试）；`executed` 房间除 `tasks.markDone` / `rooms.startFollowUp` 外的写入得 `run.invalid_state` | CI + CT |
| SC-T6 | 递归遍历 schema：无以 `_` / `$` 开头的字段名；不存在 `deferredItemKeys`、`contentHash`、`catalogRevision`、`operationId`、`budgets`、`modelCalls`、`usageCounters`、`visibility` 等已废弃名（防回潮） | CI |
| SC-T7 | `REDACTABLE_FIELDS ∩ TERMS_KEY_FIELDS = ∅`（编译期）；抹除后全部 `termsKey` / `boundTermsKey` / `executions.termsKey` 不变 | CI + CT |
| SC-T8 | `eventPayloadV` 的字符串叶子 ⊆ `EVENT_STRING_FIELDS`；payload 中无私密数值字段名（`capCents`、`committed*`、`headroom*`、`deadline`） | CI |
| SC-T9 | 3.14 每一行：串行下重复调用得到 `unchanged` / 已有结果 / 精确错误码，行数不变 | CT |
| SC-T10 | 3.14 中依赖 OCC 的行（成员、审批 seq、`executionKey`、单活跃 run、`nextProposalVersion`、事件 `seq`、每个 execution 至多一个后续房间）：多 `ConvexHttpClient` 并发探针，`maxOverlap >= 2` 才算有效样本（16、spikes §8 #1） | RD |
| SC-T11 | 目录 revision 契约表驱动（3.7）；性质：只改 `title` / `taskTemplates` ⇔ `hardProjection` 不变且 `lines[].revision` 仍等于当前行 | P + CT |
| SC-T12 | `sharedFacts`：最新行按 `seq` 取；撤回行隐藏；历史值按 `briefVersion` 时生效的受众判定（07 TC-PRIV-14）；finance 金额字段写给 provider → `internal` | CT |
| SC-T13 | provenance 继承 `seeded > stub > live`；live 房间里 stub run 的 `human_choice` 提案及其执行、变更单、任务、`ledgerEntries(commit)` 为 `stub`；stub 执行的后续房间为 `stub`；`seed.fromFixture` 只经生产写入口（无 `t.run` 直插） | CT |
| SC-T14 | 节流：同一事务多条命令事件只计一次；`unchanged` 与被拒调用不计数；第 7 次得 `run.rate_limited`，先写入 ≥ 50 条同一成员的无关事件（审批、任务完成）后依然如此；`setup` 期的确认不计入 `price_writes` / `hard_writes`；人工 `runs.start` 与系统开局读同一个 `run_starts` 计数（3.11.3） | CT |
| SC-T15 | 任何公开 query 的 `returns` 中没有 bigint / `commitTs`；`rawOutputs`、`constraintRevisions`、`ledgerEntries` 无可达的公开读函数（API 面扫描） | CI |
| SC-T16 | `DISCLOSURE` 覆盖 schema 的全部叶子路径（07 TC-PRIV-10） | CI |
| SC-T17 | 每个 convex-test 场景 `afterEach` 跑 08 的对账 R1–R11 与 09 的 `assertFixedPoint`（F1–F4） | CT |
| SC-T18 | provider 选中被规则阻断的候选：`proposals` 行数与 `rooms.nextProposalVersion` 不变，`turns.outcome.blockedCandidateKey` 记录该键并进入 `excludedCandidateKeys(run)`，provider 的提案历史不出现它（05 P10、04 §4.3.4、06 §9.2） | CT |
| SC-T19 | `rooms.startFollowUp` 对同一 execution 串行重复调用：返回同一 `roomId`（`created: false`），新房间、成员、目录草稿行数不变；`by_followsExecutionId` 每个 execution 至多一行 | CT |

## 3.20 开放问题与待验证

| # | 问题 | 当前处理 | 影响章 |
| --- | --- | --- | --- |
| V-S1 | `v.commitTs()` 在 1.48 的确切拼写与写入方式；不同事务的 `commitTs` 是否必然不同（techstack O4） | 按 techstack D02/X3 写；房间写锁使同房间事务串行，索引键含 `roomId` | 11、16 |
| V-S2 | 索引区间读是否进入读集（versioned-approvals V3） | 房间写锁让正确性不依赖它；仍进 RD 套件 | 08、16 |
| V-S3 | `NaN` / `Infinity` 写入 `v.number()` 的真实部署行为（spikes §8 #5） | 代码校验先拦 | 16 |
| V-S4 | `v.id("_scheduled_functions")` 作字段（run-lifecycle V6） | 存 `v.string()`，读时 `ctx.db.system.normalizeId` | 10 |
| V-S5 | mutation 内 `crypto`（链接邀请 token）、运行时 `Intl` 时区（V-D2） | token 在 action 内生成；时区按 techstack D37 | 07、15 |
| Q2 | （已关闭）INV-67 已改为"`currentRunId` 指向最新 run、终态不清空、只由 `startRunTx` 写"（canon §1.2 / C49） | — | — |
| Q5 | （已关闭）事件名别名：14 §11 A1 / A3、16 TC-RUN-03、15 §15.7、10 §10.16.3 与 00-invariants 的 cause 名已在各包与跨章核对阶段回改 | 3.11.1 末列只作历史映射 | — |
| Q6 | `self` 类自由文本（`rationale`、`softFields.notes`）在生产房间的保留期与删除路径 | v1 生产无删除；`notes` 可抹除，`rationale` 列入 15 / 17 的保留策略 | 15、17 |
| Q10 | 目录 / 任务标题可能被填入个人信息 | 不入 `REDACTABLE_FIELDS`（业务快照），确认页提示 | 13 |
| Q11 | （已关闭）canon D18 已写明 `privacy.redact` 是只追加表的唯一例外（只覆写 `REDACTABLE_FIELDS`、不删行、无自助删除）；16 TC-PRIV-22 覆盖抹除后 `termsKey` / `boundTermsKey` 不变与 `pii_redacted` 事件（SC-T7） | — | — |
| Q12 | （已关闭）canon D15 已改为 `disclose { field, toRoles }`；12 §12.14 已改为读 `toRoles` | — | — |
| Q13 | （已关闭）canon D14 已列出 `restrictedRefV` 的八表（C59） | — | — |
| Q14 | （已关闭）每个 execution 至多一个后续房间：本章 SC-T19（串行）、SC-T10（并发）与 16 TC-EXE-11（双击与并发 `startFollowUp` 只建一个房间） | — | — |

## 3.21 与 canon 的对照

| canon | 本章落实 |
| --- | --- |
| §1.1 实体与表 | 22 张表全部使用规范名；废弃别名（participants、decisions、commitments、modelCalls、budgets、offerItems…）一律不存在（SC-T6）；`constraintRevisions`（canon §1.1 已收录）按 09 §9.3 落地；运维表 `opsFlags` / `spendCounters` 与内部表 `rawOutputs` |
| §1.2 关键字段 | `rooms.constraintsVersion / localDate / timeZone / nextProposalVersion / followsExecutionId`、`runs.constraintsVersionAtStart`、`turns.constraintsVersion`、`termsKey = canonicalJson(terms)`、`boundConstraintsVersion / boundTermsKey`、`executionKey = "exec:" + proposalId`、三段 `taskKey`、`candidateKey`、`provenance`、金额 `*Cents` + `assertCents`、`IsoDate` |
| §1.3 状态 | 各表 `status` 字面量与 canon 逐一相同；`paused`、`endorsed`、`approved`、`blocked` 不存在；派生量不入库 |
| D02 | `approvals` 只追加、`seq`、`by_proposal_user` 单索引服务整区间读与本人最新行 |
| D03 | `executions.by_executionKey` 先查后插；执行不 bump（无 cv 写入）；客户端不传幂等键 |
| D04 | `rooms.status: executed` 终态、`executionId`、`followsExecutionId`（`by_followsExecutionId`：每个 execution 至多一个后续房间；后续房间只复制未执行条目为草稿）；`openRoomTx` 默认拒绝 `executed` 房间写入；`approvalIds` 冻结快照 |
| D05 / D25 | 硬投影字段全部有存储落点；目录定价修订号 `revision` + 展示修订号 `editNo`；无 `catalogRevision`；`proposals` 只有 `status` 可变，`lines[]` / `plannedTasks[]` 快照；rush 是 `catalogItems(kind: modifier)` |
| D06 | `runs.currentProposalId` 表达"当前提案"；`proposals.runId` 只是来历；`stale → active` 只在同一 bump 事务 |
| D07 / D08 | `attempts.watchdogFnId / watchdogArmCount / deadlineAt`、`turns.currentAttemptNo / constraintsVersion`、`runs.activeTurnSeq`；无屏障计数器 |
| D09 / D16 | `attempts.usage / stopReason / stopCategory / requestId / schemaVersion / issuePaths`；模型原文只在内部表 `rawOutputs` |
| D10 | `turns.candidateSnapshot`（≤ 12、字典序、O1..On）由创建回合的 mutation 写入；剔除集合 `excludedCandidateKeys(run)` 派生不存（已提出——含被阻断——∪ 被人拒绝 ∪ `choose_candidate` 复核失败，与 05 / 06 / 14 及 canon D10 现文一致）；被阻断的候选不插提案（SC-T18） |
| D11 / D13 | 无 `deferredItemKeys`、无 `publicRationale`；`humanRequests.options` 投影后写入且有不可选的 `blocked` 项；目录 `title` 正则 |
| D12 | `events.by_room_actor` 索引计数节流；`sharedFacts` 的 finance 金额字段只许 `customer` 受众；简报与共享事实里的 itemKey 必须属于本房间曾确认过的 item 键（写入时闸门 ⑧，关闭伪 itemKey 信道）；⑥ 的每房间 24 小时桶：计数源字段 `catalog_item_confirmed.priceChanged` / `brief_confirmed.hardChanged`（3.11.1），只在 `open` 期间打 `rateRoom` 标记、经 `events.by_room_rate` 计数（3.11.3）；`run_starts` 读 `runs.by_room_runNo`，系统开局超出时 `turns.waitingReason: 'run_cap'`（3.8） |
| D14 | `events` 无 `visibility`，`(roomId, commitTs, seq)`，`restrictedRef`，`commitTs` 不进 DTO；`restrictedRef` 八表与 canon D14（C59）一致；`constraints_changed` 的 actor 恒为 system；`brief_confirmed` / `human_request_answered` / `turn_failed` 对 provider 另有变体（privacy-02 / 06） |
| D15 | `humanRequests` 形状、`expiresAt`（7 天）、`by_run_status` 保证每 run 一个 open；`disclose` 效果带 `toRoles`（与 canon D15 现文一致）；`pass_to_next { toRole }` 效果（canon D15 / C54） |
| D17 | `runs.maxAttempts / attemptCount / reservedMicroUsd / spentMicroUsd`、`spendCounters(global, day)`、`opsFlags.draining`（stub 不受排空与 `AGENTS_ENABLED` 约束，`activeAttemptCount` 只数 live）；美元与 attempt 计数为 `system` 类；无 `usageCounters` / 房间累计计数 |
| D18 | `provenance` 字段与继承；seed 只走生产写入口；`seed.reset` 是 dev / preview 唯一删除入口；`privacy.redact` 是运维人工发起、只覆写 `REDACTABLE_FIELDS` 的 PII 抹除，不删行（canon D18 现文已列为唯一例外） |
| D22 / D23 / D24 | `rooms.localDate` 只由 create、cron 与 `rollLocalDateTx` 写、交付日绝对日期；`ledgerEntries` 只追加 + `capCents >= committedCents`；成员两条逻辑唯一 + 邮箱定向 / 链接邀请两形态 |
