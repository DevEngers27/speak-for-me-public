# 05 协商协议（part2：回合与轮次、轮次裁决、澄清即披露请求、升级给人）

## 5.5 回合与轮次规则（解决 GAP-10）

- **一轮** = 一个"主题提案" + 其余所有角色对它的并行评审。
  - 第 1 轮的主题提案来自场景声明的首个提议方（首场景 `provider`）的 propose 回合。
  - 之后各轮的主题提案来自上一轮被采纳的 counter（不需要额外的 propose 回合），或在没有 counter 时由首个提议方再提一次。
  - 人拒绝后（R10），由拒绝者角色的代理发起下一轮的 propose 回合。
- **评审并行**：同一轮的各 review 回合同时调度（各自 `runAfter(0, …)`），每个 `completeTurn` 写自己的结果；读到本轮全部 review 均 `succeeded` 的那个事务执行 `resolveRound`（两个完成事务读写重叠，OCC 保证恰有一个看到"全部完成"）。`resolveRound` 先检查并推进 `run.phase`（`reviewing → idle`），重复调用直接返回。
- **串行深度**：第 1 轮 2（propose → 并行 review），之后每轮 1（只有 review）。`maxRounds = 3`（场景可配）时最坏深度 4，最坏调用数 = 1 + 2×3 = 7，再加自动重试；`maxCalls = 12` 作为硬上限。
- **候选去重**：propose 回合的候选集排除本 run 中已经出现过、且在当前 cv 下对提议方视图显示为 blocked 的条款（按 `pricingKey`），避免代理反复提出已知被阻断的方案（比较 `pricingKey`：它只由目录决定，在任何视图中算出的值都相同）。
- **提议方无候选**：若提议方视图下候选集为空（例如 provider 的最低接单额排除了所有组合），不调用模型，直接进入裁决的"无主题提案"分支。
- **全局预检**：每次调度 propose 回合之前运行 `globalFeasible(input)`（使用全部私密数据，结果只以"有/无"影响流程）。为空则不调用模型，直接 `needs_human`（publicReason `NO_FEASIBLE_OPTION`）。

## 5.6 轮次裁决算法

```ts
// convex/agentRuntime.ts —— 在 completeTurn 的事务内调用，所有输入都在本事务读取
function resolveRound(ctx, room, run, current: Doc<"proposals">, reviews: ReviewResult[]) {
  const input = loadConstraintInput(ctx, room);                 // 当前 cv
  const evalCurrent = evaluate(current, input, todayIn(room.timeZone));
  const counters = dedupeByPricingKey(reviews.filter(isCounter))
    .filter((c) => c.pricingKey !== pricingKeyOf(current));
  const pick = sortBy(counters, [roleRank(scenario.counterPriority), (c) => c.priceCents])[0];
  const canContinue = run.round < run.maxRounds && run.callCount + reviewersExcept(pick).length <= run.maxCalls;

  if (pick && canContinue) {                                    // ① 采纳 counter，进入下一轮
    const p = insertProposal(ctx, { candidate: pick.candidate, author: agentOf(pick), derivedFrom: current });
    advanceRound(run, { phase: "reviewing" });
    scheduleReviews(run, p, reviewersExcept(pick.roleKey));
    return;
  }
  if (evalCurrent.ok) return toAwaitingApproval(run, current);  // ② 当前提案通过
  if (pick) {                                                   // ③ 轮次/调用用尽，但有 counter
    const p = insertProposal(ctx, { candidate: pick.candidate, author: agentOf(pick), derivedFrom: current });
    return evaluate(p, input, today).ok ? toAwaitingApproval(run, p) : toNeedsHuman(run, "ROUNDS_EXHAUSTED");
  }
  if (canContinue && globalFeasible(input).length > 0) {        // ④ 再由首个提议方提一次
    advanceRound(run, { phase: "proposing" });
    return scheduleTurn(run, "propose", scenario.firstProposerRoleKey);
  }
  return toNeedsHuman(run, globalFeasible(input).length === 0 ? "NO_FEASIBLE_OPTION" : "ROUNDS_EXHAUSTED");
}
```

规则说明：
- counter 的采纳顺序只按场景声明的角色优先级（首场景 `customer > finance > provider`）与价格，**不按"是否通过全局检查"**：否则未被采纳的一方能从"为什么不选我"推断出他方约束。
- 代理的 `reject`（不带 counter）不阻止 ② 发生：它只是给本方委托人的建议。
- 被采纳的 counter 成为提案时，作者记为提出该 counter 的代理角色，`derivedFromProposalId` 指向被还价的提案。
- 未被采纳的 counter 只留在其作者的 `agentNotes` 中，不公开。

