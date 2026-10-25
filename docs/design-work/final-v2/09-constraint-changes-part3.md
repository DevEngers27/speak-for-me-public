# 09 · 约束变化（part3）：run 处置、各写入口规格、预算低于已承诺

> 分片清单见 `09-constraint-changes.md` 顶部。

## 9.5 约束变化后 run、提案、请求的处置（canon D06）

`bump` 内的 `disposeCurrentRun(ctx, room, "constraints_changed")` 与随后的 `react()`（9.4）按 bump 时的当前 run 状态处置。审批行**从不修改**：它们绑定的 `boundConstraintsVersion` 不再等于新 cv，派生有效性自然变为 `stale_approve` / `stale_reject`（04 §4.7.1）。

| bump 时的当前 run | run 迁移（04） | 当前提案 | open 请求 | 非终态 turn / 在途 attempt | `react()` 之后 |
| --- | --- | --- | --- | --- | --- |
| （房间 `setup`） | — | — | — | — | 不 bump（M2），`openIfReady` |
| `negotiating` | R7 → `superseded`（`constraints_changed`） | `active` → `stale`（P4） | — | turn → `stale`；attempt 保持 `running`，返回时 G1 拒收、只补记用量 | `startRunTx`（不传 `keepCandidateId`，**不沿用**：代理评估尚未完成，canon D06 修订、04 §4.15 Q1）：可行集非空 → R1（新 run 的 provider 回合重新提出、评估方重新评估）；为空 → R3 |
| `pending_approval` | R12 → `superseded` | `active` → `stale` | — | — | `startRunTx(keepCandidateId = 该提案)`：在新约束下仍通过 → R2（"上调预算 / 下调后仍够 / 无关改价"的标准路径：同一 `proposalId`、不复制版本、三方以新 cv 重批）；否则可行集非空 → R1；为空 → R3 |
| `needs_input` | R16 → `superseded` | 若有 `active` → `stale` | 由本次回答触发的那条已 `answered`；其余 → `superseded`（H4） | — | 同 `negotiating` 行（不沿用；例如 `raise_cap` 回答后新 run 重新协商） |
| 无活跃 run（上一 run `ended_no_agreement` / `canceled`） | 不变 | — | — | — | `startRunTx` 开新 run：约束变化即"再试一次"的信号（canon D06 的 react 条件），滥用受 canon D12 ⑥ 节流 |
| （房间 `executed` / `closed`） | — | — | — | — | 入口拒绝 `run.invalid_state`，不 bump（canon D03/D04） |

- **被拒提案不复活**：`disposeCurrentRun` 只把 `active` 改成 `stale`；人拒绝后的 run 回到 `negotiating`，其 `currentProposalId` 指向的是 `rejected` 行，不会被改、不会成为 `keepCandidateId`（inputs/07"复活被人拒绝的提案"）。
- **R2 只在被取代 run 处于 `pending_approval` 时适用，且只看规则结论**（canon D06 / §1.3、04 R2）：预检用 `passesChecks(P, loadRuleInput(roomId))`（此时房间已是新 cv），与审批守卫、执行重算是同一个函数；通过即进入 `pending_approval`，零模型调用。
- **预检无解不调模型**：R3 由 `buildHumanRequests` 按目标角色自身视图生成恰好一个请求（canon D11/D15），不会让代理编造一致（核心 8）。

## 9.6 各写入口规格

