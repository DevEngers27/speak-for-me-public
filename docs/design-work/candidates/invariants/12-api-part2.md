# 12 后端函数目录 · part2：公共 action、internal 函数、cron、错误码、工作台 DTO

## 4. 公共 action（只在需要真随机数、哈希或模型时使用）

| 函数 | args | returns | 鉴权 | 内部调用 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `invites.create` | `{ roomId, roleKey }` | `{ url, expiresAt }` | 房主（action 内经 `internal.auth.viewerParticipant` 校验） | `crypto.getRandomValues` 生成 32 字节 token → SHA-256 → `internal.invites.insertHashed` | 明文只在返回值中出现一次；同角色旧 open 邀请被撤销 |
| `invites.accept` | `{ token }` | `{ roomId, roleKey }` | 登录 | 哈希 → `internal.invites.acceptByHash({ tokenHash, tokenIdentifier })` | ID-3/4/6 的检查全部在这一个 internal mutation 中完成；若 mutation 内 `crypto.subtle` 可用（待验证），可简化为公共 mutation |
| `briefs.extractDraft` | `{ roomId, text }`（≤ 20,000 字符） | `{ draft, issues }` | 本人 | `internal.briefs.extractionContext` → `internal.usage.reserveCall`（RN-5）→ Claude → `internal.briefs.storeExtracted` + `internal.usage.recordCall` | 原文不落库；结果只进草稿（10 §11） |

action 由客户端直接调用时，断线会使在途调用失败且不重发（inputs/04 §1.11）；三者都没有"半完成"的业务副作用，界面提供重试即可。

## 5. internal 函数

| 函数 | 类型 | 调用者 | 职责 |
| --- | --- | --- | --- |
| `internal.auth.viewerParticipant` | query | 公共 action | 从传入的 tokenIdentifier 解析 user 与 participant |
| `internal.invites.insertHashed` / `acceptByHash` | mutation | `invites.create` / `accept` | 04 part2 §6 |
| `internal.agents.context.build` | query | `executeTurn` | 07 §7；回合不在 running 时返回 null |
| `internal.agents.executeTurn` | action | 调度器 | 10 part2 §8 |
| `internal.agents.commit.completeTurn` | mutation | `executeTurn` | 活性守卫、记用量、L3 校验、分派、`settleStep` |
| `internal.agents.commit.failTurn` | mutation | `executeTurn` | 活性守卫、记用量、重试或 run → failed |
| `internal.agents.commit.turnWatchdog` | mutation | 调度器 | 到期仍 running → TIMEOUT 处理 |
| `internal.briefs.extractionContext` / `storeExtracted` | query / mutation | `extractDraft` | — |
| `internal.usage.reserveCall` / `recordCall` | mutation | 抽取 | 调用预算计数与 modelCalls 写入 |
| `internal.ops.seedScopeChange` | mutation | CLI（`npx convex run`） | `{ variant, D?, ownerTokenIdentifier, memberTokenIdentifiers? }`；创建房间（isSimulated、fixtureKey）、参与方、经 `commitBriefVersion` 写三份确认简报；返回 roomId 与未入座角色的邀请提示（15 §2） |
| `internal.ops.purgeSimulatedRoom` | mutation | CLI | 仅 `DEPLOYMENT_KIND ≠ prod` 且 `room.isSimulated`；按 by_roomId 级联删除；这是系统唯一的删除路径 |
| `internal.ops.auditRoom` | query | cron、测试 | 复核 CS-1、CS-4、EX-1、EX-4、EV-1、RN-1、PR-2、BR-1、HR-4，返回违规列表 |
| `internal.ops.auditRooms` | action | cron（每日） | 分页遍历 open 房间调用 auditRoom；有违规写运维告警日志（不含业务数值） |
| `internal.ops.auditUsers` | query | cron | 检查 tokenIdentifier 重复（03 §21 的残余风险） |
| `internal.ops.setRoomCallBudget` | mutation | CLI | 调整 `modelCallBudget`，写事件 |
| `internal.ops.liveTurns` | query | 部署前检查 | 列出 running 回合（15 §5） |
| `internal.ops.metrics` | query | 运维面板 | 15 §3 的指标聚合 |
| `internal.ops.checkModelAccess` | action | 部署后 | `models.retrieve` 核对白名单模型可用 |

`convex/crons.ts`：`crons.daily("audit rooms", { hourUTC: 9, minuteUTC: 0 }, internal.ops.auditRooms)`（`cronJobs` 由 `convex/server` 导出；具体调度 API 以 Convex 文档为准）。

