# 02 领域模型 · part1：不变量清单（本设计的出发点）

> 本设计以"不变量优先"展开：先写出系统必须永远成立的命题，再由它们推导实体、字段、索引、状态机、守卫与函数边界。part1–part2 列全不变量及其落点；part3 给出实体、关系、所有权与"守卫 × 不变量"矩阵；字段细节见 03，迁移见 04。
> 记号：`表.字段` 是数据落点；`fn` 是守卫所在函数（定义见 12）；"唯一写者"指该表或字段在全代码库中只有这一处写入。

## 0. 一条贯穿全部守卫的机制：房间聚合写锁（M-ROOM）

Convex 没有唯一约束，也没有行锁；它提供 mutation 级可串行化（OCC，冲突者自动重试）。本设计规定：**任何改变房间内业务状态的 mutation，都必须 patch 该房间的 `rooms` 文档**（至少 `eventSeq += 1`，因为每个状态迁移都要写事件，见 EV-2）。于是同一房间内的业务写入在 OCC 下天然串行，下列"先查后写"守卫不依赖"索引区间读是否进入读集"这一待验证细节（inputs/04 待验证 #2）。代价是房间内吞吐受限，本产品每房间 3 人、每分钟个位数写入，可以接受。不同房间互不冲突。

## 1. 身份与成员（ID）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| ID-1 | 公共函数的行动者只来自 `ctx.auth.getUserIdentity().tokenIdentifier` 映射到的 `users` 行；任何公共函数都不接受"我是谁"类参数（userId、roleKey、participantId） | `users.tokenIdentifier` | `requireViewer` / `requireParticipant`；16 的 API 签名扫描测试 |
| ID-2 | `users.tokenIdentifier` 全局唯一 | `users` + `by_tokenIdentifier` | 唯一写者 `users.ensure`：先查后插 |
| ID-3 | 同一房间内 `roleKey` 唯一（一角色一席） | `participants` + `by_roomId_and_roleKey` | `rooms.create`（房主席位）与 `invites.accept` 先查后插 |
| ID-4 | 同一房间内 `userId` 唯一（一人一席）⇒ 必需审批角色必由不同用户持有 | `participants` + `by_roomId_and_userId` | `invites.accept` 先查 |
| ID-5 | `participants.roleKey` 永不改变；participants 只有 `currentBriefVersionId`、`briefVersionCount`、`displayName` 可变 | 同上 | db 门面 `patchMutable` 的字段白名单（见 part3 §4） |
| ID-6 | 邀请至多被接受一次，且仅在 `status = open ∧ now < expiresAt` 时；席位角色取自邀请行而非客户端 | `invites.status/expiresAt/roleKey` | `invites.accept` |
| ID-7 | 房主身份不带来审批、代答或读他人简报的权力；`rooms.ownerUserId` 只用于邀请、改名、关闭 | `rooms.ownerUserId` | `requireRoomOwner` 只出现在 `invites.create/revoke`、`rooms.rename`、`rooms.close` |

## 2. 私密简报与披露（BR）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| BR-1 | 简报确认版本只追加；`(participantId, versionNo)` 唯一且从 1 连续 | `briefVersions` + `participants.briefVersionCount` | 唯一写者 `commitBriefVersion`：`versionNo = count + 1`，同事务 patch count |
| BR-2 | 规则、代理、提案只读取**已确认版本**（由 constraintSet 引用），从不读草稿 | `constraintSets.briefVersionIds`，`briefDrafts` | `loadRuleInputs(constraintSetId)`、`buildAgentContext(turnId)` 的签名不接受草稿 |
| BR-3 | 简报内容（草稿与版本）只出现在两处：本人的 `briefs.mine` 返回值；为本人角色服务的代理上下文 | `briefVersions.content`、`briefDrafts.content` | 投影层是唯一出口；其他 query 的 `returns` validator 不含简报字段；金丝雀测试 |
| BR-4 | 对他方可见的任何值只来自四种来源：(a) 所有者在当前确认版本中对该受众的披露；(b) 07 列举的策略性披露（以确认时的 acknowledgements 记录）；(c) 派生值且其全部输入对该查看者可见（**派生闭包**）；(d) 检查通过/失败、选项可行与否这类"存在位" | `briefVersions.disclosures/acknowledgements` | `projectFor(viewerRole, …)` 是唯一出口，每个数值带可见性标签（07 §3） |
| BR-5 | 每个确认版本都含该角色在场景中要求的全部 acknowledgements（例如"被提案引用的报价行会公开"） | `briefVersions.acknowledgements` | `commitBriefVersion` → `scenario.validateBrief` |

