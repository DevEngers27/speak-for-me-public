# 15 运维

## 1. 可观测性

- 唯一数据源：`agentTurns`（每次尝试的 model、effort、stopReason、usage、latencyMs、errorCode、lateResult）。
- `ops.usageSummary({sinceMs})`（CLI `npx convex run ops:usageSummary`）：调用数、成功/失败/stale 数、按 errorCode 分布、p50/p95 延迟、token 合计、估算成本（标 estimate）、人工请求数、执行数；报告样本量。
- 缓存断言：同一 run 第二个回合起 `cacheReadInputTokens > 0`，否则在 summary 中标红。

## 2. seed / reset

- `seed.scopeChangeRoom({ variant, creatorTokenIdentifier?, today? })` 是 internalMutation，只经 CLI 调用；写入：room（simulated）、三个席位（可选直接绑定已知账号，否则生成邀请令牌并返回）、三份 v1 简报（simulated、confirmedBy "system:seed"），然后与正常路径一样触发 `startRun`。
- 不提供删除式 reset：每次排练 seed 一个新房间，旧房间留作历史（核心 6）。
- 不 seed 中间状态（已有审批、待批提案）：所有后续状态必须经真实 mutation 产生（Q11 的回答）；需要快速到达待批状态时用 `AGENT_MODE=stub`。

## 3. 环境分离

| 环境 | Convex 部署 | Clerk 实例 | AGENT_MODE | key |
| --- | --- | --- | --- | --- |
| 个人开发 | 每人一个 dev deployment | dev | stub（默认）/ model | dev workspace key，低花费上限 |
| 集成/预览 | 共享 deployment，只从主分支 `convex deploy` | dev | model | 同上 |
| 生产 | prod deployment | prod（是否需自有域名待验证） | model | prod workspace key，单独花费上限 |

任何人不对共享/生产部署运行 `convex dev`。

## 4. 成本与上限

每 run ≤ 27 次尝试；每房间 ≤ 20 个 run；`AGENTS_ENABLED=false` 总开关（action 开头检查，回合以 `AGENTS_DISABLED` 失败，界面明确提示）；Anthropic 控制台按 workspace 设花费上限（至少 3 倍余量）。

## 5. 密钥与部署纪律

- 密钥只在部署平台与密码管理器；环境检查脚本只报告存在性。
- 有活动 run（negotiating）时不部署：部署会打断在途 action，看门狗会把它判 TIMEOUT 并自动重试一次，所以误部署可恢复，但浪费一次调用。
- 依赖用精确版本；CI 锁 actions SHA。

## 6. 隐私例行检查

上线前与每周：在 Convex 日志中搜索 canary 字符串与 fixture 预算数字 → 零命中；生产使用 `convex deploy` 产物（隐藏非 ConvexError 消息）。

## 7. 数据保留（开放）

私密简报与 rationale 的保留期限、房间归档时清除 notes/rationale 的运维操作，待用户决定（18 号 Q5）；模型供应商的数据保留政策需确认（GAP-23）。
