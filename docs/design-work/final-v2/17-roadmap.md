# 17 · 演进路线与扩展点（part1）

> 分片：`17-roadmap.md`（本文件：目标、§17.1 阶段、§17.2 扩展点总表与逐项要求）→ `17-roadmap-part2.md`（§17.3 第二场景 `procurement_rfq` 契约测试 fixture 对引擎的要求、§17.4 明确不做、§17.5 产品验证活动、不变量、开放问题、与 canon 的对照）。
> 底稿：`candidates/product/17-roadmap.md`（阶段、扩展点对引擎接口的要求）+ `candidates2/plugin/17-roadmap.md`（第二场景对插件接口的要求）。吸收 `research/README.md` §6 17 段与 §7、canon D01/D04/D14/D21/D24/D26 与 U6。canon 的裁决是：凡列入本章的能力，v1 都**不做**，只保留接口与触发条件。

## 目标

1. 给出从设计到可用产品的阶段与出口标准。
2. 对每个延后的能力说清：它解决什么问题、对引擎接口的要求、触发条件、v1 已预留什么、不能怎么做。
3. 用第二场景 `procurement_rfq` 的契约测试 fixture 证明引擎接口的边界在哪里，而不是在 v1 里把它实现出来。
4. 明确列出"永不做"的方向，防止被重新引入。

## 17.1 阶段

| 阶段 | 内容 | 出口标准 |
| --- | --- | --- |
| M0 平台验证（实现第 1 周，U11） | spikes §8 的 18 项真实部署验证按影响章分配给各章实现者；techstack §6 的 O4–O10；各专题 review 新增的待验证项（18 汇总） | 每项有结论并回填对应章；任一项否定当前设计时先改设计再进入 M1 |
| M1 引擎骨架 + stub | 身份与 `users`、房间与成员、邀请、简报、目录、台账、`constraints.bump`、规则引擎、提案、审批、执行、事件、stub 运行时（`AgentDriver` 的 stub / scripted 驱动）、scope_change 插件、投影与隐私测试 | 16 的 L0–L2 全绿；14 的主线与全部变体在 stub 下端到端通过；R1–R11 对账在每个 convex-test 场景 afterEach 通过 |
| M2 真实代理 | `modelGateway`（`stream().finalMessage()`、运行时白名单）、上下文组装、看门狗、用量记账、离线评测 runner | 评测发布门槛达标并确定 effort（U5）；隐私金丝雀与注入语料通过；真实部署并发探针（`maxOverlap ≥ 2`）通过 |
| M3 产品化 | 13 的完整旅程、可访问性门禁、15 的环境与排空、采购项（U9） | E2E 与 axe 门禁全绿；内部试用；首个真实用户进 prod 前完成采购与备份演练 |
| M4 扩展 | 按 §17.2 的触发条件逐项进入 | 每项先写 ADR（18）再实现 |

## 17.2 扩展点总表

