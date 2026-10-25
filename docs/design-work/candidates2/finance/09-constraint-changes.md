# 09 约束变更

## 1. 约束版本的定义

`rooms.constraintsVersion = n` 标识一个完整约束快照：
`{ 上限（最新 budgetRevision）, 已承诺（全部 commitments）, 各角色最新确认简报的硬字段, 当前报价修订集合 }`。
任何让这四者之一变化的写入都必须在同一 mutation 内调用：

```ts
// convex/engine/constraints.ts —— 唯一能改 rooms.constraintsVersion 的代码
export async function bumpConstraints(ctx: MutationCtx, room: Doc<"rooms">,
  c: { cause: ConstraintCause; refId: string; actorKind: ActorKind; actorRole?: Role }): Promise<number> {
  const to = room.constraintsVersion + 1;
  await ctx.db.patch("rooms", room._id, { constraintsVersion: to });
  await ctx.db.insert("constraintChanges", { roomId: room._id, fromVersion: room.constraintsVersion, toVersion: to, ...c, createdAt: Date.now() });
  await writeEvent(ctx, "constraints_changed", { audience: { kind: "room" } }, { fromVersion: room.constraintsVersion, toVersion: to, cause: c.cause });
  return to;
}
```

lint 规则：除 `constraints.ts` 外，任何 `patch("rooms", …, { constraintsVersion })` 都报错。

## 2. 哪些操作递增

| 操作 | 函数 | cause | 递增条件 |
| --- | --- | --- | --- |
| 设定 / 改变上限 | `budget.setLimit`、`requests.answer`(raise_limit) | budget_limit | 新值 ≠ 旧值（相等抛 NO_CHANGE） |
| 录入期初承诺 | `budget.recordOpeningBalance` | opening_balance | 总是 |
| 确认简报 | `briefs.confirm`、`requests.answer`(defer_item / extend_deadline) | brief_confirmed | `hardKey` 与上一确认版本不同；首个版本总是 |
| 报价新增 / 改价 / 改工期 / 改有效期 / 退役 | `catalog.saveItem`、`catalog.retireItem` | catalog_changed | 总是（任何修订） |
| 报价到期 | `catalog.expireItem`（scheduled） | quote_expired | 该修订仍是当前修订 |
| 执行 | `executeProposal` | commitment_recorded | 总是 |

**不递增**：软字段（wantedItemKeys 顺序、preferredDate、privateNotes）、shareableFields 变化、草稿保存、签字、拒绝、回合结果、任务状态、邀请与成员。软字段变化只影响下一次协商的偏好，不使签字失效（ADR-13）。

## 3. 约束变化后的统一流程 `afterConstraintChange(ctx, room, actor)`

在调用 bumpConstraints 的同一 mutation 中执行（room 在 active 状态时；setup 状态只 bump）：

| 步 | 动作 |
| --- | --- |
| C1 | 取消全部 open humanRequests（cancelReason "constraints_changed"） |
| C2 | 若有活动 run：→ superseded（assertTransition）；对其 openTurnSeqs 的 scheduled 函数尽力 `scheduler.cancel`（先查 `_scheduled_functions` 状态，包 try/catch）；真正保证来自回合守卫 G-T |
| C3 | 载入新快照，若有 active 当前提案：`validateProposal` |
| C4a | 当前提案仍通过 → `startRunInternal(trigger "constraint_change", initialStatus "pending_approval")`；不调模型；事件 "Re-approval required for v3 under constraints v8" |
| C4b | 不通过且 `enumerateCandidates`（完整约束）非空 → 新 run negotiating，调度 provider propose 回合 |
| C4c | 枚举为空 → 新 run needs_input，`openHumanRequests(no_feasible_option)` |
| C5 | 写 run_started 事件 |

- "阻断"是读取时派生：预算一提交，所有订阅 `rooms.view` 的窗口在同一次推送里看到 v3 变为 blocked、签字变为 stale，不等待新 run 和模型。
- 上调预算（C4a 常见）不会自动寻找更大的方案；任一成员可点 "Renegotiate"（`runs.requestRenegotiation`）开启 trigger `renegotiation_requested` 的新 run（Q7 的回答）。

## 4. `budget.setLimit({ roomId, newLimitCents, reasonCode, note, expectedRevision })`

| 步 | 动作 | 失败码 |
| --- | --- | --- |
| 1 | `requireRole(finance)`；`assertCents(newLimitCents)`；note 1–500 字符；reasonCode ∈ {increase, decrease}（首次为 initial，由服务端判定） | ROLE_FORBIDDEN / AMOUNT_OUT_OF_RANGE / NOTE_REQUIRED |
| 2 | 读 budgets；`expectedRevision === budgets.nextRevision - 1`（乐观并发：finance 看到的就是当前上限） | REVISION_CONFLICT |
| 3 | `ledgerBalance`；`newLimitCents === limit` → NO_CHANGE；`newLimitCents < committedCents` → BUDGET_BELOW_COMMITTED | 同左 |
| 4 | reasonCode 与方向一致（increase ⇔ new > old） | REASON_MISMATCH |
| 5 | patch budgets.nextRevision；插入 budgetRevisions（constraintsVersion = 步 6 的新值） | — |
| 6 | `bumpConstraints(cause budget_limit, refId revisionId, actorRole finance)` | — |
| 7 | `afterConstraintChange` | — |
| 8 | 事件 budget_limit_changed（买方） | — |

**为什么拒绝"降到已承诺以下"而不是进入 needs_input**：已承诺是已执行的内部记录，v1 没有冲销机制；允许 limit < committed 会产生一个任何提案都无法满足、也没有任何人能通过系统内动作解决的状态，并破坏 L3。finance 在台账里能看到最低允许值 `minAllowedLimitCents`，若现实中预算真的被削减到已承诺以下，那是需要线下处理的冲销事件（17 扩展点）。

## 5. `budget.recordOpeningBalance({ roomId, amountCents, note })`

守卫：finance；房间 setup；已有上限修订；by_operationKey(`open:{budgetId}`) 无记录；`amountCents ≤ limit`（L3）；允许 0？——**不允许 0 分录**（L1 承诺 > 0）。期初为零时调用 `budget.declareNoOpeningBalance`（只写 constraintChanges 与事件，不写承诺；房间 setup→active 守卫接受二者之一）。写入后 bumpConstraints(opening_balance)。

## 6. 回合进行中约束变化

1. finance 提交 setLimit：C2 把 run → superseded。
2. 在途 action 稍后调用 `completeTurn`：G-T 失败（currentRunId 已变 / cv 不等）→ 回合 → stale，记录 usage，事件 turn_rejected_stale，结果丢弃。
3. 新 run 按 C4 继续。用量照常入账（成本真实发生）。

## 7. 历史保留

- budgetRevisions、briefVersions、catalogItems 修订、constraintChanges、旧 runs、旧提案与签字全部保留；"constraints v5 时的上限是多少"可由 `budgetRevisions where constraintsVersion ≤ 5` 的最新行回答。
- 约束变化的原因：上限变化必须带 note；简报与报价变化在 constraintChanges 记录 refId，可展开到具体修订。
