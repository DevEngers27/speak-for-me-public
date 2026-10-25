# 03 Convex schema v1 · part1：约定、身份、房间、简报、约束集

> 三片：part1 约定与 users/rooms/participants/invites/briefDrafts/briefVersions/constraintSets 及场景简报 validator；part2 runs/agentTurns/proposals/decisions/humanRequests；part3 executions/commitments/tasks/events/modelCalls、唯一性落点表、不变量落点表、演进规则。每张表都标出它承载的不变量（02）。

## 1. 约定

1. **单一类型来源**：Convex `v` 管存储与函数参数；Zod 只管模型输入输出（05）。字面量集合在 `convex/engine/values.ts` 里以 `as const` 数组与 validator 各写一次，再加编译期断言防漂移（`v.union(...xs.map(v.literal))` 会丢字面量类型，所以不这么写）：

```ts
export const RUN_STATUS = ["negotiating", "awaiting_input", "pending_approval", "failed",
  "executed", "superseded", "no_agreement", "cancelled"] as const;
export const runStatusV = v.union(v.literal("negotiating"), v.literal("awaiting_input"),
  v.literal("pending_approval"), v.literal("failed"), v.literal("executed"),
  v.literal("superseded"), v.literal("no_agreement"), v.literal("cancelled"));
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _runStatusSync: Equals<Infer<typeof runStatusV>, (typeof RUN_STATUS)[number]> = true;
```

2. **金额**：`v.number()` 存整数美分；validator 不能表达整数与范围（inputs/04 §1.8），由 `assertCents(n)`（`Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS`，`MAX_CENTS = 100_000_000_000`）在所有入口校验（VAL-1）。不用 `v.int64()`：bigint 在客户端与 JSON 中都更麻烦，安全整数范围远超需要。
3. **日期**：`v.string()` 存 `YYYY-MM-DD`，入口用唯一的 `isoDate` 谓词（正则 + 真实日历日，与 Zod `z.iso.date()` 行为一致，16 有对拍测试）（VAL-2）。比较用字典序。
4. **时间戳**：`v.number()` 毫秒，来自 mutation 内 `Date.now()`。排序不依赖 `_creationTime`，房间内顺序一律用 `rooms.eventSeq` 派生的 `seq`/`roomSeq`。
5. **索引命名**：包含全部字段，如 `by_roomId_and_roleKey`（inputs/04 §1.6）。
6. **场景联合**：引擎表里属于场景的字段（简报内容、条款、代理输出、请求选项、事件里的场景 payload）都是"以 `scenario` 字面量判别的联合"。v1 只有 `scope_change` 一个成员；第二个场景 = 往联合里加成员 + 场景模块（17）。
7. **可选 vs 清空**：当前指针用 `v.optional(v.id(...))`，清空时 patch 为 `undefined`。

## 2. users

```ts
users: defineTable({
  tokenIdentifier: v.string(),   // identity.tokenIdentifier，全局唯一（inputs/04 §1.7）
  clerkSubject: v.string(),      // identity.subject，仅展示与对账
  displayName: v.string(),       // 首次从 identity.name 取（JWT 是否带 name 待验证），取不到则让用户填写
  createdAt: v.number(),
}).index("by_tokenIdentifier", ["tokenIdentifier"]),
```
承载 ID-1、ID-2。唯一写者 `users.ensure`（插入）与 `users.setDisplayName`（改名）。

## 3. rooms

