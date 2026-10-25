# 技术选型 ADR 决策表（Speak for Me）

> 汇总日期 2026-10-24。输入：本目录 8 份子决策备忘录及其反驳审查（`*-review*.md`）。栈不变：Next.js 16.4.3 App Router + Convex 1.48.0 + Clerk 7.9.20 + `@anthropic-ai/sdk` 1.x + `claude-opus-5-5`。
> 状态含义：`accepted` = 按备忘录原样采纳；`accepted_with_changes` = 采纳，但按 §3 的裁决修改；`needs_decision` = 涉及采购或数据处理方，须用户拍板（附推荐默认值）。
> 裁决原则：任务书 §3 核心优先；反驳与备忘录冲突时，按任务书 §6"两个方案都完整时选简单的"裁决；跨备忘录冲突统一在 §2 处理，各备忘录以本表为准回改。

## 0. 一页结论

- 8 份备忘录的反驳结论全部是 accept_with_changes，没有 reject，没有推翻栈。共 77 条反驳意见：1 条 blocker、4 条 high、26 条 medium、46 条 low。裁决见 §3：采纳 73 条，部分采纳 3 条，改走他法 1 条，没有驳回的条目。
- 跨备忘录有 6 处必须统一的冲突，统一裁决见 §2：X1 版本纪律（三份备忘录各写一套冷却期）、X2 调用与花费上限落点（三个真相源、8 层上限）、X3 事件顺序（`commitTs` 不是全序，且是 bigint）、X4 错误与日志卫生、X5 平台采购、X6 测试工具版本。
- 只有 3 项留给用户拍板（D28、D31、D32），都是采购或"多接一个第三方数据处理方"的问题。其余全部可以直接写进设计文档。

## 1. 决策表

