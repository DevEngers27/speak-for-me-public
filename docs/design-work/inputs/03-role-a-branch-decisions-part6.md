# 03 Role A 分支决定 · part6：§5 确定性规则（一）预算、检查清单、校验来源、双版本审批

## 5.1 RA-R01 预算不变式 — 采纳（改落点）

- **现状**：
  - `total = room.committedCents + proposal.additionalCostCents; fits = total <= room.totalBudgetCents`（lib/workspace/rules.ts:25-26）；
  - `remainingCents = cap − committed`（rules.ts:10）；
  - 建房要求 committed ≤ cap（lib/workspace/preview-store.ts:143），改上限不得低于 committed（preview-store.ts:293），执行时 committed 累加（preview-store.ts:124）。
- **理由**：这是原 README 和场景最核心的确定性规则，用整数分，算术正确。
- **问题**：
  1. committed 是可变计数（RA-B09），检查结果随时间变化：已执行的提案事后再检查必然"超预算"，UI 只好构造 basis 减回去（components/workspace/workbench.tsx:144-145）；
  2. 超出额直接写进全员可见文本（RA-B08）。
- **新设计要求**：
  - 不变式 I-budget：对每个 budget，baseline + Σ commitments ≤ capCents 始终成立；
  - 执行 mutation 在同一事务内重算并断言；
  - 检查函数为纯函数 `checkBudget({capCents, committedCents, priceCents}) → {ok, reasonCode: "budget.within" | "budget.over", overByCents}`；overByCents 披露给谁由 07 决定。

## 5.2 RA-R02 `checkProposal` 四项检查 — 修改后采纳

- **现状**：rules.ts:20-47 返回 `Check {id, ok, label, detail}[]`：

| id | 标签 | 实际实现 |
| --- | --- | --- |
| terms | Terms are complete | Zod `proposalTerms`：scope 非空、非负安全整数分、`z.iso.date()`、sourceRefs 非空 |
| current | Current version | `proposal.version === room.proposalVersion` |
| constraints | Matches current constraints | `proposal.constraintsVersion === room.constraintsVersion`，只比版本号 |
| budget | Within the budget cap | committed + cost ≤ cap |

  `isExecutable` 要求全部通过（rules.ts:49）。approve 前要求全过（preview-store.ts:249-250），执行前再查一次（preview-store.ts:116）。
- **保留的部分**：
  - 检查清单的形状：每项带人类可读的 detail，UI 原样列出 Pass/Fail；
  - 调用点：批准前、执行前都查。
- **否决的部分**：把这四项当作完整的检查集。注释说 "The backend (B2/B3) must enforce the same rules server-side"（rules.ts:5-6），README diff 第 108 行也这么写，照做会把缺口原样带进后端。
- **缺陷**：
  1. **"Matches current constraints" 名不副实**（gap1-07，RA-B01）：只比较版本号，不检查必需范围和截止日。审查已复现：上限降到 $4,800 后，provider 确认一个 `["Change item 3"]`、$700、2026-12-20 的报价，bestFeasibleOption 选中它，四项全部 Pass，三方批准后写入承诺。这个方案延后了客户必需的 1、2 项，又晚于截止日。
  2. **没有来源核对**（RA-B04，本次新发现）：从不核对价格、范围、日期是否与引用的已确认报价一致，sourceRefs 只要是非空字符串就行。报价在提案之后被改价，旧提案照样可批。
  3. **没有日期语义**（security-22，RA-B11）：不查交付日是否晚于截止、是否早于今天。fixture v1 交付 2026-12-04，晚于客户截止 2026-11-20，却只被报为超预算。
- **新设计要求**：检查集按 reasonCode 组织，由引擎与场景插件共同组成。
  - **引擎级**：
    - schema 合法；
    - 提案是当前提案；
    - 约束版本一致，标签改为"按约束 vN 评估"，不再暗示检查过约束内容；
    - 必需审批人集合非空；
    - 来源可解析、全部为 confirmed、未过期；
    - 条款与来源一致：价格 = Σ 引用报价价格；范围 ⊆ 引用报价范围；交付日 = 引用报价的日期（多个报价时取规则规定的最晚者）。
  - **场景级（scope_change）**：
    - budget；
    - requiredScope ⊆ scope；
    - deliveryDate ≤ deadline；
    - deliveryDate ≥ 今天（按房间时区）；
    - deferred 不含必需项。
  - **输出**：`{checkId, ok, reasonCode, params}`，文本由模板按受众渲染（§8.2）。私密约束（例如客户未共享的截止日）不满足时，他方看到什么由 07 决定（开放问题 Q3）。

## 5.3 RA-R03 条款校验来源 — 修改后采纳

- **现状**：检查用 `proposalTerms`（lib/negotiation.ts:5-10）；saveBrief 另写一套校验：`/^\d{4}-\d{2}-\d{2}$/` + `Date.parse`（preview-store.ts:174）。
- **缺陷**（RA-B10，本次新发现）：两套校验对日历日的判断不一致。用该仓库安装的 zod 4.6.7 实测：
  - `Date.parse("2026-02-30")` 滚动成 2026-03-02，被 saveBrief 接受，而 `z.iso.date()` 拒绝；
  - `2026-11-31`、`2026-02-29` 同理。
  浏览器的 date 输入框能挡住这类值，但存储层会接受一个之后永远过不了 terms 检查的报价。这正是 architecture-24 说的"两套真相源"。
