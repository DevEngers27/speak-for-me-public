# 08 审批与执行（part2）：决定 A7–A13

> 接 part1 的 A1–A6。每条：决定 → 理由 → 否决 → 不变量（编号见 part11 §8.11）。

### A7 执行键 `executionKey = exec:${proposalId}`，服务端派生；客户端不传任何幂等键

- **决定**：`executionKey = composeKey('exec', proposal._id)`（foundation/idempotency-ids 的可读形式，Convex 文档 id 不含 `:` / `%`，因此恰为 `` `exec:${proposalId}` ``），不含 constraintsVersion、不做哈希。唯一写入口 `executeIfComplete` 先查 `executions.by_executionKey`（`take(1)`）再插入；同时查 `executions.by_room`（`take(1)`）落实"一房一执行"（D04）。两处任一命中而守卫却已通过，说明 E1 已被破坏 → `publicOpsLog('invariant.duplicate_execution' | 'invariant.room_already_executed', { fn: 'approvals.record' })`（执行在公开 mutation 内，只能用闭集三键 logger，15 §15.6.2；告警按码计数）并抛 `internal`，整笔回滚（fail closed）。正常的重复请求在更早的"已执行快速路径"就被接住并返回已有结果（part5 S3），走不到这里。客户端不传 operationId / uuid；公开路径的日志恰为 `{ fn, code, errorClass }` 三键，不记 `requestId` 等请求标识。
- **理由**：D06 让同一提案可在 cv 3、cv 4 先后进入审批；含 cv 的键（`exec:${proposalId}:${cv}`）会允许它在两个版本各执行一次，削弱"每个提案至多执行一次"（canon C2）。客户端 uuid 防不住双击（两次点击两个 uuid → 两条 execution，spikes B2 实测）。命中即静默返回会掩盖 bug，所以第二道防线报警而不是吞掉。
- **否决**：`exec:${proposalId}:${cv}`（旧 canon D03、五份候选）；`sha256(roomId, proposalId, cv)`（运行时待验证、无收益）；客户端 operationId；以 `changeOrders` 作幂等锚点（第二场景的产物不一定叫变更单，审批快照与执行前后快照需要与场景无关的家；`executions` 只多一张表）。
- **不变量**：E1、E5。

### A8 执行不递增 `constraintsVersion`

- **决定**：执行写 `ledgerEntries(commit)` 但不调用 `constraints.bump`；`ledgerEntries` 不在硬投影内（D05）。执行后 `room.status = 'executed'`（终态），不存在仍需作废的审批。
- **理由**：v1 一房一预算、一房一执行；台账只在当前提案执行时变化，执行与预算重算在同一事务。若执行 bump，刚促成执行的三条 approve 会立即派生为 stale，结果页显示 "Invalidated by constraints v5"，与 `approvalIds` 的事实冲突（inputs/07 "审批有效性按当前版本派生会改写已执行历史"，4 条）。
- **否决**：执行 bump cv（plugin ADR-12、finance ADR-05、security ADR-17、runtime ADR-22，canon C4 已否决）。
- **边界**：多个房间共享预算时，A 房执行会改变 B 房可行性——列入 17（届时承诺插入须对共享房间 bump，或接受"审批显示有效、执行被重算阻断"）。
- **不变量**：E12。

### A9 `approvalIds` 冻结快照；执行后房间终态；后续变更开新房间

