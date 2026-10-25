# 13 前端信息架构

> 本章分 2 片：part1（本文件）页面地图、房间外壳、角色工作台、组件；part2 实时更新、加载与错误、可访问性、响应式、标注纪律、诊断页、语言。

## 13.1 页面地图（`src/app/`）

| 路由 | 用途 | 主要数据源（12） | 谁能进 |
| --- | --- | --- | --- |
| `/` | 产品说明（三步：Set your boundaries / Compare proposals / Approve the outcome）与登录入口 | — | 所有人 |
| `/sign-in/[[...sign-in]]` | Clerk 登录 | — | 所有人 |
| `/rooms` | 我的房间：阶段徽章、"Your turn" 徽章、新建按钮 | `rooms.listMine` | 登录 |
| `/rooms/new` | 建房：标题、共享目标、场景、时区、我的角色 | `rooms.create` | 登录 |
| `/invite/[token]` | 邀请预览与加入：房间、角色、披露基线 | `invites.preview` / `invites.accept` | 登录（未登录先跳转再回来） |
| `/rooms/[roomId]` | **工作台**（默认页）：待办、当前提案、签核、代理进度、请求卡 | `rooms.workspace` | 成员 |
| `/rooms/[roomId]/brief` | 我的私密简报：草稿编辑、披露控件、"What others will see"、版本历史、从文本抽取 | `briefs.myDraft`、`briefs.myVersions`、`briefs.previewConfirm` | 本席位 |
| `/rooms/[roomId]/lists/[listKey]` | 共享清单（scope_change：Scope、Quote）；作者可编辑，其他人只读 | `lists.view`、`lists.previewConfirm` | 成员 |
| `/rooms/[roomId]/history` | 提案版本对比、约束修订、完整时间线、我的代理笔记 | `proposals.history`、`proposals.compare`、`history.*` | 成员（投影） |
| `/rooms/[roomId]/records` | 变更单、任务、（买方）预算影响与台账 | `records.view`、`ledger.view` | 成员（投影） |
| `/rooms/[roomId]/settings` | 席位与邀请、房间信息、关闭房间 | `invites.listForRoom` | 房主 |
| `/admin/health` | 配置与连通诊断 | `health.viewer`、`health.config` | 管理员 |

Role A 的四页面信息架构（房间列表 / 我的简报 / 工作台 / 结果与历史）保留并扩充为上表（RA-U01）；"Preview as" 角色切换、预览横幅、"Check confirmed options"、重发执行按钮、写死的演示提示全部不进入产品（RA-U12、RA-U13、RA-U15）。

## 13.2 房间外壳（`src/app/rooms/[roomId]/layout.tsx`）

```text
┌ ← Rooms   Q4 analytics portal change                [Simulated room]          ┐
│ Customer (you) · Provider: Leo · Finance: Priya     Proposal v2 · Constraints v7 │
│ ▸ Phase banner: "Awaiting approval — 2 of 3 signoffs"  / "Agents are negotiating…" │
│ [Overview] [My brief] [Scope] [Quote] [History] [Records] [Settings*]             │
└───────────────────────────────────────────────────────────────────────────────┘
```

- 版本条 "Proposal vN · Constraints vM" 常驻（RA-D03、体验原则 2）。
- 阶段横幅文案来自 `phase` + `blockedReason`（04 第 4.9 节），总是写出"在等谁、下一步是什么"。
- 场景声明的清单自动生成页签；`Settings` 只对房主显示。
- 外壳本身是 Server Component；所有实时数据在 Client Component 内订阅（04 平台约束 5.1）。

## 13.3 角色工作台（同一路由、同一 query，按投影呈现）

工作台从上到下的区块，所有角色共用组件，内容由 `workspaceDTO` 决定：

| 区块 | 内容 | customer | provider | finance |
| --- | --- | --- | --- | --- |
| Decisions needed from you | `todo` 列表（服务端按查看者计算） | 确认简报、接受条款、回答偏好/披露请求 | 确认报价、接受条款、取舍请求（加报价行） | 确认预算、批准预算承诺、取舍请求（上调档位） |
| Request cards | `myRequests`：问题、选项（展开看条款与检查）、"Also asked: …" | ✓ | ✓ | ✓ |
| Current proposal | 条款、明细、差异、检查清单（投影）、"Approving creates…" 预览、签核按钮 | 买方预算行 | 无预算数字 | 完整预算分解 |
| Signoffs | 每个必需席位：approved / rejected / pending / stale（附解释与时间） | ✓ | ✓ | ✓ |
| Agents | run 进度条：每个代理 drafting / reviewing / done / failed；公开立场；"Your agent's notes"（仅本人，折叠） | ✓ | ✓ | ✓ |
| Shared facts | 对我披露的他方字段与共享说明 | ✓ | ✓ | ✓ |
| Role panel | 场景 `RolePanels` | — | — | `FinanceBudgetPanel`：上限、已承诺、余量、"Update budget cap"、台账入口 |
| Waiting on | 别人的请求与签核（只有角色与类型） | ✓ | ✓ | ✓ |

**签核按钮**：
- 文案带版本："Accept terms of v2 (constraints v7)" / "Approve budget commitment of +$750 (v2, constraints v7)"；
- 不可执行时禁用，旁边写原因（"Blocked: exceeds the finance limit"）；拒绝始终可用；
- 点击拒绝弹出原因码单选 + 私密备注（"Only you and your agent will see this note"）；
- 若我是最后一个待签核者，按钮下显示 "Approving will execute these records now"；
- 永远附一行 "An agent's recommendation never counts as approval."（RA-U03）。

**候选浏览器**（"Choose an option myself"，有 `proposal.author` 能力者）：列出 `proposals.candidates` 返回的作用域候选，每项显示条款与已知检查，未知检查显示 "Depends on others' private constraints"；选择后确认对话框展示完整条款，可勾选 "Also accept these terms"。

## 13.4 引擎通用组件（`src/components/`）

| 组件 | 输入 DTO | 说明 |
| --- | --- | --- |
| `PhaseBanner` | `room.phase`、`blockedReason` | 每种阶段一句话 + 主行动 |
| `ProposalCard` | `proposalCardDTO` | 条款由场景 `TermsView` 渲染；检查清单、差异、记录预览、签核区 |
| `SignoffPanel` | `signoffs` | stale 显示 "You accepted v1 under constraints v6 — no longer applies" |
| `RunProgress` | `runProgressDTO` | 回合级状态，不做 token 级流式（04 平台约束 4.9） |
| `RequestCard` | `requestCardDTO` | tradeoff / preference / disclosure 三种布局；disclosure 卡明确"共享后谁会看到什么" |
| `CandidateExplorer` | `candidateDTO[]` | 见 13.3 |
| `DiffList` | `diffFromPrevious` | "Moves EXPORT to deferred" 与 "Removes" 区分 |
| `Timeline` | `renderedEventDTO` 分页 | 按提案版本 / 约束版本筛选；私密信息不在此出现 |
| `ConstraintHistory` | `history.constraints` | 本人字段显示前后值，他方只显示原因与角色 |
| `AgentNotes` | `history.myAgentNotes` | 本人代理的 rationale、被阻断原因、用量 |
| `DisclosureControl` | 字段披露设置 | "Visible to: only me and my agent / Provider / Finance / Everyone"；`implicitInTerms` 字段锁定为 Everyone 并说明原因 |
| `SimulatedBadge` | `isSimulated` / `agentMode` | "Simulated room" / "Simulated quote" / "Simulated agent" |
| `MoneyInput` | — | 美元输入 → 整数美分（严格解析，服务端再校验，RA-X01） |
