# 09 约束变更 · part1：约束版本是什么、递增点、确认与 bump 的事务步骤

## 1. 约束版本 = 一个约束集

`constraintSets` 的一行 = 一个约束版本：`{ version, briefVersionIds（每个角色当时的确认版本）, committedCents（快照）, cause }`。`rooms.constraintsVersion` 与 `currentConstraintSetId` 指向最新一行（CS-1）。规则引擎、代理、审批都只认这个元组：

- 规则输入可复现：任一提案在任一历史版本下的检查结果都能从不可变数据重算（CS-2），因此"v2 当时为什么可执行、现在为什么被阻断"总能解释。
- 单一递增入口：`bumpConstraints` 是 constraintSets 与 `rooms.constraintsVersion` 的唯一写者；而能改变规则输入的只有两种写入——简报确认、执行——它们各自只有一个写者，并都调用 `bumpConstraints`（CS-3）。这从结构上消灭了"只 patch 预算、忘了递增版本"的错误（F09.1、RA-B02）。

## 2. 递增点清单（穷举）

| 操作 | 函数 | 递增？ | 理由 |
| --- | --- | --- | --- |
| 任一角色**首次**确认简报 | `commitBriefVersion` | 是 | 规则输入首次出现 |
| customer 改 requestedItems（含标题、描述）、requiredItemKeys、deadline | `commitBriefVersion` | 是 | 规则字段 |
| customer 只改 preferredDate、notes、披露、acknowledgements | 同上 | 否 | 软字段只产生 info 检查；披露不改变可行性（F09.1 改写：软约束不使审批失效） |
| provider 改 offerLines 的任何属性（增删行、价格、最早日、label、taskTitle、validUntil） | 同上 | 是 | 规则字段；taskTitle 进入被批准的执行内容 |
| provider 只改 capacityNotes、notes、披露 | 同上 | 否 | — |
| finance 改 budgetCapCents、externalCommittedCents（含 `briefs.updateBudgetCap`） | 同上 | 是 | 规则字段 |
| finance 只改 paymentNotes、notes、披露 | 同上 | 否 | — |
| 回答人工请求且效果是改规则字段（make_optional、relax_deadline_to_fit、raise_cap_to_fit） | `requests.answer` → `commitBriefVersion` | 是 | 同上 |
| 回答披露请求（disclose） | 同上 | 否 | 只改 disclosures |
| 执行 | `executeIfReady` | 是 | 台账变化，committedCents 增加 |
| 房间改名、改 goal | `rooms.rename` | 否 | 不进规则（Role A Q12） |
| 参与方加入 | `invites.accept` | 否 | 必需角色由场景固定；其简报确认时才 bump |
| 时间推移（今天变化） | — | 否 | 是评估参数，不是输入（06 §5） |
| 房间时区 | — | 不可改 | VAL-3 |
| 必需审批人集合 | — | v1 不可改 | 场景版本内常量；房间固定 scenarioVersion |

`ruleDiff`（06 §10）决定"是否改了规则字段"。只改非规则字段的确认产生新简报版本（历史保留），但不产生新约束集，旧审批继续有效。

## 3. `commitBriefVersion(ctx, participant, input, meta)` 的步骤

调用者：`briefs.confirm`（本人从草稿确认）、`briefs.updateBudgetCap`（finance 便捷入口：以最新确认版本为底，只改上限与原因）、`requests.answer`（应用选项效果，origin = request_answer）、`ops.seed*`（origin = fixture）。

