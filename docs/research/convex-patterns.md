# Convex 生产模式调研（convex-patterns）

> 研究代理产出。访问日期均为 2026-10-24。网页内容按数据处理。
> 与 inputs/04-platform-constraints（下称"04"）的关系：04 主要读自本地已安装源码；本文用官方在线文档、stack.convex.dev 与官方组件仓库**补证或修正** 04 中的结论与"待验证"项。冲突处已在条目中标出。
> 可信度标记：**高** = 官方文档原文明确写出；**中** = 官方文档有但措辞含糊、或两页之间有出入；**低** = 推论或仅社区来源。

## 0. 概述

一句话：Convex 给了我们"可串行化的 mutation 事务 + 与 mutation 原子绑定的调度 + exactly-once 的被调度 mutation"，但**没有唯一约束、action 不重试且超时无回调、身份不随调度传播、query 返回值全部到达浏览器**。所以 Speak for Me 的五条核心（私密委托、人批准具体版本、代码校验、幂等原子执行、历史不可篡改）都必须落在"单一写入口 mutation + 索引查重 + 状态/版本守卫 + 服务端字段裁剪"上；组件（workpool / action-retrier / rate-limiter / workflow）只能减少样板代码，不能替代这些守卫。

在线文档对 04 的主要修正与补证：
1. action 超时：limits 页写 **Convex 运行时 30 分钟、Node 运行时（"use node"）10 分钟**；actions 页仍写"10 minutes"。按保守值 10 分钟设计（见 F4）。
2. 调度限额：单函数最多调度 **1000** 个函数；limits 页写每个参数 4 MiB、每 mutation 合计 16 MiB，scheduled-functions 页写合计 8 MB（见 F2，取 8 MB）。
3. 身份**不会**传播到被调度函数（官方原文，04 标为待验证）。
4. 被调度函数结果保留 **7 天**；action-retrier 已完成记录也是 7 天后自动清理。
5. 生产环境非 `ConvexError` 的错误信息被**脱敏**为函数名 + "Server Error"；`ConvexError.data` 会原样到达客户端（隐私含义见 F10）。
6. 环境变量可在 `convex.config.ts` 的 `defineApp({ env })` 中声明，生成类型化 `env`（1.39.0 引入），声明不等于赋值。
7. Clerk 侧当前推荐"在 Clerk Dashboard 激活 Convex integration"（`aud` 已预映射为 `convex`），无需手建 JWT template；Convex 文档变量名是 `CLERK_JWT_ISSUER_DOMAIN`，Clerk 文档是 `CLERK_FRONTEND_API_URL`——仅命名不同。
8. convex-test 官方页列出的局限：不强制大小/时间限额、不跑 cron、Edge Runtime 模拟与真实运行时有差异；**未提及并发/OCC 模拟**（仍按 04 的判断：不能依赖它测并发）。

---

## 1. 逐项发现

### F1 唯一性与幂等 mutation

**结论**：Convex 没有唯一索引；唯一性与幂等只能靠"单一写入口 mutation 内按索引先查后写"。OCC 提供可串行化（serializability），冲突事务由 Convex 自动重跑，重跑时会看到先提交者的写入，因此"查空→插入"在可串行化下是安全的。客户端重连会重发同一次在途 mutation 并由后端去重，但**用户连点是两次独立调用**，业务层仍需幂等键。

**证据**：
- OCC 页："treating the transaction as a declarative proposal to write records on the basis of any read record versions"；冲突时 "We can run several retries if necessary until we succeed…"；并声明提供 true serializability 而非仅 snapshot isolation。https://docs.convex.dev/database/advanced/occ
- 最佳实践页：公开函数必须有参数校验与访问控制；"don't use a function argument which could be spoofed (e.g. email) for access control checks"。https://docs.convex.dev/understanding/best-practices
- 04 §1.6（本地源码）：`IndexOptions` 无 unique；`.unique()` 只是读取断言。

**可信度**：高（serializability 与自动重试）；中（"索引区间读入读集"在线文档 OCC 页没有明说，是 serializability 承诺的必然推论）。

**推荐模式（本系统采用）**：
1. 每条唯一性不变量 = 一个覆盖该键的索引 + 一个唯一写入口 `internalMutation` 或公开 mutation + 代码审查/ESLint 禁止旁路写入。
2. 幂等键写进被保护的那张表本身（例如 `executions.executionKey`、`approvals` 的 `(proposalVersionId, participantId)`），而不是单独的"幂等表"，这样"查重"与"插入"天然在同一读写集。
3. 重复调用返回**已存在的结果**（`{ status: "already_executed", executionId }`），而不是抛错——让 UI 连点与客户端重发都表现为成功。
4. 热点文档（例如每次都 patch `rooms.updatedAt`、计数器）会放大冲突与重试延迟；用"追加事件行"替代"改同一行计数器"。

### F2 Scheduler：保证、原子性与限额

