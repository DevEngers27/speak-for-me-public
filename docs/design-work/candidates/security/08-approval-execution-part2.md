# 08 审批与执行（part2：原子幂等执行、记录派生、并发分析、审批界面、执行边界）

## 8.5 `executeInTx`：在最后一票的事务里执行

只被 `decisions.decide` 调用（I-16），不是独立的 public 或 internal 入口；因此不存在"全员已批准但没人点执行"的悬空状态，也不存在第二条执行路径。

```ts
async function executeInTx(ctx: MutationCtx, x: ExecCtx): Promise<DecideResult> {
  const { room, run, proposal, approvals, finalApprover } = x;
  const operationKey = `exec:${proposal._id}:${room.constraintsVersion}`;
  // ① 第二道保险：operationKey 已存在则返回已有结果（主防线是 run 状态守卫）
  const existing = await ctx.db.query("changeOrders")
    .withIndex("by_operationKey", (q) => q.eq("operationKey", operationKey)).unique();
  if (existing) { await bumpCounter(ctx, `dup_exec:room:${room._id}`); return executedResult(existing, true); }
  // ② 重算：与 decide 步骤 5 相同的函数、相同的输入（断言）
  const input = await loadConstraintInput(ctx, room);
  const ev = scenario.evaluate(proposal, input.full, todayIn(room.timeZone));
  if (!ev.ok) throw err("PROPOSAL_BLOCKED", { checks: viewEvaluation(ev, finalApprover.roleKey, input.disclosedTo(finalApprover.roleKey), scenario.reasonCodes) });
  const amount = scenario.commitmentAmount(proposal.terms);           // = proposal.priceCents
  const before = input.committedCents;
  const cap = input.financeHard.capCents;
  if (before + amount > cap) throw err("PROPOSAL_BLOCKED");           // I-18（与 OVER_BUDGET 等价的断言）
  if (new Set(approvals.map((d) => d.userId)).size !== proposal.requiredApproverRoleKeys.length)
    throw err("APPROVER_SET_INVALID");                                // 纵深防御
  // ③ 同事务写入：变更单、承诺、任务
  const isSimulated = proposal.isSimulated || room.isSimulated;
  const changeOrderId = await ctx.db.insert("changeOrders", {
    roomId: room._id, runId: run._id, proposalId: proposal._id, proposalVersion: proposal.version,
    constraintsVersion: room.constraintsVersion, operationKey, terms: proposal.terms,
    priceCents: proposal.priceCents, termsKey: proposal.termsKey,
    decisionIds: approvals.map((d) => d._id), executedByParticipantId: finalApprover._id,
    rulesVersion: proposal.rulesVersion, templateVersion: scenario.templateVersion,
    isSimulated, createdAt: Date.now() });
  await ctx.db.insert("commitments", {
    roomId: room._id, changeOrderId, amountCents: amount, constraintsVersion: room.constraintsVersion,
    snapshot: { capCents: cap, committedBeforeCents: before, committedAfterCents: before + amount,
                headroomAudience: input.headroomAudience },
    isSimulated, createdAt: Date.now() });
  const tasks = scenario.deriveTasks(proposal.terms, input.catalog);
  for (const t of tasks) {
    const seat = await seatByRole(ctx, room._id, t.assigneeRoleKey);
    await ctx.db.insert("tasks", { roomId: room._id, changeOrderId, itemKey: t.itemKey, title: t.title,
      assigneeRoleKey: t.assigneeRoleKey, assigneeParticipantId: seat._id, dueDate: t.dueDate,
      status: "todo", isSimulated, createdAt: Date.now(), updatedAt: Date.now() });
  }
  // ④ 状态迁移与事件
  assertTransition(RUN_TRANSITIONS, run.status, "executed");
  await ctx.db.patch("runs", run._id, { status: "executed", outcome: "EXECUTED", endedAt: Date.now() });
  await appendEvent(ctx, room._id, { type: "change_order_executed", proposalVersion: proposal.version,
    constraintsVersion: room.constraintsVersion, priceCents: proposal.priceCents, taskCount: tasks.length });
  // ⑤ 已承诺额变了 → cv + 1（不启动新 run；run 已是终态）
  await bumpConstraints(ctx, room, { kind: "executed", changeOrderId });
  return executedResult({ _id: changeOrderId }, false);
}
```

