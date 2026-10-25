# 05 · 协商协议（part5：clarify、escalate、人工请求、跨角色反馈）

> 分片清单见 `05-protocol.md` 开头。

## 5.9 clarify：话题化的披露请求

### 5.9.1 话题表（场景声明；结构归本章，取值由 14 定稿）

```ts
export type ClarifyTopic = {
  topicKey: string;
  askers: readonly Role[];        // 谁的代理可以问
  ownerRole: Role;                // 信息所有者 = clarify.toRole 必须等于它
  field: string;                  // 所有者简报中的字段（disclose 时写入 sharedFacts 的 field）
  answer: 'human' | 'code';       // v1 全部为 'human'；'code' 留给第二场景（代码可从公开信息作答的话题）
  questionTemplateKey: string;    // renderPublicText 的模板键
};
```

取值以 14 §3 的 `protocol.topics` 为唯一来源（下表只是复述；v1 全部 `answer: 'human'`）：

| topicKey | askers | ownerRole | field | 说明 |
| --- | --- | --- | --- | --- |
| `item_required` | provider、finance | customer | `requiredItemKeys` | 必需条目 |
| `deadline_value` | provider、finance | customer | `deadline` | 硬截止日 |
| `budget_room` | customer | finance | `headroomCents` | 等价于 finance 打开 `headroomCents` 对 customer 的披露开关；provider 不可问（D12 ③） |

没有软字段话题（`tradeoffPriority` 不是任何 schema 的字段）；provider 没有可披露的简报字段，所以也没有以 provider 为所有者的话题（14 §3 的 `item_scope` 已删除：对 provider 的提问只能以自由文本作答，违反 D13）。

- **没有 `option_fits_constraints`**：canon D12 ③（修订）要求任何角色都不提供该话题，本设计同此。clarify 载荷里没有 optionKey，"哪个选项可行"只能问成"快照里哪些可行"——对 customer 是逐候选的预算探针（U1 默认 customer 看不到预算），对 finance 是 customer 私密截止日 / 必需项的探针。canon D12 ③ 已采纳同一口径（OBJ-28）。
- **provider 永远不能问预算**（PV-07：provider 永远拿不到任何预算数字）。
- 本回合可问的 `topicKeys` = 本角色在 `askers` 内、该字段尚未对本角色披露、且所有者本 run 未拒绝过同一 (asker, field) 的话题；为空则去掉 `clarify`。

### 5.9.2 流程

1. 代理输出 `clarify { toRole, topicKey }`；语义校验确认 `toRole === topic.ownerRole` 且 ≠ 自己。
2. `answer === 'code'`（v1 无）：答案写入发问方下一回合的 `clarifyAnswers`；provider 发问 → 同一轮再开一个 provider 回合；evaluator 发问 → 按 canon D08 计为"未接受"，进入下一轮。
3. `answer === 'human'`：run → `needs_input`，恰好开一个 `kind: 'clarify'` 请求给 `ownerRole`，选项 `disclose { field, toRoles: [发问角色] }`、`keep_as_is`（= 拒绝披露）与 `end_run`（与其他 kind 一样以 `end_run` 收尾，§5.11.2）。请求页写明答复的受众（"Your answer will be visible to: provider"）。
4. 回答 `disclose`：经 07 的披露闸门写 `sharedFacts { fromRole: owner, field, value }`（值取所有者**当前已确认**简报，受众 = 发问角色）；回答 `keep_as_is`：记录本 run 的拒绝。两种回答都让 run → `negotiating`，并**在同一轮**为发问角色新开一个同类回合（新 `turnSeq`；evaluate 回合评估同一个 base），`clarifyAnswers = [{ topicKey, outcome: 'disclosed' | 'declined' }]`，该角色本 run 不再有 `clarify`。
5. 披露不改变任何硬约束（不 bump）：它只改变发问方视图，下一快照自然反映（例如 provider 得知 `deadline` 后其候选集被截止日过滤）。

## 5.10 escalate：策略检查

`acceptEscalation(move, ctx): { accepted: false } | { accepted: true; request: RequestPlan }`（纯函数）。模型的 `toRole` 记录在回合结果里，只作参考；**打扰谁由代码决定**。

| kind | 接受条件（全部满足） | 接受后 | 不接受 |
| --- | --- | --- | --- |
| `infeasible` | 剔除本 run 已阻断与被人拒绝的候选后，`enumerateCandidates(fullView)` 为空（全量约束，代码私有，只以"有 / 无"影响流程；这里故意不用完整的 `excludedCandidateKeys(run)`——已提出且通过检查的候选仍算可行） | `needs_input` + `infeasible` 请求（§5.11.2） | 按 `reject(other)` 处理 |
| `needs_tradeoff` | ① 本 run 尚无被接受的 `needs_tradeoff`；② 场景 `tradeoffOwner`（首个场景 customer）自己的视图里、剔除已阻断与被拒候选后至少有 2 个候选；③ 发起方不是在第 1 轮的第一个回合（provider 首提不可直接甩给人） | `needs_input` + `agent_escalated` 请求给 customer | 同上 |