**结论**：
- 被调度的 mutation **exactly once**，Convex 自动重试内部错误，开发者错误不重试；被调度的 action **at most once**，遇瞬时错误永久失败。
- 在 mutation 内调度与该 mutation **原子**：mutation 失败则什么都不调度。在 action 内调度**不随 action 结果撤销**。
- `cancel`：未开始则不运行；已开始则继续跑完，但它新调度的函数不运行。
- 状态在系统表 `_scheduled_functions`（`name`、`args`、`scheduledTime`、`completedTime`、`state ∈ pending / inProgress(仅 action) / success / failed / canceled`），**结果保留 7 天**。
- **身份不传播**："The auth is not propagated from the scheduling to the scheduled function."
- 限额：单个函数最多调度 1000 个，参数合计 8 MB（scheduled-functions 页）；limits 页另写单个参数 4 MiB、每 mutation 16 MiB、未完成调度总数 1,000,000；并发运行的 scheduled jobs 按部署规格 8（S16）/ 256（S256）/ 512 / 1024。

**证据**：https://docs.convex.dev/scheduling/scheduled-functions ；https://docs.convex.dev/production/state/limits

**可信度**：高；合计参数上限两页有出入（8 MB vs 16 MiB）→ 中，设计按 8 MB。

**官方建议的手工重试**：action 失败后 "Developers can retry those manually by scheduling a mutation that checks" 目标是否已达成，未达成再调度 action。这正是"watchdog mutation"模式。

### F3 Cron

**结论**：`crons.interval / cron / hourly / daily / weekly / monthly`，时间一律 UTC；**同一 cron 任一时刻至多一个运行实例**，运行过久时后续运行**可能被跳过**（记录在日志）；失败语义与被调度函数相同（mutation exactly-once、action at-most-once）；cron 定义只在部署时求值（依赖环境变量的 cron 改变量后要重新部署）。文档建议避开整点（有 `@convex-dev/no-top-of-hour-crons` lint 规则）。

**证据**：https://docs.convex.dev/scheduling/cron-jobs ；https://docs.convex.dev/production/environment-variables

**可信度**：高；"dev 部署是否运行 cron"文档未写 → 未知（经验上 dev 部署也运行，待验证）。

### F4 Action：超时、内存、重试与调用纪律

**结论**：
- 超时：limits 页 "Convex runtime action timeout: 30 minutes / Node runtime: 10 minutes"；actions 页 "Actions time out after 10 minutes"。**按 10 分钟设计**，Claude 调用的 SDK `timeout` 应显著小于此值（例如 ≤ 5 分钟，且 `maxRetries` 在 SDK 层设 0 或 1，重试交给我们自己的 attempt 机制）。
- 内存：Convex 运行时 64 MB，Node 512 MB。并发 I/O 每函数 1000。
- Convex **不重试 action**："it is the responsibility of the caller to handle errors raised by actions"。
- 客户端直接调用 action 是**反模式**：应由 mutation 记录意图并调度 action，"which also lets it enforce invariants such as preventing duplicate execution"。
- 必须 await 所有 promise；悬挂的 promise "might or might not complete"，Node 环境可能复用导致后续调用出错。
- action 内多次顺序 `runQuery/runMutation` 是多个事务，可能不一致；应合并为一个 internal query / mutation。
- `runAction` 只用于跨运行时。

**证据**：https://docs.convex.dev/functions/actions ；https://docs.convex.dev/production/state/limits ；https://docs.convex.dev/understanding/best-practices

**可信度**：高；超时数值两页不一致 → 中。

### F5 官方组件：workpool / action-retrier / workflow / rate-limiter

**共同限制（组件作者文档）**：
- 组件内 **`ctx.auth` 不可用**："Within a component, `ctx.auth` is not available."——应用层鉴权后把 `userId` 等作为参数传入。
- 组件与应用的环境变量隔离（只有 `CONVEX_CLOUD_URL`、`CONVEX_SITE_URL` 共享）。
- 跨边界的 `Id<"t">` 变成普通 string，不能在组件内对应用表写 `v.id(...)`。
- 一个 query 跨应用与组件只能有一次分页调用。
- 事务：顶层 mutation 中调用组件 mutation 的写入与顶层**一起提交**；组件 mutation 抛错时只回滚它自己的写入，调用方 catch 后可继续提交。

证据：https://docs.convex.dev/components/authoring ；https://docs.convex.dev/components/using 。可信度：高。

**workpool**（https://github.com/get-convex/workpool ；README 0.4.14 https://cdn.jsdelivr.net/npm/@convex-dev/workpool@0.4.14/README.md ）
- 能力：按池限制并发 `maxParallelism`（可运行时 `config.update`，设 0 暂停）；action 重试（`initialBackoffMs * base^(n-1)` + 抖动，`retryActionsByDefault` 默认关）；`NonRetryableError` 立即终止重试；`enqueueActionBatch`；`runAt/runAfter`。
- `onComplete`："It will always be called, whether the work was successful, failed, or was canceled."；**在另一个事务中运行**；被重试的中间失败不触发回调；可带 `context`。README **没有写"exactly once"**。
- `cancel` "will avoid starting or retrying, but will not stop in-progress work"；在途尝试成功仍记为 success。
- 完成后不保留元数据（`status` 返回 `{ kind: "finished" }`）——**结果必须由 onComplete 写进我们自己的表**。
- 并发建议："Avoid exceeding 100 on Pro, 20 on the free plan, across all workpools and workflows."
- 官方幂等示例：支付 action 发送一致的交易 ID，使重试成为 no-op；非幂等 action 设 `retry: false`。
- **README 未说明如何发现超时/丢失的 action**（04 已标待验证，仍未解决）。
- 可信度：高（列出的行为）；超时检测：未知。

