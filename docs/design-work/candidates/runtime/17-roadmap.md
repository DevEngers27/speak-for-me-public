# 17 演进路线

> 原则：v1 先把一个场景的权限、版本化审批、执行正确性与运行时可靠性做扎实（P-22）；每个扩展点都写清它对引擎接口的要求，证明 v1 的接口不需要推倒重来。

## 17.1 v1 范围回顾

v1 = 本设计 00–16 的全部内容：通用引擎 + 软件范围变更场景、三方邀请与私密简报、代码枚举候选 + 三个代理回合、版本化审批与原子幂等执行、约束变化后的自动失效与重谈 / 问人、stub 与故障注入、简报抽取（可选模块）、用量与估算成本、运维巡检与熔断。

## 17.2 第二个场景：活动预算（FX-01）

| 需要 | 落在哪里 | 引擎是否要改 |
| --- | --- | --- |
| 角色：organizer（buyer）、venue / vendor（seller）、finance | 插件 `roles` | 否 |
| 条目带数量（人数 × 单价、按天计价） | 新的 `terms` 变体 `event_budget.v1`（`lines: {itemKey, qty}[]`）、新的条目属性变体 | 否：schema 中 terms / attributes / briefFields 本来就是场景联合，新增变体即可 |
| 候选空间大（数量组合爆炸） | 插件 `enumerateCandidates` 用剪枝（必需项固定、数量取档位、按公开排序截断）并遵守 `limits.maxCandidates` | 否：引擎只要求"确定性 + 全部可行 + 公开排序 + ≤ 32" |
| 多个 seller 各有目录 | `ownsCatalog` 允许多个角色；目录条目带 `ownerRoleKey`（v1 已有） | 提议方可能需要按 seller 轮流：`proposerRole` 扩展为 `proposerRoles` 时需改协议的轮次规则（05 §5.6）——这是唯一可预见的引擎改动，已在接口中预留字段名 |
| 不同的执行产物（场地预订记录、付款计划） | 插件 `deriveExecution` / `writeExecution` 与场景表 | 否 |

## 17.3 外部集成与通知：outbox

- 新增 `outbox` 表：执行事务（08 §8.4 E5）同事务插入一行 `{ kind, payload, idempotencyKey: operationKey, status }`；独立的 internal action 消费者按自己的重试预算投递（ERP 导出、Webhook、邮件），失败只影响 outbox 行，不回滚执行（核心 7：外部集成是扩展点，不在执行路径上）。
- 通知（邀请、待我审批、待我回答）是第一个消费者；用户偏好（邮箱、频率）放在 `users` 上，需要用户显式提供邮箱。
- 任何外部写入都不宣称 exactly-once；以 idempotencyKey 交给对方去重（P-05）。

## 17.4 多模型 / 多提供方（FX-11）

引擎只依赖 `ModelAdapter.call(request) → { outcome, meta }`（v1 只有 Anthropic 实现，10 part5）。新适配器必须：支持结构化输出或接受"仅靠语义校验 + 重试"；把错误映射到同一组 outcome；报告可换算成本的用量。按调用点选择模型已在 `runtimeConfig` 中预留（目前统一为 `AGENT_MODEL`）。

## 17.5 其他扩展点

| 扩展 | 说明 | 对 v1 接口的要求 |
| --- | --- | --- |
| 付款条件作为第四维度（GAP-14） | finance 简报新增付款偏好 / 约束；条款新增 `paymentPlan` | 场景 terms 变体 + 新检查；引擎无改动 |
| 代理提出目录外选项 | 代理输出 `suggestItem`（结构化），落为 unconfirmed 草稿，provider 确认后才进入目录 | 协议新动作（`PROTOCOL_VERSION` +1）；目录确认流程不变 |
| 审批阈值升级 | 金额超过 finance 设定阈值时要求额外审批人或点名 finance | `requiredApprovals(input)` 已以规则输入为参数，可按金额返回不同集合 |
| 项目级预算被多个房间共享 | 房间之上的 `budgets` 实体与台账；执行事务需要锁住预算级不变式（所有共享该预算的房间都读写同一预算文档，热点需评估） | `scenarioState` 改为从预算实体读取；约束快照引用预算版本 |
| 已执行变更单的修订链 | `changeOrders.supersedesId`、承诺调整（允许负金额的 adjustment） | 台账 kind 扩展；`assertCents` 对 adjustment 放开符号 |
| 报价有效期与审批有效期（Q-05） | 目录条目 `validUntil`；过期视为约束变化（由 cron 触发 `bumpConstraints`） | 检查新增 `engine.source_expired`；cron 是唯一新增的触发者 |
| 延后项的后续占位（Q9） | 执行时为延后项生成 `followUps` 记录，后续变更可从这里开新房间或新 run | 场景执行派生新增产物 |
| 一个角色多人（Q13） | 参与者按角色可多行；审批要求变为"该角色任一人"或"全部" | 必需审批快照需带"人数规则"；属于约束变化 |
| 编排迁移到 workpool | 触发条件：大量房间并发导致 429 风暴，需要全局 `maxParallelism` | 只替换 `scheduleAttempt` 的调度方式，run / turn / attempt 状态机不变（10 part1 §10.2） |
| 录制回放 | 展示历史 run 的回合进度，标注 "Recorded run at …" | 只读查询；数据已在 `runs` / `turns` / `modelCalls` 中 |
| PDF 与邮件导入（FX-12） | 扩展抽取模块的输入类型 | 抽取任务 schema 增加附件引用；模型侧能力待验证 |
| 界面多语言（P-25） | 模板表按语言分组，渲染时按查看者偏好 | 渲染器已在读时执行，只需模板表增加语言维度 |
| 原生移动端（FX-09） | 响应式网页先行 | 无 |

## 17.6 产品验证（非系统功能）

与有外包、采购或财务协调经验的人访谈（V-03），验证两个假设（F01.4）：①首个场景假定的组织形态（外包工作室 + 有独立预算负责人的中型客户）是否真实；②服务方是否愿意进入客户的工作区协商。结论回填 01 与 18。
