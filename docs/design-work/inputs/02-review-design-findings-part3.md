# 02 审查设计发现 · part3：03 schema（一）逐表字段建议

> 分片清单见 part1。以下字段是审计员修正后的建议汇总（原为黑客松 v1 精简版），不是定稿；【改写】处给出无时间约束时的调整。字段名沿用审查原文，itemCodes 与 itemKeys 混用，设计时统一为一个名字。

### F03.1 rooms：删掉预算字段，加锚点
- 问题：`schema.ts:13` 的预算字段要移走；缺 currentRunId、currentProposalId、proposalVersion、goal（`schema.ts:10-14`）。
- 建议：`{ ownerId, title, goal, status: 'open'|'closed', constraintsVersion, proposalVersion, currentRunId?: Id<'runs'>, currentProposalId?: Id<'proposals'>, fixtureKey?: string }`。run 状态不放在 room 上（见 part4 的 04）。
- 来源：architecture-01/-05/-18/-23、security-03/-08、M9。

### F03.2 members 与 roomInvites
- members：`{ roomId, userId /* tokenIdentifier */, role, displayName, joinedAt }`，索引 by_room_role、by_room_user。删掉 `approvalRequired`，或只读、不提供修改入口（必需审批角色改为代码常量，见 08）。
- roomInvites：`{ roomId, role, code, createdBy, acceptedBy?, acceptedAt? }`，索引 by_code。原建议 code 用 `crypto.randomUUID()`、只在 owner 的查询里返回，tokenHash/expiresAt"有时间再加"；【改写】只存 tokenHash 和 expiresAt，明文只在创建时返回给 owner 一次。
- acceptInvite 在同一个 mutation 里检查：码未用、该角色在 by_room_role 下无人、该 userId 在本房间尚无成员，然后插 member 并标记已用。
- 来源：architecture-11、security-05、code-11、security-24（P15）。

### F03.3 budgets / budgetChanges / commitments
- budgets：`{ roomId, totalBudgetCents, updatedBy, updatedAt }`，by_room；不存 version 和 committed。
- budgetChanges：`{ roomId, oldTotalCents, newTotalCents, actor, reason, constraintsVersion, createdAt }`，仅 finance 可读；它替代原设想的 constraintRevisions 加两级事件。
- commitments：`{ roomId, kind: 'baseline'|'change_order', changeOrderId?, operationId?, amountCents, simulated?, createdAt }`，索引 by_room、by_operation；`proposalId` 改可选或删掉。committed 用 `getCommitted(ctx, roomId)`（`convex/lib/budget.ts`）按 by_room 汇总。
- 不做 supersedesCommitmentId/status（修订场景），见 17。
- 来源：architecture-01/-02/-23、security-04/-06（P8、P9）。

### F03.4 目录（offerItems / quoteOptions）
- `{ roomId, itemKey, title, priceCents, earliestDeliveryDate? | leadTimeDays?, taskTemplates, confirmedBy?, confirmedAt?, status: 'unconfirmed'|'confirmed', simulated }`，可选 `confirmedTerms: [{ termId, kind /* e.g. rush_fee */, deltaCents, condition }]`。itemKey 房间内唯一，靠先查后插保证。
- fixture 由 seed 直接写成已确认（confirmedBy = provider 账号），UI 显示 "Simulated quote"。
- 来源：security-01、architecture-09、security-20（P4）。

### F03.5 privateBriefs
- `{ roomId, userId, role, status: 'draft'|'confirmed', confirmedAt?, version /* 仅乐观并发 */, ...按角色结构化字段, shareableFacts: [{ field, value }] }`，索引 by_room_role。
- customer：`requiredItemKeys, deferrableItemKeys, deadline /* hard */, preferredDate? /* soft */`；provider：关联目录；finance：引用 budgets。
- 原建议"brief.version 与 constraintsVersion 只留一个"：要么删 brief 自己的计数，要么只用于乐观并发和展示，不参与审批绑定。
- 来源：architecture-21、security-08、security-16（M6）。

### F03.6 proposals
- `{ roomId, runId, turnId, version, baseProposalVersion, itemKeys, deferredItemKeys, termIds?, amountCents /* 服务端求和 */, deliveryDate, sourceRefs /* 由 itemKeys 推出 */, requiredApproverRoles /* 快照 */, constraintsVersion, status: 'active'|'superseded'|'executed', validation: { checkedAtConstraintsVersion, reasonCodes[] }, publicSummary /* 模板 */, actorType, createdAt }`。
- validation 只是写入时快照，用于时间线和审计；执行永远重算。不要存 'valid'|'invalid'，它与实时计算重复且会过时。
- 若采用轻量版人工取舍（见 05）：加 `optionGroupId?`，status 增加 'option'。
- security-03 曾建议 status 含 'blocked'；architecture-17 认为阻断应实时派生。建议以派生为准，不存 blocked。
- 来源：architecture-04/-17、security-03、M9、P19。

