# 03 Convex schema v1（part5）：唯一性落点、rooms 写入口、scope_change 载荷、演进

## 3.21 唯一性与"至多一个"的落点

| 逻辑约束 | 覆盖索引 | 唯一写入口（同一 mutation 先查后写） | 冲突时行为 |
| --- | --- | --- | --- |
| `users.tokenIdentifier` 唯一 | `users.by_token` | `users.ensureMe` | 返回已有行 |
| `(roomId, roleKey)` 一个席位 | `seats.by_room_role` | `rooms.create`（一次性） | 不会发生（无其他插入路径） |
| 一个用户在一个房间至多一席 | `seats.by_room_user` | `invites._accept`、`rooms.create` | `ALREADY_SEATED`；同一席位重复接受返回成功 |
| 每席位至多一个 pending 邀请 | `invites.by_seat` | `invites._store` | 旧的置 revoked |
| 令牌哈希唯一 | `invites.by_token_hash` | `invites._store` | 极低概率碰撞时重试生成 |
| 每席位一条草稿 | `briefDrafts.by_seat` | `rooms.create` | — |
| `(seatId, version)` 简报版本唯一且连续 | `briefVersions.by_seat_version` | `appendBriefVersion` | OCC 重试后取新最大值 |
| `(roomId, listKey, itemKey, version)` 唯一；每 itemKey ≤1 draft、≤1 confirmed | `listItems.by_room_list_key_version` | `lists.saveDraft` / `lists.confirm` / `lists.withdraw` | 草稿覆盖写同一行；确认时旧 confirmed → superseded |
| `(roomId, version)` 约束修订唯一 | `constraintRevisions.by_room_version` | `bumpConstraints` | — |
| `(roomId, seq)` 台账序号唯一 | `commitments.by_room_seq` | `ledger.addBaseline`、`executeIfComplete` | — |
| `(roomId, version)` 提案版本唯一 | `proposals.by_room_version` | `insertProposal` | — |
| 每房间 ≤1 active 提案 | `rooms.currentProposalId` + `proposals.by_room_status` | `insertProposal`、`executeIfComplete` | 旧的置 superseded |
| `operationKey` 唯一 | `executions.by_operation` | `executeIfComplete` | 返回已有执行 |
| 每房间 ≤1 running/stalled run | `rooms.activeRunId` | `startRun`、`finishRun` | `RUN_ACTIVE` 或返回已有 run |
| `(runId, seq, attempt)` 唯一 | `turns.by_run_seq` | `scheduleTurn`、`retryRun` | — |

所有入口都读写 `rooms` 文档或覆盖索引区间，使并发写入在 OCC 下串行化；并发正确性由 16 的真实部署脚本验证（convex-test 不模拟并发）。

## 3.22 rooms 字段的唯一写入口

| 字段 | 唯一写入口 | 何时改变 |
| --- | --- | --- |
| `constraintsVersion` | `bumpConstraints` | 规则字段、已确认清单、台账、执行、插件升级 |
| `proposalSeq`、`currentProposalId` | `insertProposal`（+1 并指向新提案）；`executeIfComplete`（清空指针） | 新提案；执行 |
| `runSeq`、`activeRunId` | `startRun`（设置）；`finishRun`（清空） | run 开始与结束（含 superseded、cancelled） |
| `executionSeq`、`lastExecutionId` | `executeIfComplete` | 执行 |
| `ledgerSeq` | `appendCommitment`（被 `ledger.addBaseline` 与 `executeIfComplete` 调用） | 台账新增 |
| `negotiationOpen` | `rooms.create`（true）、`executeIfComplete`（false）、`negotiation.requestRun`（true） | 见左 |
| `dayStamp` | `ops.maintenance.refreshDayStamps`（定时） | 房间时区跨日 |
| `status`、`closedAt` | `rooms.close` | 关闭 |
| `title`、`goal` | `rooms.updateInfo`（房主） | 任意时刻；不影响规则，不递增约束版本 |

lint 规则：`ctx.db.patch("rooms", ...)` 只允许出现在上表列出的模块中（11 的依赖规则）。

## 3.23 scope_change 载荷校验器（`scenarios/scope-change/validators.ts`）

```ts
import { v } from "convex/values";
const sc = v.literal("scope_change");

export const briefFields = v.union(
  v.object({ scenario: sc, role: v.literal("customer"),
    requiredItemKeys: v.optional(v.array(v.string())),   // rule
    hardDeadline: v.optional(v.string()),                // rule
    preferredDate: v.optional(v.string()) }),            // preference
  v.object({ scenario: sc, role: v.literal("provider"),
    minChangeValueCents: v.optional(v.number()) }),      // rule
  v.object({ scenario: sc, role: v.literal("finance"),
    budgetCapCents: v.optional(v.number()) }),           // rule
);

export const listItemData = v.union(
  v.object({ scenario: sc, list: v.literal("scope"),
    title: v.string(), description: v.string() }),
  v.object({ scenario: sc, list: v.literal("quote"), kind: v.literal("line"),
    scopeItemKey: v.string(), variantLabel: v.optional(v.string()),
    priceCents: v.number(), standardDate: v.string(), expeditedDate: v.optional(v.string()) }),
  v.object({ scenario: sc, list: v.literal("quote"), kind: v.literal("expedite_fee"),
    priceCents: v.number() }),
);

export const selection = v.object({
  scenario: sc,
  lineKeys: v.array(v.string()),                         // 每个范围项至多一行
  schedule: v.union(v.literal("standard"), v.literal("expedited")),
});

export const terms = v.object({
  scenario: sc,
  refs: v.array(v.object({ listKey: v.string(), itemKey: v.string(), version: v.number() })),
  lines: v.array(v.object({
    scopeItemKey: v.string(), quoteItemKey: v.string(), variantLabel: v.optional(v.string()),
    priceCents: v.number(), deliveryDate: v.string(),
  })),
  schedule: v.union(v.literal("standard"), v.literal("expedited")),
  feeCents: v.number(),
  amountCents: v.number(),
  deliveryDate: v.string(),
  includedItemKeys: v.array(v.string()),
  deferredItemKeys: v.array(v.string()),                 // 已确认范围项 − 已包含，代码计算
});
```

- `refs` 包含：被包含范围项的当前版本、所选报价行、加急时的费用行。任何一项被取代或撤回，提案经 `source_current` 检查被阻断。
- `role` 必须等于席位的 `roleKey`，`scenario` 必须等于房间的 `scenarioKey`（`appendBriefVersion` 守卫）。
- 字段语义与规则见 14。

## 3.24 演进规则

1. 新字段先 `v.optional` 推送，再用 internal mutation 分批回填，最后视需要收紧（04 平台约束 1.6 staged 索引可用于大表）。
2. 插件规则语义变化（检查、金额计算、候选定义）必须提升 `plugin.version`。部署后运行 `ops.maintenance.upgradeScenario`：对该场景所有 open 房间调用 `bumpConstraints(cause:"scenario_upgraded")`，旧签核因此过期，旧提案按新规则重新评估；`rooms.scenarioVersion` 更新。这样"人批准具体版本"也覆盖规则本身的变化。
3. 不删除历史表数据；开发部署可以清库重新 seed。
4. 生成代码 `convex/_generated` 入库，CI 无凭据也能类型检查（F11.2）。
