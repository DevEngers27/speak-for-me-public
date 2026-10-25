# Speak for Me 验证 spike 汇总

> 根目录（下称 `SP/`）：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/`
> 本文中所有相对路径都相对 `SP/`。6 个 spike 全部离线完成：没有任何真实 Claude API 调用，没有读取或搜索任何密钥；需要模型的地方一律用 stub、假 `fetch` 或 Ajv 近似。
> 设计文件编号沿用任务书（`design/00-brief.md`）第 5 节：00-overview … 18-decisions-open-questions。

## 0. 总览

| # | spike | 目录 / 报告 | 实测规模 | 一句话结论 |
| --- | --- | --- | --- | --- |
| 1 | convex-test 验证 Convex 语义 | `convex-test/`、`convex-test-report.md` | tsc 通过；5 个文件 32 个用例全过 | 单入口"先查后写"、mutation 原子回滚、"写状态 + runAfter"原子组合、过期拒绝都能离线回归；**客户端 operationId 不足以防重复执行，审批 upsert 违反历史不可篡改**；OCC 并发测不了 |
| 2 | Anthropic SDK 1.1 + Zod 4 结构化输出 | `anthropic-zod/`、`anthropic-zod-report.md` | tsc 通过；6 个离线脚本 | `zodOutputFormat` 把 enum/const/长度/上下界全部降级为描述文字；`messages.parse()` 解析失败直接抛错并丢失 usage → 生产路径用 `create()` + 自行 `safeParse` + 自建 strict schema |
| 3 | Next 16 + Convex + Clerk 骨架 | `skeleton/`、`skeleton-report.md` | 无凭据下 lint/typecheck/test(5)/build 全部 exit 0 | 版本组合可用、分层可被 eslint 强制、缺配置 fail closed；**proxy 的 `auth.protect()` 对 API 请求也是 307 而不是 404** |
| 4 | Convex 组件评估 | `convex-components/`、`convex-components-report.md` | 26 个用例 25 过 1 跳过 | 推荐 `@convex-dev/workflow` 跑回合循环（68 行），自建 scheduler 链 + watchdog 是可行备选；**不用 action-retrier**；带组件的应用没有离线 codegen |
| 5 | 协议 schema 与规则引擎 | `protocol-rules/`、`protocol-rules-report.md` | tsc 通过；5 个文件 92 个用例全过 | 规则引擎可写成零依赖纯函数（8.7 KB、0 处 zod）；原 README 的预算下调走查可复现；**版本号匹配 + 重新审批并不能恢复可执行，必须用当前状态重跑规则**；模型输出根必须是 object |
| 6 | 隐私金丝雀与注入测试 | `privacy-canary/`、`privacy-canary-report.md` | tsc 通过（6 处 `@ts-expect-error`）；4 个文件 157 个用例全过 | 在"信封 + strict 校验 + 目录求和 + 模板生成公开文本 + 日志只记哈希"下，完全被攻破的模型也守住 20 条注入的不变量；**目录标题、语义合法的日期、shared fact 都是此前漏掉的泄露通道** |

## 0.1 跨 spike 的不一致（落地前必须统一）

各 spike 并行完成，以下几处彼此冲突，设计文档要选定一个答案：

| 主题 | 冲突 | 建议 |
| --- | --- | --- |
| 动作集与引用字段 | protocol-rules 与 privacy-canary 用 `propose / counter / clarify / recommend_accept / reject / escalate`，counter 带 `baseProposalVersion`；anthropic-zod 用 `request_tradeoff`、`baseProposalId`、`addressee` | 采用 `escalate {kind: infeasible \| needs_tradeoff, toRole, options}`；模型只引用它见过的**提案版本号**（小整数），由服务端映射到 `Id<"proposals">`；收件人字段统一叫 `toRole` |
| reasonCode 命名 | protocol-rules 用点分小写（`budget.over`、`approval.stale`，20 个）；privacy-canary 用大写下划线（`OVER_BUDGET`、`OUTPUT_SCHEMA_VIOLATION`、`DATE_OUT_OF_RANGE`、`DISCLOSURE_BLOCKED` 等） | 统一用点分小写并按域分组：`output.*`（not_json / schema_violation）、`action.*`（not_allowed_for_role）、`item.*`、`date.*`（含 `date.out_of_range`）、`budget.*`、`amount.*`、`version.*`、`approval.*`、`disclosure.*`（blocked / needs_own_confirmation）；单一来源文件沿用 `protocol-rules/src/reasonCodes.ts` |
| 离线 codegen | convex-test 读源码后认为不能离线；skeleton 实测 `convex codegen --system-udfs --typecheck disable` 可以离线且输出确定；convex-components 实测**带组件**时报 `No CONVEX_DEPLOYMENT set` | 三者其实相容：无组件 → 隐藏参数可离线；有组件 → 必须有部署，或用 `convex-components/scripts/gen-generated.mjs` 按模板生成。是否引入 workflow 组件直接决定 CI 漂移检查怎么做（见 11、16） |
| 严格 schema 生成器 | 两份实现：`protocol-rules/src/jsonSchema.ts`（`toStrictOutputSchema`，记录被剔除路径 + 子集静态检查）与 `anthropic-zod/src/strict-format.ts`（`toStrictJsonSchema`，内联、去 `$schema`、丢冗余 pattern，另有带 parse 的 `strictZodOutputFormat`） | 合并为一个模块：以 `toStrictOutputSchema` 的剔除记录与 `apiSubsetViolations` 为骨架，吸收 `strict-format.ts` 的内联和去冗余规则；两边的快照（`protocol-rules/out/strict.root.json`、`anthropic-zod/out/strict-envelope.json`）做成快照测试 |
| 工具链版本 | TS 7.0.2（convex-test）/ 6.0.3（skeleton、protocol-rules、anthropic-zod、privacy-canary）/ 5.9.3（convex-components）；vitest 5.0.5 / 3.2.x | 以 skeleton 为准：TS 6.0.3 + vitest 5.0.5 + vite 8.3.5。迁入 protocol-rules、privacy-canary 的测试时需在 vitest 5 下重跑一次（未做） |
| fixture | protocol-rules：5 项合计 $1,400，必需 sso_login + audit_log_export = $800，+usage_dashboard = $900；privacy-canary：LOGIN $400 / REPORTS $500 / EXPORT $350 / AUDIT（unconfirmed） | 14 用 protocol-rules 的目录与 v1/v2/v3 约束作为主 fixture，再把 privacy-canary 的三方 canary（`CANARY-CUS-2219` 等）、私密截止日、底价/成本叠加进去，并让 `lintCanaries` 通过 |
| 审批存储 | convex-test 演示了 `by_proposal_user` upsert（patch 覆盖）；protocol-rules 的 `isExecutable` 按"每人最新一条"判定 | 只追加；"当前决定"= 该 (proposal, user) 最新一行（见 03、08） |

## 1. convex-test：Convex 语义（convex 1.48.0 / convex-test 0.0.65 / vitest 5.0.5）

**结论**
- 证实：同一 mutation 内按 `by_operationId` 先查后 insert，重复调用返回已有记录（`created:false`），execution / commitment / 事件各 1 行（串行条件下）。
- 证实：写完三表后抛 `ConvexError`，三表都是 0 行；同 key 重试成功。`ConvexError({code,message})` 以原类和原样 `data` 到达调用方，可作错误码通道。
- 证实：`runAfter` 之后再抛错，run 行和 `_scheduled_functions` 行一起回滚，action 从未运行 →"写状态 + 启动 action"是原子组合。被调度 action 抛错 → `failed`、不重试；`cancel` → `canceled`。
- 证实：被调度的 mutation 与 action 里 `getUserIdentity()` 为 `null`（即使调度者已登录）→ 必须显式传 `actorUserId`，鉴权在调度前完成。
- 证实：`commitRunResult` 按 `status + attempt` 拒绝旧 attempt；`internal.*` 可直接 `t.mutation(internal.x)` 测试。
- 证实：未登录 query 拿到 `null` 不抛错；`requireIdentity` 抛 `UNAUTHENTICATED`；已登录但无 users 行 → `USER_NOT_PROVISIONED`。`withIdentity({subject, issuer})` 得到确定的 `tokenIdentifier = "<issuer>|<subject>"`。
- 证实：schema 在 insert / patch / `t.run` 都校验（字面量联合、optional vs nullable、多余字段、`v.id` 表名、嵌套判别联合）；`v.*` 只校验形状，负数、小数、`NaN`、空串都能写入。
- 证实：action 非事务（第一次 `runMutation` 的写入保留）；1.48 mutation 内 `ctx.runMutation` 是子事务（内层抛错被捕获 → 内层回滚、外层保留）。
- 证伪：**"客户端 operationId 足以防重复执行"**——两次点击各生成一个 key 就写出 2 条 execution。
- 证伪：用 patch 覆盖决定的审批 upsert 与核心 #6 冲突；`{field: undefined}` 经参数传入会被丢弃变成空 patch，删除字段只能在 handler 内做。
- 证伪：文档里的模块 glob `import.meta.glob("./**/!(*.*.*)*.*s")` 在 vitest 5 下匹配 0 个文件，须改为 `["./**/*.*s", "!./**/*.*.*s"]`。
- 注意：索引不唯一。`t.run` 能插入重复审批，之后入口里的 `.unique()` 抛错 → 能检测到但该键从此失败关闭，所以 seed / 迁移也不能绕过入口。
- 注意：引用同一 API 图的函数需显式返回类型以避开 TS7022/7023。

**关键证据**
```
[spike] second: {"created":false,"executionId":"0000000000000000010003executions"}
[spike] executions after two client-random keys: 2
[spike] after failed startRun: {"runs":0,"jobs":0}
[spike] identity seen inside scheduled mutation: {"identity":null}
[spike] events after failed action: {"step1":1,"step2":0}
duplicate detection error: unique() query returned more than one result from table approvals
number_NaN => accepted
```

**可复用代码**：`convex-test/vitest.config.ts`、`convex-test/convex/test.setup.ts`（修正后的 glob）、`convex-test/convex/test.helpers.ts`（makeT / as / seed / countRows / scheduledJobs / expectAppError）、`convex-test/convex/lib/auth.ts`（requireIdentity / requireUser / appError）、`convex-test/convex/users.ts`（幂等 ensureUser）、`convex-test/convex/execution.ts`（落地时改为服务端派生键）、`convex-test/convex/approvals.ts`（落地时改为只追加）、`convex-test/convex/runs.ts`（startRun → markRunning → commitRunResult 过期拒绝）、`convex-test/convex/*.test.ts`（五组测试模板）。`convex-test/convex/_generated/` 只是离线替身，不要迁入。

## 2. anthropic-zod：SDK 1.1.0 + Zod 4.6.7 结构化输出

**结论**
- 证实：`zodOutputFormat` 把 `enum`、`const`、`minLength/maxLength`、`pattern`、`maxItems`、`minItems ≥ 2`、`minimum/maximum`、`default` 全挪进 `description`；真正保留的只有 `type`、`anyOf`、`properties`、`required`、`additionalProperties:false`、受支持的 `format`、`minItems ∈ {0,1}`、`$ref/$defs`。
- 证实：判别联合 → zod 根级 `oneOf` → SDK 改写为根级 `anyOf`，无 `discriminator`；根级 `$schema` 被拼进描述。
- 证实：SDK schema 有真实解码缺口——counter 缺 `baseProposalId`、`action:'approve'`、非法 reasonCode、`addressee:'cfo'` 都能过 SDK schema（Ajv 近似），被 Zod 拒绝；自建 strict 生成器保留 enum/const 后这 4 类在 schema 层被拒，长度 / maxItems / minItems:2 仍只能靠 Zod。
- 证实：`additionalProperties:false` 生效，`terms` 里夹带 `priceUsd` 在 schema 层被拒。
- 证实：`messages.parse()` 在截断、带半截文本的 refusal、Zod 不匹配、多个 text 块时**直接抛 `AnthropicError`**，usage 与 `_request_id` 一起丢失；只有"refusal 且 content 为空"返回 `parsed_output: null`。
- 证实：类型能挡住字面量里的 `temperature/top_p/top_k`、`output_format`、`effort:'minimal'`、`display:'updates'`；**挡不住** `thinking: disabled/enabled/between_tools`、强制 `tool_choice`、prefill、拼错的模型 ID，非字面量对象里的 `temperature` 会被原样发出。
- 证实：非流式 `max_tokens` 21,333 能发，21,334 在 fetch 之前就抛 `Streaming is required`；`maxRetries` 对超时也生效（50 ms、maxRetries=1 实发 2 次）；默认头 `anthropic-version: 2026-10-21`，key 用 `Authorization: Bearer` 发送。
- 证实：schema 逐字节稳定（跨进程哈希一致），可把哈希记作 `schemaVersion`。
- 证伪：技能文档"parse 失败时 `parsed_output` 为 null"；"SDK 会在客户端校验"（只有 `parse()` 以抛错方式校验，`create()` 不校验）；`stop_details.category` 在 SDK 类型里是封闭联合，但运行时应按 `string | null` 存；`z.record` 会被改写成只能输出 `{}`，`.default()` 让字段变 required → 都不能用于模型输出；nullable 字段并非总是 `type:["string","null"]`，复用 + describe 时会出现 `anyOf:[{$ref},{type:null}]`。

**关键证据**
```
sdk-zodOutputFormat-union inDescription: {"enum":4,"const":6,"maxItems":5,"pattern":2,"minLength":6,"maxLength":7,...}
unknown action 'approve'   sdkSchema=ACCEPT  strictSchema=reject  zod=FAIL(action)
[parse] max_tokens truncated JSON: THROWS AnthropicError: Failed to parse structured output ...
[parse] refusal, empty content: OK stop=refusal parsed_output=null
max_tokens=21334: THROWS before fetch=true: Streaming is required ...
non-literal temperature forwarded to body: true
[callModel] schema mismatch: kind=schema_mismatch retryable=true usage=kept paths=baseProposalId
```

**可复用代码**：`anthropic-zod/src/call-model.ts`（`callModel`、`classifyApiError`、`toUsageRecord`：16 类失败闭集、usage 始终保留、整数微美元成本）、`anthropic-zod/src/strict-format.ts`（并入统一生成器，见 0.1）、`anthropic-zod/src/turn-schema.ts`（动作名需按 0.1 统一；`FORBIDDEN_PROPERTY_PATTERN` 做成"schema 中无金额属性名"测试）、`anthropic-zod/src/type-tests.ts`（SDK 类型契约回归，升级 SDK 先跑）、`anthropic-zod/src/stub-harness.ts`（假 fetch 夹具，改写成 vitest）、`anthropic-zod/src/decode-gap.ts`、`anthropic-zod/out/*.json`（schema 快照）。

## 3. skeleton：Next 16.4.3 + Convex 1.48.0 + Clerk 7.9.20 新仓库骨架

**结论**
- 证实：next 16.4.3、react 19.3.1、convex 1.48.0、@clerk/nextjs 7.9.20、zod 4.6.7、typescript 6.0.3、eslint 9.39.5、vitest 5.0.5、convex-test 0.0.65、vite 8.3.5 用 pnpm 11.25.0 干净安装；`env -i` 无凭据下 lint、双项目 typecheck、test（5 个）、build 全部 exit 0。
- 证实：无组件时 `convex codegen --system-udfs --typecheck disable` 离线生成 `_generated`，两次输出 `diff -r` 无差异 → 生成代码入库 + CI 漂移检查可行。
- 证实：条件 Provider——未配置时不创建 `ConvexReactClient`、横幅列出缺失变量名；配置后 SSR 不建 WebSocket、页面显示加载态。`CLERK_SECRET_KEY` 在客户端 chunk 与 HTML 中 0 次出现。
- 证实：`proxy.ts` 中 `createRouteMatcher(['/rooms(.*)'])` + `auth.protect()` 重定向未登录请求；Clerk 未配置时 `/rooms` → 307 `/setup?missing=clerk`（fail closed）。
- 证实：Convex 代码可通过 `@core/*` 引用无框架的 `core/`（vitest 与 esbuild 0.27.0 回放都通过）；eslint `no-restricted-imports` 强制 `core ← convex`、`core ← src`、`src → @convex/_generated/{api,dataModel}`，5 个故意违规 5 个 error。
- 证伪：inputs/04 §3.5 "非文档（API）请求返回 404"——JSON fetch 与 Route Handler `/api/probe` 都得到 307 到 sign-in（原因：`protect.js` 的 `isPagePathAvailable()`）。API 路由必须自己 `auth()` 并返回 401。
- 证伪：Convex 生成的 tsconfig 模板在 TS 6 下报 TS2591（`process`），须加 `"types": ["node"]`；Vite 8 下同样需要改 glob。
- 证伪："`NEXT_PUBLIC_*` 一律构建期内联"——构建时未定义的变量会被服务端代码（proxy、Server Component）在运行时读取，"无凭据构建 + 运行时注入"会形成服务端已配置、客户端未内联的混合态 → 每个环境带变量单独构建。
- 建议：`convex/` 下目录用 camelCase（`scenarios/scopeChange`），避免 `api.scenarios["scope-change"]` 与服务端校验风险；场景表加 `scopeChange_` 前缀。

**关键证据**
```
################ pnpm build ... ƒ Proxy (Middleware)  exit=0
== GET /rooms       307 -> http://localhost:3917/setup?missing=clerk
## secret marker in client static chunks:  0
== GET /api/probe (fetch, JSON)   307 -> https://example.accounts.dev/sign-in?redirect_url=...%2Fapi%2Fprobe
convex/auth.config.ts(7,16): error TS2591: Cannot find name 'process'
```

**可复用代码**：`skeleton/package.json`（scripts：lint / typecheck 双项目 / test / check / `convex:codegen:offline`）、`skeleton/pnpm-workspace.yaml`、`skeleton/tsconfig.json`、`skeleton/convex/tsconfig.json`、`skeleton/eslint.config.mjs`、`skeleton/vitest.config.ts`（convex=edge-runtime、core=node 两个 project）、`skeleton/convex/test.setup.ts`、`skeleton/convex/auth.config.ts`、`skeleton/convex/engine/auth.ts`、`skeleton/convex/schema.ts`（engineTables + scopeChangeTables 组合）、`skeleton/src/proxy.ts`、`skeleton/src/lib/config.ts`、`skeleton/src/lib/clerk-env.ts`、`skeleton/src/components/providers.tsx`、`skeleton/src/app/layout.tsx`、`skeleton/.github/workflows/ci.yml`、`skeleton/.env.example`、`skeleton/scripts/check-env.mjs`。

## 4. convex-components：回合编排引擎选型

版本：workflow 0.4.10（peer workpool ^0.4.4、convex ^1.46.0、convex-helpers ^0.1.127）、workpool 0.4.14、action-retrier 0.3.1、rate-limiter 0.4.2（batch-worker 0.3.5 与 workpool 自带的 0.2.2 两份并存）。四个组件都导出 `./test`，可在 convex-test 中注册并真实运行。

**结论**
- 三个引擎（A 自建 scheduler 链 + attempts 表 + watchdog / B workflow / C 链 + action-retrier）都通过 tsc；实测正常路径 2 轮 × 3 角色、瞬时失败 2 次后恢复、超过上限（3 次调用）后 run 失败、预算变更取消。
- 证实：workflow 的 `step.runAction` 重试认 `NonRetryableError`（致命错误只调 1 次）；`onComplete` 的 kind 是 `success | failed | canceled`（README 示例写的 `error` 与类型不符）。
- 证实：在预算变更 mutation 内 `workflow.cancel`：在途 action 会跑完但结果被丢弃，commit 步骤不执行（只提交 3 个回合）。
- 证实：自建链的 watchdog 有效（模拟 action 丢失 → `timedOut` → 重试 → 完成）；迟到结果被拒并记 `late_attempt_canceled`。
- 证实：workflow 确定性约束——handler 内 `fetch` 报错、`process` 未定义、`Date.now`/`Math.random` 可用；在途实例遇到新插入的步骤报 `Journal entry mismatch` 失败。
- 证实：rate-limiter 可与 `startRun` 同事务使用（`limit(..., {throws:true})`）；第二次并发 start 被 `run_already_active` 拒绝。
- 证实：无论选哪个引擎，提交 mutation 都必须做过期拒绝 + `(runId, turnIndex)` 幂等。
- 证伪：带组件的应用离线 codegen（`No CONVEX_DEPLOYMENT set`，`components.ts:105-160`）。
- 证伪：action-retrier 认 `NonRetryableError`（致命错误照样重试 3 次）；在 action-retrier 的 `onComplete` 里 `cleanup` 会抛 `Run ... hasn't completed`，被组件吞掉，链静默卡死在 `running`。
- 证伪：`finishAllScheduledFunctions(vi.runAllTimers)` 能测 watchdog——它在 0 ms 的 action 跑完前就触发 11 分钟的 watchdog，必须逐个推进定时器。convex-test 也不支持取消 inProgress 的调度函数。
- 注意：workflow 取消后 stderr 出现 `already has generation number 1 when completing ... Expected 0` 噪声日志，未影响结果。

**推荐**（写进 10）：回合循环用 workflow，前提是 ① 一个实例只覆盖一个 run，人工审批 / 取舍不用 `awaitEvent`，用状态行；② workflow 名带版本（`negotiationV1`），步骤变更时新增版本，部署前排空在途实例；③ `turns.commitTurn` 仍是唯一写入口；④ 预算变更 mutation 内"递增版本 + `workflow.cancel`"同事务；⑤ workpool `maxParallelism` 做 Anthropic 全局并发保护，rate-limiter 只做业务限流，不替代"单活跃 run"检查；⑥ 不用 action-retrier。不愿承担确定性约束时选 A（约多 40 行 + attempts 表，取消 / 超时 / 可观测完全自控）。

**关键证据**
```
Tests  25 passed | 1 skipped (26)
[workflow] fatal => {"status":"failed",...}   fatal calls = 1
[retrierChain] fatal => {"status":"failed",...,"stubCalls":{"0:customer":3}}   fatal calls = 3
[workflow] budgetCutDuring => {"status":"canceled","turns":3,"rejections":[],"wfStatus":"canceled"}
[chain] lost => {"status":"completed","attempts":[...,"2#1:timedOut","2#2:succeeded"]}
[probe codeChange] final= {"st":{"error":"Journal entry mismatch: ..."}}
Error running onComplete handler for ...runs: Run ...runs hasn't completed.
```

**可复用代码**：`convex-components/convex/turns.ts`（`commitTurnLogic`：唯一写入口 + 过期拒绝 + 幂等 + 确定性校验）、`convex-components/convex/wf.ts`（workflow 回合循环 + `onRunComplete`）、`convex-components/convex/chain.ts`（备选引擎 A）、`convex-components/convex/rooms.ts`（`changeBudget`、`cancelIfUnfinished`）、`convex-components/convex/model.ts`（stub 模型与 transient / fatal / lost / budgetCutDuring 故障注入）、`convex-components/convex/lib.ts` 与 `convex-components/convex/convex.config.ts`、`convex-components/convex/engines.test.ts`（三引擎参数化套件 + 逐步推进的 `drain()`）、`convex-components/convex/probes.test.ts` + `wfProbe.ts`、`convex-components/scripts/gen-generated.mjs`（无部署生成带组件类型的 `_generated`）。

## 5. protocol-rules：协议 schema 与规则引擎

**结论**
- 证实：`rules.ts` + `primitives.ts` 打包 8.7 KB、0 处 zod；stub、`isExecutable` 与测试共用同一份代码 → zod 只放在边界（模型输出、mutation 入参）。
- 证实：`checkBudget` 恰等于上限通过（headroom 100000、overBy 0），超 1 分 `budget.over`；`total < committed` 返回独立的 `budget.total_below_committed`；小数分、负数、NaN、2^53、求和溢出 → `budget.invalid_amount` 并指出字段。
- 证实：`checkProposal` 一次收集全部问题（$1,400 全量同时报 `budget.over` + `date.after_deadline`）；空范围、重复、未知 / withdrawn 项、日期格式错误属结构性问题，此时 `terms = null`；恰等于截止日 / 最早交付日通过；闰年正确。
- 证实：模型输出用 `z.strictObject`，附带 `priceCents` / `constraintsVersion` 被拒；同版本目录改价时旧提案得到 `amount.claim_mismatch`。
- 证实：原 README 走查可复现——v1 下 stub 选 required + usage_dashboard = $900；下调到 $4,800 后旧提案 `isExecutable` 报 `version.stale_constraints + budget.over + 3×approval.stale`；stub 改为只含必需项的 $800 counter（恰等于上限）；$4,700 时输出 `escalate/infeasible → finance`，不编造一致。
- 证实：`contentHash`（stableStringify + Web Crypto SHA-256）与键顺序无关；绑定旧哈希 / 其他 proposalId / 最新一条为 reject 分别判 `approval.stale / missing / rejected`。
- 证实：stub 输出经 zod parse 并通过 ajv 对严格 schema 与 SDK schema 的校验；200 次运行字节一致；信封层强制 stub 来源 `isSimulated: true`。
- 证伪：**"约束版本相同即有效 / 重新审批即可恢复可执行"**——v2 下三方重新审批旧 $900 提案仍是 `budget.over`；`isExecutable` 必须用当前目录与约束重跑规则。
- 证伪：把自建 schema 交给 `jsonSchemaOutputFormat` 就能保留 enum/const——默认 `transform:true` 同样剥掉（0/0），必须 `{transform:false}` 或直接放进 `output_config.format`。
- 证伪：判别联合直接作根——`zodOutputFormat` 生成无 `type` 的根，`jsonSchemaOutputFormat` 抛 `JSON schema must be an object, but got undefined` → 根包一层 `{turn: AgentModelOutput}`。

**关键证据**
```
Tests  92 passed (92)
isExecutable v1→v2: ["version.stale_constraints","budget.over","approval.stale","approval.stale","approval.stale"]
re-approved under v2: ["budget.over"]
sdk enum/const count: { enum: 0, const: 0 }   strict enum/const count: { enum: 5, const: 6 }
jsonSchemaOutputFormat(default) enum/const: { enum: 0, const: 0 }
bare union rejected by jsonSchemaOutputFormat: JSON schema must be an object, but got undefined
out/rules.bundle.js  8.7kb      zod refs in rules bundle: 0     out/stub.bundle.js 772690 bytes
```

**可复用代码**：`protocol-rules/src/rules.ts`（`checkBudget` / `checkProposal` / `isExecutable` 四段判定）、`protocol-rules/src/primitives.ts`（`isCents`、`sumCents`、`isIsoDate`、`compareIsoDate`、`maxIsoDate`、`stableStringify`、`contentHash`）、`protocol-rules/src/reasonCodes.ts`（单一来源 + `PRIVATE_PARAM_CODES`）、`protocol-rules/src/protocol.ts`（`AgentModelOutput`、`AgentModelOutputRoot`、`AgentEnvelope`、`OutputSource`、`Catalog`、`ScopeChangeConstraints`、`ProposalTerms`）、`protocol-rules/src/stubAgent.ts`（`findBestCombination`、`stubAgentTurn`、`wrapStubTurn`）、`protocol-rules/src/jsonSchema.ts`、`protocol-rules/src/fixtures.ts`、`protocol-rules/test/*.test.ts`（92 个表驱动用例）、`protocol-rules/scripts/dump-schemas.ts`、`protocol-rules/scripts/probe-format-helpers.ts`、`protocol-rules/out/strict.root.json`。

## 6. privacy-canary：隐私金丝雀与注入测试

**结论**
- 证实：按受众判断泄露的扫描器可行（`SecretField {ownerRole, allowedRoles}` × `Surface {audience}`）；同一句 "$5,000 → $4,800" 对 provider / room 算泄露，对 finance 与可见预算的 customer 合法；日志是 `ops` 受众，任何秘密都不授权。
- 证实：金额正例 20/20 命中（全角、零宽、`4.800,00`、`4.8k`、整数分、英文大写、`预算4800元`），反例 9/9 零误报（`$14,800`、`48000`、`k4800x` 等）；日期 9 种写法、字符串 skeleton / 反转 / base64 / URL 编码都能命中。
- 证实：公共模板只读 5 个白名单字段（Proxy 记录），fuzz 463 次零泄露；类型层 6 处 `@ts-expect-error` 生效（私密 number 不能赋给 `PublicCents`、自由文本不能当 `ItemKey`、模板写 `{capCents}` 编译失败）。
- 证实：`constraints_changed` 事件按受众三种模板零越权；照 Role A 写法复刻的模板把 v1、v2 上限都泄露给 provider。
- 证实：20 条注入 × {compromised, benign} × {customerSeesBudget true/false} = 80 组不变量全过（零越权、零 approvals、公开文本来自模板、金额 = 目录求和、日志无 payload）；去掉防线的对照组 10/20 条出现越权 → 语料与扫描器有灵敏度。
- 证实：`buildAgentContext` 白名单——provider 上下文里他方秘密零命中；customer 即使可见预算也看不到 `CANARY-FIN-7731`；端到端一轮 15 个可见面、462 个叶子零越权。
- 证伪：跨代理自由文本只有提案、事件、shared facts——**provider 写的目录标题**未定界进入他方代理上下文（INJ-15），已改为 `<untrusted_data>` 包装。
- 证伪：结构化字段过格式校验就够——`4800-01-01` 是合法日期却能把上限经模板公开，需要日期窗口语义校验；`CAP_480000` 能过 itemKey 正则，必须查目录成员关系。
- 证伪：TS 类型足以证明模板不碰私密字段——更宽的非字面量对象能通过结构类型检查，必须加显式取字段、运行时复核与 Proxy 读取测试。
- 证伪：shared fact 包进 untrusted 块就安全——customer 能把 finance 上限粘贴进 shared fact 发给 provider（INJ-17），需要写入时披露闸门。
- 证伪：公开文本不含私密字段 ⇒ 不含私密值——私密值与公开值相同（如 $900）时无法区分，canary 要先过 `lintCanaries`；手写的 `reads` 声明会漂移（customer 模板多声明一个字段被抓到），可见性矩阵必须由测试对账。

**关键证据**
```
Tests  157 passed (157)
rendered: Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred.
top-level keys read: actorRole,amountCents,deferredItemKeys,deliveryDate,itemKeys
Role-A leaky template violations: finance.capCents.v2(money:grouped) -> provider; finance.capCents.v1(money:grouped) -> provider
INJ-17 tool_spoof committed OVER_BUDGET viol=0 ... gate:DISCLOSURE_BLOCKED
date-channel summary: Customer proposes LOGIN + REPORTS for $900, delivery 4800-01-01. -> [ 'finance.capCents.v2:money:plain' ]
surfaces=15 leaves=462 hits=37 violations=0
```

**可复用代码**：`privacy-canary/src/types.ts`、`privacy-canary/src/variants.ts`、`privacy-canary/src/scanner.ts`（`scan`、`lintCanaries`、`unauthorizedFor`）、`privacy-canary/src/templates.ts`（品牌类型、`defineTemplate` 占位符类型检查、按受众事件模板与 `reads`）、`privacy-canary/src/agent.ts`（`buildAgentContext`、`wrapUntrusted`、`ServerOutputSchema`、`ACTIONS_BY_ROLE`）、`privacy-canary/src/gate.ts`（披露闸门）、`privacy-canary/src/pipeline.ts`（回合校验顺序、`projectRoomFor`、`collectSurfaces`、日志纪律；需改写成 mutation）、`privacy-canary/src/corpus.ts`（20 条语料 + `Assertion` DSL）、`privacy-canary/src/harness.ts`（`runCase`、compromised / benign stub、`naiveSurfaces` 对照）、`privacy-canary/src/fixture.ts`、`privacy-canary/test/*.test.ts` 与 `privacy-canary/test/templates.types.ts`。

## 7. 对设计文档的直接含义

标记：**改写** = 现有假设被证伪或需要补的设计点；**确认** = 已被实测证实，可以直接写成定论；**决策** = 需要在 18 里形成 ADR 的选择。

### 00-overview
- **改写**：术语表统一动作集（`escalate`，不用 `request_tradeoff`）、`toRole`、reasonCode 点分小写命名（见 0.1）。
- **改写**："与原方案的主要差异"补三条：执行唯一键由服务端派生；审批只追加；对他方可见的文本只来自模板。
- **确认**："代理的 recommend_accept 不是批准"在管线上可强制（代理输出永远不写 approvals，80 组注入用例零 approvals）。

### 01-product
- **决策**：`customerSeesBudget`（customer 是否看到 finance 的预算投影）直接改变披露矩阵与扫描期望，需产品拍板。
- **决策**：隐蔽信道政策——itemKey 选择、日期选择、`budget.over` 本身各泄露约 1 bit，provider 可反复提案二分出上限；建议对 provider 只显示 "blocked"、限制提案频率。
- **确认**：无可行解时（$4,700）系统向 finance 发 `escalate/infeasible`，不编造一致意见，可作为关键用户旅程。

### 02-domain-model
- **改写**：不变量补充——提案不可变且带 `contentHash`；`ProposalTerms` 的金额 / 交付日期 / 延后项全部由服务端从目录派生，模型只给 `includedItemKeys` 与 `deliveryDate | null`；`terms` 保存派生时的 `additionalCostCents` 作为"声明值"，供改价检测。
- **改写**：可执行性是派生量，不是存储状态：`isExecutable` = 哈希完整 ∧ 约束版本一致 ∧ 用**当前**目录与约束重跑规则无问题 ∧ 每个必需审批人最新一条为 approve 且绑定同一 `(proposalId, contentHash, constraintsVersion)`。
- **改写**：目录标题是 provider 写的自由文本，属于"他方可读的不可信文本"实体；shared fact 需要"披露决定"实体（作者确认记录）。
- **确认**：金额一律整数分（安全非负整数），求和溢出视为非法。

### 03-schema
- **改写**：approvals 改为只追加（每次决定一行，`by_proposal_user` + `_creationTime` 取最新），或"当前行 + approvalEvents 追加表"；不得 patch 覆盖决定。
- **改写**：executions 唯一键由服务端派生（`executionKey = proposalId`，或 `${roomId}:${proposalVersion}:${constraintsVersion}`），索引 `by_executionKey`，同一 mutation 内再查"该房间是否已有执行"；客户端 `operationId` 只用于请求去重与追溯。
- **确认 + 改写**：索引不唯一；每个需唯一的键只能有一个写入口，seed / 迁移脚本也走入口（`.unique()` 遇重复会让该键失败关闭）。
- **确认**：`v.*` 只管形状——金额整数性 / 非负 / NaN、字符串长度、日期格式在代码中校验；required-but-empty 用 `v.union(x, v.null())`，可缺省用 `v.optional`。
- **改写**：`stop_details.category` 存 `v.union(v.string(), v.null())`，不用封闭字面量联合；用量表存 `requestId`、`schemaVersion`、整数微美元成本；日志 / 回合记录只存 `outputSha256`、`outputBytes`，模型原文只进私有表。
- **改写**：删除字段只能在 handler 内 `patch({f: undefined})`，API 参数不能用 undefined 表达删除。
- **确认**：场景表加 `scopeChange_` 前缀，在 `schema.ts` 组合 engineTables + scenarioTables；`convex/` 目录用 camelCase。
- **决策**：选 workflow 时 runs 表存 workflowId，不建 attempts 表；选自建链时需要 attempts 表（`by_run_turn`、状态 `inFlight / succeeded / failed / timedOut / canceled`）。

### 04-state-machines
- **确认**：run 迁移"写状态 + `runAfter(0)` 启动 action"是原子的；mutation 失败时调度一起回滚。
- **改写**：run 状态加入 `canceled`（预算变更）与（自建链时）`timedOut`；所有提交迁移守卫 `status + attempt/turnIndex + constraintsVersion`，迟到结果记 `late_attempt_canceled` 而不是报错。
- **确认**：被调度 action 失败即 `failed`、不自动重试；`cancel` 不能中止在途 action，只能让它的结果被拒。
- **改写**：审批状态是"最新一行"的投影；约束或内容哈希变化后旧审批为 `stale`；**重新审批不能把规则失败的提案变回可执行**，提案迁移表需体现"规则阻断"独立于"审批阻断"。
- **确认**：workflow `onComplete` 结果 kind 为 `success | failed | canceled`，状态映射按此写。

### 05-protocol
- **改写**：模型输出根固定为 object：`{ turn: AgentModelOutput }`；全部字段 required，可空用 `nullable`；全部 `strictObject`；禁止 `z.record`、`.default()`；schema 中不得出现金额类属性名（做成测试）。
- **改写**：动作集统一为 `propose / counter(baseProposalVersion) / clarify(toRole, topic, question) / recommend_accept(proposalVersion) / reject(reason 枚举) / escalate(kind, toRole, options)`；`escalate.options` 只含范围选择，服务端用 `checkProposal` 定价后再展示。
- **改写**：写明哪些约束在解码层生效（自建 strict schema 下的 type、enum/const、required、additionalProperties:false、format）、哪些只在 Zod 事后生效（长度、maxItems、minItems ≥ 2、正则）→ 后者的违规是可预期的 `output.schema_violation`，进入有界重试。
- **改写**：服务端回合校验顺序写成固定流水线：记 usage → 查 `stop_reason` → JSON 解析 → strict Zod → 角色动作白名单 → 目录成员 → 日期合法 + 日期窗口 → 金额由目录求和 → reasonCode → 只追加写入。
- **确认**：`deliveryDate: null` 表示"取目录推导的最早日期"；stub 与真实代理共用同一输出 schema，信封里 stub 强制 `isSimulated: true`、model 强制 `false`。

### 06-rules-engine
- **确认**：规则层是零依赖纯函数（`checkBudget`、`checkProposal`、`isExecutable`），只吃已解析数据；zod 只在边界。
- **确认**：一次收集全部问题；结构性问题 `terms = null`、规则问题仍返回 `terms` 供界面展示被阻断条款。
- **改写**：reasonCode 合并两套清单（protocol-rules 的 20 个 + privacy-canary 的 `output.not_json`、`output.schema_violation`、`action.not_allowed_for_role`、`date.out_of_range`、`disclosure.blocked`、`disclosure.needs_own_confirmation` 等），统一命名。
- **改写**：新增日期窗口语义规则：交付日期 ≥ 今天 + 最长前置期，且 ≤ 今天 + 365 天；itemKey 必须属于已确认目录（不只过正则）。
- **改写**：`isExecutable` 在审批前与执行事务内各调用一次；目录同版本改价靠"声明值 vs 重算值"（`amount.claim_mismatch`）抓到。
- **改写**：reasonCode 的 `params` 按受众裁剪（`overByCents`、`headroomCents` 泄露预算，`date.after_deadline` 泄露私密截止日），以 `PRIVATE_PARAM_CODES` 为输入。
- **改写**：场景插件接口补充：模板必须声明 `reads` 并由 Proxy 测试对账；fixture 必须标注模拟并通过 `lintCanaries`；插件提供 `secretsOf(fixture)` 供隐私测试。
- **决策**：`contentHash` 依赖 `crypto.subtle.digest`，Convex 默认 V8 运行时是否可用未验证；备选纯 JS SHA-256 或放进 Node action。

### 07-permissions-privacy
- **改写**：proxy 的 `auth.protect()` 对 API / Route Handler 也是 307，不是 404；proxy 只做乐观登录检查，Route Handler 自己 `auth()` 并返回 401，真正授权在 Convex 函数内。
- **确认**：每个公开函数 `requireIdentity`（`UNAUTHENTICATED`）→ `requireUser`（`USER_NOT_PROVISIONED`）→ 成员 / 角色检查；被调度函数没有身份，鉴权在调度前完成并显式传 `actorUserId`。
- **改写**：列出**所有**进入他方代理上下文的用户文本字段（至少：shared facts、目录标题、提案公开说明），全部用 `<untrusted_data source=…>` 定界并清除伪造定界符。
- **改写**：shared fact 写入前过披露闸门：含他方秘密 → `disclosure.blocked`；只含作者本人秘密 → `disclosure.needs_own_confirmation`，确认后放行。
- **改写**：对他方可见的文本只来自模板；"模板不碰私密字段"按三层证明（品牌类型、显式取字段 + 运行时复核、Proxy 读取测试），事件按受众分模板，`reads` 声明由测试自动对账。
- **改写**：日志是 `ops` 受众：不含模型原文与简报内容，只记 id、code、哈希、长度；脱敏 `authorization`（SDK 以 Bearer 发 key）；Zod 错误只记 issue 路径。
- **确认**：`buildAgentContext` 白名单组装可行；"预算投影 ≠ finance 的 brief"。
- **确认**：`CLERK_SECRET_KEY` 不进客户端；字段裁剪必须在 Convex query 内完成。
- **决策**：`customerSeesBudget`、隐蔽信道政策（见 01）。

### 08-approval-execution
- **改写**：审批只追加，绑定 `(proposalId, contentHash, constraintsVersion)`；"撤回"也是追加一行。
- **改写**：执行唯一键服务端派生（见 03）；`operationId` 仅作请求去重。
- **确认**：执行 mutation 原子（三表写入后抛错全部回滚，同键重试成功）；错误通过 `ConvexError({code})` 传给前端。
- **改写**：执行事务内重跑 `isExecutable`（当前目录 + 当前约束 + 最新审批），不能只看审批是否到齐。
- **待验证**：并发双击在 OCC 下只产生 1 条 execution（见 §8）。

### 09-constraint-changes
- **确认**：预算变更 mutation 内"递增 `constraintsVersion` + 取消活动 run（`workflow.cancel` 或取消 pending 调度）"同事务；在途 action 的结果被丢弃，提交 mutation 的版本检查是第二道防线。
- **确认**：走查数字写进文档：$4,800 后旧 $900 提案 → `version.stale_constraints + budget.over + 3×approval.stale`；重新审批仍 `budget.over`；stub counter 只含必需项 $800；$4,700 → `escalate/infeasible → finance`。
- **改写**：目录改价也必须让旧提案失效（改价即递增目录版本，或至少靠 `amount.claim_mismatch` 兜底）；`budget.total_below_committed` 作为独立情况处理。
- **改写**：`constraints_changed` 事件按受众三种渲染（customer / provider / finance），不复用 Role A 的单模板。

### 10-agent-runtime
- **决策**：回合编排用 workflow（附 §4 的六条前提）或自建链 + watchdog；不用 action-retrier。
- **改写**：模型调用只走 `callModel()`：`messages.create`（不用 `parse()`）；固定模型 `claude-opus-5-5`，显式 `output_config.effort`；不传 `thinking`、采样参数、`tool_choice`、prefill；请求由封装函数自己构造字面量，不透传调用方对象。
- **改写**：结构化输出用统一 strict 生成器的结果，直接放 `output_config.format`（或 `jsonSchemaOutputFormat(schema, {transform:false})`）；模块加载时生成，sha256 前 16 位记为 `schemaVersion`。
- **改写**：`max_tokens ≤ 21,333`（默认 16,000），`timeout` 与 `maxRetries` 显式设置，保证 `timeout × (maxRetries + 1) + 退避` 低于 Convex action 上限；跨 action 重试交给引擎。
- **改写**：失败闭集（16 类）与处置：`refusal` 不重试、转人工（workflow 下抛 `NonRetryableError`）；`max_tokens` 可重试一次；`schema_mismatch` / `invalid_json` 有界重试；`bad_request` / `auth` 视为配置错误告警不重试；只要收到响应就落库 usage 与 `requestId`，成本按整数微美元。
- **确认**：workflow handler 内不能 `fetch`，模型调用必须在 `step.runAction` 里；stub 模式与真实代理共用 schema、确定性输出、标注模拟。
- **改写**：workpool `maxParallelism` = Anthropic 全局并发上限；rate-limiter 在 `startRun` 同事务内做每房间 / 每日限流；单活跃 run 由 `startRun` 自查。

### 11-architecture
- **确认**：版本集 next 16.4.3、react 19.3.1、convex 1.48.0、@clerk/nextjs 7.9.20、typescript 6.0.3、eslint 9.39.5、vitest 5.0.5、convex-test 0.0.65、vite 8.3.5、zod 4.6.7、@anthropic-ai/sdk 1.1.0、pnpm 11.25.0；选 workflow 时加 workflow 0.4.10 / workpool 0.4.14 / convex-helpers 0.1.129（rate-limiter 0.4.2 可选）。
- **确认**：分层 `core/engine`、`core/scenarios/<kebab>`、`convex/`、`src/`，依赖方向由 eslint 强制；`@core/*` 别名在 vitest 与 Convex esbuild 下都可用。
- **改写**：`convex/tsconfig.json` 加 `"types": ["node"]`；`_generated` 入库；**codegen 策略取决于是否用组件**：无组件 → `convex codegen --system-udfs --typecheck disable` 离线 + CI 漂移检查；有组件 → CI 用 `gen-generated.mjs` 或连接 dev 部署，漂移检查需重新设计。
- **改写**：条件 Provider + `/setup` 页 + `auth.config.ts` 缺变量抛错，整体 fail closed；每个环境带变量单独构建。
- **待验证**：zod 4 在 Convex 函数里的包体积 / 冷启动（stub 打包未压缩约 772 KB）。

### 12-api
- **确认**：所有公开函数先鉴权再做成员 / 角色检查；`internal.*` 接收 `actorUserId`；引用同一 API 图的函数写显式返回类型。
- **改写**：错误一律 `ConvexError({code, message})`，code 与 reasonCode 同一命名空间；参数不能用 `undefined` 表达删除。
- **改写**：函数目录对齐 spike：`runs.startRun`（含限流与单活跃检查）、`internal.turns.commitTurn`（唯一写入口）、`rooms.changeBudget`（递增版本 + 取消）、`approvals.recordApproval`（只追加，替代 upsert）、`execution.executeProposal`（服务端键）、`sharedFacts.submit`（披露闸门）、`rooms.view`（按角色投影）。
- **改写**：Next Route Handler（如有）自行返回 401，不依赖 proxy。

### 13-frontend
- **确认**：未配置时 `BackendGate` 不挂载 Convex hook；SSR 不建 WebSocket，显示加载态。
- **改写**：`recommend_accept` 显示为"建议，不是批准"；阻断原因按受众渲染 reasonCode（provider 只见 blocked）；所有模拟数据带标识。
- **确认**：浏览器只收到 `rooms.view` 的角色投影，不收私密字段再隐藏。

### 14-scenario-scope-change
- **改写**：主 fixture 用 protocol-rules 的目录（5 项合计 $1,400；必需 $800；+usage_dashboard $900；截止 2026-11-20；v1 $5,000 / 已承诺 $4,000，v2 $4,800，v3 $4,700），叠加 privacy-canary 的三方 canary 与私密值，并过 `lintCanaries`。
- **改写**：加入日期窗口规则与"itemKey 必须在已确认目录"；目录标题标为不可信文本。
- **确认**：公开模板示例句与按受众的 `constraints_changed` 三种渲染可直接写进文档。

### 15-operations
- **改写**：每环境单独构建；`.env.example` 与 CI 设 `CLERK_TELEMETRY_DISABLED=1`；`scripts/check-env.mjs` 启动检查。
- **改写**：seed / reset 必须走与生产相同的写入口。
- **改写**：选 workflow 时，改步骤的部署前先排空在途实例，或新增 `negotiationV<n>`。
- **改写**：日志纪律（只记哈希 / 长度，脱敏 Bearer）；用量与成本按 `toUsageRecord` 记整数微美元。
- **注意**：pnpm 11 会把过新包写进 `minimumReleaseAgeExclude`，锁版本时要审查。

### 16-testing
- **确认**：convex-test 配置——`environment: edge-runtime`、`server.deps.inline: ["convex-test", /@convex-dev/]`、模块 glob 用 `["./**/*.*s", "!./**/*.*.*s"]`；`vi.useFakeTimers()`，排空用 `finishAllScheduledFunctions(vi.runAllTimers)`，延迟用 `advanceTimersByTime` + `finishInProgressScheduledFunctions`；**含 watchdog 的流程逐个推进定时器**；`withIdentity({subject, issuer})`；错误断言用 `instanceof ConvexError` + `data.code`。
- **改写**：convex-test 不支持取消 inProgress 的调度函数、不模拟并发——OCC / 并发 / 生产限额用例单列为 live-deployment 套件。
- **确认**：纯函数单测直接迁入 protocol-rules 的 92 个表驱动用例。
- **确认**：隐私测试三件套 `secretsOf` + `collectSurfaces`（convex-test 中以各身份调用 `rooms.view`、渲染后的事件、`buildAgentContext` 输出、console spy 捕获的日志）+ `scan`，先跑 `lintCanaries`；注入用 compromised stub，断言分 invariant / compromised outcome / live soft 三类，并保留去掉防线的灵敏度对照。
- **确认**：SDK 类型契约（`type-tests.ts`）在升级 SDK 时先跑；假 fetch 夹具测 `callModel` 分类；schema 快照 + 哈希测试；分层 lint 反例测试。

