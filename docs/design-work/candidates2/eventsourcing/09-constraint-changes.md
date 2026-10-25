# 09 约束变更（事件溯源候选）

## 1. 决定

| # | 决定 | 理由 |
| --- | --- | --- |
| CC-1 | `constraintsVersion` 只由四类**约束事件**推进：`budget_changed`、`catalog_item_confirmed`、`catalog_item_withdrawn`、`brief_confirmed{hardChanged:true}`。事件载荷携带 `constraintsVersionAfter`，apply 只从这里写 `rooms.constraintsVersion` | "谁在何时因何把版本推到 n"本身就是日志里的事实；不存在"只 patch 预算忘了递增"的路径（F09.1 blocker） |
| CC-2 | 约束变更的**后果**是同一命令内由反应器追加的独立事件：`run_superseded`、`human_request_cancelled`×n、新 `run_started` 或 `run_needs_input` | 每个后果都可追溯到原因（`causationSeq`） |
| CC-3 | 阻断在读取时派生，不回写旧提案或旧审批 | 预算一提交，所有窗口同一刻翻转为 blocked，不等新 run 与模型（F09.3） |
| CC-4 | 约束历史不另建表：就是约束事件的子序列；`constraintsAt(n)` 折叠得到任一版本的完整约束 | 事件溯源直接替代原设想的 `constraintRevisions` / `budgetChanges` 表 |
| CC-5 | 任何硬约束变化（含**上调预算**）都推进版本并使旧审批失效 | 核心 3："条款或约束变了必须重新审批"；上调也可能让更优方案可行（Q7 裁决：上调同样重谈） |
| CC-6 | 软约束（`preferredDate`、notes、desired 顺序）变化：确认新简报版本，`hardChanged:false`，**不推进版本**、不使审批失效；若有活动 run 处于 negotiating，下一回合自然读到新简报 | 偏好只影响协商，不影响可执行性（开放决定 14） |
| CC-7 | 预算可以被设到低于已承诺（记录现实），但会进入 `BUDGET_BELOW_COMMITTED`，不启动新 run，向 finance 开请求 | 系统只记录事实，不能拒绝记录真实发生的预算削减；与 RA-R10"拒绝"不同，见 18 ADR-11 |

## 2. 递增点清单

| 命令 | 何时推进 | 事件 | hardChanged 判定 |
| --- | --- | --- | --- |
| `budget.update` | newTotalCents ≠ 当前（相同值返回 `noop`） | budget_changed | 恒为硬约束 |
| `catalog.confirmItem` | 新 itemKey 或已有 itemKey 的价格/lead days/rush/模板任一变化 | catalog_item_confirmed{itemVersion+1} | 恒为硬约束 |
| `catalog.withdrawItem` | 条目存在且为 confirmed | catalog_item_withdrawn | 恒为硬约束 |
| `briefs.confirm`（customer） | `requiredItemKeys`、`deadline`、`deferrableItemKeys`、`desiredItemKeys` 任一变化 | brief_confirmed{hardChanged:true} | 插件 `brief.customer.hardFields` |
| `briefs.confirm`（provider） | `earliestStartDate` 变化 | 同上 | `brief.provider.hardFields` |
| `briefs.confirm`（finance） | 无硬字段（预算走 budget.update） | brief_confirmed{hardChanged:false} | — |
| `requests.answer` | 选项为 raise_budget / relax_deadline | 分别产生 budget_changed / brief_confirmed（actor 为回答者本人，`causationSeq` 指向 human_request_answered） | 同上 |
| 其他任何写入 | **不得**推进 | — | — |

setup 阶段（尚无 run）的约束事件同样推进版本——规则统一，没有特例；第一份提案的 constraintsVersion 自然 ≥ 这些事件。

desired/deferrable 被归为硬字段，是因为它们改变候选排序与 deferredItemKeys，进而改变"被批准的内容"；保守处理。

## 3. `budget.update` 事务（完整时序）

