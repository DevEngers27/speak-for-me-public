# 研究：变更单与审批系统的数据模型

> 研究方向：成熟的变更单（change order）、采购审批、预算承诺（encumbrance / commitment accounting）系统如何建模，以及可直接借用到 Speak for Me 的字段与状态。
> 访问日期：所有 URL 均于 2026-10-24 访问。网页内容只作为数据使用。
> 可信度标记：高 = 官方一手文档，原文已读；中 = 官方文档的搜索摘要或社区资料与官方资料一致；低 = 第三方或社区说法，需验证。

## 0. 概述

调研了五类成熟系统，结论很一致：

1. **审批对象和生效版本分开**。ERP（Oracle Fusion Procurement）里，变更单（change order）是"对已批准文档提出的修改"。审批期间旧的已批准版本一直生效，审批完成后才产生新版本（revision +1）。这和本系统"提案只追加；审批绑定具体版本"的核心完全对应。
2. **审批绑定内容快照，内容一变就作废**。GitHub 的 dismiss stale approvals 记录"批准时的 diff"，diff 变了审批就失效；SAP 的 release strategy 会在批准后的改动超出容差时重置。本系统应采用最严格的一档：没有容差，任何条款或约束变化都作废审批。
3. **多方变更单要求每个必需方都签字才生效**。AIA G701 要 owner、contractor、architect 三方签字，并在单据上记录"原合同额 → 已批准变更的累计净额 → 本次变更前金额 → 本次增减 → 新合同额"，日期也同样记录。这一组字段可以直接用作我们 change order 记录的金额与日期字段。
4. **承诺会计（commitment accounting）是分层的金额类型账本**：budget、pre-encumbrance（预计支出，没有法律义务）、encumbrance（有法律义务）、expenditure（实际支出）。available = budget − pre-encumbrance − encumbrance − expenditure，是算出来的，不存储。状态推进时用 liquidation（冲销）把金额从上一层转到下一层，不改写原记录。
5. **记账不可变，纠错靠反向分录；幂等靠 key 加参数比对**。Modern Treasury 的 ledger transaction 是 pending（可改）→ posted / archived（不可改），撤销只能另写 reversing transaction，并保留 version 历史。Stripe 用 idempotency key 保存第一次执行的结果；同一个 key 带着不同参数重放时报错。

下面逐项列出发现，然后按任务书第 5 节的文件编号给出设计含义。

---

## 1. 逐项发现

### F1. 变更单 ≠ 新文档；审批期间旧已批准版本保持生效
- **结论**：Oracle Fusion Procurement 把 change order 作为独立对象挂在采购文档上。创建与审批期间，"currently approved version" 保持不变，并继续作为收货、开票等下游活动的事实来源；只有在 approval、acceptance、validation 全部完成后，变更才会被应用，生成文档的新版本。版本表记录状态 DRAFT / PENDING APPROVAL / PENDING ACCEPTANCE / PENDING SIGNATURE / PREAPPROVED / PROCESSED，以及应用时的 revision 号。
- **证据**：Oracle Fusion Cloud Procurement, *Change Orders*（23D）https://docs.oracle.com/en/cloud/saas/procurement/23d/oaprc/change-orders.html （正文由搜索摘要获得，直接抓取只返回目录页）；*Purchasing Document Versions* PVO https://docs.oracle.com/en/cloud/saas/procurement/25a/oadpr/PurchasingDocumentVersionExtractPVO.html ；*poversions* 表 https://docs.oracle.com/en/cloud/saas/procurement/24d/oedmp/poversions-25190.html
- **可信度**：中高（官方文档，经搜索摘要获得，状态枚举来自官方表文档）。
- **借用**：`status` 枚举里区分"待内部审批"（PENDING APPROVAL）和"待对方接受"（PENDING ACCEPTANCE）；`revisionNum` 只在 PROCESSED 时递增。

### F2. 每次重新批准都让 revision 递增；累计金额容差防止"切香肠"
- **结论**：Oracle E-Business Suite Purchasing 规定所有重新批准（完整或自动）都会让文档 revision 号递增。它还有 cumulative amount tolerance，防止一连串小改动累计把订单金额抬过阈值。EBS 12.2 新增了"absolute amount limit"：对采购订单的任何改动，只要超过这个绝对金额就强制重新审批。
- **证据**：EBS *Workflow Processes for Approving Change Orders*（镜像）https://ap1.mclaneco.com/OA_HTML/HelpServlet/US/PO/@cocst ；EBS 12.2 What's New https://docs.oracle.com/en/applications/e-business-suite/readiness/procurement/12.2/whats-new/ebs-proc-wn-f40460.htm
- **可信度**：中（第一条来自 Oracle 帮助的第三方镜像，第二条是官方）。
- **借用**：如果将来允许"小改动免审批"，比较对象必须是累计值（相对于最初批准的基线），不能是相邻版本之间的差值。本系统 v1 不设容差。

