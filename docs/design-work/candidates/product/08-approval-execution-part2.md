# 08 审批与执行（part2）：执行事务、失败分支、记录派生、幂等与并发

## 8.7 执行事务分步时序

执行**不**是单独的 action、调度任务或按钮：它发生在完成最后一个必需签核的那次 `decisions.record`（或 `requests.answer` 带 `alsoApprove`）mutation 内，与那条签核同一事务（RA-R07、F08.4）。

`decisions.record({proposalId, kind:"approve", expectedConstraintsVersion, expectedTermsKey})`：

| 步 | 动作 | 读 | 写 | 失败 → 结果 |
| --- | --- | --- | --- | --- |
| 1 | `requireViewer`；读提案；`requireSeat(proposal.roomId)`；`assertRoomOpen` | users、proposals、seats、rooms | — | `UNAUTHENTICATED` / `NOT_A_MEMBER` / `ROOM_CLOSED`，不写 |
| 2 | 若 `proposal.status === "executed"`：按 `executions.by_proposal` 取执行，返回 `{status:"executed", executionId}` | executions | — | 幂等返回 |
| 3 | G-SIGN：当前且 active、约束版本与 termsKey 匹配、席位在 `requiredSignoffs` | rooms | — | `PROPOSAL_NOT_CURRENT` / `CONSTRAINTS_CHANGED` / `TERMS_CHANGED` / `ROLE_NOT_PERMITTED` |
| 4 | `today = computeToday(room.timeZone, Date.now())`；`view = buildRuleView(ctx, room, today)` | briefVersions（每席位最新）、listItems（confirmed）、commitments（active） | — | — |
| 5 | G-EVAL：`evaluateProposal(plugin, proposal.terms, view)` 全部通过 | — | — | `PROPOSAL_NOT_EXECUTABLE`（`params` 只含检查 id 与按调用者投影的原因码） |
| 6 | 读本提案**全部**签核（`by_proposal_seat` 前缀区间） | decisions | — | — |
| 7 | 若本席位当前最新已是 approve：跳过第 8 步（幂等），继续第 9 步 | — | — | — |
| 8 | 追加 decision；事件 `decision_recorded` | — | decisions、events | — |
| 9 | `executeIfComplete`：`signoffStates(...)`，未完成 → 返回 `{status:"recorded"}` 或 `already_recorded` | — | — | — |
| 10 | `operationKey = "exec:" + proposalId + ":" + room.constraintsVersion`；`executions.by_operation` 命中 → 返回已有（防御） | executions | — | 幂等返回 |
| 11 | 计算：`amount = plugin.records.commitmentCents(terms)`；`before = view.ledger.committedCents`；`after = before + amount`；`assertCents(after)`；快照 `plugin.records.snapshotFields` 的值；任务草稿 `plugin.records.tasks(terms, view)`；把 `assigneeRoleKey` 映射为席位 | — | — | 插件异常 → 整笔回滚（视为 bug，告警） |
| 12 | 插入执行记录（`number = room.executionSeq + 1`、冻结条款、`decisionIds`、快照、`recordsVersion`） | — | executions | — |
| 13 | `amount > 0 && plugin.ledger` → `appendCommitment(kind:"execution", label:"CO-n", executionId)` | — | commitments、rooms.ledgerSeq | — |
| 14 | 插入任务（`ordinal` 顺序） | — | tasks | — |
| 15 | 提案 → `executed`（`assertTransition`）；room：清空 `currentProposalId`，设 `lastExecutionId`、`executionSeq`，`negotiationOpen = false` | — | proposals、rooms | — |
| 16 | `bumpConstraints(cause:"execution", refs:{executionId})`：active run → superseded，open 请求 → superseded，`constraints_changed` 事件，调度 `afterConstraintChange`（因 `negotiationOpen` 为 false 不会开 run） | runs、humanRequests | constraintRevisions、rooms、runs、humanRequests、events | — |
| 17 | 事件 `execution_completed`；返回 `{status:"executed", executionId}` | — | events | — |

步骤 1–17 是一个 Convex mutation：任一步抛错，全部写入（包括第 8 步的签核）回滚，客户端收到错误码，界面刷新到最新状态。

## 8.8 失败分支

