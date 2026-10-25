# 18 · 决策记录（part3）：ADR-D06…D10

> 分片见 `18-decisions-open-questions.md` 顶部。

## ADR-D06 约束变化后 run 的处置：supersede + 不动点 + 同一提案预检保留

- **背景**：草稿 R9 把仍合规的提案保留在旧 run（旧 run 的 `constraintsVersionAtStart` 恒不符 → 永久 stale，FF-12）；事件溯源候选只做一层反应（FF-15）；资金候选让被拒提案在约束变化后复活（FF-14）；Role A 复制 "revalidated" 版本（RA-R11）。
- **选项**：A 保留提案在旧 run；B 一律 supersede 并从头重谈；C supersede + 新 run 预检，仍合规则对同一 `proposalId` 重批；D 复制一个条款相同的新版本。
- **决定**：C。`constraints.bump` 同事务：当前非终态 run → `superseded`（`endedReason: constraints_changed`），其 `active` 提案 → `stale`，审批按 D02 自然失效（不改行），open `humanRequest` → `superseded`；随后 `react()` 迭代到不动点（深度上限 4）：若 `room.status === 'open'` → `startRunTx(cause: constraints_changed)`；新 run 预检：**仅当被取代的 run 处于 `pending_approval`**，且刚 stale 的当前提案在新约束下 `passesChecks` → 新 run 直接 `pending_approval`、`currentProposalId` 指向同一 `proposalId`，该提案在同一事务内 `stale → active`（不复制版本，canon D06 / §1.3、C47）；被取代 run 处于 `negotiating` / `needs_input` 时一律重新评估；否则全量约束下的可行集（`buyerFeasible`，04 §4.3.3）非空 → `negotiating`；为空 → `needs_input` + `buildHumanRequests`。由 `humanRequests.answer` 产生的 bump 进入同一循环。被人拒绝的提案不参与"仍通过则保留"。
- **被否决**：A（**C10**）——活性死锁；D——条款相同的噪音行；单层 react（**C11**）——answer → bump 后不开新 run；B——无谓重谈与花费，丢失"条款未变、只需重批"的快路径；复活被拒提案——丢弃人的拒绝；沿用 `negotiating` / `needs_input` run 的提案直接进 `pending_approval`（**C47**：跳过未完成的代理评估）；终态时清空 `rooms.currentRunId`（**C49**：R2 取不到刚被取代的 run，阶段显示错误）；排空或 `run_starts` 节流时系统路径拒绝建 run（**C52**：会把约束变更本身回滚，首回合停泊即可）。
- **后果**：正面——约束变化后总有出口；历史无噪音版本；"terms unchanged · constraints vC → vC+1 · re-approval needed"在界面上清楚。代价——每次 bump 都要预检，且可能开新 run（由 D12 ⑥ 节流约束）。关闭评委反例：FF-12、FF-14、FF-15、FF-33（保留条件含 `version.stale_source`，同 key 不同来源的旧提案不会被复用），并与 D15 一起关闭 FF-07。待验证：不动点深度上限的测试；同事务读回本事务写入（§18.5 V-R09）。

## ADR-D07 回合持久化守卫（含 attempt 身份）与 reconcile

