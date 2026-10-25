# Spike 报告：convex-test 验证 Convex 语义

- 目录：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/convex-test/`（下称 SPIKE）
- 版本（`npm ls --depth=0` 实测）：convex@1.48.0、convex-test@0.0.65、vitest@5.0.5、typescript@7.0.2、@edge-runtime/vm@5.0.0；Node v24.21.0
- 结果：`tsc --noEmit` 通过；`vitest run` 5 个文件 32 个用例全部通过。未进行任何 Claude API 调用，未读取任何密钥；"模型调用"由 `runs.ts` 里的 `stubModel()` 纯函数代替。

## 1. 目的

用一个离线、可运行的最小 Convex 项目，实测 inputs/04 §1 中与"唯一性 / 幂等 / 审批 / 调度 / 认证 / validator / action 非事务"相关的假设，确定哪些可以由 convex-test 做确定性回归，哪些必须留给真实部署。具体对应任务 (a)–(f)，另加 (g)：1.48 新增的 mutation 内 `ctx.runMutation` 子事务语义。

## 2. 做了什么

### 2.1 命令

```bash
cd SPIKE
npm install --save-dev convex@1.48.0 convex-test vitest typescript @edge-runtime/vm
npx tsc --noEmit -p .
npx vitest run --reporter=verbose > test-output.txt
```

注意：vitest 5 在代理环境下默认 reporter 不打印通过用例的 `console.log`，要看 `[spike]` 日志须加 `--reporter=verbose`。

### 2.2 为什么手写 `convex/_generated/`

`npx convex codegen` 需要已选定的部署凭据：`node_modules/convex/src/cli/codegen.ts` 在 action 中先 `loadSelectedDeploymentCredentials`，`lib/components.ts` 的 `runCodegen` 在 `credentials === null` 时直接 return（源码阅读，未运行，以免触碰云端）。因此 spike 手写了三个最小替身：
- `convex/_generated/server.ts`：`queryGeneric` 等按 `DataModel` 断言类型；
- `convex/_generated/dataModel.ts`：`DataModelFromSchemaDefinition<typeof schema>`、`Doc`、`Id`；
- `convex/_generated/api.ts`：`anyApi` + `ApiFromModules<{...}>` + `FilterApi`。

convex-test 靠模块路径里含 `_generated` 来定位函数根目录（`convex-test/dist/index.js:1707-1716`），所以必须存在这个目录。真实项目用 `npx convex dev` 生成并提交进仓库即可，不需要这些替身。

### 2.3 关键代码路径（均在 SPIKE/convex/ 下）

| 文件 | 内容 |
| --- | --- |
| `schema.ts` | users / rooms / proposals / approvals(`by_proposal_user`) / executions(`by_operationId`) / commitments / runs / events(`by_kind`) / agentMessages(判别联合) / counters |
| `lib/auth.ts` | `requireIdentity`、`requireUser`（`tokenIdentifier` → users 行），`appError(code)` 抛 `ConvexError({code,message})` |
| `users.ts` | `whoami` query、幂等 `ensureUser`、`whoamiViaAction`（action 内身份是否传入 `runQuery`） |
| `execution.ts` | `executeProposal`：同一 mutation 内按 `by_operationId` 先查后写 execution + commitment + event；`simulateFailureAfterWrites` 验证原子性 |
| `approvals.ts` | `setApproval`：按 `by_proposal_user` upsert，返回 `inserted/unchanged/updated` 与 `revision` |
| `runs.ts` | `startRun`（写 run + `runAfter` 调度 action；`failAfterSchedule` 验证回滚）、`executeRunAction`（action：`markRunning` → stub → `commitRunResult` 带过期拒绝）、调度 mutation、链式调度、失败 action、`cancel` |
| `actions.ts` | `twoStepAction`：两次 `runMutation`，中间可抛错 |
| `nested.ts` | `outerCatchesInner`：mutation 内 `ctx.runMutation` 子事务 |
| `validation.ts` | 用 `v.any()` 参数绕过参数校验、把坏文档推到 DB 层；严格参数与 `returns` 校验对照 |
| `test.setup.ts` | 模块 glob（见 3.0 的修正） |
| `test.helpers.ts` | `makeT`、`as(t, who)`、`seed`、计数、`rejectionOf`、`expectAppError`、`log` |
| `*.test.ts` | idempotency / scheduler / auth / validation / actions 五组测试 |

## 3. 实测结果

### 3.0 环境层面的意外

1. convex-test 文档中的 `import.meta.glob("./**/!(*.*.*)*.*s")` 在 vitest 5.0.5 下**匹配到 0 个文件**（实测打印 `Object.keys(modules)` 为 `[]`），convexTest 随即报 `Could not find the "_generated" directory`。改为 `import.meta.glob(["./**/*.*s", "!./**/*.*.*s"])` 后正常。
2. TypeScript 7.0.2 能正确检查 convex 1.48 代码；但模块内用 `internal.*`/`api.*` 引用同一 API 图的函数（`runs.startRun`、`users.whoamiViaAction`）会触发 TS7022/TS7023 循环推断错误，需给 handler 写显式返回类型（与 convex-test 类型注释"may need explicit return type annotations"一致）。

### 3.1 (a) 同一 mutation 内"先按索引查再 insert"

```
[spike] first: {"created":true,"executionId":"0000000000000000010003executions"}
[spike] second: {"created":false,"executionId":"0000000000000000010003executions"}
[spike] parallel results: [{"created":true,...},{"created":false,...}]   // Promise.all 同一 operationId
[spike] executions after two client-random keys: 2                      // 两个不同 operationId
[spike] error data: {"code":"SIMULATED_FAILURE","message":"after writes"} // 写完三行后抛错
```
- 重复调用同一 operationId 返回已有记录，executions / commitments / `execution.created` 事件各 1 行。
- 写入 3 行后抛错：三张表都是 0 行（mutation 原子）；随后用同一 operationId 重试 `created: true`。
- `Promise.all` 两个相同调用只建 1 行，但这只是因为 convex-test 串行执行（`dist/index.js:1988-1993` 注释：DatabaseFake "restricts `convexTest` to run one function at a time"），**不能证明 OCC 下的行为**。
- 两次点击若各自生成不同 operationId，会产生 **2 条** execution。

### 3.2 (b) 审批 upsert（`by_proposal_user`）

```
[spike] alice r1/r2/r3: ["inserted","unchanged","updated",2]
[spike] duplicate detection error: unique() query returned more than one result from table approvals:
```
- 同一 (proposal, user) 始终 1 行；同决定同约束版本返回 `unchanged`；改决定 `updated` 且 revision+1；房间 `constraintVersion` 1→2 后再提交同一决定也会 `updated`（revision 3，constraintVersion 2）；bob 另起一行；`listForProposal` 共 2 行。
- 用 `t.run` 绕过入口直接插入重复行**成功**（索引不唯一），之后入口里的 `.unique()` 抛错：重复被检测到，但该键从此"失败关闭"。

### 3.3 (c) 调度器

真实 API 名（以 `convex-test/dist/index.d.ts` 为准）：`t.finishInProgressScheduledFunctions(): Promise<void>`、`t.finishAllScheduledFunctions(advanceTimers: () => void, maxIterations = 100): Promise<void>`。

```
[spike] run status right after startRun: queued
[spike] job right after startRun: {"name":"runs:executeRunAction","state":{"kind":"pending"}}
[spike] run after drain: {"status":"succeeded","output":"STUB(Scope change)","observedIdentity":null}
[spike] job after drain: {"kind":"success"}
[spike] delayed mutation job: {"state":{"kind":"success"},"scheduledTimeMinusCreation":60000}
[spike] identity seen inside scheduled mutation: {"identity":null}
[spike] chain job states: ["runs:chain:success" x4]
[spike] after failed startRun: {"runs":0,"jobs":0}
[spike] failing action job: {"kind":"failed"}
[spike] console.error calls: 1
```
- `runAfter` 不会在调度它的 mutation 返回前执行；任务以 `pending` 出现在 `ctx.db.system.query("_scheduled_functions")`。
- **被调度的 action 与 mutation 都能测**：`vi.useFakeTimers()` + `await t.finishAllScheduledFunctions(vi.runAllTimers)` 一次性排空（含"函数再调度函数"的链，深度 3 共 4 次）；精确时间用 `vi.advanceTimersByTime(59_999)`（仍 pending）→ `advanceTimersByTime(1)` + `await t.finishInProgressScheduledFunctions()`（success）。
- 真实计时器下 `runAfter(0)` 调度的任务，之后开启假计时器再 `finishAllScheduledFunctions` 也能排空（与 d.ts 注释一致）。
- mutation 在 `runAfter` 之后抛错：run 行与 `_scheduled_functions` 行一起回滚，action 从未运行。
- 被调度的 action 抛错 → 状态 `failed`，convex-test 打一次 `console.error`，不重试。`ctx.scheduler.cancel` → `canceled`，不运行。
- 被调度的 mutation 与 action 内 `ctx.auth.getUserIdentity()` 都是 `null`，即使调度者已登录（convex-test 源码 `dist/index.js:1181-1184` 注释称有意如此）。
- 测试可以直接调 `internal.*`：`t.mutation(internal.runs.commitRunResult, …)`；旧 attempt 的提交返回 `false`（过期拒绝），之后真正触发的 action 在 `markRunning` 看到状态不是 queued 就不做任何事。

### 3.4 (d) `t.withIdentity` 与 `ctx.auth.getUserIdentity`

```
[spike] auto-generated identity: {"issuer":"https://convex.test","name":"Alice","subject":"-1008044925","tokenIdentifier":"https://convex.test|-1008044925"}
[spike] explicit subject+issuer identity: {"issuer":"https://clerk.example.test","subject":"user_alice","tokenIdentifier":"https://clerk.example.test|user_alice"}
[spike] error class / data: {"isConvexError":true,"data":{"code":"UNAUTHENTICATED","message":"UNAUTHENTICATED"},"message":"{\"code\":\"UNAUTHENTICATED\",\"message\":\"UNAUTHENTICATED\"}"}
[spike] action identity: {"inAction":{...,"tokenIdentifier":"https://clerk.example.test|user_alice"},"viaRunQuery":{...同上...}}
```
- 未登录：query 里 `getUserIdentity()` 返回 `null`，不抛错；"未登录抛错"是 `requireIdentity` 自己抛的 `ConvexError`，它以 `ConvexError` 类与原样的 `data` 到达测试（`message` 是 data 的 JSON 字符串）。
- 只给 `name` 时 issuer 自动为 `https://convex.test`、subject 自动生成；给 subject+issuer 时 `tokenIdentifier = "<issuer>|<subject>"`；显式给 tokenIdentifier 则原样使用。
- `withIdentity` 返回新的访问器，原 `t` 仍匿名。
- 已登录但 users 表没有对应行 → `USER_NOT_PROVISIONED`（认证与"是否为本系统用户"分开判断）。`ensureUser` 重复调用返回同一 id，users 只有 1 行。
- 公开 action 内能拿到身份，并传入 `ctx.runQuery`；匿名 action 两者都是 null。

