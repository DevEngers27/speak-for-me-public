# xcheck 包处置记录（跨章一致性核对与汇总，2026-10-24）

格式：`<编号> | fixed|partially|rejected | <文件> | <一句话>`。编号 Xnn 对应 harness 下发的第 nn 条跨章备注（索引见文末），Xnn 后缀 a/b/c… 或 -章号 表示同一备注落在不同章节的分条；N-* 为第 2 步全仓 grep 自行发现的不一致。汇总表与未解决项见 `99-review-log.md`（分片，未解决项在最后一个分片末尾）。

X08 | fixed | 00-canon-part3（核对，无改动）、03-schema-part9、03-schema-part12 | canon D14 已列八表（C59，canon 包 OBJ-04）；03 §3.11 说明段与 Q13 改为已关闭
X09 | fixed | 00-canon-part3 D15 | disclose 改为 { field, toRoles } 并注明受众来源（核对者同步）
X10 | fixed | 00-canon-part3 D18 | 补 privacy.redact 为只追加表唯一例外（只覆写 REDACTABLE_FIELDS、不删行）
X11 | fixed | 00-canon-part2 D10 | 剔除集合改为 excludedCandidateKeys(run) = 已提出（含被阻断）∪ 被拒 ∪ 复核失败
X23a | fixed | 00-canon-part3 D18 | "rooms.close 是生产唯一清理"限定为 setup / open 房间，executed 保持只读
X35a | fixed | 00-canon-part2 D10 | 同 X11（protocol 侧同一请求）
X36 | fixed | 00-canon-part4（核对，无改动） | D27 已是 v2 $800、2 条 stale_approve（canon 包 OBJ-24），canon_objections 第 23 条的 v3 说法已被裁决否决
X37 | fixed | 00-canon §1.2 / part4 D22（核对，无改动） | D22 已写"query 与普通 mutation 一律读 rooms.localDate，只有推进处用 todayInTimeZone"（OBJ-20/44）
X44a | fixed | 00-canon-part3 D12 ⑥ | run_starts 恢复改为 B6a 的 beginFnId 延迟调度、巡检只兜底
X61 | fixed | 00-canon §1.5（核对，无改动） | approval.not_executable 与 item.limit_exceeded 已在码表（canon 包 names-38）
X66 | fixed | 00-canon-part3 D12 末句 | "探针风险由 ⑥⑦ 限制"改为速率 / 总量 / 可见度三者只能限量；D17 已无"堵住零成本预言机"
X73 | fixed | 00-canon-part4 D25 | lines[] 补 kind: 'item' | 'modifier'
X74 | fixed | 00-canon §1.2（核对，无改动） | constraintRevisions cause 已含 scenario_migrated
X75 | fixed | 00-canon-part2 D04（核对，无改动） | 两项豁免已写入（OBJ-02）
X83a | fixed | 00-canon-part3 D12 ② | 补 rejected / nextConstraintsVersion / unchanged 分支，形状仍以 12 §12.17 为准
X87a | fixed | 00-canon-part2 D04 | startFollowUp 只复制未交付的目录行，已交付键 item.duplicate
X91a | fixed | 00-canon §1.2 | 新增 writeSeq 行（M-ROOM，INV-M1）；§1.1 constraintRevisions / rawOutputs 与 editNo 已在（canon 包）
N-helper | fixed | 00-canon §1.6 | 事务 helper 名补 beginAttemptTx / rollLocalDateTx / scenarioOf（各章已在用，canon 未登记）
X12 | fixed | 00-invariants-part6（核对）；03 §3.20、02 §2.14 见各章条目 | INV-67 已改为 currentRunId 指向最新 run、不清空（canon 包 invariants-09），INV-24 / 57 / 75 cause 已改名（names-18）
X22 | fixed | 00-invariants-part6 | INV-72 ② / CE-135 已是 rounds_exhausted（canon 包已改，核对）；INV-73 补 pass_to_next 的出现条件与"不 bump"；新增 INV-79 终结活性（04 INV-SM-07 / rooms.forceClose）
X35b | fixed | 00-invariants-part2 INV-09 | 剔除集合改为 excludedCandidateKeys(run)
X40a | fixed | 00-invariants-part6 INV-77（核对，无改动） | INV-77 已列 rollLocalDateTx 为 localDate 写者
X42a | fixed | 00-invariants-part6 INV-70 | 已是 ops.livenessSweep 每 5 分钟（核对）；唤醒者改为 beginFnId（B6 / B6a）+ 巡检兜底
X51 | fixed | 00-invariants（核对，无改动） | INV-55 已含"被规则阻断的候选不插提案、不消耗版本号"；INV-34 码名已是 auth.role_forbidden / request.not_open / request.option_unknown / run.invalid_state
X56a | fixed | 00-invariants-part7 CE-006、part8 CE-045 | softFields.preferredDate 改为 preferredItemKeys（v1 无 preferredDate）
X59a | fixed | 00-invariants-part3 INV-20、part7 CE-036 | agent_recommended 改为 turn_completed
X72 | fixed | 00-invariants-part2 INV-18、part7 CE-029（核对，无改动） | 现文已区分：非本角色可共享字段 / 越界受众 → disclosure.blocked，本人硬字段未二次确认 → needs_own_confirmation，sharedFacts.add 无 value 参数
X83b | fixed | 00-invariants-part2 INV-11（CE-013 核对无改动） | previewChange 分支补 rejected / nextConstraintsVersion / unchanged；CE-013 已是"种类非本人 → null、本人变更 → recheck"
X86a | fixed | 00-invariants-part10 CE-156（INV-63 核对无改动） | "停在确认前"改为缺省开首个 run、stopBeforeRole 停 setup、seed 不写提案 / 审批 / 执行
X87b | fixed | 00-invariants-part4 INV-52、part9 CE-112、part11 CE-168 | 补跨房间规则：后续房间目录 / 快照不含已交付条目，已交付键 catalog.confirm → item.duplicate
X91b | fixed | 00-invariants-part6 §1.11、part11 §3 / §3.1、00-invariants.md、00-canon.md 页首、README | 新增 INV-M1（房间写锁）与 INV-79，编号单一来源说明同步
X23b | fixed | 00-invariants-part5 INV-54 | "rooms.close 是唯一清理"限定为 setup / open 房间
X97 | fixed | 00-invariants（核对） | 16 §16.11.2 的 8 条期望已由 canon 包并入电池（C43）；INV-M1 见 X91b
X01 | fixed | 00-overview.md §0.3、00-overview-part2 §0.6.1 / §0.6.2 / §0.7 / §0.9 / §0.10 | §0.3 已是 CE-001…170（product 包），本次删去"按 16 §16.11.2 修订后断言"、INV 范围改 01…79 + INV-M1；§0.6 以引用方式采用 canon §1.1–1.3，canon 新增项（constraintRevisions、rawOutputs、editNo、currentRunId、run cause、passesChecks 三判定、stale→active、openIfReady）随引用自动生效，§0.6.1 改引 canon §1.3；§0.9 第 3、4 条关闭；§0.10 补 C43–C60 落点行
X65 | fixed | 00-overview.md §0.3（核对） | product 包已按 00-invariants-part11 §3 重写 §0.3 并删去旧口径；本次只同步 INV 范围与 CE-176 起编号
X91c | fixed | 00-overview-part2 §0.6.2 | 表改为"已由 canon 吸收"的指针表（canon §1.1 / §1.2 / §1.6 / D18，N-09 / N-31…33 已解决）
X03-01 | fixed | 01-product-part3 F7、01-product-part4 X6 | 取舍旅程补 pass_to_next（"Pass to Finance"，按位置提供、不 bump、目标按自身视图）与 kind→选项说明
X35c | fixed | 01-product-part3（P4' 表） | "剔除已被阻断"改为 excludedCandidateKeys(run)
X50 | fixed | 01-product-part2 C8b | topicKey delivery_deadline → deadline_value；disclose 补 toRoles，clarify 选项补 end_run
X59b | fixed | 01-product-part3 P2、01-product-part4 X11 | catalog_confirmed / ledger_baseline_recorded / run_pending_approval / run_superseded / execution_completed 改为 03 §3.11.1 名；follow-up 事件改为 room_created + follow_up_started
X86b | fixed | 01-product-part4 X8 | seed 改为只写输入链、缺省开首个 run、stopBeforeRole 停 setup、不写提案 / 审批 / 执行
X87c | fixed | 01-product-part2 C12 | "目录复制为 draft"改为只复制未交付条目，已交付键 item.duplicate / item.unknown
X96 | fixed | 01-product-part4 X6 / X7 / X9 | setup 出口改为 openIfReady；身份消失兜底写入请求过期与 rooms.forceClose（INV-79）
X54a | fixed | 01-product-part3 P2 | 标题失败码补"定界词 → disclosure.blocked{field:title}"
X12b | fixed | 02-domain-model-part7 §2.14 Q2 / Q5 | canon 已改写 INV-67 与 cause 名，两条改为已关闭
X35d | fixed | 02-domain-model-part5 INV-09 | 剔除集合改为 excludedCandidateKeys(run)
X40b | fixed | 02-domain-model-part6 INV-77 | localDate 写者补 rollLocalDateTx 及其两个调用点
X51b | fixed | 02-domain-model-part5 INV-34（核对，无改动） | 码名已与 12 §12.14 一致（model 包）
X56b | fixed | 02-domain-model-part4（核对，无改动） | 字段表已写明 v1 没有 preferredDate
X60a | fixed | 02-domain-model-part4 §2.8、part7 Q1 | isExecutable 口径说明改为"已统一、不含审批集合"，Q1 关闭
X63a | fixed | 02-domain-model-part5 INV-15（核对，无改动） | 已是 invite.seat_taken（model 包）
X84a | fixed | 02-domain-model-part5 INV-17 / part6 INV-44（核对，无改动） | 已是 auth.user_not_provisioned / not_member / role_forbidden
X86c | fixed | 02-domain-model-part6 INV-63 | seed 口径改为缺省开 run、stopBeforeRole 停 setup
X87d | fixed | 02-domain-model-part6 INV-52 | 补跨房间规则（只复制未交付行、已交付键 item.duplicate）
X92 | partially | 02-domain-model-part5 页首 | 不删"简述"列（检索需要），改为声明其非规范、谓词以 00-invariants 为准，并修正本轮发现的漂移行（INV-09 / 52 / 63 / 70 / 73 / 77 / M1）；整表重排为三列未做
X03-02 | fixed | 02-domain-model-part6 INV-73 | 补 pass_to_next 迁移
X91d | fixed | 02-domain-model-part6 INV-M1、part7 Q4 | INV-M1 标为已并入 00-invariants，Q4 关闭
X03-03 | fixed | 03-schema-part7 humanRequests | requestEffectV 加 pass_to_next { toRole } 分支（含出现条件注释）
X08b | fixed | 03-schema-part9 §3.11、part12 Q13 / §3.21 D14 | restrictedRef 八表与 canon D14 一致，Q13 关闭
X10b | fixed | 03-schema-part2 §3.3.2 第 5 / 6 条、part12 Q11 / §3.21 D18 | privacy.redact 改述为 canon D18 已列的唯一例外；"删除只有三个入口"笔误改为两个
X12c | fixed | 03-schema-part12 Q2 / Q5 | INV-67 与 cause 名已改，事件别名残留已回改，两条关闭
X16d | fixed | 03-schema-part12 Q14 | 引用改为 16 TC-EXE-11（本阶段新增）
X24 | fixed | 03-schema-part5 turns.waitingReason | 联合类型加 run_cap
X32 | fixed | 03-schema-part9（constraints_changed 行）、03-schema-part2 §3.3.2 | 写明 constraints_changed 的 actor 恒为 system、变更角色只经 restrictedRef；RoomCtx = MutationCtx & { tx: RoomTx } 写成类型
X38 | fixed | 03-schema-part5 | 同 X24（protocol 侧同一请求）
X40c | fixed | 03-schema-part10 §3.13.2 rooms 行、part12 §3.21 D22 | localDate 写者补 rollLocalDateTx 及调用点
X62 | fixed | 03-schema-part9 constraints_changed 行 | 补"provider 对任何 cause 只见 Constraints changed，目录事实经 catalog_item_* 事件渲染"
X63b | fixed | 03-schema-part10 addMember、part3 invites（核对，无改动） | 已是 invite.seat_taken 与 invites.insertLink（model 包）
X67 | fixed | 03-schema-part5 | 同 X24（privacy 侧同一请求）
X68a | fixed | 03-schema-part9 disclosure_changed / human_request_closed 行 | 受众外查看者并入同提交的 Constraints changed，provider actor 标签为空
X69a | fixed | 03-schema-part4 sharedFacts | appendSharedFact 违例日志改为 publicOpsLog('shared_fact.audience_violation')
X77a | fixed | 03-schema-part9 approval_recorded、part7 approvals 披露类 | reasonKey 只在受众为 room 时进 payload；buyers 键经 restrictedRef；披露类改按 humanReasonKeys[].audience
X87e | fixed | 03-schema-part10 appendCatalogRow | 守卫补"后续房间重用已交付键 → item.duplicate"；§3.7 复制过滤已在（model 包）
X93a | fixed | 03-schema-part8（核对，无改动） | canon §1.6 现已登记 tasks.markDone，"已补录"说法属实
X11b | fixed | 03-schema-part12 §3.21 D10 | 剔除集合补"choose_candidate 复核失败"，删去"canon 尚未补注"
X35e | fixed | 04-state-machines-part3 U1 | 快照剔除改为 excludedCandidateKeys(run)
X42b | fixed | 04-state-machines-part3 §4.3.5 | 巡检已是每 5 分钟（state 包）；opsLog 码 invariant.run_cv_drift → constraints_drift；beginAttemptTx 写全 { origin, delayMs, actorUserId, why }
X44b | fixed | 04-state-machines-part2 §4.3.3、part3 §4.3.5 / U1、part5 SM-19 与唤醒表 | run_cap 判定只留在 10 B6a：startRunTx 不再自算桶，首回合由 beginAttemptTx 延迟登记 beginFnId，巡检只兜底（与 10 / 12 / canon D12 ⑥ 一致）
X79a | fixed | 04-state-machines-part3 U1 | createTurnTx 加场景版本前置：scenarioOf(room) 不可解析 → 不建回合、needs_input + agent_failed(end_run)，引 08 §8.5.4 与 15 §15.5.1
X07a | fixed | 04-state-machines-part5 §4.15（核对，无改动） | Q1 / Q3 / Q4 / Q5 / Q6 已标"已裁决 / 已关闭"（state 包）
X03-04 | fixed | 04-state-machines-part2 R21、part4 效果表 / §4.8.3、part5 SM-31（核对，无改动） | pass_to_next 自环与效果行已由 state 包写入
X03-05 | fixed | 05-protocol-part5 §5.11.1 / §5.11.2 / §5.11.4、part7 §5.20 | requestEffectV 加 pass_to_next；infeasible 选项按位置附 pass_to_next；§5.11.4 加效果行；clarify 选项补 toRoles 与 end_run；D15 对照改为十种 effect
X04a | fixed | 05-protocol-part4 S0 | startRunInternal → openIfReady / react() → startRunTx
X05 | fixed | 05-protocol-part5 §5.11.4 | choose_candidate 复核失败改为本请求 superseded(closedReason: regenerated，照记 answerOptionKey)
X52 | fixed | 05-protocol-part5 §5.11.2、06-rules-engine-part7 §11.2 | 二选一取 05：当前仍通过且未被拒的提案排第一，其余 rankForOwner；剔除"已阻断 ∪ 被拒 ∪ 复核失败"，刻意不用完整 excludedCandidateKeys（已提出未被拒的候选仍可供人选）；06 同步
X11c | fixed | 05-protocol-part7 开放问题 5 / 6 / 7、§5.20 D10 / D27、part6 §5.15.1 末段 | canon 已改写 D10 / D15 keep_as_is / D27，三条开放问题关闭，对照表不再标偏离
X03-06 | fixed | 06-rules-engine-part7 §11.1 / §11.2 / §11.3 / §11.4、part9 T06-U32/33/39 / D15 行 | Effect 加 pass_to_next；infeasible 请求按位置追加（run.passedToNext 去重）；§11.3 说明它不是 relaxation、不读视图；§11.4 加回答校验行；新增 T06-U39 位置非干扰用例
X18 | fixed | 06-rules-engine.md R-D11（核对，无改动） | 已是 'A'..'E'（rules 包 extra-01），14 §11 亦无 opt_N
X33a | fixed | 06-rules-engine-part8 §12.1 末 | 登记 registry 的 scenarioOf(room) / latestScenarioVersion(key)，引擎与插件不 import 注册表
X52b | fixed | 06-rules-engine-part7 §11.1 / §11.2、part9 T06-U40 | buildHumanRequests 输入加 chooseExcludedKeys / currentCandidateKey；rounds_exhausted 的 choose_candidate 按 05 口径（当前提案优先、剔除已阻断 ∪ 被拒 ∪ 复核失败）
X63c | fixed | 06-rules-engine-part3（核对，无改动） | invite.expired / invite.email_mismatch 只出现在"不设"注释里，数组已与 12 §12.4 一致
X70 | fixed | 06 §9.2 / 14 S7（核对，无改动） | previewChange 已无 feasibility 枚举（rules 包 privacy-03）；06 T06-P4 的 feasibility 指 enumerateCandidates 的模式，不是预览
X84b | fixed | 06-rules-engine-part3（核对，无改动） | API_ERROR_CODES 恰为 12 §12.4 的 13 个码；approval.not_executable 参数 reasonCodes；retryAfterMs / currentConstraintsVersion / minAllowedCapCents 已在 PARAM_AUDIENCE
X87f | fixed | 06-rules-engine-part3 item.duplicate 行 | 产生者补"后续房间重新上架已交付键"
X89a | fixed | 06-rules-engine-part9 T06-S4 | 断言 checks[].text 只消费 PARAM_AUDIENCE 已声明且已裁剪的参数
CN002-2/3 | fixed | 06-rules-engine-part7 §11.2、00-invariants-part6 INV-74 | escalate(infeasible) 开 infeasible 请求（不是 agent_escalated）；customer agent_escalated 提供 keep_as_is（= 下一轮），与 canon D15 / 05 一致
X03-07 | fixed | 07-permissions-privacy-part6 §7.12.2 humanRequests.answer 行 | 注明 pass_to_next 只按收件人位置提供、不读私密值、不构成预言机、不 bump
X07b | fixed | 07-permissions-privacy-part9 §7.24 第 8–13 条 | 开放问题 9（INV-18 / CE-029）及 8 / 10 / 12 / 13 关闭，11 改述为 canon D18 现文
X08c | fixed | 07-permissions-privacy-part7 §7.17（核对，无改动） | restrictedRef 已按 03 八表书写
X10c | fixed | 07-permissions-privacy-part9 §7.24 第 11 条 | "canon D18 已加豁免"现已属实（核对者同步 canon D18），措辞改为指向 canon 现文与 ADR-X04
X47 | fixed | 07-permissions-privacy-part7 §7.14.3 | 写明组装顺序：净化 → encodeBlock → 加不经编码的字面量外层标签（source="provider.catalog_titles"）
X69b | fixed | 07-permissions-privacy-part8 E1 代码块 | OpsCode → OpsLogCode；PublicOpsCode 示例改为 15 §15.6.2 闭集成员
X81 | fixed | 07-permissions-privacy-part9 §7.21 R-9 | 登记 08 O15：不带理由的 finance 拒绝泄露 buyers 键这 1 bit，默认接受，并写出不接受时的改法
X88a | fixed | 07-permissions-privacy-part9 §7.21 R-10 | 对 12 Q18 作处置：登记为残余推断（只暴露回合角色与顺序），写明不接受时改为合并买方阶段的连带改动
X89b | fixed | 07-permissions-privacy-part6 §7.11 | version.stale_source 参数改为 itemKeys（room），与 06 PARAM_AUDIENCE 一致；表格排版断裂已由 privacy 包修复（核对）
X93b | fixed | 07-permissions-privacy-part9 §7.24 第 11 条 | 同 X10c
X21 | fixed | 08-approval-execution-part11 §8.14 O11 | ①② 改为"已统一为 12 §12.4 的码"，删去 auth.forbidden / auth.not_found 的过时描述
X49 | fixed | 08（核对，无改动） | scope_mismatch 已全部改为 14 的 scope_insufficient（approval 包 names-26）
X69c | fixed | 08-approval-execution.md A4、part5 S11、part6 §8.6.6 / X14、part7 K31 | 公开路径日志改为 publicOpsLog（approval.not_executable / view.vacant_slot / approval.self_conflict / invariant.open_request_at_execution）
X87g | fixed | 08-approval-execution-part2 A9 | "天然杜绝"改为引用 startFollowUp 的复制过滤与 item.duplicate
X93c | fixed | 08-approval-execution-part6（核对，无改动） | "canon §1.6 已补录 tasks.markDone"现已属实
X35f | fixed | 08-approval-execution-part5 §8.5.4 第 2 步、part11 D10 行 | "已阻断集合"改为 excludedCandidateKeys(run)
X33b | fixed | 08-approval-execution-part5 S5 | getScenario(key).version 比较改为 scenarioOf(room) 可解析
X75b | fixed | 08-approval-execution-part11 D04 行 | "canon 待补"改为 canon D04 现文已列两项豁免
X07c | fixed | 09-constraint-changes-part5 §9.14（核对，无改动） | Q1 / Q2 / Q3 / Q5 / Q6 已标已裁决 / 已关闭（state 包）
X41 | fixed | 09-constraint-changes-part3 §9.6.7 | "本回合被 G3 判 stale"改为"D06 同事务 supersede 本 run、本 attempt 被 G1 判 stale"，并写明 negotiating 期间推进 localDate 通常不 bump
X53 | fixed | 09-constraint-changes.md §9.1.1、09-part2 §9.4、04-state-machines-part2 §4.3.3 | 删除第二份 hardProjection 实现，改为引用 06 §5.3 唯一实现；loadRuleInput 的引用 06 §6.2 → 06 §5.1
X54b | fixed | 09-constraint-changes-part3 §9.6.3 | 标题守卫补"NFKC 后含定界词 → disclosure.blocked{field:title}"两码划分，④ 补后续房间已交付键 item.duplicate
X03-09 | fixed | 09-constraint-changes.md M17（核对，无改动） | humanRequests.answer 行已列 pass_to_next
X54c | fixed | 03-schema.md §3.2 值规则表 | 目录标题补"NFKC 后含定界词 → disclosure.blocked{field:title}"一行，格式失败码写明 field
X55a | fixed | 03-schema.md §3.2（核对）、12-api-part3 §12.12 ⑥ | 任务模板标题上限统一为 80（03 TEXT_LIMITS 与 14 §5 已是 80，12 由 120 改为 80）
X04b | fixed | 10-agent-runtime-part2 §10.4.1 步骤 1、10-agent-runtime.md RT1、part4 §10.12.3 / §10.13 | startRunInternal 全部改为 startRunTx；步骤 1 改为 openIfReady → bump(room_opened) → react() → startRunTx(room_opened)
X19 | fixed | 10-agent-runtime.md / part2 / part5 / part7（核对，无改动） | rawOutputs 已是 ≤ 64 KiB、保留期 dev 30 / prod 7；B4 / B5 已写失败码记 runs.lastFailure（turn 无 failureCode）；§10.16.3 指标已按 waitingReason 计数（protocol 包）
X24b | fixed | 10-agent-runtime.md §10.3 turns 行 | waitingReason 列表写入 run_cap 并注明 03 已登记
X25 | fixed | 10-agent-runtime-part3 §10.9 | 删去与 04 分叉的第二份 reconcile 代码，改为引用 04 §4.3.5（只读 decideReconcile、确定要写才开 RoomTx、内联复用调用方 tx、react 带 runCause）的分支表；删去"04 现写 15 分钟"的过时括注
X90 | fixed | 10-agent-runtime-part5（核对，无改动） | 指标行已是 opsLog('spend_deferred') 计数与按 waitingReason 统计
X95 | fixed | 10-agent-runtime-part7 开放问题 5（核对，无改动） | 已是 dev 30 / prod 7
N-beginAttemptTx | fixed | 10-agent-runtime-part2 §10.5.1、12-api-part6 §12.18 | 事务 helper 统一名 beginAttemptTx（04 / 08 已用，canon §1.6 已登记），BeginOpts 加 why?；B6a 说明改为与 04 / 12 / canon 一致
X79b | fixed | 10-agent-runtime-part6 F33 | 失败表补"场景版本不可解析时 reject 后建回合 → agent_failed(end_run)"
X44c | fixed | 10-agent-runtime-part2 B6a | 删去"12 B7 写的由巡检恢复"的对立表述，改为 04 / 12 / canon 同口径
X07d | fixed | 11-architecture-part4 §11.15 Q6 / Q7 | canon D20 / D21 已写入，Q6 标已裁决（安装当天仅确认冷却期）、Q7 关闭
X33c | fixed | 11-architecture.md §11.3 目录树 | registry.ts 登记 scenarioOf(room) 与 latestScenarioVersion(key)
X46 | fixed | 11-architecture.md §11.3 | core/engine/projection/ 增列 encodeBlock.ts 与组装顺序
X64a | fixed | 11-architecture-part3 §11.10 | 补"唯一 Route Handler 是无业务数据的 /api/health，自行 auth() 返回 401"
X69d | fixed | 11-architecture.md §11.3、11-architecture-part2 §11.5 L11 / §11.6 | 构造器只在 internal / action 上注入 InternalCtx 品牌；withSanitizedErrors 改用 publicOpsLog；新增 lint L11 禁止公开模块 import opsLog
N-beginAttemptTx-11 | fixed | 11-architecture.md §11.3 | model/turns.ts 的 helper 名改为 beginAttemptTx
X03-12 | fixed | 12-api-part4 §12.14 | effect 列表与效果表加 pass_to_next 行（校验位置与去重、不 bump、留在 needs_input）
X05b | fixed | 12-api-part4 §12.14 choose_candidate 行 | 复核失败改为本请求 superseded(regenerated)，照记 answerOptionKey
X07e | fixed | 12-api-part8 §12.25 Q3 / Q5 / Q14（及 Q6 / Q17 / Q18 / Q19 / Q20 / Q21） | canon 已写入的条目与本阶段已同步的条目全部标为已关闭
X13 | fixed | 12-api-part4 §12.14、12-api-part8 Q6 | disclose 改为 { field, toRoles }，受众 = 最新行受众 ∪ toRoles，run 去向按 kind（clarify / infeasible 回退）
X14 | fixed | 12-api-part3 §12.9 | briefs.confirm 的 customer 软字段删去 preferredDate
X15 | fixed | 12-api-part3 §12.11 守卫 ⑥ 与失败码、12-api.md §12.4 | itemKeys 闸门改为 confirmed ∪ retired（与 briefs.confirm 同一集合），§12.4 登记 item.unconfirmed
X23c | fixed | 12-api.md B11 | "rooms.close 是唯一清理"限定为 setup / open 房间，executed 只读，privacy.redact 只覆写
X26 | fixed | 12-api-part3 §12.8 第 4 步 | 沿用同一 proposalId 补前提"被取代 run 处于 pending_approval"与同事务 stale → active（canon D06 / C47）
X27 | fixed | 12-api-part4 §12.14 | 约束效果未改变投影时改为"不 bump、按 R20 重跑预检"，日志改 publicOpsLog('request.effect_noop')
X33d | fixed | 12-api-part6 §12.19 | helper 表登记 scenarioOf / latestScenarioVersion 与 rollLocalDateTx
X43 | fixed | 12-api-part6 §12.18 | beginAttempt args 加 retryNote；BeginResult 加 deferred.reason 与 limit.cause turn_attempts；检查范围改为 B1–B7 + B4a / B6a；modelResponseV 的 stopDetailsCategory → stopCategory；helper 名 beginAttemptTx
X44d | fixed | 12-api.md §12.2 第 7 条 | run_starts 恢复改为 B6a 的 beginFnId 延迟调度、巡检只兜底
X55b | fixed | 12-api-part3 §12.12 ⑥ | 任务模板标题上限 120 → 80
X68b | fixed | 12-api-part5 timeline.page | 视图模型补 disclosure_changed / human_request_closed 并入规则、他人约束变更提交对 provider actor 置 system、buyers 受众 reasonKey 只对买方连接
X69e | fixed | 12-api.md §12.4、12-api-part4 §12.14 / §12.15 ⑨ | 公开路径日志改为 publicOpsLog
X76 | fixed | 12-api-part4 §12.15 ⑧ | 按 08 S9 改为三种读法：reject 只读本人最新一行；withdraw 读本人区间（≤ 71 行）计数；approve 人均上限 60 只在需写新行时生效，unchanged 收敛不受挡
X77b | fixed | 12-api-part4 §12.15 ⑩ | approval_recorded 的 reasonKey 只在受众为 room 时进 payload，buyers 键经 restrictedRef
X82 | fixed | 12-api-part5 §12.17 recordsPreview | 口径统一到 08：commitCents = terms.amountCents（本次增减），三方可见；已承诺额 / cap / headroom 不在此 DTO
X35g | fixed | 12-api-part4 §12.15 ⑪ | "候选进入本 run 已阻断集合"改为 excludedCandidateKeys(run)；补 reject 后场景版本不可解析的兜底
X79c | fixed | 12-api-part4 §12.15 ⑪ | reject → createTurnTx 版本不符 → needs_input + agent_failed(end_run)
X53b-12 | fixed | 12-api-part7 §12.20 注 | ops.setDraining 全部层级已是 canon 现文，删去"已列 canon_objections"
X03-13 | fixed | 13-frontend-part2 §13.6 第 3 条、part6 开放问题 1 / D15 行 | 取舍卡渲染服务端提供的 pass_to_next（"Pass to {Role}"），开放问题 1 关闭
X07f | fixed | 13-frontend-part6 开放问题 1 | 同上
X31 | fixed | 05 / 06 / 12 / 13 / 18（见各章条目） | state 侧 pass_to_next 落章请求与 canon 侧 X03 合并处理
X60b | fixed | 13-frontend.md FE-D12、13-frontend-part6 D19 / D02 行 | 删去"isExecutable 在 08 含审批已齐"与"定义待 canon"，改引 canon §1.3（C44）
X64b | fixed | 13-frontend.md §13.1（核对，无改动） | 已写"唯一的 Next Route Handler 是 /api/health"，与 FE-D14 一致（product 包）
X87h | fixed | 13-frontend-part5 §13.10 C | 后续房间只读显示 followUpOf.deliveredItems（"Delivered in CO-n"），RequiredItemsPicker 不列已交付键
X03-14 | fixed | 14-scenario-scope-change-part3 §8 模板表、part6 §11 D2 / E3、part7 §16 D15 行 | 新增 request.pass_to_next 模板；变体 D / E 的 customer 请求按位置附 pass_to_next，A 的 finance（末位）不附
X17 | fixed | 14-scenario-scope-change-part6 §11（核对，无改动） | A1 已是 run_ended(superseded)、A3 已是 room_executed、选项键已是 'A'..'E'（rules 包）
X48 | fixed | 14-scenario-scope-change-part4 §9.4 B、part6 §11 G2 | source="provider.catalogTitle" → "provider.catalog_titles"；§11 F 的 opt_N 已无（核对）
X80 | fixed | 14-scenario-scope-change-part5 S10（核对，无改动） | 已改为 approval.not_current（当前性守卫先于 stale 检查，rules 包）
X81b | fixed | 07-permissions-privacy-part9 R-9 | 08 O15 的 1 bit 由 07 登记接受；14 §3 无需改动（不接受时的改法已写在 R-9）
X36b | fixed | 14-scenario-scope-change-part7 §16 末段 | D27 两处差异改述为"canon 已改写（C57）"
X20 | fixed | 15-operations-part3 §15.7（核对，无改动） | 全局日美元行已改为不写事件、只记 waitingReason（arch 包）
X23d | fixed | 15-operations.md O7、15-operations-part4 §15.9 | "rooms.close 是生产唯一清理"限定为 setup / open 房间，executed 只读，PII 只经 privacy.redact 覆写
X28 | fixed | 15-operations-part2 §15.5 第 2 步 | WATCHDOG_DELAY_MS → ACTION_WALL_MAX_MS（10 §10.11）+ 60 秒
X29 | fixed | 15-operations.md O10、15-operations-part4 §15.8 clock 行 | 采用本地午夜 runAt 精确推进 + 小时 cron 兜底，否决列改为"只靠每小时 cron"
X69f | fixed | 15-operations-part3 §15.6.2 / §15.6.4、15-operations.md O4、part5 D16 行 | §15.6.2 改为两个 logger 的唯一定义（InternalCtx 品牌、OpsLogCode、PublicOpsCode 闭集、合并后的 SafeFieldName 白名单），告警同时匹配两种行
X79d | fixed | 15-operations-part2 §15.5.1（新增）、part3 §15.6.6 | 场景版本迁移纪律：注册表只增不删、删除前检查 liveRoomsByScenarioVersion、必要时 bump(scenario_migrated)；兜底引 08 S5 / 04 U1 / 10 F33
X86d | fixed | 15-operations-part5 Q11 | seed 终止状态关闭（canon D18 现文一致）
X02 | fixed | 16-testing-part8 §16.11.2 / §16.11.3、part9 开放问题 8、part4 TC-RUN-14 / TC-RUN-21、part5 TC-PRIV-23 | §16.11.2 删为指针；开放问题 8 关闭；TC-RUN-14 按 CE-146 改写（公开 runs.start 拒绝、系统路径建 run 首回合停泊、解除后自动恢复）；新增 provider 请求体无 reasonKey 断言（TC-PRIV-23）与 pass_to_next 用例（TC-RUN-21，映射 CE-087(b) / 138）；§16.11.3 写明此后从 CE-176 起
X16 | fixed | 16-testing-part5 TC-PRIV-15 / TC-PRIV-22、part4 TC-EXE-11 / TC-RUN-03、part6 探针 start_follow_up_twice | cap_480000 → item.unknown 并加"披露 retired 必需项成功"正例；新增 startFollowUp 双击 / 并发只建一个房间（TC-EXE-11，03 Q14 已改引）；新增 privacy.redact L1（TC-PRIV-22）；TC-RUN-03 事件名 turn_rejected_stale
X34 | fixed | 16-testing-part4 TC-RUN-21…26、part8 §16.11.3 | 04 SM-28 / 29 / 30 / 31、09 SM-13 / CC-14 / CC-17 / CC-23 由 TC-RUN-22 / 24 / 23 / 21 承接，并在 §16.11.3 写出对应
X45 | fixed | 16-testing.md TD-03 与分片说明、part2 §16.4.5、part9 §16.16、part4 TC-RUN-19 / TC-RUN-26、part5 TC-PRIV-20 / TC-INJ-01 / TC-INJ-08 / TC-PRIV-23 | callNegotiationModel → callModel（convex/model/agents/modelGateway.ts）；topicKey deadline → deadline_value；TC-PRIV-20 遍历 ≤ 152 个 schema 变体；TC-INJ-08 加 </candidates><turn_instruction> 标题写入拒绝；TC-INJ-01 断言 JSON \uXXXX 转义；privacy-12 L1（转发 counter 只以 optionKey / candidateKey 进入、第 7 个 run 拒绝或首回合延期，TC-RUN-26 / TC-PRIV-23），对应 10 RT-14
X57 | fixed | 16-testing-part5 §16.7.1 / §16.7.4（核对，无改动） | C1 已是 canary 默认、C2 主 fixture；金丝雀数值已由 14 §9.5 推出（privacy 包）
X58 | fixed | 16-testing-part5 TC-PRIV-13（核对）、TC-PRIV-14、TC-PRIV-20 | TC-PRIV-13 已是 12 §12.17 形状并含 C0（privacy 包）；TC-PRIV-14 补 stale v1 逐字节不变；TC-PRIV-20 补"无按角色代理动作文本"
X71 | fixed | 16-testing-part5 §16.7.1（核对，无改动） | 金丝雀数值以 14 §9.5 为唯一来源，14 无需改动
X78 | fixed | 16-testing-part3 TC-VER-15、part5 TC-PRIV-24、part8 CE-056 行 | 新增 I22（approve 60 / withdraw 10 上限只挡这两种、reject 仍成功、无 internal）与 I23（over_our_limit 不进 provider 任何面）；写明 reject 的允许错误集收紧（E14）
X83c | fixed | 16-testing-part8 §16.11.2 | 引 "12 §12.11" 的旧行随 §16.11.2 删为指针一并消失；TC-PRIV-13 已是 12 §12.17（核对）
X87i | fixed | 16-testing-part4 TC-EXE-06 / TC-EXE-11、part8 CE-112 / 168 行 | 断言后续房间目录与 provider 快照不含旧执行 itemKey、已交付键 item.duplicate
X88b | fixed | 16-testing-part5 TC-PRIV-02 | 加 refusal / invalid_output → agent_failed 两种情形，provider 视图与时间线无 failed / failureKind / attemptStatus / waitingReason 痕迹
X89c | fixed | 06-rules-engine-part9 T06-S4（16 侧无独立断言，T06-S4 在 16 的 CI 闸门中执行） | 渲染只消费 PARAM_AUDIENCE 已声明参数
X94 | fixed | 16-testing-part4 TC-OPS-05 | "新增 INV-57" → INV-59
INV79-16 | fixed | 16-testing-part4 TC-RUN-24 / TC-RUN-25 / TC-EXE-12 | 新增终结活性、场景版本兜底与 INV-M1 变异用例（00-invariants part11 §3.1 已引用）
X30 | fixed | 17-roadmap.md E10 表行与 §17 E9 / E10 / E11 段 | 写明触发条件（换人 / 多审批人、forceClose 每月 ≥ 1 次、审批挂起 > 14 天）与席位转移做法，并引用 v1 兜底 rooms.forceClose（04 §4.11、INV-79）
X96b | fixed | 17-roadmap.md E10 | 同 X30（product 侧同一请求）
X03-18 | fixed | 18-decisions-open-questions-part4 ADR-D15、part7 N-01 | ADR-D15 决定写入 pass_to_next 与 keep_as_is 按 kind，被否决加 C54，后果删去"转交不在 effect 集合"；N-01 已解决
X06 | fixed | 18-decisions-open-questions.md §18.2（新增 C43–C60 索引表）、part2–part6 ADR-D02/D04/D05/D06/D09/D12/D13/D14/D15/D16/D17/D27 的"被否决"、part7 N-08、part8 本章不变量 2 与对照表 | C44–C60 逐条进入对应 ADR 的被否决（C43 为文档纪律不进 ADR）；N-08 标已解决（cause scenario_migrated + 15 §15.5.1）；pass_to_next、keep_as_is 按 kind、D06 收窄、D04 两项豁免写入 ADR-D15 / D06 / D04 的决定
X07g | fixed | 18（N 表） | 与 X07 各章条目对应的 N-05 / N-22 / N-26 / N-27 / N-28 / N-30 标已解决
X23e | fixed | 18-decisions-open-questions-part5 ADR-D18 | "rooms.close 是唯一清理"限定为 setup / open 房间，并注明 privacy.redact 例外；决定改为 canon D18 现文（internal mutation、缺省开 run、stopBeforeRole）
X35h | fixed | 18-decisions-open-questions-part3 ADR-D10 | "剔除已被阻断"改为 excludedCandidateKeys(run)
X64c | fixed | 18-decisions-open-questions-part5 ADR-D19 | 补 proxy / 布局兜底与"唯一 Route Handler /api/health"的口径
X85 | fixed | 18-decisions-open-questions-part7 N-24、part9 09·Q9（核对，无改动） | 已标"已解决：以 12 §12.12 批量签名为准"（product 包）
X91e | fixed | 18-decisions-open-questions-part10 ADR-X01…X04、part7 N-09 / N-31 / N-32 / N-33、§18.0 | ADR-X 标题改为"细化 canon …"，与 canon 关系改为已吸收；四个 N 标已解决
X86e | fixed | 18-decisions-open-questions-part5 ADR-D18 | seed 决定改为缺省开首个 run、stopBeforeRole 停 setup
X36c | fixed | 18-decisions-open-questions-part6 ADR-D27、part7 N-04 | 残余改为"canon D27 已改写（C57）"
N-18-18 | fixed | 18-decisions-open-questions-part7 N-18 | rawOutputs 保留期由"默认 30 天"改为 dev 30 / prod 7
X73b | fixed | 08-approval-execution-part3 §8.3.1 | "canon D25 缺 kind、canon 待补"改为与 canon 现文一致
X08d | fixed | 02-domain-model-part7 D14 / D15 行 | restrictedRef 八表、disclose.toRoles 改为与 canon 现文一致，补 pass_to_next
X36d | fixed | 01-product-part4 开放问题 4 | D27 差异改为已关闭（C57）
N-names-01 | fixed | 01-product-part3（task_done → task_completed）、10-agent-runtime-part7（r13 startRunInternal → startRunTx）、08-approval-execution-part2 A10（getScenario → scenarioOf）、00-invariants-part9 CE-073（budget.fits 不是码） | 第 2 步 grep 发现的残留别名
N-names-02 | fixed | 12-api-part4 §12.13、02-domain-model-part3、08-approval-execution-part10、18-decisions-open-questions-part3 | "买方视图可行集"（误导为 customer 视图）改为"全量约束下的可行集（buyerFeasible，04 §4.3.3）"；runs.start 的 beginAttempt(origin: 首个) → beginAttemptTx(origin: "turn_start")
N-names-03 | fixed | 12-api-part7 rooms.forceClose、15-operations-part3 OpsLogCode、04-state-machines-part4 §4.8.2 | opsLog 带自由文本 reason 改为只记 roomId，room_force_closed 入 OpsLogCode；04 的 request.effect_noop 改 publicOpsLog
N-matrix-07 | fixed | 07-permissions-privacy-part6 §7.12.1 / §7.12.2 | 第 2 步对账：07 动作矩阵缺 12 的公开函数 catalog.list / proposals.get / executions.forRoom / users.viewer / users.ensureViewer / health.ping，已补行（受众与 12、08 一致）
N-beginAttemptTx-2 | fixed | 10-agent-runtime-part2 / part3、12-api-part4 / part6 | 叙述中的 helper 调用 beginAttempt(…) 统一为 beginAttemptTx(…)
N-excl-03 | fixed | 03-schema-part2 §3.4、03-schema-part5 §3.8 | excludedCandidateKeys 定义补齐第三部分（choose_candidate 复核失败，由 regenerated 请求的 answerOptionKey 派生）
N-excl-07-05 | fixed | 07-permissions-privacy-part7 §7.14.2、05-protocol-part4 §5.8.5 | 剔除集合措辞补齐复核失败；rounds_exhausted 的 choose_candidate 口径对齐 §5.11.2
N-table-01 | fixed | 00-canon-part4 D25、06-rules-engine-part2 §4 目录标题行 | 表格单元内未转义的 `|` 破坏列数（前者是本阶段补 kind 时引入，后者原有），改为 \|
N-names-04 | fixed | 06-rules-engine-part7 §11.1 | Effect 判别字段 kind → type（与 03 §3.9 requestEffectV、05、12 的线格式一致），补不可回答的 blocked 分支
N-names-05 | fixed | 05-protocol.md P12 / part5 §5.9.1、06-rules-engine-part8 §12.2 第 5 条、07-permissions-privacy-part7 LP-5 / part8 T-31 / part9 §7.25、18-decisions-open-questions-part4 ADR-D12、00-invariants-part7 CE-010 | option_fits_constraints 仍按"只限 provider / seller"书写的残留，改为 canon D12 ③ 修订后的"任何角色都没有"；ADR-D12 的 previewChange 分支同步；07 §7.25 的"第三份确认自动 runs.start"改为 openIfReady
N-names-06 | fixed | 06-rules-engine.md R-D12 与分片说明、06-rules-engine-part2 §3、part8 标题、part9 D21 行、17-roadmap-part2 R6 | ScenarioPlugin 成员数"15"改为 06 §12.1 的 16 个必需 + 2 个可选
N-brief-12 | fixed | 12-api-part5 §12.17 rooms.view.members | briefVersion 的置空范围对齐 07 DX-7（只对 provider 置 null；买方互见），原 12 写'对非本人一律 null'与 07 矛盾

