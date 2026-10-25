# 02 领域模型（part2：派生量、金额口径、不变量清单）

## 2.6 金额口径（解决 GAP-03 "$900 与 $4,900 混用"）

全部为整数美分（`number`，`Number.isSafeInteger`，0 ≤ n ≤ 100_000_000）。名字全篇统一：

| 名字 | 含义 | 来源 | 示例（fixture，降预算前） | 谁能看到数值 |
| --- | --- | --- | --- | --- |
| `priceCents` | 本提案的变更金额（明细之和 + 费用行） | `deriveTerms` 从目录版本计算 | 90000 | 全房间（提案公开） |
| `baselineCommittedCents` | 本房间之前已承诺的金额 | finance 简报硬字段 | 400000 | finance；D |
| `committedCents` | 当前已承诺 = baseline + Σ commitments | 读时汇总 | 400000 | finance；D（经 headroom） |
| `projectedCommittedCents` | 若执行本提案后的已承诺 = committed + price | 读时计算 | 490000 | finance；customer 仅当 headroom 已披露时看到"执行后余量" |
| `capCents` | 预算上限 | finance 简报硬字段 | 500000 | finance；D |
| `headroomCents` | 余量 = cap − committed | 派生字段（可披露） | 100000 | finance；D |
| `shortfallCents` | 超出额 = max(0, projected − cap) | `OVER_BUDGET` 参数 | 0（降到 4,800 后为 10000） | 同 `OVER_BUDGET` 可见性 |

界面口径：买方（有权限时）显示 "+$900 change · $4,900 committed after approval · $5,000 cap"；provider 只显示 "+$900"。provider 已知 $900，看到 $4,900 就能反推已承诺 $4,000，所以执行后合计永远不出现在 provider 视图中（07 §7.9）。

## 2.7 派生状态（不入库）

```ts
// packages/engine/src/derive.ts —— 全部为纯函数，query 与 mutation 共用
proposalStatus(p, room, executedProposalIds, evalNow):
  "executed"        if executedProposalIds.has(p._id)
  "current_ready"   if room.currentProposalId === p._id && evalNow.ok
  "current_blocked" if room.currentProposalId === p._id && !evalNow.ok
  "superseded"      otherwise

decisionState(seat, p, room, decisionsOfSeatOnP):
  latest  = 该席位对 p 在 room.constraintsVersion 下的最新一行
  earlier = 该席位对 p 在更早 cv 下的最新一行
  latest?.kind === "approve"  → "approved"
  latest?.kind === "reject"   → "rejected"
  latest?.kind === "withdraw" → "withdrawn"
  earlier?.kind === "approve" → "stale_approve"   // "你曾在约束 v1 下批准过 v3"
  earlier?.kind === "reject"  → "stale_reject"    // 修复 RA-B30
  otherwise                   → "pending"

committedCents(financeBrief, commitments) = financeBrief.hard.baselineCommittedCents + Σ commitments.amountCents
needsInput(room, run) = run.status === "needs_human"      // 由 open humanRequests 驱动
```

为什么不存 `proposal.status` 与 `approval.status`：它们是"当前约束 + 当前指针"的函数，存储就会与数据漂移（Role A RA-B17）。执行状态是唯一的事实型状态，由 `changeOrders` 的存在表达，同样不需要在提案上存。

## 2.8 不变量清单

每条写明落点（哪个函数守护）与测试（16 章）。"单一写入口"指：该表的该类写入在整个代码库中只有一个 helper，其他代码调用它。

