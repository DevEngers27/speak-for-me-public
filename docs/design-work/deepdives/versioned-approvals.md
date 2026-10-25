# 专题深潜：版本化审批与约束失效（part1：目标、范围、决定）

> 依据：00-brief §3 核心 3/4/5/6、inputs/02 F02.9 I1–I10、F03.6/F03.7/F03.9/F03.10、F04.2/F04.4/F04.5/F04.7、F08.1–F08.4、F09.1–F09.4；inputs/03 RA-D03、RA-D12、RA-R10、RA-R11、RA-B02/B04/B06/B18/B30、§10.2 回归 1–15；inputs/04 §1.3（OCC）、part2（索引平局字段、commitTs）。
>
> 文件清单：
> - versioned-approvals.md（本文件）：目标与范围、决定与理由
> - versioned-approvals-part2.md：不变量清单、字段摘要、递增矩阵、守卫
> - versioned-approvals-part3.md：状态迁移（reconcile 分支、提案、审批派生状态、处境）、流程时序、历史展示
> - versioned-approvals-part4.md：反例与边界表（X1–X28）、测试清单（37 条）
> - versioned-approvals-part5.md：与其他专题的接口（按 brief §5 文件编号）、对输入的偏离记录、开放问题、待验证清单
> - versioned-approvals/schema.ts：validators 与表定义片段
> - versioned-approvals/standing.ts：纯函数（审批汇总、提案处境、isExecutable）
> - versioned-approvals/constraints.ts：`withConstraintChange` / `bumpConstraints` / `reconcileAfterBump`
> - versioned-approvals/decide.ts：`decideOnProposal` mutation 骨架与守卫顺序

## 1. 目标与范围

### 1.1 要解决的问题

1. **审批到底对什么成立**。旧 schema 只存版本号，Role A 用 (proposalVersion, constraintsVersion) 两个整数做键，提案可变、版本不唯一，旧签字可能落到新方案上（F08.1、RA-D12）。
2. **constraintsVersion 何时递增没有定义**（F09.1，技术 blocker 之一）。Role A 只在改预算时递增，改简报硬约束、改报价都不递增，旧审批继续"有效"（RA-B02、RA-B04）。
3. **"可执行"被存成状态**，与实时数据漂移（RA-B17、F09.3、I10）。
4. **约束变化后提案怎么办**：Role A 复制一个 revalidated 新版本（RA-R11，已否决）；审查建议"run → superseded + 新 run"（F09.2）；回归测试 6 又要求"降上限后当前提案仍可行时不产生新版本、对同一 proposalId 重新批准后可执行"。三者需要统一。
5. **回合进行中约束变化**：在途模型调用的结果必须被拒收，且不能误伤之后合法的回合。
6. **历史**：旧审批、旧拒绝、旧提案、每次约束变化的原因都要保留并能展示（核心 6、RA-B06、RA-B30）。

### 1.2 本专题负责

- 不变量：审批成立的条件、constraintsVersion 与 proposalVersion 的语义与分配者。
- 递增矩阵：哪些写入递增 constraintsVersion、哪些不递增，以及保证"不漏递增"的机制。
- 派生计算：`summarizeApprovals`、`deriveProposalStanding`、`isExecutable`。
- 审批决定的写入（approve / reject / withdraw）及其守卫顺序。
- 约束变化后对 run、提案、人工请求、在途回合的处理（`reconcileAfterBump`）。
- 反例表、测试清单。

### 1.3 本专题不负责（只给接口）

- 执行事务本体（变更单、承诺、任务的派生）→ 08。本文只规定"执行在哪个守卫下被调用、用什么幂等键"。
- 规则本体（`evaluateProposal` 的检查集与 reasonCode）→ 06。本文只规定它的输入必须是 `loadConstraintInputs` 的输出。
- 预算可见性、事件措辞、reasonCode 按角色过滤 → 07。
- run 的完整迁移表、回合调度与重试 → 04、10。本文只给出约束变化引发的那几条迁移与回合持久化守卫的修订。

## 2. 决定与理由

每条：决定 → 理由 → 被否决的备选 → 带来的不变量。

### D1 审批只对 (proposalId, constraintsVersion) 成立

- **决定**：一条审批决定绑定不可变的 `proposalId`（条款）与做决定时房间的 `constraintsVersion`（约束）。审批"对当前有效"当且仅当 `decision.proposalId === room.currentProposalId && decision.constraintsVersion === room.constraintsVersion` 且它是该用户在这一对键上的最新决定。
- **理由**：提案只追加（I1），proposalId 即证明"批准的就是这份条款"；约束版本证明"批准时看到的是这套约束下的评估"。两者都是服务端可核对的事实。
- **否决**：(a) 绑定 proposalVersion 整数——依赖版本号唯一性，且需二次查找；(b) 额外存 contentHash——提案不可变时冗余，且 Convex 运行时 `crypto.subtle` 行为待验证（F03.7）；可读证据用 `termsKey` 规范字符串，由 03 决定是否保留。
- **不变量**：INV-A1（见 part2 §1）。

