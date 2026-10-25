# 05 协商协议 · part2：回合与轮次、clarify 与披露请求、向具体的人请求取舍、示例

## 1. 回合与轮次规则（解决 GAP-10）

- **一轮** = provider 的 propose 步骤（1 次调用）+ 评估步骤（customer、finance 并行各 1 次调用）。串行深度 2。
- 先手永远是 provider（报价归它），评估方并行：`scheduleTurn` 在同一 mutation 里为两个评估方各调度一次；两个 `completeTurn` 都 patch 同一 run 与房间，OCC 把它们串行化（M-ROOM）。
- provider 的提案若被规则判为 blocked，**本轮不调用评估方**（省成本，也避免评估一个不可能执行的提案），直接进入下一轮，provider 收到按其角色投影的检查结论作为反馈。
- `maxRounds` 是场景配置（scope_change = 3）。clarify 不消耗轮次，但每个角色每个 run 至多 1 次（`clarifyUsedBy`）。
- 每个回合持久化后才推进；界面展示回合级状态（"Provider agent drafting…"），不做 token 级流式（inputs/04 §4.9）。
- 硬上限：`rooms.modelCallBudget`（默认 40）兜住"拒绝 → 新 run → 再拒绝"的循环（RN-5）。

## 2. 步骤结算 `settleStep(run)`（在 completeTurn / closeRequest 中、pendingTurnIds 为空时调用）

先处理 clarify：若存在关联本 run 的 open blocking 请求 → run 进入 awaiting_input（HR-4），结束。若某角色在本步骤的最新成功回合是 clarify 且请求已关闭 → 只为这些角色重排本步骤回合，结束。否则按下表：

**propose 步骤（provider 的动作，提案 P）**

| 条件 | 结果 |
| --- | --- |
| P.verdict = pass | step = evaluate；并行调度评估方 |
| P.verdict = blocked 且 round < maxRounds | round + 1；调度 provider（反馈 = P 的投影检查 + 本 run 已有的评估方动作） |
| P.verdict = blocked 且 round = maxRounds，或 provider reject | **用尽处理** |

**evaluate 步骤（评估方对 P 的动作）**

| 条件 | 结果 |
| --- | --- |
| 全部 recommend_accept | R-1：pending_approval，当前提案 = P |
| 有 counter / reject 且 round < maxRounds | round + 1；调度 provider（反馈含 counter 的 include/exclude/preferLineKeys 与 reasonCode） |
| 有 counter / reject 且 round = maxRounds | R-1：pending_approval，当前提案 = P；界面标注"代理有异议（仅供参考）"——人有最终决定权 |

**用尽处理**：若 `run.lastValidProposalId` 存在 → R-1（以它为当前提案）。否则 `F = enumerateFeasible(currentInputs, today)`：F 非空 → 向 customer 开 `choose_package` 请求（最多 3 个包）；F 为空 → `tradeoffs(...)` 生成 tradeoff 组。两者都是 R-2。**系统永远不在没有通过检查的提案时进入审批，也不替人"选一个最优解"**（SIM-2，否决 Role A 的 bestFeasibleOption 充当协商结果）。

为什么代码知道可行集却不告诉代理：可行集是 finance 预算、customer 截止日等私密约束的派生值；把它放进 provider 代理的上下文，provider 就能经由 rationale 读到"最贵可行包 ≈ 余量"，违反派生闭包（BR-4、RN-6）。所以可行集只用于三件事：run 开始前的预检、用尽处理、stub 代理之外的测试断言。这是对审查 F05.5"代码枚举候选、模型挑选"的有意偏离（18 ADR-07）。

## 3. clarify → 披露请求（解决 GAP-11、PR-17）

代理之间不互相"回答问题"。原因：被问方代理掌握的是它委托人的私密简报，它的回答就是一次未经委托人决定的披露（违反核心 1）。因此：

1. 代理发出 `clarify { code, itemKey? }`。问题码映射到（字段所有者角色，字段列表），见 part1 §3 的 `QUESTIONS`。
2. `completeTurn` 为字段所有者开一个 `disclosure` 请求（blocking），选项由代码生成：
   - `disclose → { kind: "roles", roleKeys: [提问角色] }`（"只告诉 provider"）
   - `disclose → { kind: "room" }`
   - `decline`
3. 所有者选择披露 → `commitBriefVersion` 产生一个只改 `disclosures` 的新版本（`ruleFieldsChanged = []`，不 bump，旧审批不受影响）→ `closeRequest` → R-4：提问角色在本步骤重跑，新上下文里能看到披露的字段。
4. 所有者拒绝 → 请求 declined → R-4：提问角色重跑，上下文写明"customer declined to disclose LATEST_ACCEPTABLE_DATE"（这条事实本身对提问方可见，属策略披露）。

## 4. 向具体的人请求取舍（PR-11、GAP-12）

