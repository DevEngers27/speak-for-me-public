# 18 · 决策记录（part2）：ADR-D01…D05

> 分片见 `18-decisions-open-questions.md` 顶部。格式：背景 → 选项 → 决定 → 被否决 → 后果。

## ADR-D01 编排引擎：自建 `ctx.scheduler` 链

- **背景**：run / turn / attempt 的状态无论如何都要落在自有表（守卫、界面、审计都读它）；被调度 action 至多执行一次、不重试，action 与 mutation 不同事务（spike B1/B5）；spike B7 实测 workflow 版回合循环 68 行、自建链 108 行；techstack D07 选自建。
- **选项**：A 自建链：`turns.beginAttempt`（写 attempt 行 + 同事务 `runAfter(0, agents.runAttempt, {attemptId, actorUserId})` + `runAfter(deadline, agents.watchdog, {attemptId})`）；B `@convex-dev/workflow`；C `@convex-dev/agent`；D 自建链 + action-retrier。
- **决定**：A。`beginAttempt` 是唯一调度接缝；action 只做"读快照 → 调模型 → 一次 `turns.complete / fail`"；提交 mutation 做过期拒绝与 `(runId, turnSeq, attemptNo)` 幂等；不用 `scheduler.cancel`，靠守卫拒收。升级触发：并发 run > 50 或 Anthropic 429 成为常态 → 只把 `beginAttempt` 换成 workpool `enqueueAction`；出现多步长流水线 → 为那条流水线单独用 workflow（17 E4 / E5）。
- **被否决**：B（**C1**）——状态仍要落自有表，workflow 只是并行的第二份日志；handler 确定性约束与在途实例下改步骤的 "Journal entry mismatch" 与 v1 协议频繁迭代冲突；带组件后 `convex codegen` 不能离线，CI 漂移检查变复杂；节省的只是约 40 行退避代码。C——要求 Vercel AI SDK，与栈冲突。D——action-retrier 不认 `NonRetryableError`，`onComplete` 里 cleanup 静默卡死（spike 实测）。
- **后果**：正面——状态真相源唯一；无确定性重放约束；离线 codegen + 漂移检查成立（D20）。代价——退避重试、看门狗、孤儿修复（`runs.reconcile`）自写。关闭评委反例：FF-04（与 D07、D08 一起：单调度接缝 + 串行 + reconcile）、FF-11（看门狗以 attempt 为单位，D07）、FF-25（schema 在 action 内构造，D09）。待验证：spikes §8 #2（被调度 action at-most-once、mutation exactly-once）；升级 workpool 前 §8 #9。

## ADR-D02 审批只追加与完成判定

- **背景**：spike convex-test 演示的 `by_proposal_user` upsert 覆盖了决定，违反核心 6；research：审批绑定快照、不设容差（GitHub stale review），同一人不能满足两个必需角色（NIST AC-5），任一 reject 结束整轮；评委反例 FF-23（无 `expected*` 的 TOCTOU）。
- **选项**：A patch upsert 为最新决定；B 当前行 + `approvalEvents` 追加表；C 只追加、当前决定 = 该 `(proposalId, userId)` 的 `seq` 最大行，入参带 `expectedConstraintsVersion` / `expectedTermsKey`，集合判定。
- **决定**：C。一行一决定；同人对同 `(proposalId, boundConstraintsVersion)` 重复相同决定返回 `unchanged`；撤回追加 `withdraw`，只能撤回本人 approve、执行前有效；对某提案的 reject 是终局（提案 `rejected`，run 回 `negotiating` 下一轮或轮次用尽进 `needs_input`）。完成判定 `evaluateApprovalSet`（唯一实现，归 08）：`proposal.requiredApprovals` 中每个角色取**当前** `members` 中的持有人，其当前决定为 `approve`、`boundConstraintsVersion === room.constraintsVersion`、`boundTermsKey === proposal.termsKey`，且被选中的 `userId` 两两不同；禁止计数式判定。`expected*` 不符 → `approval.stale` 不写行；`approve` 前同事务跑 `isExecutable`，不通过 → `approval.not_executable`（纵深防御）。`kind` 由角色派生（customer / provider = `terms`，finance = `budget`），只影响文案。审批不过期（U7）。
- **被否决**：A——丢历史（核心 6）；B——两份真相源、多一次写，无收益；无 `expected*`——TOCTOU（FF-23）；会挡住 reject 的全局 `TOO_MANY_DECISIONS` 上限；同人多 kind（va-review r02，v1 一人一席，D24）；**C41** 7 天审批过期（PD-08 推荐，否决：研究建议的期限按整轮计，v1 先不设，列入 17 E9 与 U7）。canon 包修订（2026-10-24）另否决把审批集合并入 `isExecutable`（**C44**：`isExecutable` = 当前性 ∧ `passesChecks`，最后一票之前即可为真；`canExecuteNow = isExecutable ∧ allApproved` 另名）。
- **后果**：正面——"先拒后撤再批""stale_approve"全部可追溯；执行后用 `approvalIds` 快照如实展示（D04）。代价——每次决定读取该提案全部审批区间（由人类操作频率自然有界），完成判定的并发安全依赖 OCC 冲突：03 以房间写锁 M-ROOM 给出确定的冲突点，区间读冲突为第二道（§18.6 ADR-X01）。关闭评委反例：FF-23、FF-08（与 D04 一起：不再按"当前 cv"改写已执行历史，也不存在"重新选中旧提案让旧审批复活"——被拒或被 supersede 的提案不会回到当前）、FF-42（`approval.already_executed` 与状态守卫统一）。待验证：spikes §8 #1（并发最后两票在空索引区间上的 OCC 冲突，`maxOverlap ≥ 2` 证据）。

