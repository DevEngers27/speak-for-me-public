# 15 运维

## 15.1 环境拓扑

| 环境 | Convex | Clerk | Anthropic | `AGENT_MODE` | 数据 | 部署方式 |
| --- | --- | --- | --- | --- | --- | --- |
| 本地开发（每人一个） | 个人 dev deployment | 开发实例（Restricted 注册 + 预建测试账号，免费版可用性待验证） | 可选 dev key（单独 workspace + 低花费上限） | 默认 `stub` | 只有模拟房间 | `npx convex dev` |
| 预发布 staging | 共享 deployment，只从主分支部署 | 开发或独立 staging 实例 | staging key | `live` | 模拟房间 + 内部试用 | CI `npx convex deploy` |
| 生产 | 生产 deployment | 生产实例（是否必须绑定自有域名待验证） | prod key（独立 workspace 与花费上限） | 强制 `live`（启动断言） | 真实房间 | CI，人工批准 |

- 任何人不对 staging/生产运行 `convex dev`（watch 会推送本地文件，F11.4）。
- `NEXT_PUBLIC_*` 在构建期内联，每个环境单独构建（04 平台约束 5.3）。
- Clerk 开发与生产实例的 issuer 与用户 ID 不同；seed 与管理员名单按环境分别配置。
- 访问控制上线并通过 16 的权限测试之前，任何环境只允许模拟数据（P-14）。

## 15.2 配置与密钥

- 变量清单与归属见 11 第 11.5 节。项目级默认环境变量（`npx convex env default set`）在第一次 `convex dev` 前设置 `CLERK_JWT_ISSUER_DOMAIN`；已存在的 deployment 用 `npx convex env set` 补（默认值对已有 deployment 是否生效待验证）。
- 密钥只存在于密码管理器与托管平台；不进仓库、截图、聊天、事件或日志。`scripts/env-check.ts` 只报告"缺哪些变量名"，从不打印值，也不调用会打印值的命令。
- `CONVEX_DEPLOY_KEY` 只放 CI/托管平台。GitHub Actions 锁定 action 的提交 SHA，设置超时与并发组。
- 依赖：精确版本、提交 lockfile；新依赖选择已发布一段时间的版本，例外需评审理由。

## 15.3 seed 与重置

| 操作 | 方式 | 规则 |
| --- | --- | --- |
| 新建演示房间 | `npx convex run ops/seed:createDemoRoom '{"fixtureKey":"scope_change/standard"}'` | 每次排练新建一个房间，旧房间留作历史（不删除，契合核心 6）；房间与全部子记录 `isSimulated: true` |
| 绑定已知账号 | 各测试账号登录后在 `/admin/health` 看到自己的 `tokenIdentifier`，传给 `seatTokenIdentifiers` | 直接入座，跳过邀请 |
| 应用变体 | `ops/seed:applyVariant` | 经与真实用户相同的校验路径执行（Q11：不直接写中间状态） |
| 阶段快照（例如"v2 待批"） | 在 stub 模式下真实跑一遍后，用新房间重现，不复制数据 | 任何预置结果标注来源 "seeded from run <id>" |
| 清理 | `ops/maintenance:purgeSimulatedRoom` | 仅开发部署、仅 `isSimulated` 房间；生产禁用（函数开头断言部署类型） |

seed 从不提供公共端点或界面按钮（F15.1）。

## 15.4 可观测性与度量

| 信号 | 来源 | 用途 |
| --- | --- | --- |
| 模型调用次数、各 errorCode 次数、p50/p95 延迟、token、缓存命中率 | `turns`（`ops.metrics.summary`） | 成本、稳定性、延迟预算核对（10 第 10.5 节） |
| 被校验器拒绝的输出次数（`invalid_output`） | `turns` | 提示与 schema 质量 |
| 人工介入次数（请求数、手动提出数、重试数） | `humanRequests`、`proposals.author`、`runs` | 有用性度量（V-14） |
| 得到首个可执行提案的时间 | `runs.startedAt` → 首个 `proposal_created` | 有用性度量 |
| 硬约束违规数 | 应恒为 0：执行记录对应的规则视图重放全部通过（`replayRuleView` 抽查） | 正确性哨兵 |
| stale 结果、看门狗超时、孤儿 run | `turns`、cron 日志 | 运行时健康 |

- 所有度量报告样本数与失败；未测量前不宣称改进百分比（P-18）。
- 管理员页面 `/admin/metrics` 展示上表（只读，`ADMIN_TOKEN_IDENTIFIERS`）。
- 告警（v1 用 Convex 日志 + 简单定时检查）：`AGENT_CONFIG_ERROR` 出现、stalled run 超过 30 分钟、孤儿 run、每日 token 超阈值。日志流导出到外部平台的能力待验证，作为后续增强。

## 15.5 成本控制

- 每 run 24 次调用、每房间每日 120 次、每房间每小时 10 次人工触发（10 第 10.7 节）。
- `AGENTS_ENABLED=false` 一键停止新调用；开发默认 stub。
- 供应商侧：dev/staging/prod 分 workspace，各设花费上限并留出 ≥ 3 倍余量。
- 成本估算按 `pricing.ts`（带 `asOf` 与来源说明）换算并标 "estimated"；以账单为准。

## 15.6 部署纪律

1. 推送前 CI：lint（含依赖规则）、typecheck（`next typegen && tsc --noEmit`；`convex/_generated` 入库）、单元测试、convex-test、构建；`force-dynamic` 下构建通过不代表页面能渲染，部署后跑冒烟（F11.5）。
2. 有活动 run 时部署会打断进行中的 action：部署脚本先把 `AGENTS_ENABLED` 置 false，等待 `runs.by_status` 中无 running 回合（或最长 3 分钟，余下的由看门狗收尾），部署，再恢复。
3. 插件规则版本提升时，部署后运行 `ops/maintenance:upgradeScenario`（03 第 3.24 节）。
4. 生产部署使用 `convex deploy` 产物（隐藏非 ConvexError 消息）。
5. 每次发布后：在 Convex 日志中扫描金丝雀字符串与 fixture 预算数字，应零命中（07 第 7.8 节）；跑一次 16 的真实部署并发脚本（staging）。

## 15.7 数据保留与备份

- 房间关闭后只读保留；v1 无硬删除（07 第 7.10 节）。
- 依赖 Convex 平台的备份/导出能力做定期快照（具体能力与频率待验证）；恢复演练每季度一次。
