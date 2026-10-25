# 99 · 修订轮处置总表（part6）：§2.2 跨章修正清单（1）

> 分片见 `99-review-log.md` 顶部。

## 2.2 跨章修正清单（1）

| 编号 | 处置 | 位置 | 说明 |
| --- | --- | --- | --- |
| X01 | fixed | 00-overview.md §0.3、00-overview-part2 §0.6.1 / §0.6.2 / §0.7 / §0.9 / §0.10 | §0.3 已是 CE-001…170（product 包），本次删去"按 16 §16.11.2 修订后断言"、INV 范围改 01…79 + INV-M1；§0.6 以引用方式采用 canon §1.1–1.3，canon 新增项（constraintRevisions、rawOutputs、editNo、currentRunId、run cause、passesChecks 三判定、stale→active、openIfReady）随引用自动生效，§0.6.1 改引 canon §1.3；§0.9 第 3、4 条关闭；§0.10 补 C43–C60 落点行 |
| X02 | fixed | 16-testing-part8 §16.11.2 / §16.11.3、part9 开放问题 8、part4 TC-RUN-14 / TC-RUN-21、part5 TC-PRIV-23 | §16.11.2 删为指针；开放问题 8 关闭；TC-RUN-14 按 CE-146 改写（公开 runs.start 拒绝、系统路径建 run 首回合停泊、解除后自动恢复）；新增 provider 请求体无 reasonKey 断言（TC-PRIV-23）与 pass_to_next 用例（TC-RUN-21，映射 CE-087(b) / 138）；§16.11.3 写明此后从 CE-176 起 |
| X03-01 | fixed | 01-product-part3 F7、01-product-part4 X6 | 取舍旅程补 pass_to_next（"Pass to Finance"，按位置提供、不 bump、目标按自身视图）与 kind→选项说明 |
| X03-02 | fixed | 02-domain-model-part6 INV-73 | 补 pass_to_next 迁移 |
| X03-03 | fixed | 03-schema-part7 humanRequests | requestEffectV 加 pass_to_next { toRole } 分支（含出现条件注释） |
| X03-04 | fixed | 04-state-machines-part2 R21、part4 效果表 / §4.8.3、part5 SM-31（核对，无改动） | pass_to_next 自环与效果行已由 state 包写入 |
| X03-05 | fixed | 05-protocol-part5 §5.11.1 / §5.11.2 / §5.11.4、part7 §5.20 | requestEffectV 加 pass_to_next；infeasible 选项按位置附 pass_to_next；§5.11.4 加效果行；clarify 选项补 toRoles 与 end_run；D15 对照改为十种 effect |
| X03-06 | fixed | 06-rules-engine-part7 §11.1 / §11.2 / §11.3 / §11.4、part9 T06-U32/33/39 / D15 行 | Effect 加 pass_to_next；infeasible 请求按位置追加（run.passedToNext 去重）；§11.3 说明它不是 relaxation、不读视图；§11.4 加回答校验行；新增 T06-U39 位置非干扰用例 |
| X03-07 | fixed | 07-permissions-privacy-part6 §7.12.2 humanRequests.answer 行 | 注明 pass_to_next 只按收件人位置提供、不读私密值、不构成预言机、不 bump |
| X03-09 | fixed | 09-constraint-changes.md M17（核对，无改动） | humanRequests.answer 行已列 pass_to_next |
| X03-12 | fixed | 12-api-part4 §12.14 | effect 列表与效果表加 pass_to_next 行（校验位置与去重、不 bump、留在 needs_input） |
| X03-13 | fixed | 13-frontend-part2 §13.6 第 3 条、part6 开放问题 1 / D15 行 | 取舍卡渲染服务端提供的 pass_to_next（"Pass to {Role}"），开放问题 1 关闭 |
| X03-14 | fixed | 14-scenario-scope-change-part3 §8 模板表、part6 §11 D2 / E3、part7 §16 D15 行 | 新增 request.pass_to_next 模板；变体 D / E 的 customer 请求按位置附 pass_to_next，A 的 finance（末位）不附 |
| X03-18 | fixed | 18-decisions-open-questions-part4 ADR-D15、part7 N-01 | ADR-D15 决定写入 pass_to_next 与 keep_as_is 按 kind，被否决加 C54，后果删去"转交不在 effect 集合"；N-01 已解决 |
| X04a | fixed | 05-protocol-part4 S0 | startRunInternal → openIfReady / react() → startRunTx |
| X04b | fixed | 10-agent-runtime-part2 §10.4.1 步骤 1、10-agent-runtime.md RT1、part4 §10.12.3 / §10.13 | startRunInternal 全部改为 startRunTx；步骤 1 改为 openIfReady → bump(room_opened) → react() → startRunTx(room_opened) |
| X05 | fixed | 05-protocol-part5 §5.11.4 | choose_candidate 复核失败改为本请求 superseded(closedReason: regenerated，照记 answerOptionKey) |
| X05b | fixed | 12-api-part4 §12.14 choose_candidate 行 | 复核失败改为本请求 superseded(regenerated)，照记 answerOptionKey |
| X06 | fixed | 18-decisions-open-questions.md §18.2（新增 C43–C60 索引表）、part2–part6 ADR-D02/D04/D05/D06/D09/D12/D13/D14/D15/D16/D17/D27 的"被否决"、part7 N-08、part8 本章不变量 2 与对照表 | C44–C60 逐条进入对应 ADR 的被否决（C43 为文档纪律不进 ADR）；N-08 标已解决（cause scenario_migrated + 15 §15.5.1）；pass_to_next、keep_as_is 按 kind、D06 收窄、D04 两项豁免写入 ADR-D15 / D06 / D04 的决定 |
| X07a | fixed | 04-state-machines-part5 §4.15（核对，无改动） | Q1 / Q3 / Q4 / Q5 / Q6 已标"已裁决 / 已关闭"（state 包） |
| X07b | fixed | 07-permissions-privacy-part9 §7.24 第 8–13 条 | 开放问题 9（INV-18 / CE-029）及 8 / 10 / 12 / 13 关闭，11 改述为 canon D18 现文 |
| X07c | fixed | 09-constraint-changes-part5 §9.14（核对，无改动） | Q1 / Q2 / Q3 / Q5 / Q6 已标已裁决 / 已关闭（state 包） |
| X07d | fixed | 11-architecture-part4 §11.15 Q6 / Q7 | canon D20 / D21 已写入，Q6 标已裁决（安装当天仅确认冷却期）、Q7 关闭 |
| X07e | fixed | 12-api-part8 §12.25 Q3 / Q5 / Q14（及 Q6 / Q17 / Q18 / Q19 / Q20 / Q21） | canon 已写入的条目与本阶段已同步的条目全部标为已关闭 |
| X07f | fixed | 13-frontend-part6 开放问题 1 | 同上 |
| X07g | fixed | 18（N 表） | 与 X07 各章条目对应的 N-05 / N-22 / N-26 / N-27 / N-28 / N-30 标已解决 |
| X08 | fixed | 00-canon-part3（核对，无改动）、03-schema-part9、03-schema-part12 | canon D14 已列八表（C59，canon 包 OBJ-04）；03 §3.11 说明段与 Q13 改为已关闭 |
| X08b | fixed | 03-schema-part9 §3.11、part12 Q13 / §3.21 D14 | restrictedRef 八表与 canon D14 一致，Q13 关闭 |
| X08c | fixed | 07-permissions-privacy-part7 §7.17（核对，无改动） | restrictedRef 已按 03 八表书写 |
| X08d | fixed | 02-domain-model-part7 D14 / D15 行 | restrictedRef 八表、disclose.toRoles 改为与 canon 现文一致，补 pass_to_next |
| X09 | fixed | 00-canon-part3 D15 | disclose 改为 { field, toRoles } 并注明受众来源（核对者同步） |
| X10 | fixed | 00-canon-part3 D18 | 补 privacy.redact 为只追加表唯一例外（只覆写 REDACTABLE_FIELDS、不删行） |
| X10b | fixed | 03-schema-part2 §3.3.2 第 5 / 6 条、part12 Q11 / §3.21 D18 | privacy.redact 改述为 canon D18 已列的唯一例外；"删除只有三个入口"笔误改为两个 |
| X10c | fixed | 07-permissions-privacy-part9 §7.24 第 11 条 | "canon D18 已加豁免"现已属实（核对者同步 canon D18），措辞改为指向 canon 现文与 ADR-X04 |
| X11 | fixed | 00-canon-part2 D10 | 剔除集合改为 excludedCandidateKeys(run) = 已提出（含被阻断）∪ 被拒 ∪ 复核失败 |
| X11b | fixed | 03-schema-part12 §3.21 D10 | 剔除集合补"choose_candidate 复核失败"，删去"canon 尚未补注" |
| X11c | fixed | 05-protocol-part7 开放问题 5 / 6 / 7、§5.20 D10 / D27、part6 §5.15.1 末段 | canon 已改写 D10 / D15 keep_as_is / D27，三条开放问题关闭，对照表不再标偏离 |
| X12 | fixed | 00-invariants-part6（核对）；03 §3.20、02 §2.14 见各章条目 | INV-67 已改为 currentRunId 指向最新 run、不清空（canon 包 invariants-09），INV-24 / 57 / 75 cause 已改名（names-18） |
| X12b | fixed | 02-domain-model-part7 §2.14 Q2 / Q5 | canon 已改写 INV-67 与 cause 名，两条改为已关闭 |
| X12c | fixed | 03-schema-part12 Q2 / Q5 | INV-67 与 cause 名已改，事件别名残留已回改，两条关闭 |
| X13 | fixed | 12-api-part4 §12.14、12-api-part8 Q6 | disclose 改为 { field, toRoles }，受众 = 最新行受众 ∪ toRoles，run 去向按 kind（clarify / infeasible 回退） |
| X14 | fixed | 12-api-part3 §12.9 | briefs.confirm 的 customer 软字段删去 preferredDate |
| X15 | fixed | 12-api-part3 §12.11 守卫 ⑥ 与失败码、12-api.md §12.4 | itemKeys 闸门改为 confirmed ∪ retired（与 briefs.confirm 同一集合），§12.4 登记 item.unconfirmed |
| X16 | fixed | 16-testing-part5 TC-PRIV-15 / TC-PRIV-22、part4 TC-EXE-11 / TC-RUN-03、part6 探针 start_follow_up_twice | cap_480000 → item.unknown 并加"披露 retired 必需项成功"正例；新增 startFollowUp 双击 / 并发只建一个房间（TC-EXE-11，03 Q14 已改引）；新增 privacy.redact L1（TC-PRIV-22）；TC-RUN-03 事件名 turn_rejected_stale |
| X16d | fixed | 03-schema-part12 Q14 | 引用改为 16 TC-EXE-11（本阶段新增） |
| X17 | fixed | 14-scenario-scope-change-part6 §11（核对，无改动） | A1 已是 run_ended(superseded)、A3 已是 room_executed、选项键已是 'A'..'E'（rules 包） |
| X18 | fixed | 06-rules-engine.md R-D11（核对，无改动） | 已是 'A'..'E'（rules 包 extra-01），14 §11 亦无 opt_N |
| X19 | fixed | 10-agent-runtime.md / part2 / part5 / part7（核对，无改动） | rawOutputs 已是 ≤ 64 KiB、保留期 dev 30 / prod 7；B4 / B5 已写失败码记 runs.lastFailure（turn 无 failureCode）；§10.16.3 指标已按 waitingReason 计数（protocol 包） |
| X20 | fixed | 15-operations-part3 §15.7（核对，无改动） | 全局日美元行已改为不写事件、只记 waitingReason（arch 包） |
| X21 | fixed | 08-approval-execution-part11 §8.14 O11 | ①② 改为"已统一为 12 §12.4 的码"，删去 auth.forbidden / auth.not_found 的过时描述 |
| X22 | fixed | 00-invariants-part6 | INV-72 ② / CE-135 已是 rounds_exhausted（canon 包已改，核对）；INV-73 补 pass_to_next 的出现条件与"不 bump"；新增 INV-79 终结活性（04 INV-SM-07 / rooms.forceClose） |
| X23a | fixed | 00-canon-part3 D18 | "rooms.close 是生产唯一清理"限定为 setup / open 房间，executed 保持只读 |
| X23b | fixed | 00-invariants-part5 INV-54 | "rooms.close 是唯一清理"限定为 setup / open 房间 |
| X23c | fixed | 12-api.md B11 | "rooms.close 是唯一清理"限定为 setup / open 房间，executed 只读，privacy.redact 只覆写 |
| X23d | fixed | 15-operations.md O7、15-operations-part4 §15.9 | "rooms.close 是生产唯一清理"限定为 setup / open 房间，executed 只读，PII 只经 privacy.redact 覆写 |
| X23e | fixed | 18-decisions-open-questions-part5 ADR-D18 | "rooms.close 是唯一清理"限定为 setup / open 房间，并注明 privacy.redact 例外；决定改为 canon D18 现文（internal mutation、缺省开 run、stopBeforeRole） |
| X24 | fixed | 03-schema-part5 turns.waitingReason | 联合类型加 run_cap |
| X24b | fixed | 10-agent-runtime.md §10.3 turns 行 | waitingReason 列表写入 run_cap 并注明 03 已登记 |
| X25 | fixed | 10-agent-runtime-part3 §10.9 | 删去与 04 分叉的第二份 reconcile 代码，改为引用 04 §4.3.5（只读 decideReconcile、确定要写才开 RoomTx、内联复用调用方 tx、react 带 runCause）的分支表；删去"04 现写 15 分钟"的过时括注 |
| X26 | fixed | 12-api-part3 §12.8 第 4 步 | 沿用同一 proposalId 补前提"被取代 run 处于 pending_approval"与同事务 stale → active（canon D06 / C47） |
| X27 | fixed | 12-api-part4 §12.14 | 约束效果未改变投影时改为"不 bump、按 R20 重跑预检"，日志改 publicOpsLog('request.effect_noop') |
| X28 | fixed | 15-operations-part2 §15.5 第 2 步 | WATCHDOG_DELAY_MS → ACTION_WALL_MAX_MS（10 §10.11）+ 60 秒 |
| X29 | fixed | 15-operations.md O10、15-operations-part4 §15.8 clock 行 | 采用本地午夜 runAt 精确推进 + 小时 cron 兜底，否决列改为"只靠每小时 cron" |
| X30 | fixed | 17-roadmap.md E10 表行与 §17 E9 / E10 / E11 段 | 写明触发条件（换人 / 多审批人、forceClose 每月 ≥ 1 次、审批挂起 > 14 天）与席位转移做法，并引用 v1 兜底 rooms.forceClose（04 §4.11、INV-79） |
| X31 | fixed | 05 / 06 / 12 / 13 / 18（见各章条目） | state 侧 pass_to_next 落章请求与 canon 侧 X03 合并处理 |
| X32 | fixed | 03-schema-part9（constraints_changed 行）、03-schema-part2 §3.3.2 | 写明 constraints_changed 的 actor 恒为 system、变更角色只经 restrictedRef；RoomCtx = MutationCtx & { tx: RoomTx } 写成类型 |
| X33a | fixed | 06-rules-engine-part8 §12.1 末 | 登记 registry 的 scenarioOf(room) / latestScenarioVersion(key)，引擎与插件不 import 注册表 |
| X33b | fixed | 08-approval-execution-part5 S5 | getScenario(key).version 比较改为 scenarioOf(room) 可解析 |
| X33c | fixed | 11-architecture.md §11.3 目录树 | registry.ts 登记 scenarioOf(room) 与 latestScenarioVersion(key) |
| X33d | fixed | 12-api-part6 §12.19 | helper 表登记 scenarioOf / latestScenarioVersion 与 rollLocalDateTx |
| X34 | fixed | 16-testing-part4 TC-RUN-21…26、part8 §16.11.3 | 04 SM-28 / 29 / 30 / 31、09 SM-13 / CC-14 / CC-17 / CC-23 由 TC-RUN-22 / 24 / 23 / 21 承接，并在 §16.11.3 写出对应 |
| X35a | fixed | 00-canon-part2 D10 | 同 X11（protocol 侧同一请求） |
| X35b | fixed | 00-invariants-part2 INV-09 | 剔除集合改为 excludedCandidateKeys(run) |
| X35c | fixed | 01-product-part3（P4' 表） | "剔除已被阻断"改为 excludedCandidateKeys(run) |
| X35d | fixed | 02-domain-model-part5 INV-09 | 剔除集合改为 excludedCandidateKeys(run) |
| X35e | fixed | 04-state-machines-part3 U1 | 快照剔除改为 excludedCandidateKeys(run) |
| X35f | fixed | 08-approval-execution-part5 §8.5.4 第 2 步、part11 D10 行 | "已阻断集合"改为 excludedCandidateKeys(run) |
| X35g | fixed | 12-api-part4 §12.15 ⑪ | "候选进入本 run 已阻断集合"改为 excludedCandidateKeys(run)；补 reject 后场景版本不可解析的兜底 |
| X35h | fixed | 18-decisions-open-questions-part3 ADR-D10 | "剔除已被阻断"改为 excludedCandidateKeys(run) |
| X36 | fixed | 00-canon-part4（核对，无改动） | D27 已是 v2 $800、2 条 stale_approve（canon 包 OBJ-24），canon_objections 第 23 条的 v3 说法已被裁决否决 |
| X36b | fixed | 14-scenario-scope-change-part7 §16 末段 | D27 两处差异改述为"canon 已改写（C57）" |
| X36c | fixed | 18-decisions-open-questions-part6 ADR-D27、part7 N-04 | 残余改为"canon D27 已改写（C57）" |
| X36d | fixed | 01-product-part4 开放问题 4 | D27 差异改为已关闭（C57） |
| X37 | fixed | 00-canon §1.2 / part4 D22（核对，无改动） | D22 已写"query 与普通 mutation 一律读 rooms.localDate，只有推进处用 todayInTimeZone"（OBJ-20/44） |
| X38 | fixed | 03-schema-part5 | 同 X24（protocol 侧同一请求） |
| X40a | fixed | 00-invariants-part6 INV-77（核对，无改动） | INV-77 已列 rollLocalDateTx 为 localDate 写者 |
| X40b | fixed | 02-domain-model-part6 INV-77 | localDate 写者补 rollLocalDateTx 及其两个调用点 |
| X40c | fixed | 03-schema-part10 §3.13.2 rooms 行、part12 §3.21 D22 | localDate 写者补 rollLocalDateTx 及调用点 |
| X41 | fixed | 09-constraint-changes-part3 §9.6.7 | "本回合被 G3 判 stale"改为"D06 同事务 supersede 本 run、本 attempt 被 G1 判 stale"，并写明 negotiating 期间推进 localDate 通常不 bump |
| X42a | fixed | 00-invariants-part6 INV-70 | 已是 ops.livenessSweep 每 5 分钟（核对）；唤醒者改为 beginFnId（B6 / B6a）+ 巡检兜底 |
| X42b | fixed | 04-state-machines-part3 §4.3.5 | 巡检已是每 5 分钟（state 包）；opsLog 码 invariant.run_cv_drift → constraints_drift；beginAttemptTx 写全 { origin, delayMs, actorUserId, why } |
| X43 | fixed | 12-api-part6 §12.18 | beginAttempt args 加 retryNote；BeginResult 加 deferred.reason 与 limit.cause turn_attempts；检查范围改为 B1–B7 + B4a / B6a；modelResponseV 的 stopDetailsCategory → stopCategory；helper 名 beginAttemptTx |
| X44a | fixed | 00-canon-part3 D12 ⑥ | run_starts 恢复改为 B6a 的 beginFnId 延迟调度、巡检只兜底 |
| X44b | fixed | 04-state-machines-part2 §4.3.3、part3 §4.3.5 / U1、part5 SM-19 与唤醒表 | run_cap 判定只留在 10 B6a：startRunTx 不再自算桶，首回合由 beginAttemptTx 延迟登记 beginFnId，巡检只兜底（与 10 / 12 / canon D12 ⑥ 一致） |
| X44c | fixed | 10-agent-runtime-part2 B6a | 删去"12 B7 写的由巡检恢复"的对立表述，改为 04 / 12 / canon 同口径 |
| X44d | fixed | 12-api.md §12.2 第 7 条 | run_starts 恢复改为 B6a 的 beginFnId 延迟调度、巡检只兜底 |
| X45 | fixed | 16-testing.md TD-03 与分片说明、part2 §16.4.5、part9 §16.16、part4 TC-RUN-19 / TC-RUN-26、part5 TC-PRIV-20 / TC-INJ-01 / TC-INJ-08 / TC-PRIV-23 | callNegotiationModel → callModel（convex/model/agents/modelGateway.ts）；topicKey deadline → deadline_value；TC-PRIV-20 遍历 ≤ 152 个 schema 变体；TC-INJ-08 加 </candidates><turn_instruction> 标题写入拒绝；TC-INJ-01 断言 JSON \uXXXX 转义；privacy-12 L1（转发 counter 只以 optionKey / candidateKey 进入、第 7 个 run 拒绝或首回合延期，TC-RUN-26 / TC-PRIV-23），对应 10 RT-14 |
| X46 | fixed | 11-architecture.md §11.3 | core/engine/projection/ 增列 encodeBlock.ts 与组装顺序 |
| X47 | fixed | 07-permissions-privacy-part7 §7.14.3 | 写明组装顺序：净化 → encodeBlock → 加不经编码的字面量外层标签（source="provider.catalog_titles"） |
| X48 | fixed | 14-scenario-scope-change-part4 §9.4 B、part6 §11 G2 | source="provider.catalogTitle" → "provider.catalog_titles"；§11 F 的 opt_N 已无（核对） |
| X49 | fixed | 08（核对，无改动） | scope_mismatch 已全部改为 14 的 scope_insufficient（approval 包 names-26） |
| X50 | fixed | 01-product-part2 C8b | topicKey delivery_deadline → deadline_value；disclose 补 toRoles，clarify 选项补 end_run |
| X51 | fixed | 00-invariants（核对，无改动） | INV-55 已含"被规则阻断的候选不插提案、不消耗版本号"；INV-34 码名已是 auth.role_forbidden / request.not_open / request.option_unknown / run.invalid_state |
| X51b | fixed | 02-domain-model-part5 INV-34（核对，无改动） | 码名已与 12 §12.14 一致（model 包） |
| X52 | fixed | 05-protocol-part5 §5.11.2、06-rules-engine-part7 §11.2 | 二选一取 05：当前仍通过且未被拒的提案排第一，其余 rankForOwner；剔除"已阻断 ∪ 被拒 ∪ 复核失败"，刻意不用完整 excludedCandidateKeys（已提出未被拒的候选仍可供人选）；06 同步 |
| X52b | fixed | 06-rules-engine-part7 §11.1 / §11.2、part9 T06-U40 | buildHumanRequests 输入加 chooseExcludedKeys / currentCandidateKey；rounds_exhausted 的 choose_candidate 按 05 口径（当前提案优先、剔除已阻断 ∪ 被拒 ∪ 复核失败） |
| X53 | fixed | 09-constraint-changes.md §9.1.1、09-part2 §9.4、04-state-machines-part2 §4.3.3 | 删除第二份 hardProjection 实现，改为引用 06 §5.3 唯一实现；loadRuleInput 的引用 06 §6.2 → 06 §5.1 |
| X53b-12 | fixed | 12-api-part7 §12.20 注 | ops.setDraining 全部层级已是 canon 现文，删去"已列 canon_objections" |
| X54a | fixed | 01-product-part3 P2 | 标题失败码补"定界词 → disclosure.blocked{field:title}" |
| X54b | fixed | 09-constraint-changes-part3 §9.6.3 | 标题守卫补"NFKC 后含定界词 → disclosure.blocked{field:title}"两码划分，④ 补后续房间已交付键 item.duplicate |
| X54c | fixed | 03-schema.md §3.2 值规则表 | 目录标题补"NFKC 后含定界词 → disclosure.blocked{field:title}"一行，格式失败码写明 field |
| X55a | fixed | 03-schema.md §3.2（核对）、12-api-part3 §12.12 ⑥ | 任务模板标题上限统一为 80（03 TEXT_LIMITS 与 14 §5 已是 80，12 由 120 改为 80） |
| X55b | fixed | 12-api-part3 §12.12 ⑥ | 任务模板标题上限 120 → 80 |
| X56a | fixed | 00-invariants-part7 CE-006、part8 CE-045 | softFields.preferredDate 改为 preferredItemKeys（v1 无 preferredDate） |
| X56b | fixed | 02-domain-model-part4（核对，无改动） | 字段表已写明 v1 没有 preferredDate |
