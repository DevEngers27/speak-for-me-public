# 06 · 确定性规则引擎与场景插件接口（part6：isExecutable、调用点、enumerateCandidates）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§9 isExecutable 组合与调用点、§10 enumerateCandidates。

## 9. isExecutable 与调用点

### 9.1 组合（语义与唯一实现归 08 §8.4.2；本章只给出与规则的接缝）

全仓只有一个导出名为 `isExecutable` 的函数，位于 `core/engine/executable.ts`，由 08 §8.4.2 定义（16 增加结构测试：`grep -rn 'export function isExecutable'` 恰一处）。其口径：

- `isExecutable(i) = isCurrentForApproval(i) ∧ passesChecks(i.verdict)`，其中 `verdict = checkProposal(p, loadRuleInput(全局, today = room.localDate), proposal)`；**不含**审批集合。`isCurrentForApproval` 是 08 的状态守卫（房间 `open`、run 是 `currentRunId` 且 `pending_approval`、提案是 `run.currentProposalId` 且 `active`）。`termsKey` 完整性断言（`canonicalJson(terms) === termsKey`，否则 `internal`）在 `loadRuleInput` 之后、`checkProposal` 之前由 08 执行。
- 返回 `{ ok: true } | { ok: false, reasons: [{ code }] }`：状态守卫失败 → `approval.not_current`（提案 `stale` 时为 `version.stale_constraints`，`executed` 时为 `approval.already_executed`）；规则阻断项照 `checkProposal` 的 `blocking` 列出（"一次说全"）。`reasons` 离开服务端前经 §8 的投影。
- `allApproved = evaluateApprovalSet(...).complete`（08）；执行条件 `canExecuteNow = isExecutable ∧ allApproved`，只在最后一张必需 approve 的事务里成立并立刻执行（D03）。

`approve` 之前（`approvals.record`：第一、第二、最后一张都跑）与执行事务内（`executeIfComplete`）各调用一次 `isExecutable`；两次读同一事务快照，OCC 保证一致（并发区间冲突的平台语义待验证，spikes §8）。D27 走查中旧提案 v1 在上限降到 $4,800 后的结果 = `{ ok: false, reasons: ['version.stale_constraints', 'budget.over'] }`，三个必需角色的审批状态由 08 给出（2 条 `stale_approve` + finance `pending`）。

### 9.2 调用点总表

