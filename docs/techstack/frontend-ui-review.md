# 反驳评审：前端 UI 层选型备忘录（frontend-ui.md）

> 评审对象：`techstack/frontend-ui.md`。核对日 2026-10-24。证据来自 `npm view`（2026-10-24 执行）、`/Users/zhennn/cal-hack-2026-main/node_modules`、官方文档，以及 scratchpad 里的 ESLint 实测（`scratchpad/eslint-a11y-test/`，没有改动源仓库）。

## 0. 结论

**verdict：accept_with_changes。** 主选型（Tailwind 4 + shadcn/ui 选 Base UI 原语、RHF + zod 4、结构化字段 diff、lucide、next-intl 不走路由）与任务书核心一致，兼容性证据基本成立，不需要推翻。但有两处会让 §7 的验证步骤**直接失败**的供应链/安装问题：
1. 把 `minimumReleaseAge: 20160` 写进工作区，会和栈本身锁定的版本冲突；
2. next-intl 带的原生构建依赖会被 pnpm 11 的 `strictDepBuilds` 拦下。

另外，a11y lint 的接法照抄会报错，还有几处事实小错。改完这些即可采纳。

## 1. 声明逐条核对

| # | 声明 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | tailwindcss / @tailwindcss/postcss 4.3.3，MIT，2026-07-16 | 成立 | `npm view tailwindcss time`：4.3.3 = 2026-07-16T12:03Z；两个包 latest 都是 4.3.3、MIT |
| 2 | Next 16 CSS 文档首选 tailwindcss + @tailwindcss/postcss | 成立 | `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md:22-50`（`pnpm add -D tailwindcss @tailwindcss/postcss` 和 postcss.config.mjs 示例） |
| 3 | dev/build 默认 Turbopack，自定义 webpack 时 build 失败 | 成立 | `version-16.md:102-130`；同文件 :100 的浏览器基线 Chrome 111+ / Safari 16.4+，与 Tailwind 4 的要求一致 |
| 4 | lucide-react 在 optimizePackageImports 默认名单 | 成立 | `optimizePackageImports.md:23` |
| 5 | shadcn 4.22.1（2026-10-18）MIT；2026-07 起默认 Base UI，Radix 继续支持且新组件两套同发 | 成立 | npm time 4.22.1 = 2026-10-18T18:12Z；ui.shadcn.com/docs/changelog/2026-07-base-ui-default 原话："Updates and new components will ship for both libraries"，Base UI 独有组件除外；选 Radix 用 `shadcn init -b radix` |
| 6 | @base-ui/react 1.9.0（2026-10-09）MIT；peer react ^17‖^18‖^19；date-fns 系为可选 peer；1.0.0 = 2025-12-11 | 成立 | `npm view @base-ui/react@1.9.0 peerDependencies peerDependenciesMeta`；1.0.0 = 2025-12-11T15:56Z |
| 7 | radix-ui 1.8.1（2026-10-12）**peer react ^19.0**；2026-06/07 修复多起 React 19/19.2 回归 | 部分不成立 | 发布日期成立（2026-10-12T21:03Z）。peer 实为 `^16.8‖^17.0‖^18.0‖^19.0‖^19.0.0-rc`，不是只有 ^19.0。回归修复成立：releases 页 2026-06-06 修了 Slot 无限重渲染，2026-07-06 修了 React 19.2 下陈旧的 `onEscapeKeyDown`。releases 页最后一条是 2026-07-20，npm 上仍在发补丁 |
| 8 | @radix-ui/themes 3.3.0 最近发布 2026-01-31 | 成立 | npm time：3.3.0 和 modified 都是 2026-01-31 |
| 9 | @mantine/core 9.7.3 peer react ^19.2.0 | 成立 | `npm view @mantine/core@9.7.3 peerDependencies` |
| 10 | RHF 7.91.0（2026-10-23）**peer react ^19**；7.89.0 = 2026-09-26；8.0.0-beta.5 = 2026-10-23 | 部分不成立 | 日期全部成立。peer 实为 `^16.8.0‖^17‖^18‖^19`。另外 dist-tag `beta` 仍指向 8.0.0-beta.0，beta.5 只能精确指定 |
| 11 | @hookform/resolvers 6.0.0（2026-10-19）；peer zod ^3.25‖^4、RHF ^7.55；唯一破坏性变更是 effect 要求 v4 | 基本成立 | peer 成立。releases 页的 BREAKING 里除了 Effect v4，还有 Effect 错误 type 改名和 ata-validator ^1.23.0 同步；都与 zod 无关 |
| 12 | @conform-to/react 1.21.2 peer react >=18；@conform-to/zod peer zod ^3.21‖^4 | 成立 | npm view |
| 13 | lucide-react 1.61.0 ISC；1.0.0 = 2026-03-23 | 成立 | 1.61.0 = 2026-10-21；1.0.0 = 2026-03-23T13:46Z |
| 14 | phosphor 最后修改 2025-05-22；heroicons 2.2.0 = 2024-11-18 | 成立 | npm time（heroicons 的 modified 是 2026-05-12，那是元数据变更，没有新版本） |
| 15 | next-intl 4.14.9 MIT，peer next ^16；支持不走路由、不需要 proxy | 成立，但有遗漏 | peer `next ^12…‖^16.0.0`。next-intl.dev without-i18n-routing 页的步骤只有 request.ts、插件、Provider，没有 proxy。**遗漏**：hard dependencies 里有 `@swc/core ~1.16.0`、`@parcel/watcher`（见 r02） |
| 16 | eslint-config-next 依赖 jsx-a11y ^6.10.0，**只开 5 条** warn | 部分不成立 | 依赖成立（`eslint-config-next/package.json:19`）。`dist/index.js:176-191` 实际开了 **6 条**：alt-text、aria-props、aria-proptypes、aria-unsupported-elements、role-has-required-aria-props、role-supports-aria-props |
| 17 | @axe-core/playwright 4.14.0 MPL-2.0 | 成立 | npm view license |
| 18 | react-diff-viewer-continued 4.4.0 的依赖 | 成立 | 依赖为 @emotion/css、@emotion/react、classnames、diff ^9、js-yaml、memoize-one、refractor ^5 |
| 19 | minimumReleaseAge 单位分钟、pnpm 11 默认 1440、**minimumReleaseAgeStrict 默认 true** | 部分不成立 | pnpm.io/settings/dependency-resolution：单位分钟、v11 起默认 1440 成立。strict 是"显式配置 minimumReleaseAge 时为 true，否则 false"。该设置作用于**所有依赖，含传递依赖**；文档的 `trustLockfile` 一节暗示默认会对 lockfile 条目重新应用该规则（推断） |
| 20a | shadcn init 在 16.4.3 + Turbopack 下生成 Base UI 组件 | 仍待验证 | 本评审没有跑 init（时间盒限制）。注意：shadcn 4.22.1 只发布了 6 天，见 r01 |
| 20b | Base UI Button 的 focusableWhenDisabled | 成立（部分） | base-ui.com/react/components/button（1.9.0）：布尔值，默认 false，"禁用时仍可聚焦"，官方推荐用于 loading 状态。文档没写它是否输出 `aria-disabled`，原因文本仍需自己挂 `aria-describedby` |
| 20c | @clerk/localizations 包名与版本 | 成立 | `@clerk/localizations` 4.24.1，MIT，2026-10-23；依赖 `@clerk/shared ^4.41.1`，与 `node_modules/@clerk/nextjs/package.json:77` 的 `@clerk/shared ^4.41.1` 一致 |
| 附 | 表 2.2 "@tanstack/react-form 1.33.5（2026-10-23）" | 不成立 | npm time：1.33.5 = 2026-08-11 |

