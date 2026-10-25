# 09 · 约束变化（part2）：`constraintRevisions` 与 `bump` / `react()`

> 分片清单见 `09-constraint-changes.md` 顶部。

## 9.3 `constraintRevisions`：每个 cv 一行

canon §1.1 已列出 `constraintRevision`（每个 cv 恰一行、只追加、唯一写者 `constraints.bump`，cause 枚举见 canon §1.2）；03 §3.7 按下式落地（9.14 Q3 已关闭）。

```ts
// convex/schema.ts 片段（validator 只校验形状；版本连续性由唯一写入口保证）
export const revisionCauseV = v.union(v.literal("room_opened"), v.literal("brief_confirmed"),
  v.literal("catalog_changed"), v.literal("human_answer"), v.literal("clock"),
  v.literal("scenario_migrated"));   // 15 的场景版本迁移（08 O12）：对受影响房间强制 bump 后重批；定义与 03 §3.7 同源
export const sourceRefV = v.union(
  v.object({ kind: v.literal("brief"), briefId: v.id("briefs"), role: roleV, version: v.number() }),
  v.object({ kind: v.literal("catalogItem"), catalogItemId: v.id("catalogItems"),
             itemKey: v.string(), revision: v.number() }),
  v.object({ kind: v.literal("ledgerEntry"), ledgerEntryId: v.id("ledgerEntries") }),   // 只出现在 room_opened 行
  v.object({ kind: v.literal("humanRequest"), humanRequestId: v.id("humanRequests") }),
  v.object({ kind: v.literal("clock"), localDate: v.string() }),
);
constraintRevisions: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),                       // bump 后的 rooms.constraintsVersion（从 1 起连续）
  previousVersion: v.number(),               // = version - 1
  cause: revisionCauseV,
  actorUserId: v.optional(v.id("users")),    // 只有 cause === "clock" 时缺省（canon §1.2：被调度函数显式传身份）
  sourceRefs: v.array(sourceRefV),           // room_opened：全部生效来源；其余：本次变化的来源
  localDate: v.string(),                     // bump 时的 rooms.localDate（clock 翻转的证据；重放日期取求值引用，见下）
  supersededRunId: v.optional(v.id("runs")),
  staleProposalId: v.optional(v.id("proposals")),
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]),
```

| 性质 | 保证方式 |
| --- | --- |
| 每个 cv ≥ 1 恰一行、`(roomId, version)` 唯一且连续 | 唯一写入口 `bump`；它在同事务读写 `rooms`，并发 bump 被 OCC 串行化；`version = room.constraintsVersion + 1` |
| 不存约束值 | 行内只有 id、版本号、角色可推的 `actorUserId`；新旧上限只在 finance 简报版本里（本人可读） |
| 他方看不到私密来源 | 无公开 query 直接返回本表；`constraints_changed` 事件 payload 只有 `{ fromVersion, toVersion }`，`restrictedRef` 指向本行，`timeline.page` 渲染时按查看者连接（canon D14、03 §3.7）：finance 看到 cause 与新旧上限（经 `sourceRefs` 连接其简报版本），customer 看到 cause / 变更角色、上限按 finance 的披露开关（"Finance updated the budget" 或具体值），provider 只见 "Constraints changed (vN)"——provider 连"是谁改的"都看不到 |
| 不回填来源表 | 不设 `producedConstraintsVersion`（versioned-approvals r11）；"版本 N 的输入"由 `sourceRefs` 折叠得到 |
| 不存派生计数 | 作废的审批数由 `evaluateApprovalSet` 前后对比现算，不入库 |

**重放**（核心 6"可从事件追溯每个结果"）：

```ts
// convex/constraints.ts —— internal query；审计页与回归测试用
// 参数是不可变的求值引用 evaluationRef = { constraintsVersion, localDate }：同一 cv 内 localDate 可以不 bump 地推进
// （canon D22、9.6.7），只给 cv 不足以确定当时的 RuleInput，所以不提供只带 cv 的形态
export const replayRuleInput = internalQuery({
  args: { roomId: v.id("rooms"), ref: v.object({ constraintsVersion: v.number(), localDate: v.string() }) },
  handler: async (ctx, a) => {
    const revs = await ctx.db.query("constraintRevisions")
      .withIndex("by_room_version", q => q.eq("roomId", a.roomId).lte("version", a.ref.constraintsVersion)).collect(); // 几十行
    if (revs.at(-1)?.version !== a.ref.constraintsVersion) throw new EngineInvariantError("replay.unknown_version");
    const inForce = new Map<string, SourceRef>();            // brief:<role> | catalog:<itemKey> | ledger:baseline
    for (const r of revs) for (const s of r.sourceRefs)
      if (s.kind === "brief" || s.kind === "catalogItem" || s.kind === "ledgerEntry") inForce.set(refKey(s), s);
    return assembleRuleInput(ctx, inForce, a.ref.localDate);   // 日期逐字取自求值引用，从不取 revision 行的 bump 日
  },
});
```

