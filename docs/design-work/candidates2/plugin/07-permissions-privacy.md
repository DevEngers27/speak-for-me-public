# 07 权限与隐私

## 1. 认证 vs 授权
- 认证：Clerk 会话 → Convex `auth.config.ts`（issuer = `CLERK_JWT_ISSUER_DOMAIN`，`applicationID: 'convex'`，缺变量即部署失败，fail-closed）。
- 授权：完全在 Convex 函数内。`packages/engine/convex/lib/auth.ts`：
  - `getViewer(ctx)`：`ctx.auth.getUserIdentity()` → `users.by_token`；query 未认证返回 `null`，mutation 抛 `ConvexError({code:'UNAUTHENTICATED'})`。
  - `requireParticipant(ctx, roomId)` → `{user, participant, room, plugin}`；不是成员抛 `NOT_A_PARTICIPANT`（query 返回 null）。
  - `requireRole(ctx, roomId, roleKey)`、`requireLedgerOwner(ctx, roomId, accountKey)`、`requireCatalogAuthor(ctx, roomId, entryKey)`。
- 业务函数**从不**接受 `userId`/`roleKey` 参数代表"我是谁"；调度函数不依赖身份，显式传 `actorUserId`（鉴权已在调度前的 public mutation 完成）。
- Next `proxy.ts` 只做乐观登录跳转；缺 Clerk key 时私有路由返回 "Backend not configured"，不是放行。

## 2. 成员与角色授予
- `rooms.create` 按插件 `roles` 为每个 roleKey 生成邀请：32 字节随机 token，库里只存 SHA-256 `tokenHash`，明文只在创建结果里返回给创建者一次；`expiresAt` 默认 7 天。
- `invites.accept({token})`：同一 mutation 内检查 未过期/未撤销/未接受、`by_room_role` 无人、`by_room_user` 无人 → 插 participant、标记邀请、写 `participant_joined`。
- 创建者身份不带来任何审批权或可见性；创建者若要参与，也必须通过邀请占一个席位。
- v1 每角色一人（Q13）；不支持移除成员（17）。

## 3. 披露模型：三层
1. **引擎表级**：谁能读哪张表的哪些行（§4）。
2. **插件字段级**：简报 `disclosable` + 本人勾选 + `mandatoryFor`；目录 `visibleTo`；`project.derived`；账户 `visibleTo`。
3. **文本级**：只有模板；参数按 `Check.audience` 过滤后才进入渲染。

`rooms.view` 是唯一的房间读模型，声明 `returns`：引擎部分为固定 `v.object`，场景部分为 `plugin.viewValidator`（插件导出的 Convex validator，买方专属字段为 `v.optional`）。据文档 `v.object` 返回校验拒绝多余字段（待验证，16 有对应测试）——若成立，误把私密字段塞进 DTO 会直接报错。

## 4. 字段 × 角色披露矩阵（`software_change`）

| 数据 | customer | provider | finance | 机制 |
| --- | --- | --- | --- | --- |
| customer 简报 `requiredEntryKeys`、`deadline` | 本人 | ✓（强制披露，表单提示） | ✓ | mandatoryFor |
| customer `niceToHaveEntryKeys`、`preferredDate` | 本人 | 仅当勾选 | 仅当勾选 | disclosedFields |
| customer `notes` | 本人 | ✗ | ✗ | 永不披露，只进本方代理 |
| provider `minimumMarginNote` | ✗ | 本人 | ✗ | 同上 |
| finance `notes` | ✗ | ✗ | 本人 | 同上 |
| 他方简报的存在、版本号、确认时间 | ✓ | ✓ | ✓ | `briefStatuses` |
| 已确认目录条目（含价格） | ✓ | ✓ | ✓ | catalog.visibleTo |
| 未确认目录草稿 | ✗ | 本人 | ✗ | 作者可见 |
| 账户 cap、committed、headroom、shortfall | ✓ | ✗ | ✓ | account.visibleTo = [finance, customer] |
| ledgerCapChanges（含 reason） | ✗ | ✗ | ✓ | ownerRole 专属；房间只看到不带数字的 `ledger_cap_changed` 事件 |
| 提案 selection、amount、deliveryDate、deferred | ✓ | ✓ | ✓ | 条款本身是三方要批准的内容 |
| 提案 `executable` 与 reasonCode | ✓ | ✓（code） | ✓ | 所有人 |
| `ledger.over_cap` 的数字 params | ✓ | ✗ | ✓ | Check.audience |
| 回合输出 rationale、用量 | 本角色 | 本角色 | 本角色 | `turns.mine` |
| 回合状态（running/failed） | ✓ | ✓ | ✓ | `rooms.view.runProgress` |
| decisions：谁、何时、approve/reject、reasonCode | ✓ | ✓ | ✓ | 审批是公开行为 |
| decisions.note | 本人 + 同 side | 本人 | 本人 + 同 side | v1 简化：只给本人（开放问题） |
| humanRequest | 仅 targetRole 看到详情；他方看到"Waiting on {roleLabel}" | 同左 | 同左 | 按 targetRole 投影 |
| outcomeDocuments | 按 audienceRoles | 同左 | 同左 | 文档级受众 |

