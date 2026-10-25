# 04 平台约束与推荐模式（第 2/7 部分）

> 分片清单见 part1。本文件：§1 Convex（下）。

### 1.6 唯一性与索引

- `IndexOptions` 只有 `staged` 一个选项，**没有 unique 约束**（源码 `CVX:server/schema.ts:173-185`）。`.unique()` 只是读取时的断言：匹配多于一条就抛错，它不阻止写入重复（`CVX:server/query.ts:264-282`）。
- 唯一性只能"在同一个 mutation 内先按索引查、查不到再写"。两个并发 mutation 都读到空区间时，OCC 会让后提交者冲突重试，重试时它会看到前者的插入（文档推论：Convex 把索引区间读入读集。并发下确实如此：待验证，且 convex-test 无法验证，见 1.12）。
- 推论：任何"每个 X 只能有一条 Y"的不变量（每版本每人一条审批、每个执行 key 一条执行记录、每间房一个活跃 run）都必须：①有覆盖该键的索引；②在唯一的写入口 mutation 里检查；③不能有绕过该入口的写路径。
- 索引字段按定义顺序查询；系统自动在末尾追加 `_creationTime` 作为平局字段（`schema.ts:236-285`，`IndexTiebreakerField`）。源码建议索引名包含全部字段，如 `by_roomId_and_version`。
- 大表加索引可用 `staged: true` 后台回填（`schema.ts:175-184`），1.47 起也可对表校验器做 staged 变更（`NM:convex/CHANGELOG.md` 1.47 节）。
- 新能力 `commitTs`：字段用 `v.commitTs()` 声明，插入时写 `ctx.db.vars.commitTs`，提交时解析成按提交顺序递增的 int64；在该字段上建索引即可按提交顺序读；同一 mutation 内读回的是占位符，不能当数字用（`CVX:values/validator.ts:213-222`；`database.ts:376-386`）。配套 `ctx.meta.getSnapshotTs()`（`meta.ts:160-182`）。适合事件流的全序游标；`_creationTime` 是墙钟，源码明确说不保证跟提交顺序一致。

### 1.7 认证：`ctx.auth` 与 `auth.config.ts`

- `auth.config.ts` 的 provider 两种形态：OIDC `{ domain, applicationID }`，或 `{ type: "customJwt", issuer, jwks, algorithm: "RS256" | "ES256", applicationID? }`（源码 `CVX:server/authentication.ts:19-70`）。原仓库用 `CLERK_JWT_ISSUER_DOMAIN` 环境变量作 domain、`applicationID: "convex"`，缺失时直接抛错，部署即失败、默认拒绝（`ORIG:convex/auth.config.ts`）。
- `ctx.auth.getUserIdentity()`：未认证时在 query/mutation/action 返回 `null`，在 HTTP action 中抛错（`authentication.ts:227-236`）。只保证 `tokenIdentifier`（= `iss` + `sub`，全局唯一）与 `issuer` 存在；`subject` 是 IdP 用户 id（Clerk 的 `user_...`），跨 IdP 不保证唯一（`authentication.ts:72-122`）。
- 原始 JWT 可从 `ctx.meta.getRequestMetadata().authToken` 取得（`meta.ts:126-132`）。
- 被调度的函数是否带有调度者身份：待验证（普遍做法是不依赖，把 `actorUserId` 作为参数显式传入，并在调度前的 mutation 中完成鉴权）。
- 1.48 新增 `ctx.auth.signJwt`（仅 mutation）：ES256，最长 1 小时，claims 只签名不加密，任何人可用 `${CONVEX_CLOUD_URL}/.well-known/jwks.json` 验证（`authentication.ts:245-269`；`CHANGELOG.md` 1.48）。本系统暂无必需用途。

### 1.8 `v.*` validator 能表达什么

- 可用构造：`v.id(table)`、`v.null()`、`v.number()`（float64）、`v.int64()` / `v.bigint()`、`v.commitTs()`、`v.boolean()`、`v.string()`、`v.bytes()`、`v.literal(x)`、`v.array(el)`、`v.object(fields)`、`v.record(k, v)`、`v.union(...)`、`v.any()`、`v.optional(x)`、`v.nullable(x)`；1.46 起每个 validator 也有 `.optional()` 方法（`CVX:values/validator.ts:151-430`；`CHANGELOG.md` 1.46）。
- 能表达：结构、字面量枚举（`v.union(v.literal(...))`）、判别联合（`v.union(v.object({ kind: v.literal("a"), ... }), ...)`，源码注释推荐）、外键表名、"可省略"与"必须出现但可为 null"的区别（`validator.ts:366-430`）。
- 不能表达：数值范围、`v.number()` 上的整数约束、字符串长度/正则/格式、数组长度、跨字段约束、外键存在性。这些必须在 mutation 代码里校验（例如 Zod 或手写断言）。
- 金额：`v.number()` 是 float64，整数分在 `Number.isSafeInteger` 范围内精确；需要更大范围用 `v.int64()`（bigint）。
- schema 校验默认开启（`schema.ts:900-904`）；单文档大小、数组长度、嵌套深度等上限：待验证（文档 limits 页）。