## ADR-D03 执行键派生与执行时机

- **背景**：spike 实测"两次点击、两个客户端 key → 两条 execution"；旧 canon 用 `sha256(roomId, proposalId, cv)`；五份候选用 `exec:${proposalId}:${cv}` 且执行递增 cv。
- **选项**：A 客户端 operationId；B `exec:${proposalId}:${cv}`；C `sha256(...)`；D `exec:${proposalId}`，服务端派生，在最后一个必需审批落库的同一 mutation 内执行。
- **决定**：D。`executions.executeIfComplete` 在同事务重读 room / run / proposal / 全部 approvals 区间 / members / ledgerEntries 区间 → `isExecutable` 重算 → 按 `by_executionKey` 先查后插 `executions`（含 `approvalIds` 冻结快照、`committedBeforeCents` / `committedAfterCents`、`provenance`）+ `ledgerEntries(commit)` + `changeOrders` + `tasks`（来自 `proposal.plannedTasks` 快照，`taskKey = ${executionId}:${itemKey}:${templateIndex}`）+ 事件；proposal / run / room → `executed`。执行**不**递增 `constraintsVersion`。客户端不传任何幂等键；`requestId` 只用于去重与追溯。
- **被否决**：A——spike 证伪；B（**C2**）——同提案跨 cv 重批后可执行两次，且若执行 bump 则键永远算错；C——`crypto.subtle` 在 Convex 运行时可用性待验证，哈希无收益；执行递增 cv（**C4**）——执行后房间终态，递增只会让已执行审批显示 stale；两段 `taskKey`（**C39**）——同一条目多个任务模板时重名。
- **后果**：正面——每个提案至多执行一次由构造保证；没有"已全签未执行"的悬空状态，也不需要"重试执行"入口。代价——执行逻辑在审批 mutation 内，受单事务读写上限约束。关闭评委反例：FF-09、FF-21、FF-40（执行用插入时的条款与任务快照，不重算），并与 D04 一起关闭 FF-05。待验证：spikes §8 #1、§8 #4（事务限额与错误格式）；testing-ops r11 的最大 fixture 写入量（`getTransactionMetrics`）。

## ADR-D04 执行后房间：一房一执行 + `startFollowUp`

