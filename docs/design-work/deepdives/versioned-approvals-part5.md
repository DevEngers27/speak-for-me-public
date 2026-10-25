# 专题深潜：版本化审批与约束失效（part5：与其他专题的接口、偏离记录、待验证）

## 1. 与其他专题的接口（按 brief §5 文件编号）

| 文件 | 本专题提供 | 本专题需要对方提供 / 拍板 |
| --- | --- | --- |
| 02-domain-model | INV-A1..A6、C1..C4、P1..P4、E1..E3、T1..T2、H1、R1；实体 constraintRevisions；"硬投影"概念 | 把 I3/I4/I10 替换为本表编号；briefVersions、catalogItems 的只追加版本化（RA-B05） |
| 03-schema | versioned-approvals/schema.ts：constraintRevisions、approvals（只追加 + seq）、proposals 字段改名 `createdAtConstraintsVersion`、agentTurns.constraintsVersion、humanRequests.cancelledByRevision、源表 producedConstraintsVersion | 统一表名（本稿已与 idempotent-execution 对齐为 `approvals`）；索引名规范 `by_a_and_b` |
| 04-state-machines | part3 §1.1 reconcile 分支表、§1.2 提案迁移表、§1.3 审批派生状态、§1.4 处境优先级 | run 迁移表需包含：pending_approval → pending_approval（约束变化但合规，无状态变化，仅记录）；所有 → superseded 的 endedReason `constraints_changed`；**回合持久化守卫按 D8 修订** |
| 05-protocol | 新 run 可沿用桌上提案进入审批（`accept_base` 类动作，part3 §1.1） | 动作名；`onProposalRejected` 的去向（negotiating vs needs_input）；humanRequest 选项如何声明它会改变哪些硬输入（供 B8/B9 判定，最终仍由投影比较决定） |
| 06-rules-engine | 要求 `evaluateProposal(proposal, inputs)` 与 `hardProjection` 共用 `loadConstraintInputs`；`preflightFeasibility` 签名 | reasonCode：`SOURCE_PRICE_CHANGED`、`SOURCE_ITEM_WITHDRAWN`、`APPROVER_SET_CHANGED`（预留）；预算比较用 `<=`（X20） |
| 07-permissions-privacy | 错误码清单（part2 §4.1）；事件只带 actorRole + causes + 计数，不带数值；constraintRevisions.actorUserId 不出公共视图 | 决定 provider 能否看到"是 finance 改了约束"（默认能看到角色与类别）；reject reasonCode 与 note 的可见性；`filterReasonCodesForRole` |
| 08-approval-execution | `decideOnProposal` 守卫顺序与返回形状；完成判定 `summarizeApprovals`；`isExecutable` | **冲突待裁决**：幂等键 `exec:${proposalId}`（D12）vs idempotent-execution D5 的 `exec:${proposalId}:${constraintsVersion}`；审批/执行守卫去掉 `proposal.constraintsVersion === room.constraintsVersion`（D7）；执行事务必须读 budgets 与 commitments 区间（已在 idempotent-execution D10） |
| 09-constraint-changes | 本专题即其核心：递增矩阵（part2 §3）、withConstraintChange / bumpConstraints / reconcileAfterBump、时序（part3 §2） | updateBudget、confirmBrief、confirmCatalogItem、answerRequest 的业务鉴权步骤 |
| 10-agent-runtime | INV-T1/T2；提前退出检查 | **冲突待裁决**：run-lifecycle 的 G3 `room.constraintsVersion === run.constraintsVersionAtStart` 与 G1 `run.status ∈ {negotiating, failed}` → 本稿建议改为 `turn.constraintsVersion === room.constraintsVersion`；`scheduleTurn` 写 turn.constraintsVersion；`supersedeRun` 的尽力 cancel |
| 12-api | public：`decideOnProposal`、（各业务）`updateBudget` / `confirmBrief` / `confirmCatalogItem` / `answerRequest` 都带 `expectedConstraintsVersion`？——见开放问题 O3；internal：无新增（bump 不是 Convex 函数，是 helper） | 函数命名统一（idempotent-execution 用 `approvals.decide`） |
| 13-frontend | 审批面板文案要素、stale 展示、"Terms unchanged… now evaluated under v{m}"、CONSTRAINTS_CHANGED 的刷新提示 | 具体措辞与布局 |
| 14-scenario-scope-change | 走查 part3 §2.1/§2.2（$5,000 → $4,800 与 → $4,950 两支） | fixture 中各条目价格使两支都可构造 |
| 16-testing | part4 §2 的 37 条 | 测试记录纪律（如实写明串行/并发） |
| 17-roadmap | 共享预算时 D9 失效的处理；房间级审批人配置走 B10 | — |
| 18-decisions | D1–D12 作为 ADR 素材；开放问题 O1–O4 | — |

## 2. 对输入的偏离记录（供 18 号 ADR）