### F3. 审批绑定内容快照；内容变化让审批变成 stale
- **结论**：GitHub 受保护分支在批准时记录 diff 的状态。之后 diff 一变（推送新提交、点 Update branch、目标分支合入相关 PR 导致 merge base 变化），这个批准就会作为 stale 被撤销，必须重新批准。另一个选项 "require approval of the most recent reviewable push" 要求最近一次推送必须由推送者以外的人批准。code owners 规则让特定路径的变更必须得到指定所有者的批准。
- **证据**：GitHub Docs, *About protected branches* https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches （原文已读）
- **可信度**：高。
- **借用**：(a) 审批记录里存 `proposalVersionId` 加 `contentHash` 加 `constraintVersion`，相当于"批准时的 diff"；(b) 引起 stale 的不只是提案本身的改动，**外部基线变化也算**（对应 GitHub 的 merge base 变化，在本系统里就是约束版本或预算变化）；(c) "必需审批人"对应 code owners；(d) "最后改动者不能自我满足审批"对应 most recent push 规则。在本系统里，代理生成提案，人批准，所以这条规则天然满足；但应禁止一个人同时满足两个必需角色。

### F4. SAP release strategy：批准后可改性由 changeability indicator 决定，超出容差就重置
- **结论**：SAP MM 的 release strategy 用 changeability indicator 控制已批准（released）采购单的改动行为：1 = 批准后不可改；2 = 可改且不重新确定策略；3–6 = 在策略改变、价值超出容差或已输出等条件下重新审批（reset release）。值 4/6 带 value change 百分比，例如涨价超过 10% 就重新走审批。社区报告了容差边界的已知缺陷：数量减少导致审批被重置到更低层级；某些情况下涨价却没有触发重置（KBA 3028481）。
- **证据**：SAP Help 4.6C https://help.sap.com/saphelp_46C/helpdata/EN/ac/2d547bb435d1118b3f0060b03ca329/content.htm ；SAP KBA 3028481 预览 https://userapps.support.sap.com/sap/support/knowledge/en/3028481 ；SAP Community https://answers.sap.com/questions/7679485/release-strategy---reset.html
- **可信度**：中（官方帮助版本较旧，其余是社区资料）。
- **借用**：有条件的重置逻辑容易出错，这是反面教材。本系统采用等价于 indicator 1 的规则：批准后的版本不可改；任何变化都生成新版本，旧审批全部作废。在 06 规则引擎里，`isApprovalStillValid` 只做哈希和版本相等比较，不做容差判断。

### F5. 多方变更单：所有必需方签字后才生效；金额与日期用"累计链"表达
- **结论**：AIA G701–2017 用来落实 owner、contractor 与 architect 三方已经同意的工作变更。表单有三方签字栏，三方都签字后才有效；执行完成即表示"同意变更的全部条款"，包括合同金额（或 GMP）和合同工期的调整。金额部分依次记录：(1) Original Contract Sum；(2) Net change by previously authorized Change Orders；(3) Contract Sum prior to this Change Order；(4) 本次增加或减少；(5) New Contract Sum。工期部分记录增减天数和新的 Substantial Completion 日期。尚未议定的 Construction Change Directive 不计入第 (2) 项。
- **证据**：AIA Contract Docs, *Instructions: G701–2017* https://help.aiacontracts.com/hc/en-us/articles/1500009322061-Instructions-G701-2017-Change-Order ；*Summary: G701–2017* https://help.aiacontracts.com/hc/en-us/articles/1500009384382
- **可信度**：高（官方说明页，已读）。
- **借用**：我们的场景也是三方（customer / provider / finance），与 owner / contractor / architect 一一对应。change order 执行记录应存 `baselineAmount`、`priorApprovedDelta`、`amountBefore`、`delta`、`amountAfter` 与 `dateBefore`、`dateAfter`、`daysDelta`，并且这些值都由代码从基线和已执行的变更单推导、校验，不由模型填写。"未议定的指令不计入累计"说明：只有 executed 状态的变更单才进入 `priorApprovedDelta`。

