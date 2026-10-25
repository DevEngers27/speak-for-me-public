# CN-005 · External design review (9 reports): items that need a canon ruling

Raised by: external review consolidation (Codex / Gemini / Grok × invariants / privacy_platform / implementability), 2026-10-24. Status: pending canon ruling. Each group appends only its own section; canon text is not edited by the apply step.


## 组：model-schema（02-domain-model / 03-schema / 00-invariants / 00-product-decisions）

### CONS-08 · 终态房间里迟到 attempt 的用量与预留结算

- **来源**：codex-invariants#codex-invariants-07、codex-privacy_platform#codex-privacy_platform-04（consolidated.json `canon_change: true`）。
- **矛盾**：canon D04 规定 `executed` 房间"只有两个写入豁免"（`tasks.markDone`、`rooms.startFollowUp`），03 §3.3.2 第 2 条据此并按 04 §4.2.2 让 `openRoomTx` 默认拒绝 `executed` / `closed` 房间；而 04 G1 / U6、10 §10.7 与 §10.13、12 §12.6（`rooms.close`："在途 attempt 不取消，其提交被守卫 G1 拒收"）都要求在途 attempt 的迟到结果"用量照记"——attempt 置 `stale` / 补写 `lateUsage`、结算 `runs.reservedMicroUsd` / `spentMicroUsd`、回补 `spendCounters(global, day)`。房间在 attempt 返回前被关闭，或旧 run 的 live attempt 返回前房间已经执行时，`turns.complete` / `turns.fail` / `agents.watchdog` 在 `openRoomTx` 处先抛 `run.invalid_state`，到不了 G0–G3：用量永不记录，美元预留永不释放（全局日计数只增不减），attempt 停在 `running` 直到看门狗也同样写不进去。
- **拟议裁定**：D04 增加第三个、只限 internal 的豁免——attempt 结算路径（`turns.complete` / `turns.fail` / `agents.watchdog` 的 G0–G3 拒收分支，经 `openRoomTx({ allow: ['executed', 'closed'] })` 的专用变体 `settleAttemptTx`），仍持房间写锁，只许写：attempt 的用量 / 终态（`stale` / `timeout`）/ `lateUsage`、`rawOutputs`、所属 run 的美元字段、`spendCounters`，以及不含私密值的 `turn_rejected_stale` 事件；不建 turn / 提案 / 审批 / 请求，不改 run 或房间状态，不调度任何函数，不复活 run。`closed` 房间同样适用（D04 只管 `executed`，`closed` 的拒绝来自 04 §4.2.2）。公开 API 的终态拒绝表不变。
- **受影响章节**：00-canon D04；03 §3.3.2 第 2 条、SC-T5；04 §4.2.2 与 `executed` 拒绝清单；07 §7.7；10 §10.7、§10.13；12 §12.2.10、§12.6；16（迟到结果在 `executed` / `closed` 房间结算的用例）；00-invariants（D04 / INV-69 – INV-71 对应条目）。

### CONS-07（canon 措辞同步）· `item.limit_exceeded` 多了任务模板合计这一触发条件

- **来源**：CONS-07 落地附带（verifier 跟进，组：model-schema）。非 canon 部分已落到 03 §3.7（`taskTemplates` 字段注释、`appendCatalogRow` 校验清单）与 03 §3.13.1（`appendCatalogRow` 写后守卫、`insertProposal` 的 internal 断言）。
- **矛盾**：03 §3.13.1 的 `appendCatalogRow` 现在写后还检查在架 item 的 `taskTemplates` 条数之和 ≤ `MAX_TASKS_PER_EXECUTION`（50，08 §8.4.4），违反同样报 `item.limit_exceeded`；canon §1.5 对该码的释义只有"目录超过 12 个 item 或 2 个 modifier"，少了这第三种含义。
- **拟议裁定**：canon §1.5 `item.*` 中 `limit_exceeded` 的释义同步补上"或在架 item 的任务模板合计超过 50"，即改为"目录超过 12 个 item 或 2 个 modifier，或在架 item 的任务模板合计超过 50"。不新增码，上限 50 不变。
- **受影响章节**：00-canon §1.5；（已落）03 §3.7、§3.13.1；06 错误表与 12 §12.12 的码说明随 canon 同步。


## 组：state-protocol（04-state-machines / 05-protocol / 09-constraint-changes / 10-agent-runtime）

### CONS-82 · 预检结论在 `run_starts` 桶用尽后照常发布