## 3. 约束版本（CS）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| CS-1 | `rooms.constraintsVersion` 等于本房间 `constraintSets` 的最大 version；version 从 1 连续 | `rooms.constraintsVersion/currentConstraintSetId`，`constraintSets.version` | 唯一写者 `bumpConstraints`，同事务写两处 |
| CS-2 | constraintSet 只追加，记录各角色确认版本 id 与 `committedCents` 快照；任一提案在任一版本下的评估可由不可变数据复现 | `constraintSets.*` | 同上；`evaluateProposal` 是纯函数 |
| CS-3 | 每次改变规则输入都在同一事务内递增约束版本：①简报确认且场景 `ruleDiff ≠ ∅`；②执行（台账变化）。不存在其他规则输入 | `briefVersions`、`commitments` | 这两张表各只有一个写者（`commitBriefVersion`、`executeIfReady`），二者都调用 `bumpConstraints` |
| CS-4 | 台账一致：`currentConstraintSet.committedCents = finance 确认版本.externalCommittedCents + Σ commitments(room)` | `constraintSets.committedCents`、`commitments.amountCents` | `bumpConstraints` 计算；`executeIfReady` 执行前重算并断言，不等即抛 `INVARIANT_VIOLATION` 回滚；`ops.auditRoom` |
| CS-5 | `run.status ∈ {negotiating, awaiting_input, failed}` ⟹ `run.constraintsVersion = rooms.constraintsVersion` | `runs.constraintsVersion` | `onConstraintsChanged` 把这三态的 run 迁移为 superseded |
| CS-6 | 任何 bump 都关闭本房间全部 open 人工请求 | `humanRequests.status` | `onConstraintsChanged` |

## 4. 提案（PR）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| PR-1 | 提案插入后不 patch、不 delete（状态全部派生） | `proposals` | db 门面不为只追加表提供 patch/delete；lint 禁止裸 `ctx.db.patch/replace/delete` |
| PR-2 | `(roomId, version)` 唯一，`version = ++rooms.proposalSeq`；约束变化不递增提案版本 | `proposals.version`、`rooms.proposalSeq` | 唯一写者 `insertProposal` |
| PR-3 | 条款中的价格、金额、最早交付日由代码从 constraintSet 引用的 provider 确认版本复制求和；模型输出 schema 不含任何金额字段 | `proposals.terms` | `materializeTerms`；05 的输出 schema |
| PR-4 | `rooms.currentProposalId` 有值 ⟺ 当前 run 处于 pending_approval；它指向该 run 的提案且 `creationVerdict = pass` | `rooms.currentProposalId` | 只有 `transitionRun(→pending_approval)` 设置它，离开该状态的迁移清空它 |
| PR-5 | "可执行"从不存储：`isExecutable(p) ⟺ PR-4 成立 ∧ evaluateProposal(p.terms, currentInputs, today) 全部通过 ∧ 无 execution 引用 p` | 无（派生） | 纯函数 `isExecutable`，所有调用点共用 |
| PR-6 | `requiredApproverRoles`、`approvalKinds` 在插入时从场景策略快照，之后不变 | `proposals.requiredApproverRoles` | `insertProposal` |
| PR-7 | `proposal.isSimulated = run.agentMode = stub ∨ constraintSet 中任一简报版本为模拟` | `proposals.isSimulated` | `insertProposal` |

