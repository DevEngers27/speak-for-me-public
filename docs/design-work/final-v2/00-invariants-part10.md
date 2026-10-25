# 00 · 反例电池 part10 — 2.6 生命周期与活性、2.7 执行边界、2.8 不伪造

> 分片清单见 `00-invariants.md`。2.6 对应 run-lifecycle E1–E17 与反驳 r01 / r02 / r04 / r07、versioned-approvals X11 / X12 / X21 / X22、inputs/07 的并行评估死锁 ×5 与 needs_input 死路 ×3、testing-ops r06。

### 2.6 运行生命周期 / 活性

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-121 | 回合 k 的 action 在途；（stub 加 `STUB_DELAY_MS`）期间另一路径产出 v3 → `pending_approval` → 执行；k 迟到调 `turns.complete` | INV-69：G1 不符 → attempt `stale`、usage 照记、事件；`runs.reconcile` 对终态 run 空操作；不触碰 proposals / approvals | CT |
| CE-122 | finance evaluate 回合进行中 finance 降预算（cv+1） | INV-32：run superseded、新 run 开始；INV-69：迟到结果 G1 / G3 → `stale`；不分配提案版本（INV-55） | CT + RD |
| CE-123 | attempt#1 超时被看门狗标 `timeout`，attempt#2 已创建；attempt#1 的 action 随后返回 | INV-69：G0（`currentAttemptNo` 不符）→ `stale`，不重复落库（va r03） | CT |
| CE-124 | action 因平台积压延迟 60 s 才开始；看门狗按调度时刻到期 | INV-71：读 `_scheduled_functions` 得 `inProgress` → 重登记（≤ 3 次），不判 timeout、不双付费 | CT + RD |
| CE-125 | 看门狗对已 `completed` 的 attempt 触发；或对已 `superseded` run 的 attempt 触发 | INV-71 / INV-69：G0 / G1 空操作，只写 ops 计数 | CT |
| CE-126 | 评估方 finance 回合 `refusal`（不可重试） | INV-70 / INV-73：run → `needs_input(agent_failed, toRole: finance)`，选项 `retry_turn` / `end_run`；没有"另一半并行回合"需要等待 | CT |
| CE-127 | 变异纵深：某写路径 bump 了 cv 但未 supersede run；下一回合 `loadTurnContext` G3 失败 | INV-69 / INV-70：attempt `stale` **且** `runs.reconcile` 发现 run 的 cv 也漂移（D06 被破坏）→ 修复分支：取代该 run（`endedReason: constraints_changed`）并 `react()` 开出新 run，写 ops 告警，不卡 negotiating（run-lifecycle r01、04 §4.3.5） | CT |
| CE-128 | run 1 `pending_approval` 时降预算到无合规组合（$4,400，`committed 400000 + 最便宜 80000 > 440000`） | INV-32(c) / INV-64：新 run 直接 `needs_input(infeasible)`、恰一个 open 请求；customer 视图（看不到已承诺额）候选集非空 → 被跳过；请求给 finance：`raise_cap` 480000 / 490000 + `end_run`（finance 位于 `relaxationOrder` 末位，没有 `pass_to_next`）；`attempts` 为 0 | CT |
| CE-129 | run 处于 `pending_approval`、当前提案 v2 $800 时，finance 把上限从 $5,000 降到 $4,800（v2 仍合规） | INV-32(a)：v2 同事务 `stale → active`，新 run 直接 `pending_approval`；不复制版本，同 proposalId 重批 | CT |
| CE-130 | 执行后 finance 再改预算 / provider 再 retire 条目 | INV-52：`run.invalid_state`；不开 run、不发请求 | CT |
| CE-131 | 执行后在新房间多次 bump；回到旧房间结果页 | INV-53 / INV-58：审批显示来自 `approvalIds` 快照，不显示 stale | E2E |
| CE-132 | 变异：reject 后提案保持 `active` 直到新提案 | INV-30：reject 同事务 `proposal → rejected`；`run.currentProposalId` 保留指向它（历史），后续 approve 由 `proposal.status` 守卫拒绝（`approval.not_current`） | CT |
| CE-133 | 活跃 run 存在时任一成员 `runs.start` | INV-67：返回同一 runId（`created: false`），不新建、不写、不计节流 | CT |
| CE-134 | 任一成员 1 小时内第 7 次成功调用 `retryTurn` / `requestRenegotiation` / `briefs.confirm` / 实际开局的 `runs.start` 任意组合 | INV-11 / INV-72 ①：`run.rate_limited { retryAfterMs }`；计数按用户 × 房间、按 distinct `commitTs`；幂等返回的 `runs.start` 与 `unchanged` 不计 | CT |
| CE-135 | 单 run 内 attempt 数达到 `runs.maxAttempts`（18）；或美元预留失败 | INV-72 ②③：不再调度，run → `needs_input` + customer 的 `rounds_exhausted`（码 `run.call_limit`，`questionKey` 为 `call_limit` / `spend_limit`），该请求不提供 `keep_as_is` | CT |
| CE-136 | `ops.setDraining(true)` 时：成员调 `runs.start`；live 回合 `beginAttempt`；finance 降预算触发 bump；在途 attempt 提交；随后解除排空 | INV-72：公开 `runs.start` 拒绝 `run.draining`；`beginAttempt` 停泊回合（`waitingReason: draining`）、不建 attempt；bump 后 `react()` 照常建新 run，只停泊首回合（约束变更不回滚）；在途 `turns.complete` 正常；stub run 不受影响；解除排空后 `ops.livenessSweep` → `runs.reconcile` 恢复停泊回合 | CT |
| CE-137 | `spendCounters(global, day)` 超限时被调度的 `beginAttempt` | INV-72 ④：返回 `deferred` 并 `runAfter` 到次日，不 throw、run 不失败 | CT |
| CE-138 | 构造任何进入 `needs_input` 却无 open 请求的路径（如旧设计 `stop_run`）；以及 `pass_to_next` / `choose_candidate` 复核失败这两条 `needs_input → needs_input` 自环 | INV-64：04 的每条 `→ needs_input` 迁移同事务 `openHumanRequestTx`；自环先关旧请求再开新请求；断言 `needs_input ⇔ 恰一个 open` | CT |
| CE-139 | open 请求 7 天无人回答；cron 到期 | INV-65：`expired`，run → `ended_no_agreement`，creator 待办；审批不过期 | CT |
| CE-140 | 失败方双击 `retry_turn` | INV-34 / INV-70：第二次请求已 `answered` → `request.not_open`；只一个新 turn / attempt | CT |
| CE-141 | finance 收到 `raise_cap` 请求后不回答而是直接 `budget.setCap` | INV-32 / INV-34：bump 把 open 请求 `superseded` 并走不动点；不出现"needs_input 无请求"悬空（candidates1 "edit_constraints 意向悬空"） | CT |
| CE-142 | run 已延长过一次后的 `rounds_exhausted` 请求里提交旧的 `keep_as_is` optionKey；轮次已尽时 customer 对 `agent_escalated` 选 `keep_as_is`；对 `clarify` 请求选 `keep_as_is` | INV-65：第一种 → 新请求不再提供 → `request.option_unknown`；第二种等价 `end_run` → `ended_no_agreement`；第三种 = 拒绝披露、发问方同轮新开回合，不消耗轮次 | CT |
| CE-143 | 穷举 `RUN_TRANSITIONS` / 提案 / 请求 / attempt 迁移表：对每个 (from, to) 调用 `assertTransition` | INV-76 / INV-68：终态无出边；`failed → pending_approval`、`executed → *`、`rejected → active` 等不在表中；`stale → active` 只在 bump 事务内经 R2 出现 | P |
| CE-144 | customer `choose_candidate` 选的候选在全视图复核下不通过（触犯未披露的卖方约束） | INV-73：旧请求 `superseded`（`closedReason: regenerated`，`answerOptionKey` 照记以保留"人选了什么"），该候选进剔除集，同事务生成同 kind 新请求，run 保持 `needs_input`；不插入不可执行提案 | CT |
| CE-145 | `humanRequests.answer(raise_cap)` 后检查该请求行 | INV-34：`answered` + `answeredBy` + `answerOptionKey` 已写，`constraintRevisions.sourceRefs` 指向该请求（追溯不断链） | CT |
| CE-146 | (a) 最后一个就绪条件（第三份简报确认）满足时 `draining` 为真；(b) 该成员的 `constraint_writes` 已满时提交第三份简报确认 | INV-75 / INV-67：(a) 简报写入、房间 `open`、cv 1、run 建立，首回合停泊（`waitingReason: draining`）、无 attempt；解除排空后由 `ops.livenessSweep` → `runs.reconcile` 恢复，无需成员 `runs.start`；(b) 那次 `briefs.confirm` 整体被拒（`run.rate_limited`），简报不写入、房间仍 `setup` | CT |

