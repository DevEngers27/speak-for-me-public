# 00 概览（候选设计 agentquality：代理协商质量与评测优先）

## 0.1 一句话

Speak for Me 是一个"代码管安全、模型管判断"的多方协商工作台：每个参与方的私密简报只进入自己代理的上下文；代理在**代码预先枚举、按本角色可见信息投影的候选方案**里做选择、还价、澄清或建议接受；所有硬约束结论、金额、日期、对他方可见文本都由确定性代码产生；人对一个不可变版本审批，最后一票在同一事务里原子幂等地执行。协商核心写成**与 Convex 无关的纯状态归约器**，同一份代码既跑在 Convex mutation 里，也跑在离线评测器里，使"代理谈得好不好"可以用固定 fixture 反复度量。

## 0.2 本候选的主视角

| 主题 | 本设计的回答 | 详见 |
| --- | --- | --- |
| 上下文只给授权信息 | `buildRoleView(snapshot, roleKey)` 是唯一组装入口，输出白名单 DTO；stub/live/replay 驱动收到同一个 RoleView | 07、10 |
| 提示词结构 | 稳定前缀（协议章程 + 角色卡 + 场景规则）→ 本方简报块 → 本回合状态块 → 中途 `role:"system"` 回合指令；无时间戳、键序固定 | 10 |
| 输出 schema | 服务端信封（身份/版本/ID/金额）与模型输出（动作 + candidateKey + 理由）分离；每回合按候选集动态生成 JSON Schema（保留 `enum`），同源生成 Zod 校验器 | 05、10 |
| 回合策略 | 提议方先提 → 评估方并行评估 → 代码裁决本轮；硬约束违规由代码直接裁决、不花评估调用；轮次、重复候选、澄清次数都有代码上限 | 05、04 |
| 不可行识别 | 代码在调用任何模型前求联合可行集；为空则直接生成指向约束所有者的取舍请求，附"最小放松量" | 05、06、09 |
| 他方文本不信任 | 他方只以结构化字段 + 模板文本出现；目录标题等唯一跨方自由文本做长度/字符清洗并放进不可信定界块；动作空间封闭，注入的最坏后果是"选了一个合法候选" | 07、10 |
| stub 与真实共用接口 | `AgentDriver.decide(TurnRequest)`，模式 live / stub / replay / scripted；之后的解析、语义校验、归约完全相同 | 10 |
| 离线评测 | `evals/` 用场景 fixture 驱动纯归约器；指标：首次有效率、约束违反率、隐私泄露率、达成率、正确升级率、遗憾值、回合数、延迟、成本、缓存命中率 | 16 |

## 0.3 第 3 节八条核心如何保证

| # | 核心 | 由哪些设计点保证 |
| --- | --- | --- |
| 1 | 私密委托 | 07 字段×角色矩阵；所有公共 query 经 `project*For(viewer)` 在服务端裁剪并声明 `returns`；`buildRoleView` 白名单（07 §4）；候选集按角色投影，provider 的候选不用预算计算（05 §3）；代理自由文本 `rationale` 只给本方、永不进他方上下文；共享事实只来自简报中逐字段的 `disclosures`；隐私金丝雀测试（16） |
| 2 | 代理只建议 | 模型输出动作集里没有 approve；`recommend_accept` 只写 turn 与事件；`decisions` 表只能由带身份的 `decisions.submit` 写入（07 动作矩阵、08 §1）；澄清与升级由代码生成 `humanRequests`，只有目标角色的人能回答 |
| 3 | 人批准具体版本 | `proposals` 只追加、条款不可改；`decisions` 绑定 `(proposalId, constraintsVersion, contentHash)`；完成判定按快照的 `requiredApprovals` 集合、要求不同 userId（08 §2）；约束变更后旧决定自然失效（09 §4） |
| 4 | 代码负责校验 | 模型只能输出本回合候选集里的 `candidateKey`；条款由 `materializeTerms` 从已确认目录求和、按交付模式算日期（06 §3）；`validateProposal` 纯函数在回合提交、`rooms.view`、执行三处调用；模型不能输出硬约束 reasonCode（05 §2） |
| 5 | 执行幂等且原子 | 最后一票所在 mutation 内：状态守卫 → 集合判定 → 重算预算 → `operationId = exec:{proposalId}:{constraintsVersion}` 查重 → 同事务写 changeOrder / commitment / tasks（08 §4）；真实部署并发脚本测试（16） |
| 6 | 历史不可篡改 | proposals、decisions、briefs 确认版本、catalogItems 修订、budgetChanges、commitments、events 全部只追加；唯一可变的是少数 status 字段，且只经迁移表（04）；事件带 `commitTs` 全序；turn 保存 RoleView 哈希与 promptVersion，可重建请求（10） |
| 7 | 执行边界 | 执行只写 `changeOrders/commitments/tasks` 三张内部表；没有任何出站集成代码；外部集成作为 17 的扩展点（outbox 模式，v1 不建） |
| 8 | 不伪造 | `isSimulated` 贯穿 rooms、catalogItems、commitments、turns（stub/replay 驱动）；界面统一徽章；缺信息时代码生成 humanRequest，代理不得"假设对方同意"；评测报告标注样本量与驱动模式 |

