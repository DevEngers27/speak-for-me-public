# 17 演进路线

| 扩展点 | 对引擎接口的要求 | v1 已预留 |
| --- | --- | --- |
| 第二场景 `event_budget` 上线 | 无需改引擎：契约测试已通过；只需注册插件、实现 UI slot | 06 part2、16 §2 |
| 目录外新选项（代理提议 → unconfirmed → 作者确认） | 代理输出加 `suggest_entry` 动作，落 `catalogEntries(status:'unconfirmed', createdBy: agent)`；作者确认后 bump | `entryStatus` 已含 unconfirmed |
| 从邮件/文本抽取简报草稿 | 新调用点（小模型、effort low 属用户决策），只写 briefDrafts，提交才确认 | briefDrafts 与确认分离 |
| 第四维度（付款条件） | 插件 selection 扩展，引擎不变 | selection 为 unknown |
| 审批阈值升级（超额点名 finance） | 插件 `requiredApprovals` 改为函数 `requiredApprovals(derived)`；提案快照不变 | 已快照 |
| 多房间共享预算 | `ledgerAccounts` 上移为组织级实体，房间引用；执行事务锁账户文档 | ledger 已是独立原语 |
| 已执行结果的修订 | 新 run 产出 `parentExecutionId`；ledger 条目允许负额（退款）需单独 ADR | executions 独立表 |
| 外部集成（ERP、合同、邮件、通知） | outbox 表：执行事务内插 `outbox(kind, payload, operationId)`，独立 action 消费，至少一次 + 下游幂等键 | operationId 已全局唯一 |
| 编排迁移到 workflow 组件 | `scheduleTurn/complete` 边界不变；需排空在途 run | 回合守卫与组件无关 |
| 多模型 / 每调用点模型 | `AGENT_MODEL_<CALLSITE>` 已可配；需用户决策与质量对比 | 白名单常量 |
| 报价/审批有效期 | 目录 payload 加 `validUntil`；到期由定时 mutation 视为 `catalog.retire`（bump） | — |
| 多人共享一个角色席位 | participants 唯一键改为 (roomId, userId)，审批按席位而非用户；需重新论证 I7 | — |
