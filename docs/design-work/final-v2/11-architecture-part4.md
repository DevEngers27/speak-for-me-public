# 11 · 系统架构（part4）：地基模块映射、拆包触发、不变量、备选、开放问题、canon 对照

## 11.11 地基模块映射（`scratchpad/foundation/*`）

| 模块 | 落位 | 在本系统中的用途 | 必须改动 / 不采用的部分 |
| --- | --- | --- | --- |
| errors-result | `core/engine/result.ts`、`core/engine/errors.ts`；函数边界在 `convex/lib/errors.ts` | `Result`、`collect`（规则一次收集全部问题）、`defineReasonCodes`（params 只有 key / cents / date / int 等种类，无自由文本；`param.restricted` 按参数做受众裁剪）、错误注册表与穷举 `match` | 线格式由 `{ code, message, data }` 改为 canon 的 `{ code, params }`；码名一律用 canon §1.5 的小写点分并由 `reasonCodes.ts` 单一数组派生；`exposure: "internal"` 的码到浏览器一律是 `internal`；日志不用 `console.error(toLogRecord)`，改 `opsLog` |
| money-dates | `core/engine/money.ts`、`core/engine/dates.ts` | `Cents` / `SignedCents` 品牌类型、溢出检查的 `sumCents`、表单 `parseCents`（不经浮点）、`IsoDate`、`addDays`、日期比较 | 调用 `assertCents` 一律传 `{ max: 1e11 }`（canon §1.2）；`formatCents` 留在 core 供模板；界面显示用 `src/lib/format.ts` 的 `Intl`；`isoDateFromEpochMs(ms, offset)` 只作为 `todayInTimeZone` 在 V-D2 不通过时的退路（`convex/lib/time.ts`）；`parseCents` 语法：去掉首尾空白后必须匹配 `^\d+(\.\d{1,2})?$`（拒绝货币符号、千分位逗号、正负号、指数记法、超过两位小数与空串），用字符串整数运算换算（小数部分右补零到两位），语法错误 → `input.invalid`，超过 `MAX_CENTS`（1e11）→ `amount.out_of_range`；显示格式化与解析分开 |
| idempotency-ids | `core/engine/canonicalJson.ts`、`core/engine/keys.ts`；`convex/lib/crypto.ts` 复用其 `sha256` / `randomBytes` 适配器 | `termsKey = canonicalJson(terms)`（D25）；`executionKey = composeKey("exec", proposalId)`，即 `exec:${proposalId}`（D03）；三段式 `taskKey`；邀请链接 token 的随机数与 `sha256Hex(token)` | 不用哈希形 operation id（D03 否决哈希）；不用 `createPublicId` / slug（ID 用 `_id` + 领域键，techstack D40）；`crypto.subtle` 在 mutation 内可用性待验证，`sha256` 可注入纯 JS 实现作退路 |
| text-templates | `core/engine/text/`；模板常量分别在 engine（通用事件）与 `core/scenarios/scope-change/templates.ts` | `renderPublicText`：槽位白名单、编译期与运行期都拒绝多余字段、品牌金额类型 `PublicCents`、确定性格式化器（无 `Intl`） | 他方可见模板不使用 `slot.text`（D13：参数类型不含自由 string，条目用 `itemKey` token）；编码器用 `plainTextEncoder`（React 负责 HTML 转义）；模板按受众分 `room` / `buyer` / `owner` 变体 |
| context-projection | `core/engine/projection/` | `projectForRole` = `defineDisclosureMatrix` + `projectByRole`（字段级受众，fail closed，新增字段必须做披露决定）；`pickExact` / `projectInto` 构造 DTO；`trimToBudget` 供代理上下文（10） | `wrapUntrusted` 的定界标签改为 canon 的 `<untrusted_data source=…>`，转义 `<` `>` `&`（D12 ⑧、D13）；`UNTRUSTED_TEXT_POLICY` 文案随之改；确定性边界 token（利于提示缓存）保留 |
| model-call | `convex/model/agents/modelGateway.ts`（依赖 SDK，不能进 core） | `callModel` 唯一接缝：请求体由模块内字面量构造、运行时参数白名单、`stop_reason` 分支、usage 无论成败都返回、可注入 Transport、stub transport 结果标 `source: "stub"` | 改为 `client.messages.stream(...).finalMessage()`（D09，删除"非流式 21,333 上限"检查）；`output_config.format` 用 `toStrictOutputSchema` 的结果，不用 `zodOutputFormat`（会把 enum / const 降级为描述）；SDK `maxRetries: 0`，重试只在网关一层（429 / 连接错误每次调用 ≤ 1 次，`max_tokens` 截断调用内 ≤ 1 次，408 / 409 / 5xx / 529 不重试）；单次发送 `timeout` 由 `max_tokens` 推导，总截止早于 `WATCHDOG_FIRST_MS` 且到期不可重试（10 R11、§10.11）；不传 `thinking` |
| fixture-types | 类型 → `core/engine/fixtures.ts`；Zod 加载器 → `convex/lib/fixtureSchema.ts`；数据 → `core/scenarios/scope-change/fixtures/` | 交叉引用、金额求和、版本单调等校验；加载后冻结 | Zod 不进 core；`provenance` 映射为 canon 的 `'seeded'`；`asOf` 绝对日期改为相对锚点（D27）；fixture 只描述 seed 链的输入，不描述提案 / 审批等中间状态（D18） |
| convex-test-utils | `testing/convex-test-utils/` | 角色身份、动作 × 角色矩阵断言、只推进到期任务的 `drainScheduled`、禁字段扫描、"先查后写"去重配方 | 不放进 `convex/`（否则被当作函数模块打包）；函数名以 12 为准 |
| e2e-harness | `testing/e2e-harness/` + `e2e/` | 三个隔离浏览器上下文（A / B / C 映射 customer / provider / finance）、Clerk 测试 token、DOM 与 WebSocket 帧的金丝雀扫描 | 只对 dev / preview（stub）部署运行 |
| dev-tooling | `tooling/dev-tooling/` | ESLint 边界配置工厂与 must-fail 夹具（L3）、`check-env`、`convex-ops` 守卫（seed / reset 的客户端层，15 §15.9）、CI 模板 | `layout` 默认值即本仓库布局；其 ESLint 9 与 D20 一致 |