| # | 扩展 | 解决的问题 | 触发条件 | v1 已预留 | 对引擎的要求（摘要，细节见下） |
| --- | --- | --- | --- | --- | --- |
| E1 | 同房间追加轮（PD-05b） | 一个项目的多次变更集中在一个房间 | 用户访谈确认"跨房间历史"不够用 | `rooms.followsExecutionId` 链可先做"项目视图" | `executedItemKeys` 进入规则输入与枚举；房间 `executed` 改为非终态；审批快照冻结 |
| E2 | 修订 / 冲销（PD-05c，release 账本） | 已执行的变更单需要撤销或改金额 | 出现真实的超额削减或取消需求（D23 指向这里） | `ledgerEntries` 只追加、`kind` 可扩展；`executions` 独立表 | `ledgerEntries.kind: 'release'` + `reversesEntryId`；`executions.revisesExecutionId`；任务 `canceled`；修订仍走提案 → 审批 → 执行 |
| E3 | 事件链头外部锚点 | 证明"锚定时刻之后"事件未被改动 | 合规要求（NIST AU-9 / AU-10） | `events` 只追加、`(roomId, commitTs, seq)` 有序、`events.append` 单一写入口 | 每房间链头 `{lastSeq, chainHash}` 周期性导出到 Convex 之外的不可改存储 |
| E4 | workpool 替换调度接缝 | 高并发下的 429 风暴 | 并发 run > 50 或 Anthropic 429 成为常态（D01） | `turns.beginAttempt` 是唯一调度接缝 | 只把 `beginAttempt` 内的 `runAfter(0, agents.runAttempt)` 换成 workpool `enqueueAction` |
| E5 | workflow 组件用于长流水线 | 多步、跨天的流程（如履约提醒） | 出现第一条这样的流水线 | — | 只为那条流水线用 workflow；回合循环不迁移 |
| E6 | 四包拆分 | 让"私密逻辑进不了浏览器包"成为包图事实 | 第二个场景落地，或出现包内违规（D21） | 单包下 `core/engine ← core/scenarios ← convex ← src` 由 `no-restricted-imports` 强制 | 按 techstack D04/D05 拆为 `@sfm/engine` / `@sfm/scenario-scope-change` / `@sfm/backend` / `apps/web` |
| E7 | LLM 简报抽取 | 从粘贴文本快速起草简报 | 用户反馈表单填写是主要摩擦 | 简报确认与草稿分离（草稿不入库） | 新调用点；只产出待确认建议；粘贴文本是不可信输入 |
| E8 | 通知 outbox | 多日审批不必盯屏 | 试用中出现"没看到自己的审批已失效" | 收件箱四分区、事件只含房间可见字段 | `outbox` 表 + 投递 action；只深链，不放批准按钮 |
| E9 | 审批 / 报价有效期 | 报价会过期；审批轮需要期限 | 产品试用反馈（U7） | `clock.rollLocalDate` 的"结论翻转才 bump"机制（D22） | 目录 `validUntil`；审批轮可选期限，派生 `expired` |
| E10 | 成员更换 / 多席位 | 换人；一个角色多人 | 真实组织出现换人或多审批人；或 v1 兜底 `rooms.forceClose`（04 §4.11、INV-79）在生产中每月被使用 ≥ 1 次（说明"关房重建"已成为常态成本）；或审批长期挂起（某提案的必需审批停留 > 14 天）成为可观测的抱怨来源（与 E9 审批有效期联动） | `evaluateApprovalSet` 按**当前成员**判定（旧成员审批自然失效） | `members.status`；席位实例键；`requiredApprovals` 按席位或"角色任一人" |
| E11 | 跨房间共享预算 | 一个项目多次变更共享一个预算 | 同一 finance 管多个房间的需求 | 上限是 finance 硬字段、已承诺是账本求和 | 房间之上的预算账户实体；执行锁账户文档 |
| E12 | 外部集成（ERP / 会计 / 项目管理） | 执行结果落到外部系统 | 第一个真实集成需求 | 执行只写内部记录；`executionKey` 全局唯一 | 只经 outbox；`executionKey` 作外部幂等键 |
| E13 | 多模型 / 服务端回退 | 成本、延迟、可用性 | 评测或账单数据支持（U5） | `modelGateway` 单点、`MODEL_FALLBACKS` 开关（默认关） | 开启回退需改走 `beta.messages`，usage 按 iterations 拆行 |
| E14 | 代理提出目录外选项 | 代理创造性 | 用户反馈候选不够 | 目录 `status: draft` 与确认分离 | 新动作 `suggest_item`（无价格）→ 给 provider 本人的请求 → 人补价并确认 |
| E15 | 界面多语言（zh-CN） | 用户群 | 用户决策 | 文案外置、公共文本 `{templateKey, params}` | 补翻译、Clerk 本地化、CJK 字体回退、文本膨胀走查 |
| E16 | 导出 / 打印变更单 | 归档与对外沟通 | 用户需求 | 只读 query | 打印视图优先；CSV 防公式注入；固定声明"内部记录，非合同" |
| E17 | 账户删除与数据导出（自助） | 合规 | 法务要求 | 运维人工发起的 `privacy.redact`（18 ADR-X04）；`REDACTABLE_FIELDS` 与 `termsKey` 覆盖字段不相交（03） | "清除私密字段内容、保留结构与审计链"的作业 |
| E18 | 原生移动端 | 审批便利 | 用户需求 | API 已按查看者投影 | 直接复用 query / mutation |

### E1 同房间追加轮（PD-05b）——为什么 v1 不做、将来怎么做

canon D04 否决它的理由：需要 `executedItemKeys` 进入规则输入、候选枚举、简报语义（必需项 = required − executed）、审批快照冻结与非终态 `executed`，每一项都在至少一份候选里被评委打出反例（重复承诺已执行范围 15 条、审批有效性改写历史 4 条）。若将来要做，前置不变量：(1) 候选集 ∩ 已执行条目 = ∅，由 `enumerateCandidates` 的输入保证而非人眼；(2) 必需项检查用 `required − executed`；(3) 执行后审批有效性只读 `executions.approvalIds`；(4) 房间状态机新增 `executed → open` 只能由显式"开始追加轮"迁移触发且递增约束版本；(5) "同房间第二轮不得重复承诺已执行范围"必须先写成失败用例——重写版电池已按 D04 把它改写为"终态 + 新房间"的断言（`00-invariants` CE-112、CE-118、CE-130、CE-168），做 E1 时须恢复同房间版本并与这几条并存。更便宜的替代：在 `followsExecutionId` 链上做只读"项目视图"，聚合多个房间的变更单与台账。

### E2 修订 / 冲销（PD-05c）

