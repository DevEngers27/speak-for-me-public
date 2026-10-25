# 17 演进路线

| 扩展 | 对引擎接口的要求 | 本设计已留的位置 |
| --- | --- | --- |
| 第二个场景（如采购询价、排期协调） | 实现 `ScenarioPlugin`；`briefContentV` 加联合成员；大目录需剪枝枚举器 | 引擎表角色为 `v.string()`；规则/模板/提示词全在插件 |
| 可协商交付日与条款（加急费、延后折扣、付款条件） | 模型输出增加受约束的 `termIds`；`computeTerms` 支持条件价格 | proposals 的 `lines` 可扩展为含 term 行 |
| 抽取：粘贴邮件/需求 → 简报草稿 | 新 action，只返回草稿给本人，不入库 | 简报只存已确认版本，草稿天然不入库 |
| 多房间共享项目预算 | 引入 `budgetAccounts` + `commitments`（房间之上）；执行事务读写账户级不变式 | `committedCents` 是派生函数，替换实现即可；ADR-04 |
| 一个角色多名用户 / 审批策略（任一/全部/阈值） | 席位 1..n 用户；`approverRoles` 升级为策略对象并快照 | `requiredApproverRoles` 已快照 |
| 金额阈值触发升级（超额点名 finance） | 场景 `buildRequests` 增加触发条件 | humanRequests 结构不变 |
| 已执行变更单的修订链 | `changeOrders.supersedesId` + 负金额承诺（退减） | 金额非负限制需放宽为带符号 |
| 外部集成（ERP、工单） | changeOrder 插入后调度出站同步，幂等键 changeOrderId；只追加同步状态表 | 执行只写内部表（核心 7） |
| 通知（邮件/Slack：轮到你批准、你被点名） | 订阅 `rooms.view` 派生的待办，或在 mutation 中调度通知 action | 待办已是派生量 |
| 编排迁移到 workflow 组件 | 回合 = `step.runAction(runTurn)` + `step.runMutation(completeTurn)` | GT 守卫与提交 mutation 不变 |
| 并行评估 | evaluatorRoles 同轮并行，completeTurn 等待集合完成 | ADR-06 |
| 多模型/每调用点模型 | `AGENT_MODEL_<role>`；用量已记录实际 model | 需用户拍板（不得自行降级） |
| 报价/审批有效期 | 目录项 `validUntil`，过期派生为不可执行 | 09 §6 |
| 房间归档与私密数据清除 | 归档运维操作清除 notes/rationale，保留结构化历史 | 18 号 Q5 |
| 时间线全序/通知游标 | 新增 `v.commitTs()` 字段 | 03 §6 |
