# 07 · 权限、隐私与威胁模型（part5：字段 × 角色披露矩阵、受控投影）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.9 字段 × 角色披露矩阵（首个场景 scope_change）

记号：● 可见；○ 不可见；S 按 `sharedFacts` 有效可见性（§7.8.3）；本 = 只有所属角色（`self`）；cr = creator；sys = 永不出服务端。"代理"列：`同` = 与委托人相同，`✘` = 不进任何代理上下文，`U` = 进入时包在 `<untrusted_data>` 内。DTO 中 id 字段用 `id`（`v.object` 字段名不能以 `_` / `$` 开头）。本矩阵是 `DISCLOSURE` 的人读摘要、按例外列出：未在本节逐行列出的 schema 叶子（含 `rawOutputs.*`、`rooms.writeSeq` / `nextRunNo`、全部 `*FnId` 调度 id、`*UserId` 与 `createdBy`，即 03 §3.16.1 的 `system` 类）在 `DISCLOSURE` 中一律登记为 sys + 代理 ✘（fail-closed：遗漏不等于放行）；叶子清单由 TC-PRIV-10 从 03 schema 递归生成，并要求与注册表精确相等，任何叶子放宽为非 sys 之前必须先在本节加行。

### 7.9.1 房间、身份、成员、邀请

| 表.字段 | cus | pro | fin | 代理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `rooms.status / constraintsVersion / localDate / timeZone / scenarioKey / scenarioVersion / currentRunId / nextProposalVersion / provenance / followsExecutionId` | ● | ● | ● | 同（只取 status、cv、localDate、scenario） | `provenance` 必须透传到界面（核心 8） |
| `rooms.title` | ● | ● | ● | ✘ | creator 撰写的自由文本，只给人看 |
| `rooms.createdBy` | ○ | ○ | ○ | ✘ | sys；DTO 只给 `isCreator: boolean` |
| `users.tokenIdentifier` | ○ | ○ | ○ | ✘ | sys |
| `members.role / joinedAt` | ● | ● | ● | 同（只取 role） | — |
| `members.displayName` | ● | ● | ● | ✘ | 注入面，只给人看 |
| `members.userId` | ○ | ○ | ○ | ✘ | sys；DTO 给 `isMe` |
| `invites.role / status / expiresAt` | cr | cr | cr | ✘ | 被邀请人经 `invites.listMine` 看到自己的那条 |
| `invites.invitedEmail` | cr | cr | cr | ✘ | — |
| `invites.tokenHash` | ○ | ○ | ○ | ✘ | sys；明文只在 `invites.createLink` 返回值出现一次 |

### 7.9.2 简报、披露账本、目录

| 表.字段 | cus | pro | fin | 代理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `briefs.hardFields / softFields`（本方各字段） | 本 | 本 | 本 | 同（principal 块） | 只由 `briefs.mine` 返回；同侧也不共享（C28） |
| `briefs.softFields.notes` | 本 | 本 | 本 | 同（principal 块，转义） | 永不可共享 |
| `briefs.disclosures` | 本 | 本 | 本 | ✘ | 他方只经 `sharedFacts` 看到效果 |
| 派生确认状态（`briefConfirmed`） | ● | ● | ● | ✘ | DX-7；草稿不入库 |
| `briefs.version / confirmedAt`（他方的） | ● | ●′ | ● | ✘ | ●′：房间 `open` 前可见；`open` 后 provider 对非本人一律 `null`，他人 `brief_confirmed` 并入同一提交的 "Constraints changed (vN)"（DX-7，privacy-02；12 §12.17 `members[].briefVersion`） |
| `briefs.confirmedBy` | ○ | ○ | ○ | ✘ | sys；DTO 给角色 |
| `sharedFacts.value / field / fromRole / briefVersion` | S | S | S | 同（按委托人可见性） | 不在受众内的行对查看者完全不存在（连字段名也不暴露） |
| `sharedFacts.createdBy / source` | ○ | ○ | ○ | ✘ | sys / 审计 |
| `catalogItems`（`status: 'draft'`）全部字段 | ○ | ● | ○ | provider 同 | — |
| `catalogItems`（confirmed / retired）`itemKey / revision / kind / priceCents / leadDays / taskTemplates / status` | ● | ● | ● | 同 | 路径 ① 披露；提案 `lines[]` 快照另存 |
| `catalogItems.title`（confirmed） | ● | ● | ● | U | `^[^<>\r\n]{1,80}$`；唯一进入他方上下文的人写字符串 |

### 7.9.3 预算账本、提案、审批

