# 07 权限与隐私（part1）：认证与授权、角色授予、字段×角色披露矩阵

> 分片：part1 本页；part2 动作×角色矩阵、代理上下文组装、委托条款、对他方可见文本、事件可见性；part3 日志与错误纪律、威胁模型、数据保留。

## 7.1 认证 ≠ 授权

| 层 | 做什么 | 不做什么 |
| --- | --- | --- |
| Clerk（浏览器 + Next） | 登录、会话、取 Convex token（`ConvexProviderWithClerk`） | 不表达房间角色；不用 Clerk Organizations（inputs/04 §3.4） |
| Next `proxy.ts` | 对 `/rooms(.*)` 等私有路由做乐观的"必须登录"跳转（`auth.protect()`） | 不是授权（inputs/04 §3.5）；缺配置时返回 503 页面而不是放行 |
| Convex `auth.config.ts` | 校验 JWT（issuer = `CLERK_JWT_ISSUER_DOMAIN`，`applicationID: "convex"`）；缺变量时推送失败（fail-closed） | — |
| Convex 函数 | **全部授权**：从 `ctx.auth` 推导用户，查 `participants` 得到角色，按 7.4 矩阵判断 | 从不接受 userId / roleKey 参数 |

授权 helper（`convex/lib/auth.ts`）：

```ts
getViewer(ctx): Promise<Doc<"users"> | null>            // 按 tokenIdentifier 查 users；query 中未认证返回 null
requireUser(ctx): Promise<Doc<"users">>                 // mutation 用；未认证抛 ConvexError({code:"UNAUTHENTICATED"})
requireParticipant(ctx, roomId): Promise<{ user, participant, room }>   // 非参与者抛 NOT_PARTICIPANT（query 中返回 null）
requireRole(ctx, roomId, roleKey | (decl) => boolean)   // 角色不符抛 FORBIDDEN_ROLE
```

约定：query 对未认证或非参与者返回 `null`（前端显示登录或"无权访问"），mutation 抛 `ConvexError`。被调度的 internal 函数不依赖调用者身份，只接收 id；授权检查全部落在调度它们的 public mutation 里（inputs/04 §1.7）。

## 7.2 成员与角色授予

- **谁能创建房间**：环境变量 `ROOM_CREATION_POLICY = "allowlist" | "any_signed_in"`。生产默认 allowlist（`ROOM_CREATOR_TOKEN_IDENTIFIERS`，逗号分隔），因为每个房间都可能触发付费模型调用（T-06）；开发与预发布可设为 any_signed_in。
- **创建者**选择自己在房间里的角色（任意一个场景角色），并为其余角色各生成一个邀请链接。创建者身份本身不带来任何额外的审批权或数据可见权；它只多三项管理动作：邀请 / 撤销邀请 / 关闭房间（F07.4）。
- **邀请**：明文令牌只在 `invites.create` 返回时出现一次（链接形如 `/join/<token>`），库里只存哈希；7 天过期；单次使用；接受时校验角色仍空缺、本人在房间里尚无角色（T-02、T-09）。
- **跨组织成员**：provider 通常来自另一家公司（V-02、GAP-17）。邀请链接对任何持有它的已登录用户有效，因此链接的传递渠道是安全边界：界面提示"只把链接发给对应的人"，并在 open 状态下显示邀请对象的角色与过期时间，创建者可随时撤销重发。
- **v1 不支持**移除参与者、更换角色、一个角色多人（Q13）。这些都会改变必需审批人集合，将来实现时必须走约束变化流程（RA-R05）。

## 7.3 字段×角色披露矩阵

图例：✔ 可见；— 不可见；"受众"表示由数据所有者在简报中逐字段选择（括号内为默认）。**每个角色的代理上下文 ⊆ 该角色的人能看到的内容**（再加上本角色自己的私密简报），代理不会比它服务的人知道得更多。

