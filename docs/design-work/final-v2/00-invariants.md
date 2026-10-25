# 00 · 系统不变量总表、反例电池与覆盖矩阵（final-v2 · canon 对齐重写版）

> 口径：本文件完全服从 `00-canon.md`（§1 命名、§1.3 状态、§1.5 reasonCode、§1.6 函数名）与 `00-canon-part2..5.md`（D01–D27、C1–C42）。canon 已裁决的事项这里不再重新裁决，只把它们写成可测试的谓词；凡本文件与 canon 不一致，以 canon 为准。平台事实以 inputs/05 > inputs/04 为准，不确定处标"待验证"。
> 依据（本版新增吸收）：testing-ops 专题全部六片与三片反驳（L0–L4 分层、`[serial]` 诚实标注、`ConcurrencyEvidence`、派生数值金丝雀、`drainDue`、`opsFlags.draining`）；candidates/ 四份（invariants、security、runtime、product）的 02/04/08/09 与 judging/candidates1.json 的 12 名评委反例；idempotent-execution C1–C23 与反驳 r01–r10；versioned-approvals X1–X28 与反驳 r01–r15；negotiation-protocol E1–E18 与反驳 r08–r10；run-lifecycle E1–E17 与反驳 r01/r02/r04/r07；privacy-disclosure T1–T13；scenario-plugin SP-I1–I14 与反驳；inputs/07 全部 103 条；spikes README §8。
> 用途：02-domain-model 的不变量清单、04 的守卫、08/09 的时序、16 的用例矩阵都从这里取编号。
> **编号单一来源（canon C43）**：INV-01…79、INV-M1 与 CE-001…170 只在本文件定义（INV-79 / INV-M1 为跨章核对阶段补录，part6 §1.11）；16 章新增反例从 CE-171 起编号；00-overview 早稿引用的旧电池编号（CE-001…118）作废，须改引本文件编号。电池期望与定稿章节不一致时，改本文件，不在别处另立"修订后期望"。
> **canon 包修订（2026-10-24）**：按修订后的 canon（§1.1–1.6、D02 / D04–D07 / D09 / D12–D18 / D22–D25 / D27、C43–C60）与 03 / 04 / 05 / 07 / 08 / 09 / 10 / 12 / 14 / 16 定稿逐条改写了命名（helper、索引、cron 名）、cause 枚举、错误码、`currentRunId` 语义、首个 run 的开启方式、D06 收窄、D15 新出口与 `keep_as_is` 按 kind、D27 主线；16 §16.11.2 列出的修订已并入电池。记录见 `_fix/canon-log.md`；§0 末尾的"本次修订对齐表"列出改动点。

## 分片

| 文件 | 内容 |
| --- | --- |
| `00-invariants.md`（本文件） | §0 草稿 → canon 对齐表 |
| `00-invariants-part2.md` | §1 不变量总表 1.1 私密委托（INV-01 … INV-19） |
| `00-invariants-part3.md` | 1.2 代理只建议、1.3 人批准具体版本（INV-20 … INV-36） |
| `00-invariants-part4.md` | 1.4 代码负责校验、1.5 执行幂等且原子（INV-37 … INV-53） |
| `00-invariants-part5.md` | 1.6 历史不可篡改、1.7 执行边界、1.8 不伪造（INV-54 … INV-66） |
| `00-invariants-part6.md` | 1.9 运行生命周期与活性、1.10 时间与值域（INV-67 … INV-78）、1.11 核对阶段补录（INV-79、INV-M1） |
| `00-invariants-part7.md` | §2 反例电池 2.1 私密委托、2.2 代理只建议（CE-001 … CE-041） |
| `00-invariants-part8.md` | 2.3 审批与约束版本（CE-042 … CE-072） |
| `00-invariants-part9.md` | 2.4 规则引擎与协议、2.5 幂等与并发（CE-073 … CE-120） |
| `00-invariants-part10.md` | 2.6 生命周期与活性、2.7 执行边界、2.8 不伪造（CE-121 … CE-157） |
| `00-invariants-part11.md` | 2.9 测试基础设施（防假绿）、2.10 端到端组合（CE-158 … CE-170）；§3 覆盖矩阵、无反例覆盖的不变量、必须真实部署验证的反例；§4 开放问题 |