### D2 审批决定只追加，不 upsert

- **决定**：`approvals` 表改为只追加，每行不可变；`decision ∈ 'approve' | 'reject' | 'withdraw'`；同一 (proposalId, userId) 内用服务端分配的 `seq` 定序；"当前决定"= 在 (proposalId, userId, constraintsVersion) 上 seq 最大的一行。
- **理由**：F08.1/F03.7 建议"同一 (proposalId, userId) 先查后 patch"，但这会在重新批准时把 v2 的旧审批改写成 v3，**旧审批丢失**，违反核心 6 与 AX-07；也重蹈 RA-B06（改写拒绝历史）。只追加让"stale_approve（v2）""先拒后撤再批"都可追溯（回归 5、15）。
- **否决**：upsert（丢历史）；两表分存 approve/reject（RA-D12 问题 1）。
- **去重**：同一用户在同一 (proposalId, constraintsVersion) 上重复提交与当前决定相同的 decision → 不插行、不写事件、返回已有 decisionId（双击不产生噪音行）。
- **为什么不用 `_creationTime` 定序**：inputs/04 part2 指出 `_creationTime` 是墙钟、不保证与提交顺序一致；`seq` 在同一 mutation 内按索引读最后一行再 +1，OCC 保证不重复（I-UNIQ 落点见 part2 §6）。

### D3 approve 必须携带 expectedConstraintsVersion（比较并设置）

- **决定**：`decideOnProposal({ proposalId, decision, expectedConstraintsVersion, ... })`；服务端若 `room.constraintsVersion !== expectedConstraintsVersion` 则拒绝 `CONSTRAINTS_CHANGED`，要求用户重新查看。
- **理由**：条款不可变，用户看到的页面与点击之间唯一可能变的是约束（及其评估）。没有这一步，"用户在 v2 下看到可行，点击时预算已降到 v3"会被记成"在 v3 下批准"——用户从未见过的约束。客户端传入的只是陈旧检查值，不是授权依据；恶意客户端传当前版本等价于"不看就批"，不获得任何额外权限。
- **否决**：只用服务端当前版本（上述竞态）；要求客户端传 proposalVersion（proposalId 已足够）。

### D4 constraintsVersion 只经 `bumpConstraints` 改变，且由"硬投影比较"决定是否递增

- **决定**：所有可能改变硬约束的 mutation 都把写入包在 `withConstraintChange(ctx, { roomId, cause, actor }, apply)` 里：先 `loadConstraintInputs` 求 `hardProjection`（before），执行 `apply` 写入，再求 after；`!equalHard(before, after)` 时调用唯一的 `bumpConstraints`。递增矩阵（part2 §3）列出调用点，投影比较保证"无实质变化不递增、实质变化必递增"。
- **理由**：RA-B02 正是"开发者判断这次写入不算约束变化"导致的漏递增。投影与 `evaluateProposal` 读同一个 `loadConstraintInputs`，所以"规则读到的东西变了"⇔"版本变了"，不依赖人工判断。同一 mutation 内读回自己的写入是 Convex 事务语义，before 无需持久化（不会把私密值写进共享表）。
- **否决**：(a) 只靠列表、每处手动 `bump`——易漏；(b) 每次写约束源都无条件递增——"把预算改成同一个值"会无谓作废全部审批；(c) 存投影哈希——小值域（预算）可被枚举反推，有隐私风险。
- **不变量**：INV-C1..C4。

### D5 "硬"的定义 = 被 `evaluateProposal` 读取的字段

- **决定**：硬投影包含：预算总额、customer 已确认简报中的 `requiredItemKeys`、`deferrableItemKeys`、`deadline`；全部已确认目录条目（当前版本的 itemKey、priceCents、交付日期字段、catalogItemId）；必需审批角色集合（v1 为场景常量）。**不含**：软偏好（`preferredDate`）、披露设置（shareableFacts）、显示名、房间标题/目标、草稿、未确认目录建议、承诺台账（见 D9）。
- **理由**：核心 3 说"约束变了必须重新审批"；"约束"在可核对意义上就是规则的输入。软偏好只影响协商（F09.1【改写】），披露只影响代理上下文，不改变"这份条款在这套约束下是否合规"。

### D6 约束变化后：当前提案若仍合规则保留，不复制、不重谈