### F6. 预算视图按状态分栏：draft 不入账，pending 进"待定"栏，approved 进"已批准/已承诺"栏
- **结论**：Procore 的 change order 默认状态有 Draft（默认，不反映在预算）、Pending - In Review（进入 Pending Changes 栏）、其他 Pending 变体（Pricing、Proceeding、Revised 等，不带预算值）、Approved（进入 Approved Changes 栏）、Rejected（不入预算）、Void（只有 potential change order 可用，表示没有推进）。预算视图的公式是：Projected Budget = Revised Budget + Pending Budget Changes；Committed Costs 只统计 Approved 的 subcontract / PO / CO；Projected Costs = Committed + Direct + Pending Cost Changes。
- **证据**：Procore FAQ *Default statuses for change orders* https://support.procore.com/faq/what-are-the-default-statuses-for-change-orders-in-procore ；*About the Procore Standard Budget View* https://support.procore.com/products/online/user-guide/project-level/budget/tutorials/about-the-procore-standard-budget-view
- **可信度**：中高（官方支持文档；不同版本对 Revised Budget 的定义不一致）。
- **借用**：财务视图里分开显示 `committed`（已执行承诺）和 `pending`（已提出、审批中，只作提示，不占用额度）。Void 与 Rejected 要区分：Rejected 是被人拒绝，Void 是没有推进或被系统作废。

### F7. 承诺会计：分层金额类型，available 是算出来的，推进靠 liquidation
- **结论**：PeopleSoft Commitment Control 定义了几种金额类型：budget、planned、pre-encumbrance（"预计支出但没有法律义务"，例如请购单）、encumbrance（"有法律义务在将来支出"，例如采购单）、expenditure（实际支出）。请购单转成采购单时，pre-encumbrance 被 liquidate，同时记入 encumbrance；冲销不会让 pre-encumbrance 变成负数。available 不存储，在预算检查时计算。预算检查结果有 pass / error / warning 三种，可以设置 early warning 百分比；有权限的人可以 override，允许超出预算。PO 关闭时释放剩余 encumbrance；取消关闭时恢复。活动日志每行记录 Action、Doc、Seq、Period、Reversal flag、Close flag、Ledger、Amount。
- **证据**：Oracle PeopleSoft FSCM 9.2, *Understanding PeopleSoft Commitment Control* https://docs.oracle.com/cd/G24469_01/fscm92pbr53/eng/fscm/fscc/UnderstandingPeopleSoftCommitmentControl-9f2424.html （原文已读）；Tipalti 对 encumbrance accounting 的说明 https://tipalti.com/resources/learn/encumbrance-accounting-explained/
- **可信度**：高。
- **借用**：(a) 本系统的预算承诺是内部记录，没有法律效力（核心第 7 条），所以命名上应避免暗示法律义务，建议用 `commitment` 并在文档里定义为"内部承诺"，与会计里的 encumbrance 区分；(b) `available = budgetLimit − sum(active commitments) − (可选)pending reservations` 每次现算，不存可变余额；(c) 状态推进与释放（release / liquidate）都用追加的 entry 实现。

### F8. 资金检查（check）与资金预留（reserve）分开；预留点可以是提交时或批准时
- **结论**：Oracle Fusion Procurement 允许在提交请购单前做 check funds，这一步只验证，不占用额度；资金预留（reserve）发生在提交审批时或批准时，取决于 ledger 的 Budgetary Control 配置。所有可预留行的所有 distribution 都必须通过检查才能提交。带 insufficient funds override request 的请购单，无论配置的预留点是什么，都只在审批通过后才预留。encumbrance 会计分录在请购单被实施（implementation）时才生成。EBS 时代的行状态有 Passed / Failed Funds Check，以及预留前的 Pending、提交后的 Accepted / Rejected。
- **证据**：*Perform Check Funds on Requisitions*（25A）https://docs.oracle.com/en/cloud/saas/procurement/25a/fapra/use-case_PerformCheckFundsonRequisitions.html ；*How Funds Are Reserved for Requisitions*（25A，直接抓取被重定向到首页，内容取自搜索摘要）https://docs.oracle.com/en/cloud/saas/procurement/25a/oaprc/how-funds-are-reserved-for-requisitions.html ；*Submit Requisitions with Insufficient Funds Override Request*（24A）https://docs.oracle.com/en/cloud/saas/procurement/24a/fapra/Submit%20Requisitions%20with%20Insufficient%20Funds%20Override%20Request.html ；EBS 文档 https://docs.oracle.com/cd/E18727_01/doc.121/e13567/T237204T237232.htm
- **可信度**：中（官方文档，部分内容来自搜索摘要）。
- **借用**：本系统把三件事分开：确定性校验 `checkBudget()`（无副作用，提案生成和每次审批时都运行）；"预留"（v1 不做，见第 3 节含义 08）；"承诺"（只在执行事务里写入）。执行事务里必须**重新计算** available，不能信任审批时的检查结果。这对应 Fusion 的规则：override 的请购单要到批准后才预留。