记法：`表.字段`；守卫写成 `函数 → 守卫(reasonCode)`；cv = `rooms.constraintsVersion`；"当前成员" = `members` 中该角色的行；测试层 **P** = 纯函数（vitest node，`core/engine` 与 `core/scenarios`）、**CT** = convex-test（串行语义，用例名带 `[serial]`，不得写成"并发安全"）、**RD** = 真实 dev / staging 部署（唯一能证明 OCC 的层，产出 `ConcurrencyEvidence`，重叠度 `maxOverlap >= 2` 才算有效样本）、**E2E** = Playwright 三账号 + WebSocket 帧扫描。真实模型评测（testing-ops L4）不是电池闸门，只在 §3.3 列出。

## 0. 草稿 → canon 对齐表（限时草稿里必须改掉的东西）

| 草稿写法 | canon 规范 | 依据 |
| --- | --- | --- |
| `executions.operationId = exec:<proposalId>`、索引 `by_operationId` | `executions.executionKey = "exec:" + proposalId`，索引 `by_executionKey`，唯一写入口 `executions.executeIfComplete`（R-A 采纳，改名） | D03、C2 |
| 评估屏障 `runs.pendingEvaluations`、"整轮 failed"（R-D） | **否决**。评估回合串行，run 任意时刻至多一个 `running` attempt，`runs.activeTurnSeq` 指向它；没有屏障计数器 | D08、C5 |
| 回合失败 → `paused` | 没有 `paused`；失败方重试耗尽 → `needs_input` + `humanRequest(kind: 'agent_failed')`（选项 `retry_turn` / `end_run`） | D15、C6 |
| `briefs.confirm` 不自动 `startRun`（R-H） | **否决**。房间就绪（最后一个就绪条件满足，不一定是第三份简报）时 `openIfReady` 同事务打开房间、`bump(room_opened)` 并开首个 run（cause `room_opened`）；探针风险由 D12 ⑥ 的节流与总量桶、provider 只见 `run_waiting` 限制 | D12 ⑥⑦、§1.3、C48 |
| `rooms.todayAnchor` 进硬投影、每日 cron bump（R-I） | **否决**。`rooms.localDate` 由 `clock.rollLocalDate` 推进，不在投影内；交付日在插入时物化为绝对日期不重算；只有结论翻转才 `bump(cause: 'clock')` | D22、C7 |
| 执行递增 cv；执行后同房间再 run，候选排除已执行 itemKeys（旧 INV-39） | 执行**不**递增 cv；执行后 `room.status = 'executed'` 终态，协商 / 约束 / 审批类写入一律拒绝（只豁免 `tasks.markDone` 与 `rooms.startFollowUp`）；后续变更 = `rooms.startFollowUp` 新房间 | D03、D04、C3、C4、C45 |
| `budgets` 表、`budgets.totalCents / committedCents` | 上限是 finance `briefs.hardFields.capCents`；已承诺 = `Σ ledgerEntries.amountCents`（`baseline` + `commit`），不存计数器 | §1.1 |
| `modelCalls` 表、`agentTurns`、`catalogRevision`、`contentHash`、`deferredItemKeys` | `attempts` 即用量账本；`turns`；守卫只比较 cv；`termsKey = canonicalJson(terms)`；deferred 派生字段删除 | §1.1–1.2、D11、D25 |
| 大写下划线 reasonCode（`BUDGET_BELOW_COMMITTED`、`CONSTRAINTS_CHANGED`…） | 小写点分：`budget.below_committed`、`approval.stale`、`approval.not_current`、`run.invalid_state`、`run.rate_limited`… | §1.5、C22 |
| 动作 `request_tradeoff`、字段 `targetRole`、`baseProposalId` | `escalate { kind, toRole }`、`toRole`、`counter.baseProposalVersion` | §1.4、C20 |
| `runs.proposalBudget` / `rooms.callLimit` / `modelCallBudget` | 四层上限：每用户每房间每小时节流、`runs.maxAttempts`、`runs.reservedMicroUsd`、`spendCounters(global, day)`；排空用 `opsFlags.draining` | D17、C33、C34 |
| 事件 `audience` 字段、三套 payload | `events` 全部房间可读、无 `visibility`；payload 只含房间可见字段；私密细节走 `restrictedRef`；渲染按受众分变体 | D14、C29 |
| 两段 `taskKey` | 三段 `${executionId}:${itemKey}:${templateIndex}` | §1.2、C39 |
| 核心 7 没有直接不变量 | 新增 1.7 节 INV-59 … INV-61 | 本版 |
| 反例只写"挡住"的不变量，不写操作序列与层 | 每条反例写操作序列、挡住它的不变量与守卫码、测试层；新增 2.9 节"防假绿"反例（来自 testing-ops） | 本版 |

R-B（预算低于已承诺拒绝）、R-C（守卫命中必 reconcile）、R-F（删除 deferred）、R-G（请求选项按目标视图）、R-J（执行后审批快照冻结）与 canon 一致，直接落为 INV-39 / INV-69 / INV-07 / INV-10 / INV-53。

