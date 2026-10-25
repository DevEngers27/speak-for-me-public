# 专题深潜：版本化审批与约束失效（part4：反例与边界、测试清单）

> 守卫顺序以 versioned-approvals/decide.ts 为准：G9（已执行的幂等成功）在 G2 之后、G3 之前检查；part2 §4.1 表中列在末尾只为叙述方便。

## 1. 反例与边界表

"错误设计"列说明若没有对应机制会发生什么；"期望"是本设计下的结果，也是测试断言。

| # | 场景 | 错误设计下的后果 | 期望（本设计） | 防线 |
| --- | --- | --- | --- | --- |
| X1 | 两方已批准后 customer 确认新简报把截止日提前（RA-B02） | 只在改预算时递增 → 旧审批仍有效，执行违反新截止日 | cv+1；两条审批变 stale_approve；若 v3 交付日 > 新截止日 → blocked + run superseded；否则保持 pending 并要求重批 | B2、INV-C3 |
| X2 | 提案引用目录条目后 provider 改价（RA-B04） | 旧提案按旧价执行 | cv+1；evaluate 报 `SOURCE_PRICE_CHANGED`（06）→ blocked；提案金额永不被改写 | B5、INV-P1 |
| X3 | finance 把预算改成原值 | 无条件递增 → 全部审批无故作废 | `{ changed: false }`，不递增、不写事件 | D4 投影比较 |
| X4 | customer 只改 preferredDate | 递增 → 无故重批 | 不递增；新 briefVersion；下一回合读到软偏好 | B3、D5 |
| X5 | 降预算后当前提案仍合规（回归 6） | 复制 revalidated 版本（RA-R11）或强制重谈 | 不产生新版本；run 保持 pending_approval；对同一 proposalId 重批后可执行 | D6、D7 |
| X6 | 用户在 v2 下看到可行，点击前预算降到 v3 | 记为"在 v3 下批准" | `CONSTRAINTS_CHANGED`（G6）或 `NOT_AWAITING_APPROVAL`（G5） | D3 |
| X7 | 双击 approve（非最后一票） | 插两行 / 计数提前达标 | 第二次 `unchanged`，只有一行 | G8、INV-E3 按集合 |
| X8 | 双击最后一票 | 两次执行 | OCC：第二次重试见 executed → `{ status: 'executed', changeOrderId }`；一条 changeOrder、一条 commitment | G9、08 状态守卫 |
| X9 | 先 reject、后 withdraw、再 approve（回归 5） | upsert 只剩一行；RA-B06 删除旧拒绝 | 三行 seq 1/2/3 全保留；当前 approved | D2、INV-A2 |
| X10 | v2 下拒绝，约束变到 v3（回归 15、RA-B30） | 显示 pending，丢失"曾拒绝"信息 | stale_reject（v2） | 1.3 派生状态 |
| X11 | 回合在途时预算下调（F09.4） | 迟到结果覆盖新状态 | run superseded；迟到结果 `turn_rejected_stale`；不分配 proposalVersion | INV-T1 |
| X12 | run 在 cv4 进入 pending、cv5 变化后保持、被拒回 negotiating | 旧守卫 `room.cv === run.constraintsVersionAtStart` 拒收所有新回合，run 卡死 | 新回合快照 cv5，被接受 | D8 |
| X13 | 最后一票与 updateBudget 并发 | 写偏斜：按旧预算执行且预算已降 | OCC 串行化：要么先执行后改预算（可能 BUDGET_BELOW_COMMITTED），要么先改预算后 G6 拒绝 | part3 §2.5；08 D10 必须读 budgets/commitments |
| X14 | 同一提案在 v2 未执行、v3 重批后执行 | 幂等键含 cv → 理论上同一提案可在 v2、v3 各执行一次 | 状态守卫 + `exec:${proposalId}` 双重保证至多一次 | D12 |
| X15 | 代理输出 recommend_accept | 被当成批准 | 只写事件和本方 rationale；approvals 无新行 | INV-A6 |
| X16 | 角色成员更替：旧 customer 已批准后被替换 | 旧人审批仍计入 | 完成判定只认当前成员的决定 → 新成员需批准 | INV-E3 |
| X17 | humanRequest H1、H2 同时 open，customer 回答 H1 改变约束 | H2 仍可回答，基于过时约束 | H1 answered；bump 取消 H2；finance 回答 → `REQUEST_NOT_OPEN` | INV-H1 |
| X18 | answerRequest 选项不改变硬输入（澄清） | 递增 → 无谓作废 | 不递增；run needs_input → negotiating | B9 |
| X19 | 新预算 < 已承诺 | 允许写入 → 预算账面为负 | `BUDGET_BELOW_COMMITTED`，整个 mutation 回滚，不 bump | B1 |
| X20 | 新预算 = 已承诺 + 当前提案金额（恰好用尽，回归 14） | 用 `<` 误判超支 | 合规（规则用 `committed + amount <= total`，06） | 06 |
| X21 | 降预算到无合规组合 | 模型被调用并可能编造一致意见 | preflight infeasible → 新 run 直接 needs_input + humanRequest，不调用模型 | reconcile、AC-07 |
| X22 | 两次快速 bump（cv4、cv5） | R2 的已调度回合仍调用模型 | R2 superseded；其回合 action 提前退出（不调用模型）或被 completeTurn 拒收 | 4.3 提前退出 |
| X23 | 执行后再改预算 | 已执行记录被"重新评估"或作废 | 走"无活动 run"分支；changeOrder 保持 cv 旧值；结果页不变 | 1.1、3 |
| X24 | 新 run 沿用桌上的旧提案（合规） | 守卫比较 proposal.runId === currentRunId → 无法审批 | G5 看当前 run；可审批 | G5 |
| X25 | 绕过 withConstraintChange 直接 patch budgets | 静默漏递增 | 代码结构测试失败（INV-C4） | 16 |
| X26 | 提案创建时 cv=1，当前 cv=3，仍合规 | F09.3 公式判不可执行 | 可执行性只看当前规则与当前审批（D7） | D7 |
| X27 | 非必需角色或非成员调 decide | 被记录 | `NOT_REQUIRED_APPROVER` / `NOT_FOUND` | G1、G2 |
| X28 | withdraw 时当前版本上无决定 | 插入无意义的 withdraw | `NOTHING_TO_WITHDRAW` | G8 |