**action-retrier**（https://github.com/get-convex/action-retrier ；https://stack.convex.dev/retry-actions ）
- 默认 `initialBackoffMs: 250`、`base: 2`、`maxFailures: 4`；`run` 返回 runId；`onComplete` "is guaranteed to eventually run exactly once"；`cancel` best effort；完成记录 7 天后自动清理或 `cleanup`。
- 失败检测机制（stack 文章）：一个 mutation 调度 action、记下 job id，再从 `_scheduled_functions` 读 `state.kind` 判断；状态轮询以 10ms 起指数退避。由于平台会把超时的 action 标为 failed，这一机制**间接覆盖超时**（推论，可信度中）。
- 与 workpool 重试能力重叠，无并发上限。

**workflow**（https://github.com/get-convex/workflow ）
- 步骤 `step.runQuery/runMutation/runAction/runWorkflow`、`step.sleep`、`step.awaitEvent` + `sendEvent`、`Promise.all` 并行、`{ inline: true }` 共享工作流事务；"By default there are no retries on actions"。
- "the overall workflow is guaranteed to run to completion, with exactly-once execution of an `onComplete` handler"。
- 确定性要求：`fetch`、env、`crypto` 只能放在步骤里；`Date` 被打补丁、`Math.random` 用按工作流播种的 PRNG。
- 限额：步骤输入输出合计 1 MB / 次执行；日志 8 MiB。
- **步骤增删、重排或改名都会让在途工作流以 determinism violation 失败**；完成的工作流不会自动清理。
- 可信度：高。

**rate-limiter**（https://github.com/get-convex/rate-limiter ）
- token bucket / fixed window；`limit(ctx, name, { key, count, throws, reserve })`、`check`、`reset`；"Transactional evaluation: all rate limit changes will roll back if your mutation fails."；"Fails closed, not open"。
- `count` 可按 token 数消费；`reserve` 返回 `retryAfter`，可与 `scheduler.runAfter` 配合排队。
- 异步模式（`applyUpdates: "asynchronously"`）最终一致、可能超发且不能分片；需要精确上限用同步 + 分片。同步模式高争用下会 OCC 重试，增加延迟。
- React hook `useRateLimit` + `hookAPI` 可在 UI 显示"还需等待多久"。
- 可信度：高。

### F6 Clerk 集成与服务端身份

**结论**：
- 当前推荐路径：在 Clerk Dashboard **激活 Convex integration**，`aud` 已预映射；`auth.config.ts` 用 `{ domain: <Clerk Frontend API URL>, applicationID: "convex" }`；改动后需 `npx convex dev/deploy` 同步。变量名：Convex 文档 `CLERK_JWT_ISSUER_DOMAIN`，Clerk 文档 `CLERK_FRONTEND_API_URL`（任选其一，全篇统一）。
- dev 与 prod 是两个 Clerk 实例：dev 域 `https://verb-noun-00.clerk.accounts.dev`、`pk_test_`；prod 域 `https://clerk.<domain>.com`、`pk_live_`。每个 Convex 部署单独设置该变量（`npx convex env --prod set …`）。
- Next.js App Router：`ConvexProviderWithClerk` 必须在 Client Component 包装器中，且 `<ClerkProvider>` 包在外层。
- UI 判断登录态用 `useConvexAuth()` / `<Authenticated>`，**不要用 Clerk 的 `useAuth()`**——前者确认 token 已被 Convex 校验；需要登录的 query 放在 `<Authenticated>` 之下。
- `fva` claim 被排除出 Convex identity（避免每次 token 刷新都重跑查询）；需要 step-up 时用 Clerk reverification。
- 服务端（Server Component / Server Action / Route Handler）：`fetchQuery / fetchMutation / fetchAction / preloadQuery` 的第三个参数传 `{ token }`；Clerk 示例 `(await (await auth()).getToken()) ?? undefined`（无 template 参数）。这些调用使用无状态 `ConvexHTTPClient`，**多次调用之间不保证同一快照**，官方建议同页避免多个 `preloadQuery`。
- `getUserIdentity()` 保证有 `tokenIdentifier`、`subject`、`issuer`（在线文档写三者都保证；04 本地源码只确认前两者）；`tokenIdentifier` 是 subject+issuer 组合，跨 provider 唯一。
- 用户入库两种方式：登录后客户端调用 `store` mutation（只能存 JWT 里的字段，按 `by_token` 索引查重 upsert），或 Clerk webhook（`/clerk-users-webhook` httpAction + Svix 验签 + `CLERK_WEBHOOK_SECRET`）。官方示例**未讨论并发重复与乱序事件**。

