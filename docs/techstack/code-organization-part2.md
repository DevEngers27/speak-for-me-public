# 技术选型：代码组织与工具链（第 2/5 部分）

## 3. 评估维度

### 3.1 布局方案（5 分制，越高越好；"不变量"指对任务书 §3 核心 1、4 的结构性支撑）

| 维度 | L-A 单包 | L-B 单包分层 | **L-C 推荐** | L-D web 内 convex | L-E 根 convex | L-F +Turbo | L-G Nx |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 成熟度 | 5（官方快速上手） | 4 | 4（官方 monorepo 模板同构 [S6]） | 4 | 3（无官方示例） | 4（官方模板） | 4 |
| 与 Next 16 / React 19 兼容 | 5 | 5 | 4（Turbopack 自动转译 workspace 包，C8） | 4 | 3（跨包相对导入依赖 Turbopack root 探测） | 4 | 3（插件需跟进 Next 16） |
| 与 Convex 1.48 兼容 | 5 | 4（`convex/` 外的相对导入：待验证） | 4（esbuild 跟随 symlink 打包 workspace 包：待验证，见 7.1） | 4 | 4 | 4 | 3 |
| 学习成本 | 5 | 4 | 3 | 3 | 3 | 2 | 1 |
| 迁移成本（以后换布局） | 退出到 L-C 需大搬家 | 中 | 低（包即边界，可退回 L-B 只需改导入） | 中 | 中 | 低 | 高 |
| 对不变量的影响 | 2：仅 lint | 3：lint + 目录 | **5：web 无法解析引擎/场景/SDK** | 3：web 包依赖 SDK | 3：根依赖向下可见 | 5 | 5 |
| 部署复杂度 | 5：`convex deploy --cmd 'pnpm build'` | 5 | 3：deploy 命令需跨包 `--filter` | 5 | 3 | 3 | 2 |

L-C 与 L-F 在不变量上等价，差别只在 Turborepo；按任务书"选简单的"取 L-C。L-C 相对 L-A/L-D 多付出的成本（两份 `.env.local`、跨包 deploy 命令、多几个 tsconfig）是一次性的，换来的是"私密逻辑进不了浏览器包"从约定变成结构事实。

### 3.2 工具选择

| 维度 | ESLint 10 | Prettier | Vitest 4.1 | Playwright | lefthook | eslint-plugin-boundaries |
| --- | --- | --- | --- | --- | --- | --- |
| 成熟度 | 高 | 高 | 高 | 高 | 中高 | 中高（7.x 稳定线） |
| 兼容 | Next 文档声明支持（C7），部分插件 peer 警告需白名单 | 无耦合 | convex-test 文档写明 Vitest 4 `projects` 配置 [S5] | `@clerk/testing` peer `^1` | 与 Node 无关（Go 二进制） | peer `eslint >=6` |
| 许可证 | MIT | MIT | MIT | Apache-2.0 | MIT | MIT |
| 维护活跃度 | 当前主线（9 已 EOL） | 2026-10-10 发布 | V4 与 V5 同日发补丁 | 2026-10-14 | 2026-10-13 | 2026-10-23 |
| 学习成本 | 低（flat config 已是默认） | 极低 | 低 | 中 | 低 | 中（元素/策略模型） |
| 迁移成本 | 中（规则集重） | 低（可换 Biome 格式化） | 低（升 5 一行） | 中 | 低（换 husky 半小时） | 低（删配置块即可） |
| 对不变量 | `no-floating-promises`（Convex 官方推荐 [S7]）、`switch-exhaustiveness-check` 保状态机穷举；纯度规则保核心 4 | 无 | 引擎/场景纯函数单测、convex-test 状态机与权限测试 | 端到端隐私金丝雀 | 本地快速反馈 | 包内分层（API 层必做鉴权、model 层不反向依赖） |

## 4. 推荐与理由

### 4.1 目录结构