## 2. 测试清单

### 2.1 纯函数单测（standing.ts、constraints.ts 中的纯部分）

1. `latestPerUser`：乱序输入按 seq 取最大。
2. `summarizeApprovals`：三角色都在当前 cv approve → complete；任一缺失 → 不 complete。
3. 同上：某角色最新为 v2 approve、当前 v3 → `stale_approve`，complete = false。
4. 同上：v2 reject → `stale_reject`，不是 `pending`（X10）。
5. 同上：当前 cv 上 approve 后 withdraw → `pending`。
6. 同上：reject→withdraw→approve 序列 → `approved`（X9）。
7. 同上：approve 来自非当前成员 → 不计入（X16）。
8. 同上：同一 userId 出现在两个必需角色（数据被破坏的防御）→ 第二个不计入，complete = false。
9. 同上：role/kind 与快照不符的行 → 不计入。
10. `deriveProposalStanding`：executed / superseded / blocked / renegotiating / awaiting_approval / executable 六个分支各一例，且按优先级（如 blocked 优先于 renegotiating）。
11. `deriveProposalStanding`：`createdAtConstraintsVersion` 与当前不同但规则通过、审批齐 → executable（X26）。
12. `hardProjection` + `equalHard`：数组顺序不同视为相等；preferredDate 变化视为相等；committedCents 变化视为相等；required 增删、deadline、价格、条目撤回、预算变化各视为不等。
13. 递增矩阵 B1–B16 的表驱动测试：给定 before/after 输入，断言 bumped 与否（不需要数据库）。

