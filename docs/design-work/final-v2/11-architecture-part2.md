# 11 · 系统架构（part2）：依赖方向、lint、函数构造器、写门面

## 11.4 依赖方向（允许清单，其余一律禁止）

| 从 \ 到 | `core/engine` | `core/scenarios/<x>` | `convex/**` | `@convex/_generated/{api,dataModel}` | `src/**` | `zod` | `convex/*`（npm） | `@anthropic-ai/sdk` | next / react / `@clerk/*` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core/engine` | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `core/scenarios/<x>` | ✓（经 `index.ts`） | 仅本目录 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `convex/**` | ✓（经 `@core/engine`） | ✓（只经 `convex/scenarios/registry.ts`） | ✓ | ✓ | ✗ | ✓ | ✓ | ✓（只在 `convex/model/agents/**`） | ✗ |
| `src/**` | 仅 `@core/engine/ui` | ✗ | ✗ | ✓ | ✓ | ✓（表单） | `convex/react`、`convex/react-clerk`、`convex/nextjs` | ✗ | ✓ |

说明：
- `@core/engine/ui` 是给浏览器的窄出口：`APP_NAME`、reasonCode 与错误码常量（只用于映射文案）、`parseCents` / `formatCents` / `IsoDate` 解析、码点计数（`TEXT_LIMITS`，前后端计数一致）。它**不**导出规则、投影、候选枚举或模板：浏览器不得自行计算可执行性或阻断原因（13 的 `passesChecks` 只来自 `rooms.view`）。
- 场景只经 `registry.ts` 进入 Convex，引擎不 import 任何具体场景；一个场景不能 import 另一个场景（第二个场景落地时自动受约束）。
- 金额显示的 `Intl.NumberFormat` 只在 `src/lib/format.ts`（D36 的 `formatUsd` 归 UI）；`core` 内需要打印金额时用无 `Intl` 的 `formatCents`（模板确定性）。

## 11.5 Lint 规则（`eslint.config.mjs`，ESLint 9.39.5 flat config，D20）

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createBoundaryConfig } from "./tooling/dev-tooling/src/eslint/index.ts"; // Node 24 类型剥离直接加载
export default defineConfig([
  ...nextVitals, ...nextTs,
  globalIgnores([".next/**", "convex/_generated/**", "next-env.d.ts", "coverage/**",
                 "tooling/dev-tooling/fixtures/**"]),
  ...createBoundaryConfig({ rootDir: import.meta.dirname }),   // L3：按解析后的目标文件判定层级
  { files: ["core/**/*.ts"], rules: { /* L1、L2 */ } },
  { files: ["convex/**/*.ts"], rules: { /* L4–L9 */ } },
  { files: ["src/**/*.{ts,tsx}"], rules: { /* L10 */ } },
  { files: ["core/**/*.ts", "convex/**/*.ts"], rules: { /* L11，type-aware */ } },
  { files: ["**/*.test.ts", "testing/**", "e2e/**", "evals/**", "scripts/**"], rules: { /* L12 */ } },
]);
```

| # | 作用域 | 规则（机制） | 守护 |
| --- | --- | --- | --- |
| L1 | `core/**` | `no-restricted-imports`：`next*`、`react*`、`@clerk/*`、`convex`、`convex/*`、`@convex/*`、`@/*`、`zod`、`@anthropic-ai/*`、`server-only`；正则拦相对路径进入 `convex/` 或 `src/`（skeleton 实测写法） | 分层；引擎纯度（D21） |
| L2 | `core/**` | `no-restricted-syntax` / `no-restricted-globals`：`new Date()`、`Date.now`、`Intl`、`Math.random`、`fetch`、`crypto`、`process`、`console` | 核心 4 的确定性（时间、随机数、网络都由调用方传入） |
| L3 | 全仓 | dev-tooling `createBoundaryConfig`：`boundaries/dependencies` 按**解析后**的目标分类（别名与相对路径一视同仁），默认 disallow；场景之间互不可见 | L1/L4/L10 的正则补漏（正则看不到别名指向，且会误伤名字含 `src` 的目录）——见 part4 §11.15 Q7 |
| L4 | `convex/**` | `no-restricted-imports`：`next*`、`react*`、`@clerk/*`、`@/*`；正则拦相对路径进入 `src/` | Convex 不依赖 Next |
| L5 | `convex/**`（除 `lib/functions.ts`） | `no-restricted-imports` + `importNames`：禁止从 `_generated/server` 导入 `query`、`mutation`、`action`、`internalQuery`、`internalMutation`、`internalAction`、`httpAction` | A3：构造器是唯一入口，鉴权与错误清洗不可绕过 |
| L6 | `convex/**`（除 `model/agents/**`） | `no-restricted-imports`：`@anthropic-ai/sdk` | 模型调用唯一接缝 `callModel`（10；testing-ops r01） |
| L7 | `convex/**`（除 `lib/opsLog.ts`） | `no-console`（error） | D16：公共函数里的 `console.*` 会经 `logLines` 下发到调用者浏览器 |
| L8 | `convex/**`（除 `lib/db.ts`；删除另豁免 `seed.ts`、`ops.ts` 的 `purgeRawOutputs`、`privacy.ts`） | `no-restricted-properties`：`ctx.db.patch` / `replace` / `delete`；`no-restricted-syntax`：裸 `Date.now()`（除 `lib/time.ts`） | A4 写门面；D22（时间只经 `nowMs(ctx: MutationCtx \| ActionCtx)`，类型上 query 拿不到） |
| L9 | `convex/model/views/**` | `no-restricted-syntax`：`SpreadElement`（对象展开） | 投影逐字段挑选，不得 `...doc`（07） |
| L11 | `convex/model/views/**` 与函数层中只含公开构造器导出的文件 | `no-restricted-imports` + `importNames`：禁止从 `lib/opsLog` 导入 `opsLog`（只许 `publicOpsLog`） | privacy-10：公开路径的日志随 `logLines` 下发；主防线是 `InternalCtx` 品牌参数（§11.6），本条只拦显式 import |
| L10 | `src/**` | `no-restricted-imports`：`@convex/*` 中除 `_generated/api`、`_generated/dataModel` 以外全部；相对路径进入 `convex/`；`@core/*` 中除 `@core/engine/ui` 以外全部；`@anthropic-ai/*` | 浏览器拿不到服务端逻辑与私密处理代码 |
| L11 | `core/**`、`convex/**` | `@typescript-eslint/no-floating-promises`、`@typescript-eslint/switch-exhaustiveness-check`（type-aware，`projectService: true`） | Convex 官方推荐（漏 `await` 的 `ctx.db.insert`）；状态机穷举 |
| L12 | 测试、`testing/`、`e2e/`、`evals/`、`scripts/` | 放宽 L2、L7；同时禁止 `src/`、`convex/` 运行时代码反向导入这些目录 | 测试设施不进部署包 |

lint 之外的机械检查（CI 的 `pnpm arch:check`，脚本放 `scripts/arch-check.ts`）：
1. 唯一写入口 grep，白名单即 03 §3.13.2 的"表 → 唯一写者"：`events` 与 `commitTs` 只在 `model/events.ts`（`appendEvents`）；`executions` / `changeOrders` / `tasks` 只在 `model/executions.ts`；`ledgerEntries` 只在 `model/ledger.ts`（`appendLedgerEntry`，commit 由执行事务调用）；`approvals` 只在 `model/approvals.ts`；`members` 只在 `model/members.ts`（`addMember`）；`proposals` 只在 `model/proposals.ts`（`insertProposal`）；`rooms.constraintsVersion` 只在 `model/constraints.ts`（`bump`）；`internal.invites.insertLink` 之外无 `tokenHash` 写入。
2. `convex.json`：`node.nodeVersion === "24"` 与 `.node-version` 主版本一致；若出现 `externalPackages`，不得含 `"*"`（code-organization review r06：`"*"` 会把本地模块当外部包去 npm 安装）。
3. lint 自检：dev-tooling 的 `lintFixtureProject` 跑 must-fail / must-pass 夹具（25 个夹具 0 不符），外加本仓库自写的反例夹具：不经构造器的 public mutation、`core` 内 `Date.now()`、`src` 导入 `@convex/model/*`、`convex/rooms.ts` 内 `console.log`。规则被误关时 CI 立即变红。

## 11.6 函数构造器（`convex/lib/functions.ts`）

用 `convex-helpers@0.1.128` 的 `customQuery` / `customMutation` / `customAction` 实现（techstack D08；它是普通库、不是 Convex 组件，不影响离线 codegen）。若该版本受冷却期或兼容性阻塞，退路是手写约 80 行的包装器，导出名与语义不变。

| 构造器 | 包装 | 鉴权（按顺序） | 失败行为 | 白名单 |
| --- | --- | --- | --- | --- |
| `anonQuery` | `query` | 无 | — | 仅 `health.ping`（文件内附审查注释） |
| `userQuery` | `query` | 身份 → `users.by_tokenIdentifier` | 无身份或未建档：**不执行 handler，返回 `null`**（`returns` 必须含 `v.null()`）；例外（见 12）：`users.viewer` 未建档时返回 `{ status: "unprovisioned" }`；`rooms.listMine` 返回空页 `{ page: [], isDone: true, continueCursor: "" }`，`returns` 不含 `v.null()`（`usePaginatedQuery` 的类型约束） | — |
| `userMutation` | `mutation` | 身份 → users 行 | `auth.unauthenticated` / `auth.user_not_provisioned`；`{ provision: true }` 只允许 `users.ensureViewer` 使用（跳过 users 行检查） | — |
| `memberQuery` | `query` | 身份 → users → `room` 解析器（由 `roomId` / `proposalId` / `requestId` / `executionId` / `taskId` / `runId` 取得房间）→ `members.by_room_user` → `roles` | 任一步失败（含目标文档不存在）返回 `null`，三种情况不可区分 | — |
| `memberMutation` | `mutation` | 同上 + `roles` / `creatorOnly` / `rateLimit` | `auth.not_member`（含文档不存在）、`auth.role_forbidden`、`auth.not_creator`、`run.rate_limited` | — |
| `userAction` | `action` | 身份 → `ctx.runQuery(internal.users.resolve)` | 同 `userMutation` | 仅 `invites.createLink` |
| `sysQuery` / `sysMutation` / `sysAction` | `internal*` | 无身份；代表用户行事的函数 `args` 必须含 `actorUserId`（`v.id("users")`；代理运行时函数为 `v.union(v.id("users"), v.null())`，`null` = 系统触发） | — | — |

构造器注入的上下文：`ctx.viewer = { userId, tokenIdentifier, emailVerified }`（`emailVerified` 只在 Convex `UserIdentity.emailVerified === true` 时为真，`false` 与缺失一律为假；业务代码不读原始 claim 名 `email_verified`，16 覆盖 true / false / 缺失三种身份）；成员构造器另有 `ctx.member = { memberId, role, isCreator }`、`ctx.room`（已读的房间文档）。参数里**永远不出现** `userId`、`role`、`memberId` 之类"我是谁"的字段（身份只来自 `ctx.auth`；目标实体 id 如 `proposalId` 允许）。

公共构造器的类型签名要求同时提供 `args` 与 `returns`；缺 `returns` 编译失败（inputs/04 §1.1：公开函数必须声明两者）。`returns` 只作测试期探测器，不当作运行时隐私防线（D16），投影由 `convex/model/views/*` 逐字段完成。公共构造器在 `withSanitizedErrors` 之内、返回之前，用与 `returns` 同源的闭集 DTO validator 在运行时校验投影结果：不通过时丢弃校验细节，query 返回 `null`、mutation 抛 `internal`，并记 `publicOpsLog("unhandled", { fn, errorClass: "Other" })`；平台随后的 `returns` 校验只是第二道断言，它的失败消息因此碰不到未通过校验的值。

`withSanitizedErrors` 包住每个构造器的整个执行（含鉴权），公共与内部一视同仁（techstack X4）：

```ts
// convex/lib/errors.ts
export type WirePayload = { code: ErrorCode; params: WireParams };      // D16：浏览器只收 {code, params}
export function appError(code: ErrorCode, params: WireParams = {}): ConvexError<WirePayload> {
  return new ConvexError({ code, params });                            // params 由调用处按受众裁剪后传入
}
export async function withSanitizedErrors<T>(fn: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (e) {
    if (e instanceof ConvexError && isWirePayload(e.data)) throw e;   // 已规范化：原样抛出（事务照常回滚）
    publicOpsLog("unhandled", { fn, errorClass: errorClassOf(e) });    // 只记类名，不记 message / stack；三键闭集（公开与内部同一行形）
    throw new ConvexError({ code: "internal", params: {} });
  }
}
```

- `errorClassOf` 只返回白名单类名（`TypeError`、`RangeError`、`SyntaxError`、`ArgumentValidationError`、`Other`）；`JSON.parse` 的报错消息会带出输入前若干字符（observability-ops review r02 实测），所以消息正文永不记录。
- 规范化错误的 `params` 必须在抛出处已经按调用者角色裁剪（07 的 `params` 受众表；未标注受众的参数丢弃）。`ConvexError.message` 等于 data 的序列化，data 本身就是纪律边界。
- OCC 冲突在提交时由平台检测与重试，不进入 handler 的 catch（待验证：errors-result 已知缺口第 3 条）。
- 地基 `errors-result` 的线格式 `{ code, message, data }` 在本仓库改为 canon 的 `{ code, params }`：`message` 是静态文案，由前端按 `code` 从本地表重新得出，不上线。

**两个 logger 的可达性**（privacy-10，签名与白名单以 15 §15.6.2 为唯一定义）：`sysQuery` / `sysMutation` / `sysAction` 与 `userAction` 的 handler 上下文带 `ctx.log: InternalCtx` 品牌，`opsLog(ctx.log, code, fields)` 只能这样调用；`anonQuery` / `userQuery` / `userMutation` / `memberQuery` / `memberMutation` 不注入它，所以公开路径上调用 `opsLog` 编译不过，只能用 `publicOpsLog`（三键、闭集、不收数值）。被公开与内部路径共用的 `convex/model/**` helper 不自己 import `opsLog`：需要带数值的日志时由调用方传入 `InternalCtx | null`，为 `null` 时只发 `publicOpsLog`。lint L11 兜底。

`rateLimit` 选项（D12 ⑥、D17）在 handler 之前执行 `assertWithinRate(ctx, bucket)`：按发起者索引计数、零依赖、不建计数文档（12 §12.2 给出桶与计数源）。被拒的调用抛错并回滚，不会被计数；能产生可观测状态变化的只有成功的写入，而它们一定被计数。

## 11.7 写门面与房间写锁（`convex/lib/db.ts`，形状以 03 §3.3 为准）

```ts
// 只追加表（永不 patch / delete；唯一例外是 privacy.redact 覆盖 REDACTABLE_FIELDS）
export const APPEND_ONLY = ["briefs", "sharedFacts", "catalogItems", "ledgerEntries",
  "constraintRevisions", "approvals", "executions", "changeOrders", "events"] as const;
export const MUTABLE_FIELDS = { /* 逐表字段白名单，清单只在 03 §3.3.2 维护，CI 断言 ⊆ keyof Doc<t> */ } as const;
export async function openRoomTx(ctx: MutationCtx, roomId: Id<"rooms">,
  opts: { allow: readonly RoomStatus[] }): Promise<RoomTx>;   // 重读房间并 rooms.writeSeq + 1（M-ROOM）