- **来源**：gemini-privacy_platform#gemini-privacy_platform-09（consolidated.json `canon_change: true`）。
- **矛盾**：canon D12 ⑥ 末句称预检探针"总量由 ⑥ 的三个每房间每 24 小时桶封顶"，并把 `run_starts` 写成"含系统自动开局"。但 `run_starts` 只在 10 §10.5.2 B6a 处生效，即 R1 首回合的第一个 attempt；04 §4.3.3 `startRunTx` 的 R2（直接 `pending_approval`）与 R3（`needs_input` + `infeasible` 请求，零模型调用）分支在同一事务里立即发布，根本到不了 B6a。所以桶满之后，每次约束写入的预检结论（provider 看到 "awaiting approval" / "agents working" / `run_waiting`）照常可见。07 DX-2 / PV-16 实际把总量上界归给 `price_writes` 与 `setCap` / customer 硬字段子桶，和 D12 的措辞对不上。`humanRequests.answer` 的约束效果（`raise_cap` / `drop_items` / `extend_deadline`）算不算进硬字段子桶，canon 和 07 都没写。
- **评审提议**：R1/R2/R3 发布前加一个共享的"预检披露预算闸门"；超限时只落约束、新建停泊的 run、不求值不发布，窗口腾出后再经同一闸门唤醒；为此新增显式的 parked-precheck 表示与 reconcile 规则。
- **拟议裁定**：不采纳 parked-precheck。它新增一种等待态，和 D06"系统路径照常建 run、立即预检"以及 D12"不设无出口等待态"冲突，还会让约束变化后的房间状态延迟可见。改为修订 D12 ⑥ 措辞：
  - `run_starts` 只限制模型回合开局（R1 首回合停泊为 `run_cap`），不承担预检 1 bit 的总量上界；
  - 预检总量上界由 `price_writes` 与 `setCap` / customer 硬字段子桶承担；
  - 明确 `humanRequests.answer` 的约束效果计入硬字段子桶：`raise_cap` 计 `setCap` 侧，`drop_items` / `extend_deadline` 计 customer 侧；
  - `clock` bump 不由用户触发，不计入任何桶。
- **受影响章节**：00-canon-part3 D12 ⑥；04 §4.3.3（R3 的 1 bit 说明）；07 §7.13 DX-2 / PV-16；10 §10.5.2 B6a、§10.12.1；12 B7。

### CONS-61（落地附带）· 看门狗在终态房间的写锁，依赖 CONS-08 的裁定

- **来源**：gemini-invariants#gemini-invariants-16。这一项本身不改 canon，非 canon 部分已落到 10 §10.8 与 §10.7.2 步骤 1。
- **矛盾**：看门狗原来用 `ctx.db.patch` 重登记，绕过了写门面（INV-M1）；现已改为经 `ctx.tx` 写：房间 `open` 时用 `openRoomTx(allow: ['open'])`，`executed` / `closed` 时用结算变体 `settleAttemptTx`。终态房间这一半需要 canon D04 的内部结算豁免，和 model-schema 组的 CONS-08 是同一个问题。
- **拟议裁定**：跟随 CONS-08 的裁定。若采纳，`settleAttemptTx` 的可写集合还要加上 attempt 的 `costState`、`inProgressSeenAt`、`physicalLeaseUntil`（10 §10.8 / §10.12.2，对应 CONS-25 / CONS-43），以及 run 与 `spendCounters` 的 `unknownExposureMicroUsd`。若否决，10 §10.8 / §10.7.2 的终态房间分支要改回裁定后的写法。
- **受影响章节**：00-canon-part2 D04；03 §3.3.2（`settleAttemptTx`、`MUTABLE_FIELDS`）；10 §10.7.2、§10.8。


## 组：rules-privacy（06-rules-engine / 07-permissions-privacy / 14-scenario-scope-change / 16-testing）

### CONS-42 · provider 的剔除集合里有私密的 `choose_candidate` 复核失败