| # | 主题 | 决定（已含裁决） | 状态 | 理由一句 | 来源 |
| --- | --- | --- | --- | --- | --- |
| D01 | 整体栈与退出 | 维持 Next 16.4.3 + Convex 1.48.0（云托管）+ Clerk 7.9.20 + SDK 1.x；可迁出纪律：引擎/场景纯函数、decide/apply 分离（每个 mutation 自写落库，不做通用写计划解释器）、业务键显式、唯一性清单可映射 SQL UNIQUE；退出 L0 自托管 Convex、L1 Postgres + Drizzle | accepted_with_changes | 替代方案无一在实时订阅 + 事务调度上同时胜出，退出成本靠纪律而非换栈来控制 | stack-review.md, -part2/3/4, stack-review-review.md |
| D02 | 事件顺序与游标 | 事件表 `commitTs`（`v.commitTs()`）+ `seq`（同一事务内从 0 递增），索引与游标按 `(commitTs, seq)`；返回 DTO 只给字符串游标，不出现 bigint；只有单一入口 `appendEvents()` 写 `db.vars.commitTs` | accepted_with_changes | 同一 mutation 写多条事件时 `commitTs` 相同，且字段可被任意 int64 写入 | §2 X3；stack-review-review r01；data-evolution-review r09 |
| D03 | 版本纪律 | 直接依赖全部精确锁定、经 `catalog:` 统一；`minimumReleaseAge: 10080`（strict）由代码组织统一持有，例外清单脚本生成、带到期日；删除前端的工作区级 20160 | accepted_with_changes | 三份备忘录各写一套，20160 会让现有锁定版本全部装不上 | §2 X1 |
| D04 | 仓库布局 | pnpm 11 workspace，不用 Turborepo；`@sfm/engine` → `@sfm/scenario-scope-change` → `@sfm/backend`（`convex/` 在包根）→ `apps/web`（只经 `exports` 白名单导入 `@sfm/backend/api`）；内部包源码直出 | accepted | 让"私密逻辑进不了浏览器包"成为包图事实，与 Convex 官方 monorepo 模板同构 | code-organization.md, -review |
| D05 | 依赖方向强制 | v1 只上 L1 包图、L2 `exports` 白名单、L3 `import-x/no-extraneous-dependencies`、L5 引擎纯度规则、L6 `@convex-dev/eslint-plugin` + CI；L4 boundaries 推迟到第二个场景落地或出现包内违规时；L7 架构测试并入 L3，只保留 `convex.json` 断言脚本；`no-cycle` 只作用于 engine/scenario | accepted_with_changes | L3/L4/L7 重叠，boundaries 7.3.0 刚发布且键名文档不一致 | code-organization-review r02, r06 |
| D06 | Lint 与工具链 | ESLint 10 flat config + typescript-eslint 8.x type-checked + TS 6.0.x + Prettier 3 + lefthook 2；禁止另行注册 `eslint-plugin-import`，新 import 规则只用 import-x；jsx-a11y 只合并 rules；`require-access-control` 配 pattern | accepted_with_changes | ESLint 9 已 EOL；eslint-config-next 内部 shim 才是 ESLint 10 可用的原因 | code-organization-review r03, r04；frontend-ui-review r03 |
| D07 | run 编排 | 自建 `ctx.scheduler` 链，`scheduleAttempt()` 为唯一接缝；不用 workflow/workpool，触发条件出现时再升级 workpool | accepted | 状态真相源留在自有表；workflow 要求确定性 handler，改代码会打断在途实例 | convex-internals.md C1 |
| D08 | 鉴权入口 | `convex-helpers` 0.1.128 的 `customQuery/customMutation` 定义 `userQuery/userMutation/memberQuery/memberMutation` 与白名单内的 `anonQuery`（须附审查注释）；所有构造器内置 X4 的 `withSanitizedErrors`；v1 没有公开 action | accepted_with_changes | 鉴权不可遗漏要靠单一入口，匿名函数需要有名有姓的出口，否则会被 eslint-disable 绕过 | convex-internals C3a；-review r06, r11；observability-ops-review r02 |
| D09 | 调用与花费上限 | 按 §2 X2 的落点表：每用户 3 个节流（零依赖索引计数）、run 级 attempt 上限、run 级美元预留/结算、全局日美元计数、Console 兜底；v1 不引入 `@convex-dev/rate-limiter` | accepted_with_changes | 三份文档合起来 8 层上限、3 个真相源，属于过度设计 | convex-internals-review r01/r03/r09/r10；model-layer-review r09 |
| D10 | schema 演进 | 扩展 → 回填 → 收缩；`@convex-dev/migrations` 0.3.7 在首个需要回填的变更时安装（采用 data-evolution 写法）；收缩可用 1.47 的 `defineTable().staged()`，staged 索引自 1.26 起已有 | accepted_with_changes | 两份备忘录时机不一，平台版本事实需更正 | data-evolution.md；convex-internals-review r04, r06；data-evolution-review r05 |
| D11 | crons 与本地日期 | 内建 `cronJobs()` 只做全局巡检；新增 cron 按房间时区写 `rooms.localDate`，query 只读这个字段，mutation 用 `Date.now()` 权威重算 | accepted_with_changes | query 里读时钟会返回陈旧结果并刷缓存 | convex-internals C6；data-evolution-review r02 |
| D12 | 测试分工 | L1 convex-test（串行逻辑、经 `api` 引用调用）；L2 真实 dev 部署（并发、OCC、唯一性、限额、returns 多余字段校验，以 L2 结果为准） | accepted_with_changes | convex-test 不模拟并发，inline handler 会跳过 returns 校验 | convex-internals C7, -review r08 |
| D13 | 模型与 effort | 所有路由 `claude-opus-5-5`；propose/review `medium`，extract `low`，最终以评测扫描为准；评审"扫描候选用 low"那句删除，确需时改用 per-message effort | accepted_with_changes | 技能规定不得为省钱降级；同一方 effort 变化会让缓存失效 | model-layer.md；-review r05 |
| D14 | 调用网关 | 自建 `modelGateway`：一律走 `client.beta.messages.stream().finalMessage()`，只按条件加 `betas`/`fallbacks`；Convex 层总截止时间经 `AbortSignal` 兜底；`maxRetries` 只覆盖 429 与连接错误；删除 `retryMaxTokens`，`stop_reason: max_tokens` 转 HumanRequest 或降一档 effort；显式传 `thinking: {type: "adaptive"}` | accepted_with_changes | 非流式 + 16k–20k `max_tokens` + 180s 超时自相矛盾；回退到 Opus 4.8 时省略 thinking 等于关闭思考 | model-layer-review r01, r03, r07 |
| D15 | 结构化输出与解析 | `output_config.format` 配自建 JSON Schema（保留 `enum`/`const`），`create`/`finalMessage` 后先查 `stop_reason` 再 `safeParse`，然后过规则引擎；解析失败自行 try/catch，错误里不带原文 | accepted | `zodOutputFormat` 会降级 enum/const，`parse()` 失败会丢 usage | model-layer.md；04 要点 16–17 |
| D16 | 提示缓存 | 4 个断点按"协议→场景→角色卡→本方私密→本方事件"；每次调用把新增事件合成一个 block 追加，不再"补断点"；本回合指令放末尾中途 system 消息 | accepted_with_changes | 每请求最多 4 个断点，已用满 | model-layer-review r05 |
| D17 | 服务端回退 | `fallbacks: "default"` 默认开、`MODEL_FALLBACKS` 可关；按"重跑同一请求"语义描述；V1 只断言请求被接受与 `iterations` 形状；上线后按 `fallbackServed` 分组监控 schema_invalid 与规则拒绝率并告警 | accepted_with_changes | 引用的继承注释只适用于数组条目，良性请求触发不了回退 | model-layer-review r02 |
| D18 | 离线评测 | 自建 runner 作为 Vitest 的一个 project 运行（不靠 Node 24 类型剥离直接跑 `.ts`）；promptfoo 否决理由只保留"判分要运行引擎代码"和"依赖面大" | accepted_with_changes | 实测无扩展名导入与 enum 在类型剥离下失败；promptfoo 仍是 MIT | model-layer-review r04, r06 |
| D19 | 用量记账与原文 | `modelCalls` 逐次记账（含 `usage.iterations`）；默认只存响应原文与请求哈希，完整请求仅 dev 或抽样保存并设保留期 | accepted_with_changes | 请求可由事件、promptVersion、prefixHash 确定性重建，再存一份等于复制私密简报 | model-layer-review r10 |
| D20 | 认证与成员 | Clerk 只做认证（原生集成，session token `aud="convex"`，claim 加 `name`/`email`/`email_verified`）；成员、角色、邀请全在 Convex 表；不用 Organizations、publicMetadata 角色、多会话；`isTestAccount` 按 `identity.issuer` 属于 dev 实例或 seed 显式置位判定 | accepted_with_changes | 房间角色是应用数据；`+clerk_test` 子地址在生产只是普通地址 | identity-auth.md；-review r03, r08 |
| D21 | 加入房间 | 默认邮箱定向邀请（`invitedEmail` 必填、无 token，对方登录后按已验证邮箱列出并接受，要求 `identity.emailVerified === true`，否则 `EMAIL_UNVERIFIED`）；不知道邮箱时才用单次链接，token 放 fragment（`/invite#t=…`），邀请页不调 `auth.protect()`、设 `Referrer-Policy: no-referrer`；两种方式共用同一个 accept 写入口与唯一性检查 | accepted_with_changes | 路径里的 token 会经 `redirect_url` 发给 Clerk 托管页并进日志；多数参与方事先知道邮箱 | identity-auth-review r02, r03, r09 |
| D22 | 注册模式 | 生产默认 Open + Clerk bot 防护；Invite-only 降为运营开关，开启时创建定向邀请须同时 `invitations.createInvitation({ignoreExisting: true, redirectUrl})` | accepted_with_changes | Invite-only 会让未注册的被邀请人无法注册；房间访问本来只靠邀请 | identity-auth-review r01 |
| D23 | 路由保护与缺配置 | `proxy.ts` 先判 `isClerkConfigured()`，不满足返回 503 或 rewrite 到 `/setup`，满足才进 `clerkMiddleware()`；`/setup` 在独立根布局的 route group（不包 ClerkProvider）；`auth.protect()` 只在 `(app)/layout.tsx` 调一次，邀请页与 `/setup` 豁免；`viewer` 查询返回 null 时先 `ensureViewer` 再挂业务查询，claim 变化时 patch 并写事件 | accepted_with_changes | 缺 key 时 Clerk 直接抛错，原 fail-closed 路径到不了；页面级检查只影响体验 | identity-auth-review r04, r06, r07 |
| D24 | 样式与组件 | Tailwind 4.3.3（PostCSS）+ shadcn/ui CLI 4（源码入库）+ `@base-ui/react` 1.9.0 原语，Radix 作同 API 备选；`lucide-react` 选满 14 天的 1.x；版本差异由场景纯函数 `diffTerms` 作用于已投影的 `ProposalView` | accepted | 组件代码入库、运行时依赖少、diff 不越过角色投影 | frontend-ui.md |
| D25 | 表单 | `react-hook-form` 7.89.0 + `@hookform/resolvers` 5.9.1 + zod 4 + `zodResolver`，提交走 Convex `useMutation`，不走 Server Actions；resolvers 6.0.0 对 zod 用户无收益，不急于升级 | accepted_with_changes | 原表写的 7.89.x、5.9.x 不存在或未满 14 天 | frontend-ui-review r05 |
| D26 | 可访问性 | WCAG 2.2 AA；`eslint-plugin-jsx-a11y` 6.10.2 作直接 devDependency，只合并 `flatConfigs.recommended.rules`；`@axe-core/playwright` 进 E2E 门禁；禁用按钮统一用自有 Button 的 `disabledReason`（`aria-disabled` + `aria-describedby` + onClick 拦截） | accepted_with_changes | 直接叠加 recommended 会报 Cannot redefine plugin；`focusableWhenDisabled` 不保证输出 `aria-disabled` | frontend-ui-review r03, r07 |
| D27 | 国际化 | `next-intl` 4.14.9 无路由模式，v1 只有 `en`；`pnpm-workspace.yaml` 加 `allowBuilds: {'@swc/core': false, '@parcel/watcher': false}`；`use-intl` 作实现前 spike 对照；公共文本存 `{templateKey, params}` 改为向 03/05 提出的需求，被否决时退路为"只翻译界面文案，历史公共文本保持英文" | accepted_with_changes | 消息提取依赖带安装脚本，pnpm 11 `strictDepBuilds` 会让安装失败；schema 不由 UI 拍板 | frontend-ui-review r02, r06 |
| D28 | 托管平台 | Vercel Pro（商用不能用 Hobby，$20/席位/月）+ 自有域名（Clerk 生产实例不接受 `*.vercel.app`）；推荐默认：采购 | needs_decision | 有新增费用与域名采购 | observability-ops O1/O8；-review r07 |
| D29 | 环境分层 | v1 三层：`dev` / 每 PR `preview`（不持 Anthropic key，强制 stub）/ `prod`；staging 列为扩展点（触发条件：需要上线前真实模型冒烟或多人并行验收），届时做成单独的 Vercel 项目，不依赖 Convex CLI 隐藏选项；Clerk 两个实例，Anthropic 两个 workspace | accepted_with_changes | 部署 key、限额、日志流、异常上报本来就按部署隔离；自定义环境下 `VERCEL_ENV=preview` 会让 prod key 发布被中止 | observability-ops-review r04, r05 |
| D30 | 错误追踪 | Next 侧 `@sentry/nextjs` 11.6.0，`dataCollection` 全部键显式 false 并 `satisfies Required<DataCollection>`；删 `enableLogs`/`tracesSampleRate`，过滤 Console integration；Convex 侧平台 exception reporting（依赖 D32）；所有入口经 `withSanitizedErrors` | accepted_with_changes | v11 未写的键默认全开；V8 的 JSON.parse 报错会带出输入片段 | §2 X4；observability-ops-review r01–r03 |
| D31 | 日志去向 | 推荐默认：采购 D32 后只给 prod 接 Convex log streams → Axiom，金丝雀扫描覆盖 `error_message`；备选：v1 不接，只用 Sentry + `opsLog` + 看门狗 cron（缺平台级耗时与 OCC 指标） | needs_decision | 多一个第三方数据处理方，取舍由用户定 | observability-ops O3；-review r10 |
| D32 | Convex Pro | 推荐默认：prod 上线前采购（$25/开发者/月）：log streams、exception reporting、周期备份都要它；不采购时的退路见 §2 X5 | needs_decision | 任务书与 inputs/04 没有这项费用 | data-evolution-review r08；observability-ops O8 |
| D33 | 功能开关 | Convex 环境变量经单一 `config.ts` 白名单解析，run 开始时快照；不建开关表、不用开关 SaaS | accepted | v1 只需全局开关，变更由 Convex audit_log 留痕 | observability-ops O6 |
| D34 | 密钥与轮换 | 每个密钥只放在使用它的一处；"先加新、再部署、后删旧"，90 天例行 + 泄露即轮换；删掉"仅 Clerk Admin 可管理 secret key"的无源说法 | accepted_with_changes | 来源找不到该句 | observability-ops O7；-review r07 |
| D35 | 用量与成本 | `modelCalls` 为事实来源，成本读时按带 `asOf` 的价目表估算；与 Admin API `cost_report` 对账须 Anthropic 组织，写明不含 Priority Tier、不能按 key 过滤；CI 用 org:admin 联合身份，不存长期 Admin key | accepted_with_changes | 个人账户没有 Admin key | observability-ops O5；-review r08 |
| D36 | 金额 | 整数分 `v.number()`；`engine/money.ts` 只留 `assertCents`/`parseUsdInput`/`sumCents`；`formatUsd` 移到 `apps/web/lib/format.ts`；引擎或模板需打印金额时用纯整数 `formatCentsUsd` + 与 Intl 对比的属性测试 | accepted_with_changes | 引擎纯度规则禁用 Intl | data-evolution-review r01 |
| D37 | 日期与时区 | `IsoDate` 字符串 + 自写 `isoDate.ts`；`todayInTimeZone` 只在 mutation 与 cron 调用；先跑 V-D2（Convex 运行时 Intl 时区支持），通过则删 `fallbackUtcOffsetMinutes`，不通过则只存 offset 并写明 DST 局限 | accepted_with_changes | 回退字段与写入时校验互相抵消 | data-evolution-review r02, r03 |
| D38 | PII 与只追加表 | PII 只在可抹除字段；抹除是只追加表上第二种、也是最后一种允许的写入，只经 `privacy.*` 入口、只动 `REDACTABLE_FIELDS`；编译期断言该清单与 `contentHash` 覆盖字段不相交 | accepted_with_changes | 原文两条规则互相矛盾 | data-evolution-review r04 |
| D39 | 备份与恢复 | prod 周期备份（依赖 D32）+ 发布前手动备份；CI grep 只在自动化脚本里禁 `--replace/--replace-all`；保留 break-glass 手册：先 Backup Now、双人确认、写 `opsLog('restore')`，平台备份用 dashboard 恢复，离线 ZIP 才用 `import --prod --replace`；恢复后从恢复前快照的 `pii_redacted` 事件重放抹除 | accepted_with_changes | 一刀切禁用会让灾难恢复没有手册；抹除清单不能放在会被覆盖的表里而无机制 | data-evolution-review r07, r10 |
| D40 | 文本上限与 ID | `TEXT_LIMITS` + `assertText`（NFC、trim、按码点计长）；前端计数复用 `engine/limits.ts` 的码点函数，模型输出先 NFC 再过 Zod；ID 用 `_id` + 领域键，不做 slug | accepted_with_changes | HTML `maxLength` 按 UTF-16 计，Zod 不做 NFC | data-evolution-review r12；data-evolution.md |