- **背景**：run-lifecycle review r01——守卫命中只标 stale 会让 run 停在 `negotiating` 却无在途回合；r07——看门狗须按 attempt 登记；代理质量候选的看门狗以 `turnId` + `turn.startedAt` 计时，在 attempt 2 刚开始时误杀它（FF-11）。
- **选项**：A 守卫比较 `run.constraintsVersionAtStart`，命中只标 stale；B 守卫 G0–G3（含 attempt 身份）+ 命中必 `runs.reconcile`；看门狗以 `turnId` vs 以 `attemptId` 并读 `_scheduled_functions`。
- **决定**：B。`turns.complete / fail(attemptId, …)` 守卫：G0 `attempt.status === 'running'` 且 `turn.currentAttemptNo === attempt.attemptNo`；G1 `room.currentRunId === run._id` 且 `run.status === 'negotiating'`；G2 `run.activeTurnSeq === turn.turnSeq`；G3 `turn.constraintsVersion === room.constraintsVersion`。任一不符 → attempt `stale`、用量照记、写事件（G0 情形不写）、调用 `runs.reconcile(runId)`：run 为 `negotiating` 且无 running / 已调度 attempt 时，重新调度当前 turn 的下一 attempt 或按上限转 `needs_input`。看门狗以 `attemptId` 登记、每个 attempt 自有一个；到期先读 `_scheduled_functions`（`normalizeId`）：`pending` / `inProgress` → 重登记（≤ 3 次），`failed` → `error`，`success` 而回合仍 running → `error(internal)`；新 attempt 不 cancel 旧看门狗（G0 使其成为空操作）；`loadTurnContext` 返回 null 时 action 调 `turns.fail(stale)` 而不是空挂。
- **被否决**：以 `turnId` 为参数、以 `turn.startedAt` 计时的看门狗（**C14**）；守卫命中只标 stale（**C13**）；比较 `run.constraintsVersionAtStart`（**C12**——在 D06 下与回合快照等价，但回合快照更精确，03 以回合字段为准）。
- **后果**：正面——"run 为 `negotiating` 时必有 running 或已调度的 attempt"可维护、可测试。代价——看门狗多读一次系统表；`_scheduled_functions` 结果只保留 7 天，看门狗期限远小于此。关闭评委反例：FF-04（与 D08）、FF-11。待验证：spikes §8 #2；run-lifecycle review 待验证 #4（平台中断后状态是否 `failed`）、#12（`v.id("_scheduled_functions")` 作应用字段）、Convex 运行时 `AbortSignal.timeout` 是否可用（退路 `AbortController` + `setTimeout`）。

## ADR-D08 评估回合串行

- **背景**：八份候选并行评估，五份被构造出"一方失败、另一方被判 stale、计数器永不归零"的死锁（FF-04）；并行评估的两个 counter 冲突无规则（FF-38）；草稿 R-D 的屏障 + "整轮 failed" 仍需并行协调。
- **选项**：A 并行 + `pendingTurnSeqs` / `openTurnCount`；B R-D 屏障；C 串行。
- **决定**：C。每轮 = proposer（provider）1 个 propose 回合 + 其余角色按场景固定顺序（customer → finance）各 1 个 evaluate 回合；任意时刻每 run 至多一个 running attempt（`runs.activeTurnSeq`）。轮次推进由纯函数 `resolveRound(proposal, evaluations)` 决定：需人回答的 `clarify` → `needs_input`；通过策略检查的 `escalate` → `needs_input`；全部 `recommend_accept` 且通过检查 → `pending_approval`；customer `counter` 可行 → 下一轮 proposer 回合（反馈含 counter 的 optionKey）；其他 → 下一轮；`roundNo === maxRounds`（默认 3）→ `needs_input`。provider 提案被规则阻断时不花评估调用，直接下一轮并只反馈 `blocked`。finance 不能 counter。
- **被否决**：A（**C5**）——死锁；B——仍需并行协调与额外的"整轮失败"语义。
- **后果**：正面——无屏障计数器；轮次确定；评估方失败只影响一条线性路径。代价——每轮墙钟约 3 次串行调用（U4，用户决策）。关闭评委反例：FF-04、FF-38。待验证：Opus 5.5 回合 p50 / p95（testing-ops V17），用来定看门狗期限与界面预期。

## ADR-D09 模型输出根形状与结构化输出路径

