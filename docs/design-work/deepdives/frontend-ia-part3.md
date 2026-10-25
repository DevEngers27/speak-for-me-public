# 专题深潜：前端信息架构与视图模型（part 3：视图模型清单、实时更新、预算翻转时序）

> 接 frontend-ia-part2.md §3.3。

### 3.4 视图模型：query 清单与返回形状

完整 validator 见 `frontend-ia/view-models.ts`；投影纯函数见 `frontend-ia/projection.ts`。所有 query 以 `getViewer` / `requireMember` 开头，未认证或非成员返回 `null`（F07.3），不抛错。

| query | 参数 | 返回（要点） | 投影要点 | 有界性 |
| --- | --- | --- | --- | --- |
| `rooms.listMine` | `{}` | `null \| RoomCardView[]`：roomId、title、scenarioLabel、myRole、phase、todoCount、topTodoKind、updatedAt、isSimulated | **不含任何金额**（Role A 卡片上的 "$X of $Y committed" 移除） | 成员关系数，≤ 50 后分页 |
| `rooms.view` | `{ roomId }` | `roomViewV`（见 view-models.ts） | 预算判别联合；checks 参数按受众投影；requests 按 targetRole 分 mine/waiting；myAgentSuggestion 只本方 | proposalHistory ≤ 20；facts、participants 天然有界 |
| `runs.transcript` | `{ roomId, paginationOpts }` | `PaginationResult<TranscriptItemView>`：turnId、round、seq、actorRole、action、basedOnProposalVersion、publicText（模板）、status（accepted / rejected_stale / failed）、`myRationale?`（仅本方回合） | 他方回合只有模板文本；本方回合额外带 rationale | 分页 |
| `events.timeline` | `{ roomId, filter?: { proposalVersion?, constraintsVersion?, kinds? }, paginationOpts }` | `PaginationResult<EventView>`：eventId、kind、at、actorRole、isMe、text（按受众模板渲染）、refs、audience（room / me） | 房间事件 + 本人可见的私密事件（F07.6），服务端合并 | 分页 |
| `briefs.mine` | `{ roomId }` | 本人草稿、最新确认版本、目录（scenario catalog 的 itemKey 与 label）、`disclosurePreview`、他方状态 | 只按 `(roomId, viewer.userId)` 读；他方简报一行也不读 | 有界 |
| `budgets.mine` | `{ roomId }` | finance：cap、committed、commitments 列表、budgetChanges 历史；非 finance 返回 `null` | 仅 finance | changes ≤ 50 |
| `constraints.previewChange` | `{ roomId, change }` | `ImpactPreview`：nextConstraintsVersion、invalidatedSlots、currentProposalVerdictAfter（executable / blocked / none）、openRequestsToCancel、willStartRenegotiation | 只给发起人自己；用与执行相同的纯函数（06）推演 | 有界 |
| `results.view` | `{ roomId }` | executions[]：每轮一条，changeOrder（条款）、tasks（含 canToggle）、decisionsUsed、offerVersionsUsed、constraintsSnapshotVersion、budgetImpact（判别联合，读执行时快照，RA-B09） | provider 的 budgetImpact 为 `{ visibility: "verdict" }` | 有界（轮次少） |
| `proposals.detail` | `{ roomId, version }` | 该版本的卡片（与 proposalCardV 同形，但 `checkedAgainstConstraintsVersion` 为查看时版本）+ 针对它的全部决定历史 | 同 rooms.view | 有界 |
| `members.view` | `{ roomId }` | participants；owner 额外收到 invites（role、status、createdAt；邀请链接只在创建时由 mutation 返回一次） | 非 owner 无 invites 字段（判别联合） | 有界 |
| `health.viewer` | `{}` | `null \| { tokenIdentifier, subject }` | — | — |

**为什么 transcript 与 timeline 不并入 rooms.view**：它们无界增长，而且代理每写一个回合都会变化；并入会让工作台每个回合都整体重算并把整页重新渲染。它们不含任何可执行性判断，因此与 rooms.view 的版本偏斜无害（I-FE-2）。

**前端只读的派生字段**（服务端算，前端不重算）：`phase`、`isExecutable`、`blockedReasonCodes`、`approvalSlot.state`、`todos`、`budget.status`、`rowStatus`、`canDecide`、`canRetry`、`canToggle`。

### 3.5 实时更新策略

