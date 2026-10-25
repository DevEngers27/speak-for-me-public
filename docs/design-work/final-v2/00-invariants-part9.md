# 00 · 反例电池 part9 — 2.4 规则引擎与协议、2.5 幂等与并发

> 分片清单见 `00-invariants.md`。2.4 对应 negotiation-protocol E1–E18 与反驳 r08–r10、rules-engine 反驳 r01–r04、scenario-plugin SP-I4 / I5 / I12；2.5 对应 idempotent-execution C1–C23 与反驳 r05 / r10、versioned-approvals X7 / X8 / X13 / X14、spikes B1 / B2。

### 2.4 代码校验 / 规则引擎 / 协议

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-073 | `committedCents 400000 + amountCents 80000 === capCents 480000` | INV-39：闭区间通过（预算检查 B2 `status: 'pass'`；`budget.fits` 不是 reasonCode，06 §6.1） | P |
| CE-074 | 上限 479999（边界减一分） | INV-39：`budget.over` | P |
| CE-075 | 脚本化模型 `rationale` 1,500 码点 | INV-43：NFC 后截断到 1,200 码点、记 `rationaleTruncated`，动作照常处理；**不**判 `output.schema_violation`、不重试；截断后的 rationale 仍只给本方 | P |
| CE-076 | 响应只有 thinking 块，`stop_reason: 'max_tokens'` | INV-40：`output.truncated`，重试一次，绝不当"无动作"；usage 已记录 | P |
| CE-077 | `stop_reason: 'refusal'` + 半截 JSON | INV-40：attempt `refused`，不解析、不重试 → `needs_input(agent_failed, toRole: 失败方)` | P + CT |
| CE-078 | customer `counter` 的 optionKey 对应当前提案本身 | INV-22：传给 `allowedActions` 的 evaluate 快照已排除 base，counter 枚举天然不含它；若 loose 模式出现 → `action.option_not_in_snapshot` | P |
| CE-079 | 可行集只有 1 个候选 | INV-22：customer evaluate 快照去掉 base 后 `n = 0` → 去掉 counter；INV-74：仍跑完一轮（provider 只能选它，买方评估） | CT |
| CE-080 | 第 3 轮仍未收敛且无合格提案 | INV-74：customer `rounds_exhausted` 请求（`choose_candidate` / `keep_as_is` / `end_run`），不再调模型；`attempts` 行数不增 | CT |
| CE-081 | 变异：插件 `priceTerms` 读 `ctx.constraints.headcount` | INV-37：一致性测试"改约束 terms 不变 ⇒ 金额不变"红 | P |
| CE-082 | 插件返回负数 / `1.5` / `NaN` 金额 | INV-43：`assertCents` → `internal`（代码缺陷），回合不落库 | P |
| CE-083 | `rooms.create` 指定未注册的 `scenarioKey@scenarioVersion`；已有房间的版本在当前部署未注册时 approve | INV-45：`run.invalid_state{ guard: 'scenario_version' }`，不写行；reject / withdraw 照常；读只返回引擎字段 | CT |
| CE-084 | 前端对 `budget.setCap` 传 `role: 'finance'`，调用者是 provider | INV-17 / INV-44：多余参数 → 参数校验失败；去掉后 → `auth.role_forbidden` | CT |
| CE-085 | 变异：在 internal query 中返回 Zod schema 给 action | INV-42：Convex 值校验拒绝 `$defs`（inputs/07 第 1 条）；schema 在 action 内构造 | CT |
| CE-086 | 换模型后 API 对保留 `enum` 的 schema 返回 400 | INV-40 / INV-42：`error`（`bad_request`）不重试、ops 告警 → `needs_input(agent_failed)`；运维开关 `OUTPUT_SCHEMA_TRANSFORM = sdk`（枚举降级为描述），语义校验兜底 | RD |
| CE-087 | customer 必需项 `audit_log_export` 已被 provider 撤下（不在当前 confirmed 目录中） | INV-38：`item.required_missing`；`enumerateCandidates` 返回空集不崩溃 → `needs_input(infeasible)`；customer 视图为空且放松 `drop_items` 可非空 → 请求给 customer（`drop_items [audit_log_export]` + `pass_to_next { toRole: finance }` + `end_run`）；(b) customer 选 `pass_to_next` → 本请求 `answered`，同事务给 finance 开它自己视图的 `infeasible` 请求（finance 视图里加预算解决不了缺项 → 只有 `disclose` 回退项与 `end_run`），run 仍 `needs_input`、恰一个 open、不 bump | P + CT |
| CE-088 | 同一 run 内 provider 再次提出已被阻断的 `audit_log_export+usage_dashboard@rush` | INV-41 / INV-09：快照已剔除；出现即 `action.repeats_blocked` | P |
| CE-089 | 改价后新 run 里模型选中与旧提案同 `candidateKey` 的候选（revision 不同） | INV-55：插入新提案版本（新 `lines[].revision`），不复用不可执行的旧提案；界面可标"条款与 vN 相同" | CT |
| CE-090 | 输入日期 `2026-02-30`、`2026-2-3`、`4800-01-01` | INV-43 / INV-78：解析拒绝；窗口拒绝 | P |
| CE-091 | 变异：把 rush 费写成插件常量 | INV-37：`modifiers` 必须解析到 `catalogItems(kind: 'modifier')`，否则 `item.unknown` | P |
| CE-092 | provider 提案被 `item.required_missing` 阻断 | INV-74：不花评估调用，直接下一轮只反馈 `blocked`；`attempts` 中无 evaluate 行 | CT |
| CE-093 | 配置变异（`max_tokens: 16000` 下）：`加载余量 + 总截止 + 落库余量 ≥ action 上限`；或 `加载余量 + 总截止 ≥ WATCHDOG_FIRST_MS`；或 SDK `maxRetries ≠ 0` | INV-42：I1 / I3 / I6 是模块加载断言（10 §10.11），失败即部署失败，不产生 attempt、不调模型；只有传输层收到非零 SDK `maxRetries` 时抛 `GatewayConfigError`，attempt `error(config_invalid)`，不调模型（10 §10.15.2） | P |
| CE-094 | 模型回显错误 `roomId` / `proposalVersion: 99` 在 rationale 之外的字段 | INV-04 / INV-23：schema 无字段 → `output.schema_violation`；信封来自 turn 快照 | P |

