# 13 前端信息架构

## 1. 原则

1. 默认展示**结论、阻断和需要你做的决定**，代理细节可展开（V-11）。
2. 每个窗口只拿到按本人角色投影的数据；前端不做任何"取回再隐藏"（核心 1、RA-D16 否决）。
3. 审批、执行、回答请求以服务端结果为准，不做乐观更新（inputs/04 §5.1）。
4. 版本意识常驻：房间标题区固定显示 "Proposal v{n} · Constraints v{m}"（Role A 采纳）。
5. 诚实：模拟数据、stub 回合、代理建议、估算成本都有显式标记；代理建议永远不画成"已批准"。

## 2. 页面

| 路由 | 组件边界 | 内容 |
| --- | --- | --- |
| `/` | Server | 产品说明（"Independent goals. Shared decisions."），三步：Set your boundaries / Compare proposals / Approve the outcome |
| `/sign-in`、`/sign-up` | Clerk | — |
| `/rooms` | Server 外壳 + Client（`rooms.listMine`） | 房间卡片：标题、我的角色、phase、"轮到你"徽章（确认简报 / 批准 / 重新批准 / 回答请求 / 重试）、Simulated 徽章；新建房间表单（title、goal、时区、我的角色）；**无任何预算数字** |
| `/invite/[token]` | Client | 显示房间标题与将获得的角色 → "Join as Service provider"（调用 `invites.accept`）；过期/已用的明确提示 |
| `/rooms/[roomId]` | Client（`rooms.workspace`） | **协商工作台**（§3） |
| `/rooms/[roomId]/brief` | Client（`briefs.mine`、`briefs.previewConfirm`） | **我的私密简报**（§4） |
| `/rooms/[roomId]/history` | Client（`events.list` 分页、`executions.get`、`turns.mine`） | **结果与历史**（§5） |
| `/rooms/[roomId]/change-orders/[number]` | Client | 变更单详情与打印视图（固定声明"Internal record only…"） |
| `/rooms/[roomId]/settings` | Client | 房主：邀请（生成/撤销、复制链接一次）、改名、关闭房间 |
| `/setup` | 仅非生产或管理员 | 诊断：`useConvexAuth()` 状态、`health.viewer` 是否被 Convex 接受、从 publishable key 解出的 Frontend API 主机、各配置"已配置/可用"分别显示（P-19、F13.4） |

房间内页面共用 `RoomFrame`：标题、goal、phase 徽章、版本行、"Viewing as {role}"、三个 tab（Workbench / My private brief / Results & history）、`aria-live="polite"` 的操作反馈区。

## 3. 协商工作台（按角色同一布局，内容由投影决定）

左列：
1. **Decisions needed from you**（`myTodos` + `myRequests`）：每项一个卡片和直接操作；没有时显示 "Nothing right now. Waiting on {waitingOn roles}."。
2. **当前提案卡**：作者（"Provider agent" / "Simulated agent" / "Customer, chosen from options"）、`proposal.summary` 模板文本、条款表（项、变体、价格、交付日、延后项）、"Changes from v{n}"（结构化 diff：新增 / 移除 / **延后** / 换变体 / 价格 / 日期；约束版本变化单独一行，Role A RA-R14）、检查清单（标题 "Checked against constraints v{m}"，每项 Pass / Fail / Info + 投影后的解释）、**执行预览**（"Approving creates: change order, +$750 commitment, 2 tasks"）、审批面板（每个必需角色：approved / rejected / pending / stale，stale 附"approved under constraints v3"）、按钮 "Accept terms of v{n}" 或 "Approve budget commitment for v{n}"、"Reject…"（要求选择原因、可选 note 并勾选是否公开、确认"会为所有人重启协商"）、"Withdraw approval"。按钮禁用时旁边写原因（`myActions.disabledReason`）。按钮下固定说明："Your approval applies only to v{n} under constraints v{m}. An agent's recommendation never counts as approval."
3. **协商记录**（默认折叠）：run 进度（"Run #2 · round 1 of 3 · Provider agent drafting…"，失败时 "Retry turn"）、公开级代理动作列表（模板文本，带 "advice" 标签）、"Request renegotiation"。
4. **版本对比表**：每个提案一行（版本、约束版本、项/延后、金额、交付日、状态 executed / current / superseded / rules-blocked），当前行 `aria-current`；superseded 行附"在当前约束下：Blocked — exceeds the finance limit"。买方额外一列"批准后已承诺"（投影可见时）。

