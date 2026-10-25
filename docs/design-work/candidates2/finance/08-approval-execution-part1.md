# 08 审批与执行（part1：签字、执行事务、幂等）

## 1. 目标与决定

| 目标 | 决定 | 被否决的备选 |
| --- | --- | --- |
| 签字证明"批准的就是这份内容" | decision 绑定 `(proposalId, constraintsVersion, contentKey)`；提案只插入 | 只绑版本号（Role A 缺陷：版本号可能复用）；termsHash 用 crypto.subtle（运行时不确定） |
| 谁必须签由代码决定 | 场景常量 `requiredSignatures`，插入提案时快照 | 可改的 `approvalRequired` 字段（可被绕过） |
| 条款签核与预算承诺权责分开 | `signatureKind`: customer/provider 签 `terms`，finance 签 `budget` | 两套独立流程（重复、难同步） |
| 历史完整 | decisions 只追加；撤回 = 追加 withdraw | patch 最新决定（丢失"先拒后批"的历史） |
| 无悬空"已全签未执行" | 执行在最后一票的同一 mutation | 单独 execute 按钮或调度 action（窗口期 + 非事务） |

## 2. `decisions.approve({ proposalId, expectedContentKey })` 事务步骤

`expectedContentKey` 是界面上显示的那份内容的键：防止用户看着旧卡片点到新提案。

| 步 | 动作 | 失败 → 结果 |
| --- | --- | --- |
| 1 | `requireMember` → (user, member)；`kind = signatureKindFor(member.role)` | NOT_AUTHENTICATED / NOT_MEMBER，无写入 |
| 2 | 读 proposal、room、run；G-A 前四项（04 §3） | `STALE_PROPOSAL` / `RUN_NOT_PENDING`，无写入 |
| 3 | `proposal.requiredSignatures` 含 (member.role, kind) | ROLE_FORBIDDEN |
| 4 | `contentKey(proposal) === proposal.contentKey === expectedContentKey` | CONTENT_MISMATCH（前两者不等是缺陷，记 ops 计数） |
| 5 | 载入快照：当前目录、customer 当前简报版本、`ledgerBalance`（读 budgets 文档）；`validateProposal` | NOT_EXECUTABLE{projectedCode}，无写入 |
| 6 | 查该用户在该提案上的最新 decision；若是 approve 且 cv === room.cv → 返回 `{status: "already_approved"}` | 幂等，无写入 |
| 7 | 插入 decision `{approve, seq: last+1, constraintsVersion: room.cv, contentKey}`；写 `decision_recorded` 事件 | — |
| 8 | `signatureStatus(proposal.requiredSignatures, latestByUser, room.cv)` | 未齐 → 返回 `{status: "recorded", missing}` |
| 9 | 齐 → `executeProposal(ctx, {room, run, proposal, balance, authorizing, actor})`（§3） | 任一守卫失败 → 抛错，整个 mutation（含步 7）回滚 |
| 10 | 返回 `{status: "executed", changeOrderId, number}` | — |

- 步 9 失败时步 7 的签字也回滚：签字与执行是一个原子单位，不会出现"签了但没执行、也没报错"。
- 两个人几乎同时签最后两票：两事务都读 run、budgets、同一 proposal 的 decisions 区间 → OCC 让后者重试；重试时看到 run 已 confirmed → 步 2 返回 `RUN_NOT_PENDING`。界面把它显示为 "Already executed: CO-1"（客户端收到错误后读 `rooms.view` 即可）。为了更友好，步 2 若发现 `proposal.status === "executed"` 直接返回 `{status: "executed", changeOrderId}` 而不是抛错。

## 3. `executeProposal`（内部 helper，非导出函数）

