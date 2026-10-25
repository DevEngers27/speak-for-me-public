# 专题深潜：协商协议与结构化输出

> 归属：任务书第 5 节 05-protocol（主），并向 10-agent-runtime、06-rules-engine、07-permissions-privacy、04-state-machines 提供接口。
> 分片：本文件（§1 目标与范围、§2 决定 D1–D5）→ negotiation-protocol-part2.md（§2 决定 D6–D10）→ negotiation-protocol-part3.md（§3.1–3.6 信封与消息三层、模型输出、语义校验、动作矩阵、回合与轮次、澄清与 request_tradeoff）→ negotiation-protocol-part4.md（§3.7 人工请求与不可行识别、§3.8 提示词与上下文分块、§3.9 SDK 对齐、§3.10 stop_reason）→ negotiation-protocol-part5.md（§3.11 stub/live 共用接口；§4 反例与边界；§5 测试；§6 与其他专题的接口；§7 待验证清单）。
> 代码：deepdives/negotiation-protocol/ 下 `model-output.ts`、`strict-json-schema.ts`、`envelope.ts`、`call-model.ts`、`agent.ts`、`prompt.ts`、`probe.ts`。`probe.ts` 只在本地跑 zod 与 SDK 的 schema 转换，不发网络请求；其输出在 part3 §3.8 引用。

## 1. 目标与范围

### 1.1 本专题要回答的问题

1. 一条代理消息里，哪些字段由服务端注入（身份、版本、ID、回合序号），哪些由模型产出；两者如何保证永不混用。
2. 模型输出的 Zod 4 schema：六个动作（propose / counter / clarify / recommend_accept / reject / request_tradeoff）的判别联合，只含 optionKey(s) / itemKeys / termIds / deliveryDate / objection / rationale，不含金额。
3. 三个角色的 system prompt 结构与上下文分块；他方文本如何定界为不可信数据。
4. 回合（turn）与轮次（round）的规则；澄清与人工取舍请求的结构；"不可行"由谁、在何时识别。
5. stub 代理与真实代理共用的接口。
6. 与 `@anthropic-ai/sdk` 1.1.0 的对齐：`messages.parse` + `zodOutputFormat` 会把哪些约束降级、为什么主路径改用 `create` + 自行校验、`max_tokens` / `refusal` / `stop_reason` 的处理、effort 选择。

### 1.2 不在本专题内

- 表结构的最终字段与索引（03）；run / turn / proposal / humanRequest 的完整迁移表（04）；validateProposal 与 reasonCode 的规则细节（06）；字段×角色披露矩阵（07）；调度、看门狗、用量表（10）；首个场景目录数值（14）。本文只给出它们必须满足的接口，并用首个场景的 LOGIN / REPORTS / EXPORT / RUSH 词表作示例（数值以 14 为准）。
- 不做真实 API 调用。所有 SDK 行为来自 `node_modules/@anthropic-ai/sdk` 1.1.0 源码阅读与本地 `probe.ts`；API 端行为标"待验证"。

### 1.3 术语

| 术语 | 含义 |
| --- | --- |
| run | 一次协商运行，绑定开始时的 constraintsVersion；约束变化即被取代（09） |
| round | 一轮 = 一个 provider 回合（draft 或 revise）+ customer 与 finance 两个并行 evaluate 回合 |
| turn | 一次代理决策（一次模型调用或 stub 调用），记录在 agentTurns；有 turnSeq 与 attempt |
| envelope | 服务端信封：runId、turnSeq、round、turnKind、sourceRole、baseProposalVersion、constraintsVersion 等，全部来自 turn 记录快照 |
| move | 模型输出里的动作对象（`AgentMove`），六个变体之一 |
| candidate | 代码为本回合枚举出的条款组合（itemKeys、deferredItemKeys、termIds、deliveryDate、amountCents），以位置标签 `O1..On` 作为 optionKey 呈现给模型 |
| candidate snapshot | 回合开始时写入 agentTurns 的候选列表；optionKey 只能在这份快照里解析，永不重新计算 |
| humanRequest | 向具体某个角色的人提出的结构化请求（clarify / tradeoff / infeasible） |
| objection | 模型可给出的偏好层面的反对理由（`ObjectionCode`），与规则引擎的 reasonCode 是两个枚举 |

## 2. 决定与理由

每条写：决定 → 理由 → 被否决的备选 → 带来的不变量。

### D1 信封与模型输出分两层，模型不回显任何身份或版本

- 决定：`TurnEnvelope`（Convex validator）只由服务端在 `startTurn` 时从 run / room 快照写入 agentTurns；action 调用 `completeTurn({ turnId, attempt, decision })` 时只传 turnId 与 attempt，completeTurn 自己读 turn 记录拿信封。模型输出 schema（`AgentModelOutput`）里**不存在** runId、turnSeq、sourceRole、proposalVersion、constraintsVersion、amountCents 这些字段；`z.strictObject` 让多余字段直接校验失败。
- 理由：F05.1 复现过——把信封字段放进模型 schema，模型就会编造版本号，过期检查失效。不存在的字段无法被伪造，也就不需要"回显比对"这道易错的守卫。
- 被否决：让模型回显版本号、服务端比对不一致即拒绝（01 PR-02 的备选）。回显不提供任何信息，只增加 invalid_output 概率和 token。
- 不变量：P1 envelope 中每个字段的唯一写入点是 `startTurn` / `retryTurn`；P2 completeTurn 的所有守卫只读 turn 记录与当前 room / run，从不读 move 内容判断身份或版本。

