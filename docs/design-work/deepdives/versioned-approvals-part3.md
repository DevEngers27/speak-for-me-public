# 专题深潜：版本化审批与约束失效（part3：状态迁移、流程时序、历史展示）

## 1. 状态迁移

### 1.1 `reconcileAfterBump`：约束变化对当前 run 的影响

在 `bumpConstraints` 同一事务内、版本已 +1、open 请求已取消之后执行。`ok` 指 `evaluateProposal(currentProposal, inputs@新版本).ok`。

| 当前 run 状态 | 条件 | run 迁移 | 提案 | 其他 | `constraintRevisions.runEffect` |
| --- | --- | --- | --- | --- | --- |
| 无活动 run（无 run / confirmed / superseded / cancelled） | — | 无 | 无 | 不自动开新 run（开局由人显式发起，05） | `none` |
| pending_approval | `ok` | 保持 pending_approval | 保持 active，不产生新版本 | 写 `reapproval_required` 事件（含被作废的决定数，不含人名与数值） | `kept_pending_approval` |
| pending_approval | `!ok` | → superseded（endedReason `constraints_changed`） | 保持 active（仍是"桌上的方案"，作为新 run 的 base），派生处境 = blocked | 预检：`preflightFeasibility(inputs)`；可行 → `startRun({ trigger })`；不可行 → `startRun` 后立即 → needs_input 并创建 humanRequest（05/06） | `run_superseded` |
| negotiating | — | → superseded | 若有当前提案则保持 active | 同上：新 run 或 needs_input；在途回合由 INV-T1 拒收；尽力 `scheduler.cancel` 未开始的回合 action | `run_superseded` |
| needs_input | — | → superseded | 同上 | open 请求已被 INV-H1 取消；新 run 的 trigger：cause 含 `human_answer` → `human_answer`，否则 `constraints_change` | `run_superseded` |
| failed | — | → superseded | 同上 | 同上 | `run_superseded` |

说明：

- pending_approval 且 `ok` 是唯一"run 跨越约束版本"的分支，它要求 D8 的回合快照守卫（被拒后回到 negotiating 时，新回合快照新版本，不会被误判过期）。
- `!ok` 分支不清空 `currentProposalId`：阻断瞬间完成（F09.3），所有窗口立即看到"v3 blocked under constraints v2"，重谈结果随后异步替换它。
- 新 run 若决定沿用桌上的提案（新约束下合规，例如 negotiating 中途的无关变化），可由 completeTurn 以 `accept_base` 类动作把 run 推进到 pending_approval，**不插新提案**（05 定义动作名）；审批守卫 G5 看当前 run 而不是 `proposal.runId`，所以可行。

### 1.2 提案状态（存储）

| from | to | 触发 | 守卫 | 同事务的其他写入 |
| --- | --- | --- | --- | --- |
| （插入） | active | `insertProposal`（completeTurn 或代码生成候选） | 持久化守卫通过；`evaluateProposal` 结果写入 `validationAtCreation` | 旧 active → superseded；`room.currentProposalId = new`；`room.proposalVersion += 1` |
| active | superseded | 新提案插入（同上） | — | — |
| active | executed | 执行事务 | 审批/执行守卫 + `isExecutable` 重算 | changeOrder 等（08）；`room.currentProposalId` 保持指向它，供结果页 |
| superseded / executed | 任何 | 禁止 | `assertProposalTransition` 抛 `ILLEGAL_TRANSITION` | — |

约束变化**从不**改变提案存储状态；"blocked"只是派生处境。

### 1.3 审批的派生状态（不入库）

对某个提案与某个必需 (role, kind)：