## 11.12 四包拆分的触发条件

- **触发（任一即可）**：① 第二个场景开始实际落地（不只是 `procurement_rfq` 契约测试 fixture，U6）；② 出现包内违规：L1 / L3 / L10 被绕过，或构建后浏览器 chunk 扫描发现服务端模块标记；③ CI 时长超过约 10 分钟且主要耗在全仓类型检查。
- **目标形态**（techstack D04/D05）：`core/engine` → `@sfm/engine`；`core/scenarios/scope-change` → `@sfm/scenario-scope-change`；`convex/` → `@sfm/backend`（`convex/` 在包根，`exports` 只暴露 `./api` 与 `./dataModel`）；`src/` → `apps/web`。包图 + `exports` 白名单 + `import-x/no-extraneous-dependencies` 取代 L1 / L10 的正则部分，引擎纯度规则（L2）保留。
- **前置验证**：spikes §8 #8 在真实部署上打包 workspace 包（symlink + `exports` 指向 `.ts`）；`externalPackages` 不含 `"*"`；`convex deploy --cmd` 的跨包 `--filter` 行为。
- **迁移成本**：`@core/*` 别名改为包名导入（机械替换）；tsconfig 拆分；部署命令改到 backend 包内运行。目标是业务代码零改动，因为分层已经由 lint 维持。

## 11.13 不变量（架构层）

