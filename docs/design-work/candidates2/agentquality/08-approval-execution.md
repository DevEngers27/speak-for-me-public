# 08 审批与执行

## 8.1 审批绑定
- 一条 decision 绑定 `(proposalId, constraintsVersion, contentHash)`；`roleKey` 从 members 读，`kind` 由角色推出（customer / provider → terms，finance → budget），客户端不能传。
- 只追加；有效决定 = 对 (proposalId, 当前 constraintsVersion, userId) 取最新一条。撤回 = 追加 `withdraw`。
- `approve` 前置：G-A 守卫 + `validateProposal = OK`（不让人批准不可执行的版本）；`reject` 只需 G-A 前三项（永远可以说不），必须带场景拒绝码（`SPEND_TOO_HIGH`、`SCOPE_INSUFFICIENT`、`DATE_UNACCEPTABLE`、`TERMS_UNACCEPTABLE`、`OTHER`）。
- 代理的 `recommend_accept` 不写 decisions（I15 / 核心 2）；UI 中代理建议与人的决定分栏显示。

## 8.2 必需审批人与完成判定
- `requiredApprovals` 来自场景常量 `[{customer, terms}, {provider, terms}, {finance, budget}]`，插入提案时快照进 proposal；执行时以快照为准。
- 完成判定按集合（禁止 `count >= N`）：

```ts
function isComplete(p: Doc<"proposals">, cv: number, decisions: Doc<"decisions">[], members: Doc<"members">[]) {
  const latest = latestByUser(decisions.filter((d) => d.constraintsVersion === cv && d.contentHash === p.contentHash));
  const used = new Set<string>();
  for (const req of p.requiredApprovals) {
    const m = members.find((x) => x.roleKey === req.roleKey);          // I13：每角色一人
    const d = m && latest.get(m.userId);
    if (!d || d.decision !== "approve" || d.kind !== req.kind || used.has(m.userId)) return false;
    used.add(m.userId);
  }
  return true;
}
```

## 8.3 `decisions.submit` 时序（一个 mutation）

| 步 | 动作 | 读 / 写 | 失败时 |
| --- | --- | --- | --- |
| 1 | `requireMember` → roleKey、kind | members | 抛 NOT_A_MEMBER |
| 2 | 读 room、run、proposal；G-A 守卫 | rooms、runs、proposals | 返回 `{ok:false, code:"STALE_PROPOSAL"}`，无写入 |
| 3 | approve：构造 SystemView，`validateProposal` | catalog、briefs、budgets、commitments | 返回 `NOT_EXECUTABLE` + 按角色投影的码 |
| 4 | 幂等：若本人最新决定与本次相同，直接返回现状（连点不追加） | decisions | — |
| 5 | 插入 decision；写事件 `decision.submitted` | decisions、events | — |
| 6 | reject：proposal → rejected_by_human；R11 / R12 | proposals、runs | — |
| 7 | approve：`isComplete`？否 → 返回 `{ok:true, executed:false}` | — | — |
| 8 | 是 → `executeIfComplete`（8.4，同事务） | 见下 | 返回 `{executed:false, code}`，decision 已记录 |

## 8.4 原子幂等执行（`executeIfComplete`，在 8.3 同一事务内）

1. 状态守卫（主防线）：再次确认 G-A；两个并发的"最后一票"读写同一 run 文档，OCC 让后提交者重试，重试时看到 `run.status = executed`，走第 2 步返回已有结果。
2. `operationId = "exec:" + proposalId + ":" + constraintsVersion`；`changeOrders.by_operationId` 命中 → 返回已有 changeOrderId（第二道保险兼审计键）。
3. 重算：`checkBudget(proposal.terms.priceCents, freshSystemView)`；失败 → 不执行，写事件 `execution.blocked`（买方版含数字），返回。
4. 插入 changeOrder（terms、contentHash、decisionIds、executedBy = 当前调用者、isSimulated = room.isSimulated）。
5. 插入 commitment（kind change_order，amountCents = priceCents，changeOrderId）。
6. `deriveTasks` → 插入 tasks（assignee = provider 成员，dueDate = deliveryDate）。
7. proposal → executed；run → executed（`assertTransition`），`endedAt`；room 指针保持指向该提案，`currentRunId` 清空。
8. 写事件 `execution.completed`（payload：changeOrderId、版本号、itemKeys；金额只在买方模板渲染总额）。

不使用 action 或 scheduler：执行只写内部表，没有外部 I/O，一个 mutation 即可原子完成。

## 8.5 撤回与过期
- 执行前可撤回（`withdraw`）；执行后不可撤回，修订走新 run（17：修订链）。
- v1 无审批过期时间；约束版本变化即失效。报价有效期见 18 开放问题 Q4。

## 8.6 派生关系

```text
changeOrder ── proposalId → proposal ── authoredByTurnId → turn → run
     │                         └─ terms.sourceRefs → catalogItems(revision)
     ├── decisionIds → decisions（谁、何时、哪个约束版本）
     ├── commitment（changeOrderId）
     └── tasks（changeOrderId，每个 scope 条目一个）
```

## 8.7 执行边界
只写 changeOrders / commitments / tasks。可读产物是页面与打印视图；不做 CSV 导出（若将来做，单元格以 `= + - @ \t \r` 开头时加 `'` 前缀）。外部 ERP / 支付 / 签署都不在 v1，扩展点见 17（outbox 表 + 人工确认后再推送）。