```ts
async function executeProposal(ctx: MutationCtx, a: ExecArgs): Promise<Id<"changeOrders">> {
  // E1 主守卫：G-A 全部重查（调用方已查，这里断言，防未来新调用点遗漏）
  // E2 辅守卫：operationKey
  const operationKey = `exec:${a.proposal._id}:cv${a.room.constraintsVersion}`;
  const dup = await ctx.db.query("changeOrders").withIndex("by_operationKey", q => q.eq("operationKey", operationKey)).unique();
  if (dup) return dup._id;                                   // 幂等返回，不写事件
  // E3 预算重算（同一事务、同一快照）
  const budget = await getBudgetForRoom(ctx, a.room._id);     // 读 budgets 文档 → 进入读集
  const bal = await ledgerBalance(ctx, budget._id);
  const chk = checkBudget(bal, a.proposal.amountCents);
  if (!chk.ok) throw new ConvexError({ code: "NOT_EXECUTABLE", reason: "OVER_BUDGET" });
  // E4 签字证据
  assert(a.authorizing.length === a.proposal.requiredSignatures.length);
  // E5 写入（同一事务）
  const number = await nextChangeOrderNumber(ctx, a.room._id);
  const coId = await ctx.db.insert("changeOrders", { ...snapshotFrom(a.proposal), operationKey, number,
    constraintsVersion: a.room.constraintsVersion, authorizingDecisionIds: a.authorizing,
    budgetSnapshot: { limitCents: bal.limitCents, limitRevision: bal.limitRevision,
      committedBeforeCents: bal.committedCents, committedAfterCents: chk.committedAfterCents,
      headroomAfterCents: chk.headroomAfterCents }, executedByUserId: a.actor, ... });
  await ctx.db.patch("budgets", budget._id, { nextCommitmentSeq: budget.nextCommitmentSeq + 1 });
  const cvAfter = await bumpConstraints(ctx, a.room, { cause: "commitment_recorded", refId: coId, actorKind: "user" });
  await ctx.db.insert("commitments", { kind: "change_order", seq: budget.nextCommitmentSeq,
    amountCents: a.proposal.amountCents, changeOrderId: coId, proposalId: a.proposal._id,
    operationKey, constraintsVersion: cvAfter, ... });
  for (const t of scenario.deriveTasks(...)) await ctx.db.insert("tasks", { ...t, operationKey: `${operationKey}:task:${t.itemKey}`, status: "todo" });
  await transitionProposal(ctx, a.proposal, "executed");
  await transitionRun(ctx, a.run, "confirmed", { endedReason: "executed" });
  await writeEvent(ctx, "change_order_executed", { audience: room }, ...);
  await writeEvent(ctx, "commitment_recorded", { audience: roles(["finance","customer"]) }, ...);
  return coId;
}
```

- 写入顺序在一个事务里无所谓先后，但上面的顺序保证 commitment 能引用 changeOrderId，且 changeOrder 不需要回填 commitmentId（通过 `commitments.by_changeOrder` 反查），保持变更单不可变。
- `bumpConstraints` 在执行中调用：执行后的已承诺变化属于约束快照（ADR-05）；旧签字随之显示为 "signed (executed)"（04 §5 特例），不会被误判为 stale。
- 执行不取消 humanRequests 以外的东西：执行时 run 一定是 pending_approval，不存在 open 请求。

## 4. 幂等性矩阵

| 重复来源 | 第一道防线 | 第二道防线 | 结果 |
| --- | --- | --- | --- |
| 同一用户连点 approve | 步 6 已签返回 already_approved | — | 1 条 decision |
| 网络重连重发同一 mutation | Convex 客户端去重（inputs/04 §1.11） | 步 6 | 1 条 |
| 两人并发签最后两票 | OCC（run / budgets / decisions 区间读写冲突） | 步 2 状态守卫 | 1 张变更单 |
| 签字与降预算并发 | OCC（双方都 patch budgets 文档） | 执行内 `checkBudget` + G-A 版本比较 | 要么先执行再拒绝降到已承诺以下，要么先降再阻断执行 |
| 代码缺陷导致二次调用 executeProposal | E2 operationKey 查重 | L7 对账检查 | 返回已有 id |
| 未来新调用点（例如 human_choice 后自动执行） | E1 断言 | E2 | 同上 |

并发不变量必须在真实 dev 部署上用并发脚本验证（convex-test 串行，inputs/04 §1.12）。

## 5. `decisions.reject({ proposalId, reasonCode, note?, noteShared })`

1. 鉴权 + G-A 前四项（不要求可执行：永远可以说不）。
2. 插入 decision `{reject, ...}`；事件 `decision_recorded`。
3. run：`round < maxRounds` → negotiating（round+1），在同一 mutation `runAfter(0, internal.agents.runTurn, {turnId})` 调度 provider 回合，信封携带投影后的拒绝码；否则 → needs_input，`openHumanRequests(choose_option 或 no_feasible_option)`。
4. 提案保持 active 直到新提案插入（被拒提案仍是"当前"，但 run 不在 pending_approval，无法再签）。

## 6. `decisions.withdraw({ proposalId })`

- 守卫：最新分录是 approve 且 `constraintsVersion === room.cv`；提案未执行（执行在最后一票原子完成，所以已执行即不可撤回）。
- 插入 `withdraw` 分录；run 状态不变（仍 pending_approval，等待重新签字或拒绝）。

## 7. 过期

| 过期来源 | 机制 |
| --- | --- |
| 约束变化 | 派生：签字 cv ≠ room.cv → stale |
| 提案被替代 | 派生：proposalId ≠ room.currentProposalId → stale |
| 报价到期 `validUntil` | `catalog.saveItem` 为有 validUntil 的修订 `runAt(当天结束于房间时区, internal.catalog.expireItem)`；该 mutation 写 status retired 修订并 bumpConstraints(cause "quote_expired") |
| 签字时间有效期 | v1 不做（开放问题 OQ-3） |