### D2 propose / counter 只能从代码枚举的候选里选 optionKey，金额与条款由代码解析

- 决定：每个回合开始时，场景插件的 `enumerateCandidates(view, role)` 按**该角色有权知道的约束**枚举候选，写入 candidate snapshot，用 `O1..On`（n ≤ 12）标签呈现给模型。propose / counter 只输出 `optionKey`；itemKeys、deferredItemKeys、termIds、deliveryDate、amountCents 一律由代码从快照解析。v1 不允许模型自由拼装条款。
- 理由：(1) "模型不得发明金额"在结构上成立，而非靠校验兜底；(2) 不会产出缺必需项、日期越界、目录外条目这类无效组合，省掉格式重试（F06.5）；(3) prompt 更短；(4) `O1..On` 是位置标签，dynamic enum 只随 n 变化，结构化输出的 schema 编译缓存命中率高（见 D5）。
- 被否决：(a) F05.2 修正版的 `itemKeys + deferredItemKeys + deliveryDate + termIds` 自由拼装——要求模型做组合计算，错误由后验校验发现，耗重试；(b) 用 termsKey 字符串当 optionKey——更长、更易抄错，且对模型泄露了规范化格式。自由拼装作为大目录场景的扩展点保留（`compose` 变体，v1 关闭，见 part3 §6）。
- 不变量：P3 proposal 的条款字段只能来自 candidate snapshot 或人工请求选项（同样来自快照）；P4 optionKey 在 snapshot 之外 → `OPTION_NOT_IN_SNAPSHOT`，invalid_output。

### D3 候选按角色投影：provider 的候选不按预算过滤

- 决定：customer 与 finance（买方）的候选经过全部硬约束过滤（含预算余量）；provider 的候选只经过 provider 有权知道的约束过滤（目录、交期、customer 已披露的 shareableFacts）。provider 提出的方案若被预算挡住，代码直接把 proposal 记为 blocked（派生状态），跳过本轮 evaluate 调用，下一轮 provider revise 只拿到 reasonCode `OVER_BUDGET`（无数字）。
- 理由：核心 1 与 F07.1——provider 看到"哪些组合可行"就能把预算余量夹到很窄的区间；blocked 后只告诉它 reasonCode，泄露量与 F07.1 已允许的"Blocked: exceeds the finance limit"相同。
- 被否决：给 provider 的候选标注 fits / not fits。只有当 finance 在简报里显式开启 `discloseFitSignals` 时才这样做（默认关，开放问题 Q2）。
- 不变量：P5 provider 的 AgentTurnInput 里不含任何预算数值、余量或"按预算过滤"的痕迹（隐私金丝雀覆盖）。

### D4 对他方可见的内容全部来自结构化字段 + 模板；rationale 只给本方

- 决定：move 中唯一的自由文本是 `rationale`，只存在 agentTurns.output，仅本方成员可见，不进入任何其他代理的上下文。他方看到的是由 action、optionKey 解析出的条款、objection、clarify topic、reasonCode 经模板渲染的英文句子（07 / 14 的模板）。clarify 不带自由文本问题：问题由 `topic` + 结构化参数决定，措辞由模板生成。
- 理由：F05.3、F05.4——跨代理 prompt injection 的唯一通道就是他方自由文本；不让它存在，比"定界 + 声明不可信"更强。定界仍然要做，用于兜底目录标题等人类输入的字符串（D7）。
- 被否决：F05.2 的 `clarify.question: z.string()`；对自由文本做金额正则过滤（F05.3 已论证误伤与漏网）。
- 不变量：P6 任何 `actorType: 'agent'` 的事件 summary 都能由 (action, resolved terms, codes) 重新渲染出来；P7 他方代理上下文里出现的每个字符串，要么来自枚举，要么来自经过长度上限与转义的已确认目录 / 简报字段。

### D5 发给 API 的 JSON Schema 由我们自己的转换生成，保留 enum / const；解析后必做 Zod + 语义两层校验

- 决定：`toStrictOutputSchema(buildMoveSchema({ strictEnums: true, ... }))` 生成请求里的 `output_config.format.schema`：沿用 SDK 的做法（`additionalProperties: false`、不支持的关键字挪进 description、oneOf → anyOf），**唯一差别是保留 `enum` 与 `const`**。响应用静态的宽松 schema `AgentModelOutput.safeParse`，再用 `validateMoveSemantics(move, turnInput)` 做快照成员检查。配置项 `OUTPUT_SCHEMA_MODE = 'strict_enum' | 'sdk_transform'`，若 API 拒绝我们的 schema（待验证），切回 `zodOutputFormat(...).schema`，校验链不变。
- 理由：SDK 1.1.0 `transformJSONSchema` 把 `const`、`enum` 一并降级为描述文字（04 §4.4 实测，本文 probe 复核），判别字段 `action` 与 optionKey 因此不受解码约束；而 API 文档列出的子集支持 enum / const（`tool-use-concepts.md:541-558`）。保留它们能把"选了不存在的 optionKey / 动作不在本回合允许集"从重试问题变成解码期不可能事件。
- 被否决：直接 `messages.parse({ output_config: { format: zodOutputFormat(schema) } })` 读 `parsed_output`（F10.13 的推荐）。原因见 D6。
- 不变量：P8 进入 completeTurn 的 move 一定已通过 Zod 与语义校验；P9 API schema 与校验 schema 出自同一个工厂 `buildMoveSchema`，只差 `strictEnums`。

