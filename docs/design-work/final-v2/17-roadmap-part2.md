# 17 · 演进路线与扩展点（part2）：第二场景契约、明确不做、收尾

> 分片见 `17-roadmap.md` 顶部。

## 17.3 第二场景：`procurement_rfq` 契约测试 fixture（U6 默认）

**为什么选它**（PD-07）：它恰好暴露首个场景没覆盖的两点——**同一角色多席位**与**多个提案并排比较**——又不动"有金额、至少两个审批角色"的引擎假设。`event_budget` 与首场景太像，考验最弱；`shift_swap` 没有金额且审批人只有一个，会碰核心 3 的假设。v1 只写 fixture 与契约测试，不写 UI、不注册到生产场景表。v1 的契约 fixture 是**单 supplier、三席**（requester / supplier / procurement 各一席）的纯插件，只用现有 `Terms` / `Effect` 类型；多席位、由条款决定审批集合、卖方私有目录都以**能力声明**的形式出现，由注册表拒绝并给出能力缺失码（R1、R3、R4），不拿一个注定失败的多 supplier fixture 充当通过证据。

**fixture 草图**（`core/scenarios/procurement-rfq/fixture.ts`，只在测试中加载）：

| 要素 | 内容 |
| --- | --- |
| 角色 | `requester`（需求方，买方）、`supplier`（一席）、`procurement`（预算拥有者，相当于 finance）；多家 supplier 各占一席（`supplier:a` / `supplier:b`）是延后能力，只作被拒绝的能力声明（R1） |
| 目录 | supplier 的 `catalogItems`，已确认即对房间可见（与 scope_change 相同）；多家 supplier 的目录彼此不可见是延后能力（R3） |
| 条款 | 现有 `Terms`（`{ itemKeys, modifiers, deliveryDate, amountCents }`，D25）：买哪些；"选哪家"（`supplierSeat`）依赖多席位，延后 |
| 必需审批 | `requester(terms)`、`supplier(terms)`、`procurement(budget)`——`requiredApprovals` 只由 `roles[].approvalKind` 派生（06 §12.1 / §12.3），在提案插入时快照；"只要被选中的那一家 supplier 批准"依赖条款与多席位，延后（R4） |
| 约束 | requester 的必需条目与截止日；procurement 的上限与基线 |
| 预期协商 | 每轮 supplier 一个 propose 回合，requester 与 procurement 串行评估（同 scope_change，D08）；"并排比较多家报价"降级为 requester 的 `choose_candidate` 请求（R2） |

**它对引擎提出的要求与 v1 的处置**：

| # | 要求 | v1 现状 | 契约测试断言（v1 必须通过） |
| --- | --- | --- | --- |
| R1 | 同角色多席位：`members` 唯一性 `(roomId, role)` 需放松为席位实例 | 不支持（D24 一人一房一席、一席一人） | 插件声明 `seatsPerRole: { supplier: 2 }` 时，场景注册表**拒绝注册**并给出能力缺失码，而不是静默运行 |
| R2 | 多个提案并排：每 run 不止一个 `active` 提案 | 不支持（`run.currentProposalId` 单值，D08 单 proposer） | `resolveRound` 的输入类型只接受单 proposer；fixture 把"并排"降级为 requester 的 `choose_candidate` 请求时可以跑通 |
| R3 | 卖方之间互不可见的目录 | 部分支持：披露矩阵按字段类声明，但目录行默认房间可见 | 插件声明"目录行按卖方席位私有"时，场景注册表**拒绝注册**并给出能力缺失码；多 supplier 的非干扰性质（改 `supplier:b` 的价格，`supplier:a` 的视图逐字节不变）待 R1 / R3 支持后再写，不作为 v1 用例 |
| R4 | `requiredApprovals` 依赖条款 | 不支持：`requiredApprovals` 只由 `roles[].approvalKind` 派生、在提案插入时快照（06 §12.3：插件无法覆盖） | 单 supplier fixture 的 `requiredApprovals` 恰为三个角色的派生项，`evaluateApprovalSet` 按快照判齐；插件声明依赖条款的审批集合时，场景注册表**拒绝注册**并给出能力缺失码 |
| R5 | 多 proposer 的轮次与 fit 信号 | 不支持多 proposer；fit 信号按角色 | supplier 的投影与 scope_change 的 provider 相同，只见 `ok / blocked`（投影测试）；"每家只见自己的提案与结论"待 R1 / R2 支持后再写 |
| R6 | 引擎表不出现场景字面量 | 部分：`proposals.lines` / `terms` 形状偏"目录子集 + 单一预算" | 插件接口 16 个必需成员 + 2 个可选成员（06 §12.1）能表达 procurement 的条款；若需改引擎 schema，测试列出具体字段（评委"引擎 / 场景边界名不副实"反例的回归） |
| R7 | 规则与投影的通用检查 | 支持 | `hardProjection` 性质测试（投影相等 ⇒ 阻断集合相等）；模板 `reads` Proxy 对账；fixture 过 `lintCanaries`；候选快照 ≤ 12 且按 `candidateKey` 稳定排序 |

