# 场景插件接口 · part3：具体设计（二）

### 3.6 规则函数与引擎组合

引擎的组合函数（`engine/core/evaluate.ts`，纯函数，`rooms.view`、`decide`、执行 mutation 共用，F06.1）：

```ts
export function evaluateProposal<A, C, T>(
  plugin: ScenarioPlugin<A, any, C, any, T>,
  p: { terms: T; sourceRefs: SourceRef[]; amountCents: Cents; constraintsVersion: number;
       requiredApprovers: ApproverRequirement[]; proposalId: string },
  room: { currentProposalId: string | null; constraintsVersion: number },
  ctx: EvalContext<A, C>,
): Check[] {
  const checks: Check[] = [];
  checks.push(chk("engine.current", room.currentProposalId === p.proposalId, "NOT_CURRENT_PROPOSAL"));
  checks.push(chk("engine.constraints_version", p.constraintsVersion === room.constraintsVersion,
                  "CONSTRAINTS_STALE", { checkedAgainst: room.constraintsVersion }));
  checks.push(...resolveSources(p.sourceRefs, ctx));          // UNKNOWN_ITEM | ITEM_NOT_CONFIRMED | SOURCE_SUPERSEDED | ITEM_EXPIRED
  const price = plugin.priceTerms(p.terms, ctx);              // throws PluginContractError on bad cents
  assertBreakdown(price);                                     // I9: safe ints, Σ lines === total
  checks.push(chk("engine.amount", price.totalCents === p.amountCents, "AMOUNT_MISMATCH"));
  checks.push(chk("engine.approvers", p.requiredApprovers.length > 0, "NO_REQUIRED_APPROVERS"));
  if (plugin.budget.enabled && ctx.budget) {
    const b = checkBudget(ctx.budget, price.totalCents);
    checks.push({ checkId: "engine.budget", ok: b.ok, reasonCode: b.reasonCode,
                  params: { amountCents: price.totalCents, headroomCents: b.headroomCents },
                  ownerRole: plugin.budget.ownerRole });
  }
  for (const c of plugin.validateProposal(p.terms, price, ctx)) {
    if (c.checkId.startsWith("engine.")) throw new PluginContractError("RESERVED_CHECK_ID");
    checks.push(c);
  }
  return checks;
}
```

插件函数签名与契约（完整类型见 plugin.ts）：

| 函数 | 签名要点 | 契约 |
| --- | --- | --- |
| `deriveConstraints(input)` | `ConstraintInput<A,B> → C` | 缺必需简报时仍返回 `C`，但在 `C` 里标 `missingBriefs`；引擎据此拒绝开始 run（RA-B15） |
| `buildTerms(draft, ctx)` | `D → {ok, terms}｜{ok:false, checks}` | 排序去重 itemKeys；未知键 → `UNKNOWN_ITEM`；`deferredItemKeys` 与 `itemKeys` 不相交；条款字段全部来自草稿或约束，不含金额 |
| `sourceItemKeys(terms)` | `T → ItemKey[]` | 引擎据此从 ctx.catalog 取当前 revision 组成 `sourceRefs`（F05.2：sourceRefs 由代码推出） |
| `priceTerms(terms, ctx)` | `T → PriceBreakdown` | 唯一金额来源；只读 ctx.catalog；每行 `lineCents = quantity × unitPriceCents`，条件费用作为独立行 |
| `validateProposal(terms, price, ctx)` | `→ Check[]` | 只放场景硬约束；每个失败 Check 带 `ownerRole` |
| `enumerateFeasible(ctx, limits)` | `→ {candidates, exhaustive, blockersSeen}` | 可靠性：每个候选 `evaluateProposal` 全通过（一致性测试断言）；小目录必须 `exhaustive: true` |
| `pickStub(candidates, ctx)` | `→ T｜null` | 确定性；同分按 itemKey 字典序 |
| `buildTradeoffRequests(input)` | `→ TradeoffRequestSpec[]` | 每个 option 的 effect 只能写 targetRole 自己有权写的东西（引擎再核一次） |
| `checkTradeoffAnswer(option, ctx)` | `→ ok｜reasonCode` | 防止回答时约束已变（请求已被取消时引擎先拦截） |
| `requiredApprovers(terms, price, c)` | `→ ApproverRequirement[]` | 见 3.10 |
| `deriveExecution(terms, price, ctx)` | `→ {changeOrder, tasks}` | 每个 sourceRef 的 `taskTemplates` 展开为任务；`dueDate = addDays(executedOn, dueOffsetDays)` |