### F03.7 approvals
- `{ roomId, proposalId, userId, role /* 从 members 读 */, decision: 'approve'|'reject', reason?, constraintsVersion, decidedAt, kind?: 'terms'|'budget' }`，索引 by_proposal_user [proposalId, userId]、by_room。
- 写入：先用 `.unique()` 查，再 patch 或 insert；撤回 = 改为 reject。architecture-04 认为 role 可由 members 推出、属于冗余，security-03 建议冗余存储；整理者建议保留快照，便于审计。
- termsHash 不需要：proposals 只插入不修改，approval 绑定 proposalId 就证明"批准的就是这份条款"。若要可读证据，存规范化字符串 termsKey（如 `${keys.sort().join(",")}|${cents}|${date}`），避开 Convex 运行时 `crypto.subtle` 的不确定性。
- 来源：architecture-04、security-03、product-21（P9、L7）。

### F03.8 changeOrders 与 tasks
- changeOrders：`{ roomId, runId, proposalId, proposalVersion, constraintsVersion, operationId, approvedItemKeys[], deferredItemKeys[], amountCents, deliveryDate, summary /* 模板 */, createdAt }`，索引 by_room、by_operation。approvalIds[] 不存（按 proposalId 可查）。
- tasks：`{ roomId, changeOrderId, itemKey, title, assigneeRole: 'provider', operationId, createdAt }`，由 approvedItemKeys 和 taskTemplates 确定性派生。
- 来源：architecture-10、security-04、code-07（P9）。

### F03.9 runs 与 agentTurns
- runs：`{ roomId, status /* 与 state.ts 共用联合类型 */, trigger: 'initial'|'budget_change'|'human_answer', constraintsVersionAtStart, round, maxRounds, nextTurnSeq, callCount, endedReason?, startedBy, createdAt }`，by_room。callCount 用于每房间调用上限（security-12 建议计数放在这张表里）。
- agentTurns：`{ roomId, runId, turnSeq, role, attempt, status: 'running'|'succeeded'|'invalid_output'|'failed'|'stale', baseProposalVersion, constraintsVersion, output? /* 校验后的模型输出，含私有 rationale */, resultProposalId?, model, inputTokens?, outputTokens?, thinkingTokens?, cacheReadTokens?, requestId?, latencyMs?, errorCode?, startedAt, finishedAt? }`，索引 by_run_seq [runId, turnSeq]。
- 删掉 leaseToken/leaseExpiresAt：scheduled action 至多执行一次，不存在两个 worker 抢同一回合，(runId, turnSeq) 守卫足够。promptHash、costEstimateMicros 不存（成本按 token 离线换算）。
- 来源：architecture-05/-06/-13、security-08/-12/-17、P13 第 6 点、P14。

### F03.10 humanRequests
- `{ roomId, runId, targetRole, kind: 'tradeoff'|'clarify', question /* 模板 */, options: [{ key, label, impact: { deltaCents?, deferItemKeys? } }], status: 'open'|'answered'|'cancelled', answerKey?, answeredBy?, answeredAt?, constraintsVersion }`，索引 by_room_status。去掉 kind 'confirm_estimate'。
- 来源：architecture-12（P19）。

### F03.11 events
- `{ roomId, action, summary /* 模板 */ | reasonCode, runId?, proposalId?, proposalVersion?, constraintsVersion, actorType: 'user'|'agent'|'system', actorRole?, createdAt }`。
- action 用字面量联合：room_created、member_joined、brief_confirmed、run_started、proposal_created、turn_failed、turn_rejected_stale、constraints_changed、approval_recorded、approval_invalidated、request_opened、request_answered、executed。
- proposalVersion 改可选（原 `schema.ts:41-46` 必填）。读取用 `.order('desc').take(100)`。
- visibility/visibleToUserId 的去留是开放决定：多数来源主张删掉、events 全房间可见、角色私密细节放 budgetChanges/agentTurns/humanRequests；红队指出 architecture-02/-20 与 docs-03 口径不同（见 18）。
- 来源：architecture-20、security-11、docs-15、M9。
