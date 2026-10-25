# 11 · 系统架构（part3）：Convex 工程约定、codegen、版本与 CI、环境与配置

## 11.8 Convex 工程约定与 codegen

**tsconfig**（skeleton 实测可用）：

```jsonc
// convex/tsconfig.json —— Convex 模板 + 两处修改
{ "compilerOptions": {
    "allowJs": true, "strict": true, "moduleResolution": "Bundler", "jsx": "react-jsx",
    "skipLibCheck": true, "allowSyntheticDefaultImports": true, "noUncheckedIndexedAccess": true,
    "target": "ESNext", "lib": ["ES2023", "dom"], "forceConsistentCasingInFileNames": true,
    "module": "ESNext", "isolatedModules": true, "noEmit": true,
    "types": ["node"],                       // TS 6 的 types 默认 []；auth.config.ts 读 process.env 需要它（TS2591 实测）
    "paths": { "@core/*": ["../core/*"] } },  // Convex esbuild 自动读取（打包回放 errors: 0）
  "include": ["./**/*", "../core/**/*"], "exclude": ["./_generated"] }
```

根 `tsconfig.json` 覆盖 `src/`、`core/` 与根目录配置文件，`exclude: ["convex"]`，`paths` 为 `@/*`、`@core/*`、`@convex/*`；`strict` + `noUncheckedIndexedAccess`。类型检查跑两次：`tsc --noEmit -p tsconfig.json && tsc --noEmit -p convex/tsconfig.json`。

**codegen 与漂移检查**（D20，依赖 D01 的"无组件"）：
- `convex/_generated/` 提交入库，CI 无部署凭据也能 typecheck 与跑 convex-test（缺 `_generated` 时 convex-test 直接抛错）。
- `pnpm convex:codegen:offline` = `convex codegen --system-udfs --typecheck disable`（隐藏参数，走 `doCodegen`，不需要部署）；CI 执行后 `git diff --exit-code -- convex/_generated`。spike 两次运行 `diff -r` 无差异。
- 这一条只在"应用不含 Convex 组件"时成立；将来引入任何组件（例如 D01 的 workpool 升级触发条件出现时）必须先重新设计 CI 漂移检查（连接 dev 部署，或 `gen-generated.mjs` 按模板生成），写进对应 ADR。
- 真实部署的 codegen 产物与离线产物是否一致，列入 spikes §8 #8，实现第 1 周验证（U11）。

**convex-test 模块表**（D20）：`convex/test.setup.ts` 用 `import.meta.glob(["./**/*.*s", "!./**/*.*.*s"])`。Convex 文档的 extglob 写法在 Vite 8 下匹配 0 个文件（spike 实测）；该模式排除 `test.setup.ts`、`*.test.ts`、`_generated/*.d.ts`，保留 `_generated/api.js`。vitest 的 convex project：`environment: "edge-runtime"`（devDependency `@edge-runtime/vm` 5.0.0，记为风险：23 个月未发版），`server.deps.inline: ["convex-test"]`。

**函数与运行时约定**：
1. 函数文件按领域命名，导出名即动作；客户端引用 `api.rooms.create`。`convex/` 内不出现连字符目录。
2. 引用同一 API 图的 handler 写显式返回类型，避开 TS7022 / TS7023（spike 注意项）。
3. 数据库调用用"表名在前"的新签名 `ctx.db.get("rooms", id)`（inputs/04 §1.1）；由写门面统一封装 patch。
4. 事务内复用逻辑写成普通 helper（`convex/model/*`），不用 mutation 内的 `ctx.runMutation` / `ctx.runQuery`（有参数校验与隔离上下文开销，inputs/04 §1.1）。
5. 默认 isolate 运行时；**不写 `"use node"`**。`agents.runAttempt` 与 `agents.watchdog`、`agents.loadTurnContext` 同住 `convex/agents.ts`（实现细节在 `convex/model/agents/`），因为 `"use node"` 文件只能定义 action（inputs/04 §1.2）。SDK 1.1.0 显式传 `apiKey` 时可在默认运行时打包，但流式长连接在默认运行时的行为待验证；若验证失败，把 `runAttempt` 移到 `convex/agentsNode.ts`（函数名随之变为 `agentsNode.runAttempt`，在 18 记录）。
6. Zod 只在 Convex 边界使用：`convex/model/agents/outputSchema.ts`（按 `(role, turnKind, n)` 从 `core/engine/protocol` 的 `TurnSpec` 构造 Zod schema，再用 Zod 4 的 JSON Schema 导出交给 `core/engine/strictSchema.ts` 的 `toStrictOutputSchema` 做纯变换）、`convex/lib/config.ts`、`convex/lib/fieldSpec.ts`、fixture 加载器。这样同时满足 D09（strict schema 生成器住在 `core/engine/strictSchema.ts`，保留 `enum` / `const`）与 D21（`core` 不 import Zod）。Zod 进入函数包后的体积与冷启动待验证（§8 #7）。
7. 场景简报字段在 `core/scenarios/scope-change/fields.ts` 以纯数据 `FieldSpec` 声明（类型、范围、是否硬约束、可披露受众）；`convex/lib/fieldSpec.ts` 把它转换成 `v.*` validator（mutation 入参）与 Zod（若需要）。`core` 不依赖 `convex/values`。

