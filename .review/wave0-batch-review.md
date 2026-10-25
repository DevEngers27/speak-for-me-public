# Wave-0 批次代码审查

审查范围是 `git diff e2f99d0...HEAD -- . ':!docs' ':!lab'`。`core/engine/{reasonCodes,stateMachines,actions,strictSchema}.ts` 与 `convex/lib/validators.ts` 不在本批。对照 canon §1.1–§1.6、D09、D11、D13、D16、D20–D22、D25、D27，以及 `11-architecture.md`、`16-testing.md` §16.1、`14-scenario-scope-change.md` §4 §5 §9。

## 总评

地基的分层、锁定版本和无密钥检查是可运行的。`npx --yes pnpm@11.25.0 test` 通过：第一段 Vitest 收集 51 个文件（18 个有断言通过，33 个只有 `it.todo`、被记为 skipped），加上 `scripts/tooling.test.ts` 与 `e2e/harness.test.ts`，共 53 个 Vitest 文件；`find` 到的第 54 个是 Playwright 的 `e2e/smoke/smoke.spec.ts`，只在 CI 的 e2e job 有密钥时运行。用例合计 159 passed、253 todo。

金额、历法日期、`canonicalJson`、键派生和 D27 主数字与 §14 的修正一致，依赖目录与 CI 漂移检查也按 D20 落地。会直接被下一波当契约抄走的几处已经偏了，而且测试把偏差锁住：`max_tokens` 不重试、HTTP 重试叠了 SDK 与网关两层且没有早于看门狗的截止信号、调度 helper 默认 `runAllTimers`、场景键 `scope_change` 与 `scope-change` 分裂、公共模板仍能把自由字符串原样拼进他方文本并在错误里回显原值。电池 253 条不会失败，绿色不能证明 CE-001…CE-175。

## 问题

### W0R-01 high · model-gateway

`convex/lib/modelGateway.ts:2407`

D09 规定 `stop_reason === 'max_tokens'` 记为 `output.truncated` 并重试一次。`callModel` 在记录 usage 之后直接返回，`retryable` 为 false，循环不会进入下一次 attempt。`refusal` 与 `model_context_window_exceeded` 不重试，这一点与 D09 一致；被截断的输出却被当成终局失败。

证据：

```ts
if (stopReason === 'max_tokens') {
  // ...
  return Object.freeze({
    ok: false,
    kind: 'output.truncated',
    reasonCode: 'output.truncated',
    retryable: false,
```

`convex/lib/modelGateway.test.ts:314` 写着 `expect(result.retryable).toBe(false)`，回归会保护这个偏差。

建议：截断时在同一 `callModel` 内再发一次，第二次仍是 `max_tokens` 才返回 `output.truncated`。把测试改成断言第二次调用发生，并且第一次的 usage / requestId 已记入 `attemptLogs`。

### W0R-02 high · model-gateway

`convex/lib/modelGateway.ts:41`、`convex/lib/modelGateway.ts:80`、`convex/lib/modelGateway.ts:1322`、`convex/lib/modelGateway.ts:2291`

预算注释把 448_000 ms 解释成「一次 SDK 重试」：`2 * 220s + 8s`。实现同时有两层重试。`DEFAULT_MAX_RETRIES` 等于 `SDK_MAX_RETRIES`（都是 1）。`anthropicTransport` 把 `maxRetries: 1` 交给 `client.messages.stream`，`callModel` 又在 `classifyError` 判定可重试时再跑一轮。可重试集合包括 429、408、409、500–599、529、超时和连接错误，宽于 D09 的「只覆盖 429 / 连接错误」。Anthropic SDK 的 timeout 按单次请求计，一次 `send()` 可以到 `(1 + sdkMaxRetries) * 220s = 440s`，网关再来一轮则接近 880s，超过 Convex action 的 600s，也晚于 `WATCHDOG_FIRST_MS`（275_000）。`callModel` 只在 attempt 开始前看剩余预算，并把 `params.signal` 原样传下去，没有把总截止做成 AbortSignal。D09 要求总截止早于看门狗。

证据：

```ts
export const SDK_MAX_RETRIES = 1 as const;
export const DEFAULT_MAX_RETRIES = SDK_MAX_RETRIES;
// anthropicTransport
maxRetries: sdkMaxRetries,
// callModel
const canRetry = classified.retryable && attemptIdx < maxRetries;
```

`createFetchStreamClient`（`convex/lib/modelGateway.ts:1508`）读了 `streamOpts.signal`，没有用 `streamOpts.timeout`，这条测试传输本身也不强制截止。

