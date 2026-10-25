# 场景插件接口 · part2：具体设计（一）

> 接口全文见 scenario-plugin/contract.ts 与 scenario-plugin/plugin.ts。本片解释结构、依赖方向、目录、角色与简报、约束与版本。

## 3. 具体设计

### 3.1 接口总览（成员 × 调用点 × 纯度）

| 成员 | 产出 | 调用点（谁调用、在哪个函数里） | 读写库 |
| --- | --- | --- | --- |
| `key` / `version` / `supportedVersions` | 标识与钉住 | `createRoom` 写 `rooms.scenarioKey/scenarioVersion`；每次加载插件时核对 | 否 |
| `roles` | 角色、席位、简报 schema 与字段描述 | `createRoom` 生成邀请；`briefs.save/confirm` 校验；07 投影 | 否 |
| `catalog.*` | 条目属性 schema、拥有者、上限 | `catalog.upsertDraft/confirm/withdraw` 校验 | 否 |
| `budget` | 是否启用、拥有者、可见角色 | `updateBudget` 鉴权；07 投影 | 否 |
| `deriveConstraints` | `C` | 引擎 `loadEvalContext`（query/mutation 共用的内部 helper） | 否 |
| `hardConstraintProjection` | 可哈希 JSON | 每个约束写入口，见 3.5 | 否 |
| `draftTermsSchema` | 模型输出片段 | 10 的 `agents.runTurn` 构造输出格式；`completeTurn` safeParse | 否 |
| `buildTerms` | 不可变 `T` | `completeTurn` 插入提案前 | 否 |
| `sourceItemKeys` + `priceTerms` | sourceRefs 与金额 | 插入提案前；`rooms.view`；执行 mutation | 否 |
| `validateProposal` | 场景 Check[] | 引擎 `evaluateProposal`（`rooms.view`、`decide`、执行） | 否 |
| `enumerateFeasible` / `pickStub` | 候选集 | run 开始前（限定代理选择空间）；约束变更后预检；stub 回合 | 否 |
| `buildTradeoffRequests` / `checkTradeoffAnswer` | 人工请求规格 | 无可行解或轮次用尽时的 `completeTurn` / `bumpConstraints` 后续；`answerRequest` | 否 |
| `requiredApprovers` | 审批要求 | 插入提案时快照 | 否 |
| `deriveExecution` | 变更单与任务内容 | 执行 mutation（同事务） | 否 |
| `reasonCodes` / `templates` | 文本 | 查询时按查看者渲染 | 否 |
| `agentInstructions` | 静态 prompt 片段 | `buildAgentContext` | 否 |
| `fixtures` | seed 输入与期望 | `seed.fromFixture`、测试 | 否 |

所有"读写库"列都是"否"——这就是 SP-D2 的形式化表述。引擎负责把库里的数据组装成 `ConstraintInput` / `EvalContext`，负责把插件输出写回库。

### 3.2 依赖方向与目录结构

```
packages/engine/contract/   # contract.ts, plugin.ts  —— 只依赖 zod
packages/engine/core/       # evaluateProposal, approvalsComplete, registry, conformance —— 依赖 contract
packages/scenarios/scope-change/index.ts   # 规则入口 —— 只依赖 engine/contract + zod
packages/scenarios/scope-change/ui.tsx     # "use client" UI 槽位 —— 依赖 react + engine/contract 的 DTO 类型
packages/scenarios/event-budget/...
packages/scenarios/registry.ts             # SCENARIOS = { scope_change, event_budget }
convex/                     # 函数层：鉴权、读写、调度；import engine/core + scenarios/registry
src/                        # Next app；import scenarios/*/ui.tsx 与 DTO 类型
```

依赖规则（CI 强制，SP-D12）：