`room_opened` 行列出全部生效来源，所以折叠从 v1 起总是完整的；只改标题的目录行不产生 revision，重放取到的是定价行，规则结论不受影响（9.1.3）；`open` 期间台账只有基线（9.1.2），cv 内来源不变，因此 `(constraintsVersion, localDate)` 唯一确定 `RuleInput`。**求值引用由求值处捕获、写后不改**：provider 回合的规则判定（`turns.complete`）、提案插入（`insertProposal`，含 `choose_candidate`）与执行（`executeIfComplete`）各自在同一事务记下当时的 `{ constraintsVersion: room.constraintsVersion, localDate: room.localDate }`（字段由 03 落地）；审计与回归测试按记录逐字重放，从不由 cv 推断日期。bump 事务内算出的结论（`disposeCurrentRun` 的处置、`react → startRunTx` 的 R2 沿用预检与 R3 可行集判定）不另设捕获点：它们的求值引用就是本次 bump 写入的 revision 行 `{ constraintsVersion: revision.version, localDate: revision.localDate }`——`bump` 在同一事务里读 `room.localDate` 写入该行（`clock` 先 patch `localDate` 再 bump，9.6.7；`rollLocalDateTx` 在同一事务内幂等），所以该事务里 `room.localDate` 等于 revision 行的 `localDate`。`constraintRevisions.localDate` 只是 bump 当时的日期（`clock` 翻转的证据），不是该 cv 的唯一求值日。测试 CC-16 断言：每条求值记录的 `replayRuleInput(ref)` 与当时的 `loadRuleInput` 逐字段相等（去掉 `title` / `taskTemplates`），同一 cv 跨午夜的两条记录各自重放出不同的 `localDate`。

## 9.4 唯一递增入口与不动点

```ts
// convex/constraints.ts —— rooms.constraintsVersion 的唯一写入口（结构测试 CC-17）
// ctx: RoomCtx = MutationCtx & { tx: RoomTx }（04 §4.1.2）：调用方（budget.setCap / briefs.confirm / catalog.* /
// humanRequests.answer / openIfReady / clock.rollLocalDate）已在第一次写之前 openRoomTx；这里只经 ctx.tx 写、不另开写锁
export const MAX_REACT_DEPTH = 4;

export async function withConstraintChange(ctx: RoomCtx,
    c: { cause: "brief_confirmed" | "catalog_changed" | "human_answer"; actorUserId?: Id<"users"> },
    apply: () => Promise<SourceRef[]>): Promise<{ changed: boolean; constraintsVersion: number }> {
  const roomId = ctx.tx.room._id;
  const room0 = (await ctx.db.get(roomId))!;
  if (room0.status === "executed" || room0.status === "closed")
    throw new ConvexError({ code: "run.invalid_state" });          // openRoomTx({ allow: ["setup", "open"] }) 已先拦，这里是纵深
  if (room0.status === "setup") {                                   // M2：只写来源，不 bump
    await apply(); await openIfReady(ctx, roomId, c.actorUserId);
    const r = (await ctx.db.get(roomId))!; return { changed: false, constraintsVersion: r.constraintsVersion };
  }
  const before = hardProjection(await loadRuleInput(ctx, roomId));   // 06 §5.1 / §5.3
  const sourceRefs = await apply();                                 // 先写来源行（新简报版本 / 目录行）
  const after = hardProjection(await loadRuleInput(ctx, roomId));    // 读回本事务写入
  if (before === after) return { changed: false, constraintsVersion: room0.constraintsVersion };
  return { changed: true, constraintsVersion: await bump(ctx, { ...c, sourceRefs, depth: 0 }) };
}

export async function bump(ctx: RoomCtx, b: BumpArgs): Promise<number> {   // BumpArgs.cause: revisionCauseV 全部取值
  if (b.depth >= MAX_REACT_DEPTH) throw new EngineInvariantError("constraints.react_depth_exceeded"); // 回滚整笔
  const room = (await ctx.db.get(ctx.tx.room._id))!;                // 重读本事务内最新值
  if (room.status !== "open") throw new EngineInvariantError("constraints.bump_not_open");
  const to = room.constraintsVersion + 1;
  const d = await disposeCurrentRun(ctx, room, "constraints_changed");   // 9.5：取代 run、P4、H4、turn → stale；返回 { runId?, staleProposalId?, previousStatus? }
  const revisionId = await ctx.tx.insert("constraintRevisions", { roomId: room._id, version: to,
    previousVersion: to - 1, cause: b.cause, actorUserId: b.actorUserId, sourceRefs: b.sourceRefs,
    localDate: room.localDate, supersededRunId: d.runId, staleProposalId: d.staleProposalId, createdAt: Date.now() });
  await ctx.tx.patch("rooms", room._id, { constraintsVersion: to });
  await appendEvents(ctx.tx, [{                                      // 03 §3.11.2；payload 只有房间可见字段（canon D14）
    payload: { type: "constraints_changed", fromVersion: to - 1, toVersion: to },
    restrictedRef: { table: "constraintRevisions", id: revisionId },   // cause / 变更角色 / 新旧值渲染时按查看者连接
    actor: { kind: "system" } }]);                                  // 不写 user actor：provider 连"谁改的"都不应看到（9.3 表）
  // keepCandidateId 只在被取代 run 被取代前处于 pending_approval 时非空（canon D06 / §1.3；04 R2）
  await react(ctx, room._id, { depth: b.depth + 1,
    runCause: b.cause === "room_opened" ? "room_opened" : "constraints_changed",
    keepCandidateId: d.previousStatus === "pending_approval" ? d.staleProposalId : undefined });
  if (DEV_ASSERTS) await assertFixedPoint(ctx, room._id);           // F1–F4，见下
  return to;
}

async function react(ctx: RoomCtx, roomId: Id<"rooms">,
    r: { depth: number; runCause: "room_opened" | "constraints_changed"; keepCandidateId?: Id<"proposals"> }) {
  if (r.depth > MAX_REACT_DEPTH) throw new EngineInvariantError("constraints.react_depth_exceeded");
  const room = (await ctx.db.get(roomId))!;
  if (room.status !== "open") return;                               // setup / executed / closed 无反应
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (run && !RUN_TERMINAL.has(run.status)) {
    if (run.constraintsVersionAtStart === room.constraintsVersion) return;  // 已是不动点
    await disposeCurrentRun(ctx, room, "constraints_changed");      // 防御（正常已在 bump 中处置）
  }
  await startRunTx(ctx, roomId, {                                   // 04 §4.3.3：R1 / R2 / R3
    cause: r.runCause, origin: "system", keepCandidateId: r.keepCandidateId, reactDepth: r.depth });
}
```

