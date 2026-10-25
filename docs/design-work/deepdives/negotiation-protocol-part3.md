# 专题深潜：协商协议与结构化输出（part3：具体设计 §3.1–3.7）

> 分片清单见 negotiation-protocol.md 开头。代码见 deepdives/negotiation-protocol/。

## 3. 具体设计

### 3.1 一条代理消息的三层

| 层 | 内容 | 来源 | 存放 |
| --- | --- | --- | --- |
| envelope | `turnEnvelopeV`：roomId、runId、turnSeq、round、turnKind、sourceRole、baseProposalId、baseProposalVersion、constraintsVersion、promptVersion、agentMode | startTurn 从 room / run 快照写入 | agentTurns（03） |
| move | `AgentMove`（六变体），唯一自由文本是 rationale | 模型 / stub / replay | agentTurns.output，仅本方可见 |
| resolution | 由代码从 move + candidate snapshot 解析：proposal 条款、objection 的公开措辞、clarify 的问题模板参数、tradeoff 选项 | completeTurn 内的纯函数 | proposals、events、humanRequests |

模型 schema 与存储 validator 分开定义（F03.13）：Zod 在 `model-output.ts`，Convex `v` 在 `envelope.ts`，两者在 CI 里加一条编译期断言 `Infer<typeof agentMoveV>` 与 `z.infer<typeof AgentModelOutput>['move']` 互相可赋值。

### 3.2 模型输出 schema（摘要；完整代码 `model-output.ts`）

根对象 `z.strictObject({ move })`，`move` 是按 `action` 判别的联合，只包含本回合允许的变体：

| action | 字段 | 说明 |
| --- | --- | --- |
| `propose` | `optionKey`、`rationale` | provider 在 draft / revise 回合选一个候选 |
| `counter` | `optionKey`、`rationale` | customer 在 evaluate 回合给出替代候选 |
| `clarify` | `targetRole`、`question`（按 `topic` 判别：`item_required{itemKeys}`、`date_acceptable{deliveryDate}`、`term_acceptable{termIds}`、`option_fits_constraints{optionKey}`）、`rationale` | 向另一角色提一个结构化问题；不允许自由文本问题；targetRole 不能是自己，也没有 `human` |
| `recommend_accept` | `rationale` | 只对本回合的 baseProposal 有效；不带版本号，绑定由信封完成（F05.2）；永不写 approvals（F05.7） |
| `reject` | `objection: ObjectionCode`、`rationale` | 偏好层面的反对；硬规则失败由规则引擎给 reasonCode，不归模型 |
| `request_tradeoff` | `axis`、`optionKeys`（2–3 个）、`rationale` | 建议把这几个候选交给人选；是否真的升级、交给谁，由代码决定（§3.6） |

字段边界：`rationale` 1–1200 字符；`optionKey`、`itemKey`、`termId` 1–64 字符；数组上限 3–5。这些边界只在 Zod 层生效（API 不支持 maxLength / maxItems，见 part4 §3.9），真正限制输出长度的是 `max_tokens`。

### 3.3 语义校验 `validateMoveSemantics(move, input): MoveIssue[]`

纯函数，Zod 通过后执行；任一问题即 `invalid_output`（计入自动重试，见 part4 §3.10）。

| code | 条件 |
| --- | --- |
| `ACTION_NOT_ALLOWED` | `move.action ∉ allowedActions(role, turnKind)`（strict_enum 模式下解码已保证，sdk_transform 模式下才可能出现） |
| `OPTION_NOT_IN_SNAPSHOT` | propose / counter / tradeoff / clarify 的 optionKey 不在本回合 candidate snapshot |
| `COUNTER_EQUALS_BASE` | counter 的候选 termsKey 与 baseProposal 相同（应为 recommend_accept） |
| `PROPOSE_REPEATS_BLOCKED` | revise 回合重复提出本 run 已被规则引擎阻断的 termsKey |
| `TRADEOFF_DUPLICATE_OPTIONS` | optionKeys 有重复或解析到相同 termsKey |
| `CLARIFY_SELF` | targetRole === sourceRole |
| `UNKNOWN_ITEM_KEY` / `UNKNOWN_TERM_ID` | clarify 引用的键不在本房间已确认目录 |
| `DATE_OUT_OF_RANGE` | clarify.date_acceptable 的日期早于房间时区的 today（06 计算） |

### 3.4 动作 × 角色 × 回合矩阵（代码常量 `ALLOWED_ACTIONS`）

| 角色 \ 回合 | draft（第 1 轮） | evaluate（每轮） | revise（第 ≥2 轮） |
| --- | --- | --- | --- |
| provider | propose、clarify、reject（`CAPACITY_CONFLICT`：无法交付任何候选） | — | propose、clarify、reject、request_tradeoff |
| customer | — | recommend_accept、counter、reject、clarify、request_tradeoff | — |
| finance | — | recommend_accept、reject、clarify、request_tradeoff | — |

- finance 不能 counter：范围取舍是 customer 的判断；finance 的意见以 reject + objection 或 request_tradeoff（axis `scope_vs_cost`）表达。
- provider 没有 recommend_accept：接受 customer 的 counter 就是在 revise 回合 propose 同一个候选，它会再经过一轮评估，规则统一、没有特例。
- 每个回合的 schema 只含本格的变体，所以模型在解码层就无法选到不允许的动作（strict_enum 模式）。

### 3.5 回合与轮次规则

**run 开始（startRun → startRound(1)）**
1. 代码对买方视图运行 `enumerateCandidates`（全部硬约束），得到可行集 F。若 F = ∅ → 不调模型，走 §3.7 不可行流程。
2. 否则创建 provider 的 draft 回合：写 envelope 与 candidate snapshot（provider 投影，见 D3），`callCount += 1`，`runAfter(0, internal.agents.runTurn, { turnId })`。

