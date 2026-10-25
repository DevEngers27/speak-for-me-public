import {retainedApprovalReadModels} from '../../convex-helpers/w2ReadModels.fixture';
import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import {describe,it as vitestIt} from 'vitest';
import {runtimeCase} from '../../convex-helpers/runtimeCases.w2-4.fixture';
import {cases,answerBump,projectionMatrix,depthRollback,infeasibleAfterCap} from '../w2-3.cases';

// W2-4: real scheduler assertions retain the registry titles below.

const implemented: Record<string, () => Promise<void>> = {
  'CE-061': runtimeCase('CE-061'),
  'CE-068': runtimeCase('CE-068'),
  'INV-34': runtimeCase('INV-34'),
  'INV-36': runtimeCase('INV-36'),
  'CE-043': cases.repricingBumps,
  'CE-044': cases.unchanged,
  'CE-046': cases.titleOnly,
  'CE-059': cases.retainPending,
  'CE-060': answerBump,
  'CE-062': answerBump,
  'CE-065': cases.retainPending,
  'CE-066': cases.twoBumps,
  'CE-070': cases.rollover,
  'INV-33': cases.twoBumps,
  'INV-24': projectionMatrix,
  'INV-32': async () => { await cases.retainPending(); await infeasibleAfterCap(); await cases.rejectedNeverRevives(); await depthRollback(); },
  'CE-067': depthRollback,
  'INV-25': w2BatteryCases['INV-25']!,
  'INV-28': w2BatteryCases['INV-28']!,
  'INV-29': w2BatteryCases['INV-29']!,
  'INV-30': w2BatteryCases['INV-30']!,
  'INV-31': w2BatteryCases['INV-31']!,
  'CE-042': w2BatteryCases['CE-042']!,
  'CE-047': w2BatteryCases['CE-047']!,
  'CE-048': w2BatteryCases['CE-048']!,
  'CE-049': w2BatteryCases['CE-049']!,
  'CE-050': w2BatteryCases['CE-050']!,
  'CE-051': w2BatteryCases['CE-051']!,
  'CE-052': w2BatteryCases['CE-052']!,
  'CE-054': w2BatteryCases['CE-054']!,
  'CE-055': w2BatteryCases['CE-055']!,
  'CE-056': w2BatteryCases['CE-056']!,
  'CE-058': async () => { await w2BatteryCases['CE-058']!(); await retainedApprovalReadModels(); },
  'CE-063': w2BatteryCases['CE-063']!,
  'CE-064': w2BatteryCases['CE-064']!,
  'CE-069': w2BatteryCases['CE-069']!,
  'CE-071': w2BatteryCases['CE-071']!
};
const it = { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } };
// End W2-4.

