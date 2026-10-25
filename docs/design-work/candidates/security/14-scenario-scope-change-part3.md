# 14 首个场景（part3：预算下调完整走查、无解与边界变体、算术核对）

走查使用 `scope_change.main` 与 stub 代理（`AGENT_MODE=stub`），因此每一步都是确定的；真实模型在同样的候选集里可能做出不同选择，但所有守卫、提案价格与检查结果完全相同。

## 14.11 主走查

| # | 动作（函数） | 关键写入 | cv | run | customer 看到 | provider 看到 | finance 看到 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | customer 建房（`rooms.create`，自选 customer 席位），发两份邀请 | rooms、3 席位、2 邀请 | 0 | — | 房间（setup） | — | — |
| 2 | provider、finance 接受邀请（`invites.accept`） | 席位绑定 | 0 | — | "Provider joined"、"Finance joined" | 同左 | 同左 |
| 3 | provider 发布目录 v1；三方确认简报 v1 | catalogVersions、briefVersions | 0 → **1** | run 1 `running` | "Room is active · constraints v1" | 同左 | 同左 |
| 4 | provider 代理 propose（候选第 1 名：三项加急） | 提案 **v1** $1,400，2026-11-25 | 1 | round 1 | "Over budget by $400" | "Blocked: buyer-side constraint" | "Over budget by $400" |
| 5 | customer 代理 counter LOGIN+REPORTS 加急；finance 代理 counter LOGIN+REPORTS 标准 | 两条私有笔记；按优先级采纳 customer 的 counter → 提案 **v2** $900，2026-11-13，EXPORT 延后 | 1 | round 2 | v2 "Ready" · "+$900 · available $1,000 → $100" | v2 "Ready" · "+$900" | v2 "Ready" · "$4,000 → $4,900 of $5,000" |
| 6 | provider、finance 代理评审 v2：均 `recommend_accept`（私有） | 笔记 | 1 | `awaiting_approval` | "Reviews complete" + 本方代理建议 | 同左 | 同左 |
| 7 | customer "Approve change v2"；provider "Accept terms v2"（各带 `expectedConstraintsVersion: 1`） | 2 条 decisions | 1 | 同上 | 两人 approved，finance pending | 同左 | 同左 |
| 8 | finance `budget.update(480000, "Q4 budget revision")` | finance 简报 v2；快照 cv 2；run 1 → `superseded`；run 2 开始 | **2** | run 2 `running` | v2 "Over budget by $100"；自己的批准 "stale — constraints changed"；"Finance updated a private constraint (v1 → v2). Available budget is now $800." | v2 "Blocked: buyer-side constraint"；自己的批准 stale；"Finance updated a private constraint (v1 → v2)." | "You lowered the cap: $5,000 → $4,800. Reason: Q4 budget revision." v2 "Over by $100" |
| 9 | provider 代理 propose（排除 v1、v2 后第 1 名：三项标准） | 提案 **v3** $1,250，2026-12-04 | 2 | round 1 | v3 "Over budget by $450; after your deadline by 7 days" | v3 "Blocked: buyer-side constraint" | v3 "Over budget by $450; after deadline by 7 days"（deadline 已披露给 finance） |
| 10 | customer、finance 代理都 counter LOGIN+REPORTS 标准 | 去重 → 提案 **v4** $750，2026-11-20，EXPORT 延后（作者 customer 代理） | 2 | round 2 | v4 "Ready" · "+$750 · available $800 → $50" | v4 "Ready" · "+$750" | v4 "Ready" · "$4,000 → $4,750 of $4,800" |
| 11 | provider、finance 代理 `recommend_accept` | 笔记 | 2 | `awaiting_approval` | 审批卡："Approval will create: change order, 2 tasks for provider (due 2026-11-20)" | 同左（无预算行） | 同左 + 预算行 |
| 12 | 三方依次批准 v4（`expectedConstraintsVersion: 2`）；第三票在同一事务中执行 | decisions ×3；changeOrders CO-1；commitments（before 400000 / after 475000 / cap 480000）；tasks ×2；run 2 → `executed`；快照 cv 3（cause executed） | **3** | run 2 `executed` | "Change order CO-1 recorded … Internal record only." · "available budget $50" | CO-1 与 2 个任务（指派给自己） | CO-1 · "$4,750 committed of $4,800" |
| 13 | finance 再次双击批准（或脚本 `double_click_final`） | 无新写入；`dup_exec` 计数 +1 | 3 | 不变 | 不变 | 不变 | "Already executed (CO-1)" |

