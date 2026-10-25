# 反驳审查：代码组织与工具链（code-organization.md + part2–5）

> 审查日期 2026-10-24。缩写同原文：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`npm:` = 当日 `npm view` 结果（独立缓存重跑，非沿用作者缓存）。

## 0. 结论

**accept_with_changes。** 18 条待验证声明中 17 条成立，1 条有措辞偏差（convex-test "需要 import.meta.glob"）。没有发现与任务书 §3 核心冲突的地方。推荐的 L-C 布局（pnpm workspace，engine / scenario / backend / web 四个包）与 Convex 官方 monorepo 模板同构，能把核心 1"私密逻辑进不了浏览器包"变成结构事实，站得住。需要改的有两处中等问题和若干低优先级修正：

1. **7 天严格冷却的实际代价被低估**（r01）。pnpm 的冷却规则对传递依赖同样生效。今天在 7 天窗口内的不只任务书的四个基线包，还有 memo 自己点名的 typescript-eslint 8.72.0、convex-test 0.0.63–0.0.65，以及 Next 和 Clerk 的全部子包。
2. **强制手段叠了 7 层，其中 L3、L4、L7 有重叠**（r02）。另外 lint 里会同时出现两个 import 插件。按任务书"选简单的"，L4 应明确推迟，不该写成"要砍时先砍"。

## 1. 逐条核对

