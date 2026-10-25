# 01 产品（part3）：provider 与 finance 的完整旅程

## provider（Leo）

### P1 接受邀请

- 打开链接 `/invite/<token>` → `invites.preview`（action，按令牌哈希查邀请）显示：房间标题与共享目标、邀请人显示名、角色 "Provider"、该角色能做什么、**披露基线**："Everyone in the room sees your confirmed quote lines. Your minimum change value and private notes are visible only to you and your agent. Others only see whether a proposal meets your minimum (yes/no)."
- 点 "Join as Provider" → `invites.accept`。失败：`INVITE_EXPIRED`、`INVITE_USED`、`INVITE_REVOKED`、`ALREADY_SEATED`（同一用户已占本房间另一席位）。
- 写入：`seats`（filled，显示名快照）、`invites`（accepted）、`events: seat_joined`。

### P2 报价（共享清单）

- 看到：Quote 页签，按 customer 已确认的范围项分组。provider 可编辑，其他人只读。
- 做：为每个范围项添加报价行：`LOGIN` $450（标准 2026-11-20 / 加急 2026-11-13）、`REPORTS` $300（11-20 / 11-13）、`EXPORT` $500（11-27 / 11-20）；费用行 `EXPEDITE` $150；可选有效期 2026-12-15。点 "Confirm 4 lines"。
- 确认对话框："Confirmed quote lines are visible to everyone and can be used in proposals. Changing a price later creates a new version and invalidates approvals that relied on it."
- 调用：`lists.saveDraft` ×4 → `lists.confirm({roomId, listKey:"quote", itemKeys})`。写入 `listItems`、`constraintRevisions`、事件。

### P3 私密简报

- 字段：最低变更金额 $350（私密，规则字段）；私密备注 "Team can deliver two items before 11-20. Prefer phased delivery. No fixed price without confirmed scope."；共享说明 "Prefer phased delivery."
- 确认流程同 C4。

### P4 协商中 provider 看到什么

- 提案 v1 卡（provider 投影）："+$900 · Fits the finance limit ✓ · Includes the customer's required items ✓ · Meets the customer's date requirement ✓ · Meets your minimum ($350) ✓"。其中"日期要求"只显示结论，因为 customer 未披露截止日；不出现 "$4,900 committed" 或上限。
- "Your agent's notes"（只给 Leo）："Full scope (+$1,400) was blocked: exceeds the finance limit. Proposed LOGIN + REPORTS expedited instead." 被阻断候选的原因码只回给提出方本人和本方代理（07 第 7.6 节的有界推断披露）。
- Leo 点 "Accept terms of v1 (constraints v6)"。

### P5 预算下调时 provider 看到什么

- 横幅 "Finance updated their constraints (budget revision) · Constraints v6 → v7"；v1 徽章 "Blocked: exceeds the finance limit"；没有任何金额。自己的接受显示为 "no longer applies"。
- run 2 的代理笔记："Expedited options now exceed the finance limit; proposed standard delivery (−$150 vs v1)."

### P6 被点名的取舍请求（fixture 变体 B：上限降到 $4,400）

- 请求卡（只给 Leo）："No option fits the room's constraints with the current quote. You can help by adding a lower-priced or reduced-scope quote line for a required item. [Add a quote line…] [I can't offer anything else]"，附 "Also asked: Finance. Whichever change comes first resolves this request." 不出现预算数字。
- 点 "Add a quote line…" 打开报价编辑器，预置 "Variant of LOGIN"。Leo 填 `LOGIN_LITE`（Admin-only SSO）$380、标准 2026-11-18，确认。
- 结果：确认触发约束递增；Leo 的请求被标记 `answered`（关联到这次约束修订），发给 Finance 的同组请求变为 `superseded`；自动重新预检 → 有可行候选 → 新 run。

### P7 改价的副作用（边界体验）