describe("CT · 03-versioned-approvals", () => {
  it.todo("INV-24 `rooms.constraintsVersion` 只经 `constraints.bump` 递增；`setup` 期的写入只写来源、不 bump；`open` 房间里，非强制类写入使 `scenario.hardProjection(RuleInput)` 的前后 `canonicalJson`（同一事务内各求一次、不持久化）改变 ⇔ 同事务 bump 一次；三种强制 bump：`setup → open` 时 `cause: room_opened`（cv 0 → 1）、`clock.rollLocalDate` 在时间结论翻转时 `cause: clock`、场景迁移 `cause: scenario_migrated`；硬投影 = `{ capCents, requiredItemKeys, deadline, catalog: [{ itemKey, revision, status, priceCents, leadDays }] }`（含 `kind: 'modifier'` 的 rush；`revision` 是定价修订号）；`localDate`、软字段、披露开关、成员、目录 `title` / `taskTemplates`（只增 `editNo`）、`ledgerEntries` 不在投影内；每个 cv 恰一行 `constraintRevisions { version, previousVersion, cause, actorUserId?, sourceRefs, localDate }`，`cause ∈ room_opened / brief_confirmed / catalog_changed / human_answer / clock / scenario_migrated`；性质：\"同 `localDate`、同台账下投影相等 ⇒ 任意提案阻断集合相等\"（06 T06-P4）");
  it.todo("INV-25 ∀ `approvals` 行：`proposalId`、`boundConstraintsVersion`、`boundTermsKey` 写后不变且 `boundTermsKey === proposals.termsKey`；`approvals.record` 入参 `expectedConstraintsVersion === room.constraintsVersion ∧ expectedTermsKey === proposal.termsKey`，否则抛出 `approval.stale`（`params.currentConstraintsVersion`）、不写行；写入的 bound* 取服务端值");
  it.todo("INV-28 `proposals.requiredApprovals: { role, kind }[]` 在插入时由场景快照、不可变（v1 为常量三角色）；`kind: terms | budget` 由角色派生只影响文案；改变必需审批人属于 17");
  it.todo("INV-29 同一 `(proposalId, userId)` 的 `seq` 从 1 严格连续（读上一行 + 1，不用 `_creationTime`）；同人对同 `(proposalId, boundConstraintsVersion)` 重复相同 decision 不插行、不写事件，返回 `unchanged`；`withdraw` 只能撤回本人在当前 cv 上的 approve 且在执行前（无可撤回 → 返回 `unchanged`、不插行、不写事件，不另设错误码）；同一提案上本人 withdraw 行 ≥ 10 或 approve 行 ≥ 60 → `run.rate_limited`（reject 永不受限）");
  it.todo("INV-30 对某 proposalId 一旦落下有效 `reject`：提案 → `rejected`（终局，不能撤回拒绝、不复活），`run.currentProposalId` 保留指向它作历史（守卫靠 `proposal.status`），被拒 `candidateKey` 进入本 run 阻断集；run → `negotiating`（下一轮；代理反馈只含被拒版本——provider 代理只见 \"vN rejected\"，买方代理另见拒绝者角色——**任何他方代理上下文不含 `reasonKey` / `note`**）或轮次用尽 → `needs_input(kind: 'rounds_exhausted')`；`reasonKey` 对人按场景 `humanReasonKeys[].audience` 渲染；bump 预检的\"仍通过则保留\"不考虑 `rejected` 提案");
  it.todo("INV-31 `approvals.record` 前置：非成员 → `auth.not_member`；caller.role ∉ `requiredApprovals` → `auth.role_forbidden`（`approval.missing_role` 只作 `evaluateApprovalSet` 的槽位原因）；提案已执行：approve 先于其余检查返回 `{ status: 'executed', executionId, alreadyExecuted: true }` 不写行，reject / withdraw → `approval.already_executed`；`room.status === 'open' ∧ run 是 room.currentRunId ∧ run.status === 'pending_approval' ∧ run.currentProposalId === proposalId ∧ proposal.status === 'active'`，否则 `approval.not_current`（含提案已 `rejected` / `superseded` / `stale`、房间仍在 `setup`）；approve 前同事务 `isExecutable`（canon §1.3：当前性 ∧ `passesChecks`，不含审批集合）为真，否则 `approval.not_executable`（纵深防御）；reject 不要求可执行；场景版本在当前部署未注册时 approve → `run.invalid_state{ guard: 'scenario_version' }`，reject / withdraw 照常");
  it.todo("INV-32 `constraints.bump` 同事务（`disposeCurrentRun`）：非终态 run → `superseded(endedReason: 'constraints_changed')`、其 `active` 提案 → `stale`、非终态 turn → `stale`、open `humanRequests` → `superseded`，再 `react()` 迭代到不动点（深度 ≤ 4）；`room.status === 'open'` 时 `startRunTx(cause: 'constraints_changed')` 预检。事务结束时**恰为**下列之一：(a) 被取代的 run **处于 `pending_approval`**，且其 `currentProposalId`（从未被拒）在新约束下 `passesChecks` → 新 run `pending_approval`、`run.currentProposalId` 为同一 proposalId、该提案同事务 `stale → active`（04 P4 + P5），零回合，旧审批按 INV-26 自然 stale；(b) (a) 不成立且全量 `RuleInput` 下可行集非空 → 新 run `negotiating`（provider 首回合）、旧提案 `stale`；(c) 为空 → 新 run `needs_input`、恰一个 open 请求、旧提案 `stale`、零模型调用。被取代 run 处于 `negotiating` / `needs_input` 时其提案一律重新评估，不走 (a)。系统路径不因排空或 `run_starts` 节流而拒绝建 run（首回合停泊 `waitingReason: draining | run_cap`）。不存在\"run 停在 `pending_approval` 而其提案不可执行且无新 run\"");
  it.todo("INV-33 新 run 的 `constraintsVersionAtStart` 取 patch 后的 cv；∀ 非终态 run：`run.constraintsVersionAtStart === room.constraintsVersion`；∀ 非终态 turn：`turn.constraintsVersion === room.constraintsVersion`");
  it.todo("INV-34 open `humanRequest` ⇒ 其 `runId === room.currentRunId` 且该 run 为 `needs_input`（由 INV-33 得其 cv = 当前 cv）；每 run 至多一个 open 请求；`humanRequests.answer` 守卫：caller.role === `toRole`（否则 `auth.role_forbidden`）、`status === 'open'`（否则 `request.not_open`——bump 已把旧请求置 `superseded`，不需要单独的 cv 守卫）、`optionKey ∈ options` 且不是 `blocked` 说明项（否则 `request.option_unknown`）、run 仍是当前且 `needs_input`（否则 `run.invalid_state`）；answer 先写 `answered` / `answeredBy` / `answerOptionKey` 再触发效果，bump 只 supersede **其他** open 请求");
  it.todo("INV-36 交付日在提案插入时物化为绝对日期（`localDate(插入日) + max(leadDays)`），之后不重算；日期检查只有 `deliveryDate >= localDate`（`date.in_past`）与 `deliveryDate <= deadline`（`date.after_deadline`）；query 永不读 `Date.now()`；`clock.rollLocalDate` 推进 `rooms.localDate`，仅当当前 `pending_approval` 提案或 open 请求选项的时间结论翻转才 `constraints.bump(cause: 'clock')`；物化条款的 mutation 若发现真实日期已过 `localDate`，先同事务 `rollLocalDateTx` 再物化（不会按前一日物化）；审批与执行不因跨午夜重算而失效；v1 目录无 `validUntil`（报价有效期在 17）");
  it.todo("CE-042 customer、provider 已批 v3（cv4）；customer `briefs.confirm` 把 `deadline` 提前（cv5），v3 的 `deliveryDate > 新 deadline`");
  it.todo("CE-043 provider `catalog.confirm` 改已被 v3 引用条目的 `priceCents`（cv+1）");
  it.todo("CE-044 finance `budget.setCap` 填回当前值");
  it.todo("CE-046 provider `catalog.confirm` 只改 `title` 或 `taskTemplates`（新行 `revision` 不变、`editNo + 1`）");
  it.todo("CE-047 用户页面停在 cv5；cv 已变 6 且 v3 仍合规；点击 `approve`（`expectedConstraintsVersion: 5`）");
  it.todo("CE-048 用户看到 v2 内容；提交时 `run.currentProposalId` 已是 v3");
  it.todo("CE-049 同一人 approve → withdraw → approve 串行");
  it.todo("CE-050 在 cv2 下 reject v2；随后 cv → 3");
  it.todo("CE-051 seed 构造：F 已批后把 finance 席位换成 F'（v1 不支持换人，仅测试构造）");
  it.todo("CE-052 seed 绕过 INV-15 让同一 userId 同时持 customer 与 finance 席，两席都 approve");
  it.todo("CE-054 非成员 / 匿名 调 `approvals.record`；（v1 无第四席，若测试构造出不在 `requiredApprovals` 中的角色席位）该角色调用");
  it.todo("CE-055 当前 cv 下本人无 approve 时调 `withdraw`（含已撤回、只有旧 cv 上的 approve）");
  it.todo("CE-056 同一人在同一提案上 approve / withdraw 交替，直到第 11 次 withdraw；随后另一人 `reject`");
  it.todo("CE-058 finance 上调 cap（cv+1）时 run 处于 `pending_approval`、v3 仍合规；customer 以新 cv approve");
  it.todo("CE-059 预算上调（对当前方案有利）");
  it.todo("CE-060 H1 open（finance `raise_cap`）；finance 回答 → bump；随后有人回答已 `answered` 的 H1，或回答被 bump 置 `superseded` 的旧 run 请求");
  it.todo("CE-061 `humanRequests.answer` 选 `disclose`（不改硬输入）");
  it.todo("CE-062 `humanRequests.answer(raise_cap)` → bump 后旧 run 已 superseded；检查是否自动开新 run 并预检");
  it.todo("CE-063 v3 在 cv4 pending；cv5 保留（INV-32(a)）；被拒回 `negotiating`；下一回合创建");
  it.todo("CE-064 customer reject v3 后 provider 改无关条目价格（bump）");
  it.todo("CE-065 变异：bump 把提案置 `stale` 后预检保留却忘记把新 run 指向它，或忘记同事务 `stale → active`；变异：被取代 run 处于 `negotiating` 时也沿用其 active 提案");
  it.todo("CE-066 两次快速 bump（cv4、cv5）：第一次开出的新 run R2 已调度 attempt");
  it.todo("CE-067 构造 answer → bump → start → 预检 needs_input → 再 answer 的链条，检查 `react()` 深度");
  it.todo("CE-068 creator 从 `negotiating` 调 `runs.requestRenegotiation`；从 `executed` 房间调；非 creator 调");
  it.todo("CE-069 跨午夜：v1 `deliveryDate 2026-11-20`；23:50 两票；00:10 第三票");
  it.todo("CE-070 跨午夜翻转：pending 提案 `deliveryDate === localDate`；`clock.rollLocalDate` 推进一天");
  it.todo("CE-071 测试里手工把 `Date.now()` 推进两天但不跑 cron");
});
