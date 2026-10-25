# 09 约束变化（part1）：什么是约束、递增点、`bumpConstraints`、预算下调完整时序

> 本章分 2 片：part1（本文件）9.1–9.4；part2 9.5 `afterConstraintChange`、9.6 取舍请求生成、9.7 重新协商触发汇总、9.8 软约束、9.9 历史保留与重放、9.10 边界情形。

## 9.1 什么算"约束"

约束 = 规则引擎判断可执行性时读取的全部输入：

1. 各席位最新确认简报中的**规则字段**（`FieldSpec.kind === "rule"`）：customer 必需项与硬截止日、provider 最低金额、finance 预算上限；
2. 全部**已确认清单项**的当前版本（范围、报价、加急费）；
3. **台账**（基线与执行承诺）；
4. **插件规则版本**（`scenarioVersion`）。

不是约束：偏好字段（`preferredDate`）、私密备注、共享说明、披露设置、房间标题与共享目标（Q12）、成员加入、时间流逝（报价过期由检查实时判定）。

## 9.2 递增点清单（回答 F09.1、RA-B02）

| 操作（12） | 递增？ | cause | 说明 |
| --- | --- | --- | --- |
| `briefs.confirm`：规则字段 `ruleDigest` 变化 | 是 | `brief_confirmed` | 含首次确认 |
| `briefs.confirm`：只改偏好、备注、共享说明、披露 | 否 | — | 仍生成新简报版本 |
| `briefs.quickUpdate`（例如改预算上限） | 是 | `brief_confirmed` | 只允许改规则字段 |
| `requests.answer` → `patch_brief` | 规则变化则是 | `brief_confirmed` | `refs.requestId` |
| `requests.answer` → `share_fields` | 否 | — | 只改披露 |
| `requests.answer` → `choose_candidate` | 否 | — | 产生提案，不改约束 |
| `lists.confirm`（一批） | 是，一批一次 | `list_changed` | 新项或新版本 |
| `lists.withdraw` | 是 | `list_changed` | |
| `lists.saveDraft` / `discardDraft` | 否 | — | 草稿不是约束 |
| `ledger.addBaseline` / `voidBaseline` | 是 | `ledger_changed` | |
| 执行（`executeIfComplete`） | 是 | `execution` | 台账变化 |
| `ops.maintenance.upgradeScenario` | 是 | `scenario_upgraded` | 规则本身变化也让旧签核失效 |
| `rooms.updateInfo`、`invites.*`、`decisions.record`、run/回合 | 否 | — | |

规则：**所有改变约束的写入都必须调用 `bumpConstraints`，其他任何代码不得修改 `rooms.constraintsVersion`**（I-7、I-8）。lint 规则只允许 `convex/engine/constraints.ts` 写该字段。

## 9.3 `bumpConstraints`（唯一入口）

```ts
// convex/engine/constraints.ts
export async function bumpConstraints(ctx: MutationCtx, roomId: Id<"rooms">, c: {
  cause: "brief_confirmed" | "list_changed" | "ledger_changed" | "execution" | "scenario_upgraded";
  actor: Actor; causeSeatId?: Id<"seats">; publicReasonCode?: string;
  changedRuleFieldKeys?: string[]; refs: RevisionRefs;
  satisfies?: { intent: "patch_brief" } | { intent: "edit_list"; listKey: string };
}): Promise<Doc<"rooms">> {
  const room = await ctx.db.get("rooms", roomId);                  // 读本事务内最新值
  const to = room!.constraintsVersion + 1;
  const inForce = await collectInForce(ctx, roomId);              // 每席位最新简报版本 id、confirmed 清单项 id、ledgerSeq
  await ctx.db.insert("constraintRevisions", { roomId, version: to, cause: c.cause, actor: c.actor,
    causeSeatId: c.causeSeatId, publicReasonCode: c.publicReasonCode,
    changedRuleFieldKeys: c.changedRuleFieldKeys ?? [], inForce, refs: c.refs, createdAt: Date.now() });
  await ctx.db.patch("rooms", roomId, { constraintsVersion: to });
  if (room!.activeRunId) await finishRun(ctx, room!.activeRunId, "superseded", "CONSTRAINTS_CHANGED");
  await closeOpenRequests(ctx, roomId, { causeSeatId: c.causeSeatId, satisfies: c.satisfies, toVersion: to });
  await appendEvent(ctx, roomId, { type: "constraints_changed", fromVersion: to - 1, toVersion: to,
    cause: c.cause, causeRoleKey: await roleOf(ctx, c.causeSeatId), publicReasonCode: c.publicReasonCode }, c.actor);
  await ctx.scheduler.runAfter(0, internal.negotiation.afterConstraintChange, { roomId, constraintsVersion: to });
  return (await ctx.db.get("rooms", roomId))!;
}
```

