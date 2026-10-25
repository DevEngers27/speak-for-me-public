# 17 演进路线（事件溯源候选）

| 扩展点 | 对引擎接口的要求 | 事件溯源带来的便利 / 代价 |
| --- | --- | --- |
| 第二个场景（如活动预算、采购询价） | `Role` 从三值字面量变为插件声明的 roleKey 联合；简报内容、目录项 validator 加联合分支；`requiredApprovals`、模板、候选枚举都由插件提供；事件类型保持通用（不加场景专属事件） | 引擎事件不变，旧房间回放不受影响；代价是 schema 联合随场景增长 |
| 外部集成（ERP、合同系统） | **outbox 投影**：`execution_completed` 的 apply 追加一行 `outbox{operationId, target, status}`；一个 action 消费并以 operationId 作外部幂等键；结果以 `external_sync_*` 事件回写 | 日志即集成源，不改执行事务；仍需对外部"至少一次"如实说明 |
| 通知（邮件/Slack） | 由事件驱动的反应器 + 每用户通知偏好表（普通表） | 通知内容同样经 redactEvent/renderEvent |
| 多模型 / 每调用点不同模型 | `AGENT_MODEL` 拆成按调用点配置；用量表已记录实际 `model` | 需要用户在 18 中拍板（技能规定不得自行降级） |
| 代理提出目录外新选项 | 新事件 `catalog_item_suggested{status:unconfirmed}`，provider 确认后才产生 `catalog_item_confirmed` | 追加一个事件类型即可 |
| 已执行变更单的修订 | 新 run（trigger manual）+ `execution_completed.supersedesOperationId?`；commitments 允许负额修正行 | 修订链天然在日志中 |
| 多房间共享项目预算 | 预算成为独立聚合（`budgetAccounts` 流），执行需跨流一致：要么把预算账户作为执行时的第二个 OCC 点（同 mutation 读写其流头），要么引入预留 | 是 v1"一房间一流"决定的主要演进成本 |
| 报价/审批有效期 | 目录项 `validUntil`；cron 在到期时追加 `catalog_item_expired`（约束事件） | 过期也是事实 |
| 简报抽取 | 小 effort 调用只填草稿（普通表），不产生事件 | — |
| 全局事件流 / 跨房间报表 | `v.commitTs()` 字段 + 全局索引，或离线导出 | v1 不需要 |
| 编排迁移到 workflow/workpool | 只替换 `scheduleTurn` 与 runTurn 的调用方式；守卫与事件不变 | 低 |
| 加密粉碎（crypto-shredding）满足删除权 | 私密载荷用每房间密钥加密、密钥存外部 KMS；删除密钥即"删除" | 复杂度高，只在出现合规需求时做 |
| 大目录候选枚举 | 插件提供剪枝枚举器，`MAX_ENUMERATED` 上界 | — |
