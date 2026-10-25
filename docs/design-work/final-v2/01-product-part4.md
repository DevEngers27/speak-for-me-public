# 01 · 产品（part4）：横切体验、"谁该行动"表、追溯、度量与收尾

> 分片见 `01-product.md` 顶部。

## X1 代理失败、排空与上限

| 情况 | 系统行为（10 / D07 / D15 / D17） | 用户看到 | 谁能做什么 |
| --- | --- | --- | --- |
| 超时 / 5xx / 429 | 同一 turn 开下一个 attempt（每个 attempt 自带看门狗；SDK `maxRetries: 1` 只覆盖 429 / 连接错误） | 进度 "Provider's agent retrying (attempt 2)" | 等待 |
| attempt 用尽、无效输出用尽、`refusal`、400 配置错误 | run → `needs_input` + `agent_failed` 请求给**失败方**本人（`retry_turn` / `end_run`）；400 同时告警运维 | 失败方："Your agent couldn't finish its turn. No partial result was saved."；买方看到 "Waiting on Provider"；provider 只看到 "Waiting on others"（若失败方不是它） | 失败方回答；7 天未答 → `ended_no_agreement` |
| 运维排空 `opsFlags.draining` | `turns.beginAttempt` 返回 `run.draining`、`runs.start` 拒绝；在途 attempt 照常提交 | 横幅 "Agents are paused for maintenance. You can still edit briefs, answer requests and approve." | 人工路径照常 |
| 紧急止血 `AGENTS_ENABLED=false` | attempt `error(agents_disabled)` → `agent_failed` 请求 | 同上 + 失败方的请求卡 | 同上 |
| 每 run 美元预留超限 | 不调度下一 attempt，转 `needs_input` | 目标人看到请求卡 | 回答 `end_run` 或等运维 |
| 全局日美元上限 | 被调度路径返回 `deferred`，`runAfter` 到次日 | "Agents will resume tomorrow" | 等待或结束 |

**fail-closed 与 fail-open（模型完全不可用时）**：永远不会发生的事——没有代码校验的提案、没有人的审批、没有齐全审批的执行、编造的一致意见。仍然可用的事——编辑简报 / 目录 / 上限、对已在 `pending_approval` 的提案批准或拒绝、回答请求、结束 run、关闭房间、发起后续变更。v1 **不提供**的事——模型不可用时由人手写新提案（只有轮次用尽时 customer 的 `choose_candidate`，见 C8b）；是否给 `agent_failed` 请求加 `choose_candidate` 出口记入 18 开放问题。

## X2 迟到的模型结果

run 2 的 provider 回合在途时 Priya 又改一次预算 → `constraints.bump` → run 2 `superseded` → 模型结果稍后到达，`turns.complete` 的持久化守卫（G0–G3，D07）拒收 → attempt `stale`，用量照记入 `attempts`，写房间事件 "An agent result was discarded because constraints changed"，并调用 `runs.reconcile`。用户永远看不到基于旧约束的提案。

## X3 审批与约束变化同时发生

Maya 点 Accept 的同时 Priya 提交降预算。两个 mutation 都读写 `rooms`，OCC 让后提交者重试：Priya 先提交 → Maya 的重试发现 `expectedConstraintsVersion` 不符 → `approval.stale`，什么都不写，界面："Constraints changed while you were approving. Nothing was recorded. Review the latest proposal."；Maya 先提交 → 审批记在 vC 上，随即因 vC+1 显示 `stale_approve`。两种结果都不会产生"批准了一个看不到的版本"。

## X4 最后两票并发

完成判定读取该提案**全部** approvals 区间与当前成员；并发插入在 OCC 下冲突，后者重试时看到前者的行并发现提案已 `executed`，得到 `{ status: 'executed', executionId, alreadyExecuted: true }`（同一个 executionId），界面按订阅显示已执行而不弹错误。结果：恰好一条 `executions`、一条 `ledgerEntries(commit)`、N 条 `tasks`。该结论依赖"空索引区间读冲突"（spikes §8 #1，真实部署验证）。

## X5 断线重发与连点

Convex 客户端重连后重发在途 mutation；`approvals.record` 对"同人、同提案、同 `boundConstraintsVersion`、同决定"返回 `unchanged`。断线最长约 60 秒才被客户端察觉（frontend-ia-review r06），所以按钮的断线禁用只是提示：正确性只靠 `expected*` 与服务端幂等；在途超过数秒时显示 "Still sending your decision…"。