建议：只保留一层重试，范围收成 429 与连接错误。`max_tokens` 的那一次重试单独计数。进入 `send` 之前用 `AbortSignal` 把剩余预算和调用方 signal 联在一起，截止早于 275s 的看门狗。`CALL_DEADLINE_MS` 按真实的尝试次数重算。

### W0R-03 high · scheduler

`convex/test/helpers.ts:360`

TD-05 要求调度只通过 `drainDue` 推进当前到期任务，并禁止在带看门狗的链路上使用 `vi.runAllTimers` 与 `finishAllScheduledFunctions(vi.runAllTimers)`。被否决的备选就是 foundation 里的 `drainScheduled`，因为它包的正是 `runAllTimers`。仓库里没有 `drainDue`。交付的 helper 仍叫 `drainScheduled`，默认时钟就是 `clock.runAllTimers()`。`advanceScheduledBy` / `advanceScheduledTo` 的逐步推进是对的，默认排空路径会把 0ms 的 action 和看门狗同时跑起来，后续用例会得到 spike 已经证伪的假绿。

证据：

```ts
await t.finishAllScheduledFunctions(
  resolved.advanceTimers ?? (() => clock.runAllTimers()),
  resolved.maxIterations ?? 100,
);
```

建议：默认改为循环 `advanceTimersByTime(0)` + `finishInProgressScheduledFunctions`，直到没有到期任务；失败的调度函数继续抛错。看门狗用例只调用 `advanceScheduledTo(scheduledTime)`。名字用 `drainDue`。

### W0R-04 high · fixtures

`core/scenarios/scope-change/fixtures/main.ts:29`、`core/scenarios/scope-change/index.ts:4`、`convex/lib/fixtureSchema.ts:162`、`core/engine/plugin.ts:12`

§14 与 D27 的场景键是 `scope_change`（目录名按 D21 用 `scope-change`）。fixture 的 `room.scenarioKey` 是 `"scope_change"`。插件 id、`health.ping` 返回值和 `defineScenario` / `ScenarioFixtureShape.scenarioKey` 的正则都是 `^[a-z][a-z0-9-]*$`，这个正则拒绝下划线，所以插件被写成 `"scope-change"`。`health.test.ts:14` 把 `"scope-change"` 锁成了公开探针的场景列表。通用 `loadFixture` 还要求 `schemaVersion`、`members`、`constraintSets`、`steps`，D27 的 `ScopeChangeFixture` 没有这些字段。没有任何测试把 `main` 送进 `loadFixture`，两套 fixture 对不上也不会红。

证据：

```ts
scenarioKey: "scope_change",
export const scopeChangePlugin = defineScenario({ id: "scope-change", ... });
scenarioKey: z.string().regex(/^[a-z][a-z0-9-]*$/),
if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) throw new Error(...);
```

建议：运行时键统一为 `scope_change`，目录名保持 `scope-change`。正则允许这一个下划线形式，或单独的 `SCENARIO_KEY` 常量同时被插件、fixture、`health.ping` 和 schema 引用。补一条 `loadFixture`（或明确的适配器）必须接受 `main` 的测试。

### W0R-05 high · public-text

`core/engine/publicText.ts:1239`、`core/engine/publicText.ts:427`

D13 要求对他方可见的文本只从白名单结构化字段渲染，参数类型不含自由 `string`。`definePublicTemplate` 只在 `kind === 'text'` 时拒绝。`slot.token` 的 kind 是 `'token'`，正则只要用 `^` / `$` 锚定即可。`/^[\s\S]{1,80}$/` 或 `^.+$` 会把任意单行（含 `<>`）原样返回，渲染循环再把它拼进句子，不经过 `wrapUntrusted`。内置 `PUBLIC_TEMPLATES` 目前用的是 `ITEM_KEY_RE`，样例本身是安全的；门禁挡不住下一次模板。`slot.list` 包住 `slot.text` 时会把 kind 标成 `'text'` 从而被拒绝，单层 `slot.token` 没有同等处理。

证据：

```ts
if ((specCandidate.kind as string) === 'text') {
  throw new TemplateRenderError('DISALLOWED_PUBLIC_SLOT_KIND', ...);
}
// slot.token render
return value;
```

建议：公共槽只保留 enum、金额、日期、整数、`ItemKey` 和已渲染 `Fragment`。`token` 若留下，模式必须来自封闭的正则表，并且输出再走与标题相同的转义。标题不要作为裸插值进入模板。

### W0R-06 high · public-text

`core/engine/publicText.ts:122`、`core/engine/publicText.ts:132`、`core/engine/publicText.ts:181`