- 调用方必须**先**写入引起变化的记录（新简报版本、确认的清单项、台账条目），再调用 bump，使 `inForce` 包含它（同一 mutation 读得到自己的写入）。
- `closeOpenRequests`：目标席位 = `causeSeatId` 且请求含匹配意图（`patch_brief` 对简报确认、`edit_list` 对同清单确认）→ `answered`（`result.constraintsVersion = to`）；其余 → `superseded`（I-34）。
- 调度 `afterConstraintChange` 而不是在同一事务内开 run：保持变更 mutation 小；连续多次变化时只有最后一次的跟进生效（跟进函数先比较版本，旧的直接返回）。被调度的 mutation 恰好执行一次（04 平台约束 1.5）。

## 9.4 预算下调完整时序（$5,000 → $4,800，标准 fixture 主线）

前置：约束 v6；提案 v1（LOGIN + REPORTS · expedited，+$900）为当前且可执行；Maya 已在 v6 上接受；run 1 已 `finished/proposal_ready`；台账 $4,000。

| 步 | 谁 / 函数 | 读 | 写 | 可能失败 |
| --- | --- | --- | --- | --- |
| 1 | Priya 打开 "Update budget cap"，输入 $4,800；界面调用 `briefs.previewConfirm({patch})` | 规则视图、当前提案、签核 | — | — |
| 2 | 预览返回（只给 Priya）："Proposal v1 will be blocked (over by $100). 1 approval will no longer apply. Feasible options exist." | — | — | — |
| 3 | 提交 `briefs.quickUpdate({fieldPatch:{budgetCapCents:480000}, publicReasonCode:"budget_revision", changeReason:"Q4 revision", expectedConstraintsVersion:6})` | rooms、seats | — | `CONSTRAINTS_CHANGED`（期间有其他变化） |
| 4 | 校验：finance 能力；补丁仅含规则字段；`assertCents`；插件 `validate`；场景守卫 已承诺 $4,000 ≤ $4,800 | commitments | — | `CAP_BELOW_COMMITTED` |
| 5 | `appendBriefVersion`：finance v2（origin `quick_update`），草稿同步 | briefVersions | briefVersions、briefDrafts | — |
| 6 | `bumpConstraints(cause:"brief_confirmed", changedRuleFieldKeys:["budgetCapCents"])` → v7；无 active run；无 open 请求 | — | constraintRevisions、rooms、events | — |
| 7 | 事件 `brief_confirmed`（finance v2，ruleChanged，`budget_revision`）；事务提交 | — | events | — |
| 8 | 三个窗口的 `rooms.workspace` 订阅重算：v1 在 v7 下预算检查失败 → `blocked`；Maya 的签核 → `stale_approve`。买方看到 "over by $100"，provider 看到 "Blocked: exceeds the finance limit" | — | — | — |
| 9 | 调度的 `negotiation.afterConstraintChange({constraintsVersion:7})` 执行：版本仍为 7；`negotiationOpen`；就绪；当前提案不可执行；无 active run；预检可执行候选 `LOGIN+REPORTS@standard`、`LOGIN@expedited`、`LOGIN@standard` | 规则视图 | — | 代理不可用 → 不开 run，阶段 `blocked/agents_unavailable` |
| 10 | `startRun(trigger:"constraints_changed")` → run 2（约束 v7）；`scheduleTurn(propose, provider)` | — | runs、turns、rooms、events | 调用额度用尽 → `blocked/call_budget_exhausted` |
| 11 | provider 回合（05 第 5.11 节）→ 提案 v2（LOGIN + REPORTS · standard，+$750），v1 → superseded | — | proposals、turns、rooms、events | 迟到/失败见 10 |
| 12 | customer、finance 审阅并行 → 两者 `recommend_accept` → run 2 `proposal_ready`（consensus） | — | turns、runs、events | — |
| 13 | 三人在 v2 / v7 上签核；最后一人的事务执行 CO-1（08 第 8.7 节），约束 → v8 | — | 见 08 | — |

从第 7 步提交到第 8 步所有窗口翻转为"Blocked"不依赖模型（毫秒级订阅推送）；重新协商在第 9 步之后异步出现（F09.3）。
