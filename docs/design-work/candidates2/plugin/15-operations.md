# 15 运维

| 主题 | 决定 |
| --- | --- |
| 环境 | 每位开发者一个 dev deployment；共享 prod 只从主分支 `convex deploy`，无人对其 `convex dev`；Clerk dev/prod 实例分离 |
| 密钥 | `ANTHROPIC_API_KEY` 只在需要真实调用的部署；dev/prod 不同 workspace，各设花费上限（≥3 倍预估余量）；环境检查脚本只报存在性 |
| seed | `npx convex run seed:createFromFixture '{"scenarioKey":"software_change","fixtureKey":"feasible","ownerTokenIdentifier":"..."}'`；每次新建房间，旧房间保留（不删除，符合历史不可篡改）；全部记录 `simulated: true` |
| reset | 不提供删除式 reset；开发部署可清表重建 |
| 中间状态快照 | 禁止 seed 直接写"已有审批"等中间状态（Q11）：要演示中间状态，用 stub 模式真实跑到该状态 |
| 可观测性 | `ops.metrics`（OPS_ADMINS）：按房间/部署聚合回合数、失败率、stale 数、p50/p95 latency、token；成本 = token × 价目表，标"估算" |
| 缓存核查 | 指标中 `cacheReadTokens > 0` 比例作为常驻断言 |
| 日志隐私 | 上线前与每周：在 Convex 日志中搜索 canary 与 fixture 中的预算数字，应零命中 |
| 部署纪律 | 有非终态 run 时不部署（action 会被打断；watchdog 会把回合标 failed，可人工重试）；`ops.activeRuns` 查询供发布前检查 |
| 总开关 | `AGENTS_ENABLED=false` 立即停止新模型调用；`AGENT_MODE=stub` 降级 |
| 依赖 | 精确版本、发布满两周；CI 锁 actions SHA；`next typegen && tsc --noEmit`；运行时冒烟（`force-dynamic` 下 build 不渲染页面） |