| # | 声明 | 结果 | 证据（日期均为 2026-10-24） |
| --- | --- | --- | --- |
| 1 | ESLint 9 已于 2026-08-06 EOL，10 是当前主线；latest 10.13.0，maintenance 9.39.5 | ✅ | https://eslint.org/version-support/ 原文："ESLint v9.x reached end-of-life on 2026-08-06"，v10 为 Current。npm 上 latest=10.13.0（2026-10-16），maintenance=9.39.5（2026-07-10） |
| 2 | typescript-eslint 8.72.0 与 @typescript-eslint/utils 8.58.2 的 peer 是 `typescript >=4.8.4 <6.1.0`、`eslint ^8.57‖^9‖^10` | ✅ | npm 结果一致。补充：本机安装的 utils 是 8.72.0（`NM:.pnpm/@typescript-eslint+utils@8.72.0…`）；8.58.x 来自 `@convex-dev/eslint-plugin@5.0.0`，它的依赖写的是 `@typescript-eslint/utils ~8.58.0`，所以依赖树里会有两份 utils |
| 3 | eslint-config-next 16.4.3 依赖的 import 2.32.0、react 7.37.5、jsx-a11y 6.10.2 三个插件 peer 上限都是 ^9；Next 文档称支持 ESLint 10，但会有 peer 警告 | ✅（措辞需修，见 r03） | npm 结果一致。`NM:next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md:83-85` 的原意是：eslint-config-next 支持 ESLint 9 和 10；从 16.4.0 起，React 版本检测在 ESLint 10 下可用；部分插件的 peer 还没列 10。memo 写的"16.4.0 起支持 ESLint 10"把这几层意思合成了一句 |
| 4 | eslint-plugin-import-x 4.17.1 的 peer 含 eslint ^10 | ✅ | npm 结果一致。另有 peer `@typescript-eslint/utils ^8.56.0`。最近一次发布是 2026-06-28 |
| 5 | pnpm 11 的 minimumReleaseAge 默认 1440 且非 strict；显式设置后 strict 默认 true；trustPolicy 默认 off；blockExoticSubdeps 默认 true | ✅ | https://pnpm.io/settings/dependency-resolution 。同页还写明冷却"applies to all dependencies, including transitive ones"，strict 只在"no version in the requested range meets the age requirement"时才失败。`minimumReleaseAgeExclude` 从 10.19.0 起支持 `name@version` |
| 6 | pnpm latest 12.15.0；latest-11 为 11.28.8（10-22）；12.0.0 发布于 08-26 | ✅ | npm：12.0.0 是 2026-08-26，11.28.8 是 2026-10-22，12.15.0 是 2026-10-21 |
| 7 | Node 24 于 2026-10-20 转为 Maintenance，2028-04-30 EOL；Node 26 于 2026-10-28 进入 LTS | ✅ | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json 。v26 的 EOL 是 2029-04-30 |
| 8 | Convex `"use node"` 支持 Node 22 和 24，默认 24；`nodeVersion` 配在 convex.json 的 node 段 | ✅ | https://docs.convex.dev/functions/runtimes 原文："We currently support Node.js 22 and 24"，默认 24。`NM:convex/src/cli/lib/config.ts:267-278`（NodeSchema 里有 `nodeVersion`）。补充：自托管后端不支持这个设置 |
| 9 | Convex 调用 esbuild 时不传 tsconfig，conditions 为 `[convex, module, …]`；非相对导入默认全部打包；esbuild 会就近读取 tsconfig 的 paths | ✅ 前半；后半部分成立 | `NM:convex/src/bundler/debugBundle.ts:60-90` 的 build 选项里没有 `tsconfig`。`external.ts` 只在 externalPackages 名单命中时才外置。esbuild 文档写的是 "Normally the build API automatically discovers tsconfig.json files"（https://esbuild.github.io/api/#tsconfig），但"逐文件就近"和"读取 paths"的细节没在已读部分确认，仍按待验证处理。这不影响"内部包禁用 paths"的结论 |
| 10 | Convex 打包器把 server-only 替换成空模块 | ✅ | `NM:convex/src/bundler/serverOnly.ts`（onResolve `^server-only$` 返回空 contents） |
| 11 | `_generated/api.js` 运行时只是 anyApi；存在 `codegen.staticApi` | ✅ | `NM:convex/src/cli/codegen_templates/api.ts:118-156`；`config.ts:281-286`（默认 false） |
| 12 | Turbopack 自动转译 workspace 包 | ✅ | `NM:next/…/transpilePackages.md:21`："Turbopack transpiles workspace packages … automatically under both routers" |
| 13 | convex-test 文档只覆盖 Vitest 3/4，需要 @edge-runtime/vm 和 import.meta.glob；自身 devDeps 用 vitest 1.6.1 | ⚠️ 部分 | 文档只写了 Vitest 4 的 `projects` 和 Vitest 3 的 `environmentMatchGlobs`，没有提到 5。安装步骤包含 @edge-runtime/vm。但 import.meta.glob 只在 convex 目录名或位置不是默认值时才需要。npm：devDeps 里是 vitest 1.6.1、@edge-runtime/vm 5.0.0，peer 只有 `convex ^1.43.0`，没有 vitest 约束 |
| 14 | Convex 官方推荐 no-floating-promises，并建议逻辑放 convex/model | ✅ | https://docs.convex.dev/understanding/best-practices/ 原文："We recommend the no-floating-promises rule"，以及 "most of your code should live in a directory like convex/model" |
| 15 | @convex-dev/eslint-plugin 5.0.0 含 require-access-control、import-wrong-runtime（实验性）等规则 | ✅（细节见 r04） | https://docs.convex.dev/eslint 。三条规则都不在 recommended 里，只有 import-wrong-runtime 标了实验性；require-access-control 接受 `pattern` 选项 |
| 16 | lefthook 2.2.2 用 postinstall 安装平台二进制，需要进 allowBuilds | ✅ | npm：`scripts.postinstall = "node postinstall.js"`，11 个平台包放在 optionalDependencies；发布于 2026-10-13 |
| 17 | 许可证：Vitest、Prettier、ESLint、lefthook、boundaries、dependency-cruiser 是 MIT；Biome 是 MIT OR Apache-2.0；Playwright、convex-test、@convex-dev/eslint-plugin 是 Apache-2.0 | ✅ | npm 逐个核对一致。另外 import-x、typescript-eslint、@clerk/testing 是 MIT。全部可商用，没有 copyleft |
| 18 | 基线包都在 7 天内发布：next 16.4.3（10-23）、@clerk/nextjs 7.9.20（10-23）、convex 1.48.0（10-22）、sdk 1.1.0（10-21）；sdk latest 是 1.3.0 | ✅ | npm 时间戳一致。sdk 1.3.0 发布于 2026-10-23T23:31Z，dist-tag latest=1.3.0 |

### 主动兼容性检查（均通过）

