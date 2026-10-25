# 09 约束变更

## 1. 规则
- 约束集合 = 已确认简报的 hardKey + 当前已确认目录修订 + 账户 cap + 台账条目。它的任何变化都必须经 `bumpConstraints(ctx, roomId, cause)`，其他写入不得改 `rooms.constraintsVersion`（lint 规则 + 测试）。
- 软约束（插件 `hardKey` 之外的字段，如 `preferredDate`、`notes`）的变化写新 briefVersion，但**不递增**，不使审批失效；它只在下一个回合进入代理上下文。

## 2. 递增点（完整清单）

| 函数 | 条件 | cause.kind |
| --- | --- | --- |
| `briefs.confirm` | 新 hardKey ≠ 上一已确认版本的 hardKey（首次确认且 hardKey 非空也算） | `brief_hard` |
| `catalog.confirm` / `catalog.retire` | 任何确认或撤回（价格、日期都在 payload 里） | `catalog` |
| `ledger.updateCap` | newCap ≠ oldCap | `ledger_cap` |
| `ledger.addExternalEntry` | 总是 | `ledger_external` |
| `executeIfComplete` | 总是（台账新增 execution 条目） | `ledger_execution` |
| `requests.answer` | effect 为 brief/ledger_cap 时，经上面相同的内部函数 | 同上 |

## 3. `bumpConstraints` 的步骤（同一 mutation 内）

```ts
async function bumpConstraints(ctx, roomId, cause) {
  const room = await ctx.db.get('rooms', roomId);
  await ctx.db.patch('rooms', roomId, { constraintsVersion: room.constraintsVersion + 1 });
  await writeEvent(ctx, room, { type: 'constraints_changed', audience: { kind: 'room' },
    templateKey: 'event.constraints_changed', params: { roleLabel: cause.actorRoleLabel } }); // 不带数字
  if (cause.kind === 'ledger_execution') return;                 // run 已 confirmed
  const run = room.currentRunId && await ctx.db.get('runs', room.currentRunId);
  if (!run || isTerminal(run.status)) return;
  const snap = await buildSnapshot(ctx, roomId);                 // 读到本事务刚写入的新值
  const keep = run.status === 'pending_approval' && await proposalStillHolds(room.currentProposalId, snap);
  if (keep) return;                                              // R9：旧审批靠版本比较自然 stale
  await supersedeRun(ctx, run, 'constraints_changed');           // R10：取消 open 请求、尽力 cancel 回合、提案 superseded
  await startRunInternal(ctx, roomId, { trigger: 'constraints_changed', startedBy: 'system' }); // R1 或 R1'
}
```
`proposalStillHolds` = `evaluate(...).executable`（含 `engine.content_drift`）。

## 4. 预算下调流程 `ledger.updateCap({roomId, accountKey, newCapCents, reason})`

| 步 | 动作 | 失败 |
| --- | --- | --- |
| 1 | `requireLedgerOwner`；`assertCents(newCapCents)`；`reason` 1–200 字符 | `FORBIDDEN` / `INVALID_AMOUNT` |
| 2 | 读账户与 committed；`newCap < committed` → 拒绝 | `LEDGER_CAP_BELOW_COMMITTED`（ADR-09） |
| 3 | `newCap === oldCap` → 拒绝 | `NO_CHANGE` |
| 4 | patch `capCents`；插 `ledgerCapChanges`（old/new/actor/reason/via）；写 roles:[owner] 事件（带数字）| — |
| 5 | `bumpConstraints`（room 级事件不带数字） | — |
| 6 | 若当前 run 在 negotiating：在途 action 无法中止；它的 complete 会因 `constraintsVersion` 不等于 `constraintsVersionAtStart` 被拒为 stale（只记用量） | — |
| 7 | mutation 提交：所有订阅 `rooms.view` 的窗口在同一刻看到旧提案 Blocked，新 run 的 "drafting" 随后出现 | — |

上调预算（Q7）：同样递增；当前提案若仍成立则保留（R9），不自动寻找更优方案；任何参与方可点 "Renegotiate"（`runs.requestRenegotiation`）。

## 5. 简报硬约束变化（例：customer 提前截止日；event_budget 人数改变）
`briefs.confirm` → hardKey 变 → bump → 当前提案可能触发 `sc.deadline_missed` 或 `engine.content_drift` → R10。这正是 Role A 缺陷 RA-B02 的修正：改硬约束也必须让旧审批失效。

## 6. 派生可执行性
`rooms.view` 每次读取实时算 `evaluate(currentProposal, snapshot)`，不回写 blocked。阻断是瞬时的（随约束提交），重谈是异步的（随新 run）。

## 7. 历史保留
旧提案（superseded）、旧决定（stale）、`ledgerCapChanges`、旧 briefVersions、旧 catalog 修订、旧 run 与其回合全部保留。时间线可回答"v1 为什么被阻断"：`constraints_changed` 事件（commitSeq 全序）→ 对应 cap 变化 → v1 的派生检查结果在当时与现在的差异（`validationSnapshot` 记录插入时结果）。

## 8. 必测场景
回合进行中降预算（迟到回复 stale）；改截止日使旧审批失效；改价（新目录修订）使旧提案 content_drift；降到恰好等于余量（通过）；降到无可行解（needs_input，不调模型）；cap 低于 committed（拒绝）；软约束变化不使审批失效。