| 编号 | 不变量 | 落点 | 测试 |
| --- | --- | --- | --- |
| I-01 | 每个 `(roomId, roleKey)` 恰好一个席位 | `rooms.create` 一次性插入全部席位；之后无 `participants` 插入路径 | TC-AUTH-05 |
| I-02 | 每个 `(roomId, userId)` 至多一个席位 | `invites.accept`、`rooms.create` 内按 `by_room_user` 查后写 | TC-AUTH-06 |
| I-03 | "我是谁、我是什么角色"只从 `ctx.auth` + `participants` 推导 | `convex/lib/access.ts`；业务函数无 userId/roleKey 参数 | TC-AUTH-07、API 快照 |
| I-04 | `briefVersions` 不可变；同一席位 version 连续递增 | 单一写入口 `writeBriefVersion`（读最大 version + 1） | TC-VER-06 |
| I-05 | `catalogVersions` 不可变；同房间 version 连续递增 | 单一写入口 `writeCatalogVersion` | TC-VER-06 |
| I-06 | cv 只经 `bumpConstraints` 改变（激活经 `activateRoom`）；单调递增；每个 cv ≥ 1 恰好一行 `constraintSnapshots` | 上述两个 helper | TC-VER-08 |
| I-07 | `setup` 阶段 cv = 0；激活时 cv = 1 | `activateRoom` | TC-RUN-06 |
| I-08 | `proposals` 不可变；version 在同一 mutation 内由 `rooms.proposalSeq + 1` 分配；`(roomId, version)` 唯一 | 单一构造器 `insertProposal` | TC-VER-06 |
| I-09 | 提案的条目、延后项、交付日期、价格只由 `deriveTerms(candidate, catalogVersion, customerRequest)` 产生 | `insertProposal` 只接受 `Candidate` 与目录版本 id，不接受条款对象 | TC-RULE-01、TC-INJ-05 |
| I-10 | 每房间至多一个非终态 run，`rooms.currentRunId` 指向它 | 单一写入口 `startRun`：先终止旧 run 再插入 | TC-RUN-07 |
| I-11 | `run.constraintsVersion` 固定为创建时的 cv；cv 递增时，若当前 run 仍非终态，必在同一事务内转为 `superseded`（执行引起的递增发生在 run 已转为 `executed` 之后） | `bumpConstraints` | TC-VER-02 |
| I-12 | 回合结果只有在持久化守卫成立时才写入提案、笔记与 run 进度 | `agentRuntime.completeTurn` | TC-RUN-01–04 |
| I-13 | `decisions` 只追加；"当前决定"为同一 (proposal, cv, seat) 的最新一行 | `decisions.decide` | TC-VER-05 |
| I-14 | 决定只在守卫成立时写入：席位角色 ∈ `proposal.requiredApproverRoleKeys`；提案是当前提案；`expectedConstraintsVersion === room.constraintsVersion === run.constraintsVersion`；`approve` 还要求当前求值通过 | `decisions.decide` | TC-VER-01/03/04 |
| I-15 | 每个 `(proposalId, cv)` 至多一个变更单；`operationKey` 唯一 | `decisions.decide` 内按 `by_operationKey` 查后写 + run 状态守卫 | TC-EXE-01/02 |
| I-16 | 每个变更单恰好一条承诺，任务按模板派生，三者同事务写入 | `executeInTx` helper（只被 `decide` 调用） | TC-EXE-04 |
| I-17 | 已承诺额不存储为计数器 | 无 `committedCents` 字段；只有派生函数 | 静态 schema 测试 |
| I-18 | 执行时 `committedCents + priceCents ≤ capCents` 在执行事务内用当前存储值重算 | `executeInTx` 调用 `evaluate` | TC-RULE-05、TC-EXE-05 |
| I-19 | `capCents ≥ committedCents` 始终成立 | finance 简报确认与 `budget.update` 守卫；I-18 保证执行后仍成立 | TC-RULE-09 |
| I-20 | 对他方可见的文本只由模板从公开载荷生成；模型文本不出现在任何公共文本中 | `renderEvent`、DTO 构造器 | TC-PRIV-02、TC-PRIV-07 |
| I-21 | `events` 只追加；载荷 schema 只含公开字段 | `appendEvent` helper；`eventPayloadV` 分类测试 | TC-PRIV-03 |
| I-22 | 代理上下文只由 `buildAgentContext` 构造，参数中的角色来自回合记录 | `agentRuntime.beginTurn` | TC-PRIV-04/05 |
| I-23 | 模型输出不提供金额、日期、条目键、身份或版本号 | 输出 schema（05）只含候选 ID 与枚举 | TC-INJ-05 |
| I-24 | 金额是 0 ≤ n ≤ 100_000_000 的安全整数美分 | `assertCents` 在所有金额入口 | TC-RULE-10 |
| I-25 | 日期是真实日历日 `YYYY-MM-DD`；"今天"按房间时区计算 | `parseIsoDate`、`todayIn(timeZone)` | TC-RULE-11 |
| I-26 | 由模拟输入派生的记录也是模拟的（提案、变更单继承 `isSimulated`） | `insertProposal`、`executeInTx` | TC-OPS-03 |
| I-27 | open 的取舍请求（`kind: "tradeoff"`）绑定 cv；cv 递增时全部转为 `cancelled`。披露请求与 cv 无关，直到回答或过期 | `bumpConstraints` | TC-RUN-08 |
| I-28 | 房间关闭后所有业务写入口拒绝（`ROOM_CLOSED`） | `requireCapability` 内检查 lifecycle | TC-AUTH-11 |
| I-29 | 代理 rationale 只写入 `agentNotes`，不进入任何 R 表或他方上下文 | `completeTurn`、`buildAgentContext` | TC-PRIV-07 |

## 2.9 生命周期之间的关系（摘要，详见 04）

```text
Room: setup ──(全部席位已绑定 + 全部简报与目录已确认)──> active ──(房主关闭)──> closed
   激活时：cv=1、写快照、startRun(trigger="initial")
Run（每个 cv 至多一个非终态）：running → awaiting_approval → executed
                                 ↘ needs_human ↗      ↘ failed → running(retry)
   cv 递增：当前 run → superseded；新 run 的起始状态由"当前提案是否仍通过"和"是否存在全局可行组合"决定（09）
Proposal：插入即不可变；状态全部派生
Decision：只追加；状态派生；cv 变化即 stale
HumanRequest：open → answered | cancelled | expired
```