## 0.4 设计原则

1. **能枚举就不生成**：凡是可以由代码穷举的（候选组合、可行性、金额、日期、问题与选项），都不让模型生成。模型只在封闭集合里选择并写给本方看的理由。
2. **两层 schema**：存储与函数参数用 Convex `v`；模型 I/O 用"回合规格 → JSON Schema + Zod"同源生成；两者之间由服务端信封衔接。
3. **一个归约器**：协商推进逻辑 `reduceRun(state, event) → {state, effects}` 纯函数化；Convex 只负责加载、鉴权、守卫、落库与调度。
4. **派生优先于存储**：可执行性、阻断、共享事实、已承诺金额都在读取时计算。
5. **每个上限都有落点**：轮次、每回合尝试、每 run 调用数、每房间每日调用数、澄清次数，全是代码常量或场景配置。
6. **反对过度设计**：自建 scheduler 链而非 workflow/agent 组件；不建通用规则 DSL；事件只做一张表；评测结果存仓库文件而非数据库。

## 0.5 术语表

| 术语 | 含义 |
| --- | --- |
| room | 一次三方协商的容器，绑定一个 scenarioKey |
| roleKey | 场景声明的角色键；首个场景为 `customer` / `provider` / `finance` |
| brief | 参与方的私密简报，有 draft / confirmed 版本 |
| disclosure | 简报中某字段对房间公开的显式决定 |
| catalogItem | provider 确认过的报价条目（含 `kind: scope / fee`） |
| candidate | 代码枚举的一个可选方案（条目集合 + 交付模式），键为 `candidateKey` |
| RoleView | 某角色代理在某回合能看到的全部信息的白名单对象 |
| run | 针对某个 constraintsVersion 的一次协商运行 |
| round | run 内围绕一个"在审提案"的一轮：提议 + 并行评估 + 代码裁决 |
| turn | 某角色代理的一次决策，含 1–2 次 attempt（模型调用） |
| envelope | 服务端为 turn 注入的身份、版本、ID 快照 |
| proposal | 不可变的结构化条款版本 |
| decision | 人对 (proposal, constraintsVersion) 的批准 / 拒绝 / 撤回 |
| humanRequest | 代码生成的、指向具体角色的人的问题与选项 |
| constraintsVersion | 房间硬约束版本；只经 `bumpConstraints` 递增 |
| changeOrder | 执行产出的变更单；与 commitment、tasks 互相引用 |
| driver | 代理决策的执行器：live（Claude）/ stub / replay / scripted |

## 0.6 与原方案的主要差异（ADR 详见 18）

| 原方案 | 本设计 | ADR |
| --- | --- | --- |
| 模型输出 scope、additionalCostCents、sourceRefs、publicSummary | 模型只输出 `candidateKey` 与私有 `rationale`；其余由代码派生，公开文本只来自模板 | ADR-03、04 |
| 澄清 `target: agent | human` 由模型决定 | `clarify` 只给 `topicKey`；代码按场景话题表生成指向信息所有者的 humanRequest | ADR-06 |
| 一次一回合串行，最多 9 次调用 | 每轮提议 1 次 + 评估方并行；硬违规由代码裁决不调模型；无解不调模型 | ADR-05 |
| 预算放 rooms、全员可见 | budgets 独立表，买方可见数字、provider 只见 reasonCode | ADR-08 |
| 状态只在 room 上 | run / turn / proposal / humanRequest 各自迁移表 | ADR-09 |
| Role A：前端全量状态再过滤、revalidated 复制提案 | 服务端按角色投影；约束变更不复制提案，阻断读时派生 | ADR-10 |
| 交付日期由模型给 | 交付模式 standard / rush 由候选决定，日期由目录 lead time 计算 | ADR-04 |
| 评测未设计 | 纯归约器 + 离线评测集 + 发布门槛 | ADR-02 |
