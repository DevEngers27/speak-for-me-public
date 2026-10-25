# 02 审查设计发现 · part11：11 架构、12 API、13 前端

> 分片清单见 part1。

## 11 架构

### F11.1 模块分层与依赖方向（审查给出的切分）
- 纯模块（只依赖 zod / SDK，可脱离 Convex 单测）：`convex/lib/contract.ts`（校验器与类型）、`validate.ts`（规则）、`budget.ts`（getCommitted、checkBudget）、`state.ts`（迁移表）、`negotiate.ts`（buildAgentPrompt、callModel、输出 schema）。
- Convex 函数层只做鉴权、读写、调度，调用纯模块；`buildAgentContext` 由后端提供，代理代码只调用不自行查表。
- 场景数据（目录、fixture）是可被 Next、Convex 与测试共同 import 的 TS 模块。
- 来源：P11 第 4–5 点、security-09、architecture-09/-24。

### F11.2 Convex 工程约束
- `_generated` 随函数变更重新生成；缺 `convex/tsconfig.json` 时 CLI 会跳过 Convex 函数类型检查（用 `npx convex codegen --init` 生成）；原 `convex/health.ts` 用 `queryGeneric` 绕过了生成类型，重建时统一用 `_generated/server`。
- 无凭据环境（如 CI）无法运行 codegen（`convex codegen --dry-run` 报 "No CONVEX_DEPLOYMENT set"），所以生成文件要入库或在有凭据的步骤里生成。
- `convex/` 内不用 `@/` 别名（F03.15）。
- 来源：architecture-25、code-24、P6 第 5 点。

### F11.3 认证配置与"是否已配置"的判断
- 保留 fail-closed：auth config 缺 `CLERK_JWT_ISSUER_DOMAIN` 时拒绝（Convex 服务端对引用未设变量的 auth config 本身也会拒绝推送）；issuer 用项目级默认环境变量（`npx convex env default set`）在任何人首次 `convex dev` 之前设好，已存在的 deployment 用 `npx convex env set` 补。
- 抽出一个不含 server-only 的 `isClerkConfigured()`，供 proxy 与配置模块共用，内含格式校验：pk_/sk_ 前缀且同为 test 或同为 live；Convex URL 为 https 且以 `.convex.cloud` 结尾或是 localhost，拒绝 `.convex.site`；不合格视为未配置。审计员复测：格式错误的 `pk_test_notarealkey` 会让 `/` 和 `/setup` 都返回 500。
- 托管环境设 `REQUIRE_AUTH=1` 时缺 key 返回 503（不依赖平台特定变量）；私有路由段在服务端做门槛并显示 "Backend not configured. See /setup."。
- 条件挂载 Provider 的半配置状态下 `useQuery` 会抛错：依赖 Convex 的组件只在 Provider 存在时渲染。
- 来源：code-15（被推翻条目的处理）、P6 第 2 点、L2（security-23、code-18、code-16、code-13）、architecture-19。

### F11.4 环境拓扑
- 每人一个开发 deployment，数据与环境变量互不共享；另设一个共享的集成/生产 deployment，只从主分支部署，任何人不对它运行 `convex dev`（watch 会把本地保存推上去）。
- `ANTHROPIC_API_KEY` 只配在需要真实调用的 deployment，其余用 stub；dev 与 prod 用不同 key 与花费上限。
- Clerk 开发实例与生产实例的 issuer 不同，用户 ID 不同，seed 要按环境分别取账号 ID。生产 Clerk 实例是否必须绑定自有域名：待验证（product-18、architecture-16、docs-11、code-19 均为 uncertain）。
- 来源：code-03、docs-07、architecture-16、P6、M8。

### F11.5 Next 侧
- `next-env.d.ts` 应忽略而不入库，typecheck 用 `next typegen && tsc --noEmit`；`force-dynamic` 下 `next build` 不渲染页面，构建通过不代表页面能渲染，需要运行时冒烟。
- 来源：code-22、code-12（L4）。

## 12 API（审查中出现过的函数，需在 12 中补全参数、返回、鉴权、幂等性）

