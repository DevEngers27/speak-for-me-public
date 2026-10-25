# 13 前端信息架构

## 13.1 原则

1. **浏览器只拿到它有权看到的东西**：每个组件的数据都来自已投影的 query（12）；不存在"拿到全量再按角色隐藏"的组件（核心 1，RA-D16 否决）。没有角色切换器：身份只来自 Clerk（RA-U13）。
2. **默认展示结论、阻断与"轮到你"**，代理细节可展开（V-11、RA-U02）。
3. **版本意识**：房间标题区常驻 "Proposal v4 · Constraints v2"；每个审批按钮写明版本（RA-U03）。
4. **诚实标注**：模拟数据、stub 代理、代理建议、内部记录各有固定徽章与文案（核心 8）。
5. **不做乐观更新**的操作：批准、拒绝、撤回、回答请求、改预算、发布目录、确认简报。

## 13.2 页面

| 路由 | 用途 | 主要组件 |
| --- | --- | --- |
| `/` | 产品说明（三步：Set your boundaries / Compare proposals / Approve the outcome） | 静态 |
| `/rooms` | 我的房间 | 房间卡（标题、生命周期、我的角色、"Your turn"徽章计数，无金额）；新建房间表单（标题、目标、场景、时区、我的角色） |
| `/invite/[token]` | 接受邀请 | `invites.peek` 结果 + "Join as Finance owner" 按钮；无效令牌统一显示 "This invitation is not valid" |
| `/rooms/[id]` | 协商工作台 | 见 13.3 |
| `/rooms/[id]/brief` | 我的私密简报 | 见 13.4 |
| `/rooms/[id]/results` | 结果与历史 | 变更单卡（"Internal record — not a contract, no payment has been made"）、任务（仅被指派人可改状态）、预算影响（按角色）、决定记录（含撤回与旧拒绝）、可筛选的事件时间线 |
| `/rooms/[id]/settings` | 房主设置 | 邀请（发放、复制一次性链接、撤销）、关闭房间 |
| `/setup` | 开发/管理员诊断 | `useConvexAuth()` 状态、`health.viewer` 结果、从 publishable key 解出的 Frontend API 主机名、"Convex accepted Clerk token" 或 "check CLERK_JWT_ISSUER_DOMAIN"；生产对非管理员 404 |

## 13.3 工作台（按角色同一布局，内容由 `rooms.view` 投影）

左列：
1. **Your turn**（`todo`）：确认简报、"Approve v4 under constraints v2"、回答请求（卡片含模板问题与选项按钮，只对目标人显示）、"Retry turn"、"Your earlier approval no longer applies"。没有待办时："Nothing right now — waiting on Finance (approval)."
2. **当前提案卡**：条款（条目标题、延后项、交付方式与日期、价格明细）、`termsKey`、作者徽章（"Provider agent" / "Customer agent" / "Chosen by Customer"，stub 时加 "Simulated agent"）、检查清单（按查看者粗化，标题 "Checked against constraints v2"）、与上一版本的差异（移除与延后分开）、"Approval will create" 预览、决定按钮（场景文案），禁用时旁边写原因。
3. **决定面板**：每个必需角色一行：approved / rejected / withdrawn / stale_approve / stale_reject / pending / used for execution，带解释。
4. **版本对比表**：版本、作者、条目（含延后）、价格、交付、派生状态；买方额外列"after approval"（仅有权限者），provider 不显示该列；当前行 `aria-current="true"`。
5. **协商进度**：run 序号与触发原因、轮次、每个角色的回合状态（"Provider agent drafting…"、"Customer agent reviewing…"、"Failed — Retry turn"），只来自 `turnProgress`，没有代理的结论（07 §7.9）。
6. **我的代理笔记**（折叠）：`agents.myNotes`，标题 "Advice from your agent — only people approve"；没有笔记就是空的，从不编造（RA-U07）。