- **来源**：codex-privacy_platform#codex-privacy_platform-05（consolidated.json `canon_change: true`）。
- **矛盾**：canon D10（核对者同步后的现文）规定 provider 快照剔除 `excludedCandidateKeys(run)`，即已提出 ∪ 被人拒绝 ∪ `choose_candidate` 复核失败。07 DX-12 却只把复核结局（`applied` / `regenerated`）解密给 customer（`toRole`）。复核失败后，同一 run 里 provider 还可能再有回合（`rounds_exhausted` 或 customer `agent_escalated` 回答 `keep_as_is` 后进入下一轮）。这时该候选从 provider 快照里消失，≤ 12 截断还会让别的候选跟着进出。provider 对比前后两份快照，就能推出"customer 选过 X，X 没通过全局复核"。这是一条没登记的派生信道，违反 07 §7.8.6 末段"不在清单里的派生值一律继承最严格输入的类"，也违反同处的非干扰定义。07 §7.14.2 provider 行逐字照抄 D10，改它就得改 canon，所以本组没有动正文。
- **拟议裁定**：剔除集合按收件人拆开。provider 快照只剔除两类键：本 run provider 已提出的（含被阻断的），以及被人拒绝的提案（后者已对房间公开，DX-6）。`choose_candidate` 复核失败的键只进 customer 侧的 `chooseExcludedKeys`。代价：provider 之后可能提出 X 并被阻断，但这落在已登记的 DX-1 里（每 run ≤ 4 次提案）。配套性质测试：两条 provider 历史若只在私密的复核失败上不同，provider 快照必须逐字节相同。
- **受影响章节**：00-canon-part2 D10；03 §3.5（剔除集合的派生）、SC-T18 附近；05 P11、§5.3.3、§5.7.2；06 §10.1 第 4 条、§11.1 `run.excludedCandidateKeys` 注释、§11.3 第 4 条；07 §7.14.2 provider 行、DX-12；14 S8；00-invariants INV-09；02 INV-09；01 P 表"被挡住时代理能做什么"；18 D10 ADR；16 TC-RUN-12、TC-PRIV-05。

### CONS-118（canon 部分）· D12 ⑥ 的"合计每天至多数十 bit"漏算 DX-1 与 DX-12

- **来源**：codex-privacy_platform#codex-privacy_platform-01、grok-privacy_platform#grok-privacy_platform-01、grok-privacy_platform#grok-privacy_platform-02。不涉及 canon 的部分已落到 07 §7.13 量化段与 §7.21 R-1：改成逐信道核算，写明 DX-12 没有日总量桶，不再宣称 39 bit 是全信道总量。
- **矛盾**：canon D12 ⑥ 末句说预检探针的总量"由 ⑥ 的三个每房间每 24 小时桶封顶（合计每天至多数十 bit，07 §7.13）"。07 原先的 39 bit 只加了三类：DX-2 改价（≤ 4.8 bit）、`setCap` / 硬字段（≤ 9.5 bit）和 counter（≤ 24 bit）。漏掉两类：一是 DX-1 provider 提案结局，按 `run_starts` 6 × 每 run 4 计，每天 ≤ 24 bit；二是 DX-12 `choose_candidate` 复核结局，每次 ≤ 1 bit，只受 D12 ⑥ 的每小时 6 次节流，没有任何日总量桶（customer 每天最多约 144 次）。所以"合计每天至多数十 bit"没有机制支撑。这和 state-protocol 组 CONS-82 改的是同一句 D12 ⑥，可以一并裁定。
- **拟议裁定（二选一）**：
  - (a) 给 DX-12 加日总量：`humanRequests.answer` 中复核失败（`regenerated`）的 `choose_candidate` 回答，计入每房间每 24 小时的一个小桶（例如 ≤ 6 次，计数源 `superseded(regenerated)` 请求或 `human_request_answered{ outcome }` 事件）。D12 ⑥ 末句改成逐信道列出上界：DX-1 / DX-11 由 `run_starts` × 4 封顶，DX-2 由 `price_writes` 与硬字段子桶封顶，DX-12 由新桶封顶。
  - (b) 不加桶。D12 ⑥ 末句改成"只对总量桶覆盖的信道有日上界；DX-12 只限速率，没有经验证的全信道日上界"。07 §7.21 R-1 的用户告知文案也要相应说明。
  - 两种读法的后果：(a) 能恢复"每天有限 bit"的承诺，代价是 customer 在困难房间里反复挑候选可能被限流；(b) 不改实现，但承认 customer 侧可以通过反复挑候选、按每小时 6 次的速率探测全局可行性。
- **受影响章节**：00-canon-part3 D12 ⑥；07 §7.13、§7.21 R-1、PV-16；12 B7、§12.2 第 7 条、§12.14；16 TC-AUTH-13（若取 (a)，加 DX-12 桶的断言）。

### CONS-18（附带的 canon 措辞残留）· D10 括注里的 `lines[]` 形状比 D25 少字段

