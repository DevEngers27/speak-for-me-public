# 专题深潜：披露矩阵与代理上下文组装（part2）

> 接 part1 第 5.1 节。记号同前：● 可见；○ 不可见；◐ 有条件；own 房主；sys 仅服务端。

## 5. 字段×角色披露矩阵（下）

### 5.2 私密简报与共享事实

| 表.字段 | cus | pro | fin | 类 | 备注 |
| --- | --- | --- | --- | --- | --- |
| privateBriefs / briefVersions 全部结构化字段（customer：requiredItemKeys、deferrableItemKeys、deadline、preferredDate；provider：目录关联、notes；finance：notes） | 本人 | 本人 | 本人 | self | 同侧也不共享（PD-5）；只由 `briefs.mine` 返回 |
| briefVersions.notes（委托人写给自己代理的自由文本） | 本人 | 本人 | 本人 | self | 进本方代理上下文的 principal 段；绝不进他方上下文 |
| privateBriefs.status、confirmedVersion、confirmedAt | ● | ● | ● | room | X6；他方只看到 `confirmed | not_confirmed`，draft 与 missing 的区别仅本人可见 |
| sharedFacts.{ownerRole, field, value, sharedAt, briefVersionId} | ● | ● | ● | room | 显式逐项披露；值是日期 / itemKey[] / 枚举 |
| 原始粘贴文本、抽取草稿 | — | — | — | — | 不入库（F02.8）；抽取结果只作为本人 mutation 的返回值 |

首个场景的共享词表（场景插件声明，`SHAREABLE_FIELDS`）：customer：`deadline`、`requiredItemKeys`、`deferrableItemKeys`、`preferredDate`；provider：`earliestStartDate`；finance：v1 为空（PD-12）。

### 5.3 目录、提案、审批

| 表.字段 | cus | pro | fin | 类 | 备注 |
| --- | --- | --- | --- | --- | --- |
| offerItems（status = draft）全部字段 | ○ | ● | ○ | self(provider) | |
| offerItems（confirmed）.itemKey、title、priceCents、earliestDeliveryDate、simulated、confirmedAt | ● | ● | ● | room | PD-4；title 是 provider 自由文本：长度 ≤ 80、单行，进他方代理上下文时放不可信数据块 |
| offerItems.taskTemplates | ● | ● | ● | room | 审批前预览将生成的任务（RA-B19） |
| offerItems.confirmedByUserId | ○ | ○ | ○ | sys | DTO 只给"Confirmed by provider" |
| proposals.version、authorKind、authorRole、itemKeys、deferredItemKeys、amountCents、deliveryDate、requiredApproverRoles、constraintsVersion、status、createdAt | ● | ● | ● | room | amountCents = 已公开目录价求和，不泄露预算 |
| proposals 的公开摘要 | ● | ● | ● | room | 不存字符串，读取时由模板 `proposal.summary` 渲染 |
| proposals.validation.reasonCodes（写入时快照） | ● | ● | ● | room | X2 |
| 派生 `executable`、`blockedReasonCodes` | ● | ● | ● | room | X1、X2，读取时实时计算 |
| 派生 `budgetDetail {totalCents, committedCents, afterApprovalCents, headroomCents, overByCents}` | ● | ○ | ● | roles:buyer | provider 窗口只显示 "+$900 · Blocked: exceeds the finance limit"（F07.1 文案陷阱） |
| 派生 `constraintDetail.missingItemKeys`、`deadline` | ◐ | ◐ | ◐ | self(customer)，若已共享则 room | 未共享时他方只见代码 `missing_required_item` / `date_after_deadline` |
| proposals.turnId、runId | ● | ● | ● | room | 指向的回合内容按 5.5 节控制 |
| approvals.role、decision、decidedAt、constraintsVersion、reasonCode（拒绝枚举） | ● | ● | ● | room | 派生 `isCurrent`（失效显示为 invalidated） |
| approvals.note（人写的拒绝说明） | ◐ | ◐ | ◐ | self；`noteShared = true` 时 room | 人自己的显式披露；**无论是否共享都不进任何代理上下文**（注入面） |
| approvals.userId | ○ | ○ | ○ | sys | DTO 给 `memberId` |

