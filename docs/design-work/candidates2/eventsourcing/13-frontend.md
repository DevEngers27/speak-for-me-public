# 13 前端信息架构（事件溯源候选）

## 1. 页面

| 路由 | 内容 | 数据源 |
| --- | --- | --- |
| `/` | 登录入口、产品说明（含"不转账、不签约"的执行边界） | 静态 |
| `/setup` | 诊断：`useConvexAuth()`、`health.viewer`、publishable key 解码出的 Frontend API 主机 | health.viewer |
| `/invite/[token]` | 接受邀请（显示房间标题与将获得的角色，填写显示名） | invites.accept |
| `/rooms` | 我的房间卡片：角色、待办数、当前状态 | rooms.listMine |
| `/rooms/[roomId]` | **工作台**：置顶 "Decisions needed from you"；当前提案卡；审批面板；协商进度（每个代理的回合状态）；人工请求卡；阻断说明 | rooms.view |
| `/rooms/[roomId]/brief` | 我的私密简报：结构化表单、逐项 "Visible to other parties" 勾选、"What the room can see" 预览（服务端按披露模型生成）、确认版本历史 | briefs.mine、briefs.statuses |
| `/rooms/[roomId]/catalog` | provider 确认报价（确认提示 "Visible to everyone in the room"；改价即新版本） | rooms.view |
| `/rooms/[roomId]/history` | **时间线**：按 seq 的事件流（模板文本、角色徽章、simulated 徽章）；版本对比表；"Constraints history"（约束事件子序列） | timeline.page、audit.constraintsAt |
| `/rooms/[roomId]/results` | 变更单、任务（provider 可标记完成）、预算影响（买方）、"How we got here" 追溯链 | rooms.view、audit.trace |
| `/rooms/[roomId]/agents` | 我的代理：本角色回合的 rationale、clarify 问题、用量 | turns.mine |

不提供"单浏览器角色切换器"（RA-U13 否决）；身份只来自 Clerk。

## 2. 关键组件与文案

| 组件 | 要点 |
| --- | --- |
| ProposalCard | 条款、来源（itemKey@version）、derivedStatus 徽章、"Checked against constraints v{n}"、按角色的预算行（买方："+$900 change / $4,900 committed after approval / $4,800 cap / over by $100"；provider："+$900 · Blocked: exceeds the finance limit"）、"Agent recommendations are not approvals" |
| ApprovalPanel | 每个必需审批：pending / approved / rejected / stale（"Approved under v6 — no longer counts"）/ stale_reject；按钮按 kind："Accept terms v3" / "Approve budget commitment v3"；禁用时旁边写原因码对应文案 |
| RunProgress | "Provider agent drafting…"、"Customer agent reviewing…"；failed 时 "Retry turn"；stub 回合徽章 "Rule-based (no model)" |
| HumanRequestCard | 仅目标角色可点选项；其他人看到"Waiting for {role}" |
| BudgetForm（finance） | 美元输入 → 整数美分；必填 reason；提交后立刻看到旧提案翻转 blocked |
| Timeline | 每条事件可展开"caused by #seq"；私密事件（只有本人可见的那些）带锁形徽章 |
| SimulatedBadge | 任何 simulated 行/事件："Simulated" / "Seeded fixture" |

## 3. 实时更新策略

- 每个页面一个聚合订阅（`rooms.view`），保证同一时刻的一致快照；时间线用分页 `timeline.page`（向前加载更早事件）。
- 审批、执行、预算变更**不做乐观更新**，以服务端提交与订阅回推为准（inputs/04 §5）。
- 表单提交按钮在请求期间禁用，并为每次提交生成新的 `commandId`；网络重发由 Convex 客户端安全重放。
- Server Component 只做外壳；如需预取用 `preloadQuery(..., { token })`，其结果同样来自已投影的 query。

## 4. 错误与加载

- `useQuery` 返回 `undefined` → 骨架屏；返回 `null` → "You are not a member of this room"。
- `ConvexError.data.code` → 文案映射表（不含数字）；未知错误 → 通用提示 + 客户端 `error.tsx` 重试。
- Provider 未挂载（缺配置）时不渲染依赖 Convex 的组件，显示 "Backend not configured. See /setup."。

## 5. 可访问性

- 状态不只靠颜色：徽章带文字；阻断原因以文本呈现。
- 时间线与审批面板用语义化列表与 `aria-live="polite"` 通告"Proposal v3 is now blocked"。
- 所有按钮有可见焦点；金额读屏格式 "nine hundred dollars"（`Intl.NumberFormat`）。
- 日期以房间时区显示并标注时区缩写。