**不动点与深度**。一次 mutation 内的反应链是：触发写入 →（若投影变化）`bump`（深度 0）→ `disposeCurrentRun` → `react` → `startRunTx`。反应链中任何需要再次 bump 的步骤都必须以 `depth + 1` 调用 `bump`，由它递归 `react`；每层深度 +1，`depth ≥ 4` 抛 `constraints.react_depth_exceeded`，整个 mutation（含触发写入本身）回滚、`opsLog`，而不是无限循环。v1 的反应步骤（取代、开 run、预检、生成请求）都不 bump，所以实际链长恒为 1；深度上限为将来的自动反应（如报价过期）预留，并由 CC-15 用注入的递归反应验证回滚行为。由回答产生的 bump（`human_answer`）与任何其他 bump 走同一条链（canon D06、inputs/07"单层反应"反例）。

`assertFixedPoint`（dev / test 下开启，生产关闭以省读）断言：
- **F1** room `open` ⇒ 当前 run 非终态且 `constraintsVersionAtStart === room.constraintsVersion`；
- **F2** run `needs_input` ⇒ 恰一个 open 请求；`pending_approval` ⇒ `currentProposalId` 为 `active` 且 `passesChecks`；
- **F3** 不存在 `constraintsVersion < room.constraintsVersion` 的 open 请求；
- **F4** 不存在当前 run 之外的 `active` 提案。

### 9.4.1 写入顺序规则

1. **先写来源、再求 after**：调用方在 `apply` 内插入新简报版本 / 目录行，`after` 读回同事务写入（read-your-writes；"索引区间读能看到本事务刚插入的行"列为实现首周真实部署探针，versioned-approvals V1）。
2. **回答先置 answered、再 bump**：`humanRequests.answer` 的约束效果先 `setStatus(open → answered)`，再 `withConstraintChange`，所以 `disposeCurrentRun` 的"取代 open 请求"不会误伤它。
3. **系统路径永不因上限、节流或排空抛错**：`react → startRunTx` 在 `opsFlags.draining`、全局日美元已满、`run_starts` 桶已满（房间 24 小时 ≥ 6 个 run）时照常插入 run / turn，由 `turns.beginAttempt` 或 `startRunTx` 记等待原因（`draining` / `spend_deferred` / `run_cap`，04 §4.3.3、canon D06 末句、D12 ⑥、D17）。约束写入因此永远能落库。
4. **所有 bump 路径读写 `rooms`，且全部写经入口持有的 `RoomTx`**（04 §4.1.2；`bump` / `react` 不另调 `openRoomTx`，`writeSeq` 每事务恰 +1，03 SC-T4 / SC-T5）：并发的两次约束写入、约束写入与最后一票（`approvals.record` 读 `rooms`、`executeIfComplete` 写 `rooms`）都被 OCC 串行化（9.9 V10）。OCC 永久失败以普通 mutation 错误返回，前端给通用重试提示（versioned-approvals V2）。
5. **`setup` 不 bump**：`withConstraintChange` 在 `setup` 只写来源并调用 `openIfReady`；`openIfReady` 先 `setStatus(setup → open)` 再 `bump({ cause: "room_opened", sourceRefs: 全部生效来源 })`，得到 v1 与第一行 revision，随后 `react` 以 `cause: room_opened` 开首个 run。