- **来源**：随 CONS-18（codex-implementability#codex-implementability-09 等）落地时发现。本项不要求改决定，只是措辞对齐。
- **矛盾**：06 §7.1 的 `Line` 与 14 §6.2 `materialize` 已按 canon D25 / 03 §3.4 `lineV` 补上 `kind`。但 canon D10 物化说明的括注仍写 `lines[{itemKey, revision, priceCents, title}]`，没有 `kind` 和 `leadDays`，和 D25 的 `{itemKey, kind, revision, title, priceCents, leadDays}` 字面不一致。
- **拟议裁定**：D10 括注改为"`lines[]`（形状见 D25）"，不再单独列字段。
- **受影响章节**：00-canon-part2 D10（只改措辞）。


## 组：product-api（01-product / 08-approval-execution / 11-architecture / 12-api / 13-frontend / 15-operations / 17-roadmap / 18-decisions-open-questions / 00-overview / README）

### CONS-04 · 后续房间的"已交付范围"只看直接前序

- **来源**：codex-implementability#codex-implementability-03、codex-invariants#codex-invariants-03、gemini-invariants#gemini-invariants-02（consolidated.json `canon_change: true`）。
- **矛盾**：canon D04 与 INV-52 把已交付范围写成"旧执行的 `terms.itemKeys`"，即只看 `followsExecutionId` 指向的直接前序；12 §12.6 / §12.12 ④、03 §3.13.1 `appendCatalogRow`、04 §4.9 C1 都照此只做一跳过滤。后续房间还能再开后续房间（每个 execution 至多一个后续房间，但链可以延长：CO-1 → CO-2 → CO-3）。CO-3 房间的 `catalog.confirm` ④ 只和 CO-2 的 `terms.itemKeys` 比较，provider 可以把 CO-1 已交付的键（如 `sso_login`）重新上架，customer 也能要求它，于是已交付范围被再承诺一次；`followUpOf.deliveredItems` 同样只列直接前序。这违反核心 5 / INV-52 的跨房间承诺。
- **拟议裁定**：D04 / INV-52 的"已交付"改为祖先链并集：`deliveredItemKeys(room) = ⋃ terms.itemKeys`，从 `room.followsExecutionId` 出发，经该执行所在房间的 `followsExecutionId` 逐级回溯。回溯要做环检测，链长设上界（例如 ≤ 20）；链不完整（某个前序执行或房间缺失）一律 fail closed（抛 `internal`，不写）。`startFollowUp` 的复制、`catalog.confirm` ④、简报必需项校验、`followUpOf.deliveredItems` 都用这同一个集合。替代读法：保持一跳，但禁止"后续房间再开后续房间"（`startFollowUp` 只对非 follow-up 房间开放）。这样实现更简单，代价是砍掉一段产品旅程。
- **受影响章节**：00-canon-part2 D04；00-invariants INV-52 / CE-112 / CE-168；02 INV-58；03 §3.13.1 `appendCatalogRow`；04 §4.9 C1；12 §12.6、§12.12 ④、§12.17 `followUpOf`；13 §13.10 C；16 TC-EXE-06 / TC-EXE-11（加三代链用例）。

### CONS-114 · "哪个就绪条件最后都可以"与 customer 简报依赖已确认目录相矛盾

- **来源**：gemini-implementability#gemini-implementability-02（consolidated.json `canon_change: true`）。
- **矛盾**：canon D12 ⑧ 的修正草稿写"最后一个就绪条件（第三份简报、首次目录确认或基线录入，哪个最后都可以）"。可同一条 D12 ⑧ 与 12 §12.9 ⑤ 又要求 customer 的 `requiredItemKeys` 非空，且必须是本房间曾确认过的目录键，所以 customer 简报只能在首次目录确认之后提交，"首次目录确认"不可能落在三份简报全部确认之后。00-invariants CE-154 的"缺 provider 目录时第三份简报确认"一支也因此构造不出来。01 part2 的走查原先让 C3 从已确认目录里选必需项、C4 又在等 provider 确认目录，同样走不通。本组已把走查改为目录先确认、provider 简报是最后一个就绪条件（01 part2 C3–C5），这一改动不依赖本条裁定。
- **拟议裁定**：D12 ⑧ 改为"最后一个就绪条件可以是任何一个彼此独立的剩余条件（席位、provider / finance 简报、baseline）；customer 简报依赖已确认目录，所以首次目录确认总在 customer 简报之前"。CE-154 改为"三份简报已确认但缺 baseline，随后录入 baseline 成为最后一个就绪条件"，另加一条"目录确认前提交 customer 简报 → `item.unknown`"。
- **受影响章节**：00-canon-part3 D12 ⑧（"哪个最后都可以"一句）；00-invariants INV-75 / CE-154；04 §4.2.1；12 §12.9；14 S3；16（CE-154 对应用例）；01 part2 C3–C5（已按拟议方向改写）。

