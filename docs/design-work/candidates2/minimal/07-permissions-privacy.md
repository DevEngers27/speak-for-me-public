# 07 权限与隐私

## 1. 认证 vs 授权

- **认证**：Clerk → Convex `auth.config.ts`（缺 `CLERK_JWT_ISSUER_DOMAIN` 时 fail-closed）。用户主键 = `identity.tokenIdentifier`（全局唯一，inputs/04 §1.7）。
- **授权**：只在 Convex 函数里按 `seats` 判断。公共函数**从不接受** `userId`/`role` 参数。helper：
  - `getViewer(ctx)` → `tokenIdentifier | null`
  - `requireSeat(ctx, roomId)` → `{ seat, room }`，无席位抛 `ConvexError({code:"NOT_A_MEMBER"})`
  - `requireRole(ctx, roomId, role)`
- query 未认证/非成员返回 `null`（不抛错，避免泄露存在性）；mutation 抛 `ConvexError({code})`。
- 被调度函数不依赖身份：鉴权在调度前的公共 mutation 里完成，internal 函数只收 ID。
- Next `proxy.ts` 的 `auth.protect()` 只做页面跳转（乐观），不是授权。

## 2. 席位授予

- `rooms.create`：创建者选自己的角色并立即认领；其余席位各生成一个 32 字节随机令牌，只存 SHA-256 哈希与 `inviteExpiresAt = now + 7d`，明文**只在本次返回值里给创建者一次**。
- `seats.claim({token, displayName})`：哈希查席位 → 未认领、未过期 → 该用户在本房间无席位 → 认领。角色由席位决定，不能自选。
- `seats.reissueInvite`：仅创建者，仅对未认领席位。v1 无"移除成员"（审计历史引用 seatId）。
- 房主身份不带来任何审批或读取特权（只有补发邀请）。

## 3. 披露模型

每个角色的简报字段分三类，由场景 `disclosure` 声明：

| 类别 | 含义 | 首个场景 |
| --- | --- | --- |
| `private` | 只给本人与本人代理，永不披露 | 所有 `notes`；customer `preferredDate`；provider `preferredItemKeys` |
| `disclosable` | 本人逐项勾选后，给声明的受众 | customer `requiredItemKeys` / `wantedItemKeys` / `deadline` → 受众 provider、finance；finance `totalBudgetCents` / `priorCommittedCents` → 受众 **customer**（provider 永远不在受众内） |
| `public_on_confirm` | 确认即对房间公开（表单显示提示，确认 = 披露决定） | provider `items`（报价目录本就是给客户的报价，Q4） |

表单每个可披露字段旁写 "Visible to: provider, finance"；provider 目录上方写 "Confirming publishes these quote items to everyone in this room"。另外列出"你的代理可能对他方说的话"（rejectCodes 的公开模板），确认即同意。

## 4. 字段 × 查看者矩阵（`rooms.view` 投影后）

| 数据 | customer | provider | finance |
| --- | --- | --- | --- |
| 自己简报全文（含 notes、reason） | ✓ | ✓ | ✓ |
| 他方简报：版本号、确认时间、changeCode | ✓ | ✓ | ✓ |
| 他方已披露字段 | 按受众 | 按受众 | 按受众 |
| 报价目录（标题、价格、最早日期） | ✓ | ✓ | ✓ |
| 提案条款（items、amount、date、deferred） | ✓ | ✓ | ✓ |
| executable + 公开 reasonCodes | ✓ | ✓ | ✓ |
| 预算数字：total、committed、committedAfter、headroom、shortfall | 仅当 finance 披露 total **与** priorCommitted | ✗ 永不 | ✓ |
| 变更单条款 + 任务 | ✓ | ✓ | ✓ |
| 变更单内嵌 `commitment` 快照 | 同"预算数字"规则 | ✗ | ✓ |
| 审批行（角色、决定、reasonCode、时间、valid/invalidated） | ✓ | ✓ | ✓ |
| 人工请求（问题、选项、选项里的数字） | 仅 targetRole | 仅 targetRole | 仅 targetRole |
| "Waiting on X" | ✓ | ✓ | ✓ |
| 代理回合：状态、角色 | ✓（全员看进度） | ✓ | ✓ |
| 代理回合：rationale、clarify 原文、用量 | 仅本角色 | 仅本角色 | 仅本角色 |

**provider 视图陷阱**：provider 已知自己的报价 $900，若看到 "$4,900 committed after approval" 就能反推已承诺 $4,000。所以 provider 的 DTO 中没有任何 committed* 字段，阻断只显示 "+$900 · Blocked: exceeds the finance limit"。provider 能由此推断"超预算"——可接受的最小披露，写入产品文案。

## 5. 动作 × 角色矩阵