## 2. 跨备忘录统一裁决

### X1 版本纪律（取代 frontend-ui R2/§7-10、code-organization §pnpm、stack-review §3.2 成熟度行）

1. **选版规则**：所有直接依赖精确锁定（不用 `^`/`~`），版本只在根 `catalog:` 写一次。基线四族（`next` 与 `@next/*`、`@clerk/*`、`convex`、`@anthropic-ai/sdk`）用任务书指定版本；其余新增包在实现开始当天选"满 14 天的最新版"。
2. **强制手段**：只由代码组织持有的 `pnpm-workspace.yaml` 设 `minimumReleaseAge: 10080`（显式即 strict）。`minimumReleaseAgeExclude` 由脚本从 lockfile 生成，每条带"包名@精确版本 + 原因 + 到期日"，CI 检查过期条目。写明行为差异：strict 只拦精确锁定；用范围声明的传递依赖会静默退到更旧版本，可以接受。frontend 的工作区级 20160 删除。
3. **具体锁定**：`@anthropic-ai/sdk` 1.1.0（PC-5 实测针对它；1.3.0 的 helper 已 diff 相同）。升级到 1.3.x 之前重跑 PROBE、结构化输出与参数 400 用例；版本号由 model-layer 决定，catalog 引用它。另锁 `convex-helpers` 0.1.128（2026-11-04 后再统一升级）、`@convex-dev/migrations` 0.3.7（安装时）、`react-hook-form` 7.89.0、`@hookform/resolvers` 5.9.1、`eslint-plugin-jsx-a11y` 6.10.2、`@sentry/nextjs` 11.6.0。
4. **耦合**：Clerk 对 react 的 peer 是 `~19.3.0-0`，React 小版本升级必须与 Clerk 同步（写进 K9）。Node 24 全链路，仓库提交 `.node-version`，L0 自托管清单引用同一文件。
5. **构建脚本**：`allowBuilds` 只放行 `esbuild`、`unrs-resolver`；`@swc/core`、`@parcel/watcher` 显式 false。
6. **记录**：V8 验证步骤记下各核心包的发布日期，风险表新增一项"新发版本"。

