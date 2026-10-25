# 05 协商协议

## 1. 原则
1. **信封归服务端，内容归模型**：身份、角色、版本、ID、金额、日期永远来自服务端；模型只在服务端给出的候选键与插件码中做选择，并写一段只给本方看的 rationale。
2. **候选由代码枚举**：模型不能构造条款，只能 `propose` 某个 `candidateKey`。这把"金额不得由模型发明"从"事后核对"变成"结构上不可能"。
3. **对他方可见的一切来自模板**（I8）。模型文本不进入其他代理的上下文，也不进入公共时间线。
4. **升级给人由代码决定**；模型只能提出"需要问我的委托人"，问题与选项由插件模板生成。

## 2. 服务端信封（不进入模型输出 schema）

```ts
// 存在 turns 行上，由 scheduleTurn 写入快照；complete 只拿快照与当前 room/run 比较
type TurnEnvelope = {
  roomId: Id<'rooms'>; runId: Id<'runs'>; turnId: Id<'turns'>; turnSeq: number; attempt: number;
  round: number; roleKey: string; kind: 'propose' | 'evaluate';
  constraintsVersion: number; proposalId?: Id<'proposals'>; candidateKeys: string[];
};
```
prompt 可以告诉模型"这是第 2 轮"作为背景，但不要求、也不读取模型回显的任何版本号。

## 3. 模型输出 schema（每回合动态生成）

为规避平台不确定性（04：`zodOutputFormat` 把 `enum/const` 降级为描述；根级 `anyOf` 与 `type` 数组是否接受待验证），采用**扁平对象 + 属性级 anyOf 表示可空**，并由引擎自建 JSON Schema（保留 `enum`），同时用同一份定义生成 Zod 做事后校验。

```ts
// packages/engine/src/protocol.ts
export const proposerOutput = (keys: string[], declineCodes: string[]) => z.strictObject({
  action: z.enum(['propose', 'decline']),
  candidateKey: z.enum(keys).nullable(),          // propose 时必填
  declineCode: z.enum(declineCodes).nullable(),   // decline 时必填；码由插件 agent.declineCodes 提供
  rationale: z.string().max(1200),                // 只给本方
}).superRefine(requireByAction({ propose: ['candidateKey'], decline: ['declineCode'] }));

export const evaluatorOutput = (keys: string[], objectionCodes: string[], topicCodes: string[]) => z.strictObject({
  action: z.enum(['recommend_accept', 'object', 'ask_principal']),
  preferCandidateKey: z.enum(keys).nullable(),    // object 时可选
  objectionCode: z.enum(objectionCodes).nullable(), // object 时必填（如 sc.obj.prefer_date / sc.obj.prefer_scope）
  topicCode: z.enum(topicCodes).nullable(),       // ask_principal 时必填（如 sc.topic.scope_vs_date）
  rationale: z.string().max(1200),
}).superRefine(requireByAction({ object: ['objectionCode'], ask_principal: ['topicCode'] }));
```

对应 JSON Schema 片段（引擎 `toOutputSchema()` 生成，非 zod 转换）：

```json
{ "type": "object", "additionalProperties": false,
  "required": ["action", "candidateKey", "declineCode", "rationale"],
  "properties": {
    "action": { "type": "string", "enum": ["propose", "decline"] },
    "candidateKey": { "anyOf": [ { "type": "string", "enum": ["c_LOGIN+REPORTS_std", "c_LOGIN_exp"] }, { "type": "null" } ] },
    "declineCode": { "anyOf": [ { "type": "string", "enum": ["sc.decl.margin_too_low"] }, { "type": "null" } ] },
    "rationale": { "type": "string" } } }
```

动作集与语义：