### 1.9 查询、排序、分页

- 标准形态：`ctx.db.query("t").withIndex("by_x", q => q.eq("x", x)).order("desc").take(n)`；消费方式 `collect / take / first / unique / paginate / for await`（`CVX:server/query.ts:120-170, 176`）。
- `.collect()` 把全部匹配加载进内存，源码反复提示只用于有明确上界的结果集；`.filter()` 是扫描，优先 `.withIndex()`（`query.ts:123, 190, 230-245`）。
- 分页：`paginate({ numItems, cursor, endCursor? })`；在响应式查询里 `numItems` 只是初始值，数据增删时页大小会变，客户端用 `usePaginatedQuery` 处理页拆分（`CVX:server/pagination.ts:68-98`；`CVX:react/index.ts:72`）。
- 排序只能按所用索引的字段（加 `_creationTime`）；需要"按房间按版本倒序取最新"就要 `by_roomId_and_version` 这样的索引。

### 1.10 1.47–1.48 其他相关新能力

- mutation 中可直接 `ctx.storage.store()` / `ctx.storage.get()`，计入事务限额（`CHANGELOG.md` 1.48）。
- `ctx.meta`：`getFunctionMetadata()`、`getDeploymentMetadata()`、`getTransactionMetrics()`、`getRequestMetadata()`（含 `requestId`、`scheduledFunctionId`、`authToken`）、`getSnapshotTs()`（`meta.ts:56-226`）。可把 `requestId` 写进事件做追溯。
- CLI 在识别到 AI 代理时 `npx convex env list` 默认只列变量名（`CHANGELOG.md` 1.47–1.48），与"密钥不进日志"的纪律一致。

### 1.11 客户端（convex/react）语义

- 断线重连时，客户端重发在途 mutation，后端会去重，源码称其"safe since mutations are idempotent"（`CVX:browser/sync/request_manager.ts:205-210`）。这只覆盖同一次调用的重发；用户连点两次是两次独立调用，业务幂等仍需自己做（幂等键 + 唯一性检查）。
- 在途 action 在重连时判失败、不重发（`request_manager.ts:211-224`）。
- `useQuery` 加载中返回 `undefined`；有 `<Authenticated>` / `<Unauthenticated>` / `<AuthLoading>` 组件与 `useConvexAuth()`（`CVX:react/auth_helpers.tsx:10-37`；`ConvexAuthState.tsx:54`）。
- query 返回的一切都会到达浏览器（可在 devtools 看到），因此字段级披露必须在 query 的服务端返回值上完成，不能"取回再隐藏"。

### 1.12 convex-test

- 版本：`npm view convex-test` → 0.0.65，peer `convex ^1.43.0`，2026-10-23 更新；README 原意：社区维护的、用 TypeScript 实现的 Convex 后端模拟，用于自动化测试。本机两个仓库都没有安装它。
- 常见能力（来自 Convex 测试文档的一般认知，具体 API 名称待验证）：`convexTest(schema, modules)`；`t.query/t.mutation/t.action/t.run`；`t.withIdentity({...})` 模拟登录身份；配合 vitest 假时钟推进并完成已调度函数（`finishAllScheduledFunctions` 一类 API）；可注册组件。
- 局限（待验证）：它不是真实后端，函数串行执行，**不模拟并发事务与 OCC 冲突**；限额、超时、错误信息与生产不同；`"use node"` 与默认运行时的差异不被模拟。
- 推论：幂等与并发不变量（重复审批、并发执行、唯一性）必须另有"针对真实 dev 部署并行发起 mutation"的测试脚本；convex-test 用于状态机、权限、披露规则的确定性测试。

## §1 对设计的直接含义

1. 所有业务写入都走 mutation；action 只做"调用 Claude → 一次 `runMutation` 提交结果"，提交 mutation 必须重新校验 run 是否仍有效、约束版本是否未变（过期拒绝）。
2. 状态迁移与启动 action 放在同一 mutation：先写状态，再 `runAfter(0, internal...)`；回滚则调度一并消失。
3. 被调度的 action 是 at-most-once：重试、超时都要自建（attempt 记录 + watchdog mutation），或采用 part3 中的组件。
4. 唯一性靠"单一写入口 mutation + 索引查重"；为每条唯一性不变量指定索引与唯一入口，并列入 03-schema 的不变量落点。
5. 事件顺序如需全序，考虑 `v.commitTs()` 字段 + 索引；`_creationTime` 只作展示。
6. validator 只管形状；金额、日期、范围、披露规则由代码校验，不能指望 schema。
7. 鉴权以 `identity.tokenIdentifier` 为主键映射到内部 `users` 表；被调度函数不依赖身份，显式传 `actorUserId`。
8. 公开 query 只返回调用者有权看到的字段；私密简报永远不进入对他方可调用的 query 的返回值。
9. Claude 调用默认放在默认运行时的 action 中（显式 `apiKey`），先做最小实验验证；失败则改为单独的 `"use node"` 文件。
10. 并发测试不能只靠 convex-test。
