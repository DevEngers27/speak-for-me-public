# 09 约束变更（part1）：版本规则、递增点、bumpConstraints、预算变更流程

> 分片：part1 本页；part2 派生可执行性与"瞬间阻断"、重新协商的触发规则、历史保留、边界情形。

## 9.1 规则

1. **约束 = 规则输入**：各角色最新确认简报中的规则相关字段（ruleKey 覆盖的字段）、目录中有效的条目版本、承诺台账汇总、房间时区。规则只读这些（06 §6.2）。
2. **单一入口**：`rooms.constraintsVersion` 只经 `bumpConstraints(ctx, room, cause, actorUserId?)` 改变（I3），并且每次都插入一行 `constraintVersions` 快照。任何直接 patch 该字段的代码都是缺陷（静态扫描 IM-03）。
3. **递增即失效**：版本 +1 让所有基于旧版本的审批派生为 stale，让活跃 run 立即 superseded（R2），让 open 人工请求 superseded（I18）。
4. **软信息不递增**：软偏好、私密备注、披露选择、已回答请求的公开答案改变代理的上下文，但不改变规则输入，所以不使审批失效（F09.1【改写】）。

## 9.2 快照与 `loadRuleInput`

`constraintVersions[v]` 保存指针而不是副本：`briefVersionIds`（每角色最新确认版本）、`catalogItemIds`（每个 itemKey 的最新版本且为 confirmed）、`scenarioState`（`committedCents`、`baselineRecorded`）。`loadRuleInput(ctx, room, v)` 按指针读取不可变记录组装 `RuleInput`。因为被指向的记录都不可变，任何历史版本的评估都可以在事后精确复现（核心 6 的"可追溯每个结果是怎么来的"）。

## 9.3 递增点清单

| 操作 | 函数 | 递增？ | cause |
| --- | --- | --- | --- |
| customer 确认简报，且请求范围、必需项或截止日变化 | `briefs.confirm` | 是 | `brief_confirmed` |
| customer 确认简报，只改重要项、首选日、备注或披露 | `briefs.confirm` | 否（生成新简报版本） | — |
| finance 确认新的预算上限 | `briefs.confirm`（界面入口 "Update budget cap"） | 是 | `brief_confirmed` |
| provider 确认简报（v1 只有软字段） | `briefs.confirm` | 否 | — |
| provider 确认目录条目（新增、改价、改日期、改加急费） | `catalog.confirmItem` | 是 | `catalog_changed` |
| provider 撤回目录条目 | `catalog.withdrawItem` | 是 | `catalog_changed` |
| finance 记录基线承诺 | `ledger.recordBaseline` | 是 | `baseline_recorded` |
| 执行（台账增加） | `executeIfReady` | 是 | `execution_recorded` |
| 回答 `share_answer` 类请求 | `requests.answer` | 否（开新 run，同一版本） | — |
| 参与者加入 | `invites.accept` | 否（必需审批角色由场景声明，不随成员变化；成员齐全是就绪条件） | — |
| 修改房间标题 / 目标 | （v1 不提供修改入口；Q12：目标不进入规则） | 否 | — |
| 日期流逝 | — | 否（`date.in_past` 实时派生） | — |

是否递增由 ruleKey 比较自动决定（`briefs.confirm`），不靠调用方自觉：新版本的 `scenario.brief.ruleKey(roleKey, fields)` 与上一确认版本不同才调用 `bumpConstraints`。

## 9.4 `bumpConstraints` 与 `onConstraintsChanged`

```ts
async function bumpConstraints(ctx, room, cause: ConstraintCause, actorUserId?: Id<"users">) {
  const version = room.constraintsVersion + 1;
  const pointers = await collectPointers(ctx, room);          // 同事务内读到刚插入的简报 / 目录 / 台账行
  await ctx.db.insert("constraintVersions", { roomId: room._id, version, cause, actorUserId, ...pointers, createdAt: now });
  await ctx.db.patch("rooms", room._id, { constraintsVersion: version });
  await emitEvent(ctx, "constraints_changed", { audience: room, payload: { version, causeKind: cause.kind, causeRole } });
  await scenario.emitConstraintDetailEvents(ctx, room, cause, pointers);     // 如 budget_cap_changed（只发预算受众）
  await onConstraintsChanged(ctx, { ...room, constraintsVersion: version }, cause);
}

async function onConstraintsChanged(ctx, room, cause) {
  const live = await getLiveRun(ctx, room);
  if (live) await supersedeRunTx(ctx, live, "constraints_changed");          // T12：取消 attempt、请求
  if (cause.kind === "execution_recorded") return;                          // 执行后不自动开始新协商
  if (!live) return;                                                        // 协商尚未开始（准备阶段逐个确认简报）不自动开始
  await startRunTx(ctx, room, { trigger: { kind: "constraints_changed", constraintsVersion: room.constraintsVersion },
                                origin: "system" });                       // → T1 / T2 / T3（04 §4.2.3）
}
```

要点：
- 只有"变化发生时已有活跃 run"才自动重启协商；准备阶段（还没人点开始）的确认只递增版本。
- `startRunTx` 决定三条路径：当前提案在新版本下仍可执行 → 零回合 run 进入重新审批（T2，不复制提案，RA-R11）；不可执行但有候选 → 新 run 以 3 秒防抖开始协商（T1）；没有候选 → 直接问人（T3，不调模型）。
- 同一事务里完成"递增 + 取代旧 run + 建新 run + 调度第一个回合"，任何一步失败整体回滚；不会出现"版本变了但旧 run 仍在跑"的中间态。

## 9.5 预算变更流程（finance 在审批期间下调上限）

**界面**：finance 的预算面板 "Update budget cap" → 输入新上限与原因 → 预览（`briefs.previewConstraintImpact`，只返回给本人：当前提案在新上限下的评估、哪些审批会失效、候选数量）→ 确认。

**事务**（`briefs.confirm({ roomId, fields, privateNotes, disclosures, changeNote, expectedLatestVersion })`）：

| 步 | 动作 | 失败 → 结果 |
| --- | --- | --- |
| 1 | `requireRole(finance)`；房间 open；`fields` 经场景 Zod（含 `assertCents`）；`expectedLatestVersion` 等于本人最新确认版本（同一人在两个标签页编辑时的乐观并发） | `FORBIDDEN_ROLE` / `ROOM_CLOSED` / `VALIDATION_FAILED` / `STALE_VIEW`；无写入 |
| 2 | 插入 `briefVersions` v(n+1)，`changeNote = reason`，计算 ruleKey | — |
| 3 | ruleKey 变化 → `bumpConstraints(cause: brief_confirmed{finance})` | — |
| 4 | 事件：`constraints_changed`（全房间，无数值）；`budget_cap_changed`（finance + 预算受众：旧 / 新上限、原因） | — |
| 5 | `onConstraintsChanged` → 旧 run superseded → `startRunTx` 按 9.4 选择路径 | — |
| 6 | 返回 `{ briefVersionId, constraintsVersion, effect: "none" \| "reapproval" \| "renegotiating" \| "needs_input" }` | — |

允许把上限调到已承诺额以下（如实记录现实中的预算削减）：确认前显示警告；之后所有候选都报 `budget.cap_below_committed`，`startRunTx` 走 T3，规划器只给 finance 发请求（14 §14.10 变体 C）。

与审批并发时的串行化见 08 §8.6；与在飞回合并发时的处理见 10 part2 F12。
