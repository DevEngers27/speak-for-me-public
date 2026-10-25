# 15 运维

## 15.1 环境

| 环境 | Convex | Clerk | 模型 | 数据 | 谁能部署 |
| --- | --- | --- | --- | --- | --- |
| 个人开发 | 每人一个 dev deployment（`npx convex dev`） | Clerk 开发实例 | 默认 `AGENT_MODE=stub`；需要时用开发 workspace 的 key | 只有 fixture（模拟） | 本人 |
| 预发布 staging | 共享 deployment，只从主分支经 CI 部署；任何人不对它运行 `convex dev` | Clerk 开发实例（独立应用或同一开发实例，待定） | `live`，开发 workspace key，花费上限 | 只有 fixture 与测试账号 | CI |
| 生产 | 独立 deployment | Clerk 生产实例（是否必须绑定自有域名：待验证） | `live`，生产 workspace key，独立花费上限 | 真实数据 | CI（需审批） |

- 访问控制实现并通过 16 章权限与隐私测试之前，任何环境都只使用模拟数据（P-14）。
- 每个环境分别构建 Next（`NEXT_PUBLIC_*` 在构建期内联，inputs/04 §5.3）。
- Clerk 开发与生产实例的 issuer 不同，用户的 `tokenIdentifier` 不同，seed 按环境取账号。

## 15.2 密钥

| 密钥 | 存放 | 规则 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 对应 Convex deployment 环境变量 | dev 与 prod 分属不同 workspace；永不出现在 Next 或浏览器 |
| `CLERK_SECRET_KEY` | Next 托管平台环境变量 | 密码管理器传递，不进聊天与截图 |
| `CONVEX_DEPLOY_KEY` | CI 密钥 | 只有部署作业可读 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex 环境变量（项目级默认 + 各 deployment） | 非密钥，但缺失即推送失败 |

`scripts/env-check.ts` 只报告"缺哪些名字"，不打印值，也不调用会打印值的命令。

## 15.3 健康检查：三种状态分开报告（P-19）

| 状态 | 判定 | 显示位置 |
| --- | --- | --- |
| 已安装 | 依赖存在 | CI |
| 已配置 | 变量存在且通过格式预检（11 §11.4） | `/setup`、`env-check` |
| 端到端可用 | Clerk 登录成功且 `health.viewer` 返回已认证；`admin.metrics` 能读；live 环境额外用最小请求验证模型 ID 可用（`models.retrieve`） | `/setup`（开发/管理员）、部署后冒烟作业 |

## 15.4 可观测性

- 结构化日志：只有 `logEvent(name, SafeLogFields)`（07 §7.16）。事件名例：`turn.started`、`turn.completed`、`turn.stale`、`turn.failed`、`decide.executed`、`decide.duplicate`、`constraints.bumped`、`ratelimit.hit`。
- 指标（`admin.metrics`，来自 `modelCalls`/`agentTurns`/`runs`/`counters`）：每日调用数与失败率（按 errorCode）、回合 p50/p95 延迟、token 与缓存命中率、`rejected_stale` 次数、`needs_human` 次数与原因、人工请求回答时间、重复执行次数、每房间从激活到首个 `awaiting_approval` 的时间。报告样本数；没有测量就不宣称改进（P-18）。
- 告警：`MODEL_HTTP_400`（编程错误）任意一次；`STOP_REFUSAL` 激增；缓存命中率为 0；看门狗触发率 > 5%；`dup_exec` 激增（可能有人在脚本化重放）。

## 15.5 成本控制

- 供应商侧：开发与生产 workspace 各设花费上限，留出 ≥ 3 倍余量。
- 应用侧：10 §10.6 的每 run / 每房间 / 每用户上限；`AGENTS_ENABLED` 总开关；无可行解时不调用模型。
- 估算：成本由 token × 价目表常量离线换算，界面与报表标注 "estimate"；以账单为准。

## 15.6 seed 与 reset

- `admin.seedFixture`（internal，CLI 调用；对生产需显式 `--prod` 且仅限内部演示账号）：创建一个新房间并走生产写入路径到激活点（14 §14.6）。推荐每次演练 seed 一个新房间，旧房间保留为历史。
- 不提供"重置到中间状态"或"预置待批提案"：中间状态只能由真实运行（stub 或 live）产生（核心 8）。
- `admin.purgeRoom`：仅在 `ALLOW_PURGE=1` 的部署上、且房间 `isSimulated`；生产上的合规删除走两人复核的运维流程，操作写入运维日志。
- 产品界面没有 reset 按钮（RA-U14）。

## 15.7 部署纪律

- CI：lint（含依赖方向与 `no-console`）、typecheck、单元测试、convex-test、静态安全测试（不可变表写入扫描、public 函数快照）、构建；主分支合并后部署 staging 并跑 E2E 与隐私金丝雀扫描；生产部署需人工批准。
- 部署会打断进行中的 action：看门狗会把被打断的回合置为 failed 并按规则重试或等待人工重试，所以部署不会卡住房间；仍建议在低峰部署，并在部署后检查 `turn.failed{WATCHDOG_TIMEOUT}` 计数。
- 依赖：锁定 lockfile；新依赖选用已发布一段时间的精确版本；CI actions 锁定 SHA；CI 作业设超时与并发控制（L3，从第一天做）。
- schema 变更遵循 03 §3.15。

## 15.8 隐私运维

- 上线前与每次发布后：在 staging 用 `scope_change.canary` 跑完整流程，扫描 Convex 日志、全部 query 返回、渲染事件，金丝雀零命中（TC-OPS-01）。
- Convex 控制台：生产 deployment 只授予必要成员；控制台能读全部数据，这是被明确接受的残余风险（07 §7.5），通过人员最小化与访问审计约束。
- 数据保留：房间数据在生命周期内保留；关闭后只读；合规删除见 07 §7.17。

## 15.9 事故手册（摘要）

| 情况 | 动作 |
| --- | --- |
| 模型成本异常 | `npx convex env set AGENTS_ENABLED false`（立即生效，在途回合跑完后不再调度）；查 `admin.metrics` 定位房间 |
| 发现隐私泄露 | 关闭开关；定位泄露路径（DTO / 事件 / 日志 / 上下文）；修复并补金丝雀用例；评估是否需通知受影响用户 |
| 邀请链接外泄 | 房主撤销未接受的邀请；已被错误占用的席位 → 关闭房间并重建（v1 无解绑） |
| 卡在 `failed` 的 run | 成员点 "Retry turn"；超过人工重试上限时请求重新协商 |