| 派生状态 | 条件 | UI 文案（英文，13 决定最终措辞） |
| --- | --- | --- |
| `approved` | 当前成员在当前 cv 上的最新决定为 approve | Approved under constraints v{cv} |
| `rejected` | 同上为 reject | Rejected under constraints v{cv} |
| `pending` | 当前 cv 上无决定（或最新为 withdraw），且更早 cv 上也无决定 | Awaiting decision |
| `stale_approve` | 当前 cv 上无有效决定，最近一次更早 cv 的决定为 approve | Approved under v{old}; constraints changed — re-approval needed |
| `stale_reject` | 同上为 reject | Rejected under v{old}; constraints changed（RA-B30：不得显示为 pending） |
| `historical` | 提案不是当前提案（superseded / executed 以外的旧提案） | 只列出决定历史，不计算待办 |

### 1.4 提案处境 `ProposalStanding`（派生，`deriveProposalStanding`）

`executed` → `superseded` → `blocked`（规则不过）→ `renegotiating`（合规但当前 run 不在 pending_approval）→ `awaiting_approval`（合规、待批未齐）→ `executable`（全部到齐；正常情况下执行与最后一票同事务，因此该值只在守卫内部出现，不会被持久观察到）。按此顺序取第一个命中值。

## 2. 流程时序

### 2.1 审批期间预算下调，当前提案变为超支（AC-G4 标准走查）

前提：cv=3，提案 v3 = $900，已承诺 $4,000，预算 $5,000；customer、provider 已在 cv=3 上 approve；run R2 = pending_approval。

1. finance 调 `updateBudget({ roomId, newTotalCents: 480000, reason })`。
2. 业务 mutation：鉴权 finance → `withConstraintChange(ctx, { roomId, cause: 'budget', actor }, apply)`。
3. before = `hardProjection(load())`；apply：`assertCents`、读台账 committed = 400000、480000 ≥ 400000 通过、patch budgets、插入 budgetChanges。
4. after ≠ before → `bumpConstraints`：room.cv 3→4；插入 constraintRevisions(v4, causes [budget])；open 请求取消（无）；回填 `budgetChanges.producedConstraintsVersion = 4`。
5. `reconcileAfterBump`：R2 pending_approval，evaluate(v3, inputs@4) → OVER_BUDGET → `!ok`；R2 → superseded；preflight：剩余 $800，目录存在合规组合 → `startRun({ trigger: 'constraints_change', constraintsVersionAtStart: 4 })` → R3 negotiating，调度第一回合（turn.constraintsVersion = 4）。
6. 事件：`constraints_changed`（"Finance changed constraints (v4). Proposal v3 is blocked; renegotiating."，不含金额）、`approval_invalidated`（count 2）、`run_started`。
7. 提交。所有订阅 `rooms.view` 的窗口在同一刻看到：v3 处境 blocked、两条审批 stale_approve、run R3 negotiating。
8. 若 customer 的浏览器在第 1 步之前打开了审批面板（expectedConstraintsVersion = 3）并在第 7 步后点击 approve → G4/G5 先失败（`NOT_AWAITING_APPROVAL`）；即使 run 仍为 pending_approval（见 2.2），G6 也会以 `CONSTRAINTS_CHANGED` 拒绝。

### 2.2 预算下调但当前提案仍合规（回归 6）

同上前提，但新预算 $4,950。第 5 步 evaluate 通过 → R2 保持 pending_approval，v3 保持 active；写 `reapproval_required`。三方各自以 `expectedConstraintsVersion = 4` 对同一 proposalId 重新 approve；最后一票的 mutation 内 `isExecutable` 为真 → 执行；changeOrder.constraintsVersion = 4，operationId = `exec:${v3Id}`（D12）。cv=3 上的两条旧 approve 保留，显示为历史。

### 2.3 回合进行中约束变化