### 2.7 执行边界（核心 7）

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-147 | 变异：`package.json` 加入 `stripe` / `@sap/*` / `docusign-*` / `nodemailer` | INV-59：依赖白名单测试红 | P |
| CE-148 | 变异：`convex/executions.ts` import `"use node"` 模块或 action；`executeIfComplete` 内 `runAfter` | INV-59 / INV-60：`no-restricted-imports` 红；写集合白名单测试红 | P |
| CE-149 | 变异：`core/engine` 内出现 `Date.now()` / `fetch` / `import { v } from 'convex/values'` | INV-59 引擎纯度 lint 红 | P |
| CE-150 | 打开变更单页与打印视图，查找免责声明与 `SimulatedBadge` | INV-61 | E2E |
| CE-151 | 枚举 `convex/` 的公开 action | INV-60：只有 `invites.createLink`（随机数 + 哈希）；`invites.create` 是 memberMutation；其余 action 均为 internal | P |

### 2.8 不伪造（核心 8）

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-152 | seed 房间走完主线执行；检查 `executions` / `changeOrders` / `tasks` / `ledgerEntries(commit)` 的 `provenance` | INV-62：全部 `seeded`（stub 产物 `stub`），schema 必填 | CT |
| CE-153 | stub 模式运行到执行；三窗口检查徽章 | INV-62 / INV-61：`SimulatedBadge` 出现在提案卡、变更单、任务 | E2E |
| CE-154 | 缺 provider 目录 / 缺 baseline 时第三份简报确认；随后 finance 录入 baseline 成为最后一个就绪条件 | INV-75 / INV-67：就绪不满足 → 房间停在 `setup`、不 bump、不开 run，界面按 `roomReadiness` 缺口列出缺项与负责角色；不要求代理在无目录下提案；baseline 录入时 `openIfReady` 同事务打开房间并开首个 run（cause `room_opened`） | CT |
| CE-155 | fixture 变体用 seed 伪造 `capCents < committedCents` | INV-63：fixture 自检拒绝；该变体只能是"写入被拒" | P |
| CE-156 | 变异：seed 用 `t.run` 直接 insert 已批准的 v1 | INV-63：seed 一致性测试红（seed 只经生产入口链：缺省第三份确认同事务开首个 run 并由 stub 推进，`stopBeforeRole` 停在 `setup`；seed 自身永不写提案 / 审批 / 执行） | CT |
| CE-157 | stub run 进行中把 `AGENT_MODE` 改为 `live` | INV-66：该 run 仍 stub（`runs.agentMode` 快照），新 run 才是 live | CT |