| 函数（12 名） | 类型 | 规则调用 | 读 | 写 | 失败码（规则相关） |
| --- | --- | --- | --- | --- | --- |
| `rooms.view({ roomId })` | memberQuery | `loadRuleInput` → **当前提案**（`run.currentProposalId`）`checkProposal` → `projectChecks(viewer)`（07 §7.11）；买方 CTA 用 `passesChecks`，审批槽位用 `evaluateApprovalSet`；已 `stale` 的提案不重算（§8） | rooms、briefs、catalogItems、ledgerEntries、runs、proposals、approvals | — | 无；插件异常 → `evaluation: 'unavailable'` |
| `startRunTx(cause)`（04 §4.3.3，插入 run 的唯一入口；被 `runs.start({ roomId })`（`manual_start`，公开参数无 `cause`）、`react()`（`room_opened` / `constraints_changed`）、`runs.requestRenegotiation` 调用） | 事务内 helper | 预检：① 被 supersede 的 run **处于 `pending_approval`** 时，其 active 提案（非 `rejected`）若 `checkProposal(全局)` 通过 → 新 run `pending_approval` 并沿用同一 `proposalId`（状态迁回 `active` 的迁移归 04 R2；canon D06 已收窄，被取代 run 在 `negotiating` / `needs_input` 的提案一律重新评估）；② 否则 `enumerateCandidates(全局, feasibility)` 非空 → `negotiating`（不按沿用提案在新 cv 下的结论剔除任何候选，D12 ①、05 §5.7.2）；③ 空 → `buildHumanRequests({kind: 'infeasible'})` → `needs_input` | rooms、briefs、catalogItems、ledgerEntries、proposals | runs、turns（`createTurnTx`）、humanRequests、events | `run.invalid_state`、`run.draining`（仅人工入口）、`run.rate_limited`（仅人工入口） |
| `createTurnTx`（04 helper） | 被 `startRunTx` / `turns.complete` / `humanRequests.answer` 调用 | `enumerateCandidates(viewFor(role), { mode: 'snapshot', turnKind, roundNo, limit: protocol.maxCandidates, exclude: excludedCandidateKeys(run)（provider 回合先去掉上一轮被成功转发的 counter 键，§10.1 第 4 条；customer 评估另排除 base 提案的键）, mustInclude: 上一轮被转发的 customer counter 键 })`（锚点不是参数：引擎按 `viewer === proposerRole ∧ turnKind === 'propose' ∧ roundNo === 1` 派生，§10）；finance 评估回合不建快照（不能 counter，05） | 同上 | `turns.candidateSnapshot`、`turns.constraintsVersion` | — |
| `turns.complete({ attemptId, output })` | internalMutation | 守卫 G0–G3 通过后：`optionKey` 只在 `turn.candidateSnapshot` 解析；`materialize(draft, input.catalog, room.localDate)` → `checkProposal(全局)`：通过才插入提案（`terms`、`termsKey`、`lines`、`plannedTasks`）；不通过 → **不插提案、不消耗版本号**，turn 记 `outcome.blockedCandidateKey`（03/04），provider 只得 `blocked`，不调评估、下一轮；counter 全局不通过视为拒绝反馈；进入 `pending_approval` 前用当前 `room.localDate` 重算 `passesChecks`（04 R5） | rooms、runs、turns、attempts、catalogItems、briefs、ledgerEntries | proposals、runs、turns、attempts、events、humanRequests | `action.option_not_in_snapshot`、`action.repeats_blocked`、`version.stale_constraints`（attempt stale） |
| `approvals.record({ proposalId, decision, expectedConstraintsVersion, expectedTermsKey, reasonKey?, note? })` | memberMutation | 提案已 `executed` 且决定为 approve → 先于规则检查返回 `{ status: 'executed', executionId, alreadyExecuted: true }`（12 §12.15 ②、08 §8.5.2；reject / withdraw → `approval.already_executed`）；approve：先过当前性与 `expected*` 守卫（12 §12.15 ⑤⑦），再 `isExecutable`（不含审批集合，第一、第二、最后一张都跑）不通过 → `approval.not_executable`（`params.reasonCodes` 经 §8 投影）不写行；写入后 `executeIfComplete` | rooms、runs、proposals、approvals、members、ledgerEntries 等 | approvals（及执行写入） | `approval.stale`、`approval.not_executable`、`approval.not_current`、`approval.already_executed`、`run.invalid_state` |
| `executeIfComplete`（helper） | 同事务 | 重读后 `isExecutable` + `evaluateApprovalSet`；`checkBudget` 以台账区间读重算 | 同上 + `executions.by_executionKey` | executions、ledgerEntries(commit)、changeOrders、tasks、events | 见 08 |
| `budget.setCap({ roomId, capCents, expectedConstraintsVersion })` | memberMutation（finance） | `validateCapChange(capCents, committedCents)`；与现值相等 → `unchanged` | rooms、briefs、ledgerEntries | briefs（新 finance 版本）→ `constraints.bump` | `budget.below_committed`、`amount.out_of_range`、`run.rate_limited`、`run.invalid_state` |
| `briefs.confirm({ roomId, hardFields, softFields, disclosures })` | memberMutation（本角色） | `validateBriefFields(role, fields, { localDate, catalogKeys })`（`catalogKeys` = 本房间曾确认过的 item 键：confirmed ∪ retired；`requiredItemKeys` / `preferredItemKeys` 的每个键必须属于它，否则 `item.unknown`——关闭伪 itemKey 自由文本信道，privacy-08）；finance 另跑 `validateCapChange` | rooms、briefs、catalogItems、ledgerEntries | briefs → `constraints.bump`；第三份确认 → `openIfReady` → `bump(cause: 'room_opened')` → `react()` → `startRunTx(cause: 'room_opened')`（04 M2） | `date.*`、`item.*`、`amount.out_of_range`、`budget.below_committed`、`disclosure.blocked`、`run.rate_limited` |
| `catalog.confirm` / `catalog.retire`（参数形状以 12 为准，均带 `expectedConstraintsVersion`） | memberMutation（provider） | `validateCatalogRow`（价格上限、`leadDays`、标题闸门、kind 不可变、行数上限）；`revision` 契约（INV-R8） | catalogItems | catalogItems → `constraints.bump` | `amount.out_of_range`、`date.out_of_range`、`input.invalid`（标题格式 / 长度）、`disclosure.blocked`（标题定界词）、`item.duplicate`、`item.limit_exceeded`、`run.rate_limited`（含 `price_writes` 桶，12 §12.2 B7） |
| `sharedFacts.add({ roomId, field, audience, confirmOwnDisclosure })`（12 §12.11，**无 value 参数**） | memberMutation | 值只从调用者本人当前已确认简报复制（finance 的 `committedCents` / `headroomCents` 取台账派生值），结构上无法转述他方的值；`validateFactValue`（日期窗口、itemKey ∈ 本房间曾确认过的 item 键）+ 披露闸门（字段 ∈ `SHAREABLE_FIELDS` 且受众在允许集内；本人硬字段对他方披露须 `confirmOwnDisclosure`；不与他方秘密比对，07 LP-3） | briefs、ledgerEntries、catalogItems、sharedFacts | sharedFacts | `date.out_of_range`、`item.unknown`、`item.unconfirmed`、`disclosure.blocked`、`disclosure.needs_own_confirmation`、`run.invalid_state` |
| `humanRequests.answer({ requestId, optionKey })` | memberMutation（仅 `toRole`） | `raise_cap` → `validateCapChange`；`drop_items` / `extend_deadline` → `validateBriefFields`；`choose_candidate` → 显示交付日 ≥ `localDate + effectiveLeadDays` 且 `checkProposal(全局)` 通过才插入提案（`origin: 'human_choice'`），否则以同一 kind 重新 `buildHumanRequests` | humanRequests、runs、briefs、catalogItems、ledgerEntries | briefs / proposals / sharedFacts / humanRequests → 必要时 `constraints.bump` | `date.before_lead_time`、`budget.below_committed`、`run.invalid_state`、`run.rate_limited` |
| `constraints.bump`（helper，经 09 §9.4 `withConstraintChange`） | 同事务 | 对写入前、写入后的全局输入各算一次 `hardProjection` 并在内存中比较，不同才递增；投影串**不持久化**（§5.3、09 §9.1.1）；`cause: 'clock'` 强制递增 | rooms、写入前后的 `RuleInput` | rooms.constraintsVersion、`constraintRevisions { version, cause, actorUserId, sourceRefs }`（无投影字段）等（09） | — |
| `clock.rollLocalDate` | internalMutation（cron） | 推进 `localDate` 后，对 `pending_approval` 的当前提案比较新旧 `localDate` 下的 `blocking`；对 open 请求的 `choose_candidate` 选项检查显示日是否早于新 `localDate + effectiveLeadDays`；任一翻转 → `constraints.bump({ cause: 'clock' })` | rooms、runs、proposals、humanRequests、catalogItems | rooms.localDate（+ bump） | — |
| `rooms.previewChange({ roomId, change })` | memberQuery | 形状以 12 §12.17 为唯一定义：只对 finance 的 `kind: 'cap'` 变更返回 `verdictAfter`——**仅**当前提案在新上限下的预算检查（`budget.over` / `budget.below_committed`），**不做** feasibility 枚举、不回答"仍存在可行方案"（否则在 U1 / C0 配置下是对 customer 私密必需项与截止日的零成本预言机，privacy-03）；其余变更与角色 `{ verdict: 'recheck', invalidatedApprovals, willSupersedeRun }`；非字段所有者返回 `null`（D12 ②） | 同 `rooms.view` | — | — |
| stub 驱动 `AgentDriver.decide` | action 内纯调用 | 插件 `stubDecide` | 回合快照 | — | — |