## 11.9 依赖版本与 CI

**版本基线**（D20，spikes B10 实测可装可建，全部精确锁定、经根 `catalog:` 统一）：`next 16.4.3`、`react` / `react-dom 19.3.1`、`convex 1.48.0`、`@clerk/nextjs 7.9.20`、`typescript 6.0.3`、`eslint 9.39.5` + `eslint-config-next 16.4.3`、`vitest 5.0.5`、`vite 8.3.5`、`zod 4.6.7`、`convex-test 0.0.65`、`@edge-runtime/vm 5.0.0`、`@anthropic-ai/sdk 1.1.0`、`@types/node 24.19.2`、`server-only 0.0.1`、`pnpm 11.25.0`、Node `>=24.19.0 <25`。React 小版本随 Clerk 的 peer（`~19.3.0-0`）同步升级。

**本章在基线之上新增**（每项写明理由，版本在实现当天按冷却规则确定）：`convex-helpers 0.1.128`（构造器，techstack D08）；dev-tooling 的 `eslint-plugin-boundaries 7.2.0`、`eslint-import-resolver-typescript 4.4.5`、`@typescript-eslint/parser 8.71.1` 与 `overrides: { handlebars: 4.7.10 }`（boundaries 7.2.0 钉的 4.7.9 有严重公告）；`tsx`（`scripts/` 运行器：Node 24 原生类型剥离不读 `paths`、不支持 `enum`，testing-ops review r20）。16 / 15 章另行引入 `@playwright/test 1.64.x` + `@clerk/testing`、`@sentry/nextjs 11.6.0`。不引入 lefthook（安装脚本需进 `allowBuilds`，与 D20 的白名单冲突；CI 才是门禁）。

**`pnpm-workspace.yaml`**（单包，只承载安装策略）：

```yaml
catalog: { next: 16.4.3, react: 19.3.1, convex: 1.48.0, "@clerk/nextjs": 7.9.20, zod: 4.6.7,
           typescript: 6.0.3, "@anthropic-ai/sdk": 1.1.0 }      # 其余同理
minimumReleaseAge: 10080            # 7 天；显式设置 ⇒ strict
minimumReleaseAgeExclude: []        # 由 scripts/gen-release-age-excludes.ts 从 lockfile 生成，每条带"原因 + 到期日"
allowBuilds: { esbuild: true, unrs-resolver: true, sharp: false }
overrides: { handlebars: 4.7.10 }
```

`.npmrc`：`save-exact=true`、`engine-strict=true`。strict 冷却只拦精确锁定；以范围声明的传递依赖会静默退到更旧版本，可以接受（techstack X1）。

**scripts**（`package.json`）：

```jsonc
"lint": "eslint --max-warnings=0 .",
"lint:fixtures": "node tooling/dev-tooling/src/eslint/lint-fixtures-cli.ts",
"arch:check": "tsx scripts/arch-check.ts",               // §11.5 的 grep 与 convex.json 断言
"deps:check": "tsx scripts/check-release-age-excludes.ts", // 例外清单到期即失败
"typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p convex/tsconfig.json",
"test": "vitest run --project core --project convex --project web",
"test:evals": "vitest run --project evals",
"test:e2e": "playwright test",
"build": "next build",
"check": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
"convex:codegen:offline": "convex codegen --system-udfs --typecheck disable",
"env:check": "node --env-file-if-exists=.env.local tooling/dev-tooling/src/scripts/check-env-cli.ts",
"ops": "node --env-file-if-exists=.env.local tooling/dev-tooling/src/scripts/convex-ops-cli.ts"
```

**PR 闸门**（`.github/workflows/ci.yml`，无任何 secret，skeleton 工作流的超集）：checkout → setup-node（`.node-version`）→ `pnpm@11.25.0 install --frozen-lockfile` → codegen 漂移检查 → `deps:check` → `lint` → `lint:fixtures` → `arch:check` → `typecheck` → `test` → `build`。`permissions: contents: read`；`NEXT_TELEMETRY_DISABLED=1`、`CLERK_TELEMETRY_DISABLED=1`；第三方 Action 锁完整 commit SHA。其余工作流（预览部署 E2E、发布、夜间探针）属于运维，见 15 §15.4。

## 11.10 环境与配置