- **新设计要求**：
  - 一个共享校验模块（例如 `engine/validators`）。Convex validator 与 Zod schema 共用枚举和金额、日期谓词，最好从同一来源生成；
  - 日期一律 `YYYY-MM-DD` 并校验真实日历日；
  - 客户端校验只为即时反馈，服务端必须再校验一次。

## 5.4 RA-R04 双版本审批与 stale — 采纳（改绑定键）

- **现状**：`approvalStates`（rules.ts:55-68）对每个 approvalRequired 成员判断：
  1. 有与 (proposal.version, room.constraintsVersion) 匹配的审批 → approved；
  2. 有匹配的拒绝 → rejected；
  3. 有任何更早的审批 → stale（"that approval no longer applies"）；
  4. 否则 pending。
  审批记录从不删除。结果页 Approval record 给每条记录打上 Used for execution / Current / No longer applies 标签（components/workspace/results-page.tsx:104-122）。
- **理由**：
  - 旧审批"保留但不计数"正是核心 3 与核心 6 的要求；
  - 降预算后 customer 的审批在三个窗口里同时变成 stale，是原 README 演示的核心时刻。
- **问题**：
  1. 绑定的是版本号，不是不可变内容（security-03）；
  2. 只有旧审批会显示 stale，旧拒绝显示为 pending（rules.ts:64-66，RA-B30）。
- **新设计要求**：
  - `decisionState(participant)` 由该参与方对 (currentProposalId, currentConstraintsVersion, contentHash) 的最后一条 decision 决定；
  - 绑定不匹配的更早决定显示为 stale，并区分 `stale_approve` / `stale_reject`，界面可以解释"你之前批准过 v2，约束已从 v1 变为 v2"。

## 5.5 RA-R05 必需审批人 — 修改后采纳

- **现状**：`allApproved = states.length > 0 && every approved`（rules.ts:70）。必需集合是当前 members 中 approvalRequired 的成员（rules.ts:58），检查时动态读取。
- **问题**（RA-B18）：提案生成后成员或审批要求变化，会悄悄改变"已经全员批准"的含义。
- **新设计要求**：
  - 提案创建时快照 `requiredApproverParticipantIds`，取值来自场景规则（scope_change 默认三方都需要）；
  - 成员或审批要求变化视为约束变化；
  - product-21 指出"服务商签核条款"和"客户内部的预算承诺"权责不同，是否拆成两类审批列为开放问题 Q5。

## 5.6 RA-R06 / RA-R07 审批守卫与"最后一票即执行" — 采纳

- **现状**：
  - approve 的守卫：是 approvalRequired 成员、房间未 confirmed、存在当前提案、四项检查全过、未重复批准（preview-store.ts:245-252）。写入审批后在同一次 mutate 中调用 execute（preview-store.ts:260）；
  - reject 不要求检查通过（preview-store.ts:266-285），已批准者不能再拒绝。
- **理由**：
  - 不让人批准一个不可执行的版本，但永远可以说不；
  - 最后一票与执行同在一个事务里，不会出现"全员已批准却没人点执行"的悬空状态，并发的最后两票也只会有一次执行成功。Convex mutation 的事务与 OCC 重试语义以 inputs/04 为准。
- **新设计要求**：
  - 执行逻辑是内部函数，由 approve mutation 和一个显式的"重试执行"入口共用；
  - 入口内重算全部守卫：身份与成员资格、提案为当前、约束版本一致、contentHash 一致、全部检查通过、全部必需决定为当前的 approve、operationId 尚未执行。

## 5.7 RA-R08 / RA-R09 `operationId` 与重复执行 — 修改后采纳

- **现状**：
  - `operationId = ${room.id}:p${proposal.version}:c${room.constraintsVersion}`（rules.ts:80）；
  - execute 先查重，再跑检查（preview-store.ts:114-117）。这个顺序是对的：执行后 committed 已经增加，如果先查预算，重复请求会被误报为"未就绪"；
  - 重复请求返回 "duplicate"；resendExecution 每次都写一条 `duplicate_execution_ignored` 房间事件（preview-store.ts:340-343）。
- **保留的部分**：服务端派生、确定性、写前查重。architecture-03 和 security-04 要求的正是这些。
- **问题**：
  1. 依赖版本号唯一；
  2. 每次重试都写房间事件，任何成员都能刷屏（RA-B25）。
- **新设计要求**：
  - operationId 由 (proposalId, constraintsVersion) 派生，或直接用这个二元组作唯一键；
  - executions 表按 operationId 建索引，执行 mutation 内"先读，不存在才写"；
  - 重复请求返回已存在的 execution（幂等结果），不报错；
  - 重复次数记入运维日志或计数器，不写房间事件；
  - "Send the execution request again" 只出现在自动化测试里（RA-U12）。
