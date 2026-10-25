# 07 · 权限、隐私与威胁模型（part6：规则结论可见性、previewChange、动作 × 角色矩阵、频率上界）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.11 规则结论的可见性（XP-5 `projectChecks`）

```ts
// core/engine/privacy/projectChecks.ts（纯函数；06 的 checkProposal 产出 CheckResult[]）
type CheckResult = { checkId: string; code: ReasonCode; ownerRole: RoleKey | null; inputs: FieldPath[]; params: Record<string, unknown> };
type ChecksView =
  | { kind: "fit"; fit: "ok" | "blocked" }                                     // scenario.fitOnlyRoles（scope_change = ['provider']）
  | { kind: "checks"; fit: "ok" | "blocked"; items: { code: ReasonCode; params: PublicParams }[] };
```

规则（按顺序）：

1. 查看者角色 ∈ `scenario.fitOnlyRoles` → 只返回 `{ kind: 'fit' }`：无 reasonCode、无 checkId、无 params、无失败条数（canon D12 ①）。provider 的代理收到的反馈同样只有 `blocked`（D08：被规则阻断的提案不花评估调用）。
2. 其他角色，对每条**失败**检查：`ownerRole === null`（引擎公开检查：`item.unknown` / `item.retired` / `date.in_past` / `version.*`）、或 `ownerRole === viewer.role`、或 `inputs` 全部对查看者可见（经 XP-1）→ 原码 + 裁剪后的 params；否则记为掩码。
3. 掩码合并为至多一条 `{ code: 'private.constraint_unmet' }`，不带 checkId、不带计数；**通过**的掩码检查直接省略（不出现 "ok" 条目）。
4. params 按 `reasonCodes.ts` 中每个参数声明的受众裁剪；未声明受众的参数一律丢弃（fail-closed）：

| reasonCode | 参数 | 受众 |
| --- | --- | --- |
| `budget.over` | `overByCents`、`headroomCents` | finance；customer 仅当可得 headroom（§7.8.5） |
| `budget.below_committed` | `minAllowedCapCents` | finance（只出现在 finance 自己的写入错误里） |
| `date.after_deadline` | `deadline`、`daysLate` | customer；他人仅当 `deadline` 已共享给他 |
| `item.required_missing` | `itemKeys`、`reason` | customer；他人仅当 `requiredItemKeys` 已共享给他 |
| `item.unknown` / `item.retired` | `itemKeys` | room（目录公开） |
| `amount.claim_mismatch` | — | room |
| `version.stale_source` | `itemKeys` | room（目录公开） |

参数名与受众的唯一来源是 06 §6.2 `PARAM_AUDIENCE`（fail-closed：未声明的参数在投影时丢弃）；本表只是复述，T06-S4 断言两者一致，12 §12.17 的 `checks[].text` 由裁剪后的参数渲染。

示例（主 fixture，finance 把上限降到 $4,800 后的 $900 提案）：finance 见 `budget.over { overByCents: 10000 }`；customer（fixture 只获共享 `capCents`，算不出 headroom）见 `private.constraint_unmet`；provider 见 `fit: blocked`。若 finance 再共享 `headroomCents`，customer 见 `budget.over { overByCents: 10000 }`。

**代理反馈**：provider 代理的下一回合只得到 `{ proposalVersion, outcome: 'blocked' | 'not_accepted' | 'countered' | 'pending_approval' }`；`not_accepted` 不带评估方角色与 `reasonKey`（PV-10）；`countered` 只表示"customer 的 counter 通过全量检查并被转发"，被转发的候选以本回合快照中的一个 `optionKey` 出现（DX-11 / DX-13）——counter **不是提案**（05 §5.3.1 / §5.8.4），没有版本号、不进提案列表；未通过全量检查的 counter 对 provider 不留任何痕迹（它看到的就是普通的 `not_accepted`）。评估方代理得到本角色的 `ChecksView`。

### 7.11.1 `rooms.previewChange`（memberQuery；参数与返回形状**以 12 §12.17 为唯一定义**，本节只说明隐私语义）

