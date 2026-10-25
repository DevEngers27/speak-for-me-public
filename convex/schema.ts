import {rateUserV,briefSourceV} from './lib/validators';
import { eventPayloadV } from './lib/eventPayload';
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { itemKeyV, roleV, turnKindV, agentActionV, decisionV, roomStatusV, runStatusV,
  turnStatusV, attemptStatusV, proposalStatusV, humanRequestStatusV,
  catalogItemStatusV, taskStatusV } from "./lib/validators";

const provenanceV = v.union(v.literal("live"), v.literal("seeded"), v.literal("stub"));
const agentModeV = v.union(v.literal("live"), v.literal("stub"));
const approvalKindV = v.union(v.literal("terms"), v.literal("budget"));
const requiredApprovalV = v.object({ role: roleV, kind: approvalKindV });
// Scenario reason keys, 14 §3 (models and human decisions).
const rejectReasonKeyV = v.union(...([
  "cannot_deliver", "missing_required_item", "after_deadline", "preference_not_met",
  "over_budget", "price_too_high", "terms_not_acceptable", "scope_insufficient",
  "needs_earlier_delivery", "other", "over_our_limit",
] as const).map((key) => v.literal(key)));

// 条款与快照（canon D25；08 §8.3.1 相同）
export const termsV = v.object({
  itemKeys: v.array(itemKeyV),        // 字典序、去重、非空；只含 kind: item
  modifiers: v.array(itemKeyV),       // 字典序、去重；只含 kind: modifier（v1 至多 ["rush"]）
  deliveryDate: v.string(),             // IsoDate：localDate(插入日) + 有效工期，插入后不重算（D22）
  amountCents: v.number(),              // = Σ lines[].priceCents
});
export const lineV = v.object({         // 插入时的目录快照，item 与 modifier 各一行
  itemKey: itemKeyV, kind: v.union(v.literal("item"), v.literal("modifier")),
  revision: v.number(), title: v.string(), priceCents: v.number(), leadDays: v.number(),
});
export const plannedTaskV = v.object({  // 插入时由 taskTemplates 派生；执行时原样写入 tasks
  itemKey: itemKeyV, templateIndex: v.number(), title: v.string(),
  assigneeRole: roleV, dueDate: v.string(),
});
export const candidateV = v.object({    // turns.candidateSnapshot 的一项（canon D10）
  optionKey: v.string(),                // "O1".."O12"，按 candidateKey 字典序编号
  candidateKey: v.string(),             // canonical(itemKeys, modifiers)，如 "audit_log_export+sso_login@rush"
  itemKeys: v.array(itemKeyV), modifiers: v.array(itemKeyV),
  amountCents: v.number(), deliveryDate: v.string(),
});

export const agentMoveV = v.union(      // 05 的 Zod AgentModelOutput 规范化后的存储镜像（null 字段已去除）
  v.object({ action: v.literal("propose"), optionKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("counter"), optionKey: v.string(), baseProposalVersion: v.number(), rationale: v.string() }),
  v.object({ action: v.literal("clarify"), toRole: roleV, topicKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("recommend_accept"), proposalVersion: v.number(), rationale: v.string() }),
  v.object({ action: v.literal("reject"), proposalVersion: v.union(v.number(), v.null()),
             reasonKey: rejectReasonKeyV, rationale: v.string() }),
  v.object({ action: v.literal("escalate"), kind: v.union(v.literal("infeasible"), v.literal("needs_tradeoff")),
             toRole: roleV, rationale: v.string() }),
);
export const usageV = v.object({        // Anthropic usage 的整数字段；stub 全 0
  inputTokens: v.number(), cacheCreationInputTokens: v.number(), cacheReadInputTokens: v.number(),
  outputTokens: v.number(), thinkingTokens: v.number(),
});





const customerHardV = v.object({ schemaKey: v.literal("scope_change.customer.v1"),
  requiredItemKeys: v.array(itemKeyV),      // 非空、去重、字典序、≤ 12；不要求已在目录（缺项 → item.required_missing）
  deadline: v.string() });                    // IsoDate + 日期窗口
const providerHardV = v.object({ schemaKey: v.literal("scope_change.provider.v1") }); // v1 provider 硬约束只有目录（D05）
const financeHardV = v.object({ schemaKey: v.literal("scope_change.finance.v1"),
  capCents: v.number() });                    // assertCents，且 >= 当前 committedCents（D23）
const customerSoftV = v.object({ schemaKey: v.literal("scope_change.customer.v1"),
  preferredItemKeys: v.array(itemKeyV),     // 想要但非必需；与 requiredItemKeys 不相交
  notes: v.string() });                       // ≤ 2,000；只给本人与本方代理；REDACTABLE
