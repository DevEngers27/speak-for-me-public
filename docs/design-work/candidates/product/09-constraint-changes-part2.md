# 09 约束变化（part2）：跟进逻辑、取舍请求、触发汇总、软约束、历史与边界

## 9.5 `negotiation.afterConstraintChange`（internal mutation，被调度）

```ts
export const afterConstraintChange = internalMutation({
  args: { roomId: v.id("rooms"), constraintsVersion: v.number() },
  handler: async (ctx, { roomId, constraintsVersion }) => {
    const room = await ctx.db.get("rooms", roomId);
    if (!room || room.status !== "open") return;
    if (room.constraintsVersion !== constraintsVersion) return;   // 有更新的变化，交给它的跟进
    if (!room.negotiationOpen || room.activeRunId) return;
    const plugin = pluginFor(room);
    const view = await buildRuleView(ctx, room, computeToday(room.timeZone, Date.now()));
    if (!plugin.readiness(view).ready) return;
    if (room.currentProposalId) {
      const p = await ctx.db.get("proposals", room.currentProposalId);
      if (p && evaluateProposal(plugin, p.terms, view).executable) return; // 只需重新签核（9.10 Q7）
    }
    const excluded = await rejectedCandidateKeys(ctx, roomId, constraintsVersion);
    const report = analyzeFeasibility(plugin, view, excluded);
    if (report.executableKeys.length === 0) return openTradeoffRequests(ctx, room, view, report);
    await startRun(ctx, room, { trigger: room.runSeq === 0 ? "ready" : "constraints_changed",
      actor: { kind: "system" }, excluded, internal: true });   // 代理不可用、额度用尽时静默返回
  },
});
```

`invites._accept` 也会调度一次（用当前版本），以防"最后一个就绪条件是有人入座"的情况；函数是幂等的。

## 9.6 `openTradeoffRequests`：无可行方案时向具体的人请求取舍

1. `groupKey = "tradeoff:cv" + room.constraintsVersion`；已有同组 open 请求则返回（幂等）。
2. `drafts = plugin.tradeoffs(view, report)`：插件按阻断维度计算"最小放宽"选项（scope_change 规则见 14 第 14.6 节）。每个草稿给一个角色；没有可行动选项的角色不发请求。
3. 每个草稿插入一条 `humanRequests`（kind `tradeoff`，`blockingReasonCodes` 为全部候选的失败原因并集，`options` 含意图与 `enablesCandidateKeys`，末项为 `decline`）。
4. 写 `request_opened` 事件（房间版只含目标角色与类型）；他人工作台显示 "Waiting on Finance and Provider"。
5. 若 `drafts` 为空（任何单方放宽都无法得到可行方案）：不发请求，阶段 `blocked/awaiting_trigger`，工作台解释 "No single change makes an option feasible. Review the scope, quote, and budget together." 并列出全部失败原因（按查看者投影）。

请求被回答 → 引起约束变化 → 整组关闭 → `afterConstraintChange` 重新预检。请求全部被拒 → `blocked/requests_declined`（X6）。

## 9.7 重新协商的触发汇总

| 触发 | 条件 | 开 run？ | trigger | 不开时 |
| --- | --- | --- | --- | --- |
| 首次就绪 | 最后一个就绪条件满足 | 预检有解则开 | `ready` | 取舍请求 |
| 约束变化 | 当前提案不存在或不可执行 | 预检有解则开 | `constraints_changed` | 取舍请求 |
| 约束变化 | 当前提案仍可执行 | 否 | — | 只需重新签核；可手动请求 |
| 人拒绝 | 见 04 第 4.6 节 | 预检（排除被拒）有解则开 | `rejection` | 取舍请求或偏好请求 |
| 请求回答：`share_fields` | — | 是 | `request_answered` | — |
| 请求回答：`patch_brief` / `edit_list` | 通过约束变化路径 | 按上面"约束变化"行 | `constraints_changed` | — |
| 手动 `negotiation.requestRun` | 无 active run；置 `negotiationOpen = true` | 预检有解则开 | `manual` | 取舍请求（不调模型） |
| 执行 | — | 否（`negotiationOpen = false`） | — | — |

## 9.8 软约束（偏好）

- 偏好字段（customer `preferredDate`）、私密备注、共享说明的变化**不**递增约束版本，**不**使签核失效，**不**自动开 run；它们只影响下一次 run 中代理的判断（F09.1 【改写】、ADR-20）。
- 理由：签核绑定的是"可执行性所依赖的事实"；偏好不参与可执行性判断，让它们使签核失效会制造无意义的重签。
- 若用户希望按新偏好重谈：工作台提供 "Ask agents to renegotiate"（`requestRun`）。

## 9.9 历史保留与重放

| 保留什么 | 在哪里 | 谁能看 |
| --- | --- | --- |
| 每个约束版本的原因、操作者、生效来源 | `constraintRevisions`（含 `inForce`） | 原因与角色全体可见；字段名按披露；值不在此表 |
| 规则字段的每个历史值 | `briefVersions` | 本人全量；他方只见披露字段 |
| 清单每个版本 | `listItems`（superseded / withdrawn 保留） | 全体（confirmed 过的） |
| 台账每笔 | `commitments`（voided 保留并带原因） | 按 `committedCents` 披露 |
| 旧签核 | `decisions` | 类型与时间全体可见 |
| 旧提案 | `proposals`（superseded） | 全体 |

`ops.maintenance.replayRuleView({roomId, version})`（internal query）由 `inForce` 重建任一版本的规则视图，并重新评估当时的提案，用于审计与回归测试（核心 6："从事件追溯每个结果是怎么来的"）。

## 9.10 边界情形

| 情形 | 行为 | 依据 |
| --- | --- | --- |
| 上调预算（Q7） | 约束递增，旧签核 stale；当前提案仍可执行 → 不自动重谈，工作台提示 "Constraints changed — re-approval needed" 与 "Ask agents to look for a better option" | 避免在人审批途中自动换方案；由人决定是否追求更优 |
| 上限低于已承诺 | 拒绝写入 `CAP_BELOW_COMMITTED`（只对 finance 显示具体金额） | 已承诺无法在系统内撤销（核心 7）；保持 I-9（ADR-16） |
| 恰好等于余量（$4,750） | 通过（`≤`） | 边界测试（14） |
| run 进行中改约束 | run → superseded；迟到结果 stale；跟进函数视情况开新 run | G-PERSIST |
| 审批事务与约束变更并发 | OCC 串行；签核侧 `CONSTRAINTS_CHANGED` 或签核先落、随后 stale | X3 |
| 报价今天过期 | 不递增约束版本；查询以 `dayStamp` 为今天、执行以实时日期为准，提案被 `SOURCE_EXPIRED` 阻断；每小时任务刷新 `dayStamp` 后订阅自动反映 | 10 第 10.9 节 |
| 首次执行后作废基线 | `BASELINE_LOCKED` | 台账历史 |
| 连续快速多次变化 | 每次都递增并写修订；只有最后一个版本的跟进生效 | 9.3 |
| 插件升级 | `ops.maintenance.upgradeScenario` 对所有 open 房间递增约束版本（`scenario_upgraded`），旧签核 stale | 03 第 3.24 节 |