所有入口先过构造器层的成员鉴权（`memberMutation`：`auth.not_member` / `auth.role_forbidden` / `auth.not_creator`，12 §12.3）与 `withSanitizedErrors`；第一次写之前调用 `openRoomTx(ctx, roomId, { allow: ["setup", "open"] })`，再以 `RoomCtx` 调 `withConstraintChange`（04 §4.1.2；`executed` / `closed` 房间由此得 `run.invalid_state{guard:"room_status"}`）；失败一律 `ConvexError({ code, params })` 且不写任何行；`params` 按调用者角色投影（canon D16）。"节流"指 canon D12 ⑥ 的每用户每房间每小时 ≤ 6 次（`run.rate_limited`）。四个约束写入函数都带 `expectedConstraintsVersion`（12 B5：提交前展示的影响预览必须与提交时同一 cv，canon D19），不符返回 `version.stale_constraints { currentConstraintsVersion }`。返回值统一为 12 的 `confirmResultV = { status: "confirmed" | "unchanged", version, constraintsVersion, bumped }`——不返回 run 去向（对 provider 会多泄露一位，界面从 `rooms.view` 读已投影的 run 状态）。

### 9.6.1 `budget.setCap`（finance 便捷入口）

| 项 | 内容 |
| --- | --- |
| 参数 | `{ roomId: Id<"rooms">, capCents: number, expectedConstraintsVersion: number }` |
| 守卫（顺序） | ① 调用者角色 = finance（`auth.role_forbidden`）② `room.status ∈ {setup, open}`（`run.invalid_state{guard:"room_status"}`）③ `expectedConstraintsVersion`（`version.stale_constraints`）④ `assertCents(capCents)`（`amount.out_of_range`）⑤ 等于 finance 最新简报的 `capCents` → `unchanged`，不写、不计节流 ⑥ `committedCents = Σ ledgerEntries`（`by_room_kind` 前缀）；`capCents < committedCents` → `budget.below_committed`，`params.minAllowedCapCents = committedCents`（只给 finance）⑦ 节流 |
| 写 | `insertBriefVersion(finance)`（03 §3.13.1 唯一插入 helper）：复制最新版本、`hardFields.capCents = capCents`、`source: 'set_cap'`、`confirmedBy` = 调用者；`withConstraintChange({ cause: "brief_confirmed" })` → `open` 时 bump（constraintRevisions、rooms、runs、proposals、humanRequests、turns、events，可能新 run / turn / attempt 并调度 `agents.runAttempt` + `agents.watchdog`）；`setup` 时 `openIfReady` |
| 读 | rooms、members、briefs（`by_room_role_version`）、`ledgerEntries` 区间（与执行事务 OCC 冲突）、catalogItems、runs、proposals、humanRequests、opsFlags |
| 返回 | `confirmResultV`（`version` = finance 新简报版本号；`bumped` 表示 cv 是否递增） |

### 9.6.2 `briefs.confirm`（硬字段部分；完整参数与披露矩阵见 07 / 12 §12.9）

| 项 | 内容 |
| --- | --- |
| 参数 | `{ roomId, expectedConstraintsVersion, hardFields, softFields, disclosures }`（按角色判别的 validator，由场景 `FieldSpec` 生成） |
| 守卫 | ① 只能确认本人角色的简报（`input.invalid{field:"hardFields"}`）② `setup` / `open` ③ `expectedConstraintsVersion` ④ customer：`requiredItemKeys` 非空、≤ 12 项、形如 `^[a-z][a-z0-9_]{1,39}$`、唯一（`item.duplicate`），且每个键（`preferredItemKeys` 同）必须属于本房间曾确认过的 item 键 confirmed ∪ retired（否则 `item.unknown`：关闭伪 itemKey 自由文本信道，privacy-08；已 retired 的必需项由规则报 `item.required_missing(not_offered)`）；`deadline` 为真实 `IsoDate` 且 `room.localDate ≤ deadline ≤ localDate + 365`（`date.invalid` / `date.in_past` / `date.out_of_range`，canon D12 ⑧；`setup` 房间先同事务 `rollLocalDateTx`，以当日 `localDate` 校验，9.6.7）；finance：`assertCents(capCents)` 且 ≥ `committedCents`（`budget.below_committed`）；provider：无硬字段 ⑤ 披露字段必须是 `FieldSpec` 声明为可披露的（`input.invalid{field:"disclosures"}`）⑥ 内容与最新版本完全相同 → `unchanged` ⑦ 节流 |
| 写 | 新简报版本 → `withConstraintChange({ cause: "brief_confirmed" })`：只有硬投影变化才 bump；只改软字段 / 备注 / 披露 → 新版本 + 事件 `brief_confirmed`（不含值），不 bump、不打扰 run |

