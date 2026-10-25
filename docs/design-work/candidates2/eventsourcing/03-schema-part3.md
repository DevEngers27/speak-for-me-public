# 03 Convex schema v1 · part3：EVENT_META、哈希链、写入管线、唯一性、演进与重建

> 分片清单见 part1。

## 1. `EVENT_META`（类型级常量）

| type | audience | 约束事件 | 投影目标 | 渲染模板键 |
| --- | --- | --- | --- | --- |
| room_created | room | 否 | rooms | `room.created` |
| member_joined | room | 否 | members | `member.joined` |
| catalog_item_confirmed / withdrawn | room | **是** | catalogItems, rooms | `catalog.confirmed` / `.withdrawn` |
| brief_confirmed | room（内容按 07 逐字段裁剪） | 若 hardChanged | briefVersions, rooms | `brief.confirmed` |
| budget_changed | room（金额只给 buyers） | **是** | budgets, rooms | `budget.changed` |
| baseline_commitment_recorded | buyers | 否 | commitments | `commitment.baseline` |
| run_started / resumed / failed / superseded / needs_input / ready_for_approval | room | 否 | runs, rooms | `run.*` |
| proposal_created | room | 否 | proposals, rooms, runs | `proposal.created` |
| turn_completed / turn_failed / turn_rejected_stale | room | 否 | （仅时间线；agentTurns 由普通写入维护） | `turn.*` |
| decision_recorded | room | 否 | decisions | `decision.*` |
| human_request_opened / answered / cancelled | room（选项细节按 07 裁剪） | 否 | humanRequests | `request.*` |
| execution_completed | room（承诺前后总额只给 buyers） | 否 | changeOrders, commitments, tasks, runs, rooms | `execution.completed` |
| task_completed | room | 否 | tasks | `task.completed` |
| room_closed | room | 否 | rooms | `room.closed` |

## 2. 哈希链

```ts
// convex/engine/events/hash.ts（纯函数）
export const GENESIS = "0".repeat(64);
export function eventDigestInput(prevHash: string, e: Omit<EventDoc, "_id"|"_creationTime"|"hash"|"prevHash">) {
  return prevHash + "\n" + canonicalJson(e);   // canonicalJson：键排序、无 undefined、数字原样
}
export const hashEvent = (prev: string, e) => sha256Hex(eventDigestInput(prev, e));
```

- `sha256Hex` 优先用 `crypto.subtle.digest`（Convex 默认运行时是否在 mutation 中提供：**待验证**）；不可用则用纯 JS 的 `@noble/hashes/sha256`（无 Node 依赖，同步、确定性）。
- 链头存 `rooms.lastHash`。验证：从 seq=1 顺序重算，任一不符即报告 `{seq, expected, actual}`。
- 哈希链证明"日志未被改过"，不证明"写入时内容正确"——后者由命令校验与测试保证。

## 3. 写入管线（唯一的事件写入口）

```ts
// convex/engine/commands.ts —— 所有业务 mutation 的骨架
export async function runCommand<R>(ctx: MutationCtx, a: {
  roomId: Id<"rooms">; actor: Actor; commandId?: string;
  plan: (s: RoomState) => PlanResult<R>;           // 纯函数：校验命令、给出事件草稿
}): Promise<CommandResult<R>> {
  if (a.commandId) {                                 // ① 去重：同一提交重放返回原结果
    const prior = await ctx.db.query("events").withIndex("by_room_command",
      q => q.eq("roomId", a.roomId).eq("commandId", a.commandId)).first();
    if (prior) return { ok: true, duplicate: true, seq: prior.seq } as const;
  }
  const state = await loadRoomState(ctx, a.roomId); // ② 从投影读聚合状态（同事务快照）
  const planned = a.plan(state);                     // ③ 纯决策
  if (!planned.ok) return planned;                   //    拒绝 = 不写任何东西
  const appended = await appendAndApply(ctx, state, planned.events, a); // ④ 追加 + 投影
  const followUps = react(await loadRoomState(ctx, a.roomId), appended); // ⑤ 反应器（纯）
  await appendAndApply(ctx, state, followUps.events, { ...a, causation: appended.at(-1)?.seq });
  for (const job of followUps.jobs) await schedule(ctx, job);           // ⑥ 同事务调度 action
  return { ok: true, value: planned.value, seqs: [...] };
}

async function appendAndApply(ctx, _s, drafts: EventDraft[], meta) {
  const room = await ctx.db.get("rooms", meta.roomId);
  let { lastSeq, lastHash } = room!;
  const out = [];
  for (const d of drafts) {
    const body = { ...d, roomId: meta.roomId, seq: ++lastSeq, v: EVENT_META[d.type].v, at: Date.now(),
      actor: d.actor ?? meta.actor, audience: EVENT_META[d.type].audience, commandId: meta.commandId,
      causationSeq: meta.causation, simulated: d.simulated ?? room!.simulated };
    const hash = await hashEvent(lastHash, body);
    const doc = { ...body, prevHash: lastHash, hash };
    await ctx.db.insert("events", doc);
    await applyEvent(ctx, doc);                      // 唯一投影写入者；穷举 switch
    lastHash = hash; out.push(doc);
  }
  await ctx.db.patch("rooms", meta.roomId, { lastSeq, lastHash });
  return out;
}
```