| 步 | 动作 | 失败时 |
| --- | --- | --- |
| 1 | 房间 open；participant 属于调用者（seed 例外，由 internal 入口保证） | `ROOM_CLOSED` / `NOT_A_PARTICIPANT` |
| 2 | 乐观并发：`input.baseVersionNo = participant.briefVersionCount`，否则说明有人（同一用户另一标签页、或请求应答）先确认了新版本 | `BRIEF_VERSION_CONFLICT`（界面提示合并） |
| 3 | `prev = participant.currentBriefVersionId` 的内容；`committed = currentConstraintSet?.committedCents ?? 0` | — |
| 4 | `issues = scenario.brief.validate(role, content, { committed, currentInputs, today })`；finance 的 `budgetCapCents ≥ committed`（EX-5） | `INVALID_BRIEF { issues }`（只含本人字段路径） |
| 5 | `changed = scenario.brief.ruleDiff(role, prev, content)`；若内容、披露、acknowledgements 都与 prev 相同 → 返回 `{ status: "unchanged" }` | — |
| 6 | 插入 `briefVersions`（versionNo = count + 1，`ruleFieldsChanged = changed`）；patch participant 的 `briefVersionCount`、`currentBriefVersionId`；草稿的 `baseVersionNo` 更新 | — |
| 7 | 事件：房间 `brief_confirmed { roleKey, versionNo, ruleChanged, categories }`；本人 `brief_confirmed_detail`；finance 改预算时另写本人 `budget_changed_detail` | — |
| 8 | 若 `changed.length > 0` → `bumpConstraints(ctx, room, { kind: "brief_confirmed", roleKey, briefVersionId, ruleFieldsChanged: changed })` | — |

确认前界面调用 `briefs.previewConfirm`（query）得到"将改变的规则字段"与"会使哪些审批失效"，在按钮旁提示："Confirming changes the deadline. Current approvals on v2 will no longer count."（Role A §7.3）。

## 4. `bumpConstraints(ctx, room, cause)` 与 `onConstraintsChanged`

```ts
async function bumpConstraints(ctx, room, cause) {
  const parts = await currentConfirmedVersionsByRole(ctx, room._id);       // 每个已有确认版本的角色一项
  const ledger = await sumCommitments(ctx, room._id);
  const committedCents = scenario.rules.committedFrom(parts, ledger);      // = finance.externalCommittedCents + ledger
  const version = room.constraintsVersion + 1;
  const csId = await db.insert(ctx, "constraintSets", { roomId: room._id, version,
    briefVersionIds: parts.map(p => ({ roleKey: p.roleKey, briefVersionId: p._id })),
    committedCents, cause, createdAt: Date.now() });
  await db.patchMutable(ctx, "rooms", room._id, { constraintsVersion: version, currentConstraintSetId: csId });
  await emitEvent(ctx, room, roomEvent("constraints_changed", publicCauseOf(cause, version)));
  await onConstraintsChanged(ctx, { ...room, constraintsVersion: version, currentConstraintSetId: csId }, cause);
}

async function onConstraintsChanged(ctx, room, cause) {
  await cancelOpenRequests(ctx, room, "constraints_changed");                       // CS-6
  const run = room.currentRunId && await ctx.db.get("runs", room.currentRunId);
  if (!run) return;                                                                 // 例如执行已先结束 run
  if (run.status === "pending_approval") {
    const p = await ctx.db.get("proposals", room.currentProposalId!);
    const checks = scenario.rules.evaluate(p.terms, await loadRuleInputs(ctx, room.currentConstraintSetId), todayIn(room.timeZone));
    if (allPass(checks)) {                                                          // R-10 不迁移分支
      await emitEvent(ctx, room, roomEvent("reapproval_required", { proposalVersion: p.version,
        fromVersion: room.constraintsVersion - 1, toVersion: room.constraintsVersion }));
      return;
    }
  }
  await cancelLiveTurns(ctx, run);                                                  // 回合 → cancelled，尽力取消调度
  await transitionRun(ctx, room, run, "superseded", { endReason: "constraints_changed" });   // R-9 / R-10
  await startRun(ctx, room, { trigger: "constraint_change", previousRunId: run._id,
    feedback: { kind: "constraint_change", fromRunId: run._id,
      fromVersion: room.constraintsVersion - 1, toVersion: room.constraintsVersion,
      categories: categoriesOf(cause) } });
}
```
- 只有存在非终态 run 时才自动开新 run。setup 阶段的确认、执行之后的确认只 bump，不启动协商（等有人 `runs.start`）。
- `cancelLiveTurns` 对每个 running 回合 `ctx.scheduler.cancel(scheduledFnId)` 并包 try/catch（已开始或已完成的调用会抛错，inputs/04 §1.5），然后把回合标为 cancelled。真正的保证是回合持久化守卫（RN-3），取消只是省钱。
- 新 run 的 `startRun` 先跑可行性预检：可行集空 → 直接 awaiting_input 并开 tradeoff 组，**不调用模型**（审查 P12 的结论：无可行解可由代码判定）。
