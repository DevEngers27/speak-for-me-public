# 14 首个场景 · part2：fixture 与预算下调的完整走查

## 6. fixture（`convex/scenarios/scopeChange/fixtures.ts`，Next、Convex、测试共用一份）

全部记录 `isSimulated = true`，界面显示 "Simulated"。日期相对 seed 日 D 计算，下文以 D = 2026-11-02（周一，房间时区 America/Los_Angeles）展示。

```ts
export const scopeChangeFixture = (D: string, variant: "renegotiate" | "tradeoff") => ({
  room: { title: "Analytics portal — Q4 change request", goal: "Add SSO and usage reporting before the board demo.",
          timeZone: "America/Los_Angeles" },
  customer: { requestedItems: [
      { itemKey: "SSO_LOGIN", title: "Single sign-on login" },
      { itemKey: "USAGE_REPORTS", title: "Usage reports dashboard" },
      { itemKey: "CSV_EXPORT", title: "CSV export of usage data" } ],
    requiredItemKeys: ["SSO_LOGIN", "USAGE_REPORTS"],
    deadline: addDays(D, 28),        // 2026-11-30，私密
    preferredDate: addDays(D, 18),   // 2026-11-20，私密
    notes: "Board demo on the preferred date. Custom report filters are nice to have.",
    disclosures: [] },
  provider: { offerLines: [
      { itemKey: "SSO_LOGIN", variantKey: "std", label: "SSO via SAML/OIDC", priceCents: 50000,
        earliestDeliveryDate: addDays(D, 14), taskTitle: "Implement SSO login" },
      { itemKey: "USAGE_REPORTS", variantKey: "full", label: "Usage reports with custom filters", priceCents: 40000,
        earliestDeliveryDate: addDays(D, 18), taskTitle: "Build usage reports dashboard" },
      ...(variant === "renegotiate" ? [{ itemKey: "USAGE_REPORTS", variantKey: "lite",
        label: "Usage reports, three fixed charts", priceCents: 25000,
        earliestDeliveryDate: addDays(D, 16), taskTitle: "Build fixed usage charts" }] : []),
      { itemKey: "CSV_EXPORT", variantKey: "std", label: "CSV export", priceCents: 50000,
        earliestDeliveryDate: addDays(D, 32), taskTitle: "Build CSV export" } ],   // 2026-12-04
    capacityNotes: "Two engineers until Dec 4.", notes: "Prefer phased delivery." },
  finance: { budgetCapCents: 500000, externalCommittedCents: 400000,
    paymentNotes: "Prefer milestone payments.", notes: "",
    disclosures: [ { field: "budgetCapCents", audience: { kind: "roles", roleKeys: ["customer"] } },
                   { field: "externalCommittedCents", audience: { kind: "roles", roleKeys: ["customer"] } } ] },
});
```
- 数字与原方案一致：总预算 $5,000、已承诺 $4,000、全量 $1,400（500+400+500）、一期 $900（SSO + 完整报表）、承诺后 $4,900、下调后 $4,800（余量 $800）。
- 补齐原方案缺的结局（F14.1、RA-B29）：变体 renegotiate 有 lite 报表行，$800 余量内存在满足必需项的 $750 方案（不落在边界上）；变体 tradeoff 没有 lite 行，下调后无可行方案。
- customer 的截止日与 provider 的产能是私密的：私密约束由代码检查、结论按披露矩阵展示（Role A RA-F03 修正三）。
- 测试变体 `canary`：在每方 notes 中加入 `CANARY-CUS-5521` / `CANARY-PRO-7713` / `CANARY-FIN-7731`，并把 cap 设为不常见的 $5,013.37（501337），便于扫描数值泄露。
- seed 只写入房间、参与方（已知账号）与**三份确认简报**（经 `commitBriefVersion`，因此 cv = 3），不直接写提案或审批（Role A Q11：中间状态必须由真实流程产生，15 §2）。

## 7. 标准走查（变体 renegotiate，stub 模式下完全确定；llm 模式下结构相同、具体提案可能不同）

