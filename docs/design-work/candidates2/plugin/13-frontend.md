# 13 前端

## 1. 页面

| 路由 | 内容 | 数据 |
| --- | --- | --- |
| `/` | 我的房间列表、"needs you" 徽章 | `rooms.listMine` |
| `/join/[token]` | 接受邀请（显示角色与房间标题） | `invites.accept` |
| `/rooms/[roomId]` | 角色工作台 | `rooms.view`（单一订阅） |
| `/rooms/[roomId]/brief` | 我的私密简报 + "What the room can see" 预览 | `briefs.mine`、`briefs.disclosurePreview` |
| `/rooms/[roomId]/outcome` | 变更单/文档、任务、审批记录（打印视图） | `outcome.view` |
| `/setup` | 配置诊断（Clerk/Convex 是否互认） | `health.viewer` |

## 2. 工作台布局（引擎组件 + 插件 slot）
1. **Decisions needed from you**（置顶，来自 `rooms.view.todo`，服务端按 viewer 计算）：待你审批的 v{seq}、待你回答的请求、失败回合的 "Retry turn"。
2. **Current proposal** `ProposalCard`：插件 slot `proposalTerms` + 检查清单（文案 "Checked against constraints v{n}"）+ 预算行（买方/他方两种模板）+ "Records that will be written"预览 + 按 kind 的按钮 "Accept terms" / "Approve budget commitment" + 固定说明 "Agent recommendations are not approvals"。
3. **Run progress**：每个角色一个状态点（drafting / reviewing / done / failed），stub 回合显示 "Simulated agent"。
4. **Approvals panel**：每席位 pending / approved / rejected / stale_approved / stale_rejected；旧决定保留可展开。
5. **Version history**：v1…vn 表（Executed / Superseded / Blocked / Current），金额列经投影。
6. **Timeline**：`events.list`，模板渲染，私密事件带 "Only you" 徽章。
7. **My agent**：`turns.mine` 的 rationale（"Visible only to you"）。

## 3. 实时策略
- 所有窗口订阅同一个 `rooms.view`；预算提交后同一刻翻转 Blocked，不等模型。
- 审批、执行、回答不做乐观更新，以订阅回推为准；按钮在 mutation 进行中禁用（防连点，后端仍幂等）。
- 服务端组件只做外壳；若用 `preloadQuery`，它与 `useQuery` 同样只拿投影后的数据。

## 4. 错误与加载
- `useQuery` 为 `undefined` 时骨架屏；`null` 显示"无权访问或未登录"。
- `ConvexError.code` → 本地化文案表（不显示服务端 message）；客户端 `error.tsx` 带重试。
- Provider 未配置时不渲染依赖 Convex 的组件，显示 "Backend not configured. See /setup."。

## 5. 诚实与可访问性
- `simulated` 房间顶栏常驻 "Simulated data" 标签；目录条目 "Simulated quote"；seed 提案 "Seeded"。
- 不做单浏览器角色切换器（身份只来自 Clerk）。
- 状态不只靠颜色（图标 + 文本）；按钮有含版本号的可访问名称（"Approve budget commitment for v2"）；时间线 `aria-live="polite"`；金额以 `Intl.NumberFormat` 按房间币种显示，日期按 UTC 渲染日历日。