### CONS-26 · 约束变更后失效提案的检查结论与审批槽在房间页无来源

- **来源**：gemini-implementability#gemini-implementability-01、gemini-invariants#gemini-invariants-07（consolidated.json `canon_change: false`）。转来裁定的原因：评审给的落地方式会改动 canon D12 ① / D19 的解读，需要改写 INV-11、07 §7.9.3，并且正是 18 N-07 的待决项。
- **矛盾**：D27 主线与 D19 要求预算下调后，界面仍能看到 v1"No longer current"和两条"No longer applies"审批。但 v1 没被新 run 保留时，`rooms.view.currentProposal = null`，`proposalHistory` 只有存储状态，`proposals.get` 对非当前提案又不带检查（12 §12.17、13 §13.9.2、07 §7.9.3、INV-11；18 N-07 的默认值是"历史提案不带检查"）。01 C7 与 13 §13.11 第 5a / 5c 步原来写的失效检查行（"A participant's private constraint isn't met"、"over by $100"）因此没有数据来源；本组已按 CONS-78 删去这些实时结论，只保留存储状态。评审的提议是加 `lastInvalidatedProposal`：不可变条款、两条 `stale_approve` 槽加一条未投票的 pending 槽，外加在 bump 事务内冻结一次的失效评估（finance 精确、customer 掩码、provider 通用），历史永不重算。
- **拟议裁定（两种读法）**：
  - (a) 采纳冻结快照：`constraints.bump` / `disposeCurrentRun` 在同一事务里把被置 `stale` 的当前提案的 `checks` 冻结进该 cv 的 `constraintRevisions` 行（新字段，落在 03 / 09）。`rooms.view` 增加 `lastInvalidatedProposal { proposalId, version, terms, lines, approvals[], invalidatedAtConstraintsVersion, checksAtInvalidation }`，按 07 §7.11 `projectChecks` 投影；provider 只见 "No longer current"（D12 ①）。INV-11、07 §7.9.3、18 N-07 改写为"历史提案不实时重算；失效时冻结的结论按冻结时的受众显示"。后果：customer / finance 能在房间页看到 v1 为什么失效；代价是多一个存储字段和一条披露规则。
  - (b) 维持现状：历史提案只显示存储状态，失效审批经 `proposals.get().decisions` 与收件箱 `notice` 呈现，D19 的"旧审批保留"由永久链接满足。后果：不新增任何披露面，但房间页上看不到 v1 的失效原因。
  - 本组倾向先采纳 (a) 里的槽位部分：`lastInvalidatedProposal` 只带条款与审批槽，审批行本来就对房间可见，不新增披露。检查快照部分留待裁定。
- **受影响章节**：00-canon-part3 D12 ① / D19（解读）；00-invariants INV-11；03 `constraintRevisions`；07 §7.9.3、§7.11；09 §9.4 `disposeCurrentRun`；12 §12.17 `rooms.view`；13 §13.9.2、§13.11；14 S7；16（历史提案的隐私用例）；18 N-07。

### CONS-48 · 按原始事件行分页无法保证提交级的作者中立

- **来源**：codex-implementability#codex-implementability-12、codex-privacy_platform#codex-privacy_platform-03、gemini-privacy_platform#gemini-privacy_platform-13（consolidated.json `canon_change: false`）。转来裁定的原因：评审给的落地方式正是 canon D14 明确否决的写法。
- **矛盾**：12 §12.17 `timeline.page` 对原始事件行做一次 `.paginate()`，渲染时再把"与 `constraints_changed` 同一提交"的他人条目对 provider 并成一条（07 §7.17 作者中立）。问题有两个：
  - 一个提交的事件被页边界切开时，provider 会在前一页看到孤立的 `brief_confirmed` / `disclosure_changed`：并入规则在同一页里找不到 `constraints_changed`，于是暴露了变更者。
  - 并入会让同一页原始行对 provider 渲染出更少的条目，条目数之差就是"这次约束变更带了几条附属事件"，同样指向变更者。
  
  所以 12 末句"页大小因此稳定"不成立。评审建议在写入时按受众生成 `timelineGroups`（`(roomId, audience, publicOrder)`），改为分页这些组。这正是 canon D14 否决的方案：写入时的 `visibility`，以及双写 room 级与 owner 级事件。
