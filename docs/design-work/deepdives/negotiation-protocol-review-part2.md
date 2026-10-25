# 反驳评审：协商协议与结构化输出（part2：r07–r14、总评）

> 分片清单见 negotiation-protocol-review.md 开头。

## 2. 问题清单（续）

### r07（medium）调用上限的计数口径与公式不一致；provider clarify 在轮内的规则缺失

- 描述：`MAX_CALLS_PER_RUN = maxRounds × 3 × (1 + AUTO_RETRY_INVALID_OUTPUT) = 18`，但 `run.callCount` 在 startTurn / retryTurn 时按"回合"递增，自动重试却在 callModel 内部再发 HTTP。按回合计数又乘了重试系数，实际 HTTP 上界是 18 回合 × 2 = 36（再加 SDK 内部重试），P12"模型调用数 ≤ 18"不成立。另外"每轮 3 个回合"的假设被 clarify 打破：provider 在 draft 回合 clarify、代码可回答时，"追加到发问者下一回合"——这个下一回合是否在同一轮、是否消耗 round，§3.5 没写；若不推进 round，provider 可在同一轮内反复 clarify（与 r02 叠加）。
- 证据：part3 §3.5"调用上限"；part2 D8 P12；call-model.ts:67-90；part3 §3.6 第 2 步。
- 建议：二选一并写成不变量：(a) 按 HTTP 计数——在 `recordUsage` 的 mutation 里递增并在每次 `create` 前检查；(b) 按回合计数——上限 = `maxRounds × 3 + clarifyAllowance`，不乘重试系数，另设每回合 HTTP 上限。明确规则："provider 的 clarify 消耗本轮 provider 槽位，代码作答后同一轮再开一个 provider 回合，每轮至多 1 次"。

### r08（medium）P13"needs_input 必伴随 open 的 humanRequest"有两个反例

- 描述：(1) 人选 `stop_run` 后，请求变为 answered，run"保持 needs_input 等人手动重开"，此时没有 open 请求；(2) `MODEL_REFUSAL` → run → needs_input"提示人检查输入"，但 humanRequest 的 kind（clarify / tradeoff / infeasible）与 reasonCode 都没有对应项。
- 证据：part4 §3.7 选项效果 `stop_run`；part4 §3.10 refusal 行；part2 D8 P13；run-lifecycle 的 `RUN_STATUSES` 已有 `cancelled`，refusal 在 run-lifecycle 是 turn failed。
- 建议：`stop_run` → run `cancelled`（`endedReason: cancelled_by_member`）；refusal → turn failed（不自动重试），run → failed 并在界面提示，与 run-lifecycle 对齐；P13 保持为真。

### r09（medium）allowedActions 不随快照调整，制造必然失败的输出

- 描述：动作集只按 (role, turnKind) 固定。n = 1 时（E12）customer 仍可选 `counter` 与 `request_tradeoff`；`optionKeys.min(2)` 在两种转换下都只进 description（minItems 只保留 0/1），解码层允许 `["O1"]` 或 `["O1","O1"]`，必然被 Zod 或 `TRADEOFF_DUPLICATE_OPTIONS` 打回并耗一次重试；唯一候选等于 baseProposal 时 counter 必然 `COUNTER_EQUALS_BASE`。
- 证据：model-output.ts:101、131-142；part3 §3.3；part5 E12；transform-json-schema.js:96-102。
- 建议：`allowedActions(role, turnKind, snapshot)`：n < 2 时去掉 request_tradeoff；快照中没有异于 base 的候选时去掉 counter；counter 的 optionKey 枚举直接排除 base 的 optionKey。这样 strict_enum 模式下这几类语义错误在解码层就不可能出现，与 D5 的目标一致。

### r10（medium）schema 变体数估计不准，首用编译延迟会落在交互路径

- 描述：§3.9 称"每房间至多约 48 个不同 schema"（4 格 × n∈1..12）。实际 schema 还嵌入房间目录的 `itemKeys`、`termIds` 枚举（clarify 用），目录词表变化（例如确认了新条目）就是一批新 schema；不同房间目录不同，跨房间几乎不共享缓存；r09 的动态动作集会再增加变体。编译缓存按什么判定同一性仍待验证。
- 证据：model-output.ts:71-81（itemKey、termId 走 `keyOf(..., S)`）；part4 §3.9 末段；`tool-use-concepts.md` Important Notes。
- 建议：clarify 中的 itemKeys / termIds 不做解码枚举（已有 `UNKNOWN_ITEM_KEY` / `UNKNOWN_TERM_ID` 语义校验兜底），让 schema 只依赖 (cell, n, 动作裁剪)，全局变体数有界且与房间无关；部署后用 fixture 对每个变体各发一次真实小请求预热（注意 `max_tokens: 0` 与 `output_config.format` 同用会被拒，`prompt-caching.md:295`）。同时把 C4/C5 的线上冒烟（enum、const、属性级 anyOf、`$defs`）作为 v1 实现第一天的阻塞项，而不是"需要额度时才跑"。

