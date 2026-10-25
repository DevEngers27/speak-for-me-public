# 02 · 领域模型（part5）：不变量清单 A（核心 1–3）

> 分片清单见 `02-domain-model.md` 顶部。编号与完整谓词取自 `00-invariants-part2..6`（canon 对齐版）；本章按"落到哪个实体的哪个字段、谁是唯一写者、哪个守卫以什么码挡住"重新组织，供 03 / 04 / 12 / 16 对照。"不变量（简述）"列只是便于检索的标题，**不是规范谓词**：谓词、核心归属与反例一律以 `00-invariants*.md` 为准，二者措辞不一致时以后者为准（completeness-30）。"写锁"指房间写锁 M-ROOM（DM-09，INV-M1）。

## 2.11 不变量清单

### A1 私密委托（核心 1）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-01 | 他方可见的一切（DTO、事件渲染、代理上下文）都是 `projectForRole` 的输出；不含未经披露的简报字段 | `briefs.hardFields / softFields / disclosures`；`sharedFacts` | 投影只在 `memberQuery` 内；他方投影从不读 `briefs` 行（07 PV-05）；非成员 query 返回 `null`、mutation 抛 `auth.not_member`（12 §12.4） |
| INV-02 | `capCents` / `committedCents` / `headroomCents` / `overByCents` / `shortfallCents` 只给 finance；customer 仅当 `sharedFacts` 中 finance 该字段最新行受众含 customer；provider 永不 | finance `briefs.hardFields.capCents`；`ledgerEntries`；`sharedFacts`（finance 金额字段受众 ⊆ `[customer]`） | `appendSharedFact` 写入断言（违例 `internal`）；`projectForRole` |
| INV-03 | 代理请求体 ⊆ 本方投影 ∪ 本人当前简报 ∪ 本回合 `candidateSnapshot` ∪ 模板化公共历史 | `turns.candidateSnapshot`；`attempts` | `agents.loadTurnContext`（internal query）只调投影；他方自由文本类型上不可进入 `AgentContext` |
| INV-04 | 模型输出 schema 无金额 / 版本 / 身份属性名，根为 `{ turn }`，全部 required | `attempts.schemaVersion`（= `turnSpecKey(spec)` 规范串，不是哈希，05 §5.4.1） | `core/engine/strictSchema.ts` 快照与属性名测试 |
| INV-05 | 他方可见字符串只来自 `renderPublicText`；唯一进入他方上下文的人写串是目录 `title`（`^[^<>\r\n]{1,80}$`，定界 + 转义） | `catalogItems.title`；`events.payload` 无自由文本 | `appendCatalogRow` 正则（`input.invalid`）；模板 `reads` 对账；payload 字符串白名单测试 |
| INV-06 | 掩码检查对非所有者只给 `private.constraint_unmet`（无 checkId、无 params），通过的掩码检查省略；未标注受众的 param 丢弃 | `core/engine/reasonCodes.ts` 的 owner 与 param 受众表 | `projectChecks`（07 §7.11 XP-5，在 `projectForRole` 内） |
| INV-07 | 不存在任何字段、`termsKey` 成分、模板参数、事件 payload 等于"私密集合 − 条款" | `proposals` / `changeOrders` / `events` 中无 `deferred*`；`REDACTABLE_FIELDS ∩ termsKey 字段 = ∅` | schema 测试 03 SC-T6 / SC-T7；customer 自己的"未纳入条目"只在投影内现算 |
| INV-08 | 派生值继承输入中最严格的类（07 解密清单 DX-1…DX-13 除外）；非干扰：只改他方未披露值，本方全部可见输出逐字节不变 | `DISCLOSURE.derivedFrom` | 07 TC-PRIV-05 metamorphic 测试 |
| INV-09 | `candidateSnapshot = enumerateCandidates(viewFor(turn.role))`：provider 不按预算 / 未披露截止日过滤、剔除 `excludedCandidateKeys(run)`（已提出含被阻断 ∪ 被拒 ∪ 复核失败，canon D10）；≤ 12；按 `candidateKey` 字典序；首轮首位为最低价候选 | `turns.candidateSnapshot`（写后不变） | `createTurnTx` 在同一 mutation 内枚举并写入；没有只读 query 重算 |
| INV-10 | `humanRequests.options` 只按 `toRole` 自身视图计算；需要他方未披露值才成立的选项只写不可选的 `blocked` 项、不写数字 | `humanRequests.options[].effect` | `openHumanRequestTx` 写前 `assertOptionsProjected` |
| INV-11 | provider 只见 `fit: ok \| blocked`；`previewChange.verdictAfter` 只给 finance；每 run 每角色 `propose / counter` ≤ 4；约束变更类写入每用户每房间每小时 ≤ 6 | `events.by_room_actor`（命令事件）；`turns` 派生计数 | `assertWithinRate`（`run.rate_limited`）；`allowedActions` 裁剪 |
| INV-12 | `events` 无 `visibility`；`payload` 只含房间可见字段；私密细节经 `restrictedRef`；`run_needs_input` / `human_request_opened` 对 provider 渲染为 `run_waiting` | `events.payload / restrictedRef` | `appendEvents` + 03 SC-T8；`timeline.page` 受众渲染 |
| INV-13 | 浏览器只收 `ConvexError({ code, params })`（params 经投影）；公开函数无 `console.*`；模型原文只在 `rawOutputs` | `attempts.rawOutputRef`、`issuePaths`；`rawOutputs` | 构造器内置 `withSanitizedErrors`（`internal`）；`opsLog` 字段白名单 |
| INV-14 | 页面只传 `roomId`；受限数据只经鉴权订阅；RSC 负载与静态 chunk 不含受限 DTO | — | 页面结构；E2E view-source 扫描 |
| INV-15 | `members` 上 `(roomId, userId)` 与 `(roomId, role)` 唯一；`role` 不可变 | `members.by_room_user / by_room_role` | `addMember`（`invite.seat_taken` / `invite.already_member`）+ 写锁 |
| INV-16 | 角色只由邀请授予；邮箱邀请要求已验证邮箱且相等；链接只存 `tokenHash`、72h、一次性；creator 无额外审批权 | `invites.mode / invitedEmail / tokenHash / status / expiresAt` | `invites.accept`（`invite.invalid` / `invite.email_unverified`） |
| INV-17 | 公开函数不接受 `userId` / `role` 参数；被调度函数显式带 `actorUserId`，只作归属不作授权 | `users.tokenIdentifier` | 构造器（`auth.unauthenticated` / `auth.user_not_provisioned` / `auth.not_member` / `auth.role_forbidden` / `auth.not_creator`，12 §12.4） |
| INV-18 | 共享事实的值只能是日期 / `itemKey[]` / 枚举 / 整数分；过闸门与日期窗口；`itemKey[]` 值与简报里的 itemKey 一样必须属于本房间曾确认过的 item 键（confirmed ∪ retired），关闭伪 itemKey 自由文本信道 | `sharedFacts.value / audience / briefVersion` | `appendSharedFact`（`disclosure.blocked` / `disclosure.needs_own_confirmation` / `date.out_of_range` / `item.unknown`） |
| INV-19 | 跨角色可见的简报字段只经 `sharedFacts` 最新行（版本绑定）读出，该行只由所有者的显式披露写入（确认时的 `disclosures` 勾选、`sharedFacts.add`、`disclose` 回答）；`ledger.recordBaseline` 与 finance 确认按 finance 既有勾选经 `materializeDisclosures` 写入同一张表，不另设写入口；同侧（customer ↔ finance）也不默认共享 | `briefs.disclosures` → `sharedFacts` | `appendSharedFact`（唯一写入 helper，被 `materializeDisclosures` / `sharedFacts.add` / `humanRequests.answer` 的 `disclose` 调用；03 §3.6、07 §7.8.3） |