- **Node 24**：next 16.4.3 要求 `>=20.9.0`，eslint 10.13.0 要求 `^20.19‖^22.13‖>=24`，vitest 4.1.12 要求 `^20‖^22‖>=24`，pnpm 11.28.8 要求 `>=22.13`。全部满足。
- **Zod 4**：@anthropic-ai/sdk 1.1.0 的 peer 是 `zod ^3.25‖^4`，catalog 里的 zod 4.6.7（10-12 发布）没有冲突。
- **React 19.3**：eslint-plugin-react-hooks 7.1.1 的 peer 含 eslint ^10，本机 convex 1.48.0 与 react 19.3.1 已经共存。
- **Clerk 7.9**：@clerk/testing 2.2.50 的 peer 是 `@playwright/test ^1`，与 1.64.1 兼容。
- **维护活跃度（近 12 个月）**：ESLint、typescript-eslint、Vitest、Prettier、lefthook、boundaries、convex-test 都在近一个月内发过版。**例外**是 eslint-config-next 内含的三个插件：eslint-plugin-import 最后一次发布在 2025-06-20，eslint-plugin-react 在 2025-04-03，eslint-plugin-jsx-a11y 在 2024-10-26，都超过 12 个月没有发版（见 r03）。

## 2. 问题清单

### r01（medium）7 天严格冷却的代价被低估

- **现象**：memo 4.5 只说"若实现早于 10-30，需要按精确版本加入 exclude"，没有估算条目数量，也没区分精确版本和版本范围的不同行为。
- **证据**：
  - pnpm 文档写明冷却对传递依赖生效，strict 只在整个范围内都没有达龄版本时失败。
  - 原仓库只用默认的 1 天冷却，`/Users/zhennn/cal-hack-2026-main/pnpm-workspace.yaml` 里就已经有 16 条精确 exclude：`@next/swc-*` ×8、`@next/env`、`@clerk/backend|react|shared`、`eslint-config-next` 等。
  - 改成 7 天后，2026-10-24 时落在窗口内的还有：convex 1.48.0、@anthropic-ai/sdk 1.1.0 和 1.3.0、typescript-eslint 8.72.0（10-19）、convex-test 0.0.63/0.0.64/0.0.65（10-20 到 10-23）、eslint-plugin-boundaries 7.2.1/7.3.0、pnpm 11.28.8。
- **后果**：catalog 里的精确锁定（convex 1.48.0 等）会直接报错。用插入符范围声明的依赖不会报错，而是静默解析到更旧的版本，可能和 catalog 的意图不一致。
- **建议**：
  1. 写一个脚本，从 lockfile 生成 exclude 清单，每条带到期日；CI 定期检查过期条目。
  2. 或者首版冷却设为 3 天（4320 分钟），基线稳定后再提到 7 天。
  3. 在 memo 里写明"strict 只拦截精确锁定"，typescript-eslint 等工具链包也锁到满龄版本。

### r02（medium）L1–L7 有重叠，偏向过度设计

- **现象**：L3（import-x/no-extraneous-dependencies）、L4（boundaries）、L7（package.json 架构测试）互相覆盖。根配置里同时会有 eslint-config-next 带入的 eslint-plugin-import 和新增的 import-x，两套 resolver 配置并存。`import-x/no-cycle` 在跨包、type-aware 场景下开销大。
- **证据**：memo 自己在 4.3 写了"最先砍 L4"。boundaries 7.3.0 发布于 10-23，按 7 天冷却会退到 7.2.0（08-09）；它的配置键名在文档里前后不一（memo 6.9 已提到）。
- **建议**：
  1. v1 只上 L1、L2、L3、L5、L6，加上 CI。
  2. L4 明确写成"第二个场景落地或包内分层出现违规时再加"。
  3. L7 和 L3 二选一，倾向保留 L3，因为编辑器里能即时提示。
  4. `no-cycle` 只作用于 `packages/engine` 和 `packages/scenario-*`，或者先不开。

### r03（low）ESLint 10 风险的证据应补全，维护活跃度维度漏掉了三个停更插件

