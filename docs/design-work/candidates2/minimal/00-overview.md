# 00 概览：Speak for Me（极简完整版设计）

## 1. 一句话

三方各自把私密目标交给自己的 AI 代理；provider 代理只凭公开信息提议与还价，customer/finance 代理按私密偏好评估；代码用目录算金额、校验硬约束；三人对一个不可变版本签字后，最后一票的同一事务写入变更单（含预算承诺快照）与任务；任何简报变化都让旧方案、旧审批即时失效并重开协商或点名问人。

## 2. 设计原则

1. **最少概念**：10 张表；只有 run 与 turn 存状态；能派生的（提案状态、审批有效性、请求是否打开、可执行性、已承诺金额、时间线、房间阶段）一律不存。
2. **约束只有一个来源**：所有硬约束都是某角色已确认简报的字段；约束版本只有一个写入口。
3. **只追加**：简报、提案、审批、变更单写入后永不修改。
4. **模型不碰数字**：模型只选 itemKeys 或给 reasonCode；金额、日期、延后项、来源全部由代码算。
5. **公开内容只走模板**：模型文本只给本方。
6. **一条路径**：约束变化 → 取代当前 run → 新 run；一组回合守卫、一组审批守卫。
7. **不砍功能**：协商、澄清、取舍请求、审批、撤回、约束变更、执行、隐私、标注全部在 v1。

## 3. 八条核心如何保证

| 核心 | 设计点 | 文件 |
| --- | --- | --- |
| 1 私密委托 | 字段三分类（private/disclosable/public_on_confirm）+ 逐项披露；`rooms.view` 服务端投影 + `returns` validator；`getTurnContext` 白名单上下文；provider 永不在预算受众内；无"整份状态"query；canary 测试 | 07 §3–6、03 §5、16 §3 |
| 2 代理只建议 | 动作集无 approve；`recommend_accept` 只推进 run，永不写 approvals；approvals 只来自需要身份的 `approvals.decide` | 05 §3、08 §2 |
| 3 人批准具体版本 | 提案不可变；approval 绑定 proposalId（+ 冗余 constraintsVersion）；GA 守卫要求提案约束版本 = 房间约束版本；任何简报确认使旧审批派生为 invalidated | 04 §2、08 §1 |
| 4 代码负责校验 | 模型输出无金额/日期字段；`computeTerms`/`validateProposal` 纯函数，在 completeTurn、view、decide 三处调用；目录只存在于已确认 provider 简报中；`SOURCE_MISMATCH` 来源核对；身份只从 ctx.auth | 05 §4、06 §2 |
| 5 执行幂等且原子 | 最后一票同一 mutation 内执行；run 状态守卫 + `changeOrders.by_proposal` 先查后写 + OCC；集合判定；真实部署并发测试 | 08 §2–3、16 §4 |
| 6 历史不可篡改 | 四张只追加表；约束历史 = 简报版本链；旧审批不删不改；提案→turn/简报版本/审批/变更单全引用；派生时间线 | 02 §5、09 §5、07 §8 |
| 7 执行边界 | 执行只写 changeOrders/tasks；无外部调用；界面声明 "Internal record"；外部集成是出站扩展点 | 08 §6、17 |
| 8 不伪造 | `simulated` 字段（rooms/briefs/proposals/changeOrders）+ stub 模式标注；无可行解由代码判定并问具体的人；不 seed 中间状态；用量只来自真实响应 | 10 §6、14、15 §2 |

## 4. 术语表

| 术语 | 英文标识 | 含义 |
| --- | --- | --- |
| 房间 | `rooms` | 一次多方协商的容器 |
| 席位 | `seats` | 房间中的一个角色；未认领时是邀请 |
| 简报版本 | `briefs` | 某角色一份已确认的私密简报（含约束、备注、披露选择） |
| 约束版本 | `constraintsVersion` | 房间级计数，任何简报确认 +1 |
| 协商运行 | `runs` | 从一个约束版本开始的一次协商 |
| 代理回合 | `agentTurns` | 一个角色代理的一次模型调用尝试 |
| 提案 | `proposals` | 不可变条款（itemKeys、目录算出的金额与日期） |
| 审批 | `approvals` | 一个人对一个提案的一次决定 |
| 人工请求 | `humanRequests` | 代码生成、指向具体角色的问题与选项 |
| 变更单 | `changeOrders` | 执行产物，内嵌预算承诺快照 |
| 任务 | `tasks` | 由变更单派生的工作项 |
| 已承诺金额 | `committedCents`（派生） | `priorCommittedCents + Σ commitment.amountCents` |
| 余量 | `headroomCents`（派生，仅买方） | `total − committed` |
| reasonCode | — | 规则与文本、投影、请求之间的唯一接口 |
| GT / GA / GR | — | 回合持久化守卫 / 审批守卫 / 回答守卫 |

## 5. 与原方案的主要差异（详见 18）

- 17 → 10 张表：删除 users、roomInvites、budgets、budgetChanges、offerItems、commitments、events，职责见 02 §3。
- 预算、目录、截止日都是简报字段，一个写入口递增约束版本（原方案未定义递增点）。
- 提案无状态、审批只追加、时间线派生、房间无状态。
- 模型只选条目，不给日期与金额；公开文本全模板。
- 预算低于已承诺直接拒绝；预算对 customer 也需 finance 显式披露。

## 6. 文件索引

00 概览 · 01 产品 · 02 领域模型 · 03 schema（part1/part2）· 04 状态机 · 05 协议 · 06 规则引擎 · 07 权限与隐私 · 08 审批与执行 · 09 约束变更 · 10 代理运行时 · 11 架构 · 12 API · 13 前端 · 14 首个场景 · 15 运维 · 16 测试 · 17 路线 · 18 决策与开放问题（part1/part2）
