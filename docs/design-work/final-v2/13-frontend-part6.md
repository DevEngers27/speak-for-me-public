# 13 · 前端信息架构（part6）：可访问性、标注、技术选型、测试、反例与收尾

> 分片见 `13-frontend.md` 顶部。

## 13.13 可访问性与响应式（验收标准，WCAG 2.2 AA）

1. 区块 `<section aria-labelledby>`；每页一个 `<h1>`（房间标题或决策问题），区块 `<h2>`。
2. **禁用原因可达**：决定类按钮不用 `disabled`（会移出 tab 序列），统一用自有 `Button` 的 `disabledReason`：`aria-disabled="true"` + `aria-describedby` 指向原因 + onClick 拦截并把焦点移到原因（techstack D26；Base UI 的 `focusableWhenDisabled` 只作实现选项）。
3. 实时变化：全局 `LiveAnnouncer`（polite）播报自己动作的结果、约束翻转摘要、"你的审批已失效"、请求到达、新提案就绪；只有自己动作失败用 `role="alert"`；代理每个回合**不播报**；**不移动焦点**（例外：stale 提示与 `approval.stale` 时焦点移到提案标题）。
4. 状态 = 颜色 + 文字 + 图标；令牌对比度 ≥ 4.5:1（大字 3:1）。CRITIQUES 指出紫色同时表示私密 / 代理 / 进行中：令牌拆为 `--agent`（虚线描边 + 机器人图标）、`--private`（米黄底 + 斜纹 + 锁）、`--busy`（蓝 + 旋转图标），任何一种都不只靠颜色。
5. 对话框用原生 `<dialog>` + `showModal()` 或 Base UI Dialog：焦点进入、Esc 关闭、关闭后回到触发按钮。
6. `BudgetMeter` 只在 `finance` / `customer` 分支渲染，`role="img"`，`aria-label` 只念出该分支里存在的数字；provider 没有此组件。
7. 宽表（历史、对比）放进 `role="region" aria-label="Proposal comparison" tabindex="0"` 的横向滚动容器；当前行 `aria-current="true"` + 文字 "Current"。
8. 日期显示 "Nov 20, 2026" 并包 `<time dateTime="2026-11-20">`；相对时间旁有绝对时间 tooltip。
9. 动画包在 `motion-safe:`；目标尺寸 ≥ 24×24 CSS px；`<html lang="en">`。
10. CI：`eslint-plugin-jsx-a11y` 6.10.2 只合并 `flatConfigs.recommended.rules`（直接叠加会报 Cannot redefine plugin）；`@axe-core/playwright` 4.14.0 对三个角色的收件箱、房间页、决策页、取舍页、简报页、结果页扫描，serious / critical 为 0。
11. 响应式：≥ 1280px 三栏；1024–1279px 两栏 + "What I know" 抽屉；< 1024px 单列（顺序见 part2 §13.4）；< 640px 表格转卡片列表；审批与回答请求在手机上可完整完成。

## 13.14 诚实标注与格式化

- `SimulatedBadge`（`provenance ∈ {seeded, stub}`）用于房间横幅、目录行、提案、回合 lane、变更单、任务；房间横幅写 "Simulated room · seeded from fixture scope_change/main"。
- 代理立场永远在虚线框且标 "Suggestion"；`origin: human_choice` 的提案写 "Chosen by Customer"，代理提案写 "Drafted by Provider's agent"；时间线 actor 区分 human / agent / rules / system（CRITIQUES：不把代理与代码的行为记在人名下）。
- 没有代理消息时显示空状态，不生成占位；不伪造代理建议（例如回答请求后不会凭空出现三方 "recommends accepting"）。
- 检查标题写 "Checked against constraints vN"，不写 "Matches current constraints"。
- 变更单固定声明 "Internal record only. No payment, transfer, or e-signature happens in Speak for Me."
- v1 产品界面不展示模型成本（运维视图见 15）。
- 金额：`formatCents(cents)` = `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)`，放 `src/lib/format.ts`（引擎禁 `Intl`）。日期：`formatIsoDate("2026-11-20")` 按 `-` 拆分，任何时区都显示 "Nov 20, 2026"。时间戳按查看者浏览器时区显示；"今天"与截止判断一律来自服务端（房间时区的 `localDate`）。