右列：
1. **预算面板**（finance；获 headroom 披露的 customer；provider 无此面板）：finance 见 "$4,000 → $4,750 committed · $4,800 cap"，customer 见 "Available budget $800 → $50"。条形图 `role="img"`，`aria-label` 内容与可见文字同源、同样按角色裁剪。
2. **finance 的"Update budget cap"**：美元输入（`parseDollarsToCents`）+ 必填原因；提交前确认对话框："This creates constraints v3. Existing approvals will no longer apply."
3. **共享事实**：别人披露给我的字段（"Customer shared: required items LOGIN"）。
4. **等待中的请求徽章**：`requestBadges`（"Waiting on a finance decision"）。
5. **时间线**：最近 10 条渲染事件，链接到结果页完整历史。

## 13.4 私密简报页

- 草稿自动保存（`briefs.saveDraft`，防抖 1 s）；顶部显示 "Draft · based on version 2"；与已确认版本的差异高亮，硬约束变化旁标注 "Changes a hard constraint — confirming creates constraints v3 and existing approvals will no longer apply"。
- 每个可披露字段旁边是受众选择（多选角色），默认不披露；选择后显示 "Visible to Provider"。备注字段标注 "Only you and your agent can see this"。
- 右侧 "What others can see"：`briefs.disclosurePreview` 按他方角色分组显示其真实可见内容（与他方 `sharedFactsForMe` 同源，RA-U08）；另列固有披露清单与确认勾选（`inherentDisclosuresAck`）。
- provider 额外有目录编辑器：条目键、标题、价格、标准/加急日期、任务标题；"Publish these quotes to everyone in the room (creates catalog v2)"。
- "Extract from pasted text"：文本框 + 按钮；结果填入草稿，被预填的字段带 "From pasted text — confirm" 标记与原文引用，逐项点 "Looks right" 后才能确认简报（`extractedFieldKeys` 为空才启用确认按钮）。
- 他方简报只显示 "Finance — version 2, confirmed 10:42"（RA-U09）。

## 13.5 实时更新策略

- 工作台只订阅一个聚合 query `rooms.view`，保证同一时刻的提案、决定、预算面板与 run 状态来自同一快照（预算一提交，所有窗口在同一次推送中翻转为 blocked，F13.1）。
- `events.list`、`agents.myNotes`、`proposals.list` 用 `usePaginatedQuery`；首屏只取一页。
- 加载中（`undefined`）显示骨架；`null` 显示 "You don't have access to this room"（不区分不存在与无权）。
- Server Component 外壳可用 `preloadQuery(api.rooms.view, …, { token })` + `usePreloadedQuery` 加速首屏；预取结果同样来自投影 query（inputs/04 §5.1）。

## 13.6 错误与加载

- mutation 错误按 `code` 映射固定文案；`STALE_VIEW` → "This changed while you were looking. Review the latest version." 并自动滚动到当前提案；`PROPOSAL_BLOCKED` 用 params 中已粗化的检查渲染原因；`RATE_LIMITED` 显示可再试的日期。
- 依赖 Convex 的组件只在 Provider 存在时渲染（半配置时 `useQuery` 会抛错，F11.3）；全局与路由级 `error.tsx` 带重试。
- 所有动作结果写入 `aria-live="polite"` 区域。

## 13.7 可访问性与响应式

- 语义化 `section` + `aria-labelledby`；状态徽章同时用颜色与文字；禁用按钮旁必有文字原因；宽表放在横向滚动容器；窄屏单列。
- 审批卡在手机宽度可完整操作（FX-09：响应式审批进入 v1，原生应用不做）。
- 键盘可达：请求选项、审批按钮、披露受众选择均可 Tab 操作。

## 13.8 文案纪律

- 不出现 "AI approved"、"agreement reached"（只有人批准；执行产生的是 "change order (internal record)"）。
- provider 视图不出现买方的执行后合计、余量、上限（02 §2.6）。
- 不在产品界面里写演示提示（RA-U15）。
- 模拟房间页眉："Simulated data — quotes, budgets and people in this room are not real."
