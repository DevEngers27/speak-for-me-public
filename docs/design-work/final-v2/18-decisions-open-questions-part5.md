# 18 · 决策记录（part5）：ADR-D16…D21

> 分片见 `18-decisions-open-questions.md` 顶部。

## ADR-D16 日志与错误消息下发浏览器的纪律；reasonCode 命名

- **背景**：privacy-disclosure review r02：query / mutation 的 `console.*` 输出会作为 `logLines` 随响应发给调用者浏览器，失败时 `errorMessage` 也下发（dev 部署已实证，prod 待验证）；r10：返回值校验失败的消息可能回显被拦字段；SDK `APIError.message` 可能回显请求；techstack X4；冲突 C22（大写下划线 vs 点分小写）。
- **选项**：透传错误 message；把 `returns` validator 当运行时防线；浏览器只收 `ConvexError({ code, params })` 且 `params` 按受众投影、公共函数禁 `console.*`、统一 `withSanitizedErrors`；reasonCode 大写下划线 vs 点分小写按域分组。
- **决定**：后者。`ConvexError.message` 等于 data 的序列化，所以 data 本身就是纪律边界；非 `ConvexError` 异常 → `opsLog('unhandled', { errorClass, code })` + 抛 `ConvexError({ code: 'internal' })`；服务端日志用字段白名单 `opsLog(code, SafeLogFields)`；模型原文只存 `attempts.rawOutputRef`（内部表，无 query 暴露）；解析失败只记 issue 路径（未知段替换为 `*`）；SDK 错误映射为错误码后丢弃原消息。reasonCode 单一来源 `core/engine/reasonCodes.ts`，Convex validator 与 Zod enum 由同一数组派生；`params` 未标注受众的一律丢弃（fail-closed）；provider 永不收到 `overByCents` / `headroomCents` / `deadline`；06 给出旧码 → 新码对照表。
- **被否决**：透传 message；`returns` 作为运行时防线（只作测试期探测器）；大写下划线码（**C22**）。canon 包修订（2026-10-24）另否决为"无可撤回"、非法 `reasonKey`、场景未注册、美元上限另设新码（**C56**：分别为 `unchanged`、`input.invalid`、`run.invalid_state{ guard: 'scenario_version' }`、`run.call_limit` + `questionKey`，§1.5 补录 API 层码）。
- **后果**：正面——日志、错误、WebSocket 负载三条旁路被统一纪律覆盖；错误码与界面文案一一映射（13 §13.12）。代价——排障依赖 `opsLog` 与内部 `attempts`。关闭评委反例：FF-42 中的错误码 / 返回形状不一致；结构性关闭 privacy review r02 / r10 指出的泄露通道。待验证：§18.5 V-R01（`logLines` 在 prod 是否下发）、V-R02（返回值校验失败的消息内容）、spikes §8 #4（生产错误格式）。

## ADR-D17 调用上限与排空开关分离

- **背景**：旧 canon 的每房间累计 `modelCallBudget`、run-lifecycle 的 `usageCounters` 全局日计数、techstack X2 指出三份文档合起来 8 层上限 3 个真相源；评委：callLimit 存在 run 上、每新 run 归零（FF-24）；run 数上限把约束记录绑死（FF-24）；被阻断计数随抛错回滚（FF-26）；testing-ops review r06：用 `AGENTS_ENABLED=false` 排空会把在途多步 run 全打成 failed。
- **选项**：每房间累计上限；每 run 计数；X2 四层落点；排空用 `AGENTS_ENABLED` vs 独立布尔。
- **决定**：四层——每用户每房间每小时节流（D12 ⑥，零依赖索引计数，公开 mutation 抛 `run.rate_limited`）；每 run attempt 上限 `runs.maxAttempts`（默认 `maxRounds × 3 × 2`）；每 run 美元预留 / 结算（`runs.reservedMicroUsd`，调度前预留、提交时结算，超限不调度下一 attempt、转 `needs_input`）；全局日美元 `spendCounters(global, day)`（被调度路径不 throw：返回 `deferred` 并 `runAfter` 到次日）；Anthropic Console 花费上限兜底。`opsFlags.draining` 独立：置位后 `turns.beginAttempt` 返回 `run.draining`、`runs.start` 拒绝，在途 attempt 照常提交，等 `activeAttemptCount === 0` 再部署；`AGENTS_ENABLED` 只作紧急止血（attempt `error(agents_disabled)`）。stub 模式不受两者影响。
- **被否决**：callLimit 存于 runs 且无用户节流（**C33**）；8 层上限、3 个真相源；用 `AGENTS_ENABLED=false` 排空（**C34**）。canon 包修订（2026-10-24）另否决排空时系统路径也拒绝建 run（**C52**）；`ops.setDraining` 只在 dev（**C53**：发布排空需要 prod）；每回合自动重试 3 次（**C55**：每链至多 1 次自动重试，`MAX_ATTEMPTS_PER_TURN = 2`）。
- **后果**：正面——成本滥用需要穿过用户节流，且没有任何上限会挡住约束记录本身（节流按人计，他人刷不满 finance 的额度）。代价——全局日计数行在大规模下可能成为 OCC 热点（出现争用再改）。关闭评委反例：FF-24、FF-26（v1 无人工提案入口；节流按已提交写入计数，失败的调用本身不改变状态）。待验证：`npx convex env set` 后何时生效（testing V12，排空不依赖它）、按部署配置的用量上限（V18）。