| 变量 | 所在 | 浏览器可见 | 读取方 | 缺失或非法时 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | 托管平台构建环境（由 `convex deploy --cmd-url-env-var-name` 注入） | 是 | `src/lib/config.ts` | 不创建 `ConvexReactClient`，横幅列出缺失变量名 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 托管平台 | 是 | 同上、`src/lib/clerk-env.ts` | 同上；`/rooms(.*)` 307 到 `/setup?missing=clerk` |
| `CLERK_SECRET_KEY` | 托管平台（仅服务端） | 否 | `proxy.ts`、`config.ts` | 同上；永不进入客户端 chunk（spike：0 次出现） |
| `NEXT_PUBLIC_DEPLOYMENT_TIER`、`NEXT_PUBLIC_SENTRY_DSN` | 托管平台 | 是 | Sentry 初始化（15） | 缺 DSN 则不上报 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex 部署环境变量 | 否 | `convex/auth.config.ts` | 模块加载即抛错，推送失败（fail closed；报错形态待验证 §8 #12） |
| `DEPLOYMENT_TIER` | Convex | 否 | `convex/lib/config.ts`、`assertTier` | `dev` / `preview` / `prod`（convex-test 中为 `test`）；缺失时所有受守护的内部函数拒绝执行，`ops.configHealth` 报告 |
| `AGENT_MODE` | Convex | 否 | run 创建时快照进 `runs.agentMode` | 缺省 `stub`；`DEPLOYMENT_TIER=preview` 时只接受 `stub` |
| `AGENTS_ENABLED` | Convex | 否 | `agents.runAttempt` 调模型前 | 只作紧急止血：关闭即 live attempt `error(agents_disabled)`；stub 不受影响（D17） |
| `ANTHROPIC_API_KEY` | Convex（每层不同 workspace；preview 不设） | 否 | 只在 `convex/model/agents/modelGateway.ts` | live 模式缺 key → attempt `error(config_invalid)`，不发请求 |
| `MODEL_FALLBACKS` | Convex | 否 | `modelGateway` | 缺省关（D09） |
| `E2E_CUSTOMER_SUBJECT` / `E2E_PROVIDER_SUBJECT` / `E2E_FINANCE_SUBJECT` | Convex（仅 dev / preview） | 否 | `seed.fromFixture` 拼 `tokenIdentifier` | 缺失时 seed 用合成身份（只能经 CLI `--identity` 驱动） |
| `CONVEX_DEPLOY_KEY` / `CONVEX_DEPLOYMENT` | CI 与托管平台 / 本地 `.env.local` | 否 | Convex CLI | — |

- **配置只经一处解析**：`convex/lib/config.ts` 用 Zod 白名单解析上表的 Convex 变量，返回类型化对象；非法值只报"哪个变量非法"，从不打印值。`agents.runAttempt` 首次调用时校验 `AGENT_MODE` / key / tier 的组合，失败写 `opsLog("config_invalid", { field })` 并让 attempt 进入 `error`，不尝试调用（testing-ops §4.2）。运行时开关不建表、不用开关 SaaS（techstack D33）；唯一的数据库开关是 `opsFlags.draining`（D17，事务内可见，不依赖环境变量生效时机）。
- **`assertTier(ctx, allowed, opts?)`**（async，调用方一律 `await`）：读 `DEPLOYMENT_TIER` 与 `(await ctx.meta.getDeploymentMetadata()).name`（`ctx.meta` 的方法返回 Promise，`getTransactionMetrics()` 同理；部署名形如 `tall-tiger-123`，元数据不含部署类型，所以仍需 `DEPLOYMENT_TIER`）；破坏性函数另要求参数 `confirmDeployment` 等于部署名（D18）。判定拆成注入元数据的纯函数做单测，真实元数据适配器另做集成测试；不为生产增加覆盖用的环境变量。
- **Next 侧 fail closed**：`src/lib/config.ts`（`server-only`）返回 `configured | unconfigured(missing[])`；根布局 A 只在三项齐全时渲染 `<ClerkProvider publishableKey>` → `<ConvexClientProvider>`，否则不创建 Convex 客户端、显示缺失变量名横幅；使用 Convex hook 的组件包在 `BackendGate` 里。`publishableKey` 由服务端作为 prop 传下（规避客户端未内联的半配置态）。
- **`proxy.ts`**：先判 `isClerkConfigured()`，未配置时受保护路由重定向到 `/setup?missing=clerk`；已配置时进入 `clerkMiddleware`，对 `/rooms(.*)` 调 `auth.protect()`（skeleton 实测）。`/invite` 与 `/setup` 不受保护。它只是乐观检查，授权在 Convex；它对 API 请求也返回 307，所以 v1 不提供业务 Route Handler；唯一的 Route Handler 是不含业务数据的 `/api/health`（`src/app/api/health/route.ts`），它自行 `auth()` 并对未登录返回 401（13 FE-D14、16 TC-AUTH-11 的静态断言）；将来若加业务 handler，同样在 handler 内自行 `auth()` 并返回 401。
- **按环境分别构建**：dev / preview / prod 各用自己的 `NEXT_PUBLIC_*` 构建，禁止把一个环境的构建产物提升到另一个环境（skeleton 证伪"NEXT_PUBLIC 一律构建期内联"：构建时未定义的变量会被服务端代码在运行时读取，形成半配置）。构建命令与发布顺序见 15 §15.4。
- `.env.example` 只列变量名与注释（Next 侧与 Convex 侧分开标注），`CLERK_TELEMETRY_DISABLED=1`；`pnpm env:check` 只报告"存在 / 缺失 / 远端"，从不打印值，并对"设置了、名字像密钥的 `NEXT_PUBLIC_*`"报暴露警告（dev-tooling `checkEnv`）。
