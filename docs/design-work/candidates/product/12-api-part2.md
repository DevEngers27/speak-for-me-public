# 12 后端函数目录（part2）：提案、签核、请求、协商、历史、记录、健康、internal 与 ops

## 12.8 proposals（`convex/proposals.ts`）

```ts
history = query({ args: { roomId: v.id("rooms") }, returns: v.union(v.null(), v.array(proposalRowDTO)) });
get = query({ args: { proposalId: v.id("proposals") }, returns: v.union(v.null(), proposalCardDTO) });
compare = query({ args: { a: v.id("proposals"), b: v.id("proposals") }, returns: v.union(v.null(), diffDTO) });
candidates = query({ args: { roomId: v.id("rooms") }, returns: v.union(v.null(), v.array(candidateDTO)) });
  // 需 proposal.author；作用域视图下的候选（≤ 40），每个带已知检查与 unknownCheckIds
proposeCandidate = mutation({
  args: { roomId: v.id("rooms"), candidateKey: v.string(), expectedConstraintsVersion: v.number(),
          alsoApprove: v.boolean() },
  returns: v.object({ proposalId: v.id("proposals"), version: v.number(),
    status: v.union(v.literal("proposed"), v.literal("recorded"), v.literal("executed")),
    executionId: v.optional(v.id("executions")) }) });
  // 需 proposal.author；候选不在本人作用域 → CANDIDATE_UNKNOWN；未通过检查 → CANDIDATE_BLOCKED（按本人投影的原因码）；
  // 有 active run → 先 finishRun(cancelled)；与当前提案候选相同 → 返回当前提案（幂等）
```

`proposalCardDTO = { proposalId, version, author: {kind, roleKey, agentMode?}, candidateKey, termsSummary, termsLines, terms, checks: ProjectedCheck[], executable, diffFromPrevious?: string[], signoffs: [{seatId, roleKey, kind, state, decidedAt?}], myDecision?: {kind, reasonCode?, note?}, recordsPreview: {agreementNumberHint, commitmentCents, tasks: [{title, assigneeRoleKey, dueDate}], buyerLedgerAfterCents?}, constraintsVersion /* 当前 */, termsKey, status }`。

## 12.9 decisions（`convex/decisions.ts`）

```ts
record = mutation({
  args: { proposalId: v.id("proposals"),
          kind: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
          expectedConstraintsVersion: v.number(), expectedTermsKey: v.string(),
          reasonCode: v.optional(v.string()), note: v.optional(v.string()) },
  returns: v.object({
    status: v.union(v.literal("recorded"), v.literal("already_recorded"), v.literal("executed")),
    executionId: v.optional(v.id("executions")) }) });
```

守卫顺序与幂等见 04 第 4.6 节；执行事务见 08 第 8.7 节。reject 调度 `internal.negotiation.afterRejection`。

## 12.10 requests（`convex/requests.ts`）

```ts
answer = mutation({
  args: { requestId: v.id("humanRequests"), optionKey: v.string(),
          alsoApprove: v.optional(v.boolean()),            // choose_candidate 时
          changeReason: v.optional(v.string()),            // patch_brief 时（私密）
          publicReasonCode: v.optional(v.string()) },
  returns: v.object({ status: v.union(v.literal("answered"), v.literal("declined")),
    proposalId: v.optional(v.id("proposals")), constraintsVersion: v.optional(v.number()),
    executionId: v.optional(v.id("executions")) }) });
  // 目标席位；G-REQ；按意图：patch_brief → appendBriefVersion(+bump)；choose_candidate → insertProposal(+approve)；
  // share_fields → 新简报版本（只改披露）+ startRun(request_answered)；edit_list → 返回 {status:"answered"} 前要求清单已确认（通常由 lists.confirm 自动关闭，不经此函数）；decline → declined
decline = mutation({ args: { requestId: v.id("humanRequests") }, returns: v.null() });   // 目标；已关闭 → REQUEST_CLOSED
```

## 12.11 negotiation（`convex/negotiation.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `requestRun` | mutation | `{roomId}` | `{outcome: "run_started" \| "requests_opened" \| "already_running" \| "nothing_to_do", runId?}` | 成员；限频 | 置 `negotiationOpen = true`；预检无解则开取舍请求，不调模型 |
| `retryRun` | mutation | `{roomId, runId}` | `null` | 成员；限频 | run 非 stalled → 无操作 |
| `cancelRun` | mutation | `{roomId, runId}` | `null` | 成员；限频 | 已结束 → 无操作 |
| `afterConstraintChange` | internalMutation | `{roomId, constraintsVersion}` | `null` | 内部 | 09 第 9.5 节 |
| `afterRejection` | internalMutation | `{roomId, proposalId, constraintsVersion}` | `null` | 内部 | 04 第 4.6 节 |

