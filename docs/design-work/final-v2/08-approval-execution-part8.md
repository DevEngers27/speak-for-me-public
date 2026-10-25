# 08 审批与执行（part8）：8.8 对账检查器 R1–R11

> 来源：`candidates2/finance/08-approval-execution-part2.md` §10 的 R1–R11（码名保留），改写到 canon 的表结构（无 `budgets` / `commitments` / `budgetRevisions`，上限在 finance 简报，台账为 `ledgerEntries`）；并入 `deepdives/idempotent-execution-part4.md` §4.3 `checkExecutionInvariants` 的 8 条与 review r10 的活性不变量。任何发现都是代码缺陷的证据（正常路径不可能产生）。

## 8.8.1 形态

```ts
// core/engine/reconcile.ts —— 纯函数；输入是一个房间的只读快照
export type ReconcileCode = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11';
export interface Finding {
  code: ReconcileCode;
  check: string;                                   // 如 'R7.signer_not_latest'
  ref?: { table: string; id: string };             // 不含任何金额或私密值 → 可安全写 opsLog
}
export function reconcileRoom(s: RoomSnapshot, opts: { scenario: ScenarioPlugin }): Finding[];

// convex/model/executions.ts
export const checkInvariants = internalQuery({     // 测试、运维共用；无公开入口
  args: { roomId: v.id('rooms') },
  returns: v.array(findingV),
  handler: async (ctx, { roomId }) => reconcileRoom(await loadRoomSnapshot(ctx, roomId), { scenario: … }),
});
```

`RoomSnapshot` = 该房间的 `rooms`、`runs`、`proposals`、`approvals`、`members`、`briefs`（finance / customer 全部版本）、`catalogItems`（全部修订）、`ledgerEntries`、`executions`、`changeOrders`、`tasks`、open `humanRequests`。快照装载走索引并有上界（v1 单房规模为几十到几百行）。v1 不提供公开的 finance 对账页（finance 候选的 `budget.reconcile` 公开 query 推迟到 13 有需要时再加，届时只返回 `{ ok, findingCodes }`）。

## 8.8.2 检查清单

