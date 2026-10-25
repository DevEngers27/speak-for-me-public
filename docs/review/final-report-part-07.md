### 2.3 Low（表格）

| 编号 | 问题 | 建议要点 | 工作量 | 来源 |
|---|---|---|---|---|
| L1 | 日期只校验格式不校验含义；"今天"时区未约定（README.md:532 只针对团队日程）；报价/审批无有效期 | 服务端算 today（活动在 11-01 夏令时结束前，可固定 UTC-7 并注释为 MVP 简化），`today ≤ deliveryDate ≤ deadline` 且 ≥ earliestDeliveryDate，格式通过后按字典序比较；fixture 日期设几周后避开边界；validUntil 和审批有效期砍掉（版本机制已覆盖） | 15 分钟（B） | security-22 |
| L2 | `src/proxy.ts` 缺 key 时放行（fail-open），与 `auth.config.ts` 的 fail-closed 相反；Clerk 是否启用的判断在两处重复；配置只查"有没有值"，格式错误的 pk_test_ key 会让全站含 `/setup` 返回 500（审计员复测属实），`env:check` 按设计只查存在性；条件挂载 Provider 在半配置状态下 `useQuery` 会抛错 | 抽出不含 server-only 的 `isClerkConfigured()` 供 proxy 和 config 共用，内含格式校验（pk_/sk_ 前缀并同为 test 或 live；Convex URL 为 https 且以 .convex.cloud 结尾或 localhost，拒 .convex.site），不合格视为"未配置"；托管环境设 `REQUIRE_AUTH=1` 时缺 key 返回 503（不依赖 VERCEL_ENV）；私有路由段 `src/app/rooms/layout.tsx` 做服务端门槛显示 "Backend not configured. See /setup."；`check-env.mjs` 同样格式检查，不要在脚本里跑 `npx convex env list`（会打印值）；frame-ancestors 'none' 会挡住 Mana 嵌入加分项，慎加；README 写明 proxy 只负责 UX 跳转，授权在每个 Convex 函数 | 30–45 分钟，可选 | security-23, code-18, code-16, code-13 |
| L3 | 供应链与工具链：16 个精确版本绕过 pnpm 11 默认 24 小时冷却期且 README 没说明；loose 模式会以一条 info 自动追加豁免；actions 只锁主版本标签；CI 无缓存/超时/并发控制；`.npmrc` 的 engine-strict 和 save-exact 在 pnpm 11 下不生效（审计员实测 `pnpm config get` 返回 undefined，Node 不符只警告）；engines 比依赖实际需要窄；README 只给全局安装命令 | 赛中只做纪律：PR 评审检查 `pnpm-workspace.yaml` diff，任何新增 exclude/allowBuilds 都要说明理由；新依赖选发布 >1 天的精确版本；`saveExact: true` 移到 pnpm-workspace.yaml，删掉 `.npmrc` 失效的两行；engines 维持现状不开 engineStrict；README 加 `npx --yes pnpm@11.25.0 install --frozen-lockfile`（首选）或 `corepack enable` 兜底，并补一句 "If pnpm rejects a version because of minimumReleaseAge, pick an older exact version; do not add exclusions without review."；开工前每人跑一次 `pnpm check`，失败者按 `.node-version` 切到 24.x（Homebrew 可能已是 Node 25）；CI 加 `timeout-minutes: 10` 和 `concurrency`（pnpm/action-setup 必须放在 setup-node 之前）；锁 SHA、显式 `minimumReleaseAge: 1440` 推到赛后 | 各 5–15 分钟 | security-25, code-23, docs-25, code-25, code-21, process-25, product-25 |
| L4 | 仓库卫生：`next-env.d.ts` 被提交而 Next 文档要求忽略，dev/build 会来回改写；AI 编码代理环境下首次 `next dev` 会生成未忽略的 AGENTS.md；多个页面 JSX 挤在一行（最长 1353 字符）且无格式化工具；缺 `convex/tsconfig.json` 时 CLI 跳过 Convex 函数类型检查；force-dynamic 下 `next build` 不渲染页面，CI 绿只代表能编译 | `next-env.d.ts` 入 .gitignore 并移出仓库，typecheck 改 `next typegen && tsc --noEmit`；AGENTS.md 由团队决定提交或设 `agentRules: false`；只用 Prettier 格式化 `src/**/*.tsx` 和 `convex/**/*.ts` 并 .prettierignore 排除 README.md、pnpm-lock.yaml、`convex/_generated`（不要全量格式化 README），分支已开出就只拆 layout.tsx:14；`convex/tsconfig.json` 由环境负责人用 `npx convex codegen --init` 生成并与 `_generated` 一起提交；README.md:15 的 "production build work" 改为 "compiles"，D 每次合并 main 后在共享部署人工冒烟；curl 冒烟 CI 步骤可选，Playwright 砍掉 | 10–20 分钟各项，单独 PR，在大量分支开出前完成 | code-22, code-20, code-24, code-12 |
| L5 | P1 的"可下载变更单"和 CSV 输入路径没考虑公式注入 | 砍 CSV/XLSX 导出，改页面内 Markdown 或打印视图；坚持做 CSV 则对 `= + - @ \t \r` 开头的单元格加 `'` 前缀并经成员校验的 query 取数；粘贴 CSV 进 prompt 放不可信定界块 | 建议砍 | security-26 |
| L6 | 多房间共享同一预算时可能超额承诺（只在多房间代表同一项目预算时成立，confidence low） | MVP 一房间一预算，README Known limitations 写 "one room per project budget in the MVP"；committed 唯一来源见 P9 | 0–15 分钟 | security-14 |
| L7 | 三方批准同一版本把外部服务商的条款签核和客户内部预算承诺绑在一起，职责语义不清 | 已并入 P9：approvals 加 kind:'terms'\|'budget'，provider 视图只显示变更单条款和自己的任务；时间紧只改 UI 文案 | 20–30 分钟，可砍 | product-21 |
| L8 | 项目名称不统一（"Cal Hack 2026" / "Cal Hacks 2026" / Devpost slug cal-hacks-13-0）；首页 h1 泛化，没用 README.md:67 的 role statement | D 核实 Devpost 页面标题后三处统一；A 做 A1 首页时 hero 用 :67 精简版（如 "AI coordinates service scope changes. People approve the budget."），画面文案写清口径 "Budget cap drops to $4,800 → a $900 change (projected committed total $4,900) is blocked and renegotiated."，删掉 "Starter preview only" | 10–15 分钟 | docs-26 |
| L9 | S1–S5 把决策与执行任务混在一起、S4 与 hold 存在措辞歧义；赛道放弃顺序、度量存储、澄清截止、文档过长 | 已分别并入 P1、P2、M3、M4、M5、M7 | — | process-13, process-19, process-20, process-23, process-24, docs-22 |
| L10 | 目标用户与跨组织采用路径是未验证假设（谁付费、服务商为何进客户工作区） | 已并入 M5：收窄为"agency/外包工作室 + 有独立预算负责人的中型客户"或"企业内部采购"，两句话答案标 hypothesis | 15–20 分钟 | product-19 |
| L11 | 流程规则按长期项目设计；评审现场的降级路径（本地预览 vs Clerk 三账号）操作互斥且无运行手册 | 已并入 M7：只简化流程类规则；两种模式各写一页英文 runbook，预览标 simulated 且讲述人口径与标注一致 | 并入 M7 | product-22, gap4-08 |
| L12 | Citations 与结构化输出互斥；Convex isolate 运行时与 `convex/actions/` 目录命名陷阱；Workflow 组件前置条件；Convex 赛道是否因用 Workflow 加分（**待核实**） | 已并入 P13 第 7–8 点和 P14 第 3、5 点 | — | gap2-07, gap2-08, gap3-07, gap3-08 |

