# 反驳审查：模型与代理调用层（model-layer.md）

> 审查者：技术选型反驳代理。日期 2026-10-24。被审文件：`scratchpad/techstack/model-layer.md`。
> 引用缩写同原文：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`，`SDK:` = `NM:@anthropic-ai/sdk/`（1.1.0），`SK:` = claude-api 技能目录（以 Skill 工具加载；注意该目录下**没有** `SKILL.md` 文件，技能正文只能经 Skill 工具取得），`DL:` = `scratchpad/techstack-dl/`，`RP:` = 本审查的探针目录 `scratchpad/techstack/_review_probe/`。

## 0. 结论

**判定：accept_with_changes。** 主方向正确，且与任务书核心与技能规则一致：全部 `claude-opus-5-5`、直接用 SDK 加薄网关、`output_config.format` 配保留 `enum`/`const` 的自建 schema、`create` 后自己 `safeParse`、按方成链的缓存、中途 `role:"system"` 作运营者通道、默认开 `fallbacks:"default"`。15 条待验证声明里，11 条成立，2 条部分成立，2 条被推翻。需要改的是 5 处实现细节：非流式调用配 16k–20k `max_tokens` 和 180s 超时，三者互相矛盾；评测 runner 依赖 Node 24 类型剥离，跑不起来；缓存断点超出 4 个的上限；回退继承的证据引错了地方，且省略 `thinking` 会让 Opus 4.8 回退时不思考；成本封顶和双代码路径偏重。

| 编号 | 严重度 | 一句话 |
| --- | --- | --- |
| r01 | medium | 非流式 + `max_tokens` 16k/20k + `timeout` 180s 自相矛盾；显式 timeout 让 SDK 的 21,333 守卫失效；最坏 4 次 HTTP 尝试 |
| r02 | medium | 引用的"回退继承 format/effort"注释只描述数组条目；V1 用良性请求触发不了回退，证明不了回退路径 |
| r03 | low | 省略 `thinking` 时，cyber 类拒绝路由到 Opus 4.8 后会以"无 thinking"运行；应显式传 `{type:"adaptive"}` |
| r04 | medium | Node 24 类型剥离要求相对导入写 `.ts` 扩展名、不能用 enum；`node evals/run.ts` 直接导入引擎代码会失败 |
| r05 | medium | "单回合超过 15 块就补断点"不可行，4 个断点已全部用掉；评审"扫描候选用 `low`"与"同一方 effort 相同"矛盾 |
| r06 | low | promptfoo "开源是否保留只有二手报道"被推翻：npm README 一手写明仍是 MIT；13 个 peer 全部为可选 |
| r07 | low | 回退开/关走 beta 与非 beta 两条路径，返回类型不同；统一走 `client.beta.messages.create` 更简单 |
| r08 | low | 400 一律打开全局熔断，范围过大；缺 401/403/413 分支 |
| r09 | low | 三个范围的预留/结算偏重，全局日计数文档是 OCC 热点；v1 用"run 级 attempt 上限 + 全局日计数"就够 |
| r10 | low | 原始请求 blob 复制了私密简报，没有保留期和最小化策略 |
| r11 | low | 事实小修：`@convex-dev/agent` 的 peer 漏了 `@ai-sdk/provider-utils ^5.0.0`；SDK 在 1.0.0 从 MIT 改为 Apache-2.0 |

## 1. 逐条核对待验证声明

| # | 声明（摘要） | 结果 | 证据（访问日期 2026-10-24） |
| --- | --- | --- | --- |
| 1 | SDK 最新 1.3.0（10-23）、仓库 1.1.0、1.0.0 于 10-21T16:00Z；Apache-2.0；peer zod `^3.25.0 \|\| ^4.0.0` | **成立** | `npm view @anthropic-ai/sdk`：1.0.0 `2026-10-21T16:00:53Z`、1.1.0 `10-21T22:03Z`、1.2.0 `10-23T13:13Z`、1.3.0 `10-23T23:31Z`；peer zod 标为 optional；`NM:@anthropic-ai/sdk/package.json` 中 version 1.1.0、license Apache-2.0。补充：1.0.0 之前一天还在发 0.x（0.137.0 发布于 2026-10-20T22:23Z），所以 1.x 是连续演进来的，不是停更后重启 |
| 2 | 1.1.0 与 1.3.0 的四个 helper 文件逐字节相同 | **成立** | `cmp` 四个文件全部相同（`SDK:` 对 `DL:sdk130/package/`）。1.2.0、1.3.0 的 CHANGELOG 只改了 tool runner、报表端点和错误文案，与本层无关 |
| 3 | `zodOutputFormat` 把 enum/const/边界挪进 description；`z.toJSONSchema(io:'output')` 保留它们，但输出 `oneOf` 与 `$schema` | **成立** | 重跑 `techstack-probe/probe.cjs` 结果一致；原因是 `SDK:lib/transform-json-schema.js` 只取出白名单键，其余键全部并进 description。注意：技能 `SK:shared/tool-use-concepts.md:546` 写明 API 支持 `enum`/`const`，所以 SDK 的转换比 API 更保守，B1 理由成立 |
| 4 | `jsonSchemaOutputFormat(schema,{transform:false})` 原样透传，根节点必须是 object | **成立** | `SDK:helpers/json-schema.js:14-21` |
| 5 | `parse()` 在 JSON 或 Zod 失败时抛 `AnthropicError` | **成立** | `SDK:lib/parser.js:52-64`（catch 后 `throw new AnthropicError`） |
| 6 | `BetaFallbackParam` 注释写明回退继承 format/effort；`BetaFallbacksParam = Array<…> \| 'default'` | **部分成立** | 文字确实在 `messages.d.ts:3943-3962`，类型在 4032。但那段注释写在**数组条目**的 `output_config` 字段上（"combined with the request's `output_config` one field at a time"）；`'default'` 的注释（4018-4031）只说"server-defined default fallback configuration"。另见 r02 |
| 7 | 技能：用户没点名就一律用 `claude-opus-5-5`，不得为省钱降级；Opus 5.5 代码默认带 `fallbacks:'default'` 并告知用户 | **成立** | SKILL "Current Models"（"ALWAYS use `claude-opus-5-5`… Never downgrade for cost"）；Fable 5.1 节 refusal 条目（"When you write … `claude-opus-5-5` … code, include the server-side `fallbacks` parameter by default … Tell the user"） |
| 8 | Opus 5.5：effort 默认 medium、thinking 不可关、强制 `tool_choice` 400、`reasoning_extraction` 不回退；Haiku 5.5 无服务端回退 | **成立** | `SK:shared/model-migration.md:2013-2017`（medium 默认；medium 超过 Opus 5 的 high）、`:2024`（"`reasoning_extraction` declines are not retried on a fallback model"）、`:2349`（Haiku 5.5 没有服务端回退）；SKILL Thinking 表 |
| 9 | Opus 5.5 价格 $4/$20、缓存读 $0.20、写 5m $5 / 1h $8；最小前缀 512；effort 一变 messages 缓存失效；向前回看 20 块 | **成立（附注）** | SKILL 价格表；`prompt-caching.md:144`（写入 1.25× / 2×，读 0.05×）；`:135`（512 token，原文附"使用前查文档"）；`:226`（effort 变化必定使 messages 缓存失效，**某些模型上连 tools/system 段也失效**，原文漏了后半句）；`:244`（20 块回看窗口） |
| 10 | Convex：默认运行时 action 30 分钟、Node 10 分钟、文档 1 MiB、Node action 参数 5 MiB | **成立** | WebFetch https://docs.convex.dev/production/state/limits ：表格写 Convex 运行时 action 30 分钟、Node 运行时 10 分钟；文档 1 MiB；函数参数一般上限 16 MiB，Node action 只到 5 MiB；Free/Starter 套餐并发 action 上限 64 |
| 11 | `@ai-sdk/anthropic` 4.0.87：发 `anthropic-version: 2023-06-01`；refusal 映射为 content-filter；支持 effort、fallbacks（default 与数组）、between_tools、中途 system（自动加 beta） | **成立** | `DL:aisdk/package/dist/index.js:7055`（2023-06-01）、`:3325`（`case "refusal": return "content-filter"`）、`:1061`/`:3951`（fallbacks 两种形式）、`:2361`（加 `mid-conversation-system-2026-04-07`）、`:930`（between_tools）、`:7022`（VERSION 4.0.87）。对照：`SDK:client.js:966` 发的是 `2026-10-21` |
| 12 | `ai` 7.0.152 与 provider 都是 Apache-2.0、node ≥22；agent 0.7.8 为 Apache-2.0，peer `ai ^7`、`@ai-sdk/provider ^4`、`convex ^1.46`、`convex-helpers ^0.1.127` | **基本成立** | `npm view`：以上都对；但 agent 的 peer 还有 `@ai-sdk/provider-utils ^5.0.0`、可选的 `react`，engines node ≥22（r11） |
| 13 | promptfoo 0.125.0：MIT、node ≥22.22.0、10-23 更新；OpenAI 于 2026-03-09 宣布收购，开源是否保留只有二手报道 | **前半成立，后半推翻** | `npm view promptfoo`：MIT、`>=22.22.0`；npm 上的 README（0.125.0）原文："Promptfoo is now part of OpenAI. Promptfoo remains open source and MIT licensed."，属于一手声明。收购日期 03-09 有多处报道（WebSearch：appsecsanta.com/promptfoo、qaskills.sh）。13 个 peer 在 `peerDependenciesMeta` 中全部为 optional；直接依赖 76 个（r06） |
| 14 | Opus 5.5 上中途 system 不需要 beta 头；回退目标（Opus 5 / Opus 4.8）也支持中途 system 与结构化输出 | **成立（按文档）** | SKILL "Mid-Conversation System Messages"：列表含 Opus 5、Opus 5.5、Opus 4.8，"no beta header"；`model-migration.md:1392`："supported fallback targets are `claude-opus-4-8` and `claude-opus-5`"；`:995`：cyber 类拒绝路由到 Opus 4.8。`SDK:…/beta/messages/messages.d.ts:4630, 5182`：beta 路径也有 `BetaSystemMessageParam`。这三项能否在**同一请求**里共存，仍要实测（04 待验证 #7 没有关闭） |
| 15 | Node 24 默认用类型剥离直接运行 `.ts` | **部分推翻** | RP 实测（Node v24.21.0）：`process.features.typescript === "strip"`，`a.ts` 用 `./lib.ts` 导入能跑；`b.ts` 用无扩展名的 `./lib` 报 `ERR_MODULE_NOT_FOUND`；`c.ts` 含 enum 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。仓库的 `tsconfig.json:15` 是 `moduleResolution: "bundler"`，Next/Convex 代码惯用无扩展名导入（r04） |

另外两条原文当作前提的事实：

- **推翻**："非流式请求的 `max_tokens` 必须 ≤ 21,333（C5）"在本设计下并不是 SDK 强制的约束。`SDK:resources/messages/messages.js:32-35` 只在 `timeout == null` 时才检查；网关给客户端设了 `timeout: 180_000`，这道守卫就被跳过了。真正的约束变成了"180s 内能否生成完"（r01）。
- **成立**：SDK 1.x 发送 `anthropic-version: 2026-10-21`（`SDK:client.js:966`），所以"与 AI SDK 并存两套 API 版本语义"这条否决理由成立。

## 2. 问题与修改建议

### r01（medium）非流式 + 大 `max_tokens` + 180s 超时互相矛盾
- 证据：§4.4 设定 `maxTokens` 16,000/12,000、截断重试用 20,000，非流式，`timeout: 180_000`，`maxRetries: 1`。180s 内生成 16,000 token，需要持续约 89 token/s；生成 20,000 token 需要约 111 token/s（纯算术，实际速度要等 V4 实测）。达不到这个速度，被截断的那次重试就会稳定超时，SDK 再重试一次，然后 Convex attempt 再来一轮。一个逻辑回合最多发出 4 次 HTTP 请求，每次都可能为已生成的 token 计费。技能默认的写法是："may involve … high `max_tokens`" 的请求用流式加 `.finalMessage()`（SKILL Defaults）。
- 修改：网关改用 `client.beta.messages.stream({...}).finalMessage()`，网关接口与分支表不变；由 Convex 层的总截止时间（`AbortSignal`）兜底，不靠 SDK 超时重试；`maxRetries` 只留给 429 和连接错误，或者干脆设为 0，统一交给 attempt 层。删掉 `retryMaxTokens`：+25% 的余量几乎救不回截断，因为截断说明 thinking 失控了。`max_tokens` 改为直接转 `HumanRequest`，或者降一档 effort 重试（会断缓存，要写进 18-decisions）。同时把 C5 改写成"显式设 timeout 时 SDK 不检查 21,333"。

### r02（medium）回退继承的证据引错位置，V1 证明不了回退路径
- 证据：`messages.d.ts:3943-3962` 是 `BetaFallbackParam.output_config` 的注释，讲的是数组条目的覆盖规则。`model-migration.md:1420` 还说条目里的 `thinking`/`output_config` 覆盖"rolling out"。`'default'` 形式的继承语义来自"在回退模型上重跑同一个请求"（`model-migration.md:995, 2026`），结论大概率是对的，但原文引用的证据不支持它。另外，V1 用的是良性请求，回退根本不会被触发，所以 V1 只能证明"带 fallbacks 的请求被接受"。
- 修改：§4.7 改成按上述来源表述；V1 的断言收窄为"请求被接受、`usage.iterations` 字段形状正确"。回退产出的质量靠线上指标盯：`fallbackServed=true` 时的 `schema_invalid` 率与规则拒绝率，并设告警阈值。原文"评测显示回退产出 schema_invalid 更高"这一关闭条件，在离线评测里同样触发不了。

### r03（low）省略 `thinking` 时，回退到 Opus 4.8 会不思考
- 证据：SKILL Thinking 表中，Opus 4.8/4.7 一行写着"Omitting `thinking`: Runs **without** thinking"。cyber 类拒绝的默认路由是 Opus 4.8（`model-migration.md:995`）。在 Opus 5.5 上，`{type:"adaptive"}` 与省略等价，显式传没有任何代价。
- 修改：§4.4 模板显式写 `thinking: { type: "adaptive" }`。也要说明：这个领域触发 cyber/bio 拒绝的概率很低，所以这一项是零成本的防御，不是主要风险。

### r04（medium）评测 runner 不能依赖 `node evals/run.ts`
- 证据：见第 1 节第 15 条的 RP 实测。引擎代码只要用了无扩展名导入、路径别名、enum、namespace 或参数属性中的任何一种，直接 import 就会失败。
- 修改：任选其一，写进 11-architecture。（a）评测作为 Vitest 的一个 project 运行（`vitest run --project eval`）：16-testing 用的 convex-test 本来就基于 Vitest，复用同一套解析配置，不新增依赖类别；（b）全仓约定 `.ts` 扩展名导入，加 `allowImportingTsExtensions` 与 `erasableSyntaxOnly`，并禁止别名。推荐（a），它也是更简单的方案。

### r05（medium）缓存断点预算不够，effort 规则自相矛盾
- 证据：§4.3 已用 BP1–BP4，API 每个请求最多 4 个断点（SKILL Prompt Caching），所以"补一个断点"会多出第 5 个。§4.1 评审写"扫描候选：`low`"，又说"同一方各路由 effort 相同"。`prompt-caching.md:226`：effort 一变，messages 缓存必定失效，某些模型上 tools/system 段也会失效。
- 修改：（a）事件按"本方本次调用以来新增"合成一个 block 追加，每回合只增加 1 个位置，彻底避开 20 块窗口。代价是要记录每方的 `lastRenderedSeq`，或者保持"一条事件一个 block"，同时明确 v1 每回合事件数远低于 20、超过时只告警。（b）如果评审确实需要 `low`，用 per-message effort（beta `mid-conversation-output-config-2026-07-01`，Opus 5.5 支持，`prompt-caching.md:83`），不要改顶层 effort。否则删掉"扫描候选：low"。

### r06（low）promptfoo 的否决理由要更新
- 证据：见第 1 节第 13 条。
- 修改：删掉"收购后路线图不确定"这条理由，保留"判分必须运行引擎代码、需要自定义 provider，等于重写一遍 E1"和"76 个直接依赖"。否决结论不变。

### r07（low）双代码路径
- 证据：`fallbacksOn=false` 时改走 `client.messages.create`，返回 `Message`，否则是 `BetaMessage`；`usage.iterations` 等字段的类型也不同。
- 修改：一律调 `client.beta.messages.create`（或 `.stream`），只按条件加 `betas`/`fallbacks`。网关只处理一种类型，V8 的分支单测也减半。

### r08（low）错误分支过粗
- 证据：§4.5 对 `BadRequestError` 一律"打开熔断"。一个房间的上下文过长或边角输入引起的 400，会让所有房间停摆。分支表里没有 401/403（密钥或权限）和 413（请求过大）。
- 修改：熔断按 `(route, schemaHash, promptVersion)` 分键；401/403 触发全局告警并停止调度；413 只把该 run 转 `HumanRequest`；其余 400 落到该 attempt 失败，同一个键连续 N 次失败才熔断。

### r09（low）成本封顶偏重
- 证据：run、room、global 三个范围逐日"预留 + 结算"，再加 Console 上限；`spendCounters` 里的 global 日文档每次调度和每次提交都要写，在 Convex OCC 下会成为写冲突热点。
- 修改：v1 只保留"run 级 attempt 上限（24）+ run 级美元上限 + global 日计数"；room/day 范围等第二个场景或真实滥用出现后再加。`modelCalls` 照常逐次记账，不受影响。

### r10（low）原始请求 blob 的隐私面
- 证据：§4.6 把"请求与响应原文"存进 `_storage`，等于把私密简报再复制一份，而且没有保留期。请求本可以由事件、`promptVersion` 与 `prefixHash` 确定性地重建。
- 修改：默认只存响应原文和请求哈希；完整请求只在 dev 环境或抽样时保存，带保留期（例如 30 天），并写进 07 的披露矩阵与 15 的运维章节。

### r11（low）事实小修
- `@convex-dev/agent` 0.7.8 的 peer 还包括 `@ai-sdk/provider-utils ^5.0.0`，engines 为 node ≥22（`npm view`）。SDK 在 1.0.0 把许可证从 MIT 改为 Apache-2.0，0.x 版本仍是 MIT（`SDK:LICENSE-MIT` 首段）。不影响结论，但许可证表应注明。

## 3. 主动检查

| 检查项 | 结论 | 依据 |
| --- | --- | --- |
| 与 Next 16.4.3 / React 19.3.1 / Convex 1.48.0 / Clerk 7.9.20 / Zod 4.6.7 / Node 24.21 的兼容 | 推荐方案只新增 `@anthropic-ai/sdk`（已装 1.1.0）。SDK 没有 engines 限制；peer zod 为可选，4.6.7 满足；只在 Convex action 内运行，与 Next/React/Clerk 没有交集。默认运行时（非 `"use node"`）能否打包运行仍待 V5 实测 | `NM:*/package.json`；`npm view @anthropic-ai/sdk` |
| 许可证 | SDK 为 Apache-2.0，`zod` 为 MIT，`convex` 为 Apache-2.0；被否决的候选也都是宽松许可证。没有冲突 | 同上 |
| 近 12 个月维护活跃度 | 自 2025-11 起共 93 个版本，0.101.0 到 0.137.0 覆盖 2026-06 至 10-20，几乎每周都有，10-21 起 3 天又发了 4 个 1.x 版本。属于高活跃，但 1.x 很新，"精确锁版本 + 升级前重跑探针"的对策合理 | `npm view @anthropic-ai/sdk time` |
| 与任务书核心是否冲突 | 不冲突：模型只能引用候选 id（核心 4）；按方组装上下文、公共文本走模板（核心 1）；拒绝或截断转 `HumanRequest`（核心 8）；网关不写业务表（核心 5）。r10 是对核心 1 的加固建议 | 00-brief §3 |
| 是否过度设计 | 大体克制，没有引入框架。偏重的有三处：三范围预留（r09）、双代码路径（r07）、全量请求 blob（r10） | 本文 r07/r09/r10 |
| 被忽略的更简单方案 | （1）流式 `.finalMessage()` 替代"非流式 + 长超时 + 截断扩容重试"（r01）；（2）用 Vitest project 跑评测，不自写 Node runner 的解析环境（r04）；（3）一律走 beta 路径（r07）；（4）用 per-message effort 替代"为缓存把 effort 锁死"（r05） | 同上 |

## 4. 维持原判的部分（反驳未成立）

- 不用 `messages.parse()`：成立，parse 失败直接抛错，`usage` 会丢。
- 不用 AI SDK / `@convex-dev/agent`：成立。理由是栈已定、refusal 类别丢失、API 版本不同（2023-06-01 对 2026-10-21），不是功能缺失。原文对此写得准确。
- 全部用 Opus 5.5、靠 effort 区分路由：符合技能硬规则，换小模型只作为用户选项写进 18-decisions，处理得当。
- 默认开 `fallbacks:"default"`（beta `-2026-07-01`）并留开关：符合技能要求；头与形式的配对正确（`model-migration.md:1420`）。