const providerSoftV = v.object({ schemaKey: v.literal("scope_change.provider.v1"), notes: v.string() });
const financeSoftV = v.object({ schemaKey: v.literal("scope_change.finance.v1"), notes: v.string() });


const sharedFactValueV = v.union(             // 无自由文本（canon §1.1）
  v.object({ kind: v.literal("date"), date: v.string() }),            // IsoDate + 日期窗口
  v.object({ kind: v.literal("itemKeys"), itemKeys: v.array(itemKeyV) }),
  v.object({ kind: v.literal("enum"), value: v.string() }),           // 场景枚举成员
  v.object({ kind: v.literal("cents"), cents: v.number() }),          // assertCents
);



export const revisionCauseV = v.union(v.literal("room_opened"), v.literal("brief_confirmed"),
  v.literal("catalog_changed"), v.literal("human_answer"), v.literal("clock"),
  v.literal("scenario_migrated"));   // 15 的场景版本迁移（08 O12）：对受影响房间强制 bump 后重批；v1 无迁移脚本时不出现
export const sourceRefV = v.union(
  v.object({ kind: v.literal("brief"), briefId: v.id("briefs"), role: roleV, version: v.number() }),
  v.object({ kind: v.literal("catalogItem"), catalogItemId: v.id("catalogItems"),
             itemKey: itemKeyV, revision: v.number() }),
  v.object({ kind: v.literal("ledgerEntry"), ledgerEntryId: v.id("ledgerEntries") }), // 只出现在 room_opened 行
  v.object({ kind: v.literal("humanRequest"), humanRequestId: v.id("humanRequests") }),
  v.object({ kind: v.literal("clock"), localDate: v.string() }),
);







export const requestOptionShownV=v.object({itemKeys:v.optional(v.array(v.string())),modifiers:v.optional(v.array(v.string())),amountCents:v.optional(v.number()),deliveryDate:v.optional(v.string()),deltaCents:v.optional(v.number())});
export const requestEffectV = v.union(
  v.object({ type: v.literal("pass_to_next"), toRole: roleV }),               // 仅 infeasible 请求（含回退请求）：relaxationOrder 中本收件人之后的下一角色；
                                              // 末位没有；每 run 每个 (from, to) 至多一次；不 bump（canon D15、04 R21）
  v.object({ type: v.literal("raise_cap"), amountCents: v.number() }),         // toRole = finance；绝对目标上限
  v.object({ type: v.literal("drop_items"), itemKeys: v.array(itemKeyV) }),  // toRole = customer
  v.object({ type: v.literal("extend_deadline"), date: v.string() }),          // toRole = customer
  v.object({ type: v.literal("choose_candidate"), candidateKey: v.string() }), // toRole = customer
  v.object({ type: v.literal("disclose"), field: v.string(), toRoles: v.array(roleV) }), // 被问方；toRoles = 本次披露新增的受众
                                              // （clarify：发问角色；infeasible 回退：尚未获披露的放松角色；04 R14 / R20、05 §5.11.1、06 §11.1）
  v.object({ type: v.literal("retry_turn") }),                                 // 失败方
  v.object({ type: v.literal("keep_as_is") }),
  v.object({ type: v.literal("end_run") }),
  v.object({ type: v.literal("blocked") }),   // 只作说明、不可选：成立需要他方未披露的值（canon D11，不写数字）
);






export const restrictedRefV = v.union(       // 只指向本就按角色控制访问的行
  v.object({ table: v.literal("briefs"), id: v.id("briefs") }),
  v.object({ table: v.literal("humanRequests"), id: v.id("humanRequests") }),
  v.object({ table: v.literal("attempts"), id: v.id("attempts") }),
  v.object({ table: v.literal("ledgerEntries"), id: v.id("ledgerEntries") }),
  v.object({ table: v.literal("approvals"), id: v.id("approvals") }),           // 只为作者连接 note
  v.object({ table: v.literal("constraintRevisions"), id: v.id("constraintRevisions") }),
  v.object({ table: v.literal("sharedFacts"), id: v.id("sharedFacts") }),
  v.object({ table: v.literal("executions"), id: v.id("executions") }),         // 金额链只给 finance 类
);
export const eventActorV = v.union(
  v.object({ kind: v.literal("user"), role: roleV }),
  v.object({ kind: v.literal("agent"), role: roleV }),
  v.object({ kind: v.literal("system") }),
);

export { eventPayloadV } from './lib/eventPayload';

