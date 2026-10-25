# 08 审批与执行（part2：派生记录、台账视图、对账）

## 8. 一次执行写入什么

| 记录 | 条数 | 关键字段来源 | 互相引用 |
| --- | --- | --- | --- |
| changeOrders | 1 | 提案快照（lines、fees、amount、date、deferred、contentKey）+ 签字 id + 预算快照 | proposalId、runId |
| commitments | 1（kind change_order） | amount = proposal.amountCents；seq = budgets.nextCommitmentSeq | changeOrderId、proposalId、同 operationKey |
| tasks | 每个 scope line 1 条 | `deriveTasks`，assignee provider | changeOrderId、operationKey 派生 |
| constraintChanges | 1 | cause commitment_recorded，refId = changeOrderId | — |
| events | 2 | change_order_executed（room）、commitment_recorded（买方） | proposalId、runId |

- 不调用模型；文本全部模板化。界面固定文案："Internal record only — no payment, contract, or external system was changed."
- `deferredItemKeys` 进入被签字内容；v1 不自动生成后续变更占位（OQ-5）。

## 9. 财务视图 `budget.ledger({ roomId })`（customer、finance）

返回（买方投影，provider 调用抛 ROLE_FORBIDDEN）：

```ts
{
  currency: "USD",
  balance: { limitCents, limitRevision, committedCents, headroomCents },   // 实时派生
  limitHistory: [{ revision, limitCents, previousLimitCents, reasonCode, note, actorName,
                   constraintsVersion, createdAt, simulated }],
  commitments: [{ seq, kind, amountCents, runningCommittedCents, createdAt, simulated,
                  changeOrder?: { id, number, proposalVersion, constraintsVersion,
                                  signers: [{ role, displayName, signedAt }] } }],
  exposure?: { proposalVersion, amountCents, committedAfterCents, headroomAfterCents,
               shortfallCents, executable },                              // 当前提案的影响预览
  minAllowedLimitCents: committedCents,                                  // setLimit 的下限提示
}
```

- `runningCommittedCents` 按 seq 累加（服务端计算），用于逐行核对。
- 每条 change_order 承诺可点开：变更单 → 提案 v{n}（价格快照与 contentKey）→ 签字分录（含 seq、时间、cv）。这就是"每笔承诺可追溯到审批到齐的具体提案版本"的界面落点。

## 10. 对账 `budget.reconcile({ roomId })`（finance；同时有 internalQuery 版本供测试与运维）

纯读，返回 `{ ok: boolean, checkedAtConstraintsVersion, findings: Finding[] }`。检查：

| 码 | 检查 | 对应不变量 |
| --- | --- | --- |
| R1 `SEQ_GAP` | commitments.seq 与 budgetRevisions.revision 从 1 连续 | L6 |
| R2 `COUNTER_DRIFT` | `budgets.nextCommitmentSeq === max(seq)+1`，`nextRevision === max(revision)+1` | L6 |
| R3 `AMOUNT_RANGE` | 每个金额是 `(0, MAX_CENTS]` 的安全整数（limit 可为 0） | L1 |
| R4 `HEADROOM_NEGATIVE` | 按 seq 重放：每条承诺写入时 `running ≤ 当时生效的 limit`（取 constraintsVersion 不大于该承诺的最新上限修订） | L3 |
| R5 `ORPHAN_COMMITMENT` | 每条 change_order 承诺有变更单且金额相等，operationKey 相同 | L4 |
| R6 `ORPHAN_CHANGE_ORDER` | 每张变更单恰有一条承诺（by_changeOrder） | L4、L7 |
| R7 `SIGNATURE_SET` | 变更单的 authorizingDecisionIds：均为 approve、cv = 变更单 cv、contentKey = 提案 contentKey、覆盖 requiredSignatures、userId 互不相同、各自 role 与 members 一致 | L4、I6、I7 |
| R8 `CONTENT_KEY` | `contentKey(proposal)` 重算 = proposal.contentKey = changeOrder.contentKey | 核心 3 |
| R9 `PRICE_SOURCE` | 变更单 lines 的 catalogItemId/revision/price 与 catalogItems 行一致，且该修订在执行时（变更单 cv 下）是当前修订 | 核心 4 |
| R10 `OPENING_BALANCE` | 至多一条 opening_balance，seq = 1 或在任何 change_order 之前 | L5 |
| R11 `PROPOSAL_STATUS` | status executed 的提案恰有一张变更单；反之亦然 | L7 |

- 任何发现都是代码缺陷的证据（正常路径不可能产生）；界面显示红色 "Reconciliation failed: R5"，同时写运维日志计数（不含金额）。
- 测试在每个 convex-test 场景结束时调用 internal 版本断言 `ok === true`（16）。

## 11. 变更单视图 `changeOrders.get({ changeOrderId })`

- 所有成员：number、条款、交付日、签字人与时间、任务、"Internal record only"。
- 买方额外：budgetSnapshot（执行前/后已承诺、上限、执行后余量）——读快照，不读实时值，所以之后的新承诺不会改写旧变更单显示（RA-B09 回归）。
- 打印视图 `/rooms/[roomId]/change-orders/[n]/print`；v1 不做 CSV。

## 12. 失败后的状态（时序摘要）

| 场景 | 读写 | 失败点 | 失败后状态 |
| --- | --- | --- | --- |
| 最后一票时预算已被并发降低 | 读 budgets → OCC 重试 → 重读 | 步 2（cv 已变，run 已 superseded） | 签字未写；界面显示 "Constraints changed — re-review v3" |
| 最后一票时报价恰好到期 | expireItem 已提交 | 步 2/5 | 同上 |
| 最后一票时 contentKey 不符 | — | 步 4 | 无写入；客户端刷新卡片 |
| executeProposal 内部断言失败 | — | E1/E4 | 整个事务回滚；运维告警；状态不变，可重试 |
