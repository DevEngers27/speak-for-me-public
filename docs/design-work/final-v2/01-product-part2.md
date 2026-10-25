# 01 · 产品（part2）：customer 的完整旅程

> 分片见 `01-product.md` 顶部。人物虚构：Maya（customer，Northwind 项目负责人）、Leo（provider，Studio Kite）、Priya（finance，Northwind 财务）。每步写：看到什么 → 做什么 → 调用（12）→ 写入（03）→ 失败码。失败码用 canon §1.5 的点分小写，鉴权 / 邀请 / 输入 / 请求类码取 12 的 `auth.*`、`invite.*`、`input.invalid`、`request.*`。约束版本号写成 `vC → vC+1` 的相对形式；14 的主走查中房间开放时 cv = 1，预算下调后 cv = 2。

## C1 建房

- 看到：`/rooms` 收件箱（空）与 "New room"。
- 做：在 `/rooms/new` 填房间标题 "Q4 analytics portal change"（≤ 80 码点单行，对房间成员可见，不进任何代理上下文）、场景 "Software scope change"、时区 `America/Los_Angeles`（建房后固定，D22）、"My role in this room: Customer"。不填任何预算（预算只由 finance 在自己的简报里确认）。
- 调用：`rooms.create({ scenarioKey: 'scope_change', title, timeZone, myRole: 'customer' })`。
- 写入：`rooms`（`status: 'setup'`、`localDate` 由 mutation 按时区计算、`scenarioVersion`、`createdBy`、`provenance: 'live'`）、`members`（Maya × customer）、`events`（`room_created`、`member_joined`，经 `events.append`）。
- 失败：`auth.unauthenticated` / `auth.user_not_provisioned`；标题不合规 `input.invalid`；建房节流 `run.rate_limited`。

## C2 邀请

- 做：People 面板点 "Invite Provider"、"Invite Finance"，默认填对方邮箱。
- 调用：`invites.create({ roomId, role, invitedEmail })`（mutation，无 token）。不知道邮箱时改用单次链接：`invites.createLink({ roomId, role })`（唯一公开 action）在 action 内生成随机 token、只存 `tokenHash`，链接 `/invite#t=…` 只在本次响应显示一次（token 在 fragment，不进服务器日志与 `redirect_url`，D24）。
- 看到：席位行 "Invite pending · expires in 72h"。
- 对方：Leo 登录后在收件箱看到 "Invitation: join as Provider"（`invites.listMine` 按**已验证邮箱**列出）→ `invites.accept({ invite: { by: "email", inviteId } })`。
- 失败：`invite.invalid`（过期 / 已使用 / 邮箱不符）、`invite.email_unverified`、`invite.seat_taken`、`invite.already_member`（D24 一人一房一席）。

## C3 私密简报与披露

- 看到：`/rooms/[roomId]/brief`。左侧结构化表单（v1 无"从文本抽取"，D26）；每个字段右侧是受众控件 "Visible to: only me and my agent / Provider / Finance"，**默认只给自己**；右栏 "What others can see from you" 由服务端按当前表单内容渲染投影预览。
- 做：`requiredItemKeys` 勾选 `sso_login`、`audit_log_export`（候选来自已确认目录——本走查中 Leo 已先完成 part3 P2 的目录确认；目录为空时显示 "Provider hasn't confirmed any catalog items yet"，customer 简报在目录确认前无法提交）；`deadline` 2026-11-20；软字段：偏好 `usage_dashboard`、`slack_alerts`，偏好日期 2026-11-18；`notes` "Usage dashboard should be live before the 11-24 board review; Slack alerts can wait."；按 14 的主 fixture 把 `requiredItemKeys` 与 `deadline` 披露给 Provider 与 Finance、偏好条目只披露给 Provider（其余默认只给自己）。
- 草稿：只在浏览器内存（canon：草稿不入库）；离开页面有未确认提示。
- 调用：`briefs.confirm({ roomId, expectedConstraintsVersion, hardFields, softFields, disclosures })`。硬投影变化时同事务 `constraints.bump`（D05）；披露与软字段变化不 bump。
- 写入：`briefs` 新版本 `(roomId, 'customer', version)` + `confirmedBy`；`sharedFacts`（被披露字段，值只能是日期 / itemKey[] / 枚举）；必要时 `rooms.constraintsVersion` + 约束修订记录；`events: brief_confirmed`（只含角色、版本号与 `hardChanged` 布尔，无字段值，03 §3.11.1）。
- 失败：`date.invalid` / `date.in_past` / `date.out_of_range`（`localDate ≤ d ≤ localDate + 365`，D12 ⑧）；`item.duplicate`、`input.invalid`；`version.stale_constraints`（期间约束已变）；约束变更类写入超过每用户每房间每小时 6 次 → `run.rate_limited`；房间已 `executed` / `closed` → `run.invalid_state`。

