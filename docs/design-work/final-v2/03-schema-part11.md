# 03 · Convex schema v1（part11）：索引用途、字段披露类与 REDACTABLE_FIELDS、不变量落点

> 分片清单见 `03-schema.md` 顶部。

## 3.15 索引用途（每个索引都有读者；无读者的索引不建，idempotent-execution review r09）

| 索引 | 读者 |
| --- | --- |
| `users.by_tokenIdentifier` | 全部构造器的 `getViewer` |
| `rooms.by_createdBy` | `room_create` 节流桶（+ `_creationTime` 窗口）、"我建的房间" |
| `rooms.by_status` | `clock.rollLocalDate` / `humanRequests.expireDue` 的房间枚举（再逐房间调度） |
| `rooms.by_followsExecutionId` | `rooms.startFollowUp` 的先查后插；结果页 "Follow-up room" 链接 |
| `members.by_room_user` / `by_room_role` / `by_user` | `getMember`；`addMember`、`evaluateApprovalSet` 当前成员解析；`rooms.listMine` |
| `invites.by_room_role` / `by_email_status` / `by_tokenHash` | 新邀请取代旧邀请；`invites.listMine`；链接接受 |
| `briefs.by_room_role_version` | `loadRuleInput`、`briefs.mine`、代理上下文（本方）、`insertBriefVersion` |
| `sharedFacts.by_room_from_field` | `projectForRole`、`buildAgentContext`、`appendSharedFact`、历史值按版本判定 |
| `catalogItems.by_room_item` | `loadRuleInput`、`catalog.list`、`appendCatalogRow`、`insertBriefVersion` / `appendSharedFact` 的 itemKey 成员校验（confirmed ∪ retired） |
| `ledgerEntries.by_room_kind` | `loadRuleInput`（求和）、baseline 唯一性、执行事务区间读、对账 |
| `constraintRevisions.by_room_version` | `constraints.bump`、09 `replayRuleInput`、`constraints_changed` 渲染 |
| `runs.by_room_runNo` / `by_status` | run 历史；`run_starts` 滚动 24 小时计数（人工 `runs.start` 与 10 B6a 共用，3.11.3）；`ops.livenessSweep`、`ops.setDraining(false)` |
| `turns.by_run_turnSeq` | G2、`createTurnTx`、run 内计数派生、`runs.reconcile` |
| `attempts.by_turn` / `by_run` / `by_status_deadline` / `by_room` | G0、当前 attempt；run 上限复核与对账；卡住告警与 `ops.activeAttemptCount`；房间用量汇总 |
| `rawOutputs.by_attempt` / `by_expiresAt` | dashboard 排障；`ops.purgeRawOutputs` |
| `proposals.by_room_version` / `by_run` | 提案历史；P2a 取代 |
| `approvals.by_proposal_user` / `by_run_decision` | `evaluateApprovalSet`（整区间）、本人当前决定；本 run 被拒键（剔除集合派生，3.8） |
| `humanRequests.by_run_status` / `by_room_status` / `by_status_expiresAt` | 每 run 一个 open；收件箱与执行防御；过期 cron |
| `executions.by_executionKey` / `by_room` / `by_proposal` | 执行幂等三重查重；结果页 |
| `changeOrders.by_execution` / `by_room` | 变更单详情；follow-up 链内序号 |
| `tasks.by_taskKey` / `by_execution` / `by_room_assignee` | 对账；变更单任务列表；"Needs you" 待办 |
| `events.by_room_order` / `by_room_actor` / `by_room_rate` | `timeline.page`；`constraint_writes` / `soft_writes` 节流桶；`price_writes` / `hard_writes` 总量桶 |
| `opsFlags.by_key` / `spendCounters.by_scope_day` | 排空与全局日美元读取 |

## 3.16 字段披露类摘要与 `REDACTABLE_FIELDS`

### 3.16.1 每表默认披露类（逐字段见各表注释；07 §7.9 定最终矩阵，`DISCLOSURE` 注册表必须覆盖全部叶子路径，TC-PRIV-10）

| 类 | 表与字段 |
| --- | --- |
| `room` | `rooms` 的标题 / 状态 / cv / localDate；`members.role / displayName`；简报的版本号与确认时间；非草稿目录行；`constraintRevisions.version`；`runs` 的状态 / 原因 / 轮次 / 结束原因；`turns` 的元数据（他方只见粗粒度状态）；`proposals`（除来源 id）；`approvals`（除 `note` / `userId`）；请求的存在与状态；`executions` 的引用与金额；变更单文档部分；`tasks`；`events.payload` |
| `roles: [customer, finance]` | `constraintRevisions.cause` 与变更角色；请求的 `kind` / `toRole`（provider 为 `toRole` 时本人也可见） |
| `self(role)` | 简报全部内容与披露决定；草稿目录行（provider）；`turns.candidateSnapshot / allowedActions / result / outcome`；`attempts` 的用量、move、错误细节；请求的问题与选项（`toRole`）；`approvals.note`（作者） |
| 行级受众 | `sharedFacts`：`audience ∪ {fromRole}` |
| finance 类（customer 经 `sharedFacts` 共享行，按值所属版本判定） | `ledgerEntries`；`executions.committedBefore/After/capCentsAtExecution`；`changeOrders` 的 G701 基线 / 前后金额 |
| `creator` | `invites`（`runs` 的美元与 attempt 计数为 `system`，只在 `ops.metrics` 或 run 终态后按整 run 汇总给 creator，privacy-15） |
| `system` | `users`、`writeSeq`、全部 `*UserId` / `createdBy` / `*FnId`、`requestId`、`rawOutputs`、`constraintRevisions` 的来源与 localDate、`events.actorUserId / rateUser / rateRoom / restrictedRef / commitTs`、`opsFlags`、`spendCounters` |