### 9.6.3 `catalog.confirm`

| 项 | 内容 |
| --- | --- |
| 参数 | `{ roomId, expectedConstraintsVersion, rows: { itemKey, kind: "item" \| "modifier", title, priceCents, leadDays, taskTemplates }[] }`（一批 ≤ 14 行，计一次节流；参数名与形状以 12 §12.12 为准，03 §3.7 同）；改价 / 改工期 / 新增 / 撤下另受 07 §7.13 的 `price_writes` 桶约束（每房间 open 期间每 24 小时 ≤ 3 批，每个 open run 内同一 itemKey 改价 ≤ 1 次） |
| 守卫 | ① provider ② `setup` / `open` ③ `expectedConstraintsVersion` ④ 批内 itemKey 唯一；已有 itemKey 的 `kind` 不可变；后续房间里不得重新上架旧执行已交付的 itemKey（均 `item.duplicate`，03 §3.13.1、12 §12.12 ④）⑤ `itemKey` 匹配 `^[a-z][a-z0-9_]{1,39}$`；`title` NFC 后 1–80 码点且匹配 `^[^<>\r\n]+$`（canon D13：唯一进入他方上下文的人写字符串；格式不符 → `input.invalid{field:"title"}`），格式合法但 NFKC 归一后含定界词（`untrusted_data`、`room_state`、`candidates`、`shared_facts`、`clarify_answers`、`principal_brief`、`principal_notes`、`turn_instruction`、`system` 的原文或 `&lt;` 形式）→ `disclosure.blocked{field:"title"}`（06 §4、12 §12.12 ⑤、14 §5 同一两码划分）；`assertCents(priceCents)`；`leadDays` 为 0–365 的整数；`taskTemplates` 形状与上限按 03 / 14（以上不符均 `input.invalid{field}`）⑥ 当前非 retired 的 item ≤ 12、modifier ≤ 2（`item.limit_exceeded`，06）⑦ 节流 |
| 写 | 逐项按 9.1.3 插行或跳过（follow-up 房间 `revision 0` 的 draft 行不修改，确认插 `revision 1` 新行）；`withConstraintChange({ cause: "catalog_changed", sourceRefs: 定价变化的行 })`：一批至多一次 bump；只改标题的批不 bump |
| 返回 | `confirmResultV` |

### 9.6.4 `catalog.retire`

参数 `{ roomId, itemKey, expectedConstraintsVersion }`；守卫 ① provider ② `setup` / `open` ③ `expectedConstraintsVersion` ④ 当前行存在（`item.unknown`）；已 `retired` → `unchanged` ⑤ 节流；写入 `{ revision: +1, editNo: 0, status: "retired" }` 的新行（其余字段复制）→ `withConstraintChange({ cause: "catalog_changed" })`。引用该项的当前提案在新 cv 下报 `item.retired`，不会被 R2 沿用。

### 9.6.5 `ledger.recordBaseline`

参数 `{ roomId, amountCents }`；守卫 ① finance ② `room.status === "setup"`（`open` 及之后 → `run.invalid_state{guard:"room_status"}`：基线开房后不可改，使 `committedCents` 在 `open` 期间恒定，9.1.2）③ 本房间尚无 baseline（`run.invalid_state{guard:"baseline_exists"}`，canon §1.5）④ `assertCents` ⑤ finance 已有确认简报时 `amountCents ≤ capCents`（否则 `budget.below_committed`，`params.minAllowedCapCents = amountCents`）。写 `ledgerEntries { kind: "baseline", amountCents, provenance }` 后 `openIfReady`。`rooms.startFollowUp` 预填的"旧执行 `committedAfterCents`"仍须 finance 调本函数确认（canon D04）。