| 动作 | 谁 | 效果（代码执行） | 绝不产生 |
| --- | --- | --- | --- |
| `propose` | proposerRole | 重新 derive/evaluate 选中候选 → `insertProposal`（authorKind agent）→ 调度评估回合 | 审批 |
| `decline` | proposerRole | 没有可接受候选 → R4 needs_input，`tradeoffs` 给出请求 | 提案 |
| `recommend_accept` | 其他角色 | 记入回合输出；本轮全部推荐 → R2 pending_approval | **decision 行**（核心 2） |
| `object` | 其他角色 | 下一轮 proposer 上下文得到 `{roleKey, objectionCode, preferCandidateKey}`（无 rationale） | 他方可见的自由文本 |
| `ask_principal` | 其他角色 | 代码按 `topicCode` 用插件模板向**本方**委托人开 humanRequest → R4 | 向他方提问的自由文本 |

"还价"（counter）不是单独动作：下一轮 proposer 再次 `propose` 不同候选即为还价；"澄清"即 `ask_principal`；"拒绝"即 `object`（代理层）或人的 `reject`（审批层）。动作集刻意小。

## 4. 回合与轮次

```
round r:
  1. proposer turn（串行深度 1）
  2. 所有非 proposer 的必需审批角色并行 evaluate（串行深度 2，同一 mutation 内多次 runAfter(0)）
  3. 最后一个 evaluate 的 complete 汇总：全推荐 → pending_approval；
     有 ask_principal → needs_input；有 object 且 r < maxRounds → round r+1；否则 needs_input(deadlock)
```
- `maxRounds` 由插件声明（`software_change` = 3）。`runs.pendingTurnSeqs` 记录本轮未完成的回合序号；两个评估回合的 complete 写同一 run 文档，OCC 串行化，后到者看到 `pendingTurnSeqs` 为空才汇总。
- 最坏模型调用数 = `maxRounds × roles.length` = 9（scope change），加每回合至多 1 次应用级重试 → 18；`callLimit` 默认 24。
- 每个回合持久化后界面即时显示（"Provider agent drafting…" / "Finance agent reviewing v2"）；不做 token 流式。

## 5. 公共文本：模板 + 结构化参数
- 提案的公共行 `publicLine = {templateKey: 'proposal.line', params: project.derived(derived, 'room')}`；渲染在客户端按 `viewerRole` 选模板变体（`check.ledger.over_cap.buyer` / `.other`）。存结构化参数，不存渲染后文字（否决 RA-T02）。
- 模型的 rationale 存在 `turns.output`，只经 `turns.mine` 返回给同一 roleKey 的参与方；不进入任何他方代理上下文。
- 不可信文本（用户 notes、他方结构化异议）进入 prompt 时放进 `<untrusted_data source="...">` 定界块；运营者的动态说明用中途 `role: "system"` 消息（04 §4.7），不混入 user 内容。

## 6. 向具体的人请求取舍
- 只有代码能开请求，三种来源：`infeasible`（枚举为空）、`deadlock`（轮次用尽/decline/重复被拒）、`agent_topic`（ask_principal），外加 `turn_failed`（重试用尽，选项 "Retry turn" / "Close negotiation"，targetRole = proposerRole 的人）。
- 结构：`{targetRole, templateKey, params, options[{optionKey, labelTemplateKey, labelParams, effect}]}`；effect 只能是插件 `ConstraintPatch` 或 `ProposalFromOption`。
- `requests.answer({requestId, optionKey})`：public mutation，`requireRole(targetRole)`；代理永远调用不到。
  - effect `proposal` → R11：插入 human_option 提案，run → pending_approval；
  - effect `brief` → 写入回答者本人的新简报版本（hardKey 变了则 `bumpConstraints`）→ R10 → 新 run（trigger human_answer）；
  - effect `ledger_cap` → 调与 `ledger.updateCap` 相同的内部函数（要求回答者是 ownerRole）→ R10；
  - effect `none` + `close` → `rooms.close`。
- 同一 run 同一时刻最多 1 个 open 请求（取舍按顺序问，回答开放问题 Q8）；约束变化取消全部 open 请求。