## X6 每个卡住状态对应具体的人与动作（derivePhase 表）

`derivePhase` 是读时派生的 UI 阶段（04 定义：`setup{gaps}` / `negotiating` / `needs_input{you, waitingOn?}` / `awaiting_approval{pendingRoles}` / `stopped{reason}` / `executed` / `closed`；13 用它排收件箱）。

| 派生 phase | 判定条件 | 等谁 | 他的动作（函数） | 他方看到 | 出口 |
| --- | --- | --- | --- | --- | --- |
| `setup`（缺口：席位） | room `setup` 且有空席 | creator | `invites.create` / 重发链接 | "Waiting for Provider to join" | `invites.accept` |
| `setup`（缺口：简报 / 目录 / 基线） | 席位齐，但有简报未确认 / 目录无 confirmed 项 / 基线未录 | 缺什么就是谁（可多人并列） | `briefs.confirm` / `catalog.confirm` / `ledger.recordBaseline` | "Waiting on Finance: confirm brief" | 最后一项就绪条件满足的那次写入同事务 `openIfReady`：`bump(room_opened)` + 首个 run（cause `room_opened`） |
| `negotiating` | 当前 run `negotiating` | 无人（代理在跑） | creator 可 `runs.cancel` | run 进度 | → `pending_approval` / `needs_input` / 被 supersede |
| `needs_input` | 当前 run `needs_input`，恰好一个 open 请求 | 请求的 `toRole` | `humanRequests.answer` | 买方："Waiting on Finance"；provider："Waiting on others" | 按 effect 迁移；7 天 → `expired` → `ended_no_agreement` |
| `awaiting_approval` | 当前 run `pending_approval` | 当前提案上尚无有效 approve 的必需审批人 | `approvals.record`（approve / reject / withdraw）；creator 可 `runs.requestRenegotiation` | 审批面板（对房间可见） | 最后一票 → 执行；reject → 下一轮或 `needs_input`；bump → D06 |
| `stopped`（reason：`ended_no_agreement` / `canceled`） | 当前 run 为终态，room `open` | 任一成员（重开）/ creator（关闭） | 修改自己的约束（自动新 run）或 `runs.start`（节流）；`rooms.close` | "No agreement was reached. Nothing was committed." / "Negotiation was stopped by the room creator." | 新 run 或 `closed` |
| `executed` | room `executed` | provider（任务）；任一成员（后续变更） | 勾选任务；`rooms.startFollowUp` | 变更单（按投影） | 终态；新房间 |
| `closed` | room `closed` | — | 只读 | 只读历史 | 终态 |

`needs_input` 的 kind 与收件人：`infeasible` → `relaxationOrder` 中第一个"按自身视图存在可放松选项"的角色（customer `drop_items` / `extend_deadline`，否则 finance `raise_cap`）；`rounds_exhausted` → customer（`choose_candidate` / `keep_as_is` / `end_run`）；`agent_escalated` → 代码策略检查通过后的 `toRole`；`infeasible` 的收件人不是 `relaxationOrder` 末位时另带 `pass_to_next`（转交给下一角色，按位置提供）；`clarify` → 被问方（`disclose` / `keep_as_is` / `end_run`）；`agent_failed` → 失败方（`retry_turn` / `end_run`）。**没有任何选项映射到 `rooms.close`**（D15）。

## X7 邀请与席位

邀请 72h 过期 → creator 重新邀请。一人一房一席、一席一人；creator 没有额外审批权；v1 不支持换人与解绑（关房重建，列入 17）。creator 或必需审批人的账号消失时不会永久卡住：open 请求 7 天过期 → `ended_no_agreement`；运维可经 CLI 调 internal `rooms.forceClose`（双人确认）关房（04 §4.11、INV-79）。演示用三个 Clerk 账号，fixture 走 `--identity`（D24）。

## X8 模拟模式与 fixture 房间

