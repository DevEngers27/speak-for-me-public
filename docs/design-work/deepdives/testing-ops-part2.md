# 专题深潜：测试策略与运维（part 2/6）

> §2 决定与理由（续）。文件清单见 testing-ops.md。

### TD-7 四个部署层级 + 一个层级变量
- 决定：Convex 部署分 `dev`（每人一个）、`preview`（每个 PR 一个、短命，若账户计划不支持则改用本地部署，待验证）、`staging`（共享集成，长期）、`prod`；每个部署设置环境变量 `DEPLOYMENT_TIER`，所有危险的内部函数（seed 假身份、reset、`devProbe.*`）在入口调用 `assertTier(...)`。Clerk：dev 实例服务 dev / preview / staging，prod 实例只服务 prod。Anthropic：dev 与 prod 不同 workspace、不同 key、各自花费上限。
- 理由：层级必须在服务端可判定，不能依赖"运维记得不要在生产上跑"；`--prod` 只是 CLI 选择，函数本身不知道自己在哪。
- 否决：用部署 URL 字符串推断层级（易错）；单一 dev 部署多人共享（个人试验互相污染，L2 证据不可复现）。

### TD-8 seed 只追加，reset 只存在于可丢弃层级
- 决定：`seed.fromFixture` 是 `internalMutation`，经 `npx convex run` 调用，每次新建房间并标 `isSimulated: true`，从不删除旧房间；硬删除式 `seed.purgeSimulatedRooms` 只在 `dev` / `preview` 可用，且要求参数 `confirmDeployment` 与当前部署名一致（部署名来源：`ctx.meta.getDeploymentMetadata()`，字段名待验证；退路是 `CONVEX_CLOUD_URL` 环境变量）。生产不提供任何 reset。
- 理由：与核心 6"历史不可篡改"一致（F15.1 推荐）；把删除能力限制在本来就可整体丢弃的部署。

### TD-9 可观测性只用三个事实来源
- 决定：(1) `events`（领域事件，追加，带 `commitTs` 全序与 `requestId`）；(2) `agentTurns` + `modelCalls`（回合状态与每次模型调用的 token、延迟、`stopReason`、`model`、`requestId`、`attempt`、`outcome`；表结构以 run-lifecycle 专题为准）；(3) 结构化日志（`opsLog()` 助手，只接受白名单键与非文本值）。所有指标（调用次数、p50/p95、拒绝率、人工介入率、估算成本）由 `internalQuery` 从 (1)(2) 派生并报样本量。外部看板只读这些查询或 Convex 自带的 logs / insights。
- 理由：F15.2 要求"用量来自结构化字段、报样本量"；不自建指标存储即可满足 v1。

### TD-10 CI：PR 闸门无密钥，部署闸门有人
- 决定：PR：安装（冻结锁）→ lint → typecheck（app 与 convex 两个 tsconfig）→ L0 + L1 → `next build` → L3（stub）→ 金丝雀扫描 L3 产物。main：部署 staging → L2 冒烟。生产：人工批准 + 排空检查（无活动 run）→ `npx convex deploy` → 部署后冒烟。第三方 Action 锁 SHA、每个 job 设超时与并发组（F15.4）。
- 理由：PR 闸门不持有任何密钥，fork PR 也安全；生产部署会打断在途 action（F10.2、F15.4），必须先排空。

### TD-11 生产部署前排空代理
- 决定：部署脚本先 `npx convex env set AGENTS_ENABLED false --prod`（新回合直接返回 `agents_disabled`）→ 轮询 `ops.activeTurnCount` 直到 0 或超过看门狗期限 → 部署 → 恢复 `AGENTS_ENABLED`。被看门狗判失败的回合可由人点 "Retry turn"。
- 理由：action 至多一次、被部署打断无回调（inputs/04 §1.5）；排空把"被打断"从常态变成例外，看门狗兜底例外。
- 注意：`npx convex env set` 修改环境变量后函数是否立即读到新值：待验证。

### TD-12 用量护栏分三层
- 决定：每房间调用上限（`runs.callCount`，调用前原子 +1，F10.5）；全局开关 `AGENTS_ENABLED`；供应商侧 workspace 花费上限（dev 与 prod 分开，至少 3 倍余量）。另外用 Convex CLI 1.48 的 `usage-limits`（指标含 `functionCalls`、`actionComputeConvexGbHours` 等，类型 `warning | disable`，源码 `NM:convex/src/cli/lib/usageLimits.ts:15-40`）给每个部署设 Convex 侧告警；`disable` 会暂停部署，只用于 dev / preview。
- 与 10 的关系：run-lifecycle 专题另设 `usageCounters` 全局按日上限（热点文档，冲突升高时分片）；本专题要求 L2 探针 `start_run_repeat` 同时记录该文档的 OCC 冲突情况，作为是否分片的依据。