`enumerateFeasible` 的上界：引擎传 `limits = { maxCandidates: 8, maxEvaluations: 4096 }`（2^12）。`catalog.maxItems` 不超过 12 时插件可穷举；更大时插件必须实现剪枝（先固定必需项，再按优先级加入可选项），并在超出 `maxEvaluations` 时返回 `exhaustive: false`。引擎规则：`candidates` 为空且 `exhaustive: false` 时，不得生成"不可行"文案，改为人工请求 `SEARCH_INCOMPLETE`（target 为 catalog.ownerRole 与预算拥有者之外的买方角色，由插件在 `buildTradeoffRequests` 中决定）。

### 3.7 reasonCode 注册表与披露

引擎保留码（插件不得重定义）：

| code | ownerRole | 默认披露（buyer / seller） | 说明 |
| --- | --- | --- | --- |
| `NOT_CURRENT_PROPOSAL` | — | detail / detail | 提案不是房间当前提案 |
| `CONSTRAINTS_STALE` | — | detail / detail | "Checked against constraints v{n}" |
| `UNKNOWN_ITEM` / `ITEM_NOT_CONFIRMED` / `SOURCE_SUPERSEDED` / `ITEM_EXPIRED` | catalog.ownerRole | detail / detail | 目录被引用即公开，故可全披露 |
| `AMOUNT_MISMATCH` | — | detail / detail | 代码缺陷信号，同时写运维计数 |
| `NO_REQUIRED_APPROVERS` | — | detail / detail | 代码缺陷信号 |
| `FITS_BUDGET` / `OVER_BUDGET` / `BUDGET_BELOW_COMMITTED` | budget.ownerRole | detail / summary | provider 只见 "Blocked: exceeds the finance limit"，不见 headroom（F07.1） |
| `SEARCH_INCOMPLETE` / `ROUNDS_EXHAUSTED` | — | detail / detail | 人工请求的问题码 |
| `PLUGIN_CONTRACT_VIOLATION` | — | summary / summary | 只显示 "Internal check failed"，细节进运维日志（无私密值） |

渲染算法（07 的 `projectRoomFor(role)` 内调用）：

```ts
function renderCheck(c: Check, viewer: RoleKey, reg: Registry, f: Fmt): RenderedCheck {
  const spec = reg.get(c.reasonCode);                    // registry built at load; missing => throw
  const level = viewer === c.ownerRole ? "detail" : spec.disclosure[viewer];
  if (level === "masked")
    return { checkId: c.checkId, ok: c.ok, reasonCode: "CONSTRAINT_UNMET",
             text: `A ${f.role(c.ownerRole!)} constraint is not met` };   // no params leave the server
  const tpl = spec.templates[level] ?? spec.templates.summary!;
  return { checkId: c.checkId, ok: c.ok, reasonCode: c.reasonCode,
           text: tpl(spec.paramsSchema.parse(c.params), f),
           params: level === "detail" ? c.params : undefined };
}
```

注册表加载时的校验（启动即失败，不留到运行时）：码不冲突；每个码的 `disclosure` 覆盖所有已声明角色；每个用到的级别都有模板；`ownerRole` 已声明；`masked` 只允许用于有 `ownerRole` 的码。

Q3 的回答在机制上落到这里：私密硬约束（例如 customer 未共享的硬截止日）的码由插件声明为对他方 `masked`。他方仍能推断"customer 有某个约束没满足"——这是可接受的最小披露，必须写进 07 的矩阵。若该字段已被 owner 列入 `sharedFields`，插件可在模板里引用该值，但披露级别仍按注册表，不随共享动态变化（简单优先；动态披露列为开放问题）。

### 3.8 公共文本模板

- 模板是 `(params, fmt) => string` 的纯函数，英文，存于插件；引擎事件模板（成员、决定、执行、run）存于引擎（RA-T03 的分工）。
- 存储只存 `{ type, payload }`（RA-T02），查询时按查看者渲染；同一事件对买方/卖方用不同模板，不存两份。
- `proposalSummary(terms, price, audience, fmt)` 示例（scope_change）："Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred."——金额是变更金额，provider 已知，可对三方显示；"批准后已承诺总额"只由引擎在买方视图里额外渲染（F14.3）。
- 模板参数只能是：itemKeys、引擎算出的金额与日期、reasonCode params、目录 title。模板不得接收简报对象（类型上 `ScenarioTemplates` 没有该参数）。
- 模型自由文本 `rationale` 永远不经过模板，只进本方可见的 agentTurns（F05.3）。

### 3.9 fixture 与 seed

