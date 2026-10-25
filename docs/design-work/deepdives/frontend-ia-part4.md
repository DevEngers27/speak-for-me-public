# 专题深潜：前端信息架构与视图模型（part 4：状态矩阵、取舍请求、审批版本显示、组件、可访问性）

> 接 frontend-ia-part3.md §3.6。

### 3.7 加载 / 错误 / 空状态 / 断线

**加载与认证**：

| 状况 | 判定 | 显示 |
| --- | --- | --- |
| Clerk 加载中 | `<AuthLoading>` | 顶栏骨架 |
| 未登录 | `<Unauthenticated>`（proxy 通常已跳转） | 登录按钮 |
| 已登录但 Convex 未接受 token | `useConvexAuth().isAuthenticated === false` 且 Clerk 已登录 | "Signed in, but the backend did not accept your session. See /setup."（F13.4；`ConvexProviderWithClerk` 会吞掉 token 错误） |
| query 加载中 | `useQuery` 返回 `undefined` | 区块骨架，保留布局高度，避免翻转时跳动 |
| query 返回 null | 非成员 / 不存在 / 未认证 | `NotAvailable` |
| query 抛错 | 默认 `useQuery` 把错误抛给错误边界 | 路由段 `error.tsx`：一句话 + "Try again"（`reset()`）；不显示错误详情 |
| 断线 | `useConvexConnectionState().isWebSocketConnected === false` 且 `hasEverConnected` | 顶部 `ConnectionBanner`："Reconnecting… Live updates are paused." 关键按钮 aria-disabled（D-FE-06）；数据保持最后一次结果并标"may be out of date" |

**mutation 错误码 → 界面**（错误统一 `ConvexError({ code })`，消息不带他方数值，F07.8）：

| code | 显示位置 | 文案 | 后续 |
| --- | --- | --- | --- |
| `STALE_VIEW` | 动作旁 + live 区 | "Constraints changed while you were reviewing. Review the current version before deciding." | 不重试；焦点移到提案卡标题 |
| `PROPOSAL_NOT_CURRENT` | 同上 | "A newer proposal replaced this one." | 同上 |
| `NOT_YOUR_TURN` / `ROLE_FORBIDDEN` | live 区 | "You can't do this in your role." | 记录为前端 bug（按钮本不应可用） |
| `REQUEST_CLOSED` | 请求卡 | "This request was withdrawn (constraints changed) or already answered." | 卡片随订阅消失 |
| `RUN_BUSY` | RunStatusPanel | "Agents are already working on this round." | — |
| `RATE_LIMITED` | live 区 | "Too many requests. Try again in a minute." | — |
| `VALIDATION_FAILED` | 表单字段 | 字段级 `fieldErrors`（由服务端返回字段名与规则码） | 焦点移到第一个错误字段 |
| `BUDGET_BELOW_COMMITTED` | finance 预算表单 | "The cap can't be below committed spend ($4,000)."（只有 finance 能触发、也只返回给 finance） | — |
| 其他 / 非 ConvexError | live 区 | "Something went wrong. Nothing was changed." | 生产环境隐藏原消息 |

重复决定不是错误：`decide` 对同一 `(proposalId, user)` 同一决定幂等返回 `{ ok: true, alreadyRecorded: true }`，界面显示与首次一致。

**空状态**（按阶段，不编造）：

| 位置 | 条件 | 文案 |
| --- | --- | --- |
| `/rooms` | 无房间 | "You're not in any rooms yet. Ask a room owner for an invite link." + 可创建者看到"Create a room" |
| 工作台提案区 | phase=setup | "Waiting for briefs: 2 of 3 confirmed. Negotiation starts when every required brief and the budget are confirmed." + 未确认的角色名 |
| 工作台提案区 | phase=negotiating 且无提案 | "Agents are negotiating (round 1). The first proposal appears here." |
| TodoList | 空 | "Nothing needs you right now. Waiting on: Provider (decision on v3)." |
| Transcript | 0 条 | "No agent messages yet. Messages appear only when agents actually send them."（RA-U07） |
| Results | 无执行 | "No executed agreement yet" + 阻断原因列表（来自 rooms.view.phaseReasonCodes 与审批槽位）+ 回工作台链接（RA 7.5） |
| SharedFacts | 0 条 | "No one has shared constraints with the room yet." |

### 3.8 被请求取舍时的交互

目标人视角（`requests[i].kind === "mine"`）：