1. R1 negotiating，回合 T(seq 5, cv 3) 的 action 已在调用模型。
2. customer 确认新简报把截止日提前 → bump cv 4 → R1 superseded → R2 起，调度 T'(seq 1, cv 4)。
3. T 的模型返回，action 调 `completeTurn(R1, 5)`：G1 `room.currentRunId !== R1` → T → stale，事件 `turn_rejected_stale`；不分配 proposalVersion。
4. 若 T 的 action 在第 2 步之后才开始组装上下文：提前退出检查命中，不调用模型。
5. 反向情形（D8 必要性）：R2 在 cv 4 下进入 pending_approval；cv 5 的变化使 v4 仍合规 → R2 保持；之后 provider reject → R2 → negotiating，调度 T''(cv 5)。旧守卫 `room.cv === run.constraintsVersionAtStart(4)` 会错误拒收 T''；新守卫比较 `turn.constraintsVersion(5) === room.cv(5)`，正确接受。

### 2.4 人工回答改变约束

1. R1 needs_input，humanRequest H1（targetRole customer，选项 "Defer REPORTS to Phase 2"），H2（targetRole finance，选项 "Raise budget by $100"）同时 open。
2. customer 调 `answerRequest({ requestId: H1, optionKey, expectedConstraintsVersion })`：守卫 H1.status === 'open'、调用者为 targetRole、`H1.constraintsVersion === room.cv === expected`。
3. H1 → answered；`withConstraintChange(cause: ['human_answer', 'customer_requirements'])`：apply 写新 customer briefVersion（REPORTS 移入 deferrable）→ 投影变化 → bump：H2 → cancelled（`cancelledByRevision`）；R1 needs_input → superseded；新 run trigger `human_answer`。
4. finance 稍后点 H2 → `REQUEST_NOT_OPEN`；UI 显示"已被 customer 的回答取代"。

### 2.5 最后一票与约束变化并发

- A = customer 最后一票的 `decideOnProposal`（读 room、run、proposal、approvals、budgets、commitments，写 approvals、changeOrder、commitments、tasks、run、proposal）。
- B = finance 的 `updateBudget`（读 room、budgets、commitments，写 budgets、room、runs…）。
- 两者都读写 room 与 budgets，Convex OCC 保证其中一个先提交、另一个重试（inputs/04 §1.3）。
  - A 先：执行完成，run confirmed；B 重试时 committed 已含新承诺，若新总额 < committed → `BUDGET_BELOW_COMMITTED` 回滚；否则 bump，reconcile 走"无活动 run"分支。已执行记录保留 cv=旧值。
  - B 先：cv 已变；A 重试时 G6 `CONSTRAINTS_CHANGED`（或 G5 失败），不写审批。
- 关键：A 必须**读** budgets 与 commitments 区间（08 的 D10），否则 B 的写入不会与 A 冲突，形成写偏斜。

## 3. 旧审批、旧提案的保留与展示

- **保留**：approvals、proposals、constraintRevisions、budgetChanges、briefVersions、catalogItems 全部只追加（提案的 status 例外，INV-P1）。没有任何删除路径；reset 只作用于标 simulated 的演示房间（15）。
- **房间标题区**：常驻 "Proposal v{n} · Constraints v{m}"（RA-D03 保留）。
- **审批面板**（当前提案）：每个必需角色一行，显示 1.3 的派生状态；stale 行显示旧版本号与"constraints changed by {actorRole} ({category})"。当提案创建版本 ≠ 当前版本时，显示 "Terms unchanged since v{n} was proposed under constraints v{k}; now evaluated under v{m}"（RA-R11 替代方案）。
- **提案时间线**：按 version 倒序；每项显示 status、`createdAtConstraintsVersion`、`validationAtCreation`（创建时快照，标明"at creation"）、该提案上的全部决定（按 seq，带 cv）。只有 active 提案显示"在当前约束下的评估"；旧提案不在当前约束下重算（无意义且多一个泄露面）。
- **约束时间线**：constraintRevisions 按 version 倒序，每行 version、actorRole、causes、runEffect、invalidatedDecisionCount；数值只在本人有权读的源表视图中显示（finance 看 budgetChanges，07）。
- **结果页**：changeOrder 显示执行时的 proposalVersion 与 constraintsVersion；之后的约束变化不改变它（RA-B09 精神）。