- 形状：`ScenarioFixture { label, simulated: true, timeZone, build(today) → FixtureData, variants }`；`FixtureData` 含目录、三份简报（data + sharedFields）、预算与基线承诺。日期全部 `addDays(today, n)`，避免演练日早于 fixture 日期。
- 变体：每个变体是对 `FixtureData` 的补丁（`budgetTotalCents`、`briefPatches`）加期望 `expect`。必备 `feasible`、`tradeoff`、`infeasible`、`below_committed`。
- seed 流程（15 实现，引擎提供）：`internal.seed.fromFixture({ scenarioKey, fixtureKey, variant?, accounts })` →
  1. `createRoomCore`（与公共 `createRoom` 共用）写 `rooms`（含 `scenarioKey/scenarioVersion/timeZone/fixtureKey`）；
  2. 为每个角色写邀请或直接写 members（账号来自参数）；
  3. 逐条走 `catalog.confirmCore`（attrsSchema 校验）、`briefs.confirmCore`（briefSchema 校验）、`budgets.initCore` + 写 `commitments(kind: 'baseline', simulated: true)`；
  4. 最后一次性计算硬约束哈希、`constraintsVersion = 1`；
  5. 写事件 `room_seeded`（文本 "Seeded fixture (simulated): {label}"）。
  任何一步校验失败整个 mutation 回滚。
- 测试直接 import fixture，数字由 `build(today)` 推出，不在测试里另写（F14.2）。

### 3.10 必需审批人规则

```ts
requiredApprovers(terms: T, price: PriceBreakdown, c: C): ApproverRequirement[]
```

引擎守卫（插入提案时，`engine/core/approvers.ts`）：

1. 结果非空；去重 `(role, kind)`。
2. 每个 role 已在 `plugin.roles` 中声明且当前有席位。
3. 若 `plugin.budget.enabled` 且 `price.totalCents > 0`：必须存在 `{ role: budget.ownerRole, kind: 'budget' }`。这条让"超过阈值才需要 finance"只能发生在零金额场景之外的**条件放宽**被插件明确写出时才可能——见 part4 活动场景的取舍。
4. 快照进 `proposals.requiredApprovers`；完成判定（08）：对每条要求，存在一个当前 `(proposalId, constraintsVersion)` 下最新决定为 approve 的、角色匹配的、彼此不同的 userId。

### 3.11 UI 片段注册点

```ts
// packages/engine/contract/ui.ts (types only)
export interface ScenarioUiSlots<DTO extends ScenarioDtos> {
  catalogItemRow?: (p: { item: DTO["catalogItem"]; viewerRole: RoleKey }) => ReactNode;
  briefFieldsForm?: (p: { role: RoleKey; draft: DTO["briefDraft"]; onChange(next: DTO["briefDraft"]): void;
                          readOnlyFields: string[] }) => ReactNode;
  proposalTermsCard?: (p: { proposal: DTO["proposalForViewer"] }) => ReactNode;
  tradeoffOption?: (p: { option: DTO["tradeoffOptionForViewer"] }) => ReactNode;
  changeOrderBody?: (p: { changeOrder: DTO["changeOrderForViewer"] }) => ReactNode;
  sharedFactValue?: (p: { role: RoleKey; field: string; value: unknown }) => ReactNode;
}
```

- `DTO["...ForViewer"]` 是 Convex query 返回、已按角色投影的类型；槽位拿不到 Convex client。
- 槽位缺省时，引擎通用组件按 `briefFields` 描述符生成表单（hard 字段显示 "Changing this re-opens approvals"，shareable 字段旁显示 "This will be visible to other parties" 勾选框），按 `PriceBreakdown.lines` 渲染条款。
- 所有 `simulated` 记录由引擎统一加 "Simulated" 标签，槽位不能去掉（核心 8）。
- 审批按钮、阻断提示、版本说明不提供槽位（必须由引擎渲染，保证 "Accept terms" / "Approve budget commitment" 与 "Checked against constraints v{n}" 的一致）。

### 3.12 关键时序：代理提案落库（插件函数在哪一步）

1. `agents.runTurn`（action）组装上下文时调用 `plugin.agentInstructions[role]`、`enumerateFeasible`（把候选作为可选空间给模型）、`draftTermsSchema`（嵌入 05 的输出格式）。
2. `completeTurn`（internal mutation）：回合守卫（04/10）→ `safeParse` 模型输出 → `loadEvalContext` → `buildTerms` → 失败则 `failTurn`/有界重试（10）。
3. 成功：`sourceItemKeys` → 组成 `sourceRefs`；`priceTerms` → `amountCents`；`requiredApprovers` → 快照；`contentHash = stableHash({terms, sourceRefs, amountCents, requiredApprovers, taskPreview})`；读 `rooms.proposalVersion` +1 并插入 proposal（I2）。
4. `evaluateProposal` 的结果作为 `validationSnapshot` 存档（仅快照，I10 不以它为准）。
5. 全部检查通过 → run 进入 `pending_approval`；否则按 05 继续回合或 `buildTradeoffRequests` 生成人工请求。
失败点：步骤 2 parse 失败 → 回合 failed、不插入；步骤 3 `PluginContractError` → 回合 failed、`errorCode: 'PLUGIN_CONTRACT_VIOLATION'`、run 进入 needs_input 并点名房主以外的运维告警（不向用户暴露细节）。