- **背景**：PD-05 推荐同房间追加轮；评委 15 条"执行后重复承诺已执行范围"（FF-05）与 2 条"审批有效性改写已执行历史"（FF-08）；research：A2A 终止态不可重启；原文 GAP-13。
- **选项**：A 执行后房间终态，后续变更开新房间；B 同房间追加轮（PD-05b，`executedItemKeys` 进入规则）；C 修订 / 冲销（PD-05c，release 账本）。
- **决定**：A。执行后 `room.status = 'executed'`，协商 / 约束 / 成员 / 审批类写入拒绝 `run.invalid_state`，只有两项写入豁免——被指派人的 `tasks.markDone` 与旧房间任一成员的 `rooms.startFollowUp`（canon D04 / C45，经 `openRoomTx({ allow: ['executed'] })`）；审批有效性由 `executions.approvalIds` 快照显示。`rooms.startFollowUp({ executionId })` 创建 `followsExecutionId` 指向旧执行的新房间（每个 execution 至多一个）：预分配同三位成员席位；只把 provider 目录中**未交付**的行（`itemKey ∉` 旧执行 `terms.itemKeys`）复制为 `draft` 需重新确认，已交付键在新房间 `catalog.confirm` → `item.duplicate`、只读显示 "Delivered in CO-n"；各方重新确认简报；finance 的基线预填旧房间 `committedAfterCents` 但必须确认。`runs.requestRenegotiation` 只允许 creator 从 `pending_approval` / `needs_input` 发起（**C40**）。
- **被否决**：B（**C3**）——需要 `executedItemKeys` 进入规则输入、枚举、简报语义、审批快照冻结与非终态 `executed`，每一项都被评委打出反例；C——列入 17 E2；从 `executed` 或四种状态发起重新协商（C40）；"执行后任何写入一律拒绝"的字面（**C45**：会挡住任务勾选与后续变更）；照搬全部目录到后续房间（stub / 模型默认路径会把已执行条目再提一次、再承诺一次，invariants-06）。
- **后果**：正面——后续变更旅程零新不变量；新房间的必需项是重新确认的、已交付条目不被复制，重复承诺由复制过滤与 `item.duplicate` 杜绝；已执行历史不再被实时派生改写。代价——项目历史跨房间（17 E1 的"项目视图"可补）；用户需重新确认简报。关闭评委反例：FF-05、FF-08、FF-42（a）。残余：`startFollowUp` 的发起权限（§18.4 N-02）。

## ADR-D05 约束版本递增矩阵与硬投影

- **背景**：原文只隐含"预算变化 → 新约束版本"（AX-15）；候选在"目录标题是否 bump""today 是否进投影""provider 硬字段是否被检查"上互相矛盾；评委 FF-10（标题改动冻结协商）、FF-20（已声明的硬字段不在规则输入里）。
- **选项**：A 每个写入口手写"是否 bump"；B 由"硬投影比较"决定：`scenario.hardProjection(input) = canonicalJson({ capCents, requiredItemKeys, deadline, catalog: [{itemKey, revision, status, priceCents, leadDays}] })`，与 `checkProposal` 读同一份 `RuleInput`；C 目录任何确认都 bump；D 目录不在投影内。
- **决定**：B，唯一写入口 `constraints.bump`。递增：finance `capCents`；customer `requiredItemKeys` / `deadline`；provider 改已确认项的价格 / 工期、新增项、下架（含 modifier）；带约束效果的请求回答；`clock.rollLocalDate` 判定时间结论翻转（D22）。不递增：目录只改 `title` / `taskTemplates`（提案快照承载）、软字段与备注、披露开关、成员变动、执行、`localDate` 本身、`ledgerEntries`。守卫一律比较 `constraintsVersion`，删除 `catalogRevision`。性质测试："投影相等 ⇒ 阻断集合相等"。
- **被否决**：A——会漂移；C（**C8**）——provider 可无成本冻结协商；D（**C9**）——价格来源失守；席位进投影（va B15）；`todayAnchor` 进投影（C7 → D22）。canon 包修订（2026-10-24）另否决按"任何编辑都递增"的单一 `revision` 判来源（**C46**：`revision` = 定价修订号 + 同 revision 内的 `editNo`，ADR-X02）。
- **后果**：正面——所有写入者共用一条规则；标题与任务模板可安全编辑。代价——每个场景维护投影，由性质测试防漂移。关闭评委反例：FF-10、FF-20（v1 provider 的硬字段只有目录；任何新硬字段不进 `RuleInput` 就过不了性质测试）、FF-30（披露变化不 bump，但 `projectForRole` 与代理上下文读每角色最新确认版本，撤回即时生效）。待验证：同一 mutation 内读回本事务写入（versioned-approvals V1，§18.5 V-R09）。