**证据**：https://docs.convex.dev/auth/clerk ；https://clerk.com/docs/integrations/databases/convex ；https://docs.convex.dev/auth/functions-auth ；https://docs.convex.dev/auth/database-auth ；https://docs.convex.dev/client/nextjs/app-router/server-rendering

**可信度**：高；JWT template 方式是否已弃用：两份文档都未写 → 未知。

### F7 授权与"不要把私密字段发到客户端"

**结论**：
- 官方立场：Convex 数据库只能经服务器函数访问，**授权写在函数里**即可；RLS（`convex-helpers` 的 `rowLevelSecurity` + `wrapDatabaseReader/Writer` + `customQuery/customMutation`）是可选的集中化手段，作者认为"most Convex apps don't need row-level security"，且 RLS 对未配置的表**默认放行**，需 `{ defaultPolicy: "deny" }`。RLS 过滤的是**行**，不是字段。
- 防止"忘记鉴权"的官方建议：用 `customQuery/customMutation/customCtx` 定义 `userQuery`/`roomMemberMutation` 等构造器把已验证用户注入 `ctx`；用 ESLint `no-restricted-imports` 禁止直接从 `_generated/server` 导入裸 `query/mutation/action`；或在 custom ctx 中把 `db` 设为 `undefined`、只暴露 `safeDB`。
- 字段级披露：官方没有专门的"字段过滤"API。可用的官方机制是 **`returns` validator**：对象 validator 不允许额外字段，运行时校验，返回值多一个字段即**报错而非截断**——文档明确说它有助于避免 "returning more data than intended to a client"。这是 fail-closed 的第二道防线，第一道是 handler 内显式构造投影（DTO），不返回整行文档。
- 访问控制不能依赖可伪造参数（email 等）；可以依赖 `ctx.auth` 或不可猜测的 ID（但本系统不把"ID 不可猜"当授权）。
- 被调度函数与组件内都**没有身份**：鉴权必须在调度前/调用前的 mutation 中完成，再显式传 `actorUserId`。

**证据**：https://stack.convex.dev/row-level-security ；https://stack.convex.dev/custom-functions ；https://docs.convex.dev/functions/validation ；https://docs.convex.dev/understanding/best-practices ；https://docs.convex.dev/scheduling/scheduled-functions

**可信度**：高（returns 运行时校验、额外字段报错——文档对 returns 未单独举例，由通用对象规则推出：中高）。

### F8 错误处理与错误信息纪律

**结论**：
- 四类错误：应用错误（`ConvexError`）、开发者错误、读写限额错误、Convex 内部错误（自动处理）。
- mutation 中**任何抛错都阻止事务提交**；客户端乐观更新随之回滚。query 不存在"重试"概念；mutation 只对内部错误自动重试；action 不重试。
- 生产部署中非 `ConvexError` 错误被脱敏为"函数名 + Server Error"，无堆栈；dev 部署包含原始消息与服务端堆栈。
- `ConvexError(data)` 的 `data` 在生产中**原样到达客户端**："Server application errors will still include their custom `data`."
- 官方两种表达预期失败的方式：返回判别联合（`{ error: "EMAIL_ADDRESS_IN_USE" }`，好处是 UI 必须处理），或抛 `ConvexError`（适合需要回滚、跨 `run*` 冒泡）。
- 日志：`console.*` 单行 4 KiB、每函数 256 行（超出丢弃）；可接 Log Streams（Axiom、Datadog、PostHog、webhook）与 Exception Reporting（Dashboard → Deployment Settings → Integrations；所需套餐页面未写）。

**证据**：https://docs.convex.dev/functions/error-handling/ ；https://docs.convex.dev/functions/error-handling/application-errors ；https://docs.convex.dev/production/state/limits ；https://docs.convex.dev/production/integrations/

**可信度**：高。

### F9 convex-test 与其他测试手段

**结论**：
- convex-test（社区维护的 TypeScript 后端模拟）：`convexTest(schema, modules)`（传 schema 才会做 schema 校验）、`t.query/mutation/action`（公开与 internal 均可）、`t.run`（直接读写模拟库与存储）、`t.withIdentity({...})`、`t.fetch`（HTTP action）、Vitest 假时钟 + `t.finishInProgressScheduledFunctions` / `t.finishAllScheduledFunctions`（含递归调度）、`vi.stubGlobal("fetch")` 模拟外部调用、`t.registerComponent` 与 `defineTestApp({ components })`（不加载 `convex.config.ts`）。
- 官方列出的局限：**不强制大小与时间限额**；不要依赖后端错误消息内容；全文检索不排序、向量检索无索引；**不跑 cron**（需手动触发）；运行在 Edge Runtime 模拟上，与 Convex 运行时有差异。
- 官方页与仓库 README 都**没有提到并发 / OCC 模拟**——不能用它证明唯一性或幂等在并发下成立。
- 另一条官方测试路径：针对**本地开源 Convex 后端**运行测试——运行与生产相同的后端代码、强制大小限额、可连同客户端测试；缺点：不能控制时间与随机性、不能 mock `fetch`、测试内不能设环境变量，cron 需用 `IS_TEST` 关闭。并发/幂等测试应在这里或真实 dev 部署上并行发起 mutation（文档未明说支持并发验证，但它是真实后端）。

