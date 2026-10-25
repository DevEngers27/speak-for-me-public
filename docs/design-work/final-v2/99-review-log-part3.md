# 99 · 修订轮处置总表（part3）：§1 续（3）

> 分片见 `99-review-log.md` 顶部。

| issue id | 包 | 处置 | 位置 | 说明 | 核对阶段 |
| --- | --- | --- | --- | --- | --- |
| names-29 | approval | fixed | 08-approval-execution-part2.md, 08-approval-execution-part11.md | A9 的"creator 的 rooms.startFollowUp"改为旧房间任一成员（与 04/07/12 一致，节流归 room_create 桶）；§8.6.5、V8 早已一致；§8.14 D04 行删去不实的"canon D04 已明文" | — |
| names-30 | protocol | fixed | 10-agent-runtime-part3.md, 10-agent-runtime-part4.md, 10-agent-runtime-part6.md | 注册函数集中在 convex/agents.ts、convex/turns.ts、convex/runs.ts，实现在 convex/model/agents/（§10.6 文件说明、§10.5.1、§10.14.1、§10.18.1）；§10.13 第 3 条按 M-ROOM 经 openRoomTx；testFaultPlan 已由 03 §3.5 登记为非生产可选字段，已核对。 | — |
| names-31 | state | fixed | 09-constraint-changes-part2.md, 09-constraint-changes-part3.md, 09-constraint-changes-part4.md | 第 3 步 appendBriefVersion 改为 insertBriefVersion；§9.4 的 withConstraintChange / bump / react 改用入口持有的 RoomTx（ctx.tx.insert、ctx.tx.patch("rooms",…)、appendEvents(ctx.tx,[{payload,restrictedRef,actor}])），删掉 dispose 之后又自开 openRoomTx 的写法，也去掉了缺表名的 tx.patch；clock.rollLocalDate 改为在幂等检查之后才开 RoomTx；rows、≤ 12、Q9 现稿已改好 | — |
| names-32 | protocol | fixed | 05-protocol-part3.md, 10-agent-runtime-part3.md, 05-protocol-part7.md | §5.7.3 第 2 步 today = room.localDate；本轮把滞后消除改为 turns.complete 在 G1–G3 之前调用 rollLocalDateTx（10 §10.7.2 新增步骤 2b），万一 bump 由 G1（不是 G3）判 stale，第 4 步改述；canon D22 措辞澄清记入跨章（已有 canon_objections 19/43）。 | — |
| names-33 | arch | partially | 12-api.md; 12-api-part8.md; 11-architecture.md; 11-architecture-part4.md | B4 改为写明 ERROR_CODES = REASON_CODES ∪ API_ERROR_CODES 且 API_ERROR_CODES 恰为 §12.4 中非 reasonCode 的 13 个码；§12.4 末尾新增"码集合与参数名的单一来源"（成员清单、折叠进 invite.invalid / unchanged / input.invalid 的码、retryAfterMs 与 reasonCodes 等参数名、T06-S4 断言）；§12.23 API-16、§12.25 Q20、§12.26 §1.5 行；11 §11.3 与 §11.16 同步；06 的 run.rate_limited 已是 retryAfterMs、03 §3.13.1 已无 auth.not_found（核对属实）；剩余 06 API_ERROR_CODES 成员（多 invite.expired/email_mismatch/approval.nothing_to_withdraw/approval.invalid_reason、缺 invite.email_unverified）、06 approval.not_executable 参数名 blocking、02 INV-17/INV-44 旧 auth 码交核对者 | 剩余已补完（X84：06 由 rules、02 由 model 改写，核对确认） |
| names-34 | privacy | fixed | 07-permissions-privacy-part4.md、16-testing-part5.md | 07 §7.8.4 已分"主 fixture / canary 变体"两列并与 14 §9.2 / §9.5 一致；本次把 07 的说明句改为"16 的隐私扫描跑 canary fixture：C1 = canary 列、C2 = 主 fixture 列"，16 §16.7.4 的 C1 改为 canary 默认、新增 C2 = 主 fixture 默认，Ck 个数由 11 改为 9（v1 无 preferredDate） | — |
| names-35 | state | fixed | 04-state-machines-part5.md, 04-state-machines-part2.md | 4.10 现稿已是 7 阶段形状；本次把 stopped.reason 的取值从 no_agreement 改为 ended_no_agreement，与 01 X6、13 §13.9.2 一致；derivePhase 代码、4.10 表和 R17 同步修改，阶段名一致性的声明现在属实 | — |
| names-36 | privacy | fixed | 07-permissions-privacy-part3.md、07-permissions-privacy-part5.md | 逐条核对：users.email / constraintRevisions.version / approvals.decidedAt / run_waiting / catalog_item_confirmed / room_executed → executions / item.required_missing 的 itemKeys+reason / DX-8 endedReason 均已与 03/06/12 一致；本次修正剩余的 §7.6 `rooms.create` 参数 `creatorRole` → `myRole`（并补 `member_joined{role}` 事件与 `room_create` 节流），另修 §7.9.4 表格中未转义的竖线 | — |
| names-37 | model | partially | 03-schema-part3.md、03-schema-part4.md、03-schema-part8.md、03-schema-part9.md、03-schema-part10.md、03-schema-part12.md、02-domain-model-part5.md、02-domain-model-part7.md | 03 §3.21 删去不实的"canon D14 已补列"与"canon D10 已据 05/06 改写"、§3.11 加 restrictedRef 扩展说明与 Q13、§3.20 删去已关闭的 Q1/Q3/Q4/Q7–Q9 并把 Q2/Q5 改成如实未决项、§3.5/§3.7/§3.10 过时注释改为现状（schemaVersion 已是 turnSpecKey，核对），02 INV-04 改 turnSpecKey、INV-01/15/17/29/31/34/44 码名对齐 12 §12.4、Q3 关闭；剩余是 08 O11 的 07 旧码描述（08 包）。 | 剩余已补完（X21：08 O11） |
| names-38 | canon | fixed | 00-canon §1.1/§1.2/§1.5/§1.6、part2 D04、part4 D27 | §1.5 补 approval.not_executable、item.limit_exceeded 与 auth / invite / request / input / internal（date.before_lead_time 原本已在 §1.5，issue 此点不成立）；§1.6 补 previewChange / tasks.markDone / invites.createLink / expireDue / livenessSweep / activeAttemptCount，ops.setDraining 改为全层级；§1.1 补 constraintRevisions、rawOutputs、editNo；§1.2 示例改 audit_log_export+sso_login@rush；D04 写两项豁免；D27 改 2 条 stale_approve + provider 提出 v2 $800 | — |
| OBJ-01 | canon | fixed | 00-canon §1.1 | objection accepted：补 constraintRevisions 实体行与关系 room 1—n constraintRevision | — |
| OBJ-02 | canon | fixed | 00-canon-part2 D04 | objection accepted：D04 改为协商 / 约束 / 成员 / 审批类写入拒绝，tasks.markDone 与 rooms.startFollowUp 经 openRoomTx({allow:['executed']}) 豁免 | — |
| OBJ-03 | canon | fixed | 00-canon §1.1/§1.2、part2 D05、part4 D25 | objection accepted：revision = 定价修订号 + editNo，逻辑唯一 (roomId, itemKey, revision, editNo) | — |
| OBJ-04 | canon | fixed | 00-canon-part3 D14 | objection accepted：restrictedRef 目标扩为 03 restrictedRefV 的八表，条件"本就按角色控制访问" | — |
| OBJ-05 | canon | fixed | 00-canon §1.3 | objection accepted：一句话定义 passesChecks / isExecutable（当前性 ∧ passesChecks，不含审批集合）/ canExecuteNow | — |
| OBJ-06 | canon | partially | 00-canon §1.5 | objection accepted 于 approval.not_executable、input.invalid、auth.*、invite.*、item.limit_exceeded；"无可撤回"不设 approval.nothing_to_withdraw，按 08 / 12 现文返回 unchanged（objection 所述"08 用 nothing_to_withdraw"已过时） | 无剩余：部分采纳即 canon 终局裁决 |
| OBJ-07 | canon | fixed | 00-canon §1.3、part2 D06 | objection accepted：选 (ii) 同事务 stale → active（与 04 P4 + P5 一致） | — |
| OBJ-08 | canon | partially | 00-canon §1.5 | objection accepted 于 request.not_open（另一码名为 request.option_unknown，跟 12）；rejected 于 approval.nothing_to_withdraw / approval.invalid_reason / config.invalid——各章已收敛到 unchanged / input.invalid / run.invalid_state{scenario_version} | 无剩余：部分采纳即 canon 终局裁决 |
| OBJ-09 | canon | fixed | 00-canon-part4 D22 | objection accepted：删去 validUntil 例子，注明 v1 无此字段、17 引入时须进投影或翻转清单 | — |
| OBJ-10 | canon | partially | 00-canon §1.3、part3 D12、part5 C48 | objection accepted 于"canon 必须定义 setup → open 触发条件"；rejected 于其建议的"三席就位即 open"——以 04 M2 openIfReady 为准（就绪全满足才 open 并开 run） | 无剩余：部分采纳即 canon 终局裁决 |
| OBJ-11 | canon | fixed | 00-canon-part4 D23 | objection accepted：recordBaseline 在上限已确认时守 baseline ≤ capCents，raise_cap ≥ committed，同码 budget.below_committed | — |
| OBJ-12 | canon | fixed | 00-canon-part3 D12 ⑥ | objection accepted：计数源 = 命令事件 + events.by_room_actor 按 distinct commitTs；系统自动开局不计 constraint_writes、计 run_starts | — |
| OBJ-13 | canon | fixed | 00-canon-part2 D06 | objection accepted：保留提案只限被取代 run 处于 pending_approval（04 Q1 / 09 Q1 所述"canon 已收窄"现已真正写入 canon） | — |
| OBJ-14 | canon | fixed | 00-canon §1.3 | objection accepted：superseded 扩为"同 run 新版本替代或 run 非因约束变化而结束" | — |
| OBJ-15 | canon | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02 | — |
| OBJ-16 | canon | fixed | 00-canon §1.5 | objection accepted：approval.not_executable 入表 | — |
| OBJ-17 | canon | fixed | 00-canon §1.1/§1.2 | objection accepted：同 OBJ-03 | — |
| OBJ-18 | canon | fixed | 00-canon §1.1 | objection accepted：同 OBJ-01 | — |
| OBJ-19 | canon | fixed | 00-canon-part4 D27 | objection accepted：2 条 stale_approve + finance pending；provider 在 run 2 提出 $800 | — |
| OBJ-20 | canon | fixed | 00-canon §1.2、part4 D22 | objection accepted：规则在 query 与普通 mutation 一律读 localDate；补充 09 §9.6.7 的 rollLocalDateTx（物化前先推进） | — |
| OBJ-21 | canon | fixed | 00-canon-part3 D17、页首、00-product-decisions-part2 PD-11 | objection accepted：取 D17 / 10 的 MAX_ATTEMPTS_PER_TURN = 2，否决 PD-11 的 3 次 | — |
| OBJ-22 | canon | fixed | 00-canon §1.4、00-invariants-part2 INV-04 | objection accepted：属性名白名单，显式例外 proposalVersion / baseProposalVersion / toRole | — |
| OBJ-23 | canon | fixed | 00-canon-part2 D09 | objection accepted：改写 maxRetries 措辞为"流开始前的瞬时失败由 SDK 重试，流开始后只由 attempt 层负责" | — |
| OBJ-24 | canon | partially | 00-canon-part4 D27 | objection accepted 于"不是 counter、不会有 3 条 stale"；rejected 于"$800 是 v3"——被阻断候选不插提案、不消耗版本号（04 P1、05 §5.15.1 测试行"v1–v2"、09 §9.8.2、14 S8），故为 v2 | 无剩余：部分采纳即 canon 终局裁决 |
| OBJ-25 | canon | fixed | 00-canon-part3 D15 | objection accepted：keep_as_is 按 kind 写明，clarify = 拒绝披露并同轮重开发问方回合 | — |
| OBJ-26 | canon | fixed | 00-canon-part2 D06、part3 D17 | objection accepted：公开 runs.start 拒绝 run.draining，系统路径照常建 run、首回合停泊 | — |
| OBJ-27 | canon | fixed | 00-canon-part2 D09 | objection accepted（说明性）：schema 随 (role, turnKind, 裁剪后动作集, n, scenarioVersion) 变化，与房间无关 | — |
| OBJ-28 | canon | fixed | 00-canon §1.4、part3 D12 ③ | objection accepted：任何角色都没有 option_fits_constraints | — |
| OBJ-29 | canon | rejected | 00-canon §1.5、part3 D17 | objection rejected：不设 run.spend_limit；两种 run 级上限的后果完全相同（customer rounds_exhausted、不提供 keep_as_is），差别只在文案，由 questionKey（call_limit / spend_limit）区分即可，canon 原句"run.*（call_limit / draining / invalid_state / rate_limited）"保留并注明此用法 | — |
| OBJ-30 | canon | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19 | — |
| OBJ-31 | canon | fixed | 00-canon-part4 D27 | objection accepted：$800 由 provider 在下一轮从剔除阻断键的快照中提出，customer 无从 counter | — |
| OBJ-32 | canon | fixed | 00-canon §1.5 | objection accepted：approval.not_executable、item.limit_exceeded 入表 | — |
| OBJ-33 | canon | partially | 00-canon-part3 D12 ⑥ | objection accepted 于总量上界：把 12 B7 / 07 §7.13 已实现的 price_writes（每房间 open 期 24h ≤ 3 批、每 run 同一 itemKey 改价 ≤ 1 次）、setCap / 硬字段子桶、run_starts 写入 canon；"让预检结果对 provider 不可区分"列入 17（07 Q3 同此） | 无剩余：部分采纳即 canon 终局裁决（"预检对 provider 不可区分"列入 17） |
| OBJ-34 | canon | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02 | — |
| OBJ-35 | canon | fixed | 00-canon-part3 D14 | objection accepted：同 OBJ-04 | — |
| OBJ-36 | canon | fixed | 00-canon §1.4 | objection accepted：同 OBJ-22 | — |
| OBJ-37 | canon | fixed | 00-canon §1.6、part3 D12 ⑧ | objection accepted：sharedFacts.add 无 value 参数、值从本人当前简报复制、闸门不与他方秘密比对；12 现文已无 value（已核对） | — |
| OBJ-38 | canon | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19 | — |
| OBJ-39 | canon | fixed | 00-canon §1.5 | objection accepted：approval.not_executable、input.invalid、auth.*（unauthenticated / user_not_provisioned / not_member / role_forbidden / not_creator）入表 | — |
| OBJ-40 | canon | fixed | 00-canon-part2 D02 | objection accepted：明确"抛出 ConvexError approval.stale（params.currentConstraintsVersion）" | — |
| OBJ-41 | canon | fixed | 00-canon-part2 D04 | objection accepted：列出两项豁免；已执行提案上 approve 幂等返回 executed，reject / withdraw → approval.already_executed | — |
| OBJ-42 | canon | fixed | 00-canon §1.3、part2 D06 | objection accepted：同 OBJ-07 | — |
| OBJ-43 | canon | fixed | 00-canon §1.3、part2 D02 | objection accepted（以定义解决）：保留 isExecutable 一词，但定义为当前性 ∧ passesChecks、不含审批集合，最后一票前即可为真；规则部分名 passesChecks | — |
| OBJ-44 | canon | fixed | 00-canon-part4 D22 | objection accepted：同 OBJ-20，并写明原措辞的失败情形 | — |
| OBJ-45 | canon | fixed | 00-canon-part3 D13 | objection accepted：reasonKey 对人按 humanReasonKeys[].audience 渲染，任何他方代理上下文不含 | — |
| OBJ-46 | canon | fixed | 00-canon §1.6 | objection accepted：登记 tasks.markDone（废弃 tasks.complete）与 proposals.get（含 decisions） | — |
| OBJ-47 | canon | fixed | 00-canon §1.6、part3 D17 | objection accepted：ops.* 全部层级 internal，seed.* 仅 dev / preview / test | — |
| OBJ-48 | canon | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02 | — |
| OBJ-49 | canon | fixed | 00-canon §1.5 | objection accepted：API 层 auth / invite / request / input / internal 与 approval.not_executable、item.limit_exceeded 入表 | — |
| OBJ-50 | canon | fixed | 00-canon-part3 D18 | objection accepted：seed.fromFixture 为 internal mutation、以 fixture 身份作 actor 复用入口逻辑；就绪后按生产路径自动开 run，stopBeforeRole 可停在 setup | — |
| OBJ-51 | canon | fixed | 00-canon-part2 D09、part4 D21 | objection accepted：core/engine/strictSchema.ts 是 JSON Schema → 严格 JSON Schema 纯变换，Zod 构造在 convex/model/agents/outputSchema.ts | — |
| OBJ-52 | canon | fixed | 00-canon-part4 D20 | objection accepted：convex-helpers 0.1.128 列入基线并写明手写包装器退路 | — |
| OBJ-53 | canon | fixed | 00-canon-part4 D21 | objection accepted：允许同一 ESLint 内的 eslint-plugin-boundaries 补漏，注明它不是被否决的双工具 | — |
| OBJ-54 | canon | fixed | 00-canon §1.1、part4 D24 | objection accepted：单一写入口改为 helper addMember（rooms.create / invites.accept / rooms.startFollowUp 共用） | — |
| OBJ-55 | canon | fixed | 00-canon-part3 D15、part7 13 must_absorb | objection accepted：新增 pass_to_next { toRole }，只在 infeasible 请求、按 relaxationOrder 位置提供（不依赖私密值），回答后同事务给下一角色开它自己视图的请求，仍恰一个 open | — |
| OBJ-56 | canon | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19 / OBJ-31 | — |
| OBJ-57 | canon | partially | 00-canon §1.5 | objection accepted 于 approval.not_executable、item.limit_exceeded、input.invalid、auth.*、invite.*、request.* 与 version.stale_constraints 的写入期含义；approval.nothing_to_withdraw 不采纳（返回 unchanged） | 无剩余：部分采纳即 canon 终局裁决 |
| OBJ-58 | canon | fixed | 00-canon §1.1/§1.2、part4 D25 | objection accepted：同 OBJ-03，并改写 D25 被否决列以消除字面自相矛盾 | — |
| OBJ-59 | canon | fixed | 00-canon-part2 D04、§1.6 | objection accepted：D04 两项豁免；ops.setDraining 全层级 | — |
| OBJ-60 | canon | fixed | 00-canon §1.3 | objection accepted：同 OBJ-05 | — |
| OBJ-61 | canon | fixed | 00-canon-part3 D12 ⑥ | objection accepted：catalog.confirm 一批 ≤ 14 行计一次；setup 期不豁免（正常建房每人 ≤ 2 次）；price_writes 只在 open 期计 | — |
| OBJ-62 | canon | fixed | 00-canon 页首、part5 C43、part7 | objection accepted：编号单一来源 = 00-invariants（CE-001…170），16 从 CE-171 起 | — |
| privacy-01 | privacy | fixed | 07-permissions-privacy.md、07-permissions-privacy-part3.md、07-permissions-privacy-part4.md、07-permissions-privacy-part6.md、07-permissions-privacy-part8.md、07-permissions-privacy-part9.md、16-testing-part2.md、16-testing-part3.md | 07 已有 price_writes / 硬字段子桶（与 12 B7 一致）；本次补齐：PV-16 改写为"⑥ 只决定速率、总量由每房间 24h 桶封顶"，§7.7 码表与 §7.12.2 ⑥ 列标注 P/H/R 三桶，§7.13 量化改为每次预检 ≤ log₂3 bit、合计 ≤ 39 bit/天并新增 DX-12、变更者身份两行，R-1 / PV-INV-14 / T-09 同步；16 新增 TC-AUTH-13（第 4 批价格类目录确认、第 7 次硬字段变更、第 7 个人工 run 均 run.rate_limited，三场景独立），TC-AUTH-12 隔离小时桶，§16.4.3 说明 seed 与总量桶的关系；canon D12 ⑥"堵住零成本预言机"的措辞偏离写入 cross-chapter（已有 canon 异议） | — |
| privacy-02 | privacy | fixed | 07-permissions-privacy.md、07-permissions-privacy-part4.md、07-permissions-privacy-part5.md、07-permissions-privacy-part7.md、07-permissions-privacy-part8.md、07-permissions-privacy-part9.md、16-testing-part5.md、16-testing-part8.md | DX-7 已有"版本号只给买方"；本次发现并堵住残留通道：finance 改上限经 materializeDisclosures 重写已共享的 capCents 行，`disclosure_changed`"Finance updated what they share"与 cv+1 同一提交照样暴露变更者——规定受众外的 disclosure_changed、human_request_closed 同提交并入"Constraints changed (vN)"，他人发起的约束变更提交对 provider actorLabel 为空；§7.9.2 矩阵拆出 briefVersion 行（provider ●′）、PV-12 / DX-5 / §7.17 新增"作者中立"条、T-38、PV-INV-15；16 新增 TC-PRIV-21（A 组三种买方 bump、B 组 answer(raise_cap) 对直接 setCap，组内 provider 视图逐字节相同，含灵敏度对照），TC-PRIV-02 / CE-175 同步；03 §3.11.1 与 12 视图模型的对应改动写入 cross-chapter（12 的 briefVersion null、13 §13.6 文案已由他包改好） | — |
| privacy-03 | rules | fixed | 06-rules-engine-part6.md | 06 §9.2 previewChange 行与 14 S7 已只回答当前提案的预算检查、不做 feasibility 枚举；本轮把 14 S7 返回值改为逐字取自 12 §12.17（补 nextConstraintsVersion），06 §13.3 增加 C0 非干扰用例（扰动 customer 未披露的必需项 / 截止日，finance 结果逐字节不变）；09 §9.6.8 的 feasibleAfter 已删；16 TC-PRIV-13 仍写 budgetAfter / no_change，记跨章 | — |
| privacy-04 | rules | fixed | 14-scenario-scope-change-part3.md | §3 代理拒绝"不显示"、§8.5 agent.recommended 只有 owner 变体、S5 用 turn_completed 已落地；本轮补 §8.5 turn.blocked 模板并把 §11 A3 的 "Provider agent's option was blocked by the checks." 统一为 S8 的不带角色句；T14-T01 增加"provider / finance 文本无按角色代理动作"断言；13 §13.5 区块 10 已同步；16 TC-PRIV-20 断言记跨章 | — |
