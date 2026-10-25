# 00 概览（入口）

> Speak for Me 重建设计 · 候选方案"运行时与可靠性优先"。本文件给出任务书第 3 节八条不可动摇核心的保证表，并索引本章分片。

## 不可动摇的核心如何被保证

| 核心 | 由哪些设计点保证 | 主要验证 |
| --- | --- | --- |
| 1 私密委托 | 字段×角色披露矩阵与逐字段受众选择（07 §7.3、ADR-11）；单一投影函数同时服务 UI 与代理（`projectBriefFor` 等）；`assembleAgentContext` 显式白名单（I15）；模型 rationale 只给本方、永不进他方上下文（05 §5.4）；多角色可读文档不存私密数值（I20）；事件 payload 受众安全、读时服务端渲染（ADR-19）；query 声明 `returns`；委托条款写明可推断的最小披露（07 §7.6） | PV-01…PV-08、CTX-01、TP-01、E2E-04 |
| 2 代理只建议 | `recommend_accept` 只写回合结果与事件，从不写 `decisions`（05 §5.2）；`decisions.decide` 是唯一审批入口且要求人的身份与角色；clarify 只交给人回答（ADR-09）；代理只能从候选中选择（R7）；界面标注 advisory | AU-01、FL-01、RT-21 |
| 3 人批准具体版本 | 提案不可变（ADR-07）；决定绑定 (proposalId, constraintsVersion, termsKey)（ADR-13）；`expectedConstraintsVersion` / `expectedTermsKey` 不一致即 `STALE_VIEW`（T-07）；ruleKey 变化即递增约束版本、旧决定派生 stale（ADR-23）；必需审批在提案创建时快照（I7） | AP-06、RG-02、RG-06、RG-13、DC-15 |
| 4 代码负责校验 | 纯函数 `evaluateProposal` 在视图、建 run、建提案、审批、执行五处共用（06 §6.1）；`enumerateCandidates` 只产出全部检查通过的组合，金额与日期由目录计算（ADR-05）；`engine.sources` 来源核对；JSON Schema 枚举 + Zod + 语义校验（05 §5.3）；`assertTransition` 守护所有状态字段（04）；执行前用重新汇总的台账再算一次（G-E2） | RG-*、RP-01、CL-*、JS-01、SM-01 |
| 5 执行幂等且原子 | 执行与最后一票同一 mutation（08 §8.4）；状态守卫为主、`operationKey` 为辅；OCC 串行化并发最后两票；双击与重连重发返回已有结果 | AP-05、AP-08、E2E-02 |
| 6 历史不可篡改 | 九类表只追加（03 §3.1 第 6 条）；`constraintVersions` 让任何版本的评估可复现（09 §9.2）；被取代的 run、stale 决定、撤回全部保留；事件 `commitTs` 全序；变更单冻结预算影响快照 | IM-01…IM-03、RG-11、DC-05 |
| 7 执行边界 | 只写 executions、变更单、承诺台账、任务；固定文案 "Internal record. Not a contract."；外部集成只经 outbox 扩展点（17 §17.3） | 代码审查、EX-01 |
| 8 不伪造 | `isSimulated`、`agentMode: "stub"`、作者类型在数据与界面上标注；无可行方案时请求具体的人、全员拒绝时显示"无法达成一致"（ADR-15）；代理失败显示"无建议"而不是编造（ADR-10）；成本标注为估算、未知成本单列；种子数据走生产写入路径（14 §14.8）；录制结果标注来源 | FL-02、RT-19、PV-05 |

## 分片

1. `00-overview-part1.md`：系统一页纸、设计原则 P1–P8、运行时与可靠性要点
2. `00-overview-part2.md`：术语表、与原方案（README、Role A 分支）的主要差异、读法

## 全部文件

00 概览 · 01 产品 · 02 领域模型 · 03 schema · 04 状态机 · 05 协议 · 06 规则引擎 · 07 权限与隐私 · 08 审批与执行 · 09 约束变更 · 10 代理运行时（主视角，6 片）· 11 架构 · 12 API · 13 前端 · 14 首个场景 · 15 运维 · 16 测试 · 17 路线 · 18 决策与开放问题。拆片的章节都有同名入口文件（如 `10-agent-runtime.md`）列出分片。