## ADR-D18 seed / reset 走生产写入口

- **背景**：spike B1：索引不唯一，`t.run` 插入重复审批后入口里的 `.unique()` 抛错、该键从此失败关闭，所以 seed / 迁移不能绕过入口；testing-ops TD-8；fixtures-walkthrough D8 / D9；核心 8；评委：执行产物无数据级模拟标注（FF-41）。
- **选项**：直接写表；seed 中间状态（"已批准的 v1"）；seed 复用与用户相同的入口逻辑，只写输入链。
- **决定**：后者：`seed.fromFixture` 是 internal mutation（dev / preview / test，`assertTier`），在一个事务内以 fixture 角色身份作 actor，复用与公开 mutation 相同的入口逻辑与事务 helper，依次 `rooms.create → invites.create + invites.accept → ledger.recordBaseline → catalog.confirm → briefs.confirm ×3`；缺省时最后一项就绪条件满足即按生产路径 `openIfReady` 开首个 run（stub 推进），`stopBeforeRole` 留一方不确认、停在 `setup`；seed 自身永不写提案 / 审批 / 执行（canon D18 修订措辞；真实部署探针另用 `npx convex run --identity` 调公开函数）；全部行 `provenance: 'seeded'`，stub 代理产物 `provenance: 'stub'`，界面统一徽章。`seed.reset` 为 dev / preview-only internal mutation，入口 `assertTier` 读 `DEPLOYMENT_TIER` 与 `(await ctx.meta.getDeploymentMetadata()).name`，只删 `provenance !== 'live'` 的房间；prod 无 reset；归档（`rooms.close`）是 `setup` / `open` 房间唯一的"清理"（`executed` 房间保持只读）；只追加表的唯一例外是运维人工发起的 `privacy.redact`（只覆写 `REDACTABLE_FIELDS`、不删行，ADR-X04）。禁止 `t.run` / 直接 insert 绕过唯一写入口。
- **被否决**：直接写表；seed 中间状态；fixture 用 seed 伪造 `below_committed`（不可达状态，裁决见 ADR-D23 / C32）。
- **后果**：正面——fixture 永远满足全部不变量；数据级标注贯穿所有派生行。代价——要得到"v2 待批"这类阶段必须在 stub 模式真实跑一遍。关闭评委反例：FF-41。待验证：`npx convex run --identity` 的身份伪造（fixtures review）、preview 部署的默认环境变量（testing V20）。

## ADR-D19 前端默认首页与决策页模板

- **背景**：四个 UI 原型评审（决策收件箱 47.5 / 三栏工作台 46 / 时间线叙事 45.5 / 账本对比 45）；frontend-ia D-FE-01…12 与 review r01–r13；techstack D23。
- **选项**：以时间线为首页；按角色分路由；`previewChange` 对所有角色求值；`isExecutable` 兼指"检查通过"。
- **决定**：默认首页 `/rooms` 决策收件箱四分区；房间页三栏 + 常驻 `Proposal vN · Constraints vM · Viewing as X`；决策页统一模板（问题标题、版本绑定副标题、差异、按角色裁剪的确定性检查、虚线 agent-box、实线 human-box、版本绑定按钮、最后一票提示、stale 横幅、`SimulatedBadge`、旧审批 "No longer applies"）；影响预览只用 `rooms.view` 已有数据，`verdictAfter` 只对 finance；不做乐观更新；查询在 `isAuthenticated` 前 `skip`；错误边界在 layout 之上并用 `retry()`；运维不进产品路由，`/setup` 独立根布局；`proxy.ts` 对 `/rooms(.*)` 调 `auth.protect()`、`(app)` 布局兜底，唯一的 Route Handler 是不含业务数据的 `/api/health`（自行 `auth()`、未登录返回 401，11 §11.10、13 FE-D14）；`passesChecks` 与 `allApproved` 分开命名，`isExecutable` 按 canon §1.3 是当前性 ∧ `passesChecks`（细节见 13）。
- **被否决**：时间线首页（回答"怎么来的"而非"该我做什么"）；角色路由；`previewChange` 对所有角色求值（预言机）；`isExecutable` 兼指检查通过（与 08 定义冲突）。
- **后果**：正面——原型评审指出的泄露（HR-2 选项对非目标人可见、Fits / Over 推断）与死路（取舍无"都不要"出口）在 IA 层被关闭。代价——聚合 `rooms.view` 在任何房间写入后都对全部订阅者重算（15 加 query 耗时指标）。关闭评委反例：FF-01 中的预览分支（与 D12 ②）。待验证：Clerk Playwright 多测试用户（V-R13）、断线检测时延（V-R15）。

