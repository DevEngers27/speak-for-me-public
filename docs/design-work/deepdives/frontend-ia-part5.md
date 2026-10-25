# 专题深潜：前端信息架构与视图模型（part 5：组件清单、可访问性、对 Role A 四页的取舍）

> 接 frontend-ia-part4.md §3.9。

### 3.10 组件清单

"输入"列写组件消费的视图模型片段；所有组件都是客户端组件，除标注"壳"者。

| 组件 | 输入 | 职责 | 备注 |
| --- | --- | --- | --- |
| `AppShell`（壳） | — | 顶栏、`UserButton`、`ConnectionBanner` 挂载点 | |
| `Providers` | env | `ClerkProvider` > `ConvexProviderWithClerk`；`ConvexReactClient` 只创建一次 | 缺配置时渲染 `BackendNotConfigured`，不挂载依赖 Convex 的子树（F11.3） |
| `ConnectionBanner` | `useConvexConnectionState()` | 断线提示 | |
| `RoomViewProvider` | `rooms.view` | 订阅一次、经 context 下发；null → `NotAvailable` | |
| `RoomFrame` | `view.room/versions/phase/viewer` | 标题区、tab、`ActionResultLive` | |
| `PhaseBadge` / `StatusBadge` | enum | 颜色 + 文字 + 图标 | |
| `VersionTag` | `versions` | "Proposal v3 · Constraints v2" | |
| `SimulatedBadge` | `isSimulated` | "Simulated" 标签 + tooltip 说明来源 | 房间、提案、来源、回合、记录都可用 |
| `ConstraintChangeBanner` | `lastConstraintChange` + `useVersionWatch` | 变更摘要、失效审批、阻断 | |
| `TodoList` / `TodoItem` | `todos` | 排序、链接、空状态 | |
| `HumanRequestCard` / `RequestOption` / `WaitingNote` | `requests` | 3.8 | |
| `ProposalCard` | `currentProposal` | 容器 | |
| ├ `TermsList` | items、cost、date | 条款 | |
| ├ `SourcesList` | sources | 来源与版本 | |
| ├ `DiffFromPrevious` | diffFromPrevious | 版本差异 | |
| ├ `ChecksList` | checks + `checkedAgainstConstraintsVersion` | Pass/Fail + 受众文案 | |
| ├ `RecordsPreview` | recordsPreview | 批准后将创建的记录 | |
| ├ `DecisionControls` | myDecision、versions | 按钮、禁用原因、对话框 | 提交时携带 `expectedConstraintsVersion` |
| └ `AgentSuggestionNote` | myAgentSuggestion | 本方代理建议 | |
| `ExecutedCard` | execution | 已执行摘要 + Results 链接 | |
| `ProposalCompareTable` | proposalHistory | 对比表，`<caption>`、当前行 `aria-current="true"` | Total after 列仅当行内有该字段 |
| `ApprovalPanel` / `ApprovalSlotRow` | approvals | 3.9 | 输入类型不含 agentTurns 字段 |
| `BudgetPanel` | budget | 判别联合分支渲染 `BudgetAmounts` / `BudgetVerdict` / `BudgetUnset` | |
| `BudgetMeter` | amounts | `role="img"` + 完整 aria-label | 仅 amounts 分支 |
| `RunStatusPanel` / `AgentLane` | run | 每个角色一条：waiting / drafting / done；失败与重试 | |
| `TranscriptSection` / `TranscriptItem` | `runs.transcript` | 折叠、分页、本方 rationale 标"Private to your side" | |
| `SharedFactsPanel` | sharedFacts | 按角色分组 | |
| `ParticipantStatusList` | participants | 版本与确认时间 | |
| `BriefEditor` | `briefs.mine` | goal、约束、偏好、`DisclosureToggle` | 自动保存草稿；确认走 `ConfirmConstraintChangeDialog` |
| `RequiredItemsPicker` | catalog | 从目录勾选 | customer |
| `OfferEditor` | catalog + offers | 报价草稿、单独确认、确认后锁定 | provider |
| `BudgetEditor` | `budgets.mine` | 美元输入 → 整数美分、原因必填、历史 | finance |
| `DisclosurePreview` | disclosurePreview | 他方真实可见内容 | 服务端生成 |
| `ExtractionReview` | 抽取草稿 | 逐条确认 / 修改 / 丢弃，显示来源片段 | 未确认不生效 |
| `ConfirmConstraintChangeDialog` / `ImpactSummary` | `constraints.previewChange` | 约束变更前的影响确认 | 原生 `<dialog>` |
| `ChangeOrderCard` | results.view | 变更单、"Internal record only. No payment, transfer, or e-signature." | 无重发按钮 |
| `TaskList` | tasks | 仅 canToggle 可勾选 | |
| `BudgetImpact` | budgetImpact | 判别联合 | 读执行快照 |
| `DecisionRecord` | decisions | 完整决定历史 | |
| `HistoryTimeline` / `HistoryFilters` | `events.timeline` | 按提案版本、约束版本、类型筛选；私密事件"Private to you" | 说明"The log records actions, versions, and outcomes, not hidden model reasoning." |
| `InviteManager` | members.view（owner） | 生成 / 撤销邀请；链接只显示一次 | |
| `SetupDiagnostics` | `health.viewer`、`useConvexAuth` | F13.4 | |
| `ActionResultLive` | 本地状态 | `aria-live="polite"` 动作结果 | |
| `NotAvailable` / `BackendNotConfigured` | — | 空/错误页 | |