export default defineSchema({
  // Logical uniqueness: tokenIdentifier — users.ensureViewer.
  users: defineTable({
    tokenIdentifier: v.string(),     // identity.tokenIdentifier（"<issuer>|<subject>"），全局唯一；永不进 DTO / 日志
    displayName: v.string(),         // 取自 claim `name`，取不到则让用户填写；≤ 80；REDACTABLE
    isTestAccount: v.boolean(),      // issuer 属于 dev 实例或 seed 显式置位（techstack D20）
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  // Logical uniqueness: At most one nonterminal run per room — startRunTx (currentRunId and nextRunNo).
  rooms: defineTable({
    scenarioKey: v.literal("scope_change"),     // v1 唯一场景；第二场景改为联合
    scenarioVersion: v.number(),                // 建房钉住（规则、模板、任务派生的版本）
    title: v.string(),                          // ≤ 120；只给人看：不进代理上下文、不进事件 payload
    timeZone: v.string(),                       // IANA；建房校验，之后无写路径
    localDate: v.string(),                      // 房间时区的"今天"；只由 rooms.create 与 clock.rollLocalDate 写（D22）
    status: roomStatusV,
    constraintsVersion: v.number(),             // setup 期 0；打开时 → 1（04 M2）；只由 constraints.bump 写
    nextProposalVersion: v.number(),            // 建房 1；只由 insertProposal 写
    nextRunNo: v.number(),                      // 建房 1；只由 startRunTx 写
    writeSeq: v.number(),                       // 房间写锁；只由 openRoomTx 写
    currentRunId: v.optional(v.id("runs")),     // 最新 run（任何状态）；只由 startRunTx 写
    executionId: v.optional(v.id("executions")),// v1 至多一个（D04）；只由 executeIfComplete 写
    followsExecutionId: v.optional(v.id("executions")), // rooms.startFollowUp 建的房间指向旧执行；每个 execution 至多一个后续房间（by_followsExecutionId 先查后插）
    createdBy: v.id("users"),
    provenance: provenanceV,
    createdAt: v.number(),
    openedAt: v.optional(v.number()),
    executedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  }).index("by_createdBy", ["createdBy"])       // 每用户建房节流（techstack X2）+ "我建的房间"
    .index("by_status", ["status"])             // clock / reconcile / 请求过期巡检只列 open 房间
    .index("by_followsExecutionId", ["followsExecutionId"]), // rooms.startFollowUp 的"每个执行至多一个后续房间"（先查后插 + 旧房间写锁）

  // Logical uniqueness: (roomId, userId) and (roomId, role) — addMember.
  members: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"),
    role: roleV,                                // 写后不变
    displayName: v.string(),                    // 加入时快照；≤ 80；REDACTABLE；不进任何代理上下文
    joinedVia: v.union(v.literal("creator"), v.literal("invite"), v.literal("follow_up")),
    inviteId: v.optional(v.id("invites")),      // joinedVia === "invite" 时必有
    joinedAt: v.number(),
  }).index("by_room_user", ["roomId", "userId"])
    .index("by_room_role", ["roomId", "role"])
    .index("by_user", ["userId"]),              // rooms.listMine

  // Logical uniqueness: tokenHash — invites.insertLink; one open (roomId, role) —
  // invites.create / invites.insertLink supersede the previous open row under the room lock.
  invites: defineTable({
    roomId: v.id("rooms"),
    role: roleV,
    mode: v.union(v.literal("email"), v.literal("link")),
    invitedEmail: v.optional(v.string()),       // mode=email 必有：小写 + NFC，≤ 254；REDACTABLE
    tokenHash: v.optional(v.string()),          // mode=link 必有：SHA-256 hex，action 内生成；明文不入库
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("superseded")),
    expiresAt: v.number(),                      // createdAt + 72h；过期在 accept 时比较，不写状态
    createdBy: v.id("users"),
    acceptedBy: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_room_role", ["roomId", "role"])          // 新邀请把同角色 open 行置 superseded
    .index("by_email_status", ["invitedEmail", "status"]) // invites.listMine
    .index("by_tokenHash", ["tokenHash"]),               // 链接接受

  // Logical uniqueness: (roomId, role, version) — insertBriefVersion.
  briefs: defineTable({
    roomId: v.id("rooms"),
    role: roleV,
    version: v.number(),                        // (roomId, role) 内从 1 连续
    hardFields: v.union(customerHardV, providerHardV, financeHardV),
    softFields: v.union(customerSoftV, providerSoftV, financeSoftV),
    disclosures: v.record(v.string(), v.array(roleV)), // 字段 → 受众（本版本的披露决定）；空数组 = 不共享
    source: briefSourceV,
    humanRequestId: v.optional(v.id("humanRequests")), // source === "request_answer" 必有：追溯"cv N 由哪个取舍造成"
    confirmedBy: v.id("users"),
    confirmedAt: v.number(),
    provenance: provenanceV,
  }).index("by_room_role_version", ["roomId", "role", "version"]),

  // Logical uniqueness: (roomId, fromRole, field, seq) — appendSharedFact.
  sharedFacts: defineTable({
    roomId: v.id("rooms"),
    fromRole: roleV,
    field: v.string(),                          // plugin.fields 中 owner=fromRole 且可披露的键（07 §7.8.4）
    seq: v.number(),                            // (roomId, fromRole, field) 内从 1 连续；"最新行"按它取，不按 _creationTime
    value: v.union(sharedFactValueV, v.null()), // null = 撤回
    audience: v.array(roleV),                   // 不含 fromRole；⊆ 允许受众；撤回行为空
    briefVersion: v.number(),                   // 值所属的 fromRole 简报版本（历史值按版本判定受众，07 PV-12）
    source: v.union(v.literal("brief_confirm"), v.literal("manual"),
                    v.literal("request_answer"), v.literal("ledger")),
    humanRequestId: v.optional(v.id("humanRequests")), // source === "request_answer" 必有
    createdBy: v.union(v.id("users"), v.null()),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_room_from_field", ["roomId", "fromRole", "field", "seq"]),

  // Logical uniqueness: (roomId, itemKey, revision, editNo) — appendCatalogRow.
  catalogItems: defineTable({
    roomId: v.id("rooms"),
    itemKey: itemKeyV,                        // 房间内稳定；item 与 modifier 共用键空间；同键 kind 不可变
    revision: v.number(),                       // 定价修订号：仅 priceCents / leadDays / status 变化 +1；draft 行为 0（09 §9.1.3）
    editNo: v.number(),                         // 同一 revision 内的展示修订号：新 revision 从 0 起，只改 title / taskTemplates 时 +1
    status: catalogItemStatusV,
    kind: v.union(v.literal("item"), v.literal("modifier")),
    title: v.string(),                          // ^[^<>\r\n]{1,80}$；唯一进入他方代理上下文的人写串
    priceCents: v.number(),                     // assertCents 且 <= MAX_CATALOG_ROW_CENTS（8e9，06 §4）
    leadDays: v.number(),                       // item：标准工期天数；modifier：加急缩短的天数（物化归 14）；整数 0–365
    taskTemplates: v.array(v.object({ title: v.string(), assigneeRole: roleV })), // item ≤ 5 条；modifier 必须为空
    confirmedBy: v.optional(v.id("users")),     // status !== "draft" 必有
    confirmedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_room_item", ["roomId", "itemKey", "revision", "editNo"]),

  // Logical uniqueness: one baseline per room and one commit per execution — appendLedgerEntry
  // (called by ledger.recordBaseline / executions.executeIfComplete).
  ledgerEntries: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("baseline"), v.literal("commit")),
    amountCents: v.number(),                    // assertCents；baseline 可为 0
    executionId: v.optional(v.id("executions")),// commit 必有、baseline 必无（handler 断言 + 对账 R5）
    recordedByUserId: v.id("users"),            // baseline：finance；commit：投最后一票的人
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_room_kind", ["roomId", "kind"]),

  // Logical uniqueness: (roomId, version) — constraints.bump.
  constraintRevisions: defineTable({
    roomId: v.id("rooms"),
    version: v.number(),                        // bump 后的 rooms.constraintsVersion；(roomId, version) 从 1 连续
    previousVersion: v.number(),                // = version - 1
    cause: revisionCauseV,
    actorUserId: v.optional(v.id("users")),     // 只有 cause === "clock" 时缺省
    sourceRefs: v.array(sourceRefV),            // room_opened：全部生效来源；其余：本次变化的来源
    localDate: v.string(),                      // bump 时的 rooms.localDate（重放用）
    supersededRunId: v.optional(v.id("runs")),
    staleProposalId: v.optional(v.id("proposals")),
    createdAt: v.number(),
  }).index("by_room_version", ["roomId", "version"]),

  // Logical uniqueness: (roomId, runNo), at most one nonterminal run — startRunTx.
  runs: defineTable({
    roomId: v.id("rooms"),
    runNo: v.number(),                          // = rooms.nextRunNo（房间内从 1 连续，展示 "Run #2"）
    status: runStatusV,
    cause: v.union(v.literal("room_opened"), v.literal("constraints_changed"),
      v.literal("renegotiation_requested"), v.literal("manual_start")),           // 04 §4.3.1
    constraintsVersionAtStart: v.number(),      // 插入时重读的 room.constraintsVersion；D06 下非终态时恒等于它
    agentMode: agentModeV,                      // 开局时快照 AGENT_MODE；本 run 全部 attempt 同一模式
    roundNo: v.number(),                        // 1 起
    maxRounds: v.number(),                      // 场景快照，默认 3；keep_as_is 延长一次时 +1
    roundsExtended: v.boolean(),                // 每 run 至多延长一次（canon D15）
    activeTurnSeq: v.union(v.number(), v.null()), // 唯一可持久化的回合；非 negotiating 时为 null（G2）
    nextTurnSeq: v.number(),                    // 下一 turn 的序号，从 1 起
    currentProposalId: v.optional(v.id("proposals")), // 本 run 当前提案；D06 沿用时指向旧 run 创建的提案
    attemptCount: v.number(),                   // 已创建的 attempt 数（含 stub）
    maxAttempts: v.number(),                    // 快照：默认 maxRounds × 3 × 2（canon D17）
    reservedMicroUsd: v.number(),               // 在途 attempt 的美元预留之和（调度前预留、提交时结算）
    spentMicroUsd: v.number(),                  // 已结算估算成本之和
    spendCapMicroUsd: v.number(),               // 快照：每 run 美元上限（10 定默认值）
    previousRunId: v.optional(v.id("runs")),
    startedBy: v.optional(v.id("users")),       // 人工开局者，或引起系统开局的成员；纯系统为空
    endedReason: v.optional(v.union(v.literal("executed"), v.literal("constraints_changed"),
      v.literal("renegotiation_requested"), v.literal("no_agreement"), v.literal("request_expired"),
      v.literal("canceled_by_creator"), v.literal("room_closed"))),
    lastFailure: v.optional(v.object({ code: v.string(), at: v.number() })), // 最近一次回合失败（不随重试清除）
    provenance: provenanceV,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_room_runNo", ["roomId", "runNo"])
    .index("by_status", ["status"]),            // ops.livenessSweep / setDraining(false) 只列 negotiating

  // Logical uniqueness: (runId, turnSeq), at most one nonterminal turn — createTurnTx.
  turns: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    turnSeq: v.number(),                        // = run.nextTurnSeq；(runId, turnSeq) 唯一
    roundNo: v.number(),
    role: roleV,
    kind: turnKindV,
    status: turnStatusV,
    constraintsVersion: v.number(),             // 创建时 room.constraintsVersion 快照（G3 比较它，canon D07 / C12）
    baseProposalId: v.optional(v.id("proposals")),   // evaluate 回合评估的提案
    baseProposalVersion: v.optional(v.number()),     // 同上的版本号（模型只引用小整数，05 P01）
    candidateSnapshot: v.array(candidateV),     // ≤ 12，按 candidateKey 字典序，optionKey O1..On；写后不变
    allowedActions: v.array(agentActionV),      // allowedActions(role, kind, ctx) 的结果（05 §5.3.3）；写后不变
    promptVersion: v.string(),                  // 提示模板版本（缓存与评测归因）
    currentAttemptNo: v.number(),               // 0 = 尚无 attempt；G0 比较它
    waitingReason: v.optional(v.union(v.literal("backoff"), v.literal("spend_deferred"), v.literal("draining"), v.literal("run_cap"))),   // run_cap：系统开局超出每房间 24h run_starts 桶（canon D12 ⑥、10 B6a），带 beginFnId
    beginFnId: v.optional(v.string()),          // runAfter(…, turns.beginAttempt) 的 _scheduled_functions id（字符串存、normalizeId 读）
    retryOfTurnId: v.optional(v.id("turns")),   // retry_turn / 修复新建的 turn 指向被替代者
    result: v.optional(agentMoveV),             // 被接受的模型 move（含 rationale），05 §5.2
    outcome: v.optional(v.object({              // 服务端对该 move 的处置（04 §4.3.4）
      candidateKey: v.optional(v.string()),     // propose / counter 解析出的候选
      proposalId: v.optional(v.id("proposals")),// 因此插入的提案（provider propose 通过规则时）
      blockedCandidateKey: v.optional(v.string()), // provider 候选被规则阻断（不插提案，provider 只得 blocked）
      answeredFromFacts: v.optional(v.boolean()),  // clarify 由已披露事实代答
    })),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run_turnSeq", ["runId", "turnSeq"]),

  // Logical uniqueness: (turnId, attemptNo), at most one running attempt — turns.beginAttempt.
  attempts: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    turnId: v.id("turns"),
    attemptNo: v.number(),                      // = turn.currentAttemptNo + 1；(turnId, attemptNo) 唯一
    role: roleV,                                // 冗余自 turn，便于按角色聚合
    origin: v.union(v.literal("turn_start"), v.literal("auto_retry"), v.literal("retry_turn")),
    status: attemptStatusV,
    provenance: provenanceV,                    // live / stub（= run.agentMode），再与房间继承
    model: v.string(),                          // "claude-opus-5-5" 或 "stub:v1"
    effort: v.string(),                         // modelGateway 白名单内的值（v1 "medium"）
    maxTokens: v.number(),                      // v1 16000（canon D09）
    schemaVersion: v.optional(v.string()),      // = turnSpecKey(spec)（05 §5.4.1）；action 构造 schema 后随提交写入
    protocolVersion: v.string(),                // PROTOCOL_VERSION（05）
    promptVersion: v.string(),                  // PROMPT_VERSION（05 §5.13.3）
    reservedDay: v.string(),                    // 预留所在的 UTC 日（跨午夜结算回原日期行，10 §10.12.2）
    retryNote: v.optional(v.string()),          // 上一 attempt 的 reasonCode，供 RETRY_NOTES 渲染（10 §10.5.1）
    actionFnId: v.optional(v.string()),         // agents.runAttempt 的调度 id
    watchdogFnId: v.optional(v.string()),       // agents.watchdog 的调度 id（每个 attempt 自有，canon D07）
    watchdogArmCount: v.number(),               // 重登记次数 ≤ 3（04 §4.5.3）
    deadlineAt: v.number(),                     // 看门狗到期时刻，随重登记更新
    reservedMicroUsd: v.number(),               // 调度前预留额（按 maxTokens 与价目表估算）
    usage: v.optional(usageV),                  // ↓ 用量字段：写一次（含迟到结果补记）
    stopReason: v.optional(v.string()),
    stopCategory: v.optional(v.union(v.string(), v.null())),   // stop_details.category 运行时按 string|null（inputs/05 A6）
    requestId: v.optional(v.string()),          // msg._request_id
    messageId: v.optional(v.string()),
    responseModel: v.optional(v.string()),      // msg.model（开启回退时可能不同，D09 默认关）
    latencyMs: v.optional(v.number()),
    costMicroUsd: v.optional(v.number()),       // 结算时按带 asOf 的价目表估算，界面标 "estimate"
    priceTableAsOf: v.optional(v.string()),
    lateUsage: v.boolean(),                     // 守卫拒收或已终态后补记的用量
    errorCode: v.optional(v.string()),          // reasonCode（output.* / action.* / run.*）或 10 §10.15 的 AttemptErrorCode，无原文
    issuePaths: v.optional(v.array(v.string())),// Zod issue 路径，未知段替换为 "*"，截断（privacy review r15）
    staleGuard: v.optional(v.union(v.literal("G1"), v.literal("G2"), v.literal("G3"))), // 守卫拒收的原因（10 §10.7.2）
    httpStatus: v.optional(v.number()),         // SDK 错误的 HTTP 状态（分类用，10 §10.15）
    retryAfterMs: v.optional(v.number()),       // 429 的 retry-after（退避用）
    rationaleTruncated: v.optional(v.boolean()),// rationale > 1,200 码点被截断（05 §5.5.2）
    move: v.optional(agentMoveV),               // 通过 strict 解析的 move（含被语义校验拒绝的），self
    outputBytes: v.optional(v.number()),        // 没有 outputSha256：mutation 内无 crypto，原文已在 rawOutputs
    rawOutputRef: v.optional(v.id("rawOutputs")),// 模型原文只在内部表（canon D16）
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_turn", ["turnId", "attemptNo"])  // canon 指定；G0 与"当前 attempt"
    .index("by_run", ["runId"])                 // run 级上限复核、对账
    .index("by_status_deadline", ["status", "deadlineAt"]) // 卡住的 running attempt 告警；activeAttemptCount
    .index("by_room", ["roomId"]),              // 房间用量汇总（+ _creationTime 区间）

  // Logical uniqueness: Raw output insertion — turns.complete / turns.fail (03 §3.13).
  rawOutputs: defineTable({
    attemptId: v.id("attempts"),
    roomId: v.id("rooms"),
    text: v.string(),                           // 模型返回的原始文本（≤ 64 KiB，超出截断并记 truncated）
    truncated: v.boolean(),
    createdAt: v.number(),
    expiresAt: v.number(),                      // dev 30 天、prod 7 天（15 定），ops.purgeRawOutputs 删除
  }).index("by_attempt", ["attemptId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Logical uniqueness: (roomId, version) — insertProposal.
  proposals: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),                        // 创建它的 run（来历）；"属于哪个活跃 run"只由 runs.currentProposalId 表达
    version: v.number(),                        // = rooms.nextProposalVersion；房间内单调，不因新 run / bump 重置
    origin: v.union(v.literal("agent"), v.literal("human_choice")),
    authorRole: roleV,                          // agent：provider；human_choice：customer
    sourceTurnId: v.optional(v.id("turns")),    // origin === "agent" 必有
    sourceRequestId: v.optional(v.id("humanRequests")), // origin === "human_choice" 必有（04 R15）
    chosenBy: v.optional(v.id("users")),        // human_choice 的回答者
    candidateKey: v.string(),                   // canonical(itemKeys, modifiers)，3.4
    terms: termsV,                              // { itemKeys, modifiers, deliveryDate, amountCents }
    termsKey: v.string(),                       // canonicalJson(terms)；审批第二绑定（canon D25）
    lines: v.array(lineV),                      // 插入时目录快照：键集合 = itemKeys ∪ modifiers
    plannedTasks: v.array(plannedTaskV),        // 插入时由当时修订的 taskTemplates 派生；执行原样写入 tasks
    requiredApprovals: v.array(requiredApprovalV), // 场景快照，v1 三角色；写后不变
    createdAtConstraintsVersion: v.number(),    // 只作来历与展示；isExecutable 不比较它（canon §1.1）
    status: proposalStatusV,
    statusChangedAt: v.number(),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_room_version", ["roomId", "version"])
    .index("by_run", ["runId"]),                // 本 run 的被拒 candidateKey（阻断集）、P2a 取代

  // Logical uniqueness: (proposalId, userId, seq) — approvals.record.
  approvals: defineTable({
    roomId: v.id("rooms"),
    proposalId: v.id("proposals"),
    runId: v.id("runs"),                        // 决定时的 room.currentRunId；仅来历，判定不读
    userId: v.id("users"),
    role: roleV,                                // 取自 members，不接受客户端
    kind: approvalKindV,                        // 由角色派生（customer / provider = terms，finance = budget），只影响文案
    decision: decisionV,                        // approve | reject | withdraw
    seq: v.number(),                            // (proposalId, userId) 内 1..n，跨 cv 不重置
    boundConstraintsVersion: v.number(),        // = 写入时 room.constraintsVersion = expectedConstraintsVersion
    boundTermsKey: v.string(),                  // = proposal.termsKey = expectedTermsKey
    reasonKey: v.optional(rejectReasonKeyV),    // decision === "reject" 必有，其余必无（handler 断言）
    note: v.optional(v.string()),               // ≤ 500 码点；只给本人；不进事件 / 他方上下文；REDACTABLE
    decidedAt: v.number(),                      // 仅展示；任何排序都不读它
  }).index("by_proposal_user", ["proposalId", "userId", "seq"])
    .index("by_run_decision", ["runId", "decision"]),

  // Logical uniqueness: At most one open request per run — openHumanRequestTx.
  humanRequests: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    kind: v.union(v.literal("infeasible"), v.literal("rounds_exhausted"), v.literal("agent_escalated"),
                  v.literal("clarify"), v.literal("agent_failed")),
    toRole: roleV,
    questionKey: v.string(),                    // 模板键（按 kind + cause 选择）
    topicKey: v.optional(v.string()),           // kind === "clarify"：场景话题表的键
    sourceTurnId: v.optional(v.id("turns")),    // clarify / escalate / agent_failed 的来源回合
    constraintsVersion: v.number(),             // 创建时的 cv；bump 时整体 superseded
    options: v.array(v.object({
      optionKey: v.string(),                    // "A".."E"，与模型的 "O1".."On" 区分
      templateKey: v.string(),
      effect: requestEffectV,
      shown: v.optional(requestOptionShownV),
    })),                                        // 非空；末项为出口（end_run），blocked 项不可被回答
    status: humanRequestStatusV,
    expiresAt: v.number(),                      // createdAt + HUMAN_REQUEST_TTL_DAYS（7）天
    answeredBy: v.optional(v.id("users")),
    answerOptionKey: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    closedReason: v.optional(v.union(v.literal("constraints_changed"), v.literal("renegotiation_requested"),
      v.literal("run_canceled"), v.literal("room_closed"), v.literal("regenerated"))), // 仅 superseded 时
    closedAt: v.optional(v.number()),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_run_status", ["runId", "status"])         // "每 run 至多一个 open"（INV-34 的 by_run_open 即本索引）
    .index("by_room_status", ["roomId", "status"])       // 收件箱 "Needs you"、执行时防御性检查
    .index("by_status_expiresAt", ["status", "expiresAt"]), // humanRequests.expireDue（cron）

  // Logical uniqueness: executionKey, proposalId, roomId — executions.executeIfComplete.
  executions: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    proposalId: v.id("proposals"),
    proposalVersion: v.number(),
    executionKey: v.string(),                   // "exec:" + proposalId（canon D03：不含 cv、不哈希、服务端派生）
    constraintsVersion: v.number(),             // 执行时 room.constraintsVersion
    termsKey: v.string(),                       // = proposal.termsKey
    approvalIds: v.array(v.id("approvals")),    // 冻结快照，按 requiredApprovals 顺序（canon D04、R-J）
    executedByUserId: v.id("users"),            // 提交最后一票的人
    scenarioKey: v.literal("scope_change"),
    scenarioVersion: v.number(),                // 类型随 rooms.scenarioVersion（3.2 第 7 条）
    amountCents: v.number(),                    // = proposal.terms.amountCents
    committedBeforeCents: v.number(),           // 快照：仅展示 / 对账，不参与任何计算（08 A11）
    committedAfterCents: v.number(),            // = committedBeforeCents + amountCents <= capCentsAtExecution
    capCentsAtExecution: v.number(),
    provenance: provenanceV,
    executedAt: v.number(),
  }).index("by_executionKey", ["executionKey"])
    .index("by_room", ["roomId"])
    .index("by_proposal", ["proposalId"]),

  // Logical uniqueness: executionId — executions.executeIfComplete.
  changeOrders: defineTable({
    roomId: v.id("rooms"),
    executionId: v.id("executions"),
    proposalId: v.id("proposals"),
    proposalVersion: v.number(),
    number: v.number(),                         // 链内序号：followsExecutionId ? 前序变更单 number + 1 : 1；显示 CO-{number}
    terms: termsV, lines: v.array(lineV), termsKey: v.string(),
    baselineCents: v.number(),                  // G701 (1) 原合同额 ← 本房 baseline 账本行
    priorApprovedDeltaCents: v.number(),        // G701 (2) 已批准变更累计 ← 本房此前 commit 之和（v1 恒 0）
    amountBeforeCents: v.number(),              // G701 (3) 本次前金额 = (1) + (2)
    deltaCents: v.number(),                     // G701 (4) 本次增减 = terms.amountCents
    amountAfterCents: v.number(),               // G701 (5) 新金额 = (3) + (4) <= capCentsAtExecution
    constraintsVersion: v.number(),
    followsExecutionId: v.optional(v.id("executions")),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_execution", ["executionId"])
    .index("by_room", ["roomId"]),

  // Logical uniqueness: taskKey — executions.executeIfComplete.
  tasks: defineTable({
    roomId: v.id("rooms"),
    executionId: v.id("executions"),
    taskKey: v.string(),                        // `${executionId}:${itemKey}:${templateIndex}`（canon §1.2，三段）
    itemKey: itemKeyV,
    templateIndex: v.number(),                  // 从 0 起
    title: v.string(),                          // 来自 proposal.plannedTasks 快照，执行时不重算模板
    assigneeRole: roleV,
    dueDate: v.string(),                        // = terms.deliveryDate
    status: taskStatusV,
    doneByUserId: v.optional(v.id("users")),
    doneAt: v.optional(v.number()),
    provenance: provenanceV,
    createdAt: v.number(),
  }).index("by_taskKey", ["taskKey"])
    .index("by_execution", ["executionId"])
    .index("by_room_assignee", ["roomId", "assigneeRole", "status"]),

  // Logical uniqueness: Singleton key — ops.setDraining.
  opsFlags: defineTable({
    key: v.literal("global"),                   // 恰一行
    draining: v.boolean(),                      // 排空开关（canon D17）：置位后 turns.beginAttempt 不建 attempt、人工开局拒绝
    changedAt: v.number(),
    changedBy: v.union(v.id("users"), v.null()),// 经 `npx convex run ops:setDraining` 时为 null
  }).index("by_key", ["key"]),

  // Logical uniqueness: (scope, day) — turns.beginAttempt.
  spendCounters: defineTable({
    scope: v.literal("global"),
    day: v.string(),                            // UTC "YYYY-MM-DD"
    reservedMicroUsd: v.number(),               // 在途 attempt 的预留
    spentMicroUsd: v.number(),                  // 已结算估算
    attempts: v.number(),                       // 当日 live attempt 数（ops.metrics）
    unknownCostAttempts: v.number(),            // 无响应、成本未知的 attempt 数（不编造金额，10 §10.12.2）
  }).index("by_scope_day", ["scope", "day"]),

  // Logical uniqueness: (roomId, commitTs, seq) — events.append (appendEvents).
  events: defineTable({
    roomId: v.id("rooms"),
    payload: eventPayloadV,                     // 以 payload.type 判别的联合，见下表；无自由文本、无私密数值
    restrictedRef: v.optional(restrictedRefV),
    actor: eventActorV,
    rateUser: v.optional(rateUserV),
    actorUserId: v.optional(v.id("users")),     // 归属与节流计数；system 类，永不进 DTO（12 §12.2 B7）
    refs: v.object({ runId: v.optional(v.id("runs")), proposalId: v.optional(v.id("proposals")),
                     executionId: v.optional(v.id("executions")) }),
    commitTs: v.commitTs(),                     // 提交时由平台填入（techstack D02/X3；1.48 拼写待验证 V-S1）
    seq: v.number(),                            // 同一事务内 0..n-1，由 events.append 分配
    provenance: provenanceV,                    // = 房间 provenance
    createdAt: v.number(),
  }).index("by_room_order", ["roomId", "commitTs", "seq"])   // timeline.page 唯一排序与游标
    .index("by_room_actor", ["roomId", "actorUserId", "rateUser"]),       // + _creationTime：节流窗口计数

});