**provider 回合完成（completeTurn，persistenceGuard 通过后）**
- `propose`：在同一 mutation 内 `rooms.proposalVersion += 1`、插入 proposal（条款来自快照，origin `agent`，sourceTurnId，状态 `active`，旧 active → `superseded`），运行 `validateProposal`（06）。
  - 校验通过 → 同一 mutation 内创建 customer 与 finance 两个 evaluate 回合（turnSeq 依次分配，round 不变）并各 `runAfter(0)`。
  - 校验失败（如 provider 不知道的 `OVER_BUDGET`）→ 不调评估；若 `round < maxRounds` 进入下一轮 revise，反馈只含 reasonCode；否则进入轮次用尽流程。
- `clarify` → §3.6；`reject(CAPACITY_CONFLICT)` → 轮次用尽流程（直接把可行集交给人）。

**evaluate 回合完成（round barrier）**
两次 completeTurn 都写同一个 run 文档（`run.pendingEvaluations` 递减），OCC 把它们串行化；后到的那次看到计数为 0，调用纯函数 `resolveRound`：

| 优先级 | 条件（customer 结果 C、finance 结果 F） | 结果 |
| --- | --- | --- |
| 1 | C 或 F 是 clarify，且无法从已披露事实回答 | 创建 clarify 请求，run → needs_input |
| 2 | C 或 F 是 request_tradeoff 且通过 §3.6 策略检查 | 创建 tradeoff 请求，run → needs_input |
| 3 | C 与 F 都是 recommend_accept，且 proposal 实时可执行 | run → pending_approval（人审批，见 08） |
| 4 | C 是 counter 且 counter 候选对买方视图可行 | 下一轮 provider revise，反馈含 counter 的 optionKey（重新标号进新快照） |
| 5 | 其他（reject / 可回答的 clarify / 未通过策略的 tradeoff） | 下一轮 provider revise，反馈含 objection 与澄清答案 |
| — | 第 4、5 行但 `round === maxRounds` | 轮次用尽流程：代码取买方可行集中排名前 ≤3 的候选生成 tradeoff 请求给 customer（`reasonCode: ROUND_LIMIT`），run → needs_input |

- 一个 evaluate 回合失败（重试耗尽）→ run → failed（可恢复），另一个已成功的结果保留；retryTurn 只重跑失败的回合，barrier 计数不变。
- 人在 pending_approval 阶段拒绝（08）→ 若 `round < maxRounds`，run → negotiating 并开下一轮 revise，反馈是人选的结构化拒绝原因；否则轮次用尽流程。
- 回合级状态展示（"Provider agent drafting…"）读 agentTurns，不做 token 流式（F05.5）。

**调用上限**：`MAX_CALLS_PER_RUN = maxRounds × 3 × (1 + AUTO_RETRY_INVALID_OUTPUT)`，默认 `3 × 3 × 2 = 18`；startTurn / retryTurn 前原子检查并递增 `run.callCount`，超限 → run needs_input（`reasonCode: CALL_LIMIT`）。

### 3.6 澄清与 request_tradeoff 的处理

**clarify（模型只决定"问什么"，不决定"打扰谁"）**
1. 代码先查目标角色已披露的 shareableFacts（07 的固定词表 `{ field, value }`）：
   - `item_required`：customer 是否披露了 requiredItemKeys / deferrableItemKeys；
   - `date_acceptable`：customer 是否披露了 deadline / preferredDate；
   - `term_acceptable`：customer 是否披露了对该 term 的态度；
   - `option_fits_constraints`：由规则引擎直接算出 `FITS` / `BLOCKED(reasonCode)`，只在发问者有权看到该结论时回答（provider 只拿到 reasonCode，F07.1）。
2. 能回答 → 生成 `clarifyAnswer`（模板句 + 结构化值），追加到发问者下一回合的 `<clarify_answers>` 块，不调模型、不打扰人。
3. 不能回答 → 创建 `kind: 'clarify'` 的 humanRequest 给**目标角色的人**，选项由 topic 生成（例：item_required → `required` / `deferrable` / `decline_to_share`）。人的回答本身就是一次显式披露（核心 1）：写入 shareableFacts；若改变了硬约束（例如把 REPORTS 从 required 改为 deferrable），由 09 的 `bumpConstraints` 递增版本并开新 run（trigger `human_answer`）；只是披露则同一 run 回到 negotiating 继续下一回合。
4. 每个 run 至多 2 个由 clarify 产生的人工请求；超过后 clarify 只按第 1 步处理，答不了就回复 `NOT_DISCLOSED`。

**request_tradeoff 的策略检查 `acceptTradeoffSuggestion(move, input)`**——全部满足才升级：
- 每个 optionKey 解析出的候选对买方视图都可行（validateProposal 通过）；
- 候选两两之间在 `axis` 指明的维度上确有差异（scope_vs_date：itemKeys 不同且 deliveryDate 不同；scope_vs_cost：itemKeys 与 amountCents 不同；date_vs_cost：deliveryDate 与 amountCents 不同）；
- 本 run 还没有 open 或已回答的 tradeoff 请求（每 run 至多 1 个由代理建议的 tradeoff）。
- targetRole 由代码按 axis 决定：`scope_vs_date` → customer；`scope_vs_cost` 与 `date_vs_cost` → customer（选项里不显示预算余量以外的私密数）；若所有候选都需要追加预算才可行，则改为 §3.7 的 finance 请求。模型无法指定目标的人。
- 未通过 → 视为一次 reject(`OTHER`)，进入 resolveRound 第 5 行。
