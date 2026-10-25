import { describe, it as vitestIt } from "vitest";

import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import {batteryChecks} from '../../convex-helpers/workflows.fixture';

// W2-2 / W2-1: union of production assertions; registry titles retained.
const implemented: Record<string, () => Promise<void>> = {
  'INV-46': w2BatteryCases['INV-46']!,
  'INV-47': w2BatteryCases['INV-47']!,
  'INV-48': w2BatteryCases['INV-48']!,
  'INV-50': w2BatteryCases['INV-50']!,
  'INV-53': w2BatteryCases['INV-53']!,
  'CE-095': w2BatteryCases['CE-095']!,
  'CE-103': w2BatteryCases['CE-103']!,
  'CE-105': w2BatteryCases['CE-105']!,
  'CE-106': w2BatteryCases['CE-106']!,
  'CE-107': w2BatteryCases['CE-107']!,
  'CE-108': w2BatteryCases['CE-108']!,
  'CE-110': w2BatteryCases['CE-110']!,
  'CE-111': w2BatteryCases['CE-111']!,
  'CE-113': w2BatteryCases['CE-113']!,
  'CE-115': w2BatteryCases['CE-115']!,
  'CE-116': w2BatteryCases['CE-116']!,
  'CE-117':batteryChecks['CE-117']!,
};
const it = { todo(title: string) {
  const body = implemented[title.split(' ')[0]!];
  if (body) vitestIt(title, body); else vitestIt.todo(title);
} };
// End W2-2 / W2-1.

describe("CT · 05-idempotent-execution", () => {
  it.todo("INV-46 `executions.executionKey = \"exec:\" + proposalId` 唯一（不含 cv、不哈希、服务端派生）；同一 proposalId 至多一行 `executions`、一行 `changeOrders`、一行 `ledgerEntries(kind: 'commit')`；客户端不传任何幂等键，`requestId` 只用于去重与追溯");
  it.todo("INV-47 最后一个必需 approve 的 `approvals` 行 + `executions` + `ledgerEntries(commit)` + `changeOrders` + `tasks` + `events` + `proposal → executed` + `run → executed` + `room → executed` 在同一个 mutation 事务内提交；任一失败全部回滚（不存在\"审批已记录执行丢失\"或\"执行了一半\"）");
  it.todo("INV-48 执行前在同一事务内重读 `rooms`、`runs`、`proposals`、全部 `approvals.by_proposal` 区间、`members`、`ledgerEntries.by_room` 区间、当前 confirmed `catalogItems`、三方简报硬字段；`isExecutable` 重算；不信任入参、不信任任何缓存的 `committedCents`");
  it.todo("INV-50 `committedCents = Σ ledgerEntries.amountCents`（`baseline` + `commit`），不存计数器；每房间恰一行 `kind: 'baseline'`（`ledger.recordBaseline` 在 `setup` 阶段写入一次，可为 0，`startFollowUp` 预填但须 finance 确认；finance 上限已确认时要求 `baseline ≤ capCents`，否则 `budget.below_committed`，canon D23 对称守卫）；`commit` 行只由 `executeIfComplete` 写；`executions.committedBeforeCents / committedAfterCents` 是不可变快照只用于展示；对账 R1–R11（finance 候选 08 §10）在每个 convex-test 场景 `afterEach` 断言");
  it.todo("INV-52 一房一执行：`room.status === 'executed'` 为终态，协商 / 约束 / 成员类写 mutation（含 `budget.setCap` / `catalog.*` / `briefs.confirm` / `ledger.recordBaseline` / `sharedFacts.add` / `invites.*` / `runs.*` / `humanRequests.answer` / `rooms.close`）与内部入口（`constraints.bump` / `startRunTx` / `turns.beginAttempt`）拒绝 `run.invalid_state{ guard: 'room_status' }`，`approvals.record` 按 INV-31（approve 幂等返回 `executed{ alreadyExecuted: true }`、reject / withdraw → `approval.already_executed`）；只有 `tasks.markDone` 与 `rooms.startFollowUp` 放行；后续变更只能 `rooms.startFollowUp({ executionId })` 创建 `followsExecutionId` 指向旧执行的新房间（经 `addMember` 预分配同三席、只把**未交付**的目录行——`itemKey ∉` 旧执行 `terms.itemKeys`——复制为 `draft`、基线预填旧 `committedAfterCents`）；因此不存在\"同房间再次承诺已执行范围\"。跨房间：后续房间的目录与任何候选快照永不含已交付条目，后续房间对已交付键调 `catalog.confirm` → `item.duplicate`（canon D04、12 §12.6 / §12.12）");
  it.todo("INV-53 执行**不**递增 cv；执行后 `executions.approvalIds[]` 冻结当时的 approvals 行 id，结果页与变更单只读快照，后续任何展示不派生 stale");
  it.todo("CE-095 同一人双击 approve，串行到达");
  it.todo("CE-103 用户收到网络错误后再点一次（新调用）");
  it.todo("CE-105 双击 reject");
  it.todo("CE-106 执行中途 `deriveExecution` 抛错");
  it.todo("CE-107 执行后其他人 approve（订阅未刷新）");
  it.todo("CE-108 执行后 reject");
  it.todo("CE-110 v3 在 cv5 缺 finance；bump 到 cv6 后三方在 cv6 批准");
  it.todo("CE-111 变异：执行键改为 `exec:${proposalId}:${cv}`");
  it.todo("CE-113 两次执行后（两个房间）`Σ ledgerEntries ≠ committedBefore + amount`");
  it.todo("CE-115 客户端两次点击各生成一个 `operationId` 传入");
  it.todo("CE-116 变异：执行路径调用 `constraints.bump`");
  it.todo("CE-117 finance 双击 `ledger.recordBaseline`；finance 已确认上限 $5,000 后录入 $5,100 的基线");
  it.todo("CE-118 `executed` 房间：`budget.setCap` / `catalog.confirm` / `runs.start` / `requestRenegotiation` / `approvals.record(reject)`；被指派人 `tasks.markDone`；任一成员 `rooms.startFollowUp`");
});