### A2 代理只建议（核心 2）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-20 | `approvals` 只由 `approvals.record`（`memberMutation`）写；`recommend_accept` 只写 `turns` 与 `events` | `approvals` | CI 结构测试：`insert('approvals'` 只在 `convex/approvals.ts` |
| INV-21 | 执行的唯一路径是 `approvals.record` 同事务调用的 helper `executeIfComplete`；无公开 / internal 执行入口、无 action / cron 执行 | `executions` | helper 不导出为 Convex 函数；结构测试 CE-037 |
| INV-22 | 动作集恰为六个；`allowedActions(role, kind, ctx)` 裁剪（finance 不能 counter、provider 无 recommend_accept、快照空则无 propose / counter） | `turns.allowedActions` | Zod enum + 语义校验（`action.not_allowed_for_role`） |
| INV-23 | 模型只能引用见过的 `optionKey`、提案 `version`、`topicKey`、`reasonKey`、`toRole`；任何模型声明的数值不进入判定，`terms` 由服务端物化 | `turns.result`（模型 move）与 `turns.outcome`（服务端处置）分开存 | `turns.complete`（`action.option_not_in_snapshot` / `output.unknown_reference`） |

### A3 人批准具体版本（核心 3）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-24 | `constraintsVersion` 只经 `constraints.bump`；递增 ⇔ 硬投影 `{capCents, requiredItemKeys, deadline, catalog[{itemKey, revision, status, priceCents, leadDays}]}` 前后不等（`clock` 例外）；标题 / 任务模板 / 软字段 / 披露 / 成员 / 台账不在投影内 | `rooms.constraintsVersion`；`catalogItems.revision`（定价修订号）；`constraintRevisions` | `withConstraintChange` → `bump`；结构测试 CC-17（`patch(rooms, {constraintsVersion})` 只在 `constraints.ts`） |
| INV-25 | 审批行的 `boundConstraintsVersion` / `boundTermsKey` 写后不变，等于入参 `expected*` 与服务端当前值 | `approvals.boundConstraintsVersion / boundTermsKey` | `approvals.record` A-G5（`approval.stale`，不写行） |
| INV-26 | 审批有效性不存字段；执行后改读 `executions.approvalIds` 冻结快照 | `approvals`；`executions.approvalIds` | `evaluateApprovalSet`（08 唯一实现） |
| INV-27 | 完成判定按集合：每个必需角色恰一位当前成员、有效 approve、userId 两两不同；输入是同事务读到的整个审批区间 | `approvals.by_proposal_user` 前缀 `eq(proposalId)`；`members.by_room_role` | `approvals.record`（`approval.self_conflict`）+ 写锁 |
| INV-28 | `proposals.requiredApprovals` 插入时快照、不可变 | `proposals.requiredApprovals` | `insertProposal` |
| INV-29 | 同一 `(proposalId, userId)` 的 `seq` 从 1 连续；同一 cv 上重复相同决定返回 `unchanged`；`withdraw` 只撤本人当前 cv 的 approve、执行前 | `approvals.seq` | `approvals.record`（无可撤回的 approve 时返回 `unchanged`、不插行，08 §8.5.5、12 §12.15） |
| INV-30 | reject 是该提案的终局：提案 → `rejected`，永不复活；bump 预检只看刚由 `active` 变 `stale` 的那一行 | `proposals.status` | `approvals.record` → `setStatus`；`startRunTx` 的 R2 分支 |
| INV-31 | `approvals.record` 前置：房间 `open`、当前 run `pending_approval` 且 `currentProposalId === proposalId`、提案 `active`、调用者角色在快照内、approve 前同事务 `passesChecks` | `rooms`、`runs`、`proposals` | `approval.not_current` / `auth.role_forbidden` / `approval.not_executable` / `approval.already_executed`（同人同 approve 对已执行提案幂等成功） |
| INV-32 | bump 同事务：取代非终态 run、其 active 提案 → `stale`、open 请求 → `superseded`，`react()` 到不动点（深度 ≤ 4），结束时恰为 (a) 新 run `pending_approval` 沿用同一 proposalId、(b) 新 run `negotiating`、(c) 新 run `needs_input` + 恰一个请求之一 | `runs`、`proposals.status`、`humanRequests.status`、`constraintRevisions.supersededRunId / staleProposalId` | `constraints.bump` + `react()`；dev 断言 `assertFixedPoint` F1–F4 |
| INV-33 | 非终态 run 的 `constraintsVersionAtStart` 与非终态 turn 的 `constraintsVersion` 都等于房间当前 cv | `runs.constraintsVersionAtStart`；`turns.constraintsVersion` | `startRunTx` 重读房间；`createTurnTx` 快照；G3 |
| INV-34 | open 请求必属于当前非终态 run；每 run 至多一个 open；`answer` 先置 `answered` 再触发 bump | `humanRequests.runId / status` | `openHumanRequestTx`（先查 `by_run_status`）；`humanRequests.answer`（`request.not_open` / `request.option_unknown` / `auth.role_forbidden`，12 §12.4） |
| INV-35 | `isExecutable` 派生（状态 + 规则），不比较 `createdAtConstraintsVersion`；审批集合另名 `allApproved` | — | 08 `isExecutable`；2.8 口径说明 |
| INV-36 | 交付日插入时物化为绝对日期、不重算；query 不读时钟；`clock.rollLocalDate` 只在结论翻转时 bump | `proposals.terms.deliveryDate`；`rooms.localDate` | `insertProposal`；`clock.rollLocalDate`（`cause: 'clock'`） |