- **背景**：spike A1–A6：`zodOutputFormat` 把 enum / const / 长度 / 上下界降级为描述；判别联合不能作根；`messages.parse()` 解析失败直接抛错并丢 usage；非流式 `max_tokens` 上限约 21,333；类型挡不住会 400 的 `thinking` / prefill / 拼错模型 ID。评委：Zod 对象经 `runQuery` 传递过不了 Convex 值校验（FF-25）。
- **选项**：A `messages.parse()` + `zodOutputFormat`；B 非流式 `create()` + 8,000 tokens + 45–90s timeout；C `client.messages.stream({...}).finalMessage()` + `output_config.format = { type: 'json_schema', schema: toStrictOutputSchema(zodSchema) }` + 自行 `safeParse`；根用判别联合 vs `{ turn: AgentModelOutput }`。
- **决定**：C + `{ turn }` 根（canon §1.4 六个动作）。流程：先记 `usage` / `stop_reason` / `requestId` 到 `attempts`（无论成败）→ 按 `stop_reason` 分支（`max_tokens` → `output.truncated` 重试一次；`refusal` → `refused` 不重试；`model_context_window_exceeded` → `error` 不重试）→ `JSON.parse` → `safeParse` → 语义校验（optionKey 在快照内、动作在角色白名单内、不重复已阻断候选）。`modelGateway` 运行时白名单：`claude-opus-5-5`、显式 `output_config.effort: 'medium'`、`max_tokens: 16000`、SDK `timeout` 由 `max_tokens` 推导、`maxRetries: 1`（只覆盖 429 / 连接错误）、AbortSignal 总截止早于看门狗，并满足 `timeout × HTTP 次数 + 落库余量 < action 上限`；不传 `thinking` / 采样参数 / prefill / `tool_choice`；`fallbacks` 默认关、开关 `MODEL_FALLBACKS`。schema 在 action 内按 role 构造，只随 (role, turnKind, n) 变化。
- **被否决**：A——丢 usage、enum 降级；判别联合作根——spike 抛错；B（**C15**）——三者不自洽；`fallbacks` 默认开（**C16**，techstack D17 被推翻：与 `output_config.format` 同用待验证，开启需改走 `beta.messages`、usage 按 iterations 拆行）；显式 `thinking: {type: 'adaptive'}`（**C17**，spike A4：thinking 参数能 400）；`request_tradeoff` / `addressee` / `baseProposalId` 命名（**C20**，统一为 `escalate` / `toRole` / `baseProposalVersion`）；schema 经 `runQuery` 传递（FF-25）。canon 包修订（2026-10-24）另否决`toStrictOutputSchema(zodSchema)` 住在 `core/engine`、`modelGateway` 在 `core/engine`（**C60**：core 只做 JSON Schema → 严格 JSON Schema 的纯变换，Zod 构造在 `convex/model/agents/outputSchema.ts`，`callModel` 在 `convex/model/agents/modelGateway.ts`）。
- **后果**：正面——用量永远可记账；enum / const 在解码层生效；schema 与房间无关、可缓存、不嵌入私密值。代价——网关代码多于 `parse()`。关闭评委反例：FF-25。待验证：spikes §8 #13（API 是否接受 strict schema 的 `anyOf` 内 `const`、`format: date`）、#14（解码是否真正强制 enum / `additionalProperties:false`）、#15（`max_tokens: 16000` 与 effort 是否够用）、#16（SDK 内部重试是否计费、`fallbacks` + format）。

## ADR-D10 模型只选 `optionKey`；候选由代码按角色视图快照

- **背景**：research：代码出价使成交率 26.7% → 88.9%，首提案锚定 ρ = 0.716；spike C1：模型自填日期会发明日期、编码泄露；评委：候选集按预算过滤后给 provider 泄露余量区间（FF-01）、counter 的排序列表是容量信道（FF-35）、私密必需项经全员可见候选集被披露（FF-36）、被拒候选不排除导致死循环（FF-39）、候选规模失控（FF-29）。
- **选项**：A 模型自填 `itemKeys + deliveryDate`；B 模型输出 `candidateKey` 字符串；C 模型输出位置标签 `optionKey`（`O1..On`），只在本回合 `turn.candidateSnapshot` 内解析；候选按预算过滤 vs 只用本角色可见约束；按偏好排序 vs 按 `candidateKey` 稳定排序。
- **决定**：C。回合创建的 mutation 把 `enumerateCandidates(viewFor(role))` 写入 `turn.candidateSnapshot[]`（每项 `{optionKey, candidateKey, itemKeys, modifiers, amountCents, deliveryDate}`，≤ 12 项，按 `candidateKey` 稳定排序）；`turns.complete` 只在快照内解析并物化 `terms`；provider 只用 provider 可见约束（目录、已披露事实），**不按预算过滤**，并剔除 `excludedCandidateKeys(run)`（本 run 已提出过——含被阻断——∪ 被人拒绝 ∪ `choose_candidate` 复核失败，canon D10 现文）；第 1 轮 provider 快照首位固定为其视图下金额最低的含必需项候选；`escalate` 不带选项，人工选项由代码生成（D15）。
- **被否决**：A——发明日期、编码泄露；B（**C21**）——schema 随房间变化、无法预热缓存；查询内重算候选——与 `turns.complete` 解析不一致；按预算过滤后给 provider（**C26**）；按 customer 偏好排序——排序泄露。
- **后果**：正面——模型无法发明数字；schema 与房间无关；首发锚点中性。代价——provider 可能提出被挡住的候选（多花一轮，但 D08 不为它花评估调用）。关闭评委反例：FF-35、FF-36、FF-39、FF-01 中"候选集按预算过滤"一支，FF-29 部分关闭（快照上界 12；06 需补最坏规模的性能用例）。
