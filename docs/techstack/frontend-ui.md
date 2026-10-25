# 前端 UI 层技术选型（Speak for Me）

> 子决策范围：样式与组件、表单与校验、提案版本差异呈现、图标、可访问性基线、国际化预留。栈已定：Next.js 16.4.3（App Router）+ React 19.3.1 + Convex 1.48.0 + Clerk 7.9.20 + zod 4.6.7（`/Users/zhennn/cal-hack-2026-main/package.json`）。事实核对日 2026-10-24。来源编号 [S#] 见文末。

## 0. 结论（先读）

| 子决策 | 推荐 | 版本（精确锁定，见 §6 浸泡期） |
| --- | --- | --- |
| 样式 | Tailwind CSS 4，PostCSS 插件接入；设计令牌放 `globals.css` 的 `:root` + `@theme inline` | `tailwindcss` 4.3.3、`@tailwindcss/postcss` 4.3.3 |
| 组件 | shadcn/ui（CLI 4，组件源码复制进仓库）+ **Base UI** 作原语（shadcn 自 2026-07-02 起的默认）；Radix 作同 API 备选 | `shadcn` 4.22.1（仅开发期 CLI）、`@base-ui/react` 1.9.0、`class-variance-authority` 0.7.1、`tailwind-merge` 3.7.x、`clsx` 2.1.1、`tw-animate-css` 1.4.0、`sonner` 2.0.8 |
| 表单 | `react-hook-form` 7 + zod 4 + `@hookform/resolvers`（`zodResolver`）+ shadcn `Field` 组件；提交走 Convex `useMutation`，**不走 Server Actions** | `react-hook-form` 7.89.x、`@hookform/resolvers` 5.9.x（6.0.0 满 14 天后可升） |
| 版本差异 | **不用文本 diff 库**。场景插件提供纯函数 `diffTerms(prev, next)`，作用于**已按角色投影**的 `ProposalView`；引擎提供通用渲染：提案卡 "Changes from vN"、版本对比表、任选两版并排 | 无新依赖 |
| 图标 | `lucide-react`（ISC，shadcn 默认，Next 16 默认 `optimizePackageImports` 名单内） | 实现当天满 14 天的最新 1.x |
| 可访问性 | WCAG 2.2 AA；显式开启 `eslint-plugin-jsx-a11y` recommended；`@axe-core/playwright` 进 E2E 门禁；实时变化经 `aria-live` 播报，不抢焦点 | `@axe-core/playwright` 4.14.0、`@playwright/test` 1.64.x（均 devDep） |
| 国际化 | `next-intl` 4（"without i18n routing" 模式，无 URL 前缀、不动 `proxy.ts`）；v1 只有 `en`，但所有界面文案、reasonCode、公共模板文本从第一天起经 message key 渲染 | `next-intl` 4.14.9 |

一句话：Tailwind 4 + shadcn/ui（Base UI 原语）+ RHF/zod 4 + 结构化字段 diff + lucide + next-intl 无路由模式；组件代码入库、运行时第三方依赖约 10 个、全部 MIT/ISC/Apache-2.0。

## 1. 需求与约束

### 1.1 来自任务书核心（`design/00-brief.md` §3）

| 核心 | 对 UI 层的硬要求 |
| --- | --- |
| 1 私密委托 | 组件只消费按角色投影后的 Convex query 结果；**不得**为了算 diff、算预算条而拉取更宽的数据再在客户端过滤（Role A 缺陷 F07.2）。diff 函数的参数类型只能是投影后的 `ProposalView`，让越权在类型层就编不过。 |
| 2 代理只建议 | 代理消息区与审批区视觉与语义分离；"Agent recommends accepting" 用徽章/文本，绝不是按钮状态。 |
| 3 人批准具体版本 | 审批按钮文案带版本号与约束版本（"Approve v3 under constraints v4"）；禁用时旁边有文字原因；**不做乐观更新**（04-platform §5 含义 4）。 |
| 4 代码负责校验 | 价格在表单中只读（来自已确认目录）；金额以整数美分提交；客户端 zod 只是 UX，Convex mutation 必须重新校验并以 `ConvexError({code})` 回传，表单把 code 映射回字段错误。 |
| 6 历史不可篡改 | 对比表与历史保留 superseded / invalidated 版本与旧审批，用状态徽章区分，不隐藏。 |
| 8 不伪造 | 统一的 `SimulatedBadge`（"Simulated quote"、stub 回合标 simulated）是基础组件，不是各页自写。 |

### 1.2 来自平台约束（`design/inputs/04-platform-constraints-part7.md`、part4）

- Server Component 做外壳，实时数据只在 Client Component 中经 Convex hooks 订阅（part7 §5.1）；角色工作台整体是 Client Component，因此组件库是否 "RSC 友好" 不是关键维度，**交互组件的可访问性与可控性**才是。
- Next 16 默认用 Turbopack 做 `next dev` 与 `next build`，有自定义 webpack 配置时 build 直接失败（`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:102-130`）。排除依赖 webpack/babel 插件的方案。
- "多数写入直接在客户端 `useMutation` 即可，鉴权都在 Convex 内"（part7 §5.1）；在途 mutation 重连后安全重发（04 索引要点 8）。这决定了表单方案。
- `proxy.ts` 运行时固定 nodejs、每个项目只能有一个（part4 §3.5）——国际化不应再往 proxy 里塞路由逻辑。

### 1.3 来自前端需求（`02-review-design-findings-part11.md` F13.1–F13.4；`03-role-a-branch-decisions-part9.md` §7.4–7.6）

- 页面：房间列表 / 我的私密简报 / 工作台 / 结果与历史，外加 `/setup` 诊断。
- 工作台组件：待办置顶、提案卡（含 "Changes from vN"、检查清单、"批准后将创建的记录"预览）、版本对比表（Version / Scope / Cost / Total spend / Delivery / Status，当前行 `aria-current`）、审批面板、run 进度（queued / running / failed→"Retry turn" / stale）、人工请求卡（选项按钮只对目标人可操作）、共享事实面板、预算条（`role="img"`，aria-label 按角色裁剪）。
- 表单（F13.2）：结构化简报（itemKey 勾选、价格只读、deadline、deferrable、逐项"visible to other parties"共享勾选，提交即确认）；finance "Update budget cap"（reason + 美元→整数美分）；回答人工请求；建房 / 邀请 / 加入；provider 确认目录条目（需要 `useFieldArray`）。规模：< 10 个表单，无复杂多步向导。
- 可访问性既有决定（采纳）：语义 `section` + `aria-labelledby`、徽章颜色+文字、宽表横向滚动、窄屏单列。
- 界面英文，后续加中文：文案外置要从第一天开始，否则后续回填成本高。

## 2. 候选方案表

### 2.1 样式与组件

| 方案 | 最新版 / 许可证 / 最近发布 | React 19.3 / Next 16.4 / Tailwind 4 兼容证据 | 要点 |
| --- | --- | --- | --- |
| A. Tailwind 4 + shadcn/ui（Base UI 原语） | `tailwindcss` 4.3.3 MIT（2026-07-16）；`shadcn` 4.22.1 MIT（2026-10-18）；`@base-ui/react` 1.9.0 MIT（2026-10-09），1.0.0 发布于 2025-12-11 | Next 16 官方 CSS 文档把 `tailwindcss` + `@tailwindcss/postcss` 作为首选接入 [S1]；shadcn："新项目以 Tailwind v4 + React 19 起步"，组件去掉 `forwardRef`、加 `data-slot` [S4]；Base UI peer `react ^17‖^18‖^19`，`date-fns`/`@date-fns/tz` 为可选 peer [S10] | 源码入库，原语可换；2026-07-02 起 shadcn 默认 Base UI，Radix 继续支持，新组件两套同发 [S3] |
| B. Tailwind 4 + shadcn/ui（Radix 原语） | `radix-ui` 1.8.1 MIT（2026-10-12） | peer `react ^19.0`；2026-06/07 修复多起 React 19/19.2 回归（`Slot` 无限重渲染、陈旧 `onEscapeKeyDown`）[S6] | 成熟度最高；WorkOS 维护，第三方评论称节奏放缓 [S7] |
| C. Radix Themes | `@radix-ui/themes` 3.3.0 MIT（**2026-01-31**，近 9 个月无发布） | peer 含 `^19.0` | 成品主题，令牌与布局定制有限，自带 CSS 与 Tailwind 并存冲突 |
| D. Mantine 9 | `@mantine/core` 9.7.3 MIT（2026-10-17） | peer `react ^19.2.0`（满足 19.3.1） | 全家桶（含 `@mantine/form`），自带 CSS 变量 + PostCSS preset 样式体系 |
| E. 纯 CSS Modules（可配 Base UI 无样式原语） | Next 内置 | 内置 | 零依赖；Dialog/Select/Popover/Tabs/Toast 的可访问交互需自建或另引原语 |

### 2.2 表单与校验

| 方案 | 版本 / 许可证 / 发布 | 兼容 | 要点 |
| --- | --- | --- | --- |
| A. `react-hook-form` + zod 4 + `@hookform/resolvers` | RHF 7.91.0 MIT（2026-10-23），7.89.0（2026-09-26）；8.0.0-beta.5 同日发布；resolvers 6.0.0 MIT（2026-10-19），5.9.2（2026-10-17） | RHF peer `react ^19`；resolvers peer `zod ^3.25‖^4`、`react-hook-form ^7.55` [S8]；6.0.0 唯一破坏性变更是 effect resolver 要求 Effect v4 [S9] | 非受控、重渲染少、`useFieldArray`；shadcn 官方 Forms 文档用 `Field` + `Controller` + `zodResolver` [S5] |
| B. Conform | `@conform-to/react` 1.21.2 MIT（2026-10-11）；`@conform-to/zod` peer `zod ^3.21‖^4` | peer `react >=18` | 以 FormData + Server Action + 渐进增强为核心；文档另有 "Future APIs" 分区 [S11] |
| C. TanStack Form | `@tanstack/react-form` 1.33.5 MIT（2026-10-23） | peer `react ^19` | 类型推断强；shadcn 文档也有一页 |
| D. 原生 Server Actions + `useActionState` | Next/React 内置 | 内置 | 需在 Next 服务端 `fetchMutation(api…, args, { token })`（part7 §5.1） |
| E. `@mantine/form` | 9.7.3 MIT | `react ^19.2` | 只有选 Mantine 时才合理 |

### 2.3 版本差异呈现

| 方案 | 版本 / 许可证 | 要点 |
| --- | --- | --- |
| A. 结构化字段 diff（场景插件纯函数 + 引擎通用渲染） | 无依赖 | 提案本身是结构化的（itemKeys、deferredItemKeys、termIds、amountCents、deliveryDate，见 `02-review-design-findings-part3.md` F03 proposals 草案） |
| B. `diff`（jsdiff） | 9.0.0 BSD-3-Clause（2026-04-13） | 文本/行/词级 diff |
| C. `react-diff-viewer-continued` | 4.4.0 MIT（2026-07-14） | 代码评审式视图；依赖 `@emotion/css`、`@emotion/react`、`refractor`、`diff`、`js-yaml`（npm view） |

### 2.4 图标

| 方案 | 版本 / 许可证 / 发布 | 要点 |
| --- | --- | --- |
| A. `lucide-react` | 1.61.0 ISC（2026-10-21；1.0.0 于 2026-03-23；10 月几乎每 1–3 天一版） | shadcn 默认；Next 16 `optimizePackageImports` 默认名单含 `lucide-react`（`next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/optimizePackageImports.md:23`） |
| B. `@heroicons/react` | 2.2.0 MIT（2024-11-18） | 图标数量少，近两年无新版本 |
| C. `@phosphor-icons/react` | 2.1.10 MIT（npm modified 2025-05-22） | 17 个月无发布 |

### 2.5 国际化

| 方案 | 版本 / 许可证 | 要点 |
| --- | --- | --- |
| A. `next-intl` | 4.14.9 MIT（2026-10-02），peer `next ^16`、`react ^19` | Server/Client 组件都可用；有不做路由的接入方式，locale 可来自 cookie 或用户设置 [S12] |
| B. `react-intl`（FormatJS） | 12.1.5 BSD-3-Clause | ICU 成熟，但无 Next App Router/RSC 一等集成 |
| C. Lingui | `@lingui/core` 6.10.1 MIT | 依赖编译期宏（SWC/babel 插件），与 Turbopack 默认构建的配合需额外验证 |
| D. 自写字典 | 无依赖 | Next 文档示例做法；无复数/ICU、无格式化器 |

### 2.6 可访问性工具

| 工具 | 版本 / 许可证 | 现状 |
| --- | --- | --- |
| `eslint-plugin-jsx-a11y` | 6.10.2 MIT（2024-10-26） | 已经被 `eslint-config-next` 16.4.3 依赖，但只开 5 条规则且都是 `warn`（`node_modules/eslint-config-next/dist/index.js:176-191`）——需显式开 recommended |
| `@axe-core/playwright` | 4.14.0 **MPL-2.0**（2026-10-15） | 只作 devDependency，不进产物，许可证无传染风险 |

## 3. 评估维度

### 3.1 样式与组件（5 分制，越高越好）

| 维度 | A shadcn+Base UI | B shadcn+Radix | C Radix Themes | D Mantine 9 | E CSS Modules |
| --- | --- | --- | --- | --- | --- |
| 成熟度 | 4（Base UI 1.x 约 10 个月，MUI 原班；shadcn 默认） | 5 | 3 | 5 | 5（技术本身） |
| Next 16 / React 19.3 / Tailwind 4 | 5 | 4（2026 年多起 React 19 回归已修） | 3（与 Tailwind 双体系） | 4（不用 Tailwind） | 5 |
| Convex 1.48 | 中性：组件只吃 props，`useQuery` 加载中为 `undefined` 由页面组件处理 | 同左 | 同左 | 同左 | 同左 |
| 许可证 | MIT | MIT | MIT | MIT | — |
| 维护活跃度 | 5（2026-10-09 发布） | 4（2026-10-12；节奏放缓） | 2（2026-01-31 后无发布） | 5 | — |
| 学习成本 | 中（Tailwind + cva） | 中 | 低 | 中（自有 API） | 低（但要自建可访问组件，实为高） |
| 迁移成本（将来换掉） | 低：源码在仓库，原语可逐组件换回 Radix | 低 | 中 | 高：组件不在仓库，API 渗透各页 | 最低 |
| 对核心不变量的影响 | 无负面；徽章/禁用原因/Simulated 标注都是自有组件 | 同左 | 定制受限，"颜色+文字"徽章需覆盖主题 | 中性 | 可访问性风险最高 |

### 3.2 表单

| 维度 | A RHF + zod 4 | B Conform | C TanStack Form | D Server Actions |
| --- | --- | --- | --- | --- |
| 成熟度 | 5（7.x 多年稳定） | 4 | 4 | 5（平台能力） |
| 与写入路径（Convex `useMutation`）匹配 | 5：`handleSubmit` 里直接调 mutation，pending 期间禁用按钮 | 2：核心价值（FormData、Server Action、无 JS 可用）用不上 | 5 | 2：多一跳 Next 服务端、要转发 token、`ConvexError` 跨边界映射、失去客户端重连重发语义 |
| zod 4 | 是（resolvers peer `^4`） | 是 | 是（Standard Schema） | 手写 `safeParse` |
| 学习成本 / 生态 | 低 / 最大 | 中 / 小 | 中 / 中 | 低 / — |
| 迁移成本 | 低：schema 是 zod，可平移到 C | 中 | 低 | — |
| 对不变量 | 无负面，前提是"客户端校验非权威"写进规范 | 同 | 同 | 多一个持有 token 的服务端面 |

### 3.3 差异呈现

结构化 diff 胜出的决定性理由：提案不是文本。`publicSummary` 由模板从结构化字段生成（F05.3），对它做文本 diff 只是把字段差异绕一圈变成噪声；`rationale` 是本方可见的模型自由文本，跨版本比较它没有业务意义。另外 C 方案引入 emotion 运行时 CSS-in-JS 与 YAML 解析器，与 Tailwind 体系重复。

## 4. 推荐与理由

### 4.1 样式与组件：Tailwind 4 + shadcn/ui（Base UI）

1. **源码所有权**：shadcn 组件复制进 `src/components/ui/`，按我们的不变量改（例如 `Button` 默认支持 `disabledReason`，渲染 `aria-describedby` 指向原因文本）。不存在"等上游发版"的阻塞。
2. **跟随上游默认**：shadcn 2026-07-02 把默认原语切到 Base UI，理由是 Base UI 1.6.0 时已有 600 万+周下载、shadcn/create 新项目选 Base UI 与 Radix 约 2:1，且承诺 Radix 不弃用、新组件两套同发 [S3]。跟随默认可让后续 `shadcn add` 的组件与文档最少偏差。
3. **可替换**：两套原语下组件 API 相同 [S2]，如果 Base UI 出问题可按组件换回 Radix（风险 R1）。
4. **Tailwind 4 是 Next 16 文档的首选样式方案** [S1]，零配置 PostCSS 接入、与 Turbopack 默认构建兼容（待 §7 步骤 3 实测）。
5. 令牌：`globals.css` 定义 `--background/--foreground/--muted/--accent/--destructive/--success/--warning/--ring` 等 OKLCH 变量 + `.dark`，再 `@theme inline` 暴露给 Tailwind（shadcn v4 约定 [S4]）。状态色对比度 ≥ 4.5:1 作为令牌验收项。
6. 日期输入用原生 `<input type="date">`（可访问、随浏览器 locale），v1 不引 `react-day-picker`/`date-fns`；Base UI 的 `date-fns` peer 是可选的，因此不会被拖入。
7. 通知用 `sonner`（shadcn 已弃用旧 toast 改用 sonner [S4]）；但**审批、阻断、失效等关键状态不只靠 toast**，必须在页面常驻区域呈现。

### 4.2 表单：RHF + zod 4 + `zodResolver` + shadcn `Field`

- 写入路径固定为 `useMutation`：`form.handleSubmit(async (values) => { await mutate(toArgs(values)) })`，捕获 `ConvexError` 后 `form.setError(field, { message: t(\`reasonCodes.${code}\`) })` 或表单级错误。
- **两层 schema**：`FormSchema`（界面形状，例如 `capDollars: string`）与 `ArgsSchema`（mutation 形状，`capCents: number` 整数）。转换函数 `parseDollarsToCents(input): Result<number>` 放在引擎/场景的纯模块，拒绝超过两位小数、负数、非数字、超出 `Number.MAX_SAFE_INTEGER`；同一 `ArgsSchema` 在 Convex mutation 里于 `v.*` 形状校验之后再跑一次（04 要点 5：`v.*` 不表达范围）。
- 泛型写法 `useForm<z.input<typeof FormSchema>, unknown, z.output<typeof FormSchema>>`（resolvers 5.x 起推荐的 Input/Context/Output 三参数）。
- 价格字段在简报表单里渲染为只读文本，不是 disabled input——不进入表单值，避免"客户端可篡改价格"的错觉。
- 共享勾选：每个可共享字段旁 `Checkbox` + 文本 "This will be visible to other parties"，提交前汇总一次披露清单（核心 1 的"显式披露决定"）。
- 不做乐观更新；提交中按钮 `aria-disabled` + "Saving…"；幂等由服务端保证，前端禁用只是 UX。

### 4.3 版本差异：场景插件纯函数 + 引擎通用渲染

```ts
// engine：通用、与场景无关
export type DiffEntry = {
  field: string;                       // 例如 "items" | "deliveryDate" | "amountCents"
  kind: "added" | "removed" | "changed" | "deferred" | "undeferred";
  labelKey: string;                    // next-intl message key
  from?: DisplayValue; to?: DisplayValue; // 已是投影后可见的值
};
export type ProposalDiff = {
  fromVersion: number; toVersion: number;
  constraintsVersionChanged: { from: number; to: number } | null;
  entries: DiffEntry[];
};
// scenario 插件接口的一员
diffTerms(prev: ProposalView["terms"], next: ProposalView["terms"]): DiffEntry[];
```

- 参数类型是 `ProposalView`（Convex `rooms.view` 声明的 `returns` 投影类型），不是表文档类型；provider 视图里没有 total spend，diff 自然不会出现它。类型测试用 `// @ts-expect-error` 断言传入原始 proposal 文档编译失败。
- 在客户端对订阅到的投影数据计算（纯函数、O(条目数)），不新增 query；同一函数在 convex-test 里复用于断言。
- 三种呈现：
  1. 提案卡 "Changes from v{n}"：`<ul>`，每项 = lucide 图标（`Plus`/`Minus`/`ArrowRight`/`Clock`）+ 视觉隐藏前缀（"Added:"/"Removed:"/"Changed from … to …"）+ 文本；颜色只是冗余提示。不依赖 `<ins>/<del>`（多数读屏默认不播报）。
  2. 版本对比表：`<table>` + `<caption>` + `<th scope>`，当前行 `aria-current="true"`；外层 `role="region"` + `aria-label` + `tabIndex={0}` 的横向滚动容器，键盘可滚。
  3. 任选两版并排（两个 `Select`，默认 当前 vs 上一版）：v1 可延后，引擎接口已能支持。
- 约束版本变化导致的"旧审批失效"不是 diff 的职责，由审批面板与事件呈现；diff 只在头部标注 "Checked against constraints v{n}"（F13.1 的如实文案）。

### 4.4 图标：`lucide-react`

shadcn 默认、ISC 宽松许可、具名导入可摇树且在 Next 16 默认 `optimizePackageImports` 名单内。规则：装饰性图标 `aria-hidden`，独立图标按钮必须有 `aria-label`（或视觉隐藏文本）；状态不能只用图标表达。发版极频繁，必须精确锁版本。

### 4.5 可访问性基线（验收标准，不是愿景）

| 编号 | 要求 | 落点 |
| --- | --- | --- |
| A1 | 目标 WCAG 2.2 AA | 设计评审与 E2E |
| A2 | `eslint.config.mjs` 显式加入 `jsx-a11y` recommended（`eslint-config-next` 默认只开 5 条 warn） | CI lint 失败即阻断 |
| A3 | 每个角色的 4 个主页面跑 `@axe-core/playwright`，serious/critical 为 0 | E2E 门禁 |
| A4 | Convex 推送引起的关键变化（预算翻转 blocked、"你的审批已失效"、run failed、人工请求到达）经全局 `aria-live="polite"` 播报器播报，文本来自已投影数据；错误用 `role="alert"`；**不移动焦点** | `LiveAnnouncer` 组件 |
| A5 | 禁用操作必须有可读原因：用 `aria-disabled="true"` + `aria-describedby`（或 Base UI Button 的 focusableWhenDisabled 能力，待验证），保证键盘用户能聚焦并听到原因 | `Button` 的 `disabledReason` |
| A6 | 状态 = 颜色 + 文字（+ 可选图标）；令牌对比度 ≥ 4.5:1（大字 3:1） | 令牌表 |
| A7 | 焦点可见（`focus-visible:ring`）；Dialog 焦点圈定与归还由原语负责 | 原语 |
| A8 | 表单：`label`/`htmlFor`、`aria-invalid`、错误 `aria-describedby`（shadcn `Field` 约定 [S5]） | `Field` |
| A9 | `motion-safe:` 包裹动画；`<html lang>` 随 locale；目标尺寸 ≥ 24×24 CSS px | 全局 |
| A10 | 预算条 `role="img"`，`aria-label` 内容同样按角色裁剪（provider 只听到"within budget / over budget"） | `BudgetBar` |

### 4.6 国际化预留：`next-intl` 无路由模式

- 接入：`src/i18n/request.ts`（`getRequestConfig` 返回 locale 与 messages）+ `next.config.ts` 包 `createNextIntlPlugin()` + 根 layout 包 `NextIntlClientProvider` [S12]。v1 locale 固定 `en`；后续读用户设置（Convex 用户偏好）或 cookie。**不加 `[locale]` 路由段、不改 `proxy.ts`**。
- 文案：`messages/en.json` 按页面/组件命名空间；reasonCode → `reasonCodes.<CODE>`；状态枚举 → `status.<enum>`。
- **跨模块要求（需 03-schema / 05-protocol 配合）**：对他方可见的公共文本（`publicSummary`、事件 summary、人工请求问题与选项）在数据库中存**结构化** `{ templateKey, params }`（params 只含枚举、itemKey、整数美分、ISO 日期），由前端按 viewer locale 渲染；若为日志/导出需要英文渲染结果，可另存，但不能只存渲染后的英文。否则将来加中文时历史记录无法翻译。模型自由文本（本方 rationale）不翻译、原样显示并标注来源。
- 格式化：金额统一 `format.number(cents / 100, { style: "currency", currency })`；`deliveryDate` 等日历日期是 `YYYY-MM-DD`，按 UTC 解析与格式化以免时区偏移一天；时间戳用房间 `timeZone`。
- 中文阶段清单：`messages/zh-CN.json`、Clerk 组件本地化（`@clerk/localizations`，待验证包名与版本）、CJK 字体回退栈、文本膨胀/截断走查。

## 5. 否决理由

| 否决项 | 理由 |
| --- | --- |
| shadcn + Radix（作为首选） | 可行，留作备选。不首选的原因：上游默认已转 Base UI 且新组件 Base UI 优先 [S3]；Radix 2026 年出现多起 React 19 回归（虽已修）[S6]，维护节奏放缓 [S7]。 |
| Radix Themes | 2026-01-31 之后无发布；成品主题定制受限；与 Tailwind 形成两套样式体系。 |
| Mantine 9 | 质量高、React 19.2+ 就绪，但自带样式体系与表单库，组件不在仓库、API 渗透所有页面，退出成本最高；我们只需十几个数据密集型组件，不需要 100+ 组件的全家桶。 |
| 纯 CSS Modules | 依赖最少，但要自建可访问的 Dialog/Select/Popover/Tabs/Toast，正是可访问性 bug 最集中的地方。保留为退出路径（E + Base UI 无样式原语）。 |
| Conform | 核心价值是 FormData + Server Action + 无 JS 渐进增强；本系统写入走 Convex `useMutation`，工作台本身依赖实时订阅，无 JS 不是目标。 |
| 原生 Server Actions | 多一跳 Next 服务端并要转发用户 token，`ConvexError` 跨边界映射，失去 Convex 客户端在途 mutation 重连安全重发；多一个持有 token 的服务端面。 |
| TanStack Form | 可信替代；RHF 更成熟、生态与 shadcn 文档覆盖更全。schema 都是 zod，日后切换成本低。 |
| jsdiff / react-diff-viewer-continued | 提案是结构化数据，文本 diff 是噪声；后者引入 emotion 运行时 CSS-in-JS、refractor、js-yaml。 |
| Phosphor / Heroicons | Phosphor 17 个月无发布；Heroicons 图标集小、近两年无新版。 |
| react-intl / Lingui / 自写字典 | react-intl 无 App Router 一等集成；Lingui 依赖编译期宏，Turbopack 默认构建下需额外验证；自写字典缺 ICU 复数与格式化器。 |

## 6. 风险与退出策略

| 编号 | 风险 | 缓解 | 退出 |
| --- | --- | --- | --- |
| R1 | Base UI 较年轻（1.0.0 于 2025-12-11），可能遇到组件缺陷 | 组件源码在仓库；E2E + axe 覆盖关键交互 | 逐组件 `shadcn add` 的 Radix 版本替换，API 相同 [S2] |
| R2 | 供应链：本次涉及的包 10 月几乎都在发版（lucide 每 1–3 天、RHF 7.91.0 发布仅 1 天、resolvers 6.0.0 仅 5 天） | 精确锁版本 + lockfile；`pnpm-workspace.yaml` 设 `minimumReleaseAge: 20160`（14 天，单位分钟；pnpm 11 默认 1440，`minimumReleaseAgeStrict` 默认 true）[S13]；shadcn CLI 生成的代码人工审阅后再提交 | — |
| R3 | RHF 8 已在 beta（8.0.0-beta.5，2026-10-23），v8 正式版可能有破坏性变更 | 锁 `^7` 的精确版本 | schema 不变，切 TanStack Form |
| R4 | UI 层越权：开发者为了算 diff/预算条去订阅更宽的 query | diff/预算组件参数只收投影类型；隐私金丝雀 E2E 扫 DOM 与 WebSocket 帧（F16 canary） | — |
| R5 | 公共文本只存英文渲染结果，阻断中文化 | §4.6 跨模块要求写入 03/05 | 迁移脚本按 eventType 反解（代价高，应避免） |
| R6 | Tailwind 类名膨胀、视觉不一致 | 令牌 + `cva` 变体；可选 `prettier-plugin-tailwindcss` 排序 | Tailwind 输出纯 CSS，可渐进改写为 CSS Modules |
| R7 | `sonner`、Base UI Toast 等通知被误用于关键状态 | 规范：关键状态常驻页面 + `aria-live`，toast 只做回执 | — |

## 7. 如何验证（可执行步骤，在 scratchpad 的独立 spike 目录里做，不碰源仓库）

1. `pnpm create next-app@16.4.3 ui-spike --ts --app --tailwind --eslint --src-dir`，然后 `pnpm add next@16.4.3 react@19.3.1 react-dom@19.3.1`；确认 `postcss.config.mjs` 使用 `@tailwindcss/postcss`、`tailwindcss` 解析为 4.3.3。
2. `pnpm dlx shadcn@4.22.1 init`（选 Base UI、icon 选 lucide），再 `pnpm dlx shadcn@4.22.1 add button field input checkbox select dialog table badge tabs tooltip sonner`；检查 `components.json` 与 `package.json` 中实际写入的依赖与版本。
3. `pnpm add convex@1.48.0 @clerk/nextjs@7.9.20 zod@4.6.7 react-hook-form@7.89.0 @hookform/resolvers@5.9.1 next-intl@4.14.9`；`pnpm install --strict-peer-dependencies` 无 peer 报错；`pnpm build`（Turbopack 默认）通过，`pnpm start` 后浏览器控制台无 hydration 警告。
4. 表单 spike：实现 "Update budget cap"，zod 4 schema + `zodResolver`；验证 `useForm<z.input, unknown, z.output>` 类型推断正确；对 `"12.345"`、`"-1"`、`"1e3"`、`"4800"` 断言 `parseDollarsToCents` 结果；模拟 mutation 抛 `ConvexError({ code: "BUDGET_BELOW_COMMITTED" })`，断言字段错误文案来自 `messages/en.json`。
5. diff 单测：用 Role A fixture（`03-role-a-branch-decisions-part9.md` §8.1：v1 全量 $1,400 / 2026-12-04 → v2 一期 $900 / 2026-11-20、item 3 延后）断言 `entries`；provider 视图下断言没有 total spend 条目；`// @ts-expect-error` 断言原始文档类型被拒。
6. 可访问性：`pnpm add -D @playwright/test@1.64.1 @axe-core/playwright@4.14.0`；对 spike 页跑 axe（serious/critical = 0）；键盘走查 Dialog/Select/对比表滚动区；macOS VoiceOver 验证预算翻转时 `aria-live` 播报一次且焦点不动；验证 `aria-disabled` 按钮能聚焦并读出原因。
7. i18n：加 `messages/zh-CN.json`（3 个 key），切 cookie，确认 Server 与 Client 组件都切换；`next build` 在 `createNextIntlPlugin` 下通过。
8. 包体：`next build` 输出中工作台路由首屏 JS；确认 lucide 只打入用到的图标。
9. 许可证：`pnpm licenses list --prod`，白名单 MIT / ISC / Apache-2.0 / BSD-3-Clause；MPL-2.0 只允许出现在 dev 依赖。
10. 锁版本：在 `pnpm-workspace.yaml` 写 `minimumReleaseAge: 20160` 后 `pnpm install`，确认装上的都是 ≥ 14 天的版本（例如 resolvers 不会解析到 6.0.0）。

## 8. 来源列表（访问日期均为 2026-10-24）

- [S1] Next.js CSS 文档（Tailwind 首选接入）：`/Users/zhennn/cal-hack-2026-main/node_modules/next/dist/docs/01-app/01-getting-started/11-css.md:22-50`；Turbopack 默认：同目录 `02-guides/upgrading/version-16.md:102-130`；lucide 在 optimizePackageImports 默认名单：`03-api-reference/05-config/01-next-config-js/optimizePackageImports.md:23`
- [S2] shadcn changelog 2026-01 Base UI：https://ui.shadcn.com/docs/changelog/2026-01-base-ui
- [S3] shadcn changelog "Base UI as the Default"（2026-07-02）：https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default ；changelog 索引 https://ui.shadcn.com/docs/changelog
- [S4] shadcn Tailwind v4 说明：https://ui.shadcn.com/docs/tailwind-v4 ；Next 安装：https://ui.shadcn.com/docs/installation/next
- [S5] shadcn Forms / React Hook Form：https://ui.shadcn.com/docs/forms/react-hook-form
- [S6] Radix Primitives releases：https://www.radix-ui.com/primitives/docs/overview/releases
- [S7] Radix 维护状态评论（非权威）：https://dev.to/mashuktamim/is-your-shadcn-ui-project-at-risk-a-deep-dive-into-radixs-future-45ei ；https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026
- [S8] npm registry（`npm view <pkg> version license peerDependencies time`，2026-10-24 执行）：tailwindcss、@tailwindcss/postcss、shadcn、radix-ui、@radix-ui/themes、@mantine/core、react-hook-form、@hookform/resolvers、@conform-to/react、@conform-to/zod、@tanstack/react-form、lucide-react、@heroicons/react、@phosphor-icons/react、next-intl、react-intl、@lingui/core、diff、react-diff-viewer-continued、class-variance-authority、tailwind-merge、clsx、sonner、@base-ui/react、eslint-plugin-jsx-a11y、@axe-core/playwright、@playwright/test、tw-animate-css
- [S9] @hookform/resolvers releases（v6.0.0 / v5.9.2）：https://github.com/react-hook-form/resolvers/releases
- [S10] `npm view @base-ui/react@1.9.0 peerDependenciesMeta`（date-fns、@date-fns/tz 可选）
- [S11] Conform 文档：https://conform.guide/
- [S12] next-intl without i18n routing：https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
- [S13] pnpm settings（minimumReleaseAge）：https://pnpm.io/settings
- 已装版本基线：`/Users/zhennn/cal-hack-2026-main/package.json`；`eslint-config-next` 的 a11y 规则：`/Users/zhennn/cal-hack-2026-main/node_modules/eslint-config-next/dist/index.js:176-191`
- 设计输入：`design/00-brief.md` §3；`design/inputs/04-platform-constraints-part4.md`、`-part7.md`；`02-review-design-findings-part11.md` F13；`03-role-a-branch-decisions-part9.md` §7.4–7.6、§8.1