### 3.5 (e) schema 校验在写入时生效

```
valid_without_optional_note => accepted
optional_note_wrong_type => rejected: Validator error: Expected `string`, got `42`
nullable_archivedAt_missing => rejected: Validator error: Missing required field `archivedAt` in object
nullable_archivedAt_number => accepted
literal_status_bogus => rejected: Validator error: Expected one of literal, literal, literal, got `"bogus"`
extra_unknown_field => rejected: Validator error: Unexpected field `extra` in object
id_wrong_table => rejected: Validator error: Expected ID for table "users", got `000000000000000000000010001rooms`
id_garbage_string => rejected: Validator error: Expected ID for table "users", got `not-an-id`
number_negative_fraction => accepted
number_NaN => accepted
empty_title_string => accepted
patch_bogus_status => rejected: ... got `"bogus"`
patch_unknown_field => rejected: Validator error: Unexpected field `nope` in object
args_undefined_is_dropped_noop => accepted          // {archivedAt: undefined} 经函数参数传入后变成空 patch
handler_unset_optional => accepted                  // handler 内 patch({note: undefined}) 删除字段
handler_unset_required => rejected: Validator error: Missing required field `archivedAt` in object
approval_proposalId_is_users_id => rejected: Validator error: Expected ID for table "proposals", ...
msg_propose_with_clarify_field => rejected: Validator error: Expected one of object, object, got `{"kind":"propose","question":"?"}`
msg_unknown_kind => rejected: ... got `{"kind":"accept"}`
msg_propose_negative_fraction_price => accepted
t_run_bypasses_functions_but_not_schema => rejected: Validator error: Missing required field `title` in object
args_bad_literal => rejected; args_extra_field => rejected: Unexpected field `x`
returns_violated => rejected: Return value validation failed for mutation "validation:badReturn":
```
- `v.union(v.literal…)`、`v.optional`（可缺省）vs `v.union(x, v.null())`（必须出现）、多余字段、`v.id` 的表名、嵌套判别联合，在 insert 与 patch 时都被 schema 校验拒绝；`t.run` 的直接写入同样受 schema 约束。
- 参数校验与 `returns` 校验都生效。
- 只校验形状：负数、小数、`NaN`、空字符串都能写入。
- 对象里的 `undefined` 在函数参数序列化时被丢弃，"把字段设为 undefined 来删除"只能在 handler 内做；删除必填字段被拒并回滚。

