# 技术选型：代码组织与工具链（第 4/5 部分）

## 5. 否决理由

### 5.1 布局

| 方案 | 否决理由 |
| --- | --- |
| L-A 单包 | 引擎、场景、`@anthropic-ai/sdk` 与前端共享一个依赖集合，"Client 组件误导入服务端模块"只有 lint 一道防线；原仓库根 tsconfig 的 `include: ["**/*.ts"]` 会把 `convex/` 也纳入 Next 的类型检查（`/Users/zhennn/cal-hack-2026-main/tsconfig.json`），两套运行时的编译选项互相干扰。以后拆包要大搬家 |
| L-B 单包分层 | 比 L-A 好，但 SDK 对 `src/` 仍可解析；结构性隔离为零，全靠 boundaries 规则；`convex/` 之外的相对导入被 Convex 打包的行为未验证 |
| L-D web 内含 convex | 部署最省事，但 `@sfm/web` 必须声明引擎、场景和 SDK 依赖，L1 防线对最关键的方向（web → 服务端逻辑）失效。可作为 L-C 的退路（6.1） |
| L-E 根 convex | 根包带运行时依赖，任何子包向上解析都能"摸到" `convex` 与 SDK；web 只能 `../../convex/_generated/api` 跨包相对导入，破坏包边界；无官方示例 |
| L-F +Turborepo | 内部包源码直出、无构建产物，Turbo 的缓存与任务图收益很小；pnpm 的 `-r`/`--filter`/`--parallel` 已能按拓扑顺序执行。CI 超过约 5 分钟再引入（只加 `turbo.json`，不动布局） |
| L-G Nx | 对 4 个包过度；插件跟进 Next 16 / Convex 的成本由我们承担 |

### 5.2 依赖方向工具

| 方案 | 否决理由 |
| --- | --- |
| dependency-cruiser | 与包图 + import-x + boundaries 的覆盖面重叠；另一套规则语言与 CI 步骤；不在编辑器里即时提示。若将来需要依赖图可视化或"孤儿模块"检测再加，作为只读报告 |
| TS project references | 需要 `composite` 与声明产物、`tsc -b` 增量构建；Next 的 tsconfig（`noEmit` + Next 插件）与 Convex 的 `convex/tsconfig.json`（`noEmit`，C3）都不是为 references 设计的；它强制的"只能导入被引用项目"已由 L1 包图提供 |
| 只靠 eslint-plugin-boundaries | 规则可被关闭或漏配；跨包方向本可以由包管理器结构性保证，不该降级成 lint |

### 5.3 其他工具

| 方案 | 否决理由 |
| --- | --- |
| ESLint 9 | 已于 2026-08-06 EOL，不再有安全修复 [S1]；新项目不应以 EOL 主线起步。代价是 eslint-config-next 内含插件的 peer 警告，用 `peerDependencyRules` 白名单（C7 中 Next 官方承认这一状态） |
| eslint-plugin-import 的规则（`import/*`） | 2.32.0 peer 只到 ESLint ^9；改用 `eslint-plugin-import-x`（peer 含 ^10）承载 `no-extraneous-dependencies`、`no-cycle`。eslint-config-next 仍会带入 eslint-plugin-import，我们不在其上新增规则 |
| Biome 替代 ESLint | 没有 eslint-config-next 的 Next 专属规则、`@convex-dev/eslint-plugin`、eslint-plugin-boundaries 的等价物；type-aware 的 `no-floating-promises` 成熟度不及 typescript-eslint（待验证）。这些恰是保护核心不变量的规则 |
| Biome 只做格式化 | 可行，但与 Prettier 相比收益只有速度；Next 文档的示例走 `eslint-config-prettier`（`NXD:03-api-reference/05-config/03-eslint.md:272-276`）；中文 Markdown 设计文档的格式化支持以 Prettier 更稳（Biome 对 Markdown 的支持程度：待验证）。仓库规模下 Prettier 的速度不是瓶颈 |
| TypeScript 7 | typescript-eslint peer `<6.1.0`，type-checked lint 失效；Next 也提示 TS 7 暂无 JS 编译器 API（`NXD:…/02-typescript.md:14-16`） |
| Vitest 5.0（作为起点） | 不否决，只是推迟：convex-test 文档尚未覆盖 5；7.1 探针通过即升 |
| Jest | convex-test 依赖 Vite 的 `import.meta.glob` 收集模块 [S5]，Jest 无此能力 |
| husky + lint-staged | 两个包两份配置；lint-staged 17 要求 Node `>=22.22.1` [npm]（满足，但多一条约束）。功能上与 lefthook 等价，是 lefthook 出问题时的退路 |
| 不装钩子、只靠 CI | 反馈慢；格式化差异会污染 PR。钩子轻量（只处理暂存文件）即可 |
| Node 26 起步 | Convex `"use node"` 尚不支持 26 [S4]；本地与 Convex 运行时大版本不一致会让 convex-test 与生产行为偏离 |