| 码 | 检查（对一个房间） | 对应不变量 |
| --- | --- | --- |
| **R1 `SEQ_GAP`** | (a) 每个 `(proposalId, userId)` 的审批 `seq` 恰为 1..n 连续、无重复；相邻两行的 `(decision, boundConstraintsVersion)` 不同（否则第二行不该被写入）。(b) 每个角色的 `briefs.version` 从 1 连续（上限历史 = finance 简报版本链，替代 finance 候选的 `budgetRevisions.revision`）。(c) `proposals.version` 在房间内唯一且从 1 连续 | E2 |
| **R2 `COUNTER_DRIFT`** | (a) `rooms.nextProposalVersion === max(proposals.version) + 1`（房间内唯一的计数器字段）。(b) 已承诺不存计数器：`executions.committedAfterCents === Σ ledgerEntries.amountCents`（v1 执行后无新台账行），`committedBeforeCents === Σ（除本执行 commit 外的全部行）`。(c) 静态部分在 16 的 schema 测试里：`rooms` / `briefs` 无任何 `committed*` 字段 | E6 |
| **R3 `AMOUNT_RANGE`** | 每个金额是 `0 ≤ n ≤ 1e11` 的安全整数：`ledgerEntries.amountCents`、`executions.{amountCents, committedBeforeCents, committedAfterCents, capCentsAtExecution}`、`changeOrders` 链上五个字段、`proposals.terms.amountCents`、`proposals.lines[].priceCents`、finance 各版本 `hardFields.capCents` | E6 |
| **R4 `HEADROOM_NEGATIVE`** | (a) `execution.committedAfterCents ≤ execution.capCentsAtExecution`。(b) `capCentsAtExecution` 等于 finance 最新简报版本的 `capCents`（执行后房间终态，不可能再有新版本）。(c) 当前 `Σ ledgerEntries ≤` 当前 finance `capCents`（D23 保证上限不低于已承诺） | E6、E7 |
| **R5 `ORPHAN_COMMITMENT`** | 每条 `kind: 'commit'` 的台账行有 `executionId`，指向本房存在的执行，且 `amountCents === execution.amountCents === changeOrder.deltaCents`；每条 `baseline` 行没有 `executionId` | E6 |
| **R6 `ORPHAN_CHANGE_ORDER`** | 每条执行恰有 1 张变更单（`by_execution`）、恰有 1 条 commit；变更单与任务都指向存在的执行；该执行的任务集合与 `proposal.plannedTasks` 一一对应：数量相等，`taskKey === \`${executionId}:${itemKey}:${templateIndex}\``，`taskKey` 唯一，`title` / `assigneeRole` / `dueDate` 与快照相同 | E8 |
| **R7 `SIGNATURE_SET`** | `execution.approvalIds.length === proposal.requiredApprovals.length`；第 i 个 id 指向的行：存在、`proposalId` 相同、`decision === 'approve'`、`role` / `kind` 等于 `requiredApprovals[i]`、`boundConstraintsVersion === execution.constraintsVersion`、`boundTermsKey === proposal.termsKey`、是该用户在该提案上 seq 最大的行（执行后没有更晚的行）；userId 两两不同；每个签字人是该角色**唯一**的当前成员（`members.by_room_role` 恰 1 行） | E4、E10 |
| **R8 `TERMS_KEY`** | `canonicalJson(proposal.terms) === proposal.termsKey === execution.termsKey === changeOrder.termsKey`；`changeOrder.terms` 与 `changeOrder.lines` 逐字段等于提案快照；`Σ lines[].priceCents === terms.amountCents` | E3、E8 |
| **R9 `PRICE_SOURCE`** | 变更单每行 `(itemKey, revision, priceCents, leadDays)` 与 `catalogItems` 中同 `(itemKey, revision)` 的行一致；该修订 `status === 'confirmed'` 且是该 itemKey 的最新修订（执行后房间终态，不会再有目录写入；执行前若有更新修订，bump 早已让提案离开审批，D05） | 核心 4 |
| **R10 `OPENING_BALANCE`** | 房间曾打开（`room.constraintsVersion ≥ 1`）则恰有 1 条 `baseline`；从 `setup` 直接关闭的房间（cv 仍为 0）至多 1 条；`commit` 至多 1 条（一房一执行）；变更单链：`baselineCents === baseline.amountCents`、`priorApprovedDeltaCents === Σ 其他 commit`（v1 为 0）、`amountBeforeCents === baselineCents + priorApprovedDeltaCents`、`amountAfterCents === amountBeforeCents + deltaCents`；`execution.committedBeforeCents === amountBeforeCents`、`committedAfterCents === amountAfterCents` | E7 |
| **R11 `PROPOSAL_STATUS`** | (a) 提案 `executed` ⇔ 恰有 1 条执行指向它；(b) `room.status === 'executed'` ⇔ 本房恰有 1 条执行；(c) run `executed` ⇔ 它就是本房执行行的 `execution.runId`（且其 `currentProposalId === execution.proposalId`）；被取代的 run 可以保留指向同一提案的历史 `currentProposalId`（D06 跨 run 保留同一 proposalId），不据此报错；(d) `executionKey === \`exec:${proposalId}\`` 且在全表唯一（按本房执行检查）；(e) 活性：若 `room.status === 'open'`、当前 run `pending_approval`、当前提案 `active`、`evaluateApprovalSet` 在当前 cv 下 `complete` 且 `passesChecks`（以 `room.localDate` 为 today）→ 报 `R11.complete_but_not_executed`；(f) 已执行房间内无 open `humanRequests` | E1、E5、E11、E12 |

## 8.8.3 在哪里断言