## 2. 问题清单

### frontend-ui-r01（blocker）14 天浸泡期与栈自身的锁定版本冲突
R2 和 §7 第 10 步要在 `pnpm-workspace.yaml` 写 `minimumReleaseAge: 20160`。显式配置后 `minimumReleaseAgeStrict` 自动为 true，满足不了就直接解析失败；规则覆盖传递依赖，默认还会复核 lockfile 条目。下面这些版本今天都不满 14 天：

| 版本 | 发布日期 | 已满天数 |
| --- | --- | --- |
| next 16.4.3 | 2026-10-23 | 1 |
| @clerk/nextjs 7.9.20 | 2026-10-23 | 1 |
| convex 1.48.0 | 2026-10-22 | 2 |
| @anthropic-ai/sdk 1.1.0 | 2026-10-21 | 3 |
| react 19.3.1 | 2026-10-14 | 10 |
| zod 4.6.7 | 2026-10-12 | 12 |

备忘录自己在 §7 也精确指定了几个不满 14 天的版本：shadcn 4.22.1（6 天）、@axe-core/playwright 4.14.0（9 天）、@playwright/test 1.64.1（10 天）。所以 §7 第 3、6、10 步互相矛盾。

现有的 `pnpm-workspace.yaml` 只为 1 天的默认值排除了 next/clerk 系列，convex、react、zod、sdk 都不在排除表里。