结论写进 18：引擎在 v1 明确只支持"每角色一席、每 run 一个 proposer、目录对房间可见或按字段披露"的场景；R1 / R2 / R3 / R4 是真正支持第二场景前必须先做的引擎改动，届时同时触发 E6 四包拆分。

## 17.4 明确不做（防止被重新引入）

| 方向 | 为什么不做 | 若将来确有需要 |
| --- | --- | --- |
| **单方先执行、后议价**（FAR unilateral change order / AIA Construction Change Directive） | 与核心 2（代理只建议）、3（人批准具体版本）、5（全部必需审批到齐后才执行）冲突（research §7.1-1） | 只能建模为"新增一个必需审批角色"并仍走审批，不能绕过 |
| 审批容差 / 管理员越权批准 | GitHub stale review 是最强同构先例；SAP / Ironclad 的容差与越权正是反例（research §0.4） | 不提供；"小额免审"只能以引擎级委托规则设计并写 ADR，不能让插件绕过"预算承诺必须有预算拥有者批准" |
| 代理之间的自由文本私聊 | 致命三要素齐全；泄露率 35–50%（research §1.4、§4.5） | 不提供；跨方只有结构化动作与模板文本 |
| 执行事务内调用外部系统 | 破坏原子性与幂等；外部 exactly-once 不可得 | 只经 outbox（E12） |
| 把哈希链宣传为防篡改 | 链头在同库，有写权限者可整条重算（评委反例） | 只有加外部锚点后，且只宣称"锚定后改动可发现"（E3） |
| 转账、电子签名、法律合同、写外部 ERP | 核心 7 | 外部集成扩展点（E12），系统内永远只写内部记录 |
| 端到端加密 / "数据不出设备"承诺 | 私密上下文必须发给模型提供方 | 不承诺；07 写明 |
| 语音、代理市场 | 与私密委托、单场景打磨无关（DX、FX-08/10） | — |

## 17.5 产品验证活动（非系统功能）

- 访谈有外包、采购或财务协调经验的人：记录流程、痛点、据此做出的改动（V-03）。
- 验证 H1 / H2（客户方是否有独立预算负责人；provider 是否愿意进客户的房间）与 H3 规模。
- 度量（15）：首个合格提案用时、人工干预次数、被拦下的硬约束违规（执行中应为 0）、未达成比例与原因、每次执行的估算模型成本、审批前停留时间与差异展开率；报告样本量与失败。

## 本章不变量

1. 任何扩展都不得让代理产物写入 `approvals`，不得让执行在必需审批齐全之前发生。
2. 任何外部副作用只发生在提交后的 action 中，经 outbox，且以 `executionKey` 或 `eventId` 去重。
3. 账本只追加：修订只能追加 `release`，不能改写或删除 `commit`。
4. 扩展的可见性一律经 `projectForRole`；新增字段必须在 07 的矩阵中声明披露类，未声明即不可见（fail-closed）。
5. 第二场景在引擎支持 R1–R4 之前不能进入生产场景注册表。

## 开放问题（汇入 18）

1. E11 跨房间预算：他房执行改变本房已承诺额时，是否进入本房硬投影（会作废无关审批）。
2. E7 抽取的结果如何在"无公开 action"的约束下返回给本人（12 设计）。
3. E3 链头锚点的外部存储选型与"每日校验"的告警归属（15）。
4. E2 修订放在新房间进行时，新房间的必需审批是否必须与原执行的审批人一致（成员更换场景，与 E10 联动）。
5. U6：若用户把第二场景改为 `event_budget` 或 `shift_swap`，§17.3 的 R1–R7 需要重写。

## 与 canon 的对照

本章不改变任何 v1 裁决：canon D01 / D04 / D09 / D14 / D21 / D23 / D24 / D26 延后或否决的能力，只在 E1–E13 中给出触发条件、v1 已预留的接口与对引擎的要求（每项已标 Dnn / Cnn），不再逐条复列。下表只列细化与 part7 must_absorb 的落点。

| canon 条目 | 本章的细化 | 位置 |
| --- | --- | --- |
| D04 / C3 | 若将来做同房间追加轮，先满足五条前置不变量；更便宜的替代是 `followsExecutionId` 链上的只读项目视图 | E1 |
| D23 | 系统内唯一合法的"降低已承诺"路径是经审批的 `release`，放在 `startFollowUp` 新房间进行 | E2 |
| U6 | `procurement_rfq` 契约测试对引擎的要求 R1–R7；R1–R4 是支持第二场景前必须先做的引擎改动 | §17.3 |
| part7 17-roadmap must_absorb | PD-05(b)(c)（E1、E2）；链头外部锚点（E3）；workpool / workflow 触发（E4、E5）；四包拆分（E6）；LLM 简报抽取（E7）；通知 outbox（E8）；审批 / 报价有效期（E9）；成员更换 / 多席位（E10）；跨房间预算（E11）；`procurement_rfq` 对引擎的要求（§17.3）；外部集成只经 outbox（E12、§17.4）；"单方先执行后议价"明确不做（§17.4） | — |