### 5.4 预算与执行记录

| 表.字段 | cus | pro | fin | 类 | 备注 |
| --- | --- | --- | --- | --- | --- |
| budgets.totalBudgetCents、updatedAt | ● | ○ | ● | roles:buyer | PD-2 |
| 派生 committedCents（commitments 汇总）、headroomCents | ● | ○ | ● | roles:buyer | |
| budgetChanges.oldTotalCents、newTotalCents、constraintsVersion、createdAt | ● | ○ | ● | roles:buyer | customer 本就能看到上限，新旧值不构成新披露 |
| budgetChanges.reason（finance 自由文本） | ○ | ○ | ● | self(finance) | |
| commitments 行（kind、amountCents、simulated、changeOrderId） | ● | ○ | ● | roles:buyer | baseline 金额会直接暴露已承诺额 |
| changeOrders.approvedItemKeys、deferredItemKeys、amountCents、deliveryDate、proposalVersion、constraintsVersion、createdAt | ● | ● | ● | room | 金额 = provider 自己的目录价 |
| changeOrders 执行快照 `budgetSnapshot {totalCents, committedBeforeCents}`（若 08 决定存） | ● | ○ | ● | roles:buyer | |
| changeOrders.operationId | ○ | ○ | ○ | sys | 幂等键，无展示价值 |
| tasks.itemKey、title、assigneeRole、dueDate、status | ● | ● | ● | room | |

### 5.5 运行、回合、人工请求、事件

| 表.字段 | cus | pro | fin | 类 | 备注 |
| --- | --- | --- | --- | --- | --- |
| runs.status、trigger、round、maxRounds、endedReasonCode、startedAt | ● | ● | ● | room | X4 |
| runs.callCount | ● | ● | ● | room | 无敏感性，供"已调用 N 次 / 上限 M" |
| runs 累计 token / 成本 | own | own | own | owner | 运营汇总 |
| agentTurns 公开投影：role、turnSeq、attempt、status、failureKind（粗粒度枚举）、startedAt、finishedAt | ● | ● | ● | room | 供 "Provider agent drafting…" |
| agentTurns.output 的结构化动作（action、itemKeys、deliveryDate、reasonCode、clarify.topic） | ● | ● | ● | room | 协议本身就是跨方消息；只以模板渲染形式出现 |
| agentTurns.output.rationale | 本方 | 本方 | 本方 | self | PD-7 |
| agentTurns 的 usage（tokens、latencyMs、model、stopReason）、errorCode、zod issue 路径 | 本方 | 本方 | 本方 | self | 防止跨方从 token 数推断简报长度（低风险侧信道，一并关掉） |
| agentTurns.contextRef（briefVersionId、eventSeqUpTo、constraintsVersion） | 本方 | 本方 | 本方 | self | 不存 prompt 全文（part3 第 9 节） |
| agentTurns.anthropicRequestId | ○ | ○ | ○ | sys | 只给运营排障 |
| humanRequests.targetRole、kind、status、createdAt、answeredAt | ● | ● | ● | room | X5 |
| humanRequests.options[*]（label 模板参数、impact） | ◐ | ◐ | ◐ | 每个 option 自带类 | 例：给 finance 的 "Raise budget by $100" 类为 roles:buyer；给 customer 的 "Defer REPORTS (−$300)" 类为 room（目录价已公开） |
| humanRequests.answerKey 渲染后的结果 | ● | ● | ● | room（按 option 类降级措辞） | provider 看到 "Finance updated a budget constraint" |
| events（全部） | ● | ● | ● | room | PD-8；payload 只含 room 类字段，受限细节经 restrictedRef 按查看者连接 |

## 6. 动作×角色矩阵

记号：✔ 允许；✘ 拒绝；◐ 条件允许。agent 列指代理运行时经 internal 函数能做的事（不经公共入口）。"非成员"含已登录但不在房间、未登录两种：query 返回 null，mutation 抛 `ConvexError({code:'UNAUTHENTICATED'|'NOT_A_MEMBER'})`（F07.3 约定）。