### 2.2 convex-test 集成（串行；如实记录"未覆盖并发"）

14. `updateBudget` 同值 → 无 constraintRevisions 行、无事件（X3）。
15. `updateBudget` 降到仍合规 → cv+1；run 仍 pending_approval；提案数不变；`reapproval_required` 事件；旧审批 stale；三方以新 cv 重批 → 一条 changeOrder，constraintsVersion = 新值（X5、回归 6）。
16. `updateBudget` 降到超支 → run superseded；新 run negotiating；`approval_invalidated` 事件 count = 2；提案仍 active、处境 blocked（AC-G4）。
17. `updateBudget` 低于已承诺 → `BUDGET_BELOW_COMMITTED`，cv 不变、budgets 不变（X19）。
18. customer 改截止日 / required → cv+1；软偏好改动 → cv 不变（X1、X4）。
19. provider 改价确认 → cv+1；引用该条目的提案 blocked（X2）。
20. decide：`expectedConstraintsVersion` 过期 → `CONSTRAINTS_CHANGED`，approvals 无新行（X6）。
21. decide：连续两次 approve → 第二次 `unchanged`（X7）；最后一票连续两次 → 第二次 `executed`，同一 changeOrderId（X8，串行模拟）。
22. decide：reject 无 reasonCode → `REASON_REQUIRED`；reject 后 run 迁移由 04/05 断言。
23. completeTurn：bump 之后提交的旧回合 → turn stale、`turn_rejected_stale`、room.proposalVersion 不变（X11）。
24. completeTurn：跨版本保持的 run 被拒后回到 negotiating，新回合被接受（X12）。
25. answerRequest 改约束 → 其他 open 请求 cancelled 且 `cancelledByRevision` 指向新 revision；被取消请求的回答 → `REQUEST_NOT_OPEN`（X17）。
26. preflight infeasible → 新 run needs_input，模型 stub 调用次数为 0（X21）。
27. 执行后改预算 → constraintRevisions.runEffect = `none`；changeOrder 不变（X23）。
28. 每次 bump：constraintRevisions.version 连续、与 room.constraintsVersion 一致（INV-C2）；源表回填 producedConstraintsVersion。
29. 版本号：多个 run 之后 proposal.version 连续且不重置；约束变化不增加 proposalVersion（INV-P3）。

### 2.3 真实部署上的并发测试（F08.5；convex-test 不模拟 OCC）

30. 并发 5 次最后一票 approve → commitments 只多一行、changeOrders 一行。
31. 最后一票与 `updateBudget` 并发（脚本交错发起 50 次）→ 每次结果属于 part3 §2.5 两种串行结果之一；从无"按旧预算执行且预算已降到已承诺以下"。
32. 两个不同用户并发 `confirmBrief`/`updateBudget` → constraintRevisions 版本号无重复、无空洞。

### 2.4 代码结构测试（CI 中 grep / AST 白名单）

33. `constraintsVersion:` 的 patch 只出现在 constraints.ts 的 `bumpConstraints`（INV-C1）。
34. 对 `budgets`、confirmed briefVersions、confirmed catalogItems 的 insert/patch 只出现在 `withConstraintChange` 的 apply 回调所在文件（INV-C4，X25）。
35. `approvals` 表没有 patch / delete 调用（INV-A2）；`proposals` 的 patch 只改 status/statusChangedAt（INV-P1）。
36. internal 函数与 action 不 import `decideOnProposal` 的写入 helper（INV-A6）。

### 2.5 端到端（13/16）

37. 三个浏览器会话：finance 降预算 → 其余两个窗口无需刷新在同一刻看到 blocked 与 stale 标记；处于审批面板的用户点击 approve 收到"约束已变化，请重新查看"。
