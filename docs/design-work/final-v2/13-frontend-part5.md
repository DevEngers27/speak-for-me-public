# 13 · 前端信息架构（part5）：交互流程、实时策略、加载与错误

> 分片见 `13-frontend.md` 顶部。

## 13.10 交互流程

### A. 审批、拒绝、撤回（`useDecide`）

```ts
// src/features/decide/useDecide.ts —— 唯一的审批调用封装
const record = useMutation(api.approvals.record);
async function decide(view: RoomView, decision: "approve" | "reject" | "withdraw", reject?: { reasonKey: string; note?: string }) {
  const p = view.currentProposal!;                        // 版本只取自同一个 rooms.view 结果（I-FE-6）
  return record({ proposalId: p.proposalId, decision,
    expectedConstraintsVersion: view.header.constraintsVersion, expectedTermsKey: p.termsKey,
    reasonKey: reject?.reasonKey ?? null, note: reject?.note ?? null });
}
// 12：返回 { status: "recorded", decision, missingRoles } | { status: "unchanged" } | { status: "executed", executionId, alreadyExecuted }
// 拒绝时 reasonKey 必填、note ≤ 500 码点；其余决定 reasonKey / note 传 null。ConvexError.data = { code, params }
```

- `recorded` → live 区 "Recorded your approval of v2. Still needed: Finance."（`missingRoles`）；`unchanged` → 与首次相同的界面（双击不是错误）；`executed` → "All approvals are in. Change order CO-1 was created." 并在头部出现 Executed，焦点不动；`alreadyExecuted: true`（最后两票并发或重复点击）→ 同一界面，不弹错误。
- 拒绝对话框见 part2 §13.5；撤回按钮只在 `myAction.canWithdraw`（part3 Δ1；未并入前按 `myAction.current === "approve"`）为真时出现。
- 进行中按钮 `aria-disabled` + "Saving…"；在途超过 3 秒显示 "Still sending your decision…"（`useConvexConnectionState().inflightMutations` 与 `timeOfOldestInflightRequest`）。

### B. 约束变更（finance 改上限、customer 改硬字段、provider 改目录价格 / 工期 / 增删 / 下架）

| 步 | 谁 / 哪里 | 发生什么 | 数据 | 失败 |
| --- | --- | --- | --- | --- |
| 1 | 发起人编辑表单 | 本地编辑；客户端判断是否触及硬字段（目录只改 `title` / `taskTemplates` 不触及） | 本地 | — |
| 2 | 点 "Review impact" | `ConfirmConstraintChangeDialog`：调用 `rooms.previewChange({ roomId, change })`（`change.kind ∈ 'cap' \| 'customer_hard' \| 'catalog'`，12 §12.17）；非 finance 得到 `recheck`：下一个版本、将失效的审批数、是否会取代当前 run（`willSupersedeRun`）——全部是 `rooms.view` 已有的信息；对话框同时用 `rooms.view` 的槽位列出将失效审批的角色与显示名；`unchanged` 时提示 "This doesn't change constraints." | `rooms.previewChange`（只读，不计节流）+ `rooms.view`（FE-D11） | — |
| 2' | 仅 finance 改上限 | `after` 分支：对话框追加 "The current proposal (v1) will no longer fit the budget (over by $100)" 或 "…will still fit"（只讲当前提案的预算检查，不讲"是否还有可行方案"）；低于已承诺时 `rejected` 分支直接显示最小允许上限 | `rooms.previewChange` 的 `verdictAfter.budgetCheck` / `overByCents` | — |
| 3 | 确认 | `budget.setCap({ roomId, capCents, expectedConstraintsVersion })` / `briefs.confirm({ ..., expectedConstraintsVersion })` / `catalog.confirm({ roomId, expectedConstraintsVersion, rows })`（批量：一次提交全部变更行，计一次节流，12 §12.12）/ `catalog.retire` | 服务端同事务 `constraints.bump` → D06 | `version.stale_constraints`（打开对话框后约束已变）；`budget.below_committed`（只 finance，显示 `params.minAllowedCapCents`）；`run.rate_limited`；`run.invalid_state`；字段级 `input.invalid` / `date.*` / `item.duplicate` / `amount.out_of_range` |
| 4 | 全部订阅者 | 同一次推送翻转（§13.11） | `rooms.view` | — |