## 10. enumerateCandidates

引擎只有这一个 `enumerateCandidates`（`core/engine`，canon §1.6）；场景插件只提供 `candidateSpace`（组合草稿）、`materialize` 与 `stubDecide`，不重新实现枚举、排序、截断、锚点或排除（§12.3）。

```ts
// core/engine/candidates.ts
export type SnapshotItem = { optionKey: string; candidateKey: string; itemKeys: ItemKey[]; modifiers: ItemKey[]; amountCents: Cents; deliveryDate: IsoDate };
export type EnumerateOpts =
  | { mode: 'snapshot'; turnKind: 'propose' | 'evaluate'; roundNo: number;     // 必填；锚点由它们派生，没有覆盖参数
      limit: number; exclude: readonly string[]; mustInclude: readonly string[] }
  | { mode: 'feasibility'; exclude?: readonly string[] };                      // 无 limit：返回视图下全部可行候选（预检、relaxations、choose_candidate）
export function enumerateCandidates<RI>(p: ScenarioPlugin<RI>, view: View<RI>, o: EnumerateOpts):
  { items: SnapshotItem[]; materialized: Materialized[]; emptyReasons: ReasonCode[] } {
  const exclude = o.exclude ?? [];
  const space = p.candidateSpace(view);                       // 插件：只生成组合，必需项不在目录时返回 { drafts: [], emptyReasons }
  const seen = new Set<string>(); const ok: Materialized[] = [];
  for (const d of space.drafts) {
    const m = p.materialize(d, view.catalog, view.localDate);  // 金额 = Σ 目录行；交付日 = localDate + effectiveLeadDays
    if (m === null) continue;                                  // 求和溢出（INV-R6）：丢弃，不崩溃
    if (seen.has(m.candidateKey) || exclude.includes(m.candidateKey)) continue;
    seen.add(m.candidateKey);
    if (checkProposal(p, view, m).blocking.length === 0) ok.push(m);   // 视图读不到的检查为 unknown，不阻断
  }
  const byPublic = (a: Materialized, b: Materialized) =>
    a.terms.amountCents - b.terms.amountCents || codeUnitCmp(a.candidateKey, b.candidateKey);
  const byKey = (a: Materialized, b: Materialized) => codeUnitCmp(a.candidateKey, b.candidateKey);
  if (o.mode === 'feasibility') return { items: label(ok.sort(byKey)), materialized: ok, emptyReasons: space.emptyReasons };
  const anchor = view.viewer === p.protocol.proposerRole && o.turnKind === 'propose' && o.roundNo === 1;   // 派生，调用方不能覆盖
  const pool = [...ok].sort(byPublic); const chosen: Materialized[] = [];
  if (anchor && pool[0]) chosen.push(pool[0]);                // 首轮 proposer：最便宜候选固定首位（抑制锚定，D10）
  for (const k of o.mustInclude) { const m = pool.find(x => x.candidateKey === k); if (m && !chosen.includes(m)) chosen.push(m); }
  for (const m of pool) { if (chosen.length >= o.limit) break; if (!chosen.includes(m)) chosen.push(m); }
  const head = anchor ? chosen.slice(0, 1) : [];
  const rest = chosen.filter(m => !head.includes(m)).sort(byKey);
  const ordered = [...head, ...rest];                         // items 与 materialized 同序；调用方仍按 candidateKey 对应，不靠下标
  return { items: label(ordered), materialized: ordered, emptyReasons: space.emptyReasons };
}
const label = (ms: Materialized[]): SnapshotItem[] => ms.map((m, i) => ({ optionKey: `O${i + 1}`, candidateKey: m.candidateKey,
  itemKeys: m.terms.itemKeys, modifiers: m.terms.modifiers, amountCents: m.terms.amountCents, deliveryDate: m.terms.deliveryDate }));
```

（§10 的规则与理由续见 part7 开头。）