## C4 等待他方

- 看到：Setup 清单 "Provider: brief not confirmed"（目录已确认）、"Finance: brief confirmed ✓"；他方简报只显示 "brief v1 confirmed 10:42"，不显示内容；"Shared with you" 列出别人披露给 Maya 的事实，例如 "Budget cap $5,000 (shared by Finance)"（fixture 中 finance 只打开 `capCents` 开关，U1）。
- 收件箱：该房间在 "Waiting on others" 分区，卡片写 "Waiting on Provider: confirm brief"（`rooms.listMine` 服务端按查看者计算）。

## C5 第一个提案出现

- 触发：最后一个就绪条件满足（本走查中是 Leo 的简报确认，即第三份简报）的**同一事务**内，`openIfReady` 打开房间并开首个 run（cause `room_opened`，D12 修正草稿）。串行回合（D08）：provider propose → customer evaluate → finance evaluate。
- 看到（实时，无需刷新）：右栏 run 进度 "Round 1 · Provider's agent drafting → Your agent reviewing → Finance's agent reviewing"。随后中栏出现提案卡：
  - "Proposal v1 · drafted by Provider's agent"、状态 "Ready for approval"；
  - 条款："SSO login + Audit log export + Usage dashboard · delivery 2026-11-18 · +$900"；明细行来自目录 revision 快照（$500 / $300 / $100）；
  - 检查（customer 投影）："Includes your required items ✓"、"Delivered by your deadline (2026-11-20) ✓"、"Checked against constraints vC"；finance 的预算检查对 Maya 是掩码检查，**通过时省略**；
  - 虚线框 "Your agent suggests accepting — the dashboard lands 6 days before your board review. Suggestion only, never counted as approval."（`rationale` 只给本方）；
  - 审批面板：Customer pending · Provider pending · Finance pending；
  - "Approving creates: 1 change order · a +$900 budget commitment · N tasks"（N 来自目录 `taskTemplates` 快照 `plannedTasks`；+$900 是公开目录价之和，不泄露预算）。

## C6 接受条款

- 做：点 "Accept terms of v1 under constraints vC"。
- 调用：`approvals.record({ proposalId, decision: 'approve', expectedConstraintsVersion: C, expectedTermsKey, reasonKey: null, note: null })`。
- 写入：`approvals` 追加一行（`seq`、`role`、`boundConstraintsVersion`、`boundTermsKey`）；`events: approval_recorded`（角色、决定、版本，不含 note）。
- 返回：`{ status: 'recorded', missingRoles: ['finance'] }`；双击 → 第二次 `{ status: 'unchanged' }`，不插行。
- 失败：期间约束或条款已变 → `approval.stale`，整笔不写；提案已被取代 → `approval.not_current`；纵深防御 `approval.not_executable`（正常路径不触发）；提案已执行时再点 approve 返回 `{ status: 'executed', alreadyExecuted: true }`，其他决定返回 `approval.already_executed`。

## C7 Finance 下调预算时 Maya 看到什么

- 触发：Priya 把上限从 $5,000 改为 $4,800（part3 F5）。
- 看到（同一次订阅推送，不等任何模型调用）：
  - 横幅 "Finance updated a budget constraint · Constraints vC → vC+1"，因为 `capCents` 已对 Maya 披露，横幅附 "Budget cap $5,000 → $4,800"（D14 的 customer 渲染变体）；
  - v1 徽章变 "No longer current · constraints changed"（提案 `stale`，退为历史提案：只显示存储状态、不重算检查，12 `proposals.get`、13 §13.9.2）；
  - 自己的审批槽 "You approved v1 under constraints vC · No longer applies"（`stale_approve`，旧行保留可查）；
  - run 进度显示新 run 已自动开始（D06：旧 run `superseded`，新 run 预检后 `negotiating`）。

## C8 新提案与重新接受

- 看到：v2 "SSO login + Audit log export · delivery 2026-11-16 · +$800"（14 主线：新 run 剔除已被阻断的 $900 候选后，provider 快照只剩这一项，由 provider 代理提出；恰等于余量）；与 v1 的结构化差异 "Removed Usage dashboard · Delivery 2026-11-18 → 2026-11-16 · −$100"；Maya 自己的视图额外显示 "Not included: Usage dashboard (one of your preferences)"——这是她的投影现算的，不是提案条款，他方看不到（D11）；虚线框 "Your agent suggests accepting — required items arrive 4 days before your deadline; the dashboard was a preference."
- 做：Accept v2（同 C6，`expected*` 取自当前 `rooms.view`）。

### C8b 分支：轮次用尽，由 Maya 亲自选

