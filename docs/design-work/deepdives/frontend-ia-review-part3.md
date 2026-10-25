# 反驳评审：前端信息架构与视图模型（part 3：问题清单续与最小改动集）

> 接 frontend-ia-review-part2.md r08。

### r09 [medium] 错误边界位置与 Next 16.4 语义
- **问题**：四个 tab 要共享同一个 `rooms.view` 订阅，`RoomViewProvider`/`RoomFrame` 最自然的位置是 `app/rooms/[roomId]/layout.tsx`；但 `error.js` 不包裹同段的 `layout.js`（error.md:96），rooms.view 抛错会越过 `[roomId]/error.tsx` 冒到上层或 global-error。§3.1 写 `reset()`，16.3 起官方推荐 `retry()`。
- **建议**：明确 Provider 放在 layout，错误边界放在 `app/rooms/error.tsx`（上一层），或在 layout 内用自建客户端错误边界包裹 Provider。"Try again"用 `retry()`。C16 改为"已核实：约定存在，`retry` 自 16.3 稳定"。

### r10 [low] `proposals.detail` 的检查版本与"当时的检查结果"矛盾，且违反 I-FE-2
- **证据**：§3.1 写"当时的检查结果"；§3.4 写 `checkedAgainstConstraintsVersion` 为查看时版本。在 rooms.view 之外重算检查也与 I-FE-2"可执行性只由 rooms.view 计算"冲突。
- **建议**：永久链接展示提案创建时存档的评估快照（标"Checked against constraints vN at creation"）；若是当前提案，只链接回工作台查看当前结论。

### r11 [low] 执行次数模型前后不一
- **证据**：`results.view.executions[]`"每轮一条"、`room.round`；而 `roomViewV.execution` 是单个对象，`derivePhase` 中 `executed` 是终态。
- **建议**：按 08/09 定"一间房最多一次执行"还是"多轮执行"；若单次，删去 executions 数组与 round 叙述；若多轮，`execution` 改为"最近一次"并让 `derivePhase` 在新一轮开始后离开 executed。

### r12 [low] `events.timeline` 合并私密事件与 privacy-disclosure PD-8 冲突
- **证据**：§3.4 `events.timeline` 返回 `audience: room | me`，"房间事件 + 本人私密事件服务端合并"；PD-8 规定 events 全部房间可见、无 visibility 字段，受限细节经 `restrictedRef` 在渲染时按查看者连接，正是为了避免分页后过滤。多维 `filter`（proposalVersion / constraintsVersion / kinds）需要各自的索引，否则页大小不均。
- **建议**：采用 PD-8；v1 只保留按 `proposalVersion` 一种筛选（有索引），其余在客户端对已加载页过滤。

### r13 [low] `RoomViewProvider` 的去重理由不成立；`rooms.listMine` 读集过大
- **证据**：C6 已证明客户端自动去重。`rooms.listMine` 要为每间房算 `todoCount` / `topTodoKind`，等于对最多 50 间房各跑一遍 rooms.view 的读取，任何一间房的写入都会让列表重算。
- **建议**：保留 Provider，但理由改为"统一 auth 门控与 null 处理"（见 r05）。`listMine` v1 只返回 `myRole`、`phase` 和"是否有待办"这类廉价字段，或由写入口维护按成员的待办计数（需 03 认可）。

## 4. 建议的最小改动集（按优先级）

1. 收紧 previewChange（r01）；删除 `projectCheckParams`，改为 audience 标注 fail-closed（r02）。
2. 槽位与待办改用 08 的 `summarizeApprovals`，补 `withdraw`（r03）；`isExecutable` 改名 `passesChecks`，错误码、返回形状、状态名对齐 08/10（r04）。
3. 房间 query 在 Convex 认证完成前 `skip`（r05）；D-FE-06 的理由改写，增加在途提示（r06）。
4. `proposalRowV` 改为判别联合，金丝雀覆盖所有服务端字符串（r08）；07 写明 verdict 区间推断（r07）。
5. 错误边界放在 layout 之上并使用 `retry()`（r09）；其余 low 项在 13-frontend 定稿时一并处理。