- **拟议裁定**：保持 D14 的"事件无 visibility、渲染时按查看者连接"，只把分页单位从事件行改为提交。具体做法：`events.append` 为每个事务标出一个受众中立的提交头（新增提交头行，或给 `seq === 0` 的事件建索引）；`timeline.page` 分页提交头，再按 `(roomId, commitTs)` 前缀读出该提交的全部事件，按查看者渲染；DTO 只含渲染后的条目，不带原始行数。这样所有查看者在同一游标下拿到同一组提交，页大小和条目数都不再泄露作者。D14"排序与游标"一句相应改为"游标在提交粒度"。替代读法是采纳评审的按受众写入投影组，那就必须修订 D14 的否决项。
- **受影响章节**：00-canon-part3 D14；03 §3.11（`events.append`、提交头表或索引）；07 §7.17；12 §12.17 `timeline.page`、B9 / API-14；13 §13.10 E；16 §16.7.5、TC-PRIV-21（在页大小 1 与 2 下比较调用者可见的全部分页元数据）。

### CONS-79（canon 措辞残留）· D18 的 `ctx.meta.getDeploymentMetadata().name` 缺 `await`

- **来源**：CONS-79 落地附带（verifier 跟进，组：product-api）。本项不改 canon 规则，只做措辞对齐。
- **矛盾**：`ctx.meta.getDeploymentMetadata()` 返回 Promise。11 §11.10 的 `assertTier` 已改为 async、调用方一律 `await`；15 §15.2 与 §15.9、12 §12.20 `seed.reset`、18 ADR-D18 都已写成 `(await ctx.meta.getDeploymentMetadata()).name`。canon D18 仍写"入口 `assertTier` 读 `DEPLOYMENT_TIER` 与 `ctx.meta.getDeploymentMetadata().name`"，照抄会对 Promise 取 `.name`（得到 `undefined`），部署名比对因此失效。
- **拟议裁定**：D18 该句改为"入口 `await assertTier(...)` 读 `DEPLOYMENT_TIER` 与 `(await ctx.meta.getDeploymentMetadata()).name`"。规则本身不变：seed / reset 只在 dev / preview / test，`seed.reset` 的 `confirmDeployment` 必须等于部署名。
- **受影响章节**：00-canon-part3 D18（只改措辞）。同一措辞还出现在 00-invariants CE-109 与 16 TC-OPS-03（都不是 canon，交对应组跟进）。

## Late additions (2026-10-25, from the review-guide appendix gap check)

### CONS-113 — delivery-date formula: `max(leadDays)` vs subtracting modifier lead days (canon_change: true; needs ruling)
Sources: codex-implementability / gemini-invariants (consolidated CONS-113). Canon D22 and INV-36 fix the materialised delivery date as `localDate(insert day) + max(leadDays)` and never recompute it; 14 §6.2 (scope-change) and the implemented `materializeTerms` let a `rush` modifier **subtract** lead days. Contradiction at the canon level, so no chapter edit was made. Proposed ruling: keep canon's "materialise once, never recompute" and let the scenario's lead-time rule be `max(item leadDays) + Σ modifier leadDays` with negative modifier values allowed and clamped at `>= 0 days` — the formula is a scenario member (06 §12), canon only fixes *when* it is applied; D22 / INV-36 wording changes from `max(leadDays)` to "the scenario's lead-time rule". Affected: 00-canon D22, 00-invariants INV-36, 14 §6.2, 06 §9 (materializeTerms contract), battery CE rows on delivery dates. Code today follows 14 (subtracts) — no change needed if the ruling is accepted.

### CONS-39 — decision index / review log still label completed alignment as unresolved (bookkeeping; no ruling)
Target: 18 §18.4.3 / §18.6.1 and the review log U-10 row. Change: mark U-10 resolved ("06 §8 delegates to 07 `projectChecks`; remaining mismatch is the 14 `CheckDecl` shape"), and mark the resolved platform gates (currentRunId retention, draft append, disclosure recipient, reviewed questions) as resolved links, keeping genuinely open gates. Pending: a small editor pass; no chapter semantics change.
