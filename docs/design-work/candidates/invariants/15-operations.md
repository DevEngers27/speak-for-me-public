# 15 运维：环境、seed、可观测性、用量与成本、密钥、部署

## 1. 环境分离

| 环境 | Convex | Clerk | Anthropic | AGENT_MODE | 数据 |
| --- | --- | --- | --- | --- | --- |
| dev（每人一个） | 个人 dev deployment（`npx convex dev`） | 开发实例 | 无 key 或 dev workspace key | 默认 stub | 只有模拟数据（P-14） |
| staging | 共享 deployment，只从主分支经 CI `convex deploy` | 开发实例（或独立 staging 实例） | staging workspace key，月度上限 | llm | 模拟 + 内部测试数据；真实模型端到端验收在此 |
| prod | 独立 deployment | 生产实例（是否需自有域名待验证） | prod workspace key，月度上限 | llm | 真实数据 |

- 任何人都不对 staging/prod 运行 `convex dev`（watch 会推送本地文件）。
- `NEXT_PUBLIC_*` 构建期内联，每个环境单独构建（inputs/04 §5.3）。
- Clerk 开发与生产实例的 issuer 与用户 id 不同；seed 按环境分别取账号 tokenIdentifier。
- `DEPLOYMENT_KIND` 决定危险运维函数是否可用；缺失视为 prod。

## 2. seed 与 reset

- `internal.ops.seedScopeChange`（CLI：`npx convex run ops/seed:seedScopeChange '{"variant":"renegotiate", …}'`）：创建 `isSimulated = true`、`fixtureKey` 的房间；对提供了 tokenIdentifier 的账号直接 `addParticipant`（joinedVia seed），其余角色提示房主生成邀请；三份简报经 `commitBriefVersion(origin = "fixture")` 写入，与生产走同一校验路径（Role A RA-F03 修正三）。账号的 tokenIdentifier 由各账号登录后在 `/setup` 读取 `health.viewer` 得到。
- **不直接写中间状态**（提案、审批、执行）：需要"v2 待批"之类的演练起点时，用 `scripts/drive-demo.ts` 以 stub 模式调用真实公共函数推进（各账号的 Convex 身份由测试 token 提供，具体方式待验证），产生的记录全部是真实流程的结果且带模拟标记。
- 推荐每次演练 seed 一个新房间，旧房间留作历史，不删除（核心 6）。
- `internal.ops.purgeSimulatedRoom` 只在非 prod 且房间 `isSimulated` 时可用，按 by_roomId 级联删除；prod 没有任何删除路径。

## 3. 可观测性

**结构化来源**（不靠日志正文）：`agentTurns`（回合状态、错误码、尝试次数）、`modelCalls`（token、延迟、stop_reason、成本估算）、`events`（业务时间线）、`runs`（结局与原因）。

**指标**（`internal.ops.metrics`，按天、按环境，报告样本量 n 与失败数，P-18、AC-14）：

| 指标 | 定义 |
| --- | --- |
| 回合延迟 p50 / p95 | `modelCalls.latencyMs`，按调用点分组 |
| 首个有效提案用时 | run 创建 → 第一个 verdict = pass 的提案 |
| 约束变化后恢复用时 | bump → 新 run 进入 pending_approval 或 awaiting_input |
| 人工介入次数 | 每 run 的人工请求数、拒绝数、重谈请求数 |
| 硬约束违规数 | 规则判 blocked 的提案数（代理提出了违规方案）；**执行后违规数必须恒为 0**（由 auditRoom 断言） |
| 失败率 | invalid_output、failed、stale、cancelled 占比；按错误码 |
| 缓存命中 | `cache_read_input_tokens > 0` 的同角色后续回合占比 |
| 成本 | 每 run、每房间、每天的估算美元，标 "estimate" |
| 不变量违规 | `auditRoom` 发现数（期望 0；非 0 即告警） |

**告警**：auditRoom 违规、`INVARIANT_VIOLATION`、HTTP 4XX（编程错误）、某日成本超过阈值、watchdog 触发率异常升高。告警内容只含 id、码、计数，不含业务数值。

## 4. 用量与成本控制

- 每房间调用预算（默认 40）、`AGENTS_ENABLED` 总开关、建房策略、`runs.start` 冷却（10 §6、07 §2）。
- Anthropic 控制台：dev / staging / prod 分 workspace 与 key，各设月度花费上限（至少留 3 倍余量）；以控制台账单为成本真相，系统内估算只用于趋势与提示。
- 若某日成本异常：先把 `AGENTS_ENABLED=false`（进行中的回合由 watchdog 收尾为 failed，房间进入可重试状态），再排查。

## 5. 部署纪律

- 部署会中断进行中的 action（inputs/04 §2）。部署前执行 `internal.ops.liveTurns`，有 running 回合时等待或接受其被 watchdog 收尾后自动重试（10 §5）。因为结果提交有持久化守卫、回合有 watchdog，部署不会造成状态损坏，只会多一次调用。
- schema 变更遵循 03 §23（先 optional、回填、再收紧）；场景版本升级不影响已有房间（`rooms.scenarioVersion` 固定）。
- 部署后运行 `internal.ops.checkModelAccess` 与一次 staging 端到端冒烟（16 §6）。
- CI：lint（含不变量 lint 规则）、typecheck（`_generated` 入库）、单测、convex-test、构建、Playwright（staging 夜间）；actions 锁 SHA、设超时与并发控制；依赖锁精确版本并提交 lockfile（F15.4）。

## 6. 密钥与日志纪律

- `ANTHROPIC_API_KEY`、`CLERK_JWT_ISSUER_DOMAIN` 只在 Convex 环境变量；`CLERK_SECRET_KEY` 只在 Next 服务端；`CONVEX_DEPLOY_KEY` 只在 CI。密钥不进仓库、截图、聊天、日志（P-26）。
- 环境检查脚本只报告"已设置 / 未设置"，不运行会打印值的命令。
- 上线前与每周：在 Convex 日志中搜索 fixture 金丝雀与预算数值，期望零命中（F15.3）；生产使用 `convex deploy` 出来的部署，非 ConvexError 消息被隐藏。

## 7. 数据保留与隐私说明

- 产品隐私说明如实写明：私密简报由服务端处理并发送给模型提供方用于生成代理回合；不宣称端到端加密或"零泄露"（P-11）；模型提供方的数据保留与训练政策以组织账户设置为准（待验证，GAP-23）。
- 保留：房间及其历史在生命周期内保留；删除与匿名化见 18 开放问题。