`money.ts` 的错误故意不回显金额。`publicCents`、`isoDate` 和各个 `failSlot` 把原值写进 `RangeError` / `TemplateRenderError.message`（`got ${String(value)}`、`JSON.stringify(value)`）。一个没过槽位的私密备注或金额会留在异常消息里；`withSanitizedErrors` 尚未接到构造器上，这条消息就是 D16 要挡住的那一层。

同一文件的标尺也和引擎不一致。`MAX_SAFE_CENTS` 是 `Number.MAX_SAFE_INTEGER`，canon 的 `assertCents` 上限是 `1e11`。`isCalendarDate` 只接受 1900–2100，`core/engine/dates.ts` 接受 0000-01-01..9999-12-31，而 `dates.ts:9` 写明旧原型里两套校验不一致是已经修掉的问题。`formatUsdCents` 不拒绝非整数：`-150` 会格式化成带负余数的字符串。槽位在调用它之前做了检查，直接导出的函数没有。

证据：

```ts
throw new RangeError(`PublicCents must be a safe non-negative integer, got ${String(value)}`);
if (year < 1900 || year > 2100) return false;
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;
```

建议：公共金额走 `assertCents`，日期走 `core/engine/dates.ts` 的 `parseIsoDate`。失败消息只留槽名和错误码。删除 `publicText.ts` 里的第二套历法。

### W0R-07 medium · model-gateway

`convex/lib/modelGateway.ts:36`、`convex/lib/modelGateway.ts:468`、`convex/lib/modelGateway.ts:577`、`convex/lib/modelGateway.ts:733`、`convex/lib/modelGateway.ts:1549`

顶层白名单拒绝了 `thinking`、`temperature`、`top_p`、`top_k`、`tools`、`tool_choice`、`stop_sequences` 和 assistant prefill，最后一条消息必须是 `user`。协商回合仍未钉死 D09 的 `effort: 'medium'`：`EFFORT_LEVELS` 含 `low | medium | high | max`，`buildRequest` 接受调用方的 `effort`，`extraBody` 在校验前展开，可以换掉整个 `output_config`。`max_tokens` 允许 `1..16000`，不是固定的 16000。`system` 为数组时只检查 `cache_control`，不要求文本块。`messages[]` 上除 `role` / `content` 以外的字段会原样留下。

`createFetchStreamClient` 把响应体放进异常消息：`` `HTTP ${res.status}: ${rawText}` ``。`classifyError` 的 `detail` 没有抄 `err.message`，但 `GatewayAPIError.message` 和 `detectContextOverflowHint` 读到的仍是可能回显请求的原文。

建议：协商请求在 `assertWhitelisted` 里要求 `effort === 'medium'` 且 `max_tokens === 16000`。序列化前把 system / messages 收成文本块加允许的 `cache_control`。HTTP 错误体只留状态码和安全的 `type` 标记。

### W0R-08 medium · canon-names

`convex/lib/modelGateway.ts:1771`、`convex/lib/modelGateway.ts:2055`、`core/engine/publicText.ts:1468`

TD-03 的接缝是 `convex/agents/modelGateway.ts` 的 `callNegotiationModel`（架构写在 `convex/model/agents/modelGateway.ts`）。现有导出是 `convex/lib/modelGateway.ts` 的 `callModel` / `callStructured`。§1.3 的 attempt 状态是 `running | completed | invalid_output | timeout | error | refused | stale`。网关使用 `succeeded` 和 `aborted`，并另造 `model.aborted`、`model.timeout`、`model.rate_limit` 等，不在 §1.5 的 `output.*` / `run.*` 里。

`PUBLIC_TEMPLATES` 的提案状态是 `draft | pending_review | countered | accepted`，决定是 `approved | declined | escalated`。§1.3 的提案状态是 `active | executed | superseded | rejected | stale`，审批决定是 `approve | reject | withdraw`。文件注释写 Canon-aligned。样例会被下一波模板抄走。

建议：对外只导出 `callNegotiationModel`，路径与 TD-03 一致；`succeeded` 改为 `completed`。样例枚举改成 §1.3 的存储状态。传输层码若必须留下，不要冒充 `reasonCode`。

### W0R-09 medium · tests

`tests/battery/pure/01-privacy-delegation.test.ts:3`、`tests/scenario/arithmetic.test.ts:67`、`tests/scenario/arithmetic.test.ts:101`、`tests/battery/index.ts:2657`

