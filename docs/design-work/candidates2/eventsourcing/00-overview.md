# 00 概览（事件溯源与可审计性优先的候选设计）

## 1. 一句话

Speak for Me 的每一次状态变化——提案提出、约束变更、审批、执行、回合结果、人工请求——先成为房间事件流里一条不可变、带哈希链的事件；所有业务表都是这条日志在**同一 Convex 事务内**更新的投影，可随时回放重建与校验。

## 2. 文件清单

| 编号 | 文件 |
| --- | --- |
| 00 | 00-overview.md（本文件） |
| 01 | 01-product.md |
| 02 | 02-domain-model.md |
| 03 | 03-schema.md（事件表）、03-schema-part2.md（投影表与普通表）、03-schema-part3.md（EVENT_META、哈希链、写入管线、唯一性、演进与重建） |
| 04 | 04-state-machines.md |
| 05 | 05-protocol.md、05-protocol-part2.md |
| 06 | 06-rules-engine.md |
| 07 | 07-permissions-privacy.md、07-permissions-privacy-part2.md |
| 08 | 08-approval-execution.md |
| 09 | 09-constraint-changes.md |
| 10 | 10-agent-runtime.md、10-agent-runtime-part2.md |
| 11–13 | 11-architecture.md、12-api.md、13-frontend.md |
| 14 | 14-scenario-scope-change.md、14-scenario-scope-change-part2.md |
| 15–18 | 15-operations.md、16-testing.md、17-roadmap.md、18-decisions-open-questions.md |

## 3. 设计原则

1. **事实先于状态**：命令被校验后产生事件；事件不可拒绝、不可修改；状态是事件的投影。
2. **同事务投影，没有最终一致**：`runCommand` 在一个 mutation 里完成 去重 → 读聚合 → 纯决策 → 追加事件 → 投影 → 反应器 → 调度（03 part3 §3）。
3. **能派生的不存**：提案状态、可执行性、审批有效性、已承诺总额都在读取时由纯函数计算。
4. **诚实退回**：不是事实的东西（草稿、遥测、令牌）不进日志（02 DM-6）。
5. **披露在服务端逐字段决定**：日志含私密载荷，但永不原样离开服务端；`redactEvent` 穷举每个事件类型 × 角色。
6. **模型只在代码给出的候选中选择**；金额、条目、日期在结构上无法由模型表达。
7. **反对过度设计**：不用消息总线、不用异步投影器、不用 workflow/agent 组件、不建快照；每房间百级事件，直接回放。

## 4. 核心八条如何被保证

| 核心 | 保证它的设计点 |
| --- | --- |
| 1 私密委托 | 07 字段×角色矩阵；`redactEvent` 白名单 + 穷举；`rooms.view` 声明 `returns`；`getTurnContext` 单一入口只含本方简报与他方 shareableFacts；provider 候选不按预算过滤（ADR-07）；金丝雀矩阵测试（16 §4） |
| 2 代理只建议 | 协议动作集无 approve（05 §4）；`turn_completed{recommend_accept}` 不写 decisions；`approvals.decide` 只接受人的身份；人工请求只能由 targetRole 本人回答 |
| 3 人批准具体版本 | `decision_recorded` 绑定 (proposalVersion, constraintsVersion)；提案行不可变；必需审批快照；有效性派生，约束一变即 stale（04 §5、08 §4） |
| 4 代码负责校验 | 候选由 `enumerateCandidates` 从已确认目录算出；`validateProposal` 四个调用点；模型输出 Zod + 候选成员检查；状态迁移表 `assertRunTransition`；身份只从 ctx.auth |
| 5 执行幂等且原子 | 最后一票同一 mutation；单事件 `execution_completed` 投影变更单/承诺/任务；状态守卫 + `operationId` + `commandId` 三层；流头 OCC 串行化（08 §3、§7） |
| 6 历史不可篡改 | 只追加事件 + 唯一写入口 + CI 禁写规则；SHA-256 哈希链 + 每日校验；回放比对（`audit.verifyRoom`）；约束历史 = 约束事件子序列；`audit.trace` 追溯链（03 part3、09 §5、14 §13） |
| 7 执行边界 | 只有三张内部投影表承载执行结果；外部集成仅作为 outbox 扩展点（08 §8、17） |
| 8 不伪造 | 事件信封 `simulated` 继承到所有投影与 UI 徽章；seed 走命令管线；存档回放带来源标注；stub 回合 `mode:"stub"`、提案 `authorKind:"rule"`；无可行解时由代码开人工请求，不编造一致 |