---

## 3. 被推翻或存疑的发现

**整条被推翻（3 条）**

- **security-19**（"安全接缝无单一负责人，无最低安全线清单"）：README.md:405-416 的 Required scenarios 已列出越权读 brief、预算变更后旧方案不可执行、超时/陈旧结果、重复执行四类场景，:543 规定砍单时保留 permissions/approval/execution，C2（:352）和 :503 已把上下文隔离分给 C、授权分给 B。残余风险（B 过载、安全场景没有强制检查时间点）已并入 P16 和 M1：建议在周六晚草稿提交检查点和功能冻结前各跑一次 6 项清单。
- **code-10**（"演示运维工具缺位"）：fixture、授权 reset、三个账号都已是 D1/S3 的计划项，不构成 README 未承认的新缺陷。但审计员仍认为 seed/reset 是评审两小时的运营基础（上调为 high），其"只新增、不删除"的 seedDemo 实现建议已并入 P12。
- **code-15**（"auth.config.ts 导入即抛错"）：这是有意的 fail-closed（`auth.config.ts:4`、README.md:494、convex/README.md:13），Convex 服务端对引用未设置变量的 auth config 本身也会拒绝推送；用项目级默认环境变量即可避免每人失败一次（已并入 P6）。

**待核实（核心论断依赖本地无法验证的外部事实，10 条）**

