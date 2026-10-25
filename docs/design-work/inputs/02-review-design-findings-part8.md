# 02 审查设计发现 · part8：08 审批与执行、09 约束变更

> 分片清单见 part1。

## 08 审批与执行

### F08.1 审批绑定不可变提案 + 约束版本
- 问题：approvals 只存版本号，没有 proposalId、decision（记不了 reject）、(proposal, userId) 唯一性；proposals 可被修改，版本号也不唯一，旧签字可能匹配到新方案（`schema.ts:28-31`）。
- 建议方案：approval 绑定 `(proposalId, constraintsVersion)`；proposals 只插入不修改；同一 (proposalId, userId) 先查后 patch，只保留最新决定，撤回就是改为 reject；role 从 members 读，不接受客户端传入。字段见 F03.7。
- 来源：architecture-04、security-03、product-12、code-07（P9）。

### F08.2 谁必须批准由代码决定，不由可改字段决定
- 问题："谁必须批准"由可改的 `members.approvalRequired` 布尔值决定，finance 的批准可能被绕过；finance 的"审批规则"只存在于模型上下文里。
- 建议方案：`REQUIRED_APPROVER_ROLES = ['customer','provider','finance']` 写成代码常量，插入提案时快照进 proposal，执行时以快照为准；删掉 approvalRequired 或设为只读。
- 完成判定按集合，不按计数：针对 room.currentProposalId 与 room.constraintsVersion，每个必需角色都恰好有一个**不同 userId** 的最新决定为 approve。禁止 `approvals.length >= N`（重复点击会让计数提前达标）。
- 来源：security-10、architecture-03、security-03/-05。

### F08.3 条款签核与预算承诺的职责区分
- 问题：三方批准同一版本，把外部服务商的条款签核和客户内部的预算承诺绑在一起，权责不清。
- 建议方案：approvals 加 `kind: 'terms'|'budget'`；provider 与 customer 签 terms，finance 签 budget，两类都绑定提案与约束版本；执行检查"所有 terms 与 budget 签核都在当前版本上"。provider 视图只显示变更单条款和自己的任务。界面文案 "Accept terms" / "Approve budget commitment"。不要做成两套独立流程。
- 来源：product-21（L7）。

### F08.4 执行放在最后一次审批的同一个 mutation 里
- 问题：幂等执行的落点和 operationId 的生成规则都没定义；客户端生成 uuid 会让 by_operation 查重失效；committedCents 是可累加计数器（`schema.ts:13/:32-35`）。
- 建议方案（顺序即事务内步骤，不用 action 或 scheduler）：
  1. 从 ctx.auth 取身份，查 members 得到角色；upsert 本人审批。
  2. 按 F08.2 做集合判定；未齐则返回。
  3. 状态守卫（主防线）：`run.status === 'pending_approval'`、`room.currentProposalId === proposalId`、`proposal.constraintsVersion === room.constraintsVersion`。两次并发调用会读写同一文档，OCC 让第二次重试时看到 confirmed，直接返回已有结果。
  4. 重算预算（读 budgets + 汇总 commitments，调用 F06 的同一纯函数）；超出就不执行，返回 blocked。
  5. `operationId = exec:${proposalId}:${constraintsVersion}`，服务端派生；by_operation 命中则返回已有 changeOrderId，不抛错（第二道保险兼审计键）。
  6. 同一事务插入 changeOrder、commitment（kind change_order）、tasks（按 approvedItemKeys/taskTemplates 确定性派生，不调模型）。
  7. run → confirmed（经 assertTransition），proposal → executed，写 executed 事件。
- Role A 的 `rules.ts:80` 已把 operationId 定为 `${room.id}:p${proposal.version}:c${room.constraintsVersion}` 的服务端派生形式，方向一致。
- reject 时 run 转 negotiating 或 needs_input 并写事件。
- 来源：architecture-03、security-04、docs-02、gap1-06（P9 第 3 点、P5 第 5 点红队修订）。

