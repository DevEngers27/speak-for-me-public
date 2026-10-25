# 15 运维

## 1. 可观测性

| 指标 | 来源 |
| --- | --- |
| 回合数、p50/p95 延迟、失败/超时/stale/invalid_output 次数 | agentTurns |
| token（含 thinking、缓存读写）与估算成本 | agentTurns.usage × 配置价格表（运维脚本，标 estimate） |
| 人工请求次数、平均等待 | humanRequests |
| 对账失败次数 | `budget.reconcileInternal` 定时巡检（每小时 cron 对活跃房间运行，只记房间 id 与失败码） |
| 执行重复命中次数（E2 查重命中） | 运维计数日志（不写房间事件） |

日志只记 id、计数、错误码，不记 prompt、简报、模型原文、金额。上线前与每周：在 Convex 日志中搜索 fixture canary 与预算数字，应零命中。

## 2. seed / reset

- `npx convex run seed:demoRoom '{"fixtureKey":"baseline"}'`（internalMutation，生产需 `--prod` 且默认禁用：`SEED_ENABLED` 环境变量）。
- 每次演练 seed 新房间，旧房间保留（历史不可篡改）；不提供删除式 reset。需要清理时只在 dev 部署清表。
- seed 经与产品相同的内部 helper 写入，所有记录 `simulated: true`；不预置"已签字"等中间状态（Q11 的回答：中间状态必须经真实 mutation 产生）。

## 3. 环境分离与密钥

- dev / preview / prod：各自的 Convex 部署、Clerk 实例、Anthropic workspace 与 key、花费上限（至少 3 倍于预期用量）。
- 密钥只放 Convex / 托管平台环境变量；环境检查脚本只报"存在 / 缺失"。
- `AGENTS_ENABLED=false` 一键停用模型调用；`AGENT_MODE=stub` 用于无额度环境。

## 4. 部署纪律

- 有活动 run（negotiating）时不部署：在途 action 会被打断（看门狗会把回合置 failed，可重试，但浪费调用）。部署脚本先查询活跃回合数。
- schema 变更：新增字段先 optional 再回填。
- CI：lint（含禁止 `constraintsVersion` 直写、禁止 `convex/` 下 `console.log` 白名单外）、typecheck、单测、convex-test；依赖锁精确版本；actions 锁 SHA。
- 并发测试脚本对 dev 部署运行，作为发布前检查（16 §4）。