| 函数 | 类型 | 审查要点 |
| --- | --- | --- |
| `rooms.listMine` | query | requireMember 风格，未认证返回 null |
| `rooms.view({roomId})` | query | 按角色投影的 DTO，声明 returns，finance 专属字段 v.optional，内部调用 validateProposal 实时算 executable |
| `briefs.mine` / `turns.mine` | query | 只返回本人 / 本角色数据 |
| `createRoom` | mutation | 同时生成三个角色的邀请码；限定可创建者 |
| `acceptInvite({code})` | mutation | 先查后插，角色由邀请决定 |
| `confirmBrief` | mutation | 写已确认版本，调用 bumpConstraints |
| `updateBudget({roomId, newTotalCents, reason})` | mutation | 步骤见 F09.2 |
| 审批（如 `decide({proposalId, decision})`） | mutation | upsert 审批 + 集合判定 + 同事务执行，见 F08.4 |
| `answerRequest({requestId, answerKey})` | mutation | requireRole(targetRole)；改硬约束则 bump 并开新 run |
| `startRun` / `requestNextTurn({roomId})` / `retryTurn` | mutation | 幂等；只收 roomId；只能请求轮到的回合 |
| `agents.runTurn` | internal action | try/catch → completeTurn / failTurn |
| `completeTurn` / `failTurn` / `turnWatchdog` | internal mutation | 回合守卫、原子调度下一回合 |
| `buildAgentContext` / `briefs.getForAgent` | internal query | 显式白名单 |
| `seed.demoRoom` / `resetDemoRoom` | internal mutation | 只经 CLI 调用，见 15 |
| 指标聚合 | internal query | 调用次数、失败次数、平均与分位延迟、token |
| `health.viewer` | query | 未认证返回 null，返回 tokenIdentifier（便于 seed 取账号 ID） |

- 通用约定：业务函数不接受 userId/role；公共函数以 getViewer/requireMember 开头；错误用 `ConvexError({code})`。
- 来源：M9、architecture-19、P5、P9、P14、P15、P19、M2、security-20。

## 13 前端

### F13.1 角色工作台与阻断展示
- 所有窗口订阅同一个聚合 query，预算一提交即同一刻翻转为 blocked，不等模型。买方与 provider 两套文案见 F07.1。
- 每个代理显示回合状态（drafting / failed）；failed 显示 "Retry turn"；人工请求显示可点选的选项（"Choose this option" 或请求卡片）；审批按钮按 kind 区分 "Accept terms" / "Approve budget commitment"；旧审批显示为 invalidated 并保留。
- 检查项文案如实："Checked against constraints v{n}"，不要写 "Matches current constraints"。
- 来源：architecture-02/-17、P7 第 2 点、P14、P19、product-21、gap1-07。

### F13.2 表单
- 结构化简报表单：itemKey 勾选、价格只读、deadline、deferrable、共享范围逐项勾选并标注 "visible to other parties"；提交即确认。
- finance 的 "Update budget cap" 表单带 reason；美元输入换算为整数美分。
- 抽取（可选）只预填草稿，用户检查后提交。
- 来源：M6、security-16、P5 第 7 点、M9。

### F13.3 标注与诚实
- 模拟数据显示 "Simulated quote" 等标签；预跑或存档回放标注来源；stub 回合标注 simulated。
- 真实身份模式下不做"单浏览器角色切换器"（违反 README.md:306）；Clerk 默认单会话，同一浏览器 profile 登第二个账号会顶掉前一个（多会话需在 dashboard 开启）。
- 来源：security-20、P12、P2 第 4 点。

### F13.4 诊断与错误
- `/setup` 诊断：`useConvexAuth()` 显示 isAuthenticated；`useQuery(health.viewer)`（未认证时 'skip'）显示 "Convex accepted Clerk token" 或 "check CLERK_JWT_ISSUER_DOMAIN"；顺带显示从 publishable key 解码出的 Frontend API 主机名（最常见故障是 key 与 issuer 来自不同实例：登录成功、后端永远未认证）。
- `ConvexProviderWithClerk` 会吞掉 token 获取错误（`ConvexProviderWithClerk.js:38-39`），所以需要上述可见诊断；加客户端 `error.tsx`（带重试）。
- 来源：code-14、docs-18（M2）。