### r11（low）C7 表述不准；strict() 在无 type 节点上静默产出 `{}`

- 描述：Zod 4.6.7 对 `z.discriminatedUnion` 输出 `oneOf`，不是 anyOf（内联复跑确认）；最终 schema 因两种转换都改写为 anyOf 而正确，只需改文字。另外 strict-json-schema.ts:37 在既无 anyOf/allOf 又无 type 时写 `out.type = undefined`，序列化后变成 `{}`（接受任意值）；SDK 同一情况直接抛错（transform-json-schema.js:56-58）。今天没有 `z.any()` / `z.unknown()`，但将来误加一个就会得到不受约束的字段且无报错。
- 建议：改 C7 文字；strict() 在该分支抛错，与 SDK 行为一致，并加一条单测。

### r12（low）决策表中的不可达分支与丢失的反馈

- 描述：(1) §3.6 tradeoff 策略要求"每个候选对买方视图都可行"，随后又写"若所有候选都需要追加预算才可行，则改为 §3.7 的 finance 请求"——前置条件已排除，该分支不可达；(2) resolveRound 第 4 行（customer counter 可行）只把 counter 的 optionKey 交给 provider，同轮 finance 的 reject objection 被丢弃。
- 建议：删掉不可达分支；第 4 行的反馈同时带上 finance 的 objection（模板化，不含数字）。

### r13（low）回退 ADR 应写清"对本工作负载收益很小"与"开启会改变调用面"

- 描述：作者把 `fallbacks` 默认关闭列为需拍板的偏离，方向正确，但 ADR 缺少两条事实：(1) Opus 5.5 的拒绝类别是 cyber / bio / reasoning_extraction，商务协商文本很少触发前两类，而 `reasoning_extraction` 不回退（inputs/04 §4.5），所以默认开启的实际收益很小；(2) 开启需要改走 `client.beta.messages.create` + `betas: ["server-side-fallback-2026-07-01"]`，顶层 `usage` 只覆盖最终尝试，逐次计费在 `usage.iterations`——call-model.ts 的 `recordUsage` 与 P10 都要跟着改。
- 建议：在 18 的 ADR 写入以上两点，以及"若开启，`provenance.model` 取 `msg.model`、用量按 iterations 拆行"的实现约束。

### r14（low）小瑕疵

- humanRequest 的 `questionParams: v.any()`（part4 §3.7）与任务书"消息写成 schema"的要求不符，建议按 `questionKey` 做判别联合，或至少 `v.record(v.string(), v.union(v.string(), v.array(v.string()), v.number()))`。
- part4 §3.8 定界规则原文"把 `<`、`>`、`&` 转成 `<`、`>`、`&`"在 markdown 里丢了转义，读者看不出转成了什么；应写明转为 `<`、`>`、`&`（与 prompt.ts:25 一致）。
- agent.ts 的 StubAgent customer 用 `candidates.find(termsKey === base.termsKey)` 找 base；当 provider 提出的方案不在 customer 的前 12 个候选中时 baseCand 为 undefined，stub 会改为 counter 而不是评估 base 本身。建议 `roomState.baseProposal` 直接携带解析后的条款。

## 3. 核心对照小结

| 核心 | 结论 |
| --- | --- |
| 1 私密委托 | 主体成立（rationale 只给本方、他方只见模板摘要、provider 候选不按预算过滤）；r02 是一个实质缺口 |
| 2 代理只建议 | 成立：recommend_accept 不写 approvals，request_tradeoff / clarify 由代码决定是否升级 |
| 3 人批准具体版本 | 本专题不直接负责；`choose_candidate` 产出的 proposal 走正常审批，未见冲突 |
| 4 代码校验、不发明金额 | 成立且是本专题最强的部分：模型只能选 optionKey，金额与条款由快照解析 |
| 5 幂等原子 | 本专题范围内的风险是 r01（barrier） |
| 6 历史不可篡改 | 成立：被阻断的提案照常追加（E2） |
| 8 不伪造 | 成立：provenance.mode 标注；r03 让 stub 走查失败，但不会伪造结果 |

## 4. 总评

本专题最有价值的决定是"模型只从代码枚举的候选里选位置标签，金额与条款由代码从不可变快照解析"，以及基于 SDK 1.1.0 源码改用 `create` + 先记用量再分类的调用方式；C1、C2、C3、C9、C11 经源码与本地复跑核实无误，probe 结果可复现。主要问题集中在与运行时的交界处：evaluate 失败时的 barrier 死锁（r01）、clarify 预算探测器（r02）、stub 走查必然失败（r03）、timeout / max_tokens / action 上限不自洽（r04），以及与 run-lifecycle、privacy-disclosure、rules-engine 的大面积命名和模型冲突（r05、r06）。建议先按 run-lifecycle 的 step 模型收敛 run / turn 定义，再把 r02、r03、r09 的修正落进 `buildMoveSchema` 与候选快照，最后把 C4/C5 的线上冒烟列为实现第一天的阻塞项。
