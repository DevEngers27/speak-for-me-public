# 13 · 前端信息架构（part3）：视图模型（采用 12 的返回形状）

> 分片见 `13-frontend.md` 顶部。返回形状的唯一定义在 12 §12.17（validator 位于 `convex/model/views/*`）；本节不另起一套字段名，只写：前端消费哪些字段、组件如何映射、哪些规则必须由服务端而不是前端计算，以及 13 对 12 的增量需求（§13.8.3）。

## 13.8 视图模型

### 13.8.1 前端消费的 query 与要点

| query（12） | 前端用途 | 关键字段与消费规则 |
| --- | --- | --- |
| `rooms.view({ roomId })` | 房间头部、三栏、决策页、取舍页、People 页 | `header`（`phase` 来自 04 的 `derivePhase`、`constraintsVersion`、`proposalVersion`、`viewingAs`、`isCreator`、`provenanceBadge`）；`members` / `seats`（seats 仅 creator）；`todos`；`catalog`；`sharedFacts`；`budget`；`currentProposal`；`proposalHistory`；`run`；`openRequest`；`execution` |
| `rooms.listMine({ paginationOpts })` | 收件箱（`usePaginatedQuery`，"Load more"） | `inboxSection`、`topTodo`、`phase`、`myRole`、`provenanceBadge`、`updatedAt`；无任何金额；分区只对已加载页 |
| `invites.listMine({})` | 收件箱 "Invitations" | `emailVerified` 为假时显示 "Verify your email to see invitations." |
| `rooms.previewChange({ roomId, change })` | 约束变更确认对话框 | 形状以 12 §12.17 为唯一定义：`null`（非所有者）/ `unchanged` / `rejected`（`budget.below_committed`，只 finance，带 `minAllowedCapCents`）/ `recheck`（`nextConstraintsVersion`、`invalidatedApprovals`、`willSupersedeRun`）/ `after`（只 finance 的 `kind: 'cap'`：另带 `verdictAfter { proposalVersion, budgetCheck: 'pass' \| 'budget.over', overByCents? }`，不含任何可行性枚举） |
| `briefs.mine({ roomId })` | 简报页、"Guide my agent" 面板 | `latest`、`versions`、`othersSee`（"What others can see from you"，服务端对已确认版本计算）；`versions[].notes` 是 "Earlier guidance" 的唯一来源（§13.10 F） |
| `catalog.list({ roomId })` | 必需项选择器、provider 目录编辑 | `items`（当前已确认修订）；`mine`（只 provider：草稿、修订历史、任务模板） |
| `proposals.get({ proposalId })` | 提案永久链接 | `card` 与当前提案同形，但**只有当前提案**带 `fit` / `checks`，历史提案只带存储状态（D12 ①）；`decisions[]`（`note` 只在 `isMe` 时返回） |
| `humanRequests.get({ requestId })` | 取舍页 | 按 URL 中的 `requestId` 取（不用当前 `openRequest` 代替）；`mine` 分支带选项、状态、回答 / 关闭摘要与关闭时的约束版本；非 `toRole` 分支只有投影后的元数据 |
| `turns.mine({ roomId, runId, paginationOpts })` | "Learn more"、本方代理笔记 | 只本方回合、`rationale` 与用量 |
| `executions.forRoom({ roomId })` | 结果页 | `approvalsSnapshot`（来自 `executions.approvalIds`）、`changeOrder.amountChain`（finance 完整；customer 按执行时生效的共享开关逐字段给出、未共享为 null；provider 恒 null）、`tasks[].canMarkDone`、`whyChain`（服务端组装并已按查看者投影） |
| `timeline.page({ roomId, paginationOpts })` | 右栏与时间线页 | 单索引单次 `paginate`、字符串游标；`text` 已按查看者渲染；`privateToYou`；`refs` |
| `users.viewer` / `users.ensureViewer` | `(app)` 布局 | `unprovisioned` 时先 `ensureViewer`，完成前不挂任何业务 query |

### 13.8.2 组件 ← 字段映射（判别联合只按分支渲染，FE-D16）