## 13.15 UI 技术选型（techstack D24–D27）

| 子决策 | 选型与版本（精确锁定，经根 `catalog:`） | 约束 |
| --- | --- | --- |
| 样式与组件 | Tailwind CSS 4.3.3（`@tailwindcss/postcss`）+ shadcn/ui CLI 4（源码入库 `src/components/ui/`）+ `@base-ui/react` 1.9.0（Radix 为同 API 备选）+ `class-variance-authority`、`tailwind-merge`、`clsx`、`sonner`（只做回执，关键状态必须常驻页面） | 令牌放 `globals.css` 的 `:root` + `@theme inline` |
| 图标 | `lucide-react`（实现当天满 14 天的 1.x） | 装饰图标 `aria-hidden`；独立图标按钮必须有 `aria-label` |
| 表单 | `react-hook-form` 7.89.0 + `@hookform/resolvers` 5.9.1 + zod 4.6.7 + `zodResolver`；提交走 Convex `useMutation`，不走 Server Actions | 客户端校验只是 UX；价格在简报表单里是只读文本 |
| 版本差异 | 场景纯函数 `diffTerms(prev, next)`，参数只接受已投影的 `ProposalView['terms']`（`@ts-expect-error` 断言传原始文档编译失败）；不用文本 diff 库 | — |
| 国际化 | `next-intl` 4.14.9 无路由模式，v1 只有 `en`，全部文案外置 `messages/en.json`；`pnpm-workspace.yaml` 的 `allowBuilds` 对 `@swc/core`、`@parcel/watcher` 显式 false；`use-intl` 作实现前 spike 对照 | 公共文本以 `{templateKey, params}` 渲染（D13），加中文只补翻译 |
| 版本纪律 | `minimumReleaseAge: 10080`（canon D20），例外清单脚本生成带到期日；React 小版本跟随 Clerk | — |

## 13.16 测试（L 层与 16 对齐）

| 层 | 用例 | 方法 |
| --- | --- | --- |
| 投影纯函数 | `budget` 判别联合：provider 恒为 `none`；customer 只含已开开关字段、派生字段缺输入即 null；finance 分支在 $800 恰等于余量时 `within`、$4,799.99 时 `over`（Δ2） | vitest 表驱动 |
| 投影纯函数 | `fit` 判别联合：provider 恒 `audience: "provider"`；他方私密检查失败出现 `owner: "other"` 的 `private.constraint_unmet`（或查看者已获全部输入披露时的精确码），通过时省略；`text` 由服务端渲染，DTO 无开放 `params` | vitest |
| 派生 | 槽位：同一提案跨 cv 重批 → `stale_approve` → `approved`；新提案出现时旧提案上的决定**不**影响新槽位（review r03）；`withdraw` → `withdrawn`；`completesSet` 真值表；`todos` 与收件箱 `section` | vitest，调用 08 的 `evaluateApprovalSet` |
| 隐私金丝雀 | fixture 上限设奇数美分金丝雀（例 481,237）、已承诺 400,013；以 provider 身份订阅 `rooms.view`、`rooms.listMine`、`proposals.get`、`executions.forRoom`、`timeline.page`、`turns.mine`，并收集所有服务端渲染字符串、`ConvexError.data`：不得出现金丝雀值、其格式化串、已承诺 + 提案金额之和；customer 在 `committedCents` 开关关闭时同样扫描 | convex-test + E2E 抓 WebSocket 帧（spikes §8 #11） |
| 竞态 | 读 view 得 cv = C → `budget.setCap` → 用 C 调 `approvals.record` → `approval.stale` 且无审批行 | convex-test |
| 三窗口翻转 | Playwright 三个浏览器上下文（三个 Clerk 测试用户）；finance 改 $4,800；5 秒内无刷新出现 "No longer current"，customer / provider 槽位 "No longer applies"，provider DOM 不含 "$4,900"、"$4,800"、"$100" | E2E（dev 部署；Clerk 测试登录方式待验证） |
| 双击 | 快速双击 Approve → 一条审批；最后一票双击 → 一条 `executions` | E2E + 真实部署（convex-test 不模拟并发） |
| 对话框翻转 | 打开批准对话框后另一窗口改上限 → 确认按钮 `aria-disabled` + 提示 | E2E |
| 认证门控 | Clerk 未就绪期间不出现 `NotAvailable` 闪烁 | 组件测试 |
| 错误边界 | `rooms.view` 抛错被 `app/(app)/rooms/error.tsx` 捕获，`retry()` 恢复 | 组件 / E2E |
| 日期 | `TZ=America/Los_Angeles` 下 `2026-11-20` 显示 Nov 20 | vitest |
| 可访问性 | axe 扫描；禁用按钮可 Tab 聚焦并读出原因 | E2E |
| 标注 | seeded 房间所有提案、目录行、变更单显示 Simulated | 组件测试 |
| 读集 | `rooms.listMine` 一页 50 个房间时，非 `setup` 房间每房 ≤ 7、`setup` 房间每房 ≤ 10 次点查（`getTransactionMetrics`）；第 51 个房间出现在下一页 | convex-test |

