# 08 审批与执行 · part2：并发与重复、记录预览、执行边界、后续变更、失败模式

## 5. 并发与重复的逐案分析

所有涉及的 mutation 都 patch 同一 `rooms` 文档（M-ROOM），OCC 让它们串行提交；被回滚者由 Convex 自动重试，重试时读到前者的结果。

| 场景 | 时序 | 结果 | 依赖的不变量 |
| --- | --- | --- | --- |
| 同一人双击 Approve | 两次独立调用（客户端重连重发同一调用由 Convex 去重，inputs/04 §1.11；双击是两次调用） | 第二次在步骤 4 读到最新决定已是 approve → `unchanged`，无事件、无执行 | DE-5 |
| 最后两票由两人并发提交 | A、B 都读到"另一人未批" | 先提交者只写决定；后者重试时完成判定成立并执行。若二者都恰好是"最后一票"（不可能，因为需要三票），也只有一个能执行，另一个在 `by_proposalId` 命中 | EX-1、DE-4 |
| 最后一票与 finance 下调预算并发 | 两者都 patch rooms | 下调先提交：审批重试时 cv 已变，步骤 2 若 run 已 superseded → `PROPOSAL_NOT_CURRENT`；若仍可执行（R-10 不迁移分支）→ 决定绑定新 cv，旧批准不计数，不会执行。审批先提交并执行：下调重试时 `budgetCapCents ≥ committed` 以新台账判断 | DE-3、EX-5、CS-5 |
| 审批与迟到的模型结果并发 | pending_approval 时没有活动回合；若有迟到结果，其 run 已非当前或非 negotiating | 结果被 `assertTurnLive` 拒收为 stale | RN-3 |
| 网络重试同一次 `decisions.record` | Convex 客户端重发在途 mutation，后端去重 | 只提交一次 | 平台语义 |
| 执行后有人再点 Approve | run 已 executed，`currentProposalId` 为空 | `PROPOSAL_NOT_CURRENT` | PR-4 |
| 有人用脚本直接调 internal 执行函数 | internal 函数不暴露给客户端 | 不可能 | 平台语义 |

验证方式：convex-test 串行执行，证明不了 OCC（inputs/04 §1.12）。并发用例用脚本对真实 dev 部署并行调用公共 mutation（同一 proposal 5 个并发 approve、approve 与 updateBudgetCap 交错），再用 `ops.auditRoom` 断言 executions、commitments 只多一行（16 §5）。

## 6. 拒绝与撤回的后续

- **拒绝**：必须带场景 reasonCode（customer：`SCOPE_UNACCEPTABLE` / `DATE_UNACCEPTABLE` / `PRICE_UNACCEPTABLE`；provider：`TERMS_UNACCEPTABLE` / `CAPACITY_CONFLICT`；finance：`BUDGET_POLICY` / `PAYMENT_TERMS`），可附 note（作者选择是否公开）。立即：run superseded → 新 run（trigger human_reject），新 run 的代理在 `feedback` 中看到拒绝方角色、reasonCode 与公开 note（作为不可信文本）。
- **撤回**：只撤回自己的批准，执行前有效；追加 `withdraw`，该角色状态回到 pending；不影响 run 状态。撤回不需要理由（Role A Q6：v1 选简单）。
- **约束变化后的旧决定**：保留；界面显示 stale_approve / stale_reject，并说明约束从 v{n} 变为 v{m}。

## 7. 变更单、承诺、任务的派生与审批前预览

- 变更单 = `executions` 行；编号 `CO-{number:04d}`；内容 = 提案条款（不可变）+ 执行元数据。
- 承诺 = 一条 `commitments`，金额 = 提案 `amountCents`。
- 任务 = 每个包含的报价行一条，标题来自 `taskTitle`，指派 provider，截止 = 交付日（`deriveExecution`，06 §11）。
- `rooms.workspace` 为当前提案返回 `executionPreview`：`{ recordKind, amountCents, tasks[], budgetImpact? }`，其中 budgetImpact 按派生闭包投影（finance 与获得披露的 customer 看到"执行前 $4,000 → 执行后 $4,750 / 上限 $4,800"）。审批人在点击前就能看到批准会写入哪些记录（Role A RA-B19 的修正）。
- 结果页的"执行前 / 后"读 `budgetSnapshot`，不再用减法推算，之后的承诺不会改变旧变更单的显示（RA-B09）。

## 8. 执行边界（核心 7）

- 执行只写本系统内部的四类记录（executions、commitments、tasks、events）与约束集；不调度任何 action、不 fetch（平台禁止 mutation 做外部 I/O），因此不可能在执行事务中转账、签约或写外部 ERP（EX-6）。
- 幂等只承诺内部记录；不宣称对外部系统 exactly-once（P-05）。外部集成的扩展方式是 outbox（17）：执行事务里追加一条 `outbox` 行，由独立 action 投递并自带幂等键——v1 不建这张表。
- 变更单页面与打印视图顶部固定声明："Internal record only. No payment, transfer, contract signature, or ERP update happens in Speak for Me." v1 不提供 CSV 导出（避免公式注入，F07.10 #7）。

## 9. 修订已执行的协议（GAP-13、AX-10）

- 已执行的变更单永不修改（EX-1、只追加）。
- "后续变更"（例如把延后的 CSV_EXPORT 做成二期）= 同一房间新开 run（`runs.start`，trigger manual）。新 run 以执行后新的约束版本为基线（已承诺包含一期），产出新的提案、新的变更单。房间保留完整历史，比"新开房间"更可追溯（Role A RA-S05 的修正）。
- "取消或缩减已执行的变更单"需要负金额调整与修订链（`revisesExecutionId`、台账调整条目），v1 不支持，界面不提供入口；17 定义扩展方式。金额非负（VAL-1）在 v1 内保持成立。

## 10. 失败模式

| 失败 | 发生在 | 后果 | 恢复 |
| --- | --- | --- | --- |
| 审批时提案已不是当前 | record 步骤 2 | 拒绝，返回当前提案版本 | 界面刷新到当前提案 |
| 审批时检查不通过（例如跨日后交付日已过） | record 步骤 6 | 拒绝，返回投影后的 reasonCode | 任一方 `runs.requestRenegotiation` |
| 最后一票时重算发现失败 | executeIfReady 步骤 3 | 决定已写入，未执行，返回 blocked | 同上；界面显示"已批准但当前不可执行"及原因 |
| CS-4 断言失败 | executeIfReady 步骤 4 | 整个事务回滚（含该决定），返回内部错误码 `INVARIANT_VIOLATION`，告警 | 运维用 `ops.auditRoom` 定位；这只可能来自代码缺陷 |
| OCC 持续冲突 | 任意 | Convex 重试若干次后报错（具体次数待验证 #2） | 客户端显示可重试错误；业务幂等保证重试安全 |
| 房间在审批期间被关闭 | rooms.close | run cancelled，审批入口拒绝 `ROOM_CLOSED` | — |

## 11. 验收对应

AC-G5 / AC-S6（恰好一次）→ §4、§5；AX-01/02（批准具体版本、双绑定）→ §1；AX-06/07（拒绝过期审批、保留历史）→ §1、§6；AX-11（审批界面显示确切条款与版本）→ 13 的提案卡；AX-12（可拒绝）→ §3；AX-13/14（修订关系、执行产物）→ §7、§9。