另外，工作区级别的安装策略属于运维/供应链决定，不该由 UI 子决策单方面拍板。

**修改**：删掉工作区级 20160 的提议，改成"UI 新增包精确锁版本，并且选满 14 天的版本"作为选版规则，强制手段交给 observability-ops 统一决定。如果坚持全局 14 天，就必须同时列出完整的 `minimumReleaseAgeExclude`，并修正"strict 默认 true"的表述。

### frontend-ui-r02（high）next-intl 的原生构建依赖会让 pnpm 11 安装失败
next-intl 4.14.9 的 `dependencies` 里有：
- `@swc/core ~1.16.0`（`postinstall: node postinstall.js`）
- `@parcel/watcher`（`install: node scripts/build-from-source.js`）
- `next-intl-swc-plugin-extractor`、`@eloqnt/*`

解包核对：`@swc/core` 只在 `dist/esm/*/extractor/extractor/MessageExtractor.js` 里被 import，`@parcel/watcher` 只在 `extractor/source/SourceFileWatcher.js` 里，都只服务于可选的消息提取功能。

问题在于 pnpm 11 的 `strictDepBuilds` 默认 true：不在 `allowBuilds` 里的构建脚本会触发 `ERR_PNPM_IGNORED_BUILDS`，安装失败（pnpm.io/settings/build）。现有 `allowBuilds` 只有 esbuild、unrs-resolver。

**修改**：在 `pnpm-workspace.yaml` 加 `allowBuilds: { '@swc/core': false, '@parcel/watcher': false }`（明确拒绝，算作"已审阅"），并写进验证步骤。同时把这部分体积和原生依赖算进 next-intl 的成本。

**更轻的备选**：v1 只有 en、工作台以 Client Component 为主时，`use-intl` 4.14.9 只依赖 intl-messageformat、icu-minify 等，没有原生依赖，可以作为对照项评估。

### frontend-ui-r03（medium）jsx-a11y 照"显式开 recommended"的写法会让 lint 崩溃
在 scratch 里实测：`defineConfig([...nextVitals, jsxA11y.flatConfigs.recommended])` 报错 `ConfigError: Config "jsx-a11y/recommended": Key "plugins": Cannot redefine plugin "jsx-a11y"`。原因是 eslint-config-next 用 `_interop_require_wildcard` 包了一层插件对象（`dist/index.js:7,122`），与插件自身导出的对象不是同一个引用。

改成只合并 rules，`{ files: ["**/*.tsx"], rules: jsxA11y.flatConfigs.recommended.rules }`，可以正常报出 `click-events-have-key-events` 等错误。

另外，pnpm 不提升依赖，根目录下没有 `node_modules/eslint-plugin-jsx-a11y`，必须把它加成直接 devDependency，并锁定 6.10.2，与 eslint-config-next 用的版本一致。