## 13.17 反例与边界

| # | 反例 | 错误做法 | 本设计 |
| --- | --- | --- | --- |
| E1 | provider 反推已承诺额 | provider 窗口显示 "$4,900 total, blocked" | provider 视图无预算组件、无合计；检查只有 fit |
| E2 | 客户端过滤 | `useQuery(api.rooms.full)` 后按角色隐藏 | 不存在全量 query；FE-D16 |
| E3 | Server Component 传 props | page.tsx 里 `fetchQuery` 整个房间传给客户端 | 壳不取房间数据（FE-D01） |
| E4 | 竞态批准 | 降预算同一刻点批准被记成对新版本的批准 | `expected*` → `approval.stale` |
| E5 | 代理建议被当成批准 | 面板显示 "Approved by Customer (agent)" | 面板输入类型无代理字段 |
| E6 | 旧审批消失 | 约束变更后清空审批列表 | `stale_*` + 结果页完整 DecisionRecord |
| E7 | 日期偏一天 | `new Date("2026-11-20")` | 字符串拆分 |
| E8 | $800 边界 | 前端自算 `cap - committed - price < 0` | 前端不算可执行性 |
| E9 | 离线点击 | 离线时点批准、重连后在新约束下提交 | `approval.stale` 兜底；断线横幅只是提示 |
| E10 | 双击 | 两条决定或两次执行 | 进行中禁用 + `unchanged` + `exec:<proposalId>` |
| E11 | 选项泄露 | 所有人看到 "Raise the cap to $4,800" | 非目标人只收到 `mine: false` 的 `waitingOnRole` 或 `run_waiting` |
| E12 | 错误消息泄露 | customer 收到 "Cap $4,800 is below total $4,900" | 错误只带 code + 投影后 params |
| E13 | 房间存在性探测 | 非成员得到 "Forbidden" | 一律 null → NotAvailable |
| E14 | 半配置 | 缺 key 时全站 500 或放行 | `/setup` 独立根布局；Convex 侧 fail-closed |
| E15 | 无限列表 | 工作台 query 返回全部事件 | `timeline.page` 分页且不在 `rooms.view` |
| E16 | 一人两角色 | 两个 tab 以两个角色批准 | 前端无角色切换；后端一人一房一席 + `userId` 两两不同 |
| E17 | 账号切换残留 | 切换账号后旧角色数据残留 | 不启用多会话；`sessionId` 变化时卸载 `RoomViewProvider` |
| E18 | 模拟数据被当真 | 种子提案无标识 | `provenance` 贯穿 + `SimulatedBadge` |
| E19 | 预览预言机 | 任何角色反复调 `previewChange` 二分他方私密值 | 非 finance 只得 `recheck`；前端只用已有数据（FE-D11） |
| E20 | params 默认放行 | `v.record` params 透传新规则的私密参数 | 无 params 记录；服务端按受众渲染 `text`（FE-D03） |
| E21 | 新提案显示 stale | 槽位取"任意提案的最新决定" | 只看当前提案，`evaluateApprovalSet` |
| E22 | 命名冲突 | `isExecutable` 兼指"检查通过"导致永远不出 `decide_proposal` | `passesChecks` / `allApproved` 分开 |
| E23 | NotAvailable 闪烁 | Clerk 未就绪时 query 以未认证执行返回 null | `skip` 直到 `isAuthenticated` |
| E24 | 错误边界失效 | `[roomId]/error.tsx` 接不住同段 layout 的错误 | 边界放 `rooms/error.tsx`，`retry()` |
| E25 | 收件箱读集爆炸 | 每房间跑一遍 `rooms.view` | `listMine` 每房 ≤ 7（`setup` ≤ 10）次点查，按成员行分页 |
| E26 | 事后披露泄露历史值 | 永久链接按**当前**披露渲染旧检查参数 | 历史提案不实时重算、不带检查（`proposals.get`） |
| E27 | 失败 lane 泄露等谁 | provider 从 "Customer's agent failed" 推出请求收件人 | 由**视图模型**决定（FE-D16）：12 §12.17 对他方回合只给 `scheduled \| running \| done`、`attemptStatus` 为 null，`turn_failed` 对他方渲染为 "finished"（privacy-06）；组件层不做任何折叠 |

