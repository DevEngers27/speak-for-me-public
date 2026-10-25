# 08 审批与执行（part10）：8.10 走查（D27 数字）

> 数字采用 canon D27 主 fixture（protocol-rules spike 实测复现）：目录 5 项合计 $1,400，`sso_login` $500、`audit_log_export` $300（二者为必需，合计 $800）、`usage_dashboard` $100；截止 2026-11-20；finance 上限 $5,000，基线已承诺 $4,000。cv 编号、提案编号与交付日的物化值以 14 §10 的走查为准（房间打开时 cv = 1，finance 下调后 cv = 2；v1 $900，v2 $800 由 provider 在 run 2 第 2 轮提出）。金额一律整数分。

## 8.10.1 主线：审批期间预算下调 → 重谈 → 恰等于上限执行

| 步 | 动作（调用者 → 函数） | 状态变化 | 审批面板（customer / provider / finance） | 各方所见要点 |
| --- | --- | --- | --- | --- |
| W1 | run1 的回合产出 v1 = `sso_login + audit_log_export + usage_dashboard`，两个评估方 `recommend_accept` → run1 `pending_approval` | v1 `active`，`termsKey = canonicalJson({ itemKeys:['audit_log_export','sso_login','usage_dashboard'], modifiers:[], deliveryDate, amountCents: 90_000 })`；`requiredApprovals = [customer/terms, provider/terms, finance/budget]` | pending / pending / pending | 预览：全员见 +$900 与任务清单；finance 另见 $4,000 → $4,900 ≤ $5,000、余量 $100；agent 建议显示在虚线框内 |
| W2 | customer → `approvals.record({ proposalId: v1, decision: 'approve', expectedConstraintsVersion: 1, expectedTermsKey, reasonKey: null, note: null })` | `approvals` +1（seq 1，bound cv 1）；事件 `approval_recorded` | approved / pending / pending | 返回 `recorded{missingRoles:['provider','finance']}` |
| W3 | provider → 同上 | `approvals` +1 | approved / approved / pending | 返回 `recorded{missingRoles:['finance']}`；finance 的待办卡 "Approve budget commitment of +$900 (v1, constraints v1)" |
| W4 | finance 不批，先看 `rooms.previewChange`（只对 finance 求值，D12 ②），再 `budget.setCap({ roomId, capCents: 480_000, expectedConstraintsVersion: 1 })`（09、12） | cv 1 → 2；run1 `superseded(constraints_changed)`；v1 → `stale`；预检：400_000 + 90_000 = 490_000 > 480_000（`budget.over`）→ 不保留；全量约束下的可行集（`buyerFeasible`，04 §4.3.3）非空（必需项 $800 = 余量）→ run2 `negotiating` | v1：stale_approve(v1) / stale_approve(v1) / pending | finance："Cap $5,000 → $4,800 (constraints v2)"；customer：fixture 中 finance 披露了 `capCents`，见 "Finance updated the budget cap to $4,800 (constraints v2)."；provider 只见 "Constraints changed (v2)."，v1 显示为 superseded（历史提案对 provider 只显示 superseded / rejected / executed / current，不显示实时重算结论，D12①、14 S7） |
| W5 | customer 的旧页面仍停在 v1 / cv 1，点 approve | S6：run1 已 `superseded` → `approval.not_current`，不写 | 不变 | "A newer proposal or negotiation replaced this one" |
| W6 | run2：第 1 轮 provider（stub）选 $900 的候选 → `budget.over` → 被阻断（不插提案、不消耗版本号，`turn.outcome.blockedCandidateKey`）；第 2 轮快照剔除它，provider 提出只含必需项的 v2（version 2）= `sso_login + audit_log_export`，$800；customer、finance 评估通过 → run2 `pending_approval`（14 §10 S8–S9） | v2 `active`，`createdAtConstraintsVersion: 2` | v2：pending ×3 | 预览：全员见 +$800；finance 见 $4,000 → $4,800 = 上限、余量 $0（恰等于通过，K18） |
| W7 | customer、provider 依次以 `expectedConstraintsVersion: 2` approve v2 | `approvals` +2 | approved / approved / pending | finance 的按钮文案 "Approve v2 under constraints v2"，并提示 "Your approval completes the set — this executes now" |
| W8 | finance approve v2 | S0–S13 通过 → `executeIfComplete`：`executionKey = exec:<v2>`；`executions` +1（`committedBeforeCents 400_000`、`committedAfterCents 480_000`、`capCentsAtExecution 480_000`、`approvalIds` = 三条 cv 2 的行）；`ledgerEntries` +1（commit 80_000）；`changeOrders` +1（CO-1，链 400_000 → 0 → 400_000 → +80_000 → 480_000）；`tasks` +2；v2 / run2 / room → `executed`；cv 仍为 2 | 冻结：approved(v2) ×3 | 返回 `executed{alreadyExecuted:false}`；全员结果页 "Executed · CO-1 · Internal record only"；provider 的金额视图只有 +$800 |
| W9 | 任何人再点 approve v2 / 任何人对 v2 reject | 无写入 | 不变 | `executed{alreadyExecuted:true}` / `approval.already_executed` |