共享 hooks：`useRoomView()`、`useVersionWatch(view)`、`useDecide()`（封装 `expectedConstraintsVersion`、进行中状态、错误码映射）、`useMoney()`、`formatIsoDate()`。

### 3.11 可访问性要点

1. 区块用 `<section aria-labelledby>`；页面只有一个 `<h1>`（房间标题），区块 `<h2>`。
2. **禁用原因可达**：决定类按钮不用 `disabled` 属性（会移出 tab 序列、读屏听不到原因），改用 `aria-disabled="true"` + `aria-describedby` 指向原因文本，点击时不执行并把焦点移到原因。
3. 实时变化：`ActionResultLive`（polite）播报自己动作的结果；`ConstraintChangeBanner` 的摘要也走 polite；只有自己动作失败用 `role="alert"`。代理每个回合**不播报**（避免噪音），只在新提案出现时播报"Proposal 4 is ready for your decision"。
4. 焦点管理：动作成功后焦点留在原控件；STALE_VIEW 后移到提案卡标题；对话框打开时焦点进入、关闭后回到触发按钮（原生 `<dialog>` + `showModal()`）。
5. 状态不只靠颜色：徽章同时有文字与图标；对比表"Current"行除样式外有 `aria-current="true"` 与文字。
6. `BudgetMeter` 是 `role="img"`，aria-label 完整描述，例如"Committed $4,000, this proposal $900, total $4,900, cap $4,800, over by $100"；只在 amounts 分支渲染，provider 无此组件。
7. 宽表放进 `role="region" aria-label="Proposal comparison" tabindex="0"` 的横向滚动容器。
8. 断点：<1024px 单列；<640px 表格转为卡片列表。
9. 动画尊重 `prefers-reduced-motion`；翻转高亮不依赖动画。
10. 日期显示为"Nov 20, 2026"，`<time dateTime="2026-11-20">`；相对时间旁有绝对时间 tooltip。
11. 用 axe 在 CI 中跑三个角色的工作台快照（§5）。

### 3.12 对 Role A 分支四页的吸收与否决

| Role A 做法 | 处理 | 本设计中的落点 |
| --- | --- | --- |
| 四页 IA：房间列表 / 简报 / 工作台 / 结果与历史（RA-U01） | 采纳并扩充 | 加 People、Invite、proposal 永久链接、/setup |
| RoomFrame 常驻 "Proposal vN · Constraints vM"、aria-live 结果区 | 采纳 | `RoomFrame`、`VersionTag`、`ActionResultLive` |
| "Decisions needed from you" 置顶（RA-U02） | 采纳，改服务端计算 | `todos`（D-FE-04） |
| 提案卡：条款、来源、差异、检查、带版本号按钮、"代理建议不算批准"（RA-U03） | 采纳 | `ProposalCard`；按钮按 kind 区分 |
| 对比表 Executed / Superseded / Blocked / Current（RA-U04） | 采纳，状态服务端派生，金额列按角色 | `proposalRowV.rowStatus`、`totalAfterCents?` |
| 预算条全员可见（RA-U05） | 修改 | 判别联合 `budgetViewV` |
| 审批面板四态（RA-U06） | 采纳并扩为五态 | `approvalSlotStateV`（加 stale_rejected） |
| Agent messages 没有就空着（RA-U07） | 采纳原则 | `TranscriptSection` 真实记录 |
| "What the room can see"（RA-U08）、他方只见版本与时间（RA-U09） | 采纳，服务端生成 | `disclosurePreview`、`participantV` |
| 抽取占位（RA-U10） | 采纳并实现 | `ExtractionReview` |
| 结果页结构、阻断原因、"只写内部记录"、"不记录隐藏推理"、私密事件徽章、仅指派人改任务（RA-U11） | 采纳 | Results 页 |
| 语义化 section、aria-current、预算条 role=img、宽表滚动、窄屏单列、徽章文字 | 采纳 | §3.11 |
| `useWorkspace` 返回全量 `WorkspaceState`、"same shapes" 迁移（RA-D16 / RA-B03） | **否决** | 按查看者投影的多个 query；客户端不持有全量状态；brief-page 拿他人简报对象、results-page 客户端过滤私密事件的写法都不得出现 |
| "Preview as" 角色切换与预览横幅（RA-U13） | **否决** | 身份来自 Clerk；多角色测试用多个浏览器 profile / Playwright 上下文 |
| "Send the execution request again"（RA-U12） | **否决** | 幂等性放进自动化测试 |
| "Check confirmed options" 按钮 | **否决** | 重新协商由约束变化、拒绝或人工请求回答触发 |
| Reset 卡、`window.confirm`（RA-U14） | 移到运维 | 15 的 CLI |
| 产品内 demo 文案"lower it to $4,800"（RA-U15） | **否决** | — |
| 建房表单含预算上限与已承诺 | 修改 | 建房只填 title、goal、scenario；预算由 finance 确认 |
| 房间卡片 "$X of $Y committed" | 修改 | 卡片无金额 |
| 简报 "Confirm brief v{n+1}" 心智模型 | 采纳 | 确认前显示影响（`constraints.previewChange`） |
| 逗号分隔的范围项文本 | 否决 | `RequiredItemsPicker` / `OfferEditor` 从目录选 |
| 动作返回 `{ok, message}` 文本 | 修改 | `{ ok: true, ... } \| ConvexError({ code })`，文案按受众在前端渲染 |