| # | 动作（函数） | 约束 | run | 结果 | customer 看到 | provider 看到 | finance 看到 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | seed：三方确认简报 | v1→v3 | — | committed 400000 | phase ready | 同左 | 同左 |
| 2 | 任一方 `runs.start` | v3 | #1 negotiating r1 | 预检可行；调度 provider | "Provider agent drafting…" | 同左 | 同左 |
| 3 | provider 回合：全量 | v3 | #1 r1 | **v1** SSO+REPORTS full+CSV，$1,400，12-04，blocked：OVER_BUDGET、DELIVERY_AFTER_DEADLINE | "Over budget: $5,400 vs $5,000 cap (over by $400)"；"Delivery 2026-12-04 is after the deadline 2026-11-30" | "Blocked: exceeds the finance limit"；"misses the customer's deadline" | 预算数字；截止日只有原因 |
| 4 | 规则阻断 → 第 2 轮，provider 去掉 earliest 最晚的 CSV | v3 | #1 r2 | **v2** SSO+REPORTS full，$900，11-20，pass；CSV deferred | "Within budget: $4,900 of $5,000" | "Within the finance limit" | 同 customer |
| 5 | customer、finance 并行评估 | v3 | #1 r2 | 两者 recommend_accept → R-1 | "Customer agent recommends accepting v2 (advice…)" | 同左 | 同左 |
| 6 | customer、provider 批准 v2 | v3 | #1 pending_approval | 2/3 approved | 审批面板：customer ✓ provider ✓ finance pending | 同左 | 同左 + "Approve budget commitment" 按钮 |
| 7 | finance `updateBudgetCap(480000, "Q4 budget revision", shared = true)` | v3→**v4** | #1 → superseded；#2 negotiating | v2 复评 OVER_BUDGET；预检可行 {SSO+lite $750} | v2 "Over budget: $4,900 vs $4,800 (over by $100)"；自己的批准 stale；"Finance updated budget constraints (v3 → v4). Reason: Q4 budget revision" | v2 "+$900 · Blocked: exceeds the finance limit"；批准 stale；同一事件文本 | 全部数字；预算变更明细 |
| 8 | provider 回合（起点 v2，OVER_BUDGET → 换最便宜变体） | v4 | #2 r1 | **v3** SSO+REPORTS lite，$750，11-18，pass；CSV deferred | "Within budget: $4,750 of $4,800" | "Within the finance limit" | 同 customer |
| 9 | 评估方 recommend_accept | v4 | #2 pending_approval | 当前 = v3；执行预览：CO，$750，2 个任务 | 预览含预算影响 $4,000 → $4,750 / $4,800 | 预览只有金额与任务 | 同 customer |
| 10 | 三方依次批准 v3；第三票触发 `executeIfReady` | v4→**v5** | #2 executed | **CO-0001**：commitment 75000；任务 "Implement SSO login"、"Build fixed usage charts"，截止 11-18 | 变更单 + 预算影响 | 变更单 + 自己的任务 | 变更单 + 执行前后快照 |
| 11 | 任一方对 v3 再点 Approve / 重复请求 | v5 | — | `PROPOSAL_NOT_CURRENT`；无新记录 | — | — | — |

历史中保留：v1、v2（superseded，附当前约束下的阻断原因）、v3（executed）；v2 上 customer 与 provider 在 v3 约束下的批准（stale_approve）；三次约束集 v3、v4、v5 及原因；全部事件。原文的 "$4,900 proposal" 在本设计里是 v2 的 `committedAfterCents`，它由代码派生，从未由模型给出（GAP-03）。

## 8. 分支走查（变体 tradeoff：下调后无可行方案）

步骤 1–6 相同（没有 lite 行不影响 v1、v2）。

| # | 动作 | 约束 | run | 结果 |
| --- | --- | --- | --- | --- |
| 7' | finance 下调到 $4,800 | v4 | #1 superseded；#2 **awaiting_input**（预检为空，未调用模型） | `tradeoffs`：customer 选项 `make_optional[USAGE_REPORTS]`（SSO 单项 $500 可行）、`make_optional[SSO_LOGIN]`（报表单项 $400 可行）；finance 选项 `raise_cap_to_fit{v2, 490000}`（v2 是公开提案且唯一失败项是 OVER_BUDGET）；provider 选项 `revise_offer[SSO_LOGIN, USAGE_REPORTS]`（导航型）；每条都附 decline |
| 8'a | customer 选 `make_optional[USAGE_REPORTS]` | v5 | #2 superseded；#3 negotiating | 其余请求因 bump 取消；provider stub 起点 v2 → OVER_BUDGET 且无更便宜变体 → 去掉 earliest 最晚的 USAGE_REPORTS → **v3** SSO $500，11-16，pass；USAGE_REPORTS、CSV deferred → 评估、审批、执行 CO-0001 $500 |
| 8'b | （另一种结局）finance 选 `raise_cap_to_fit` | v5（cap 490000） | #3 negotiating | provider stub 起点 v2 在新约束下全部通过 → 原样再提 **v3**（"same terms as v2"），$4,900 ≤ $4,900 恰好在边界上通过 |
| 8'c | （第三种结局）三人都 decline | v4 | #2 **no_agreement** | 房间 phase idle；任何人可编辑约束后 `runs.start`（trigger manual） |

## 9. 由 fixture 推出的回归数字（16 直接引用，不另写常量）

| 用例 | 输入 | 期望 |
| --- | --- | --- |
| 边界 | committed 400000，cap 490000，提案 90000 | `budget.cap` pass（≤） |
| 余量恰好等于提案 | cap 475000，提案 SSO+lite 75000 | pass |
| 超出 | cap 480000，提案 90000 | OVER_BUDGET，overBy 10000（仅 finance 与获披露的 customer 可见） |
| 低于已承诺 | finance 确认 cap 390000 | `BUDGET_BELOW_COMMITTED`，状态不变 |
| Role A RA-B01 回归 | cap 480000，provider 新确认一行 CSV_EXPORT:lite $300、earliest 12-20，提案只含它 | REQUIRED_ITEM_MISSING + DELIVERY_AFTER_DEADLINE，不可批准 |
| Role A RA-B04 回归 | v3 被引用后 provider 把 REPORTS:lite 改为 $260 | bump；v3 `SOURCE_MISMATCH`，run superseded |
| 日期非法 | provider 行 earliest "2026-02-30" | `INVALID_DATE`，确认被拒（RA-B10） |
| fixture v1 双重失败 | 全量提案 | 同时报 OVER_BUDGET 与 DELIVERY_AFTER_DEADLINE（RA-F03 修正一） |
