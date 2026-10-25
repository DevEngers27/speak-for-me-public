# 15 · 运维

> 分片：`15-operations.md`（§15.0–15.3 目标、决定、环境三层、预览默认变量与配置自检）→ `15-operations-part2.md`（§15.4–15.5 构建、发布与 CI，排空）→ `15-operations-part3.md`（§15.6–15.7 可观测性、用量与成本）→ `15-operations-part4.md`（§15.8–15.11 cron、seed / reset 授权、密钥与轮换、备份与 break-glass）→ `15-operations-part5.md`（§15.12–15.18 采购与无 Pro 退路、事故手册、上线前验证、不变量、备选与否决、开放问题、与 canon 的对照）。
> 底稿：`candidates/runtime/15-operations.md`、`deepdives/testing-ops-part5.md` §4。吸收：`deepdives/testing-ops-review*.md`（r06 排空、r07 日志采集、r09 预览变量、r11 限额、r17 发布顺序、r19 措辞）、`techstack/README.md` D28–D39 与 X4 / X5、`techstack/observability-ops*.md` 及其反驳（r01–r10）、`spikes/README.md` §6 / §8、`foundation/dev-tooling`。依据：canon D16、D17、D18、D20、D22、U5、U9、U11。函数签名见 12，目录与配置解析见 11 §11.10。

## 15.0 目标

1. 三层环境彼此隔离：密钥、数据、模型花费与部署权限按层分开；预览环境永远不持有模型密钥。
2. 发布不制造用户可见的失败：先排空、再部署；在途回合照常提交，靠守卫与看门狗兜底。
3. 可观测但不泄密：日志、错误追踪、第三方遥测只收白名单字段；成本只来自自有账本 `attempts` 并标"估算"。
4. 运维动作不绕过生产写入口：seed 走与用户相同的 helper 链，reset 只在非生产层且只删非 `live` 数据；生产没有 reset。
5. 采购项（Convex Pro、Vercel Pro + 域名、Axiom）按已采购设计，但每一项都写出不采购时的退路（U9）。