### 17-roadmap
- **确认**：`defineScenario` 插件契约 + 场景表前缀 + 模板 `reads` 对账，可容纳第二个场景。
- **待验证**：`beta.messages` 的 `fallbacks:'default'` 与 `output_config.format` 能否共用、回退模型输出是否同样受 schema 约束；多模型扩展前先验证。

### 18-decisions-open-questions（需新增或改写的 ADR）
1. 回合编排引擎：workflow vs 自建链（附 §4 对比表），不用 action-retrier。
2. 审批只追加 vs 当前行 + 事件表。
3. 执行唯一键的派生方式。
4. 模型调用：`create()` + 自行 `safeParse`，不用 `parse()`；统一 strict schema 生成器。
5. 模型输出根为 `{turn}` 包装；动作集与引用字段（版本号 vs Id）。
6. reasonCode 命名与 params 受众裁剪。
7. codegen 与 CI 漂移检查策略（与 1 联动）。
8. `customerSeesBudget`；隐蔽信道政策。
9. `contentHash` 运行时（Web Crypto vs 纯 JS vs Node action）；zod 进入 Convex 包的体积。

## 8. 仍无法离线验证、必须在真实部署上验证的清单

| # | 领域 | 待验证项 | 建议验证方式 | 影响文件 |
| --- | --- | --- | --- | --- |
| 1 | Convex | OCC：并发 `executeProposal` / `recordApproval` / `startRun` 在空索引区间上，后提交者是否冲突重试并看到前者插入，最终只有 1 行 | dev 部署上并行发起 N 个相同业务键的调用并计数 | 03、08、10 |
| 2 | Convex | 被调度 action at-most-once 且不重试；被调度 mutation 遇瞬时错误自动重试且 exactly-once | 注入可控失败并观察 `_scheduled_functions` 与业务表 | 04、10 |
| 3 | Convex | 生产中被调度函数同样没有调用者身份 | 调度一个记录 `getUserIdentity()` 的函数 | 07、12 |
| 4 | Convex | 事务限额、action 超时、生产错误信息格式（`ConvexError` data 是否原样到达前端） | dev 部署 + 前端调用 | 10、12、13 |
| 5 | Convex | `NaN` / `Infinity` 写入 `v.number()` 的行为 | dev 部署直接写入 | 03、06 |
| 6 | Convex | 默认 V8 运行时里 `crypto.subtle.digest` 是否可用；`"use node"` 运行时差异 | 部署一个计算 SHA-256 的 query/mutation | 06、10 |
| 7 | Convex | zod 4 进入 Convex 函数后的包体积与冷启动 | 推送后看部署大小与首调延迟 | 10、11 |
| 8 | Convex | 真实 codegen 产物与手写 `_generated` 是否一致；连字符模块路径是否被服务端接受（建议直接回避） | 连 dev 部署跑 `convex dev` 后 diff | 11 |
| 9 | 组件 | 平台级 action 中断 / 超时时 workpool / workflow 如何检测并上报；`onComplete` 自身抛错时是否仍 exactly-once；对已完成实例 `workflow.cancel` 是否抛错；rate-limiter 回滚语义 | dev 部署上故障注入 | 04、10 |
| 10 | Convex | 客户端断线重发、响应式订阅推送、`_creationTime` 与提交顺序、`commitTs` | 浏览器端到端 | 03、13 |
| 11 | 隐私 | 真实 WebSocket 负载、Convex 日志、`ConvexError` 消息的金丝雀扫描（离线只用 `projectRoomFor` 模拟） | 以三种身份订阅 `rooms.view` 并抓包扫描 | 07、16 |
| 12 | Clerk | 真实登录到 Convex token 的流程（原生集成 `aud=convex` vs `convex` JWT 模板）、`applicationID` 校验、`whoami` 端到端；`auth.config.ts` 缺变量时推送报错形态 | Clerk 开发实例 + dev 部署 | 07、11、15 |
| 13 | Claude API | API 是否接受 strict schema（`anyOf` 分支内 `const`、`format: date`、6 个分支、6.8–7.6 KB）；根级 `anyOf` 是否可用（默认改用 `{turn}` 包装规避）；`type` 数组写法；`$defs` 命名影响；可选属性（已改为全 required 规避） | 预发布环境少量真实调用 | 05、10 |
| 14 | Claude API | 解码是否真正强制 `const` / `enum` 与 `additionalProperties:false` | 构造诱导性提示，统计 `schema_mismatch` | 05、07 |
| 15 | Claude API | `effort:'low'` 下 thinking token 量、`max_tokens: 16000` 是否够用、拒绝率与 `schema_mismatch` 率 | 预发布批量跑 fixture | 10、15 |
| 16 | Claude API | SDK 内部重试的失败尝试是否计费；`model_context_window_exceeded` 触发条件；`fallbacks` + `output_config.format` | 预发布 + 账单核对 | 10、15、17 |
| 17 | 模型行为 | 注入 soft 断言（INJ-01、02、16）；真实模型是否只引用给定 itemKey、是否倾向 `escalate`；`publicRationale` 是否夹带他方私密值（rationale 只给本方看） | 预发布用 `claude-opus-5-5` 跑语料，只断言结构性质 | 05、07、16 |
| 18 | Next / CI | GitHub 上 CI 实际运行（`actions/checkout@v7`、`setup-node@v7` 沿用原仓库版本号）；`pnpm dev` / Turbopack HMR | 推到测试仓库跑一次 | 11、15 |

另有两类离线测不出、需要政策而非验证的问题：合法选择里的约 1 bit 隐蔽信道（itemKey、日期、`budget.over`），以及语义改写泄露（如 "a bit under five grand"）。前者在 01 / 07 拍板政策，后者靠"对他方可见的文本只来自模板"从结构上杜绝。
