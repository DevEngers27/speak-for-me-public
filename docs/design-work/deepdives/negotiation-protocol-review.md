# 反驳评审：协商协议与结构化输出（negotiation-protocol）

> 评审对象：deepdives/negotiation-protocol.md 与 part2–part5，及 negotiation-protocol/ 下 7 个代码文件。
> 分片：本文件（§0 方法、§1 待验证声明逐条核对、§2 问题 r01–r06）→ negotiation-protocol-review-part2.md（§2 问题 r07–r14、§3 总评）。
> 依据：任务书第 3 节；inputs/04 part5–part6；node_modules 中 @anthropic-ai/sdk 1.1.0、zod 4.6.7、convex 1.48.0 源码；claude-api 技能 shared/tool-use-concepts.md、shared/prompt-caching.md、shared/model-migration.md；兄弟专题 run-lifecycle、privacy-disclosure、rules-engine、versioned-approvals 的代码草案。
> 复跑：作者的 probe.ts 在 Node 24.21 下只读复跑（通过 resolve hook 指向源仓库 node_modules，不写文件），输出与 part4 §3.9 一致（OURS 2,897 字节 / SDK 3,534 字节，7 个 Zod 用例结果一致，strict 拒绝 O9）。另行内联跑了 `z.toJSONSchema` 的原始输出。

## 1. 待验证声明逐条核对

| # | 声明（缩写） | 结论 | 证据 |
| --- | --- | --- | --- |
| C1 | SDK transformJSONSchema 把 const/enum 及长度、数值、maxItems、minItems>1 挪进 description，只保留列出的键 | **属实** | `lib/transform-json-schema.js:25-115`：仅 pop `$defs/$ref/type/anyOf/oneOf→anyOf/allOf/description/title/properties/additionalProperties(强制 false)/required/受支持 format/items/minItems∈{0,1}`，其余键在 104-113 行拼进 description。probe 复跑：SDK 版 counter 的 `action` 为 `description: "{const: \"counter\"}"` |
| C2 | messages.parse = create().then(parseMessage)；对每个 text 块调 parse；zod parse 失败抛 AnthropicError；仅无 text 块时 parsed_output 为 null | **属实**（细节：`output_config.format.type !== 'json_schema'` 时也为 null；parsed_output 取第一个 text 块，而 call-model 取最后一个非空块，两者不同但不冲突） | `resources/messages/messages.js` parse 方法；`lib/parser.js:29-65`（31-44 行逐块调用，62-63 行包成 AnthropicError）；`helpers/zod.js:24-43` |
| C3 | 只有请求与客户端都没给 timeout 时才做 "Streaming is required" 检查 | **属实** | `messages.js` create：`let timeout = options?.timeout ?? this._client._options.timeout; if (!body.stream && timeout == null) {...calculateNonstreamingTimeout}`；`_options` 是构造参数原样（`client.js:187`），默认 10 分钟写在 `this.timeout`（149 行），不进 `_options`。阈值 `3600000×max_tokens/128000 > 600000` 即 >21,333（`client.js:909-917`）。opus-5-5 不在 `MODEL_NONSTREAMING_TOKENS`（`internal/constants.js:8-12`） |
| C4 | API 结构化输出子集接受 enum、const | **文档属实，线上未验证** | `tool-use-concepts.md` "JSON Schema Limitations"：Supported 列出 `enum`, `const`, `anyOf`, `allOf`, `$ref`/`$def`。同段还写 "SDKs automatically handle unsupported constraints by removing them"——SDK 连受支持的 enum/const 一起降级，原因不明，必须线上冒烟（见 r10 的建议） |
| C5 | 根对象内 anyOf 属性、嵌套 anyOf、$ref/$defs 被接受 | **未验证（作者标注正确）** | 文档只写 `$ref`/`$def`（单数，疑为笔误）；SDK 与 Zod 产出 `$defs`。属性级 anyOf 文档未禁止 |
| C6 | messages[1] 为 role:"system"（紧跟唯一 user 且为最后一条）被 Opus 5.5 接受并可与 output_config.format 同用 | **部分属实**：SDK 类型属实；位置规则属实；与 format 同用未验证 | `messages.d.ts:3616` `MessageParam = User | Assistant | SystemMessageParam`，`3871-3874` content 为 string 或 TextBlockParam[]；`prompt-caching.md` Mid-conversation system messages：Opus 5.5 无需 beta，"Must follow a role:user message… must be either the last entry… cannot be messages[0]… text-only" |
| C7 | Zod 4.6.7：z.literal→const，z.enum→enum，discriminatedUnion→anyOf，z.iso.date()→format date + 长 pattern | **部分不实** | 内联复跑：literal→`{"type":"string","const":"x"}`，enum→`{"type":"string","enum":[…]}`，iso.date→`format:"date"` + 长 pattern，均属实；**discriminatedUnion 的原始输出是 `oneOf`，不是 anyOf**。两种转换（SDK 与 strict()）都把 oneOf 改写为 anyOf，所以最终 schema 正确，但文档表述与测试断言要改（r11） |
| C8 | Opus 5.5 thinking 不可关、计入 max_tokens；effort 默认 medium；采样参数、prefill、强制 tool_choice 400 | **属实（依技能文档）** | `model-migration.md` 第 30、1880 行：thinking can't be disabled、forced tool_choice 400s、default effort medium；`api-version-migration.md` 第 73 行移除 temperature/top_p/top_k；inputs/04 §4.3 |
| C9 | 最小可缓存前缀 512；顶层 effort 变化使 messages 缓存失效 | **属实** | `prompt-caching.md:135`（512，注明以官方为准）；Invalidation hierarchy 表 "thinking or effort change → Messages cache"；第 240 行补充：显式传入默认 effort 等同于省略，所以显式 `medium` 无代价 |
| C10 | 新 schema 首次编译、24h 缓存；位置标签让每房间约 48 个 schema | **前半属实（文档），后半不准** | `tool-use-concepts.md` Important Notes："New schemas incur a one-time compilation cost… 24-hour cache"。但 schema 里还嵌入了房间目录的 itemKeys / termIds 枚举和按角色的 clarifyTargets，48 只在"目录不变"时成立，且跨房间几乎不共享（r10） |
| C11 | stop_reason 枚举 7 值；RefusalStopDetails.category 可为 null | **属实** | `messages.d.ts:3870`；`3763-3790` category 联合含 `null`；`Message.stop_details: RefusalStopDetails | null`（3527 行） |
| C12 | 被调度 action at-most-once；两个 completeTurn 写同一 run 文档被 OCC 串行化，恰好一个看到 0；convex-test 不模拟并发 | **前提属实，结论有反例** | `convex/src/server/scheduler.ts:37-40`；OCC 语义见 inputs/04 §1.3。但"恰好一个调用 resolveRound"在一个 evaluate 失败时不成立（r01） |
| C13 | fallbacks:"default" 能否与 format 同用未知；v1 不开需 ADR | **属实（未验证项标注正确）** | inputs/04 §4.5；`model-migration.md` 第 995、1388 行"Default to opting in"。补充见 r13 |

