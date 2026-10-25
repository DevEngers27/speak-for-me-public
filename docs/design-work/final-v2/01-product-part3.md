# 01 · 产品（part3）：provider 与 finance 的完整旅程

> 分片见 `01-product.md` 顶部。记法同 part2。

## provider（Leo）

### P1 接受邀请

- 看到：收件箱 "Invitation: join 'Q4 analytics portal change' as Provider"（或单次链接 `/invite#t=…`，邀请页不调 `auth.protect()`、`Referrer-Policy: no-referrer`）。邀请页列出：房间标题、邀请人显示名、角色、该角色能做什么，以及**披露基线**："Everyone in the room sees your confirmed catalog lines (title, price, lead time). Your notes are visible only to you and your agent. For every proposal you will only see whether it fits the room's private constraints — yes or no — never why or by how much."
- 调用：`invites.accept`（单一写入口，含一人一房一席检查）。
- 写入：`members`（Leo × provider）、`invites`（accepted）、`events: member_joined`。

### P2 报价目录

- 看到：My brief 页的 Catalog 区块（只有 provider 可编辑；他方只读看到已确认行）。
- 做：录入并确认 5 项：`sso_login` "SSO login" $500 / 11 天、`audit_log_export` $300 / 14 天、`usage_dashboard` $100 / 16 天、`slack_alerts` $250 / 25 天、`custom_theme` $250 / 32 天（合计 $1,400）；每项可带 `taskTemplates`；可选 `kind: 'modifier'` 的 `rush`（是否整单计费由 14 定，D25）。
- 确认对话框："Confirmed lines are visible to everyone in the room and can be used in proposals. Changing a price or lead time later creates a new revision and invalidates approvals that relied on it. Editing only a title or task template does not."
- 调用：一次 `catalog.confirm({ roomId, expectedConstraintsVersion, rows })` 确认整批（12 §12.12 的唯一签名：`rows` 1–14 行，每行 `{ itemKey, kind, title, priceCents, leadDays, taskTemplates }`；一批只计一次约束写入节流，单行也传 `rows: [row]`）；下架用 `catalog.retire`。setup 阶段的确认不计 cv（房间开放时 cv 才从 1 开始，见 14）。
- 写入：`catalogItems` 新 revision（`status: 'confirmed'`）；价格 / 工期 / 增删 / 下架改变硬投影 → `constraints.bump`；`events: catalog_item_confirmed`（`items[{ itemKey, kind, revision, priceCents, leadDays }]` 与 `priceChanged`，标题不进 payload，03 §3.11.1）。
- 失败：`amount.out_of_range`（`assertCents`）；标题不合规（≤ 80 码点、`^[^<>\r\n]+$`）→ `input.invalid{field:"title"}`；格式合法但 NFKC 归一后含定界词（如 `untrusted_data`、`turn_instruction`）→ `disclosure.blocked{field:"title"}`（06 §4、12 §12.12 ⑤）；`version.stale_constraints`；`run.rate_limited`（约束变更类写入节流）；房间已执行 → `run.invalid_state`。

### P3 私密简报

- 字段：v1 provider 的硬字段只有目录（D05）；软字段 `notes` "Team can deliver two items before 11-20. Prefer phased delivery."（只进本方代理上下文）。
- 调用：`briefs.confirm`（只改软字段，不 bump）。

### P4 协商中 provider 看到什么

- 提案卡（provider 投影）：条款与价格（公开目录价之和）；一行 fit 信号 "Fits the room's private constraints ✓"（`fit: 'ok'`）——**没有 reasonCode、没有 checkId、没有任何预算数字或"超出多少"**；审批面板（审批行对房间可见）；折叠的 "Your agent's notes"（本方 `rationale`）。
- 做：点 "Accept terms of v1 under constraints vC"（`approvals.record`，同 C6）。

### P4' provider 只见 ok / blocked 的产品含义（U2 默认）