export type RoomTx = {                                     // 没有 RoomTx 就写不了房间作用域表
  readonly room: Doc<"rooms">;
  insert<T extends RoomScopedTable>(t: T, doc: WithoutSystemFields<Doc<T>>): Promise<Id<T>>;
  patch<T extends keyof typeof MUTABLE_FIELDS>(t: T, id: Id<T>,
    fields: Partial<Pick<Doc<T>, (typeof MUTABLE_FIELDS)[T][number]>>): Promise<void>;
};
```

- **房间写锁 M-ROOM**（03 SC-05）：任何改变某房间业务状态的 mutation 在第一次写之前调用 `openRoomTx`，同房间的业务事务因都写 `rooms` 同一文档而由 OCC 确定地串行；"先查后写"的唯一性（成员、审批、提案版本、执行键）因此不押在"索引区间读进入读集"这一未在真实部署验证的假设上（spikes §8 #1）。`opts.allow` 同时是房间状态守卫：默认拒绝 `executed` / `closed`（`run.invalid_state`），只有 `tasks.markDone` 与 `rooms.startFollowUp` 显式放行 `executed`。全局行（`users`、`opsFlags`、`spendCounters`、`rawOutputs`）不经它；巡检类 cron 每个房间一个 mutation，避免与所有房间冲突。
- `RoomTx.patch` 只接受白名单字段并在运行时再断言一次（防 `as` 绕过）；`status` 只经 04 的 `setStatus`；用量字段（`attempts.usage` 等）只允许从空写成值（迟到结果补记）。`patch({ f: undefined })` 只在门面内部用于删除可选字段，参数层不能用 `undefined` 表达删除。
- **删除入口只有**：dev / preview 的 `seed.reset`（只删 `provenance !== "live"` 的房间及其行，`assertTier` 守护）与 `ops.purgeRawOutputs`（删过期原文）。**对只追加表的第二种、也是最后一种写**是 `privacy.redact`：只把 `REDACTABLE_FIELDS` 覆盖为 `"[redacted]"` 并写 `pii_redacted` 事件，编译期断言该清单与 `termsKey` 覆盖字段不相交（techstack D38）。三者都在 L8 的豁免文件里。
- 地基 idempotency-ids 的"先按索引查、未命中再插入"是唯一性的落点：每个需要唯一的键只有一个写入口（`executionKey` 在 `model/executions.ts`、`(roomId, userId)` 与 `(roomId, role)` 在 `model/members.ts`），seed 与迁移也走同一入口——convex-test 实测直接插入重复行会让该键的 `.unique()` 永久失败关闭。
