# 反驳评审：测试策略与运维（part 3/3）

> 问题 r10–r20、过度设计与简化、待验证表修订。

## r10 [medium] pr-e2e 的密钥清单不完整
- **问题**：Next 服务端在 CI 里运行，需要 Clerk dev 实例的 `CLERK_SECRET_KEY` 与 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`。Clerk 测试 token 由 Backend API 生成，同样需要 secret key。表 4.5 的 pr-e2e 只列了"preview deploy key、E2E 账号"。
- **证据**：`TestingTokenAPI.createTestingToken()`（@clerk/backend 3.26.2）；part5 §4.5。
- **修复**：pr-e2e 的密钥写全：preview deploy key、Clerk dev 实例 secret key 与 publishable key、E2E 账号凭据，并放在受保护的 environment 中。登录优先用测试 token + 测试邮箱验证码（具体机制待验证），少用密码。

## r11 [medium] 对 convex-test 能力的描述过时：它能执行事务限额，也能读部署元数据
- **问题**：§3.6 与 inputs/04 §1.12 写"convex-test 不模拟限额"。0.0.65 支持 `convexTest({ schema, modules, transactionLimits: true })`，按默认 Convex 限额执行。`ctx.meta.getTransactionMetrics()` 返回每项的 `used` / `remaining`，只能在 query / mutation 中调用（action 中调用会抛错，真实类型同样只挂在 `QueryMeta` / `MutationMeta` 上）。`getDeploymentMetadata()` 返回 `{ name: "test" }`。
- **证据**：`CT:dist/index.d.ts`（`transactionLimits` 注释："true or {}: enforce default Convex limits"）；`CT:dist/transactionMetrics.js:10-18`；`CT:dist/index.js:1324-1360`；`NM:convex/src/server/meta.ts:141-226`。
- **修复**：L1 增加 LIM 组：在 `transactionLimits: true` 下，用最大规模 fixture（最多范围项 × 最多任务模板）跑执行 mutation 与 `purgeSimulatedRooms` 的单批，断言不超限，并用 `getTransactionMetrics().documentsWritten.used` 给分批大小留 10 倍余量。`confirmDeployment` 的 L1 用例用 `"test"` 作为部署名。L2 的 `limits_probe` 只做生产数值的抽样确认。注意 convex-test 的默认值不一定等于生产值，以文档为准（仍待验证）。

## r12 [high] 金丝雀扫描发现不了算术派生的泄露（核心 1）
- **问题**：扫描器只匹配金丝雀的字面形态。provider 视图如果出现 `overByCents`、余量、"超出预算 X%"，或者对 provider 报价返回"刚好超/不超"这类信号，provider 就能用自己已知的报价反推 finance 上限。`481731` 的派生值（`cap − committedCents`、`offerTotal − cap`、`cap − 每个可行组合总价`）全部不会被命中。X4 只保证金丝雀不与合法值相撞，不覆盖派生值。
- **证据**：`testing-ops/canary-scan.ts` 的 `canaryNeedles`；part4 §3.8；核心 1 "任何对他方可见的内容都经过显式的披露决定"。
- **修复**：(1) `canaryNeedles` 增加 `derived`：由 fixture 计算上面三类派生值（含百分比的两位小数形态），扫描时与字面金丝雀同等对待。(2) L1 DISC 组增加断言：provider 视图中 `reasonCode` 的载荷只有码，没有差额字段，载荷字段集合同样从 07 的矩阵导入。(3) X4 的自检同时检查派生值与目录价、合法和不相撞，避免误报。

## r13 [low] 数值针脚会在时间戳与 ID 中误报
- **问题**：`content.includes("481731")` 会命中 `_creationTime`（形如 `1792840481731.5`）、`commitTs` 等长数字的子串。WebSocket 帧和导出快照里有成千上万个时间戳，存在偶发误报，扫描会变得不稳定。
- **修复**：数值针脚按数字边界匹配，例如 `new RegExp("(?<![0-9.])" + needle + "(?![0-9])")`。扫描前剔除 `_creationTime`、`commitTs`、`_id` 键的值。日期金丝雀也加进 X4 自检（不得等于任何公开日期）。

## r14 [medium] Vitest / convex-test 配置细节会让 PR 闸门起不来
- **问题**：(1) `environment: "edge-runtime"` 需要 devDependency `@edge-runtime/vm`，文档没有列。(2) `setup.ts` 放在 `convex/test/`，用 `import.meta.glob("../**/*.ts")`。它能工作（convex-test 用 `_generated` 的路径前缀定位根，`CT:dist/index.js:1707-1719`），但会把 `*.test.ts`、`test/*`、`_generated/*.d.ts` 都放进模块表，偏离官方写法。(3) convex-test 在找不到 `_generated` 时直接抛错。TD-1 承诺"`pnpm test` 不需要部署、不需要密钥"，这要求 `convex/_generated` 已提交进仓库，或者能离线 codegen（inputs/04 待验证）。
- **修复**：把 `convex/test.setup.ts` 放在 convex 根目录，用官方写法 `import.meta.glob("./**/*.*s")`，或者直接不传 modules，使用包内默认 glob，此时必须配 `server.deps.inline`。在 11 中决定提交 `convex/_generated`，CI 增加"codegen 后无 diff"检查。依赖清单补 `@edge-runtime/vm`。`test.projects` 与 `server.deps.inline` 在所装 Vitest 版本中的位置仍待验证。

