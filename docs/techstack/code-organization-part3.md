# 技术选型：代码组织与工具链（第 3/5 部分）

## 4. 推荐与理由（续）

### 4.5 pnpm 11 设置（`pnpm-workspace.yaml`）

```yaml
packages:
  - apps/*
  - packages/*

catalog:                     # 各包写 "zod": "catalog:"，版本只在这里改
  zod: 4.6.7
  convex: 1.48.0
  typescript: 6.0.3
  # next / react / @clerk/nextjs / @anthropic-ai/sdk 同理，按任务书基线精确锁定

minimumReleaseAge: 10080     # 7 天（分钟）。显式设置 ⇒ minimumReleaseAgeStrict 默认 true
minimumReleaseAgeExclude: [] # 只允许"包名@精确版本"，每条旁注原因与移除日期
trustPolicy: no-downgrade    # 包的发布信任级别下降时失败
blockExoticSubdeps: true     # 默认即 true，显式写出防回退
allowBuilds:                 # 依赖的安装脚本白名单
  esbuild: true              # convex 依赖
  lefthook: true             # postinstall 安装平台二进制与钩子
  unrs-resolver: true        # eslint-import-resolver 链路（原仓库已有）
engineStrict: true
peerDependencyRules:         # eslint-config-next 内含插件 peer 尚未列 ESLint 10（C7）
  allowedVersions:
    eslint-plugin-import>eslint: "10"
    eslint-plugin-react>eslint: "10"
    eslint-plugin-jsx-a11y>eslint: "10"
```

理由与说明：

- **为什么显式写 `minimumReleaseAge`**：pnpm 11 的内置默认 1440 是非 strict 的，不满足时静默回退到旧版本 [S2]；显式写值使 strict 生效，违反即失败，供应链策略可审计。7 天对应"新版本给社区一周发现恶意发布"的常见做法；任务书基线中 next 16.4.3（2026-10-23）、@clerk/nextjs 7.9.20（2026-10-23）、convex 1.48.0（2026-10-22）、@anthropic-ai/sdk 1.1.0（2026-10-21）都很新 [npm]，若实现早于 10-30 开始，需按精确版本加入 `minimumReleaseAgeExclude` 并写明移除日期（原仓库即这样做，C11）。
- `trustLockfile` 不开启：它会跳过对 lockfile 条目重新套用 `minimumReleaseAge` 与 `trustPolicy` 的检查 [S2]。
- `peerDependencyRules`、`engineStrict` 在 pnpm 11 的 `pnpm-workspace.yaml` 中的确切键名：待验证（7.2）。
- `packageManager: "pnpm@11.x.y"` 写在根 package.json，CI 用 corepack 或 `pnpm/action-setup` 读取它。pnpm 12（12.0.0 于 2026-08-26 发布，当前 12.15.0）不在本次决定内，见 6.4。

### 4.6 ESLint 10 flat config（结构草图）

```js
// eslint.config.mjs（根，唯一一份）
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import convexPlugin from "@convex-dev/eslint-plugin";
import importX from "eslint-plugin-import-x";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores(["**/_generated/**", "**/.next/**", "**/next-env.d.ts",
                 "**/playwright-report/**", "**/test-results/**", "**/coverage/**"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
  { rules: {
      "@typescript-eslint/no-floating-promises": "error",          // Convex 官方推荐 [S7]
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",   // 状态机穷举
      "@typescript-eslint/consistent-type-imports": "error",
      "import-x/no-extraneous-dependencies": "error",              // L3
      "import-x/no-cycle": "error",
  } },
  { files: ["apps/web/**"], extends: [nextVitals, nextTs],
    settings: { next: { rootDir: "apps/web/" } } },                // Next 文档的 monorepo 写法
  { files: ["packages/backend/convex/**"], extends: [/* convexPlugin recommended */],
    rules: { "@convex-dev/require-access-control": "error",
             "@convex-dev/import-wrong-runtime": "warn",
             "@convex-dev/no-collect-in-query": "warn" } },        // L6
  { files: ["packages/engine/**", "packages/scenario-*/**"],
    rules: { "no-restricted-imports": [/* L5 包清单 */],
             "no-restricted-syntax": [/* Date.now / Math.random / fetch / process.env */] } },
  { /* eslint-plugin-boundaries：elements + boundaries/dependencies 策略（L4） */ },
  { files: ["**/*.test.ts", "**/e2e/**"], rules: { /* 放宽纯度规则 */ } },
  prettier,                                                        // 最后，关闭格式类规则
]);
```

- `projectService: true` 让 typescript-eslint 按文件就近找 tsconfig，适配多包；性能问题出现再改成显式 `project` 列表。
- `extends` 在 `defineConfig` 内的用法与 `@convex-dev/eslint-plugin` 5.0.0 的 flat 导出名：待验证（7.2），以 [S8] 为准。
- boundaries 7.x 的策略数组键名文档前后不一（`rules` 与 `policies` 均出现）[S9]：以安装版本的类型定义为准，待验证。

### 4.7 测试工具