| 方面 | 含义 |
| --- | --- |
| 能知道什么 | 每个提案最多 1 bit："能否继续"。分不出是预算、截止日还是必需项挡住了它（D12 ①）。历史提案对 provider 只显示 `superseded / rejected / executed / current`，不显示它在当前约束下的实时重算结论 |
| 被挡住时代理能做什么 | 只收到 "blocked"；下一轮快照剔除 `excludedCandidateKeys(run)`（本 run 已提出过——含被阻断——∪ 被人拒绝 ∪ 复核失败的候选，D10）；provider 代理每 run 至多 4 次 `propose / counter`（D12 ⑤），`clarify` 不提供 `option_fits_constraints` 话题（D12 ③） |
| 人能做什么 | 改自己的目录（降价、加更便宜或更快的条目）；该写入照常 bump 并重新预检，但受每用户每房间每小时 6 次节流（D12 ⑥）；provider 调 `rooms.previewChange`（`kind: "catalog"`）只得到 `recheck`（下一个约束版本号、将失效的审批数、是否取代当前 run，12 §12.17），拿不到"改后是否可行"（D12 ②）；改价批次另受 `price_writes` 桶限制（每房间每 24 小时 ≤ 3 批，07 §7.13） |
| 等待时看到什么 | `needs_input` 对 provider 只投影为 "Waiting on others"（`run_waiting`，无 kind、无 toRole，D12 ⑦） |
| 为什么这样定 | 评委在 9 份候选里构造出 20+ 条"provider 零成本二分出预算余量"的反例（改价 → 预检 → 观察是否无解；预览 query；候选集按预算过滤；历史提案实时重算）；spike C4 实测 itemKey、日期、`budget.over` 各泄露约 1 bit |
| 代价与缓解 | provider 有时不知道该怎么改；收敛可能慢一轮。缓解：customer 代理用 `counter` 指出可行方向（customer 看得到自己的约束）；首发候选由代码给出（卖方视图下金额最低的含必需项候选）；轮次用尽时 customer 可 `choose_candidate` |
| 备选 | U2：给 provider 原因类别（预算 / 范围 / 日期）但不带参数——隐私更差、收敛更快，由用户拍板 |

### P5 预算下调时 provider 看到什么

- 横幅 "Constraints changed · Constraints vC → vC+1"（D14 的 provider 渲染变体：没有"谁改了什么"、没有金额）；v1 徽章 "No longer current"；自己的审批 "You accepted v1 under constraints vC · No longer applies"；run 进度显示新 run。全程没有任何金额。

### P6 被点名的请求：代理失败

- 情形：新 run 的 provider 回合两次 attempt 都失败（超时 / 无效输出），按上限转 `needs_input` + `humanRequest(kind: 'agent_failed', toRole: 'provider')`（D15，不再有 `paused`）。
- 只给 Leo 的卡片："Your agent couldn't finish its turn (timed out twice). No partial result was saved. [Retry my agent's turn] [End negotiation without agreement]"（`retry_turn` / `end_run`）。
- 其他人：customer / finance 看到 "Waiting on Provider"；provider 自己当然看到卡片。
- 回答：`humanRequests.answer({ requestId, optionKey })`（或别名 `runs.retryTurn({ runId })`）→ `retry_turn` 新 attempt、run 回到 `negotiating`；`end_run` → `ended_no_agreement`。7 天未答 → `expired` → `ended_no_agreement`，通知 creator（站内待办）。

### P7 改价的副作用（边界体验）

- v2 等待审批时 Leo 把 `audit_log_export` 从 $300 改为 $350。确认对话框用 `rooms.view` 已有数据提前警告："Proposal v2 uses Audit log export rev 1. Confirming creates constraints vC+2. 2 approvals on v2 will no longer apply, and agents will re-check the current proposal."（不预测"改后是否可行"）。
- 确认后：`constraints.bump` → 旧 run `superseded`、v2 `stale`；新 run 预检发现 v2 的 `lines[].revision` 与当前目录不符（`version.stale_source`，D25）→ 不保留 → `negotiating`。若 Leo 只改标题：不 bump，v2 不受影响（提案快照了 `lines[].title`）。

### P8 执行后的任务

- Results 页 "My tasks"：SSO login、Audit log export（due 2026-11-16），状态 `open → done`，只有被指派人可勾选（`tasks.markDone({ taskId })`，D04 下执行后唯一允许的业务写入之一），写 `events: task_completed`（03 §3.11.1）。
- provider 看到的变更单：条款、交付日、任务、Execution ID；**不显示**预算金额链。

## finance（Priya）

### F1 接受邀请

- 披露基线："Your budget cap and committed spend are private to you by default. You can share the cap, the committed total, or the remaining headroom with the Customer — each separately. The Provider never sees any budget numbers; it only sees whether a proposal fits."

### F2 录入基线

- Budget 区块 "Existing commitments" → $4,000（"Original SOW (Q3)" 只是本方备注）。
- 调用：`ledger.recordBaseline({ roomId, amountCents: 400000 })`，只在 `setup` 阶段、只录一次（可为 0）。
- 写入：`ledgerEntries(kind: 'baseline')`（seed 房间为 `provenance: 'seeded'`）；`committedCents` 从此按 `Σ amountCents` 现算，不存计数器。
- 失败：非 setup 或已录过不同金额 → `run.invalid_state`（相同金额返回 `unchanged`）；finance 已确认上限且基线大于上限 → `budget.below_committed`；`amount.out_of_range`。

### F3 预算简报

- 字段：`capCents` $5,000（硬）；字段级开关：`capCents → Customer` 打开、`committedCents`、`headroomCents` 关闭（fixture，U1）；`notes` "Q4 cap may be revised at the 11-05 budget meeting."（只本方）。
- 调用：`briefs.confirm` → 硬投影变化 → `constraints.bump`。
- 守卫：`capCents < committedCents` → `budget.below_committed`，错误 `params.minAllowedCapCents` 只给 finance，不 bump、不写事件（D23）。