- **现象**：memo 6.3 只引用了 peer 警告。实际兼容 ESLint 10 的机制是 eslint-config-next 16.4.3 的 `fixupPluginRules` shim：`NM:.pnpm/eslint-config-next@16.4.3…/dist/rule-context.js`，在 `dist/index.js:118,121` 应用于 react 和 import 两个插件，补回 ESLint 10 删除的 `getFilename`、`getSourceCode`、`parserOptions`、`parserPath`、`getCwd`。jsx-a11y 没有被包装，但 grep 结果显示它没有调用这些已删除的 API。
- **隐患**：eslint-plugin-import 2.32.0 的 `lib/core/sourceType.js` 直接执行 `'sourceType' in context.parserOptions`。如果有人绕开 next 的 shim，单独注册 eslint-plugin-import，在 ESLint 10 下会抛 TypeError。三个插件都超过 12 个月没有发版，ESLint 10 能否继续用，取决于 Next 是否维护这个 shim。
- **建议**：
  1. 6.3 补上 shim 的证据，并把可能性改为"低"。
  2. 规则写明"禁止另行注册 eslint-plugin-import，import 类新规则只用 import-x"。
  3. §3.2 的维护活跃度一栏标注这三个插件已停更。
  4. 措辞改成"eslint-config-next 支持 ESLint 9/10；从 16.4.0 起，React 版本检测兼容 ESLint 10"。

### r04（low）@convex-dev/eslint-plugin 的配置细节

- require-access-control 和 no-collect-in-query 都不在 recommended 里，需要手动开启，memo 的写法正确。但 require-access-control 接受 `pattern` 选项，需要对上 `convex/model` 里的鉴权助手命名（比如 `requireMember*`），否则规则要么噪音大，要么形同虚设。
- 这个插件 5.0.0 没有声明 eslint peer，它依赖的 `@typescript-eslint/utils ~8.58.0` 的 peer 含 ^10，所以兼容性是间接成立的。
- **建议**：在 4.6 写出 `pattern`；7.1 第 6 步加一条"故意写一个不调用鉴权助手的 public mutation，预期被拦下"。

### r05（low）convex-test 的说法需要修正

- import.meta.glob 不是必需项，只在非默认目录时需要。在 pnpm monorepo 里显式写 glob 仍然是稳妥做法，可以保留，但把理由改成"pnpm 的 symlink 布局下，默认 glob 的相对基准不可靠（待验证）"。
- convex-test 没有 vitest peer 约束，"锁 Vitest 4.1"的依据只是文档覆盖范围，这一点应如实写明。
- convex-test 4 天内连发 3 个 0.0.x 版本，r01 的冷却策略会直接影响它。

### r06（low）风险 6.8 已可以从"推论"升为事实

- `NM:convex/src/bundler/external.ts:179-212` 的 `shouldMarkExternal` 只对 `file:`、`git+file://` 和各类 URL 特殊处理，没有处理 `workspace:` 或 `catalog:`。只要名单里有 `"*"`，`@sfm/engine` 就会被标成外部包，部署时去 npm 安装，然后失败。
- 用 `catalog:` 的外部包不受影响：版本号是从 node_modules 里包自己的 package.json 读取的（`findExactVersionAndDependencies`）。
- **建议**：6.8 改为"已验证"；L7（或 CI）加一条断言"convex.json 的 externalPackages 不含 `*`"。

### r07（low）SDK 基线版本

- 任务书写的是 sdk 1.x，memo 锁 1.1.0，但 latest 已经是 1.3.0（10-23）。版本取舍应交给 model-layer 备忘录，本 memo 的 catalog 只写"取 model-layer 决定的满龄版本"，避免两份文档各写一个版本号。

## 3. 有没有被忽略的更简单方案

- 布局上没有更简单、又能保住结构隔离的方案。L-D 已列为退路，合理。
- 把 engine 和 scenario 合成一个包能少一个包，但会违反任务书 §5 对"engine 包 vs scenario 包"的边界要求，不建议。
- 工具上，r02 的精简（去掉 L4，L3 和 L7 二选一）就是现成的简化。lefthook 换 husky、Prettier 换 Biome 都属于等价替换，不构成更简单的方案。