1. **订阅拓扑**：每个房间页至多 3 个活跃订阅：`rooms.view` + 页面专属的 1 个（briefs.mine / results.view / members.view）+ 至多 1 个分页列表（transcript 或 timeline，折叠时 `"skip"`）。RoomFrame 与工作台共享同一个 `rooms.view` 订阅（同一组件树内多次 `useQuery` 相同参数由客户端去重，待验证 §7 #3；为稳妥起见由 `RoomViewProvider` context 订阅一次向下传递）。
2. **一致性**：关键判断只来自 rooms.view（D-FE-02）。其他 query 的结果若带 `constraintsVersion`（results.view、proposals.detail）且与 rooms.view 的 `versions.constraintsVersion` 不同，组件显示"Updating…"占位，不混合渲染，直到两者一致。
3. **变化提示**：`useVersionWatch(view)` 用 `useRef` 记住本会话上次渲染的 `constraintsVersion` 与 `proposalVersion`；变大时：
   - `ConstraintChangeBanner` 出现，内容来自服务端 `lastConstraintChange`（可在刷新后重现），并在本会话标记"new"；
   - 向 `aria-live="polite"` 区域播报一句摘要（见 3.6）；
   - 卡片高亮 2 秒（`prefers-reduced-motion` 时不动画，只改边框）。
   "我是否看过"只存在于本会话内存，不写服务端（不需要已读回执；避免为了一个提示增加写入）。
4. **对话框中的翻转**：若用户正在看"确认批准"或"回答请求"对话框，对话框订阅同一个 view；版本变化时确认按钮立即变 `aria-disabled`，对话框内出现"Constraints changed to v3 while you were reviewing. Review again before deciding."，并把焦点移到这句提示。
5. **竞态兜底**：即使界面没来得及翻转，提交时 `expectedConstraintsVersion` 不匹配会得到 `STALE_VIEW`（D-FE-05），前端显示同一句提示，不重试。
6. **分页列表**：`usePaginatedQuery` 初始 20 条，"Load older"按钮加载更多；新事件出现在顶部时不自动滚动，显示"N new events"按钮（避免阅读中跳动）。
7. **离开房间**：路由切换卸载组件即退订，无需手动管理。

### 3.6 预算变更：三个窗口同时翻转的时序

前提：v2 可执行，customer 已"Accept terms of v2"，provider 未决定，finance 未决定；约束版本 1。

| 步 | 谁 / 哪里 | 发生什么 | 读写 | 失败与状态 |
| --- | --- | --- | --- | --- |
| 1 | finance 浏览器，My brief#budget | 输入 $4,800、原因；点"Review impact" | `constraints.previewChange` 返回：next v2、invalidatedSlots [customer]、currentProposalVerdictAfter blocked、willStartRenegotiation true | 输入非法（非正数、低于已承诺）在前端先提示；服务端仍校验 |
| 2 | finance 对话框 | 显示影响摘要："Constraints become v2. Customer's approval of v2 will no longer apply. Proposal v2 will be blocked. Agents will renegotiate." 点"Update budget" | — | 断线时按钮 aria-disabled |
| 3 | Convex | `budgets.update({ roomId, newCapCents, reason, expectedConstraintsVersion: 1 })` 单事务：鉴权 finance → 写 budgets、budgetChanges → bumpConstraints → 旧 run superseded → 取消 open 请求 → 写 constraints_changed 事件（无数字）→ 新 run 或人工请求 → `runAfter(0, …)` | 见 09 / F09.2 | `STALE_VIEW`（有人先改了约束）、`BUDGET_BELOW_COMMITTED`（仅 finance 可见）；失败则全部回滚，界面不变 |
| 4 | 三个浏览器 | 同一次提交触发 rooms.view 对三位订阅者重算并推送 | — | — |
| 5a | customer 窗口 | ProposalCard 徽章 "Blocked"；按钮"Accept terms of v2" aria-disabled，旁注"Over the budget cap by $100 under constraints v2"；ApprovalPanel 自己的槽位变 `stale_approved`："You accepted v2 under constraints v1 · No longer applies (constraints changed)"；待办出现 `redecide_proposal` 或"Waiting for renegotiation"；Banner："Finance updated a constraint (v1 → v2). Your approval no longer applies. Proposal v2 is blocked." | — | — |
| 5b | provider 窗口 | 徽章 "Blocked"；旁注"Exceeds the finance limit"；BudgetPanel `verdict: over`；**没有任何金额**；Banner："Finance updated a constraint (v1 → v2). Proposal v2 is blocked." | — | — |
| 5c | finance 窗口 | 同 customer 的数字视图："+$900 change · $4,900 after approval · $4,800 cap · over by $100"；BudgetPanel 条形图更新 | — | — |
| 6 | 三个窗口 | RunStatusPanel："Renegotiating · round 3 · queued"；或（无可行组合时）目标人的 HumanRequestCard，他人看到"Waiting on provider to respond" | — | run 失败 → "failed" + canRetry 的人看到"Retry" |
| 7 | 稍后 | 代理产出 v3 → rooms.view 再次推送：新提案卡、审批槽位全部 pending、待办 decide_proposal | — | 迟到的旧回合被拒（rejected_stale），transcript 显示"1 late reply discarded" |

关键：步 5 不等任何模型调用（F09.3）。阻断由 rooms.view 在读取时派生，不回写提案。

播报文案（aria-live polite，每个窗口一句，按受众）：customer / finance："Constraints changed to version 2. Proposal 2 is blocked. Your approval no longer applies."（只有该人确有失效审批时才加最后一句）；provider："Constraints changed to version 2. Proposal 2 is blocked."