| # | 不变量 | 机制 | 验证 |
| --- | --- | --- | --- |
| AR-1 | `core/**` 不导入任何框架、Convex、Zod 或 SDK，不读时钟、随机数、网络、环境变量 | L1、L2 | lint 夹具；money-dates 式 hygiene 测试 |
| AR-2 | 浏览器包只含 `_generated` 的 api / dataModel 引用与 `@core/engine/ui`；`CLERK_SECRET_KEY`、`ANTHROPIC_API_KEY` 永不进入客户端 | L10；条件 Provider；密钥只在服务端 / Convex | 构建后扫描 `.next/static`：密钥标记与只从 `@core/engine` 主出口导出的金丝雀常量 `__SFM_ENGINE_CANARY__` 均为 0 次（skeleton 实测方法） |
| AR-3 | 每个 Convex 函数都由构造器定义；公共函数同时声明 `args` 与 `returns` | L5；构造器类型签名 | lint 夹具：不经构造器的 mutation 必须报错 |
| AR-4 | 身份只来自 `ctx.auth`；公共函数参数里没有 `userId` / `role` / `memberId` / `actorUserId` | 构造器；`arch:check` 扫描 `convex/*.ts` 公共定义的 `args` 键名 | CI |
| AR-5 | 被调度或内部函数不调用 `getUserIdentity()`；代表用户行事的内部函数显式带 `actorUserId` | `getUserIdentity` 只允许出现在 `convex/lib/functions.ts`（`arch:check`） | CI；convex-test 实测被调度函数身份为 null |
| AR-6 | 只追加表没有 patch / replace / delete；可变字段 ⊆ `MUTABLE_FIELDS`；关键表只有唯一写入口 | L8；`patchMutable` 运行时断言；`arch:check` grep | CI；对账检查器（08） |
| AR-7 | 公共函数内没有 `console.*`；非 `ConvexError` 异常一律变成 `internal`，日志只含白名单字段 | L7；`withSanitizedErrors`；`opsLog` 的类型 | 16 的金丝雀用例"模型返回以金丝雀开头的非法 JSON"、`logLines` 扫描 |
| AR-8 | `_generated` 与源码同步；应用不含 Convex 组件 | codegen 漂移检查；`arch:check` 断言不存在 `convex/convex.config.ts` | CI |
| AR-9 | `Date.now()` 只出现在 `convex/lib/time.ts`；query 永不读时钟 | L8；`nowMs` 只接受 `MutationCtx` / `ActionCtx` | 16：query 路径不读时钟的测试 |
| AR-10 | `@anthropic-ai/sdk` 只在 `convex/model/agents/**`；模型调用只经 `callModel` | L6 | 16：`vi.mock` 唯一接缝 + 脚本队列耗尽断言 |

## 11.14 备选与否决（11.1 之外）

| 备选 | 否决理由 |
| --- | --- |
| 直接上 ESLint 10 | spike 未验证；eslint-config-next 内含插件依赖 shim；作为独立 PR（U10） |
| Biome 替代 ESLint | 没有 Next 专属规则与 type-aware `no-floating-promises` 的等价物 |
| lefthook / husky 提交钩子 | 安装脚本需加入 `allowBuilds`，与 D20 白名单冲突；可被 `--no-verify` 跳过，CI 才是门禁 |
| Next Server Actions 或 Route Handler 承载表单与业务 | 第二套鉴权面；表单一律 `useMutation`（techstack D25） |
| `auth.protect()` 只放在 `(app)/layout.tsx`（techstack D23） | 采用 skeleton 实测的 proxy 写法：proxy 对每个请求执行，且未配置 Clerk 时能先于 Clerk 抛错重定向到 `/setup`；布局写法在客户端导航时是否每次执行待验证 |
| `@convex-dev/eslint-plugin` 的 `require-access-control` | 不在 D20 基线；按命名 pattern 识别鉴权助手，L5 的"禁止导入原始构造器"更强且零依赖 |
| 场景表 `scopeChange_*` 立即建表 | v1 场景没有独立表，场景数据落在引擎表的场景化字段里（以 03 为准）；前缀约定保留给将来 |
| 格式化工具进 CI 门禁 | v1 不在门禁里强制格式；Prettier 可作为个人编辑器设置，不进依赖（少一个工具链冲突面） |

## 11.15 开放问题

| # | 问题 | 默认 / 退路 | 验证方式与时间 |
| --- | --- | --- | --- |
| Q1 | 真实 `convex dev` 推送时 `@core/*` 的解析与 codegen 产物一致性（只做过 esbuild 回放） | 默认可行；失败则在 `convex/` 内用相对路径引用 `../core/...` | spikes §8 #8，实现第 1 周（U11） |
| Q2 | 默认运行时中 SDK 流式请求的行为 | 失败则 `runAttempt` 移入 `convex/agentsNode.ts`（`"use node"`） | dev 部署上跑一次 `runtime_smoke`（§8 #13/#15） |
| Q3 | mutation 内 `crypto.subtle` / `crypto.getRandomValues` 可用性 | 链接 token 的随机数在 action 中生成；`invites.accept` 的哈希用可注入实现，纯 JS SHA-256 兜底 | §8 #6 |
| Q4 | Convex 运行时 `Intl.DateTimeFormat` 的时区支持（V-D2） | 不通过则房间只存固定 UTC 偏移并写明夏令时局限 | dev 部署单次实验 |
| Q5 | Zod 进入函数包后的体积与冷启动 | 可接受则保持；否则把 Zod 限制在 `convex/model/agents/` | §8 #7 |
| Q6 | （已裁决）canon D20 已把 `convex-helpers 0.1.128` 列入基线并写明手写包装器退路（OBJ-52）；安装当天只需确认冷却期 | 手写包装器，导出名不变 | 安装当天 |
| Q7 | （已关闭）canon D21 已允许在同一个 ESLint 内用 `eslint-plugin-boundaries` 补漏（OBJ-53），L3 保留 | — | — |
| Q8 | `MUTABLE_FIELDS` 清单的归属 | 只在 03 §3.3.2 维护，本章 §11.7 引用；CI 类型断言 ⊆ `keyof Doc<t>` | 已与 03 对齐 |
| Q9 | U10（ESLint 10 升级时机）、U12（产品名，`APP_NAME` 单点） | 按 canon 默认 | 用户决策 |

