# 反驳评审：前端信息架构与视图模型（part 2：问题清单 r01–r08）

> 接 frontend-ia-review.md §2。

## 3. 问题清单

### r01 [high] `constraints.previewChange` 是对他方私密约束的试探 oracle（核心 1）
- **问题**：§3.4 定义 `constraints.previewChange({ roomId, change })` 为 query，返回 `currentProposalVerdictAfter`（executable / blocked）与 `invalidatedSlots`，"用与执行相同的纯函数推演"。query 可以被任意参数反复调用且不留痕迹。只要某个可预览的变更会经过依赖他方私密值的规则（例如 provider 预览改价、customer 预览改截止日而规则要用 provider 的私密产能），调用者就能二分出 finance 的余量或 provider 的产能，约 20 次调用即可精确到美分。
- **证据**：frontend-ia-part3.md §3.4 previewChange 行；§3.8 第 3 条与 §3.10 `ConfirmConstraintChangeDialog` 对所有角色都用它；privacy-disclosure PD-2 要求"provider 永远拿不到任何预算数字或可反推它的派生值"。
- **建议**：影响对话框只展示不依赖假设性求值的内容：`nextConstraintsVersion = cv + 1`、`invalidatedSlots = 当前提案上 state 为 approved 的槽位`（任何约束变化都让它们失效，可由 rooms.view 现有数据得出）、"约束变化后将重新检查"。只有当变更发起人本来就能看到全部规则输入时（首个场景只有 finance 改预算）才返回 `verdictAfter`；其余角色返回 `{ verdict: "recheck" }`。把这一条写进 07 的威胁模型。

### r02 [high] `projectCheckParams` 默认放行，`params: v.record` 让 returns validator 失效
- **问题**：注释写"default: params of a rule derived from another party's private fact are dropped"，代码却是 `return params`；只有硬编码的 `BUDGET_RULE_KEYS = {"budget.within_cap"}` 会被清空。新增任何依赖私密值的规则（截止日、产能、第二场景）都会默认泄露。`checkResultV.params` 是 `v.record(v.string(), ...)`，任意键都能通过校验，D-FE-03 的"类型上不可表达"对这里不成立。
- **证据**：frontend-ia/projection.ts `projectCheckParams`；view-models.ts `checkResultV`；privacy-disclosure/project.ts 用 `EvalDetail{ value, audience, ownerRole }` + `canSee` 做 fail-closed 投影，两者方案冲突。
- **建议**：删除 `projectCheckParams`，改用 privacy-disclosure 的 audience 标注方案：06 的每条 check 输出 `paramsAudience`，投影时 `canSee` 不通过就丢弃，未标注的 params 一律丢弃（fail-closed）。`checkResultV` 不要 `params` 记录，改为服务端按受众渲染好的 `text` + `reasonCode`，或按 ruleKey 的判别联合。

### r03 [high] 审批槽位派生取"任意提案的最新决定"，新提案显示为 stale
- **问题**：`deriveSlotState(latest, current)` 的输入是"该座位持有者在任意提案上的最新决定"。v3 出现后，customer 在 v2 上的 approve 会让 v3 槽位显示 `stale_approved · newer proposal v3`，待办出现 `redecide_proposal`（"Your earlier decision no longer applies"），而不是 `pending` / `decide_proposal`。这与本文 §3.6 步 7"审批槽位全部 pending、待办 decide_proposal"直接矛盾，也与 versioned-approvals 的按提案汇总（`summarizeApprovals` 只读 `by_proposalId` 区间）不一致。另外 `current.proposalId === null` 时也会被判成 `newer_proposal`。
- **证据**：projection.ts `deriveSlotState`、`deriveTodos`；frontend-ia-part3.md §3.6 步 7；versioned-approvals/standing.ts `summarizeApprovals`、`DerivedApprovalState`。
- **建议**：前端专题不自带槽位派生。rooms.view 调用 08 的 `summarizeApprovals`（同一纯函数，同时供 `decide` 使用），只做投影与文案映射；"旧提案上的决定"只放在 Results 的 `DecisionRecord` 与 `/proposals/[version]` 中显示。补上 `withdraw`：槽位撤回后回到 `pending`，`DecisionControls` 需要"Withdraw my approval"入口（若 08 保留 withdraw）。

### r04 [high] 与兄弟专题的命名和语义冲突（其中一处会造成功能错误）
- **问题与证据**：
  - `isExecutable`：本文指"检查通过、待审批"（`derivePhase` 中 executable 时为 awaiting_approval；`deriveTodos` 只在 `isExecutable` 时产出 `decide_proposal`）。versioned-approvals D7 定义 `isExecutable` 为"检查通过 **且** 每个必需角色都有当前有效 approve"。若统一按 08 的定义，`decide_proposal` 永远不会出现，阶段永远到不了 awaiting_approval。
  - 过期错误码：本文 `STALE_VIEW`；versioned-approvals/decide.ts:63 与 idempotent-execution/decide.ts:93 都是 `CONSTRAINTS_CHANGED`。
  - `decide` 返回：本文 `{ ok: true, alreadyRecorded: true }`；versioned-approvals 为 `{ status: "recorded" | "unchanged" | "executed" }`。拒绝理由字段：本文 `reasonKey`，08 为 `reasonCode`。
  - 槽位状态：本文 `stale_approved / stale_rejected`；08 为 `stale_approve / stale_reject`。
  - 提案字段：本文 `basedOnConstraintsVersion`；versioned-approvals D7 特意改名为 `createdAtConstraintsVersion` 以防误用。
  - run：本文 `runStatusV` = queued / drafting / awaiting_human / failed / completed / superseded，trigger = briefs_confirmed / budget_change / rejection / human_answer；run-lifecycle/schema.ts:19-32 = negotiating / pending_approval / needs_input / failed / superseded / cancelled / confirmed，trigger = initial / constraint_change / human_answer / restart。
  - 约束变更后的走向：§3.6 步 3 写"旧 run superseded → 新 run"；versioned-approvals D6 否决了"一律 supersede + 重谈"，仍合规的提案保留并要求重新审批。