### X2 调用与花费上限落点（取代 convex-internals C2、model-layer F1 §4.6、run-lifecycle r12 的三处说法）

| 层 | 机制 | 真相源 | 拒绝时行为 |
| --- | --- | --- | --- |
| 每用户节流：`startRun`、`retryTurn`、`createRoom` | 按发起者索引（`by_userId` + `_creationTime`）在窗口内计数，零依赖 | `runs` / attempt 表（命名以 03 为准）/ `rooms` | 公开 mutation `throw ConvexError({code: "RATE_LIMITED"})` |
| run 级 attempt 上限 | `runs.attemptCount` | `runs` | run 转 HumanRequest 或 failed |
| run 级美元上限 | 调度前预留、提交时结算，字段放在 run 文档内 | `runs` | 不调度下一次 attempt，转 HumanRequest |
| 全局日美元上限 | 每 UTC 日一行 `spendCounters(global, day)` | `spendCounters` | 被调度路径**不 throw**：返回 `deferred`、写 deferred 事件、`runAfter` 到次日或人工处理 |
| 账户兜底 | Anthropic Console workspace 消费上限 | Anthropic | 网关按 429/400 分支处理 |

删除项：`liveCallsGlobalDaily`、`modelRequestsGlobal`、room 范围计数、分片 shards、`usageCounters`。v1 规模下全局日计数行不会成为 OCC 热点，出现争用再改。全局 RPM 桶在观测到 429 后才引入，届时用 `@convex-dev/rate-limiter` 0.4.2 且不分片，并注明它自带嵌套子组件 batch-worker。若 03 不愿为计数加索引，退路是只为这 3 个节流引入 rate-limiter，并遵守"拒绝后仍提交写入的调用放最前，或先全部 `check()` 再 `limit()`"。

### X3 事件顺序与 bigint

- 事件写入只经 `appendEvents(ctx, roomId, events[])`：它给同一事务的多条事件分配 `seq` 0..n-1，并写 `commitTs`。lint 禁止在别处出现 `db.vars.commitTs`。
- 索引 `by_room_order: [roomId, commitTs, seq]`。query 返回字符串游标 `"<commitTs>:<seq>"`，`commitTs` 只用于索引排序，不进任何 returns DTO。
- L1 迁移映射为 `UNIQUE(commit_ts, seq)`。待验证：不同事务的 `commitTs` 是否一定不同；若不保证，UNIQUE 改为 `(room_id, commit_ts, seq)`。
- 平台事实更正：`v.commitTs` 自 1.43.0 起就有，mutation 内 `runQuery` 不晚于 1.18.0；回退到 1.47 只失去 `signJwt` 和 mutation 内 storage，回退到 1.46 还会失去 `.staged()`。inputs/04 要点 7 同步更正。