| 表.字段 | cus | pro | fin | 代理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `ledgerEntries.*`（`kind / amountCents / executionId / provenance`） | ○ | ○ | 本 | finance 同 | customer 只经派生字段的 sharedFacts 看到 committed / headroom，不看行 |
| 派生 `committedCents / headroomCents` | S | ○ | ● | 同 | finance 三开关（§7.8.4） |
| 派生 `overByCents / shortfallCents` | S′ | ○ | ● | 同 | S′ = 仅当 customer 可得 headroom（§7.8.5） |
| `proposals.version / terms / termsKey / lines / plannedTasks / status / origin / authorRole / createdAtConstraintsVersion / requiredApprovals / runId` | ● | ● | ● | 同 | `terms` 无 `deferredItemKeys`（D11）；金额 = 公开目录价之和 |
| 派生 `fit`（当前提案） | ● | ● | ● | 同 | DX-1 |
| 派生检查清单 `checks` | 掩码 | ○ | 掩码 | 同 | §7.11；provider 只有 `fit` |
| 历史提案在当前 cv 下的重算结论 | ○ | ○ | ○ | ✘ | 所有角色的历史提案只显示存储状态（`superseded / rejected / stale / executed`）；`fit` / `checks` 只对当前提案计算（D12 ①；12 `proposals.get`）。这同时关闭"事后打开披露后回看旧提案"的溯及通道 |
| customer 视图"未纳入条目" | ● | ○ | ○ | customer 同 | 现算不存 |
| `approvals.role / decision / seq / boundConstraintsVersion / boundTermsKey / decidedAt` + 派生有效性 | ● | ● | ● | 同（不含时间） | DX-6 |
| `approvals.reasonKey` | ● | ●‴ | ● | ✘（任何他方代理不含） | ●‴：按 `humanReasonKeys[].audience` 裁剪，`buyers` 受众的键对 provider 为 null（DX-6） |
| `approvals.note` | 本人 | 本人 | 本人 | 本方同（principal 块） | 永不进事件、永不进他方上下文 |
| `approvals.userId` | ○ | ○ | ○ | ✘ | sys；DTO 给 `memberId` / `isMe` |

### 7.9.4 运行、回合、尝试、人工请求

| 表.字段 | cus | pro | fin | 代理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `runs.status` | ● | ●′ | ● | 同 | ●′：provider 把 `needs_input` 投影为 `run_waiting`（D12 ⑦） |
| `runs.reservedMicroUsd / spentMicroUsd / spendCapMicroUsd / attemptCount / lastFailure` | ○ | ○ | ○ | ✘ | sys（privacy-15：实时花费暴露他方 token 量；成本只在 `ops.metrics` 或终态后整 run 汇总） |
| `runs.roundNo / activeTurnSeq / currentProposalId / cause / constraintsVersionAtStart / endedReason` | ● | ● | ● | 同（只取 roundNo、maxRounds） | DX-4、DX-8 |
| `runs.maxAttempts / reservedMicroUsd` | ○ | ○ | ○ | ✘ | sys（运维） |
| `turns.role / turnSeq / kind / status / currentAttemptNo / constraintsVersion` | ● | ●⁗ | ● | ✘ | XP-3 进度条；●⁗：他方回合的 `status` 只投影为 `scheduled \| running \| done`（`failed` / `stale` 折叠；`needs_input` 前最后一个评估回合统一 `done`），`turn_failed` 对他方渲染为 "{Role} agent finished"（privacy-06） |
| `turns.candidateSnapshot` | 本 | 本 | 本 | 本方同 | 由委托人视图枚举，继承 `self` |
| `turns` 解析后的输出（`action / optionKey / proposalVersion / reasonKey / topicKey / toRole / rationale`） | 本 | 本 | 本 | 本方同 | PV-10；他方只见由它产生的公开提案；customer 的 `counter` 不产生提案，只经 DX-11 / DX-13 外显（`turns.result.counterForwarded` 只给 customer 本方） |
| `attempts.status / attemptNo / stopReason`（映射为失败类别枚举） | 本 | 本 | 本 | ✘ | 供"Retry turn"界面 |
| `attempts.usage / requestId / schemaVersion / rawOutputRef / watchdogFnId` | ○ | ○ | ○ | ✘ | sys；token 数是简报长度的侧信道，一并关掉（review r12） |
| `humanRequests` 的存在、`kind`、`toRole`、`status`、`expiresAt` | ●″ | ○ | ●″ | ✘ | ●″：目标人见全文，非目标买方见 kind + toRole；provider 只见 `run_waiting`（DX-3）；若 toRole 是 provider，则 provider 是目标 |
| `humanRequests.options[] / effect / answerOptionKey / answeredBy` | 本（toRole） | 本（toRole） | 本（toRole） | 目标方代理只见本方的 open 请求 | `buildHumanRequests(toRole, viewFor(toRole))` + `assertOptionsProjected` |

### 7.9.5 约束修订、执行、变更单、任务、事件、运维