## 2. 问题清单（按严重度）

### r01（high）evaluate 一方失败时 barrier 死锁 / 已付费结果被丢弃

- 描述：§3.5 写"一个 evaluate 回合失败（重试耗尽）→ run → failed（可恢复），另一个已成功的结果保留；retryTurn 只重跑失败的回合，barrier 计数不变"。但 `persistenceGuard`（envelope.ts:89）在 `run.status !== "negotiating"` 时返回 `STALE_RUN`。若失败的一方先落库把 run 置为 failed，另一方迟到的成功结果命中 STALE_RUN 被丢弃，`pendingEvaluations` 仍为 2；retryTurn 只重跑失败方，成功后计数降到 1，永远到不了 0，run 卡在 negotiating。
- 证据：envelope.ts:87-93；part3 §3.5 "evaluate 回合完成" 段末；run-lifecycle.md 第 79 行 G1 明确"允许 failed：另一个在途 slot 的成功结果仍是有效且已付费的工作，应当持久化（只是不推进）"——两份专题互相矛盾。
- 建议：(a) guard 对同 run、同 round 的回合允许 `run.status ∈ {negotiating, failed}` 持久化但不推进；(b) 不用计数器做 barrier，改为"本 step 每个角色最新 attempt 都 succeeded"的派生判断（与 run-lifecycle 的 `maybeAdvance` 一致），计数器漂移问题随之消失；(c) 在 §4 加一条反例 E19（失败先到、成功后到）并进 16 的真实部署并发用例。

