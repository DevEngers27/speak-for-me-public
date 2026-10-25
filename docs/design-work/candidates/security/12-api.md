# 12 后端函数目录（part1：约定、错误码、query）

> 本章分 2 个文件：part1（本文件）约定、错误码、全部 public query；part2 public mutation/action 与 internal 函数。

## 12.1 通用约定

1. 文件即模块：`convex/users.ts`、`rooms.ts`、`invites.ts`、`briefs.ts`、`catalog.ts`、`budget.ts`、`proposals.ts`、`decisions.ts`、`requests.ts`、`runs.ts`、`agents.ts`、`events.ts`、`results.ts`、`tasks.ts`、`health.ts`；内部：`agentRuntime.ts`、`admin.ts`；共享逻辑在 `convex/lib/*`（access、constraints、roleView、projections、log、validators）。
2. 每个 public 函数声明 `args` 与 `returns`；第一行是 `getViewer`/`getMember`（query）或 `requireViewer`/`requireMember`/`requireCapability`（mutation、action）。
3. 业务参数中没有 `userId`、`roleKey`、`participantId`（"我"由服务端推导）。涉及对象的参数只有 id，函数内校验该对象属于调用者所在房间。
4. query：未认证或无权 → `null`；mutation/action：抛 `ConvexError({ code, params? })`。
5. 所有返回值经 `convex/projections/*` 的 DTO 构造器（07 §7.15）。
6. 幂等性分三类：**天然幂等**（重复调用结果相同，如 `ensureMe`）；**守卫幂等**（重复调用被状态守卫拒绝或返回已有结果，如 `decide`、`accept`）；**非幂等但受限流**（每次调用产生新记录，如 `requestRenegotiation`）。
7. public 函数清单做快照测试（TC-AUTH-09）：新增或改名 public 函数必须同时更新快照，评审时检查其鉴权与投影。

## 12.2 错误码

| code | 含义 | params（只含调用者拥有的值） |
| --- | --- | --- |
| `UNAUTHENTICATED` | 无身份或无用户行 | — |
| `NOT_FOUND` | 对象不存在或调用者无权知道它存在 | — |
| `FORBIDDEN_ROLE` | 席位角色没有该能力 | — |
| `ROOM_NOT_ACTIVE` / `ROOM_CLOSED` | 生命周期不允许 | — |
| `INVALID_INPUT` | 校验失败 | `issues: { path, code }[]`（不含接收到的值） |
| `NO_CHANGES` | 确认内容与上一版本相同 | — |
| `STALE_DRAFT` | 草稿基于旧版本 | `latestVersion` |
| `STALE_VIEW` | 期望的 cv 或当前提案已变 | `constraintsVersion`（公开） |
| `PROPOSAL_BLOCKED` | 求值不通过 | `checks`：按调用者粗化（X5） |
| `ALREADY_EXECUTED` | 仅内部使用；`decide` 转为幂等成功返回 | — |
| `NOTHING_TO_WITHDRAW` | 没有可撤回的批准 | — |
| `CAP_BELOW_COMMITTED` | 新上限低于已承诺 | `committedCents`（仅 finance 能触发） |
| `INVITE_INVALID` | 令牌无效、过期、已用或已撤销（不区分） | — |
| `ALREADY_SEATED` | 调用者在该房间已有席位 | — |
| `SEAT_TAKEN` | 席位已被占用 | — |
| `REQUEST_CLOSED` | 请求已回答、取消或过期 | — |
| `RUN_NOT_RETRYABLE` | run 不是 failed 或已达人工重试上限 | — |
| `RATE_LIMITED` | 超出限额 | `retryAfter`（日期） |
| `AGENTS_DISABLED` | 总开关关闭 | — |
| `CREATION_NOT_ALLOWED` | 无建房资格 | — |
| `ILLEGAL_TRANSITION` | 程序缺陷 | — |

前端把 code 映射为固定文案（13）；文案模板里出现的数字只来自 params。

## 12.3 public query