| 数据 | customer | provider | finance | 说明 |
| --- | --- | --- | --- | --- |
| 房间标题、目标、时区、场景、版本号 | ✔ | ✔ | ✔ | 共享事实 |
| 参与者显示名与角色；他方简报的版本号与确认时间（`briefStatuses`） | ✔ | ✔ | ✔ | 不含简报内容（RA-U09） |
| 邀请（令牌、过期、状态） | 创建者 | 创建者 | 创建者 | 明文令牌只出现一次 |
| customer `requestedItems`（键与标题） | ✔ | ✔ | ✔ | 披露固定为 room：provider 要据此报价 |
| customer `requiredItemKeys` | ✔ | 受众（room） | 受众（room） | 硬约束 |
| customer `importantItemKeys`、`preferredDate` | ✔ | 受众（private） | 受众（private） | 软偏好 |
| customer `deadline` | ✔ | 受众（private） | 受众（private） | 硬约束；未披露时他方只看到"与 customer 约束冲突" |
| provider `preferredDeliveryMode` | 受众（private） | ✔ | 受众（private） | 软偏好 |
| finance `budgetCapCents` 及全部预算数字（已承诺、执行前后、余量、超出额、基线） | 受众（customer） | **—**（不可选） | ✔ | 预算数字作为一组跟随 cap 的受众；场景声明 provider 不在允许受众内（F07.1，ADR-11） |
| 各方 `privateNotes`、`changeNote` | 本人 | 本人 | 本人 | 只进本方代理上下文 |
| 目录条目（标题、价格、交付日期、加急费） | ✔ | ✔ | ✔ | 确认即披露（ADR-20） |
| 候选集合（条款、金额、日期） | ✔ | ✔ | ✔ | 由公开目录 + 可行性推出；可行性本身是 T-08 所述的最小披露 |
| 提案条款、版本、作者类型、是否可执行 | ✔ | ✔ | ✔ | 金额是目录价格之和 |
| 提案被阻断的原因 | 按 `paramAudience` | 按 `paramAudience` | 按 `paramAudience` | 例：provider 看到 "exceeds the finance limit"，买方看到 "over by $100" |
| 审批决定（谁、何时、approve / reject / withdraw、理由码、对哪个约束版本） | ✔ | ✔ | ✔ | 审批事实对房间公开（DM-05） |
| 拒绝备注 `reasonNote` | 按本人选择 | 按本人选择 | 按本人选择 | private 或 room |
| 回合公开结果（动作、候选、理由码） | ✔ | ✔ | ✔ | 模板渲染 |
| 回合私密理由 `privateRationale`、attempt 的模型输出 | 本角色 | 本角色 | 本角色 | 从不进入他方代理上下文 |
| attempt 运行元数据（状态、耗时、token、重试原因） | ✔ | ✔ | ✔ | 不含内容；支撑"进度与故障可见" |
| 人工请求 | 目标角色全文；他人摘要 | 同左 | 同左 | 摘要只含目标角色、类型、状态 |
| 变更单条款与变更金额 | ✔ | ✔ | ✔ | — |
| 变更单的执行前后已承诺额与上限快照 | 受众（customer） | — | ✔ | 跟随预算受众 |
| 任务 | ✔ | ✔ | ✔ | 只有被指派角色能改状态 |
| 用量汇总（调用数、token、估算成本） | ✔ | ✔ | ✔ | 平台成本，不属于任何一方的私密信息 |

实现：每个返回房间数据的 query 都经过同一组投影函数（`convex/lib/projection.ts`）：`projectBriefFor(viewerRole, briefVersion)`、`budgetViewFor(viewerRole, ruleInput)`、`renderChecksFor(viewerRole, checks, ruleInput)`、`renderEventFor(viewer, event)`。`rooms.workspace` 声明 `returns` validator，买方专属字段写成 `v.optional`，只在查看者在预算受众内时填充（F03.16）；返回值校验对多余字段的拒绝行为待验证，PV-01 测试兜底。