只改标题的目录确认弹普通确认："This doesn't change constraints. Approvals stay valid."

### C. 简报页表单（`/rooms/[roomId]/brief`）

- **customer**：`RequiredItemsPicker`（已确认目录项）、`DateInput`（原生 `<input type="date">`，值即 `IsoDate` 字符串）、偏好、`notes`（"Only you and your agent see this"）、每字段 `DisclosureToggle`（默认 "Only me and my agent"）。
- **provider**：`CatalogEditor`（`useFieldArray`）：`itemKey`、`title`（码点计数复用 `core/engine/limits.ts`，≤ 80、禁 `<>\r\n`；服务端 `disclosure.blocked{ field: "title" }` → "This title contains a reserved prompt delimiter. Use a different title."）、`MoneyInput`（美元 → 整数分，`parseUsdInput` 包装 11 §11.11 的 `parseCents`，语法以其定义为准：拒绝货币符号、千分位逗号、正负号、指数记法、超过两位小数，超上限报 `amount.out_of_range`）、`leadDays`、`kind`、`taskTemplates`；行徽章 Draft / Confirmed rev N / Retired；startFollowUp 复制来的行显示 "Draft — confirm to use"；后续房间另以只读列表显示 `rooms.view.followUpOf.deliveredItems`（"Delivered in CO-{n}"，不可编辑、不可重新上架——服务端对同键 `catalog.confirm` 返回 `item.duplicate`，12 §12.6 / §12.12），customer 的 `RequiredItemsPicker` 也不列这些键。
- **finance**：`BudgetEditor`（上限 `MoneyInput`、三个对 customer 的披露开关、`notes`）；setup 阶段的 "Existing commitments" 只能录一次（`ledger.recordBaseline`）。
- `DisclosurePreview` "What others will see"：对**本人未提交的表单**用 core 中同一投影 / 模板纯函数在客户端现算（只涉及本人数据）；确认后改显示 `briefs.mine` 返回的服务端版本。
- 草稿只在内存（canon：草稿不入库）；离开有未确认修改时 `beforeunload` 提示。表单：RHF + `zodResolver`，两层 schema（界面 `FormSchema` 与 mutation 入参 `ArgsSchema`），服务端照样重新校验；`ConvexError.data.code` 映射回字段错误。
- 共享事实（`sharedFacts.add`）：只能选场景词表里的字段，值只能是日期 / itemKey[] / 枚举 / 整数分，无自由文本；`disclosure.blocked`（`field` 为共享字段时）→ "This can't be shared: it contains another participant's private information."；`disclosure.needs_own_confirmation` → 展示将公开的本人值并要求二次确认（参数由 12 定）。

### D. 结果页（`/rooms/[roomId]/results`，数据 `executions.forRoom`，一房至多一次执行，D04）

- 未执行：`WhatsInTheWay`（阶段文案 + 未批准槽位 + 在等谁），回房间链接。
- 已执行：`ChangeOrderCard`（冻结条款与明细、Execution ID `exec:…`、执行时间、"Internal record only. No payment, transfer, or e-signature."、无重发按钮）；`BudgetImpact`（判别联合：finance 完整 AIA G701 链；customer 逐字段渲染 `amountChain` 中非 null 的字段（按执行时生效的共享行，服务端已投影）；provider 无）；`TaskList`（只有被指派人可勾选，`tasks.markDone`）；`DecisionRecord`（"Used for execution" 读 `executions.approvalIds`，其他决定标 "No longer applies" / "Withdrawn" / "Rejected"，每条链接 `/rooms/[roomId]/proposals/[proposalId]`）。
- `WhyChain` "Why this result"：读 `executions.forRoom.whyChain`（服务端从不可变行组装并已按查看者投影，不从已加载的时间线页推断完整性；约束变更 → 提案不再当前 → 审批失效 → 请求回答 → 新提案 → 审批 → 执行），`href` 非空的步骤可点；代理建议以 "Seen at decision time" 侧链出现，**不作为因果边**（CRITIQUES timeline）。
- 未达成：`NoAgreementCard` "No agreement was reached. Nothing was committed." + 按查看者投影的原因行 + 出口（改我的约束 / 重新开始 / creator 关闭）。
- 已执行房间："Start a follow-up change" → `rooms.startFollowUp({ executionId })` → 跳转新房间。

