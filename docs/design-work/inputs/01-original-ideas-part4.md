# 01 原始想法整理（part4）

> 分片清单、行号约定与标注含义见 01-original-ideas-part1.md。

## §5 架构与服务连接草案

### 5.1 原作者的运行时图（R:172-191，转写）

```text
UI (Next.js/React, three users) --sign in--> Clerk
Clerk --session token via Clerk SDK--> UI
UI --Convex SDK + token--> Convex queries/mutations
Convex API --membership and role checks--> Convex DB (versioned state and events)
Convex DB --authorized reactive query results--> UI
Convex API --request an agent turn--> Convex scheduler + agent actions
Agent action --allowed context; server API key--> Claude API (separate context per participant)
Claude --structured proposal, not approval--> server validation (schema, sources, constraints, versions)
Validation --version-checked internal mutation--> Convex DB
UI --human approval of exact versions--> Convex API
```

文字版管线（R:268-277）：三个浏览器 → Next.js + Clerk → Convex 查询 / 操作 / 成员检查 → 共享的提案、审批、承诺、任务、事件 → 隔离的私密简报 → 调度器 → 三个代理 → 结构化输出 + 授权 + 约束检查 → 持久化 → 实时界面更新。

### 5.2 条目

| ID | 原作者的想法 | 出处 | 标注 | 评估与建议 |
| --- | --- | --- | --- | --- |
| AR-01 | 上面的整体运行时形状：Clerk 身份、Convex 授权函数与实时订阅、调度器驱动代理动作、模型输出先校验再经版本检查的内部 mutation 落库、人类审批走普通 mutation | R:172-191, R:268-277 | 保留 | 与 brief 拍板的栈一致，作为 11 的起点 |
| AR-02 | 只在服务端 Convex action 中调用模型，API 密钥在 Convex 部署环境里 | R:279, R:155, AN:3, R:200 | 保留 | 浏览器永远不接触模型密钥与私密上下文 |
| AR-03 | 一次只调度一个代理回合，持久化之后再推进 | R:279 | 保留 | 串行回合简化并发与过期判断；具体的并发控制（一个房间同时只有一个活动 run 等）交 10 |
| AR-04 | 模型调用与数据库 mutation 不是一个原子事务；持久化延迟回复时要再次检查版本 | R:211 | 保留 | 是"拒绝过期结果"的根据，落到 10 |
| AR-05 | 模型结果 → 存储：先校验输出，再由内部 mutation 复核 run / 提案 / 约束版本；畸形、不支持、未授权、过期的结果不能覆盖当前状态 | R:201 | 保留 | 核心 #4，落到 05 与 10 |
| AR-06 | 人类审批 → 执行：mutation 复核身份、成员、全部审批、预算、当前版本，一次原子提交创建结果、承诺、任务；重试不得重复 | R:202 | 保留 | 核心 #5，落到 08 |
| AR-07 | Browser ↔ Clerk：Clerk Next.js SDK + publishable key + secret；开启 Clerk 的 Convex 集成；三个人能分别登录，登出后失去访问 | R:197 | 保留 | 登出失效进入 16 验收；Clerk 7 的具体 API 名以 04 为准 |
| AR-08 | Browser ↔ Convex：ConvexReactClient 使用 NEXT_PUBLIC_CONVEX_URL，ConvexProviderWithClerk 获取 Clerk token | R:198 | 保留 | 组件与 hook 名称在 Convex 1.48 / Clerk 7 下待验证（以 04 为准） |
| AR-09 | Convex ↔ Clerk 信任：convex/auth.config.ts 使用 CLERK_JWT_ISSUER_DOMAIN 与 applicationID "convex"；未认证与跨用户私密调用必须失败 | R:199, AU:5-8 | 保留 | 配置写法待 04 确认；"跨用户调用失败"进入 16 |
| AR-10 | Convex action → Claude：SDK 使用 ANTHROPIC_API_KEY 与 ANTHROPIC_MODEL；有界超时与重试；上下文隔离；记录用量与成本 | R:200 | 保留 | 用量与成本记录是一等需求（FX-04） |
| AR-11 | 模型由单个环境变量 ANTHROPIC_MODEL 指定，"不假定任何模型或额度" | R:484, AN:7 | 重新评估 | 10 应按任务（简报抽取、协商回合、解释）定义模型与 effort，环境变量只做覆盖；模型 ID 以 04 为准 |
| AR-12 | Anthropic 客户端工厂：maxRetries 1、timeout 30_000 ms，缺配置时抛错 | AN:5-14 | 重新评估 | 具体数值交 10 按模型延迟与结构化输出长度确定；30 s 对长输出可能不够（待验证）。"缺配置即失败"保留 |
| AR-13 | TypeScript 全栈；Zod + Convex validators 校验消息形状与函数参数 | R:279, R:156 | 保留 | Zod 用于模型输出，Convex validators 用于函数参数；两者对应关系在 05/12 中定义 |
| AR-14 | 接入顺序：先确认身份并拒绝未授权的私密访问，再加入私密业务数据；先做确定性状态迁移、权限检查、版本化操作，再接 Claude；再接 UI；最后部署并跑 G1–G7 | R:213-221 | 保留 | 是好的实现顺序，进入实现计划；字母分工丢弃 |
| AR-15 | Clerk middleware 可选；所有 starter 页面公开；加受保护页面前要 auth.protect() 并在每个后端函数里检查成员 | PX:5-12, R:499 | 重新评估 | 新系统默认保护应用路由；后端仍对每个函数做成员检查（前端保护不算授权） |
| AR-16 | 本地预览无需任何凭证 | R:223, R:429, R:438 | 重新评估 | 演变为 10 的 stub 模式：无模型密钥时用确定性桩代理跑通流程，数据与界面都标注为模拟（核心 #8） |
| AR-17 | 环境变量表：NEXT_PUBLIC_CONVEX_URL、CONVEX_DEPLOYMENT、NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY、CLERK_SECRET_KEY（前端/Next 侧）；CLERK_JWT_ISSUER_DOMAIN、ANTHROPIC_API_KEY、ANTHROPIC_MODEL（Convex 侧）；CONVEX_DEPLOY_KEY 仅 CI 部署需要 | R:476-485 | 保留 | 进入 15；名称以 04 为准 |
| AR-18 | 生产环境用独立的 Clerk 与 Convex 实例；公开环境变量在前端构建时被固化，改动后要重新构建 | R:509 | 保留 | 进入 15 的环境分离 |
| AR-19 | env:check 脚本只报告缺失的配置名，不打印值；setup 页只报告配置是否存在，不测试连通性 | R:452, UI/setup:5, CF:3-7 | 重新评估 | 保留"不打印密钥值"；setup 页改为仅开发环境或管理员可见的健康页，区分已配置与可用（P-19） |
| AR-20 | 健康诊断 query：要求认证，只返回 subject | HL:4-10 | 保留 | 可作 15 的诊断端点样式：认证、零业务数据 |
| AR-21 | 固定 Node 24.19.0 与 pnpm 11.25.0；提交 lockfile | R:426-428, R:456 | 重新评估 | 版本选择交 04/15；"锁定依赖并提交 lockfile"保留 |
| AR-22 | GitHub Actions 跑无凭证的 lint、typecheck、build | R:159, R:526 | 保留 | 进入 16/15；后续加入 convex-test 等测试 |
| AR-23 | 前端托管：Vercel 只是选项，未选定 | R:160 | 重新评估 | 交 15 决定 |
| AR-24 | 演示工具：fixture 加载、只作用于指定演示数据的授权 reset、可从干净状态重复完整流程 | R:361 | 保留 | 进入 15 的 seed/reset：reset 必须鉴权、只动标记为演示/模拟的数据 |
| AR-25 | 不需要 agent 框架、向量库、第二数据库、Python 服务 | R:164 | 保留 | 同 P-21 |

### 5.3 对 11-architecture 的提示

- 原图没有"场景插件"层：报价目录、约束字段、规则、模板都隐含在通用表里。brief 要求引擎 / 场景分离，原 schema 的全局 role enum（S:4）与房间上的预算字段（S:13）都需要搬进场景插件。
- 原图把"server validation"画成单一步骤；brief 第 3 节要求的确定性校验应拆成：Zod 形状校验 → 来源核对 → 场景规则（预算、必需范围、日期）→ 版本与状态守卫，每步产出 reasonCode（交 06）。