| 组件 | 字段 | 渲染规则 |
| --- | --- | --- |
| `VersionTag` | `header.proposalVersion`、`header.constraintsVersion`、`header.viewingAs` | "Proposal v2 · Constraints v2 · Viewing as Customer"；无提案时 "No proposal yet" |
| `PhaseBanner` | `header.phase`（`setup{gaps}` / `negotiating{roundNo, activeRole}` / `needs_input{you, waitingOn?}` / `awaiting_approval{pendingRoles, youPending}` / `stopped{reason}` / `executed` / `closed`） | 一句状态 + 下一步；`needs_input` 对 provider 没有 `waitingOn` → "Waiting on others" |
| `ChecksList` | `currentProposal.fit` | `audience: "provider"` → 只一行 "Fits / Doesn't fit the room's private constraints"；`audience: "buyer"` → `checks[]` 逐行：每项是 `{ code, owner: "self" \| "other", text }`（文案由服务端按 06 `PARAM_AUDIENCE` 裁剪后的参数渲染，DTO 不带开放 record，FE-D03 / 12 §12.17）；`owner: "other"` 的条目可以是已获全部输入披露的精确码（例如 finance 看到 customer 已披露截止日时的 `date.after_deadline`），也可以是折叠后的 `private.constraint_unmet`（"A participant's private constraint isn't met"）——前端按 `owner` 加 "Another participant's constraint" 标签，不按 `code` 判所有者 |
| `ApprovalPanel` | `currentProposal.approvals[]`、`allApproved`；执行后 `execution.approvalsSnapshot` | 六种 `state`（`pending` / `approved` / `rejected` / `stale_approve` / `stale_reject` / `withdrawn`）见 part2 §13.5；状态由服务端的 `evaluateApprovalSet` 结果给出，前端不派生 |
| `DecisionControls` | `currentProposal.myAction`、`termsKey`、`header.constraintsVersion` | `canDecide` 为假时 `aria-disabled` + `disabledReasonCode` 文案；提交带 `expected*`；最后一票提示与撤回入口见 §13.8.3 Δ1 |
| `AgentSuggestionNote` | `currentProposal.myAgentSuggestion` | 只本方；null → "Your agent hasn't commented on this version." |
| `NotIncluded` | `currentProposal.notIncludedForMe` | 只 customer 收到非 null；"Not included from your wishlist: …" |
| `BudgetPanel` | `budget` | `none` → 不渲染；`finance` → 上限 / 已承诺 / 余量（+ 后续房间的 `baselineSuggestionCents` 预填）；`customer` → 只渲染非 null 字段（默认全部为 null，U1 默认关） |
| `ProposalHistory` | `proposalHistory[]` | 版本、状态、金额、交付日；provider 视图中 `stale` 已由服务端显示为 `superseded`；不显示任何"当前约束下是否通过"的重算结论 |
| `RunProgress` | `run`（`status` 为 12 的 UI 派生枚举、`roundNo`、`maxRounds`、`activeRole`、`attemptStatus`、`cause`、`endedReason`、`agentMode`） | 串行顺序 provider → customer → finance 推出各 lane：`activeRole` 之前的为 done、之后的为 queued；`attemptStatus` 显示 "attempt n"；`agentMode: "stub"` 时带 `SimulatedBadge`；`needs_input` 对 provider 只显示 "Waiting on others" |
| `HumanRequestCard` / `WaitingNote` | `openRequest` | `mine: true` → 问题与选项（`options[].text`、`effectView`）；`mine: false, waitingOnRole` → 买方 "Waiting on Finance"；`kind: "run_waiting"` → provider "Waiting on others" |
| `ResultsPage` | `executions.forRoom` | 见 part5 §13.10 D |
| `PeoplePage` | `rooms.view.members`、`seats` | 成员与加入状态；`seats` 非 null 才显示邀请管理（creator） |
| `TimelineItem` | `timeline.page` 项 | `text` 原样渲染（纯文本，不渲染 Markdown 图片 / 链接）；`privateToYou` → "Private to you" 徽章；`actorRole: "system"` → 菱形；actor 字形见 Δ5 |

### 13.8.3 13 对 12 的增量需求（Δ，12 定稿时并入 `roomViewV` 等）

| Δ | 需求 | 理由 | 未并入时的前端退路 |
| --- | --- | --- | --- |
| Δ1 | `currentProposal.myAction` 增加 `completesSet: boolean` 与 `canWithdraw: boolean` | "Your approval completes the set — this executes now" 与 "Withdraw my approval" 属于审批判定，按 I-FE-2 只由 `rooms.view` 计算 | 不显示最后一票提示；撤回入口按 `myAction.current === "approve"` 显示（服务端仍按 `approvals.record` 守卫判定） |
| Δ2 | `budget.finance` 增加 `proposalCents`、`totalAfterCents`、`overByCents`、`status: "within" \| "over" \| "no_proposal"` | 边界（$800 恰等于余量、$4,799.99 超一分）不由前端算术判断（E8） | finance 面板只显示上限 / 已承诺 / 余量与 `ChecksList` 的结论 |
| Δ3 | `proposalHistory[]` 增加 `proposalId` | 永久链接 `/rooms/[roomId]/proposals/[proposalId]` | 历史行不可点击 |
| Δ4 | `rooms.listMine` 增加 `waitingOn: role[] \| "others" \| null` 与可选 `notice`（`approval_no_longer_applies` / `request_closed`） | 收件箱 "Waiting on others" 写"谁在做什么"、"Done & no longer needed" 写失效通知（CRITIQUES） | 文案退化为 "Waiting on others"、不显示失效通知 |
| Δ5 | `timelineItemV` 增加 `actorKind: "human" \| "agent" \| "rules" \| "system"` | 时间线不得把代理与代码的行为记在人名下（CRITIQUES 三栏原型问题） | 按事件 `kind` 映射字形（前端常量表） |
| Δ6 | `run` 增加 `staleDiscarded: number` | "1 late reply discarded" 的诚实提示 | 不显示该计数 |

除 Δ 外，前端不需要任何新的 query；`members.view`、`proposals.detail` 等暂用名不再使用（分别由 `rooms.view.members` / `seats` 与 `proposals.get` 承担）。
