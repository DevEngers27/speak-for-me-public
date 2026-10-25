# 12 后端函数目录

通用约定：公共函数以 `getViewer/requireSeat` 开头，不接受 `userId`/`role`；query 未认证或非成员返回 `null`；mutation 错误只用 `ConvexError({code})`；全部声明 `args` 与 `returns` validator。共 **4 个 query、8 个 mutation**（公共）+ 7 个 internal。

## 1. 公共 query

| 函数 | 参数 | 返回 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `health.viewer` | — | `{ tokenIdentifier, issuer } \| null` | 登录即可 | /setup 诊断；seed 时取账号 ID |
| `rooms.listMine` | — | `Array<{ roomId, title, role, phase, simulated }> \| null` | 登录 | `seats.by_user` → rooms |
| `rooms.view` | `{ roomId }` | `RoomView \| null`（下） | 席位 | 一次返回同一快照的全部当前状态，按查看者投影 |
| `rooms.timeline` | `{ roomId }` | `Array<TimelineItem> \| null` | 席位 | 07 §8 派生时间线，`take(200)` |

```ts
type RoomView = {
  room: { id, title, goal, scenarioKey, timeZone, constraintsVersion, simulated, phase };
  me: { role, seatId, isCreator, approvalLabel };
  seats: Array<{ role, displayName?, state: "invited" | "claimed" | "expired" }>;
  invites?: Array<{ role, expiresAt }>;                       // 仅创建者；不含令牌
  myBrief?: { version, content, disclosed, notes, reason?, constraintsVersion };
  others: Array<{ role, version?, confirmedAt?, changeCode?, disclosedFields: Record<string, unknown> }>;
  catalog: Array<{ itemKey, title, priceCents, earliestDeliveryDate }>;   // public_on_confirm
  run?: { id, seq, status, round, maxRounds, trigger,
          activeTurn?: { role, attempt, status }, waitingOn: string[] };
  currentProposal?: ProposalView;
  proposals: ProposalView[];                                   // 本房间全部，按 version desc，take(50)
  approvals: Array<{ role, decision, reasonCode?, at, validity: "valid" | "invalidated", proposalVersion }>;
  myRequests: Array<{ id, kind, questionText, clarifyText?, options: Array<{ key, label }> }>;
  myTurns: Array<{ id, round, attempt, status, action?, rationale?, errorCode?, simulated }>; // 仅本角色
  changeOrders: Array<{ id, proposalVersion, itemKeys, deferredItemKeys, amountCents, deliveryDate,
                        commitment?: { committedBeforeCents, committedAfterCents, totalBudgetCents }, simulated }>;
  tasks: Array<{ id, changeOrderId, title, dueDate, assigneeRole, done: boolean }>;
  budget?: { totalBudgetCents, committedCents, headroomCents };   // 仅 finance / 已获披露的 customer
  pendingInvalidation: { approvals: number };                  // 确认简报前的提示用
};
type ProposalView = { id, version, isCounter, authorKind, itemKeys, deferredItemKeys, lines, amountCents,
  deliveryDate, constraintsVersion, status: "current" | "superseded" | "executed", executable: boolean,
  reasonCodes: string[], publicText: string,
  buyer?: { committedAfterCents, totalBudgetCents, shortfallCents } };   // 仅买方可见时
```
`rooms.view` 的读量上界：每表按 roomId 索引 `take(N)`（proposals 50、approvals 200、turns 本角色 50、changeOrders 20、tasks 100），首个场景远低于上界。

## 2. 公共 mutation