**修改**：把 A2 改成上面的写法，并在 §0 的依赖表里补上 `eslint-plugin-jsx-a11y`。

### frontend-ui-r04（low）事实小错
- eslint-config-next 默认开的 a11y 规则是 6 条，不是 5 条。
- radix-ui 和 RHF 的 react peer 都覆盖 16.8 到 19，不是"^19"。
- TanStack Form 1.33.5 的发布日期是 2026-08-11。
- resolvers 6.0.0 的破坏性变更还包括 Effect 错误 type 改名。

这些不影响结论，但应该改正。

### frontend-ui-r05（low）版本表与验证步骤不一致
§0 表写的是 resolvers "5.9.x"，但 5.9.2 只发布了 7 天，按 14 天规则只能用 5.9.1（§7 第 3 步写的正是 5.9.1）。RHF 应写成"7.89.0"，不是"7.89.x"（7.89 没有补丁版本）。另外，对 zod 用户来说，从 resolvers 5.9.1 升到 6.0.0 没有收益，可以写明"不急于升级"。

### frontend-ui-r06（low）跨模块要求的定位
"公共文本存成结构化的 `{templateKey, params}`"是 03-schema、05-protocol、07-privacy 的决定。它与核心 1、核心 4 一致：公共文本由模板生成，模型不能直接写对他方可见的金额。备忘录已经把它标成跨模块，但应措辞为"向 03/05 提出的需求"，并给出在那边被否决时的退路（只存英文渲染结果、只翻译界面文案），避免 UI 层反向锁定 schema。

### frontend-ui-r07（low）A5 的实现细节待落实
focusableWhenDisabled 存在，但文档没写它是否输出 `aria-disabled`。shadcn Base UI 版的 `Button` 是否透传这个 prop 也待确认。

**修改**：A5 统一用自有 `Button` 的 `disabledReason`：`aria-disabled="true"` + `aria-describedby`，并在 onClick 里拦截。focusableWhenDisabled 只作为实现选项，验收项不依赖它。

## 3. 主动检查

- **兼容性**：Base UI、lucide、sonner、next-intl、RHF、TanStack Form 的 peer 都覆盖 React 19.x，因此覆盖 19.3.1；Mantine 要求 ^19.2。没有发现与 Convex 1.48 或 Clerk 7.9 的直接依赖冲突，UI 包不碰 Convex。Node 24：shadcn CLI 要求 >=20.18.1，@clerk/localizations 要求 >=20.9.0，都满足。zod 4.6.7 满足 resolvers 和 conform 的 peer。React 19.3 的实际行为仍要靠 §7 的 spike 验证，Radix 在 19.2 上出过回归就是先例。
- **许可证**：运行时依赖是 MIT / ISC / Apache-2.0（cva 是 Apache-2.0），MPL-2.0 只在 axe 这个 dev 依赖里，结论成立。
- **维护活跃度**：Base UI、shadcn、lucide、RHF、Mantine 最近 30 天都有发布；Radix Themes 9 个月没有发布；eslint-plugin-jsx-a11y 6.10.2 已经很久没有新版（备忘录写的日期是 2024-10，本评审没有复核）。
- **与任务书核心的冲突**：没有。diff 只接收投影类型、不做乐观更新、SimulatedBadge、徽章用颜色加文字，都直接支撑核心 1、3、6、8。
- **过度设计**：next-intl 从第一天接入属于中等投入。任务书只要求界面英文，"后续加中文"来自 03 输入。如果采纳 r02 的成本，可以考虑 v1 只把文案外置到 `messages/en.json`，配一个很薄的 `t()`（`use-intl`），把 next-intl 插件推迟到加中文时再接。这项不阻塞，留给作者权衡。
- **被忽略的更简单方案**：表单少于 10 个，原生 `<form>` + zod `safeParse` + `useMutation` 也能做；只有目录条目的 `useFieldArray` 真正需要 RHF。备忘录的选择合理，但应写一句为什么不用原生。
