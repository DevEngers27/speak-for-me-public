# 专题深潜：首个场景 fixture 与完整走查（part4：反例与边界、seed/reset、测试、接口、待验证）

## 5. 反例与边界（同一目录，只换 finance 在第 6 步输入的新预算）

### 5.1 故意无解：cap $5,000 → $4,400（余量 $400）

- precheck：含 `sso_login` 的最便宜组合 C1 = $450 > $400 → 可行集为空。失败原因全是 `OVER_BUDGET`（C1 日期 11-23 合法）→ 按 D7 目标人 = **finance**。
- `budgets.update` 同事务：run1 → superseded；run2 插入后立即 `negotiating → needs_input`；**零模型调用**；`humanRequests +1`：`{ targetRole: 'finance', kind: 'tradeoff', questionTemplate: 'tradeoff.no_feasible_bundle', options: [ { key: 'raise_cap_to:445000', impact: { minCapCents: 445_000, enables: 'sso_login@standard' } }, { key: 'raise_cap_to:460000', impact: { minCapCents: 460_000, enables: 'sso_login@expedited' } }, { key: 'raise_cap_to:475000', impact: { minCapCents: 475_000, enables: 'sso_login+usage_reports@standard' } }, { key: 'no_change_this_cycle', impact: null } ] }`（每个选项 = 前沿候选所需的最小 cap，按金额升序）。
- 界面：F `No bundle that includes the required SSO login fits a $4,400 cap ($400 headroom; cheapest is $450). Choose: Raise cap to $4,450 · Raise cap to $4,600 · Raise cap to $4,750 · Keep $4,400 and record no change this cycle.`；C `No option fits the current budget. Finance has been asked to decide.`（C 是买方，可看到数字版本）；P `No proposal can be made under the current constraints. Waiting on another participant.`
- 回答：选 `raise_cap_to:*` → `humanRequests.answer` 调用与 `budgets.update` 相同的内部 helper `applyBudgetChange`（cv + 1、run2 → superseded、新 run3 `trigger: 'human_answer'`）；选 `no_change_this_cycle` → run2 `needs_input → closed_no_agreement`（**需要 04 增加此终态**，见 §8）并写事件 `run_closed`。
- 断言：此路径不得产生任何 `proposals` 行（AC-07 不伪造一致）。

### 5.2 边界：cap → $4,750（余量 $750 恰等于 C3）

- precheck：C3 400_000 + 75_000 = 475_000 ≤ 475_000 → 可行（`≤`）；前沿仍是 {C2, C3} → 同样向 customer 开取舍请求；选 C3 后执行，`committedAfterCents = 475_000 = cap`，`headroom = 0`。
- 界面 C、F：`+$750 change · $4,750 committed after approval · $4,750 cap · $0 headroom left`（不得显示为 "over"）。
- 执行后再发生任何正金额变更 → `OVER_BUDGET`。

### 5.3 边界减 1 分：cap → $4,749.99（474_999）

- C3 超出 1 分 → 可行 {C1, C2}；前沿 {C2} 单元素 → **不开取舍请求**，直接调度 provider 回合；预期 provider 提出 C2（$600，11-16）。若 provider 提出 C3，`completeTurn` 判 `OVER_BUDGET`，该回合结果不成为提案（记 `blocked_by_rules`，计入轮次）。
- 用途：证明 `≤` 而不是 `<`，并证明前沿计算对 1 分敏感。

### 5.4 低于已承诺：cap → $3,900

- `checkBudget` → `BUDGET_BELOW_COMMITTED`（headroom −10_000）。UI 提交前警告 `The new cap is below the $4,000 already committed. No new commitment can be approved until it is raised.`；允许提交（finance 的权力，基线承诺不会被回滚）。
- 事务：同 5.1，但 question 模板为 `budget.below_committed`，选项只有 `raise_cap_to:445000` 起的三档与 `no_change_this_cycle`。

### 5.5 其他回归用的反例（同一 fixture）

