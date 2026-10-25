# 13 · 前端信息架构（part2）：房间页、决策页、取舍页、角色差异

> 分片见 `13-frontend.md` 顶部。

## 13.4 房间页 `/rooms/[roomId]`

**头部（`RoomHeader`，sticky，所有房间子页共用）**：← Rooms · 房间标题 · `SimulatedBadge`（`room.provenance !== 'live'`）· `VersionTag` "Proposal v2 · Constraints v2 · Viewing as Customer"（`proposalVersion` 为 null 时显示 "No proposal yet"）· `PhaseBanner`（一句状态 + why，例 "Awaiting human approval of v2 under constraints v2"）· 右侧 "Needs you" 列表（每条带直达 CTA）或 "Waiting on: Finance (decision on v2)" · 页签 Room / My brief / Results / Timeline / People（`aria-current="page"`）· `ActionResultLive`（`aria-live="polite"`）。

**三栏（≥ 1280px）**：

| 栏 | 区块（自上而下） | 数据（`rooms.view` 片段，除注明外） |
| --- | --- | --- |
| 左："What I know" | `MyBriefSummary`（本人值，私密区视觉：米黄底 + 斜纹 + 锁，每条标 "Private" / "Shared with Finance"）；`DisclosureMirror` "What others can see from you"；`SharedWithYou`（别人披露给我的 `sharedFacts`）；`BudgetPanel`（finance：`owner` 分支；customer：只渲染 finance 已打开开关的字段；provider：**组件不存在**） | `myBrief`、`disclosureMirror`、`sharedFacts`、`budget` |
| 中："What we're deciding" | `ConstraintChangeBanner`（本会话内有新变更时）；`DecisionCard`（当前提案摘要 + "Review & decide v2" → 决策页；或 `ExecutedCard` / `NoAgreementCard` / 阶段空状态）；`ApprovalPanel`；`HumanRequestCard`（`openRequest.mine === true`）或 `WaitingNote`；`ProposalHistory` | `currentProposal`（含 `approvals`、`allApproved`、`myAction`）、`openRequest`、`proposalHistory`、`execution`、`header.phase`（`stopped` 时显示 `NoAgreementCard`） |
| 右："What just happened" | `RunProgress`（按串行顺序每角色一条 lane：queued / drafting (attempt n) / done，由 `run.activeRole` 推出；"1 late reply discarded"（Δ6）；"Discarded (constraints changed)"）；`TimelinePreview`（最近 20 条，actor 字形：人 = 实心圆、代理 = 虚线圈 + "Suggestion"、规则 = 方块、系统 = 菱形；"Private to you" 徽章）；"Full timeline" 链接；`GuidePanel` "Guide my agent"（本人写给本方代理的 notes，§13.10 F） | `run`；`timeline.page`；`briefs.mine`（`GuidePanel`） |

- 1024–1279px：左栏收进抽屉 "What I know"，中右两栏；< 1024px 单列，顺序：头部 → Needs you → 中栏决策 / 请求 → `RunProgress` → 左栏 → 时间线（CRITIQUES：预算下调时最该看到的 run 进展不能被推出首屏）。
- 中栏的 `DecisionCard` 只放摘要与检查结论（"Ready for approval" / "Doesn't pass the current checks"），完整条款、差异、记录预览在决策页，避免 CRITIQUES 指出的单卡信息过载；被阻断的提案不显示 "On final approval the system creates…"。

## 13.5 决策页模板 `/rooms/[roomId]/proposals/[proposalId]`

当 `proposalId` 是当前提案时为决策页；否则为永久链接（只读）：显示条款、存储状态（`superseded` / `rejected` / `stale` / `executed`，provider 视图中 `stale` 显示为 `superseded`）与全部决定记录（`proposals.get().decisions`），并写明 "Checks are shown for the current proposal only."——历史提案不实时重算、不带检查（D12 ①，part4 §13.9.2）。