### 9.6.6 `humanRequests.answer` 的约束效果

守卫与非约束效果见 04 §4.8.2。约束效果的写入顺序固定为：请求 `open → answered`（`answeredBy`、`answerOptionKey`）→ `insertBriefVersion`（`source: 'request_answer'`；`raise_cap` 写 finance 简报 `capCents = amountCents`，再查 `≥ committedCents`；`drop_items` 写 customer 简报且剩余必需项非空，否则 `item.required_missing`；`extend_deadline` 写 customer 简报且日期在窗口内，否则 `date.out_of_range`；`confirmedBy` = 回答者，回答本身就是本人对新硬值的确认）→ `withConstraintChange({ cause: "human_answer", sourceRefs: [humanRequest, 新简报] })`。若返回 `changed: false`（选项生成保证不应发生），不 bump，按 04 R20 的方式同事务重跑预检（仍无解 → 新的 `infeasible` 请求；有解 → provider 回合）并 `opsLog`，run 不会停在无请求的 `needs_input`（`infeasible` 请求没有 `keep_as_is`，canon D15）。

### 9.6.7 `clock.rollLocalDate`（internal mutation，cron）

```ts
// convex/crons.ts：crons.hourly("roll room local dates", { minuteUTC: 1 }, internal.clock.rollLocalDate, {});   // 只作兜底
// 精确推进：rooms.create 登记首个；之后每次单房间 rollLocalDate（无论本次是否推进）都确保恰有一个待执行的
// scheduler.runAt(nextLocalMidnight(now, room) + clockJitterMs(roomId), internal.clock.rollLocalDate, { roomId })，id 存 rooms.clockFnId
// （canon D22 允许的调度 mutation），所以正常情况下滞后只有秒级；小时 cron 只在调度丢失时补位
const CLOCK_STATUSES = ["setup", "open"] as const;                 // setup 也推进（不 bump）：简报日期窗口与开房预检都读 localDate
export const rollLocalDate = internalMutation({
  args: { roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, { roomId }) => {
    const now = Date.now();
    if (!roomId) {                                    // 扇出：每个房间一个小事务，互不 OCC 牵连
      for (const s of CLOCK_STATUSES)
        for await (const r of ctx.db.query("rooms").withIndex("by_status", q => q.eq("status", s)))
          if (localToday(now, r) > r.localDate)
            await ctx.scheduler.runAfter(0, internal.clock.rollLocalDate, { roomId: r._id });
      return;
    }
    const room = await ctx.db.get(roomId);
    if (!room || !CLOCK_STATUSES.includes(room.status)) return;    // executed / closed：链自然终止
    const lagging = localToday(now, room) > room.localDate;
    const timerAlive = await isPendingFn(ctx, room.clockFnId);       // _scheduled_functions 为 pending；本次调用自身是 inProgress，不算
    if (!lagging && timerAlive) return;                              // 幂等：只读返回不开写锁（cron 补位撞上仍存活的链）
    const rctx: RoomCtx = { ...ctx, tx: await openRoomTx(ctx, roomId, { allow: ["setup", "open"] }) };   // 04 §4.1.2
    if (lagging) await rollLocalDateTx(rctx, room, now);
    if (!timerAlive) {                                               // 链上的正常触发、提前触发或丢失后的补位：都补登记恰好一个
      const fnId = await ctx.scheduler.runAt(nextLocalMidnight(now, room) + clockJitterMs(roomId),
        internal.clock.rollLocalDate, { roomId });
      await rctx.tx.patch("rooms", roomId, { clockFnId: fnId });
    }
  },
});

export async function rollLocalDateTx(ctx: RoomCtx, room: Doc<"rooms">, now: number) {   // 事务内 helper：物化前、setup 日期输入前、openIfReady 前同样调用
  if (!CLOCK_STATUSES.includes(room.status)) return;
  const today = localToday(now, room);
  if (today <= room.localDate) return;                           // 幂等
  if (room.status === "setup") {                                 // setup 没有 cv、没有 run：只推进，不判翻转、不 bump（canon D05）
    await ctx.tx.patch("rooms", room._id, { localDate: today }); return;
  }
  const before = await timeVerdicts(ctx, room, room.localDate);  // pending_approval：当前提案 passesChecks；
  const after = await timeVerdicts(ctx, room, today);           // needs_input：每个选项是否仍成立
  await ctx.tx.patch("rooms", room._id, { localDate: today });   // 推进日期本身不 bump
  if (!sameVerdicts(before, after))
    await bump(ctx, { cause: "clock", sourceRefs: [{ kind: "clock", localDate: today }], depth: 0 });
}
```