## 跨章备注索引（Xnn → 来源包 · 内容 · 最终处置）

X01 | canon | 00-overview：§0.3 测试编号、§0.9 第 3 条、§0.6 术语同步、§0.10 补 C43–C60 | fixed
X02 | canon | 16：§16.11.2 删为指针、part9 开放问题 8、TC-RUN-14 按 CE-146、请求体无 reasonKey、pass_to_next 用例、CE-176 起编号 | fixed
X03 | canon | pass_to_next 落到 04 / 05 / 06 / 03 / 12 / 13 / 07 / 01 / 14 / 18 | fixed
X04 | canon | startRunInternal → startRunTx（10 / 05），10 part2 步骤 1 改为 openIfReady → react → startRunTx | fixed
X05 | canon | 05 §5.11.4 choose_candidate 复核失败 → superseded(regenerated) | fixed
X06 | canon | 18：C43–C60 进被否决、N-08、pass_to_next / keep_as_is 按 kind / D06 收窄 / D04 豁免的 ADR | fixed
X07 | canon | 关闭 04 Q1/3/4/5/6、09 Q1/2/3/5/6、12 Q3/5/14、11 Q6/7、13 问题 1、07 问题 9、08 O11 | fixed
X08 | model | canon D14 restrictedRef 八表 | fixed
X09 | model | canon D15 disclose { field, toRoles } | fixed
X10 | model | canon D18 privacy.redact 豁免；07 §7.24 第 11 条 | fixed
X11 | model | canon D10 剔除集合 | fixed
X12 | model | 00-invariants INV-67 / cause 名；03 §3.20 Q2/Q5、02 §2.14 Q2/Q5 | fixed
X13 | model | 12 §12.14 / Q6 disclose toRoles | fixed
X14 | model | 12 §12.9 删 preferredDate | fixed
X15 | model | 12 §12.11 守卫 ⑥ confirmed ∪ retired；§12.4 登记 item.unconfirmed | fixed
X16 | model | 16：TC-PRIV-15 cap_480000、startFollowUp 双击、privacy.redact L1、TC-RUN-03 事件名 | fixed
X17 | model | 14 §11 A1 / A3 事件名与选项键 | fixed
X18 | model | 06 R-D11 选项键 | fixed
X19 | model | 10：rawOutputs 64 KiB、保留期、B4/B5 措辞、§10.16.3 指标 | fixed
X20 | model | 15 §15.7 全局日美元不写事件 | fixed
X21 | model | 08 §8.11 O11 ①② 旧码 | fixed
X22 | state | 00-invariants INV-72 ② / CE-135、INV-73 补 pass_to_next 与回退 disclose、新增活性 INV | fixed
X23 | state | "rooms.close 是唯一清理"限定为 setup / open（canon D18、15、12 B11、18、INV-54） | fixed
X24 | state | 03 waitingReason 加 run_cap；10 列表同步 | fixed
X25 | state | 10 §10.9 reconcile 与 04 对齐；startRunInternal 别名 | fixed
X26 | state | 12 §12.8 沿用提案的前提 pending_approval | fixed
X27 | state | 12 约束效果未改投影 → R20 重跑预检 | fixed
X28 | state | 15 §15.5 WATCHDOG_DELAY_MS → ACTION_WALL_MAX_MS + 60 s | fixed
X29 | state | 15 O10 本地午夜 runAt | fixed
X30 | state | 17 E10 触发条件与 forceClose 兜底 | fixed
X31 | state | pass_to_next 落章（05 / 06 / 12 / 13 / 18） | fixed
X32 | state | constraints_changed actor = system；RoomCtx 类型 | fixed
X33 | state | 场景注册表取值函数正式名 scenarioOf | fixed
X34 | state | 16 纳入 SM-28…31、SM-13 / CC-23、CC-14 / CC-17 | fixed
X35 | protocol | canon D10 措辞及 04 U1、INV-09、02 INV-09、01 part3、18 D10 | fixed
X36 | protocol | canon D27 v2 $800（canon_objections 第 23 条过时） | fixed
X37 | protocol | canon D22 澄清 | fixed
X38 | protocol | 03 waitingReason run_cap；04 INV-SM-03 | fixed
X39 | protocol | 03 §3.9 disclose toRoles；12 §12.14 同步 | fixed
X40 | protocol | localDate 写者补 rollLocalDateTx（03、00-invariants / 02 INV-77） | fixed
X41 | protocol | 09 §9.6.7 G3 → G1 措辞 | fixed
X42 | protocol | 04 §4.3.5 巡检 5 分钟、opsLog 码、beginAttemptTx 参数；INV-70 | fixed
X43 | protocol | 12 §12.18 beginAttempt 参数 / 返回 / 检查范围、stopCategory | fixed
X44 | protocol | 12 B7 run_starts 恢复由 B6a beginFnId 承担 | fixed
X45 | protocol | 16：callModel、topicKey、≤152 变体、TC-INJ-08 / 01、privacy-12 L1、RT-14/15/16 | fixed
X46 | protocol | 11 §11.3 encodeBlock.ts | fixed
X47 | protocol | 07 §7.14.3 外层标签不经 encodeBlock | fixed
X48 | protocol | 14 §11 G2 source 属性、F 选项键 | fixed
X49 | protocol | 08 scope_mismatch → scope_insufficient | fixed
X50 | protocol | 01 part2 topicKey deadline_value | fixed
X51 | protocol | INV-55 阻断候选；INV-34 / 02 INV-34 错误码 | fixed
X52 | protocol | 05 vs 06 rounds_exhausted 的 choose_candidate 口径二选一 | fixed
X53 | rules | 09 第二份 hardProjection、loadRuleInput 引用 06 §5.1 | fixed
X54 | rules | 09 §9.6.3 / 03 §3.2 标题定界词 → disclosure.blocked | fixed
X55 | rules | 任务模板标题上限 80 / 120 对齐 | fixed
X56 | rules | preferredDate 残留（12、03、02、CE-006 / 045） | fixed
X57 | rules | 16 §16.7.4 C1 与 §16.7.1 金丝雀 | fixed
X58 | rules | 16 TC-PRIV-13 / 14 / 20 | fixed
X59 | rules | 旧事件名（01 part3 / part4、INV-20 / CE-036） | fixed
X60 | rules | isExecutable 过时说明（13 FE-D12、02 §2.8） | fixed
X61 | rules | canon §1.5 补两码 | fixed
X62 | rules | 03 §3.11.1 provider 对 constraints_changed 的渲染说明 | fixed
X63 | privacy | names-17 剩余（03 addMember、02 INV-15、03 storeLink、06 invite.*） | fixed
X64 | privacy | completeness-20 剩余（11 §11.10、13、18 ADR-D19） | fixed
X65 | privacy | completeness-23（00-overview §0.3） | fixed
X66 | privacy | canon D12 / D17 预言机措辞 | fixed
X67 | privacy | run_cap 进 03 / 04 | fixed
X68 | privacy | disclosure_changed / human_request_closed 并入规则（03、12） | fixed
X69 | privacy | 两个 logger（15 唯一定义、11 构造器与 lint、08 / 12 / 03 调用点） | fixed
X70 | privacy | 06 / 14 删除 feasibility 枚举 | fixed
X71 | privacy | 16 金丝雀数值以 14 §9.5 为准（告知） | fixed
X72 | privacy | INV-18 / CE-029 闸门码 | fixed
X73 | approval | canon D25 lines.kind | fixed
X74 | approval | canon 收录 scenario_migrated | fixed
X75 | approval | canon D04 两项豁免 | fixed
X76 | approval | 12 §12.15 ⑧ 读法与人均上限 | fixed
X77 | approval | approval_recorded payload 的 reasonKey 受众（03、12） | fixed
X78 | approval | 16 补 I22 / I23 与 reject 允许错误集 | fixed
X79 | approval | reject 后 createTurnTx 场景版本守卫（04 / 10）与 15 迁移流程 | fixed
X80 | approval | 14 S10 approval.not_current | fixed
X81 | approval | 08 O15 的 1 bit（14 / 07） | fixed
X82 | approval | 12 recordsPreview.commitCents 口径 | fixed
X83 | arch | previewChange 形状残留（01、16、00-invariants、02、canon D12 ②） | fixed
X84 | arch | 06 API_ERROR_CODES / 参数名 / 02 auth 码 | fixed
X85 | arch | 01 P2 批量 rows；18 N-24 / 09·Q9 | fixed
X86 | arch | seed 终止状态（canon D18、INV-63、CE-156、02、01 X8） | fixed
X87 | arch | 后续房间只复制未交付目录（canon D04 及 00-invariants / 02 / 16 / 08 / 01 / 13 / 06 / 03） | fixed
X88 | arch | 16 TC-PRIV-02 refusal 用例；07 处置 12 Q18 | fixed
X89 | arch | 06 T06-S4 断言；07 §7.11 version.stale_source 参数 | fixed
X90 | arch | 10 part5 指标 agents_deferred | fixed
X91 | product | canon 吸收 ADR-X01…X04；18 改称与 N 关闭；00-overview §0.6.2 | fixed
X92 | product | 02 part5 / part6 只留三列 | partially
X93 | product | 07 §7.24 第 11 条与"canon 已补录 tasks.markDone"的说法 | fixed
X94 | product | 16 TC-OPS-05 INV-57 → INV-59 | fixed
X95 | product | 10 part7 rawOutputs 保留期 | fixed
X96 | product | 01 X6 / X7 与 17 E10 的身份消失兜底 | fixed
X97 | product | 00-invariants 回改 8 条期望与补 INV-M1 | fixed
X98 | product | 告知：落在 product 章节的一侧已改完，勿重复 | fixed