| id | 待核实的外部事实 | 处理方式 |
|---|---|---|
| product-18, architecture-16, docs-11, code-19 | Clerk 生产实例是否必须绑定自有域名、不能用 *.vercel.app | D 对照 Clerk 当前文档确认并记时间；无论结果如何，黑客松用 dev 实例（P6） |
| architecture-14, code-17 | 实际模型延迟 p50/p95、30 秒超时是否偏紧 | S4 拿到 key 后用最终模型实测 10 次（P12、P13） |
| docs-20 | Devpost/Cal Hacks 是否要求公开仓库 | D 周六上午核实（M3） |
| docs-23 | 官方 hacking start 时间与"代码须在活动期间编写"规则；zip mtime 是否即提交时间 | D 周六 10:00 前核实；主动披露赛前 starter（M3）；最坏情况开幕后重建 ~240 行脚手架约 1 小时 |
| gap3-08 | 用 Workflow 组件能否为 Convex 赛道加分 | 评分权重未公布，不要为赛道引入组件（P14） |
| gap4-06 | 评审来访组数、每组时长、赞助商评委是否单独来访 | D 向主办方确认；spend limit 留 3 倍余量（P18） |

**被剔除或弱化的子论点（原条目保留）**

- "只剩约 24 小时、算术上做不完"：本机时间距截止约 31 小时（复核时已不足 30 小时），25 小时在算术上排得下；已改为"无缓冲、开工时间未定、无降级顺序"（P2）。
- "Connection order 把 Mana 排到第 6 步"：:220 写明 "starting early"（P17）。
- "四个赛道没写主次"：:230 已有 "prioritize Hyphenate and Convex ... also target Microsoft"（P2）。
- "provider 能看到客户内部的承诺记录"：:302 把 commitments 限定为 Authorized roles（L7）。
- "S1–S5 全部达成一致才能开工""S4 在恢复前永远完不成"：:53 允许 "explicitly resolve"（P1）。
- "Node 22 用户安装会直接失败"：实测 pnpm 11 只给 [WARN]（L3）。
- "A/B/C 后续所有工作都排在环境链后面"：纯函数、契约、fixture、静态 UI 可并行，且 Convex 有本地匿名 deployment（P6、P11）。
- "低温度"：SDK 1.1.0 没有 temperature 参数（P13）。
- "check-env 只检查前端变量"：设计如此，Convex 变量本就读不到。
- "Clerk 切换实例后用户 ID 变化"作为选 tokenIdentifier 的理由：换实例后两种 ID 都会变，与选择无关（P15）。
- "现场演示时日期检查会偏一天"：评审时段 10:30–12:30 PDT 对应 UTC 17:30–19:30 同一天（L1）。
- "预算下调由身兼审批人的财务手动降"：README 没写由谁降（P7）。
- "三处互相矛盾/循环死锁"：实为 :53 与 :213 之间的歧义（P1）。
- "部署时机三种说法"：D1 与 :537 一致主张早部署，只有 :221 一处偏晚，是两处对一处（P6）。
- "Convex 的赛道优先级建立在未确认的奖金上"：无依据，:84 说明 Convex 是核心后端（M4）。
- "D 约 20 处职责"：计数口径不一，只保留定性描述和逐行引用（P16）。
- "rooms query 必然泄露预算"：Convex query 可按字段投影，缺的是披露决策（P8）。
- "组件可替 B/C 省约 12 小时"：仓库内找不到出处，组件只覆盖调度和重试（P14）。
- "每轮评审至少两次协商运行"：无可行解可由代码判定、不调模型（P12）。
- "任何人的本地保存都会推上线"：只有该 dev deployment 所有者本人的保存会推（M3）。
- "rooms 没有状态字段就表达不了方案过期"：比较两个 constraintsVersion 即可推导（P9）。
- "模型抽取 brief 是 P0 必做项"：没有任何 G 项要求（M6）。
- "sharp 0.35.5 没有 install 脚本"：lockfile 中无法核实，未计入优点。