### F9. 审批过期：期限按整个任务计算，过期自动拒绝；升级层级有上限
- **结论**：Oracle Fusion Procurement 的 Approval Rules Management 写明：expiration 和 escalation 策略"适用于整个任务，而不是每个审批人"。例如期限 3 天、审批人 4 个，就要在提交后 3 天内拿到全部 4 个批准，而不是总共 12 天。审批人在 expiration 时间内不操作，任务自动拒绝；escalation 沿 LDAP 管理链上推，达到最大升级层级仍无人操作也自动拒绝；renewal 可以延长期限。审批可以设成并行或串行；默认配置是"任何一个参与者 Reject 就结束整个任务"。
- **证据**：Oracle Fusion Procurement 25C *Approval Rules Management for Procurement* https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-rules-management-for-procurement.html （原文已读）；已知缺陷：escalate 和 expire 共用一个设置，无法只开升级不开过期，见 MOS 2215256.1 https://support.oracle.com/knowledge/Oracle%20Cloud/2215256_1.html （需登录，内容来自摘要）。
- **可信度**：高（主要结论），中（已知缺陷）。
- **借用**：`approvalRequest.expiresAt` 定义在"审批轮次"（某个提案版本上的整组审批）上，而不是单个审批人；到期后整组作废（状态 `expired`），不是"拒绝"。本系统里过期不代表有人反对，所以 reason 要和 `rejected` 分开。v1 不做 escalation；renewal 改成"重新发起审批"，生成新一轮审批。任何一个必需审批人拒绝，整轮立即结束。

### F10. 撤回（withdraw / recall）：发起人在审批完成前可以撤回，已批准的人会收到通知
- **结论**：Oracle Fusion 的 worklist 允许任务发起人在审批开始后撤回任务；HCM 的说明是：审批完成前，请求人或管理员可以撤回交易，已批准的审批人会收到撤回通知，交易从未审批者的待办里移除。Dynamics 365 的 PO change management 允许请求人 recall 已提交的变更请求，修改后重新提交；一个变更请求只保留一个 Draft 版本。
- **证据**：Oracle SCM *Manage Worklist* https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fapim/manage-worklist-from-the-product-information-management-work.html ；Oracle HCM *Approval Management Configuration Options* https://docs.oracle.com/en/cloud/saas/human-resources/24d/faucf/approval-management-configuration-options-for-oracle-fusion.html （抓取被重定向，内容来自搜索摘要）；Microsoft Learn *Use purchase order change management* https://learn.microsoft.com/en-us/training/modules/process-purchase-orders-dyn365-supply-chain-mgmt/3-use-po-change-mgmnt
- **可信度**：中。
- **借用**：区分两种"撤"：(a) 审批人撤回**自己的**批准（`approval.status: approved → revoked`，追加一条 revoke 记录，不删除原批准），只能在执行前进行；(b) 提案方撤回整个提案（`proposal.status → withdrawn`），整轮审批作废。两种情况都要通知已经批准的人（13 前端 / 事件）。执行之后不允许撤回，只能发起新的变更单去抵消（对应 F12 的 reversal）。

### F11. 审批后锁定；改动必须走变更请求并保留可比较的版本历史
- **结论**：Dynamics 365 / AX 2012 的 PO change management：采购单批准后锁定，要改必须启动 change request 工作流；系统把变更写进历史日志，可以和上一版本比较。开启 change management 时，版本在**批准时**登记，而不是在发送或确认时。例外是 master planning 生成的采购单永远自动设为 Approved。这是"系统生成的记录绕过审批"的反例，需要在本系统里禁止。
- **证据**：Microsoft Learn *Purchase order statuses and versions* https://learn.microsoft.com/en-us/training/modules/configure-manage-vendor-collaboration-dyn365-supply-chain-mgmt/8-po-versions ；AX 2012 *Key tasks: Change management for purchase orders* https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/key-tasks-change-management-for-purchase-orders
- **可信度**：中（培训模块加已归档的旧文档）。
- **借用**：版本有两个序列，不要混用：`proposal.version`（每次还价都 +1）和 `changeOrder.revision`（只有执行后才 +1，对应合同的第几次变更）。界面上的"与上一版本比较"应对比提案内容的规范化 JSON。