| 表.字段 | cus | pro | fin | 代理 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `constraintRevisions.version` | ● | ● | ● | 同 | DX-5 |
| `constraintRevisions.cause` | ● | ○ | ● | 同（买方） | provider 只见 "Constraints changed" |
| `constraintRevisions.actorUserId / sourceRefs` | ○ | ○ | ○ | ✘ | sys |
| `executions.proposalId / constraintsVersion / approvalIds / provenance` | ● | ● | ● | ✘ | `approvalIds` 冻结快照供结果页显示（D03） |
| `executions.committedBeforeCents / committedAfterCents` | S（执行时生效行） | ○ | ● | ✘ | 读快照，不用减法推算 |
| `executions.executionKey` | ○ | ○ | ○ | ✘ | sys，无展示价值 |
| `changeOrders` 中由公开提案金额构成的金额链 | ● | ● | ● | ✘ | 若 08 的 G701 "基线"取自 `ledgerEntries.baseline`，该字段属 finance 类，须走 XP-7 投影 |
| `tasks.taskKey / itemKey / title / assigneeRole / status` | ● | ● | ● | ✘ | 只有被指派人可勾选 |
| `events.type / payload / commitTs 游标` | ● | ● | ● | 结构化最近事件（不含渲染文本） | payload 只含 room 类字段；`commitTs` 不进 DTO，游标为字符串 |
| `events.restrictedRef` | ○ | ○ | ○ | ✘ | sys；只指向 03 `restrictedRefV` 列出的受控行，渲染时按查看者决定是否连接 |
| `rawOutputs.*`（模型原文、`expiresAt`）；`rooms.writeSeq / nextRunNo`；`turns.beginFnId / retryOfTurnId`、`attempts.actionFnId`；其余未在本节列出的叶子 | ○ | ○ | ○ | ✘ | sys（03 §3.16.1）；`rawOutputs` 无任何 query 暴露，只由 `ops.purgeRawOutputs` 按 `expiresAt` 删除（D16） |
| `opsFlags / spendCounters` | ○ | ○ | ○ | ✘ | sys |

## 7.10 受控投影（`projectForRole` 的分项实现）

跨受众读取只允许以下八条投影，每条只有一个实现函数，全部在 `convex/model/projections.ts`，由 `projectForRole(role, dto)` 调度（canon D11 的统一入口）；返回值才交给 DTO 构造器。

| # | 投影 | 从 → 到 | 输出 |
| --- | --- | --- | --- |
| XP-1 | `projectSharedFacts(viewer)` | `sharedFacts` → 受众内查看者 | `{ fromRole, field, value, asOfBriefVersion }[]` |
| XP-2 | `projectBudgetPanel(viewer)` | finance 简报 + ledger → finance 全量；customer 仅 S 字段（`headroomCents` 另在 `capCents` 与 `committedCents` 同时可见时派生，§7.8.5，与 06 `viewFor` 同一谓词）；provider 分支**不调用**任何预算读函数，直接返回 `undefined` | `{ capCents?, committedCents?, headroomCents?, minAllowedCapCents? }` |
| XP-3 | `projectTurnProgress()` | `turns` → room | `{ role, kind, turnSeq, status }[]` |
| XP-4 | `projectRequestBadge(viewer)` | `humanRequests` → 目标全文 / 其他买方 kind + toRole / provider `run_waiting` | 判别联合 |
| XP-5 | `projectChecks(viewer, evaluation)` | 规则结论 → provider `fit`；他人掩码 | §7.11 |
| XP-6 | `projectApprovals(viewer)` | `approvals` → room（去 `note`、`userId`），本人行附 `note` | 按 `requiredApprovals` 槽位 |
| XP-7 | `projectExecution(viewer)` | `executions` / `changeOrders` → room；预算快照按执行时 sharedFacts 行 | — |
| XP-8 | `projectOwnAgentRecord(viewer)` | `turns` / `attempts` → 同角色 | 动作、`rationale`、失败类别 |

纪律：

1. 其他任何"从 `self` / `system` 类字段读出并返回客户端"的代码都是缺陷。受限表（`briefs`、`sharedFacts`、`ledgerEntries`、`turns`、`attempts`、`humanRequests`、`invites`）的 `ctx.db.query` 只允许出现在 `convex/model/<table>.ts` 中带 viewer 参数的读函数里，ESLint `no-restricted-syntax` 按目录强制。
2. 只保留**一层**投影：先按查看者投影成 view-model，模板与 DTO 只消费 view-model；不再给每个模板参数单独挂 audience（review r16 的简化，避免两套投影逻辑分叉）。
3. XP-2 的 provider 分支不读预算；但 XP-5 计算 `fit` 需要全量规则输入，provider 的 `rooms.view` 因此在服务端内存中读取预算（经受限读函数 `loadRuleInput`），随即投影为一位。本章不宣称"provider 路径根本不读预算"（review r04）；它的防线是 XP-5 纪律 + §7.19 日志纪律 + 金丝雀测试。写入时物化评估结果列为加固选项（§7.24）。
