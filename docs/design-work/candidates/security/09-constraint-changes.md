# 09 约束变更

## 9.1 哪些操作递增约束版本（唯一入口 `bumpConstraints`）

cv 的定义：规则求值的全部输入的版本（02 §2.4）。下表是**全部**入口；不在表中的写入不得改变 cv（I-06），代码评审与 TC-VER-08 共同把关。

| 入口 | 角色 | 改变的规则输入 | 快照 cause |
| --- | --- | --- | --- |
| `briefs.confirm`（customer，`hardDigest` 变化） | customer | `requestedItemKeys`、`requiredItemKeys`、`deadline` | `brief_confirmed` |
| `briefs.confirm`（provider，`hardDigest` 变化） | provider | `minChangeOrderCents` | `brief_confirmed` |
| `briefs.confirm`（finance，`hardDigest` 变化）与快捷入口 `budget.update` | finance | `capCents`、`baselineCommittedCents` | `brief_confirmed` |
| `catalog.publish` | provider | 目录条目、价格、日期、加急费 | `catalog_published` |
| `requests.answer(amend_brief)` | 目标人 | 补丁涉及的硬字段 | `brief_confirmed` |
| `executeInTx` | 系统 | 已承诺额（新增一条承诺） | `executed` |

不递增 cv 的写入：备注、软偏好（首选日、偏好条目）、披露设置（这三类只产生新简报版本）；房间目标（建房后不可改，RA Q12）；显示名；任务状态；邀请。

`setup` 阶段不递增：此时没有提案与决定，无需失效；激活时 cv 直接置 1 并写快照（ADR-17）。

## 9.2 软变更

- 产生新的简报版本（`hardDigest` 不变），不调用 `bumpConstraints`，不使任何决定失效，不取代 run。
- 之后调度的回合在 `beginTurn` 读取最新版本，所以软变更从下一个回合起影响代理；已在运行的回合用的是旧值（`agentTurns.inputBriefVersionId` 记录了用的是哪一版）。
- 披露变更额外写 `disclosure_changed` 事件（字段名与受众，不含值）。撤回披露时界面提示"已经被看到的值无法收回"。

## 9.3 `bumpConstraints`

```ts
// convex/lib/constraints.ts —— cv 的唯一写入口（激活除外）
export async function bumpConstraints(ctx: MutationCtx, room: Doc<"rooms">, cause: SnapshotCause,
                                      actorRoleKey?: string): Promise<void> {
  if (room.lifecycle !== "active") return;                       // setup 期不递增
  const fromCv = room.constraintsVersion, toCv = fromCv + 1;
  await ctx.db.insert("constraintSnapshots", { roomId: room._id, constraintsVersion: toCv,
    ...(await latestVersionIds(ctx, room._id)), cause, createdAt: Date.now() });
  await ctx.db.patch("rooms", room._id, { constraintsVersion: toCv });
  for (const r of await openRequestsOfRoom(ctx, room._id, "tradeoff")) await closeRequest(ctx, r, "cancelled");  // I-27
  if (cause.kind === "executed") return;                         // 执行：run 已是终态，不开新 run
  await appendEvent(ctx, room._id, { type: "constraints_changed", fromCv, toCv,
    changedByRoleKey: actorRoleKey!, source: cause.kind === "catalog_published" ? "catalog" : "brief" });
  const run = await currentRun(ctx, room);
  if (run && !isTerminal(run.status)) {
    assertTransition(RUN_TRANSITIONS, run.status, "superseded");
    await ctx.db.patch("runs", run._id, { status: "superseded", outcome: "SUPERSEDED_BY_CONSTRAINTS", endedAt: Date.now() });
    await tryCancelPendingTurns(ctx, run);                         // 尽力而为，正确性靠回合守卫
    await appendEvent(ctx, room._id, { type: "run_ended", runSeq: run.seq, outcome: "SUPERSEDED_BY_CONSTRAINTS" });
    await startNextRunAfterChange(ctx, { ...room, constraintsVersion: toCv });
  }
}
```

`tryCancelPendingTurns`：对该 run 下 `scheduled` 状态回合的 `runFnId`，先查 `_scheduled_functions` 状态，仍为 pending 才 `ctx.scheduler.cancel`（对已完成的调度调用 cancel 会抛错，inputs/04 §1.5）；已开始的 action 无法中止，其结果会在 `completeTurn` 被判为 `rejected_stale`。

**只有被取代的 run 原本处于非终态时才开新 run**。若最近的 run 已执行或已取消（例如执行完成后 finance 又调了预算），约束变化只递增 cv、写事件，不自动触发模型调用；成员可以显式请求重新协商。

## 9.4 新 run 的起始状态

```ts
async function startNextRunAfterChange(ctx: MutationCtx, room: Doc<"rooms">) {
  const input = await loadConstraintInput(ctx, room);            // 新 cv
  const today = todayIn(room.timeZone);
  const current = room.currentProposalId ? await ctx.db.get("proposals", room.currentProposalId) : null;
  const executed = current ? await isExecuted(ctx, current._id) : true;
  if (current && !executed && scenario.evaluate(current, input.full, today).ok)
    return startRun(ctx, room, { trigger: "constraints_changed", carryOver: current._id });   // R2
  if (scenario.globalFeasible(input.full, today).length > 0)
    return startRun(ctx, room, { trigger: "constraints_changed" });                          // R1
  return startRun(ctx, room, { trigger: "constraints_changed", needsHuman: "NO_FEASIBLE_OPTION" }); // R3
}
```