| 用例 | 操作 | 期望 |
| --- | --- | --- |
| RA-B01 复现 | provider 代理提出 `usage_reports@standard`（不含必需项） | `MISSING_REQUIRED_ITEM`；无提案行 |
| 日期 | 代理提出 C5 | cap 5,000 时只报 `DATE_CONFLICT`（12-07 > 11-30）；cap 4,800 时 `OVER_BUDGET` + `DATE_CONFLICT` |
| 目录外条目 | 输出 `itemKeys: ['dark_mode']` | `UNKNOWN_ITEM`，`agentTurns.status = 'invalid_output'`，有界重试 |
| 回合进行中降预算 | 第 4 步 provider 回合在途时 F 降到 $4,800 | 迟到的 `completeTurn` 因 cv 3 ≠ 4 写 `turn_rejected_stale`，不插提案 |
| 已批准后 customer 改硬截止（RA-B02） | 第 5 步后 C 重新确认 brief，`hardDeadline` 11-30 → 11-20 | cv 3 → 4，两条审批 stale，执行被拒；precheck：C1、C3（11-23）报 `DATE_CONFLICT`，可行 {C2, C4}，前沿 {C4} → 重谈得到**条款相同**的 v2（cv 4），三方必须重新批准 |
| 截止早于首选日 | C 把 `hardDeadline` 改成 11-13（< 首选日 11-16） | `validateBrief` 拒绝：`PREFERRED_AFTER_DEADLINE`，brief 不变，cv 不变 |
| 私密金丝雀 | 以 P 身份调用全部 query | 返回值不含 `CANARY-CUST-7Q2`、`CANARY-FIN-8M1`、`2026-11-30`、`480000`、`490000`、`475000`、`4,800`、`4,900`、`4,750`、`headroom` |


## 6. seed / reset 设计

| 函数 | 类型 | 调用方 | 行为 |
| --- | --- | --- | --- |
| `seed.demoRoom({ variant, seedKey, anchorDate? })` | internalMutation | `npx convex run`（生产需 `--prod` 且默认禁用） | 见第 0 步；`anchorDate` 缺省 = 房间时区今天之后的下一个周一；所有行 `isSimulated: true`；返回明文邀请码一次 |
| `seed.fastForward({ roomId, to: 'briefs_confirmed' })` | internalMutation，仅 dev | CLI | 调用与 `briefs.confirm` 相同的 `confirmBriefCore`，`actorType: 'system'`，事件 payload `seededConfirmation: true`，界面显示 `Confirmed by seed (simulated)`；**不提供更后的阶段**（提案须来自真实或 stub run，审批永不预置） |
| `seed.archiveDemoRoom({ roomId })` | internalMutation | CLI | 守卫 `room.isSimulated && room.fixtureKey`；`status: 'closed'`、`archivedAt`；取消 open humanRequests；run → superseded；不删任何行 |
| `seed.purgeDemoRoom({ roomId, confirm: roomId })` | internalMutation，仅 dev | CLI | 同上守卫 + `DEMO_PURGE_ENABLED`；按 `by_room` 分批删除各子表，每批后 `runAfter(0, self)` 续跑，避免单事务写入上限（待验证具体上限）；最后删 room |

- 不提供公共 reset 端点；若将来要按钮，用环境变量 `DEMO_ADMIN_TOKEN_IDENTIFIERS` 白名单（F15.1）。
- 已知账号直连：`seed.demoRoom` 可选 `members: { customer: tokenIdentifier, … }` 直接写 members（账号先登录后由 `health.viewer` 取得 tokenIdentifier）。
- 重复执行：同 seedKey 返回旧房间，日志记 `seed.reused`；排练建议每次新 seedKey。
- stub 模式：`AGENT_MODE=stub` 时 `agents.runTurn` 从 `fixtures/scopeChange/recordedTurns.ts` 按 `(variant, role, round)` 取录制输出，提案 `generatedBy: 'stub'`，界面 `Recorded agent output (stub mode)`。

## 7. 测试（全部 import `scopeChangeFixture`，金额从目录推出）

