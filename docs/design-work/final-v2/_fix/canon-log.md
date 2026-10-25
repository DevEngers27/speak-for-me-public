# canon 包处置记录（00-canon、00-invariants、00-product-decisions、README）

格式：`<issue id> | fixed|partially|rejected | <文件> | <一句话>`。canon-objections.json 无 id，按文件顺序编为 OBJ-01…OBJ-62。

## canon.json（11 条）

names-18 | fixed | 00-invariants-part3/part5/part6、00-invariants-part11 §4 | INV-24 / INV-57 的 cause 改为 room_opened / brief_confirmed / catalog_changed / human_answer / clock / scenario_migrated；INV-75 改写为 openIfReady → bump(room_opened) → startRunTx(room_opened)；INV-67 就绪描述与 §4 Q4 同步；08 / 14 / 05 中的 budget / initial / restart 已核对现文不再出现（无需跨章改）
names-20 | fixed | 00-invariants-part4 INV-42 | 落点改为 convex/model/agents/modelGateway.ts（以 10 §10.14.1 的实际路径为准，issue 写的 convex/agents/ 不准确），注明 core/engine 只放 strictSchema 纯变换与 runtime/budget 常量
names-23 | fixed | 00-invariants-part3/part4/part6/part7/part8/part9/part10 | INV-31 / CE-054 → auth.role_forbidden / auth.not_member；CE-068 → auth.not_creator；INV-29 / CE-055 → unchanged；INV-45 / CE-083 → run.invalid_state{scenario_version}；CE-132 → currentProposalId 保留；INV-73 → runs.cancel 仅 creator；CE-001 → query null / mutation auth.not_member；CE-120 → invite.invalid
names-24 | fixed | 00-invariants-part2/part3/part5/part6/part10 | scheduleTurn → createTurnTx + beginAttempt；openHumanRequest → openHumanRequestTx；by_run_open → by_run_status；humanRequests.expire → expireDue；runs.by_room_status → currentRunId + by_room_runNo；assertAttemptLive → G0–G3；finishRun → setStatus；INV-60 / CE-151 → invites.createLink；canon §1.6 同时登记 helper 名与废弃别名
names-25 | fixed | 00-invariants-part7/part8/part9/part10/part11 | CE-003/011/087/088/112 改用 fixture 键名；CE-046 改为 revision 不变、editNo + 1；CE-128 / CE-167 改为 customer 被跳过 → finance raise_cap；CE-075 改为截断不重试；CE-086 改为 OUTPUT_SCHEMA_TRANSFORM = sdk
names-38 | fixed | 00-canon §1.1/§1.2/§1.5/§1.6、part2 D04、part4 D27 | §1.5 补 approval.not_executable、item.limit_exceeded 与 auth / invite / request / input / internal（date.before_lead_time 原本已在 §1.5，issue 此点不成立）；§1.6 补 previewChange / tasks.markDone / invites.createLink / expireDue / livenessSweep / activeAttemptCount，ops.setDraining 改为全层级；§1.1 补 constraintRevisions、rawOutputs、editNo；§1.2 示例改 audit_log_export+sso_login@rush；D04 写两项豁免；D27 改 2 条 stale_approve + provider 提出 v2 $800
invariants-09 | fixed | 00-invariants-part6 INV-67 | currentRunId 指向最新 run（任何状态），只由 startRunTx 写，删去"终态清空"，落点改为 startRunTx 断言 cur 为空或已终态
invariants-10 | fixed | 00-invariants-part3 INV-30、part2 INV-03、part7 CE-031 | 代理反馈只含被拒版本（provider 不含角色、买方含 byRole），任何他方代理上下文不含 reasonKey / note；canon D13 补裁 reasonKey 受众；04 R10 现文已无 reasonKey（已核对）；16 的请求体断言列入跨章
invariants-13 | fixed | 00-invariants-part3 INV-24、part5 INV-57、part8 CE-046、canon part2 D05 | INV-24 改为 open 期"投影变 ⇔ bump"+ room_opened / clock / scenario_migrated 三种强制；性质加"同 localDate、同台账"前提；cause 与 09 一致；CE-046 同 revision、editNo + 1；replayRuleView → replayRuleInput
invariants-15 | fixed | 00-invariants-part6 INV-75、part10 CE-146 | INV-75 按 openIfReady 写，系统路径不受排空 / run_starts 阻断；CE-146 拆为 (a) draining 时 run 建立首回合停泊、解除后自动恢复，(b) 节流满时那次写入整体被拒；16 TC-RUN-14 同步列入跨章
invariants-17 | fixed | 00-invariants-part3/part4/part8/part9/part10 | CE-055 unchanged；CE-056 第 11 次 withdraw → run.rate_limited；CE-060 → request.not_open；CE-068 → auth.not_creator；CE-075 / INV-43 截断；CE-127 修复分支取代并 react；CE-132 currentProposalId 保留；CE-144 superseded(regenerated) 并记 answerOptionKey；INV-29 / 31 / 34 码名对齐 12 §12.4；INV-42 落点；按 C43 不在 16 §16.11.2 加修订行，而是直接改电池（16 §16.11.2 应删减，列入跨章）