| 区块 | 内容 | 规则 |
| --- | --- | --- |
| 1 问题标题 | customer / provider："Accept the terms of proposal v2?"；finance："Approve the budget commitment for proposal v2?" | 文案按 `myAction.kind`（`terms` / `budget`） |
| 2 版本绑定副标题 | "These exact terms under constraints v2" + `VersionTag` + 来历行 "Drafted by Provider's agent in round 1 of run 2 · created under constraints v2"（`origin: human_choice` 时写 "Chosen by Customer from request #…"） | `createdAtConstraintsVersion` 只作来历，不作判定 |
| 3 条款 | `lines[]`（title、itemKey、revision、价格）、交付日（`IsoDate` 拆分显示）、`amountCents` | 来自提案快照；title 作为纯文本渲染 |
| 4 差异 | "What changed from v1"（场景纯函数 `diffTerms(prev, next)`，参数类型是已投影的 `ProposalView['terms']`）；若我曾对更早版本做过决定，默认对比"我上次决定的版本"（research HITL：相对我上次批准的 diff） | 不用文本 diff 库；customer 视图额外列 "Not included: …（your preferences）"，他方不可见 |
| 5 检查清单 | 标题 "Rule checks (code, not the model) · Checked against constraints v2"；每行：label、按受众渲染的说明、等宽 reasonCode、"Detail only you see" 标签；他方私密检查未通过只显示 "A participant's private constraint isn't met"（`private.constraint_unmet`，通过的掩码检查省略）；provider 只有一行 fit："Fits the room's private constraints" / "Doesn't fit the room's private constraints" | 数据为 `checks` 判别联合（part3）；不写 "Matches current constraints" |
| 6 agent-box（虚线、机器人图标） | `myAgentSuggestion`："Your agent suggests accepting — required items arrive 4 days before your deadline." + 固定说明 "Suggestion only, never counted as approval." | 只本方；为 null 时显示 "Your agent hasn't commented on this version."；绑定当前 cv，约束一变即消失 |
| 7 human-box（实线） | `RecordsPreview`："If all required people approve: 1 change order · a +$800 budget commitment · N tasks · written once, atomically · internal records only"；`ApprovalPanel`；`DecisionControls` | 被阻断时不显示记录预览 |
| 8 决定按钮 | "Approve v2 under constraints v2"（finance："Approve budget commitment of +$800 for v2 under constraints v2"）/ "Reject…" / "Withdraw my approval"（仅当我在本提案有有效 approve 且未执行）；最后一票提示 "Your approval completes the set — this executes now." | 禁用用 `aria-disabled` + `aria-describedby` 原因；提交带 `expectedConstraintsVersion` / `expectedTermsKey` |
| 9 stale 横幅 | 打开期间 cv 或当前提案变化："Constraints changed to v3 while you were reviewing. Review again before deciding."；焦点移到这句 | 来自 `useVersionWatch` |
| 10 "Learn more"（折叠） | 本版本的协商记录：公开的提案序列与轮次结局（"v1 is ready for approval" / "Agents start round 2"，DX-4）+ 本方 `rationale`（`turns.mine`）、来源目录 revision | 他方 `rationale` **与他方代理的动作**永不出现（不渲染 "Customer agent declined" 一类按角色的动作，07 PV-10、privacy-04） |

**拒绝对话框**：必选 `reasonKey`（场景封闭枚举）；可选备注，标 "Only you and your agent will see this note"（不进事件与他方上下文，D13）；说明 "Rejecting ends this proposal. Agents will try another round, or someone will be asked to make a trade-off."

**审批面板槽位**（每个 `requiredApprovals` 一行；状态来自 08 的 `evaluateApprovalSet` 逐项结果，不在前端派生）：