| 动作（函数） | customer | provider | finance | 非成员 |
| --- | --- | --- | --- | --- |
| 读房间 `rooms.view` / `rooms.timeline` | ✓（投影） | ✓（投影） | ✓（投影） | null |
| 确认自己的简报 `briefs.confirm` | 自己 | 自己 | 自己 | ✗ |
| 改他人简报 | ✗ | ✗ | ✗ | ✗ |
| 手动开 run `runs.start`（仅 R13） | ✓ | ✓ | ✓ | ✗ |
| 重试失败回合 `runs.retryTurn` | ✓ | ✓ | ✓ | ✗ |
| 批准/拒绝 `approvals.decide` | 若在 `requiredApproverRoles` | 同 | 同 | ✗ |
| 回答请求 `requests.answer` | 若是 targetRole | 同 | 同 | ✗ |
| 标记任务完成 `tasks.setDone` | ✗ | 若 `assigneeRole = provider` | ✗ | ✗ |
| 补发邀请 `seats.reissueInvite` | 创建者 | 创建者 | 创建者 | ✗ |
| seed / reset / 用量统计 | CLI internal | CLI internal | CLI internal | CLI internal |

## 6. 代理上下文组装（单一入口）

- `internal.agents.getTurnContext({turnId})`（internalQuery）是**唯一**读取简报给模型的路径；role 从 turn 行读取，不从参数读。
- 返回显式白名单对象，每个字段逐个构造，**禁止 spread 文档**；禁止按 roomId `collect()` 整表后在 JS 里过滤给模型（代码审查清单 + 16 号 canary 测试）。
- provider 上下文包含：自己的 brief、customer 已披露给 provider 的字段、公开目录、本 run 公开历史、provider 视角候选组合。不含任何 finance 字段与 committed 数字。
- customer 上下文包含：自己的 brief、目录、finance 披露给 customer 的字段（若有）、被评估提案、customer 可见的校验结论。
- finance 上下文包含：自己的 brief、目录、customer 披露给 finance 的字段、被评估提案与完整预算数字。

## 7. 对他方可见文本的生成

唯一方式：`renderPublic(templateKey, structuredData, viewerRole)`（05 §6）。模型自由文本（rationale、clarify 问题）只存 `agentTurns`，只经 `turns` 投影给本角色。人的拒绝只有 reasonCode，没有自由文本备注（v1 不提供，避免第二个泄露面）。

## 8. 时间线可见性（无 events 表）

`rooms.timeline({roomId})` 在服务端合并：席位认领、简报版本（他方只见 role/version/changeCode）、run 起止、回合（他方只见角色与状态）、提案、审批、请求（他方只见 "waiting on"）、变更单。每一项经同一投影后按 `_creationTime` 排序，`take(200)`。私密细节因为本来就在按角色控制的表里，不存在"私有事件"概念。

## 9. 日志与错误纪律

- action 内不 `console.log` prompt、简报、模型原文；只记 `turnId`、`attempt`、`stopReason`、token 数、`latencyMs`、`errorCode`。
- 面向客户端的错误只用 `ConvexError({ code })`，消息不带任何数值；生产部署隐藏非 ConvexError 消息（兜底）。
- 15 号的例行检查：在 Convex 日志中搜索 canary 与预算数字，必须零命中。

## 10. 威胁模型

| 威胁 | 对策 | 测试 |
| --- | --- | --- |
| 越权读他方简报/预算（含 WebSocket 负载） | 投影 + `returns` validator；不存在"整份状态"query | 16：以 provider 身份调所有 query，JSON 中无 finance canary/预算值 |
| 知道 roomId 自选角色、一人多角 | 只能凭邀请令牌认领；`by_room_user` 唯一 | 16：负面鉴权 |
| 代理泄露自己委托人的私密值 | 模型文本不对他方展示；公开内容只走模板 | 16：canary 扫描所有他方可见记录 |
| 跨代理 prompt injection | 他方 rationale 不进任何上下文；他方内容只以结构化字段进入 | 16：注入用例 |
| 金额/日期伪造 | 模型输出无金额/日期字段；`computeTerms` + 执行前重算 | 16：编造 itemKey 被拒 |
| 迟到结果覆盖新状态 | GT 守卫 | 16：回合中改约束 |
| 重复/并发执行 | GA + `by_proposal` 先查后写 + OCC | 16：真实部署并发脚本 |
| 费用滥用 | 仅成员触发；每 run ≤ 27 次尝试；每房间 ≤ 20 个 run；`AGENTS_ENABLED`；供应商控制台花费上限 | 16：上限用例 |
| 配置半残（fail-open） | auth config fail-closed；`isClerkConfigured()` 格式校验；Convex 侧 identity 为 null 一律拒绝 | 15/16 冒烟 |
| 模型供应商数据保留 | 只发送本方简报与已披露字段；数据保留政策待用户确认（GAP-23，18 号 Q） | — |