### F12. 账本不可变：pending 可改，posted 不可改；撤销靠反向交易；每次修改都留版本
- **结论**：Modern Treasury 的 ledger transaction 有 pending / posted / archived 三态；pending 可以 PATCH，posted 或 archived 之后状态和分录都不可变（metadata 除外）。撤销已 posted 的交易必须另写 reversing transaction，并通过 `reverses_ledger_transaction_id` / `reversed_by_ledger_transaction_id` 双向链接；每次创建或更新都生成一条 `ledger_transaction_version` 历史记录；分录必须借贷平衡，并有可选的唯一 `external_id`。
- **证据**：Modern Treasury *Ledger Transaction object* https://docs.moderntreasury.com/platform/reference/ledger-transaction-object （原文已读）；*Transaction Status and Balances* https://docs.moderntreasury.com/platform/docs/transaction-status-and-balances
- **可信度**：高。
- **借用**：`commitments` 表只插入，不更新金额。释放承诺（例如后续变更单把金额减少，或者财务取消）写一条带 `reversesCommitmentId` 的负向 entry。可变的只有不影响金额的备注类字段。`externalId` 等价于我们的 `idempotencyKey`，按唯一索引实现。

### F13. 幂等：保存第一次执行的结果；同 key 不同参数报错；并发冲突与校验失败不保存
- **结论**：Stripe API v1 在端点开始执行后，保存给定 idempotency key 的第一次请求的状态码和响应体，重试一律返回保存的结果（包括 500）。幂等层会比对新请求参数与原请求参数，不同就报错。参数校验失败或者与同时执行的请求冲突时不保存结果，可以重试。key 至少保留 24 小时后才可能被清理。文档建议不要用敏感数据作 key。API v2 改为把失败或部分失败的工作重试到完成。
- **证据**：Stripe API Reference, *Idempotent requests* https://docs.stripe.com/api/idempotent_requests.md （原文已读）
- **可信度**：高。
- **借用**：执行 mutation 的幂等键应由**业务内容**决定，而不是由客户端随机生成：`executionKey = hash(roomId, proposalVersionId, approvalRoundId)`。同一提案版本只能执行一次，与点了几次按钮无关。表里存 `requestFingerprint`，同 key 不同 fingerprint 返回 `IDEMPOTENCY_CONFLICT`，同 fingerprint 返回第一次的结果引用。我们的执行记录永久保存，不做 24 小时清理。

### F14. 单方签署变更 vs 双方协议：先下令、后定价是一种合法模式，但要显式区分
- **结论**：FAR 43.103：bilateral modification（supplemental agreement）由承包方和 contracting officer 双方签署，用于在 change order 发出后议定 equitable adjustment，以及记录各方的其他协议；unilateral modification 只由 contracting officer 签署，用于行政性变更和发出 change order。FAR 43.204 规定：change order 未预先定价时，需要两份文件，即 change order 本身加上反映调整的 supplemental agreement；能事先议定的，只需 supplemental agreement。AIA 的 Construction Change Directive 也是"先执行、后议价"，议定前不计入合同累计金额。
- **证据**：FAR 43.103 https://www.acquisition.gov/far/43.103 ；FAR Part 43 https://www.acquisition.gov/far/part-43 ；AIA G701 说明（同 F5）。
- **可信度**：高（法规原文，由搜索摘要获得）。
- **借用**：本系统 v1 只支持"事先定价的双方/三方协议"（对应 supplemental agreement），不支持"先执行后定价"。这样可以保证执行时金额已经锁定，符合核心第 4、5 条。06 规则里加一条：没有确定价格的提案不可进入审批（reasonCode `PRICE_NOT_DEFINITIZED`）。"单方指令"作为 17 路线图的扩展点。

### F15. 审计：保护审计信息不被修改，提供不可否认的行为证据，职责分离
- **结论**：NIST SP 800-53 Rev.5 的 AU-9 要求保护审计信息和工具不被未授权访问、修改、删除；AU-10（non-repudiation）要求能证明某个人（或代表他的进程）执行了某个动作；AC-5 是职责分离。FedRAMP 2026 的 Rev5 指南转载了 OSCAL 目录 5.2.0。
- **证据**：FedRAMP *Audit and Accountability* https://fedramp.gov/2026/reference/controls/audit-and-accountability/ ；Open Security Architecture 控制目录 https://opensecurityarchitecture.org/controls ；第三方摘要 https://compliance.theartofservice.com/controls/nist-sp-800-53-rev-5-low/au-9
- **可信度**：中（控制含义来自第三方摘要，官方原文未逐字核对）。
- **借用**：审批记录要能做到"不可否认"：存 Clerk `userId`、当时的成员角色快照 `roleAtApproval`、`approvedAt`（服务端时间）、所批准内容的 `contentHash`，以及审批人在界面上看到的 `displayedSummaryHash`。职责分离：同一个人不能满足两个必需审批角色；代理永远不能写 approval 行（核心第 2 条）。

---

## 2. 对本系统设计的含义（按任务书第 5 节文件编号）