### r02（high）clarify `option_fits_constraints` 是绕过 D3 的预算探测器

- 描述：D3 的核心论证是"provider 看到哪些组合可行就能把预算余量夹到很窄的区间"，因此 provider 候选不按预算过滤、fits 标注默认关闭（`discloseFitSignals`）。但 §3.6 与 E14 允许 provider 对任意 optionKey 发 `clarify{topic: option_fits_constraints}`，代码直接回答 `FITS` / `BLOCKED(OVER_BUDGET)`，不打扰人、不查 `discloseFitSignals`；"每 run 至多 2 个"只限制升级给人的 clarify，代码可回答的 clarify 没有上限（只受 `MAX_CALLS_PER_RUN=18` 约束）。provider 已知每个候选的 amountCents，逐个询问即可得出预算余量落在哪两个相邻价格之间，正是 D3 要防的泄露；也违反 privacy-disclosure PD-2"provider 永远拿不到任何预算数字或可反推它的派生值"。
- 证据：part3 §3.6 第 1 步第 4 项；part5 E14；part1 D3；privacy-disclosure.md PD-2。
- 建议：provider 的 clarify 不提供 `option_fits_constraints` 主题（`buildMoveSchema` 按角色裁剪 clarifyQuestion 变体），或对 provider 恒答 `NOT_DISCLOSED`，除非 finance 开启披露开关；代码可回答的 clarify 也设每角色每 run 上限（建议 1）；在 16 的隐私金丝雀里加"provider 连续 clarify 所有候选"的用例，断言其上下文中 fits 信号数 ≤ 已提出提案数。

### r03（high）StubAgent 的 provider "已阻断"判定恒为空，预算下调走查会失败

- 描述：agent.ts:44 用 `counterpartyRecord.filter(r => r.role === "provider" && r.objection === "BLOCKED")` 找已阻断的 termsKey。但 counterpartyRecord 是"本 run 内他方 move 的模板化摘要"（不含 provider 自己），且 `OBJECTION_CODES` 里没有 `"BLOCKED"`（阻断是规则引擎的 reasonCode）。结果 blocked 集合恒空：预算下调后，provider 候选按 D3 不过滤预算，stub 每轮都选 rank 最小的同一个超预算候选 → 第 2 轮触发 `PROPOSE_REPEATS_BLOCKED` → invalid_output → 重试仍同 → failed。part5 §5 的"stub 模式完整走查：预算下调 → 新 run 收敛或升级"会挂。
- 证据：agent.ts:44-48；model-output.ts:26-33；part3 §3.3 `PROPOSE_REPEATS_BLOCKED`；part5 §5 convex-test 第 1 条。
- 建议：给 provider 的候选快照直接剔除本 run 已被阻断的 termsKey（provider 早已知道它们被阻断，不新增泄露），这样 live 与 stub 都不可能重复提出，`PROPOSE_REPEATS_BLOCKED` 降为防御性断言；或在 `AgentTurnInput` 增加 `ownBlocked: { termsKey; reasonCodes }[]` 并让 stub 读它。

### r04（high）`timeout: 90_000` 与 `max_tokens` 8000/12000、Convex action 上限三者不自洽

- 描述：SDK 自己对非流式请求的耗时估算是 `3600 s × max_tokens / 128000`（client.js:909-917）：8000 → 225 s，12000 → 337.5 s。90 s 的 timeout 意味着凡是思考长到接近 8000 token 的回合，大概率先超时而不是返回 `stop_reason: max_tokens`，于是 `OUTPUT_TRUNCATED → 12000` 这条路径基本到不了；超时后 SDK 还会按 `maxRetries: 1` 再发一次完整请求（用量不可见、失败尝试是否计费待验证）。反过来，若把 timeout 提到与 max_tokens 匹配，单个 action 最坏墙钟 = (1+AUTO_RETRY) × (1+maxRetries) × timeout = 2 × 2 × 337 s，超过 inputs/04 §4.6 记录的 Convex action 约 10 分钟上限（待验证）。
- 证据：call-model.ts:9-11、67-76；part2 D10 建议值；client.js:909-917；inputs/04 §4.6。实际吞吐待实测，但三者的约束关系与数值无关。
- 建议：每个 action 只发一次 HTTP（SDK `maxRetries: 0`，invalid_output 的自动重试改为新 attempt / 新 action，与 run-lifecycle 的 `origin: auto_retry` 一致）；`timeout` 由 `max_tokens` 推导（如 `max(60 s, 3600 s × max_tokens / 128000)`），并写出不等式 `timeout × HTTP 次数 + 落库余量 < action 上限`；或改 `messages.stream().finalMessage()` 规避长空闲连接。在 10 中把这条不等式作为常量断言。