**证据**：https://docs.convex.dev/testing/convex-test ；https://github.com/get-convex/convex-test ；https://docs.convex.dev/testing/convex-backend ；https://stack.convex.dev/testing-with-local-oss-backend （未打开，仅由官方页引用）

**可信度**：高（列出的 API 与局限）；"本地后端能复现 OCC 冲突"为推论 → 中。

### F10 生产部署与环境变量

**结论**：
- 部署类型：每项目一个共享 production、每位成员一个 dev；preview（每分支独立后端）是 **Pro 套餐**功能。staging 推荐用**单独的 Convex 项目**并以其 `CONVEX_DEPLOY_KEY` 部署。
- Vercel：构建命令 `npx convex deploy --cmd 'npm run build'`；`CONVEX_DEPLOY_KEY` 只勾 Production（preview 用单独的 Preview key）；deploy 会设置前端读取的 URL 变量（`--cmd-url-env-var-name` 可改名）；`--preview-run 'fn'` 只在 preview 部署时运行（适合 seed，生产忽略）。
- schema 随 `convex dev/deploy` 推送；**已有文档不满足新 schema 则推送失败**；收紧 validator 用 `.staged()` 后台验证（1.47）；大表建索引 deploy 会要求确认（1.47）。
- 向后兼容："Functions should be backwards compatible"；**已调度的函数必须仍能接受它被调度时的参数**——修改 internal 函数 args 前要考虑在途调度。
- 环境变量：按部署隔离；`npx convex env set/list/get/remove`；上限 512 个 / 合计 512 KiB / 名 256 字符 / 值 8 KiB。可在 `convex/convex.config.ts` 的 `defineApp({ env: { NAME: v.string(), LOG_LEVEL: v.optional(...) } })` 声明（支持 `v.string / v.literal / v.union / v.optional`），从 `_generated/server` 导入类型化 `env`，"validation at deploy time"；**声明不等于赋值**，未声明的仍可 `process.env` 读取。项目级默认值只作用于**新建**部署。
- 函数导出集合与 cron 定义在部署时确定，改环境变量不会重新求值——不要用环境变量条件导出函数。
- 1.47–1.48 CLI 在识别到 AI 代理时 `env list` 默认只列名字；1.48 起 `--verbose` 不再打印变量值，≥8 字符的值在其他输出中被脱敏。

**证据**：https://docs.convex.dev/production ；https://docs.convex.dev/production/hosting/vercel ；https://docs.convex.dev/database/schemas ；https://docs.convex.dev/production/environment-variables ；https://docs.convex.dev/understanding/best-practices ；https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md

**可信度**：高；"缺少必需 env 时部署失败"文档措辞为"validation at deploy time"，未明说失败 → 中。

### F11 1.46–1.48 的新特性与行为变化

| 版本 | 变化 | 对我们的意义 |
| --- | --- | --- |
| 1.48.0 | `ctx.auth.signJwt`（仅 mutation，部署自有密钥对，公钥在 `CONVEX_CLOUD_URL` 的 JWKS） | 暂无必需用途；未来可给外部集成签短期凭据 |
| 1.48.0 | mutation 中可用 `ctx.storage.store()/get()`，计入事务限额 | 附件/导出可与状态迁移同事务；注意 16 MiB 写入上限 |
| 1.48.0 | `--verbose` 不打印 env 值；≥8 字符值在输出中脱敏；AI 代理下 `env list` 只列名（`--include-values` 显式取值） | 与"密钥不进日志"一致；运维脚本不要依赖 `env list` 输出值 |
| 1.47.0 | `defineTable(...).staged()` 后台验证 schema 变更；大表索引变更需确认；`ctx.meta.getSnapshotTs()` 公开（纳秒，与 `commitTs` 同一时钟） | schema 演进路径；快照时间可写进事件做追溯 |
| 1.46.0 | 所有 validator 有 `.optional()`；`FunctionReference` 的 `_args/_returnType` 弃用；新增 `FunctionReference_future` | 场景插件把回调函数引用传给引擎时用新类型 |
| 1.43.0 | `ctx.db.vars.commitTs` / `v.commitTs()`（官方定位：实现高效 FIFO 队列等底层用途） | 事件流按提交顺序的全序游标（ship.convex.dev 写 1.43.0，npm CHANGELOG 写 1.44.0） |
| 1.39.0 | `convex.config.ts` 声明环境变量 | 见 F10 |

**证据**：https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md ；https://ship.convex.dev/changelog/convex-v1-43-0