### 3.6 (f) action 非事务；(g) mutation 内嵌 runMutation

```
[spike] action error: boom between mutations
[spike] events after failed action: {"step1":1,"step2":0}
[spike] nested (caught): {"r":"caught","counts":{"before":1,"inner":0,"after":1}}
```
- action 第一次 `runMutation` 的写入在 action 抛错后**保留**，第二次未发生：action 不是事务。
- 1.48 mutation 内 `ctx.runMutation`：内层抛错且外层捕获 → 内层写入回滚、外层写入保留；外层再抛 → 全部回滚。与 `convex/src/server/registration.ts:150-153` 的"sub-transaction"说明一致。

## 4. 对设计的结论

### 4.1 证实（convex-test 层面）
1. 单一写入口 mutation "按索引先查后写" 在串行下能让重复调用返回已有记录；mutation 内任意位置抛错都会整体回滚，包括已调度的函数。
2. 审批 upsert 以 `by_proposal_user` 为键可行；`.unique()` 是有效的"重复检测器"，但会让该键失败关闭，所以**绝不能有绕过入口的写路径**（seed / 迁移脚本也要走入口或同等检查）。
3. "写状态 + `runAfter(0)` 启动 action" 是原子组合：mutation 失败时 run 行和调度任务一起消失（inputs/04 §1 含义 2 成立）。
4. 被调度函数没有调用者身份（convex-test）：`actorUserId` 必须作为参数显式传入，且在调度前的 mutation 里完成鉴权（inputs/04 §1.7 "待验证"项在 convex-test 层面得到答案）。
5. 过期拒绝模式可测：`commitRunResult` 按 `status + attempt` 判断，旧 attempt 提交被拒。
6. action 非事务；多步 action 必须让每步幂等，或只用一次 `runMutation` 提交结果。
7. `ConvexError({code})` 原样到达调用方，适合作为 reasonCode / 错误码通道。
8. `v.*` 只管形状（inputs/04 §1.8 成立）：金额整数性、非负、`NaN`、字符串长度、日期格式必须在代码中校验。