- **决定**：`executions.approvalIds` 按 `proposal.requiredApprovals` 顺序一一记录促成执行的那几行 approve 的 id（审批行本身不可变，id 即快照）。执行之后：①审批面板与结果页对已执行提案只读快照，每行显示 "Approved · executed under constraints v{execution.constraintsVersion}"，**不再**用 `room.constraintsVersion` 实时派生；②`room.status = 'executed'`：`runs.start` / `runs.requestRenegotiation` / `briefs.confirm` / `budget.setCap` / `catalog.*` / `sharedFacts.add` 等一律 `run.invalid_state`；`approvals.record` 对已执行提案的 approve 幂等返回 `executed{alreadyExecuted:true}`，其余决定一律 `approval.already_executed`；③例外只有 `tasks.markDone`（canon §1.3 的 task `open → done` 必须在执行后可用）与旧房间任一成员的 `rooms.startFollowUp`（04 §4.2.2 / §4.3.6、07 §7.5.5、12 §12.6 一致；节流归 12 的 `room_create` 桶，不计入 D12 ⑥）——二者超出 canon D04"任何写入拒绝"的字面，04 Q4 / 12 Q3 已列为 canon 待补；④后续变更 = `rooms.startFollowUp({ executionId })`：新房间 `followsExecutionId` 指向本执行，预分配同三位成员席位，只把旧目录中未执行的条目（与修饰项）复制为 `draft`（04 catalogItem 迁移 C1、12 §12.6；已执行条目只读显示 "Delivered in CO-n"），finance 的 `ledger.recordBaseline` 预填本执行的 `committedAfterCents`（须 finance 确认）。
- **理由**：同房间追加轮需要 `executedItemKeys` 进入规则输入、枚举、简报语义与审批快照冻结，每项都被评委打出过反例（D04）；新房间以零新不变量得到同一旅程；"已执行范围不被再承诺"由 `rooms.startFollowUp` 的复制过滤保证——只把 `itemKey ∉` 旧执行 `terms.itemKeys` 的目录行复制为草稿，已交付键在后续房间 `catalog.confirm` → `item.duplicate`（canon D04、12 §12.6 / §12.12 ④，inputs/07 第 29、38、50 行）。新房间本身并不"天然"杜绝它：若照搬全部目录，stub / 模型的默认路径会把已执行条目再提一次。
- **否决**：同房间追加轮（PD-05b，列入 17）；执行后仍允许 `runs.start`（重复承诺同一范围）。
- **不变量**：E7、E12。

### A10 执行只用提案快照：`lines[]`、`terms`、`plannedTasks[]`

- **决定**：变更单的条款与行项目直接复制 `proposal.terms` 与 `proposal.lines[]`（`{itemKey, kind, revision, title, priceCents, leadDays}`，03 §3.4 的 `lineV`）；任务直接由 `proposal.plannedTasks[]`（插入时由当时 `catalogItems.taskTemplates` 派生，06/14）生成，**不在执行时读当前任务模板、不重算**。执行前断言：`canonicalJson(proposal.terms) === proposal.termsKey`（条款漂移）、`Σ lines[].priceCents === terms.amountCents`（声明金额，D25 的 `amount.claim_mismatch` 在执行层的复核）、`plannedTasks.length <= MAX_TASKS_PER_EXECUTION`（50）；任一失败 → `publicOpsLog('invariant.execution_plan', { fn: 'approvals.record' })` 并抛 `internal`（执行在公开 mutation 内，只能用闭集三键 logger，15 §15.6.2）。场景版本守卫：`scenarioOf(room)` 可解析（房间钉住的 `scenarioKey@scenarioVersion` 仍在注册表中，11 §11.3），不可解析 → `run.invalid_state{guard:'scenario_version'}`（部署了改变规则语义的场景新版本而房间未迁移时，不按新规则执行在旧规则下给出的签字；judging 对 product 候选的致命缺陷）。该守卫**只对 approve**（S5）：执行只经 approve 到达，所以执行同样受它保护；reject / withdraw 不跑规则、不需要版本一致，照常记录——否则一次场景版本提升就会让所有旧版本房间无法拒绝（invariants-16）。
- **理由**：review r02 反例——三方看过预览后 provider 只改任务模板（不 bump，D05），若执行时重算，生成的任务与预览不一致，旧审批照样计入，违背"所见即所写"。标题与模板由快照承载后，它们的改动可以不 bump（D05）而不破坏核心 3。
- **否决**：执行时按当前模板派生任务（所见非所写）；把 `taskTemplates` 并入硬投影（标题改动冻结协商，canon C8）；`planHash` 存哈希再比对（快照本身更简单）。
- **不变量**：E8、E9。

### A11 台账 `ledgerEntries`：只追加的 `baseline` / `commit`，已承诺 = Σ；变更单记录 AIA G701 金额链