1. **convex-test：每个场景 `afterEach` 断言**。16 的 `test.setup.ts` 注册全局钩子：

   ```ts
   afterEach(async () => {
     const t = currentConvexTest();                 // convex-test-utils 维护的当前实例
     if (!t || t.skipReconcile) return;             // 只有显式故障注入用例可跳过，并必须改用 expectFindings
     for (const roomId of await t.query(internal.testing.listRoomIds, {})) {
       expect(await t.query(internal.executions.checkInvariants, { roomId })).toEqual([]);
     }
   });
   ```

   覆盖所有场景，包括预期抛错的用例（抛错后状态也必须自洽）。故障注入用例（`t.run` 绕过写入口、重复成员行等）不得静默跳过：它们调用 `expectFindings(roomId, ['R7'])` 断言**恰好**出现预期的发现。`internal.testing.*` 只在 `DEPLOYMENT_TIER !== 'prod'` 时注册（`assertTier`，D18）。
2. **模型测试：每个操作之后**（不只在最后）跑一次，见 part9 §8.9.3。
3. **真实部署并发探针：每次试验之后**跑一次，结果写进证据记录（part9 §8.9.4）。
4. **运维**：15 可把 `checkInvariants` 挂到每日 cron（对 `executed` 房间与最近 7 天有写入的 `open` 房间），发现只记 `opsLog('reconcile.finding', { code, check })` 计数并告警，不含金额、不含 id 以外的值。

## 8.8.4 纯函数单测（`core/engine/*.test.ts`，vitest project `engine`）

| # | 用例 |
| --- | --- |
| U1 | `latestDecisionsByUser`：乱序输入按 seq 取最大；同 user 同 seq → `ApprovalInvariantError` |
| U2 | `evaluateApprovalSet`：三角色都在当前 cv 上 approve → `complete`，`approvalIds` 与 `required` 同序 |
| U3 | 任一角色无决定 → `missingRoles` 含它，`reasons` 为 `approval.missing_role` |
| U4 | 某角色最新为 cv 3 的 approve、当前 cv 4 → `stale_approve`，不齐，`reasons` 为 `approval.stale` |
| U5 | cv 3 的 reject、当前 cv 4 → `stale_reject`（不是 `pending`，RA-B30） |
| U6 | 当前 cv 上 approve 后 withdraw → `withdrawn`；旧 cv 上的 withdraw → `pending`（review r13） |
| U7 | approve → withdraw → approve（seq 1/2/3）→ `approved` |
| U8 | 角色持有人 0 人 / 2 人 → `vacant`，不齐 |
| U9 | 同一 userId 是两个角色的唯一持有人 → 第二个槽 `self_conflict`，不齐 |
| U10 | 行的 `role` / `kind` 与快照不符 → 该槽 `pending` |
| U11 | `boundTermsKey !== proposal.termsKey` → `stale_*` |
| U12 | 非当前成员的 approve 不计入 |
| U13 | `isExecutable`：`approval.not_current` / `version.stale_constraints` / 规则阻断各一例，集合不齐**不**影响它；`canExecuteNow`：集合不齐 → `approval.missing_role`；`createdAtConstraintsVersion` 与当前 cv 不同但规则通过 → `isExecutable.ok`（X26）；结构测试：仓库内只有一个导出名为 `isExecutable` 的函数 |
| U14 | `computeChangeOrderChain`：400_000 + 80_000 对上限 480_000 → ok、`headroomAfterCents === 0`；上限 479_999 → `budget.over`；0 或 2 条 baseline → `baseline_count`；求和溢出 → `cents_out_of_range`；有此前 commit 时 `priorApprovedDeltaCents` 正确 |
| U15 | `planExecutionRecords`：terms 漂移、声明金额不符、`deltaCents` 不符、51 个任务、重复 `(itemKey, templateIndex)`、任务 itemKey 不在条款内，各抛 `ExecutionPlanError`；正常路径输出与输入快照逐字段相同 |
| U16 | 性质测试（fast-check）：随机合法提案 + 台账 → 预览计划与执行计划深相等（同输入同输出，防止日后有人在任一路径读当前模板） |
| U17 | `inheritProvenance` 九种组合表驱动 |
| U18 | `reconcileRoom`：从一个干净的已执行快照出发，逐一篡改一个字段（seq 跳号、计数器错、负金额、超上限、孤儿 commit、缺变更单、签字人非最新行、termsKey 不符、行价与目录不符、两条 baseline、提案 executed 无执行），每次**恰好**产生对应的一个 R 码 |
