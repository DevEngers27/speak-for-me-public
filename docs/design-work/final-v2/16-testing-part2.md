# 16 · 测试策略（part2：工具链与配置、convex-test 基础设施）

> 分片列表见 `16-testing.md` 顶部。

## 16.3 工具链与配置

| 项 | 规定 | 依据 |
| --- | --- | --- |
| 版本 | `vitest 5.0.5`、`vite 8.3.5`、`convex-test 0.0.65`、`convex 1.48.0`、`zod 4.6.7`、`typescript 6.0.3`、`@playwright/test 1.64.0`、`@clerk/testing 2.2.45`、`@edge-runtime/vm`（devDependency，记为风险：长期未发版）、`@axe-core/playwright`；全部精确锁定 | canon D20；e2e-harness README |
| `convex` project | `environment: 'edge-runtime'`；`server.deps.inline: ['convex-test']`；`setupFiles: ['convex/test.setup.ts']`；`env`: `AGENT_MODE=live`、`AGENTS_ENABLED=true`、`ANTHROPIC_API_KEY=test-not-a-real-key`、`DEPLOYMENT_TIER=test`、`MODEL_FALLBACKS=false` | review r02 / r14；spikes §7 16 段 |
| 模块 glob | `convex/test.setup.ts` 位于 convex 根目录：`export const modules = import.meta.glob(['./**/*.*s', '!./**/*.*.*s'])`（文档里的 extglob 在 Vitest 5 下匹配 0 个文件） | canon D20；spike 证伪 |
| `_generated` | 提交入库；CI 跑 `convex codegen --system-udfs --typecheck disable` 后 `git diff --exit-code`（无组件，可离线） | canon D20、D01 |
| 计时 | `vi.useFakeTimers()`（`useFakeTimersForEachTest`）；推进只用 `drainDue` / `advanceScheduledTo`；convex-test 把每个事务时间钉在 max(假时钟, 上次提交时间)，边界断言用 `job.scheduledTime` | convex-test-utils README |
| 身份 | `defineRoles({ customer, provider, finance, outsider })`，`tokenIdentifier = <issuer>\|<subject>` 确定性生成；邮箱邀请用例给身份加 `email` / `emailVerified` | convex-test-utils；spike `withIdentity({subject, issuer})` |
| 错误断言 | `instanceof ConvexError` + `data.code`（`expectConvexErrorCode`）；不断言错误原文 | spikes §7 16 段；07 E7 |
| `returns` | convex-test 一律经 `api` / `internal` 引用调用函数（直接调 handler 会跳过 `returns` 校验）；任何返回值校验失败让测试失败 | techstack D12；07 §7.18 |
| 脚本 | `scripts/probes/*`、`scripts/evals-live/*` 用 `tsx`（锁版本），不依赖 Node 24 类型剥离（相对导入须带扩展名、不支持 enum / paths） | review r20 |
| 架构探针 | 故意违规的样例文件：`core ← convex` 导入、引擎内 `Date` / `Intl` / `Math.random` / `fetch` / `zod`、业务模块直接 import `mutation`、公共函数内 `console.log`、公开构造器可达的模块 import `opsLog`（只允许 `publicOpsLog`，07 §7.19 E1）、`convex/views/**` 对象展开——lint 必须各报一个 error；另有类型测试：给 `publicOpsLog` 传数值字段或自由字符串、在公开构造器的 ctx 上调用 `opsLog` 必须编译失败（`@ts-expect-error`） | canon D21；skeleton spike（5 个故意违规 5 个 error）；privacy-10 |

## 16.4 convex-test 基础设施

### 16.4.1 目录与命名

| 位置 | 内容 | project |
| --- | --- | --- |
| `core/engine/**/*.test.ts`、`core/scenarios/scope-change/**/*.test.ts` | 纯函数、类型测试（`*.test-d.ts`）、扫描器自测、fixture 自检 | `core` |
| `convex/**/*.test.ts` | 函数级用例 | `convex` |
| `convex/test/` | `roles.ts`、`seed.ts`、`scheduler.ts`（`drainDue`）、`scriptedModel.ts`、`canary.ts`、`reconcile.ts` | — |
| `evals/**` | 离线评测 runner、用例、录制 | `evals` |
| `src/**/*.test.tsx` | 组件（决策页模板、`SimulatedBadge`、按钮文案绑定版本） | `web` |
| `e2e/*.spec.ts` | Playwright 三身份用例 | Playwright |
| `scripts/probes/*.ts`、`scripts/mutation-check.ts` | L2 探针、变异检查 | `tsx` |

用例 ID：`TC-<领域>-<序号>`（与 07 §7.20 对应）；名称后缀 `[serial]`（只证明串行语义）、`[construct]`（§16.4.6）；来源标签 `CE-xxx`、`RA-Bxx`。

### 16.4.2 身份