## 15.1 决定一览

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| O1 | v1 三层：`dev`（每人一个）/ `preview`（每 PR 一个，强制 stub）/ `prod`；`DEPLOYMENT_TIER` 环境变量 + `assertTier` 守护危险函数；staging 是扩展点 | 部署 key、用量上限、日志流与异常上报本就按部署配置（techstack D29、observability review r05） | 四层含独立 staging 项目（多一套集成与发布路径；Vercel 自定义环境下 `VERCEL_ENV=preview` 会让 prod 型 deploy key 的发布被 CLI 中止，review r04） |
| O2 | 每个环境用自己的变量单独构建；构建命令 `npx convex deploy --cmd "<build>" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`；发布顺序"先推向后兼容的后端、再发布前端"，回滚相反 | skeleton 证伪"NEXT_PUBLIC 一律构建期内联"；`--cmd` 在推送之前执行，只保证 URL 注入（review r17） | 一次构建多处部署 |
| O3 | 排空用数据库标志 `opsFlags.draining`（D17）：人工开局拒绝、新的 live attempt 停泊（约束变化引起的新 run 照常建立，只是首个回合停泊），在途 attempt 照常提交；stub 不受影响；`AGENTS_ENABLED` 只作紧急止血 | 用 kill switch 排空会把所有在途多步 run 打成失败（review r06）；数据库标志事务内可见，不依赖环境变量生效时机 | `AGENTS_ENABLED=false` 排空 |
| O4 | 两个 logger（§15.6.2 唯一定义）：internal 用 `opsLog(ctx: InternalCtx, code, SafeLogFields)`，公开路径只用三键闭集的 `publicOpsLog`；所有函数经 `withSanitizedErrors`；Sentry `dataCollection` 全部键显式关闭并 `satisfies Required<DataCollection>`（D16、techstack D30 / X4） | 未捕获异常的消息与堆栈会经 `function_execution.error_message` 与异常上报外传；Sentry v11 未写的键默认全开 | 只约束自抛错误；部分键配置 |
| O5 | 成本事实来源是 `attempts`（每次调用一行、无论成败都记 usage）；结算时按带 `asOf` 的价目表估算并写一次 `attempts.costMicroUsd` / `priceTableAsOf`（03、10），界面标 "Estimated"；与供应商账单周期对账 | token 是事实、金额是估算：估算带价目表版本、不回溯改写；日志流可丢可重，不能当账本（核心 8） | `modelCalls` 独立表（canon 已并入 `attempts`）；Axiom 作账本 |
| O6 | 上限四层 + 兜底（D17）：每用户每房间节流、每 run attempt 上限、每 run 美元预留 / 结算、全局日美元计数（被调度路径返回 `deferred`）、Anthropic Console 花费上限；月预算 dev $100 / prod $300（U5） | 单一真相源，各层落在本来就要写的文档上 | 每房间累计调用上限；8 层上限 3 个真相源（techstack X2） |
| O7 | seed / reset 双层授权：CLI 侧 dev-tooling `convex-ops` 守卫 + 服务端 `assertTier`（层级 + 部署名）；生产无 seed、无 reset，`rooms.close` 是 `setup` / `open` 房间唯一的清理、`executed` 房间只读（D18） | 防"拿着 prod 的 CLI 会话误跑"；不伪造中间状态（核心 8） | 生产 demo seed（`ALLOW_DEMO_SEED`）；purge 生产模拟房间 |
| O8 | 每个密钥只放在使用它的一处；"先加新、再部署、后删旧"；90 天例行轮换 + 泄露即换 + 人员离开当天换（techstack D34） | 三个平台都支持多把 key 并存 | 统一密钥同步服务（Doppler / Vault：多一个能读全部密钥的系统） |
| O9 | prod 周期备份 + 每次发布前手动备份；break-glass 恢复手册（D39）；自动化脚本禁止 `--replace` | 一刀切禁用会让灾难恢复无手册；误覆盖不可逆 | 无备份；脚本化恢复 |
| O10 | 四个 cron：`clock.rollLocalDate`（每小时，兜底）、`humanRequests.expireDue`（每小时）、`ops.livenessSweep`（每 5 分钟）、`ops.purgeRawOutputs`（每日），全部幂等、按房间扇出；`localDate` 的正常推进是每个房间在本地午夜登记的 `runAt` 单房间调用（09 §9.6.7、canon D22） | D22、D15、D07 的活性兜底；模型原文有保留期（D16、03） | 只靠每小时 cron 推进 `localDate`（午夜后最长约 1 小时滞后；修订后的 canon D22 采用本地午夜 `runAt` 精确推进 + 小时 cron 兜底） |

## 15.2 环境三层

| 层 `DEPLOYMENT_TIER` | Convex | 前端托管 | Clerk | Anthropic | `AGENT_MODE` | 数据 | 谁能部署 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `test`（不是部署） | convex-test 进程内 | — | `withIdentity` | 无（`vi.mock` 唯一接缝 `callModel` + 脚本队列） | `live`（测试里显式设 key 占位与 `AGENTS_ENABLED=true`，需要 stub 的用例 `vi.stubEnv`，testing-ops review r02） | 测试内构造 | — |
| `dev` | 每人一个 dev 部署（`npx convex dev`）；CI 另有一个专用 dev 部署 `ci-dev` 跑真实部署探针 | 本地 `next dev` | dev 实例 | workspace `sfm-dev`，个人 key，月上限 $100（U5） | 缺省 `stub`，显式设 `live` 才调模型 | 随意 seed / reset | 本人 / CI |
| `preview` | 每个同仓库 PR 一个预览部署（`--preview-create`，beta；免费计划 5 天、Pro 14 天回收，计入部署数上限 40 / 300） | Vercel Preview | dev 实例 | **不设 key** | 只能 `stub`（`config.ts` 拒绝 preview 层的 `live`） | 部署后自动 seed（§15.4） | CI（预览 deploy key） |
| `prod` | 生产部署 | Vercel Production，自有域名 | prod 实例（必须自有域名，`*.vercel.app` 不被接受） | workspace `sfm-prod`，独立 key，月上限 $300（U5） | `live` | 真实数据；无 seed、无 reset | release 工作流（人工批准） |