### 2.5 幂等与并发

| ID | 操作序列 | 挡住它的不变量 | 层 |
| --- | --- | --- | --- |
| CE-095 | 同一人双击 approve，串行到达 | INV-29：第二次 `unchanged`，一行 | CT |
| CE-096 | 同一人双击 approve，并发（两事务都读到空区间） | INV-29 + OCC：区间读冲突 → 重试后 `unchanged`；`approvals` 只多 1 行 | RD |
| CE-097 | customer 已批；provider 与 finance 并发投最后两票（单进程多 `ConvexHttpClient` + `setAdminAuth`，N=5） | INV-27 / INV-46 / INV-47：恰一次执行；`executions` / `changeOrders` / `ledgerEntries(commit)` 各 1 行、`tasks` = `plannedTasks.length`；证据 `maxOverlap >= 2` | RD |
| CE-098 | 变异：完成判定改读 `proposal.approvedRoles` 冗余字段 | INV-27：代码审查 + 模型测试（任意串行顺序）红 | P |
| CE-099 | `budget.setCap(5000→4800)` 与最后一票并发 | 序 A（执行先）：房间 `executed` → setCap `run.invalid_state`；序 B（setCap 先）：approve `approval.stale`；不存在"按旧预算执行且预算已降" | RD |
| CE-100 | provider reject 与 finance 最后一票并发 | INV-30 / INV-31：序 A → run `negotiating`、finance 得 `approval.not_current`；序 B → 已执行、provider 得 `approval.already_executed` | RD |
| CE-101 | customer withdraw 与 finance 最后一票并发（idempotent r10 的 C24） | INV-29 / INV-27：两者都读写 `approvals.by_proposal` 区间 → 串行；不存在"已执行但 customer 当前为 withdraw" | RD |
| CE-102 | 客户端断线重连重发同一 mutation | 平台去重（待验证）+ INV-29 业务幂等 | RD |
| CE-103 | 用户收到网络错误后再点一次（新调用） | INV-31：`unchanged` 或 `{ status: 'executed', executionId }` | CT |
| CE-104 | 变异：mutation 内直接发通知 / `fetch` | INV-51：Convex 禁止 + 结构测试 | P |
| CE-105 | 双击 reject | INV-31：第二次 `approval.not_current`（run 已 negotiating）；只调度一次回合 | CT |
| CE-106 | 执行中途 `deriveExecution` 抛错 | INV-47：整体回滚，无审批行、无 execution、用户看到 `internal` | CT |
| CE-107 | 执行后其他人 approve（订阅未刷新） | INV-31：`{ status: 'executed', executionId }` 不写行 | CT |
| CE-108 | 执行后 reject | INV-31：`approval.already_executed` | CT |
| CE-109 | `seed.reset` 与执行并发 | INV-54：reset 先 patch room → 冲突者重试后失败；只删 `provenance !== 'live'`；prod 无 reset | RD |
| CE-110 | v3 在 cv5 缺 finance；bump 到 cv6 后三方在 cv6 批准 | INV-27 / INV-46：只计 cv6 的 approve；执行一次 `exec:<v3>` | CT |
| CE-111 | 变异：执行键改为 `exec:${proposalId}:${cv}` | INV-46：CE-110 的"至多一次"断言红（可在两个 cv 下各执行一次） | CT |
| CE-112 | 执行后 `rooms.startFollowUp({ executionId })`；新房间里再承诺已交付的 `sso_login` | INV-52 / INV-58：新房间的 draft 目录与 provider 的 `candidateSnapshot` 都不含 `sso_login`（只复制未交付行，canon D04）；provider 用 `sso_login` 调 `catalog.confirm` → `item.duplicate`；新房间账本独立、基线 = 旧 `committedAfterCents` 且须 finance 确认；customer 重新确认简报决定范围；旧房间不可写 | E2E |
| CE-113 | 两次执行后（两个房间）`Σ ledgerEntries ≠ committedBefore + amount` | INV-50：对账 R1–R11 `afterEach` 红 | CT |
| CE-114 | 插件给同一 itemKey 两个相同 `templateIndex` | INV-49：`taskKey` 唯一 → `internal` | P |
| CE-115 | 客户端两次点击各生成一个 `operationId` 传入 | INV-46：参数不存在；键由服务端派生 | CT |
| CE-116 | 变异：执行路径调用 `constraints.bump` | INV-53：结构测试红；已执行审批不得显示 stale | CT |
| CE-117 | finance 双击 `ledger.recordBaseline`；finance 已确认上限 $5,000 后录入 $5,100 的基线 | INV-50：第二次 `run.invalid_state{ guard: 'baseline_exists' }`；基线 > 已确认上限 → `budget.below_committed`（D23 对称守卫） | CT |
| CE-118 | `executed` 房间：`budget.setCap` / `catalog.confirm` / `runs.start` / `requestRenegotiation` / `approvals.record(reject)`；被指派人 `tasks.markDone`；任一成员 `rooms.startFollowUp` | INV-52：前四者 `run.invalid_state{ room_status }`，reject → `approval.already_executed`；`tasks.markDone` 成功（再调 `unchanged`，他人 `auth.role_forbidden`）；`startFollowUp` 成功并只写新房间 | CT |
| CE-119 | 同一房间并发 `runs.start` ×5 | INV-67：恰一个活跃 run；`turns` 首回合 1 行；其余返回同一 runId（`created: false`） | RD |
| CE-120 | N 个不同身份并发用同一链接邀请领取同一角色席位 | INV-15 / INV-16：该 `(roomId, role)` 成员 1 行；其余 `invite.invalid`（token 已被使用，与其他邀请失败不可区分） | RD |
