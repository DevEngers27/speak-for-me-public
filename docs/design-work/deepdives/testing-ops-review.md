# 反驳评审：测试策略与运维（testing-ops）（part 1/3）

> 评审对象：deepdives/testing-ops.md 与 part2–part6、testing-ops/*.ts。
> 依据：00-brief §3 核心（最高优先）、inputs/04、本机 `/Users/zhennn/cal-hack-2026-main/node_modules`（convex 1.48.0、@clerk/backend 3.26.2），以及本机 npm 缓存里的 **convex-test 0.0.65 发布包**（`~/.npm/_cacache` 中的 `convex-test-0.0.65.tgz`，解到 scratchpad 只读，未执行；下称 `CT:`，路径相对 `package/`）。
> 同时对照 run-lifecycle 专题代码草图（`deepdives/run-lifecycle/*.ts`），因为 testing-ops 的 L1 用例直接依赖它的函数名和语义。
>
> 分片：本文件 = 结论 + 待验证声明逐条核对；part2 = 问题 r01–r09（testing-ops-review-part2.md）；part3 = 问题 r10–r20、简化建议、待验证表修订（testing-ops-review-part3.md）。
>
> 引用缩写：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`RL:` = `deepdives/run-lifecycle/`。

## 0. 总体结论

分层思路（L0–L4、并发证据只认真实部署、金丝雀 + 构造保证双管齐下、PR 闸门无密钥）方向正确，大部分 CLI 选项的源码引用也准确。问题集中在三处：

1. **与 10-agent-runtime（run-lifecycle）脱节**：testing-ops 假设的 `callModel` 单一接缝在 run-lifecycle 的 `runTurn` 里并不存在；`AGENT_MODE=stub` 的测试环境会让脚本化模型永远不被调用；STALE-01 的事件断言、调用上限的去向都与 run-lifecycle 的实际语义冲突。这些问题会让 L1 的 RUN / STALE / INJ 组在第一次运行时就红，或者更糟，"假绿"。
2. **convex-test 计时推进写法有误**：`finishAllScheduledFunctions(vi.runAllTimers)` 会把看门狗计时器一起触发并与回合 action 竞争；STALE-02 没有先推进计时器，回合根本不会启动。
3. **运维流程里有两个会在生产上出事的点**：排空（`AGENTS_ENABLED=false`）按 run-lifecycle 的 kill switch 语义会把所有在途多步 run 打成 `failed`；`npx convex logs` 永不退出，`log_scan` 会把 CI 挂到超时。

另有一个隐私方面的缺口：金丝雀扫描只能发现字面值，**发现不了由上限算出来的派生数值**（差额、余量），而这正是核心 1 最容易出事的地方。

## 1. 待验证声明逐条核对

结论：**真** = 本地源码或实测确认；**部分** = 部分确认、有附加条件；**假** = 与源码矛盾；**仍待验证** = 本地无证据。

| # | 声明 | 结论 | 证据 | 对设计的影响 |
| --- | --- | --- | --- | --- |
| C1 | convex-test 0.0.65 API：`convexTest(schema, modules)`、`t.withIdentity`、`finishInProgressScheduledFunctions` / `finishAllScheduledFunctions(vi.runAllTimers)`、`import.meta.glob`；需要 edge-runtime 与 `server.deps.inline` | **部分** | `CT:dist/index.d.ts`：`convexTest(schema?, modules?)` 与 `convexTest({ schema, modules, transactionLimits })` 两种签名；`withIdentity(identity: Partial<UserIdentity>)`（缺省字段自动生成）；`finishInProgressScheduledFunctions(): Promise<void>` 只**等待**已处于 inProgress 的函数，文档要求先用计时器推进；`finishAllScheduledFunctions(advanceTimers, maxIterations = 100)`。包内默认 glob 是 `import.meta.glob("../../../convex/**/*.*s")`（`CT:dist/index.js:1693`），这是 `server.deps.inline` 的原因。包内文件没有写 edge-runtime 要求，README 只链到官方文档 | 名称正确；用法见 r03、r14 |
| C2 | convex-test 串行执行，不模拟并发与 OCC | **真** | `CT:dist/index.js:2010-2033`：顶层事务用 `_waitOnCurrentFunction` 锁串行化；注释写明同一函数内 `Promise.all` 多个嵌套 `runMutation` **不**串行化；没有冲突检测或重试 | TD-2 成立 |
| C3 | `vi.mock` 能替换 convex-test 模块图里的 modelClient；被测函数能读 `process.env` | **仍待验证（可能成立）** | 函数模块通过 `import.meta.glob` 惰性 `import()` 加载，走 Vite 模块图，`vi.mock` 理论上生效；convex-test 自己用 `typeof process !== "undefined" && process.env…`（`CT:dist/index.js:1145`），说明作者考虑过某些环境没有 `process` | 前提是接缝存在（r01），而且测试真的走到 live 分支（r02） |
| C4 | convex-test 允许在 action 执行期间插入另一个 mutation | **真（源码推断）** | action 在事务锁之外运行（`actionFromPath` 注释 "An action runs outside any transaction"，`CT:dist/index.js:2407`）；从 action 的异步上下文里发起的 `t.mutation` 不在 `nestedTxStorage` 中，按顶层事务拿锁，而锁是空闲的 | §3.5 测法 2 可行，但调度推进写法要改（r03） |
| C5 | `npx convex run --identity`：issuer 缺省 `https://convex.test`，tokenIdentifier 缺省 `${issuer}\|${subject}` | **真** | `NM:convex/src/cli/lib/run.ts:143-163`（关键行 154-157）；subject 缺省是 identity JSON 的哈希 | — |
| C6 | `npx convex run` 以 admin 权限可调 internal 函数 | **真** | `parseFunctionName` 接受 `internal.` 前缀（`run.ts:191`）；CLI 用 `client.setAdminAuth(adminKey, identity)`（`run.ts:47`），而 `NM:convex/src/browser/http_client.ts:166-172` 的注释写明 admin auth "allow calling internal queries, mutations, and actions and acting as an identity" | V6 可关闭；它也给出了更简单的并发探针做法（r16） |
| C7 | action 内 `Promise.all` 多个 `ctx.runMutation` 并发提交、会触发 OCC；能用 insights 观测 | **部分** | "每次 `runMutation` 是独立写事务"为真（`NM:convex/src/server/registration.ts:355`）；真实平台上是否并行发出仍待验证。insights 能列出 `occRetried` / `occFailedPermanently`、`occCalls`、`occ_retry_count`（`NM:convex/src/cli/insights.ts:12-60`），但**只接受用户登录**，拒绝 deploy key 和 project key（同文件 129-137），本地部署也没有 insights，数据是 72 小时聚合 | CI 拿不到 `occRetriesObserved`（r08） |
| C8 | `npx convex logs` 支持 `--history [n]` 与 `--jsonl` | **真，但有陷阱** | `NM:convex/src/cli/lib/command.ts:577-598`；`lib/logs.ts:62-147` 的 `watchLogs` 是 `for (;;)` 轮询，`--history` 只决定第一批回放多少条，**命令永不退出**；回放范围只是服务端当前缓冲（"all available logs"） | `log_scan` 会挂住 CI（r07） |
| C9 | `npx convex deploy` 的 `--cmd` / `--cmd-url-env-var-name` / `--preview-create` / `--preview-name` / `--preview-run` | **真，并补充语义** | `NM:convex/src/cli/deploy.ts`：`runCommand`（`--cmd`）在 `runPush` **之前**执行（约 332-370 行）；`--preview-run` 只在 `data.isNewDeployment` 时、推送**之后**、以 `"{}"` 参数且不带身份执行（372-385 行）；它失败时 CLI 以 exit 1 结束，但函数已经推送，不会回滚；`--preview-create` 会删掉同名预览部署再重建 | r09、r17 |
| C10 | `deployment create --type dev\|prod\|preview`；staging 的 key 与用量上限是否与 prod 隔离 | **部分** | `NM:convex/src/cli/deploymentCreate.ts:46-81`：类型三选一，另有 `--expiration`（可做短命部署）；创建需要个人访问令牌或 project key，**不接受**部署 key（约 93-97 行）。用量上限按部署配置（`lib/usageLimits.ts` 通过该部署的 URL 与 admin key 调用），所以可以单独设；账单仍是团队级 | 推荐"另建项目"可以降级为可选（见 part3） |
| C11 | usage-limits 的指标、窗口、类型，`disable` 暂停部署 | **真** | `NM:convex/src/cli/lib/usageLimits.ts:15-40`；`usageLimits.ts:125-128` 原文 "`disable` pauses the deployment when exceeded" | — |
| C12 | 存在本地部署，且能在 Linux CI runner 上免登录启动 | **部分** | `deployment select local`、`deployment create local`（`deploymentSelect.ts:45`、`deploymentCreate.ts` 的本地分支）；`dev --local` 是隐藏且已弃用的选项（`dev.ts:176,202`）；匿名模式 `CONVEX_AGENT_MODE=anonymous`（`lib/localDeployment/anonymous.ts:65,316`）；有 Linux 二进制（`download.ts:33-35,263`），首次运行要从网络下载 | 退路可行，需要实测一次 |
| C13 | `ctx.meta.getDeploymentMetadata()` 含部署名 | **真** | `NM:convex/src/server/meta.ts:82-98`：`{ name, region, class }`，`name` 形如 `tall-tiger-123`；**不含**部署类型（所以 `DEPLOYMENT_TIER` 仍然需要）；convex-test 返回 `name: "test"`（`CT:dist/index.js:1355-1360`） | `confirmDeployment` 不再需要解析 `CONVEX_CLOUD_URL` 的退路 |
| C14 | `env set` 修改 `AGENTS_ENABLED` 后何时生效 | **仍待验证** | 本地无证据 | 排空不应依赖它（r06） |
| C15 | `convex deploy` 出来的部署隐藏非 ConvexError 消息（F15.3） | **仍待验证，表述需修正** | 本地 CLI 源码里没有脱敏逻辑；按平台常识，脱敏取决于**部署类型**（prod），与用不用 `deploy` 命令无关；preview 类型是否脱敏未知 | 改写为"prod 类型部署"；E2E 不要断言错误原文 |
| C16 | Clerk 有 Playwright 官方测试支持 | **部分** | `@clerk/backend` 3.26.2 有 `TestingTokenAPI.createTestingToken()`（`NM:.pnpm/@clerk+backend@3.26.2…/dist/api/endpoints/TestingTokenApi.d.ts`），需要 secret key；`@clerk/testing` 辅助包本地未安装，包名与用法仍待验证 | pr-e2e 的密钥清单要补（r10） |
| C17 | Convex log streams 在当前计划可用 | **仍待验证** | 本地无证据 | — |
| C18 | Node 24 运行 `.ts` 是否需要 `--experimental-strip-types` | **真：不需要** | 本机 Node v24.21.0 实测：带类型注解的 `.ts` 直接运行；`enum` 报错；不带扩展名的相对导入报 `ERR_MODULE_NOT_FOUND` | 去掉该标志；限制见 r20 |
| C19 | Opus 5.5 回合 p50 / p95 | **仍待验证** | — | 看门狗期限并不由它直接决定（r18） |
| C20 | `purgeSimulatedRooms` 单事务可删文档数上限 | **部分** | convex-test 内置的"默认 Convex 限额"：`documentsWritten 16_000`、`documentsRead 32_000`、`bytesRead/bytesWritten 16 MiB`、`databaseQueries 4_096`、`functionsScheduled 1_000`（`CT:dist/transactionMetrics.js:10-18`），用 `transactionLimits: true` 开启；生产数值以 Convex 文档为准 | 可以在 L1 断言分批大小（r11） |