## 本章不变量

- I-FE-1 Server Component 不向客户端组件传递任何从 Convex 取得的房间数据。
- I-FE-2 `passesChecks`、`allApproved`、槽位状态、待办、预算结论只由 `rooms.view` 计算；其他 query 只带 `constraintsVersion` 标记。
- I-FE-3 公开 query 的 handler 只返回投影函数构造的新对象。
- I-FE-4 provider 的任何视图模型中不存在 cap、committed、totalAfter、headroom、overBy，也不存在能与已知报价相减得到已承诺额的数值。
- I-FE-5 待办为空时界面写明在等谁（provider 在 `needs_input` 时只写 "others"）。
- I-FE-6 前端提交的 `expected*` 只取自同一个 `rooms.view` 结果。
- I-FE-7 组件不以 `viewer.role` 决定是否显示数据字段。
- I-FE-8 审批面板组件的输入类型中不存在任何来自代理回合的字段。
- I-FE-9 任何选项、按钮或对话框都不会调用 `rooms.close` 以外的路径关闭房间，且 `rooms.close` 只对 creator 渲染。
- I-FE-10 产品路由中不存在 reset / seed / "Preview as" / 重发执行。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 以 timeline 为首页（时间线叙事原型） | 回答"怎么走到这里"而不是"现在该我做什么"；保留为右栏与时间线页 |
| 按角色分路由（`/rooms/[id]/finance`） | 同一 URL 便于协作引用；角色差异由视图模型驱动 |
| 前端自写槽位派生 | 与 08 定义漂移（review r03） |
| `preloadQuery` 首屏预取 | 多一条 token 路径；私密性无差别 |
| Conform / Server Actions / Mantine / 文本 diff 库 | 见 techstack frontend-ui §5 |
| 取舍卡给代理写自由文本 | 新的注入与泄露通道 |

## 开放问题