## 5. 术语表

| 术语 | 含义 |
| --- | --- |
| 命令（command） | 用户或系统的意图，可被拒绝；对应一个 mutation |
| 事件（event） | 已发生的事实，`events` 表一行，房间内按 `seq` 排序，不可变 |
| 流头 | `rooms.lastSeq` + `rooms.lastHash`；每个命令都写它，形成每房间串行点 |
| 投影（projection） | 由 `applyEvent` 从事件写出的表；[I] 行不可变、[P] 行可被后续事件更新 |
| plan / apply / react | 纯决策函数 / 唯一投影写入者 / 同事务反应器（追加后续事件与调度） |
| 领域键 | proposalVersion、runNo、requestNo、operationId 等不随投影重建而变的标识 |
| 约束事件 | 推进 `constraintsVersion` 的四类事件 |
| run / 回合（turn） / attempt | 一次协商 / 一个角色的一次代理调用 / 该回合的一次尝试 |
| 候选（candidate） | 代码从已确认目录与约束枚举出的完整方案，模型只能按 candidateId 选择 |
| 人工请求（human request） | 代码生成的、指向具体角色的结构化取舍问题 |
| 变更单（change order） | 执行产出的内部记录，与承诺、任务同事务生成 |
| buyers | customer + finance（采购方） |

## 6. 与原方案的主要差异

| 原方案 | 本设计 | ADR |
| --- | --- | --- |
| R：events 是附属日志，表是事实 | 事件是事实，表是投影，可重建 | ADR-01 |
| R：模型给 scope、additionalCostCents、sourceRefs | 模型只选 candidateId | ADR-06 |
| R：预算与已承诺放在全员可见的 rooms | budgets 投影 + commitments 台账；买方可见、provider 不可见 | ADR-08 |
| R：approvals 只存版本号；members.approvalRequired | 不可变 decision 事件；必需审批常量快照 | ADR-10 |
| RA：事件文本写入时渲染、approve 删除旧拒绝、revalidated 复制提案、"same shapes" | 读时按角色渲染；决定只追加；不复制；按查看者投影 | ADR-01/10/17 |
| RA：改上限不得低于已承诺（拒绝） | 接受并进入 BUDGET_BELOW_COMMITTED | ADR-11 |
| 无 | 哈希链、回放校验、约束历史折叠、追溯链 | ADR-04 |

## 7. 事件溯源的代价（诚实列出）

| 代价 | 缓解 |
| --- | --- |
| 每个命令双写（事件 + 投影），代码量多约 24 个 apply/redact/render 分支 | 穷举类型检查；投影一致性预言每个测试自动跑 |
| 每房间一个写热点（流头），并行回合提交会 OCC 冲突重试 | 首个场景写频率低；收益是唯一性推理被统一 |
| 日志里有私密载荷，`redactEvent` 成为安全关键代码 | 白名单 DTO、金丝雀矩阵、无原样返回路径 |
| 事件 schema 永远要兼容（upcast） | 载荷版本号 + upcast 纯函数；投影可随意改 |
| 删除权与不可变日志冲突 | 整房间删除作为唯一例外；加密粉碎列入路线 |
| 遥测（agentTurns）不能回放 | 它不是业务状态；业务结果都在事件里 |