## 6. 错误码目录（`ConvexError({ code, reasonCodes?, params? })`）

| 类别 | 码 |
| --- | --- |
| 身份与成员 | `UNAUTHENTICATED`、`NOT_FOUND`、`NOT_A_PARTICIPANT`、`NOT_ROOM_OWNER`、`FORBIDDEN_ROLE`、`ROOM_CLOSED` |
| 建房与邀请 | `CREATION_NOT_ALLOWED`、`ROOM_LIMIT_REACHED`、`INVALID_TIMEZONE`、`INVITE_INVALID`、`INVITE_EXPIRED`、`ROLE_TAKEN`、`ALREADY_A_PARTICIPANT` |
| 简报 | `BRIEF_VERSION_CONFLICT`、`INVALID_BRIEF`（issues 只含本人字段路径）、`BUDGET_BELOW_COMMITTED` |
| 运行 | `ROOM_NOT_READY`、`RUN_COOLDOWN`、`NO_ACTIVE_RUN`、`AGENTS_DISABLED`、`CALL_BUDGET_EXHAUSTED` |
| 审批 | `PROPOSAL_NOT_CURRENT`（params：当前提案版本）、`NOT_REQUIRED_APPROVER`、`NOT_EXECUTABLE`（reasonCodes 按调用者投影）、`NOTHING_TO_WITHDRAW`、`INVALID_REASON` |
| 请求 | `NOT_REQUEST_TARGET`、`REQUEST_NOT_OPEN`、`REQUEST_STALE`、`OPTION_NOT_ANSWERABLE`、`OPTION_NO_LONGER_FEASIBLE` |
| 任务 | `NOT_TASK_ASSIGNEE`、`INVALID_TRANSITION` |
| 内部 | `INVARIANT_VIOLATION`（只记码与不变量 id，不带数值；触发告警） |

客户端把码映射为模板文本；任何 params 都已按调用者可见性过滤（06 §7）。

## 7. `WorkspaceDTO`（`rooms.workspace` 的返回形状；validator 在 `convex/engine/projection/dto.ts`）

```ts
type WorkspaceDTO = {
  room: { id; title; goal; timeZone; status; phase; constraintsVersion; scenarioKey; isSimulated };
  me: { participantId; roleKey; isOwner; approvalKind };
  participants: { roleKey; displayName; joined: boolean;
                  brief: { versionNo?; confirmedAt?; lastChangeCategories: string[] } }[];
  sharedFacts: { ownerRole; field; value: string | number | string[] }[];         // 只含对我披露的
  run?: { runNo; status; trigger; round; maxRounds; step; agentMode; endedReason?;
          turns: { roleKey; status; attempt; errorCategory? }[] };
  currentProposal?: ProposalDTO & {
    executable: boolean; checks: CheckDTO[];                                        // 参数按派生闭包过滤
    approvals: { roleKey; approvalKind; state: ApprovalState; decidedAtVersion? }[];
    executionPreview: { recordKind; amountCents; tasks: { title; dueDate; assigneeRoleKey }[];
                        budgetImpact?: { committedBeforeCents; committedAfterCents; capCents } };
    myActions: { canApprove; canReject; canWithdraw; disabledReason?: string };    // 禁用原因写在按钮旁
  };
  proposals: (ProposalDTO & { display: ProposalState; sameTermsAs?: number; blockedNow?: CheckDTO[] })[];
  myTodos: { kind: "confirm_brief" | "approve" | "reapprove" | "answer_request" | "retry_run" | "start_run"; ref? }[];
  myRequests: RequestDTO[];
  waitingOn: { roleKey; kind }[];
  executions: { number; proposalVersion; amountCents; executedAt; isSimulated;
                budgetImpact?: { committedBeforeCents; committedAfterCents; capCents } }[];
  usage: { calls; budget; estimatedCostUsd };
};
type ProposalDTO = { id; version; constraintsVersion; author: { kind; roleKey; simulated: boolean };
  lines: { itemKey; variantKey; label; priceCents }[]; includedItemKeys; deferredItemKeys;
  amountCents; deliveryDate; isSimulated; createdAt };
```
- `budgetImpact` 字段是 `v.optional`，只在 finance 或已获得披露的查看者的投影中出现；provider 的 DTO 中这个键不存在（不是 null，是不存在）。
- 同一 DTO 被 `buildAgentContext` 的同一批投影函数复用（RN-6）。
- 体量：v1 的房间规模下（≤ 几十个提案与事件）一次聚合查询足够；事件另走分页查询，不进 DTO。
