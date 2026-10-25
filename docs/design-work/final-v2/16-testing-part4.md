# 16 · 测试策略（part4：用例目录下：EXE / RUN / RULE / OPS）

> 分片列表见 `16-testing.md` 顶部。层与来源记号同 part3。

### 16.6.3 执行（EXE）

| 编号 | 层 | 用例与断言 | 来源 |
| --- | --- | --- | --- |
| TC-EXE-01 | L1 `[serial]` | 最后一票连续调用两次：1 条 execution、1 条 `ledgerEntries(commit)`、1 张 changeOrder、tasks 条数 = `plannedTasks` 长度；第一次返回 `{ status: 'executed', executionId, alreadyExecuted: false }`，第二次返回 `{ status: 'executed', executionId（同一）, alreadyExecuted: true }`（`approvalRecordResultV` 以 `status` 判别，08 §8.5.2、12 §12.15），无新事件；执行后其他人再 approve 同样得到 `alreadyExecuted: true`，reject / withdraw → `approval.already_executed` | T-13、CE-103/107 |
| TC-EXE-02 | L2 | 探针 `approve_last_two`、`approve_last_repeat`（§16.8） | T-13、CE-096/097 |
| TC-EXE-03 | L3 | 三个浏览器，最后一位快速双击：只出现一个执行结果，其他窗口不刷新即看到变更单 | T-13 |
| TC-EXE-04 | L1 | execution / changeOrder / ledger commit / tasks 互相引用；`taskKey` 三段且唯一；任务指派 provider；G701 金额链 | R6、R10、CE-114 |
| TC-EXE-05 | L0 + L1 | `executionKey` 由服务端派生为 `exec:${proposalId}`，公开函数无幂等键参数；v3 在 cv5 缺 finance、cv6 集齐：只计 cv6 的审批，只执行一次 | D03、CE-110/111/115 |
| TC-EXE-06 | L1 | 执行不 bump cv；proposal / run / room 均 `executed`；之后 `budget.setCap` → `run.invalid_state`；`rooms.startFollowUp` 建新房间：`followsExecutionId` 指向旧执行、同三人席位预分配、只把**未交付**的目录行（`itemKey ∉` 旧执行 `terms.itemKeys`）复制为 `draft`（provider 须重新确认）——新房间的目录、provider 的 `candidateSnapshot` 都不含旧执行的 itemKey，provider 用已交付键调 `catalog.confirm` → `item.duplicate`，`rooms.view.followUpOf.deliveredItems` 列出它们；baseline 预填旧 `committedAfterCents` 但须 finance 确认；旧房间不可写 | D04、CE-112/118/130/168 |
| TC-EXE-07 | L1 + L3 | 结果页审批显示读 `executions.approvalIds` 快照，不实时派生 | D03、CE-131 |
| TC-EXE-08 | L1 | 提案插入后 provider 只改 `taskTemplates`（不 bump）：执行写出的 tasks 仍来自 `plannedTasks` 快照 | D25 |
| TC-EXE-09 | L1 | `vi.spyOn` 让变更单派生纯函数抛错：最后一票的审批行、execution、ledger、tasks、事件全部回滚；去掉 spy 后重试成功 | 核心 5、CE-106 |
| TC-EXE-10 | L1 | 与 08 I16 / K27 一致（规则在 query 与 mutation 中一律读 `room.localDate`，08 A12、09 §9.6.7、12 B8）：(a) 假时钟越过房间本地午夜、`rooms.localDate` 仍为前一日且未运行 `rollLocalDate`：最后一票 approve 以 `room.localDate` 判定，结论与审批人屏幕一致 → 正常执行，不出现 `approval.not_executable`；(b) 另一场景中待批提案的交付日恰为前一日：先调用 `internal.clock.rollLocalDate` 使结论翻转 → `constraints.bump(cause: 'clock')`、cv + 1、新 run 已建，之后以旧 cv 的 `expectedConstraintsVersion` approve → `approval.stale`、不写行；(c) 静态：`approvals.record` 与 `executeIfComplete` 的调用图不出现 `Date.now()` 推导的 today（只读 `room.localDate`）。否决旧写法"approve 用权威 today 重算 → `approval.not_executable`"：它让 K27（午夜后点批准）无出口（completeness-09） | D02、D22、CE-071 |
| TC-EXE-11 | L1 `[serial]` + L2 | 每个 execution 至多一个后续房间（03 SC-T19 / SC-T10、02 INV-58）：同一成员双击 `rooms.startFollowUp`、以及两名成员并发调用，只建一个房间，后到者返回同一 `roomId`（`rooms.by_followsExecutionId` 先查后插 + 旧房间写锁）；L2 用 §16.8.2 的并发探针（`maxOverlap ≥ 2`） | D04、invariants-14、CE-112/168 |
| TC-EXE-12 | L2 变异 | INV-M1 灵敏度对照：① 去掉 `openRoomTx` 的 `writeSeq + 1` 后重跑 `approve_last_two` 与 `start_follow_up_twice` 探针，断言写锁证据消失（并发轮次后 `rooms.writeSeq` 不再随成功写入递增）；此时区间读 OCC 仍可能独立挡住重复，零重复不判为"变异未被抓住"；② 另用显式变异夹具同时去掉写锁与该路径的区间查重（`executions.by_executionKey`、`rooms.by_followsExecutionId` 的先查后插），同一探针必须观察到重复行或第二次执行，证明探针本身灵敏；③ 恢复后零重复。生产重叠探针（§16.8.2，`maxOverlap ≥ 2`）不依赖本对照、独立运行 | INV-M1、18 ADR-X01 |
| TC-EXE-13 | L1 | 满目录准入与 50 任务上限（08 §8.4.4 `MAX_TASKS_PER_EXECUTION`）：12 个在架 item + 2 个 modifier，任务模板合计恰 50 时可确认，第 51 条（新增模板、新增或重新上架 item）→ `catalog.confirm` 返回 `item.limit_exceeded`（03 §3.13.1）；合计 50 时（fixture 放宽上限与截止日）含全部 item 的提案走到最后一票，`transactionLimits: true` 下执行成功、tasks 恰 50 条，全程不出现 `internal` | 核心 5、TC-OPS-06 |