- **日期与下一次登记的算法**：`localToday(t, room) = todayInTimeZone(t, room.timeZone)`（Intl 时区支持待验证 V-D2）；V-D2 不通过时的退路是房间上带标签的固定偏移（`{ kind: "fixed_offset", offsetMinutes }`，03 落地，建房时确定且不变），按固定偏移计算、从不推断夏令时。`nextLocalMidnight(now, room)` = 满足 `localToday(t, room) > localToday(now, room)` 的最早 UTC 时刻 `t > now`：上界取 `now + 48 h`（任何时区的下一个本地日期都在其内），在 `[now, now + 48 h]` 上按分钟精度二分（约 12 次日期格式化）；只比较日期字符串，所以跨夏令时切换同样成立。`clockJitterMs(roomId) = hash(roomId) mod 60_000`：确定性的 0–60 s 抖动，分散整点同时到期的房间。
- **每次调用都幂等且保证下一次登记**：`rooms.clockFnId` 指向的调度仍 `pending` 就不再登记，所以 cron 补位、链上调用与重复投递不会让定时链分叉；提前触发（尚未跨日）也会补登记，链不会因此中断。
- **`setup` 期间**：本函数与 `rollLocalDateTx` 都覆盖 `setup` 房间，推进只写 `localDate`、从不 bump（`setup` 没有 cv，canon D05）。带日期的 `setup` 输入（customer `briefs.confirm` 的 `deadline` 窗口校验，9.6.2）与 `openIfReady`（04 M2）在读 `localDate` 之前先同事务调用 `rollLocalDateTx`；`openIfReady` 随后重跑 `roomReadiness`，已过期的截止日以缺口 `deadline_passed`（负责角色 customer，04 §4.2.1）挡住开房，而不是带着落后的日期 bump 到 v1。

- 这是除 `withConstraintChange` 与 `openIfReady` 之外唯一调用 `bump` 的地方（日期不在投影内，必须显式判定翻转）；结构测试白名单只含这三处。
- 规则在 query 与 mutation 中一律读 `room.localDate`（canon §1.2、D22），所以显示与执行的结论永远一致。滞后窗口被两层消除：(a) 每个房间在本地午夜按 `runAt` 精确调度一次单房间 `rollLocalDate`（上面的注释），小时 cron 只兜底；(b) 任何**物化**条款的 mutation（`turns.complete` 的 `insertProposal`、`humanRequests.answer(choose_candidate)`）在物化前若发现 `todayInTimeZone(now, room.timeZone) > room.localDate`，先在同事务调用 `rollLocalDateTx(room)`——它就是 `clock.rollLocalDate` 单房间分支的事务内实现（同一函数体，不另写日期逻辑），结论翻转则 bump——D06 在同一事务里 supersede 本 run，`turns.complete` 随后的守卫中本 attempt 被 **G1** 判 stale（run 已不是当前 run；`rollLocalDateTx` 在 G1–G3 之前调用，10 §10.7.2 步骤 2b），新 run 由 `react()` 开出；否则按新 `localDate` 物化。实际上 `negotiating` 期间既没有 `pending_approval` 提案、也没有 open 请求，`timeVerdicts` 无可翻转的结论，推进 `localDate` 通常不会 bump，只会让本次物化按新日期计算交付日。canon D22（修订）已明文允许：只有 `clock.rollLocalDate` 及其事务 helper `rollLocalDateTx`（与建房时的 `rooms.create`）计算真实日期，物化条款的 mutation 在物化前先同事务调用 `rollLocalDateTx`。于是不会出现"按前一日物化、工期短一天"的条款（invariants-11；16 增加 "00:30 插入提案" 用例）。
- `negotiating` 中的 run 不在 `timeVerdicts` 里：`advanceRun` 在 R5 前用当前 `localDate` 重算，交付日已过的提案按阻断进入下一轮（04 §4.3.4）。

