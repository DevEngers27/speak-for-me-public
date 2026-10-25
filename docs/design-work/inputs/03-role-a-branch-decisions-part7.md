# 03 Role A 分支决定 · part7：§6 确定性规则（二）约束变化、可行性、取舍请求

## 6.1 RA-R10 改预算上限 — 采纳（补后续流程）

- **现状**：changeBudgetCap（lib/workspace/preview-store.ts:287-327）依次做：
  1. 守卫：仅 finance；房间未 confirmed；新上限 ≥ committed；与原值相同则拒绝；
  2. 写入新上限，`constraintsVersion += 1`，写全员事件 constraints_changed（文本含新旧金额）；
  3. 当前提案仍可行 → 复制成新版本（见 RA-R11）；不可行 → status = needs_input，写事件 proposal_blocked。
- **保留的部分**：
  - 只有 finance 能改；
  - 上限不得低于已承诺；
  - 任何上限变化都递增约束版本，让旧审批失效；
  - 超限的提案立即不可执行。
- **问题**：
  1. 后续只看预算，不重跑完整检查；
  2. 上调上限时不会重新考虑更好的方案，例如全量变更变得负担得起；
  3. 不可行时既不判定可行性，也不向任何人发请求，要等有人点 "Check confirmed options"；
  4. 不记录变更原因；
  5. 事件把金额公开（RA-B08）。
- **新设计要求**：统一的约束变化流程（09）：
  1. 写约束快照，递增约束版本；
  2. 所有未执行提案的派生状态自动重算（查询时派生即可）；
  3. 当前提案不再可执行时，运行可行性预检（RA-R12）：存在可行的已确认组合 → 调度一次重新协商 run；不存在 → 生成 humanRequest；
  4. 当前提案仍可执行时，保持为当前提案，只需重新审批，旧审批自动 stale；
  5. 上调后是否自动寻找更优方案，列为开放问题 Q7。

## 6.2 RA-R11 复制 `revalidated` 新提案版本 — 否决

- **现状**：上限变化后当前提案仍可行时，执行 `{...proposal, id: 新, version: +1, constraintsVersion: 新, origin: "revalidated", sourceRefs: [...旧, "Re-checked under constraints vN"]}`（preview-store.ts:306-311）。sourceRole 仍是 "provider"，而事件的 actor 是 finance（preview-store.ts:314-316）。
- **否决理由**：
  1. 审批已经绑定约束版本，旧审批本来就会自动 stale，复制提案只是第二次绑定（gap1-06）；
  2. 让"谁提出了这个版本"失真；
  3. 把"条款没变"伪装成新提案，制造版本噪音，对比表里会出现两行条款完全相同的版本。
- **替代方案**：
  - 提案保持原 version 与 contentHash，"在约束 vN 下的评估结果"作为派生数据；
  - 审批绑定 (proposalId, constraintsVersion)；
  - 审批界面明确提示"条款未变；约束从 v1 变为 v2；需要重新批准"。

## 6.3 RA-R12 `bestFeasibleOption` — 修改后采纳（降级为可行性预检）

- **现状**：在已确认、且价格 ≤ 剩余预算的报价中，按范围条目数降序、价格升序取第一个（lib/workspace/rules.ts:74-78）。UI 如实写明这是 "one fixed rule" 而不是代理（components/workspace/workbench.tsx:88；lib/workspace/types.ts:99）。
- **保留的部分**：
  - 可行性判定完全可以由代码完成，不必调模型（gap4-02 的审查结论也认可这一点）；
  - 规则产出的方案如实标注为"规则选出，非代理"。
- **否决的部分**：用"条目数最多、再最便宜"挑出最优方案，直接充当协商结果。
  - 条目数不是价值度量；
  - 它忽略必需范围与截止日。gap1-07 的复现中，正是它选中了只含可延后项的报价（RA-B12）；
  - 完全并列时结果取决于数组顺序。
