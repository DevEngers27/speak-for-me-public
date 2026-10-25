# 07 权限与隐私

## 1. 认证 vs 授权

- 认证：Clerk + `convex/auth.config.ts`（`applicationID: "convex"`，缺环境变量即部署失败）。proxy 的 `auth.protect()` 只做页面跳转。
- 授权：每个 public 函数第一行调用 `convex/engine/auth.ts`：

```ts
getViewer(ctx)            // identity → users 行；query 未认证返回 null
requireUser(ctx)          // mutation 未认证抛 NOT_AUTHENTICATED
requireMember(ctx, roomId)   // → { user, member }；非成员抛 NOT_MEMBER（query 返回 null）
requireRole(ctx, roomId, role | role[])
requireOwner(ctx, roomId)
```

- 业务函数**不接受** userId 或 role 参数。被调度函数不依赖身份：调度前的 mutation 鉴权，并把 `actorUserId` 作为参数显式传入。
- 角色只经 `invites.accept` 授予；`rooms.create` 让创建者以 customer 加入（场景配置 `ownerRole`）。v1 不支持移除成员与换角色。

## 2. 字段 × 角色披露矩阵（R = 可读，W = 可写，— = 不可见）

| 数据 | customer | provider | finance | 说明 |
| --- | --- | --- | --- | --- |
| 预算上限、修订历史与原因 | R | — | RW | 买方可见（`budgetVisibleToRoles`） |
| 已承诺、余量、期初承诺 | R | — | R（期初 W 一次） | 派生值 |
| 承诺台账明细 | R | — | R | provider 只见"自己参与的变更单金额" |
| 提案的 committedAfter / headroomAfter / shortfall | R | — | R | |
| 报价目录（确认后） | R | RW | R | 确认时提示 "Confirmed prices are visible to the room" |
| customer 简报硬字段 | RW | 仅 shareableFields | 仅 shareableFields | |
| 各方 privateNotes | 本人 | 本人 | 本人 | 也进入本方代理上下文 |
| 他方简报状态 | 版本号 + confirmedAt | 同左 | 同左 | 读模型 `briefStatuses` |
| 提案条目、变更金额、交付日、版本 | R | R | R | |
| 提案 reasonCodes | 原码 | 投影码（06 §9） | 原码 | |
| 签字分录（角色、决定、时间） | R | R | R | note 仅在 noteShared 时 |
| agentTurns.output（rationale） | 本角色 | 本角色 | 本角色 | 他方只见回合状态与耗时 |
| agentTurns.usage | 本角色 | 本角色 | 本角色 | 运维另经 CLI |
| humanRequests 全文 | 本角色为 target 时 | 同左 | 同左 | 他方只见 "Waiting on Finance" |
| changeOrders 条款 | R | R | R | |
| changeOrders.budgetSnapshot | R | — | R | |
| tasks | R | RW(status) | R | |
| constraintChanges（cause、版本） | R | R | R | 不含数值 |
| events（room 受众） | R | R | R | payload 不含私密数值 |
| events（roles 受众） | 在 roles 中才可读 | 同左 | 同左 | |

## 3. 动作 × 角色矩阵

| 动作（函数） | customer | provider | finance | owner 附加 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 建房 `rooms.create` | ✓ | — | — | — | 允许名单 `ROOM_CREATOR_ALLOWLIST`（环境变量，可为 `*`） |
| 邀请 `invites.create/revoke` | — | — | — | ✓ | |
| 编辑/确认本人简报 | ✓ | ✓ | ✓ | — | 只能自己的 |
| 报价 `catalog.saveItem/retireItem` | — | ✓ | — | — | bump |
| 设上限 `budget.setLimit` | — | — | ✓ | — | 唯一入口；bump |
| 期初 `budget.recordOpeningBalance` | — | — | ✓ | — | setup 阶段一次；bump |
| 对账 `budget.reconcile`、台账 `budget.ledger` | ✓(只读台账) | — | ✓ | — | reconcile 仅 finance |
| 开始/重谈 `runs.start/requestRenegotiation` | ✓ | ✓ | ✓ | — | 守卫见 04 |
| 重试 `runs.retryTurn` | ✓ | ✓ | ✓ | — | 只能重试失败回合，不能指定角色 |
| 签字 terms `decisions.approve` | ✓ | ✓ | — | — | signatureKind 由角色决定 |
| 签字 budget `decisions.approve` | — | — | ✓ | — | |
| 拒绝 / 撤回 | ✓ | ✓ | ✓ | — | |
| 回答请求 `requests.answer` | target | target | target | — | |
| 改任务状态 | — | ✓ | — | — | |
| 关闭房间 | — | — | — | ✓ | |