| 函数（公共） | cus | pro | fin | own 附加 | agent | 非成员 | 守卫 / 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rooms.create | ◐ | ◐ | ◐ | — | ✘ | ◐ | 登录且在创建者允许名单；创建者选择自己的角色并成为 owner |
| rooms.view / rooms.listMine | ✔ | ✔ | ✔ | — | ✘ | null | 返回 `projectRoomFor(viewer)` |
| rooms.close | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | 无活动 run 或先取消 |
| invites.create / revoke / listForRoom | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | 该角色未被占用 |
| invites.accept | — | — | — | — | ✘ | ◐ | 已登录、码有效未过期、角色空缺、该用户尚非本房间成员（一人不得多角色） |
| briefs.mine | 本人 | 本人 | 本人 | — | ✘ | null | 只按 (roomId, viewer.role) 读 |
| briefs.saveDraft / confirm | 本人 | 本人 | 本人 | — | ✘ | ✘ | confirm 写 briefVersions 与 sharedFacts；硬约束字段变化走 bumpConstraints（09） |
| offerItems.saveDraft / confirm / retire | ✘ | ✔ | ✘ | — | ✘ | ✘ | confirm 是显式披露（PD-4）并 bumpConstraints |
| budgets.update | ✘ | ✘ | ✔ | — | ✘ | ✘ | 唯一写入口；`assertCents`；bumpConstraints |
| negotiation.start | ◐ | ◐ | ◐ | — | ✘ | ✘ | 三方简报均已确认、无活动 run、房间调用上限未到 |
| runs.retryTurn | ◐ | ◐ | ◐ | — | ✘ | ✘ | run.status = failed；有冷却与次数上限（10） |
| runs.cancel | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | |
| approvals.decide（approve / reject） | ◐ | ◐ | ◐ | — | **✘** | ✘ | viewer.role ∈ proposal.requiredApproverRoles；审批/执行守卫（F04.2）；最后一个必需批准在同一 mutation 内执行（08） |
| approvals.withdraw | 本人 | 本人 | 本人 | — | ✘ | ✘ | 执行前 |
| humanRequests.answer | ◐ | ◐ | ◐ | — | **✘** | ✘ | `requireRole(request.targetRole)`；status = open 且 constraintsVersion 一致 |
| tasks.updateStatus | ✘ | ✔ | ✘ | — | ✘ | ✘ | assigneeRole = provider |
| events.list | ✔ | ✔ | ✔ | — | ✘ | null | 返回按查看者渲染的 `EventView` |
| agentTurns.mine | 本方 | 本方 | 本方 | — | ✘ | null | 只返回 role = viewer.role 的回合全文 |
| usage.roomSummary | ✘ | ✘ | ✘ | ✔ | ✘ | null | |

| internal 函数（代理运行时可达） | 允许写 | 禁止写 |
| --- | --- | --- |
| agentContext.forTurn | 只读 | — |
| turns.complete / turns.fail | agentTurns、proposals（经 06 校验后插入）、events、humanRequests（仅当代码判定需要升级，F05.6） | approvals、budgets、briefs、offerItems、sharedFacts、commitments、changeOrders、tasks |

不变量：approvals 的唯一写入口是 `approvals.decide`（public、需要身份）；`recommend_accept` 只写事件与本方 rationale（核心 #2、F05.7）。

### 6.1 公共入口模板

```ts
// 每个公共函数的前两行；身份只从 ctx.auth 推导，参数里没有 userId / role（F07.3）
const viewer = await requireMember(ctx, args.roomId);          // query 用 getViewer → null
assertAllowed(ACTIONS['budgets.update'], viewer);               // 读 ACTION_MATRIX 常量
```

`ACTION_MATRIX` 是代码常量（见 privacy-disclosure/disclosure.ts），part5 的越权测试按它生成用例：矩阵里每个 ✘ 都是一条必须失败的测试。