- **新设计要求**：
  - `findFeasibleOffers(input) → {feasible: OfferRef[][], infeasible: {offerRefs, reasonCodes}[]}`，与 checkProposal 共用同一套检查；组合规则（是否允许多个报价组合）由场景决定；
  - 用途一：协商前把代理的可选空间限制在可行集合内；
  - 用途二：约束变化后判断是"重新协商"还是"向人请求取舍"；
  - 用途三：stub 模式下作为确定性的代理替身，产出的提案 `authorKind = "rule"`，并如实标注。

## 6.4 RA-R13 无可行解 → 取舍请求 — 修改后采纳

- **现状**：
  - 无可行报价时 `room.status = "needs_input"`，并写一条全员事件："No confirmed option fits the remaining $X. A person must choose a tradeoff: defer more scope, confirm a cheaper option, or raise the cap."（preview-store.ts:209-216）；
  - 工作台按角色显示静态提示 tradeoffAsk（workbench.tsx:18-22、49），customer：决定能否延后更多范围；provider：在简报里确认更便宜的报价；finance：决定是否提高上限。
- **保留的部分**：三种取舍（延后更多范围 / 确认更便宜报价 / 提高上限）恰好对应三个角色各自的权限。这个拆分很好，原样吸收。
- **问题**：
  1. 没有结构：问谁、有哪些选项、回答存在哪里都没有（product-13、architecture-12）；
  2. 全员事件泄露剩余预算；
  3. 所有人都收到提示，没有责任人；
  4. 回答之后要手动再点一次检查。
- **新设计要求**（建议形状）：

```ts
humanRequests: {
  roomId: Id<"rooms">; targetParticipantId: Id<"participants">;
  blockingReasonCodes: string[]; constraintsVersion: number;
  options: (
    | { kind: "defer_scope"; scopeItemKeys: string[] }
    | { kind: "confirm_offer"; draftOfferKey?: string }
    | { kind: "raise_cap"; minCapCents?: number }   // 仅 finance 可见
  )[];
  status: "open" | "answered" | "superseded" | "cancelled";
  answer?: { optionIndex: number; note?: string }; answeredBy?: Id<"users">;
  createdAt: number; closedAt?: number;
}
```

  - 每个选项对应目标人可以执行的一个具体动作；
  - 回答引起约束变化后，同一阻断下的其他请求自动 superseded；
  - 同时向三人发请求还是按顺序发，列为开放问题 Q8；
  - 问题文本用模板生成，不含他方的私密值。

## 6.5 RA-R14 `describeChange` — 采纳（改为结构化）

- **现状**：rules.ts:83-94 输出 "Cost +$X"、"Adds …"、"Defers …"、"Delivery a → b"、"Constraints v1 → v2"，无变化时输出 "No term changes"。提案卡显示 "Changes from vN"（workbench.tsx:120）。
- **保留的部分**：每个新版本都告诉审批人"和上一版比变了什么"，这是人能快速重新批准的关键。
- **新设计要求**：
  - 先产出结构化 diff `{field, before, after}[]`，再由模板渲染；
  - 区分"移除"与"延后"：看 deferredScope，而不是一律叫 Defers；
  - 约束版本变化不属于条款差异，单独一行展示；
  - diff 同时用于事件 payload 与代理上下文（代理收到的是结构化差异，不是自然语言）。

## 6.6 RA-R15 / RA-R16 简报保存校验与撤回 — 修改后采纳 / 否决（删除）

- **现状**：
  - saveBrief 校验：goal 非空；非 provider 不得带报价；每个报价 label、scope 非空，价格为非负安全整数，日期过正则加 Date.parse（preview-store.ts:168-175）；空条目被丢弃（preview-store.ts:176）；
  - approve 会删除自己的旧拒绝（preview-store.ts:253）；
  - 审批不能撤回（preview-store.ts:275）。
- **裁决**：
  - 校验规则采纳，移到服务端共享 validator（RA-R03）；
  - "删除拒绝"否决；
  - "不能撤回审批"修改为：执行前允许撤回，撤回就是追加一条 `kind: "withdraw"` 的 decision；执行后不可撤回。撤回是否需要理由列为开放问题 Q6。
- **缺陷**：saveBrief 不递增约束版本（RA-B02），不检查房间是否已关闭（RA-B21），报价的确认是客户端布尔（RA-B21）。