要点：
1. 只有 `appendAndApply` 能 `insert("events")`；只有 `applyEvent` 能写 [P]/[I] 表。CI 用 grep 规则检查（16 §6）。
2. `commandId` 只用于"同一次提交的重放"（网络重发、双击）；它由客户端生成，**不是**安全或幂等执行的依据——执行幂等靠服务端派生的 `operationId`（08）。`by_room_command` 只在该房间内查，客户端无法用别人的 commandId 探测他人房间。
3. 每个命令都会 patch `rooms`（流头），同房间的命令因 OCC 串行化；这是有意的（一个聚合一个串行点）。代价：同房间并行回合提交会冲突重试（Convex 自动重试，inputs/04 §1.3），首个场景每房间写入频率很低，可接受。
4. `room_created` 是例外：流头还不存在，`rooms.create` 先 insert rooms（lastSeq 0、lastHash GENESIS），再走同一管线。

## 4. 唯一性落点

| 逻辑唯一 | 索引 | 唯一写入口 | 并发保证 |
| --- | --- | --- | --- |
| `users.tokenIdentifier` | by_token | `users.ensure` | 先查后插 + OCC |
| `(roomId, seq)` | by_room_seq | `appendAndApply` | rooms 流头 OCC |
| `(roomId, role)` / `(roomId, userId)` 成员 | by_room_role / by_room_user | `invites.accept` 的 plan | 同上（都写流头） |
| invite token | by_tokenHash | `rooms.create` / `invites.reissue` | 32 字节随机令牌，碰撞可忽略；仍先查 |
| `(roomId, role, version)` 简报 | by_room_role_version | plan 计算 version = 最新+1；apply 照抄载荷 | 流头 OCC |
| `(roomId, itemKey, itemVersion)` | by_room_item_version | apply(catalog_item_*) | 流头 OCC |
| `(roomId, version)` 提案 | by_room_version | plan 计算 version = rooms.proposalVersion+1 写入事件；apply 只照抄载荷值（回放安全） | 流头 OCC |
| `(roomId, runNo)`；每房间一个活动 run | by_room_run；`rooms.currentRunNo` | apply(run_started)；plan 要求 currentRunNo 为空或该 run 终态 | 流头 OCC |
| `(roomId, requestNo)` | by_room_request | apply(human_request_opened) | 流头 OCC |
| `(roomId, operationId)` 执行 | changeOrders.by_room_operation、commitments.by_room_operation | `approvals.decide` 的 plan（状态守卫 + 查重） | 流头 OCC；第二道保险 |
| `(roomId, runNo, turnSeq, attempt)` 回合 | by_room_run_turn | 反应器 `scheduleTurn` / `retryTurn` | 流头 OCC（调度回合的命令总会追加事件或 patch 流头） |

由于每个命令都写流头，**同一房间内的所有唯一性检查被同一个 OCC 冲突点串行化**——这是事件溯源在 Convex 上的一个实际收益：不必逐个推理"两个并发 mutation 是否读了同一索引区间"（inputs/04 §1.6 的待验证项因此不再承重）。

## 5. 演进、upcast 与重建

| 场景 | 做法 |
| --- | --- |
| 投影加字段 | 先 `v.optional`；写一个回填迁移，或直接对每个房间执行 `audit.rebuildRoom`（回放即回填） |
| 投影改形状 | 改 `applyEvent` → 部署新 schema（新表或宽松字段）→ 逐房间 rebuild → 收紧 schema |
| 事件载荷改形状 | **不改旧事件**。`EVENT_META[type].v` +1，新写入用新版本；`upcast(event)` 在读取（apply/render/verify）前把旧版本转换为当前形状；schema 联合中保留旧版本分支 |
| 删除事件类型 | 不删；标记 deprecated，upcast 映射到新类型或保留只读渲染 |
| 重建 | `audit.rebuildRoom({roomId})`（internal mutation）：删除该房间的全部 [P]/[I] 行，把 rooms 投影字段重置为初值（保留 _id、lastSeq、lastHash），按 seq 重放 `applyEvent`。房间事件数上百量级，一次 mutation 可完成（事务读写上限：待验证；超限时按 seq 分段、期间房间置维护态） |
| 校验 | `audit.verifyRoom`：①重算哈希链；②在子事务 `ctx.runMutation(internal.audit.replayCompare)` 中重建并与重建前投影逐行比较，比较完**主动抛错**让子事务回滚，父 mutation 捕获错误数据返回差异（1.48 子事务语义见 inputs/04 §1.1；错误数据能否完整透传：待验证，退路是把差异写进 `ops` 日志后再抛） |

重建依赖两条纪律：`applyEvent` 只读事件与已有投影（不读 `Date.now()`、不读普通表、不读环境变量）；事件引用领域键（02 DM-2）。