人工请求是结构化的"问题 + 选项"，每个选项对应目标人可以执行、系统可以原子应用的一个具体效果。

| 字段 | 内容 |
| --- | --- |
| 目标 | 一个参与方（`targetParticipantId`）；同一次触发可能向多个角色各发一条，共享 `groupKey` |
| 问题 | `question.code`（`NO_FEASIBLE_PACKAGE`、`ROUNDS_EXHAUSTED`、或 clarify 的问题码）+ `cause` reasonCode；文本由模板渲染（HR-1） |
| 选项 | `scRequestOptionV`（03 §15）。每个选项附"效果预览"（投影后的，例如"选择后 USAGE_REPORTS 变为可延后，存在可行方案"） |
| 截止 | 无自动过期（等待人本身只是状态行）；房间 phase 显示"等待 customer 回答" |
| 回答方式 | `requests.answer({ requestId, optionKey })`，只有目标本人可调（HR-2） |

选项效果与权限：

| effect | 目标角色 | 应用方式 | 是否 bump |
| --- | --- | --- | --- |
| `make_optional{itemKeys}` | customer | 新 customer 版本：requiredItemKeys − itemKeys（origin request_answer） | 是 |
| `relax_deadline_to_fit{proposalId,toDate}` | customer | 新版本：deadline = toDate（toDate 来自公开提案的交付日） | 是 |
| `raise_cap_to_fit{proposalId,toCents}` | finance | 新版本：budgetCapCents = toCents（= committed + 该公开提案金额） | 是 |
| `revise_offer{itemKeys}` | provider | **导航型**：服务端不接受它作为回答；界面打开报价编辑器，provider 确认新报价即 bump 并关闭整组 | 由后续确认决定 |
| `choose_package{lines,deliveryDate}` | customer | 物化条款并以 `author = human_choice` 插入提案；在当前约束下评估全部通过才接受 | 否 |
| `disclose{field,audience}` | 字段所有者 | 新版本只改 disclosures | 否 |
| `decline` | 任意目标 | 关闭本请求；整组全部 declined → R-6 no_agreement | 否 |

数值参数为什么只能来自公开提案（HR-3）：若给 finance 的选项写"把上限提到 $4,750"，而 $750 是从 provider 尚未公开的报价算出的，finance 就得知了 provider 的私密价格。所以 `raise_cap_to_fit` 必须引用一个已公开、且唯一失败项是 OVER_BUDGET 的提案；没有这样的提案时，finance 只收到不带数字的"提高上限"提示（导航到预算表单）。

## 5. 不可信文本的边界（F05.4）

跨方进入代理上下文的人写文本只有：房间 title/goal、请求项 title/description、报价行 label/taskTitle、显示名、决定的 publicNote、`changeReason`（若披露）。全部：长度上限（≤ 280，goal ≤ 2000）；放进 `<untrusted_text source="...">…</untrusted_text>` 定界块并转义 `<`；system prompt 声明块内是数据、不是指令。他方代理的 rationale 永不进入上下文，所以不存在"代理对代理"的注入通道。运营者动态说明（例如"约束已从 v2 变为 v3"）用中途 `role: "system"` 消息（inputs/04 §4.7），不混进 user 内容。

## 6. 示例（一次完整的第 2 轮 propose）

模型输出（L1–L2 通过）：
```json
{ "message": { "action": "propose",
  "lineKeys": ["SSO_LOGIN:std", "USAGE_REPORTS:full"], "deliveryDate": "2026-11-20",
  "rationale": "v1 failed the customer's deadline and the finance limit. Dropping CSV export (latest lead time, most expensive) keeps both items the customer listed first." } }
```
`completeTurn` 写入的提案（节选）：
```json
{ "version": 2, "constraintsVersion": 3, "derivedFromProposalId": "<v1>",
  "author": { "kind": "agent", "roleKey": "provider", "turnId": "<t>", "agentMode": "llm" },
  "terms": { "lines": [ { "itemKey": "SSO_LOGIN", "variantKey": "std", "priceCents": 50000, "earliestDeliveryDate": "2026-11-16" },
                        { "itemKey": "USAGE_REPORTS", "variantKey": "full", "priceCents": 40000, "earliestDeliveryDate": "2026-11-20" } ],
             "includedItemKeys": ["SSO_LOGIN", "USAGE_REPORTS"], "deferredItemKeys": ["CSV_EXPORT"],
             "amountCents": 90000, "deliveryDate": "2026-11-20" },
  "creationVerdict": "pass", "requiredApproverRoles": ["customer", "provider", "finance"] }
```
房间事件（模板渲染，各方相同）："Provider agent counter-proposed v2: SSO login + Usage reports (full) for $900, delivery 2026-11-20; CSV export deferred." rationale 只出现在 provider 的"我的代理"面板。随后 customer 与 finance 回合并行开始。