provider 在 propose 回合的 `reject(cannot_deliver)` 不经策略检查，直接开 `agent_escalated` 请求给 **provider 本人**（只有他能判断产能、决定是否修改目录），选项 `keep_as_is`（"Ask my agent to propose anyway"）/ `end_run`。

## 5.11 人工请求

### 5.11.1 形状（canon D15；完整字段与索引以 03 §3.9 为准，下面只列协议语义用到的字段——03 另有 `topicKey`、`closedReason`、`closedAt`、`provenance`、`createdAt`）

```ts
export const requestEffectV = v.union(
  v.object({ type: v.literal('raise_cap'), amountCents: v.number() }),        // 仅 toRole = finance
  v.object({ type: v.literal('drop_items'), itemKeys: v.array(v.string()) }), // 仅 toRole = customer
  v.object({ type: v.literal('extend_deadline'), date: v.string() }),         // 仅 toRole = customer
  v.object({ type: v.literal('choose_candidate'), candidateKey: v.string() }),// 仅 toRole = customer
  v.object({ type: v.literal('disclose'), field: v.string(), toRoles: v.array(roleV) }), // 被问方；toRoles = 受众（clarify：发问角色；infeasible 回退：尚未获披露的放松角色）
  v.object({ type: v.literal('retry_turn') }),                                 // 失败方
  v.object({ type: v.literal('pass_to_next'), toRole: roleV }),               // 仅 infeasible 请求：relaxationOrder 中的下一角色（canon D15、04 R21）
  v.object({ type: v.literal('keep_as_is') }),
  v.object({ type: v.literal('end_run') }),
  v.object({ type: v.literal('blocked') }),   // 只作说明、不可选：该放松成立需要他方未披露的值（canon D11，不写数字）
);   // 与 03 §3.9 的 requestEffectV 同形（disclose 带 toRoles：infeasible 回退请求没有"发问方"，受众只能显式给出）
export const humanRequestFields = {
  roomId: v.id('rooms'), runId: v.id('runs'),
  kind: v.union(v.literal('infeasible'), v.literal('rounds_exhausted'), v.literal('agent_escalated'),
                v.literal('clarify'), v.literal('agent_failed')),
  toRole: roleV,
  questionKey: v.string(),          // 模板键，按 kind + cause 选择（如 'request.rounds_exhausted.call_limit'）
  constraintsVersion: v.number(),   // 创建时的 cv；bump 时整体 superseded
  sourceTurnId: v.optional(v.id('turns')),
  options: v.array(v.object({ optionKey: v.string() /* 'A'..'E' */, templateKey: v.string(), effect: requestEffectV })),
  status: v.union(v.literal('open'), v.literal('answered'), v.literal('expired'), v.literal('superseded')),
  expiresAt: v.number(),            // now + HUMAN_REQUEST_TTL_DAYS（7）天
  answeredBy: v.optional(v.id('users')), answerOptionKey: v.optional(v.string()), answeredAt: v.optional(v.number()),
};
```

请求的 `optionKey` 用字母 `A..E`，与模型的 `O1..On` 区分；问题与选项文本由 `renderPublicText(templateKey, fields)` 按查看者渲染，参数只含目标角色有权看到的值。写入前 `assertOptionsProjected(toRole, options)`：选项中出现的每个金额、日期、条目都必须能由目标角色自己的视图推出（canon D11）。

### 5.11.2 五种 kind 的生成（`buildHumanRequests(trigger, viewFor(toRole))`，06 实现选项计算）