## CE 编号裁决（00-overview §0.9 第 3 条）

CE-numbering | fixed | 00-canon 页首、part5 C43、part7 16 must_absorb、00-invariants 页首与 part11 §3 | 裁决：INV-01…78、CE-001…170 以 00-invariants 为全仓单一来源；16 只从 CE-171 起新增（现有 171–175），之后新增从 CE-176 起由 16 登记；电池与定稿不一致时改电池本身（16 §16.11.2 的 8 条修订已并入：CE-013/027/029/054/128/133/151/167）；00-overview 引用的旧 CE-001…118 作废、须改引新编号

## canon-objections.json（62 条）

OBJ-01 | fixed | 00-canon §1.1 | objection accepted：补 constraintRevisions 实体行与关系 room 1—n constraintRevision
OBJ-02 | fixed | 00-canon-part2 D04 | objection accepted：D04 改为协商 / 约束 / 成员 / 审批类写入拒绝，tasks.markDone 与 rooms.startFollowUp 经 openRoomTx({allow:['executed']}) 豁免
OBJ-03 | fixed | 00-canon §1.1/§1.2、part2 D05、part4 D25 | objection accepted：revision = 定价修订号 + editNo，逻辑唯一 (roomId, itemKey, revision, editNo)
OBJ-04 | fixed | 00-canon-part3 D14 | objection accepted：restrictedRef 目标扩为 03 restrictedRefV 的八表，条件"本就按角色控制访问"
OBJ-05 | fixed | 00-canon §1.3 | objection accepted：一句话定义 passesChecks / isExecutable（当前性 ∧ passesChecks，不含审批集合）/ canExecuteNow
OBJ-06 | partially | 00-canon §1.5 | objection accepted 于 approval.not_executable、input.invalid、auth.*、invite.*、item.limit_exceeded；"无可撤回"不设 approval.nothing_to_withdraw，按 08 / 12 现文返回 unchanged（objection 所述"08 用 nothing_to_withdraw"已过时）
OBJ-07 | fixed | 00-canon §1.3、part2 D06 | objection accepted：选 (ii) 同事务 stale → active（与 04 P4 + P5 一致）
OBJ-08 | partially | 00-canon §1.5 | objection accepted 于 request.not_open（另一码名为 request.option_unknown，跟 12）；rejected 于 approval.nothing_to_withdraw / approval.invalid_reason / config.invalid——各章已收敛到 unchanged / input.invalid / run.invalid_state{scenario_version}
OBJ-09 | fixed | 00-canon-part4 D22 | objection accepted：删去 validUntil 例子，注明 v1 无此字段、17 引入时须进投影或翻转清单
OBJ-10 | partially | 00-canon §1.3、part3 D12、part5 C48 | objection accepted 于"canon 必须定义 setup → open 触发条件"；rejected 于其建议的"三席就位即 open"——以 04 M2 openIfReady 为准（就绪全满足才 open 并开 run）
OBJ-11 | fixed | 00-canon-part4 D23 | objection accepted：recordBaseline 在上限已确认时守 baseline ≤ capCents，raise_cap ≥ committed，同码 budget.below_committed
OBJ-12 | fixed | 00-canon-part3 D12 ⑥ | objection accepted：计数源 = 命令事件 + events.by_room_actor 按 distinct commitTs；系统自动开局不计 constraint_writes、计 run_starts
OBJ-13 | fixed | 00-canon-part2 D06 | objection accepted：保留提案只限被取代 run 处于 pending_approval（04 Q1 / 09 Q1 所述"canon 已收窄"现已真正写入 canon）
OBJ-14 | fixed | 00-canon §1.3 | objection accepted：superseded 扩为"同 run 新版本替代或 run 非因约束变化而结束"
OBJ-15 | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02
OBJ-16 | fixed | 00-canon §1.5 | objection accepted：approval.not_executable 入表
OBJ-17 | fixed | 00-canon §1.1/§1.2 | objection accepted：同 OBJ-03
OBJ-18 | fixed | 00-canon §1.1 | objection accepted：同 OBJ-01
OBJ-19 | fixed | 00-canon-part4 D27 | objection accepted：2 条 stale_approve + finance pending；provider 在 run 2 提出 $800
OBJ-20 | fixed | 00-canon §1.2、part4 D22 | objection accepted：规则在 query 与普通 mutation 一律读 localDate；补充 09 §9.6.7 的 rollLocalDateTx（物化前先推进）
OBJ-21 | fixed | 00-canon-part3 D17、页首、00-product-decisions-part2 PD-11 | objection accepted：取 D17 / 10 的 MAX_ATTEMPTS_PER_TURN = 2，否决 PD-11 的 3 次
OBJ-22 | fixed | 00-canon §1.4、00-invariants-part2 INV-04 | objection accepted：属性名白名单，显式例外 proposalVersion / baseProposalVersion / toRole
OBJ-23 | fixed | 00-canon-part2 D09 | objection accepted：改写 maxRetries 措辞为"流开始前的瞬时失败由 SDK 重试，流开始后只由 attempt 层负责"
OBJ-24 | partially | 00-canon-part4 D27 | objection accepted 于"不是 counter、不会有 3 条 stale"；rejected 于"$800 是 v3"——被阻断候选不插提案、不消耗版本号（04 P1、05 §5.15.1 测试行"v1–v2"、09 §9.8.2、14 S8），故为 v2
OBJ-25 | fixed | 00-canon-part3 D15 | objection accepted：keep_as_is 按 kind 写明，clarify = 拒绝披露并同轮重开发问方回合
OBJ-26 | fixed | 00-canon-part2 D06、part3 D17 | objection accepted：公开 runs.start 拒绝 run.draining，系统路径照常建 run、首回合停泊
OBJ-27 | fixed | 00-canon-part2 D09 | objection accepted（说明性）：schema 随 (role, turnKind, 裁剪后动作集, n, scenarioVersion) 变化，与房间无关
OBJ-28 | fixed | 00-canon §1.4、part3 D12 ③ | objection accepted：任何角色都没有 option_fits_constraints
OBJ-29 | rejected | 00-canon §1.5、part3 D17 | objection rejected：不设 run.spend_limit；两种 run 级上限的后果完全相同（customer rounds_exhausted、不提供 keep_as_is），差别只在文案，由 questionKey（call_limit / spend_limit）区分即可，canon 原句"run.*（call_limit / draining / invalid_state / rate_limited）"保留并注明此用法
OBJ-30 | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19
OBJ-31 | fixed | 00-canon-part4 D27 | objection accepted：$800 由 provider 在下一轮从剔除阻断键的快照中提出，customer 无从 counter
OBJ-32 | fixed | 00-canon §1.5 | objection accepted：approval.not_executable、item.limit_exceeded 入表
OBJ-33 | partially | 00-canon-part3 D12 ⑥ | objection accepted 于总量上界：把 12 B7 / 07 §7.13 已实现的 price_writes（每房间 open 期 24h ≤ 3 批、每 run 同一 itemKey 改价 ≤ 1 次）、setCap / 硬字段子桶、run_starts 写入 canon；"让预检结果对 provider 不可区分"列入 17（07 Q3 同此）
OBJ-34 | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02
OBJ-35 | fixed | 00-canon-part3 D14 | objection accepted：同 OBJ-04
OBJ-36 | fixed | 00-canon §1.4 | objection accepted：同 OBJ-22
OBJ-37 | fixed | 00-canon §1.6、part3 D12 ⑧ | objection accepted：sharedFacts.add 无 value 参数、值从本人当前简报复制、闸门不与他方秘密比对；12 现文已无 value（已核对）
OBJ-38 | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19
OBJ-39 | fixed | 00-canon §1.5 | objection accepted：approval.not_executable、input.invalid、auth.*（unauthenticated / user_not_provisioned / not_member / role_forbidden / not_creator）入表
OBJ-40 | fixed | 00-canon-part2 D02 | objection accepted：明确"抛出 ConvexError approval.stale（params.currentConstraintsVersion）"
OBJ-41 | fixed | 00-canon-part2 D04 | objection accepted：列出两项豁免；已执行提案上 approve 幂等返回 executed，reject / withdraw → approval.already_executed
OBJ-42 | fixed | 00-canon §1.3、part2 D06 | objection accepted：同 OBJ-07
OBJ-43 | fixed | 00-canon §1.3、part2 D02 | objection accepted（以定义解决）：保留 isExecutable 一词，但定义为当前性 ∧ passesChecks、不含审批集合，最后一票前即可为真；规则部分名 passesChecks
OBJ-44 | fixed | 00-canon-part4 D22 | objection accepted：同 OBJ-20，并写明原措辞的失败情形
OBJ-45 | fixed | 00-canon-part3 D13 | objection accepted：reasonKey 对人按 humanReasonKeys[].audience 渲染，任何他方代理上下文不含
OBJ-46 | fixed | 00-canon §1.6 | objection accepted：登记 tasks.markDone（废弃 tasks.complete）与 proposals.get（含 decisions）
OBJ-47 | fixed | 00-canon §1.6、part3 D17 | objection accepted：ops.* 全部层级 internal，seed.* 仅 dev / preview / test
OBJ-48 | fixed | 00-canon-part2 D04 | objection accepted：同 OBJ-02
OBJ-49 | fixed | 00-canon §1.5 | objection accepted：API 层 auth / invite / request / input / internal 与 approval.not_executable、item.limit_exceeded 入表
OBJ-50 | fixed | 00-canon-part3 D18 | objection accepted：seed.fromFixture 为 internal mutation、以 fixture 身份作 actor 复用入口逻辑；就绪后按生产路径自动开 run，stopBeforeRole 可停在 setup
OBJ-51 | fixed | 00-canon-part2 D09、part4 D21 | objection accepted：core/engine/strictSchema.ts 是 JSON Schema → 严格 JSON Schema 纯变换，Zod 构造在 convex/model/agents/outputSchema.ts
OBJ-52 | fixed | 00-canon-part4 D20 | objection accepted：convex-helpers 0.1.128 列入基线并写明手写包装器退路
OBJ-53 | fixed | 00-canon-part4 D21 | objection accepted：允许同一 ESLint 内的 eslint-plugin-boundaries 补漏，注明它不是被否决的双工具
OBJ-54 | fixed | 00-canon §1.1、part4 D24 | objection accepted：单一写入口改为 helper addMember（rooms.create / invites.accept / rooms.startFollowUp 共用）
OBJ-55 | fixed | 00-canon-part3 D15、part7 13 must_absorb | objection accepted：新增 pass_to_next { toRole }，只在 infeasible 请求、按 relaxationOrder 位置提供（不依赖私密值），回答后同事务给下一角色开它自己视图的请求，仍恰一个 open
OBJ-56 | fixed | 00-canon-part4 D27 | objection accepted：同 OBJ-19 / OBJ-31
OBJ-57 | partially | 00-canon §1.5 | objection accepted 于 approval.not_executable、item.limit_exceeded、input.invalid、auth.*、invite.*、request.* 与 version.stale_constraints 的写入期含义；approval.nothing_to_withdraw 不采纳（返回 unchanged）
OBJ-58 | fixed | 00-canon §1.1/§1.2、part4 D25 | objection accepted：同 OBJ-03，并改写 D25 被否决列以消除字面自相矛盾
OBJ-59 | fixed | 00-canon-part2 D04、§1.6 | objection accepted：D04 两项豁免；ops.setDraining 全层级
OBJ-60 | fixed | 00-canon §1.3 | objection accepted：同 OBJ-05
OBJ-61 | fixed | 00-canon-part3 D12 ⑥ | objection accepted：catalog.confirm 一批 ≤ 14 行计一次；setup 期不豁免（正常建房每人 ≤ 2 次）；price_writes 只在 open 期计
OBJ-62 | fixed | 00-canon 页首、part5 C43、part7 | objection accepted：编号单一来源 = 00-invariants（CE-001…170），16 从 CE-171 起