### 4.2 证伪 / 需修正
1. **"客户端 operationId 足以防止重复执行"不成立**：两次点击生成不同 key 会写出两条 execution。执行唯一键应由服务端从业务身份派生（例如 `executionKey = proposalId` 或 `${roomId}:${proposalVersion}:${constraintVersion}`，并在同一 mutation 再检查"该房间是否已有执行"）；客户端 operationId 只用于请求去重与追溯。
2. convex-test 文档的 extglob 模块 glob 在 vitest 5.0.5 下无效，须用 `["./**/*.*s", "!./**/*.*.*s"]`。
3. `npx convex codegen` 不能离线运行（源码阅读）：`_generated/` 必须提交进仓库，CI 不应依赖 codegen。
4. "经函数参数传 `{field: undefined}` 可删除字段"不成立：删除只能在 handler 里写。
5. 审批 upsert 用 `patch` 覆盖决定，与核心 #6"历史不可篡改"冲突：设计应改为 approvals 只追加（每次决定一行，`by_proposal_user` 取最新）或"当前行 + approvalEvents 追加表"；spike 用 events 记录每次变化，只是演示。

### 4.3 无法离线验证（必须在真实 dev 部署上测）
1. **OCC 并发冲突与重试**：两个并发 mutation 都读到空索引区间时，后提交者是否冲突重试并看到前者插入。convex-test 串行执行，`Promise.all` 结果没有证明力。需要对真实部署并行发起 N 个 `executeProposal` / `setApproval` 的脚本。
2. 被调度 action 的 at-most-once、不重试；被调度 mutation 在瞬时错误下自动重试且 exactly-once。convex-test 没有瞬时错误，失败一律 `failed`。
3. 生产环境被调度函数是否同样没有身份（convex-test 注释称与后端一致，仍需确认）；真实 Clerk JWT 的 `aud`/`applicationID` 与 `auth.config.ts`。
4. 生产环境的限额（convex-test 默认不启用 `transactionLimits`）、action 超时、错误信息格式。
5. `NaN` / `Infinity` 在真实后端写入 `v.number()` 字段的行为（Convex float64 理论上允许，需确认）。
6. `"use node"` 运行时差异、客户端断线重发、响应式订阅推送、`_creationTime` 与提交顺序的关系、`commitTs`。

