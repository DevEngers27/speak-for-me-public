# 07 · 权限、隐私与威胁模型（part2：信任边界、资产、攻击者）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.2 信任边界

```text
 [浏览器 customer / provider / finance]   不可信：任意参数、任意时序、重放、并发
   │  Clerk 会话 → Convex JWT（aud = "convex"）           B1 ↓   ↑ B2
 [Next 服务端：proxy.ts、Server Component、preloadQuery]   半可信：只转发，不读受限表
   │  preloadQuery / fetchQuery 走 ConvexHttpClient，结果以 _valueJSON 进 RSC 负载（进浏览器）
 ┌─────────────── Convex 部署（唯一可信计算边界）────────────────┐
 │ 公开函数：构造器（身份 → users → members → 角色 → 守卫）→ 投影 DTO │
 │ internal 函数：只被调度器 / 其他函数 / CLI 调用，参数含 actorUserId │
 │ 受限读函数：loadRuleInput（全量规则输入）只在服务端内存中使用    │
 │ agents.runAttempt：只拿 buildAgentContext 的结果                 │
 └───────────────┬──────────────────────────────────────────────┘
                 │ B3：只发送本角色视图 + 本角色候选快照
                 ▼
 [Claude API]   半可信：会遵循 / 误读注入；输出只当不可信数据      B4 ↑
```

| 边界 | 进来的东西 | 规则 |
| --- | --- | --- |
| B1 浏览器 → Convex | 函数参数、令牌、重复 / 并发调用 | 身份只取 `ctx.auth`；参数里没有身份字段；所有前置条件在 mutation 内重读判定；页面展示过的版本作为 `expected*` 传入比对 |
| B2 Convex → 浏览器 | query 返回值、`ConvexError.data`、`logLines`、`errorMessage`、预取 `_valueJSON`、WebSocket `TransitionChunk` | 只返回按查看者投影后的 DTO；错误只带 `code` 与调用者有权看到的 params；公共函数内无日志输出 |
| B2' Next 服务端 → 浏览器 | SSR HTML、RSC 负载 | Next 层只调用与客户端相同的投影 query，不另开宽松 query，不直接读表 |
| B3 Convex → 模型 | prompt | 只含本方简报、对本角色可见的 `sharedFacts`、公开房间数据、本角色候选快照；目录 title 在 `<untrusted_data>` 块内 |
| B4 模型 → Convex | 结构化输出 | 只接受快照内的 `optionKey`、小整数提案 `version`、场景枚举 `topicKey` / `reasonKey` / `toRole` 与只回给本方的 `rationale`；金额、日期、条目键一概不从模型读取 |

## 7.3 资产

| 资产 | 所有者 | 泄露 / 篡改后果 |
| --- | --- | --- |
| A1 私密硬约束：finance `capCents`、基线已承诺（`ledgerEntries.baseline`）、customer `requiredItemKeys` / `deadline` | 各参与方 | 谈判地位受损；违反核心 1 |
| A2 私密软信息：偏好（`preferredItemKeys` 等）、`softFields.notes`、`approvals.note` | 各参与方 | 同上，且常含第三方信息 |
| A3 代理输出：`rationale`、动作、`reasonKey`、`topicKey`、候选快照 | 被服务方 | 等同 A1 / A2 的转述或函数 |
| A4 派生值：`committedCents`、`headroomCents`、`overByCents`、`shortfallCents`、规则结论、可行集、人工请求选项 | 输入中最严格者 | 反推 A1 |
| A5 审批与执行记录 | 房间 | 伪造或重复承诺（核心 3、5） |
| A6 约束与提案历史 | 房间 | 无法追溯（核心 6） |
| A7 模型调用额度与美元预算 | 运营方 | 成本失控 |
| A8 邀请 token、`users.tokenIdentifier`、邮箱 | 被邀请人 / 用户 | 角色冒充、身份关联 |

## 7.4 攻击者模型

| 编号 | 攻击者 | 能力 | 不在范围 |
| --- | --- | --- | --- |
| AT1 | 房间内的另一方（最主要） | 合法登录与席位；可调用任何公开函数；可改自己的数据（目录、简报、披露）；撰写会进入他人视图的文本（目录 title、显示名、房间标题）；反复提案、改价、请求重谈以探测 | — |
| AT2 | 已登录的非成员 | 知道或猜到 `roomId`；截获邀请链接 | — |
| AT3 | 未登录者 | 直接调用 Convex 公共函数、Next 路由 | — |
| AT4 | 被注入或判断失误的模型 | 输出任意字符串、违反 schema、复述上下文、在合法选项中有偏选择 | 模型提供方本身恶意（残余风险 R-5） |
| AT5 | 本方用户误操作 | 双击、在旧页面上点批准、粘贴含指令的文本 | — |
| AT6 | 运维失误 | 缺配置、日志打印、对生产跑 seed、`console.log` 调试 | 拥有 Convex 控制台权限的内部人员（靠组织访问控制，15 章） |
| AT7 | 本方用户故意把**他方已披露给自己**的值转述给第三方 | 带外传递 | 系统外行为；系统只保证本方代理与系统写路径不能搬运（§7.15 LP-3） |
