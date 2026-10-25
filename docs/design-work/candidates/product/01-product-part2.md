# 01 产品（part2）：customer 的完整旅程

> 人物均为虚构：Maya（customer，Northwind 项目负责人）、Leo（provider，Studio Kite）、Priya（finance，Northwind 财务）。每步写明：看到什么 → 做什么 → 调用的函数（12）→ 写哪些表（03）→ 可能失败的地方。

## C1 建房

- 看到：`/rooms` 空列表与 "New room" 按钮。
- 做：填写 title "Q4 analytics portal change"、goal（共享说明）、scenario "Software scope change"、time zone `America/Los_Angeles`、"My role in this room: Customer"。
- 调用：`users.ensureMe` → `rooms.create({scenarioKey:"scope_change", title, goal, timeZone, myRoleKey:"customer"})`。
- 写入：`rooms`（constraintsVersion 0、negotiationOpen true）、`seats` ×3（customer 席位 filled）、`briefDrafts` ×3（每席位一份空草稿）、`events: room_created, seat_joined`。
- 失败：未登录 → `UNAUTHENTICATED`；超过每日建房上限 → `RATE_LIMITED`（15）。
- 结果：跳到房间的 Setup 清单（每个席位一行：待邀请 / 简报未确认 / 清单未确认）。

## C2 邀请

- 做：在 Seats 面板点 "Invite Provider"、"Invite Finance"。
- 调用：`invites.create({roomId, seatId})`（action，生成随机令牌，只存哈希）。链接只在本次响应里显示一次，可复制。
- 看到：席位卡显示 "Invite pending · expires 2026-11-09"，可 "Revoke"（`invites.revoke`）。
- 说明：邀请绑定席位（角色由邀请决定，接受者不能自选角色）；邮件发送是扩展点（17），v1 由房主自行转发链接。

## C3 范围清单（共享）

- 看到：Scope 页签，customer 可编辑，其他人只读。
- 做：添加 `LOGIN`（SSO login revamp）、`REPORTS`（Usage reports dashboard）、`EXPORT`（Data export），点 "Confirm 3 items"。
- 调用：`lists.saveDraft` ×3 → `lists.confirm({roomId, listKey:"scope", itemKeys:[...]})`。
- 写入：`listItems`（status confirmed，version 1）、`constraintRevisions`（一次批量确认只递增一次约束版本）、`events: list_items_confirmed, constraints_changed`。
- 说明：范围项一经确认即全房间可见；修改 = 新版本（旧版本 superseded），并递增约束版本。

## C4 私密简报与披露

- 看到：My brief 页签。左侧表单（场景 UI 片段）：必需范围项（从已确认范围清单勾选）、硬截止日、偏好日、私密备注、共享说明；每个字段右侧有披露控件 "Visible to: only me and my agent / Provider / Finance / Everyone"。右侧栏 "What others will see"，由服务端按当前草稿生成预览。
- 做：勾选 `LOGIN` 为必需（默认披露给全房间）；硬截止日 2026-11-23（默认私密）；偏好日 2026-11-13（私密）；备注 "Reports must be live before the 11-24 board review; export can wait until Q1. Earlier delivery is nice-to-have."；共享说明 "We need SSO first; export can wait."
- 调用：输入时 `briefs.saveDraft`（防抖自动保存，带 `basedOnVersion` 乐观并发）；点 "Confirm brief" 前 `briefs.previewConfirm` 返回影响分析（"This changes rule fields: requiredItemKeys, hardDeadline. Constraints will move from v1 to v2."）；确认 `briefs.confirm`。
- 写入：`briefVersions` v1（不可变）、`constraintRevisions`、`events: brief_confirmed`（只含席位、版本号、`ruleChanged: true`，不含任何字段值）。
- 失败：草稿在别的标签页被改过 → `STALE_DRAFT`，界面提示刷新；必填项缺失 → `BRIEF_INCOMPLETE` 并高亮字段。
- 可选：在 "Draft from text" 框粘贴需求邮件 → `briefs.extractDraft`（action）返回结构化建议，逐字段标 "Suggested from your text — review"，只填进草稿，不保存原文，确认前不生效。

## C5 等待他方

- 看到：Setup 清单 "Provider: quote not confirmed"、"Finance: brief confirmed ✓"；他方简报只显示 "brief v1 confirmed 10:42"，不显示内容；已披露给我的共享事实单独列出（例如 Finance 默认把预算上限披露给 customer："Budget cap $5,000 · Committed $4,000"）。
- `/rooms` 列表上的 "Your turn" 徽章由服务端按查看者计算（`rooms.listMine`）。

## C6 第一个提案出现