**可信度**：高（1.46–1.48 条目）；commitTs 首发版本两源不一致 → 中（不影响使用，我们锁定 1.48）。

---

## 2. 对本系统设计的含义（按任务书第 5 节文件编号）

### 02-domain-model
- 幂等键是**被保护实体自身的字段**：`approvals` 以 `(proposalVersionId, participantId)` 唯一；`executions` 以 `executionKey = proposalVersionId`（一个提案版本至多执行一次）唯一；`agentAttempts` 以 `(runId, turnIndex, attemptNo)` 唯一。不另设通用幂等表（F1）。
- 用户实体以 `tokenIdentifier` 为主键映射（官方示例索引 `by_token`），`subject`（Clerk `user_…`）只作展示/外部对账（F6）。
- 事件是只追加实体，排序字段用 `commitTs`（提交顺序全序），`_creationTime` 只展示（F11）。
- 不存在"计数器行"这类热点实体；需要计数时从事件或分片派生（F1 热点建议）。

### 03-schema
- 每条唯一性不变量写成"索引 + 唯一写入口函数名"两列：`users.by_tokenIdentifier`、`approvals.by_proposalVersionId_and_participantId`、`executions.by_executionKey`、`agentRuns.by_roomId_and_status`（单活跃 run）、`agentAttempts.by_runId_and_turnIndex_and_attemptNo`。并删除冗余前缀索引（最佳实践）。
- 单表上限：索引 32 个、每索引 16 字段；文档 1 MiB、数组 8192 元素、嵌套 16 层——模型原始输出与长对话不要塞进单个文档的数组，按回合拆行（F2/limits）。
- 金额用整数分 `v.number()` + `Number.isSafeInteger` 校验，或 `v.int64()`；范围、日期格式等在代码里校验（04 §1.8，本文 validation 页补证）。
- `agentAttempts.scheduledFunctionId: v.id("_scheduled_functions")` 记录调度句柄，供 watchdog 读状态（F2、F5 retrier 机制）。
- schema 演进：收紧 validator 用 `.staged()`；任何已存在文档不符合新 schema 时 deploy 失败（F10）。

### 04-state-machines
- 每条迁移 = 一个 mutation：读当前状态与 `constraintVersion` → 守卫 → 写新状态 → 必要时同事务 `scheduler.runAfter`（原子，F2）。
- 超时迁移由 exactly-once 的 watchdog mutation 触发（`runAfter(deadline)`），守卫"attempt 仍是 running 且未提交结果"；不依赖 action 回调（F2、F4）。
- `cancel` 不能停在途 action：run 作废迁移只改状态 + `scheduler.cancel` 未开始的调度；迟到结果由提交 mutation 的过期守卫拒绝（F2）。
- 被调度函数的 args 是迁移协议的一部分，需保持向后兼容（F10）。

### 05-protocol
- 服务端信封里的 `runId / turnIndex / attemptId / expectedConstraintVersion / expectedProposalHeadId` 是提交 mutation 的过期守卫输入；不匹配则返回 `{ outcome: "stale_rejected", reason }` 并只记录用量（F1、F4）。
- 结果提交在一个 internal mutation 内完成（action 只调用一次 `runMutation`），避免多事务不一致（F4 最佳实践）。
- 回合负载要在 1 MiB 文档、16 MiB 参数内；action 参数在 Node 运行时上限 5 MiB（limits）。

### 07-permissions-privacy
- 鉴权落点：`convex/functions.ts` 用 `customQuery/customMutation` 定义 `authedQuery`、`roomMemberQuery`、`roomMemberMutation`，注入 `ctx.viewer`（user + participant + role）；ESLint `no-restricted-imports` 禁止业务文件直接导入 `_generated/server` 的裸构造器（F7）。
- 采用"函数内显式授权 + 默认拒绝"，不采用 RLS 作为主手段（RLS 只管行不管字段、默认放行）（F7）。
- 字段披露两道防线：①handler 内显式构造按角色的投影（DTO），绝不返回整行；②所有公开 query 写严格 `returns` validator，多出的私密字段会让函数**报错而不是泄露**（F7）。
- `ConvexError.data` 在生产会到达客户端：只放 `reasonCode` 与对调用者可见的参数，**不得包含他方私密值**（例如对方预算上限）；非 ConvexError 消息虽被脱敏，但 dev 部署不脱敏，同样不得把私密值写进 `Error.message`（F8）。
- 被调度函数与组件内无身份：鉴权在调度前 mutation 完成，`actorUserId / participantId` 显式传参；组件（rate-limiter 等）只接收不透明 key（F2、F5）。
- Next 服务端预取（`preloadQuery`）的结果会序列化到浏览器，裁剪必须已在 Convex query 中完成；服务端调用以 `{ token }` 代表用户身份（F6）。
- 日志：`console.*` 不打印简报内容与密钥；Log Streams 会把日志送到第三方（F8）。