`change.kind ∈ 'cap' | 'customer_hard' | 'catalog'`；变更种类的所有者角色（finance / customer / provider）必须是查看者，否则返回 `null`（query 不抛 `auth.role_forbidden`）。

| 调用者 | 返回（12 §12.17） |
| --- | --- |
| 任意，硬投影不变 | `{ verdict: 'unchanged' }` |
| finance，`cap` 低于已承诺 | `{ verdict: 'rejected', code: 'budget.below_committed', minAllowedCapCents }` |
| finance，`cap` | `{ verdict: 'after', nextConstraintsVersion, invalidatedApprovals, willSupersedeRun, verdictAfter: { proposalVersion, budgetCheck: 'pass' \| 'budget.over', overByCents? } }`——**只回答当前提案的预算检查** |
| customer / provider（及 finance 的其他变更） | `{ verdict: 'recheck', nextConstraintsVersion, invalidatedApprovals, willSupersedeRun }` |

finance 的结论零新增信息：`budgetCheck` 只由上限、已承诺与公开提案金额决定，三者 finance 本就可见。**不做 feasibility 枚举、不回答"仍存在可行方案"**：在 U1 / C0 配置下（customer 未向 finance 披露必需项与截止日）那依赖 customer 的私密值，finance 反复调用即可零成本二分出它们（privacy-03；TC-PRIV-13 的 C0 用例断言扰动 customer 私密值后 finance 的结果逐字节不变）。customer / provider 的结论取决于对方私密值，返回它就是不留痕、不限频的预言机（D12 ②）。`recheck` 只由公开的审批、cv、run 状态计算。

## 7.12 动作 × 角色矩阵

构造器缩写：U = userQuery/userMutation，M = memberQuery/memberMutation，A = 公开 action，I = internal。节流 ⑥ = 计入"每用户每房间每小时 ≤ 6 次"（canon D12 ⑥），超限 `run.rate_limited`；⑥ 列另注每房间每 24 小时的总量桶（12 B7，§7.13）：`P` = `price_writes`（价格 / 工期 / 增删 ≤ 3 批），`H` = `setCap` + customer 硬字段子桶（≤ 6 次），`R` = `run_starts`（≤ 6 个 run）。所有 M 类写入在 `room.status ∈ {executed, closed}` 时返回 `run.invalid_state`（例外已注明）。函数全量签名见 12。

### 7.12.1 查询