- 触发：最后一项就绪条件满足的那个 mutation 递增约束版本，调度 `negotiation.afterConstraintChange`，就绪检查通过 → 开 run 1（trigger `ready`）。
- 看到（实时，无需刷新）：代理进度条 "Provider agent drafting… → Customer agent reviewing · Finance agent reviewing"。随后出现提案卡：
  - 标题 "Proposal v1 · by Provider's agent"，徽章 "Ready for approval"；
  - 条款："LOGIN + REPORTS · expedited delivery by 2026-11-13 · +$900 · EXPORT deferred"；明细行：LOGIN $450、REPORTS $300、Expedite fee $150（引用报价 v1）；
  - 买方预算行："+$900 change · $4,900 committed after approval · $5,000 cap · $100 headroom"；
  - 检查清单（按 customer 投影）："Includes your required items ✓"、"Meets your hard deadline 2026-11-23 ✓"、"Within the budget cap ✓"、"Matches confirmed quote v1 ✓"、"Checked against constraints v6"；
  - "Your agent recommends accepting"，展开为只给 Maya 看的 rationale；
  - 签核面板：Customer pending · Provider pending · Finance pending；
  - "Approving creates"：变更单 CO-1、预算承诺 +$900、任务 LOGIN（due 11-13）、REPORTS（due 11-13）。

## C7 接受条款

- 做：点 "Accept terms of v1 (constraints v6)"。
- 调用：`decisions.record({proposalId, kind:"approve", expectedConstraintsVersion:6, expectedTermsKey})`。
- 写入：`decisions`（追加）、`events: decision_recorded`。
- 失败：期间约束已变 → `CONSTRAINTS_CHANGED`，整笔不写入，界面刷新并解释；双击 → 第二次返回 `already_recorded`，不新增记录。

## C8 预算下调时 customer 看到什么

- 触发：Priya 把上限改为 $4,800（part3 F6）。
- 看到（三个窗口同一时刻翻转，不等模型）：
  - 横幅 "Finance updated their constraints (budget revision) · Constraints v6 → v7"；
  - 提案 v1 徽章变为 "Blocked"；预算检查 "Over the cap by $100: $4,900 committed after approval vs $4,800 cap"；
  - 签核面板中自己的状态 "You accepted v1 under constraints v6 — no longer applies"（`stale_approve`），旧记录保留可查；
  - 代理进度条显示 run 2 已自动开始（trigger `constraints_changed`）。

## C9 新提案与重新接受

- 看到：提案 v2 "LOGIN + REPORTS · standard delivery by 2026-11-20 · +$750 · EXPORT deferred"；与 v1 的结构化差异："Delivery 2026-11-13 → 2026-11-20 · Expedite fee removed · Cost −$150"；买方预算行 "+$750 · $4,750 after approval · $4,800 cap · $50 headroom"；"Your agent recommends accepting — REPORTS goes live 4 days before your board review; the earlier date was a nice-to-have."
- 做：接受 v2。

### C9b 分支：代理请本人做选择（偏好请求）

- 若 Maya 的备注没有说清"报表 vs 早交付"，customer 代理返回 `reject`（附建议候选），代码生成 `preference` 请求，只发给 Maya：
  "Your agent needs your call. (A) LOGIN + REPORTS, standard by 2026-11-20, +$750 · (B) LOGIN only, expedited by 2026-11-13, +$600, REPORTS deferred · [Choose A] [Choose B] [None of these]"。每个选项展开显示完整条款与检查结果。
- 选 A：`requests.answer({requestId, optionKey:"A", alsoApprove:true})` → 同一事务创建人提出的提案 v2（authorKind `human`，作者 "Customer (Maya)"）并记录 Maya 对 v2 的接受；其余两方只需审批。
- 选 "None of these"：请求关闭为 `declined`；当前提案仍在，Maya 可以用拒绝表达态度。

### C9c 分支：他方请求披露

- provider 代理用 `clarify` 询问截止日。Maya 收到披露请求："Provider's agent asks for your delivery deadline. If you share, Provider and their agent will see: Hard deadline 2026-11-23. [Share with Provider] [Share with everyone] [Don't share]"。
- 选择共享 → 生成简报新版本（只改披露，不递增约束版本）→ 新 run（trigger `request_answered`）。选择不共享 → 请求 `declined`，同一约束版本内该话题不会再被问。

## C10 拒绝

- 做：在 v2 上点 "Reject"，选择原因码（`SCOPE_INSUFFICIENT` / `TOO_LATE` / `TOO_EXPENSIVE` / `OTHER`），可写只给自己代理看的备注。
- 结果：`decisions` 追加 reject；调度 `negotiation.afterRejection` → 排除本约束版本内被拒的候选后，若仍有可行候选则开新 run，否则生成取舍请求。房间不会停在无出路的状态。

## C11 执行结果

- 触发：最后一个必需签核（通常是 finance 的预算批准）在同一事务内执行。
- 看到：工作台顶部 "Executed · Change order CO-1"；Records 页签：冻结的条款、执行时间、操作键 `exec:<proposalId>:7`；买方预算影响（执行时快照）"Before $4,000 → After $4,750 · Cap $4,800"；任务列表（assignee Provider，due 2026-11-20）；声明 "Internal record only. No payment, transfer, or signature happens in Speak for Me."
- 追溯：从 CO-1 可点开所用的三条签核、报价版本、约束 v7 的修订记录（谁、何时、因何改变）。

## C12 后续变更

- 季度后 Maya 需要 `EXPORT`：在工作台点 "Start a follow-up change" → 修改简报把 `EXPORT` 设为必需 → `negotiation.requestRun`。同一房间开新 run，版本号接续，台账已包含 CO-1 的 $750。修订已执行的变更单（撤销或改金额）不在 v1（17）。