## ADR-D20 依赖版本与冷却策略

- **背景**：spikes B10 实测可装可建的组合；techstack X1 指出三份备忘录各写一套冷却期；冲突 C18（ESLint 9 vs 10；Vitest 5.0.5 vs 4.1.11）。
- **选项**：techstack D06 的 ESLint 10 与 X6 的 Vitest 4.1.11；冷却 20160 vs 10080；带组件的 codegen。
- **决定**：基线 `next 16.4.3` / `react 19.3.1` / `convex 1.48.0` / `@clerk/nextjs 7.9.20` / `typescript 6.0.3` / `eslint 9.39.5` / `vitest 5.0.5` / `vite 8.3.5` / `zod 4.6.7` / `convex-test 0.0.65` / `@anthropic-ai/sdk 1.1.0` / `pnpm 11.25.0`；`@edge-runtime/vm` 作 devDependency（风险：23 个月未发版）。直接依赖精确锁定并经根 `catalog:` 统一；`minimumReleaseAge: 10080`，例外清单由脚本从 lockfile 生成、带到期日，CI 检查；`allowBuilds` 只放行 `esbuild`、`unrs-resolver`（`@swc/core`、`@parcel/watcher` 显式 false）。ESLint 10 作独立 PR（U10）。`_generated` 提交 + CI `convex codegen --system-udfs --typecheck disable` 漂移检查（无组件故可离线，与 D01 联动）；`convex/tsconfig.json` 加 `"types": ["node"]`；convex-test 模块 glob `['./**/*.*s', '!./**/*.*.*s']`。SDK 升级到 1.3.x 前重跑 PROBE / 结构化输出 / 参数 400 用例。
- **被否决**：两套冷却期；带组件的 codegen；直接上 ESLint 10；Vitest 4.1.11（**C18**）。
- **后果**：正面——可复现安装与离线 codegen。代价——新发版本需进例外清单。待验证：spikes §8 #18（GitHub CI 实跑）、#7（zod 进入 Convex 包的体积与冷启动）、techstack O10（SDK 1.3.x 升级时点）。

## ADR-D21 仓库布局：单包 + lint 分层

- **背景**：techstack D04 推荐四包 workspace；skeleton spike 实测单包布局可建、`no-restricted-imports` 能拦截跨层导入；Convex 打包 `convex/` 以外的相对导入未实测（spikes §8 #8）；冲突 C19；评委：引擎表写死场景字段，边界名不副实（FF-32）。
- **选项**：四包立即落地；单包 `core/engine ← core/scenarios/scope-change ← convex ← src`；dependency-cruiser + ESLint 双工具；6 个 UI 槽位 + 描述符驱动表单。
- **决定**：单包。`core/engine/`（零依赖纯 TS：规则、金额、日期、strictSchema、投影、模板、reasonCodes）← `core/scenarios/scope-change/`（纯函数插件）← `convex/`（schema、函数、`lib/functions.ts` 构造器 `userQuery / userMutation / memberQuery / memberMutation / anonQuery` + internal，内置鉴权与 `withSanitizedErrors`）← `src/`。依赖方向由 `no-restricted-imports` + `@core/*` 别名强制；引擎纯度规则禁 `Date` / `Intl` / `Math.random` / `fetch` / `convex/*` / `zod`；UI 槽位 v1 只有 `proposalTermsCard`。拆四包的触发条件：第二个场景落地或出现包内违规（17 E6）。
- **被否决**：四包立即落地（**C19**）；双工具；6 个 UI 槽位。
- **后果**：正面——spike 已验证；授权经自定义构造器而非 RLS（research ADR 候选 ⑦）。代价——边界靠 lint 而非包图。关闭评委反例：FF-32 部分关闭（v1 一个场景；17 §17.3 R6 记录残余）。待验证：spikes §8 #8（真实 codegen 与手写 `_generated` 一致；场景目录在 `convex/` 外，连字符模块路径问题不出现）。
