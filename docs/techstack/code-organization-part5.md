# 技术选型：代码组织与工具链（第 5/5 部分）

## 8. 来源（访问日期均为 2026-10-24）

- [S1] ESLint Version Support：https://eslint.org/version-support/ （"v9.x reached end-of-life on 2026-08-06"）
- [S2] pnpm Dependency Resolution 设置：https://pnpm.io/settings/dependency-resolution （minimumReleaseAge 默认 1440 since v11、minimumReleaseAgeStrict、trustPolicy、blockExoticSubdeps）；另见 https://pnpm.io/settings
- [S3] Node.js Release schedule.json：https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- [S4] Convex Runtimes：https://docs.convex.dev/functions/runtimes （"We currently support Node.js 22 and 24"，默认 24）
- [S5] Convex convex-test：https://docs.convex.dev/testing/convex-test
- [S6] Convex monorepo 模板：https://www.convex.dev/templates/monorepo （get-convex/turbo-expo-nextjs-clerk-convex-monorepo，后端在 `packages/backend`）
- [S7] Convex Best Practices：https://docs.convex.dev/understanding/best-practices/ （推荐 `no-floating-promises`；逻辑放 `convex/model`）
- [S8] Convex ESLint 插件：https://docs.convex.dev/eslint
- [S9] eslint-plugin-boundaries：https://www.jsboundaries.dev/docs/rules/dependencies/ ；仓库 https://github.com/javierbrea/eslint-plugin-boundaries
- [S10] 社区讨论（非官方，仅作风险线索）：https://discord-questions.convex.dev/m/1180648882816954418 （`convex/tsconfig.json` 别名脆弱、monorepo 与 externalPackages 的问题）
- 本地文件：`NM:convex/src/bundler/{debugBundle,external,serverOnly,index}.ts`、`NM:convex/src/cli/lib/{config,typecheck,codegen}.ts`、`NM:convex/src/cli/codegen_templates/{api,tsconfig}.ts`、`NM:convex/src/cli/dev.ts`、`NXD:02-guides/upgrading/version-16.md`、`NXD:03-api-reference/05-config/03-eslint.md`、`NXD:03-api-reference/05-config/02-typescript.md`、`NXD:03-api-reference/05-config/01-next-config-js/{transpilePackages,turbopack}.md`、`/Users/zhennn/cal-hack-2026-main/{package.json,pnpm-workspace.yaml,tsconfig.json,eslint.config.mjs}`
- npm registry（`npm view <pkg> version license time peerDependencies dependencies engines`）：pnpm、eslint、typescript-eslint、@typescript-eslint/utils、eslint-config-next、eslint-plugin-import、eslint-plugin-react、eslint-plugin-jsx-a11y、eslint-plugin-import-x、eslint-plugin-boundaries、dependency-cruiser、@convex-dev/eslint-plugin、prettier、@biomejs/biome、vitest、convex-test、@edge-runtime/vm、@playwright/test、@clerk/testing、lefthook、husky、lint-staged、turbo、typescript、next、convex、@clerk/nextjs、@anthropic-ai/sdk