## 6. 风险与退出策略

| # | 风险 | 可能性 / 影响 | 缓解 | 退出策略 |
| --- | --- | --- | --- | --- |
| 6.1 | Convex esbuild 打包 workspace 包（symlink + `exports` 指向 `.ts`）失败或行为异常（C1 推论，未实测） | 低 / 高 | 7.1 第 2 步在写业务代码前验证 | 退到 L-D：把 `convex/` 移进 `apps/web`，引擎/场景包不变；或在 backend 的 `convex/` 下用相对路径引用 `../../engine/src`（仍保留包图） |
| 6.2 | web 的 tsc 穿透 `api.d.ts` 检查 backend 与引擎源码，编译选项冲突或变慢 | 中 / 中 | 共享 `tsconfig.base.json`；评估 `codegen.staticApi`（C6） | staticApi；或 web 侧对 backend 路径宽松检查 |
| 6.3 | ESLint 10 下 eslint-config-next 内含插件（import/react/jsx-a11y）运行时报错，不只是 peer 警告 | 低-中 / 中 | 7.1 第 6 步；Next 16.4.0 起声明支持（C7） | 对 `apps/web` 暂时关闭出错的插件规则块；最坏情况 web 子树单独用一份 ESLint 9 配置（不推荐，9 已 EOL） |
| 6.4 | pnpm 11 维护期不明；pnpm 12 已发布两个月 | 中 / 低 | 只依赖 10.16+ 即有的设置（minimumReleaseAge、catalog、allowBuilds） | 读 pnpm 12 变更说明后单独升级（只改 `packageManager` 与可能更名的键） |
| 6.5 | 7 天发布冷却挡住紧急安全修复 | 低 / 中 | 按精确版本临时加入 `minimumReleaseAgeExclude`，附原因与移除日期 | 同左；冷却期可调短到 3 天 |
| 6.6 | convex-test（0.0.x，Apache-2.0，社区维护）与 Vitest 新主版本不兼容 | 中 / 中 | 锁 Vitest 4.1；convex-test 精确锁版本 | 纯函数测试不受影响；集成测试改为针对本地 Convex 后端（[S5] 提到的 local backend testing） |
| 6.7 | 内部包禁用 `paths` 后，深层相对路径变长 | 高 / 低 | 包内保持浅层目录；对外只经 `index.ts` | 无需退出 |
| 6.8 | `"use node"` 的 `externalPackages: ["*"]` 会把 `workspace:*` 包当作外部包，部署时去 npm 安装而失败（`external.ts:104-140` 推论） | 低 / 中 | 约定只列具体包名；L6 代码审查项 | 移除 `*` |
| 6.9 | boundaries 7.3.0 发布于 2026-10-23，配置键名文档不一致 [S9] | 中 / 低 | 冷却期自然选到 7.2.x；以类型定义为准 | 删掉 L4 规则块，L1–L3 不受影响 |