## r15 [low] "action 内 runMutation 不携带被模拟用户的身份"的表述可能不准确
- **问题**：convex-test 中，同一组件内 action 的身份会传给 `runQuery` / `runMutation`（`withAuth` 只在跨组件时清空身份，`CT:dist/index.js:2210-2216`）。真实平台的行为仍待验证。不过结论仍然成立：一个 action 只能带一个身份，多身份并发必须显式代入。
- **修复**：改写理由。按 r16 的做法，这个问题可以整体绕开。

## r16 [medium] 过度设计：并发探针方法 (b) 可以被更简单、更真实的做法取代
- **问题**：`devProbe.parallel` + `devProbe.asIdentity`（按字符串 `fn` 分发）+ "所有公开 mutation 必须写成薄壳 + handler"，是为测试引入的横切架构约束，外加一个需要长期维护分发表的通用冒充 RPC。它绕过了公开函数的真实鉴权路径，而 L2 恰恰应该测这条路径。
- **证据**：CLI 自身的做法是 `ConvexHttpClient` + `setAdminAuth(adminKey, actingAsIdentity)`（`run.ts:41-47`；`http_client.ts:166-182`）。
- **修复**：探针脚本在**一个 Node 进程**里创建 N 个 `ConvexHttpClient`，每个以 admin key + 不同的 acting identity 调用**公开** `api.approvals.decide`，用 `Promise.all` 发出。重叠窗口比并行 CLI 紧得多（没有冷启动），走真实的公开函数与鉴权，也不需要 `devProbe.parallel` / `asIdentity`。`setAdminAuth` 标为 `@internal`，需要类型断言，跨版本稳定性待验证；退路仍是并行 CLI。探针的结构化准备工作（`setupPendingApproval`、`executionCounts`）保留为受 `assertTier` 守护的 internal 函数。"两法都过才算通过"改为"一个紧重叠方法（r08 的 `maxOverlap >= 2`）+ UI 双击"。12 不必为测试强制"薄壳"写法，它可以作为普通的代码组织建议存在。

## r17 [low] `--cmd` 不保证"前后端同一次发布"
- **问题**：`deploy.ts` 中 `runCommand`（`--cmd`）在 `runPush` 之前执行，它只保证构建时注入正确的 URL；托管平台的发布是另一步。如果推送失败，构建产物已经存在，但不会被发布，CI 失败即可。
- **修复**：改写 §4.1 的措辞。发布顺序写成：先推送向后兼容的后端，再发布前端；回滚顺序相反。