### E. 时间线（`/rooms/[roomId]/timeline`）

`usePaginatedQuery(api.timeline.page, { roomId }, { initialNumItems: 20 })`，"Load older" 加载更多；筛选 chips：Everything / Decisions / Constraints / Agent runs / Private to you——12 的 `timeline.page` 是单索引单次 `paginate`、不带筛选参数，chips 全部在已加载页上客户端过滤（review r12）；新事件在顶部出现时显示 "N new events" 按钮而不自动滚动；页脚 "The log records actions, versions and outcomes, not hidden model reasoning."

### F. Guide my agent（房间页右栏 `GuidePanel`，写入 `briefs.updateSoft`）

- 本人写给本方代理的自由文本指导就是本人简报的 `softFields.notes`：提交调用 `briefs.updateSoft({ roomId, notes })`（12 §12.9，返回 `{ briefVersion }`），只生成一个只改 notes 的新简报版本——cv 不变、不弹 `ConfirmConstraintChangeDialog`、审批与披露不受影响。不提供 "Pause my agent"（canon C6 已删除 `paused`），所以只有一个提交按钮 "Save guidance"，没有 "Send and resume" / "Send, stay paused"。
- 输入框 "Tell your agent what matters"：预填 `briefs.mine.latest.softFields.notes`；码点计数复用 `core/engine/limits.ts`，NFC 后 ≤ 2,000 码点，超出时禁用提交并显示计数；服务端 `input.invalid{ field: "notes" }` 映射回该字段；清空后提交即清除 notes。
- 三个 chip 只向输入框末尾追加场景文案表中按角色固定的句子（不自动提交、不改其他字段、不含任何数值）；scope_change customer 为 "Prioritise the delivery date." / "Keep the cost low." / "Ask me before giving up wishlist items."。
- "Earlier guidance"：只读 `briefs.mine.versions[].notes`，倒序列出 notes 与前一版本不同的版本（"v3 · 10:42" + 文本，纯文本渲染），不另设 query；没有时显示 "None yet."。
- 隐私文案（固定）："Only you and your agent see this. Guidance shapes how your agent negotiates. It can't change your requirements, share anything, or approve anything."；保存成功后 live 区 "Saved. Your agent uses this from its next turn."（代理上下文每回合重建，05 §5.13）。
- 本人尚无已确认简报时面板显示 "Confirm your brief first." 并链接简报页（服务端兜底 `run.invalid_state{ guard: "brief_missing" }`）；房间 `executed` / `closed` 时面板只读（服务端 `run.invalid_state{ guard: "room_status" }`）；`run.rate_limited` 用 §13.12 的通用文案。

## 13.11 实时策略

1. **订阅拓扑**：每个房间页至多 4 个订阅：`rooms.view`（`[roomId]/layout.tsx` 中的 `RoomViewProvider` 订阅一次，经 context 下发；理由是统一 auth 门控与 null 处理——Convex 客户端本就对相同参数去重，review C6 / r13）+ 页面专属至多 2 个（简报页 `briefs.mine` + `catalog.list`；结果页 `executions.forRoom`；永久链接 `proposals.get`）+ 至多 1 个分页列表（`timeline.page`；本方代理笔记 `turns.mine` 折叠时 `"skip"`）。
2. **认证门控**：全部房间 query 在 `useConvexAuth().isAuthenticated` 为真前传 `"skip"`（FE-D13）。
3. **一致性**：关键判断只来自 `rooms.view`；其他 query 若带 `constraintsVersion` 且与 `rooms.view.versions` 不同，组件显示 "Updating…" 占位，不混合渲染。
4. **变化提示**：`useVersionWatch(view)` 用 `useRef` 记住本会话上次渲染的 `constraintsVersion` / `proposalVersion`；变大时显示 `ConstraintChangeBanner`（内容取 `timeline.page` 最新一条 `constraints_changed` 的按查看者渲染文本，刷新后可重现；"你的审批已失效"由本人槽位 `stale_approve` 得出）、向 `aria-live="polite"` 播报一句、卡片高亮 2 秒（`prefers-reduced-motion` 时只改边框）。"是否看过"只在会话内存，不写服务端。
5. **对话框中的翻转**：确认按钮立即 `aria-disabled`，对话框内出现 "Constraints changed to v3 while you were reviewing. Review again before deciding."，焦点移到该句。
6. **竞态兜底**：界面来不及翻转时，提交得到 `approval.stale`，显示同一句提示，不自动重试。
7. **断线**：`useConvexConnectionState()` 的 `isWebSocketConnected === false && hasEverConnected` → `ConnectionBanner` "Reconnecting… Live updates are paused."；静默断网可能约 60 秒才被察觉，所以这只是提示。
8. **不持久化私密数据**：不把任何 query 结果写入 localStorage / sessionStorage；只记 UI 偏好（折叠、上次页签）。

