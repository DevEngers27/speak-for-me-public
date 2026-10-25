# 专题深潜：测试策略与运维（part 5/6）

> §4 运维：环境分离、密钥与配置、seed/reset 授权、可观测性、CI、部署。

## 4. 运维

### 4.1 环境矩阵

| 层级 `DEPLOYMENT_TIER` | Convex 部署 | Clerk 实例 | Anthropic workspace / key | `AGENT_MODE` 缺省 | 数据 | 谁能部署 |
| --- | --- | --- | --- | --- | --- | --- |
| `test` | 无（convex-test 进程内） | 无（`withIdentity`） | 无 | 脚本化（`vi.mock`） | 测试内构造 | — |
| `dev` | 每人一个 dev 部署（`npx convex dev`） | dev 实例 | `sfm-dev` workspace，个人 key 或共享 dev key，低花费上限 | `stub`（显式改 `live` 才调模型） | 随意 seed / purge | 本人 |
| `preview` | 每个 PR 一个预览部署（`--preview-create`），合并或关闭后由平台回收（回收策略待验证）；不可用时用本地部署 | dev 实例 | 无 key（强制 `stub`） | `stub` | `--preview-run seed:e2eRoom` 自动 seed | CI（预览部署 key） |
| `staging` | 共享集成部署（Convex 1.48 CLI 支持 `npx convex deployment create staging --type prod`，见 `NM:convex/src/cli/deploymentCreate.ts:37-46`；与 `prod` 同项目还是另建项目：待定，推荐另建项目以隔离部署 key 与用量上限） | dev 实例 | `sfm-dev` workspace 的 staging key，中等上限 | `live` | 只追加：seed 新房间、归档旧房间，不 purge | CI（main 分支） |
| `prod` | 生产部署 | prod 实例（自有域名，待验证） | `sfm-prod` workspace，独立上限 | `live` | 真实数据；seed 只能在 `ALLOW_DEMO_SEED=true` 时创建带 `isSimulated` 的演示房间 | CI（人工批准后） |

- 每个 Next 环境分别构建：`NEXT_PUBLIC_CONVEX_URL` 在构建期内联（inputs/04 §5.3），所以 preview / staging / prod 三套构建各自指向自己的 Convex 部署；部署命令用 `npx convex deploy --cmd "pnpm build" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`（选项见 `NM:convex/src/cli/lib/command.ts:376-383`），保证前端与后端同一次发布、URL 一致。
- 托管平台（Vercel 或同类）不在本专题拍板；要求只有两条：支持按分支注入不同环境变量；能在构建步骤里运行上面的命令。

### 4.2 密钥与配置归属

| 变量 | 所在位置 | 浏览器可见 | 层级差异 | 备注 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | 托管平台构建环境 | 是 | 每层不同 | 由 `--cmd-url-env-var-name` 注入 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 托管平台 | 是 | dev 实例 / prod 实例 | — |
| `CLERK_SECRET_KEY` | 托管平台（仅服务端） | 否 | 同上 | 走密码管理器，不进聊天与仓库（F15.4） |
| `CONVEX_DEPLOY_KEY` | CI 密钥存储（按环境分：preview key / staging key / prod key） | 否 | 每层一个 | 只放 CI 与托管平台；prod key 只在受保护的 `production` 环境可读 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex 环境变量 | 否 | dev / prod 实例不同 | `auth.config.ts` 缺失即抛错，部署失败、默认拒绝 |
| `ANTHROPIC_API_KEY` | Convex 环境变量 | 否 | 每层不同 workspace；preview 不设 | Next 侧不持有 |
| `AGENT_MODE`、`AGENTS_ENABLED` | Convex 环境变量 | 否 | 见 4.1 | `AGENT_MODE` 在 run 开始时快照（run-lifecycle D5） |
| `AGENT_MODEL`、`AGENT_EFFORT` | Convex 环境变量 | 否 | 可不同（评估时） | 代码白名单校验（F10.10） |
| `DEPLOYMENT_TIER` | Convex 环境变量 | 否 | 必填；缺失时所有危险内部函数拒绝执行 | 本专题新增 |
| `ALLOW_DEMO_SEED` | Convex 环境变量 | 否 | 仅 prod 有意义 | 缺省 false |
| `STUB_DELAY_MS` | Convex 环境变量 | 否 | 只在 `dev` / `staging` 生效，其他层级忽略 | L2 竞态探针用 |
| `OPS_ADMIN_TOKEN_IDENTIFIERS` | Convex 环境变量 | 否 | 可选 | v1 不提供管理按钮；若将来需要，用此名单授权 |
| `E2E_*_EMAIL / PASSWORD` | CI 密钥存储 | 否 | 仅 Clerk dev 实例的测试用户 | 永不用于 prod |