## 5.7 升级给人：问谁、给什么选项

触发点只有四个，全部由代码判定：全局预检为空（R3、④）、轮次或调用用尽仍无通过提案（R6、③）、最后一轮被人拒绝（R11）、代理发起披露请求（§5.8）。

**选项按目标角色的视图生成**（与候选枚举同一原则）：`relaxations(roleView, publicReason)` 只读取目标人有权看到的信息。这样请求里出现的数字（例如给 finance 的"至少提高到 $4,450"）只可能是目标人本来就能推出的值；代价是目标人看不见的约束可能让放宽后仍然无解，此时下一次预检会再次生成请求（每一步都是人的显式决定，结论仍由代码重算，正确性不受影响）。

| publicReason | 目标 | 选项生成（目标视图内） |
| --- | --- | --- |
| `NO_FEASIBLE_OPTION` | finance | `amend_brief{capCents}`：在 finance 视图下使某个候选可行的最小上限；`decline` |
| | customer | `amend_brief{dropRequiredItemKeys}` / `amend_brief{deadline}`：在 customer 视图下使某个候选可行的最小放宽；`decline` |
| | provider | `revise_catalog`（无数字，引导到目录编辑）；`decline` |
| `ROUNDS_EXHAUSTED` | customer、finance（场景 `tradeoffOwners`） | `adopt_candidate`：目标视图中排名前 3 的候选；`decline` |
| 人拒绝后用尽（R11） | 拒绝者 | 同上，但只发给拒绝者 |
| `DISCLOSURE_ASKED` | 被请求披露的人 | `disclose_field{fieldKey, audience:[askerRole]}`；`decline` |

请求问题文本由模板按目标渲染，例如：
- finance："No combination of the published quotes fits every current constraint. Raising your cap to at least $4,450 (+$50) would allow LOGIN (standard, 2026-11-20)."
- customer："No combination fits every current constraint. You can make LOGIN optional, which would allow REPORTS (standard)."
- provider："No combination of your published quotes satisfies the buyer side's constraints. You can publish a revised catalog."

多个目标**并行**收到请求（RA Q8）。第一个导致约束变化的回答触发 `bumpConstraints`，同 run 的其余请求随之 `cancelled`（H3）；`adopt_candidate` 被采纳并通过检查时，兄弟请求同样取消（R12）。

## 5.8 澄清 = 结构化披露请求（解决 GAP-11、PR-17）

- 代理之间没有自由文本通道：一方代理的问题若由另一方代理凭其私密简报作答，答案就是一条未经人决定的披露（违背核心 1），同时也是注入通道。
- 因此 `clarifyTarget = "customer.deadline"` 的含义是："请求 customer 本人决定是否把 deadline 披露给我方"。系统为 customer 生成 `kind: "disclosure"` 请求；customer 选 `disclose_field` 则写入一个只改披露的新简报版本（不递增 cv），之后各回合的 `sharedFacts` 自然包含该值；选 `decline` 则请求方代理之后的上下文里看到 "customer declined to share deadline"。
- 非阻塞：run 不等待回答。
- 限额：同一 (请求方角色, 字段) 同时至多一个 open 请求；每个代理每个 run 至多 2 个；过期 7 天。可请求的目标只限场景声明为可披露、且尚未对请求方披露的字段（`clarifyTargets`），由输出 schema 的枚举强制。

## 5.9 人对提案的拒绝

`decisions.decide({ kind: "reject", reasonCode, note })`：
- `reasonCode` 取自场景声明的公开词表（如 `TERMS_NOT_ACCEPTABLE`、`NEEDS_EARLIER_DELIVERY`、`OVER_OUR_LIMIT`、`SCOPE_INSUFFICIENT`），界面明示"This reason is visible to everyone in the room"；`note` 同样房间可见。
- run 走 R10（还有轮次：拒绝者的代理在下一轮 propose，上下文含本人的 reasonCode 与 note）或 R11（用尽：给拒绝者发 `adopt_candidate` 请求）。拒绝永远不会让房间停在无出路的状态（修复 RA-B16）。
- 其他人已有的 approve 保留在记录中；它们绑定的是被拒绝的提案，新提案需要重新批准。