`event_budget` 的差异（只需插件声明，引擎不变）：caterer 看不到 venue 条目，反之亦然；venue/caterer 只看到 derived 中自己的行。

## 5. 动作 × 角色矩阵（`software_change`；"任一" = 任一参与方）

| 动作（函数） | customer | provider | finance | 非成员 |
| --- | --- | --- | --- | --- |
| 编辑/确认自己的简报 `briefs.saveDraft/confirm` | 自己 | 自己 | 自己 | ✗ |
| 目录草稿/确认/撤回 `catalog.*` | ✗ | ✓ | ✗ | ✗ |
| 改账户上限 `ledger.updateCap` | ✗ | ✗ | ✓ | ✗ |
| 登记外部承诺 `ledger.addExternalEntry` | ✗ | ✗ | ✓ | ✗ |
| 开始协商 / 重试回合 / 请求重谈 `runs.*` | 任一 | 任一 | 任一 | ✗ |
| 审批 `decisions.decide` | terms | terms | commitment | ✗ |
| 回答人工请求 `requests.answer` | 若 targetRole | 若 targetRole | 若 targetRole | ✗ |
| 邀请轮换 / 关闭房间 | 创建者 | 创建者 | 创建者 | ✗ |
| 指定替哪个角色跑回合 | ✗（不存在此入口） | ✗ | ✗ | ✗ |

## 6. 代理上下文组装（单一入口）
`internal.agentContext.build({turnId})`（internalQuery）是代理读取数据的唯一入口；角色取自 turn 行，不取参数。返回显式白名单对象，**从不 spread 文档**：

```ts
type AgentContext = {
  protocol: string;                     // 引擎固定文本（可缓存）
  scenario: string;                     // plugin.agent.scenarioBrief（可缓存）
  role: { roleKey: string; instructions: string };      // plugin.agent.roleInstructions[roleKey]
  myBrief: unknown;                     // plugin.project.brief(role, payload, role) 本人完整简报
  sharedFacts: Array<{ fromRole: string; field: string; value: unknown }>; // 只含披露给本角色的字段
  myLedgerView: unknown | null;         // 仅当本角色在 account.visibleTo
  candidates: Array<{ candidateKey: string; view: unknown }>;  // project.derived(c.derived, role)
  history: Array<{ round: number; roleKey: string; action: string; candidateKey?: string; code?: string }>; // 结构化，无 rationale
  currentProposal?: { seq: number; view: unknown };
};
```
单测：用三个 canary（`CANARY-CUS-4410`、`CANARY-PRV-2290`、`CANARY-FIN-7731`）断言每个角色的 `JSON.stringify(context)` 只含本方 canary。

## 7. 事件可见性
`events.audience` 判别联合：`{kind:'room'}` 或 `{kind:'roles', roles}`。`events.list({roomId})` 在服务端按 viewer 过滤后返回（过滤发生在 query 内部是安全的）。私密历史（简报编辑、rationale）不做成事件；`ledger_cap_changed` 写两条：room 级（无数字："Finance changed a constraint"）与 roles:[owner] 级（带 old/new）。

## 8. 日志与错误纪律
- action 内只 `console.log` `{runId, turnSeq, attempt, tokens, latencyMs, errorCode}`；禁止打印 prompt、简报、模型原文（代码审查清单 + 16 的日志 canary 扫描）。
- 面向客户端的错误一律 `throw new ConvexError({ code })`，code 来自固定枚举，消息不含数值；生产部署隐藏非 ConvexError 消息作兜底。

## 9. 威胁模型

| 威胁 | 缓解 |
| --- | --- |
| 越权读他方简报/预算（含 WebSocket 负载、RSC props、preloadQuery） | 仅投影后的 query；`returns` 校验；canary 端到端扫描 |
| 自选角色、一人多角 | 邀请 tokenHash + (room,role)/(room,user) 唯一 |
| 代理泄露本方私密值 | 模型文本只给本方；公共内容只有模板；模型只能选候选键 |
| 跨代理 prompt injection | 他方内容只以结构化码进入上下文；用户文本在不可信定界块 |
| 模型发明金额/条目 | 候选键枚举 + 执行前重算 |
| 费用滥用 | 仅成员触发；`callLimit`；`AGENTS_ENABLED`；供应商 workspace 花费上限 |
| 重放旧邀请 | 一次性、过期、轮换 |
| 配置半残 fail-open | proxy 缺 key 返回 503/未配置页；Convex 侧身份为 null 一律拒绝 |
| 导出公式注入 | 只做打印视图，不做 CSV（v1） |