- 账本：`ledgerEntries.kind` 增加 `release`，带 `reversesEntryId`（指向被冲销的 `commit`），金额仍为非负整数分，`committedCents = Σ baseline + Σ commit − Σ release`（PeopleSoft commit / release 分层账本，research §2）；available 现算不存。
- 执行：修订是一条新提案（条款为"对执行 X 的修订"），走同样的审批（核心 3）与原子执行（核心 5）；`executions.revisesExecutionId` 指向原执行；被取消的任务 `status: 'canceled'`（任务状态机扩展）。
- 金额链：AIA G701 链支持负增减（GAP-25）；`assertCents ≥ 0` 改为"按条目类型校验符号"。
- 与 D23 的关系：上限低于已承诺仍然拒绝写入；系统内唯一合法的"降低已承诺"路径是经审批的 release。
- 位置：在 `startFollowUp` 新房间中进行（新房间同时带 `followsExecutionId` 与修订目标），不重开已执行房间。

### E3 链头外部锚点

v1 不做哈希链（D14：有写权限者可整条重算，只能发现意外损坏）。将来：每房间链 `chainHash_n = H(chainHash_{n-1} ‖ canonicalJson(event_n))`；定时把 `{roomId, lastSeq, chainHash}` 导出到 Convex 之外的追加型存储（对象存储 WORM 或透明日志）；每日校验。对外表述严格限定为"能发现锚定时刻之后的改动"。前置：`crypto.subtle` 或纯 JS 哈希在运行时的可用性（spikes §8 #6），以及 `commitTs` 跨事务唯一性（techstack O4）。

### E4 / E5 编排升级

- E4：workpool `maxParallelism` = Anthropic 全局并发上限，`retry: false`，`onComplete` 里只调用现有 `turns.complete / fail` 守卫；看门狗、`runs.reconcile`、过期拒绝不变。需先验证平台中断时 `onComplete` 的调用语义（spikes §8 #9）。
- E5：workflow 名带版本（`fulfillmentV1`），步骤变更新增版本名并排空在途实例；人工审批不用 `awaitEvent`，仍用状态行。不用 action-retrier（不认 `NonRetryableError`，`onComplete` cleanup 静默卡死）。
- 带组件后 `convex codegen` 不能离线：CI 的 `_generated` 漂移检查改用 `gen-generated.mjs` 或连接 dev 部署（spikes §0.1）。

### E7 LLM 简报抽取

新调用点（effort `low` 属用户决策，techstack D13）；输入是委托人粘贴的文本，信任类为"委托人粘贴的外部内容"，只进本方抽取调用，永不进他方上下文；输出只作为建议逐条带原文片段、默认私密、金额类硬约束必须人工逐条确认（CRITIQUES：不得"未审阅即保留"、代理不得预勾共享）；原文不入库。需要新的注入用例与金丝雀扫描。因 v1 无公开 action（除链接邀请），需由 12 设计"mutation 调度 internal action、结果写入本人可读的短期表"的形态。

### E8 通知 outbox / E12 外部集成

- 同一事务写 `events` 时追加 `outbox(kind, refs, dedupeKey)`；投递 action 至少一次，幂等键 `${eventId}:${channel}:${userId}`（通知）或 `executionKey`（外部系统 `external_id`）；失败退避重试并保留回执与人工对账入口；**永不在执行事务内调用外部系统**，外部 exactly-once 不承诺。
- 通知内容只用房间可见模板与深链，不放批准按钮（research HITL：审批只在工作台内、带版本绑定）；用户通知偏好另表。
- 适配器只读执行记录的公开投影，不读私密简报。

### E9 / E10 / E11

- E9：目录 `validUntil` 到期由 `clock.rollLocalDate` 判定为"时间结论翻转"并 `constraints.bump(cause: 'clock')`；审批轮期限按整轮计（Oracle 做法），到期派生 `expired`，不改审批行。
- E10：v1 没有换人：creator 或必需审批人的身份消失时，房间靠 open 请求 7 天过期（→ `ended_no_agreement`）与运维人工发起的 internal `rooms.forceClose`（双人确认，04 §4.11、12 §12.20、INV-79）终结，用户再关房重建。触发上表条件后：成员更换新增 `members.status: active | left`（席位转移 = 旧成员 `left` + `addMember` 新成员，同一事务，经 creator 发起、被转移者或运维确认），旧成员审批由 `evaluateApprovalSet` 的"当前成员"规则自然失效（不 bump，D05）；届时 `rooms.forceClose` 降为纯运维兜底；多席位放松 `(roomId, role)` 唯一为 `(roomId, role, seatKey)`，D24 的"`userId` 两两不同"保留。
- E11：房间之上的 `budgetAccounts`；执行事务读写账户文档（OCC 热点）；已承诺额来自账户账本。开放问题：其他房间的执行改变本房间的已承诺额，是否进入本房间硬投影（会让无关执行作废本房间审批），需在实现前写 ADR。