- 环境检查脚本 `scripts/check-env.ts` 只报"存在 / 缺失 / 形状不对"（如 key 前缀、URL 形状），从不打印值；不在脚本里调用会打印值的命令（F15.4）。Convex 侧用一个 `internalQuery ops.configHealth` 返回布尔值清单（不返回值），CI 部署后调用。
- 启动时配置自检：`agentRuntime` 首次调用时校验 `AGENT_MODEL` 在白名单、`AGENT_MODE=live` 时 key 存在、`DEPLOYMENT_TIER` 合法；失败写 `opsLog("config_invalid", { field })` 并让回合 `failed`（错误码 `config_invalid`），不尝试调用。

### 4.3 seed / reset 授权

| 函数 | 类型 | 允许层级 | 额外条件 | 效果 |
| --- | --- | --- | --- | --- |
| `seed.fromFixture({ fixtureKey, anchorDate? })` | internalMutation | test / dev / preview / staging；prod 需 `ALLOW_DEMO_SEED=true` | — | 新建房间（`isSimulated: true`、`fixtureKey`）、预算、基线承诺、目录、三份 draft 简报、邀请码；返回 `{ roomId, inviteCodes }`；不写确认、提案、审批（与 fixtures-walkthrough D8、scenario-plugin 一致） |
| `seed.attachMember({ roomId, role, tokenIdentifier })` | internalMutation | test / dev / preview / staging | prod 拒绝 | 为已知身份直接写成员（L2 探针与 E2E 用） |
| `seed.e2eRoom()` | internalMutation | preview / dev | — | `fromFixture` + 用 `E2E_*` 账号的 tokenIdentifier 写三名成员；供 `--preview-run` 调用 |
| `seed.archiveRoom({ roomId })` | internalMutation | 全部 | — | `room.status → closed`、写 `archivedAt`，历史保留（reset 的默认形式） |
| `seed.purgeSimulatedRooms({ confirmDeployment, fixtureKey? })` | internalMutation | dev / preview | `confirmDeployment` 必须等于当前部署名；只删 `isSimulated && fixtureKey` 的房间及其 `by_room` 子表；单次删除量受事务限额约束，分批（每批上限待验证） | 硬删除；写一条 `opsLog("purge", { rooms, rows })` |
| `devProbe.*` | internalAction / internalMutation | dev / staging | 文件入口 `assertTier` | L2 探针 |

- 授权模型：这些函数全部是 `internal*`，客户端无法调用；能调用它们的只有持有部署 admin 权限的人（`npx convex run`、dashboard）或 CI（部署 key）。`assertTier` 是第二道防线，防止"拿着 prod 的 CLI 会话误跑"。
- 审计：每次 seed / archive / purge 写 `events`（`actorType: "system"`，action `room_seeded` / `room_archived`）或 `opsLog`（purge 后房间已不存在）。
- 阶段快照（F15.1）：v1 不做；若将来做，只能从一次真实运行的导出生成并标 "seeded from run <id>"。

### 4.4 可观测性

**事实来源**：`events`（领域事件，带 `commitTs` 全序与 `requestId`）、`agentTurns` / `modelCalls`（回合与调用，字段以 run-lifecycle 为准）、`opsLog` 结构化日志、Convex 平台日志与 insights、Anthropic 控制台。

**派生指标**（`convex/ops/metrics.ts` 的 internalQuery，供 CLI 与将来的运维页使用，全部返回样本量 `n`）：

| 指标 | 计算 | 用途 |
| --- | --- | --- |
| `turnLatency` p50 / p95 | `modelCalls.latencyMs`，按 model × effort × mode 分组，最近 N 条 | 对照 F10.6 目标（p95 ≤ 8 s 为待验证目标） |
| `runTimeToProposal` | `run_started` 到 `proposal_created` 的事件时间差 | 端到端体验 |
| `tokens` | input / cacheCreation / cacheRead / output / thinking 分项求和 | 成本与缓存命中 |
| `cacheHitRate` | `cacheRead > 0` 的调用占比 | 静默失效报警（inputs/04 §4.7） |
| `invalidOutputRate`、`staleRate`、`watchdogFailRate` | 按 `outcome` / 回合状态计数 | 提示词或超时参数回归 |
| `humanInterventionRate` | 每 run 的 `humanRequests` 数 | 产品指标 |
| `spendEstimate` | `estimateCostMicros` 逐行求和，标 `estimate: true` 与价格表 `asOf` | 与供应商账单对账，不作计费依据 |
| `activeTurnCount` | `agentTurns.status === "running"` 计数 | 部署排空 |