```ts
rooms: defineTable({
  scenarioKey: v.literal("scope_change"),
  scenarioVersion: v.number(),             // 房间固定在创建时的场景版本（规则、模板、任务派生）
  title: v.string(), goal: v.string(),     // 共享说明，不进规则
  timeZone: v.string(),                    // IANA，建房时定，不可改（VAL-3）
  currency: v.literal("USD"),
  ownerUserId: v.id("users"),
  status: v.union(v.literal("open"), v.literal("closed")),
  constraintsVersion: v.number(),          // 0 = 尚无约束集
  currentConstraintSetId: v.optional(v.id("constraintSets")),
  currentRunId: v.optional(v.id("runs")),
  currentProposalId: v.optional(v.id("proposals")),
  proposalSeq: v.number(), runSeq: v.number(), eventSeq: v.number(), executionSeq: v.number(),
  modelCallsUsed: v.number(), modelCallBudget: v.number(),
  isSimulated: v.boolean(), fixtureKey: v.optional(v.string()),
  createdAt: v.number(), closedAt: v.optional(v.number()),
}).index("by_ownerUserId", ["ownerUserId"]),
```
承载 M-ROOM（每个房间内业务 mutation 都 patch 本行）、CS-1（constraintsVersion、currentConstraintSetId 唯一写者 `bumpConstraints`）、RN-1（currentRunId）、PR-4（currentProposalId）、PR-2/EV-1（序号）、RN-5（调用计数）。**没有任何预算字段**（GAP-01）。

## 4. participants

```ts
participants: defineTable({
  roomId: v.id("rooms"), userId: v.id("users"),
  roleKey: v.string(),                     // 场景声明的角色键；运行时用 scenario.roles 校验
  displayName: v.string(),                 // 加入时快照
  joinedVia: v.union(v.literal("owner"), v.literal("invite"), v.literal("seed")),
  inviteId: v.optional(v.id("invites")),
  briefVersionCount: v.number(),
  currentBriefVersionId: v.optional(v.id("briefVersions")),
  joinedAt: v.number(),
})
  .index("by_roomId_and_roleKey", ["roomId", "roleKey"])
  .index("by_roomId_and_userId", ["roomId", "userId"])
  .index("by_userId", ["userId"]),
```
承载 ID-3、ID-4、ID-5、BR-1。没有 `approvalRequired`：必需审批角色由场景策略快照进提案（PR-6）。v1 不提供移除成员。

## 5. invites

```ts
invites: defineTable({
  roomId: v.id("rooms"), roleKey: v.string(),
  tokenHash: v.string(),                   // SHA-256(base64url token)；明文只在创建时返回给房主一次
  createdByUserId: v.id("users"),
  status: v.union(v.literal("open"), v.literal("accepted"), v.literal("revoked")),
  expiresAt: v.number(),                   // 默认创建后 7 天
  acceptedByUserId: v.optional(v.id("users")), acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_tokenHash", ["tokenHash"])
  .index("by_roomId_and_roleKey", ["roomId", "roleKey"]),
```
承载 ID-6。额外约束："每个 (roomId, roleKey) 至多一个 open 邀请"由 `invites.insertHashed` 守：插入前把同键 open 行改为 revoked。token 在 action 中用 `crypto.getRandomValues` 生成并哈希（mutation 内随机数与 `crypto.subtle` 的可用性和语义待验证，所以放在 action；若 action 中 `crypto.subtle` 也不可用，退化为存明文 token，风险只限于数据库读权限，见 18）。

## 6. briefDrafts

```ts
briefDrafts: defineTable({
  roomId: v.id("rooms"), participantId: v.id("participants"),
  content: briefDraftContentV,            // 与确认 validator 同形但字段全部 optional（手写，不引依赖）
  disclosures: v.array(disclosureV),
  acknowledgements: v.array(v.string()),
  origin: v.union(v.literal("manual"), v.literal("extracted"), v.literal("fixture")),
  baseVersionNo: v.number(),               // 草稿基于哪个确认版本；乐观并发与"未确认改动"提示
  updatedAt: v.number(),
}).index("by_participantId", ["participantId"]),
```
每个参与方至多一行（`briefs.saveDraft` 先查后写）。草稿永不被规则、代理或他方读取（BR-2、BR-3）。

## 7. briefVersions（只追加）

