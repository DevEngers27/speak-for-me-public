# 13 前端信息架构

> 默认展示结论、阻塞和需要你做的决定，详细的代理活动可展开（V-11）。四类信息需求（房间、我的私密简报、工作台、结果与历史）沿用原方案与 Role A 的 IA（RA-U01），身份全部来自 Clerk，不做"Preview as"角色切换（RA-U13）。

## 13.1 路由

| 路由 | 用途 | 主要数据 |
| --- | --- | --- |
| `/` | 公开首页（"Independent goals. Shared decisions."；三步：Set your boundaries / Compare proposals / Approve the outcome） | — |
| `/rooms` | 我的房间：卡片带待办徽标（确认简报、待我审批、待我回答、我的旧审批已失效）；新建房间（标题、目标、场景、时区、我的角色） | `rooms.listMine` |
| `/join/[token]` | 接受邀请：显示房间标题、我将担任的角色、过期时间 → "Join as Finance" | `invites.accept` |
| `/rooms/[roomId]` | 工作台（13.2） | `rooms.workspace`、`events.list`、`requests.mine` |
| `/rooms/[roomId]/brief` | 我的私密简报（13.3） | `briefs.mine`、`briefs.disclosurePreview`、`catalog.list` |
| `/rooms/[roomId]/results` | 结果与历史（13.4） | `results.view`、`decisions.forProposal`、`events.list` |
| `/rooms/[roomId]/runs/[runId]` | 某次协商的完整回合与尝试记录（透明度与排障） | `runs.timeline` |
| `/rooms/[roomId]/settings` | 参与者与邀请（创建者）、用量与估算成本、关闭房间 | `invites.listForRoom`、`usage.roomSummary` |
| `/setup` | 诊断页（开发环境，或房间创建者）：Convex 是否接受 Clerk token、从 publishable key 解析的 Frontend API 主机、代理模式与熔断状态（F13.4） | `health.viewer`、`health.status` |

页面外壳是 Server Component；所有房间数据在 Client Component 里通过 Convex 订阅获得。若使用 `preloadQuery`，它调用的也是同一组已投影的查询（inputs/04 §5.1）。

## 13.2 工作台（各角色共用一个页面，内容按投影不同）

自上而下：

1. **房间头**：标题、目标、"Proposal v3 · Constraints v8" 常驻（RA-D03）、状态徽章（颜色 + 文字）、`isSimulated` 横幅 "Simulated data"、代理不可用横幅（熔断或总开关）。
2. **Decisions needed from you**（服务端 `todos`）：例如 "Approve the budget commitment for v3"、"Your approval of v2 no longer applies (constraints changed)"、"Answer Finance's question"、"Confirm your brief"。没有待办时："Nothing right now. Waiting on Customer."
3. **就绪清单**（未就绪时）：每项写明负责的角色（"Waiting for Finance to record committed spend"）。
4. **协商进度**（`liveRun`）：每个角色一行——"Provider agent drafting…"、"Retrying (attempt 2 of 3)"、"Taking longer than usual"（客户端根据 `startedAt` 与该类回合的 p95 计时）、"Recommended accepting v3"、"No recommendation (agent unavailable)"；run 结局说明（例如 "Agents did not converge after 3 rounds"）；failed 时显示 "Retry"（`runs.resume`）与提议方专属的 "Choose an option manually"。
5. **当前提案卡**：作者徽标（"Provider agent" / "Provider (manual)" / "Simulated agent"）；模板摘要；条款（条目、延后项、交付方式与日期、变更金额）；`budgetLine`（买方与 provider 两套文案，F07.1）；检查清单，标题 "Checked against constraints v8 on 2026-11-05"，每项 Pass / Blocked + 按查看者渲染的原因；**批准后将创建的记录**预览（变更单、承诺、任务）；审批面板（每个必需角色一行：approved / rejected / pending / stale_approve / stale_reject / withdrawn，stale 带解释）；我的按钮——"Accept terms of v3" 或 "Approve budget commitment for v3"、"Reject…"（打开理由码 + 可选备注 + 备注可见性），按钮旁始终有说明："Your approval applies only to v3 under constraints v8. An agent's recommendation never counts as approval."；不可批准时按钮禁用并在旁边写明原因。
6. **人工请求卡**（目标为我）：问题（模板）、选项按钮；`edit_constraints` 选项打开对应编辑器；`propose_manually` 打开候选列表。
7. **Options**（候选列表）：全体可见；提议方在允许手动提案时每行有 "Propose this option"。
8. **Compare proposals**：版本表（Executed / Superseded / Blocked / Current，带 `aria-current`），金额列只显示变更金额；买方额外显示执行后已承诺额（RA-U04）。
9. **Agent activity**（默认折叠）：本 run 的公开回合结果；我的代理的私密理由带 "Only you can see this"；"The log records actions and outcomes, not hidden model reasoning."

