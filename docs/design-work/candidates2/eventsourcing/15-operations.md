# 15 运维（事件溯源候选）

## 1. 可观测性

| 信号 | 来源 | 用途 |
| --- | --- | --- |
| 回合调用数、失败率、p50/p95 延迟、token、cacheRead 命中 | `agentTurns` → `metrics.summary` | 成本与延迟预算（10 §3） |
| stale 拒收次数、人工介入次数、自动重试次数 | 事件计数（turn_rejected_stale、human_request_opened、turn_failed{willRetry}） | 协议健康度 |
| 哈希链与投影一致性 | `audit.verifyRecent`（cron 每日）+ 按需 `audit.verifyRoom` | 核心 6 的持续证明 |
| 执行重复尝试次数 | `approvals.decide` 返回 duplicate/noop 时计入运维日志（不写房间事件，RA-R09） | 幂等是否被频繁触发 |

日志只记 id、计数、耗时、errorCode（07 §8）。

## 2. 成本与上限

- 估算：Opus 5.5 单回合约 $0.07–0.09（inputs/04 §4.10）；一次完整协商（含一次下调重谈）约 6–9 回合 ≈ $0.5–0.8。标"估算"，以账单为准。
- 每房间 `ROOM_CALL_LIMIT = 30`；全局 `AGENTS_ENABLED`；dev 与 prod 用不同 API key / workspace，各自在控制台设花费上限（≥ 3 倍预计用量）。

## 3. seed / reset

- `seed.scopeChangeRoom` 只经 CLI（`npx convex run seed:scopeChangeRoom '{...}'`，prod 加 `--prod`）；通过同一命令管线写事件，`simulated:true`。
- **不做删除式 reset**：每次演练 seed 一个新房间，旧房间留作历史（与"历史不可篡改"一致）。
- 存档回放（加速演练）：从一次真实运行导出事件（`audit.exportRoom`，仅管理员），在新房间按序重放为新事件，信封 `simulated:true`、`correlation:"replay:<sourceRoomId>"`，UI 显示 "Replayed from room …"。不得直接写投影。
- 删除只在一种情况：法务/隐私删除请求（18 开放问题），整房间删除事件与投影并在运维日志记录。

## 4. 环境分离

| 环境 | Convex | Clerk | AGENT_MODE | 说明 |
| --- | --- | --- | --- | --- |
| 个人 dev | 每人一个 dev deployment | 开发实例 | stub（默认）/ model | `npx convex dev` |
| preview | 共享 preview deployment | 开发实例 | stub | CI 端到端 |
| prod | 生产 deployment（只从主分支 `convex deploy`） | 生产实例 | model | 任何人不对它运行 `convex dev` |

`CLERK_JWT_ISSUER_DOMAIN` 用项目级默认环境变量预置；Clerk 开发与生产实例 issuer 不同，seed 账号分别取。

## 5. 密钥

- `ANTHROPIC_API_KEY` 只在 Convex 中；Next 不持有。`CLERK_SECRET_KEY` 只在 Next 服务端。
- 环境检查脚本只报告存在性；CI 不打印 env。

## 6. 部署纪律

- 有活动 run（negotiating）时避免部署：在途 action 会被打断，由 watchdog 判失败、可人工重试，不会产生错误写入（守卫保证），但会浪费一次调用。
- schema 变更：投影字段先 optional → 部署 → `audit.rebuildRoom` 回填 → 收紧；事件载荷变更只能新增版本 + upcast（03 part3 §5）。
- 依赖使用已发布一段时间的精确版本；CI 锁定 action SHA。
