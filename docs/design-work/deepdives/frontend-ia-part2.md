# 专题深潜：前端信息架构与视图模型（part 2：决定续、路由与页面、布局、视图模型）

> 接 frontend-ia.md §2。

### D-FE-07 路由按房间分 tab，角色差异在组件内按视图模型分支，不按角色分路由

- **决定**：`/rooms/[roomId]` 下四个 tab：Workbench、My brief、Results & history、People。不做 `/rooms/[roomId]/finance` 这类角色路由。finance 的预算编辑放在 My brief 页的 Budget 区块（预算是 finance 的私密约束，与其他约束确认共用同一个"这会让旧审批失效"的确认流程）。
- **理由**：同一个 URL 对三个角色有意义，便于在协作中互相引用；角色差异由视图模型的判别字段驱动，组件不读 `viewer.role` 来决定是否显示某个金额。
- **不变量**：I-FE-7 组件可以用 `viewer.role` 决定**文案措辞与操作入口**，但不能用它决定**是否显示某个数据字段**；数据是否存在完全由视图模型决定。

### D-FE-08 人工取舍请求只对目标人显示选项，其他人只看到"在等谁"

- **决定**：`rooms.view.requests` 对目标人返回完整 `HumanRequestView`（问题、上下文、选项及其后果）；对其他人返回 `{ kind: "waiting", targetRole, openedAt }`。选项分两类：`apply`（服务端直接应用一个结构化变化，例如"把 REPORTS 延到二期"）与 `edit_brief`（跳到简报页相应字段，例如 provider 新增更便宜的报价）。选中 `apply` 类选项若会改变约束，先弹出影响确认对话框。
- **理由**：选项措辞可能含目标人的私密数字（"Raise budget by $100"），只能给目标人；代理调用不了 `answerRequest`（F05.6）。

### D-FE-09 版本标签常驻、旧审批保留可见

- **决定**：RoomFrame 标题区常驻 `Proposal vN · Constraints vM`；审批面板每个必需槽位显示当前状态与"最近一次决定"，旧决定标为 `No longer applies`，原因写明"constraints changed v2 → v3"或"newer proposal v4"。检查结果写"Checked against constraints vN"，不写"Matches current constraints"（F13.1）。

### D-FE-10 代理建议只给本方，且与审批分区

- **决定**：本方代理对某版本的 recommend_accept / recommend_reject 以 `myAgentSuggestion` 出现在提案卡的"Your agent's view"折叠块里，带机器人图标和固定说明"Suggestion only. It does not count as your approval."；他方只在协商记录里看到模板化的动作摘要（由 05 决定措辞）。审批面板只读 approvals 表。
- **不变量**：I-FE-8 审批面板组件的输入类型中不存在任何来自 agentTurns 的字段。

### D-FE-11 运维功能不进产品界面

- **决定**：seed / reset、指标看板不在产品路由中；`/setup` 只显示配置诊断（F13.4），不显示密钥值，生产环境只对已登录用户显示"后端是否接受了登录"。模拟数据用 `SimulatedBadge` 标注（RA-U13、RA-U14、F13.3）。

### D-FE-12 日期与金额的显示纪律

- **决定**：金额在视图模型中一律是整数美分（`*Cents`），前端用 `Intl.NumberFormat(locale, { style: "currency", currency })` 格式化；美元输入（finance 预算表单）在前端解析为整数美分后提交，服务端再 `assertCents`。交付日期、截止日是 `YYYY-MM-DD` 字符串，前端按字符串拆分显示，**禁止** `new Date("2026-11-20")`（它按 UTC 解析，在美洲时区会显示成前一天）。时间戳（`decidedAt` 等）用本地时区显示并带相对时间。
- **理由**：日期偏一天会直接改变"是否晚于截止日"的人工判断；金额浮点误差会让 $800 边界（RA-F01）显示错误。

---

## 3. 具体设计

### 3.1 路由与页面

| 路由 | 页面壳内容 | 客户端岛订阅 | 谁能进入 | 说明 |
| --- | --- | --- | --- | --- |
| `/` | 产品介绍、登录入口 | 无 | 所有人 | 已登录则客户端跳转 `/rooms` |
| `/sign-in/[[...sign-in]]`、`/sign-up/[[...sign-up]]` | Clerk 组件 | 无 | 所有人 | 注册限制见 07（F07.9） |
| `/rooms` | 标题、布局 | `rooms.listMine` | 已登录 | 顶部"Waiting on you"跨房间待办；房间卡片；新建入口（仅允许创建者） |
| `/rooms/new` | 表单布局 | `rooms.creationEligibility` | 允许创建者 | 只填 title、goal、scenario；不填预算（预算由 finance 在自己页面确认，RA-U 7.2） |
| `/invite/[code]` | 说明 | `invites.preview({code})` | 已登录 | 显示房间标题与将获得的角色；接受调用 `invites.accept` |
| `/rooms/[roomId]` | RoomFrame 壳 | `rooms.view`、`runs.transcript`（分页，折叠时 skip） | 成员 | 工作台（默认 tab） |
| `/rooms/[roomId]/brief` | RoomFrame 壳 | `rooms.view`（头部与版本）、`briefs.mine`、finance 另加 `budgets.mine` | 成员 | 私密简报、报价（provider）、预算（finance）、抽取复核 |
| `/rooms/[roomId]/results` | RoomFrame 壳 | `rooms.view`、`results.view`、`events.timeline`（分页） | 成员 | 执行结果、任务、审批记录、历史 |
| `/rooms/[roomId]/proposals/[version]` | RoomFrame 壳 | `proposals.detail({roomId, version})` | 成员 | 提案永久链接：条款、来源、当时的检查结果与针对它的全部决定；供历史与变更单追溯（核心 6） |
| `/rooms/[roomId]/people` | RoomFrame 壳 | `members.view` | 成员；邀请操作仅 owner | 参与方、加入状态；owner 的邀请管理 |
| `/setup` | 诊断说明 | `health.viewer`（未认证时 skip） | 所有人 | F13.4；不显示任何密钥值 |

