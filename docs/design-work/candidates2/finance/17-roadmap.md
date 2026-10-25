# 17 演进路线

| 扩展点 | 触发需求 | 对引擎接口的要求 | v1 预留 |
| --- | --- | --- | --- |
| 第二个场景（如采购询价、排班交换） | 新业务 | `ScenarioPlugin`：角色、签字要求、简报字段、候选枚举、定价、模板 | 引擎不出现 scopeChange 字面量 |
| 冲销 / 修订已执行变更单 | 范围取消、退款 | commitments 新 kind `reversal`（金额仍为正，`reversesCommitmentId` 指向原分录，committed = Σ change − Σ reversal）；变更单 `supersedesChangeOrderId`；需要 finance 的 budget 签字 | 金额字段与 kind 联合可扩展；L3 判定改为净额 |
| 项目级共享预算 | 多房间同一预算 | budgets 从 room 提升为 `budgetAccounts`，房间引用 accountId；执行时 patch 账户文档作为 OCC 锚点（与现在 budgets 文档同模式）；可能需要预占（encumbrance）分录 | 台账表已带 `budgetId`，房间只经 `getBudgetForRoom` 访问 |
| 审批阈值 | 大额需额外签字 | `requiredSignatures` 由插件按金额计算（快照不变） | 快照字段已存在 |
| 签字时效 | 合规要求 | decision 增加 `expiresAt`，签字完整性加时间条件；需 scheduled bump 或读时过滤（读时过滤与响应式查询冲突，倾向 scheduled） | — |
| 代理提议目录外选项 | 协商更灵活 | humanRequest kind `quote_request` → provider 确认为新修订 | humanRequests 判别联合可扩展 |
| 从邮件/文本抽取简报草稿 | 降低录入成本 | 抽取只产出草稿，确认仍由人；调用点独立配置模型与 effort | briefDrafts 已与版本分离 |
| 外部集成（ERP、合同、付款） | 执行边界外 | 执行后的 outbox 表 + 独立 action 投递，绝不在执行事务内调用外部 | changeOrders 不可变，可作为 outbox 源 |
| 编排迁移到 Workflow 组件 | 回合链变复杂 | 回合提交 mutation 与守卫不变 | 回合以 (runId, turnSeq, attempt) 为键 |
| 多模型 / 每调用点模型 | 成本与延迟 | `AGENT_MODEL` 白名单按调用点配置 | callModel 接收 cfg |
| 通知（邮件 / Slack） | 待办提醒 | 订阅 events 的投递 action；内容同样模板化、按受众投影 | events 有受众判别 |
| 多币种 | 国际客户 | 房间 currency 扩展；金额仍为最小货币单位整数；跨币种不汇总 | `currency` 字面量字段 |