- **决定**：
  - `ledgerEntries.kind ∈ 'baseline' | 'commit'`。`baseline` 只由 `ledger.recordBaseline`（finance，`setup` 阶段，每房恰好一条，可为 0）写；`commit` 只由 `executeIfComplete` 写（每房至多一条，因为一房一执行）。不 patch、不 delete；不存在 release / 冲销（列入 17）。
  - `committedCents = Σ ledgerEntries.amountCents`（`by_room_kind` 区间读，进入读集），`headroomCents = capCents − committedCents`，两者都派生不存储；`capCents` 来自 finance 最新已确认简报的 `hardFields.capCents`（canon §1.1，无 `budgets` 表）。
  - `executions.committedBeforeCents / committedAfterCents` 与 `changeOrders` 的金额链是**执行时的不可变快照**，只用于展示与对账，**不参与任何计算**（代码注释与 R2 都写明，防止被当作第二真相源）。
  - 变更单金额链（AIA G701：原合同额 → 已批准变更累计 → 本次前金额 → 本次增减 → 新金额，research F5）：`baselineCents`（本房 baseline）→ `priorApprovedDeltaCents`（本房此前 commit 之和，v1 恒为 0）→ `amountBeforeCents = baselineCents + priorApprovedDeltaCents`（= `committedBeforeCents`）→ `deltaCents = proposal.terms.amountCents` → `amountAfterCents = amountBeforeCents + deltaCents`（= `committedAfterCents`，必须 `<= capCentsAtExecution`）。由纯函数 `computeChangeOrderChain` 生成并校验链连续。
  - 审批期间**不预留**额度（research：check 与 reserve 是两步；预留会让并发提案互锁），pending 只作界面提示。
- **理由**：台账唯一真相源消除"计数器与明细不一致"（F02.3）；G701 字段让变更单自带可审计的前后对照，并可直接作为将来外部 ERP 的映射字段（17）。
- **否决**：`rooms` / `budgets` 上存 `committedCents` 计数器；`ledger.addExternalEntry`（inputs/07 第 16、102 行：非幂等、不查上限，能让 Σ > cap）；预算 override（研究建议若将来需要，做成独立必需审批角色）。
- **不变量**：E6、E7。

### A12 错误通道：被拒一律抛 `ConvexError({ code, params })`，重复调用返回成功值；规则读 `room.localDate`

- **决定**：
  - 返回（判别字段 `status`，与 12 §12.15 一致）：`recorded{ decision, missingRoles }` / `unchanged` / `executed{ executionId, alreadyExecuted }`。
  - 抛出（不写任何行，事务回滚）：`auth.unauthenticated` / `auth.user_not_provisioned` / `auth.not_member`（构造器；码名以 12 §12.4 为准）、`auth.role_forbidden`、`approval.stale`（`params.currentConstraintsVersion`，房间可见值）、`run.invalid_state`、`approval.not_current`、`approval.already_executed`、`approval.not_executable`、`approval.self_conflict`、`run.rate_limited`、`input.invalid`、`internal`。`params` 经与 DTO 相同的受众投影（D16）：`approval.not_executable` 的 `params.reasonCodes` 对 finance 给完整阻断码，对 customer 给其拥有的码或掩码 `private.constraint_unmet`，对 provider 不给 `params`（D12①）。函数整体包在 `withSanitizedErrors` 里：非 `ConvexError` 异常 → `publicOpsLog('unhandled', { fn: 'approvals.record', errorClass })` + 抛 `internal`（11 §11.6）；handler 内禁止 `console.*`（`logLines` 会随响应下发浏览器，D16）。前端把 `approval.stale` 映射为 stale 横幅 "Constraints changed while you were approving (now v{currentConstraintsVersion}). Review and decide again."，**不是**"等新提案"（review r06：保留提案时对同一 proposalId 重批即可）。
  - **时间**：规则检查一律以 `room.localDate` 为 `today`（09 §9.6.7、canon §1.2），所以审批时的结论与审批人屏幕上的结论来自同一个日期；`clock.rollLocalDate` 在房间本地午夜后（滞后 ≤ 约 1 小时）推进 `localDate`，只有当前 `pending_approval` 提案的时间结论翻转才 `constraints.bump(cause: 'clock')`（D22）。交付日在插入时物化且不重算，跨午夜不会让审批失效。
- **理由**：错误码集中、`params` 受众投影，浏览器只拿到 `{ code, params }`（`ConvexError.data` 原样到达客户端，review 核实）。`approval.stale` 是正常竞态，但 04 / 12 / 13 已统一以错误码回应并在前端映射为横幅；canon D02 的"返回 `approval.stale`"按"以该码回应、不写行"理解。规则读 `room.localDate` 消除了"cron 尚未推进时 approve 用真实日期判出 `date.in_past`、被纵深防御拒绝且无出口"的窗口。
- **否决**：透传错误 message；把 `returns` validator 当运行时防线（只作测试期探测器，D16）；`approval.stale` 作为返回值（本章早期稿：与 04 / 12 / 13 不一致，且它唯一的额外收益——让就地滚动写入提交——随"规则读 `localDate`"而消失）；approve 内就地滚动 `localDate`（与 09 的口径重复，且让审批事务额外写 `rooms.localDate`、扩大冲突面）。
- **不变量**：E3、E9。