`seed.fromFixture`（internal mutation）以 fixture 角色身份复用与用户相同的入口逻辑（`rooms.create → invites.create + invites.accept → ledger.recordBaseline → catalog.confirm → briefs.confirm ×3`），只写输入链：缺省时第三份确认按生产路径同事务 `openIfReady` 并开首个 run（stub 继续推进）；传 `stopBeforeRole` 时留一方不确认、房间停在 `setup` 供现场演示；seed 自身永不写提案 / 审批 / 执行（canon D18）；全部行 `provenance: 'seeded'`，stub 代理产物 `provenance: 'stub'`，界面统一 `SimulatedBadge`（房间横幅 "Simulated room · seeded from fixture scope_change/main"、目录行、提案、变更单、回合）。`seed.reset` 只在 dev / preview、只删 `provenance !== 'live'` 的房间；prod 没有 reset，归档靠 `rooms.close`（D18）。

## X9 关闭房间

creator `rooms.close` → room `closed`；非终态 run → `canceled`；open 请求 → `superseded`；历史全部保留。身份消失时运维的 `rooms.forceClose` 走同一迁移（`room_closed{ by: 'ops' }`，04 §4.11）。

## X10 多标签页与登出

多标签页各自订阅；不把任何 query 结果写入 localStorage / sessionStorage；登出后房间查询在 `useConvexAuth().isAuthenticated` 为假时 `skip`（13）。

## X11 旅程 → 函数 / 表 / 事件追溯

| 步骤 | 函数（12） | 写入表（03） | 事件 |
| --- | --- | --- | --- |
| C1 建房 | `rooms.create` | rooms, members | room_created, member_joined |
| C2 / P1 / F1 邀请与加入 | `invites.create`（或 `invites.createLink`）、`invites.listMine`、`invites.accept` | invites, members | invite_created, member_joined |
| C3 / P3 / F3 简报 | `briefs.confirm`（finance 改上限亦可 `budget.setCap`） | briefs, sharedFacts；必要时 rooms + 约束修订 | brief_confirmed, constraints_changed |
| P2 目录 | `catalog.confirm` / `catalog.retire` | catalogItems；必要时 rooms + 约束修订 | catalog_item_confirmed / catalog_item_retired, constraints_changed |
| F2 基线 | `ledger.recordBaseline` | ledgerEntries(baseline) | baseline_recorded |
| C5 协商 | `runs.start` → `turns.beginAttempt` → `agents.runAttempt` → `turns.complete` / `turns.fail`（internal）| runs, turns, attempts, proposals | run_started, turn_scheduled, turn_completed, proposal_created, run_awaiting_approval |
| C6 / F6 审批与执行 | `approvals.record` → `executions.executeIfComplete` | approvals；完成时 executions, ledgerEntries(commit), changeOrders, tasks, proposals, runs, rooms | approval_recorded, room_executed |
| F5 降预算 | `rooms.previewChange`（query）、`budget.setCap` | briefs, rooms, 约束修订, runs, proposals, humanRequests | constraints_changed, run_ended{status: superseded}, run_started |
| C8b / C8c / F7 回答请求 | `humanRequests.answer` | humanRequests；按 effect 写 briefs / sharedFacts / proposals / attempts | human_request_answered 及其引发的事件 |
| P6 失败重试 | `humanRequests.answer(retry_turn)` 或 `runs.retryTurn` | attempts, runs | run_resumed |
| C12 后续变更 | `rooms.startFollowUp` | rooms, members, catalogItems(draft，仅未交付条目) | 新房间 room_created / member_joined；旧房间 follow_up_started |
| X9 关闭 | `rooms.close` | rooms, runs, humanRequests | room_closed |

事件 payload 只含房间可见字段；私密细节经 `restrictedRef` 在 `timeline.page` 读时按查看者连接（D14）。表中事件名取自 03 §3.11.1 的封闭目录；函数名以 canon §1.6 与 12 为准（任务勾选 `tasks.markDone`、链接邀请 `invites.createLink` 为 12 补充定义）。

## 有用性度量（V-14、AC-14）

首个合格提案用时、人工干预次数（请求、`choose_candidate`、重试）、被代码拦下的硬约束违规数（执行中应为 0）、未达成比例与原因分布、每次执行的估算模型成本（来自 `attempts`，带 `asOf` 价目表）、审批前停留时间与差异展开率（research：审批疲劳可测）。一律报告样本量与失败；未测量前不宣称改进幅度。

## 本章不变量