失败语义：任何一步抛错，整个 `decide` 事务回滚——最后一票、变更单、承诺、任务、run 迁移、事件、cv 递增全部不存在，界面显示错误码；用户可在状态刷新后重试。

## 8.6 幂等与并发分析

| 情形 | 发生了什么 | 结果 |
| --- | --- | --- |
| 同一人双击"Approve"（最后一票） | 两个 mutation 读写同一 run、room 文档 | 第一个执行成功；第二个因 OCC 冲突重试，在步骤 3 看到 `executed`，返回 `{ status: "executed", duplicate: true }`；只有一张变更单 |
| 两名审批人同时投最后一票 | 同上 | 同上；第二人的批准不会被写入（步骤 3 先返回），他的界面显示"已执行，使用了 CO-1" |
| 客户端断线重发 | Convex 客户端重发同一次 mutation，后端去重（inputs/04 §1.11） | 与单次调用相同 |
| 用户在执行后刷新前再次点击 | 步骤 3 | 幂等结果 |
| 有人绕过 UI 直接重复调用 | 同上 | 同上；`dup_exec` 计数 +1，不写房间事件（RA-B25） |
| 降预算与最后一票竞态 | 都写 room 文档 | 见 04 §4.10 |
| 执行事务与回合完成竞态 | run 不可能同时 `running` 与 `awaiting_approval` | 回合守卫或审批守卫必有一方失败 |

验证方式：convex-test 中的 mutation 串行执行，只能证明"连续调用两次只产生一张变更单"（TC-EXE-01）；真正的并发由脚本对真实 dev 部署并发调用 5 次 `decide` 并断言 `changeOrders`/`commitments` 各一行（TC-EXE-02），以及 Playwright 双击（TC-EXE-03）。测试报告必须如实写明方法（F08.5）。

## 8.7 审批界面必须展示的内容

审批卡（13）由 `rooms.view` 的 `currentProposal` DTO 驱动，内容全部来自服务端投影：

1. 确切条款：条目（含标题）、延后项、交付方式与日期、价格明细、目录版本；`termsKey`。
2. 版本：`Proposal v3 · checked against constraints v2`。
3. 检查结果：按查看者粗化（07 §7.12），每项 Pass/Fail 与原因。
4. 与上一提案、与上一约束版本的结构化差异：`{ field, before, after }[]`，"移除"与"延后"分开显示（RA-R14）。
5. 批准后将创建的记录：`previewExecution(proposal, input)` → "Change order (internal record) · commitment +$750 · 2 tasks for provider: Login revamp, Usage reports (due 2026-11-20)"；finance 额外看到 "$4,000 → $4,750 committed of $4,800 cap"；customer（已获 headroom 披露）看到 "Available budget $800 → $50"；provider 只看到条款与任务。
6. 各必需席位的决定状态（含 stale 解释）。
7. 本方代理的建议与 rationale，放在次要区域，标注 "Advice from your agent — only people approve"。
8. 按钮文案来自场景 `approveLabel`：customer "Approve change v3"、provider "Accept terms v3"、finance "Approve budget commitment v3"（数据层都是 `approve`，ADR-19）。
9. 禁用时旁边写明原因（"Blocked: over budget by $100" / "Blocked: buyer-side constraint" / "Constraints changed — review the new version"）。

## 8.8 执行边界

- 只写内部记录：变更单、承诺台账条目、任务。不转账、不签署有法律效力的文件、不调用任何外部 ERP（核心 7）。变更单页面与打印视图页眉写明 "Internal record — not a contract, no payment has been made"。
- 幂等只对内部记录承诺；将来接入外部系统时用 outbox 模式（17），外部副作用不在执行事务内发生，也不宣称 exactly-once。

## 8.9 执行之后的修订

- 已执行的变更单不可修改（核心 6）。同一房间内任一成员可以 `runs.requestRenegotiation` 开启新 run（trigger `renegotiation`），新的提案经审批后产生**新的**变更单与承诺，叠加在已承诺额上；延后的条目（如 EXPORT）就是这样在后续变更中被处理（RA Q9：不自动生成占位）。
- v1 不支持减少已执行范围或退款（金额非负，I-24）；"修订链 + 冲销承诺"是 17 的扩展点。