### 02 领域模型
- **四个对象分开**：`proposalVersion`（不可变内容，对应 F1 里的 change order 草案）、`approvalRound`（某个版本上的一整轮审批，带期限，对应 F9 的任务级 expiration）、`approval`（单个人的决定，只追加）、`execution`（一次原子执行，派生出 `changeOrder`、`commitment[]`、`task[]`）。
- **基线和变更链**（F5）：每个房间有一个 `baseline`（原合同额、原日期、原范围），由用户确认；每个已执行的变更单记录 before / delta / after。不变量：`amountAfter(n) == amountBefore(n+1)`；`amountBefore(n) == baselineAmount + Σ delta(executed, < n)`。
- **两个版本序列**（F11）：`proposalVersion.seq` 表示协商轮次；`changeOrder.revision` 表示第几次已执行的变更，相当于合同的修订号。
- **命名**（F7）：用 `commitment`（内部承诺）而不用 `encumbrance`，并在术语表里写明"不具法律效力，不是会计 encumbrance"。

### 03 schema（字段可以直接借用）
```ts
approvalRounds: defineTable({
  roomId: v.id("rooms"),
  proposalVersionId: v.id("proposalVersions"),
  contentHash: v.string(),            // 规范化提案 JSON 的 sha256（F3 "批准时的 diff"）
  constraintVersion: v.number(),      // 发起时的约束版本（F3 merge-base 类比）
  requiredRoles: v.array(v.string()), // 例如 ["customer","provider","finance"]（F5 三方签字）
  status: v.union(v.literal("open"), v.literal("satisfied"), v.literal("rejected"),
    v.literal("expired"), v.literal("superseded"), v.literal("withdrawn"), v.literal("executed")),
  openedAt: v.number(), expiresAt: v.number(),   // 任务级期限（F9）
  closedAt: v.optional(v.number()), closedReason: v.optional(v.string()), // reasonCode
}).index("by_room_status", ["roomId","status"]).index("by_proposalVersion", ["proposalVersionId"]),

approvals: defineTable({   // 只插入；撤回 = 新插一行 decision:"revoke"
  approvalRoundId: v.id("approvalRounds"),
  role: v.string(), userId: v.string(), roleGrantId: v.id("roleGrants"), // 角色快照（F15）
  decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("revoke")),
  contentHash: v.string(), constraintVersion: v.number(),   // 冗余存储，守卫用相等比较
  displayedSummaryHash: v.optional(v.string()),             // 审批人看到的摘要
  reason: v.optional(v.string()), decidedAt: v.number(),
}).index("by_round_role", ["approvalRoundId","role"]),

executions: defineTable({
  executionKey: v.string(),            // hash(roomId, proposalVersionId, approvalRoundId)（F13）
  requestFingerprint: v.string(),
  approvalRoundId: v.id("approvalRounds"), changeOrderId: v.id("changeOrders"),
  executedAt: v.number(), executedBy: v.string(),
}).index("by_executionKey", ["executionKey"]),

changeOrders: defineTable({            // 字段取自 AIA G701（F5）
  roomId: v.id("rooms"), revision: v.number(), proposalVersionId: v.id("proposalVersions"),
  currency: v.string(),
  baselineAmountMinor: v.number(), priorApprovedDeltaMinor: v.number(),
  amountBeforeMinor: v.number(), deltaMinor: v.number(), amountAfterMinor: v.number(),
  dateBefore: v.string(), dateAfter: v.string(), daysDelta: v.number(),
  scopeAdded: v.array(v.string()), scopeRemoved: v.array(v.string()),
  status: v.union(v.literal("executed"), v.literal("reversed")),
  isSimulated: v.boolean(),            // 核心第 8 条
}).index("by_room_revision", ["roomId","revision"]),

commitments: defineTable({             // 只插入的账本（F7/F12）
  roomId: v.id("rooms"), changeOrderId: v.id("changeOrders"), budgetLineKey: v.string(),
  kind: v.union(v.literal("commit"), v.literal("release")),
  amountMinor: v.number(),             // release 为负
  reversesCommitmentId: v.optional(v.id("commitments")),
  createdAt: v.number(), isSimulated: v.boolean(),
}).index("by_room_line", ["roomId","budgetLineKey"]),
```
- 金额一律用整数最小货币单位（`*Minor`）；available 不存储，现算（F7）。
- 唯一性：Convex 没有唯一约束。在执行 mutation 里先用 `by_executionKey` 查询，再插入；Convex mutation 的可串行化事务保证并发下只有一个成功（平台细节以 inputs/04 为准，"待验证"）。