**$4,800 三窗口翻转时序**（前提：v1 $900 当前，customer、provider 已批准，finance 未批，约束 vC）：

| 步 | 谁 / 哪里 | 发生什么 | 读写 | 失败与状态 |
| --- | --- | --- | --- | --- |
| 1 | finance，My brief · Budget | 输入 $4,800 → "Review impact" | `rooms.previewChange({ roomId, change: { kind: 'cap', newCapCents: 480000 } })` → `after { verdictAfter: { proposalVersion: 1, budgetCheck: 'budget.over', overByCents: 10000 }, invalidatedApprovals: 2, willSupersedeRun: true }`；`rooms.view` 槽位列出将失效：Customer、Provider | 输入非法在前端先提示，服务端仍校验 |
| 2 | finance 对话框 | "Constraints become vC+1. Proposal v1 will no longer fit the budget (headroom after: $800). Approvals by Maya (Customer) and Leo (Provider) will no longer apply. Agents will renegotiate automatically." → "Change budget cap" | — | 断线时按钮 `aria-disabled` |
| 3 | Convex | `budget.setCap` 单事务：鉴权 finance → 新 finance 简报版本 → `constraints.bump`（cv+1、修订记录）→ 当前 run `superseded`、v1 `stale`、open 请求 `superseded` → 不动点内新 run 预检（v1 不再通过）→ `negotiating` → `turns.beginAttempt` → `events.append` | 见 09 / D06 | `budget.below_committed` / `run.rate_limited`：整体回滚，界面不变 |
| 4 | 三个浏览器 | 同一提交触发 `rooms.view` 对三位订阅者重算并推送 | — | — |
| 5a | customer | v1 "No longer current"（历史提案只显示存储状态、不重算检查，§13.9.2）；自己槽位 `stale_approve`；横幅 "Finance updated a budget constraint · cap $5,000 → $4,800"（`capCents` 已披露） | — | — |
| 5b | provider | 横幅 "Constraints changed"；v1 "No longer current"；自己槽位 `stale_approve`；**页面上没有任何金额** | — | — |
| 5c | finance | 横幅带 $5,000 → $4,800；历史行 v1 只显示存储状态 `stale`（不重算 "over by"，§13.9.2）；`BudgetPanel` 显示上限 $4,800、已承诺 $4,000、余量 $800（Δ2 并入后另显示 `status: no_proposal`） | — | — |
| 6 | 三个窗口 | `RunProgress` "Round 1 · Provider's agent drafting (attempt 1)" | — | 回合失败 → `agent_failed` 请求给失败方 |
| 7 | 稍后 | v2 $800 进入 `pending_approval` → 三方待办 `decide_proposal`、槽位 pending；迟到的旧回合被拒 → "1 late reply discarded" | — | — |

步 5 不等任何模型调用；阻断由 `rooms.view` 读时派生。播报（polite，按受众）：customer / provider "Constraints changed to version C+1. Proposal 1 is no longer current. Your approval no longer applies."；finance 无最后一句。

## 13.12 加载、错误与空状态