| 输入 | 原建议 | 本稿 | 理由 |
| --- | --- | --- | --- |
| F08.1 / F03.7 | 同一 (proposalId, userId) 先查后 patch | 只追加 + seq（与 idempotent-execution D2 一致） | patch 会把旧版本审批改写成新版本，旧审批丢失（核心 6） |
| F09.3 / F04.4 / F08.4 第 3 步 / F04.2 审批守卫 | `isExecutable` 含 `proposal.constraintsVersion === room.constraintsVersion` | 不比较；字段改名 `createdAtConstraintsVersion` | 与 RA-R11 替代方案、回归 6 不相容（D7） |
| F09.2 第 4 步 | 任何约束变化都 run → superseded + 新 run | pending_approval 且仍合规时保留 run 与提案 | D6；其余分支与 F09.2 一致 |
| F04.2 回合守卫 / run-lifecycle G3 | 比较 `run.constraintsVersionAtStart` | 比较 `turn.constraintsVersion` | D8；否则 X12 卡死 |
| F08.4 第 5 步 / idempotent-execution D5 | `exec:${proposalId}:${constraintsVersion}` | `exec:${proposalId}` | D12；与 I5 一一对应 |
| F09.1 | 列表式递增点 | 列表 + 投影比较机制 | D4；防 RA-B02 类漏递增，且同值不递增 |
| idempotent-execution D2（推断） | approve 守卫未提及客户端版本 | 必须带 `expectedConstraintsVersion` | D3；防"在未见过的约束下批准" |

## 3. 开放问题

- **O1 分类失效**：是否允许"预算变化只作废 budget 类审批"？v1 否（D11）。若用户反馈重批负担大，再引入"按 kind 的相关性表"并补测试。
- **O2 上调预算后的重谈**（Q7）：v1 不自动；是否提供 `requestRenegotiation`（customer/provider 发起，pending_approval → negotiating）由 04/05 决定。
- **O3 其他约束写入是否也带 expectedConstraintsVersion**：例如 finance 改预算时基于过时页面。建议 `updateBudget` 带 `expectedConstraintsVersion` 做陈旧检查（避免两位操作者互相覆盖），但它不影响审批正确性，可列为 UX 选项。
- **O4 承诺变化与共享预算**（Q2）：v1 不 bump（D9）；共享预算落地时必须重新评估。

## 4. 待验证清单（平台事实与假设，供反驳者核对）

| # | 假设 | 依赖它的设计 | 依据 / 状态 |
| --- | --- | --- | --- |
| V1 | 同一 mutation 内读取能看到本事务先前的写入（read-your-writes），因此 `withConstraintChange` 的 after 投影反映 apply 的写入 | D4 | Convex 事务语义常识；inputs/04 §1.3 只写"全部读写原子提交"，未明确 read-your-writes：待验证（convex-test 可验证） |
| V2 | 两个 mutation 读写同一文档（room、budgets）时 OCC 使其可串行化，后提交者自动重试 | D3、D10、part3 §2.5、X8、X13 | inputs/04 §1.3；持续冲突的重试上限与报错形态待验证 |
| V3 | 索引区间读进入读集，对区间内插入产生冲突（用于 seq 唯一、approvals 去重） | INV-A5、G8 | inputs/04 part2 第 8 行：文档推论，待验证；convex-test 无法验证 |
| V4 | 索引末尾自动追加 `_creationTime` 作平局字段；`_creationTime` 是墙钟、不保证提交顺序 | 不用 `_creationTime` 定序（D2） | inputs/04 part2 第 10、12 行（源码引用） |
| V5 | `ctx.scheduler.cancel` 不能中止在途 action；对已完成函数抛错 | reconcile 的"尽力 cancel"、提前退出检查 | inputs/04 part1 第 65 行 |
| V6 | 被调度的 action 至多执行一次、不重试 | 不需要 lease；(runId, turnSeq, cv) 守卫足够 | inputs/04 要点 1 |
| V7 | `ctx.auth.getUserIdentity().tokenIdentifier` 全局唯一且稳定 | userId、INV-E3 | inputs/04 要点 6 |
| V8 | `returns` validator 对 `v.object` 拒绝多余字段 | decide 的返回形状不泄露额外字段 | inputs/02 F03.16：据文档，未本地运行，待验证 |
| V9 | `ConvexError` 的 data 字段可携带结构化 `{ code, currentConstraintsVersion }` 到客户端 | G6 的刷新提示 | 待验证（具体客户端错误形态） |
| V10 | `.withIndex(...).order("desc").first()` 在复合索引前缀上按剩余字段（seq）倒序 | `latestDecision` | Convex 索引排序常识；待验证 |
| V11 | mutation 中 `Date.now()` 可用且在 OCC 重试时重新取值 | decidedAt、createdAt | 待验证（不影响正确性，只影响时间戳） |
| V12 | 首个场景每角色恰一人、一人不能占多个角色（acceptInvite 守卫） | summarizeApprovals 用 `find` 取角色持有人 | inputs/02 F02.6 设计要求；若改为多人/角色，需改为"任一当前持有人" |
