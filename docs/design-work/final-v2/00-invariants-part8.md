# 00 · 反例电池 part8 — 2.3 审批与约束版本

> 分片清单见 `00-invariants.md`。本节对应 versioned-approvals X1–X28、idempotent-execution C13–C15 / C22 / C23 与反驳 r01 / r06 / r07、inputs/07 的活性死锁 1、复活被拒提案、单层 react、跨午夜条目。

### 2.3 人批准具体版本 / 约束版本

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-042 | customer、provider 已批 v3（cv4）；customer `briefs.confirm` 把 `deadline` 提前（cv5），v3 的 `deliveryDate > 新 deadline` | INV-24 bump；INV-26 两审批 `stale_approve`；INV-32(b)：run superseded、v3 `stale`、新 run `negotiating` | CT |
| CE-043 | provider `catalog.confirm` 改已被 v3 引用条目的 `priceCents`（cv+1） | INV-24（目录在投影内）；INV-38：v3 在守卫层报 `version.stale_source`；INV-32(b) 新 run | CT |
| CE-044 | finance `budget.setCap` 填回当前值 | INV-24：投影相等 → 不 bump、无 `constraintRevisions` 行、无事件、返回 `unchanged` | P + CT |
| CE-045 | customer 只改软字段 `preferredItemKeys` / 披露开关 / 备注 | INV-24：不 bump；审批不失效；下一回合读到新软偏好 | P |
| CE-046 | provider `catalog.confirm` 只改 `title` 或 `taskTemplates`（新行 `revision` 不变、`editNo + 1`） | INV-24：`title` / `taskTemplates` 不在投影内 → 不 bump、无 `constraintRevisions` 行；INV-38：`lines[].revision` 与当前行 `revision` 相同 → 不报 `version.stale_source`；INV-37 / INV-49：当前提案 `lines[].title` 与 `plannedTasks` 为快照，不阻断、不漂移 | P + CT |
| CE-047 | 用户页面停在 cv5；cv 已变 6 且 v3 仍合规；点击 `approve`（`expectedConstraintsVersion: 5`） | INV-25：`approval.stale`，不写行；刷新后以 cv6 重批同一 proposalId | CT |
| CE-048 | 用户看到 v2 内容；提交时 `run.currentProposalId` 已是 v3 | INV-31：`approval.not_current`（`expectedTermsKey` 也不符 → `approval.stale`） | CT |
| CE-049 | 同一人 approve → withdraw → approve 串行 | INV-29：三行 `seq 1/2/3` 全部保留，当前有效为 approve | CT |
| CE-050 | 在 cv2 下 reject v2；随后 cv → 3 | INV-26：派生 `stale_reject`（不丢"曾拒绝"）；INV-30：v2 `rejected` 终局，预检不复活 | P + CT |
| CE-051 | seed 构造：F 已批后把 finance 席位换成 F'（v1 不支持换人，仅测试构造） | INV-26 / INV-27：按当前成员判定，F 的行不计，需要 F' 批准 | CT |
| CE-052 | seed 绕过 INV-15 让同一 userId 同时持 customer 与 finance 席，两席都 approve | INV-27：被选 userId 重复 → `approval.self_conflict`，不执行 | CT |
| CE-053 | 提案在 cv1 创建；当前 cv3 下全部检查通过且三方在 cv3 批准 | INV-35：可执行，不比较 `createdAtConstraintsVersion` | P |
| CE-054 | 非成员 / 匿名 调 `approvals.record`；（v1 无第四席，若测试构造出不在 `requiredApprovals` 中的角色席位）该角色调用 | INV-31 / INV-17：`auth.not_member` / `auth.unauthenticated` / `auth.role_forbidden`；均不写行 | CT |
| CE-055 | 当前 cv 下本人无 approve 时调 `withdraw`（含已撤回、只有旧 cv 上的 approve） | INV-29：返回 `unchanged`，不插行、不写事件 | CT |
| CE-056 | 同一人在同一提案上 approve / withdraw 交替，直到第 11 次 withdraw；随后另一人 `reject` | INV-29：第 11 次 withdraw → `run.rate_limited`（approve 行 ≥ 60 同理）；INV-30：另一人的 reject 仍成功（reject 永不受限、不读整区间）；没有全局决定上限（idempotent r03 的 `TOO_MANY_DECISIONS` 被否决） | CT |
| CE-057 | 变异：某 mutation 直接 `patch(rooms, { constraintsVersion })` 或直接 patch `briefs.hardFields` | INV-24 结构测试红；只追加表 lint 红 | P |
| CE-058 | finance 上调 cap（cv+1）时 run 处于 `pending_approval`、v3 仍合规；customer 以新 cv approve | INV-32(a)：v3 同事务 `stale → active`，新 run `pending_approval`、`currentProposalId` 同一 v3；INV-31 允许；INV-26 旧审批 stale | CT |
| CE-059 | 预算上调（对当前方案有利） | INV-24：仍 bump；旧审批 stale；不自动找更优方案（可 `requestRenegotiation`） | CT |
| CE-060 | H1 open（finance `raise_cap`）；finance 回答 → bump；随后有人回答已 `answered` 的 H1，或回答被 bump 置 `superseded` 的旧 run 请求 | INV-34：`request.not_open`（不需要单独的 cv 守卫）；bump 后每 run 至多一个 open 请求 | CT |
| CE-061 | `humanRequests.answer` 选 `disclose`（不改硬输入） | INV-24：不 bump；INV-73：run `needs_input → negotiating`；请求 `answered` | CT |
| CE-062 | `humanRequests.answer(raise_cap)` → bump 后旧 run 已 superseded；检查是否自动开新 run 并预检 | INV-32 不动点：新 run 出现且状态 ∈ {pending_approval, negotiating, needs_input}；不会停在"无 run 且无请求"（C11） | CT |
| CE-063 | v3 在 cv4 pending；cv5 保留（INV-32(a)）；被拒回 `negotiating`；下一回合创建 | INV-33：新 run 的 `constraintsVersionAtStart = 5`，回合快照 cv5，G3 通过（旧守卫 `cv === atStart` 会卡死） | CT |
| CE-064 | customer reject v3 后 provider 改无关条目价格（bump） | INV-30 / INV-32：预检只看 `active` 提案，v3 `rejected` 不复活；新 run 重谈 | CT |
| CE-065 | 变异：bump 把提案置 `stale` 后预检保留却忘记把新 run 指向它，或忘记同事务 `stale → active`；变异：被取代 run 处于 `negotiating` 时也沿用其 active 提案 | INV-32：事务结束状态三选一的断言红（`run.pending_approval ⇒ currentProposalId.active`）；(a) 的前置"被取代 run 为 `pending_approval`"断言红 | CT |
| CE-066 | 两次快速 bump（cv4、cv5）：第一次开出的新 run R2 已调度 attempt | INV-32 / INV-33：R2 → superseded；其 attempt 经 G3 判 `stale`、`loadTurnContext` 返回 null → 不调模型（INV-70） | CT |
| CE-067 | 构造 answer → bump → start → 预检 needs_input → 再 answer 的链条，检查 `react()` 深度 | INV-32：深度 ≤ 4；每一层都恰一个 open 请求；超深度时写 ops 告警而非循环 | CT |
| CE-068 | creator 从 `negotiating` 调 `runs.requestRenegotiation`；从 `executed` 房间调；非 creator 调 | INV-73 / INV-44：`run.invalid_state{ run_status }` / `run.invalid_state{ room_status }` / `auth.not_creator` | CT |
| CE-069 | 跨午夜：v1 `deliveryDate 2026-11-20`；23:50 两票；00:10 第三票 | INV-36：日期已物化不重算 → 执行成功；与 inputs/07 的 `DATE_MISMATCH` 设计对照 | CT |
| CE-070 | 跨午夜翻转：pending 提案 `deliveryDate === localDate`；`clock.rollLocalDate` 推进一天 | INV-36 / INV-32：`date.in_past` 翻转 → `bump(cause: 'clock')` → 新 run 或 `needs_input`；审批 stale | CT |
| CE-071 | 测试里手工把 `Date.now()` 推进两天但不跑 cron | INV-77 / INV-36：query 只读 `localDate`，不出现"审批有效但不可执行"悬空；cron 跑后状态一致 | CT |
| CE-072 | 部署新版场景规则（插件代码变化）而房间 `scenarioVersion` 不变；或新部署不再注册旧版本 | INV-45：房间固定版本；新代码必须兼容旧 `scenarioVersion`，否则 approve 返回 `run.invalid_state{ scenario_version }` 直到 15 的迁移对该房间 `constraints.bump(cause: 'scenario_migrated')` 后重批（08 O12） | P + CT |