- 页面级"必须登录"由 `proxy.ts` 的 `auth.protect()` 做乐观检查（`/rooms(.*)`、`/invite(.*)`）；真正授权在每个 query 内（04 §3.5）。
- `rooms.view` 返回 `null` 时（未登录、非成员、房间不存在三者不可区分），RoomFrame 渲染 `NotAvailable`："This room isn't available to you. If you were invited, open the invite link again."，不提示房间是否存在。
- 每个房间路由段有 `error.tsx`（客户端错误边界，带"Try again"），根有 `global-error.tsx`（F13.4）。
- 没有 `/rooms/[roomId]/finance` 等角色路由（D-FE-07）；没有 reset、seed、"Preview as"（RA-U12/13/14）。

### 3.2 布局

**全局**：顶栏（产品名、`/rooms` 链接、Clerk `UserButton`）；连接状态条 `ConnectionBanner`（断线时出现）；`isSimulated` 房间在 RoomFrame 顶部显示 `SimulatedBadge`。

**RoomFrame**（采纳 RA 7.1）：返回链接 → 标题 → goal → `PhaseBadge`（颜色 + 文字 + 图标）→ `VersionTag`（"Proposal v3 · Constraints v2"）→ "You are: Finance" → tab 导航（`aria-current="page"`）→ `ActionResultLive`（`aria-live="polite"` 的动作结果区）。

**工作台**（≥1024px 双列；<1024px 单列）：

| 区域 | 顺序（宽屏） | 窄屏顺序 | 内容 |
| --- | --- | --- | --- |
| 主列 | 1 | 1 | `ConstraintChangeBanner`（有未读变更时） |
| 主列 | 2 | 2 | `TodoList`（"Decisions needed from you"） |
| 主列 | 3 | 3 | `HumanRequestCard`（mine）或 `WaitingNote`（waiting） |
| 主列 | 4 | 4 | `ProposalCard`（或 `ExecutedCard`、或按阶段的空状态） |
| 侧列 | 5 | 5 | `ApprovalPanel` |
| 侧列 | 6 | 6 | `BudgetPanel` |
| 侧列 | 7 | 7 | `RunStatusPanel` |
| 主列 | 8 | 8 | `ProposalCompareTable` |
| 主列 | 9 | 9 | `TranscriptSection`（默认折叠） |
| 侧列 | 10 | 10 | `SharedFactsPanel`、`ParticipantStatusList` |

窄屏把审批与预算提到对比表之前，因为"能否执行、谁没批"比历史版本更重要。

### 3.3 角色差异矩阵（工作台）

"数据"列由视图模型决定（D-FE-07 / I-FE-7）；"操作"列由视图模型中的 `can*` 字段决定。预算数字的可见角色按 F07.1 推荐方案示例，07 裁决为准。

| 组件 | customer | provider | finance |
| --- | --- | --- | --- |
| ProposalCard 条款、价格、交付日 | 可见 | 可见 | 可见 |
| ProposalCard 决定按钮 | "Accept terms of vN" | "Accept terms of vN" | "Approve budget commitment for vN" |
| RecordsPreview | 变更单标题、任务数、承诺金额 | 变更单标题、本方任务（无承诺金额） | 变更单标题、任务数、承诺金额 |
| BudgetPanel | `amounts`（只读） | `verdict`："Within the finance limit" / "Blocked: exceeds the finance limit" | `amounts` + "Change budget" 链接到 My brief#budget |
| ProposalCompareTable 的 Total after 列 | 有 | 无此列 | 有 |
| ChecksList 中 budget 规则的参数 | shortfall 等数字 | 只有 reasonCode 文案，无数字 | shortfall 等数字 |
| ApprovalPanel | 三个槽位，含他方状态 | 同左 | 同左 |
| HumanRequestCard | 目标是自己时显示选项 | 同左 | 同左 |
| myAgentSuggestion | 本方代理 | 本方代理 | 本方代理 |
| TranscriptSection | 公开消息 + 本方 rationale | 同左 | 同左 |
| SharedFactsPanel | 各方已披露事实 | 同左 | 同左 |

provider 侧的反推防线（F07.1）：provider 已知自己报价 $900，所以 provider 收到的任何对象里都不能出现 $4,900（合计）、$4,800（上限）、$100（超出额）中的任何一个；ChecksList 的 budget 项对 provider 只渲染"Exceeds the finance limit"。见 projection.ts `projectBudget` 与 `projectCheckParams`。

**简报页**：

| 区块 | customer | provider | finance |
| --- | --- | --- | --- |
| Goal、硬约束、偏好（逐项 `DisclosureToggle`："Visible to other parties"） | 截止日、必需范围项（从目录勾选） | 产能等 | 支付偏好等 |
| 报价编辑器 `OfferEditor` | — | 有：从目录选范围项、价格、交付日；单独"Confirm offer"，确认后锁定 | — |
| 预算 `BudgetEditor` | — | — | 有：上限（美元输入）、已承诺（只读，来自 commitments 汇总）、原因（必填）、变更历史 |
| `DisclosurePreview`（"What other parties can see"） | 服务端生成 | 服务端生成，含"Offer prices become visible when a proposal uses them" | 服务端生成，含"Budget amounts are visible to customer, never to provider"（按 07） |
| `ParticipantStatusList` | 他方只有版本与确认时间 | 同左 | 同左 |
| `ExtractionReview` | 粘贴文本 → 结构化草稿逐条确认 | 同左 | 同左 |
