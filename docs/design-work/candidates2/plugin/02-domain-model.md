# 02 领域模型

## 1. 两层：引擎实体 vs 插件形状
引擎实体是存储与状态的主人；插件只提供"形状 + 纯函数"。凡是字段内容随场景变化的地方，引擎存 `payload / selection / derived / body / params`（类型 `unknown`，写入前由插件 Zod 校验），并在旁边存一个场景中立的规范化串（`hardKey`、`contentKey`）供比较。

```
User 1─* Participant *─1 Room ─1 scenarioKey(插件)
Room 1─* Invite
Room 1─* BriefDraft (每 participant 一份，可变)      Room 1─* BriefVersion (只追加)
Room 1─* CatalogEntry (按 entryKey 的修订链，只追加)
Room 1─* LedgerAccount 1─* LedgerEntry (只追加)   LedgerAccount 1─* LedgerCapChange (只追加)
Room 1─* Run 1─* Turn ─0..1 Proposal (只追加) 1─* Decision (只追加)
Run 1─* HumanRequest
Proposal 0..1─1 Execution 1─* OutcomeDocument, 1─* Task, 1─* LedgerEntry(kind execution)
Room 1─* Event (只追加)
```

## 2. 实体表

| 实体 | 是什么 | 所有者（谁能写） | 可变性 |
| --- | --- | --- | --- |
| User | 由 `identity.tokenIdentifier` 映射的内部用户；存显示名 | 本人（首次访问 upsert） | 显示名可改 |
| Room | 一次协商的容器；绑定一个插件 key+version、时区、`constraintsVersion`、`proposalSeq`、当前 run/提案指针 | 创建者建；指针只由引擎内部函数改 | 指针与计数可变，其余不变 |
| Participant | 房间席位 = (roleKey, userId) | `invites.accept` 唯一入口 | 不可变（v1 无移除） |
| Invite | 某 roleKey 的一次性邀请；只存 tokenHash | 房间创建者 | accepted/revoked 标记 |
| BriefDraft | 本人正在编辑的简报草稿 | 本人 | 可变，不参与任何规则 |
| BriefVersion | 已确认的简报版本 + 逐字段披露决定 | 本人 `briefs.confirm` | 只追加 |
| CatalogEntry | 由作者角色确认的可选供给（价格等在 payload 内） | 插件声明的 authorRoles | 只追加修订；`retired` 也是新修订 |
| LedgerAccount | 一个有上限的账户（场景中立的"预算"原语） | ownerRole（插件声明） | cap 可变，每次改动写 LedgerCapChange |
| LedgerEntry | 台账条目：baseline / execution / external | 引擎（seed、执行、外部登记） | 只追加；committed = 求和 |
| Run | 一次协商运行（若干轮代理回合） | 引擎 | 状态按 04 迁移表变 |
| Turn | 一个角色代理的一次独立调用 | 引擎 | 状态与用量字段在结束时写入一次 |
| Proposal | 不可变条款：selection + derived + contentKey + 必需审批快照 | 引擎（来自回合、人工选项或 seed） | 只有 `status` 可变 |
| Decision | 某人对某提案在某约束版本下的决定 approve/reject/withdraw | 本人 | 只追加；当前决定 = 最新一条 |
| HumanRequest | 代码生成、指向具体角色的问题与选项 | 引擎建；targetRole 本人回答 | open → answered/cancelled |
| Execution | 一次原子执行的凭据，`operationId` 唯一 | 引擎（最后一票的 mutation） | 不可变 |
| OutcomeDocument | 执行产物（变更单、预订单），带受众 | 引擎 | 不可变 |
| Task | 执行派生的任务 | 引擎建；assignee 可改 `status` | 只有 status 可变 |
| Event | 公共/角色受众的结构化时间线 | 引擎（同事务写） | 只追加 |

## 3. 版本化对象与两个计数器
- `rooms.constraintsVersion`：房间"约束集合"的版本。约束集合 = 已确认简报的硬约束 + 当前已确认目录 + 账户 cap + 台账条目。只经 `bumpConstraints` 递增（09 列出全部调用点）。
- `rooms.proposalSeq`：提案序号，在插入提案的同一 mutation 内 +1，永不因新 run 重置；`proposals.seq` 即界面上的 "v{seq}"。
- `briefVersions.version`：每 (roomId, roleKey) 自增，只用于展示与乐观并发，**不参与审批绑定**。
- `catalogEntries.revision`：每 (roomId, entryKey) 自增。

## 4. 派生而非存储

| 派生量 | 计算 | 为什么不存 |
| --- | --- | --- |
| committed | Σ ledgerEntries by account | 两份真相会漂移（F02.3） |
| proposal 是否可执行 | `evaluate(plugin, proposal, snapshot)`（06） | 约束随时变，存储值必然过时（I10） |
| 某人的审批状态 | 最新 decision；`constraintsVersion !== room.constraintsVersion` 显示 stale_approved / stale_rejected | 历史不可改，失效靠比较 |
| invite 过期 | `now > expiresAt` | 无需定时任务 |
| 房间是否可开始协商 | 全部 roleKey 有 participant 且有 briefVersion | 读时判断即可 |

## 5. 不变量清单（落点见 03 §6）

| id | 不变量 |
| --- | --- |
| I1 | 提案、决定、简报版本、目录修订、台账条目、事件只追加；proposal 只有 status 可变 |
| I2 | `proposals.seq` 在房间内唯一且严格递增（插入时读 room.proposalSeq+1 并写回，同一 mutation） |
| I3 | `constraintsVersion` 只经 `bumpConstraints` 改变 |
| I4 | 每个 (roomId, roleKey) 至多一个 participant；每个 (roomId, userId) 至多一个 participant（一人不能占两角） |
| I5 | 审批计入执行，当且仅当它是该 (proposalId, userId) 的最新 decision、为 approve、其 `constraintsVersion` 与 `contentKey` 等于当前值 |
| I6 | 每房间至多一个非终态 run（negotiating / pending_approval / needs_input / failed），由 `rooms.currentRunId` 唯一指向 |
| I7 | 必需审批集合在提案插入时从插件常量快照；不同 roleKey 的批准必须来自不同 userId（由 I4 推出，并在执行时再断言） |
| I8 | 对他方可见的文本只由插件模板从结构化字段渲染；模型自由文本（rationale）只给本方 |
| I9 | 所有金额是 `0 <= n <= 100_000_000` 的安全整数分；对每个账户，`Σ entries <= cap` 在每次执行提交后成立 |
| I10 | 每个 proposal 至多一个 execution；`operationId = exec:${proposalId}:${constraintsVersion}` 全局唯一 |
| I11 | 引擎代码不出现场景词（06 part2 §5） |
| I12 | 任何 seed / stub / 录制产生的记录 `simulated = true`，界面必须显示标签 |