**日志纪律**（`testing-ops/ops-log.ts`）：
- 业务代码不直接 `console.log`；统一 `opsLog(event, fields)`，`fields` 只允许 `Id`、枚举、数字、布尔、ISO 时间；任何自由文本（简报、rationale、模型原文、错误原文）类型上即无法传入。ESLint 规则禁止 `convex/` 下的裸 `console.*`（`ops-log.ts` 自身除外）。
- 错误：向客户端抛 `ConvexError({ code })`，code 来自固定枚举；内部异常只记录 `errorCode` 与 Anthropic `requestId`，不记录响应体。staging / prod 用 `convex deploy` 出来的部署（隐藏非 ConvexError 消息，F15.3）。
- 例行隐私核查：每周与每次发布后跑 L2 `log_scan`（`npx convex logs --history <n> --jsonl` → `canary-scan`）与 prod 上的"预算数字扫描"（只扫当前房间的上限与已承诺额的格式变体，零命中）。

**告警**（v1 最小集，接收端待定）：Convex `usage-limits` 的 `warning` 类型；Anthropic workspace 花费上限通知；`watchdogFailRate` 或 `invalidOutputRate` 在 24 小时窗口内超过阈值时由一个每小时的 cron（`crons.ts`）写 `opsLog("alert", …)`，外部日志流（Convex log streams，是否在当前计划可用：待验证）再转发。

### 4.5 CI 流水线

| 工作流 | 触发 | 步骤 | 密钥 | 超时 |
| --- | --- | --- | --- | --- |
| `pr` | pull_request | checkout → setup-node（`.node-version`）→ pnpm（固定版本）`install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck`（app + `convex/tsconfig.json`）→ `pnpm test`（L0 + L1）→ `pnpm build` | 无 | 15 min |
| `pr-e2e` | pull_request（同仓库分支；fork PR 跳过） | `npx convex deploy --preview-create $BRANCH --preview-run seed:e2eRoom --cmd "pnpm build" ...` → 启动 Next → `pnpm e2e`（Playwright）→ `canary-scan` 扫描 E2E 收集的帧与 HTML → 上传 trace / 报告 | preview deploy key、E2E 账号 | 25 min |
| `main` | push main | `pr` 全部步骤 → 部署 staging → `ops.configHealth` → L2 冒烟（`runtime_smoke`、`approve_last_two`）→ 上传证据 | staging deploy key、staging Anthropic key 在 Convex 侧 | 30 min |
| `nightly` | schedule | staging 上全部 L2 探针 + `log_scan` | 同上 | 45 min |
| `eval` | 手动 | L4 评估（花费护栏） | 同上 | 60 min |
| `release` | 手动 + `production` 环境保护（指定审批人） | 排空（4.6）→ `npx convex deploy --cmd ...`（prod key）→ `ops.configHealth` → 只读冒烟 → 恢复 `AGENTS_ENABLED` | prod deploy key | 30 min |

- 每个工作流 `permissions: contents: read`；第三方 Action 锁定完整 commit SHA；`concurrency` 组按分支，`release` 与 `main` 的部署 job 不取消进行中的运行（防止部署被拦腰中断）；依赖新版本需满足发布年龄并在 PR 中写理由（F15.4）。
- 原仓库 CI 只有 `pnpm check`（`ORIG:.github/workflows/ci.yml`）；新仓库的 `pr` 工作流是其超集。

### 4.6 部署与排空

1. `npx convex env set AGENTS_ENABLED false --prod`（live 的新回合拒绝，stub 不受影响，run-lifecycle D5）。环境变量变更对正在运行的函数何时可见：待验证。
2. 轮询 `npx convex run ops/metrics:activeTurnCount --prod` 直到 0，最长等待 = 看门狗期限 + 余量；超时则继续部署并在发布记录中写明被打断的回合 ID（看门狗会把它们置 `failed`，用户可 Retry）。
3. `npx convex deploy`（schema 变更遵循"先加字段 optional → 回填 → 再收紧"，大表索引用 `staged`，inputs/04 §1.6）。
4. 部署后 `ops.configHealth` 与只读冒烟；恢复 `AGENTS_ENABLED=true`。
5. 回滚：Convex 侧重新部署上一个 git SHA；schema 只做向后兼容变更，因此代码回滚不需要数据回滚。
