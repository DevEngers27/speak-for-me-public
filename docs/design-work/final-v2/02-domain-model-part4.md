# 02 · 领域模型（part4）：派生而不存、金额与日期命名、所有权

> 分片清单见 `02-domain-model.md` 顶部。

## 2.8 派生而不存

每个派生量都是纯函数（`core/engine` 或场景插件），输入是同一事务（mutation）或同一快照（query）读到的事实；没有任何表存储它们（03 SC-T6 的防回潮扫描包含这些名字）。

| 派生量 | 定义 | 实现（所属章） | 读取的事实 | 为什么不存 |
| --- | --- | --- | --- | --- |
| `passesChecks(p)` | `checkProposal(p, RuleInput@room.constraintsVersion, room.localDate).blocking = ∅` | 06 `checkProposal` | 当前三方硬字段（各角色最新 `briefs`）、当前目录行、`Σ ledgerEntries`、`rooms.localDate` | 依赖当前约束与"今天"；存了会在 bump 或跨午夜后过时 |
| `isExecutable(p)` | `p.status === 'active'` ∧ `p._id === run.currentProposalId` ∧ `run = room.currentRunId` ∧ `run.status === 'pending_approval'` ∧ `passesChecks(p)`；**不**比较 `createdAtConstraintsVersion` | 08（INV-35） | 上行 + `rooms`、`runs`、`proposals` | 同上；canon D02 要求每张 approve 写入前、canon D03 要求执行事务内各重算一次 |
| `allApproved(p)` | `evaluateApprovalSet(p).complete`：`requiredApprovals` 每个 `{role}` 恰有一位**当前**成员，其 seq 最大行为 approve 且 `boundConstraintsVersion === cv` ∧ `boundTermsKey === p.termsKey`，选中的 userId 两两不同 | 08（全系统唯一实现） | `approvals.by_proposal_user` 整区间、`members.by_room_role`、`rooms.constraintsVersion` | 依赖当前 cv 与当前成员；计数式字段会被双击或一人多席提前凑满 |
| 执行条件 | `isExecutable(p) ∧ allApproved(p)`，只在最后一张 approve 的事务里成立并立刻执行 | 08 | 同上 | "齐了但未执行"不应成为可观察状态（08 G5） |
| 每个必需角色的审批有效性 | `pending` / `effective` / `stale_approve` / `rejected` / `stale_reject` / `withdrawn`（判定表见 04 §4.7.1）；房间 `executed` 后改读 `executions.approvalIds` 冻结快照 | 08 `evaluateApprovalSet` 的投影 | 同上 | 按当前版本派生会改写已执行历史（inputs/07 第五类 4 条），所以执行后冻结 |
| `committedCents` | `sumCents(ledgerEntries where roomId)` | 06 `loadRuleInput` | `ledgerEntries.by_room_kind` | 计数器会与执行漂移；`open` 期间恒定（baseline 只在 setup，commit 只在执行） |
| `headroomCents` / `overByCents` / `shortfallCents` | `capCents − committedCents`（D23 保证 ≥ 0）；`max(0, committed + amount − cap)`；无解时"finance 视图内最便宜候选 − headroom" | 06 | 同上 + finance 当前简报 | 继承 finance 类；customer 只能经 finance 的共享行看到（07 §7.8.5） |
| provider 看到的 `fit` | 只对 `run.currentProposalId` 现算 `passesChecks ? 'ok' : 'blocked'`；历史提案只给 `superseded / rejected / executed / current` | 07 投影 | 同 `passesChecks` | 每个提案至多 1 bit（D12 ①）；历史不重算，免得旧提案在新约束下被重新标注成预言机 |
| 房间阶段 `phase` 与 `todos` | `setup` / `negotiating` / `needs_input` / `awaiting_approval` / `stopped` / `executed` / `closed`（04 §4.10 `derivePhase`），每个阶段对应"谁该行动" | 04 | `rooms`、当前 run、当前 turn、open 请求、审批有效性、就绪缺口 | 只存 `rooms.status`（4 值）与 `runs.status`；阶段是组合视图 |
| 就绪缺口 `readinessGaps` | 三席齐、三份简报已确认且硬字段齐、≥ 1 条 confirmed item、已有 baseline（04 §4.2.1） | 场景 `readiness` | `members`、`briefs`、`catalogItems`、`ledgerEntries` | 每次写入都可能改变缺口 |
| customer 视图的"未纳入条目" | `(requiredItemKeys ∪ preferredItemKeys) − terms.itemKeys`，只在 `projectForRole('customer')` 内现算 | 07 投影 | customer 当前简报、当前提案 | 由私密集合派生，存或公开即泄露（D11，替代被删除的 `deferredItemKeys`） |
| run 内计数 | 每角色 `propose / counter` 次数（≤ 4）、clarify / escalate 是否已用、本 run 已阻断的 `candidateKey` 集合 | 05 `ActionCtx` 由 04 `createTurnTx` 组装 | `turns.by_run_turnSeq`（`result` / `outcome`）、`approvals.by_run_decision`（本 run 的 reject，含 D06 沿用的旧 run 提案；03 §3.8）、`humanRequests.by_run_status` | 每 run ≤ 约 15 行，现算无成本；存计数会与回合结果漂移 |
| 当前简报 / 当前目录行 / 当前共享事实 / 本人当前审批 | 对应索引前缀上的最后一行（`version` / `(revision, editNo)` / `seq` / `seq`） | 各读取 helper | 对应索引 | "当前"是"最新一行"的投影，不存指针就不会悬空 |
| 共享事实对某查看者的有效值 | 最新行 `value !== null ∧ viewer ∈ audience`；历史值按"该值所属版本时生效的行"判定 | 07 §7.8.3 | `sharedFacts.by_room_from_field` | 撤回与改受众即时生效，且不溯及既往 |
| 邀请是否过期 | `now >= expiresAt`，只在 `invites.accept`（mutation）判定；列表只返回 `expiresAt` | 07 / 12 | `invites` | query 不读时钟（D22） |

