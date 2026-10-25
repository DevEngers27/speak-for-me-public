# 05 · 协商协议（part3：校验流水线、候选快照与 optionKey）

> 分片清单见 `05-protocol.md` 开头。

## 5.6 服务端校验流水线与 `validateMoveSemantics`

### 5.6.1 固定顺序（spikes §7 05 段；10 负责前半段的运行时细节）

| # | 在哪里 | 步骤 | 失败时 attempt 状态 / reasonCode | 自动重试（10） |
| --- | --- | --- | --- | --- |
| 1 | action | 驱动返回响应（live：`stream().finalMessage()`；stub：合成同形响应，§5.14） | 传输错误由 10 分类 | 见 10 |
| 2 | action | 取元数据：`usage`、`stop_reason`、`stop_details.category`（按 `string \| null` 存）、`requestId`、`model` | — | — |
| 3 | action | `stop_reason`：`end_turn` 继续；`max_tokens` → `invalid_output` / `output.truncated`；`refusal` → `refused` / `output.refusal`；`model_context_window_exceeded` → `error`；`tool_use` / `pause_turn` / `stop_sequence` / 未知 → `error` | 见左 | truncated 由网关在同一次调用内重发 1 次（不开新 attempt，§5.6.2 表后）；refusal、error 0 次 |
| 4 | action | 取**最后一个非空 text 块**（按 `type` 跳过 thinking 块，不按位置）；没有 → `output.not_json` | `invalid_output` | 1 次 |
| 5 | action | `JSON.parse`；失败 → `output.not_json`（日志只记长度，不记原文） | `invalid_output` | 1 次 |
| 6 | action | `flat` 形态时 `fromFlat`（§5.4.5） | `output.schema_violation` | 1 次 |
| 7 | action | 宽松 Zod `safeParse`；失败 → `output.schema_violation`，只记 issue 路径（未知段替换为 `*`） | `invalid_output` | 1 次 |
| 8 | action | `validateMoveSemantics(move, turnView)`（早筛，减少无效写入） | 见 §5.6.2 | 1 次 |
| 9 | action | 归一化：`rationale` NFC，> 1,200 码点截断并置 `rationaleTruncated` | — | — |
| 10 | action | 一次 `turns.complete({ attemptId, actorUserId, move, response })` 或 `turns.fail({ attemptId, actorUserId, code, response })` | — | — |
| 11 | mutation | 持久化守卫 G0–G3（canon D07，10 §10.7） | `stale` + `runs.reconcile` | 否 |
| 12 | mutation | 无论成败先把 usage / 元数据写入 attempt | — | — |
| 13 | mutation | 以存储的 turn 为准**再跑一次** `validateMoveSemantics`（权威判定） | 同 §5.6.2 | 1 次 |
| 14 | mutation | `applyMove`：按快照物化条款（金额 = 目录行求和、日期 = 插入日 `localDate` + max(`leadDays`)）→ `checkProposal(全量 RuleInput)`（含日期窗口、`amount.claim_mismatch`、`version.stale_source`）→ 推进（§5.8） | — | — |
| 15 | mutation | 只追加写入：提案（仅当第 14 步 `checkProposal` 通过；被阻断的候选不插提案、不消耗版本号，只写 `turns.outcome.blockedCandidateKey`）、`turns.result`、`humanRequests`、事件 | — | — |

流水线的任何一步都不从模型输出读取数字、日期、条目或身份：输出里本来就没有这些字段（§5.4.4）。

### 5.6.2 `validateMoveSemantics(move, t): MoveIssue[]`（纯函数，`core/engine/protocol/semantics.ts`）

`t` 是从 turn 行投影出的只读视图：`allowedActions`、`kind`、`role`、`baseProposalVersion`、`candidateSnapshot`、`excludedCandidateKeys`、`topics`（本角色可问的话题及其 `ownerRole`）、`reasonKeys`、`roles`。一次收集全部问题，按下表顺序；attempt 记第一个码，重试提示列出全部码。

| reasonCode | 条件 |
| --- | --- |
| `action.not_allowed_for_role` | `move.action ∉ t.allowedActions`（strict 模式下解码已保证，`sdk` 变换或 `flat` 形态下才可能出现） |
| `action.option_not_in_snapshot` | `propose` / `counter` 的 `optionKey` 不在 `t.candidateSnapshot` |
| `action.repeats_blocked` | 解析出的 `candidateKey ∈ t.excludedCandidateKeys`（§5.7.2 的同一集合：本 run 已提出（含被阻断）∪ 被人拒绝 ∪ `choose_candidate` 复核失败；快照已剔除，出现即说明快照与守卫不一致，属防御性断言） |
| `output.unknown_reference` | ① `counter.baseProposalVersion`、`recommend_accept.proposalVersion`、evaluate 回合的 `reject.proposalVersion` ≠ `t.baseProposalVersion`；② propose 回合的 `reject.proposalVersion ≠ null` 或 `reasonKey ≠ 'cannot_deliver'`；③ `topicKey ∉ t.topics`；④ `clarify.toRole ≠ topic.ownerRole` 或 `= t.role`；⑤ `reasonKey ∉ t.reasonKeys`；⑥ `escalate.toRole ∉ t.roles` |