### 08-approval-execution
- `approveProposalVersion` 单一写入口：查 `approvals.by_proposalVersionId_and_participantId`，已存在则返回现有记录（幂等），否则校验版本仍为当前、约束版本一致后插入（F1）。
- 执行：在"最后一个必需审批"的同一 mutation 内，或在独立的 `executeIfReady` mutation 内完成；以 `executionKey` 查重，已执行则返回已有 `executionId`；变更单、预算承诺、任务在同一事务写入（单事务可写 16,000 文档 / 16 MiB，远超需要）（F1、limits）。
- 客户端永远不直接调用 action（官方反模式）；"执行"不涉及外部 I/O，因此全程是 mutation（F4）。

### 09-constraint-changes
- 预算下调 mutation 在一个事务内：递增 `constraintVersion`、把受影响审批标记失效（追加失效记录或状态迁移）、作废活跃 run、调度重新协商或创建人工请求——原子且失败即全部回滚（F2）。
- 并发的"审批"与"预算下调"由 OCC 串行化：两者都读写 `constraintVersion` 所在文档，后提交者重跑并看到新版本（F1）。

### 10-agent-runtime
- 推荐**自建调度链**为主：`startTurn` mutation 插入 attempt + `runAfter(0, internal.agent.callModel)` + `runAfter(deadlineMs, internal.agent.watchdog)`；watchdog 读 `_scheduled_functions` 状态与 attempt 状态，失败/超时则按指数退避调度下一次 attempt（上限 N 次）或迁移到 `failed` 并创建人工请求（F2、F5 retrier 机制）。理由：Claude 调用非幂等；workpool 未说明超时检测、完成后不留元数据；workflow 改代码即令在途实例失败、handler 受确定性约束，而本系统的长等待只是状态行（F5）。
- 若需要全局并发上限，可只用 workpool 的 `maxParallelism`（`retry: false`，结果在 `onComplete` 写回我们自己的表并做过期守卫）；全部池与工作流合计并行度不超过 Pro 100 / Free 20（F5）。
- 时间预算：action 上限按 10 分钟设计；SDK `timeout` ≤ 5 分钟、SDK 层 `maxRetries: 0`，重试只发生在我们的 attempt 层；watchdog deadline = SDK timeout + 余量（F4）。
- 用量与成本：用 rate-limiter 的 token bucket 按 `roomId` / `userId` 限制触发次数与每日 token（`count` = 预计 token，`reserve` + `retryAfter` 排队），事务性、失败即拒绝；精确上限用同步模式（F5）。
- Claude 调用默认放默认运行时（30 分钟上限、64 MB 内存、无冷启动），仅当 SDK 不兼容时移入 `"use node"` 文件（只能含 action）（F4）。
- 所有 promise 必须 await（`no-floating-promises`），否则调度可能静默丢失（最佳实践）。

### 11-architecture
- 目录：`convex/functions.ts`（自定义构造器）、`convex/model/*`（纯 TS 业务逻辑，供多个函数复用）、薄函数包装；`runAction` 只用于跨运行时（F4、F7）。
- 在 `convex.config.ts` 声明环境变量：`ANTHROPIC_API_KEY: v.string()`、`CLERK_JWT_ISSUER_DOMAIN: v.string()`、`AGENT_MODE: v.union(v.literal("live"), v.literal("stub"))`、`LOG_LEVEL: v.optional(...)`，经类型化 `env` 读取（F10）。
- 不用环境变量条件导出函数或改变 cron 集合（F10）。

### 12-api
- 所有公开函数：`args` + `returns` validator 必填，访问控制在自定义构造器内；被调度、被 `run*` 调用的一律 `internal*`（最佳实践）。
- 不暴露公开 action。预期失败用返回判别联合（UI 必须处理）或 `ConvexError({ reasonCode })`，两者在 12 中逐函数标注（F8）。

### 13-frontend
- `ConvexProviderWithClerk` 放在 Client Component 包装器中，`ClerkProvider` 在外层；登录态用 `useConvexAuth()` 与 `<Authenticated>/<AuthLoading>`，需登录的 query 只在 `<Authenticated>` 之下渲染（F6）。
- 同页最多一个 `preloadQuery`（HTTP 客户端无共享快照）；列表用 `usePaginatedQuery`（F6、04）。
- 错误 UI：`ConvexError` 读 `data.reasonCode` 映射文案；其他错误显示通用"服务器错误"（生产已脱敏）（F8）。
- 限流反馈可用 `useRateLimit` 显示 `retryAfter`（F5）。
- 不在 query 中用 `Date.now()` 计算"是否过期"——过期状态由 watchdog 写入或由客户端传入时间（最佳实践）。

### 15-operations
- 环境：dev（每人）/ staging（**独立 Convex 项目** + 独立 Clerk dev 实例）/ prod（Clerk prod 实例 `pk_live_`）；preview 需 Pro，seed 用 `--preview-run`（F10、F6）。
- Vercel 构建命令 `npx convex deploy --cmd 'npm run build'`，Production 与 Preview 用不同 deploy key（F10）。
- `_scheduled_functions` 只保留 7 天、workpool 完成后不留元数据：可追溯所需的 attempt 结果、错误码、用量必须写进自有表（F2、F5）。
- 日志：每函数 256 行、每行 4 KiB；接 Log Streams 与 Exception Reporting（F8）。
- 修改 internal 函数参数前排空或兼容在途调度（F10）。