### X4 错误与日志卫生（核心 1）

- `withSanitizedErrors` 内置在 D08 的所有构造器里，内部函数构造器也一样，不另写一层：捕获非 `ConvexError` 异常，只输出 `opsLog('unhandled', {errorClass, code})`，再抛 `ConvexError({code: 'internal'})`。不论是否采购 Pro 都执行。
- 模型输出解析自行 try/catch，错误对象与日志里不带任何原文。
- Sentry 按 D30 配置。金丝雀扫描的必扫字段：Sentry 事件、log stream 的 `function_execution.error_message`、`opsLog`。新增用例："模型返回以金丝雀开头的非法 JSON"。

### X5 平台采购与无 Pro 退路

需用户拍板：Convex Pro（D32）、Vercel Pro + 自有域名（D28）、是否接 Axiom（D31）。可选：Anthropic 组织（仅对账需要，D35）。不采购 Convex Pro 时的退路：Convex 侧异常只走 `withSanitizedErrors` → `opsLog` 加看门狗 cron 汇总；备份改为 CI 定时 `npx convex export --prod` 到加密存储（沿用 opsLog 与 30 天保留规则），每次发布前再手动导出一次。非 Pro 计划能否用 CLI 快照导出待验证。

### X6 测试工具版本

`vitest` 锁 4.1.11（4.1.12 未满期），Vitest 5 待验证。`convex-test` 精确锁定，下限 0.0.63（每个 query/mutation 内 pin `Date.now()`）；实现开始时若它未满 7 天，列入 X1 的到期例外清单。`@edge-runtime/vm` 已 23 个月未发版，记为风险。`@playwright/test` 1.64.x 加 `@clerk/testing`。验证步骤加 `tsc --noEmit`（TS 6.0.3）。保留显式 `import.meta.glob`，理由改为"pnpm symlink 布局下更稳"（待验证），因为它不是必需项。

## 3. 逐条反驳裁决

裁决词：**采纳** = 按反驳建议改；**部分采纳** = 采纳问题、修法有调整；**改走他法** = 承认问题，用另一种更简单的修法。每条修改落到 §1 的哪一行写在括号里。

### 3.1 stack-review（整体栈复核）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | medium | `commitTs` 非严格全序：加 `seq`，游标 `(commitTs, seq)`，单一写入口进 K1 lint | 采纳（D02、X3），并与 data-evolution r09 合并 |
| r02 | medium | 风险表加"新发版本"：精确锁版、升级 SDK 前重跑 PC-5、V8 记发布日期 | 采纳（D03、X1） |
| r03 | medium | L0 也走维护开关并排空在途 run；import 是 Beta、调度表不随快照迁移；V6 断言游标单调；措辞改为"零业务代码改动，需要运维切换与排空" | 采纳（D01；写进 15 的 L0 手册） |
| r04 | low | 4 处引用不符；计划名 Professional；import 默认 `requireEmpty` | 采纳（无来源的句子标"推论/待验证"） |
| r05 | low | R1/R3/R7 补并发档位、1 秒用户代码、4,096 索引区间 | 采纳（作为 10 的输入，见 §5） |
| r06 | low | React 小版本随 Clerk；L0 清单提交 Node 版本文件 | 采纳（X1-4；统一用 `.node-version`，不另建 `.nvmrc`） |
| r07 | low | Supabase 150 秒空闲超时补进否决理由 | 采纳 |
| r08 | low | 不做通用写计划解释器；V5 只在首次上生产前做一次；V6 只在触发条件出现时做；保留每周 export 冷备份 | 采纳（D01；每周冷备份是否需要 Pro 见 X5） |

### 3.2 frontend-ui（前端 UI 层）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | blocker | 删除工作区级 `minimumReleaseAge: 20160`，改为选版规则，强制手段交给统一决定 | 采纳（X1：强制手段归 code-organization，不归 observability-ops） |
| r02 | high | `allowBuilds` 拒绝 `@swc/core`、`@parcel/watcher` 并写进验证；评估 `use-intl` | 采纳（D27；`use-intl` 作实现前 spike，开放问题 O6） |
| r03 | medium | jsx-a11y 只合并 rules；补直接 devDependency 6.10.2 | 采纳（D26、D06） |
| r04 | low | 规则数、peer 范围、日期、resolvers 6.0.0 破坏性变更等事实小错 | 采纳 |
| r05 | low | 表里写精确版本 7.89.0 / 5.9.1 | 采纳（D25） |
| r06 | low | 结构化公共文本改为向 03/05 提需求并给退路 | 采纳（D27） |
| r07 | low | 验收用自有 Button 的 `disabledReason` | 采纳（D26） |

### 3.3 code-organization（代码组织与工具链）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | medium | 脚本生成带到期日的例外清单 + CI 查过期，或首版冷却降到 3 天；写明 strict 只拦精确锁定 | 部分采纳（X1：用脚本清单，保留 7 天，不降到 3 天，因为直接依赖全部精确锁定后清单可控） |
| r02 | medium | v1 只上 L1/L2/L3/L5/L6 + CI；L4 推迟；L3 与 L7 二选一；`no-cycle` 收窄 | 采纳（D05：选 L3，L7 只剩 `convex.json` 断言） |
| r03 | low | 补 shim 证据、可能性改低、禁止另注册 `eslint-plugin-import`、标注三插件停更 | 采纳（D06） |
| r04 | low | `require-access-control` 写出 pattern；加"不调鉴权助手的 public mutation 被拦下"探针 | 采纳（pattern 对齐 D08 的构造器名，探针进 16） |
| r05 | low | convex-test 表述修正；锁定或列例外 | 采纳（X6） |
| r06 | low | 6.8 标已验证；CI 断言 `externalPackages` 不含 `'*'` | 采纳（D05） |
| r07 | low | catalog 里的 SDK 版本引用 model-layer 决定 | 采纳（X1-3） |