| kind | 触发 | toRole | 选项 |
| --- | --- | --- | --- |
| `infeasible` | 预检无解；`escalate(infeasible)` 被接受 | 按场景 `relaxationOrder = [customer.drop_items, finance.raise_cap]` 选第一个"在自己的视图里存在可放松选项"的角色；都没有 → 回退到 `relaxationOrder[0]` 的角色（customer），选项为它尚未向其他放松角色披露的硬字段各一个 `disclose { field, toRoles }`，末尾 `end_run`（06 §11.2；回答后同事务重跑预检，04 R20；核心 8：不伪造一致） | customer：`drop_items` ×≤2（自身视图内使候选集非空的最小必需项子集）、`extend_deadline`（自身视图内最早可行日）；finance：`raise_cap`（`committedCents` + finance 视图内最便宜候选的金额）；收件人不是 `relaxationOrder` 末位时（含回退请求）另附 `pass_to_next { toRole: 下一角色 }`（是否出现只取决于位置、不取决于任何私密值；每 run 每个 (from, to) 至多一次，04 R21）；均附 `end_run` |
| `rounds_exhausted` | §5.8.5（`questionKey` 后缀按原因：`rounds`；`no_candidates`（含 provider 的 4 次提案上限）；`call_limit` / `spend_limit` 只用于 run 的 attempt / 美元上限） | customer | `choose_candidate` ×≤3、`keep_as_is`（只在 `rounds` 情形、未延长过、provider 仍有可提候选且本 run 未满 4 次提案时提供；`no_candidates` / `call_limit` / `spend_limit` **不提供**，04 §4.8.3；提供与回答共用同一资格谓词，§5.8.5）、`end_run` |
| `agent_escalated` | `needs_tradeoff` 被接受 / provider `cannot_deliver` | customer / provider | customer：`choose_candidate` ×≤3、`keep_as_is`、`end_run`；provider：`keep_as_is`、`end_run` |
| `clarify` | 需要人回答的 clarify | 话题所有者 | `disclose { field, toRoles: [发问角色] }`、`keep_as_is`、`end_run`（与其他 kind 一样以 `end_run` 收尾，04 H1） |
| `agent_failed` | 回合失败且不再自动重试（10）；run 的 attempt / 美元上限（`run.call_limit`，`questionKey` 以 `call_limit` / `spend_limit` 区分）**除外**，那走 §5.8.5 的 `rounds_exhausted`（04 R6 / U5、12 §12.18 同此） | 失败回合的角色 | `retry_turn`、`end_run` |

"在自己的视图里存在可放松选项"的判定：该角色视图下候选集本身为空，且单独放松它的一个硬字段能让视图内候选集非空。若该角色视图下候选集**非空**（它看不到真正卡住的约束），它就没有可放松选项，轮到下一个角色——这正是 $4,700 变体里 customer 被跳过、finance 收到 `raise_cap` 的原因（§5.15）。放松后若仍无解，新 run 的预检会再生成请求：每一步都是人的显式决定，结论由代码重算。

`choose_candidate` 的顺序：本 run 当前提案若仍 `passesChecks` 且未被拒绝排第一；其余由 `scenario.rankForOwner(customerView)` 排序（只读 customer 自己的简报，这是 customer 自己的请求，不违反 D10 对他方快照的排序禁令），剔除本 run 已被规则阻断、被人拒绝与 `choose_candidate` 复核失败的候选。这里**刻意不用**完整的 `excludedCandidateKeys(run)`：已提出过但未被拒绝、仍通过检查的候选（含当前提案）正是人最可能想选的，provider 快照剔除它们是为了不让代理重复提，与人的选择无关（06 §11.2 同此口径）。

### 5.11.3 回答（`humanRequests.answer`）的守卫

守卫顺序与错误码以 12 §12.14 为唯一来源（04 §4.8.2 同序），这里逐条复述：① 成员（`auth.not_member`）；② 调用者角色 === `request.toRole`（`auth.role_forbidden`）；③ `request.status === 'open'`：同一人同一选项已回答 → 返回 `already_answered`（幂等），其他 → `request.not_open`（bump 已把旧请求置 `superseded`，所以不需要单独的 `constraintsVersion` 守卫，也不返回 `version.stale_constraints`）；④ `now < expiresAt`（否则 `request.not_open`，cron 随后标 `expired`）；⑤ 房间 `open`、`request.runId === room.currentRunId` 且 run 为 `needs_input`（`run.invalid_state`）；⑥ `optionKey` 指向可回答的选项（不存在或 `blocked` → `request.option_unknown`）；⑦ 除 `end_run` 外非排空（`run.draining`）；⑧ D12 ⑥ 节流（`run.rate_limited`）；⑨ 效果自身的校验（如 `raise_cap` 的 `budget.below_committed`、`disclose` 闸门的 `disclosure.blocked`）。

### 5.11.4 选项效果 → 结果（canon D15）