## 12.12 history（`convex/history.ts`）

| 函数 | args | returns | 鉴权 |
| --- | --- | --- | --- |
| `timeline` | `{roomId, paginationOpts, constraintsVersion?, proposalId?}` | 分页 `renderedEventDTO = {eventId, at, actorLabel, text, kind, refs, isSimulated}`（服务端过滤受众后渲染） | 成员 |
| `constraints` | `{roomId}` | `[{version, at, cause, causeRoleKey?, publicReasonCode?, changedFieldLabels /* 只含对我可见的字段 */, myValueChanges? /* 本人字段的前后值 */}]` | 成员 |
| `myAgentNotes` | `{roomId, runId?}` | `[{runNumber, round, kind, attempt, status, action?, rationale?, blocked?, errorCode?, usage?, latencyMs?, at}]` | 本席位 |

## 12.13 records（`convex/records.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `view` | query | `{roomId}` | `{executions: [{executionId, number, termsSummary, terms, executedAt, decisions: [{roleKey, kind, at}], sourceRefs, buyerImpact?: {beforeCents, afterCents, capCents}}], tasks: [{taskId, title, assigneeRoleKey, dueDate, status, canUpdate}]}` | 成员（投影） | — |
| `updateTask` | mutation | `{taskId, status}` | `null` | 被指派席位 | 状态相同 → 无操作 |

## 12.14 health（`convex/health.ts`）

| 函数 | args | returns | 鉴权 |
| --- | --- | --- | --- |
| `viewer` | `{}` | `null \| {tokenIdentifier}` | 已登录（便于运维把账号绑定到 seed 房间） |
| `config` | `{}` | `null \| {clerkIssuerConfigured, anthropicKeyConfigured, agentMode, agentsEnabled, negotiationModel, modelVerifiedAt?}` | `ADMIN_TOKEN_IDENTIFIERS`；只报"已配置/可用"，从不返回值 |

## 12.15 internal 函数（不暴露给客户端）

| 函数 | 类型 | 作用 |
| --- | --- | --- |
| `runtime.turnInput.getTurnInput({turnId})` | internalQuery | 唯一上下文组装入口；回合非 running 返回 null（07 第 7.7 节） |
| `runtime.agents.runTurn({turnId})` | internalAction | 调用模型或 stub，提交结果（10 第 10.3 节） |
| `runtime.turns.completeTurn({turnId, raw, latencyMs})` | internalMutation | G-PERSIST → 四步校验 → 选择/决议 → 推进 run |
| `runtime.turns.failTurn({turnId, error, latencyMs})` | internalMutation | 分类、重试或 stalled |
| `runtime.turns.turnWatchdog({turnId})` | internalMutation | 超时判定 |
| `briefs._applySuggestions({seatId, suggestions})` | internalMutation | 抽取结果写入草稿 |
| `invites._store` / `_lookup` / `_accept` | internal | 见 12.4 |

非 Convex 函数的 helper（普通 TS，在 mutation 内调用）：`bumpConstraints`、`appendBriefVersion`、`insertProposal`、`executeIfComplete`、`appendCommitment`、`startRun`、`finishRun`、`scheduleTurn`、`reserveCall`、`openTradeoffRequests`、`openAgentRequests`、`closeOpenRequests`、`appendEvent`、`buildRuleView`。

## 12.16 ops（只经 CLI `npx convex run`，生产加 `--prod`）

| 函数 | 类型 | 作用 |
| --- | --- | --- |
| `ops.seed.createDemoRoom({fixtureKey, seatTokenIdentifiers?, inviteForOpenSeats?})` | internalAction | 以 fixture 步骤经引擎写入路径建模拟房间；给出账号则直接入座，否则为空席位生成邀请链接；返回 `{roomId, inviteUrls?}` |
| `ops.seed.applyVariant({roomId, variant})` | internalMutation | 执行 14 第 14.11 节的变体操作（以 fixture 中对应席位身份，经同一校验路径） |
| `ops.maintenance.refreshDayStamps` / `sweepStuckTurns` / `sweepOrphanRuns` | internalMutation（cron） | 10 第 10.9 节 |
| `ops.maintenance.upgradeScenario({scenarioKey})` | internalMutation | 03 第 3.24 节 |
| `ops.maintenance.purgeSimulatedRoom({roomId})` | internalMutation | 仅开发部署且 `isSimulated`；按房间删除全部子记录 |
| `ops.maintenance.replayRuleView({roomId, version})` | internalQuery | 09 第 9.9 节 |
| `ops.metrics.summary({sinceMs})` | internalQuery | 10 第 10.11 节 |