### r05（high）与 run-lifecycle 专题的 run / turn 模型多处直接冲突

- 描述：同一组表与函数，两份专题给了不同的定义（任务书 §6 要求 03/04/05/10 一致）：

| 项 | negotiation-protocol | run-lifecycle |
| --- | --- | --- |
| round | 1..maxRounds | `round` 0 起 |
| turnSeq | 两个 evaluate 回合各分配一个 | 同一 step 的并行回合共享 turnSeq（`run.nextTurnSeq === turnSeq` 守卫的前提） |
| 回合类型 | `turnKind: draft / evaluate / revise` | `stepKind: propose / evaluate` |
| 推进函数 | `resolveRound` + `pendingEvaluations` 计数 | `planAfterStep` + "每角色最新 attempt succeeded" + `nextTurnSeq` |
| 自动重试 | 同一 action 内循环（`AUTO_RETRY_INVALID_OUTPUT`） | 新 attempt 行，`origin: auto_retry` |
| errorCode | 大写自由字符串 `OUTPUT_TRUNCATED`、`SEMANTIC_*`、`TRANSPORT_*`（`v.string()`） | 小写枚举 `turnErrorCodeV`（`schema_invalid`、`max_tokens`、`refusal`…） |
| agentMode | `live / stub / replay` | `live / stub` |
| refusal 结果 | run → needs_input | turn failed（不自动重试） |
| 校验输出的函数 | `validateMoveSemantics`；Convex 镜像 `agentMoveV` | 06 的 `validateAgentOutput`；镜像 `agentModelOutputV` |

- 证据：envelope.ts:9-21、61-78；part3 §3.5、§3.10；run-lifecycle/schema.ts（RUN_STATUSES、turnErrorCodeV、runs.round 注释 "0-based"、agentTurns.turnSeq 注释 "shared by parallel turns"）；run-lifecycle.md 第 27、33 行。
- 建议：run / turn 表归 run-lifecycle（04/10）所有，本专题改用其 step 模型：用 `planAfterStep` 名称承载 resolveRound 的决策表，删除 `pendingEvaluations`，errorCode 映射进 `turnErrorCodeV`（新增 `semantic_invalid` 等即可），自动重试按新 attempt 计；`replay` 若保留须同步到 run-lifecycle 的 `agentModeV`。若坚持本专题方案，须在 18 写 ADR 并让 run-lifecycle 同步修改。

### r06（medium）与 privacy-disclosure、rules-engine 的命名与字段不一致

- 描述：
  - 共享事实：本专题叫 `shareableFacts`，字段 `{ role, field, value: string }`；privacy-disclosure 的表是 `sharedFacts`，字段 `fromRole` / `ownerRole`、`value: string | string[]`（agentContext.ts:9、32）。
  - 上下文入口：`buildAgentTurnInput(turnId)` / `AgentTurnInput` 对 privacy 的 `internal.agentContext.forTurn({ turnId })` / `buildAgentContext` / `AgentContext`（PD-10）。
  - 候选：本专题 `optionKey`、`deliveryDate`、`termIds`；privacy 的 `candidates` 是 `candidateKey`、`earliestDeliveryDate`，没有 termIds。
  - 规则函数：`enumerateCandidates` / `computeRelaxations` 对 rules-engine 的 `findFeasibleOptions` / `suggestRelaxations`（feasibility.ts:80、111）。
  - 披露开关：本专题 Q2 `discloseFitSignals`（默认关）对 privacy PD-12"v1 不提供，扩展点 `finance.budgetCapToSeller`"。
- 建议：统一以 07（privacy）为上下文与共享事实的命名源、06（rules-engine）为可行集与放松的命名源；本专题只保留 `optionKey`（位置标签）这一个协议层新词，并说明它与 `candidateKey` 的映射。`discloseFitSignals` 与 PD-12 合并为一个开放问题。
