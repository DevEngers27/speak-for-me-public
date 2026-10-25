# 13 前端信息架构

## 13.1 页面

| 路由 | 内容 | 主要数据 |
| --- | --- | --- |
| `/` | 我的房间列表（角色、阶段、是否需要我） | `rooms.listMine` |
| `/join/[code]` | 接受邀请 | `invites.accept` |
| `/rooms/new` | 建房 | `rooms.create` |
| `/rooms/[roomId]` | 角色工作台（默认） | `rooms.view`、`runs.progress`、`humanRequests.mine` |
| `/rooms/[roomId]/brief` | 我的私密简报 + "房间将看到什么" | `briefs.mine` |
| `/rooms/[roomId]/catalog` | 报价目录（provider 可编辑） | `catalog.list` |
| `/rooms/[roomId]/agent` | 我的代理：本方回合、理由、用量 | `turns.mine` |
| `/rooms/[roomId]/history` | 版本对比、事件时间线、变更单追溯 | `proposals.list`、`events.list`、`changeOrders.get` |

## 13.2 角色工作台布局
1. 置顶 "Decisions needed from you"：服务端按查看者生成的待办（批准 vN、回答请求、确认简报）。
2. 协商进度条：run 状态 + 每个代理的回合状态（"Provider agent drafting…"），不做 token 流式。
3. 当前提案卡：条款、来源（目录修订号）、检查清单（"Checked against constraints v{n}"，按角色裁剪）、displayState 徽章（Current / Blocked / Stale / Executed）、按钮 "Accept terms v3 (constraints v2)" 或 "Approve budget commitment v3"，旁注 "Agent recommendations are not approvals."。
4. 预算块：只有买方渲染；provider 看到的是 "+$750 · Within the finance limit / Blocked: exceeds the finance limit"。
5. 审批面板：每个必需角色 approved / declined / pending / stale（旧约束版本的决定显示为 stale，不计数）。
6. 公共时间线（模板文本），"Simulated" 徽章跟随 isSimulated 与 driverMode。

## 13.3 实时更新策略
- Server Component 只做外壳与登录检查；所有房间数据在 Client Component 中通过 `useQuery` 订阅。不使用 `preloadQuery` 传递任何私密数据给 props（即使已投影，也避免两条路径）。
- `rooms.view` 是聚合查询，保证一个窗口内各块来自同一快照；时间线用 `usePaginatedQuery`。
- 审批、执行、预算更新不做乐观更新，以服务端结果与订阅回推为准；按钮在 mutation 进行中禁用，防双击（服务端仍幂等）。

## 13.4 错误与加载
- `useQuery` 返回 `undefined` → 骨架屏；返回 `null` → "You don't have access to this room"。
- mutation 错误按 `ConvexError.data.code` 映射到本地化文案；文案表不含任何数值占位。
- run paused：显示原因与 "Retry turn"（调用数剩余量）；needs_input：显示等待谁（非目标角色）或问题卡（目标角色）。

## 13.5 可访问性
- 状态徽章同时用文字与图标，不只靠颜色；Blocked 原因是可读文本。
- 进度更新用 `aria-live="polite"` 区域播报回合状态变化。
- 所有按钮带版本号的完整可访问名称（"Accept terms for proposal version 3 under constraints version 2"）。
- 键盘可达：问题卡选项是单选组 + 确认按钮。