## r18 [low] "Opus p95 决定看门狗期限"与 10 冲突
- **问题**：看门狗期限由 `TURN_BUDGET` 推导：`WATCHDOG_DELAY_MS = appRetryDelayMs + ACTION_WALL_MAX_MS + watchdogSlackMs`（`RL:budget.ts:37-46`）。L4 实测只应该校准 `sdkTimeoutMs` 与 `turnMaxTokens`，看门狗随之推导。F10.6 的 p95 ≤ 8 s 只是体验目标，不进入任何守卫。
- **修复**：V17 的"依赖它的设计"改为 `TURN_BUDGET.sdkTimeoutMs`。L4 报告给出"p99 + 余量 ≤ sdkTimeoutMs"是否成立。

## r19 [low] 错误脱敏、staging 隔离的措辞
- **问题**：(1) F15.3 的脱敏取决于部署类型，与用不用 `convex deploy` 命令无关；preview 类型是否脱敏未知。(2) 用量上限本来就是按部署配置的（C10），"另建项目以隔离用量上限"的理由不成立，只剩"隔离部署 key 与团队成员权限"这一条。
- **修复**：措辞改为"prod 类型部署"。E2E 不断言错误原文，只断言 `code`。staging 同项目或另建项目都可以：同项目更简单，`--prod` 只指向默认生产部署，staging 用 `--deployment staging` 选择（`lib/command.ts:215-225`）。

## r20 [low] Node 24 直跑 `.ts` 的限制
- **问题**：不需要 `--experimental-strip-types`（C18），但有这些限制：相对导入必须带 `.ts` 扩展名；不支持 `enum`、`namespace`、参数属性；不读 tsconfig 的 `paths`；不处理 node_modules 下的 `.ts`。探针如果导入工作区包（例如 `@sfm/scenario-scope-change` 的 fixture）或用路径别名，就会失败。
- **修复**：`scripts/` 统一用 `tsx`（锁版本），或者规定脚本只用相对导入且带 `.ts` 后缀。§3.1 删掉该标志的描述。

## 简化建议汇总（反过度设计）

| 项 | 现状 | 建议 |
| --- | --- | --- |
| 并发证据 | 并行 CLI + action 内 `Promise.all` + UI 双击，前两者都要通过 | 单进程多 `ConvexHttpClient`（r16）+ 重叠度证明（r08）+ UI 双击 |
| `devProbe.asIdentity` 与"薄壳"约束 | 为测试改变 12 的写法 | 删除 |
| 排空 | 复用 kill switch | 独立的 `opsFlags.draining`（r06） |
| 季度变异检查 | 手动、无载体 | 保留，但只针对三条守卫（执行键、`decide` 状态守卫、回合 G1–G3），写成可一键运行的脚本，否则会流于形式 |
| L4 每路径 ≥ 10 次 | 每周 | 只在改提示、schema、模型或 effort 时跑；每周跑一次 `runtime_smoke` 即可 |

## 建议修订的待验证表（替换 part6 §8 对应行）

| # | 修订 |
| --- | --- |
| V1 | 已基本确认（C1）；剩 edge-runtime 依赖与 `test.projects` / `server.deps.inline` 位置待验证 |
| V2 | 已确认（C2） |
| V5 | 源码推断可行（C4），保留一次最小实验 |
| V6 | 已确认（C6） |
| V8 | 改为"CI 不可得，只能人工"（C7、r08） |
| V9 | `--preview-run` 语义已确认（C9）；剩"当前计划是否可用"与回收策略 |
| V11 | 已确认：`name` 字段（C13）；删除 `CONVEX_CLOUD_URL` 退路 |
| V12 | 不再阻塞设计（r06 改用数据库标志） |
| V13 | 用 convex-test `transactionLimits: true` 在 L1 验证（r11） |
| V16 | 已确认：不需要标志（C18），改用 tsx 的理由见 r20 |
| V17 | 依赖项改为 `sdkTimeoutMs`（r18） |
| V18 | 用量上限按部署配置（C10）；剩 key 与成员权限隔离 |
| 新增 V19 | `ConvexHttpClient.setAdminAuth` 与 deploy key 取得 admin key 的方式（r16） |
| 新增 V20 | 预览类型默认环境变量的设置方式与生效时机（r09） |
| 新增 V21 | 真实平台上 action 内 `runQuery` / `runMutation` 是否继承调用者身份（r15） |