### 04 状态机
- `approvalRound`：`open → satisfied`（全部必需角色都有有效 approve）→ `executed`；`open → rejected`（任一必需角色 reject，F9 默认规则）；`open → expired`（`now > expiresAt`，由 scheduler 驱动，F9）；`open|satisfied → superseded`（新提案版本或约束版本递增，F3/F4）；`open|satisfied → withdrawn`（提案方撤回，F10）。`satisfied` 只是派生条件；如果在 satisfied 后、执行前出现 revoke，回到 `open`。
- 有效批准的判定：每个角色取最新一条 decision；它必须是 `approve`，且 `contentHash == round.contentHash`，且 `constraintVersion == room.currentConstraintVersion`。
- 不设"容差内免重审"（F2/F4 的反面教材）；任何变化都 → `superseded`。
- `changeOrder`：只有 `executed`，以及 `reversed`（由后续反向变更单产生，原记录不改，只追加关联）。

### 05 协议
- 代理动作 `recommend_accept` 只能把提案标为"建议提交审批"，不能创建 `approval` 行（核心第 2 条，F15 职责分离）。
- 提案进入审批前必须"已定价"（F14）：价格行全部来自目录或用户确认，否则返回 `PRICE_NOT_DEFINITIZED` 并向具体的人请求。

### 06 规则引擎
- `checkBudget(input) → {result:"pass"|"fail"|"warn", reasonCodes}`，三态取自 PeopleSoft（F7）；`warn` 对应 early warning 阈值，例如已承诺额达到预算的 90%。
- `isApprovalValid(approval, round, room)`：纯相等比较（F3）。
- `computeChangeOrderChain(baseline, executedCOs, proposal)`：生成 G701 那组 before / delta / after 字段，并校验链条连续（F5）。
- `overrideBudget` 不在 v1 提供；如果以后要做，应建模为一个独立的必需审批角色（F8 override 批准后才预留）。

### 07 权限隐私
- 审批人必须持有当前有效的 `roleGrant`；同一 `userId` 不能满足两个 `requiredRoles`（AC-5 / F3 most-recent-push 规则）。
- 已批准者收到撤回、作废通知时，事件只包含对他可见的字段（F10）。

### 08 审批执行
- 执行时序：mutation `executeApprovedProposal(roundId)` → (1) 用 `executionKey` 查询，已存在就返回原结果（F13）；(2) 在同一事务内重新读取 room 约束版本、round、全部 approvals，重新判定有效性；(3) **重新运行 `checkBudget`**，因为审批时的结论不能作为依据（F8）；(4) 插入 changeOrder（revision = 上一条 + 1）、commitments、tasks、execution、event；(5) round → `executed`。任何一步失败，整个事务回滚，round 保持 `satisfied`，并返回 reasonCode。
- 是否要"审批中预留"（pre-encumbrance）：建议 v1 **不预留**，只在财务视图里把 `pending` 显示为提示（Procore 的 Pending 栏，F6），以免并发提案互相锁住额度；执行时以重新检查的结果为准。
- 过期：scheduler 在 `expiresAt` 触发 `expireRound`。这个函数先检查状态仍为 `open` 再迁移，以保证幂等。

### 09 约束变化
- 约束版本递增时，批量把该房间所有 `open|satisfied` round 置为 `superseded`，并写事件（F3 的 merge base 变化）。已执行的变更单不受影响；如果预算下调后已承诺额超出预算，标记"超额"并向财务请求取舍，不自动反向冲销（F12：纠错只能靠新的反向记录，并且要由人决定）。

### 10 运行时
- 代理不触发执行；`expireRound` 和 `supersedeRounds` 由 scheduler 或约束变更 mutation 调用，不由模型调用。

### 13 前端
- 审批卡片显示"批准的是 v{seq}，内容指纹 {hash 前 8 位}，约束版本 {n}"；stale 时显示原因（新版本 / 约束变化 / 过期 / 撤回），对应 GitHub 的 stale 标记（F3）。
- 财务视图按 Procore 分栏：baseline / committed（已执行）/ pending（审批中，提示）/ available（现算）（F6）。
- 变更单详情展示 G701 风格的金额与日期链（F5），模拟数据要有明显标记。

### 16 测试
- 用例来自已知缺陷：数量减少或金额减少同样作废审批（SAP 的教训，F4）；同 key 不同参数返回冲突（F13）；并发双击执行只产生一条 changeOrder；预算在 satisfied 后下调，执行时被拒绝（F8）。

### 17 路线图
- 单方先执行、后议价（FAR change order / AIA CCD，F14）；预算 override 角色；审批 escalation 与 renewal（F9）；外部 ERP 写入时把 `executionKey` 作为对方的 idempotency key 或 external_id（F12/F13）。

---