- v2 等待审批时 Leo 把 `REPORTS` 改为 $350 并确认 → 对话框提前警告："Proposal v2 uses REPORTS v1. Confirming will block v2 and 2 approvals will no longer apply."
- 确认后：`REPORTS` v1 → superseded，v2 的来源检查失败（`SOURCE_SUPERSEDED`），被阻断并触发新 run。

### P8 执行后的任务

- Records 页签 "My tasks"：`LOGIN`（due 2026-11-20）、`REPORTS`（due 2026-11-20），状态 todo → in_progress → done（`records.updateTask`，只有被指派席位可改，写 `task_updated` 事件）。
- provider 看到的变更单：条款、交付日、任务；不显示预算影响。

## finance（Priya）

### F1 接受邀请

- 披露基线："Everyone sees whether a proposal fits your budget (yes/no). By default your budget cap and committed spend are visible to the customer side; you can change this in your brief. The provider never sees these numbers unless you choose to share them."

### F2 预算简报

- 字段：预算上限 $5,000（规则字段）；披露：上限 → Customer（默认）、已承诺总额（派生字段 `committedCents`）→ Customer（默认）；私密备注 "Q4 cap may be revised at the 11-05 budget meeting. Prefer milestone payments."
- 确认后约束递增。

### F3 台账基线

- Budget 面板 "Existing commitments" → "Add commitment"：标签 "Original SOW (Q3)"，$4,000。调用 `ledger.addBaseline`，写 `commitments`（kind baseline，fixture 中 isSimulated true）并递增约束版本。
- 首次执行之前可 "Void" 基线条目（`ledger.voidBaseline`，必须填原因，记录保留）；首次执行之后基线不可作废（v1 无冲销，17）。

### F4 审阅提案 v1

- finance 投影：完整预算分解与检查 "Within the budget cap ✓ · $100 headroom remains"；finance 代理笔记 "Recommend approving: fits with $100 headroom. Payment terms are outside this change; your milestone preference is noted."
- 按钮 "Approve budget commitment of +$900 (v1, constraints v6)"。Priya 决定等 11-05 预算会。

### F5 下调预算

- 点 "Update budget cap"：新上限 $4,800；公开原因码（`budget_revision` / `correction` / `other`）；私密说明 "Q4 revision from the 11-05 meeting"。
- 提交前的影响预览（`briefs.previewConfirm`，基于补丁计算）："Proposal v1 will be blocked (over by $100). 1 approval (Customer) will no longer apply. Feasible options exist; agents will renegotiate automatically."
- 调用：`briefs.quickUpdate({roomId, fieldPatch:{budgetCapCents:480000}, changeReason, publicReasonCode:"budget_revision", expectedConstraintsVersion:6})`。
- 守卫：新上限 < 已承诺 → `CAP_BELOW_COMMITTED`（已承诺不能在系统内撤销，核心 7）；期望约束版本不符 → `CONSTRAINTS_CHANGED`。
- 结果：见 09 第 9.4 节的完整时序。

### F6 批准并触发执行

- v2 上 customer、provider 已接受。Priya 看到 "Approving will execute: Change order CO-1 · Commitment +$750 · 2 tasks"。
- 点 "Approve budget commitment of +$750 (v2, constraints v7)" → `decisions.record` 返回 `{status:"executed", executionId}`；三个窗口同时显示 CO-1。

### F7 取舍请求（变体 B）

- 请求卡（只给 Priya）："No option fits the current budget. Raising the cap to $4,450 makes LOGIN (standard, +$450) possible; $4,750 makes LOGIN + REPORTS (standard, +$750) possible. [Raise to $4,450] [Raise to $4,750] [Keep $4,400]"。
- 选择一个上调选项 → `requests.answer` 在同一事务里以补丁生成 finance 简报新版本（公开原因码 `budget_revision`）→ 约束递增 → 同组请求 superseded → 新 run。选 "Keep $4,400" → `declined`。

### F8 台账视图

- `ledger.view`：基线 $4,000 + CO-1 $750 = 已承诺 $4,750；上限 $4,800；余量 $50。每条承诺可追溯到执行记录与签核。