### 3.4 convex-internals（Convex 内部选型）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | high | C2 只留三个每用户节流；删全局日桶；全局 RPM 等 429 再说；与 model-layer 出一张上限落点表；候选表补零依赖方案 | 改走他法（X2：落点表照做；三个每用户节流也改用零依赖索引计数，v1 不装 rate-limiter，少一个组件、L1 退出也更省事） |
| r02 | medium | 拒绝后仍提交写入的限流放最前，或先 `check()` 再 `limit()` | 采纳（只在 X2 的 rate-limiter 退路里生效） |
| r03 | medium | 被调度 mutation 里不 throw，返回 `ok:false` 或 `runAfter(retryAfter)` | 采纳（X2：被调度路径一律返回 `deferred`，throw 只用于公开 mutation） |
| r04 | medium | 更正 R1 降级代价与 1.48 依赖点，同步更正 inputs/04 要点 7 | 采纳（X3 末条） |
| r05 | medium | 锁 vitest 4.1.11；Vitest 5 待验证；convex-test 例外或降到 0.0.61；加 `tsc --noEmit` | 部分采纳（X6：下限保持 0.0.63，因为需要 pin `Date.now()`，未满期就列例外，不降到 0.0.61） |
| r06 | low | convex-helpers 统一 0.1.128；migrations 时机用 data-evolution 写法；C5 写明 `.staged()` | 采纳（D10、X1） |
| r07 | low | OCC 与幂等两条改引正确来源 | 采纳 |
| r08 | low | returns 校验经 `api` 引用调用，并在 L2 复跑，以 L2 为准 | 采纳（D12） |
| r09 | low | 全局桶不设 shards，删 R5 | 采纳（全局桶本身已删） |
| r10 | low | 注明 rate-limiter 自带 batch-worker 子组件 | 采纳（写进 X2 的升级路径说明） |
| r11 | low | 增加白名单内的 `anonQuery`；注明 v1 无公开 action | 采纳（D08） |

### 3.5 model-layer（模型与代理调用层）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | medium | 改流式 `.finalMessage()` + AbortSignal 总截止；`maxRetries` 只留 429/连接错误或设 0；删 `retryMaxTokens`；改写 C5 | 采纳（D14） |
| r02 | medium | 按"重跑同一请求"重写 §4.7；V1 只断言形状；上线后按 `fallbackServed` 监控 | 采纳（D17） |
| r03 | low | 显式 `thinking: {type: "adaptive"}` | 采纳（D14） |
| r04 | medium | 评测作 Vitest project，或全仓 `.ts` 扩展名导入 | 采纳第一种（D18）；不改全仓导入约定 |
| r05 | medium | 新增事件合成一个 block；评审用 low 时改 per-message effort，否则删 | 采纳（D16、D13：删掉那句） |
| r06 | low | 删 promptfoo"收购存疑"理由 | 采纳（D18） |
| r07 | low | 一律走 `client.beta.messages.*` | 采纳（D14） |
| r08 | low | 熔断按 `(route, schemaHash, promptVersion)` 分键、连续 N 次才熔断；401/403 全局告警并停调度；413 只转该 run 的 HumanRequest | 采纳（写进 10 的错误分支表） |
| r09 | low | v1 只留 run attempt 上限、run 美元上限、全局日计数 | 采纳（X2，run 美元字段放 run 文档内） |
| r10 | low | 默认只存响应原文与请求哈希，完整请求仅 dev/抽样并设保留期 | 采纳（D19；保留期写进 07、15） |
| r11 | low | 补 agent 的 peer；注明 SDK 1.0.0 从 MIT 改为 Apache-2.0 | 采纳 |

### 3.6 identity-auth（身份与权限）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | medium | 生产默认 Open + bot 防护，Invite-only 作开关 | 采纳（D22） |
| r02 | medium | token 放 fragment、邀请页不 `auth.protect()`、no-referrer、E2E 断言跳转不含 token | 采纳（D21；且链接降为备选） |
| r03 | medium | Sessions claim 加 `email_verified`，定向邀请要求已验证，`/setup` 显示 claim | 采纳（D20、D21；先在 dev 实例实测） |
| r04 | medium | proxy 先判配置；`/setup` 独立根布局；注明 `KEYLESS_DISABLED` 只本地 dev 需要 | 采纳（D23） |
| r05 | low | 列出 vitest、`@edge-runtime/vm`、`@playwright/test`；精确锁 convex-test 0.0.65 | 部分采纳（依赖照列；版本按 X6 选满期版本，不写死 0.0.65） |
| r06 | low | `auth.protect()` 只在 `(app)/layout.tsx` 调一次 | 采纳（D23） |
| r07 | low | `viewer` 查询 + 建档完成前不挂业务查询；claim 变化 patch | 采纳（D23） |
| r08 | low | `isTestAccount` 按 issuer 或 seed 置位 | 采纳（D20） |
| r09 | low | 默认邮箱定向邀请，链接作备选，共用 accept 入口 | 采纳（D21） |
| r10 | low | 实例表补"托管平台与 FAPI 代理"行；上线前解码生产 token 核对 `iss` | 采纳（生产用自有域名，风险低，但核对步骤保留） |
| r11 | low | 引用与措辞小错；升级策略写"React 小版本跟随 Clerk" | 采纳（X1-4） |

### 3.7 observability-ops（可观测性与运维）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | high | `dataCollection` 全键显式 false，`satisfies Required<DataCollection>` | 采纳（D30） |
| r02 | high | 所有入口强制 `withSanitizedErrors`；模型输出解析自行 try/catch；金丝雀加非法 JSON 用例并扫 `error_message` | 采纳（X4；包装器并入 D08 构造器，不另起一层） |
| r03 | medium | 删 `enableLogs`/`tracesSampleRate`，过滤 Console integration；V8 跑 typecheck | 采纳（D30） |
| r04 | medium | staging 做单独 Vercel 项目或 v1 取消；不靠隐藏选项 | 采纳（D29：v1 取消，将来加时用单独项目） |
| r05 | medium | v1 三层环境，staging 列为扩展点并写触发条件 | 采纳（D29） |
| r06 | low | "约 1000 次"改为"有限数量，可能随时清除" | 采纳 |
| r07 | low | Vercel 价格改引官方页；删无源的 Admin 说法 | 采纳（D28、D34） |
| r08 | low | 对账前置条件与局限；CI 用联合身份 | 采纳（D35） |
| r09 | low | 补全 9 个日志主题；关闭"是否含参数"待验证项；`error_message` 列为扫描字段 | 采纳（X4） |
| r10 | low | 候选表加"v1 不接 log streams"并写取舍，交 15 决定 | 采纳（D31，升为用户决策） |