### 16.6.4 运行时（RUN）

| 编号 | 层 | 用例与断言 | 来源 |
| --- | --- | --- | --- |
| TC-RUN-01 | L1 | attempt 在途（`hang`）时 finance 降预算：旧 run `superseded`；迟到的 `turns.complete` → attempt `stale`、用量照记、`proposals` 行数不变、新 run 首回合存在；G0 情形不写事件 | T-15、CE-121/122 |
| TC-RUN-02 | L1 | `beforeReturn` 在模型"思考"期间调用 `budget.setCap`（action 期间插入 mutation）：结果同 01，新 run 的回合快照为新 cv | F09.4 |
| TC-RUN-03 | L1 `[construct]` | 不经 supersede 直接改 `rooms.constraintsVersion`：`turns.complete` 命中 G3 → turn `stale` + 事件 `turn_rejected_stale{ guard: 'G3' }`（03 §3.11.1 的唯一名）+ `runs.reconcile` 重新调度或转 `needs_input`；LV-1 成立 | D07、CE-063/127 |
| TC-RUN-04 | L1 | attempt 1 `invalid_output` → attempt 2 开始；推进到 attempt 1 的看门狗时间：G0 使其成为空操作，attempt 2 不受影响；attempt 2 `hang` → 其看门狗读 `_scheduled_functions`：`pending` / `inProgress` → 重登记（≤ 3 次）→ 之后 `error`；`success` 而回合仍 running → `error(internal)` | D07、CE-123/124/125 |
| TC-RUN-05 | L1 | `max_tokens`（脚本化 `callModel` 的结局即网关调用内重试后仍截断）→ `output.truncated`，不再开 `auto_retry` → `agent_failed`（调用内重试一次由 §16.4.5 的 L0 网关测试覆盖）；脚本化 429 / 500 / 529 → `transport`，同样不开 `auto_retry`；`refusal` → `refused` 不重试 → `agent_failed`；`model_context_window_exceeded` → `error` 不重试；非 JSON / schema 违规 → `output.not_json` / `output.schema_violation` 有界重试；**永不**视为"无动作"；每种结局 `attempts.usage` 都有值 | D09、CE-075/076/077 |
| TC-RUN-06 | L1 | 回合串行：任何时刻至多一个 `running` attempt；顺序 provider → customer → finance；provider 提案被规则阻断时不花评估调用 | D08、LV-4、CE-092 |
| TC-RUN-07 | L1 | 已有活动 run 时 `runs.start` 返回同一 `runId`、`created: false`（不写、不计节流，12 §12.13）；就绪不满足 → `run.invalid_state { guard: 'not_ready' }` | CE-133/154 |
| TC-RUN-08 | L1 | bump 使 open 人工请求 `superseded`（含 finance 不回答而直接 `setCap` 的情形）；回答它 → `request.not_open` | D06、CE-060/141 |
| TC-RUN-09 | L1 | 无解变体（上限 $4,700）：预检 → `needs_input`；恰一个 open 请求，按 `relaxationOrder` 选中 finance 的 `raise_cap`（customer 视图下无可放松选项）；`script.recorded.length === 0`（零模型调用）；选项只由 finance 视图计算；回答 `raise_cap` → bump → 新 run `negotiating`；`react()` 深度 ≤ 4；`constraintRevisions.sourceRefs` 指向该请求 | D15、CE-062/067/128/138/145 |
| TC-RUN-10 | L1 | 两次 `invalid_output` → `needs_input` + `agent_failed` 请求给失败方（`retry_turn` / `end_run`）；`retry_turn` → 新 attempt、run → `negotiating`；`end_run` → `ended_no_agreement`；失败方双击 `retry_turn` → 第二次 `request.not_open` | D15、CE-126/140 |
| TC-RUN-11 | L1 | 三轮未收敛且无合格提案 → customer 的 `rounds_exhausted` 请求（`choose_candidate` / `keep_as_is` / `end_run`）；第二次 `keep_as_is` 等价 `end_run` | D15、CE-080/142 |
| TC-RUN-12 | L1 | `choose_candidate`：全视图复核通过 → 插入 `origin: human_choice` 提案（与本 run 当前 active 且仍通过的提案同候选时复用同一 proposalId），run `needs_input → pending_approval`；复核不通过 → 旧请求 `superseded`（`closedReason: 'regenerated'`、`answerOptionKey` 照记）、同事务重新生成同 kind 请求、该候选不再出现（不是死路，open 请求数恒为 1） | D15、CE-144 |
| TC-RUN-13 | L1 | 全部评估 `recommend_accept` 但 `isExecutable` 为假 → `resolveRound` 进下一轮或 `needs_input`，不卡住 | D08、R11(e) |
| TC-RUN-14 | L1 | `ops.setDraining(true)`：(a) 公开 `runs.start` → `run.draining`（不建 run）；(b) 系统路径照常：此时 finance `setCap` 触发 bump，`react()` 照常建新 run 与首回合，回合 `waitingReason: 'draining'`、无 attempt（约束变更不被回滚）；(c) 已有回合的 `turns.beginAttempt` 返回 `parked` 不建 attempt；在途 attempt 照常提交、`activeAttemptCount` 归零；(d) `ops.setDraining(false)` → 立即的 `ops.livenessSweep` → `runs.reconcile` 自动恢复停泊回合，无需人工操作；`AGENTS_ENABLED=false` → attempt `error(agents_disabled)` | D17、CE-136/146 |
| TC-RUN-15 | L1 | `runs.maxAttempts` 用尽 → `needs_input`；`reservedMicroUsd` 超限 → 不调度下一 attempt、转 `needs_input`；`spendCounters` 日上限 → 被调度路径返回 `deferred` 并 `runAfter` 到次日（不 throw）；stub 不受影响 | D17、T-17、CE-135/137 |
| TC-RUN-16 | L1 | 人工请求 7 天未答：推进时钟并调用 cron `humanRequests.expireDue` → `expired`、run `ended_no_agreement`、creator 待办出现 | D15、CE-139 |
| TC-RUN-17 | L1 + S | 交付日为绝对日期，跨午夜审批仍有效；`rollLocalDate` 使交付日落入过去（结论翻转）→ `constraints.bump(cause: 'clock')`；无翻转 → 不 bump；静态：query handler 与 `core/engine` 不出现 `Date.now` / `new Date()`；10 RT-16：房间本地午夜后、cron 推进前到达的 `turns.complete`（"00:30 插入提案"）先经 `rollLocalDateTx` 推进 `localDate`，交付日按当日物化、不 bump | D22、CE-069/070 |
| TC-RUN-18 | L1 | provider 在同一 run 第 5 次 `propose` → `escalate` 或 `needs_input`；重复已阻断 `candidateKey` → `action.repeats_blocked`；provider 快照剔除已阻断候选 | D12 ⑤、CE-009/088/171 |
| TC-RUN-19 | L1 | provider 代理 `clarify { toRole: customer, topicKey: deadline_value }`（14 §3）→ customer 的 `clarify` 请求（`disclose { field: deadline, toRoles: [provider] }` / `keep_as_is` / `end_run`）→ 回答 `disclose` → 写一行 `sharedFacts`（受众 = 最新行受众 ∪ `toRoles`）、不 bump、run → `negotiating`、provider 同轮新开回合；另一分支回答 `keep_as_is` → 不写 `sharedFacts`、provider 同轮新开回合（不白耗一轮） | D15、CE-061 |
| TC-RUN-20 | L1 | 两次快速 bump：第一次产生的新 run 被第二次 supersede，其回合 `loadTurnContext` 返回 `null` → `turns.fail(stale_context)`，不调模型 | D07、CE-066 |
| TC-RUN-21 | L1 | `pass_to_next`（04 SM-31 / R21）：变体 D（必需项被撤下）里 customer 的 `infeasible` 请求含 `pass_to_next { toRole: finance }`，变体 A 里给 finance（末位）的不含；customer 回答 → 旧请求 `answered`、finance 收到按**自身视图**生成的 `infeasible` 请求（有 `raise_cap`，或只有回退项与 `end_run`），open 请求数恒为 1、cv 不变、`script.recorded.length === 0`；本 run 内不再出现第二次 (customer → finance)；非干扰：只改 finance 的私密上限（使其视图卡住 / 不卡住），customer 请求的选项逐字节相同 | D15、CE-087(b)/138 |
| TC-RUN-22 | L1 | 回退请求与 R20（04 SM-28、09 SM-13 / CC-23）：customer 未向 finance 披露截止日、合起来不可行 → customer 收到 `disclose { field: deadline, toRoles: [finance] }` + `pass_to_next` + `end_run`；回答 `disclose` → 同事务重跑预检 → finance 的 `raise_cap` 请求（仍恰一个 open）；构造"约束效果未改变硬投影"的回答（`[construct]`）→ 不 bump、按 R20 重跑预检，绝不出现 `needs_input` 却无 open 请求 | D15、CE-138 |
| TC-RUN-23 | L1 | D06 只沿用 `pending_approval`（04 SM-30、09 CC-14 / CC-17）：(a) run 1 `pending_approval` 时降上限且 v1 仍通过 → 新 run 直接 `pending_approval`、同一 `proposalId`、同事务 `stale → active`、零模型调用；(b) run 1 `negotiating`（v1 已插入、评估未完成）或 `needs_input`（`rounds_exhausted`）时同样的 bump → 新 run `negotiating`，不沿用 v1；(c) 被人拒绝的提案永不复活 | D06、C47 |
| TC-RUN-24 | L1 | 终结活性（INV-79、04 SM-29）：creator 账号失效后，运维 `rooms.forceClose({ roomId, reason })` → room `closed`、非终态 run `canceled`、open 请求 `superseded`、`room_closed{ by: 'ops' }`；对 `executed` / `closed` 房间返回 `unchanged`；另一路径 open 请求到期 → `ended_no_agreement`（同 TC-RUN-16） | INV-79、completeness-21 |
| TC-RUN-25 | L1 `[construct]` | 场景版本不可解析（15 §15.5.1 的违规兜底）：把注册表里房间钉住的版本移除后，approve → `run.invalid_state{ guard: 'scenario_version' }`；reject 照常写入并把提案置 `rejected`，`createTurnTx` 不建回合，run → `needs_input` + `agent_failed`（只有 `end_run`），全程无 `internal` | 08 S5 / §8.5.4、04 U1、10 F33 |
| TC-RUN-26 | L1 | `run_starts` 桶（privacy-12、10 RT-14）：房间 24 小时内第 7 个人工 `runs.start` → `run.rate_limited`；第 7 个由 `react()` 开局的 run 照常建立，首回合 `waitingReason: 'run_cap'`、`beginFnId` pending、`runs.reconcile` 与 `ops.livenessSweep` 均为 noop；推进到窗口腾出时刻 → 延迟的 `turns.beginAttempt` 建 attempt；LV-1 全程成立（10 RT-14 的 L1 版）。附带 10 RT-15：人为让 reconcile 在链已用尽（`currentAttemptNo = 2`）的 running 回合上重派 → B4a → 回合 `failed`、失败方恰一个 `agent_failed` 请求 | D12 ⑥、CE-146(b) |
| TC-RUN-27 | L1 | `rounds_exhausted` 的每个 `questionKey`（05 §5.8.5、06 §11.2）各一个场景：`rounds`（三轮未收敛）、`no_candidates`（provider 快照剔除后为空；provider 本 run 已提 4 次）、`call_limit`（`runs.maxAttempts` 用尽）、`spend_limit`（美元预留超限）；断言请求的 `questionKey` 后缀与文案、`keep_as_is` 只在 `rounds` 且资格谓词成立时提供、回答时从 `questionKey` 读回原因复核（不成立等价 `end_run`）、run 上限触发时不出现 `agent_failed` | D15、D17、CE-080/142 |

