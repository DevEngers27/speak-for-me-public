# 技术选型：代码组织与工具链

> 子决策范围：仓库布局、依赖方向的强制手段、lint/格式化/测试/提交钩子、pnpm 与 Node 版本策略。栈本身（Next.js 16 App Router + Convex 1.48 + Clerk 7 + `@anthropic-ai/sdk` 1.x）不在此讨论。
> 日期：2026-10-24。正文分 5 个文件：本文件（§0 结论、§1 需求与约束、§2 候选方案表）、`code-organization-part2.md`（§3 评估维度、§4.1–4.4 推荐：布局、依赖方向、强制手段、TypeScript）、`code-organization-part3.md`（§4.5–4.10 pnpm、ESLint、测试、钩子、Node、脚本）、`code-organization-part4.md`（§5 否决理由、§6 风险与退出、§7 如何验证）、`code-organization-part5.md`（§8 来源）。
> 缩写：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`NXD:` = `NM:next/dist/docs/01-app/`；`IN04:` = 任务书 inputs/04-platform-constraints；`npm:` = 2026-10-24 执行 `npm view` 的结果；来源编号 [S#] 见 part5 第 8 节。

## 0. 结论（先读这一段）

| 项 | 决定 |
| --- | --- |
| 仓库布局 | **pnpm workspace，4 个包，不用 Turborepo**：`packages/engine`（`@sfm/engine`，纯 TS，只依赖 zod）→ `packages/scenario-scope-change`（`@sfm/scenario-scope-change`）→ `packages/backend`（`@sfm/backend`，包根下放 `convex/`）→ `apps/web`（`@sfm/web`，Next 16，只通过 `@sfm/backend/api` 拿函数引用与类型） |
| 依赖方向强制 | 以**包图**为主（package.json 依赖 + pnpm 隔离 node_modules + `exports` 子路径白名单），lint 补漏：`import-x/no-extraneous-dependencies`、`eslint-plugin-boundaries`（包内分层）、引擎纯度规则（`no-restricted-imports`/`no-restricted-syntax`）、`@convex-dev/eslint-plugin`；外加一个读取 package.json 的"架构测试"。不用 TS project references，不用 dependency-cruiser |
| 内部包形态 | 源码直出（`exports` 指向 `.ts`，无构建步骤）；内部包之间只用包名或相对路径，**不用 tsconfig `paths` 别名**；`@/*` 别名只在 `apps/web` 内使用 |
| Lint | **ESLint 10.x** flat config（不是 9：ESLint 9 已于 2026-08-06 EOL [S1]）+ `typescript-eslint` 8.x type-checked + `eslint-config-next` 16.4.x（作用域限定 `apps/web`）+ `@convex-dev/eslint-plugin`（限定 `convex/`）+ `eslint-plugin-import-x` + `eslint-plugin-boundaries` 7.x + `eslint-config-prettier` |
| 格式化 | **Prettier 3.x**（不用 Biome） |
| TypeScript | **6.0.x**（不上 7：`typescript-eslint` 8.72.0 的 peer 是 `typescript >=4.8.4 <6.1.0` [npm]） |
| 单测/集成 | **Vitest 4.1.x**，`test.projects` 分 node / edge-runtime（convex-test）/ jsdom；Vitest 5 作为验证后再升的一行改动 |
| 端到端 | **Playwright 1.64.x** + `@clerk/testing` 2.x |
| 提交钩子 | **lefthook 2.x**（pre-commit：格式化+lint 暂存文件；pre-push：typecheck+单测）；CI 才是门禁 |
| pnpm | `packageManager` 锁 **pnpm 11.x**（实现开始时最新且已满 7 天的 11.x）；`minimumReleaseAge: 10080` 显式设置（从而 strict）；`trustPolicy: no-downgrade`；`catalog:` 统一版本；`allowBuilds` 白名单 |
| Node | **Node 24 LTS**（本地、CI、Convex `node.nodeVersion: "24"`、前端托管四处一致）；Node 26 于 2026-10-28 进入 Active LTS [S3]，但 Convex 目前只支持 Node 22/24 [S4]，等 Convex 支持后整体一起升 |

## 1. 需求与约束（引用任务书核心与平台约束）

### 1.1 来自任务书的硬需求

- 任务书 §2：范围是"通用协商引擎 + 首个场景插件"，"引擎接口必须能容纳第二个场景"；§5 的 11-architecture 明确要求写出"模块边界（engine 包 vs scenario 包 vs app）、目录结构、依赖方向"。→ 代码组织必须让 **engine 不知道任何场景**、**场景之间互不依赖**、**app 不直接接触引擎和场景的服务端逻辑**。
- 任务书 §3 核心 1（私密委托）："不得把私密字段发到浏览器再隐藏"。→ 引擎、场景（含私密简报处理、提示词、报价成本）与 Claude SDK 不应能被打进浏览器包。代码组织是这条不变量的**第一道结构性防线**（字段裁剪仍在 Convex query 内完成，见 IN04 part7 §5 含义 2）。
- 核心 4（代码负责校验）：确定性规则必须是可单测、不依赖时钟/随机数/网络的纯函数。→ 引擎与场景包要有"纯度"约束。
- 核心 5（幂等且原子）：并发不变量不能只靠 convex-test 验证（IN04 part2 §1.12）。→ 工具链要容纳"针对真实 dev 部署的并发脚本"。
- 任务书 §6：反对过度设计，"两个方案都完整时选简单的"。

### 1.2 来自平台约束与审查发现的工程约束

| # | 约束 | 来源 |
| --- | --- | --- |
| C1 | Convex 默认运行时入口用 esbuild `platform: "browser"` 打包，`conditions: ["convex","module",...]`，**未显式传 `tsconfig`**；默认把所有非相对导入一起打包（只有 `"use node"` 的 `externalPackages` 才外置） | `NM:convex/src/bundler/debugBundle.ts:60-90`；`NM:convex/src/bundler/external.ts:59-101` |
| C2 | Convex 打包器把 `server-only` 替换成空模块 | `NM:convex/src/bundler/serverOnly.ts` |
| C3 | `convex/tsconfig.json` 缺失时 CLI 跳过 Convex 函数类型检查；模板要求 `module/target: ESNext`、`isolatedModules`、`noEmit` | `NM:convex/src/cli/lib/typecheck.ts:120-124`；`NM:convex/src/cli/codegen_templates/tsconfig.ts` |
| C4 | `convex/` 内不用 `@/` 别名（打包器是否解析根 tsconfig `paths` 待验证） | inputs/02 F03.15、F11.2 |
| C5 | 无凭据环境无法 codegen，`_generated` 需入库 | inputs/02 F11.2 |
| C6 | `_generated/api.js` 运行时只是 `anyApi` 代理，不含服务端代码；另有 `codegen.staticApi` 选项按 validator 生成类型 | `NM:convex/src/cli/codegen_templates/api.ts:118-156`；`NM:convex/src/cli/lib/config.ts:281-286` |
| C7 | Next 16 删除 `next lint`，`next build` 不再跑 lint；`eslint-config-next` 默认 flat config；16.4.0 起声明支持 ESLint 10，但其内含插件的 peer 尚未列出 10 | `NXD:02-guides/upgrading/version-16.md:943-949, 1096-1098, 1276`；`NXD:03-api-reference/05-config/03-eslint.md:83-85` |
| C8 | Turbopack 自动转译 workspace 包（两种路由器），无需 `transpilePackages`；根目录按 workspace 文件自动探测 | `NXD:03-api-reference/05-config/01-next-config-js/transpilePackages.md:21-23`；同目录 `turbopack.md:90-115` |
| C9 | convex-test 需 Vitest + `@edge-runtime/vm`，用 `import.meta.glob` 收集模块；非默认目录要自己写 glob；不模拟并发/限额 | [S5]；IN04 part2 §1.12 |
| C10 | pnpm 11 起 `minimumReleaseAge` 默认 1440 分钟且**非 strict**；显式设置后 strict 默认开启 | [S2] |
| C11 | 原仓库基线：Node `>=24.19.0 <25`、pnpm 11.25.0、TS 6.0.3、ESLint ^9.39.5、`allowBuilds` 写在 pnpm-workspace.yaml | `/Users/zhennn/cal-hack-2026-main/package.json`、`pnpm-workspace.yaml` |

## 2. 候选方案表

### 2.1 仓库布局

| 代号 | 布局 | 依赖方向如何强制 | 一句话评价 |
| --- | --- | --- | --- |
| L-A | 单包（原仓库形态）：根 = Next 应用 + `convex/`；引擎/场景放 `convex/lib/` 或 `src/engine/` | 只能靠 lint | 最简单，但引擎、场景、SDK 与前端同处一个依赖集合，"前端误导入服务端模块"只有 lint 一道防线 |
| L-B | 单包 + 顶层目录分层：`engine/`、`scenarios/<id>/`、`convex/`、`src/` | `eslint-plugin-boundaries` 或 dependency-cruiser | 比 L-A 清楚，仍是一个 package.json，`@anthropic-ai/sdk` 对 `src/` 可解析 |
| **L-C** | **pnpm workspace：`packages/engine`、`packages/scenario-<id>`、`packages/backend`（含 `convex/`）、`apps/web`** | **包图 + `exports` + lint 补漏** | **推荐**。web 的依赖集合里根本没有引擎、场景与 SDK |
| L-D | pnpm workspace，但 `convex/` 留在 `apps/web` 内（Next+Convex 同包，官方快速上手形态） | 包图（引擎↔场景）+ lint（web 内 `src/` vs `convex/`） | 部署命令最简单，但 web 包必须依赖引擎与 SDK，结构性隔离失效一半 |
| L-E | pnpm workspace，`convex/` 放仓库根 | 包图 + lint | 根包带运行时依赖，子包向上解析都能"摸到" `convex`、SDK；web 只能用 `../../convex/_generated/api` 跨包相对导入 |
| L-F | L-C + Turborepo（官方 monorepo 模板形态 [S6]） | 同 L-C | 内部包无构建步骤时缓存收益小，多一套配置 |
| L-G | Nx | 项目图 + 模块边界规则 | 能力强但学习成本与配置面最大，对 4 个包明显过度 |

### 2.2 工具候选

| 维度 | 候选 | 版本 / 许可证 / 最近发布（npm，2026-10-24） |
| --- | --- | --- |
| 依赖方向 | eslint-plugin-boundaries | 7.3.0 / MIT / 2026-10-23（7.2.1 为 2026-10-21） |
|  | dependency-cruiser | 18.7.0 / MIT / 2026-10-19；engines `^22‖^24‖>=26` |
|  | TS project references | TypeScript 内置 |
|  | eslint-plugin-import-x（`no-extraneous-dependencies`、`no-cycle`） | 4.17.1 / MIT；peer `eslint ^8.57‖^9‖^10` |
| Lint | ESLint 10 | 10.13.0 / MIT / 2026-10-16；`maintenance` tag 指向 9.39.5（已 EOL [S1]） |
|  | typescript-eslint | 8.72.0 / MIT；peer `eslint ^8.57‖^9‖^10`、`typescript >=4.8.4 <6.1.0` |
|  | eslint-config-next | 16.4.3 / MIT；依赖 eslint-plugin-import 2.32.0（peer ≤^9）、eslint-plugin-react 7.37.5（peer ≤^9.7）、eslint-plugin-jsx-a11y 6.10.2（peer ≤^9） |
|  | @convex-dev/eslint-plugin | 5.0.0 / Apache-2.0；peer `convex ^1.43.0` |
| 格式化 | Prettier | 3.9.10 / MIT |
|  | Biome | 2.6.2 / MIT OR Apache-2.0 |
| 测试 | Vitest | 5.0.5（2026-10-15）/ 4.1.12（同日，V4 线仍在维护）/ MIT |
|  | convex-test | 0.0.65 / Apache-2.0；peer `convex ^1.43.0`；自身 devDeps 用 vitest 1.6.1 |
|  | @playwright/test | 1.64.1 / Apache-2.0 |
|  | @clerk/testing | 2.2.50 / MIT；peer `@playwright/test ^1` |
| 钩子 | lefthook | 2.2.2 / MIT；`postinstall` 下载平台二进制（optionalDependencies） |
|  | husky (+ lint-staged) | 9.1.7 / MIT（lint-staged 17.6.0 / MIT，engines `>=22.22.1`） |
| 编排 | turbo | 2.11.10 / MIT |
| 包管理 | pnpm | latest 12.15.0；latest-11 为 11.28.8（2026-10-22）；12.0.0 发布于 2026-08-26 |