| 状态 | 徽章（色 + 图标 + 文字） | 说明行 |
| --- | --- | --- |
| `pending` | 灰 · 时钟 · "Pending" | "Has not decided on v2" |
| `approved` | 绿 · 勾 · "Approved" | "Approved v2 under constraints v2 · 10:42" |
| `rejected` | 红 · 叉 · "Rejected" | "Rejected v2 · Reason: Delivery too late"（备注不显示） |
| `stale_approve` | 琥珀 · 划线勾 · "No longer applies" | "Approved v2 under constraints v2 · constraints changed to v3" |
| `stale_reject` | 琥珀 · 划线叉 · "No longer applies" | "Rejected v2 under constraints v2 · constraints changed to v3" |
| `withdrawn` | 灰 · 撤回图标 · "Withdrawn" | "Approval withdrawn 10:58" |

面板标题 "Approvals for proposal v2 under constraints v2"；代理建议列与人的状态列分开（CRITIQUES），代理列只显示本方代理且标 "Suggestion"。执行后槽位改读 `executions.approvalIds` 快照，标 "Used for execution"，后续任何 bump 都不改变其显示（D04）。

## 13.6 取舍页 `/rooms/[roomId]/requests/[requestId]`

**目标人视角**（`humanRequests.get({ requestId }).mine === true`，按 URL 中的 id 取）：

1. 标题（模板）："No option fits the current budget. How should we proceed?"；上下文行（目标人自身视图的模板）：finance 看到 "No option fits a $4,700 cap. The cheapest option ($800) needs a cap of $4,800."；customer 的 `rounds_exhausted` 按 `questionKey` 的实际原因渲染（`rounds` → "Agents didn't converge in 3 rounds."；`no_candidates` / `call_limit` / `spend_limit` 各用其模板，14 §8.5），不把调用或花费上限说成轮次用尽
2. 选项并排卡（`role="radiogroup"`，无默认选中）：每张写取舍本身（"Raise the cap to $4,800 · makes the $800 option possible"）、金额 · 日期、包含范围、"Gives up: …"、逐项检查（目标人视图）、后果（"Constraints become v6 · Agents renegotiate · Current approvals no longer apply"）、固定一句 "Agents did not pick this. This is a human choice."
3. 出口与分组：`keep_as_is`（只在服务端提供时出现，文案按 kind，D15：`clarify` "Don't share — let my agent continue"、`rounds_exhausted` "Give the agents one more round"、customer 的 `agent_escalated` "Continue to the next round"、provider 的 `agent_escalated` "Let my agent try again"；`infeasible` / `agent_failed` 没有它）与 `end_run`（"End without agreement"）放在选项组下方、视觉上与"改变约束"的选项分开；**没有任何选项会关闭房间**（D15）。"转交给另一位参与者"渲染服务端提供的 `pass_to_next { toRole }` 选项（canon D15 / C54、04 R21）：按钮文案 "Pass to {Role}"，说明 "{Role} will get their own version of this question. Nothing changes until someone acts."；它只出现在 `infeasible` 请求、且收件人不是 `relaxationOrder` 末位时，前端不自行推断是否显示（是否出现只取决于位置，不暗示对方是否卡住）。
4. 目标人的选项确认使用 12 §12.17 的 `disclose: { field, toRoles }`、`pass_to_next.toRole` 和 `effect: { amountCents } | { itemKeys } | { date }`；`itemKeys` 是从必需项中移除的键（06 §11.1）。披露字段的值只从目标人自己的 `briefs.mine` 取得（缺少字段时不可确认）；披露对象按 `toRoles` 显示，不固定写 Provider。选中带约束效果的选项（`raise_cap` / `drop_items` / `extend_deadline`）→ 先弹 `ConfirmConstraintChangeDialog`（影响只来自 `rooms.view`，FE-D11）→ `humanRequests.answer({ requestId, optionKey })`（返回 `applied` / `regenerated` / `superseded_by_clock` / `already_answered`；`superseded_by_clock` 表示跨午夜推进日期改变了约束、请求已关闭（按第 7 条显示）；`regenerated` 表示 `choose_candidate` 复核未通过、已按目标视图重开请求）；`choose_candidate` → 确认对话框写明 "This creates a proposal. You will still need to approve it."；`disclose` → 写明 "{Roles} and their agent will see: {field} {your value}"
5. 侧栏 "What others see"（例 "Customer will see: Finance updated the budget cap to $4,800."（`capCents` 已披露时）/ "Provider will see: Constraints changed (v2)."——provider 永远不知道是谁改的，07 DX-5 / DX-7）与 "What happens next"。
6. `expiresAt` 倒计时在客户端由 `expiresAt` 计算（query 不读 `Date.now()`）；到期由 cron 置 `expired`。
7. 请求被关闭（约束变化 `superseded`、到期 `expired`、本人已答）→ 卡片变一行 "This request was closed: constraints changed (v3)"，10 秒后收起（刷新或从链接进入已关闭的请求时，同一行由 `humanRequests.get` 的 `status` / `closedReason` / 关闭约束版本渲染，不回落到当前 `openRequest`）；若正在对话框内，确认按钮立即 `aria-disabled` 并提示。
8. 不提供"给代理写自由文本"的输入框（人写自由文本会成为新的注入与泄露通道）。取舍页之外，本人对本方代理的偏好只经房间页的 "Guide my agent" 面板写入本人 `softFields.notes`（`briefs.updateSoft`，§13.10 F），只进本方 `<principal_notes>` 块。

