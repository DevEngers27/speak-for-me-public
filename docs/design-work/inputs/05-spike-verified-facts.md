# 05 · 平台事实实测修正（来自 6 个可运行 spike，2026-10-24）

> 本文件是 inputs/04 的实测修正与补充。**凡与 04 冲突处，以本文件为准。** 完整报告与可复用代码见 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/README.md（约 50K 字，含 18 项必须在真实部署上验证的清单）及各 `*-report.md`。

## A. @anthropic-ai/sdk 1.1.0 结构化输出（spikes/anthropic-zod、protocol-rules）
1. `zodOutputFormat()` 会把 enum、const、minLength/maxLength、pattern、minimum/maximum、maxItems、minItems≥2、default 全部降级为 description 文字。发给 API 的 schema 只保留 type、anyOf、properties、required、additionalProperties:false、受支持的 format、$ref/$defs。**判别字段 action 在解码层不受约束**，伪造的 action:'approve' 能过 SDK schema，只能靠之后的 Zod 拦。
2. 判别联合不能直接作为输出根：zodOutputFormat 生成的根没有 type；jsonSchemaOutputFormat 直接抛错。**根必须包一层对象 `{ turn: AgentModelOutput }`。**
3. `messages.parse()` 在 max_tokens 截断、带文本的 refusal、Zod 不匹配、多个 text 块时**直接抛 AnthropicError，连 usage 一起丢失**；只有 refusal 且内容为空时才返回 parsed_output=null（04 和技能文档里"失败返回 null"的说法有误）。推荐：`messages.create()` + 自建严格 schema（保留 enum/const，或 `jsonSchemaOutputFormat(schema, { transform: false })`）+ 自己 `safeParse`，这样 usage、stop_reason 都能拿到并记录。
4. 类型检查挡不住会 400 的写法：thinking disabled/enabled/between_tools、强制 tool_choice、prefill、拼错的模型 ID、非字面量对象里的 temperature 都能通过 tsc。**必须靠封装函数的运行时白名单。**
5. 模型输出里不要用 z.record（被改写成只能输出 {}）和 .default()（字段变 required、默认值只在描述里）；全部字段 required，用 nullable 代替 optional；用 strictObject；schema 中不得出现任何金额属性名（写成测试）。
6. 非流式 max_tokens 上限约 21333，再大必须流式。stop_details.category 运行时按 string|null 处理。