**终态**：room `executed`（cv 2，`nextProposalVersion 3`）；提案 v1 `stale`、v2 `executed`；`approvals` 5 行（v1：customer、provider @cv 1；v2：三方 @cv 2）；`executions` 1；`ledgerEntries` 2（baseline 400_000、commit 80_000，Σ = 480_000）；`changeOrders` 1；`tasks` 2；R1–R11 为空。

**追溯链**（结果页 History）：CO-1 → execution（cv 2）→ `approvalIds`（三条 cv 2 的 approve）→ v2（run2 `cause: constraints_changed`）→ cv 2 的 `constraintRevisions`（cause `brief_confirmed`、source `set_cap`，actor finance；数值只对 finance 显示）→ v1 与两条 cv 1 的 approve（显示 "No longer applies · approved under constraints v1"）→ run1。spike 的纯函数测试写"3 条审批 stale"，但在本设计里第三条（finance）若已落下就会立即执行（D03），所以主线可达的是 2 条 stale + finance pending。

## 8.10.2 保留分支：预算下调但当前提案仍合规（回归 6 / RA-R11）

W1–W3 同上；W4 改为 `budget.setCap({ roomId, capCents: 495_000, expectedConstraintsVersion: 1 })`：

1. cv 1 → 2；run1（被取代前 `pending_approval`，满足 canon D06 收窄后的沿用条件）`superseded`；v1 先置 `stale`，`react()` 预检：490_000 ≤ 495_000，全部检查通过、且 v1 从未被人拒绝 → 新 run2 直接 `pending_approval`，`currentProposalId = v1`（**不复制版本**），v1 恢复 `active`（04 R2）；事件 `run_started`、`reapproval_required`。
2. 面板：customer、provider `stale_approve(v1)`，finance pending；界面 "Terms unchanged since v1 was proposed under constraints v1; now evaluated under v2"。
3. customer 若用旧页面（cv 1）点 approve → S6 通过（看的是 run2 的 `currentProposalId`）→ S8 抛 `approval.stale{2}`；刷新后三方以 cv 2 重批。
4. 最后一票 → 执行：`executionKey = exec:<v1>`，`constraintsVersion 2`，`committedAfterCents 490_000`，`capCentsAtExecution 495_000`（finance 可见余量 $50）；`approvals` 5 行（cv 1 两行保留为历史，cv 2 三行入 `approvalIds`）。

## 8.10.3 变体

| 变体 | 触发 | 对 08 的影响 |
| --- | --- | --- |
| V1 无解（$4,700） | W4 改为 `setCap(470_000)`：余量 $700 < 必需项 $800 | v1 `stale`，run2 预检无解 → `needs_input`，按 `relaxationOrder` customer 无可放松项（必需项是硬约束）→ finance 的 `raise_cap` 请求；**零模型调用**、无新提案、无审批可做；两条 cv 1 的 approve 保留为 stale |
| V2 边界减一分（$4,799.99） | `setCap(479_999)` | $800 方案 400_000 + 80_000 = 480_000 > 479_999 → `budget.over`，永远到不了 `pending_approval`；若构造出这种待批状态（故障注入），S11 抛 `approval.not_executable`，`computeChangeOrderChain` 返回 `budget.over` |
| V3 低于已承诺（$3,900） | `setCap(390_000)` | `budget.below_committed` 直接拒绝（D23）：不 bump、不写事件；审批进度不受任何影响（fixture 不得用 seed 伪造此状态） |
| V4 最后两票并发 | W8 时 provider 与 finance 同时投（K3） | 恰一次执行；`executedByUserId` 取决于提交顺序；L2 探针 S1 |
| V5 拒绝 | W3 后 customer 以 `reasonKey`（取值表归 14 §3，例如 `scope_insufficient`）reject v1 | v1 `rejected`（终局）；run1 `negotiating`、`roundNo 2`；三方的人在时间线上看到 "Customer rejected v1. Reason: scope insufficient."（14 §8 模板）（07 DX-6；受众 `room`；finance 的 `over_our_limit` 受众为 `buyers`，provider 只见 "Finance rejected v1"）；provider 代理下一回合只得 "v1 rejected"（05 §5.12），快照剔除 v1 的 `candidateKey`；之后 finance 改上限也不会让 v1 复活（K26） |
| V6 金丝雀 | canary 变体叠加奇数美分（如 481_237）与三方金丝雀串 | 执行后以 provider 身份扫描 `rooms.view` / 时间线 / 错误 `data` / `proposals.get`：baseline、committed、cap、headroom 的任何写法零命中（I19） |
| V7 跨午夜 | W7 与 W8 之间跨过房间本地午夜，cron 未运行 | finance 的 approve 以 `room.localDate` 判定（与其屏幕一致）；交付日仍在未来 → 照常执行（K27）；之后 cron 推进 `localDate` 也不 bump（结论未翻转）；审批不因跨午夜失效（D22） |
| V8 执行后跟进 | 执行后旧房间任一成员调 `rooms.startFollowUp({ executionId })`（每个 execution 至多一个后续房间，`rooms.by_followsExecutionId`） | 新房间 baseline 预填 480_000（finance 确认）；新房间的变更单编号为 CO-2；旧房间结果页的审批仍显示 "executed under constraints v2"，不受新房间任何 bump 影响 |