**非目标人视角**（`humanRequests.get(...).mine === false`）：买方看到 "Waiting on Finance to choose how to proceed · opened 3 min ago"；provider 只看到 "Waiting on others"（`run_waiting`，D12 ⑦）。不显示问题与选项。

## 13.7 角色差异矩阵（房间页与决策页）

"数据"列由视图模型决定（FE-D16）；"操作"列由视图模型里的 `can*` 字段决定。

| 组件 | customer | provider | finance |
| --- | --- | --- | --- |
| 条款、价格、交付日 | 可见 | 可见 | 可见 |
| 决定按钮 | "Approve v2 under constraints v2"（`terms`） | 同左 | "Approve budget commitment of +$X for v2 under constraints v2"（`budget`） |
| 检查清单 | 自己的检查 + 他方掩码 `private.constraint_unmet`；预算数字仅当 finance 打开相应开关 | 只有 fit：ok / blocked | 自己的预算检查（含 over-by）+ customer 已披露字段的检查 + 其余掩码 |
| `BudgetPanel` | `customer` 分支：只渲染非 null 字段（默认全部为 null，finance 逐字段打开共享后才显示，U1 默认关） | `none` 分支：不渲染 | `finance` 分支：上限、已承诺、余量（Δ2 补本提案、执行后、over-by）、"Change budget cap" |
| `ProposalHistory` 行 | 版本、存储状态、金额、交付日 | 同左；`stale` 显示为 `superseded` | 同 customer |
| `RecordsPreview` | 变更单、+$X 承诺（公开目录价之和）、任务数 | 同左 + 本方任务标题 | 同 customer |
| `HumanRequestCard` | `toRole` 是我时显示选项 | 同左；`needs_input` 时只见 "Waiting on others" | 同 customer |
| `RunProgress` | 全部 lane | lane 只显示 queued / drafting / done；`needs_input` 折叠为 "Waiting on others" | 全部 lane |
| `myAgentSuggestion` / 代理笔记 | 本方 | 本方 | 本方 |
| 变更单预算金额链 | 仅当 finance 打开 `committedCents` 开关时显示已承诺前后值 | 不显示 | 完整（AIA G701） |

provider 侧反推防线：provider 已知自己报价 $900，所以它收到的任何对象里都不能出现 $4,900（合计）、$4,800（上限）、$100（超出额）中的任何一个，也不能出现能与已知报价相减得到已承诺额的数值；verdict 序列的区间推断是 D12 接受的"每提案 ≤ 1 bit"，由频率与节流上界约束。