重试提示（`RETRY_NOTES[code]` 静态文本，追加在中途 `role:'system'` 回合指令的末尾，**从不回显模型原文**；除 `output.truncated` 外都随下一 attempt 发送，`output.truncated` 的发送方式见表后）：

| code | 提示 |
| --- | --- |
| `output.not_json` / `output.schema_violation` | "Your previous response was not a single JSON object matching the schema. Respond again with only the JSON object." |
| `output.truncated` | "Your previous response was cut off. Keep reasoning brief and the rationale under three sentences." |
| `action.not_allowed_for_role` | "That action is not allowed in this turn. Allowed actions are listed above." |
| `action.option_not_in_snapshot` / `action.repeats_blocked` | "Choose an optionKey that is listed in <candidates>." |
| `output.unknown_reference` | "Reference only the proposal version, topics, reasons and roles listed for this turn." |

`output.truncated` 不开新 attempt（canon D09：截断在同一次调用内重发一次，10 §10.10.1）：网关以同一 `system` / `user` 块、同一角色视图与同一输出 schema **重建**请求，只在回合指令末尾追加上表的截断提示后重发一次；两次响应的 `usage` 求和记入同一 attempt（两次都计费），重发只能使用总截止 `CALL_DEADLINE_MS` 的剩余预算。第二次仍截断 → `output.truncated` 且 `retryable: false`；重发前或重发中总截止到期 → 不可重试的 `model_timeout`。两种情形都不产生 `auto_retry` attempt（10 §10.10.2）。

## 5.7 候选快照与 `optionKey`

### 5.7.1 快照项（canon D10，逐字采用）

```ts
// Convex validator：即 03 §3.4 的 candidateV（turns.candidateSnapshot 的元素），此处只复述，以 03 为准
export const candidateV = v.object({
  optionKey: v.string(),            // 'O1'..'On'，n ≤ 12；位置标签，只在本回合有意义
  candidateKey: v.string(),         // canonical(itemKeys, modifiers)，如 'audit_log_export+sso_login@rush'；服务端身份
  itemKeys: v.array(v.string()),    // 排序、去重，全部是已确认目录条目
  modifiers: v.array(v.string()),   // 已确认的修饰项（catalogItem kind: 'modifier'），如 ['rush']
  amountCents: v.number(),          // 按当时目录行求和（assertCents）
  deliveryDate: v.string(),         // IsoDate：快照时 localDate + max(leadDays)，仅供展示；提案插入时按 D22 重新物化
});
```

快照由**创建回合的 mutation** 计算并写入 `turns.candidateSnapshot`，之后不可变；`turns.complete` 只在这份快照里把 `optionKey` 解析为 `candidateKey`，**从不重新枚举**（避免"模型看到的"与"服务端解析的"不一致）。

### 5.7.2 每个角色的视图与快照规则（`enumerateCandidates(viewFor(role), opts)` 归 06 实现）

| 回合 | 视图（枚举时可用的约束） | 剔除 | 顺序与截断 |
| --- | --- | --- | --- |
| provider · propose | 已确认目录（条目 + 修饰项）+ 他方经披露账本给 provider 的事实（如 `requiredItemKeys`、`deadline`，取决于 customer 的勾选）；**不含任何预算数字** | `excludedCandidateKeys(run)` = 本 run 内已提出过的（含被阻断、未插提案的 `turns.outcome.blockedCandidateKey`）∪ 被人拒绝的（08 A5）∪ 本 run 内 `choose_candidate` 复核失败的（§5.11.4）；派生不存（03 §3.8），与 06 §10.1 同一定义；比 canon D10 字面更严（§5.20） | 按 `candidateKey` 字典序；第 1 轮 O1 固定为该视图下金额最低的、含已披露必需项的候选（抑制锚定）；若上一轮 customer 的 counter 被转发，强制纳入快照（仍按字典序就位，`<room_state>` 指明它是哪个 O）；最多 12 项 |
| customer · evaluate | 已确认目录 + customer 自己的已确认简报（必需项、截止日、软偏好）+ 披露给 customer 的事实（如 finance 打开 `capCents` 开关后的上限） | base 提案的 `candidateKey` ∪ `excludedCandidateKeys(run)` | 按 `candidateKey` 字典序，最多 12 项 |
| finance · evaluate | 不需要候选（finance 不能 counter，话题表里也没有引用候选的话题） | — | 快照为空（n = 0） |