### F4 审阅 v1

- finance 投影："+$900 change · committed $4,000 → $4,900 after approval · cap $5,000 · $100 headroom left"；检查 "Within the budget cap ✓"；customer 已向 finance 披露必需项与截止日（14 主 fixture），所以 finance 看到全部检查；若 customer 未披露某字段，对应检查对 finance 是掩码检查（通过则省略）。
- 虚线框 "Your agent suggests approving — fits with $100 headroom."
- 按钮 "Approve budget commitment of +$900 for v1 under constraints vC"。Priya 决定等 11-05 的预算会（v1 此时已有 customer、provider 两条 approve）。

### F5 下调预算

- 做：点 "Change budget cap"（同一控件可上调），输入 $4,800。
- 影响预览（`rooms.previewChange({ roomId, change: { kind: "cap", newCapCents: 480000 } })`，形状以 12 §12.17 为唯一定义；首个场景只有 finance 改上限时能看到全部规则输入，所以只对她返回 `after` 分支，且只回答**当前提案**在新上限下的预算检查，不回答"是否还有可行方案"，D12 ②）：`{ verdict: "after", nextConstraintsVersion: C+1, invalidatedApprovals: 2, willSupersedeRun: true, verdictAfter: { proposalVersion: 1, budgetCheck: "budget.over", overByCents: 10000 } }` → "Constraints become vC+1. Proposal v1 will no longer fit the budget (over by $100). 2 approvals (Customer, Provider) will no longer apply. Agents will renegotiate automatically."
- 调用：`budget.setCap({ roomId, capCents: 480000, expectedConstraintsVersion: C })` → 新 finance 简报版本 → `constraints.bump` → D06 链（旧 run `superseded`、v1 `stale`、审批自然失效、open 请求 `superseded`、不动点内新 run 预检）。
- 失败：$3,900 → `budget.below_committed`（拒绝写入，不是可达状态；预览阶段即返回 `rejected` 分支）；`version.stale_constraints`；节流 `run.rate_limited`；房间已执行 → `run.invalid_state`。
- 边界变体：$4,799.99 → 写入成功；只含必需项的 $800 也 `budget.over`，无可行候选 → 见 F7。

### F6 最后一票触发执行

- v2（$800）上 customer、provider 已批准。Priya 看到 "Your approval completes the set — this executes now: 1 change order · budget commitment +$800 · N tasks."
- 调用：`approvals.record` → 同事务 `executions.executeIfComplete` → 返回 `{ status: 'executed', executionId, alreadyExecuted: false }`；三个窗口同一推送显示 CO-1。已承诺 $4,000 → $4,800，余量 $0（恰等于上限通过）。

### F7 取舍请求（$4,700 / $4,799.99 变体）

- 预检：只含必需项的 $800 也超出余量 → 新 run 直接 `needs_input`，**零模型调用**（D27）。按 `relaxationOrder = [customer.drop_items, finance.raise_cap]` 选第一个"按其自身视图存在可放松选项"的角色：customer 看不到已承诺额，她的视图里没有能证明可行的放松 → 请求发给 finance（D15）。
- 只给 Priya 的卡片（14 变体 A 的模板）："No option fits a $4,700 cap. The cheapest option (Audit log export + SSO login, $800) needs a cap of $4,800." [Raise to $4,800 · makes the $800 option possible] [Raise to $4,900 · makes the $900 option possible] [End without agreement]（`raise_cap { amountCents: 480000 }` / `raise_cap { amountCents: 490000 }` / `end_run`）。
- 回答：`humanRequests.answer({ requestId, optionKey })` → 返回 `applied`；请求先标 `answered`（`answeredBy`、`answerOptionKey`），再经同一入口 `constraints.bump`（约束修订记录的 `sourceRefs` 指向该请求，追溯不断链）→ 不动点内新 run。customer 看到 "Waiting on Finance"；provider 看到 "Waiting on others"。
- 转交（D15 `pass_to_next`）：若请求先发给 `relaxationOrder` 首位的 customer（例如阻断来自截止日、customer 自己的视图就能看到），卡片另带 [Pass to Finance]（`pass_to_next { toRole: 'finance' }`）：回答后 Finance 收到按**她自己视图**生成的 `infeasible` 请求（有 `raise_cap`，或只有 `disclose` 回退项与 `end_run`），run 仍 `needs_input`、不 bump；该出口是否出现只取决于位置，不暗示 Finance 那边是否卡住，每 run 每对角色至多转交一次（04 R21）。本变体的收件人 finance 是末位，没有转交项。

### F8 台账视图

- 只给 finance（customer 按开关）：基线 $4,000 + CO-1 $800 = 已承诺 $4,800；上限 $4,800；余量 $0；每条 `ledgerEntries(commit)` 可追溯到执行与所用审批；变更单金额链按 AIA G701：基线 → 已批准变更累计 → 本次前 → 本次增减 → 新额（08）。
