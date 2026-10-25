# 14 首个场景 · part2：主走查（`scope_change.main`），以事件序列写出

> 分片清单见 part1。每行 = 一条事件（seq），括号内是投影的关键变化。金额单位美分。"cv" = constraintsVersion。

## 8. 阶段 A：seed（`npx convex run seed:scopeChangeRoom '{"fixtureKey":"scope_change.main",...}'`）

| seq | 事件（actor） | 投影变化 |
| --- | --- | --- |
| 1 | room_created（system，simulated） | rooms 行：cv 0、lastSeq 1 |
| 2–4 | member_joined ×3（system；三个已知账号，tokenIdentifier 事先由 `health.viewer` 取得） | members ×3 |
| 5 | budget_changed{old:null, new:500000, reason:"Initial budget", cv→1} | budgets 500000 |
| 6 | baseline_commitment_recorded{400000, "Existing SOW"} | commitments：baseline 400000 |
| 7–9 | catalog_item_confirmed LOGIN_SSO@1 / USAGE_REPORTS@1 / CSV_EXPORT@1（actor system 代 provider，simulated；cv→2,3,4） | catalogItems ×3 |
| 10 | brief_confirmed{provider v1, hardChanged, cv→5} | briefVersions |
| 11 | brief_confirmed{finance v1, hardChanged:false, cv:null} | briefVersions |

customer 的简报由 seed 写成**草稿**（`briefDrafts`，不是事件），留给真人确认——让"三方确认后才开始"这一步是真实操作。

## 9. 阶段 B：首轮协商（真实用户 + 模型）