### 本次修订对齐表（canon 包修订 2026-10-24）

| 本文件旧写法 | 现写法 | 依据 |
| --- | --- | --- |
| `scheduleTurn` / `openHumanRequest` / `assertAttemptLive` / `finishRun` / `replayRuleView` / `humanRequests.expire` | `createTurnTx` + `turns.beginAttempt` / `openHumanRequestTx` / 04 §4.5.2 的 G0–G3 / `setStatus` + `RUN_TRANSITIONS` / `replayRuleInput` / `humanRequests.expireDue` | canon §1.6 |
| 索引 `humanRequests.by_run_open`、`runs.by_room_status` | `humanRequests.by_run_status`；单活跃 run 由 `rooms.currentRunId` + `runs.by_room_runNo` 判定 | 03 |
| `currentRunId` "进入终态时清空" | 指向最新 run（任何状态），只由 `startRunTx` 写 | §1.2、C49 |
| constraintRevisions cause `request_answered`、缺 `room_opened`；run cause `briefs_confirmed` | `room_opened \| brief_confirmed \| catalog_changed \| human_answer \| clock \| scenario_migrated`；run `room_opened \| constraints_changed \| renegotiation_requested \| manual_start` | §1.2、C48 |
| 码：`approval.missing_role`（调用者角色不符）、`NOT_FOUND`、`INVITE_USED`、无可撤回时"拒绝"、场景未注册 `internal`、请求已关闭 `run.invalid_state`、非 creator 重谈 `approval.missing_role` | `auth.role_forbidden`、query 返回 `null` / mutation `auth.not_member`、`invite.invalid`、返回 `unchanged`、`run.invalid_state{scenario_version}`、`request.not_open` / `request.option_unknown`、`auth.not_creator` | §1.5、C56 |
| INV-32(a) 对任何被取代 run 的 active 提案预检保留 | 只限被取代 run 处于 `pending_approval`；同事务 `stale → active` | D06、C47 |
| `modelGateway` 在 `core/engine` | `convex/model/agents/modelGateway.ts`（唯一接缝 `callModel`） | D21、C60 |
| rationale 超长 → `output.schema_violation` 重试 | NFC 后截断到 1,200 码点、记 `rationaleTruncated`、不重试 | 05 §5.5.2 |
| 人拒绝后反馈含 `reasonKey` | 任何他方代理上下文不含 `reasonKey` / `note` | D13、C50 |
| `sharedFacts.add` 带 value、写他方字段 → `needs_own_confirmation` | 无 value 参数；非本角色可共享字段 → `disclosure.blocked` | §1.6、C51 |
| 排空 / 节流时第三份确认"简报写入、run 不开" | 系统路径照常建 run、首回合停泊；节流满时那次写入整体被拒 | D06、D17、C52 |
| 目录"只改标题 revision + 1" | revision 不变、`editNo + 1` | §1.2、C46 |
| D27 "3 条审批 stale""stub counter $800"；$4,700 先问 customer | 2 条 `stale_approve` + finance pending；provider 在 run 2 提出 v2 $800；customer 被跳过、finance `raise_cap` | D27、C57 |
| fixture 键 `LOGIN` / `REPORTS` / `AUDIT` | `sso_login` / `usage_dashboard` / `audit_log_export` | D27、03 itemKey 正则 |
| run 调用上限 → `agent_failed` | customer 的 `rounds_exhausted`（`questionKey: call_limit`） | D17 |
| INV-01 / 02 / 19 以 `briefs.disclosures` 为可见性来源；INV-06 `projectRuleCheck`；INV-08 无解密清单编号；INV-22 "n < 2 去 counter"；INV-74 反馈"含" counter 候选 | `sharedFacts` 最新行（版本绑定）；`projectChecks`；DX-1…DX-13；evaluate 快照已排除 base、`n ≥ 1` 保留 counter（CE-078 / CE-079 同步）；反馈只带 candidateKey，O 标号在 provider 新快照构建时分配 | 07 PV-05 / §7.8.3 / §7.11、05 §5.7.2 / §5.8.3 |

草稿里引用的专题编码在本版的落点：idempotent-execution C1–C23 → 2.5 节；versioned-approvals X1–X28 → 2.3 节；negotiation-protocol E1–E18 → 2.4 节；run-lifecycle E1–E17 → 2.6 节；privacy-disclosure T1–T13 → 1.1 / 2.1 节；scenario-plugin SP-I1–I14 → 1.4 节；testing-ops X1–X18 → 2.9 节。