`isExecutable` 的口径说明：canon D02 要求"approve 前跑 `isExecutable`"、D03 要求"执行事务内 `isExecutable` 重算"，两处都必须在审批集合尚未齐时有意义，所以本章按 00-invariants INV-35 把它定义为"状态 + 规则"，审批集合另名 `allApproved`；canon §1.3（C44）已采用同一定义，04 §4.1.1、08 §8.4.2、12 与 INV-35 现已统一为"当前性 ∧ `passesChecks`，不含审批集合"（2.14 Q1 已关闭）。

## 2.9 金额与日期命名（全篇统一）

| 名称 | 含义 | 来源 / 计算 | 默认披露 |
| --- | --- | --- | --- |
| `priceCents` | 目录行价格（item 或 modifier） | provider 确认 | room |
| `terms.amountCents` | 本次变更金额 = `Σ lines[].priceCents`（例 $900 = 90000） | `insertProposal` 物化 | room |
| `capCents` | 预算上限 | finance `briefs.hardFields.capCents` | finance；customer 经共享行 |
| `committedCents` | 已承诺 = `Σ ledgerEntries.amountCents`（例 400000） | 派生 | 同上 |
| `headroomCents` / `overByCents` / `shortfallCents` | 余量 / 超出 / 缺口 | 派生（2.8） | 同上 |
| `committedBeforeCents` / `committedAfterCents` / `capCentsAtExecution` | 执行时的快照（例 400000 / 480000 / 480000） | `executeIfComplete` | 同上（按执行时生效的共享行） |
| `baselineCents` → `priorApprovedDeltaCents` → `amountBeforeCents` → `deltaCents` → `amountAfterCents` | AIA G701 金额链 | `computeChangeOrderChain`（08） | `deltaCents` room，其余 finance 类 |
| `*MicroUsd` | 模型调用的预留 / 结算估算（整数微美元） | attempts / runs / spendCounters | system（creator 只在 run 终态后见整 run 汇总，不实时更新，03 §3.8） |
| `deadline` | customer 的硬截止（`IsoDate`）；v1 没有软日期偏好 `preferredDate`（14 §4） | customer 简报 | self；经共享行 |
| `deliveryDate` | 提案交付日，插入时物化的绝对日期，不重算 | `room.localDate + 有效工期` | room |
| `localDate` | 房间时区下的"今天" | `rooms.create`、`clock.rollLocalDate` | room |
| `dueDate` | 任务截止 = `deliveryDate` | `plannedTasks` 快照 | room |
| `*At` | 毫秒时间戳，只作展示与过期判定 | mutation 内 `Date.now()` | 视字段 |

禁止：`priceUsd`、`total`、`totalBudgetCents`、`budgetCapCents`、`limitCents`、浮点美元、`new Date("YYYY-MM-DD")`。

## 2.10 所有权规则

- **所属角色（ownerRole）**：`briefs.role`；`sharedFacts.fromRole`（另加行级 `audience`）；`turns.role` 与其 attempts；`humanRequests.toRole`（问题与选项）；`ledgerEntries` → finance；目录草稿 → provider；`approvals.note` → 作者本人。`self` 以角色为单位（v1 一角色一人，D24）。
- **creator** 只多出管理权（`rooms.close`、`invites.create`、`runs.requestRenegotiation`、`runs.cancel`），没有审批、代答、读他人简报或指定审批人的权力（07 §7.5.5）。
- **代理的读权** = 其委托人角色的读权 − `displayName` − 房间 `title` − 一切人类自由文本；他方撰写且进入代理上下文的唯一字符串是目录 `title`（定界 + 转义，canon D13）。代理没有任何写表的公开入口：它的输出只经 `turns.complete` 写 `turns` / `attempts` / `proposals` / `humanRequests` / `events`，永不写 `approvals`、`briefs`、`catalogItems`、`sharedFacts`、`ledgerEntries`、执行产物（INV-20）。
- **系统**（被调度的 internal 函数、cron）没有身份，只按显式传入的 `actorUserId` 归属，不以它授权（07 §7.5.4）。