### 3.16.2 `REDACTABLE_FIELDS`（PII 只在可抹除字段，techstack D38）

```ts
// convex/lib/privacy.ts
export const REDACTABLE_FIELDS = {
  users: ["displayName"],
  members: ["displayName"],
  invites: ["invitedEmail"],
  rooms: ["title"],                    // 可能含人名或公司名
  briefs: ["softFields.notes"],
  approvals: ["note"],
} as const;
export const TERMS_KEY_FIELDS = ["proposals.terms.itemKeys", "proposals.terms.modifiers",
  "proposals.terms.deliveryDate", "proposals.terms.amountCents"] as const;   // canonicalJson(terms) 覆盖的全部字段
type Flat<T> = { [K in keyof T]: T[K] extends readonly string[] ? `${K & string}.${T[K][number]}` : never }[keyof T];
type Redactable = Flat<typeof REDACTABLE_FIELDS>;
type TermsKeyField = (typeof TERMS_KEY_FIELDS)[number];
const _disjoint: [Extract<Redactable, TermsKeyField>] extends [never] ? true : never = true;   // 相交即编译失败
```

- 抹除是只追加表上第二种、也是最后一种允许的写入：只经 `privacy.redact`（internal，运维经 CLI 人工发起；v1 没有自助删除，3.3.2 第 6 条），只把上述字段覆盖为固定串 `"[redacted]"`，同事务写 `pii_redacted { table, field }` 事件；恢复备份后以恢复前快照中值为 `"[redacted]"` 的 `(table, rowId, field)` 为清单重放 `privacy.redact`（15 §15.11 第 6 步；techstack D39）。
- 互斥的意义：抹除永远不改变任何 `termsKey`、`boundTermsKey`、`executions.termsKey`，审批绑定与执行幂等不受影响。测试 SC-T7：抹除一个房间后对全部提案重算 `canonicalJson(terms)`，与 `termsKey` 及所有审批的 `boundTermsKey` 逐一相等。
- 不在清单里的人写字符串：目录 `title` / 任务模板 `title`（业务记录，进入 `lines[]` 与 `tasks` 快照；确认页提示"不要填写个人信息"）、模型 `rationale`（在 `attempts.move` 与 `turns.result`，按 `self` 控制，房间删除时随 `seed.reset` / 未来的房间清除流程一起处理，见 3.20 Q6）。

## 3.17 不变量落点（表 → 00-invariants 编号）

| 表 | 承载的不变量 |
| --- | --- |
| `users` | INV-17（身份只来自 `tokenIdentifier → users`） |
| `rooms` | INV-24（cv 唯一写入口）、INV-33、INV-36 / INV-77（`localDate`、时区固定）、INV-45（场景注册）、INV-52（`executed` 终态）、INV-67（单活跃 run） |
| `members` | INV-15、INV-16、INV-27（当前成员解析） |
| `invites` | INV-16 |
| `briefs` | INV-01、INV-02、INV-19、INV-24、INV-39（`capCents >= committedCents`） |
| `sharedFacts` | INV-01、INV-02、INV-18、INV-19 |
| `catalogItems` | INV-05（title 定界）、INV-24（投影字段）、INV-37、INV-38 |
| `ledgerEntries` | INV-39、INV-50 |
| `constraintRevisions` | INV-24、INV-57 |
| `runs` | INV-32、INV-33、INV-67、INV-68、INV-72、INV-76 |
| `turns` | INV-09、INV-41、INV-68、INV-69 |
| `attempts` / `rawOutputs` | INV-13、INV-40、INV-42、INV-69 – INV-72 |
| `proposals` | INV-07、INV-28、INV-35 – INV-37、INV-55 |
| `approvals` | INV-20、INV-25 – INV-31 |
| `humanRequests` | INV-10、INV-34、INV-64、INV-65、INV-73 |
| `executions` / `changeOrders` / `tasks` | INV-21、INV-46 – INV-49、INV-53、INV-60、INV-61 |
| `events` | INV-05、INV-11（节流计数）、INV-12、INV-56 |
| `opsFlags` / `spendCounters` | INV-72 |
| 全部表 | INV-43（值域，3.2）、INV-54（只追加，3.3.2）、INV-59（核心 7：schema 中没有任何外部 ERP / 支付 / 签署实体或字段）、INV-62（provenance，3.3.3） |