### 16.6.5 规则（RULE，L0 为主；06 的 35 个用例与 protocol-rules 的 92 个用例迁入并在 Vitest 5 下重跑，旧大写码按 06 的对照表改为点分小写）

| 编号 | 用例与断言 | 来源 |
| --- | --- | --- |
| TC-RULE-01 | 边界：`committed + amount === cap` 通过（主 fixture $800 @ $4,800）；多 1 分 → `budget.over`（$4,799.99 变体） | D27、CE-073/074 |
| TC-RULE-02 | 一次收集全部问题：$1,400 全量同时报 `budget.over` 与 `date.after_deadline` | 06 |
| TC-RULE-03 | 必需项不在目录 → `item.required_missing`，不崩溃 | 06 |
| TC-RULE-04 | 快照金额 ≠ 按 `lines` 重算 → `amount.claim_mismatch`；`lines[].revision` ≠ 当前目录 → `version.stale_source` | D25、CE-043/089 |
| TC-RULE-05 | 日期：`date.in_past`、`date.after_deadline`、恰等于截止日通过、闰年、`2026-02-30` 拒绝、窗口外 `date.out_of_range` | D22、RA-B10、CE-090 |
| TC-RULE-06 | 金额：负数、小数、`NaN`、`> 1e11`、非安全整数、求和溢出 → `amount.out_of_range` | §1.2 |
| TC-RULE-07 | `enumerateCandidates`：按角色视图、按 `candidateKey` 稳定排序、≤ 12、provider 不按预算过滤、第 1 轮首位为最低价含必需项候选 | D10、CE-005/006/014 |
| TC-RULE-08 | `toStrictOutputSchema` 按 `(role, turnKind, n)` 快照；保留 `enum` / `const`、`additionalProperties: false`、无 type 节点抛错；schema 哈希稳定（`schemaVersion`） | D09 |
| TC-RULE-09 | 语义校验：快照外 `optionKey` → `action.option_not_in_snapshot`；finance `counter`、provider `recommend_accept` → `action.not_allowed_for_role`；快照（已剔除基准提案的键，05 §5.7.2）n = 0 时无 `counter`、n ≥ 1 即提供；`counter` 的枚举因此不含基准提案，`counter` 等于基准提案在解码层不可能出现 | §1.4、CE-039/078/079 |
| TC-RULE-10 | `resolveRound` 优先级表（05）逐行表驱动 | D08 |
| TC-RULE-11 | `evaluateApprovalSet`：按集合、userId 两两不同、当前成员、每人最新 `seq`；不存在计数式判定 | D02、CE-098 |
| TC-RULE-12 | `buildHumanRequests`：恰一个请求、`relaxationOrder`、选项只读目标视图 | D15 |
| TC-RULE-13 | 插件契约：改约束不改金额（`priceTerms` 只读 `lines`）；返回负数 / 非安全整数 → 契约违规 | CE-072/081/082/091 |
| TC-RULE-14 | `canonicalJson` 对键序不敏感；`termsKey` 只覆盖 `terms`，与 `REDACTABLE_FIELDS` 不相交（编译期断言） | D25、CE-004 |
| TC-RULE-15 | 穷举 04 的 run / 提案 / 请求 / attempt 迁移表：终态无出边，表外迁移 `assertTransition` 抛错；对每个终态 run 调用全部 mutation，状态不变 | CE-143 |