| effect | 结果 |
| --- | --- |
| `raise_cap` / `drop_items` / `extend_deadline` | 生成新简报版本并经 `constraints.bump`（09）：旧 run → `superseded`，本请求 → `answered`，`react()` 不动点开新 run（S0 预检） |
| `choose_candidate` | 用全量视图复核：通过 → 若等于本 run 当前 `active` 且仍通过的提案，**复用同一 proposalId**；否则插入 `origin: 'human_choice'`、`authorRole: 'customer'` 的新版本（同 run 上一个 active → `superseded`）；run → `pending_approval`（04 的 `needs_input → pending_approval` 迁移）。不通过 → 本请求 `superseded`（`closedReason: regenerated`，照记 `answerOptionKey` 以保留"人选了什么"，canon D15、04 R19），该候选进入剔除集合，同事务**重新生成**同 kind 请求，run 留在 `needs_input` |
| `disclose` | 经 `sharedFacts.add` 同一闸门写 `sharedFacts`（不 bump）。`clarify` 请求：run → `negotiating`，发问角色同一轮新开回合（§5.9.2，04 R14）。`infeasible` 的回退请求：同事务重跑 S0 预检（04 R20）——仍无解 → 本请求 `answered`，`openHumanRequestTx` 生成新的 `infeasible` 请求（此时放松角色的视图已能看见冲突并得到带金额的选项），run 留在 `needs_input`；有解 → 按 S0 ③ 建 provider 回合，run → `negotiating` |
| `retry_turn` | run → `negotiating`，为同一角色、同一 kind、同一轮新开回合（新 `turnSeq`，`retryOfTurnId`）并经 `turns.beginAttempt` 调度（`origin: 'retry_turn'`，03 §3.8） |
| `pass_to_next` | 本请求 `answered`；同事务 `openHumanRequestTx` 按目标角色**自身视图**生成新的 `infeasible` 请求（`buildHumanRequests(toRole, viewFor(toRole))`；目标视图里没有可放松选项时只含 `disclose` 回退项与 `end_run`）；run 留在 `needs_input`，不 bump、不建回合（04 R21） |
| `keep_as_is` | `clarify`：拒绝披露，发问方同轮新开回合；`rounds_exhausted`：先以提供时的同一资格谓词复核（§5.8.5），成立 → `maxRounds += 1`、`roundsExtended = true`，进入下一轮，不成立 → 等价 `end_run`；customer 的 `agent_escalated`：进入下一轮（轮次已尽则等价 `end_run`）；provider 的 `agent_escalated`：provider 同轮新开回合（`providerRejectLocked` 由此请求派生） |
| `end_run` | run → `ended_no_agreement`（终态，`endedReason: no_agreement`）；房间仍 `open`，任何成员可再 `runs.start`（cause `manual_start`，受 12 §12.13 的每房间每日 run 数上限约束）或改约束 |

到期：cron 把过期请求置 `expired`，run → `ended_no_agreement`，给 creator 生成站内待办。没有任何选项映射到 `rooms.close`。

## 5.12 跨角色反馈（进入代理上下文的"他方信息"）

| 信息 | provider 代理 | customer 代理 | finance 代理 |
| --- | --- | --- | --- |
| 本房间全部提案的条款与版本号 | 有 | 有 | 有 |
| 提案结论 | 本 run 内：`ok` / `blocked`；历史：只显示 `superseded / rejected / executed / current`（D12 ①） | 本方检查的码 + 他方检查的掩码 `private.constraint_unmet` | 同左 |
| 轮次结果 | "vN not accepted" / "customer suggested Ok" / "vN rejected" | 同左；人拒绝显示 "rejected by {role}" | 同左 |
| 他方代理的动作、`reasonKey`、`rationale` | 无 | 无 | 无 |
| 人拒绝的 `reasonKey` / `note` | 无 | 仅本人 | 仅本人 |
| `sharedFacts` | 披露给 provider 的 | 披露给 customer 的 | 披露给 finance 的 |
| 预算数字 | 永不 | 按 finance 三个开关 | 本方 |

他方代理的 `reasonKey` 也不进入：同侧也不默认共享（canon C28），否则 finance 的 `over_budget` 会把"价格接近上限"的信息带给 provider。人类拒绝的 `reasonKey` 对人的可见范围由场景的 `humanReasonKeys[].audience`（`room` / `buyers`）决定（14 §3、07 DX-6），但无论受众如何都不进入任何他方代理上下文。这否决了 np-review r12 第 2 条"把 finance 的 objection 带给 provider"的建议。

**counter 的信道容量（残余风险）**：customer 的 counter 是 ≤12 选 1（≤ log₂(n) ≤ 3.6 bit），每 run ≤ 4 次，每房间每 24 小时 ≤ 6 个 run（12 §12.13 / B7 `run_starts`，含 `react()` 自动开局——人工开局在入口拒绝，系统开局的 run 由 10 §10.5.2 B6a 延期首回合），因此每房间每天 ≤ 87 bit 的理论上界。若 provider 在目录标题里注入"按预算上限的某位数字选 counter"，而 customer 代理部分服从，单 run 泄露上界约 14 bit，且只能泄露 customer 本来就看得到的值（预算数字须 finance 打开开关，U1 默认关）；进入 provider 上下文的只有被转发候选的 `optionKey` / 条款（07 DX-11）。防线：标题在 `<untrusted_data>` 内并转义、宪章声明数据不是指令、counter 只在通过全量检查时才转发；记入 07 残余风险。
