# 13 前端信息架构

## 1. 页面

| 路由 | 内容 | 数据 |
| --- | --- | --- |
| `/` | 产品说明、登录 | — |
| `/setup` | 诊断：`useConvexAuth()`、`health.viewer`（未登录 skip）、publishable key 解码出的 Frontend API 主机 | health.viewer |
| `/rooms` | 我的房间列表（角色、阶段、Simulated 徽章）、创建房间 | rooms.listMine |
| `/join/[token]` | 认领席位（显示角色，填显示名） | seats.claim |
| `/rooms/[roomId]` | **工作台**（下） | rooms.view |
| `/rooms/[roomId]/brief` | 我的简报：结构化表单 + 逐项披露 + "What the room can see" 预览 + 确认提示（将失效的审批数） | rooms.view（myBrief、catalog、pendingInvalidation） |
| `/rooms/[roomId]/results` | 变更单、任务、预算影响（仅买方）、审批记录、派生时间线 | rooms.view、rooms.timeline |

去掉 Role A 的 "Preview as"、重发执行按钮、demo 文案（RA-U12/U13/U15）。真实身份下不做单浏览器角色切换。

## 2. 工作台布局（自上而下）

1. **Decisions needed from you**：我的待批提案（带版本号按钮）、我的人工请求卡片（选项按钮 + "Edit my brief instead"）、失败回合的 "Retry turn"。为空时显示 "Nothing needs you right now"。
2. **Negotiation status**：run #n、round r/3、当前回合 "Customer agent evaluating v3…"、waitingOn。
3. **Current proposal 卡**：条款（items、deferred、$、date）、"Checked against constraints v{n}"（不写 "Matches current constraints"）、可执行性与按角色措辞的阻断原因、审批面板（approved / rejected / pending / invalidated）、"Agent recommendation — not an approval" 标签。
4. **Version table**：v1…vn，状态 current/superseded/executed，金额列（买方另有 committed-after 列）。
5. **My agent's reasoning**（折叠，仅本角色回合）：每回合 action、rationale、用量摘要；没有就空着，不伪造。
6. **Timeline**（折叠）：派生时间线。

## 3. 实时更新策略

- 工作台与简报页都订阅同一个 `rooms.view`；约束一提交，所有窗口同一刻翻转（阻断不等模型）。
- 审批、回答、确认都不做乐观更新；按钮在 mutation 进行中禁用，结果以订阅回推为准（防双击由服务端保证，前端禁用只是体验）。
- Server Component 只渲染外壳；`preloadQuery` 若使用必须带 Clerk token，返回值同样来自投影后的 query。

## 4. 表单细节

- 美元输入 → `Math.round(parseFloat(x) * 100)` 后由服务端 `assertCents` 再校验；日期用 `<input type="date">`，服务端 `assertIsoDate`。
- customer：itemKey 勾选为 required / wanted（来自公开目录）；provider：目录行编辑（itemKey 只在新增时可填）；finance：两个金额 + 变更原因（非首版必填）+ changeCode 下拉。
- 每个可披露字段旁 "Visible to: …"；provider 目录上方公开提示；底部列出"你的代理可能对他方说的话"。
- 抽取（粘贴文本 → 草稿）v1 不做（17 号）。

## 5. 错误与加载

- `useQuery` 为 `undefined` 时骨架屏；为 `null` 时显示 "You don't have access to this room"。
- `ConvexError.code` → 本地化文案表（不含数字）；未知错误走 `error.tsx`（带重试）。
- Provider 只在配置完整时挂载；半配置状态显示 /setup 指引。

## 6. 标注与诚实

- 房间 `simulated` → 顶部横幅 "Simulated data: quote and budget are fixtures"；stub 回合与提案 → "Simulated agent"；变更单 → "Internal record — no payment or contract is created"。

## 7. 可访问性

- 状态不只用颜色：每个徽章带文字（Blocked / Invalidated / Current）。
- 实时变化区域 `aria-live="polite"`（回合状态、阻断翻转）。
- 按钮文案含版本："Accept terms for v3"；键盘可达；对比度 ≥ 4.5:1。