事件时间线（provider 视角渲染，节选）：`Room activated` → `Provider agent proposed EXPORT + LOGIN + REPORTS (rush, 2026-11-25) for $1,400` → `Customer agent proposed LOGIN + REPORTS (rush, 2026-11-13) for $900; deferred: EXPORT` → `Reviews complete` → `Customer approved v2 under constraints v1` → `Provider accepted v2 under constraints v1` → `Finance updated a private constraint (v1 → v2). Proposals are being re-checked.` → `Run 2 started` → … → `Change order CO-1 recorded`。整条时间线中没有任何 $5,000、$4,800、$4,000、$4,900、$800、2026-11-27 或 $400 最低额。

调用量：run 1 = 1 + 2 + 2 = 5 次，run 2 = 5 次，均低于 `maxCalls = 12`。

## 14.12 无解变体（脚本 `twist_infeasible`：上限降到 $4,400）

| # | 事件 | 结果 |
| --- | --- | --- |
| 8′ | finance 降到 $4,400（cv 2） | v2 阻断；预检：任何含 LOGIN 的组合 ≥ $450 > 余量 $400 → 无可行组合 → run 2 直接 `needs_human`，**不调用模型** |
| 9′ | 生成请求（各自视图，05 §5.7） | finance："Raise your cap to at least $4,450 (+$50) to allow LOGIN (standard, 2026-11-20)."；customer："Make LOGIN optional — this would allow REPORTS (standard, $300)."；provider："No combination of your published quotes satisfies the buyer side's constraints. You can publish a revised catalog." |
| 10′a | finance 选择提高到 $4,450 | finance 简报 v3 → cv 3 → 预检非空 → run 3：provider 先提三项标准（阻断）→ customer 与 finance 还价 LOGIN 标准 $450（余量 $450 下唯一可行）→ 进入审批 |
| 10′b | （另一条路）customer 先选让 LOGIN 可选 | customer 简报 v2 → cv 3 → 预检仍为空（REPORTS 标准 $300 低于 provider 最低接单额 $400；REPORTS 加急 $450 超余量）→ run 3 `needs_human`；customer 收到 `adopt_candidate`（REPORTS 标准）；若采纳，人工提案显示 "Blocked: seller-side constraint"，customer 仍不知道 $400 这个数 |

这个变体同时覆盖了 AC-S2（无可行解 → 向具体的人请求取舍）与"provider 私密约束由代码执行、对买方只显示粗类"。

## 14.13 边界变体（脚本 `twist_boundary`：上限降到 $4,750）

余量恰好 $750：v2（$900）阻断；run 2 中 v4（LOGIN+REPORTS 标准 $750）满足 `750 ≤ 750`，可执行。执行后 headroom = 0，此后任何价格 > 0 的提案对 finance 显示 "Over budget"。

## 14.14 算术核对（美分）

| 量 | 计算 | 值 |
| --- | --- | --- |
| 全量加急 v1 | 45000 + 30000 + 50000 + 15000 | 140000 |
| v1 执行后 | 400000 + 140000 = 540000 > 500000 | 超 40000 |
| 一期 v2 | 45000 + 30000 + 15000 | 90000 |
| v2 执行后（cv 1） | 400000 + 90000 = 490000 ≤ 500000 | 余 10000 |
| v2 执行后（cv 2，上限 480000） | 490000 > 480000 | 超 10000 |
| 全量标准 v3 | 45000 + 30000 + 50000 | 125000；超 45000（cv 2）；交付 12-04 晚于截止 11-27 七天 |
| v4 | 45000 + 30000 | 75000；475000 ≤ 480000，余 5000 |
| 无解阈值 | LOGIN 标准 45000 > 余量 40000（上限 440000） | 无解 |
| 放宽后 | 上限 445000 → 余量 45000 = LOGIN 标准 | 可行（`≤`） |
| provider 最低额 | REPORTS 标准 30000 < 40000 | `BELOW_PROVIDER_MINIMUM` |