```ts
// convex/test/roles.ts（foundation/convex-test-utils）
export const roles = defineRoles({
  customer: { email: "cus@example.test", emailVerified: true },
  provider: { email: "pro@example.test", emailVerified: true },
  finance:  { email: "fin@example.test", emailVerified: true },
  outsider: { email: "out@example.test", emailVerified: true },
});                                   // tokenIdentifier = "<issuer>|user_<name>"，确定性
export const as = bindRoles(roles);   // as(t, "finance").mutation(api.budget.setCap, …)；ANONYMOUS 为未登录
```

### 16.4.3 fixture 走生产写入口（canon D18）

```ts
// convex/test/seed.ts —— 与 seed.fromFixture 相同的调用链，只是身份来自 roles
export async function seedRoom(t: T, fx: ScopeChangeFixture, opts: {
  disclosures?: DisclosureConfig;           // 默认 fx.defaultDisclosures；披露配置扫描时逐一替换
  until?: "members" | "catalog" | "two_briefs" | "run_started";   // 默认 run_started
}): Promise<SeededRoom>;
// 1 users.ensureViewer ×4 → 2 as(customer).rooms.create({ myRole: "customer", … }) → 3 invites.create（邮箱）× 2 → 4 as(provider|finance).invites.accept
// 5 as(finance).ledger.recordBaseline(fx.ledgerBaselineCents) → 6 as(provider).catalog.confirm(fx.catalog)
// 7 for (const role of fx.confirmOrder) as(role).briefs.confirm(fx.briefs[role] + disclosures 按配置)
//   主 fixture 的 confirmOrder = ['provider', 'customer', 'finance']（14 §9.2），最后一份（finance）就绪 → openIfReady：open + 首个 run（04 M2）
```

- 确认顺序只读 `fx.confirmOrder`，不在测试里另写：它决定 `room_opened` / 首个 `run_started` 的 `actorUserId` 与 golden 事件序列（completeness-31）。
- 数字一律从 `core/scenarios/scope-change/fixtures.ts`（D27、14 §9.2 的字段名）推出，例如 `const headroomCents = fx.briefs.finance.hardFields.capCents - fx.ledgerBaselineCents`；测试里不写第二份 `100000`。
- 日期以相对锚点存储：测试把假时钟设到 `fx.anchor`（房间时区下当日），`rooms.localDate` 只经显式调用 `internal.clock.rollLocalDate` 推进。
- 节流 ⑥ 会计入 seed 的写入（每用户 ≤ 2 次）；需要更多约束变更的用例在批次之间把假时钟推进 1 小时，或专门断言限流本身（TC-AUTH-12）。每房间 24 小时总量桶（`price_writes` / 硬字段子桶 / `run_starts`，12 §12.2 第 7 条）同样可能计入 seed 与首个 run：断言总量桶的用例（TC-AUTH-13）先把假时钟推进 25 小时，让 seed 期计数滑出窗口，再从零开始计数；其余用例在 24 小时内的价格类目录变更合计 ≤ 3（`price_writes` 只在 `open` 期计数）、硬字段变更 ≤ 4、run ≤ 5（给 seed 的两份 setup 期硬字段确认与首个 run 留余量），超出即须改为显式断言限流。

### 16.4.4 调度推进

```ts
// convex/test/scheduler.ts
export async function drainDue(t: T, maxIterations = 50): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    vi.advanceTimersByTime(0);                       // 只让"现在到期"的任务启动（runAfter(0) 的 agents.runAttempt）
    await t.finishInProgressScheduledFunctions();    // 等它们跑完（action → turns.complete）
    const due = (await listScheduled(t, { state: "pending" })).filter((j) => j.scheduledTime <= Date.now());
    if (due.length === 0) { await expectNoFailedScheduled(t); return; }   // failed 的调度函数直接报错（防假绿）
  }
  throw new Error("drainDue: scheduler did not settle");
}
```

- 看门狗：`const [wd] = await listScheduled(t, { fn: internal.agents.watchdog, state: "pending" }); await advanceScheduledTo(t, wd.scheduledTime);`。重试延迟同理。
- "模型挂起"用脚本回复 `{ type: "hang" }`（永不 resolve 的 promise）：action 停在 inProgress，之后**不得**再调用 `finishInProgressScheduledFunctions`（会永远等待；convex-test 也取消不了 inProgress 函数），只推进到看门狗时间并断言其结论。
- cron（`clock.rollLocalDate`、人工请求到期）：设置假时钟后直接 `t.mutation(internal.clock.rollLocalDate, {})`；`convex/crons.ts` 的注册由静态测试检查。
- 禁止：带看门狗的链路使用 `vi.runAllTimers`、`finishAllScheduledFunctions(vi.runAllTimers)`、convex-test-utils 的 `drainScheduled`（它包的正是 `runAllTimers`；只允许用于无延迟任务的非代理链路）。

### 16.4.5 模型接缝 `callModel` 与脚本化响应