| 状况 | 判定 | 显示 |
| --- | --- | --- |
| Clerk 加载中 | `<AuthLoading>` | 顶栏骨架 |
| 未登录 | `<Unauthenticated>`（`proxy.ts` 已对 `/rooms(.*)` 执行 `auth.protect()`，`(app)` 布局兜底） | 登录按钮 |
| 已登录但后端未接受 | `clerk.isSignedIn && !convexAuth.isLoading && !convexAuth.isAuthenticated` | "Signed in, but the backend did not accept your session. See /setup." |
| query 加载中 / 被 skip | `useQuery` 返回 `undefined` | 区块骨架，保留高度 |
| query 返回 null | 已认证后：非成员 / 不存在 | `NotAvailable`（不区分两者） |
| query 抛错 | 默认 `useQuery` 抛给错误边界 | `app/(app)/rooms/error.tsx`："Something went wrong loading this room." + "Try again"（`retry()`）；不显示详情 |

**错误码 → 文案**（浏览器只收 `ConvexError({ code, params })`，`params` 已按受众投影；前端从不显示原始 message，D16）：

| code | 位置 | 文案 |
| --- | --- | --- |
| `approval.stale` | 动作旁 + live 区 | "Constraints or terms changed while you were reviewing. Nothing was recorded. Review the current version before deciding." |
| `approval.not_current` | 同上 | "A newer proposal replaced this one." |
| `approval.not_executable` | 同上 | "This version doesn't pass the current checks." + 检查清单失败项 |
| `approval.already_executed` | 不弹错误 | 订阅已显示 Executed（重复 approve 则返回 `executed{ alreadyExecuted: true }`，不是错误） |
| `version.stale_constraints` | 约束变更对话框 | "Constraints changed while you were editing. Review the latest version and try again." |
| `request.not_open` / `request.option_unknown` | 取舍卡 | "This request was closed (constraints changed, it expired, or it was already answered)." |
| `invite.invalid` / `invite.email_unverified` / `invite.seat_taken` / `invite.already_member` | 邀请页 / 收件箱 | "This invitation is no longer valid." / "Verify your email to accept this invitation." / "This seat is already taken." / "You already hold a seat in this room." |
| `auth.*`（`unauthenticated` / `not_member` / `role_forbidden` / `not_creator`） | live 区 | 登录提示或 "You can't do this in your role." |
| `input.invalid` | 表单字段 | 按 `params.field` 定位字段 |
| `approval.missing_role` / `approval.self_conflict` | live 区 | "You can't decide this in your role."（记作前端 bug） |
| `budget.below_committed` | finance 预算表单 | "The cap can't be lower than committed spend ($4,000.00)."（金额来自 `params.minAllowedCapCents`，只 finance 收到） |
| `run.rate_limited` | live 区 | "Too many changes in this room right now. Try again later."（节流桶有 1 小时与 24 小时两种窗口，不写"last hour"；有 `params.retryAfterMs` 时显示可重试时间） |
| `run.invalid_state` | live 区 | "This can't be done now — the room is executed or closed, or the negotiation moved on." |
| `run.draining` | 横幅 | "Agents are paused for maintenance." |
| `disclosure.blocked` / `disclosure.needs_own_confirmation` | 共享事实表单；目录编辑器（`field: "title"`） | 见 §13.10 C |
| `date.*` / `item.unknown` / `amount.out_of_range` | 表单字段 | 字段级说明；焦点移到第一个错误字段 |
| `internal` / 未知码 | live 区 | "Something went wrong. Nothing was changed." |

**空状态**（按阶段，不编造）：`/rooms` 无房间 → "You're not in any rooms yet. Ask a room owner to invite you, or create a room."；提案区 `setup` → 按 `header.phase` 的 `gaps` 逐项列出缺口与负责角色（例 "Waiting on setup: Provider — confirm brief; Finance — record existing commitments. Negotiation starts automatically when the last one is done."），不写固定的 "2 of 3 briefs"；`negotiating` 无提案 → "Agents are negotiating (round 1). The first proposal appears here."；待办为空 → "Nothing needs you right now. Waiting on: Provider."；代理笔记为空 → "No notes yet. Notes appear only when your agent actually writes them."；结果页无执行 → `WhatsInTheWay`；共享事实为空 → "No one has shared anything with you yet."