1. 每个非终态派生 phase 都至少有一个具体角色与一个具体函数作为出口（X6）。
2. 没有任何取舍选项或代理动作会写 `approvals`、执行或关闭房间。
3. 回答请求不等于批准：`choose_candidate` 只产生提案，审批仍由人显式提交。
4. 对 provider 的任何界面元素都不含预算数字，提案结论只有 `ok / blocked`。
5. 已执行房间是终态；后续变更只能在 `startFollowUp` 新房间。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 同一房间开后续 run（候选 product ADR-27 / PD-05b） | 评委 15 条"执行后重复承诺已执行范围"反例；新房间以零新不变量得到同一旅程（D04） |
| provider 候选浏览器 "Choose an option myself"（候选 product X1） | 被阻断反馈构成可主动探测的预言机（FF-01）；canon 没有该入口；人工选择只经 customer 的 `rounds_exhausted` 请求 |
| 回答请求时 "Also approve"（候选 product C9b） | 把"回答"与"批准"合并，违背核心 3 的显式审批；按钮多一个语义分支 |
| 影响预览对所有角色返回"改后是否可行" | 无痕预言机（评委 7 条，D12 ②） |
| v1 做简报抽取、邮件通知、审批 / 报价有效期 | 扩大泄露面与范围（D26），进 17 |
| 简报草稿入库自动保存 | canon：草稿不入库；私密草稿多一份存储与投影面 |

## 开放问题（本章新发现，汇入 18）

1. 模型长时间不可用时，是否给 `agent_failed` 请求增加 customer 的 `choose_candidate` 出口（当前 v1 只能重试或结束）。
2. `rooms.startFollowUp`：12 已定为任一原成员可发起、每个执行至多一个后续房间（派生键幂等）；剩余问题是另两方被预分配席位前是否需要确认加入（07）。
3. 房间 `title` 是对房间可见的人写自由文本：需 07 明确它不进任何代理上下文、长度与字符约束同目录 `title`。
4. （已关闭）canon D27 已按真实流程改写（C57）：第三票会同事务执行，主线是 customer、provider 两条 stale、finance 等待。
5. H1 / H2 组织假设需用户访谈验证（17 的产品验证活动）。
6. 简报草稿只在内存：长表单刷新即丢；是否允许本机加密暂存。

## 与 canon 的对照

本章只使用 canon 规范名，另用 12 补充定义的函数与错误码（`invites.createLink`、`tasks.markDone`、`auth.*`、`invite.*`、`input.invalid`、`request.*`；canon §1.5 / §1.6 补录见 18 N-05）。D02–D26 在各旅程步骤中只被引用（每处已标 Dnn），不再逐条复列；下表只列细化、偏离与 part6 must_absorb 的落点。

| canon 条目 | 本章的细化 / 偏离 | 位置 |
| --- | --- | --- |
| D27 主线措辞 | canon 写"3 条审批 stale"与"stub counter $800"；真实流程中第三票会同事务执行、被阻断提案不进评估回合，所以本章写成 customer、provider 两条 `stale_approve` + finance 待批，$800 由 provider 在剔除阻断键的新快照中提出 | C7、C8、F4–F6；18 N-04 |
| D04 | `startFollowUp` 由任一原成员发起、每个执行至多一个后续房间（12 §12.6）；"执行后拒绝一切写入"豁免 `tasks.markDone` 与 `startFollowUp` | C12、P8；18 N-02、N-26 |
| D12 ② | `previewChange` 形状以 12 §12.17 为准：finance 的 `after` 只含当前提案在新上限下的预算检查，其余角色只得 `recheck` | F5、P4' |
| D12 ⑥ | 目录确认按批计一次节流（12 §12.12）；改价批次另受 `price_writes` 桶限制（07 §7.13） | P2、P4' |
| D15 | 模型长期不可用时 `agent_failed` 只有 `retry_turn` / `end_run`（fail-closed），是否给 customer 加 `choose_candidate` 待定 | X1；18 N-03 |
| D13 / D24 | 房间 `title` 是成员可见的人写文本：不进任何代理上下文，约束同目录标题 | C1；18 N-06 |
| part6 01-product must_absorb | 一等结局（§1.6）；`startFollowUp`（C12）；U1 默认关（§1.2）；provider ok / blocked 的产品含义（P4'）；执行边界（§1.3、C11）；derivePhase 表（X6）；v1 无抽取 / 通知 / 有效期（§1.3） | — |
