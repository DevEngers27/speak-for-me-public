# 反驳评审：可观测性与运维（part 2/2）

> 接 observability-ops-review.md（§0 结论、§1 逐条核对）。本文件为 §2 问题详述、§3 主动检查。

## 2. 问题详述与修改建议

### r01（high）Sentry 隐私配置不全
- 证据：`@sentry/core@11.6.0` 的 `DEFAULTS` 为 `httpHeaders: { request: true, response: true }`、`databaseQueryData: true`、`graphQL: { document: true, variables: true }`、`queues: true`、`frameContextLines: 5`；`resolveDataCollectionOptions` 对每个键做 `dc.x ?? DEFAULTS.x`，**没写的键就按默认全开**。备忘录 part2 O4 只写了 `userInfo/cookies/httpBodies/urlQueryParams/stackFrameVariables/genAI`。类型注释写明 `true` 时"Sensitive values like keys and tokens are always filtered out"，但 Referer、`x-*` 自定义头、Server Action 的请求头等仍会外传。
- 修改：把每个键都写全，即 `httpHeaders: false, databaseQueryData: false, graphQL: { document: false, variables: false }, queues: false`（`frameContextLines` 可保留，源码不是私密数据）。在 V8 增加一条门禁：用 `satisfies Required<DataCollection>` 写配置，以后 SDK 新增类别时类型检查会报缺键。

### r02（high）异常消息与堆栈是未被封住的外传通道
- 证据：log-streams 文档说 `error_message` "contains the error and any stack trace"，exception reporting 会把同一个异常发到 Sentry。本机 Node 24 实测 `JSON.parse("CANARY budget 48000 not json")` 抛出 `Unexpected token 'C', "CANARY bud"... is not valid JSON`，即 V8 会把输入的前若干字符写进消息。模型返回非法 JSON、Anthropic SDK 的 `APIError` 消息、Zod 自定义消息，都可能把模型原文或数值带进日志。备忘录只约束"我们自己抛的错误用 `ConvexError({ code })`"，统一错误包装器只出现在没有 Pro 时的降级方案 R1。
- 修改：在所有 action 和 mutation 的入口处强制套一层 `withSanitizedErrors`（不论是否买 Pro）：捕获非 `ConvexError` 的异常，只输出 `opsLog("unhandled", { errorClass, code })`，再抛出 `ConvexError({ code: "internal" })`；解析模型输出时自己 try/catch，不让原始的 `SyntaxError` 往上冒。V6 和 V7 增加一条"模型返回以金丝雀开头的非法 JSON"的用例。

### r03（medium）示例配置在 v11 下有错
- 证据：迁移指南写 "The `enableLogs` and `enableMetrics` options were removed"；`@sentry/core@11.6.0` options.d.ts 的顶层键里没有 `enableLogs`，对象字面量会触发多余属性报错。console 面包屑改由默认的 `consoleIntegration` 产生。options.d.ts:220-231 写明要关闭追踪，应让 `tracesSampleRate` 与 `tracesSampler` 都保持 `undefined`，设成 0 并不等于关闭。
- 修改：删掉 `enableLogs`、`tracesSampleRate`；用 `integrations: (d) => d.filter((i) => i.name !== "Console")` 关掉 console 采集，`beforeBreadcrumb` 留作兜底。

### r04（medium）staging 走 Vercel 自定义环境会被 Convex CLI 拒绝
- 证据：Vercel 系统变量文档写明 `VERCEL_ENV` 只取 production/preview/development 三个值，自定义环境的名字在 `VERCEL_TARGET_ENV` 里，所以自定义环境下 `VERCEL_ENV` 为 preview。NM/convex/src/cli/deploy.ts:140-157：只要 `isNonProdBuildEnvironment()` 为真，而 deploy key 指向 `deploymentType === "prod"` 的部署，CLI 就会以 "Detected a non-production build environment…" 中止发布。`sfm-staging` 的生产型部署正属于这种情况。绕过方式 `--check-build-environment disable` 在 CLI 里是隐藏选项（deploy.ts:83-88）。
- 修改：O2 表里不要留"自定义环境或单独项目：待验证"。要么让 staging 成为单独的 Vercel 项目（staging 即该项目的 production 目标），要么采纳 r05、v1 不设 staging。

### r05（medium）过度设计：v1 环境层级
- 任务书第 6 节要求"两个方案都完整时选简单的"。deploy key 本来就是按部署发的（`deployment token create --deployment`），`usage-limits` 按部署设置，log streams 与 exception reporting 也是按部署在 dashboard 配置。staging 单独建 Convex 项目，带来的隔离增量很小，却多出一个项目、一套集成、一套 Clerk/Anthropic 配置和一个发布路径（还会触发 r04）。
- 修改：v1 只设三层 `dev` / `preview`（强制 stub）/ `prod`；需要用真实模型冒烟时，用 preview 加一把限额很低的 key 临时开启，或在同一项目里 `deployment create --type prod` 建第二个部署。staging 列为扩展点，触发条件是"有外部用户、需要上线前演练排空流程"。

### r06–r10（low）
- r06：part1 §1.2、§2 和 part2 §5 里的"约 1000 次"改为"有限数量，维护时可能随时清除（docs.convex.dev/functions/debugging）"，S9 的社区帖降为背景资料。
- r07：S13 改引 vercel.com/pricing（$20/Developer seat，含 $20 额度）；O7 表里"仅 Clerk Admin 角色可操作"要么补上 changelog 的 URL，要么删掉。
- r08：O5 与 V15 补充三点：Admin key "not available for individual accounts"，需要 Anthropic 组织；`cost_report` 不含 Priority Tier，且只能 `group_by` workspace，不能按 key 过滤；CI 对账可以用 `org:admin` 联合身份规则（admin-api.md:30），不必在 CI 里存长期 Admin key。
- r09：S1 的主题清单补全；关闭"是否含参数"的待验证项；V6 把 `error_message` 列为必扫字段。
- r10：§2 增加一个候选："v1 不接 log streams，只用 Sentry、自有表和看门狗 cron（把调度延迟和失效率写进 `opsLog`，超阈值时 `captureMessage`）"。它能少一个数据处理方和一套告警规则，缺点是没有平台级函数耗时与 OCC 指标。是否采用由 15-operations 决定，但应作为被比较过的选项列出。

## 3. 主动检查

- **兼容性**：`@sentry/nextjs` 11.6.0 的 peer 覆盖 Next 16.4.3（NM/next/package.json），`@sentry/react` 覆盖 React 19.x，engines 覆盖 Node 24；推荐方案与 Convex 1.48、Clerk 7.9 都没有包级耦合（Convex 侧走平台集成，不装 SDK），与 Zod 4 无关。没有发现冲突。
- **许可证**：Sentry SDK 为 MIT；其余是托管服务，不引入 copyleft。
- **维护活跃度**：Sentry 11.x 从 09-23 到 10-23 发布了 10 个版本；OpenNext、Netlify 插件 10 月均有发布。
- **与任务书核心**：r01、r02 涉及核心 1，必须修；其余设计（日志流不当账本、成本标"估算"、开关在 Convex 侧强制、运维工具不做生产 reset）与核心 4、6、7、8 一致。
- **版本纪律**：convex 1.48.0 与 1.47.0 都不满两周（R11 已经交给整体栈复核，本文同意）；本备忘录依赖的 CLI 命令在 dashboard 都有等价操作，这个判断成立。