### A13 审批信息的可见性与代理边界

- **决定**（07 的矩阵为准，本章给出 08 产生的每个字段的受众）：
  - 审批进度（每个必需角色 `approved / pending / withdrawn / stale_*`、所绑定的 cv、决定时间）对房间全员可见——"等谁"在 07 的显式解密清单内。
  - reject：人的拒绝决定（`role`、`decision`、绑定版本、`reasonKey`）是人的显式表态，按 07 的 DX-6 对**该 reasonKey 声明的受众**可见：场景的 `humanReasonKeys[].audience` 为 `room`（默认）或 `buyers`（如 finance 的 `over_our_limit`，它隐含"金额超出 finance 的私密额度"，不给 provider；provider 只见 "Finance rejected v{n}"）——界面在理由选项旁标注 "Visible to everyone in this room" 或 "Visible to Customer and Finance"，让拒绝者在知情下选择；`rooms.view` / `proposals.get` / 时间线的 `approval_recorded` 渲染都按该受众裁剪（06 §12.1 成员 18，14 §3）。`reasonKey` 是场景封闭枚举、无自由文本、无数值（D13）。这与 D12① 不冲突：D12① 限制的是**系统**对 provider 披露的规则结论（`fit` 只有 ok / blocked），而 `reasonKey` 是人主动选择公开的表态。事件同样按受众：`approval_recorded` 的 payload 只在键的受众为 `room` 时携带 `reasonKey`；`buyers` 受众的键不进 payload，只经 `restrictedRef → approvals` 在 `timeline.page` 渲染时对 customer / finance 连接（D14：payload 只含房间可见值）。残余推断：provider 看到一条不带理由的 finance 拒绝，可推出所用的是 `buyers` 受众的键（v1 只有 `over_our_limit`）；这 1 bit 与"finance 拒绝了 vN"本身几乎同义，落在 D12"每个提案 ≤ 1 bit"的政策内（开放问题 O15）。
  - 代理上下文按 05 §5.12 最小化：provider 代理的下一回合反馈只有 "vN rejected"（无角色），买方代理见 "vN rejected by {role}"；**任何他方代理**都拿不到人拒绝的 `reasonKey`（同侧也不默认共享，canon C28：finance 的 `over_budget` 会把"价格接近上限"带给 provider 代理）；拒绝者本方代理可见自己的 `reasonKey`。人能看到而代理看不到，是有意的上下文最小化（research：AirGapAgent）。
  - `note` 只给本人：不进事件 payload、不进任何他方视图或代理上下文。
  - 执行：变更单条款、`deltaCents`、任务对全员可见；`baselineCents` / `priorApprovedDeltaCents` / `amountBeforeCents` / `amountAfterCents` 只给 finance，customer 须 finance 的 `committedCents` 披露开关；`capCentsAtExecution` 须 `capCents` 开关；`headroomAfterCents` 须 `headroomCents` 开关；provider 永不可见（U1 默认关）。
  - 代理永远不写 `approvals`：模型输出没有 `approve` 动作（§1.4），`recommend_accept` 只写回合结果与事件，界面以虚线 agent-box 标 "Suggestion only, never counted as approval"（D19）；`approvals.record` 只能由已鉴权的人调用，internal 函数与 action 不得 import 其写入 helper（结构测试）。
- **否决**：`reasonKey` 一律对他方的人隐藏（07 DX-6 已把人的显式表态列入解密清单；拒绝理由本是说给对方听的，一律隐藏只损失可审计性——需要对 provider 隐藏的类别由场景逐键声明 `buyers` 受众）；`reasonKey` 一律房间可见（14 的 `over_our_limit` 隐含"金额超出 finance 的私密额度"，会把预算 bit 带给 provider，privacy-07）；把人拒绝的 `reasonKey` 喂给 proposer 代理（04 R10 草稿写法；与 05 §5.12 冲突，按 05 删去，见开放问题 O14）；审批备注房间可见（spike C3 第 3 条泄露路径）；场景的 `reasonKey` 词表中出现会编码私密数值的取值（如 `over_by_100`）——词表由 05/14 审定，只允许类别级取值。
- **不变量**：E13。
