# 15 运维

## 15.1 环境拓扑

| 环境 | Convex | Clerk | Anthropic | 数据 | 谁能部署 |
| --- | --- | --- | --- | --- | --- |
| 个人开发 | 每人一个 dev deployment（`npx convex dev`） | 开发实例 | 默认 `AGENT_MODE=stub`；需要真实调用时用开发 workspace 的 key | 只有 seed 的模拟数据（P-14） | 本人 |
| 预发布（staging） | 独立 deployment，只从主分支部署，任何人不对它 `convex dev` | 开发实例或独立实例 | 预发布 workspace，花费上限低 | 模拟数据 + 评估用例；`ALLOW_FAULT_INJECTION=true` | CI |
| 生产 | 独立 deployment（`convex deploy`，隐藏非 ConvexError 消息） | 生产实例（是否需要自有域名待验证） | 生产 workspace，独立 key 与花费上限 | 真实数据 | CI（`CONVEX_DEPLOY_KEY` 只在托管平台） |

Clerk 开发与生产实例的 issuer 与用户 id 不同；seed 的账号 tokenIdentifier 按环境分别获取（各账号登录后调用 `health.viewer`）。`NEXT_PUBLIC_*` 构建期内联，每个环境单独构建（inputs/04 §5.3）。

## 15.2 运行时可调参数

除 11.4 的配置外，以下常量可由 Convex 环境变量覆盖（在函数调用时读取；环境变量修改后的生效方式待验证）：`ATTEMPT_TIMEOUT_MS`、`WATCHDOG_GRACE_MS`、`RUN_AUTO_START_DEBOUNCE_MS`、`MAX_MODEL_CALLS_PER_RUN`、`MAX_MODEL_CALLS_PER_ROOM`、`AGENT_DAILY_CALL_LIMIT`、`STUB_LATENCY_MS`、`EFFORT_PROPOSE`、`EFFORT_REVIEW`。覆盖值越界（例如超时 < 10 s 或 > 300 s）时 `ops.checkConfig` 失败并沿用默认值。

## 15.3 巡检与告警

- `ops.sweepStuckRuns`（cron 每 5 分钟）：①`modelCalls` 中 `deadlineAt` 早于 10 分钟前、状态仍为 scheduled / running / received 的行；②status 为 running 却没有任何非终态 attempt 的 run。发现即写 error 日志 `STUCK_RUN`，并对①执行与 watchdog 相同的判定（幂等）。正常情况下 watchdog 已处理一切，巡检命中意味着代码缺陷。
- 告警（订阅 Convex 日志中的 error 级结构化事件）：`MODEL_BAD_REQUEST`、熔断打开、`APPLY_FAILED`、`INTERNAL_PRECONDITION`、`ENGINE_LEDGER_DRIFT`、`STUCK_RUN`、部署当日调用量 > 80% 上限、invalid_output 率 1 小时内 > 20%、stale 率 > 30%。

## 15.4 度量面板

`ops.metrics({ since })`（internal query，经 CLI 或内部面板）输出 10 part6 §10.19 的全部指标，并始终附带样本量与失败数（V-14、P-18）：每类回合 p50 / p95、重试率、invalid_output 率、stale 率、缓存命中率、每 run / 每次执行的估算成本、得到首个有效提案的时间、人工干预次数、协商受阻（negotiation_blocked）次数、手动提案占比。未测量之前不对外陈述任何改进百分比。

## 15.5 日志与隐私核查

- 上线前与每周例行：`scripts/log-scan.ts` 拉取 Convex 日志（只读），搜索 fixture 中的金丝雀串（`CANARY-*`）与预算数值（`500000`、`480000`、`$5,000`、`$4,800` 等），要求零命中（F15.3、PV-08）。
- 例行抽查 `rooms.workspace` 在 provider 身份下的 WebSocket 负载（浏览器开发者工具或 e2e 钩子），不得出现预算键与数值。

## 15.6 seed 与 reset

- 只有 internal mutation，经 CLI：`npx convex run seed:seedFixtureRoom '{"fixtureKey":"scope_change.standard.v1","participants":{…},"agentMode":"stub"}'`（生产加 `--prod` 且要求显式确认；生产默认不 seed）。
- 推荐每次演练 seed 一个**新房间**，旧房间留作历史，不删除（与核心 6 一致）。`seed.applyFixtureVariant` 以对应角色身份走生产路径推进到某个阶段（例如变体 A 的"finance 下调上限"），不直接写中间状态（Q11）。
- 需要清理时用 `ops.purgeRoom`，只接受 `isSimulated: true` 的房间（生产真实房间的删除走 07 §7.11 的书面流程）。
- 预跑的演示结果若要展示，必须来自真实运行的存档并标注 "Recorded run at {time}"（F10.8、P-17）；v1 不提供回放功能，见 17。

## 15.7 密钥与部署纪律

- 密钥只放在 Convex 环境变量 / 托管平台的密钥存储 / 密码管理器；不进 Git、截图、聊天。`scripts/env-check.ts` 只报告变量是否存在与格式是否合法，不打印值（P-26、AR-19）。
- 部署流水线：lint + typecheck + 单元测试 + convex-test → `convex deploy` → `ops.checkConfig`（失败即回滚）→ `ops.checkModelAccess`（live 环境）→ Next 构建与部署 → 运行时冒烟（e2e 子集）。
- 有活动 run 时部署是安全的（10 part4 §10.11）；部署前查看 `ops.liveAttemptCount` 只为避免不必要的付费重试。协议输出形状变化时递增 `PROTOCOL_VERSION`。
- CI：Actions 锁定 SHA、设超时与并发组；新依赖选已发布两周以上的精确版本（F15.4）。

## 15.8 成本控制

四级调用预算（10 part4 §10.9）+ 总开关 + 熔断 + 供应商侧 workspace 花费上限（至少留 3 倍余量）。成本显示一律为估算，带价格表版本；超时 / 传输错误请求的成本单列为"未知"。

## 15.9 事故手册

| 事故 | 现象 | 处置 |
| --- | --- | --- |
| 额度耗尽 / 密钥失效 | 熔断打开横幅；`MODEL_QUOTA` / `MODEL_AUTH` 告警 | 修复额度或密钥 → `ops.checkModelAccess` → `ops.resetAgentCircuit`；受影响房间的人点 "Retry" 或已手动提案 |
| 成本异常 | 日调用量告警 | `npx convex env set AGENTS_ENABLED false`；查 `ops.metrics` 定位房间；必要时 `ops.setRoomModelCallLimit` |
| 模型 400 风暴 | `MODEL_BAD_REQUEST` 激增 | 多为请求形状或 schema 问题：回滚上一个版本；检查 V4（schema 写法）结论 |
| 卡住的 run | `STUCK_RUN` | 巡检已兜底；按日志中的 attemptId 排查代码缺陷 |
| 隐私疑似泄露 | 日志扫描命中、用户报告 | 停用代理（总开关）；定位来源（模板 / 投影 / 日志）；修复后补跑 PV-* 全套；按需通知受影响房间 |