```text
speak-for-me/
├─ package.json              # private；只有工具链 devDependencies 与编排脚本，无运行时依赖
├─ pnpm-workspace.yaml       # packages、catalog、供应链设置（见 4.5）
├─ .node-version             # 24.x.y（精确）
├─ tsconfig.base.json        # 共享严格选项，无 paths
├─ eslint.config.mjs         # 唯一 flat config，按 files 作用域分块
├─ prettier.config.mjs  .prettierignore
├─ lefthook.yml
├─ vitest.config.ts          # test.projects 指向各包
├─ apps/
│  └─ web/                   # @sfm/web
│     ├─ package.json        # next, react, react-dom, @clerk/nextjs, convex, @sfm/backend: workspace:*
│     ├─ next.config.ts  tsconfig.json（extends base，加 Next 插件与 @/* 别名）
│     ├─ src/app/ … src/components/ … src/scenarios/scope-change/（只含展示组件，数据来自 query DTO）
│     ├─ src/proxy.ts
│     └─ e2e/                # Playwright
└─ packages/
   ├─ engine/                # @sfm/engine — 依赖：zod
   │  ├─ package.json        # "exports": { ".": "./src/index.ts" }
   │  └─ src/ protocol/ rules/ state/ approval/ disclosure/ plugin/（ScenarioPlugin 接口）index.ts
   ├─ scenario-scope-change/ # @sfm/scenario-scope-change — 依赖：@sfm/engine, zod
   │  └─ src/ catalog/ constraints/ rules/ templates/ fixtures/ index.ts
   └─ backend/               # @sfm/backend — Convex 项目根（convex CLI 在此目录运行）
      ├─ package.json        # convex, @anthropic-ai/sdk, zod, @sfm/engine, @sfm/scenario-*；exports 见 4.3
      ├─ convex/
      │  ├─ schema.ts  auth.config.ts  rooms.ts  proposals.ts  approvals.ts …   # API 层（薄）
      │  ├─ model/           # 业务助手：鉴权、读写、调用引擎（Convex 最佳实践的 model 层 [S7]）
      │  ├─ scenarios.ts     # 场景注册表：{ "scope-change": scopeChangePlugin }
      │  ├─ agents/          # 调 Claude 的 action（若需 "use node" 则独立文件）
      │  ├─ test.setup.ts    # import.meta.glob 模块表（convex-test）
      │  ├─ tsconfig.json    # extends ../../../tsconfig.base.json + Convex 必需项
      │  └─ _generated/      # 入库（C5）
      └─ scripts/            # 针对真实 dev 部署的并发/幂等脚本（16-testing）
```

要点：

1. **第二个场景** = 新建 `packages/scenario-<id>`，在 `convex/scenarios.ts` 注册一行，`@sfm/backend` 加一个 `workspace:*` 依赖；引擎零改动。包图天然禁止场景 A 导入场景 B（未声明即不可解析）。
2. **场景的浏览器侧展示**放在 `apps/web/src/scenarios/<id>/`，只消费 query 返回的已裁剪 DTO；场景包不进入 web 依赖。场景的表单字段描述（标签、单位、输入类型）若前端需要，由一个公开 query 返回，而不是让 web 导入场景包。
3. **不设 `packages/contract`**：web 需要的类型全部来自 `@sfm/backend/api`（函数声明 `args` 与 `returns` validator，见 inputs/02 F03.16）。模型输出的 Zod schema 属于引擎/场景，是服务端资产。

### 4.2 依赖方向（允许清单，其余一律禁止）