| 函数 | 参数 | 返回 | 鉴权 | 幂等 / 并发 | 读 → 写 |
| --- | --- | --- | --- | --- | --- |
| `rooms.create` | `{ scenarioKey, title, goal, myRole, timeZone, displayName }` | `{ roomId, invites: Array<{ role, token, expiresAt }> }` | 登录；`ALLOWED_CREATORS` 名单（环境变量，空 = 任何登录用户） | 非幂等（每次一个新房间）；令牌明文只此一次 | → rooms、seats×3 |
| `seats.claim` | `{ token, displayName }` | `{ roomId, role }` | 登录 | 已是该席位 → 返回同值；席位已被他人认领 → `INVITE_USED` | seats.by_inviteHash、by_room_user → seats |
| `seats.reissueInvite` | `{ roomId, role }` | `{ token, expiresAt }` | 创建者 | 每次生成新令牌，旧令牌失效 | seats → seats |
| `briefs.confirm` | `{ roomId, content, disclosed, notes, reason?, changeCode?, expectedVersion }` | `{ version, constraintsVersion }` | 本席位 | `expectedVersion` 乐观并发；重复提交 → `VERSION_CONFLICT` | 09 §2 → briefs、rooms、runs、agentTurns、humanRequests；调度 |
| `runs.start` | `{ roomId }` | `{ runId }` | 席位 | 仅 R13（当前 run executed）；有活动 run → 返回它 | → runs、rooms；调度 |
| `runs.retryTurn` | `{ roomId }` | `{ turnId }` | 席位 | 仅当前 run failed；重复点击：第二次看到 negotiating → 返回在途 turnId | → agentTurns、runs；调度 |
| `approvals.decide` | `{ proposalId, decision, reasonCode? }` | `DecideResult`（08 §7） | 必需审批角色 | 08 §3 | → approvals、changeOrders、tasks、runs；可能调度 |
| `requests.answer` | `{ requestId, optionKey }` | `{ effect, runId? }` | targetRole | 已回答 → `ALREADY_ANSWERED`；请求已作废 → `REQUEST_VOID` | → humanRequests；按 effect：briefs/rooms/runs 或 runs |
| `tasks.setDone` | `{ taskId, done }` | `null` | assigneeRole | 天然幂等 | → tasks |

## 3. internal 函数

| 函数 | 类型 | 参数 | 职责 |
| --- | --- | --- | --- |
| `agents.runTurn` | internalAction | `{ turnId }` | 10 §2；只调用 getTurnContext 一次、提交 mutation 一次 |
| `agents.getTurnContext` | internalQuery | `{ turnId }` | 07 §6 白名单上下文；turn 非 running 返回 null |
| `agents.completeTurn` | internalMutation | `{ turnId, output, meta }` | GT + 推进 |
| `agents.failTurn` | internalMutation | `{ turnId, code, meta? }` | GT + 重试/failed |
| `agents.turnWatchdog` | internalMutation | `{ turnId }` | 超时判失败 |
| `seed.scopeChangeRoom` | internalMutation | `{ variant, creatorTokenIdentifier?, today? }` | 15 §2；返回 roomId 与邀请令牌 |
| `ops.usageSummary` | internalQuery | `{ sinceMs }` | 调用数、失败数、stale 数、p50/p95 延迟、token、估算成本、人工请求数 |

## 4. 共享 helper（非函数，`convex/engine/*.ts`）

`getViewer`、`requireSeat`、`requireRole`、`applyBriefVersion`、`startRun`、`scheduleTurn`、`buildRequests`（调用场景）、`assertRunTransition`、`loadConstraints(room)`、`projectFor(viewerRole)`、`renderPublic`、`assertCents`、`assertIsoDate`、`todayIn`。

## 5. 错误码（客户端可见，全部无数字）

`UNAUTHENTICATED`、`NOT_A_MEMBER`、`NOT_CREATOR`、`INVITE_INVALID`、`INVITE_USED`、`INVITE_EXPIRED`、`ALREADY_SEATED`、`VERSION_CONFLICT`、`INVALID_BRIEF`（附首个 reasonCode）、`BUDGET_BELOW_COMMITTED`、`RUN_ACTIVE`、`RUN_LIMIT`、`AGENTS_DISABLED`、`NOT_AN_APPROVER`、`STALE_PROPOSAL`、`NOT_EXECUTABLE`、`INVALID_REASON`、`ALREADY_ANSWERED`、`REQUEST_VOID`、`ILLEGAL_TRANSITION`、`NOT_ASSIGNEE`。

## 6. 模块归属

| 文件 | 函数 |
| --- | --- |
| `convex/health.ts` | health.viewer |
| `convex/rooms.ts` | rooms.listMine / view / timeline / create |
| `convex/seats.ts` | seats.claim / reissueInvite |
| `convex/briefs.ts` | briefs.confirm |
| `convex/runs.ts` | runs.start / retryTurn |
| `convex/approvals.ts` | approvals.decide |
| `convex/requests.ts` | requests.answer |
| `convex/tasks.ts` | tasks.setDone |
| `convex/agents.ts` | 全部 agents.* |
| `convex/seed.ts`、`convex/ops.ts` | seed.*、ops.* |