### F08.5 并发与重复的验证方式
- convex-test 里的 mutation 串行执行（confidence medium），用 Promise.all 证明不了 OCC。验证要对真实部署并发调用公共 approve（如脚本并发 5 次、或 `npx convex run` 连续两次），再查 commitments 只多一行；UI 快速双击同理。若在 convex-test 里测"连续调用两次只产生 1 条"，证据里要如实写明测试方法。
- 来源：security-04、architecture-03、M1。

### F08.6 执行边界
- 只写内部记录（变更单、承诺、任务），不转账、不签约、不改外部 ERP；幂等只承诺内部记录（README.md:46、:211）。变更单的可读产物用页面或打印视图；若做 CSV 导出要防公式注入（L5）。
- 来源：审查第 4 节、security-26。

## 09 约束变更（→ 09-constraint-changes）

### F09.1 constraintsVersion 只能经单一入口递增（技术 blocker 之一）
- 问题：没有任何地方规定 `rooms.constraintsVersion` 何时加 1、谁能改预算、改完怎么迁移（`schema.ts:12/:13/:21/:24`）。Role A 分支只在 `changeBudgetCap` 递增（`preview-store.ts:298`），`saveBrief` 改硬约束也不递增（`:162-195`）。最容易犯的错是只 patch 预算不递增版本，旧审批仍"有效"。
- 建议方案：唯一入口 `bumpConstraints(ctx, roomId, reason)`。审查列出的递增点是 updateBudget、confirmBrief、改变硬约束的 answerRequest；P18 又要求 provider 改目录价格、customer 改截止日也递增。整理者建议统一表述为"所有改变硬约束的 mutation 都调用 bumpConstraints，其他写入不得改它"，09 中逐个列出。privateBriefs.version 只用于该 brief 的乐观并发。
- 偏好（soft）是否单独版本化、改动是否递增：审查认为 v1 无此数据所以不细分；【改写】若引入 preferredDate 等软约束，要明确它们不使旧审批失效（只影响协商），并写进 09。
- 来源：architecture-02、security-08、process-06、docs-03（P5 第 1 点、P18 第 3 点）。

### F09.2 updateBudget 的事务步骤
- `updateBudget({ roomId, newTotalCents, reason })` 在一个 mutation 里依次：
  1. 从 ctx.auth 取身份，查 members 确认 role === 'finance'（不信任客户端）；`assertCents`。
  2. 读 budgets 与已承诺汇总；patch budgets；插入 budgetChanges（old/new/actor/reason/constraintsVersion，仅 finance 可读）。
  3. bumpConstraints。
  4. 当前 run → superseded，清空 currentRunId；`ctx.scheduler.cancel` 只能尽力：它不会中止已开始的 action，对已完成的函数调用会抛错（`scheduler.d.ts:112-121`），所以先查 `_scheduled_functions` 状态或包 try/catch；真正的保证来自 F04.2 的回合持久化守卫。
  5. 取消所有 open 的 humanRequests。
  6. 写全房间事件 constraints_changed（不带数字，如 "Finance constraint changed; proposal v3 blocked"）。
  7. 若 total < committed 或代码判定无可行组合 → 直接生成人工请求；否则新建 run（trigger 'budget_change'），用 `ctx.scheduler.runAfter(0, internal.agents.runTurn, ...)` 启动。mutation 里的调度与写入原子提交，调度在提交后才执行。
- 来源：architecture-02、security-08（P5 第 2 点）。

### F09.3 阻断是读取时派生，不回写
- 旧 approvals 不删不改，版本不匹配自然失效，历史保留（README.md:245）。
- "blocked" 不回写所有提案：`isExecutable = proposal.constraintsVersion === room.constraintsVersion && validate 通过`，`rooms.view` 实时计算；预算一提交，所有窗口同一刻翻转为 blocked，不等新 run 和模型（阻断瞬间完成，重谈随后异步出现）。
- 来源：architecture-02/-17（P5 第 3–4 点）。

### F09.4 必测场景
- 回合进行中降预算：迟到的回复被拒（turn_rejected_stale），旧批准不再计入。
- 改硬约束（截止日、必需条目、价格）同样使旧审批失效。
- 总额降到已承诺以下：BUDGET_BELOW_COMMITTED → needs_input。
- 降到"恰好等于余量"的边界、以及无可行解的值（见 14）。
- 来源：security-08、P7、P18。