| 从 \ 到 | zod | @sfm/engine | @sfm/scenario-* | convex | @anthropic-ai/sdk | @clerk/* | next / react | @sfm/backend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| engine | ✓ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| scenario-* | ✓ | ✓ | ✗（含其他场景） | ✗ | ✗ | ✗ | ✗ | ✗ |
| backend | ✓ | ✓ | ✓ | ✓ | ✓ | ✗（身份经 `ctx.auth`） | ✗ | — |
| web | ✗（不需要） | ✗ | ✗ | ✓（`convex/react`、`convex/nextjs`） | ✗ | ✓ | ✓ | 仅 `./api`、`./dataModel` 子路径 |

另：engine 与 scenario-* 内禁止 `Date.now()`、无参 `new Date()`、`Math.random`、`crypto.randomUUID`、`fetch`、`process.env`、`console`（时间与 id 由调用方传入），保证规则是确定性纯函数（核心 4、6）。

### 4.3 强制手段：分层防线

| 层 | 机制 | 强制什么 | 失败时机 |
| --- | --- | --- | --- |
| L1 包图 | 各包 package.json 只声明允许的依赖；pnpm 默认隔离式 node_modules；**根 package.json 不放任何运行时依赖** | 跨包方向；web 无法解析 `@sfm/engine`、场景包、`@anthropic-ai/sdk` | 解析失败：typecheck / `next build` / `convex dev` |
| L2 子路径白名单 | `@sfm/backend` 的 `exports`：`"./api": { "types": "./convex/_generated/api.d.ts", "default": "./convex/_generated/api.js" }`、`"./dataModel": { "types": "./convex/_generated/dataModel.d.ts" }`；引擎/场景包只导出 `"."` | web 不能深导入 `@sfm/backend/convex/rooms` 等函数源文件 | tsc（`moduleResolution: "Bundler"` 遵守 exports）/ Turbopack |
| L3 未声明依赖 | `import-x/no-extraneous-dependencies`（`packageDir` 指向最近的 package.json） | 堵住"向上走到根 node_modules 摸到工具链包"的漏洞（Node 解析会逐级向上） | eslint |
| L4 包内分层 | `eslint-plugin-boundaries`：backend 内 `convex-api`（`convex/*.ts`）→ `convex-model`（`convex/model/**`）→ 包；model 不得导入 API 文件；web 内 Client 组件不得导入 `src/server/**` | 包内依赖方向 | eslint |
| L5 纯度 | engine/scenario 作用域的 `no-restricted-imports`（禁 `convex*`、`@anthropic-ai/*`、`@clerk/*`、`next*`、`react*`）+ `no-restricted-syntax`/`no-restricted-globals`（4.2 末尾清单） | 核心 4 的"确定性" | eslint |
| L6 Convex 纪律 | `@convex-dev/eslint-plugin` recommended + `require-access-control`(error) + `import-wrong-runtime`(warn，实验性) + `no-collect-in-query`(warn) [S8] | 公共函数必须有参数校验与访问控制；默认运行时不导入 node 文件 | eslint |
| L7 架构测试 | 一个 Vitest 用例读取所有 workspace 的 package.json，断言依赖集合 ⊆ 4.2 的允许清单 | 防止"顺手加依赖"绕过 L1 | CI |

L1、L2 是结构性的（不依赖任何人记得跑 lint）；L3–L6 是低成本补丁；L7 是 20 行代码。若要再砍，最先砍 L4。

### 4.4 TypeScript 与内部包形态

- `tsconfig.base.json`：`strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`noFallthroughCasesInSwitch`、`isolatedModules`、`verbatimModuleSyntax`、`module: "ESNext"`、`moduleResolution: "Bundler"`、`target: "ES2023"`、`noEmit`、`skipLibCheck`。`exactOptionalPropertyTypes` 暂不开（与 Convex `v.optional` 推导的交互待验证）。
- 内部包源码直出：`"exports": { ".": "./src/index.ts" }`，无 `build` 脚本。消费方：Convex esbuild（原生编译 `.ts`）、Turbopack（自动转译 workspace 包，C8）、Vitest、tsc（Bundler 解析）。
- **内部包禁止 `paths` 别名**：esbuild 未显式传 tsconfig 时按文件就近读取 tsconfig（C1，行为待验证），四个消费方解析别名的方式不一致；只用包名与相对路径可让所有消费方得到同一解析结果。`apps/web` 内的 `@/*` 只被 Next 与 web 的 tsc 使用，安全。
- 类型检查：每个包 `tsc --noEmit`；web 为 `next typegen && tsc --noEmit`（inputs/02 F11.5）；backend 用 `tsc -p convex/tsconfig.json`。根脚本 `pnpm -r typecheck`。不用 project references（理由见 5.2）。
- 可选优化（待验证）：backend 开启 `codegen.staticApi`（C6），让 `api.d.ts` 由 validator 生成，web 的 typecheck 不必穿透到 backend/引擎源码。前提是所有公共函数声明 `args` 与 `returns`，与 F03.16 一致。
- TypeScript 锁 6.0.x：TS 7.0.2 已发布且 Next 16 支持用它做 `next build` 类型检查（`NXD:03-api-reference/05-config/02-typescript.md:14-41`），但 `typescript-eslint` 与 `@typescript-eslint/utils` 的 peer 上限为 `<6.1.0` [npm]，type-checked lint 会失效。
