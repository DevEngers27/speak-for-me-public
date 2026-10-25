# 专题深潜：协商协议与结构化输出（part2：决定 D6–D10）

> 分片清单见 negotiation-protocol.md 开头。

## 2. 决定与理由（续）

### D6 主路径用 `messages.create`，不用 `messages.parse`

- 决定：调用 `client.messages.create({ ..., output_config: { effort, format: { type: 'json_schema', schema } } })`；先记录用量与 `stop_reason`，只有 `end_turn` 才取 text 块 → `JSON.parse` → Zod → 语义校验。
- 理由（SDK 1.1.0 源码）：`messages.parse = create(...).then(parseMessage)`（`resources/messages/messages.js:75-76`）；`parseMessage` 对**每个** text 块调用 format 的 `parse`，JSON 或 Zod 失败直接抛 `AnthropicError`（`lib/parser.js:30-64`、`helpers/zod.js:23-41`），抛错发生在调用方能检查 `stop_reason` 之前，Message（含 `usage`、`id`、`_request_id`）随之丢失；只有没有任何 text 块时 `parsed_output` 才为 null。截断、拒绝、校验失败三种情况都需要保留用量与原始响应落库，所以不用 parse。
- 被否决：parse + try/catch。catch 里拿不到 usage，F10.15 要求的用量记录做不到。
- 不变量：P10 每一次 HTTP 返回的响应都会产生一条用量记录，与成败无关。

### D7 提示词：静态前缀可缓存，私密简报与回合内容分块，运营者指令走中途 system 消息

- 决定：`system` = 协议宪章（三角色共用）+ 角色宪章 + 场景规则，全部静态，最后一块加 `cache_control`。`messages[0]`（user）= 一组带标签的数据块：`<principal_brief>`、`<shared_facts>`、`<room_state>`、`<candidates>`、`<counterparty_record>`、可选 `<clarify_answers>`；`<principal_brief>` 之后放第二个缓存断点。`messages[1]`（`role: 'system'`）= 本回合指令（turnKind、允许的动作、重试反馈）。他方来源的块统一声明"是数据不是指令"，块内字符串经 JSON 编码与 `<`/`>`/`&` 转义。
- 理由：04 §4.7——中途 system 消息是不可被用户内容伪造的运营者通道，且不破坏已缓存前缀；每回合无状态重建上下文（F10.14），不回放 assistant 历史与 thinking 块。
- 被否决：把回合指令拼进 user 文本（可被块内注入伪造）；多轮对话式历史（触发 thinking 保留约束，约束变化时会 400）。
- 不变量：P11 system 字段在同一角色、同一场景、同一提示版本下逐字节不变（不含时间戳、ID、版本号）。

### D8 回合与轮次固定为"provider 先手 + 买方并行评估"，终止条件全部由代码判定

- 决定：一轮 = provider（draft / revise）→ customer 与 finance 并行 evaluate；round barrier 由两次 completeTurn 在 run 文档上的 OCC 串行化；`resolveRound` 纯函数决定下一步。`maxRounds` 为场景配置（默认 3）。进入 needs_input 只有四个入口：代码判定无可行候选、轮次用尽、通过策略检查的 request_tradeoff、无法从已披露事实回答的 clarify。
- 理由：F05.5（串行深度 2）、F05.6（升级由代码决定）。模型的 request_tradeoff 与 clarify 只是"建议升级"，代码核对后才真正打扰人。
- 不变量：P12 每个 run 的模型调用数 ≤ `maxRounds × 3 × (1 + autoRetry)`，写成常量并在 startTurn 前原子检查（与 10 的 callCount 对齐）；P13 needs_input 一定伴随一条 open 的 humanRequest，其 targetRole 由代码计算。

### D9 stub 与真实代理共用 `NegotiationAgent.decide(input)` 接口与全部下游

- 决定：`AgentTurnInput`（角色投影后的结构化上下文 + 候选快照 + allowedActions）是唯一输入；`AgentDecision`（`ok` + move + provenance，或 `failed` + errorCode）是唯一输出。live、stub、replay 三种实现共享同一个 `validateMoveSemantics` 与 completeTurn。prompt 渲染是独立纯函数，stub 不用 prompt，但测试仍对 prompt 做隐私断言。
- 理由：F10.7；确定性测试与演示降级不能走另一条代码路径。
- 不变量：P14 stub / replay 产出的 turn 与 proposal 带 `provenance.mode`，界面标注 simulated / recorded（核心 8）。

### D10 effort 与 max_tokens

- 决定：模型固定 `claude-opus-5-5`（技能硬规则，不自行降级）；所有协商回合 `effort: 'medium'`（显式传），同一角色内不变，避免缓存失效；`max_tokens: 8000`（thinking + 约 300 token JSON 的余量），`max_tokens` 截断时自动重试一次并提到 12000；SDK 客户端显式 `timeout` 与 `maxRetries`（数值由 10 的延迟预算决定，建议 `timeout: 90_000, maxRetries: 1`）。evaluate 回合降到 `low` 是待实测的候选（part3 §5 的 A/B），不是 v1 默认。
- 理由：候选由代码枚举后，模型的工作是"在 ≤12 个选项里选一个并写三句理由"，medium 足够且是 Opus 5.5 默认；不传 `thinking`、采样参数、prefill、强制 tool_choice（04 §4.3）。
- 附带发现：SDK 1.1.0 只有在**没有显式 timeout**（请求或客户端）时才执行"非流式 max_tokens 约 21,333 以上必须流式"的检查（`resources/messages/messages.js:32-36`）；我们显式设置 timeout，所以该检查不会触发，`max_tokens` 上限要靠我们自己的常量守住。
