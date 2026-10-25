# 99 · 修订轮处置总表（part7）：§2.2 跨章修正清单（2）

> 分片见 `99-review-log.md` 顶部。

## 2.2 跨章修正清单（2）

| 编号 | 处置 | 位置 | 说明 |
| --- | --- | --- | --- |
| X57 | fixed | 16-testing-part5 §16.7.1 / §16.7.4（核对，无改动） | C1 已是 canary 默认、C2 主 fixture；金丝雀数值已由 14 §9.5 推出（privacy 包） |
| X58 | fixed | 16-testing-part5 TC-PRIV-13（核对）、TC-PRIV-14、TC-PRIV-20 | TC-PRIV-13 已是 12 §12.17 形状并含 C0（privacy 包）；TC-PRIV-14 补 stale v1 逐字节不变；TC-PRIV-20 补"无按角色代理动作文本" |
| X59a | fixed | 00-invariants-part3 INV-20、part7 CE-036 | agent_recommended 改为 turn_completed |
| X59b | fixed | 01-product-part3 P2、01-product-part4 X11 | catalog_confirmed / ledger_baseline_recorded / run_pending_approval / run_superseded / execution_completed 改为 03 §3.11.1 名；follow-up 事件改为 room_created + follow_up_started |
| X60a | fixed | 02-domain-model-part4 §2.8、part7 Q1 | isExecutable 口径说明改为"已统一、不含审批集合"，Q1 关闭 |
| X60b | fixed | 13-frontend.md FE-D12、13-frontend-part6 D19 / D02 行 | 删去"isExecutable 在 08 含审批已齐"与"定义待 canon"，改引 canon §1.3（C44） |
| X61 | fixed | 00-canon §1.5（核对，无改动） | approval.not_executable 与 item.limit_exceeded 已在码表（canon 包 names-38） |
| X62 | fixed | 03-schema-part9 constraints_changed 行 | 补"provider 对任何 cause 只见 Constraints changed，目录事实经 catalog_item_* 事件渲染" |
| X63a | fixed | 02-domain-model-part5 INV-15（核对，无改动） | 已是 invite.seat_taken（model 包） |
| X63b | fixed | 03-schema-part10 addMember、part3 invites（核对，无改动） | 已是 invite.seat_taken 与 invites.insertLink（model 包） |
| X63c | fixed | 06-rules-engine-part3（核对，无改动） | invite.expired / invite.email_mismatch 只出现在"不设"注释里，数组已与 12 §12.4 一致 |
| X64a | fixed | 11-architecture-part3 §11.10 | 补"唯一 Route Handler 是无业务数据的 /api/health，自行 auth() 返回 401" |
| X64b | fixed | 13-frontend.md §13.1（核对，无改动） | 已写"唯一的 Next Route Handler 是 /api/health"，与 FE-D14 一致（product 包） |
| X64c | fixed | 18-decisions-open-questions-part5 ADR-D19 | 补 proxy / 布局兜底与"唯一 Route Handler /api/health"的口径 |
| X65 | fixed | 00-overview.md §0.3（核对） | product 包已按 00-invariants-part11 §3 重写 §0.3 并删去旧口径；本次只同步 INV 范围与 CE-176 起编号 |
| X66 | fixed | 00-canon-part3 D12 末句 | "探针风险由 ⑥⑦ 限制"改为速率 / 总量 / 可见度三者只能限量；D17 已无"堵住零成本预言机" |
| X67 | fixed | 03-schema-part5 | 同 X24（privacy 侧同一请求） |
| X68a | fixed | 03-schema-part9 disclosure_changed / human_request_closed 行 | 受众外查看者并入同提交的 Constraints changed，provider actor 标签为空 |
| X68b | fixed | 12-api-part5 timeline.page | 视图模型补 disclosure_changed / human_request_closed 并入规则、他人约束变更提交对 provider actor 置 system、buyers 受众 reasonKey 只对买方连接 |
| X69a | fixed | 03-schema-part4 sharedFacts | appendSharedFact 违例日志改为 publicOpsLog('shared_fact.audience_violation') |
| X69b | fixed | 07-permissions-privacy-part8 E1 代码块 | OpsCode → OpsLogCode；PublicOpsCode 示例改为 15 §15.6.2 闭集成员 |
| X69c | fixed | 08-approval-execution.md A4、part5 S11、part6 §8.6.6 / X14、part7 K31 | 公开路径日志改为 publicOpsLog（approval.not_executable / view.vacant_slot / approval.self_conflict / invariant.open_request_at_execution） |
| X69d | fixed | 11-architecture.md §11.3、11-architecture-part2 §11.5 L11 / §11.6 | 构造器只在 internal / action 上注入 InternalCtx 品牌；withSanitizedErrors 改用 publicOpsLog；新增 lint L11 禁止公开模块 import opsLog |
| X69e | fixed | 12-api.md §12.4、12-api-part4 §12.14 / §12.15 ⑨ | 公开路径日志改为 publicOpsLog |
| X69f | fixed | 15-operations-part3 §15.6.2 / §15.6.4、15-operations.md O4、part5 D16 行 | §15.6.2 改为两个 logger 的唯一定义（InternalCtx 品牌、OpsLogCode、PublicOpsCode 闭集、合并后的 SafeFieldName 白名单），告警同时匹配两种行 |
| X70 | fixed | 06 §9.2 / 14 S7（核对，无改动） | previewChange 已无 feasibility 枚举（rules 包 privacy-03）；06 T06-P4 的 feasibility 指 enumerateCandidates 的模式，不是预览 |
| X71 | fixed | 16-testing-part5 §16.7.1（核对，无改动） | 金丝雀数值以 14 §9.5 为唯一来源，14 无需改动 |
| X72 | fixed | 00-invariants-part2 INV-18、part7 CE-029（核对，无改动） | 现文已区分：非本角色可共享字段 / 越界受众 → disclosure.blocked，本人硬字段未二次确认 → needs_own_confirmation，sharedFacts.add 无 value 参数 |
| X73 | fixed | 00-canon-part4 D25 | lines[] 补 kind: 'item' \| 'modifier' |
| X73b | fixed | 08-approval-execution-part3 §8.3.1 | "canon D25 缺 kind、canon 待补"改为与 canon 现文一致 |
| X74 | fixed | 00-canon §1.2（核对，无改动） | constraintRevisions cause 已含 scenario_migrated |
| X75 | fixed | 00-canon-part2 D04（核对，无改动） | 两项豁免已写入（OBJ-02） |
| X75b | fixed | 08-approval-execution-part11 D04 行 | "canon 待补"改为 canon D04 现文已列两项豁免 |
| X76 | fixed | 12-api-part4 §12.15 ⑧ | 按 08 S9 改为三种读法：reject 只读本人最新一行；withdraw 读本人区间（≤ 71 行）计数；approve 人均上限 60 只在需写新行时生效，unchanged 收敛不受挡 |
| X77a | fixed | 03-schema-part9 approval_recorded、part7 approvals 披露类 | reasonKey 只在受众为 room 时进 payload；buyers 键经 restrictedRef；披露类改按 humanReasonKeys[].audience |
| X77b | fixed | 12-api-part4 §12.15 ⑩ | approval_recorded 的 reasonKey 只在受众为 room 时进 payload，buyers 键经 restrictedRef |
| X78 | fixed | 16-testing-part3 TC-VER-15、part5 TC-PRIV-24、part8 CE-056 行 | 新增 I22（approve 60 / withdraw 10 上限只挡这两种、reject 仍成功、无 internal）与 I23（over_our_limit 不进 provider 任何面）；写明 reject 的允许错误集收紧（E14） |
| X79a | fixed | 04-state-machines-part3 U1 | createTurnTx 加场景版本前置：scenarioOf(room) 不可解析 → 不建回合、needs_input + agent_failed(end_run)，引 08 §8.5.4 与 15 §15.5.1 |
| X79b | fixed | 10-agent-runtime-part6 F33 | 失败表补"场景版本不可解析时 reject 后建回合 → agent_failed(end_run)" |
| X79c | fixed | 12-api-part4 §12.15 ⑪ | reject → createTurnTx 版本不符 → needs_input + agent_failed(end_run) |
| X79d | fixed | 15-operations-part2 §15.5.1（新增）、part3 §15.6.6 | 场景版本迁移纪律：注册表只增不删、删除前检查 liveRoomsByScenarioVersion、必要时 bump(scenario_migrated)；兜底引 08 S5 / 04 U1 / 10 F33 |
| X80 | fixed | 14-scenario-scope-change-part5 S10（核对，无改动） | 已改为 approval.not_current（当前性守卫先于 stale 检查，rules 包） |
| X81 | fixed | 07-permissions-privacy-part9 §7.21 R-9 | 登记 08 O15：不带理由的 finance 拒绝泄露 buyers 键这 1 bit，默认接受，并写出不接受时的改法 |
| X81b | fixed | 07-permissions-privacy-part9 R-9 | 08 O15 的 1 bit 由 07 登记接受；14 §3 无需改动（不接受时的改法已写在 R-9） |
| X82 | fixed | 12-api-part5 §12.17 recordsPreview | 口径统一到 08：commitCents = terms.amountCents（本次增减），三方可见；已承诺额 / cap / headroom 不在此 DTO |
| X83a | fixed | 00-canon-part3 D12 ② | 补 rejected / nextConstraintsVersion / unchanged 分支，形状仍以 12 §12.17 为准 |
| X83b | fixed | 00-invariants-part2 INV-11（CE-013 核对无改动） | previewChange 分支补 rejected / nextConstraintsVersion / unchanged；CE-013 已是"种类非本人 → null、本人变更 → recheck" |
| X83c | fixed | 16-testing-part8 §16.11.2 | 引 "12 §12.11" 的旧行随 §16.11.2 删为指针一并消失；TC-PRIV-13 已是 12 §12.17（核对） |
| X84a | fixed | 02-domain-model-part5 INV-17 / part6 INV-44（核对，无改动） | 已是 auth.user_not_provisioned / not_member / role_forbidden |
| X84b | fixed | 06-rules-engine-part3（核对，无改动） | API_ERROR_CODES 恰为 12 §12.4 的 13 个码；approval.not_executable 参数 reasonCodes；retryAfterMs / currentConstraintsVersion / minAllowedCapCents 已在 PARAM_AUDIENCE |
| X85 | fixed | 18-decisions-open-questions-part7 N-24、part9 09·Q9（核对，无改动） | 已标"已解决：以 12 §12.12 批量签名为准"（product 包） |
| X86a | fixed | 00-invariants-part10 CE-156（INV-63 核对无改动） | "停在确认前"改为缺省开首个 run、stopBeforeRole 停 setup、seed 不写提案 / 审批 / 执行 |
| X86b | fixed | 01-product-part4 X8 | seed 改为只写输入链、缺省开首个 run、stopBeforeRole 停 setup、不写提案 / 审批 / 执行 |
| X86c | fixed | 02-domain-model-part6 INV-63 | seed 口径改为缺省开 run、stopBeforeRole 停 setup |
| X86d | fixed | 15-operations-part5 Q11 | seed 终止状态关闭（canon D18 现文一致） |
| X86e | fixed | 18-decisions-open-questions-part5 ADR-D18 | seed 决定改为缺省开首个 run、stopBeforeRole 停 setup |
| X87a | fixed | 00-canon-part2 D04 | startFollowUp 只复制未交付的目录行，已交付键 item.duplicate |
| X87b | fixed | 00-invariants-part4 INV-52、part9 CE-112、part11 CE-168 | 补跨房间规则：后续房间目录 / 快照不含已交付条目，已交付键 catalog.confirm → item.duplicate |
| X87c | fixed | 01-product-part2 C12 | "目录复制为 draft"改为只复制未交付条目，已交付键 item.duplicate / item.unknown |
| X87d | fixed | 02-domain-model-part6 INV-52 | 补跨房间规则（只复制未交付行、已交付键 item.duplicate） |
| X87e | fixed | 03-schema-part10 appendCatalogRow | 守卫补"后续房间重用已交付键 → item.duplicate"；§3.7 复制过滤已在（model 包） |
| X87f | fixed | 06-rules-engine-part3 item.duplicate 行 | 产生者补"后续房间重新上架已交付键" |
| X87g | fixed | 08-approval-execution-part2 A9 | "天然杜绝"改为引用 startFollowUp 的复制过滤与 item.duplicate |
| X87h | fixed | 13-frontend-part5 §13.10 C | 后续房间只读显示 followUpOf.deliveredItems（"Delivered in CO-n"），RequiredItemsPicker 不列已交付键 |
| X87i | fixed | 16-testing-part4 TC-EXE-06 / TC-EXE-11、part8 CE-112 / 168 行 | 断言后续房间目录与 provider 快照不含旧执行 itemKey、已交付键 item.duplicate |
| X88a | fixed | 07-permissions-privacy-part9 §7.21 R-10 | 对 12 Q18 作处置：登记为残余推断（只暴露回合角色与顺序），写明不接受时改为合并买方阶段的连带改动 |
| X88b | fixed | 16-testing-part5 TC-PRIV-02 | 加 refusal / invalid_output → agent_failed 两种情形，provider 视图与时间线无 failed / failureKind / attemptStatus / waitingReason 痕迹 |
| X89a | fixed | 06-rules-engine-part9 T06-S4 | 断言 checks[].text 只消费 PARAM_AUDIENCE 已声明且已裁剪的参数 |
| X89b | fixed | 07-permissions-privacy-part6 §7.11 | version.stale_source 参数改为 itemKeys（room），与 06 PARAM_AUDIENCE 一致；表格排版断裂已由 privacy 包修复（核对） |
| X89c | fixed | 06-rules-engine-part9 T06-S4（16 侧无独立断言，T06-S4 在 16 的 CI 闸门中执行） | 渲染只消费 PARAM_AUDIENCE 已声明参数 |
| X90 | fixed | 10-agent-runtime-part5（核对，无改动） | 指标行已是 opsLog('spend_deferred') 计数与按 waitingReason 统计 |
| X91a | fixed | 00-canon §1.2 | 新增 writeSeq 行（M-ROOM，INV-M1）；§1.1 constraintRevisions / rawOutputs 与 editNo 已在（canon 包） |
| X91b | fixed | 00-invariants-part6 §1.11、part11 §3 / §3.1、00-invariants.md、00-canon.md 页首、README | 新增 INV-M1（房间写锁）与 INV-79，编号单一来源说明同步 |
| X91c | fixed | 00-overview-part2 §0.6.2 | 表改为"已由 canon 吸收"的指针表（canon §1.1 / §1.2 / §1.6 / D18，N-09 / N-31…33 已解决） |
| X91d | fixed | 02-domain-model-part6 INV-M1、part7 Q4 | INV-M1 标为已并入 00-invariants，Q4 关闭 |
| X91e | fixed | 18-decisions-open-questions-part10 ADR-X01…X04、part7 N-09 / N-31 / N-32 / N-33、§18.0 | ADR-X 标题改为"细化 canon …"，与 canon 关系改为已吸收；四个 N 标已解决 |
| X92 | partially | 02-domain-model-part5 页首 | 不删"简述"列（检索需要），改为声明其非规范、谓词以 00-invariants 为准，并修正本轮发现的漂移行（INV-09 / 52 / 63 / 70 / 73 / 77 / M1）；整表重排为三列未做 |
| X93a | fixed | 03-schema-part8（核对，无改动） | canon §1.6 现已登记 tasks.markDone，"已补录"说法属实 |
| X93b | fixed | 07-permissions-privacy-part9 §7.24 第 11 条 | 同 X10c |
| X93c | fixed | 08-approval-execution-part6（核对，无改动） | "canon §1.6 已补录 tasks.markDone"现已属实 |
| X94 | fixed | 16-testing-part4 TC-OPS-05 | "新增 INV-57" → INV-59 |
| X95 | fixed | 10-agent-runtime-part7 开放问题 5（核对，无改动） | 已是 dev 30 / prod 7 |
| X96 | fixed | 01-product-part4 X6 / X7 / X9 | setup 出口改为 openIfReady；身份消失兜底写入请求过期与 rooms.forceClose（INV-79） |
| X96b | fixed | 17-roadmap.md E10 | 同 X30（product 侧同一请求） |
| X97 | fixed | 00-invariants（核对） | 16 §16.11.2 的 8 条期望已由 canon 包并入电池（C43）；INV-M1 见 X91b |
| CN002-2/3 | fixed | 06-rules-engine-part7 §11.2、00-invariants-part6 INV-74 | escalate(infeasible) 开 infeasible 请求（不是 agent_escalated）；customer agent_escalated 提供 keep_as_is（= 下一轮），与 canon D15 / 05 一致 |
| INV79-16 | fixed | 16-testing-part4 TC-RUN-24 / TC-RUN-25 / TC-EXE-12 | 新增终结活性、场景版本兜底与 INV-M1 变异用例（00-invariants part11 §3.1 已引用） |
| N-18-18 | fixed | 18-decisions-open-questions-part7 N-18 | rawOutputs 保留期由"默认 30 天"改为 dev 30 / prod 7 |
| N-beginAttemptTx | fixed | 10-agent-runtime-part2 §10.5.1、12-api-part6 §12.18 | 事务 helper 统一名 beginAttemptTx（04 / 08 已用，canon §1.6 已登记），BeginOpts 加 why?；B6a 说明改为与 04 / 12 / canon 一致 |
| N-beginAttemptTx-11 | fixed | 11-architecture.md §11.3 | model/turns.ts 的 helper 名改为 beginAttemptTx |
| N-beginAttemptTx-2 | fixed | 10-agent-runtime-part2 / part3、12-api-part4 / part6 | 叙述中的 helper 调用 beginAttempt(…) 统一为 beginAttemptTx(…) |
| N-brief-12 | fixed | 12-api-part5 §12.17 rooms.view.members | briefVersion 的置空范围对齐 07 DX-7（只对 provider 置 null；买方互见），原 12 写'对非本人一律 null'与 07 矛盾 |
| N-excl-03 | fixed | 03-schema-part2 §3.4、03-schema-part5 §3.8 | excludedCandidateKeys 定义补齐第三部分（choose_candidate 复核失败，由 regenerated 请求的 answerOptionKey 派生） |
| N-excl-07-05 | fixed | 07-permissions-privacy-part7 §7.14.2、05-protocol-part4 §5.8.5 | 剔除集合措辞补齐复核失败；rounds_exhausted 的 choose_candidate 口径对齐 §5.11.2 |
| N-helper | fixed | 00-canon §1.6 | 事务 helper 名补 beginAttemptTx / rollLocalDateTx / scenarioOf（各章已在用，canon 未登记） |
| N-matrix-07 | fixed | 07-permissions-privacy-part6 §7.12.1 / §7.12.2 | 第 2 步对账：07 动作矩阵缺 12 的公开函数 catalog.list / proposals.get / executions.forRoom / users.viewer / users.ensureViewer / health.ping，已补行（受众与 12、08 一致） |
| N-names-01 | fixed | 01-product-part3（task_done → task_completed）、10-agent-runtime-part7（r13 startRunInternal → startRunTx）、08-approval-execution-part2 A10（getScenario → scenarioOf）、00-invariants-part9 CE-073（budget.fits 不是码） | 第 2 步 grep 发现的残留别名 |
| N-names-02 | fixed | 12-api-part4 §12.13、02-domain-model-part3、08-approval-execution-part10、18-decisions-open-questions-part3 | "买方视图可行集"（误导为 customer 视图）改为"全量约束下的可行集（buyerFeasible，04 §4.3.3）"；runs.start 的 beginAttempt(origin: 首个) → beginAttemptTx(origin: "turn_start") |
| N-names-03 | fixed | 12-api-part7 rooms.forceClose、15-operations-part3 OpsLogCode、04-state-machines-part4 §4.8.2 | opsLog 带自由文本 reason 改为只记 roomId，room_force_closed 入 OpsLogCode；04 的 request.effect_noop 改 publicOpsLog |
| N-names-04 | fixed | 06-rules-engine-part7 §11.1 | Effect 判别字段 kind → type（与 03 §3.9 requestEffectV、05、12 的线格式一致），补不可回答的 blocked 分支 |
| N-names-05 | fixed | 05-protocol.md P12 / part5 §5.9.1、06-rules-engine-part8 §12.2 第 5 条、07-permissions-privacy-part7 LP-5 / part8 T-31 / part9 §7.25、18-decisions-open-questions-part4 ADR-D12、00-invariants-part7 CE-010 | option_fits_constraints 仍按"只限 provider / seller"书写的残留，改为 canon D12 ③ 修订后的"任何角色都没有"；ADR-D12 的 previewChange 分支同步；07 §7.25 的"第三份确认自动 runs.start"改为 openIfReady |
| N-names-06 | fixed | 06-rules-engine.md R-D12 与分片说明、06-rules-engine-part2 §3、part8 标题、part9 D21 行、17-roadmap-part2 R6 | ScenarioPlugin 成员数"15"改为 06 §12.1 的 16 个必需 + 2 个可选 |
| N-table-01 | fixed | 00-canon-part4 D25、06-rules-engine-part2 §4 目录标题行 | 表格单元内未转义的 `\|` 破坏列数（前者是本阶段补 kind 时引入，后者原有），改为 \| |