---

## 4. 做得对的地方

1. **真实与模拟的边界很诚实**：What exists today 表（README.md:11-21）、Claims 规则（:47）、"Never fabricate historical Mana usage"（:115）反复区分 planned / implemented / tested / simulated，正好对上 Hyphenate 要求的 "evidence distinguishing real from simulated behavior"（:65）。`src/app/setup/page.tsx:5` 也明确要求在访问控制实现并测试前只用模拟数据。
2. **金融权限与执行边界清楚**：agent 只提议，人批准具体版本，代码负责权限、算术和约束（:44、:281、:288）；MVP 只写内部记录，不转账、不签约、不改 ERP（:46）；幂等只承诺内部记录，不宣称对外部支付系统 exactly-once（:211）。资金事故风险很低，直接对应 Microsoft 的 Responsible design 和 Hyphenate 的 escalation。
3. **演示关键时刻选得好**：审批途中预算下降、旧方案被阻断（:245），pitch 从这里开场（:560），和 Hyphenate 的 "memorable detection, recovery"、Convex 的实时同步与事务能力天然契合；场景数字本身自洽（4,000+1,400 > 5,000 不可行，4,000+900 ≤ 5,000 可行，降到 4,800 后被阻断）。
4. **协议草案的核心不变量方向正确**：金额用整数美分且非负（`src/lib/negotiation.ts:7`），日期用 `z.iso.date()`（:8，审计员实测拒绝 2026-02-30、接受 2028-02-29），消息带 baseProposalVersion 和 constraintsVersion（:15-16），动作是枚举（:17），approvals 同时绑定两个版本（`convex/schema.ts:28-31`），commitments 按 operationId 建索引（:33-35），events 已有可见性字段雏形（:44-45），所有子表带 roomId 前缀索引。README 还主动指出索引不保证唯一（:291、convex/README.md:11）、action 与 mutation 不是原子事务（:211）、不要把私有字段发到浏览器再用 CSS 隐藏（:306）。
5. **默认安全、密钥纪律好**：`convex/auth.config.ts:5-6` 缺 issuer 时 fail-closed，applicationID "convex" 与 `ConvexProviderWithClerk` 一致（已在 node_modules 核对）；`src/lib/config.ts:1` 用 server-only；`scripts/check-env.mjs` 只报告存在性不打印值；`.gitignore:5-6` 用 `.env*` 加 `!.env.example`；Convex 侧密钥只放 dashboard（`.env.example:11-14`）；Anthropic 客户端只在服务端创建、无默认模型、缺配置即失败、不是公开 Convex 函数（`convex/lib/anthropic.ts:5-14`；具体超时/重试值按 P13 调整）；Provider 嵌套顺序 ClerkProvider > ConvexProviderWithClerk 正确，`ConvexReactClient` 在 useState 里惰性构造；CI 权限只有 contents: read、用 `--frozen-lockfile`、不用 secrets、用 pull_request 而非 pull_request_target；`allowBuilds` 只放行 esbuild 和 unrs-resolver，豁免按精确版本而非包名。
6. **README 自述经实测成立，赛道分析层次清楚**：install / lint / typecheck / build 在本机全部通过（见第 5 节）；赛道分析分三层（官方标准、我们的选择、还缺的证据，:59），主动记录 Convex 奖品冲突（:93）、Microsoft 美元字段（:133）、评审格式冲突（:554），明确不为了放 logo 硬加 Hyphenate SDK 或 Azure（:76、:131）；外部事实标了核实日期（:57）；Hyphenate 的一句话角色陈述已写好（:67）；Required scenarios 表（:405-414）可直接转成测试清单；starter 在零凭据下可正常降级运行（`layout.tsx:15-16`、`proxy.ts:6-8`）。