33 个电池文件全部是 `it.todo`，Vitest 把这些文件记为 skipped（253 todo）。它们不能失败。`reconcileBattery` 只检查 CE 的 `covers` 是否指向已知 INV、空 covers、以及 allowlist 之外的 INV 是否至少被一条 CE 点名，再把 `it.todo` 标题和注册表做字符串对齐。INV 自己的 `covers` 是自身 id，不参与覆盖计算。对账发现不了「CE 的期望与 canon 相反」。

`arithmetic.test.ts` 里有两条不依赖产品代码的断言：`expect(Math.max(14, 11) - 4).toBe(10)` 和 `expect(480_000 - 480_000).toBe(0)`。同一文件里对目录求和、`effectiveLeadDays` 和 D27 边界（480_000 恰好放下、479_999 超出 1 分、470_000 超出 10_000）的检查是有效的。

建议：删掉自比字面量。电池按章把 `it.todo` 换成会失败的断言；在那之前 CI 摘要应把 todo 数当成未覆盖，而不是通过。

### W0R-10 medium · tooling

`vitest.config.ts:27`、`package.json:19`、`tests/vitest.config.ts:2`

`pnpm test` 收集了范围内全部 Vitest 文件，对照如下。

| 位置 | find | `pnpm test` |
| --- | --- | --- |
| `core/**/*.test.ts` | 8 | 8，在 core project |
| `convex/**/*.test.ts` | 3 | 3，在 convex project |
| `tests/**` | 40 | 40（foundation 2 由 `tests/vitest.config.ts` 追加；pure/convex/real-deploy/e2e/scenario 在根配置里） |
| `scripts/**/*.test.ts` | 1 | 1，独立 config |
| `e2e/**/*.test.ts` | 1 | 1，独立 config |
| `e2e/smoke/smoke.spec.ts` | 1 | 不在 `pnpm test` 内，由 Playwright `--project=smoke` 跑 |

51 个文件里 18 passed、33 skipped，与「只有 todo 的电池文件」数量一致。TD-01 的四个 project（core / convex / evals / web）没有落成：没有 evals，没有 jsdom 的 web project。`tests/battery/real-deploy/**` 和 `tests/battery/e2e/**/*.spec.ts` 挂在 node 的 core project 上。它们今天是 todo；一旦写成真实探针，`pnpm test` 会在无密钥的 PR 里访问网络或假装跑了浏览器。TD-01 要求 `pnpm test` 不访问网络。

`test:watch` 是裸的 `vitest`，只读根 `vitest.config.ts`，不会跑 foundation、scripts、e2e harness。`tests/vitest.config.ts:2` 用无扩展名 `import "../vitest.config"`，本次运行已打印 Vite native config loader 的未来不兼容警告。

建议：real-deploy 与 Playwright spec 移出默认 project。`test:watch` 与 `test` 使用同一组 config。给 import 补上 `.ts`。

### W0R-11 medium · tooling

`convex/_generated/api.d.ts:20`、`convex/engine/health.ts:2`、`core/engine/index.ts:5`、`eslint.config.mjs:16`

`11-architecture-part4` 写明测试工具不要放进 `convex/`，否则会被当成函数模块打包。`convex codegen` 的结果已经 `import type * as test_helpers from "../test/helpers.js"`，并放进 `ApiFromModules`。`convex/test.setup.ts` 的 glob `['./**/*.*s', '!./**/*.*.*s']` 排除了 `*.test.ts`，留下了 `helpers.ts`。

A3 要求函数只经带 `withSanitizedErrors` 的构造器，lint 禁止其它文件导入原始 `query` / `mutation` / `action`。`eslint.config.mjs` 没有这条规则。`health.ping` / `health.whoami` 直接 `import { query } from "../_generated/server"`。`core/engine/index.ts` 只导出插件和 `ENGINE_VERSION`；`convex/lib/errors.ts` 深路径导入 `core/engine/dates` 与 `money`。§11.3 说 `index.ts` 是对 `convex/` 的唯一出口，这条没有 lint。

建议：测试 helper 挪到 `convex/` 之外，重新 codegen，确认 `api.d.ts` 不再引用 `test/helpers`。补上原始 `query` 导入的 restricted-import。桶文件再导出引擎纯函数，或改文档承认深路径。

### W0R-12 medium · projection

`core/engine/projection.ts:45`、`core/engine/projection.ts:169`、`core/engine/projection.ts:590`、`convex/lib/fixtureSchema.ts:91`

`markProjected` 只递归冻结，不检查字段是否已按角色裁过，然后把对象放进 `projectedObjects`。`copyListedKeys` 见到该集合就整对象返回。把仍含他方金额的对象先 `markProjected`，再作为父 DTO 的一个字段，投影会把它嵌进去。