### 9.6.8 `rooms.previewChange`（query，canon D12 ②）

参数与返回形状**以 12 §12.17 为唯一定义**（本节只复述语义）：`{ roomId, change: { kind: 'cap', newCapCents } | { kind: 'customer_hard', requiredItemKeys, deadline } | { kind: 'catalog', rows } }`；`memberQuery`，非成员或不拥有该变化的角色返回 `null`（12 §12.2 第 2 条，不抛错）。返回 `{ verdict: 'unchanged' }`（投影不变）、`{ verdict: 'recheck', invalidatedApprovals, willSupersedeRun }`（作废数基于 `rooms.view` 已可见的审批）或——仅 finance 的 `cap` 变更——`{ verdict: 'after', verdictAfter: { proposalVersion, budgetCheck: 'pass' | 'budget.over' }, invalidatedApprovals, willSupersedeRun }`：`verdictAfter` **只含当前提案在新上限下的预算检查**，不做 feasibility 枚举、不回答"仍存在可行方案"（在 U1 / C0 配置下那是对 customer 私密必需项与截止日的零成本预言机，privacy-03）。上限低于已承诺时对 finance 返回 `{ verdict: 'rejected', code: 'budget.below_committed', minAllowedCapCents }`。读 `room.localDate`，不读 `Date.now()`；不写任何东西。

## 9.7 预算低于已承诺（canon D23）

| 写入点 | 校验 | 结果 |
| --- | --- | --- |
| `budget.setCap`、finance `briefs.confirm` | `capCents < committedCents` | `budget.below_committed`（`minAllowedCapCents` 只给 finance），不 bump、不写事件、不写简报 |
| `humanRequests.answer(raise_cap)` | 选项金额由 `buildHumanRequests` 按 `committedCents + 最低可行增量` 生成，回答时复查 | 同上 |
| `ledger.recordBaseline` | 基线不得超过已确认上限 | 同上码（参数为基线额） |
| `executions.executeIfComplete` | `passesChecks`：`committedCents + amountCents ≤ capCents` | 执行后 `committedAfterCents ≤ capCents` |

由此 `capCents ≥ committedCents` 在任何房间、任何时刻成立（INV-CC-06），余量恒 ≥ 0；规则引擎保留 `budget.below_committed` 码只作纵深防御（06），若在 `RuleInput` 中观察到即 `opsLog` 不变量告警并视全部提案为阻断。fixture 的 $3,900 变体是"拒绝写入"，**不得**用 seed 伪造该状态（canon D18/D27）。现实中的超额削减（已承诺的钱需要释放）属于系统外处理或 17 的冲销流程。

被否决："允许写入并进入 `needs_input` 向 finance 发请求"（inputs/02、eventsourcing CC-7、runtime 候选）——v1 没有释放承诺的路径，请求没有任何合法选项可选，且会让"余量 ≥ 0"失效、让 fixture 依赖不可达状态。