---

## 5. 运行时验证结果

只有 code 视角执行了运行时验证（其余五个视角的 runtime_check 为空；审计员另做了 zod safeParse、tsc 探测、esbuild 打包、node:test、git merge 模拟等复现，见第 7 节）。以下如实转述：

- **环境**：macOS（Darwin 25.6.0），Node v24.21.0（仓库 `.node-version` 为 24.19.0，在 engines 范围内），通过 npx 调用 pnpm 11.25.0。
- **install**：`npx --yes pnpm@11.25.0 install --frozen-lockfile` 成功，EXIT=0，约 4.3 秒（热缓存，日志 "reused 362, downloaded 0" 和 "Lockfile passes supply-chain policies (verified 6h ago)"）；新增 362 个包，unrs-resolver 的 postinstall 正常执行，无警告；实际安装版本与 package.json 一致。
- **check（lint + typecheck + build）**：`npx --yes pnpm@11.25.0 check` 成功，EXIT=0，约 8.5 秒。eslint 无输出（另用 `--max-warnings=0` 跑过，EXIT=0）；`tsc --noEmit` 无错误（在没有 `.next` 的干净副本里复测也通过）；`next build`（Turbopack）输出 "Compiled successfully in 988ms"、"Finished TypeScript in 854ms"，`/`、`/_not-found`、`/rooms`、`/setup` 全部是 ƒ (Dynamic)，识别到 "ƒ Proxy (Middleware)"，无警告。
- **结论**：README「What exists today」声称 lint、type checks、production build 都能通过，在本机得到验证。GitHub 上 CI 的实际运行状态无法验证（代码是 zip 解压的，不是 git 仓库）；`actions/checkout@v7` 和 `actions/setup-node@v7` 的标签在上游确实存在。
- **附加运行时验证**：`next start` 下 `/`、`/rooms`、`/setup` 返回 200，`/nope` 返回 404，`/setup` 显示 Not configured；用格式错误的 Clerk key（pk_test_notarealkey）启动，`/` 和 `/setup` 都返回 500，报 "Publishable key not valid"；临时副本运行 `next dev`，`next-env.d.ts` 被改写为 `.next/dev/types` 并生成了 AGENTS.md；`pnpm env:check` 没有 `.env.local` 时 EXIT=1（带 ELIFECYCLE 报错），填入假值时报告全部 configured、EXIT=0；pnpm 11 不读取 `.npmrc` 里的 engine-strict 和 save-exact（`config get` 返回 undefined，`pnpm add` 写入 ^ 范围）；用 pnpm 12.15.0 运行时会因 packageManager 字段自动切换到 11.25.0。
- **副作用**：仓库内没有修改任何被跟踪的文件（`next-env.d.ts` 的 mtime 没变）；只生成了 node_modules、.next、tsconfig.tsbuildinfo，三者都在 .gitignore 里；所有改动文件的实验都在 scratchpad 目录的副本里进行；本机另有一个用户自己的 `next dev` 进程（`/Users/zhennn/Documents/26Fall/cal-hack-2026`），没有动它。

（来源：code 视角 runtime_check）

---