1. （已关闭）"转交给另一位参与者"出口：canon D15 已新增 `pass_to_next { toRole }`（C54），取舍卡渲染服务端提供的该选项（§13.6 第 3 条），前端不自行推断。
2. 12 已裁定历史提案不带检查（`proposals.get`）；若产品将来要在永久链接展示"当时为何被挡"，需 07 先定义快照的披露规则。
3. `rooms.listMine` 读集在用户房间数很多时是否需要 03 认可的按成员待办计数。
4. `/setup` 不包 ClerkProvider，"后端是否接受 token"的诊断只能在 `(app)` 布局横幅里做；是否需要单独的已登录诊断页。
5. `use-intl` 与 `next-intl` 的 spike 结论（techstack O6）；shadcn Base UI `Button` 是否透传 `focusableWhenDisabled`（O9）。
6. Clerk 多测试用户的 Playwright 登录方式与断线 E2E 的可靠关闭连接方式（待验证）。

## 与 canon 的对照

本章只使用 canon 规范名；D19 的首页、三栏、决策页模板、按钮文案、不做乐观更新、`skip` 门控、运维不进产品路由，以及 D11 / D12 / D13 / D16 的投影与错误纪律，都按 canon 原文落在 §13.1–§13.12（每处已标 Dnn），不再逐条复列。下表只列细化、偏离与 part7 must_absorb 的落点。

| canon 条目 | 本章的细化 / 偏离 | 位置 |
| --- | --- | --- |
| D19 错误边界与认证 | 错误边界放 `app/(app)/rooms/error.tsx`（canon 写 `app/rooms/error.tsx`，差别只是路由组）；`auth.protect()` 由 `proxy.ts` 对 `/rooms(.*)` 执行、`(app)` 布局兜底；唯一 Route Handler `/api/health` 自己返回 401 | FE-D13、FE-D14、§13.2 |
| D19 / D02 命名 | 只用 `passesChecks` 与 `allApproved` 两个词，不用 `isExecutable` 指代"检查通过"（`isExecutable` 由 canon §1.3 定义为当前性 ∧ `passesChecks`，C44） | §13.9.2；18 N-22（已解决） |
| D12 ① | 历史提案不实时重算、不带检查；provider 视图把 `stale` 显示为 `superseded` | §13.5、§13.9.2；18 N-07 |
| D12 ② | `previewChange` 形状以 12 §12.17 为准：非 finance 只得 `recheck`，finance 的 `after` 只含当前提案的预算检查 | §13.8.1、§13.10 B |
| D14 | `timeline.page` 单索引单次 `paginate`、不带筛选参数；筛选 chips 只在已加载页上客户端过滤 | §13.10 E |
| D15 | "转交给另一位参与者" = canon D15 的 `pass_to_next`，取舍卡只渲染服务端提供的选项 | §13.6；18 N-01（已解决） |
| D04 | `executed` 房间没有归档路径，收件箱用纯客户端的 "Hide executed rooms" 筛选 | §13.3 |
| 对 12 返回形状的增量 | Δ1–Δ6（`completesSet` / `canWithdraw`、finance 预算派生字段、`proposalHistory.proposalId`、`listMine.waitingOn` / `notice`、`actorKind`、`staleDiscarded`），每项写明未并入时的退路 | §13.8.3；18 N-23 |
| part7 13-frontend must_absorb | 收件箱四分区（§13.3）；三栏 + 常驻徽章（§13.4）；决策页模板与版本绑定按钮（§13.5）；取舍卡只对目标人并有出口（§13.6）；影响预览只用已有数据（FE-D11）；`passesChecks` / `allApproved` 分开（§13.9）；`evaluateApprovalSet`（§13.5）；withdraw（§13.10 A）；Clerk 未就绪 `skip`（FE-D13）；错误边界 + `retry()`（§13.12）；`SimulatedBadge`（§13.14）；`ConvexError.data` 只含 reasonCode（§13.12）；时间线 chips 与 "Private to you"（§13.10 E）；`Intl.NumberFormat`、日期拆分（§13.14） | — |