1. 工作台顶部出现 `HumanRequestCard`，同时 `answer_request` 待办置顶，`/rooms` 卡片显示"Your input is needed"。
2. 卡片结构：标题（模板问题，例如"No option fits the current budget. How should we proceed?"）→ 上下文行（按受众模板：customer 看到"Required: LOGIN, REPORTS. Remaining budget: $800."，provider 看到"No confirmed offer covers the required items within the finance limit."）→ 选项单选组（`role="radiogroup"`），每项显示 label 与 consequences（例如"Constraints become v3 · Agents renegotiate · Current approvals no longer apply"）→ 主按钮"Continue"。
3. 选项 mode：
   - `apply`：若 `changesConstraints`，点 Continue 打开 `ConfirmConstraintChangeDialog`（同 3.6 步 2，影响来自 `constraints.previewChange`），确认后调用 `requests.answer({ requestId, optionKey, expectedConstraintsVersion })`；
   - `edit_brief`：Continue 变为链接"Open my brief"，跳到 `/rooms/[roomId]/brief#<editTarget>` 并高亮字段；请求在相关字段确认后由服务端关闭（09 / 05 定义关闭条件）；
   - `decline`：需要选择理由模板，提交后服务端按 05 决定后续（通常转给下一个目标或停止 run）。
4. 不提供"给代理写自由文本"的输入框（v1）：人的自由文本若进入代理上下文会成为新的注入与泄露通道；需要更细的表达时走编辑简报。
5. 有 `expiresAt` 时显示倒计时（客户端从 expiresAt 计算；到期由服务端调度的 mutation 关闭，query 内不读 `Date.now()`，§7 #5）。
6. 请求被关闭（约束变化、他人先解决、过期）时，订阅推送让卡片变为一行说明"This request was closed: constraints changed (v4)"，保留 10 秒后收起；若用户正在对话框中，对话框按 3.5 第 4 条处理。

非目标人视角（`kind === "waiting"`）：只显示"Waiting on Finance to choose how to proceed (opened 3 min ago)"。不显示问题与选项（选项可能含目标人的私密数字）。

### 3.9 审批的版本显示

1. **按钮文案带版本**："Accept terms of v3"（customer、provider）/ "Approve budget commitment for v3"（finance），kind 来自 `myDecision.kind`（F08.3）。按钮下固定说明："Your decision applies only to proposal v3 under constraints v2. An agent's suggestion never counts as approval."
2. **确认对话框**：列出将批准的条款摘要、"Checked against constraints v2"、RecordsPreview（"Approving will create: 1 change order, 3 tasks[, a $900 commitment]"），以及最后一个审批人看到"Yours is the last required approval. Records will be created immediately."（执行与最后一次审批同事务，F08.4）。
3. **拒绝**：必须选理由模板（可附自由文本，按 08 的可见性），说明"Rejecting starts renegotiation or asks someone for a trade-off"（RA-S06）。
4. **审批面板槽位**（ApprovalSlot）：

| state | 徽章 | 说明行 |
| --- | --- | --- |
| `pending` | "Pending"（灰，时钟图标） | "Has not decided on v3" |
| `approved` | "Approved"（绿，勾） | "Accepted v3 under constraints v2 · 10:42" |
| `rejected` | "Rejected"（红，叉） | "Rejected v3 · Reason: Delivery too late" |
| `stale_approved` | "No longer applies"（琥珀，划线勾） | "Accepted v2 under constraints v1 · constraints changed" 或 "· newer proposal v3" |
| `stale_rejected` | "No longer applies"（琥珀） | "Rejected v2 under constraints v1 · …" |

   面板标题写明"Approvals for proposal v3 under constraints v2"。所有颜色同时配文字与图标。
5. **代理建议的位置**：只在 ProposalCard 内的 `AgentSuggestionNote`（本方可见，默认折叠，标题"Your agent's view"，机器人图标，说明"Suggestion only — not an approval"）。它不出现在 ApprovalPanel、不出现在 /rooms 卡片、不影响任何徽章颜色（I-FE-8）。transcript 中他方代理的 recommend_accept 以模板呈现，例如"Provider's agent suggests accepting v3."（措辞由 05 定），旁边同样标"Suggestion".
6. **历史中的审批**：Results 页的 DecisionRecord 列出全部决定（含旧拒绝、改判），标签 Used for execution / Current / No longer applies（RA 7.5，改为服务端返回完整历史，RA-B06）；每条可跳到对应 `/proposals/[version]`。
