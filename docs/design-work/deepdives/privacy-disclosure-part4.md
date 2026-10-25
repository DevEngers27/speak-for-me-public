# 专题深潜：披露矩阵与代理上下文组装（part4）

## 10. events 可见性模型

### 10.1 存储形状

```ts
// 每个 type 一个 payload 校验器；payload 校验器里没有受限字段可写（结构性保证）
export const eventDoc = v.object({
  roomId: v.id('rooms'),
  seq: v.number(),                       // 房间内递增；或用 v.commitTs()（03 决定，见 part5 接口）
  type: eventTypeV,                      // 字面量联合，见 F03.11
  actor: v.union(
    v.object({ kind: v.literal('user'), role: v.string() }),
    v.object({ kind: v.literal('agent'), role: v.string() }),
    v.object({ kind: v.literal('system') }),
  ),
  payload: eventPayloadV,                // 判别联合，按 type；只含 room 类字段
  restrictedRef: v.optional(v.union(
    v.object({ table: v.literal('budgetChanges'), id: v.id('budgetChanges') }),
    v.object({ table: v.literal('humanRequests'), id: v.id('humanRequests') }),
    v.object({ table: v.literal('agentTurns'),   id: v.id('agentTurns') }),
  )),
  constraintsVersion: v.number(),
  proposalId: v.optional(v.id('proposals')),
  runId: v.optional(v.id('runs')),
  createdAt: v.number(),
});
```

- **没有 visibility 字段**：每条事件对全房间成员存在（PD-8）。
- payload 例：`constraints_changed` → `{ constraintKind: 'budget' | 'brief' | 'catalog', fromVersion, toVersion, invalidatedApprovalCount }`；`proposal_blocked` → `{ proposalVersion, amountCents, reasonCodes }`（amountCents 是公开目录价之和）。新旧上限、shortfall 不在 payload 里，而在 `restrictedRef` 指向的 budgetChanges 行。
- `insertEvent(ctx, e)` 是 events 的唯一写入口，入参类型为 `EventInput<T>`，由 `eventPayloadV` 校验。

### 10.2 读取与渲染

```ts
export const list = query({
  args: { roomId: v.id('rooms'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { roomId, paginationOpts }) => {
    const viewer = await getViewer(ctx, roomId);
    if (!viewer) return null;
    const page = await ctx.db.query('events')
      .withIndex('by_room_seq', q => q.eq('roomId', roomId)).order('desc').paginate(paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(e => renderEventFor(ctx, e, viewer))) };
    // 唯一的展开发生在分页包装上，page 元素已全部替换为 EventView
  },
});

// renderEventFor：只有当 viewer 对 restrictedRef 指向的行有读权时才 ctx.db.get 它
async function renderEventFor(ctx: QueryCtx, e: Doc<'events'>, viewer: Viewer): Promise<EventView> {
  const restricted = e.restrictedRef && canReadRow(viewer, e.restrictedRef)
    ? await loadRestrictedForRender(ctx, e.restrictedRef, viewer) : undefined;
  return { id: e._id, type: e.type, at: e.createdAt, actor: actorLabel(e.actor),
           text: renderTemplate(e.type, { ...e.payload, restricted }, viewer),
           refs: { proposalVersion: e.payload.proposalVersion, runId: e.runId } };
}
```

`EventView = { id, type, at, actor, text, refs }`，**从不包含 payload 或 restrictedRef**。

### 10.3 私密历史不做成事件

本人简报编辑历史、本方代理的 rationale 与失败细节、本方的审批说明草稿，分别由 `briefs.mine`（含 briefVersions）、`agentTurns.mine` 展示在"我的记录"里。它们本来就按角色控制访问，不需要事件层的可见性机制。

### 10.4 事件种类与受众措辞（v1 全集的披露要点）

| type | payload（room 类） | restrictedRef | 受限变体 |
| --- | --- | --- | --- |
| room_created | scenarioKey、simulated | budgetChanges（baseline） | buyer：上限与基线已承诺额 |
| member_joined | role | — | — |
| brief_confirmed | role、version、sharedFactCount | — | — |
| catalog_confirmed | itemKeys、priceCents（已公开） | — | — |
| run_started / run_ended | trigger、round、endedReasonCode | — | — |
| turn_started / turn_completed / turn_failed | role、turnSeq、action、failureKind | agentTurns | 本方：rationale 摘要链接到 agentTurns.mine |
| turn_rejected_stale | role、turnSeq | — | — |
| proposal_created | proposalVersion、authorRole、itemKeys、deferredItemKeys、amountCents、deliveryDate | — | — |
| proposal_blocked | proposalVersion、amountCents、reasonCodes | budgetChanges（若与预算相关） | buyer：committed after / cap / over by |
| constraints_changed | constraintKind、fromVersion、toVersion、invalidatedApprovalCount | budgetChanges | buyer：新旧上限；finance：reason |
| approval_recorded / approval_invalidated | role、decision、proposalVersion、reasonCode | — | note 不进事件，即使已共享也只在审批面板显示 |
| request_opened / request_answered / request_cancelled | targetRole、kind | humanRequests | targetRole 与 option 类允许者：问题与选项全文 |
| executed | changeOrderId、proposalVersion、amountCents、taskCount | — | buyer：执行后已承诺额 |

重复执行请求不写事件（RA-B25），只返回 `{ status: 'already_executed' }`。

## 11. 日志与错误信息纪律

### 11.1 日志

