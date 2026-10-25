# 09 约束变更

## 1. 决定

| 目标 | 决定 | 理由 | 被否决 |
| --- | --- | --- | --- |
| 版本何时递增必须无歧义 | **一条规则：任何简报版本被确认，`constraintsVersion` +1**；其他任何写入都不改它 | 约束 = 已确认简报集合；规则一句话可测 | 逐字段判断"硬/软"再决定是否递增（软偏好改动不使审批失效） |
| 预算变更不是特殊流程 | 预算是 finance 简报字段；改预算 = finance 确认新简报版本（带 reason、changeCode） | 一个入口覆盖预算、截止日、必需条目、目录价格 | 独立 `updateBudget` + `budgetChanges` 表 |
| 阻断即时 | 可执行性读取时派生，不回写 | 提交瞬间所有窗口翻转 | 回写 blocked 状态 |
| 重谈只有一条路径 | 活动 run 一律 superseded，新 run（trigger constraint_change） | 一组守卫；无"同 run 跨约束版本" | 同一 run 回到 negotiating |
| 预算低于已承诺 | 拒绝写入（`BUDGET_BELOW_COMMITTED`） | v1 没有退款/撤销承诺；该状态没有任何合法出路 | 进入 needs_input（无人能用系统内操作解决） |

**关于"软约束改动也让审批失效"的代价**：customer 只改 `preferredDate` 也会使旧审批失效并触发重谈。我们接受它：①偏好会改变代理的评估，旧的代理建议已不成立；②规则简单、不会误判；③表单在确认前显示 "Confirming will invalidate 2 approvals and restart negotiation"（数量来自 `rooms.view`），人可以取消。若实测这类改动频繁，再引入"软字段不递增"的分级（ADR-11，开放问题）。

## 2. 唯一写入口 `applyBriefVersion(ctx, { room, seat, content, disclosed, notes, reason, changeCode, expectedVersion, viaRequestId? })`

被 `briefs.confirm` 与 `requests.answer(patch_brief)` 调用；是全系统唯一写 `briefs` 与 `rooms.constraintsVersion` 的代码。

```text
 1. assertRole；content.kind 必须匹配 seat.role 的 kind
 2. latest = briefs.by_room_role_version(room, role).order("desc").first()
    (latest?.version ?? 0) !== expectedVersion → throw VERSION_CONFLICT（表单基于旧版本）
 3. codes = scenario.validateBriefContent(role, content, { latestBriefs, committedCents, today })
    codes ≠ [] → throw ConvexError({ code: codes[0] })        // 无数字
 4. disclosed ⊆ scenario.disclosure[role].disclosable；notes ≤ 2000；latest 存在时 reason 必填(≤ 300) 且 changeCode ∈ 场景词表
 5. cv = room.constraintsVersion + 1
    insert briefs{ version: latest+1, constraintsVersion: cv, content, disclosed, notes, reason, changeCode, confirmedBy, viaRequestId, simulated:false }
    patch room{ constraintsVersion: cv }
 6. 若全部角色都已有简报：
      run = room.currentRunId && db.get(...)
      run 不存在                → startRun(trigger "briefs_ready")
      run.status ∉ {executed}   → startRun(trigger "constraint_change")   // 内部把旧 run 置 superseded
      run.status === executed   → 不自动开 run（执行后的变化只影响下一次 runs.start）
 7. 返回 { version, constraintsVersion: cv }
```

## 3. 每种约束变化的后果

| 变化 | 谁 | 版本 | 旧提案/审批 | 后续 |
| --- | --- | --- | --- | --- |
| 降预算（仍 ≥ 已承诺） | finance | +1 | 不可执行（版本不匹配）；审批 invalidated | 新 run：有可行组合 → provider 回合；否则 needs_input |
| 降预算到已承诺以下 | finance | 不变 | 不变 | 写入被拒 `BUDGET_BELOW_COMMITTED` |
| 升预算 | finance | +1 | 同上 | 新 run（Q7：升预算也重谈，可能得到更大范围） |
| 外部支出增加（`priorCommittedCents` 上调） | finance | +1 | 同上 | 同降预算（F01.5 进阶：已承诺上升也被系统感知） |
| 截止日提前/推后、required/wanted 调整 | customer | +1 | 同上 | 新 run |
| 目录改价、增删条目 | provider | +1 | 同上；引用旧价格的提案即使重放也会报 `SOURCE_MISMATCH` | 新 run |
| 只改 notes 或披露选择 | 任一 | +1 | 同上 | 新 run（简单规则的代价，见 §1） |
| 人工请求答案 `patch_brief` | targetRole | +1 | 同上 | 新 run（R12） |
| 新增必需审批人（RA-R05） | — | — | v1 审批人是场景常量，不可在运行中改 | 若未来可配置，必须作为某个简报字段，自动适用本规则 |

## 4. 时序：审批途中预算下调（主线走查，数字见 14）

| 步 | 调用 | 读 | 写 | 可能失败 → 状态 |
| --- | --- | --- | --- | --- |
| 1 | finance 提交 `briefs.confirm({content:{total: 480000, prior: 400000}, reason:"Q4 budget revision", changeCode:"BUDGET_REVISED", expectedVersion:1})` | room、finance 最新简报、changeOrders(room) | — | VERSION_CONFLICT / BUDGET_BELOW_COMMITTED → 无任何变化 |
| 2 | 同事务 `applyBriefVersion` | — | briefs(finance v2, cv 4)；room.cv 3→4 | — |
| 3 | 同事务 `startRun` | runs、全部最新简报 | run#1 → superseded；insert run#2{cv 4, round 1}；room.currentRunId | 可行性 ∅ → run#2 直接 needs_input + humanRequests |
| 4 | 同事务 `scheduleTurn(provider)` | — | insert agentTurns；run#2.activeTurnId；`runAfter(0, runTurn)`、`runAfter(150s, watchdog)` | 回滚则调度也不存在（inputs/04 §1.5） |
| 5 | 提交后：订阅回推 | — | — | provider 窗口："v1 superseded · Constraints changed (budget revised)"，无数字；买方窗口另显 "cap $4,800 / v1 would be over by $100" |
| 6 | run#1 若有在途回合，结果到达 | turn、run#1、room | turn → stale + 用量 | — |

## 5. 历史保留

- 每个约束版本都能还原：`briefs.by_room_cv` 取 `constraintsVersion ≤ n` 时各角色的最新版本。
- 任一提案可追溯：`proposal.sourceBriefVersions` → 当时三份简报；`proposal.turnId` → 模型调用与用量；`approvals.by_proposal` → 全部决定；`changeOrders.by_proposal` → 执行结果。
- 变更原因：`briefs.reason`（只给本人）+ `changeCode`（公开模板 "budget revised"）。F01.5 的"可见原因"由 changeCode 承担，不暴露数字。

## 6. 开放问题

- 报价有效期（`validUntil`）：若引入，到期应自动视为 provider 约束变化——需要一个 scheduled mutation 代 provider 写新版本还是只派生"过期即不可执行"？倾向后者（派生、不写），留 18 号 Q。