### 16.6.6 运维与限额（OPS）

| 编号 | 层 | 用例与断言 | 来源 |
| --- | --- | --- | --- |
| TC-OPS-01 | L2 | 日志扫描：完整流程期间收集的日志零金丝雀命中，且条目数 > 0 | T-08 |
| TC-OPS-02 | L1 + L3 | seed 产物 `provenance: 'seeded'`、stub 代理产物 `'stub'`、真实 `'live'`；DTO 透传；界面 `SimulatedBadge` | T-19、CE-152/153/157 |
| TC-OPS-03 | L1 | `seed.reset`：`assertTier` 读 `DEPLOYMENT_TIER` 与 `getDeploymentMetadata().name`（convex-test 中为 `"test"`）；prod 拒绝；只删 `provenance !== 'live'` 的房间，live 房间行数不变 | D18、CE-109 |
| TC-OPS-04 | L0 + L3 | 缺 `CLERK_JWT_ISSUER_DOMAIN` → `auth.config.ts` 抛错；proxy 未配置 → `/setup` 或 503 | T-20 |
| TC-OPS-05 | S | `modelGateway` 以外无 `fetch(` / `new Anthropic(`；依赖白名单不含 ERP / 支付 / 签署 SDK（INV-59，核心 7）；mutation 内除 `ctx.scheduler` 外无外部副作用 | CE-104/147/148 |
| TC-OPS-06 | L1 | `convexTest({ schema, modules, transactionLimits: true })` 下用最大规模 fixture（目录上限 × 任务模板上限）跑执行 mutation 与 `seed.reset` 单批：不超限，且 `getTransactionMetrics().documentsWritten.used` 留 10 倍余量 | review r11 |