```ts
export const audienceV = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("roles"), roleKeys: v.array(v.string()) }),
);
export const disclosureV = v.object({ field: v.string(), audience: audienceV }); // field 取场景声明的可披露字段

briefVersions: defineTable({
  roomId: v.id("rooms"), participantId: v.id("participants"), roleKey: v.string(),
  versionNo: v.number(),
  content: briefContentV,                  // 场景联合，见 §9
  disclosures: v.array(disclosureV),
  acknowledgements: v.array(v.string()),   // 场景要求的确认项，例如 "offer_lines_public_on_use"
  ruleFieldsChanged: v.array(v.string()),  // 与上一版本的规则字段差异；[] 表示只改了软字段/备注/披露
  changeReason: v.optional(v.string()),    // ≤ 280 字符，例如 "Q4 budget revision"
  changeReasonShared: v.boolean(),         // 是否把原因文本披露给房间（显式披露决定）
  origin: v.union(v.literal("manual"), v.literal("extracted"), v.literal("fixture"),
                  v.literal("request_answer")),
  isSimulated: v.boolean(),
  confirmedByUserId: v.id("users"), confirmedAt: v.number(),
})
  .index("by_participantId_and_versionNo", ["participantId", "versionNo"])
  .index("by_roomId", ["roomId"]),
```
承载 BR-1、BR-4、BR-5、CS-3。唯一写者 `commitBriefVersion`。

## 8. constraintSets（只追加）

```ts
constraintSets: defineTable({
  roomId: v.id("rooms"), version: v.number(),
  briefVersionIds: v.array(v.object({ roleKey: v.string(), briefVersionId: v.id("briefVersions") })),
  committedCents: v.number(),              // finance 版本 externalCommittedCents（无则 0）+ Σ commitments
  cause: v.union(
    v.object({ kind: v.literal("brief_confirmed"), roleKey: v.string(),
               briefVersionId: v.id("briefVersions"), ruleFieldsChanged: v.array(v.string()) }),
    v.object({ kind: v.literal("execution"), executionId: v.id("executions") }),
  ),
  createdAt: v.number(),
}).index("by_roomId_and_version", ["roomId", "version"]),
```
承载 CS-1–CS-4。唯一写者 `bumpConstraints`。原始行永不返回客户端（其中引用私密版本），客户端只看到 version 与 cause 的公开投影。

## 9. 场景简报 validator（scope_change，定义在 `convex/scenarios/scopeChange/validators.ts`）

```ts
const lineV = v.object({
  itemKey: v.string(), variantKey: v.string(), label: v.string(),
  priceCents: v.number(), earliestDeliveryDate: v.string(),
  validUntil: v.optional(v.string()), taskTitle: v.string(),
});
export const scCustomerBriefV = v.object({
  scenario: v.literal("scope_change"), role: v.literal("customer"),
  requestedItems: v.array(v.object({ itemKey: v.string(), title: v.string(),
                                     description: v.optional(v.string()) })),   // 强制披露给房间
  requiredItemKeys: v.array(v.string()),   // 规则字段；可延后 = requested − required
  deadline: v.string(),                    // 规则字段（硬约束，含当日）
  preferredDate: v.optional(v.string()),   // 软字段，只产生 info 检查
  notes: v.string(),                       // 私密备注，只进本方代理
});
export const scProviderBriefV = v.object({
  scenario: v.literal("scope_change"), role: v.literal("provider"),
  offerLines: v.array(lineV),              // 规则字段（任何改动都 bump）
  capacityNotes: v.string(), notes: v.string(),
});
export const scFinanceBriefV = v.object({
  scenario: v.literal("scope_change"), role: v.literal("finance"),
  budgetCapCents: v.number(), externalCommittedCents: v.number(),   // 规则字段
  paymentNotes: v.string(), notes: v.string(),
});
export const briefContentV = v.union(scCustomerBriefV, scProviderBriefV, scFinanceBriefV);
```
跨字段规则（validator 表达不了，由 `scenario.validateBrief` 执行）：itemKey 形如 `^[A-Z][A-Z0-9_]{1,31}$` 且在 requestedItems 内唯一；`requiredItemKeys ⊆ requested`；`(itemKey, variantKey)` 在 offerLines 内唯一；金额 `assertCents`；日期 `isoDate`；`externalCommittedCents ≤ budgetCapCents`；房间已有执行时 `budgetCapCents ≥ committed`（EX-5）。字段分类（规则 / 软 / 备注 / 可披露）见 14 §2。