房主身份不带审批权；同一 userId 不能持有两个角色（members 双唯一），因此一人无法满足多个签字。

## 4. 读模型与投影

- `rooms.view({roomId})` 返回一个聚合 DTO（同一快照），声明 `returns` 校验器；买方专属字段写成 `v.optional`，代码只在 `budgetVisibleToRoles.includes(role)` 时填充。
- 投影函数 `projectRoomFor(role, snapshot)` 位于 `convex/engine/projection.ts`，是唯一的组装点；禁止在 query 里 `return doc` 或 spread 整个文档。
- 其他读：`briefs.mine`、`turns.mine`（只本角色）、`requests.mine`、`budget.ledger`（买方）、`events.list`（按受众过滤后分页）。
- Next 侧：Server Component props、`preloadQuery` 结果、`useQuery` 结果都只来自上述已投影的 query。

## 5. 代理上下文组装

- 单一入口 `internal.agents.context.build({ turnId })`（internalQuery），角色从 turn 读取，不接受调用方传角色。
- 返回显式对象（05 §6）：本方确认简报、他方 shareableFields、按角色过滤的候选、结构化历史、投影后的 reasonCodes；**不 spread 文档**，不按 roomId 整表 collect 后再过滤。
- provider 上下文中不出现 limitCents、committedCents、headroom、finance privateNotes、customer 未共享字段；单测用 canary 断言（16）。
- customer 代理能看到预算（买方），但它的输出只有 candidateKey 与本方 rationale，对他方可见的内容全部走模板，因此不会成为泄露源。

## 6. 事件可见性

| type | 受众 | payload（示例） |
| --- | --- | --- |
| room_created, member_joined, brief_confirmed | room | `{role, version}` |
| catalog_changed | room | `{itemKey, revision, priceCents}`（报价公开） |
| budget_limit_changed | roles [finance, customer] | `{revision, previousLimitCents, limitCents, reasonCode}` |
| constraints_changed | room | `{fromVersion, toVersion, cause}` |
| run_started / run_ended | room | `{runSeq, trigger, status}` |
| proposal_created | room | `{version, itemKeys, amountCents, deliveryDate, deferredItemKeys}` |
| proposal_blocked | room + roles | room：`{version, projectedCode}`；买方 roles：附 shortfall |
| turn_completed / turn_failed / turn_rejected_stale | room | `{role, turnSeq, status}`（无输出） |
| decision_recorded | room | `{version, role, decision, rejectReasonCode?}` |
| request_opened / request_answered / request_cancelled | room | `{targetRole, questionKey}`（无选项数值） |
| change_order_executed | room | `{number, version, itemKeys, amountCents, deliveryDate}` |
| commitment_recorded | roles [finance, customer] | `{seq, amountCents, committedAfterCents, headroomAfterCents}` |

读时按查看者角色选模板渲染，不存预渲染文本。

## 7. 日志与错误纪律

- 代理 action 只记录 `runId, turnSeq, attempt, role, model, tokens, latencyMs, stopReason, errorCode`；不 `console.log` prompt、简报、模型原文、预算数字（代码审查清单 + lint 规则禁止 `console.*` 出现在 `convex/agents/` 之外的白名单外）。
- 客户端错误一律 `ConvexError({ code })`，不带数值；生产部署隐藏非 ConvexError 消息作为兜底。
- 拒绝 `setBudgetLimit` 时，错误给 finance 的是 `BUDGET_BELOW_COMMITTED`，界面另由 `budget.ledger` 显示最低允许值（finance 本来可见）。

## 8. 威胁模型

| 威胁 | 对策 |
| --- | --- |
| provider 越权读预算 / 简报 | 投影 + returns 校验 + 负面测试 + WebSocket canary 扫描 |
| 自选角色、一人多角 | 只经邀请；members 双唯一；签字要求不同 userId |
| 代理泄露本方私密值 | 模型自由文本只给本方；他方可见内容只走模板 |
| 跨代理注入 | 他方 rationale 不进上下文；用户文本放 untrusted 定界块 |
| 模型编造金额 / 条目 | 只能选 candidateKey；金额从目录重算；contentKey 三方比对 |
| 重放 / 连点签字 | 签字幂等（同 cv 已 approve 返回 already_approved）；执行状态守卫 + operationKey |
| 降预算与执行并发 | budgets 文档 OCC 锚点串行化；执行内重算 |
| 费用滥用 | 成员才能触发；`maxModelCalls`；`AGENTS_ENABLED` 总开关；供应商侧花费上限 |
| 导出注入 | v1 只做打印视图；CSV（若做）单元格前缀 `'` |
| 配置半残 | auth.config 缺变量即失败；proxy 缺 key 时 fail-closed |