## 本包章节"与 canon 的对照"更新

00-invariants.md §0 新增"本次修订对齐表"；00-product-decisions 各条标题下注明 canon 处置，part2 末尾新增"与 canon 的对照"表；README 更新分片说明（invariants part1–11、C1–C60、_fix/）。

## 跨章影响（交最后的核对者）

1. 00-overview：§0.3 的测试编号（CE-001…118 旧编号）改引 00-invariants 的 CE-001…170（C43）；§0.9 第 3 条关闭；§0.6 术语表须重新逐字同步 canon §1.1–1.3（新增 constraintRevisions / rawOutputs / editNo / currentRunId / run cause / passesChecks·isExecutable·canExecuteNow / 提案 stale→active）；§0.10 补 C43–C60。
2. 16-testing：§16.11.2 的 8 条修订已并入电池，应删减为指针；part9 第 8 条开放问题关闭；TC-RUN-14 按 CE-146 改为"公开 runs.start 拒绝、系统路径建 run 首回合停泊、解除后自动恢复"；补 provider 请求体无 reasonKey 的断言（invariants-10，08 I8）；新增 pass_to_next 用例（CE-087(b)、CE-138）；新增 CE 从 CE-176 起。
3. pass_to_next（D15 新 effect）：04 增加 needs_input → needs_input 自环（本请求 answered + openHumanRequestTx）与效果表行；05 §5.11.2 在 infeasible 选项中加入、§5.11.4 加效果行；06 buildHumanRequests / relaxations 生成它；03 humanRequests options 的 effect validator 加分支；12 humanRequests.answer 效果表；13 取舍卡渲染"转交"；07 动作矩阵注明它按位置提供、不构成预言机；01 取舍旅程；14 变体表；18 ADR。
4. 10-agent-runtime / 05-protocol：startRunInternal 改名 startRunTx（canon §1.6）；10 part2 步骤 1 "第三份 briefs.confirm → startRunInternal" 改为 openIfReady → react → startRunTx（cause room_opened）。
5. 18-decisions-open-questions：C43–C60 进对应 ADR 的"被否决"；N-08 的 cause 已登记为 scenario_migrated；新增 pass_to_next / keep_as_is 按 kind / D06 收窄的 ADR 记录。
6. 04 Q1 / Q3 / Q4 / Q5 / Q6 与 09 Q1 / Q2 / Q3 / Q5 / Q6、12 §12.25 Q3 / Q5 / Q14、11 Q6 / Q7、13 开放问题 1、07 开放问题 9：canon 已按各章提议写入，相应条目可标"已关闭"。
7. 05 §5.11.4 写 choose_candidate 复核失败时"本请求 answered"，与 04 R19 / canon D15 的 superseded(regenerated) 不一致，05 须改为 superseded。