| 从 \ 到 | engine/contract | engine/core | scenarios/* 规则入口 | scenarios/* ui | convex | src | 外部 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| engine/contract | — | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 | 仅 zod |
| engine/core | 允许 | — | 禁止（只用 `ScenarioPlugin` 类型） | 禁止 | 禁止 | 禁止 | 仅 zod |
| scenarios 规则入口 | 允许 | 禁止 | 禁止跨场景 | 禁止 | 禁止 | 禁止 | 仅 zod |
| scenarios ui | 允许（类型） | 禁止 | 允许（同场景常量） | — | 禁止 | 禁止 | react |
| scenarios/registry | 允许 | 允许 | 允许 | 禁止 | 禁止 | 禁止 | — |
| convex | 允许 | 允许 | 经 registry | 禁止 | — | 禁止 | convex, sdk |
| src | 允许（类型） | 允许（纯格式化） | 经 registry（只读常量） | 允许 | 仅 `_generated/api` | — | next, react, clerk |

Convex 侧能否用相对路径 import `convex/` 目录之外的 `packages/**`：**待验证**（inputs/02 18 附只确认"`@/` 别名不可靠"）。退路：把 `engine/` 与 `scenarios/`（不含 ui）放到 `convex/lib/` 下，Next 用相对路径 import；依赖规则不变。

场景禁止事项清单（写进代码审查清单与 lint）：

1. 不 import `convex/*`、`convex/_generated/*`、`@anthropic-ai/sdk`、`next/*`；规则入口不 import `react`。
2. 不调用 `Date.now()`、无参 `new Date()`、`Math.random()`、`crypto.randomUUID()`、`fetch`、`setTimeout`、`process.env`、`console.*`。
3. 不返回或拼接对他方可见的自由文本；对他方可见的文字只能出现在 `templates` 与 `reasonCodes[].templates` 中，且只用参数和 `Fmt`。
4. 不定义新的动作类型、状态、审批种类；`ApprovalKind` 只有 `terms | budget`。
5. 不放宽引擎检查：`validateProposal` 返回的 Check 只能追加；`checkId` 不得以 `engine.` 开头。
6. 不读其他角色的未披露字段来生成给第三方的内容；`agentView` 只用于本方代理。
7. fixture 不含提案、审批、执行、事件。

### 3.3 目录条目 schema

引擎表（03 负责最终定稿，这里给插件所需的形状）：

```ts
// convex/schema.ts (excerpt)
catalogItems: defineTable({
  roomId: v.id("rooms"),
  itemKey: v.string(),                 // itemKeySchema checked in code; unique per room via single write entry
  revision: v.number(),                // starts at 1; +1 on every confirmed change
  status: v.union(v.literal("draft"), v.literal("confirmed"), v.literal("withdrawn")),
  title: v.string(),
  unitPriceCents: v.number(),          // assertCents in code (inputs/04: v.number has no integer constraint)
  validUntil: v.optional(v.string()),  // isoDateSchema in code
  attrs: v.any(),                      // plugin.catalog.attrsSchema.parse() at the single write entry
  taskTemplates: v.array(v.object({ key: v.string(), title: v.string(), assigneeRole: v.string(),
                                    dueOffsetDays: v.optional(v.number()) })),
  origin: v.union(v.literal("owner"), v.literal("agent_suggestion"), v.literal("fixture")),
  simulated: v.boolean(),
  confirmedBy: v.optional(v.string()), // tokenIdentifier of catalog owner
  confirmedAt: v.optional(v.number()),
  supersedes: v.optional(v.id("catalogItems")),
})
  .index("by_room_key_rev", ["roomId", "itemKey", "revision"])
  .index("by_room_status", ["roomId", "status"]),
```

语义：

- **只追加**：确认一次修改 = 插入一行 `revision + 1`、旧行保持原样（不改 status），`supersedes` 指向旧行。"当前确认版本"= 同 itemKey 最大 revision 且 status 为 confirmed。撤下 = 插入一行 `status: 'withdrawn'`。这让提案的 `sourceRefs: {itemKey, revision}` 永远可解析（RA-B04 回归：旧提案报 `SOURCE_SUPERSEDED`）。
- **attrs 用 `v.any()` + Zod**：Convex validator 不能按场景切换形状；在唯一写入口 `catalog.confirm` 里用 `plugin.catalog.attrsSchema.parse` 校验。备选 `v.record(v.string(), ...)` 也表达不了嵌套形状，收益有限。代价：读出时需要再次 parse（`loadEvalContext` 统一做），失败视为数据损坏、抛 `PLUGIN_CONTRACT_VIOLATION`。
- **价格在引擎字段上**：`unitPriceCents` 是引擎字段而不是 attrs，以便引擎做 I9 断言与"价格只读"的通用表单；数量与条件费用由插件 `priceTerms` 决定。
- **title 被引用即公开**：目录条目一经 confirmed，其 title 与 unitPriceCents 对房间所有成员可见（回答 Q4：provider 确认时界面显示"Confirmed items are visible to everyone in the room"）。卖方的私密信息（成本、产能）放在 provider 简报，不放目录。
- **代理建议条目**：`allowAgentSuggestions` 为真时，代理的 `suggest_item` 动作（05 定义）落为 `status: 'draft', origin: 'agent_suggestion'`，只有 `catalog.ownerRole` 的人能确认；确认触发约束写入口（3.5）。draft 条目不进 `EvalContext.catalog`。
- **过期**：`validUntil < today` 时引擎检查产出 `ITEM_EXPIRED`；过期是时间驱动而非写入驱动，因此引擎在确认条目时用 `ctx.scheduler.runAt` 安排一次 `catalog.expire`，后者走约束写入口（会递增版本）。精度与调度器语义以 inputs/04 为准，行为细节**待验证**。

### 3.4 参与方角色与私密简报

`RoleSpec` 字段：`label`、`side`（buyer/seller/neutral，决定默认披露与模板受众）、`seats: 1`、`agent`（`llm` 调模型、`rule` 用 `pickStub`、`none` 无代理）、`briefSchema`（Zod）、`briefFields`（逐字段 `hardness` 与 `shareable`）。

引擎表：

```ts
briefs: defineTable({
  roomId: v.id("rooms"),
  role: v.string(),
  revision: v.number(),                // optimistic concurrency per brief only
  status: v.union(v.literal("draft"), v.literal("confirmed")),
  data: v.any(),                       // plugin.roles[role].briefSchema.parse() at write
  sharedFields: v.array(v.string()),   // subset of fields with shareable: true
  confirmedBy: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
}).index("by_room_role_rev", ["roomId", "role", "revision"]),
```

规则：

1. 只有本角色的人能写本角色简报；`sharedFields ⊆ { f | briefFields[f].shareable }`，否则 `ConvexError({ code: 'FIELD_NOT_SHAREABLE' })`。
2. 他方只能看到"已确认版本的 `sharedFields` 对应值"，经 `templates.sharedFact` 渲染；看不到未共享字段的存在与否以外的信息（07 投影）。简报的 revision 与 confirmedAt 对所有人可见（RA 采纳项）。
3. 本方代理上下文 = `agentView(data)`（缺省为整个 data）；他方代理上下文只拿到 sharedFields 的值（F07.5 白名单）。插件无法让他方代理看到更多。
4. 预算数字不在任何简报里，在 `budgets` 表（F02.4）；finance 简报只放与预算相关的偏好或阈值（例如活动场景的 `hostApprovalLimitCents`），这些阈值若影响审批人或可行性就必须标 `hardness: 'hard'`。
5. 不保存原始粘贴文本（F02.8）；抽取草稿不经过插件。

### 3.5 约束字段与版本语义

四种版本，各管各的：

| 版本 | 存在哪 | 谁递增 | 作用 |
| --- | --- | --- | --- |
| `scenarioVersion` | `rooms` | 从不（创建时钉住） | 选择插件代码契约；代码升级后旧房间仍按 `supportedVersions` 评估 |
| `constraintsVersion` | `rooms` | 只有 `bumpConstraints` | 审批绑定的另一半（I4）；硬约束投影哈希变化时 +1 |
| 简报 `revision` | `briefs` | 简报写入口 | 乐观并发；不直接影响审批 |
| 目录 `revision` | `catalogItems` | 目录确认入口 | `sourceRefs` 钉住；价格变化经约束投影传导 |

硬约束投影（引擎拼装）：

```ts
const projection: JsonValue = {
  scenario: { key: plugin.key, version: room.scenarioVersion },
  budgetTotalCents: budget?.totalCents ?? null,          // engine part
  seats: sortedRoleSeatAssignments,                      // engine part: role -> participantId
  scenario_hard: plugin.hardConstraintProjection(constraints),
};
const nextHash = stableHash(projection);
if (nextHash !== room.constraintsHash) await bumpConstraints(ctx, roomId, reason, nextHash);
```

要点：

- 调用位置：`briefs.confirm`、`catalog.confirm`、`catalog.withdraw`、`catalog.expire`、`updateBudget`、`answerRequest`（其 effect 写简报或预算）、席位变更。它们都在同一 mutation 内先写数据、再 `loadEvalContext`、再算哈希、再按需 bump。其余写入（草稿、软偏好、显示名）不调用。
- `hardConstraintProjection` 必须只包含 `hardness: 'hard'` 的简报字段派生值与已确认目录的定价相关字段（`itemKey`、`revision`、`unitPriceCents`、`attrs` 中影响规则的字段、`validUntil`、`taskTemplates`）。一致性测试用"改动每个软字段，哈希不变；改动每个硬字段，哈希变化"来核对。
- `committedCents` 不进投影：它只在执行时变化，执行本身会把 run 置为 confirmed；同一房间之后的新 run 自然按新台账评估。若将来多房间共享预算（17 路线），他房执行会改变本房可行性但不递增本房版本——这是已知限制，执行事务内的重算（I5）兜底。
- `today` 不进投影：日期跨天导致"交付日早于今天"由 `validateProposal` 实时报出，不递增版本；审批仍绑定旧版本但执行守卫会因检查失败而拒绝。