- **Vitest 4.1.x**，根 `vitest.config.ts` 用 `test.projects`：
  - `engine`、`scenario-scope-change`：`environment: "node"`，纯函数单测（规则、算术、状态迁移表、披露投影）。
  - `backend`：`environment: "edge-runtime"`（需 `@edge-runtime/vm`），convex-test；模块表在 `packages/backend/convex/test.setup.ts` 用 `import.meta.glob("./**/!(*.*.*)*.*s")` 生成 [S5]。
  - `web`：`environment: "jsdom"`，只测纯展示组件与 hooks 的少量逻辑。
  - L7 架构测试放在根 `tooling/arch.test.ts`，`environment: "node"`。
- 为什么 4.1 而不是 5.0：convex-test 的官方文档只写到 Vitest 3/4 的多环境配置 [S5]，convex-test 自身用 vitest 1.6.1 测试 [npm]；V4 线 4.1.12 与 5.0.5 同日发布补丁，仍在维护。升到 5 是 catalog 的一行改动，前提是 7.1 的探针通过。
- **Playwright 1.64.x** + `@clerk/testing`（Clerk testing token 跳过机器人检测；用测试实例与项目 seed 中的测试账号，符合任务书 §3 核心 8 的"模拟数据要标注"）。只装 chromium；E2E 跑在本地 `next dev` + 个人 dev Convex 部署 + stub 模型模式。
- 并发/幂等不变量（核心 5）用 `packages/backend/scripts/` 下针对真实 dev 部署并行发起 mutation 的脚本（`ConvexHttpClient`），不归 Vitest 管（IN04 part2 §1.12）。

### 4.8 提交钩子（lefthook 2.x）

```yaml
# lefthook.yml
pre-commit:
  piped: true                 # 先格式化再 lint，避免并行改同一文件
  jobs:
    - name: format
      glob: "*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml,css}"
      run: pnpm exec prettier --write --ignore-unknown {staged_files}
      stage_fixed: true
    - name: lint
      glob: "*.{ts,tsx,js,mjs}"
      run: pnpm exec eslint --max-warnings=0 --no-warn-ignored {staged_files}
pre-push:
  jobs:
    - run: pnpm typecheck
    - run: pnpm test
```

- 一个工具替代 husky + lint-staged；Go 二进制与 Node 版本无关。lefthook 通过 `postinstall` 安装，pnpm 11 默认拦截依赖安装脚本，所以必须进 `allowBuilds`（4.5）；或在根 `prepare` 脚本里显式 `lefthook install`。
- 钩子可被 `--no-verify` 跳过，**CI 才是门禁**：`format:check → lint → typecheck → test → web build`。`jobs` 语法与 `stage_fixed` 在 2.x 的写法：待验证（7.2）。

### 4.9 Node 版本策略

- 官方时间表 [S3]：Node 24 于 2025-10-28 进入 LTS，**2026-10-20 起转为 Maintenance**，EOL 2028-04-30；Node 26 于 **2026-10-28** 进入 Active LTS，EOL 2029-04-30。
- Convex `"use node"` 运行时目前支持 Node 22 与 24，默认 24 [S4]；版本在 `convex.json` 的 `node.nodeVersion` 配置（`NM:convex/src/cli/lib/config.ts:274-277`）。
- 决定：**全链路 Node 24**——`.node-version` 写精确 `24.x.y`；根 `engines.node: ">=24.19.0 <25"`（沿用原基线）+ `engineStrict`；`packages/backend/convex.json` 写 `"node": { "nodeVersion": "24" }`（显式，避免平台默认值漂移）；CI 与前端托管同为 24。
- 理由：本地跑 Vitest/convex-test 的 Node 与 Convex 生产 Node 运行时保持同一大版本，`"use node"` action 的行为差异最小。Node 24 处于 Maintenance 仍有 18 个月安全支持，足够覆盖第一个版本。
- 升级触发条件：Convex 宣布支持 Node 26 → 四处一起升（一次 PR：`.node-version`、`engines`、`convex.json`、CI 矩阵）。

### 4.10 根脚本与部署衔接

```jsonc
// 根 package.json scripts（示意）
"dev": "pnpm --parallel --filter @sfm/backend --filter @sfm/web dev",
"lint": "eslint . --max-warnings=0",
"format": "prettier --write .",  "format:check": "prettier --check .",
"typecheck": "pnpm -r typecheck",
"test": "vitest run",
"test:e2e": "pnpm --filter @sfm/web exec playwright test",
"check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @sfm/web build"
```

- 部署（细节归 15-operations）：在 `packages/backend` 运行 `npx convex deploy --cmd 'pnpm --filter @sfm/web build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`，让前端构建拿到对应部署的 URL（构建期内联，IN04 part7 §5.3）。跨包 `--cmd` 的行为：待验证（7.1）。
- 环境文件：`packages/backend/.env.local`（`convex dev` 写入 `CONVEX_DEPLOYMENT`）与 `apps/web/.env.local`（`NEXT_PUBLIC_CONVEX_URL`、Clerk 键）分离；提供 `pnpm env:check` 只报告缺失项名，不打印值（沿用原 AR-19）。