```ts
// convex/test/scriptedModel.ts
type ScriptedReply =
  | { type: "output"; turn: unknown }                       // 合法或故意非法的 { turn } 对象
  | { type: "raw"; text: string }                           // 非 JSON、半截 JSON、以金丝雀开头的非法 JSON
  | { type: "stop"; stopReason: "max_tokens" | "refusal" | "model_context_window_exceeded" }
  | { type: "error"; status: 400 | 401 | 429 | 500 | 529 }
  | { type: "hang" };
type ScriptStep = { expect: { role: RoleKey; turnKind: "propose" | "evaluate" }; reply: ScriptedReply;
                    beforeReturn?: () => Promise<void> };   // 例：模型"思考"期间 finance 降预算
type CallModelRequest = { body: ReturnType<typeof buildNegotiationRequest>;   // callModel 的入参：网关实现只接收 body
                          meta: { role: RoleKey; turnKind: "propose" | "evaluate"; attemptId: Id<"attempts"> } };   // meta 只供路由与测试断言，不进请求体
export const script = { queue: [] as ScriptStep[], recorded: [] as CallModelRequest[] };

vi.mock("../model/agents/modelGateway", () => ({         // convex/model/agents/modelGateway.ts（10 §10.14.1、canon D21）
  callModel: async (req: CallModelRequest) => {            // 唯一导出的接缝名（11 §11.3）
    script.recorded.push(req);                               // 隐私扫描面 S4：发往模型的完整请求体
    const step = script.queue.shift();
    if (!step) throw new Error("scripted model: queue exhausted");
    expect(req.meta).toMatchObject(step.expect);
    await step.beforeReturn?.();
    return toModelCallResult(step.reply);                    // 带 usage / stopReason / requestId，供 attempts 记账断言
  },
}));
afterEach(() => { expect(script.queue).toHaveLength(0); script.recorded.length = 0; });
```

- 默认 `AGENT_MODE=live`（假 key），脚本化模型才可达；stub 用例在 `runs.start` 之前 `vi.stubEnv("AGENT_MODE", "stub")`（run 开始时快照配置），并断言 `script.recorded.length === 0`。需要模型的用例断言 `script.recorded.length > 0`。
- `beforeReturn` 可以在 action 执行期间调用 `as(t, role).mutation(...)`：convex-test 的 action 在事务锁之外运行（review C4 源码推断，保留一次最小实验）。
- `replay` 驱动把 `evals/recordings/*.json`（只含 fixture 数据）载入同一队列。
- `vi.mock` 在 convex-test 模块图中生效：函数模块经 `import.meta.glob` 走 Vite 模块图，理论上成立（review C3）、待验证；退路是 10 的 `setDriverForTests`（只在 `DEPLOYMENT_TIER === 'test'` 时可用，注入 scripted / replay 驱动）——唯一允许的测试钩子，且不是 Convex 函数。
- `modelGateway` 自身的 L0 测试用真实 SDK 客户端 + 假 `fetch`（`baseURL: http://stub.invalid`）：请求体是封装函数内构造的新字面量；模型 `claude-opus-5-5`；显式 `output_config.effort: 'medium'`；`max_tokens: 16000`；走 `stream().finalMessage()`；SDK `maxRetries: 0`（非零值构造即抛 `GatewayConfigError`）；网关是唯一重试层：假 fetch 依次回 429 → 200 时恰发 2 次、`retry-after` 被遵从但退避 ≤ 8 s，连接错误同，408 / 409 / 500 / 529 只发 1 次；`stop_reason: max_tokens` 在同一次调用内重发 1 次，第二次截断返回 `retryable: false`、usage 为两次之和；用假时钟让总截止分别在发送前、退避等待中、发送中到期，三处都返回不可重试的 `model_timeout` 且之后不再发请求，总截止早于 `WATCHDOG_FIRST_MS`（10 R11、§10.10.1、§10.11）；永不发送 `thinking` / `temperature` / `top_p` / `top_k` / `tool_choice` / prefill；`fallbacks` 默认关；任何结局都记录 usage（canon D09；spike `type-tests.ts`、`stub-harness.ts` 改写成 vitest）。SDK 升级前先跑这组与参数 400 用例。

### 16.4.6 `[serial]` 与 `[construct]`

- `[serial]`：只证明串行幂等（状态守卫 + 键查重），报告不得写成"并发安全"：TC-EXE-01、TC-VER-11、TC-AUTH-05 的 L1 部分、`verifyQueryThenInsertDedup` 的 `burst` 步。对应的并发结论只能引用 L2 证据（§16.8）。
- `[construct]` 白名单（`t.run` 直接写表，只为测纵深守卫，每条注明被测守卫）：
  1. TC-RUN-03：不经 supersede 直接改 `rooms.constraintsVersion`，测 G3 + `runs.reconcile`；
  2. TC-VER-12：为同一用户插入第二个 `members` 行（绕过 D24），测 `evaluateApprovalSet` 的 userId 两两不同；
  3. CE-033：替换 finance 成员（v1 无此 API），测"当前成员"规则；
  4. 唯一写入口的 `bypass` 步：在入口背后插入重复键，入口必须以 `.unique()` 失败关闭（convex-test-utils `verifyQueryThenInsertDedup`），覆盖 `members`、`approvals`（同人同提案同版本）、`executions.by_executionKey`、`tasks.taskKey`、`runs`（单活跃）。
- 白名单之外出现 `t.run(…insert/patch…)` 由静态测试报错。