| 函数 | 构造 | cus | pro | fin | 非成员 | 守卫 / 读 | 返回 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rooms.view` | M | ✔ | ✔ | ✔ | `null` | 读公开行 + `loadRuleInput`（受限）→ XP-1…XP-7 | 按查看者投影的 RoomView |
| `rooms.listMine` | U | ✔ | ✔ | ✔ | 空列表 | `members.by_user` | 房间卡片（不含任何私密值） |
| `rooms.previewChange` | M | 本角色变更 | 本角色变更 | 本角色变更 | `null` | §7.11.1 | 角色分支 |
| `briefs.mine` | M | 本角色 | 本角色 | 本角色 | `null` | `briefs.by_room_role_version`（只用 viewer.role） | 本方全部版本 + 本方 sharedFacts 受众 |
| `timeline.page` | M | ✔ | ✔ | ✔ | `null` | `events.by_room_order` 分页；`returns: paginationResultValidator(eventViewV)` | 渲染后的 `EventView`（§7.17） |
| `invites.listMine` | U | ✔ | ✔ | ✔ | — | 已验证邮箱匹配 | 本人的 open 邀请 |
| `turns.mine` | M | 本角色 | 本角色 | 本角色 | `null` | XP-8 | 动作、rationale、失败类别 |
| `catalog.list` | M | ✔ | ✔ | ✔ | `null` | 每个 itemKey 的当前非草稿行（已确认即披露，§7.8.3 路径 ①）；`mine`（草稿与修订历史）只给 provider | 公开目录 |
| `proposals.get` | M | ✔ | ✔ | ✔ | `null` | 房间由 `proposalId` 解析；只有当前提案带 `fit` / `checks`；`decisions[].reasonKey` 按 `humanReasonKeys[].audience` 裁剪、`note` 只给 `isMe`（DX-6、08 §8.6.6） | 提案永久链接 DTO |
| `executions.forRoom` | M | ✔ | ✔ | ✔ | `null` | `amountChain` 只给 finance，customer 按**执行时**生效的共享行，provider 恒为 `null`（PV-12） | 变更单、任务、签字快照 |
| `users.viewer` | U | ✔ | ✔ | ✔ | `null` | 只读本人 `users` 行与构造器注入的 `ctx.viewer.emailVerified`（Convex `UserIdentity.emailVerified === true` 才为真，缺失按假；不直接读 claim） | 本人状态与显示名 |
| `health.ping` | anon | — | — | — | ✔ | 不读任何表（anonQuery 白名单唯一成员） | `{ ok: true }` |

### 7.12.2 变更与公开 action

| 函数 | 构造 | 允许 | 关键守卫（同事务重读） | 写表 | 失败码 | ⑥ |
| --- | --- | --- | --- | --- | --- | --- |
| `users.ensureViewer` | U（`provision`） | 任一登录用户 | 按 `tokenIdentifier` 先查后插（03 §3.5） | users | `auth.unauthenticated` | — |
| `rooms.create` | U | 任一登录用户 | scenario 已注册 | rooms、members、events | `auth.*` | — |
| `rooms.close` | M | creator | `status ∈ {setup, open}`；活动 run → `canceled` | rooms、runs、events | `auth.not_creator`、`run.invalid_state` | — |
| `rooms.startFollowUp` | M | 旧房间任一成员（仅 `executed` 房间，例外） | 该执行属于本房间；已有后续房间则返回它（`created: false`，`rooms.by_followsExecutionId`） | 新 rooms、members（同三人预分配）、catalogItems（只复制未执行条目的 `draft` 副本，12 §12.6）、events | `auth.not_member`、`run.invalid_state`、`run.rate_limited` | 否：计入 `room_create` 桶（12 B7） |
| `privacy.redact` | I | 运维（全部层级，经 CLI 人工发起；v1 不提供自助删除） | `REDACTABLE_FIELDS` 清单内的字段（03 §3.16.2） | 原地覆写该字段 + 事件 `pii_redacted{ table, field }` + opsLog | — | 否 |
| `rooms.forceClose` | I | 运维（全部层级，经 CLI 双人确认） | 身份消失兜底（04 §4.11）：`setup` / `open` 房间 | 等价 creator 的 `rooms.close`；事件 `room_closed{ by: 'ops' }` | — | 否 |
| `invites.create` / `invites.createLink`（A） | M / A | creator | `setup`；席位空缺 | invites、events | `auth.not_creator`、`invite.seat_taken`、`run.invalid_state` | — |
| `invites.accept` | U | 被邀请人 | §7.6（邮箱或链接两种形态，同一写入口） | members、invites、events | `invite.*`、`run.invalid_state` | — |
| `briefs.confirm` | M | 本角色 | `status ∈ {setup, open}`；日期窗口、目录成员、NFC 长度；`setup` 期只写来源并 `openIfReady`（就绪即 open + 首个 run，04 M2）；open 期硬投影变化 → `constraints.bump` | briefs、sharedFacts、rooms、constraintRevisions、runs、turns、attempts、humanRequests、events | `input.invalid`、`version.stale_constraints`、`date.*`、`item.*`、`budget.below_committed`、`run.rate_limited` | ✔；硬字段变化 + H |
| `budget.setCap` | M | finance | `newCapCents ≥ committedCents`；新 finance 简报版本（同 `briefs.confirm` 路径） | 同上 | `budget.below_committed`（params 只给 finance）、`run.rate_limited` | ✔ + H |
| `briefs.updateSoft` | M | 本角色（须已有已确认简报） | `status ∈ {setup, open}`；本角色无已确认简报 → `run.invalid_state{ guard: "brief_missing" }`；只校验 `notes`（NFC 后 ≤ 2,000 码点）；复制最新已确认版本、只替换 `softFields.notes`，不 bump、不经 `materializeDisclosures`（12 §12.9） | briefs、events（`brief_soft_updated`，只对本人渲染） | `auth.not_member`、`run.invalid_state`、`input.invalid`、`run.rate_limited` | 否：计入 `soft_writes` 桶（12 B7） |
| `ledger.recordBaseline` | M | finance | `setup`；只能一次 | ledgerEntries、sharedFacts（派生字段已共享时）、events | `run.invalid_state` | — |
| `sharedFacts.add` | M | 本角色字段 | §7.15 LP-3 闸门；值与受众都与最新行相同 → `unchanged` | sharedFacts、events（`disclosure_changed`，payload 只有 `fromRole`，`restrictedRef → sharedFacts`） | `disclosure.*`、`input.invalid` | — |
| `catalog.confirm` / `catalog.retire` | M | provider | title 正则；价格 / 工期 / 增删 / retire → bump，仅 title / taskTemplates 不 bump（D05） | catalogItems、rooms、constraintRevisions、runs…、events | `item.*`、`run.rate_limited` | ✔（一批一次）；价格 / 工期 / 增删 + P |
| `runs.start` | M | 任一成员 | `open`、就绪（04）、已有非终态 run 则返回它（`created: false`）、未 draining | runs、turns、attempts、events | `run.invalid_state`、`run.draining`、`run.rate_limited` | ✔ + R（`react()` 自动开局也计入 R 但不抛错，12 §12.2 第 7 条） |
| `runs.retryTurn` | M | 失败回合所属角色 | `humanRequests.answer(retry_turn)` 的便捷入口：run `needs_input` 且 open 请求 `kind: agent_failed`、`toRole` = 调用者角色、attempt 未用尽、未 draining | attempts、turns、runs、humanRequests、events | `auth.role_forbidden`、`run.invalid_state`、`run.draining` | ✔ |
| `runs.requestRenegotiation` | M | creator | run ∈ `pending_approval` / `needs_input` | runs、proposals、humanRequests、events | `auth.not_creator`、`run.invalid_state` | ✔ |
| `runs.cancel` | M | creator | run 非终态 | runs、events | 同上 | — |
| `approvals.record` | M | 角色 ∈ `proposal.requiredApprovals` | run `pending_approval`；`proposalId === run.currentProposalId`；`expected*` 相等；approve 前 `isExecutable`；同事务 `executeIfComplete` | approvals、（执行时）executions、ledgerEntries、changeOrders、tasks、proposals、runs、rooms、events | `approval.stale` / `not_current` / `not_executable` / `self_conflict` / `already_executed`、`run.invalid_state` | **不计**（reject 永远可做） |
| `humanRequests.answer` | M | 仅 `toRole` 成员 | 请求 open；选项 effect 见 D15：约束类 → `constraints.bump`；`disclose` → 写 **sharedFacts**（过闸门）；`choose_candidate` → 插入 `origin: human_choice` 提案；`pass_to_next` → 不 bump，给 `relaxationOrder` 中的下一角色开按其自身视图生成的请求（只按收件人位置提供、不读任何私密值，因此不构成预言机；每 run 每对角色一次，04 R21）；`retry_turn`；`end_run` | humanRequests、sharedFacts、proposals、runs、briefs（约束类）、events | `auth.role_forbidden`、`request.not_open`、`request.option_unknown`、`disclosure.*`、`run.rate_limited` | ✔；约束类回答写 `brief_confirmed{ hardChanged }`，同样计入 H |
| `tasks.markDone` | M | 被指派角色（`task.assigneeRole`） | 允许在 `executed` 房间（例外） | tasks、events | `auth.role_forbidden` | — |

### 7.12.3 代理运行时（internal）的写权

| internal 函数 | 允许写 | 禁止写 |
| --- | --- | --- |
| `turns.beginAttempt` | attempts、turns、runs（`activeTurnSeq`）、调度 `agents.runAttempt` 与 `agents.watchdog` | 其余全部 |
| `agents.runAttempt`（action） | 不直接写库；只调用一次 `turns.complete` 或 `turns.fail` | 全部 |
| `turns.complete` | turns、attempts、proposals（经 06 校验插入）、runs、humanRequests（仅代码判定需要时）、events | approvals、briefs、sharedFacts、catalogItems、ledgerEntries、executions、changeOrders、tasks、members、invites |
| `turns.fail` / `agents.watchdog` / `runs.reconcile` | attempts、turns、runs、humanRequests（`agent_failed`）、events | 同上 |

不变量：`approvals` 唯一写入口是公开的 `approvals.record`（需要人类身份）；`recommend_accept` 只写本方回合输出并可能推动 run 状态（核心 2）。`executions.executeIfComplete` 只被 `approvals.record` 调用（调用图静态测试 TC-AUTH-06）。

## 7.13 频率上界（隐蔽信道的量化）

| 信道 | 上界 | 计数落点 |
| --- | --- | --- |
| DX-1 提案 / DX-11 counter | 每 run 每角色 ≤ 4 次 `propose / counter`（D12 ⑤）；超限 → `escalate` 或 `needs_input` | `turns` 按 (runId, role, action) 计 |
| DX-2 预检 1 bit（速率） | 约束变更类写入 ≤ 6 次 / 用户 / 房间 / 小时（D12 ⑥） | 零依赖索引计数：`events.by_room_actor` 按 distinct `commitTs`（03 §3.11.3） |
| DX-2 预检 1 bit（总量，privacy-01） | `price_writes` 桶：房间 `open` 期间，改变 `priceCents` / `leadDays`、新增或撤下目录项的 `catalog.confirm` / `catalog.retire` 每房间每 24 小时 ≤ 3 批，且每个 open run 内同一 `itemKey` 改价 ≤ 1 次；`budget.setCap` 与 customer 硬字段 `briefs.confirm` 共用每房间每 24 小时 ≤ 6 次的子桶 | `catalog_item_confirmed{ priceChanged }` / `catalog_item_retired` / `brief_confirmed{ hardChanged }` 事件按 distinct `commitTs`（12 §12.2 第 7 条）；16 TC-AUTH-13 |
| DX-11 counter 转发 | 每 run ≤ 4 次 counter（D12 ⑤）；`run_starts` 桶：每房间每 24 小时 ≤ 6 个 run（含 `react()` 自动开局） | `turns` 按 (runId, role, action) 计；`run_started` 事件按日计（12 §12.13） |
| provider 可代答的 clarify | 每 run ≤ 1，且任何角色都没有 `option_fits_constraints` 话题（D12 ③，05 §5.9.1） | 05 |
| DX-12 `choose_candidate` 复核结局 | 每次回答 ≤ 1 bit；`humanRequests.answer` 计入 D12 ⑥；每 run 至多一个 open 请求（D15） | 03 §3.11.3 的命令事件 |
| DX-5 / DX-7 变更者身份 | 对 provider 为 0 bit：约束变更提交只渲染为无作者的 "Constraints changed (vN)"，他人简报版本号为 `null`（§7.17、12 §12.17） | 16 TC-PRIV-21 |

量化：$0–$10,000 区间、$1 分辨率二分余量约需 14 bit。D12 ⑥ 单独只能减速（provider 每小时 6 次改价约 2.3 小时即可精确到 $1；反向 finance 用 `setCap` 探测 customer 未披露的必需项集合，5 个条目约 5 bit，约 1 小时），所以每房间每 24 小时的总量桶才是上界（每次预检结局至多 log₂3 ≈ 1.6 bit，对二分有效的约 1 bit）：provider 改价 ≤ 3 次（≤ 4.8 bit）、买方 `setCap` / 硬字段 ≤ 6 次（≤ 9.5 bit）、counter ≤ `run_starts` 6 × 每 run 4 = 24 次（≤ 24 bit 可行性，只给 customer 与被转发候选的 provider）——这三项每房间每天 ≤ 39 bit；再加 DX-1 provider 提案结局（≤ 6 run × 每 run 4 = 24 bit）为 ≤ 63 bit，而 DX-12 `choose_candidate` 复核结局只受每小时节流、没有日总量桶，所以这不是全信道的每日上界（§7.21 R-1）；仅靠改价把余量二分到 $1 因此需要约 5 天而不是 2.3 小时，反向探测 customer 的 5 个必需项也需要约 1 天。每一次都在时间线对全员可见并使审批失效。这是告知用户的残余风险（§7.21 R-1）；是否再让预检结局对 provider 不可区分列入 17（§7.24）。