| 场景 | 发生在 | 用户看到 | 数据状态 |
| --- | --- | --- | --- |
| 签核同时预算被下调 | 步 3（OCC 重试后） | "Constraints changed while you were approving. Nothing was recorded." | 无变化（X3） |
| 签核同时新提案出现 | 步 3 | "A newer proposal (v3) replaced v2." | 无变化 |
| 报价恰在今天过期 | 步 5 | "Quote line REPORTS expired on 2026-11-30." | 无变化 |
| 最后两人并发签核 | 步 6 的区间读与对方的插入冲突 → OCC 重试 | 两人都看到 "Executed · CO-1" | 恰好一条执行（8.10） |
| 客户端断线重发 | 步 2 或步 7/10 | 正常结果 | 无重复 |
| OCC 持续冲突超过平台重试上限 | Convex 抛错（形态待验证） | 通用错误 + 重试按钮 | 无变化；重试幂等 |
| 插件派生抛错 | 步 11 | "Something went wrong; nothing was recorded." | 无变化；运维告警（插件 bug） |

不存在"全部签核已到齐但未执行"的悬空状态：要么同一事务执行，要么签核本身没有写入。因此不需要"重试执行"入口，也不需要 Role A 的 "Send the execution request again" 按钮（RA-U12）。

## 8.9 记录派生（scope_change）

| 记录 | 规则 | 例（v2：LOGIN + REPORTS · standard） |
| --- | --- | --- |
| 执行记录（变更单） | 冻结 `terms`；编号 `CO-{n}` | CO-1：LOGIN $450、REPORTS $300，standard，交付 2026-11-20，延后 EXPORT，+$750 |
| 预算承诺 | `amountCents = terms.amountCents`，`kind: "execution"`，标签 `CO-1` | +$750；台账 $4,000 → $4,750 |
| 任务 | 每个包含的报价行一条："Deliver {scope title}"（变体时附 "(variant: …)"）；assignee = provider 席位；due = 该行的交付日（按所选 schedule） | "Deliver SSO login revamp" due 2026-11-20；"Deliver Usage reports dashboard" due 2026-11-20 |
| 快照 | `finance.budgetCapCents` | 480000（只对能看见上限的查看者投影） |

`recordsVersion = "scope_change@1"`；派生规则改变必须提升插件版本（03 第 3.24 节）。

## 8.10 幂等与并发分析

| 竞争 | 防线 1 | 防线 2 | 证明方式 |
| --- | --- | --- | --- |
| 同一人双击 approve | 步 7：最新已是 approve → 不追加 | 两次调用若并发，读同一区间、写同一区间 → OCC 串行，第二次走步 7 | 真实部署：同一身份并发 5 次，`decisions` 只多 1 行 |
| 两个不同席位的最后签核并发 | 步 6 读取整个提案的签核区间，对方插入落在读集 → 后提交者重试，看到对方签核后完成执行 | 步 10 `operationKey` 查重；步 2 `status === "executed"` | 真实部署：两身份同时签核，`executions`/`commitments` 各 1 行、任务 N 行 |
| 执行与约束变更并发 | 两者都读写 `rooms`，OCC 串行 | 执行后 `negotiationOpen = false`、约束递增；预算变更后签核 stale | 集成测试 + 并发脚本 |
| 执行与回合落库并发 | 执行递增约束版本 → G-PERSIST 失败 → 回合 stale | — | 集成测试 |

convex-test 中函数串行执行，无法证明 OCC（F08.5、04 平台约束 1.12）；上述"真实部署"测试作为发布前的必跑脚本（16）。证据里如实写明测试方法。

## 8.11 执行边界与执行之后

- 执行只写 `executions`、`commitments`、`tasks`、`proposals`、`rooms`、`constraintRevisions`、`events`、`runs`、`humanRequests`；执行模块不得导入任何 action、HTTP 客户端或外部 SDK（lint，I-22）。不转账、不签约、不写外部 ERP；幂等只对内部记录承诺，不宣称外部 exactly-once（P-04、P-05）。
- 将来的外部集成走 outbox：执行事务只追加一条 `outbox` 记录，由独立 action 投递并自带幂等键（17），从不在执行事务内调用外部系统。
- 执行后房间进入 `executed` 阶段；约束变化不再自动开 run。"Start a follow-up change" → `negotiation.requestRun` 把 `negotiationOpen` 置回 true（C12）。
- 已执行变更单不可修改；修订（冲销、改金额、取消任务）列入 17，并要求以新执行记录 + 冲销台账条目的方式追加，而非修改原记录。