右列：
1. **预算卡**：finance 总是看到上限、已承诺、本提案、批准后、余量的条形图；customer 只有在 finance 披露后看到同样内容；provider 只看到"Within / Exceeds the finance limit"。条形图 `role="img"`，aria-label 内容同样按投影生成。
2. **共享事实**：各方对我披露的字段（"Customer shared: deadline 2026-11-30"）。
3. **参与方**：角色、显示名、简报版本与确认时间（他方简报内容永不显示）。
4. **用量**：本房间调用次数 / 预算、估算成本（标 "estimate"）。

finance 的"Update budget cap"表单放在 `/brief` 的预算区，不在工作台（去掉 Role A 的 demo 文案）。

## 4. 我的私密简报

- 草稿编辑器（自动保存 `briefs.saveDraft`）：customer 编辑请求项（itemKey 由标题生成、可改）、勾选必需、截止日、首选日、备注；provider 编辑报价行（按请求项分组、变体、价格以美元输入→整数美分、最早日、有效期、任务标题）；finance 编辑上限与外部已承诺。
- 每个可披露字段旁一个受众选择器（Not shared / Customer / Provider / Finance / Everyone），旁注 "This will be visible to …"；强制披露项显示锁图标与说明；acknowledgements 以必须勾选的复选框呈现，文案直接说明后果（"Prices of offer lines become visible to everyone when a proposal or option uses them"）。
- 侧栏 "What others can see"：由 `briefs.mine` 以他方角色身份调用投影生成的真实预览（Role A RA-U08），而不是前端推测。
- "Confirm brief v{n+1}"：点击前展示 `previewConfirm`（"This changes your deadline. Approvals on v2 will no longer count."）；finance 修改预算时要求填写原因并选择是否公开。
- "Extract from pasted text"：粘贴 → `briefs.extractDraft` → 草稿字段标 "Extracted — review"；原文不保存的说明。
- 版本历史：每个确认版本、时间、改了哪些规则字段、原因。

## 5. 结果与历史

- 变更单卡片（每次执行一张）：CO 编号、来源提案与约束版本、条款、金额、交付日、任务、执行时间、**预算影响（读 budgetSnapshot，按投影）**、固定声明；Simulated 徽章。
- 任务列表：被指派角色可改状态；其他人只读。
- 时间线：`events.list` 渲染，最新在上；participant 事件带 "Private to you" 徽章；按提案版本、约束版本、run 筛选；说明 "The log records actions, versions, and outcomes, not hidden model reasoning."
- 审批记录：全部决定（含撤回与 stale），标 "Used for CO-0001" / "Current" / "No longer counts (constraints v3)"。
- "我的代理"面板（`turns.mine`）：每个回合的动作、rationale（"Written by your agent — advisory"）、耗时、token、失败原因。

## 6. 实时更新、加载与错误

- 所有房间页订阅 `rooms.workspace`；预算一提交，三个窗口在同一次推送中翻转为 blocked（09 §5）。事件列表用 `usePaginatedQuery`。
- 加载：`useQuery` 返回 `undefined` 时显示骨架；`null` 时显示"无权访问或房间不存在"（不区分，防探测）。
- 错误：`ConvexError.code` → 模板文本；带 reasonCodes 的错误渲染为检查解释；`PROPOSAL_NOT_CURRENT` 自动滚动到当前提案；客户端 `error.tsx` 带重试；`ConvexProviderWithClerk` 会吞掉取 token 错误，因此 `/setup` 的诊断是必要的。
- 只有依赖 Convex 的组件在 Provider 存在时渲染（未配置时显示"Backend not configured"，F11.3）。

## 7. 可访问性与响应式

- 语义化 `section` + `aria-labelledby`；`aria-current` 标记当前 tab 与当前提案行；状态徽章同时用颜色与文字；禁用按钮旁必有文字原因；宽表放横向滚动容器；960px / 720px 断点单列；审批与请求卡片在手机宽度下完整可操作（FX-09）。
- 键盘：所有操作可 Tab 到达；危险操作（拒绝、关闭房间）有确认对话框且焦点管理正确。
- 文本：产品 UI v1 为英文，模板集中在场景模块中，为 i18n 留接口（18 开放问题）。

## 8. 明确不做

不做单浏览器角色切换器（"Preview as"）、不做"重新发送执行"按钮、不做"Check confirmed options"规则按钮、不在产品界面写演示提示（Role A RA-U12/13/15）；不做 token 级流式。