```text
finance ── budget.update({roomId, newTotalCents: 480000, reason: "Q4 budget revision", commandId})
单个 mutation:
 1 requireRole(finance)；assertCents(newTotalCents)；reason 1..200 字符
 2 commandId 去重
 3 loadRoomState：budget 500000、Σcommitments 400000、cv=4、run#1(pending_approval)、proposal v3、open 请求 0
 4 plan：new ≠ old → 事件 budget_changed{old:500000,new:480000,reason,committedCentsAtChange:400000,
        constraintsVersionAfter:5}
 5 apply：budgets.totalCents=480000；rooms.constraintsVersion=5
 6 反应器 onConstraintsChanged(state', causation=seq):
    a run#1 非终态 → run_superseded{constraints_changed}；apply 清空 currentRunNo
      ─ 在途回合：尝试 scheduler.cancel(turn.scheduledFnId)（未开始则不运行；已开始无法中止，
        包 try/catch，查 _scheduled_functions 状态）；真正保证是 completeTurn 的持久化守卫
    b 所有 open humanRequests → human_request_cancelled{reason:"constraints_changed"}
    c total < committed → run_started{#2, constraints_changed} + run_needs_input{BUDGET_BELOW_COMMITTED}
      + human_request_opened{finance}；不调模型
    d 否则 run_started{#2, trigger:"constraints_changed", constraintsVersionAtStart:5}
       → 预检 enumerateCandidates(buyer)
         无候选 → run_needs_input{NO_FEASIBLE_CANDIDATE} + human_request_opened
         有候选 → scheduleTurn(provider, propose, round 1)：insert agentTurns + runAfter(0, runTurn)
                  + runAfter(WATCHDOG_MS, turnWatchdog)
 7 patch rooms 流头；提交。调度在提交后才生效；任何一步抛错则全部回滚（含调度）
```

时间线上 provider 看到："A finance constraint changed. Constraints v5." → "Run #1 superseded." → "Run #2 started."；买方额外看到金额与原因。

## 4. 派生可执行性（为什么不需要回写）

```ts
isExecutable(p) = p.version === room.currentProposalVersion
               && run(room.currentRunNo)?.status === "pending_approval"
               && p.constraintsVersion === room.constraintsVersion
               && validate(currentInputs, p).ok
```

预算提交后：`room.constraintsVersion` 变为 5 ≠ v3 的 4 → v3 立刻 blocked（reasonCode `CONSTRAINTS_CHANGED` + 重算出的 `OVER_BUDGET`）；v3 上的两条 approve 立刻显示 stale；记录本身一条未改。

## 5. 历史与"当时的约束"

```ts
// internalQuery audit.constraintsAt({roomId, version})
// 折叠 by_room_seq 上 seq ≤ S 的约束事件，S = constraintsVersionAfter === version 的那条事件的 seq
type ConstraintsSnapshot = {
  version: number; budgetTotalCents: number;
  catalog: Record<string, CatalogItemCurrent>;        // 每个 itemKey 的最新版本（撤回则缺席）
  briefs: Partial<Record<Role, { version: number; content: BriefContent }>>;
};
```

用途：①审计页"批准 v4 时的约束是什么"；②用当时的规则版本复核 `proposal_created.validation` 快照；③争议时证明"旧审批为何失效"。

- 只读最多一个房间的事件（百级），在 query 中折叠即可；不建快照。
- 结果按查看者角色再投影（07），provider 看不到预算字段。

## 6. 重新协商的触发矩阵

| 约束变化时 run 的状态 | 处理 |
| --- | --- |
| 无活动 run（setup 或已执行后） | 只推进版本；不自动开 run（已执行后的修订需人工 `runs.start{manual}`）；setup 中最后一份必需简报确认时自动开 run |
| negotiating | 旧 run superseded；新 run；在途回合结果迟到即 stale |
| pending_approval | 同上；旧审批派生为 stale |
| needs_input | 同上；open 请求 cancelled |
| failed | 同上 |
| confirmed / superseded | 不受影响（终态） |

## 7. 必测场景（→ 16）

1. 回合进行中降预算：迟到回复 `turn_rejected_stale`，不产生提案。
2. 两方已批准后 customer 提前截止日：版本 +1，两条审批 stale，执行被拒（RA-B02）。
3. 提案引用目录 v1 后 provider 改价：旧提案 `SOURCE_SUPERSEDED`（RA-B04）。
4. 降到恰好等于余量（headroom = 80000）→ A+B standard 可行；降到 $4,400 → 无候选 → finance 请求；降到 $3,900 → BUDGET_BELOW_COMMITTED。
5. 上调预算：版本 +1、旧审批 stale、新 run 启动。
6. 只改 preferredDate：版本不变、审批仍有效。
