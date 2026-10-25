# 13 前端信息架构

## 1. 页面

| 路由 | 内容 | 数据源 |
| --- | --- | --- |
| `/rooms` | 我的房间（标题、我的角色、状态、"需要你处理"计数） | `rooms.listMine` |
| `/rooms/new` | 建房表单 | `rooms.create` |
| `/invite/[token]` | 接受邀请 | `invites.accept` |
| `/rooms/[roomId]` | 角色工作台（默认页） | `rooms.view`、`requests.mine`、`turns.mine` |
| `/rooms/[roomId]/brief` | 我的私密简报：草稿表单、逐项 "Visible to the room" 开关、"What the room can see" 预览（服务端投影生成） | `briefs.mine` |
| `/rooms/[roomId]/catalog` | provider 编辑报价；他方只读 | `catalog.list` |
| `/rooms/[roomId]/ledger` | 买方：余额条、上限修订、承诺台账（逐行可展开到变更单→提案→签字）、当前提案影响预览、对账结果（finance） | `budget.ledger`、`budget.reconcile` |
| `/rooms/[roomId]/history` | 版本对比表（Executed / Superseded / Blocked / Current）、约束变更时间线、事件 | `rooms.view`、`events.list` |
| `/rooms/[roomId]/change-orders/[n]` | 变更单、任务、签字记录、"Internal record only"；打印视图 | `changeOrders.get` |

## 2. 工作台布局（按角色）

1. **Decisions needed from you**（置顶，服务端按查看者计算）：待签字、待回答请求、失败回合重试。
2. **Current proposal 卡片**：版本号、条目、延后项、变更金额、交付日、"Checked against constraints v{n}"、检查清单（投影后的 reasonCodes）、签字面板（每角色：approved / rejected / stale / stale_reject / withdrawn / pending）、按钮 "Accept terms v{n}" 或 "Approve budget commitment v{n}"（传 `expectedContentKey`）、"Agent recommends — this is not an approval"。
3. 买方额外：**Budget impact** 行 "+$900 change / $4,900 committed after approval / $5,000 limit / $100 headroom after"；provider 只见 "+$900"。
4. **Negotiation progress**：run 序号、轮次、每个回合的状态（"Provider agent choosing…"），本角色可展开 rationale。
5. finance 额外：**Change limit** 表单（新上限、原因必填、显示最低允许值 = 已承诺）。

## 3. 实时策略

- 全部实时数据用 `useQuery` 订阅已投影的 query；一个房间页只订阅 `rooms.view` + 少量按角色 query，保证同一快照。
- 签字、执行、改预算不做乐观更新；按钮在 mutation 在途时禁用，结果以订阅推送为准。
- 收到 `RUN_NOT_PENDING` / `STALE_PROPOSAL` / `CONTENT_MISMATCH` 时显示 "This proposal changed — review the current version"，不弹通用错误。
- Server Component 只做外壳；若 SSR 预取，用 `preloadQuery(..., { token })`，返回值同样是投影后的 DTO。

## 4. 错误、加载、标注

- `useQuery` 为 undefined 时骨架屏；null（未登录 / 非成员）跳转。
- 所有 `simulated` 数据显示 "Simulated" 徽章（报价、期初承诺、stub 回合、seed 房间横幅）。
- 金额统一 `formatCents`；输入用 `parseDollarsToCents`，非法输入就地提示，不四舍五入猜测。

## 5. 可访问性

- 状态不只靠颜色：Blocked / Stale 带文字与图标；签字面板用表格语义。
- 实时变化（提案被阻断、请求到达）用 `aria-live="polite"` 区域播报。
- 所有按钮带版本号文字，避免"批准"指代不明；键盘可达；对比度 ≥ 4.5:1。