### 3.8 data-evolution（数据与演进）

| id | 严重度 | 反驳要求（摘要） | 裁决 |
| --- | --- | --- | --- |
| r01 | medium | `formatUsd` 移到 UI；需要时加纯整数 `formatCentsUsd` | 采纳（D36） |
| r02 | medium | 时钟只在 mutation/cron 读；cron 写 `rooms.localDate`；测 query 不读时钟 | 采纳（D11、D37） |
| r03 | medium | 先跑 V-D2 再二选一，更新风险表 | 采纳（D37；V-D2 列为开放问题 O5） |
| r04 | medium | 抹除列为只追加表上第二种也是最后一种写入；编译期断言字段不相交；测 `contentHash` 不变 | 采纳（D38） |
| r05 | low | staged 索引自 1.26，1.47 新增的是 `.staged()` 表校验器 | 采纳（D10） |
| r06 | low | `--replace-all` 描述更正 | 采纳 |
| r07 | medium | CI grep 只禁自动化脚本；保留 break-glass 恢复手册 | 采纳（D39） |
| r08 | low | 周期备份需 Pro，记开放问题并给无 Pro 退路 | 采纳（D32、X5） |
| r09 | low | `commitTs` 不进 returns DTO；改写 $3 否决理由 | 采纳（X3） |
| r10 | low | 恢复手册第一步 Backup Now，从恢复前快照重放抹除 | 采纳（D39） |
| r11 | low | V-M3 加核对：没有 `_generated/schema` 就 `import schema from "./schema"` | 采纳 |
| r12 | low | 前端计数复用码点函数；模型输出先 NFC 再过 Zod | 采纳（D40） |

## 4. 相互依赖

| 上游决定 | 影响到 | 约束内容 |
| --- | --- | --- |
| D04 仓库布局（代码组织） | Convex 打包 | `convex.json` 的 `externalPackages` 不得含 `'*'`，否则 `workspace:` 包会被外置（`NM:convex/src/bundler/external.ts:179-212`）；`convex/` 在 `@sfm/backend` 包根；`node.nodeVersion: "24"` 与 `.node-version` 一致 |
| D04/D05 包图 + 引擎纯度 | D36 金额、D37 日期、D15 解析 | 引擎禁 Intl/Date/网络：`formatUsd` 进 `apps/web`，`todayInTimeZone` 只在 backend 的 mutation/cron；规则引擎可被评测与 convex-test 直接 import |
| D06 ESLint 配置 | D26 可访问性、D08 鉴权入口 | jsx-a11y 只合并 rules；`require-access-control` 的 pattern 必须与 D08 构造器名一致；`anonQuery` 进白名单 |
| D14 网关（模型层） | 10 运行时、D07 编排 | 流式调用 + AbortSignal 总截止必须短于 Convex action 时限，且早于看门狗 deadline；网关不写业务表，结果交 commit mutation 做过期拒绝；`maxRetries` 与 attempt 重试不叠加成"最多 4 次计费请求" |
| D18 评测 runner | D06/X6 工具链 | 评测是 Vitest 的一个 project，与 convex-test、jsdom 并列；不依赖 Node 类型剥离 |
| X2 上限落点（模型层 × Convex 内部） | 03 schema、12 API、10 运行时 | 需要 `runs`/attempt/`rooms` 的发起者索引、run 文档的预留字段、`spendCounters` 表；被调度路径返回 `deferred` 而不 throw |
| D08 + X4 构造器 | 12 API、D30 Sentry、16 测试 | 每个公开/内部函数都经同一构造器获得鉴权与错误清洗；金丝雀扫描以此为前提 |
| D20/D21 身份 | D23 路由、13 前端、03 schema | `email_verified` claim → accept 守卫；邀请页与 `/setup` 豁免 `auth.protect()`；`roomInvites` 要支持"无 token 的邮箱定向"和"哈希 token"两种形态 |
| D02/X3 事件顺序 | 03 schema、12 API、D01 退出 | 事件表加 `seq`；返回字符串游标；L1 映射 UNIQUE；L0 迁移后断言游标单调 |
| D32 Convex Pro | D30、D31、D39 | 不采购时 exception reporting、log streams、周期备份全部改走 X5 退路 |
| D29 三层环境 | D33 开关、D35 成本、16 测试 | preview 强制 stub（不持 key）；真实模型冒烟只能在 dev 或 prod 低额度 key 上做 |
| D11 `rooms.localDate` | 06 规则引擎、09 约束变更 | 交付日期类规则在 query 中读 `localDate`，在 mutation 中用 `Date.now()` 重算，两者可能相差一个 cron 周期，以 mutation 为准 |
| X1 版本纪律 | 所有备忘录 | React 小版本跟随 Clerk；SDK 升级前重跑 PROBE；例外清单到期由 CI 提醒 |

## 5. 对设计文档的直接含义

### 10-agent-runtime
- 编排：`scheduleAttempt()` 唯一接缝；mutation 写状态 + 同事务 `runAfter(0, runTurn)` + `runAfter(deadline, turnWatchdog)`（D07）。
- 网关：`client.beta.messages.stream().finalMessage()`；显式 `thinking: {type: "adaptive"}`、`output_config.effort` 按路由；AbortSignal 总截止早于看门狗；`stop_reason: max_tokens` 转 HumanRequest 或降一档 effort（D14）。
- 错误分支表：400 按 `(route, schemaHash, promptVersion)` 连续 N 次才熔断；401/403 全局告警并停调度；413 只把该 run 转 HumanRequest；429 退避（model-layer r08）。
- 上限：照抄 X2 落点表；被调度路径不 throw。
- 平台时限：query/mutation 用户代码 1 秒、每事务 4,096 个索引区间；Free/Starter 档 scheduled job 并发 8、mutation 16，dev 部署上的看门狗频率按此设定（stack-review r05）。
- 缓存与回退：4 个断点、新增事件合成一个 block（D16）；`fallbacks: "default"` + 开关 + `fallbackServed` 监控（D17）。
- 记账：`modelCalls` 逐次记录，只存响应原文与请求哈希（D19）。stub 模式是 preview 的唯一模式（D29）。