`wrapUntrusted` 的默认 `maxChars` 是 2000，换行被收成 `\n` 后保留。D13 允许进入他方上下文的人写字符串只有目录 `title`：≤ 80 码点，且匹配 `^[^<>\r\n]+$`，并放在定界块里。定界和 `<>` 转义是有的；80 码点与拒绝换行要调用方自己传。`fixtureSchema` 的 `CatalogItem.title` 用的是最长 200 的 `Label`，`<` 和换行都能过。

证据：

```ts
if (projectedObjects.has(value)) return value;
maxChars: 2_000,
title: Label, // min 1, max 200, regex /\S/
```

建议：`markProjected` 只接受已经由 `pickExact` / `projectForRole` 产出的对象。标题走单独的 `wrapCatalogTitle`：码点 ≤ 80，拒绝 `\r` / `\n` / `<>`，再包 `<untrusted_data>`。

### W0R-13 low · hygiene

`README.md:33`、`scripts/cooldown-exceptions.json:3`、`tests/vitest.config.ts:2`

README 把 `core/scenarios/scope-change/` 写成 Placeholder scenario plugin。该目录已包含 D27 的目录、变体和金丝雀，新读者会以为数字还没定。冷却例外清单里每一项的 `expires` 都是 `2026-10-31`（今天是 2026-10-24）。`policy:check` 在那天之后会让全部例外同时失效，CI 变红。生成脚本把同一个七天到期日写给 lockfile 里的每一个包。

建议：README 改成「场景 fixture 与插件壳已在，规则引擎尚未接入」。例外按包写到期日，并在 README 的 `policy:check` 一句里说明到期后要 `--generate`。

## 优点

- `money.ts` 用 bigint 做乘、比例和最大余数分配，`assertCents` 上限 `1e11`，错误不回显金额，测试会重校验被擦掉的品牌并覆盖 half-even。
- `dates.ts` 不构造 `Date`、不用 `Intl`，历法往返和 `2028-02-29`、纪元前的 `isoDateFromEpochMs` 有断言。锚点 `2026-11-02` 加 18 天是 `2026-11-20`。
- `canonicalJson` 按 UTF-16 码元排序，省略对象里的 `undefined`，拒绝 NaN、稀疏数组、循环和非普通对象，与 D25 的 `termsKey` 用法一致。
- `executionKey` / `taskKey` / `candidateKey` 是明文分段，`['REPORTS','LOGIN']` 得到 `LOGIN+REPORTS@rush`，没有哈希，也没有把 constraintsVersion 编进执行键。
- D27 数字在 fixture 与 `tests/scenario` 里闭合：五项合计 140_000，必需项 80_000，加 `usage_dashboard` 为 90_000；上限 500_000，基线 400_000；降到 480_000 时 90_000 为 `budget.over`、80_000 恰好 `budget.fits`；479_999 超出 1 分；470_000 不可行；390_000 为 `budget.below_committed`。金丝雀 512_347 / 481_237 / 400_219 的 headroom 与执行后余额自洽。审批失效条数是 2，与 §14 对 D27「3 条」的修正一致（下调前只有 customer 与 provider 两票）。
- 依赖为 catalog 精确版本，`minimumReleaseAge: 10080`，`allowBuilds` 只有 esbuild 与 unrs-resolver。CI 在无密钥下做 codegen 漂移、`policy:check`、lint、typecheck、test、build；e2e 缺密钥时跳过浏览器安装。
- `convex/lib/errors.ts` 未标受众的参数不出网，provider 即使被写进 audiences 也拿不到 `overByCents`、`headroomCents`、`deadline`。`seed` / `reset` 需 `--yes`，破坏性操作拒绝 prod 并核对部署名。
- 引擎纯度的 12 条故意违规被 `check-boundaries` 拒绝；`core/engine` 内没有 zod、convex 或 `Date` 的导入。

## 建议的后续任务

1. 按 D09 改 `callModel`：`max_tokens` 重试一次；HTTP 只重试 429 与连接错误；总截止 AbortSignal 早于看门狗。删掉把 `retryable: false` 锁死的断言。
2. 实现 `drainDue`，禁止默认 `runAllTimers`。
3. 统一 `scenarioKey`，并让通用 fixture 加载器接受 `main`。
4. 收紧公共槽，错误消息不带原值，标题单独定界且 ≤ 80 码点。
5. 把 `convex/test/helpers.ts` 移出部署图并重新 codegen；lint 禁止构造器以外的 `query`。
6. 电池从 `it.todo` 改成会失败的用例；real-deploy 与 Playwright 不要挂在默认 `pnpm test` 的 node project 上。