### 4.4 对 16-testing 的建议
- 测试放在 `convex/*.test.ts`，环境 `edge-runtime`，`server.deps.inline: ["convex-test"]`，模块 glob 用 3.0 的写法。
- 每个用例 `vi.useFakeTimers()` / `afterEach(vi.useRealTimers)`；排空用 `finishAllScheduledFunctions(vi.runAllTimers)`，测延迟用 `advanceTimersByTime` + `finishInProgressScheduledFunctions`。
- 用 `t.withIdentity({ subject, issuer })` 得到确定的 `tokenIdentifier`，不要只给 name（subject 不可预测）。
- 断言错误用 `instanceof ConvexError` + `data.code`。
- 并发 / OCC 用例单列为"live-deployment"测试，不放进 convex-test 套件。

## 5. 可直接复用的代码清单（均在 SPIKE 下）
- `vitest.config.ts`、`tsconfig.json`、`package.json`
- `convex/test.setup.ts`（修正后的 glob）
- `convex/test.helpers.ts`（makeT / as / seed / countRows / scheduledJobs / rejectionOf / expectAppError）
- `convex/lib/auth.ts`（requireIdentity / requireUser / appError）
- `convex/users.ts`（幂等 ensureUser）
- `convex/execution.ts`（单入口先查后写 + 原子性；落地时把键改为服务端派生）
- `convex/approvals.ts`（by_proposal_user upsert；落地时改为只追加）
- `convex/runs.ts`（startRun → action → markRunning / commitRunResult 过期拒绝；stubModel）
- `convex/*.test.ts`（五组测试，可作 16-testing 模板）
- `convex/_generated/*.ts`（仅离线替身，真实项目用 codegen 产物）
- 原始测试输出：`test-output.txt`