- **决定**：`reconcileAfterBump` 按当前 run 状态分支（part2 §5）。关键一支：run 为 `pending_approval` 且当前提案在新约束下 `evaluateProposal` 通过 → **run 保持 pending_approval，提案保持 active，不产生新提案版本**；所有在旧版本上的审批自然变为 stale（派生），写 `reapproval_required` 事件，三方对同一 proposalId 重新批准即可执行（回归 6、RA-R11 替代方案）。不合规 → run → superseded，新 run（trigger `constraints_change`）开始重谈，或预检无解时直接进入 needs_input。
- **理由**：条款没变就不该出现"两行完全相同的版本"（RA-R11 否决理由 3）；也不该为一次不影响合规的变化花一轮模型调用并可能换掉人已经看过的方案。
- **否决**：(a) 一律 supersede + 重谈（F09.2 第 4 步原样）——成本高、可能无故换方案；(b) 复制 revalidated 版本（RA-R11）——已否决。
- **代价**：上调预算后不会自动寻找更优方案（Q7）。v1 由 customer/provider 显式发起重谈（接口见 part4，归 04/05）。

### D7 isExecutable 不比较 proposal 的创建时约束版本

- **决定**：提案字段改名 `createdAtConstraintsVersion`（只作来历与展示）。`isExecutable` = 提案是当前且 active ∧ 当前 run 为 pending_approval ∧ `evaluateProposal(proposal, inputs@room.constraintsVersion)` 通过 ∧ 每个快照必需角色都有一条当前有效的 approve，且来自该角色**当前**成员的不同 userId。
- **理由**：F09.3/F08.4 的公式 `proposal.constraintsVersion === room.constraintsVersion` 与 D6 不相容——它让仍合规的提案在任何约束变化后永远不可执行，只能复制（即被否决的 RA-R11）。约束绑定已由审批行承担（D1），提案侧只需"在当前约束下重算合规"。改名是为了防止实现者照旧公式误用该字段。
- **不变量**：INV-E1..E3；isExecutable 永不入库（I10）。

### D8 回合持久化守卫改用回合快照的约束版本

- **决定**：`agentTurns.constraintsVersion` 在**调度该回合的 mutation 中**写入（= 当时 room.constraintsVersion）。`completeTurn` 的守卫为：`room.currentRunId === runId ∧ run.status === 'negotiating' ∧ run.nextTurnSeq === turnSeq ∧ turn.constraintsVersion === room.constraintsVersion`。`runs.constraintsVersionAtStart` 保留，仅作来历。
- **理由**：D6 让 run 可以跨越一次约束变化（pending_approval 保留分支）；之后若被拒回到 negotiating，F04.2 的 `room.constraintsVersion === run.constraintsVersionAtStart` 会把所有新回合误判为过期。回合快照严格更精确：它就是"该回合上下文是在哪个约束版本上组装的"。
- **否决**：每次 bump 都 supersede run（见 D6 否决 a）；保留 run 但 patch constraintsVersionAtStart（字段语义变成可变，来历丢失）。

### D9 执行（写入承诺）不递增 constraintsVersion

- **决定**：承诺台账变化不触发 bump；执行事务内用实时台账重算预算（F08.4 第 4 步）。
- **理由**：v1 一房一预算、每房至多一个活动 run；台账只在当前提案执行时变化，执行后 run 进入终态，不存在"其他仍有效的审批"需要作废。重算已覆盖台账变化。若递增，每次执行都会产生一条无意义的 constraints_changed。
- **边界**：若将来多个房间共享预算（Q2），A 房执行会改变 B 房的可行性；届时要么承诺插入对所有共享房间 bump，要么接受"审批显示有效但执行被重算阻断"。列入 17。

### D10 proposalVersion 由 `insertProposal` 单点分配

- **决定**：唯一写提案的 helper `insertProposal(ctx, roomId, draft)`（只被 internal mutation 调用：`completeTurn` 与代码生成候选）读 `room.proposalVersion`、+1、patch room、插入提案。房间级单调，**不因新 run 重置、不因约束变化递增**（F04.7）。分配发生在持久化守卫通过之后，被拒收的回合不消耗版本号。
- **唯一性**：(roomId, version) 唯一由"同一 mutation 先读 room 再写 room"保证——并发写同一 room 文档必然 OCC 冲突重试（inputs/04 §1.3）。

### D11 统一失效：任何硬约束变化作废全部当前审批，不分 terms/budget

- **决定**：不做"预算变化只作废 budget 类审批"之类的分类失效。
- **理由**：核心 3 要求简单可解释："约束变了 → 重新审批"。分类失效需要证明某类约束与某类审批无关，规则一多就会出错。代价是 UX：finance 改预算后 customer/provider 也要重新点一次。列为开放问题（part4 §3）。

### D12 执行幂等键建议为 `exec:${proposalId}`

- **决定（建议给 08）**：主防线仍是状态守卫；第二道保险的幂等键用 `exec:${proposalId}`，changeOrder 另存 `constraintsVersion`。
- **理由**：D6 后同一提案可能在 v2、v3 先后进入审批；F08.4 的 `exec:${proposalId}:${constraintsVersion}` 会允许同一提案在两个约束版本下各执行一次，削弱 I5"每个提案至多执行一次"。按 proposalId 取键与 I5 一一对应。