## 11.16 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| §1.5 reasonCode | `core/engine/reasonCodes.ts` 是 reasonCode 与 API 错误码的单一来源（`REASON_CODES` + `API_ERROR_CODES` → `ERROR_CODES`，`PARAM_AUDIENCE`），`convex/lib/validators.ts` 只从它派生 validator；`WirePayload.code` 取 `ERROR_CODES`（§11.3、§11.6；码表语义见 06 §6.1 与 12 §12.4） |
| §1.6 函数名 | 函数层"文件名.导出名"即 canon 函数名；`constraints.bump`、`events.append`、`executions.executeIfComplete` 为 `convex/model/` 内 helper（§11.3） |
| D01 编排 | 不用任何组件（A5）；`turns.beginAttempt` 为唯一调度接缝；不调用 `scheduler.cancel`（§11.2） |
| D09 结构化输出 | `toStrictOutputSchema` 住在 `core/engine/strictSchema.ts`，作为 JSON Schema 纯变换；schema 在 action 内按 `(role, turnKind, n)` 构造；`callModel` 在 `convex/model/agents/`（§11.8、§11.11） |
| D14 事件 | `events.append` 是唯一写 `events` 与 `commitTs` 处（`arch:check`） |
| D16 日志与错误 | 所有构造器内置 `withSanitizedErrors`；线格式 `{ code, params }`；L7 禁 `console.*`；`opsLog` 字段白名单（§11.6、AR-7） |
| D17 排空 | 排空用数据库标志 `opsFlags.draining`，`AGENTS_ENABLED` 只作紧急止血（§11.10） |
| D18 seed / reset | `assertTier` 读 `DEPLOYMENT_TIER` 与部署名；唯一硬删除路径是 dev / preview 的 `seed.reset`（§11.7、§11.10） |
| D20 依赖与 codegen | 版本基线、`catalog:`、`minimumReleaseAge: 10080`、例外清单脚本带到期日、`allowBuilds` 只放行 `esbuild` 与 `unrs-resolver`、`_generated` 提交 + 漂移检查、`types: ["node"]`、convex-test glob、ESLint 9.39.5（§11.8、§11.9） |
| D21 仓库布局 | 单包 `core/engine` ← `core/scenarios/scope-change` ← `convex` ← `src`；`no-restricted-imports` 分层 + 纯度规则；构造器 `userQuery/userMutation/memberQuery/memberMutation/anonQuery` + internal；`convex/` camelCase、场景目录在 `core/`；四包拆分触发条件（§11.12）。场景 UI 槽位 v1 只有 `proposalTermsCard`，放在 `src/components/scenarios/scope-change/`，只消费 query DTO（13） |
| D22 时间 | `Date.now()` 只在 `convex/lib/time.ts`，类型上 query 拿不到；query 只读 `rooms.localDate`（AR-9） |
| D24 邀请 | 邀请页不调 `auth.protect()`、token 在 fragment、`Referrer-Policy: no-referrer`；`invites.createLink` 是唯一公开 action（§11.2、§11.6） |
| D02 / D03 唯一写入口 | `approvals`、`executions`、`ledgerEntries`、`changeOrders`、`tasks`、`members`、`proposals` 的写入口文件由 `arch:check` 固定（§11.5） |
| U9 / U10 / U11 / U12 | 采购项见 15；ESLint 10 独立 PR；§8 验证按开放问题分配到第 1 周；`APP_NAME` 单点在 `core/engine/brand.ts` |