## 13.3 我的私密简报

- 结构化编辑器（字段由场景声明）：customer 从请求范围中勾选必需 / 重要项、截止日、首选日；provider 编辑交付偏好与**目录**（每个条目单独 "Confirm item"，确认后锁定，改价即新版本，提示 "Confirmed items and prices become visible to everyone in this room"）；finance 的**预算面板**（"Update budget cap"：金额 + 原因 + 影响预览）与"记录基线承诺"。
- 每个可选受众的字段旁：Visible to: Only me / Customer & Finance / Everyone。
- 草稿自动保存；"Confirm brief v3" 单独按钮。确认前若规则字段有变化，显示影响预览："This changes constraints (v8 → v9). Current approvals on v3 will no longer apply."
- 侧栏："What others can see"（服务端生成）、他方简报只显示版本与确认时间、委托条款全文、"Extract from pasted text"（结果逐项 "Apply to draft"，仍需确认）。

## 13.4 结果与历史

- 变更单卡（固定文字 "Internal record. Not a contract. No payment or signature is created by this system."）：基于提案 vN · 约束 vM、批准条目、延后项、交付、变更金额、记录时间、operation key；买方另见预算影响快照（执行前 / 本次 / 执行后 / 上限，读快照而非减法）。
- 任务：被指派角色可改状态（todo / in progress / done）。
- 审批记录：全部决定（含撤回、旧拒绝），标签 "Used for execution / Current / No longer applies"。
- 约束变更历史：每个版本一行（原因、角色、对当时提案的影响），数值按投影。
- 事件时间线：按提案版本、约束版本筛选；从变更单可一路点到批准它的决定、提案、条目版本、约束版本（核心 6）。

## 13.5 实时、加载与错误

- 一个聚合订阅（`rooms.workspace`）保证同一窗口内各区块来自同一快照；预算一提交，所有窗口同一次推送翻转为 Blocked（F13.1）。
- 审批、确认、执行**不做乐观更新**（inputs/04 §5.1）：按钮进入 pending，结果以订阅推送为准。
- `STALE_VIEW`：提示 "This changed while you were looking. Review the updated version." 并保持滚动位置；其余 `ConvexError` 码映射为人话（不含他方数值）。
- `useQuery` 为 `undefined` 显示骨架；为 `null` 显示"你不是该房间成员或尚未登录"。每个路由段有 `error.tsx`（带重试）；依赖 Convex 的组件只在 Provider 存在时渲染（F11.3）。

## 13.6 可访问性与响应式

语义化 `section` + `aria-labelledby`；mutation 结果与 run 状态变化放在 `aria-live="polite"` 区域；`aria-current` 标记当前 tab 与当前提案行；状态徽章颜色 + 文字；禁用按钮旁必有文字原因；预算条 `role="img"` 且 `aria-label` 按查看者投影；宽表放横向滚动容器；窄屏单列，审批卡在手机上完整可用（FX-09）。产品界面不出现任何演示脚本文案（RA-U15）。