- Clerk 两个实例（dev / prod）的 issuer 与用户 id 不同；`tokenIdentifier = <issuer>|<subject>` 按层各自不同。Clerk 只做认证（D24）；生产默认开放注册 + Clerk bot 防护，Invite-only 只作运营开关（techstack D22）。
- Anthropic 两个 workspace（dev / prod），各设 Console 花费上限，留至少 3 倍余量。preview 没有 key，所以预览环境不可能产生模型费用。
- **staging 扩展点**：触发条件为"出现外部用户、需要在上线前用真实模型演练排空与发布"，或多人并行验收。形态：同一 Convex 项目里 `npx convex deployment create staging --type prod` 的第二个部署（以 `--deployment staging` 选择），前端做成**单独的 Vercel 项目**（staging 即该项目的 production 目标，避开 `VERCEL_ENV=preview` + prod 型 deploy key 的中止陷阱）；不依赖 CLI 隐藏选项。
- 部署名形如 `tall-tiger-123`，由 `(await ctx.meta.getDeploymentMetadata()).name` 读取（返回 Promise）；元数据不含部署类型，所以 `DEPLOYMENT_TIER` 必填（testing-ops review C13）。

## 15.3 预览默认变量与配置自检

预览部署的环境变量来自项目级"预览类型默认值"，只对**新建**部署生效（testing-ops review r09、observability O2）：

```sh
npx convex env default set --type preview DEPLOYMENT_TIER preview
npx convex env default set --type preview AGENT_MODE stub
npx convex env default set --type preview AGENTS_ENABLED true       # 与 16 一致；preview 只能 stub，stub 不受此开关影响（D17）
npx convex env default set --type preview CLERK_JWT_ISSUER_DOMAIN https://<dev-instance>.clerk.accounts.dev
npx convex env default set --type preview E2E_CUSTOMER_SUBJECT user_<id>   # Clerk dev 实例测试用户 id，不是密钥
npx convex env default set --type preview E2E_PROVIDER_SUBJECT user_<id>
npx convex env default set --type preview E2E_FINANCE_SUBJECT user_<id>
# 刻意不设：ANTHROPIC_API_KEY、MODEL_FALLBACKS
```

- 改默认值后，已存在的预览部署不受影响；下一次 push 由 `--preview-create` 删除同名预览部署并重建，从而拿到新值。
- 缺 `CLERK_JWT_ISSUER_DOMAIN` 时推送失败（`auth.config.ts` fail closed）；缺 `DEPLOYMENT_TIER` 时 `assertTier` 拒绝，`--preview-run` 的 seed 失败——此时函数已推送、CLI 以 exit 1 结束，CI 判整个 job 失败，下一次 push 重建。
- Vercel 环境变量按作用域分值：Preview 作用域放 dev 实例的 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`、预览 deploy key、`NEXT_PUBLIC_DEPLOYMENT_TIER=preview`；Production 作用域放 prod 对应值与 prod deploy key。
- **配置自检**：`ops.configHealth`（12 §12.20）只返回变量名、枚举与布尔（`clerkIssuerConfigured`、`anthropicKeyConfigured`、`agentMode`、`agentsEnabled`、`modelFallbacks`、`draining`、`configValid`、`invalidFields`），CI 在每次部署后调用，`configValid === false` 即判失败。`convex/lib/config.ts` 的组合规则：`tier = preview ⇒ agentMode = stub`；`agentMode = live ⇒ anthropicKeyConfigured`；`tier ∈ {dev, preview, prod}` 必填；`MODEL_FALLBACKS` 缺省 `false`（D09）。`agents.runAttempt` 首次调用时同样校验，失败写 `opsLog("config_invalid", { field })`，attempt 进入 `error`，不尝试调用。
- 本地与 CI 的 `pnpm env:check`（dev-tooling `checkEnv`）只报告"存在 / 缺失 / 远端（Convex 侧，需 `npx convex env list` 由人查看）"，从不打印值；设置了且名字像密钥的 `NEXT_PUBLIC_*` 报暴露警告。`.env.example` 与 CI 设 `CLERK_TELEMETRY_DISABLED=1`、`NEXT_TELEMETRY_DISABLED=1`。