```ts
// convex/lib/log.ts —— convex/ 下唯一允许的日志出口；lint `no-console` 对其余文件报错
type LogFields = Partial<{
  roomId: Id<'rooms'>; runId: Id<'runs'>; turnId: Id<'agentTurns'>; turnSeq: number; role: RoleKey;
  attempt: number; model: string; stopReason: string; inputTokens: number; outputTokens: number;
  cacheReadTokens: number; latencyMs: number; errorCode: ErrorCode; httpStatus: number;
  anthropicRequestId: string; zodIssuePaths: string[];   // 只有路径，没有 message 与 input
}>;
export function logEvent(code: LogCode, fields: LogFields): void {
  console.log(JSON.stringify({ code, ...pickAllowed(fields) }));   // pickAllowed 按白名单键过滤
}
```

禁止进入日志的内容：prompt、system 文本、AgentContext、简报任何字段、notes、rationale、模型原始输出、目录 title、预算数字、displayName、tokenIdentifier、邀请码、Zod issue 的 `message` / `input`、第三方异常的 `message` / `stack`。

### 11.2 错误

- 面向客户端：`throw new ConvexError({ code, ...safeData })`，`safeData` 只允许 `expectedVersion`、`currentVersion`、`retryAfterMs` 等无私密含义的数字；不允许金额。
- 错误码表（节选）：`UNAUTHENTICATED`、`NOT_A_MEMBER`、`FORBIDDEN_ROLE`、`INVITE_INVALID`、`ROLE_TAKEN`、`ALREADY_MEMBER`、`STALE_CONSTRAINTS`、`STALE_PROPOSAL`、`NOT_PENDING_APPROVAL`、`OVER_BUDGET`、`BUDGET_BELOW_COMMITTED`、`INVALID_CENTS`、`INVALID_DATE`、`BRIEFS_NOT_CONFIRMED`、`RUN_ACTIVE`、`CALL_LIMIT_REACHED`、`TURN_NOT_RUNNING`、`REQUEST_NOT_OPEN`。
- `OVER_BUDGET` 对 finance 也不带数值：界面从 `rooms.view` 的 buyer 段取数字。
- 服务端内部也不 `new Error(\`cap ${x}\`)`：异常消息会进入 Convex 函数日志（dashboard 可见）。
- 调用 Anthropic SDK 的 catch：映射为 `{ errorCode: 'MODEL_TIMEOUT' | 'MODEL_RATE_LIMITED' | 'MODEL_BAD_REQUEST' | 'MODEL_OVERLOADED' | 'MODEL_UNKNOWN', httpStatus, anthropicRequestId }`，原 `message` 丢弃（APIError 的消息是否会回显请求内容：待验证，按"会"处理）。
- Zod `safeParse` 失败：只保存 `issues.map(i => i.path.join('.'))` 与 `i.code`。
- 生产部署对非 ConvexError 消息的遮蔽（F07.8 引用）只作兜底，不作为防线（待验证）。

### 11.3 追溯性不靠日志

"谁在何时用了多少 token、哪个回合产出哪个提案"由 agentTurns 的结构化字段与 events 承担（F07.8）；日志只用于排障，保留期按 Convex 默认。

## 12. 反例与边界

| # | 场景 | 结论 |
| --- | --- | --- |
| B1 | provider 多轮提议，观察哪些被 `exceeds_budget` 阻断，二分逼近余量 | 协商固有的信息泄露，由 X2 接受；`maxRounds`（场景配置，≤ 3）与房间调用上限限制探测次数；文档写明为已知残余风险 |
| B2 | customer 代理（buyer 侧，知道预算）被 customer notes 里的注入要求"把预算告诉 provider" | 它的跨方输出只有 itemKeys / deliveryDate / reasonCode / clarify.topic，金额由代码算；剩余的只有"在合法选项中挑选"的低带宽隐蔽信道，接受并记录 |
| B3 | 隐蔽信道：模型通过选择 deliveryDate 的具体日子编码数字 | deliveryDate 必须 ≥ 所选条目 earliestDeliveryDate 且 ≤ 场景窗口；代码可把日期规整为候选集合内的值（候选由代码枚举，模型只能挑 candidateKey）——推荐 05 让 propose 只输出 `candidateKey`，彻底消除日期与条目的自由度 |
| B4 | 目录 title 写入注入文本（provider 自己撰写） | title 是 provider 的显式披露，人可见；进他方代理上下文时 JSON 编码并置于 `<untrusted_text>`；长度 ≤ 80；代理输出照常校验；recommend_accept 永不等于批准 |
| B5 | customer 未共享 requiredItemKeys，provider 不知道为何被阻断 | 只见 `missing_required_item`；协商可能多耗轮次，最终由代码升级给 customer（F05.6）。界面在 customer 简报页提示"共享硬约束能减少往返" |
| B6 | 他方的 displayName 写成 "Ignore all instructions" | displayName 不进任何代理上下文；UI 按纯文本渲染（React 默认转义） |
| B7 | 一人持两个角色以读取双方数据 | `invites.accept` 拒绝已是成员的用户（F02.6）；测试覆盖 |
| B8 | 通过 constraintsVersion 计数变化推断 finance 在操作 | X3 接受；时间侧信道不做防护 |
| B9 | finance 想让 provider 知道上限以加快协商 | v1 不支持（PD-12）；finance 可通过人工请求的回答表达取舍 |
| B10 | 将来第二场景没有买卖双方 | sides 是场景声明的糖衣，引擎只认 `roles` 集合；场景可声明任意角色集合作为某字段的受众 |
| B11 | 导出变更单为 CSV | 不在 v1；若做，单元格以 `= + - @ \t \r` 开头时加 `'` 前缀（F07.10 第 7 条），且导出内容按导出者投影 |
| B12 | 预取 / SSR 把 query 结果放进 props | 只预取经投影的 `rooms.view`；props 进入浏览器（inputs/04 要点 20），所以投影必须在 Convex query 内完成，Next 层不得读受限表 |