## 7. 如何验证（可执行步骤）

### 7.1 第 0 天骨架探针（在实现仓库的一个分支上执行，约半天）

1. **pnpm 设置**：按 4.5 写 `pnpm-workspace.yaml`，`pnpm install`。再 `pnpm add -F @sfm/engine <某个发布不足 7 天的包>`，预期 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 一类错误（证明 strict 生效）。`pnpm config list` 确认 `peerDependencyRules`、`engineStrict`、`trustPolicy` 被读取。
2. **Convex 打包 workspace 包**：engine 导出 `export const ENGINE_CANARY = "__SFM_ENGINE_CANARY__"`，backend 写一个 query 导入并返回它；在 `packages/backend` 运行 `npx convex dev --once --debug-bundle-path ./.bundle-out`（隐藏选项，见 `NM:convex/src/cli/dev.ts:106`；需要个人 dev 部署或本地后端），检查产物含该字符串且无 resolve 报错；调用 query 返回正确值。
3. **别名行为（只为确认规则）**：临时在 `packages/engine/tsconfig.json` 加 `paths`，并用别名导入，重复第 2 步，记录 esbuild 是否解析。无论结果，规则保持"内部包不用 paths"，结论回填 F03.15。
4. **浏览器包隔离**：在 `apps/web` 的一个 `"use client"` 组件里 `import "@sfm/engine"`，`pnpm --filter @sfm/web build` 预期 Module not found；移除后正常构建，`grep -r "__SFM_ENGINE_CANARY__" apps/web/.next/static` 预期无结果。再尝试 `import "@sfm/backend/convex/rooms"`，预期 exports 拒绝。
5. **类型检查**：`pnpm -r typecheck` 通过；在 backend 打开 `codegen.staticApi` 后重跑，比较 web typecheck 耗时与是否仍需穿透源码。
6. **ESLint 10**：`pnpm lint` 在骨架上 0 报错；故意写一个未 await 的 `ctx.db.insert`、一个漏分支的 `switch`、engine 内的 `Date.now()`、web 内导入 `@anthropic-ai/sdk`，逐条确认被 `no-floating-promises`、`switch-exhaustiveness-check`、`no-restricted-syntax`、`import-x/no-extraneous-dependencies` 拦下；确认 eslint-config-next 的规则在 ESLint 10 下无运行时异常。
7. **convex-test**：写一个用 `t.withIdentity` 调 mutation、一个推进调度函数的用例，在 Vitest 4.1.x 与 5.0.x 各跑一次，记录结果决定是否升 5。
8. **lefthook**：新克隆后 `pnpm install`，确认 `.git/hooks/pre-commit` 已安装；提交一个格式错误的文件，确认被自动修复并重新暂存。
9. **架构测试**：给 `apps/web/package.json` 加 `"@anthropic-ai/sdk"`，`pnpm test` 预期 L7 用例失败。
10. **部署衔接**：对 preview 部署执行 4.10 的 `convex deploy --cmd ...`，确认 web 构建拿到正确的 `NEXT_PUBLIC_CONVEX_URL`。
11. **Node**：`convex.json` 写 `nodeVersion: "24"` 后推送一个 `"use node"` action，在其中返回 `process.version`。

### 7.2 文档核对项（不需要代码）

- pnpm 11 文档：`peerDependencyRules`、`engineStrict`、`strictDepBuilds`、`savePrefix` 在 `pnpm-workspace.yaml` 中的键名与默认值；pnpm 11 的维护期。
- `@convex-dev/eslint-plugin` 5.0.0 的 flat config 导出名 [S8]；eslint-plugin-boundaries 7.x 的 `boundaries/dependencies` 选项键名 [S9]。
- lefthook 2.x 的 `jobs`、`piped`、`stage_fixed` 语法。
- Biome 2.6 的 Markdown 支持与 `noFloatingPromises` 状态（只影响否决理由的措辞）。

