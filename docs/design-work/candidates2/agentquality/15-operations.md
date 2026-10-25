# 15 运维

## 15.1 环境分离

| 环境 | Convex 部署 | Anthropic workspace / key | AGENT_MODE | 数据 |
| --- | --- | --- | --- | --- |
| local dev | 个人 dev 部署 | dev workspace，低花费上限 | stub（默认）/ live | seed |
| preview | preview 部署 | dev workspace | stub | seed |
| eval | 独立 dev 部署或纯 node | eval workspace（独立上限） | live / replay | fixture |
| prod | prod 部署 | prod workspace，花费上限 ≥ 3 倍预期 | live | 真实 |

## 15.2 可观测性
- 指标来源只有结构化表：modelCalls（调用、token、延迟、stopReason、outcome）、turns（invalid、stale、flags）、runs（轮次、paused 原因）、humanRequests（升级次数）。不靠日志正文。
- 运维看板（`ops.exportUsage`，管理员）：每日调用数、invalid_output 率、refusal 率、stale 率、p50/p95 延迟、估算成本、缓存命中率；带样本量。
- 告警：`API_BAD_REQUEST` 任意一次；invalid_output 率日均 > 5%；缓存命中率回退为 0；日成本超过阈值。
- `events.requestId` 记录 `ctx.meta.getRequestMetadata().requestId`，用于把一次用户操作与它触发的回合串起来。

## 15.3 seed / reset
- `seed.demoRoom({fixture})` 只能经 CLI（`npx convex run`，生产加 `--prod` 且需要管理员确认）；每次创建新房间，旧房间保留为历史，不提供删除式 reset。
- 预置的阶段快照（例如"v1 已有两方批准"）只能来自一次真实运行的录制，并标注 "seeded from run <id>"。

## 15.4 密钥与部署纪律
- 密钥只在 Convex / 托管平台环境变量中；检查脚本只报"存在 / 缺失"，不打印值。
- 有非终态 run 时不部署（在途 action 会被中断，由 watchdog 收尾为 paused，可人工 retry）。部署脚本先查询 `ops.activeRunCount`，非 0 时提示。
- 新依赖锁精确版本；CI 锁 action SHA、设置超时。

## 15.5 成本控制
四道闸：每 run 调用上限、每房间每日上限、`AGENTS_ENABLED`、供应商 workspace 花费上限。成本数字一律标 "estimate"，以账单为准。