1. 纯函数单测：`enumerateAll` 14 个组合的金额/工作量/日期（golden = §3.6，已由 node 实跑）；每个 variant 的 `expectFeasibleAfter`、`expectCustomerPareto` 与 `precheck` 结论一致。
2. `checkBudget` 边界：474_999 / 475_000 / 475_001 对 C3；负余量 → `BUDGET_BELOW_COMMITTED`。
3. convex-test 主线：用三个 `withIdentity` 依次走 S1–S12（stub 代理），断言每步表行数与事件序列；最后 `commitments` 汇总 475_000、`tasks` 2 行。
4. convex-test 无解：0 次 `agents.runTurn` 调度、0 行 proposals、1 行 finance 请求。
5. 幂等：连续两次 finance `approvals.decide` → 1 行 changeOrder；并发版本在真实 dev 部署用脚本并发 5 次（F08.5，convex-test 不模拟 OCC）。
6. 投影：三方 `rooms.view` 快照对比（golden JSON），provider 快照跑金丝雀与数字黑名单。
7. 时区：锚点在 DST 切换周（2026-11-01）附近时日期解析不偏移（UTC 日期运算）。

## 8. 与其他专题的接口（引用任务书第 5 节编号）

| 文件 | 本专题依赖 / 提供 |
| --- | --- |
| 02 / 03 | 需要的表与字段：`rooms.{fixtureKey, seedKey, anchorDate, timezone, isSimulated, currentProposalId}`、`catalogItems`、`catalogTerms`、`deliverySchedules`、`briefVersions`、`budgets.status`、`commitments.kind`、`changeOrders.budgetSnapshot`、`proposals.{deliveryTier, termKeys, generatedBy, derivedFromProposalId}`、`humanRequests.{options[].impact, disclosureOnAnswer}`；索引 `rooms.by_seed_key` |
| 04 | 用到 run 迁移：negotiating→pending_approval / needs_input / superseded；pending_approval→superseded / confirmed；needs_input→negotiating / superseded；**新增提议** needs_input→`closed_no_agreement` |
| 05 | 模型输出 `propose` 用 `deliveryTier` 代替 `deliveryDate`（D3）；不合规则的 propose 记 `blocked_by_rules` 不成提案；取舍请求由 precheck 发起（D5） |
| 06 | `enumerateCandidates`、`customerPareto`、`checkBudget`、`validateProposal` 与 reasonCode：`FITS_BUDGET`、`OVER_BUDGET`、`BUDGET_BELOW_COMMITTED`、`MISSING_REQUIRED_ITEM`、`DATE_CONFLICT`、`NOT_DELIVERABLE`、`UNKNOWN_ITEM`、`CONSTRAINTS_CHANGED`、`NEEDS_TRADEOFF` |
| 07 | 买方/卖方预算披露；provider 代理上下文不含预算过滤后的候选集；私密截止日对 P 的文案（Q3）；取舍回答的披露提示 |
| 08 | `kind: 'terms' | 'budget'`、集合判定、执行事务、`budgetSnapshot` |
| 09 | 递增点：brief 确认、预算变更、改变硬约束的回答；软偏好回答不递增（D6） |
| 10 | stub 模式与录制输出；每房间调用计数 |
| 13 | 本文所有英文文案作为模板源 |
| 14 | 本文即 14 的 fixture 与走查章节的底稿 |
| 15 | §6 seed / archive / purge；环境变量 `DEMO_TOOLS_ENABLED`、`DEMO_PURGE_ENABLED`、`AGENT_MODE` |
| 16 | §7 测试清单 |

## 9. 待验证清单

1. convex-test 中 mutation 串行、不模拟 OCC（inputs/04 与 F08.5 记为 medium 置信）——并发幂等必须在真实部署验证。
2. 单个 mutation 的写入/读取上限的具体数值（影响 `purgeDemoRoom` 分批大小）——待验证，以 inputs/04 为准。
3. `npx convex run` 调用 internal 函数、`--prod` 指向生产部署的行为。
4. `ctx.scheduler.runAfter` 在 mutation 提交后才执行、与写入原子提交（inputs/04 要点 2）。
5. Clerk 的 Convex JWT 是否带 name/email（影响 seed 直连成员的显示名）。
6. 房间时区"今天"的计算在 Convex 运行时用 `Intl.DateTimeFormat` 是否可用——待验证。
7. 帕累托 + `conflictPolicy` 触发取舍的规则是本专题提议，需 05/06 认可；`closed_no_agreement` 终态需 04 认可。