### 11-architecture
- 4 包结构与依赖方向（D04）；强制手段 L1/L2/L3/L5/L6 + CI，L4 推迟（D05）；`convex.json` 断言（§4 第 1 行）。
- 引擎纯度清单：禁 Intl、Date、随机数、网络；金额格式化在 `apps/web/lib/format.ts`（D36）。
- decide/apply 分离，每个 mutation 自写落库，不做通用解释器（D01）。
- 函数构造器层：`convex/lib/functions.ts` 定义 user/member/anon 与 internal 构造器，内置鉴权与 `withSanitizedErrors`（D08、X4）。
- 前端：`/setup` 独立根布局；`(app)/layout.tsx` 一次 `auth.protect()`；邀请页豁免（D23）；next-intl 无路由（D27）。
- 环境与配置：三层环境、`config.ts` 白名单、Clerk 实例表含 FAPI 代理行（D29、D33、identity r10）；Node 24 + `.node-version`；版本纪律 X1。

### 12-api
- 构造器目录：`userQuery/userMutation/memberQuery/memberMutation/anonQuery` + internal；v1 无公开 action（D08）。
- 邀请：`createEmailInvite`、`listMyInvites`、`createLinkInvite`、`acceptInvite`（单一写入口，错误码含 `EMAIL_UNVERIFIED`）；`viewer` query + `ensureViewer` mutation（D21、D23）。
- 节流：`startRun`、`retryTurn`、`createRoom` 返回 `RATE_LIMITED`（X2）。错误码表加 `internal`（X4）。
- 事件读取：返回字符串游标，returns 不含 bigint（X3）；所有 returns 用 `v.*`，L2 校验多余字段（D12）。
- 日期：query 读 `rooms.localDate`；抹除只经 `privacy.*`（D11、D38）；seed/reset 仅 dev/preview。

### 15-operations
- 托管与采购：D28、D32 待用户决定；日志去向 D31 待用户决定；无 Pro 退路见 X5。
- 环境：dev / preview（stub）/ prod，staging 的触发条件与形态（D29）。
- 错误与日志：Sentry 配置（D30）、`withSanitizedErrors`、金丝雀必扫字段（X4）；dashboard 日志写"有限数量，可能随时清除"。
- 成本：`modelCalls` + 价目表 `asOf`；对账前置条件与局限（D35）。
- 备份与恢复：周期备份 + 发布前手动备份 + break-glass 手册 + 抹除重放（D39）。
- 发布：排空 → 部署 → 健康检查；L0 退出手册含维护开关、排空在途 run、import 默认 `requireEmpty`、游标单调断言（stack-review r03）；V5 只在首次上生产前演练一次，V6 按触发条件演练。
- 密钥轮换 90 天（D34）；版本例外清单到期检查（X1）。

### 16-testing
- 工具：Vitest 4.1.11，projects = node / edge-runtime（convex-test）/ jsdom / evals；`tsc --noEmit`；Playwright 1.64 + `@clerk/testing` + axe 门禁（X6、D18、D26）。
- L1/L2 分工：returns 校验经 `api` 引用并在 L2 复跑；并发、OCC、唯一性、节流、全局日上限、cron 只在 L2（D12）。
- 隐私金丝雀：Sentry 事件、`error_message`、`opsLog`；"以金丝雀开头的非法 JSON"用例（X4）。
- 身份 E2E：登录跳转 URL 不含 token；未验证邮箱接受定向邀请被拒（D21）。
- 架构与 lint 探针：不调鉴权助手的 public mutation 被 lint 拦下；`externalPackages` 不含 `'*'`（code-organization r04、r06）。
- 领域：query 路径不读时钟（D11）；抹除后 `contentHash` 不变（D38）；前后端码点计数一致、模型输出先 NFC（D40）；被调度路径遇上限返回 `deferred`（X2）。
- 模型：回退只断言接受与 `iterations` 形状（D17）；SDK 升级前重跑 PROBE 与参数 400 用例（X1）。
- 安装：`pnpm install` 在 `allowBuilds` 与冷却配置下成功（X1、D27）。

### 其他文件的连带修改
- 03-schema：事件 `seq` 与 `by_room_order`；发起者索引；run 预留字段；`spendCounters`；`roomInvites` 两种形态；`rooms.localDate`；`REDACTABLE_FIELDS`。
- 05-protocol / 14：是否接受 `{templateKey, params}` 结构化公共文本（D27）。
- 07：请求原文的保留期与最小化（D19）；`email_verified` 守卫（D21）。
- 18-decisions：D28、D31、D32 三项采购决定，以及 inputs/04 要点 7 的更正（X3）。

## 6. 开放问题与待验证

- O1（用户）Convex Pro 是否采购（D32）。O2（用户）Vercel Pro + 自有域名（D28）。O3（用户）v1 是否接 Axiom（D31）。
- O4 不同事务的 `commitTs` 是否唯一，决定 L1 的 UNIQUE 键（X3）。
- O5 V-D2：Convex 运行时 Intl 时区支持，决定是否保留 `fallbackUtcOffsetMinutes`（D37）。
- O6 `use-intl` 与 `next-intl` 的 spike 对照（D27）。O7 03/05 是否接受结构化公共文本（D27）。
- O8 dev 实例实测 `email_verified` claim（D21）；上线前解码生产 token 核对 `iss`（identity r10）。
- O9 非 Pro 计划能否 `npx convex export`（X5）；`_generated/schema` 是否生成（data-evolution r11）；shadcn Base UI Button 是否透传 `focusableWhenDisabled`（D26）；pnpm symlink 下显式 glob 的必要性与 Vitest 5 兼容性（X6）。
- O10 SDK 1.1.0 → 1.3.x 的升级时点（X1）。