## B. Convex 1.48 语义（spikes/convex-test、convex-components、skeleton）
1. 同一 mutation 内"先按索引查再 insert"在串行条件下幂等；mutation 原子，抛错会连同已调度的任务一起回滚（"写状态 + runAfter(0)"是原子组合）。**OCC 并发冲突无法用 convex-test 验证**（它一次只跑一个函数），必须在真实 dev 部署上测。
2. **客户端生成的 operationId 防不住重复执行**（两次点击两个 id → 两条 execution）。执行唯一键必须由服务端从业务身份派生（例如 hash(roomId, proposalId, constraintsVersion)），客户端 id 只用于请求去重。
3. 用 patch 覆盖决定的审批 upsert 与"历史不可篡改"冲突：**审批应只追加**（每 (proposal, user) 取最新一行），撤回也是追加一行。
4. **被调度的 mutation / action 内 getUserIdentity() 为 null**，即使调度者已登录 → 必须显式传 actorUserId。
5. 被调度 action 抛错 → failed、不重试；scheduler.cancel → canceled。v.* 只校验形状：负数、小数、NaN、空串都能写入，金额/日期/长度必须在代码里校验。
6. 1.48 的 mutation 内 ctx.runMutation 是子事务：内层抛错可被外层捕获并只回滚内层。
7. 组件实测（workflow 0.4.10 / workpool 0.4.14 / action-retrier 0.3.1 / rate-limiter 0.4.2）：workflow 版编排代码最短（68 行 vs 自建链 108 行），内置退避重试、认 NonRetryableError、取消在同一事务内完成、步骤日志可查；代价是确定性约束（handler 内不能 fetch、在途实例下改步骤会报 Journal entry mismatch，改代码前要排空或起新版本名）。**action-retrier 不要用**（不认 NonRetryableError、onComplete 里 cleanup 会静默卡死）。rate-limiter 可与 startRun 同事务使用。无论选哪条路，提交结果的 mutation 都必须做过期拒绝 + 幂等（runId + turnIndex）。
8. `npx convex codegen --system-udfs --typecheck disable` 可离线生成 _generated（无组件的应用；带组件需要 CONVEX_DEPLOYMENT）。两次生成逐字一致 → **提交 _generated 并在 CI 做漂移检查**。convex-test 文档里的 glob 在 Vite 8 下匹配不到文件，须用 `['./**/*.*s', '!./**/*.*.*s']`；TS 6 下 convex/tsconfig 需加 `"types": ["node"]`。
9. Next 16.4 + Clerk 7.9：proxy.ts 里 auth.protect() 对 API/JSON 请求也返回 307 到登录页（不是 04 说的 404）→ Route Handler 自己返回 401，真正的授权在 Convex。无凭据时 /rooms 307 到 /setup 的 fail-closed 骨架已验证可构建。NEXT_PUBLIC_* 在构建期未定义时会被服务端代码在运行时读取，容易出现"半配置"状态，按环境分别构建。
10. 版本组合已验证可装可建：next 16.4.3 / react 19.3.1 / convex 1.48.0 / @clerk/nextjs 7.9.20 / typescript 6.0.3 / eslint 9.39.5 / vitest 5.0.5 / convex-test 0.0.65 / vite 8.3.5 / zod 4.6.7 / pnpm 11.25.0；eslint no-restricted-imports 能强制 core ← convex、core ← src 的分层。

## C. 规则引擎与隐私（spikes/protocol-rules、privacy-canary）
1. 零依赖纯函数 checkBudget / checkProposal / isExecutable 可行（8.7 KB，92 个表驱动用例通过）：恰等于上限通过；total < committed 独立错误码；一次收集全部问题；结构性错误时 terms=null；同版本目录改价靠"声明金额 vs 重算金额"发现（amount.claim_mismatch）。
2. 原 README 数字可复现：v1 选 $900；上限降到 $4,800 后旧提案 version.stale_constraints + budget.over + 审批全部 stale；stub 改提 $800 的 counter 恰等于上限通过；$4,700 时输出 escalate。**可执行性必须用当前状态重算，重新审批不能恢复旧提案的可执行性。**
3. 按受众判断泄露的扫描器可行（金额、日期、字符串多写法）。实测出四条新泄露路径：provider 写的目录标题未定界就进了他方代理上下文（必须包进 untrusted 块）；日期值可编码秘密（4800-01-01 合法但泄露上限 → 需要日期窗口语义校验）；customer 可把 finance 上限粘进 shared fact（写入时需披露闸门）；私密值与公开值相同（$900）时 canary 分不清 → canary 须过 lint。
4. **隐蔽信道是产品决策**：itemKey 选择、日期、budget.over 各泄露约 1 bit，provider 可靠反复提案二分出上限。建议 provider 只看到 blocked，并对提案频率限流。reasonCode 的 params（overByCents、headroomCents、after_deadline）按受众裁剪。
5. 公共文本只能由模板从白名单字段渲染；TS 结构化类型不足以证明模板不碰私密字段，需显式取字段 + 运行时复核 + Proxy 读取测试；可见性矩阵要由测试自动对账。

## D. 需要在最终设计里统一的命名（spikes README §0.1）
动作集统一为 propose / counter / clarify / recommend_accept / reject / escalate（不用 request_tradeoff）；收件人字段叫 toRole；reasonCode 用小写点分、按领域分组；两份严格 schema 生成器合并为一份。