| 情形 | 新 run | 旧决定 | 是否调用模型 |
| --- | --- | --- | --- |
| 当前提案在新约束下仍通过（如预算上调、或下调后仍够） | `awaiting_approval`，同一提案 | 全部 stale，需重新批准；界面："Terms unchanged; constraints changed v1 → v2; please re-approve" | 否 |
| 当前提案被阻断，但存在全局可行组合 | `running` | stale | 是 |
| 不存在全局可行组合 | `needs_human`，向各目标发放宽请求 | stale | 否 |

预算上调时不自动寻找"更好的"方案（RA Q7）：当前提案仍有效就只需重新批准；任何成员可以请求重新协商（受每日上限约束）。

## 9.5 预算下调的完整时序（`budget.update`）

参数 `{ roomId, newCapCents, reason }`；全部步骤在一个 mutation 中，调度在提交后才生效。

| 步 | 动作 | 读 / 写 | 失败（整笔回滚） |
| --- | --- | --- | --- |
| 1 | `requireCapability(roomId, "budget.update")` | users、participants、rooms | `NOT_FOUND`、`FORBIDDEN_ROLE`、`ROOM_CLOSED` |
| 2 | `assertCents(newCapCents)`；`reason` 经 sanitize（≤ 300，只有 finance 可见） | — | `INVALID_INPUT` |
| 3 | 读 finance 最新简报版本；新值与旧值相同 | briefVersions | `NO_CHANGES` |
| 4 | `committed = baseline + Σ commitments`；`newCap < committed` | commitments | `CAP_BELOW_COMMITTED { committedCents }`（finance 自己的数据） |
| 5 | `writeBriefVersion`：复制上一版本，`hard.capCents = newCap`，`origin: "budget_update"`，`changeReason: reason` | 写 briefVersions | — |
| 6 | 事件 `brief_confirmed { roleKey: "finance", hardChanged: true }` | 写 events | — |
| 7 | `bumpConstraints(cause=brief_confirmed, actor=finance)` | 写 constraintSnapshots、rooms、humanRequests、runs、events；可能调度回合 | — |
| 8 | 返回 `{ constraintsVersion, nextRunStatus }` | — | — |

提交瞬间，所有订阅 `rooms.view` 的窗口在同一次推送中看到：cv 变为 v2、当前提案对 finance/customer 显示 "Over budget by $100"、对 provider 显示 "Blocked: buyer-side constraint"、customer 与 provider 已有的批准显示为 stale、run 2 的状态（"Provider agent drafting…"）。阻断不等待任何模型调用（F09.3）。

## 9.6 阻断是读时派生，不回写

- 不修改旧提案、不删除旧决定、不给提案写 `blocked`。`rooms.view` 在每次查询时用当前 cv 的输入求值（06 §6.1）。
- 不复制"revalidated"提案（RA-R11）：条款没变就仍是同一个 proposalId，审批绑定的 cv 变了自然失效。

## 9.7 历史与追溯

- 每个 cv 有一行快照，指向当时生效的各简报版本与目录版本；简报版本、目录版本、承诺都不可变。因此"v2 在 cv 2 下为什么被阻断"可以在任何时候用 `evaluate(v2, loadConstraintInput(cv 2), 当日)` 精确重算（已承诺额只计 cv < 2 的承诺，03 §3.4）。
- 谁在何时为何改了约束：finance 本人在自己的版本历史中看到原因与前后值；他方在时间线上看到"Finance updated a private constraint (v1 → v2)"。
- 从变更单可追溯：变更单 → 提案（作者、所 counter 的提案、产生它的回合）→ 决定 → 执行时 cv 的快照 → 各简报版本与目录版本 → 承诺快照。

## 9.8 必测场景

| 场景 | 期望 | 测试 |
| --- | --- | --- |
| 回合进行中降预算 | 迟到结果 `rejected_stale`；旧批准 stale；新 run 开始 | TC-RUN-02 |
| customer 提前截止日（硬约束） | cv +1；两条已有批准 stale；执行被拒 | TC-VER-03 |
| provider 发布改价目录 | 旧提案 `CATALOG_STALE`；不可执行 | TC-RULE-03 |
| 降到恰好等于（已承诺 + 当前提案价格） | 当前提案仍通过 → carry-over，需重新批准 | TC-VER-09 |
| 降到低于已承诺 | `CAP_BELOW_COMMITTED` | TC-RULE-09 |
| 降到无可行组合（$4,400） | run `needs_human`，三方各自的放宽请求 | TC-RUN-09 |
| 只改备注或披露 | cv 不变；批准仍有效 | TC-VER-10 |
| 执行后 | cv +1；不开新 run | TC-EXE-06 |