- **建议**：前端把 `isExecutable` 改名为 `passesChecks`（或 `checksPassed`），审批齐备另用 `approvals.allApproved`。错误码、返回形状、槽位状态、提案字段一律采用 08 的名字。`runStatusV` 改为 UI 派生枚举并写明从 10 的状态映射的函数，不直接透传（否则 10 增加一个状态就会让 rooms.view 的 returns 校验失败，整个工作台进错误边界）。§3.6 改成"按 09/08 决定是保留提案重新审批还是重谈"，两种分支各写一行呈现。

### r05 [medium] Clerk 未加载完时 query 以未认证身份执行，NotAvailable 会闪现
- **问题**：`ConvexProviderWithAuth` 只在 `authProviderAuthenticated` 为真后才 `client.setAuth`（`src/react/ConvexAuthState.tsx:191-200`）。此前子组件的 `useQuery(rooms.view)` 按未认证执行并返回 `null`，`RoomViewProvider` 会按设计渲染 "This room isn't available to you"，Clerk 就绪后再翻回来。§3.7 的"已登录但 Convex 未接受 token"判据没有排除 `useConvexAuth().isLoading`，每次加载都会短暂误报。
- **建议**：`RoomViewProvider` 与所有房间 query 在 `useConvexAuth().isAuthenticated` 为真前传 `"skip"`（或包在 `<Authenticated>` 里）；`null` 只在已认证后解释为"非成员或不存在"。诊断条件改为 `clerk.isSignedIn && !convexAuth.isLoading && !convexAuth.isAuthenticated`。

### r06 [medium] 断线最长约 60 秒才被检测到，"断线禁用"不可靠
- **问题**：Convex 客户端只靠服务端 Ping 超时（60s）或 socket 报错发现断线，不监听 `offline` 事件（C3 证据）。这段时间内 `isWebSocketConnected` 仍为 true，按钮可点，mutation 入队并在重连后发出。§5 的 Playwright `context.setOffline(true)` 用例是否会关闭已建立的 WebSocket 也待验证，可能等满 60 秒或永远不触发。
- **建议**：D-FE-06 的理由改为"断线禁用只是提示，正确性只靠 `CONSTRAINTS_CHANGED` / `PROPOSAL_NOT_CURRENT` 与服务端幂等"。`DecisionControls` 在 `inflightMutations > 0` 且 `timeOfOldestInflightRequest` 超过数秒时显示"Still sending your decision…"。断线 e2e 改用可确定关闭连接的方式（例如 Playwright 的 WebSocket 路由能力，API 待验证），或把阈值写进测试预期。

### r07 [medium] provider 可从历次 verdict 推断余量区间，I-FE-4 表述过强
- **问题**：provider 能看到每个提案的 `additionalCostCents` 和对应的 `rowStatus` / `budget.status`（within / over）。v2 $900 被阻断、v3 $700 可执行，就知道余量在 [$700, $900)；provider 方代理多提几个价位就能逼近。F07.1 只接受"能推断出超预算"这一最小披露，没有讨论区间收窄。
- **建议**：在 07 中明确把它列为已接受的残余推断，或对 provider 的 `proposalHistory` 只给 `superseded` / `executed` / `current`，不暴露历史行是否因预算阻断。I-FE-4 改写为"不出现可直接相减得到已承诺额的数值；verdict 序列的区间推断见 07"。

### r08 [medium] D-FE-03 的"机械可检查"被高估；validator 失配会让整个工作台进入错误边界
- **问题**：(a) 违反 D-FE-03 自身的否决项：`proposalRowV.totalAfterCents` 和 `recordsPreviewV.commitmentCents` 正是"大对象 + `v.optional` 金额字段"。`totalAfterCents` 对 provider 恰好是 F07.1 的反推陷阱（totalAfter − 已知报价 = 已承诺）。(b) 真正的风险在服务端渲染的字符串（`publicSummary`、`contextLines`、`options[].label`、`diffFromPrevious.changes`、`sharedFacts.value`、事件 `text`），validator 完全看不到。(c) rooms.view 是单一聚合，任何一处 returns 失配都会让三个角色的整个房间页抛错。
- **建议**：`proposalRowV` 做成按受众的判别联合（`{ audience: "buyer", totalAfterCents } | { audience: "seller" }`）；`commitmentCents` 直接对所有人公开或删掉（它等于对全员可见的 `additionalCostCents`，隐藏无意义）。§5 的隐私金丝雀扩展到所有服务端渲染字符串与人工请求、差异模板，作为主要的机械检查；把 C2 的实验结果作为附加防线，而不是前提。