### 16-testing
- convex-test：状态机迁移、权限矩阵（`t.withIdentity` 扮演各角色）、披露投影、过期拒绝、watchdog（假时钟 + `finishAllScheduledFunctions`）、Claude 调用以 `vi.stubGlobal("fetch")` 或 stub 模式替换；组件用 `t.registerComponent`（F9）。
- convex-test 不强制限额、不跑 cron、不模拟并发：幂等与并发不变量（连点审批、并发执行、审批与预算下调竞争）在**本地开源后端或 dev 部署**上用并行客户端调用验证（F9）。
- 隐私金丝雀：在私密简报中放唯一金丝雀字符串，遍历他方可调用的全部 query 返回值断言不含该字符串；同时依赖严格 `returns` validator 让越界字段直接报错（F7）。

### 18-decisions-open-questions
- ADR 候选：①运行时编排（自建调度链 vs workpool vs workflow）；②授权实现（自定义构造器 + 显式检查 vs RLS）；③用户入库（登录后 `store` mutation vs Clerk webhook——首版只需 JWT 字段，倾向 `store` mutation）；④环境变量命名（`CLERK_JWT_ISSUER_DOMAIN` vs `CLERK_FRONTEND_API_URL`）。

---

## 3. 未解决的问题（实现前需最小实验或读源码确认）

1. **action 超时**：默认运行时到底是 30 分钟（limits 页）还是 10 分钟（actions 页）？设计按 10 分钟，确认后可放宽。
2. **调度参数合计上限**：8 MB（scheduled-functions 页）vs 每 mutation 16 MiB（limits 页）。
3. **workpool 如何发现超时/丢失的 action**，以及 `onComplete` 是否严格 exactly-once（README 只说 "always be called"）——需读组件源码。
4. **持续 OCC 冲突**的重试次数与最终报错形态（OCC 页未写）。
5. **dev 部署是否运行 cron**（cron 页未写）。
6. 在 `convex.config.ts` 声明为必需的环境变量缺失时，**deploy 是否失败**（文档只写 "validation at deploy time"）。
7. Clerk 原生集成下服务端 `getToken()`（无 template）返回的 token 是否 `aud = convex`；`convex` JWT template 是否仍受支持。
8. 1.48 mutation 内 `ctx.runMutation` 子事务抛错并被 catch 时，子事务里登记的 `scheduler.runAfter` 是否一并撤销（推论为是）。
9. 本地开源后端是否能稳定复现 OCC 冲突以做并发测试；否则改在 dev 部署上做。
10. Log Streams / Exception Reporting 所需套餐（integrations 页未写）。
11. Clerk webhook 乱序事件与 `store` mutation 并发调用的去重——serializability 保证 upsert 不重复，但乱序 `user.updated` 需要按事件时间戳比较（官方示例未处理）。

---

## 4. 来源清单（访问日期 2026-10-24）

1. https://docs.convex.dev/scheduling/scheduled-functions
2. https://docs.convex.dev/scheduling/cron-jobs
3. https://docs.convex.dev/production/state/limits
4. https://docs.convex.dev/functions/actions
5. https://docs.convex.dev/database/advanced/occ
6. https://docs.convex.dev/understanding/best-practices
7. https://docs.convex.dev/auth/clerk
8. https://docs.convex.dev/auth/functions-auth
9. https://docs.convex.dev/auth/database-auth
10. https://clerk.com/docs/integrations/databases/convex
11. https://docs.convex.dev/client/nextjs/app-router/server-rendering
12. https://docs.convex.dev/production/environment-variables
13. https://docs.convex.dev/testing/convex-test
14. https://github.com/get-convex/convex-test
15. https://docs.convex.dev/testing/convex-backend
16. https://docs.convex.dev/functions/error-handling/
17. https://docs.convex.dev/functions/error-handling/application-errors
18. https://docs.convex.dev/functions/validation
19. https://stack.convex.dev/row-level-security
20. https://stack.convex.dev/custom-functions
21. https://stack.convex.dev/retry-actions
22. https://github.com/get-convex/workpool
23. https://cdn.jsdelivr.net/npm/@convex-dev/workpool@0.4.14/README.md
24. https://github.com/get-convex/workflow
25. https://github.com/get-convex/action-retrier
26. https://github.com/get-convex/rate-limiter
27. https://docs.convex.dev/components/using
28. https://docs.convex.dev/components/authoring
29. https://docs.convex.dev/production/hosting/vercel
30. https://docs.convex.dev/production
31. https://docs.convex.dev/database/schemas
32. https://docs.convex.dev/production/integrations/
33. https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md
34. https://ship.convex.dev/changelog/convex-v1-43-0