| seq | 事件（actor） | 说明 |
| --- | --- | --- |
| 12 | brief_confirmed{customer v1, cv→6}（user customer） | 反应器：readiness 满足 |
| 13 | run_started{#1, initial, cvAtStart:6, maxRounds:3}（rule） | 预检：buyer 候选 5 个 → 调度 provider propose（agentTurns r1 t1） |
| 14 | turn_completed{provider, propose, C-…+CSV_EXPORT-rush}（agent） | 代理选了全量 |
| 15 | proposal_created{v1, 140000, 11-13, deferred:[], validation:{ok:false,[OVER_BUDGET]}} | 买方看到 "Over budget by $400"；provider 看到 "Blocked: exceeds the finance limit" |
| 16 | turn_completed{finance, counter, C-LOGIN_SSO+USAGE_REPORTS-rush} | finance 不能 recommend_accept 超预算提案（代码校验） |
| 17 | turn_completed{customer, counter, C-LOGIN_SSO+USAGE_REPORTS-rush} | 两个评估都完成 → round 2 |
| 18 | turn_completed{provider, propose, C-LOGIN_SSO+USAGE_REPORTS-rush} | — |
| 19 | proposal_created{v2, round 2, 90000, 11-13, deferred:[CSV_EXPORT], ok} | 买方："Within budget ($100 left)" |
| 20–21 | turn_completed{customer, recommend_accept}、{finance, recommend_accept} | 代理建议 ≠ 批准 |
| 22 | run_ready_for_approval{#1, v2} | run#1 pending_approval |
| 23 | decision_recorded{v2, customer, terms, approve, cv6} | — |
| 24 | decision_recorded{v2, provider, terms, approve, cv6} | 还差 finance |

## 10. 阶段 C：审批途中预算下调（核心转折）

| seq | 事件 | 说明 |
| --- | --- | --- |
| 25 | budget_changed{500000→480000, "Q4 budget revision", committedAtChange 400000, cv→7}（user finance） | 唯一的版本推进点 |
| 26 | run_superseded{#1, constraints_changed}（rule，causation 25） | currentRunNo 清空 |
| 27 | run_started{#2, constraints_changed, cvAtStart:7}（rule） | 预检：buyer 候选 3 个（AB-standard 80000、A-rush 55000、A-standard 45000）→ 调度 provider |

**seq 25 提交的同一刻，三个窗口通过 `rooms.view` 订阅同时看到：**

| 查看者 | v2 卡片 | 审批面板 |
| --- | --- | --- |
| finance | "Blocked · Checked against constraints v7: over budget by $100 (+$900 change, $4,900 committed after approval, $4,800 cap)" | customer ✓ v2@cv6 → "stale"；provider 同；finance 无 |
| customer | 同 finance（买方） | 同上 |
| provider | "+$900 · Blocked: exceeds the finance limit" —— 不出现 $4,900（否则可反推已承诺 $4,000） | 同上 |

时间线（provider）："A finance constraint changed. Constraints v7." → "Run #1 superseded." → "Run #2 started."。

## 11. 阶段 D：重谈与取舍

| seq | 事件 | 说明 |
| --- | --- | --- |
| 28 | turn_completed{provider, propose, C-LOGIN_SSO+USAGE_REPORTS-standard} | provider 上下文里有 v2 的投影原因 EXCEEDS_FINANCE_LIMIT 与运营者说明 |
| 29 | proposal_created{v3, run#2, 80000, 2026-11-20, deferred:[CSV_EXPORT], ok} | 80000 = 余量，≤ 通过 |
| 30 | turn_completed{customer, reject, NEEDS_TRADEOFF} | customer 代理知道私密偏好 11-13，日期与 REPORTS 不可兼得；理由只给 customer 本人 |
| 31 | turn_completed{finance, recommend_accept} | — |
| 32 | run_needs_input{#2, NEEDS_TRADEOFF} | 代码决定升级，不是模型 |
| 33 | human_request_opened{#1, target customer, tradeoff, options: opt-1 choose AB-standard 80000 11-20；opt-2 choose A-rush 55000 11-13；opt-3 cancel_change, cv7} | finance 看到"等待 customer 在 2 个方案间选择"；provider 只看到"Waiting for a customer decision." |
| 34 | human_request_answered{#1, opt-1}（user customer） | 所选候选即当前提案 v3 → 不新建提案 |
| 35 | run_ready_for_approval{#2, v3} | — |

## 12. 阶段 E：审批与执行

| seq | 事件 | 说明 |
| --- | --- | --- |
| 36 | decision_recorded{v3, customer, terms, approve, cv7} | — |
| 37 | decision_recorded{v3, provider, terms, approve, cv7} | — |
| 38 | decision_recorded{v3, finance, budget, approve, cv7} | 同一 mutation 内完成判定为真；重算 400000 + 80000 ≤ 480000 |
| 39 | execution_completed{run#2, v3, cv7, operationId "exec:<roomId>:p3:c7", 80000, 11-20, committedBefore 400000 → after 480000, total 480000, tasks: LOGIN_SSO×2、USAGE_REPORTS×1} | changeOrders+1、commitments+1、tasks+3、run#2 confirmed |

finance 双击第二次（同 commandId）→ `duplicate`；不同 commandId → 守卫失败（run 已 confirmed），无新事件。

## 13. 追溯："这张 $800 变更单是怎么来的"

`audit.trace({roomId, operationId})` 沿事件反查（按查看者投影）：

```text
execution_completed#39 ← decision_recorded#36,#37,#38（v3@cv7）
  ← run_ready_for_approval#35 ← human_request_answered#34（customer 选 opt-1）
  ← human_request_opened#33 ← run_needs_input#32 ← turn_completed#30（customer 代理 NEEDS_TRADEOFF）
  ← proposal_created#29（v3，候选 AB-standard，金额 = 45000 + 35000，来源 LOGIN_SSO@1、USAGE_REPORTS@1 ← #7、#8）
  ← run_started#27 ← run_superseded#26 ← budget_changed#25（finance，"Q4 budget revision"，cv7）
同时可见：v2 的两条 approve（#23、#24）保留，标记 stale @cv6
```

## 14. 变体要点

| 变体 | 与主线的分叉 | 关键事件 |
| --- | --- | --- |
| 在途回合期间下调 | seq 25 发生在 seq 18 的 provider 回合进行中 | 该回合结果到达时 `turn_rejected_stale{staleReason:"constraints_changed"}`，不产生 v2 |
| renegotiable（490000） | 余量 90000 | run#2 中 provider 再提 AB-rush → 两方 accept → 审批 → 执行 $900 |
| infeasible（440000） | 余量 40000 | run_started#2 后直接 run_needs_input{NO_FEASIBLE_CANDIDATE} + finance 请求 raise_budget 445000；**零次模型调用** |
| below_committed（390000） | total < committed | run_needs_input{BUDGET_BELOW_COMMITTED}；finance 请求 |
| customer 选 opt-2 | seq 34 选 A-rush | proposal_created{v4, human_option, 55000, 11-13, deferred:[USAGE_REPORTS, CSV_EXPORT]} → ready → 审批 → 执行 $550 |
| 人拒绝 v3 | provider 拒绝 "DATE_TOO_LATE"（不常见，用作测试） | run_resumed{human_rejected, round 2} → 新 provider 回合 |