- **为什么 evaluate 快照不含 base**：base 的条款单独出现在 `<room_state>`；counter 的 `optionKey` 枚举因此天然排除 base，`counter == base` 在解码层不可能出现（np-review r09）。canon 的"n < 2 去 counter"在此等价于"n < 1"。
- **为什么不按预算过滤 provider 的候选**：候选集的边界会把余量夹进相邻价格之间（07 的 16 条评委反例中有 5 条是这一类）；被预算挡住的提案改由 `checkProposal` 判为 blocked，provider 只得到 1 bit。
- **为什么不按偏好排序**：排序本身就是信息（07 评委：给 provider 的候选按 customer 的未披露偏好排序，stub 又选第一个）。
- **剔除已提出过的候选**：run 内约束冻结（cv 不变），同一候选再提一次不可能得到不同的规则结论；剔除也让 provider 的"已知被阻断"无需额外字段（np-review r03 的修正：stub 不会重复提出被阻断的候选）。剔除只看本 run 的历史，不看其他 run，也**不**按"旧提案在新 cv 下是否通过"剔除——那会把 D12 ① 禁止的实时重算结论泄露给 provider。
- **视图为空**：provider 视图在剔除后为空 → 不创建 provider 回合，直接按 §5.8.5 处理；customer 视图为空 → 该 evaluate 回合没有 counter（§5.3.3）。

### 5.7.3 解析与物化（`turns.complete` 内）

1. `item = turn.candidateSnapshot.find(c => c.optionKey === move.optionKey)`（语义校验已保证存在）。
2. `materializeTerms(item.candidateKey, catalogNow, today)`：`today = room.localDate`（规则与物化一律读它，query 与 mutation 结论同源，09 §9.6.7；`todayInTimeZone` 只用于推进 `localDate`）。午夜后的滞后窗口在进入本步之前已经消除：`turns.complete` 在守卫 G1–G3 **之前**调用 `rollLocalDateTx(room)`（10 §10.7.2 步骤 2b，与 09 §9.6.7 同一 helper）——`todayInTimeZone(now, room.timeZone) > room.localDate` 时推进 `localDate`；negotiating 期间没有 `pending_approval` 提案也没有 open 请求，09 的翻转判定通常不成立，只推进不 bump；万一 bump，D06 在同一事务 supersede 当前 run，本 attempt 随即被 **G1** 判 stale，由 `react()` 开的新 run 接手。因此此处读到的总是当日 `localDate`；`lines[] = {itemKey, revision, title, priceCents, leadDays}` 取当前已确认修订（run 内价格与工期不变，标题可能已改，提案快照当时的标题）；`terms = { itemKeys, modifiers, deliveryDate: addDays(today, max(leadDays)), amountCents: Σ lines.priceCents }`；`plannedTasks[]` 由当前 `taskTemplates` 派生；`termsKey = canonicalJson(terms)`。
3. 断言 `terms.amountCents === item.amountCents` 且条目、修饰项相同；不等 → `amount.claim_mismatch`（只可能是缺陷：价格变化必然 bump cv，守卫 G3 先拦住）→ attempt `error`，ops 告警。
4. `deliveryDate` 与快照不同（回合期间 `localDate` 已被 cron / 房间午夜 `runAt` / 步骤 2b 推进且结论未翻转）不算错误：以插入时的 `room.localDate` 为准（D22），不记额外字段。
5. `fit = checkProposal(ruleInputNow, { terms, lines }, today)`（全量 RuleInput）：**不通过 → 不插提案、不消耗版本号**；`turn.outcome = { candidateKey, blockedCandidateKey: candidateKey }`，该键进入 `excludedCandidateKeys(run)`，provider 下一回合只得 `fit: 'blocked'`（P10；03 §3.8、04 §4.3.4、06 §9.2）。
6. 通过 → `insertProposal`（03 §3.9 唯一插入 helper，内部再断言 `passesChecks`）：`version = room.nextProposalVersion`（并 +1）、`origin: 'agent'`、`authorRole: 'provider'`、`runId`、`sourceTurnId`、`candidateKey`、`createdAtConstraintsVersion`、`requiredApprovals` 快照、`status: 'active'`；同 run 内上一个 `active` 提案 → `superseded`；`run.currentProposalId` 指向新提案；`turn.outcome = { candidateKey, proposalId }`。