## 3. 未解决的问题
1. **审批期限的默认值和计时起点**：从 round 打开开始算，还是从最后一次通知开始算？场景插件是否可以覆盖？Oracle 的做法是任务级、从提交开始，但默认天数没有通用标准。
2. **撤回自己的批准是否需要理由，是否有冷却期**：资料只说明了"发起人撤回"，没有找到"审批人撤回自己的批准"的成熟规范；目前建议在执行前允许撤回，并强制填写理由。
3. **pending 是否占用额度**：不预留可能让财务批准两个各自可行、合起来超支的提案，不过执行时的重新检查会拦下第二个。是否需要"软预留"并给出可见的提示，要结合并发提案的频率决定。
4. **Convex 的唯一性保证**：依赖 mutation 的事务语义实现"先查后插"的唯一性，需要用 inputs/04 和 convex-test 并发测试验证。
5. **`displayedSummaryHash` 的计算口径**：对应审批人在界面上看到的公共摘要。如何规范化（字段顺序、货币格式、语言），需要与 07 的"对他方可见文本生成"统一。
6. **多币种和税**：AIA 和 ERP 都按单一合同币种计算；本场景是否只支持单币种，需要在 14 场景文档里确定。
7. **Coupa、SAP Ariba 的编辑后重审规则**：官方文档未公开或需要登录才能查看，本研究没有一手证据。结论只依赖 Oracle、GitHub 和 SAP 的旧文档。

## 4. 来源清单（访问日期 2026-10-24）
1. https://docs.oracle.com/en/cloud/saas/procurement/23d/oaprc/change-orders.html
2. https://docs.oracle.com/en/cloud/saas/procurement/25a/oadpr/PurchasingDocumentVersionExtractPVO.html
3. https://docs.oracle.com/en/cloud/saas/procurement/24d/oedmp/poversions-25190.html
4. https://ap1.mclaneco.com/OA_HTML/HelpServlet/US/PO/@cocst
5. https://docs.oracle.com/en/applications/e-business-suite/readiness/procurement/12.2/whats-new/ebs-proc-wn-f40460.htm
6. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
7. https://help.sap.com/saphelp_46C/helpdata/EN/ac/2d547bb435d1118b3f0060b03ca329/content.htm
8. https://userapps.support.sap.com/sap/support/knowledge/en/3028481
9. https://answers.sap.com/questions/7679485/release-strategy---reset.html
10. https://help.aiacontracts.com/hc/en-us/articles/1500009322061-Instructions-G701-2017-Change-Order
11. https://help.aiacontracts.com/hc/en-us/articles/1500009384382
12. https://support.procore.com/faq/what-are-the-default-statuses-for-change-orders-in-procore
13. https://support.procore.com/products/online/user-guide/project-level/budget/tutorials/about-the-procore-standard-budget-view
14. https://docs.oracle.com/cd/G24469_01/fscm92pbr53/eng/fscm/fscc/UnderstandingPeopleSoftCommitmentControl-9f2424.html
15. https://tipalti.com/resources/learn/encumbrance-accounting-explained/
16. https://docs.oracle.com/en/cloud/saas/procurement/25a/fapra/use-case_PerformCheckFundsonRequisitions.html
17. https://docs.oracle.com/en/cloud/saas/procurement/25a/oaprc/how-funds-are-reserved-for-requisitions.html
18. https://docs.oracle.com/en/cloud/saas/procurement/24a/fapra/Submit%20Requisitions%20with%20Insufficient%20Funds%20Override%20Request.html
19. https://docs.oracle.com/cd/E18727_01/doc.121/e13567/T237204T237232.htm
20. https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-rules-management-for-procurement.html
21. https://support.oracle.com/knowledge/Oracle%20Cloud/2215256_1.html
22. https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fapim/manage-worklist-from-the-product-information-management-work.html
23. https://docs.oracle.com/en/cloud/saas/human-resources/24d/faucf/approval-management-configuration-options-for-oracle-fusion.html
24. https://learn.microsoft.com/en-us/training/modules/process-purchase-orders-dyn365-supply-chain-mgmt/3-use-po-change-mgmnt
25. https://learn.microsoft.com/en-us/training/modules/configure-manage-vendor-collaboration-dyn365-supply-chain-mgmt/8-po-versions
26. https://learn.microsoft.com/en-us/dynamicsax-2012/appuser-itpro/key-tasks-change-management-for-purchase-orders
27. https://docs.moderntreasury.com/platform/reference/ledger-transaction-object
28. https://docs.moderntreasury.com/platform/docs/transaction-status-and-balances
29. https://docs.stripe.com/api/idempotent_requests.md
30. https://www.acquisition.gov/far/43.103
31. https://www.acquisition.gov/far/part-43
32. https://fedramp.gov/2026/reference/controls/audit-and-accountability/
33. https://opensecurityarchitecture.org/controls
34. https://compliance.theartofservice.com/controls/nist-sp-800-53-rev-5-low/au-9