| 函数 | 参数 | 返回 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `users.me` | — | `{ displayName, canCreateRooms } \| null` | 已认证 | 不返回 tokenIdentifier |
| `health.viewer` | — | `{ authenticated: boolean, tokenIdentifier?: string }` | 任意 | 只返回调用者本人的 tokenIdentifier（seed 绑定账号用）；`/setup` 诊断 |
| `rooms.listMine` | — | `RoomCardDTO[] \| null` | 已认证 | 按 `participants.by_user`；卡片含标题、生命周期、我的角色、`todoCount`，不含任何金额 |
| `rooms.view` | `{ roomId }` | `RoomViewDTO \| null` | 成员 | 工作台的唯一聚合 query（下见） |
| `invites.peek` | `{ token }` | `{ roomTitle, roleLabel, inviterDisplayName } \| null` | 已认证 | 无效即 null |
| `invites.listForRoom` | `{ roomId }` | `{ inviteId, roleKey, status, expiresAt }[] \| null` | 房主 | 不含令牌与哈希 |
| `briefs.myDraft` | `{ roomId }` | `BriefDraftDTO \| null` | 成员（本人） | 按 `viewer.participantId` 读，不接受目标 id |
| `briefs.myVersions` | `{ roomId }` | `BriefVersionDTO[] \| null` | 成员（本人） | 含 `changeReason`、披露 |
| `briefs.disclosurePreview` | `{ roomId }` | `{ audienceRoleKey, facts: SharedFactDTO[] }[] \| null` | 成员（本人） | "What others can see"：用 `computeSharedFacts` 对每个他方角色计算本人已确认版本的可见内容，与他方真实视图同源（RA-U08） |
| `proposals.list` | `{ roomId, paginationOpts }` | 分页 `ProposalDTO` | 成员 | 版本倒序；每项附按查看者粗化的当前求值与派生状态 |
| `proposals.get` | `{ proposalId, atConstraintsVersion? }` | `ProposalDetailDTO \| null` | 成员 | 历史 cv 下的求值从不可变快照重算（09 §9.7） |
| `decisions.history` | `{ roomId }` | `DecisionDTO[] \| null` | 成员 | 全部决定（含撤回、旧拒绝）与派生状态 |
| `requests.mine` | `{ roomId }` | `RequestDTO[] \| null` | 成员（目标人） | 只返回 `targetParticipantId = viewer` 的请求 |
| `agents.myNotes` | `{ roomId, paginationOpts }` | 分页 `AgentNoteDTO` | 成员（本人） | 本方代理的 rationale 与所选候选 |
| `events.list` | `{ roomId, paginationOpts }` | 分页 `RenderedEventDTO` | 成员 | 按 `commitTs` 倒序；服务端按查看者渲染（07 §7.14） |
| `results.view` | `{ roomId }` | `ResultsDTO \| null` | 成员 | 变更单、任务、预算影响（finance 全量；customer 仅当执行时 headroom 已披露；provider 无） |
| `budget.myLedger` | `{ roomId }` | `LedgerDTO \| null` | finance | 上限、基线与来源、每笔承诺及快照、当前余量 |

### `RoomViewDTO`

```ts
type RoomViewDTO = {
  room: { id: Id<"rooms">; title: string; goal: string; scenarioKey: string; lifecycle: Lifecycle;
          timeZone: string; constraintsVersion: number; isSimulated: boolean };
  me: { roleKey: string; roleLabel: string; isOwner: boolean; capabilities: Capability[] };
  seats: { roleKey: string; roleLabel: string; status: "open" | "occupied"; displayName?: string }[];
  briefStatuses: { roleKey: string; latestVersion?: number; confirmedAt?: number }[];   // RA-U09
  sharedFactsForMe: SharedFactDTO[];                    // X1
  catalog: CatalogDTO | null;
  run: { seq: number; status: RunStatus; round: number; maxRounds: number; trigger: string;
         turnProgress: { roleKey: string; kind: string; status: string }[];               // X3
         publicReason?: string; isSimulated: boolean } | null;
  currentProposal: ProposalDTO & { executionPreview: ExecutionPreviewDTO; diff: DiffDTO } | null;
  decisionStates: { roleKey: string; state: DecisionState; atConstraintsVersion?: number;
                    reasonCode?: string; note?: string }[];
  budgetPanel?: BudgetPanelDTO;                         // X2：finance 或已获 headroom 披露的 customer
  myOpenRequests: RequestDTO[];
  requestBadges: { targetRoleKey: string; kind: string }[];                               // X4
  todo: TodoDTO[];                                      // 确认简报、批准 vN、回答请求、重试 run……
  latestEvents: RenderedEventDTO[];                     // 最近 10 条
};
```

`ProposalDTO` 字段：`id`、`version`、`terms`（条目含标题）、`priceCents`、`termsKey`、`catalogVersion`、`author { kind, roleKey, mode }`、`derivedFromVersion`、`requiredApproverRoleKeys`、`status`（派生）、`evaluation`（X5 粗化）、`checkedAtConstraintsVersion`、`isSimulated`。不含 `runId` 之外的任何回合内部信息，不含代理理由。

`returns` 校验器中 `budgetPanel` 为 `v.optional`；构造器只在 finance 或获披露的 customer 时填充。