- 若 3 轮后没有全体 `recommend_accept` 的合格提案，代码给 Maya 开 `humanRequest(kind: 'rounds_exhausted')`：选项 `choose_candidate`（只列 **Maya 视图下**可行的候选，例如 "(A) SSO + Audit, by 2026-11-16, +$800"）/ `keep_as_is`（"Give the agents one more round"，每 run 最多 1 次）/ `end_run`（"End without agreement"）。
- 选 A：`humanRequests.answer({ requestId, optionKey })` → 服务端用全视图复核；通过 → 插入 `origin: 'human_choice'` 的提案，run `needs_input → pending_approval`；Maya 仍需像 C6 一样显式批准（回答不等于批准）。复核不通过 → 返回 `{ outcome: 'regenerated' }`，按 Maya 的视图重开请求，她看到 "That option no longer fits the room's private constraints."
- 选 `end_run`：run `ended_no_agreement`，界面正面展示未达成（part1 §1.6）。

### C8c 分支：他方代理请求澄清（变体：Maya 没有披露截止日时）

- provider 代理 `clarify { toRole: 'customer', topicKey: 'deadline_value' }`（14 §3 话题表）且代码判定不可代答 → Maya 收到 `humanRequest(kind: 'clarify')`："Provider's agent asks about your delivery deadline. If you share, Provider and their agent will see: 2026-11-20." 选项 `disclose { field: 'deadline', toRoles: ['provider'] }` / `keep_as_is`（"Don't share"，发问方同轮重开回合）/ `end_run`（每个请求都以 `end_run` 收尾，04 H1）。
- 选择披露 → 写 `sharedFacts`，run 回到 `negotiating` 继续（披露不 bump，D05）；不披露 → 同一 run 内该话题不再问。

## C9 拒绝

- 做：在 `pending_approval` 的提案上点 "Reject"，从场景封闭枚举选 `reasonKey`（例 `scope_insufficient` / `too_late` / `too_expensive` / `other`），可写只给自己看的 `note`（不进任何代理上下文与事件，D13）。
- 调用：`approvals.record({ proposalId, decision: 'reject', expectedConstraintsVersion, expectedTermsKey, reasonKey, note })`（`reasonKey` 必须属于场景枚举，`note` ≤ 500 码点，否则 `input.invalid`）。
- 结果：提案 `rejected`（对该提案终局，不能撤回拒绝）；run 回到 `negotiating` 进入下一轮，轮次已尽则 `needs_input`（rounds_exhausted 请求）。被拒提案不会因后续约束变化"复活"（D06）。

## C10 撤回

- 做：执行前点 "Withdraw my approval of v2"。
- 调用：`approvals.record({ ..., decision: 'withdraw' })`；只能撤回本人的 approve。
- 结果：槽位回到 `pending`，显示 "Approval withdrawn 10:58"；最后一票若已执行，撤回入口消失（执行与最后一票同事务，没有"已全签未执行"的窗口）。

## C11 执行结果

- 触发：最后一个必需审批（通常是 finance）在同一 mutation 内 `executions.executeIfComplete`。
- 看到：头部 "Executed · Change order CO-1"；Results 页：冻结的条款与明细行、执行时间、Execution ID（`exec:<proposalId>`，只作追溯展示）；审批记录区分 "Used for execution"（来自 `executions.approvalIds` 快照）与 "No longer applies"（v1 的旧审批）；任务（assignee Provider，due 2026-11-16）；声明 "Internal record only. No payment, transfer, or signature happens in Speak for Me."；预算影响（AIA G701 金额链）只按披露显示：Maya 只看到 "Budget cap $4,800"，看不到已承诺前后值。
- 追溯：从 CO-1 可点开所用的三条审批、目录 revision、约束修订记录（谁、何时、因何改变），因果链由事件派生（13）。

## C12 后续变更（新房间）

- 季度后 Maya 需要 `slack_alerts`：在已执行房间点 "Start a follow-up change"。
- 调用：`rooms.startFollowUp({ executionId })`（D04）。
- 结果：新房间 `followsExecutionId` 指向 CO-1；同三位成员的席位已预分配（无需重新邀请）；provider 目录中**未交付**的条目（不在 CO-1 `terms.itemKeys` 里的行）复制为 `draft`，需 Leo 重新确认，已交付的 `sso_login` / `audit_log_export` 不复制，只读显示 "Delivered in CO-1"（canon D04、12 §12.6）；Maya 与 Priya 各自重新确认简报（Maya 把 `slack_alerts` 设为必需）；finance 的基线预填 "旧房间执行后 committedAfterCents（$4,800）"，必须由 Priya 经 `ledger.recordBaseline` 确认。旧房间保持 `executed` 只读，其中任何写入返回 `run.invalid_state`；已交付条目在新房间既不能被 Leo 重新上架（`catalog.confirm` → `item.duplicate`），也不能被 Maya 设为必需项（不属于本房间确认过的目录键 → `item.unknown`），因此不会被重复承诺。修订或冲销已执行的变更单不在 v1（17）。