## 3. 未解决项（需要人或后续阶段处理）

| # | 事项 | 现状 | 需要谁 |
| --- | --- | --- | --- |
| U-01 | **核对者改了 canon 文字**：共同规则写明"00-canon 只有 canon 包可改"，但 canon 包与各包并行运行，其后到达的 canon 请求（D04 后续房间复制过滤、D10 剔除集合、D12 ② 分支与 ⑥ `run_cap` 恢复、D12 末句预言机措辞、D15 `disclose.toRoles`、D18 清理范围与 `privacy.redact` 豁免、D25 `lines[].kind`、§1.2 `writeSeq`、§1.6 `beginAttemptTx` / `rollLocalDateTx` / `scenarioOf`、页首 INV 范围）已由核对者按各章已统一的实现写回 canon，每处标"核对者同步" | 只同步、未新增决定；若 canon 所有者不认可任一处，需反向改回并通知受影响章节 | canon 所有者 / 用户确认 |
| U-02 | 02 part5 / part6 的不变量表仍保留\"简述\"列（completeness-30 / X92 只部分处置） | 已声明简述非规范、谓词以 00-invariants 为准，并修正了本轮发现的漂移；整表重排为\"编号 → 数据落点 / 唯一写者 / 守卫码\"三列未做 | 02 所有者（低优先级） |
| U-03 | `_changes/CN-001`（不在本轮跨章备注内）：已合并的网关代码是"SDK `maxRetries = 0`、网关单层重试只对 429 与连接错误、总截止早于看门狗、截断在调用内重试一次"，而 canon D09 与 10 R11 / §10.11（`CALL_DEADLINE_MS = 448_000`）/ §10.10.2 写的是 SDK `maxRetries: 1` | 设计与代码不一致，且 CN-001 要求改的方向与 canon D09 现文相反，核对者不能单方面改 10 | canon 先裁决 D09 的重试层与截止口径，再由 10 跟随 |
| U-04 | spikes §8 的 18 项真实部署验证（U11）仍未做：`v.commitTs()` 拼写与语义、OCC 对空区间读的冲突、prod 是否下发 `logLines`、运行时 `Intl` 时区（V-D2）、mutation 内 `crypto`、convex-test 中 `vi.mock` 是否生效、结构化输出对 `const` / `enum` 的接受度等 | 设计已为每项写出退路，但房间写锁、日志纪律、时区推进都押在其中几项上 | 实现第 1 周按 16 §16.8.1 分配 |
| U-05 | 用户决策 U1–U12（canon part4）仍按默认值书写 | 任何一项改动都会影响多章（尤其 U1 预算可见性、U2 fit 粒度、U3 执行后房间、U4 串行墙钟、U7 审批不过期） | 用户 |
| U-06 | 已接受的残余推断需要用户知情同意：07 §7.21 新登记的 R-9（不带理由的 finance 拒绝泄露 `buyers` 受众键的 1 bit，08 O15）与 R-10（provider 能看出哪个买方回合之后进入等待，12 Q18），以及既有的 R-1（每房间每天合计 ≤ 39 bit 的预检 / counter 信道） | 默认接受，并写明不接受时的改法 | 用户 / 隐私负责人 |
| U-07 | `pass_to_next` 的体验：转交只按位置提供，所以在变体 D / E 中 customer 把请求转给 finance 时，finance 往往只能收到回退项与 `end_run`（00-invariants-part11 §4 第 12 条已登记） | 这是\"不构成预言机\"的代价，设计接受；文案需让用户预期\"转交不保证对方能解决\" | 13 / 产品文案 |
| U-08 | 场景版本迁移只有纪律没有工具：15 §15.5.1 规定注册表只增不删、删除前检查 `liveRoomsByScenarioVersion`、必要时人工 `bump(scenario_migrated)`；v1 没有迁移脚本 | 违规时由 08 S5 / 04 U1 / 10 F33 兜底，不会写坏数据 | 15 / 第二个场景落地前 |
| U-09 | 本阶段新增的测试编号（16 TC-RUN-21…26、TC-EXE-11 / 12、TC-PRIV-22 / 23 / 24、TC-VER-15，06 T06-U39 / U40）只到用例矩阵层，脚本与 fixture 待实现时编写 | 已与 04 SM-28…31、09 CC-14 / 17 / 23、08 I22 / I23、00-invariants INV-79 / INV-M1 对上编号 | 实现阶段 |
| U-10 | 规则结论按角色投影的函数有两份契约：06 §8 `projectEvaluation(ev, viewer, plugin, disclosures)`（`owner` + 析取范式 `requires`、`side: 'seller'`）与 07 §7.11 `projectChecks(viewer, evaluation)`（`ownerRole` + 合取 `inputs`、`fitOnlyRoles`），00-invariants INV-06 / CE-035 与 02 又叫 `projectRuleCheck` | 两者的规则（provider 只见 fit、掩码合并为一条、通过的掩码检查省略、参数 fail-closed）一致，差在类型形状与名字；核对者没有替两章选一个（另一工作流的 `_changes/CN-004` 第 1 条称代码已按 07 实现） | 06 / 07 所有者裁决唯一名字与 `CheckResult` 形状，再统一 INV-06 / CE-035 / 02 |
| U-11 | `_changes/CN-002…CN-004` 是另一工作流在本轮进行期间写入的变更单（状态均为"v2 修订后再应用"），不属于本轮跨章备注 | 与本轮范围重合、已顺带处理的：CN-002 第 1–4、6、9、10 条，CN-003 第 3 条，CN-004 第 2 条（Effect 判别字段 `type`、`blocked`）、第 3 条（插件 16 + 2 成员）、第 4 条（`option_fits_constraints` 任何角色都没有）、第 6 条（`run_cap`、`pass_to_next`、`approval_recorded.reasonKey`）、第 7 条（CE-006 / 045、`briefVersion` 范围按 07）。仍需裁决：CN-003 第 1 / 2 / 4 / 5 条（`enumerateCandidates` 归属与 D21 措辞、counter 的 n ≥ 1 / 2、feasibility 无上限、`viewFor` 唯一构造）、CN-004 第 1 条（即 U-10）、第 3 条的 `CheckCtx` 形状、第 5 条（即 U-03）、第 6 条的 `turn_failed.failureKind` 是否留在 room payload 与 `retired` 能否重新上架、第 7 条的 `INV-01/02/19` 可见性来源写法与 D12 ① 历史 stale 显示、第 8 条（DISCLOSURE 代理列、模板措辞归属、RuleInput 带 provenance、场景词汇 lint 白名单） | 各章所有者 / canon 所有者 |
