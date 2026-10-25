# 17 演进路线

| 扩展点 | 对引擎接口的要求 | 本设计的预留 |
| --- | --- | --- |
| 第二场景（例如活动预算 event-budget） | 场景声明角色、简报 schema、候选枚举、模板、话题、fixture、evalCases | `ScenarioPlugin`；roleKey 为字符串；`briefs.content` 由场景 Zod 校验 |
| 大目录（> 5 条目） | 枚举器需要剪枝：先固定必需项，再按优先级贪心 + 有界搜索 | `enumerateCandidates` 接口不变；`maxCandidatesInPrompt` 已存在 |
| 代理提出目录外条目 | 新 effect `request_catalog_item` → provider 的 humanRequest → 确认后 bump | humanRequest effect 联合可扩展 |
| 简报抽取（从邮件 / 文本生成草稿） | 抽取结果只进 draft，本人确认 | briefs draft / confirmed 分离 |
| 付款条件作为协商维度 | 候选键加维度；模板与规则扩展 | candidateKey 是场景自定义字符串 |
| 审批阈值触发升级 | 场景 `requiredApprovals` 改为函数（按金额） | 已在提案插入时快照 |
| 多房间共享预算 | 房间之上的 budget 实体；执行事务读共享台账 | commitments 台账模型可平移 |
| 已执行变更单的修订 | changeOrders 加 `supersedesId`；commitment 冲销行 | 只追加模型兼容 |
| 外部集成（ERP、通知、签署） | outbox 表 + 人工确认后推送；幂等键沿用 operationId | 执行事务内写 outbox 即可 |
| 编排迁移到 workflow 组件 | runTurn / completeTurn 已拆分，可映射为 step | 归约器纯函数，不依赖调度方式 |
| 每个调用点不同模型 / effort | 需用户决定；评测报告按调用点分组 | modelCalls 记录 model 与 effort |
| 报价 / 审批有效期 | 目录项 `validUntil`；过期视为约束变化 | 18 Q4 |
| 通知（邮件 / Slack） | 读 events 的 outbox 消费者，按受众渲染 | 事件已是结构化 payload + 受众 |
