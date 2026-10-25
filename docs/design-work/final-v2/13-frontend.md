# 13 · 前端信息架构（part1）：决定、路由与布局、决策收件箱

> 分片：`13-frontend.md`（本文件：目标、§13.1 决定总表、§13.2 路由与布局、§13.3 决策收件箱 `/rooms`）→ `13-frontend-part2.md`（§13.4 房间页三栏、§13.5 决策页模板、§13.6 取舍页、§13.7 角色差异矩阵）→ `13-frontend-part3.md`（§13.8 视图模型：采用 12 的返回形状、组件 ← 字段映射、13 对 12 的增量需求 Δ1–Δ6）→ `13-frontend-part4.md`（§13.9 派生规则：前端类型、服务端派生量、前端允许的展示派生）→ `13-frontend-part5.md`（§13.10 交互流程：审批 / 撤回 / 约束变更 / 简报 / 结果 / 时间线、§13.11 实时策略与 $4,800 三窗口翻转、§13.12 加载 / 错误 / 空状态）→ `13-frontend-part6.md`（§13.13 可访问性与响应式、§13.14 诚实标注与格式化、§13.15 UI 技术选型、§13.16 测试、§13.17 反例与边界、不变量、备选与否决、开放问题、与 canon 的对照）。
> 底稿：`candidates/product/13-frontend*.md`（页面地图、房间外壳、实时策略）+ `deepdives/frontend-ia*.md` 与 `frontend-ia/*.ts`（视图模型、D-FE-01…12）；按 `frontend-ia-review*.md` r01–r13 全部修正；吸收 `ui-prototypes/CRITIQUES.md` 四段"最终设计应吸收"与 `techstack/frontend-ui*.md`（D24–D27）。命名以 canon 为准：底稿的 `STALE_VIEW` → `approval.stale`，`isExecutable`（"检查通过"义）→ `passesChecks`，`stale_approved` → `stale_approve`，`decide` → `approvals.record`，`events.timeline` → `timeline.page`。

## 目标

1. **浏览器只收已投影的数据**：每个字节都来自按查看者裁剪的 Convex query；前端没有"取回再隐藏"的代码路径，组件也不按 `viewer.role` 决定是否显示某个数据字段（核心 1）。
2. **第一眼回答"现在该我做什么"**：默认首页是跨房间决策收件箱；房间与决策页都把阻断原因与下一步放在首屏。
3. **版本意识**：任何时刻都看得见 `Proposal vN · Constraints vM`；按钮写明它批准的版本；旧审批"No longer applies"但保留（核心 3、6）。
4. **人与代理不可混淆**：代理建议只给本方、只在虚线框里；审批面板的输入类型里没有任何代理字段（核心 2）。
5. **约束变化即时可见**：预算一提交，三个窗口在同一次推送里翻转，不等模型（F09.3、F13.1）。
6. **诚实**：seeded / stub 数据带 `SimulatedBadge`；没有代理消息就空着；"未达成"按正常结局展示（核心 8）。
7. **可访问**：键盘可达、读屏能听到禁用原因与关键变化、状态不只靠颜色（WCAG 2.2 AA）。

## 13.1 决定总表

| # | 决定 | 理由 | 被否决 | 来源 |
| --- | --- | --- | --- | --- |
| FE-D01 | Server Component 只做壳（布局、静态文案、路由参数）；房间数据全部在客户端岛经 `useQuery` 订阅；v1 不用 `preloadQuery` | 私密性两者相同，预取多一条 token 路径与"模板不匹配"故障面；props 会进 RSC payload | Server Component `fetchQuery` 静态快照（失去翻转）；预取 + 续订（留作优化） | D-FE-01 |
| FE-D02 | 一个聚合 query `rooms.view` 承载全部"随约束版本变化"的判断（阶段、待办、当前提案、检查、审批槽位、预算视图、run 进度、请求、最近约束变更）；无界列表（`timeline.page`、本方代理笔记）独立分页且不含可执行性判断 | 单 query 是一次一致读快照，同窗口不会出现"提案已阻断但审批仍有效"；跨 query 原子推送只是源码事实、非正式保证 | 每面板一个 query（版本偏斜）；整房一个 query 含事件（每个回合都重算整页） | D-FE-02；review C1 |
| FE-D03 | 视图模型由显式构造的新对象返回（禁止 `return doc` / `...doc`），角色敏感部分用判别联合；检查结果不用 `v.record` params，而是服务端按受众渲染好的文案 + reasonCode；`returns` validator 只作测试期探测器 | review r02：`projectCheckParams` 默认放行 + `v.record` 让 validator 失效；privacy r10：返回值校验失败的消息可能回显被拦字段 | 大对象 + `v.optional` 金额字段；"returns 是运行时防线" | D11/D16；review r02/r08 |
| FE-D04 | 阶段 `phase`、待办 `todos`、收件箱分区由服务端按查看者计算；前端只排序、生成链接与文案；`rooms.listMine` 只返回廉价字段 | 待办依赖他方状态与 cv；读集有界（review r13） | 浏览器用全量状态现算（RA-D16） | D-FE-04 |
| FE-D05 | 审批携带 `expectedConstraintsVersion` / `expectedTermsKey`，取自同一个 `rooms.view` 结果；不符 → `approval.stale`，什么都不写 | 订阅推送与点击之间有竞态 | 只靠服务端读当前版本（无法区分用户看到的版本） | D02；D-FE-05 |
| FE-D06 | 不做乐观更新；关键按钮在调用期间 pending 并防连点；断线禁用只是提示，正确性只靠 `expected*` 与服务端幂等 | 断线最长约 60s 才被察觉（review r06）；`await mutation` 返回时订阅已反映该写入 | `withOptimisticUpdate`（短暂显示"已批准"） | D-FE-06；review r06 |
| FE-D07 | 默认首页 `/rooms` = 决策收件箱四分区：Needs you / Agents working / Waiting on others / Done & no longer needed | 先回答"该我做什么"；四原型评审最高分骨架 | 以 timeline 为首页；房间列表 | D19；CRITIQUES |
| FE-D08 | 房间页三栏：左"我知道的"、中"我们要决定的"、右"刚刚发生了什么"；头部常驻 `Proposal vN · Constraints vM · Viewing as X` | 三栏信息架构清楚；版本徽章是核心 3 的常驻提示 | 按角色分路由；单列工作台 | D19；CRITIQUES workbench |
| FE-D09 | 决策页统一模板：问题标题 + "these exact terms under constraints vN" + 差异 + 按角色裁剪的确定性检查 + 虚线 agent-box + 实线 human-box；按钮文案绑定版本 | 每个决定都在同一结构里看到证据 | 各页自写 | D19；CRITIQUES decisions |
| FE-D10 | 取舍请求只对 `toRole` 显示问题与选项，他人只见"在等谁"（provider 只见 "Waiting on others"）；选项来自服务端（目标人自身视图计算），每项带检查与后果，并有不改约束的出口（`end_run`；按 kind 另有 `keep_as_is`，`infeasible` / `agent_failed` 没有它，D15） | 选项可能含目标人私密数字；原型缺"都不要"出口 | 全员可见选项（HR-2 泄露） | D11/D12 ⑦/D15；D-FE-08 |
| FE-D11 | 约束变更前的影响预览只用 `rooms.view` 已有数据（下一个 cv、将失效的审批、当前提案将被重新检查）；"改后是否可行" `verdictAfter` 只对能看到全部规则输入的发起人（首个场景只有 finance 改上限）由 `rooms.previewChange` 返回 | review r01：预览 query 是无痕预言机 | 所有角色调用 `previewChange` 求值 | D12 ② |
| FE-D12 | `passesChecks`（当前约束下全部检查通过）与 `allApproved`（必需审批齐全）分开命名；审批槽位直接使用 08 的 `evaluateApprovalSet` 结果（按提案、按当前成员），提供 "Withdraw my approval" | review r03/r04：自带槽位派生会把新提案显示为 stale；`isExecutable` 按 canon §1.3（C44）是"当前性 ∧ `passesChecks`"、不含审批集合，界面不需要也不使用这个词，只用 `passesChecks` 与 `allApproved` | 前端自写 `deriveSlotState` | D02/D19 |
| FE-D13 | 房间 query 在 `useConvexAuth().isAuthenticated` 为真前传 `"skip"`；`null` 只在已认证后解释为"非成员或不存在"；错误边界放 `app/(app)/rooms/error.tsx`（`[roomId]/layout.tsx` 之上），"Try again" 用 `retry()` | review r05：Clerk 未就绪时闪现 NotAvailable；r09：`error.js` 不包裹同段 layout，16.3 起推荐 `retry()` | `reset()`；每段 error.tsx | D19；review r05/r09 |
| FE-D14 | 运维功能不进产品路由；`/setup` 在独立根布局（不包 ClerkProvider）；`auth.protect()` 由 `proxy.ts` 对 `/rooms(.*)` 执行（11 §11.10 的 proxy 写法），`(app)/layout.tsx` 再调一次只作客户端导航兜底；邀请页与 `/setup` 豁免；唯一的 Route Handler `/api/health` 自己 `auth()` 并返回 401 | 缺 key 时 Clerk 直接抛错；fail-closed | "Preview as"、reset 卡、重发执行按钮 | D19；techstack D23；RA-U12/13/14 |
| FE-D15 | 金额只以整数分进入视图模型，前端 `Intl.NumberFormat`（`src/lib/format.ts`）格式化；`IsoDate` 字符串按 `-` 拆分显示，禁止 `new Date("YYYY-MM-DD")` | 偏一天会改变"是否晚于截止日"的判断；引擎禁 `Intl` | 浮点金额；Date 解析 | D-FE-12；techstack D36 |
| FE-D16 | 组件可用 `viewer.role` 决定**措辞与入口**，不能决定**是否显示某个数据字段**；数据是否存在完全由视图模型决定 | 让"provider 收到金额"在类型层不可表达 | 客户端按角色隐藏 | I-FE-7 |

## 13.2 路由与布局（`src/app/`）

| 路由 | 组 / 布局 | 壳内容 | 客户端订阅（12） | 谁能进 |
| --- | --- | --- | --- | --- |
| `/` | `(public)` | 产品三步："Set your boundaries / Compare proposals / Approve the outcome" | 无（已登录则跳 `/rooms`） | 所有人 |
| `/sign-in/[[...sign-in]]`、`/sign-up/[[...sign-up]]` | `(public)` | Clerk 组件 | 无 | 所有人 |
| `/invite` | `(public)`，不调 `auth.protect()`，`Referrer-Policy: no-referrer` | 读 `location.hash` 中的 `t`，登录后接受 | `invites.accept({ invite: { by: "link", token } })` | 持链接者 |
| `/setup` | `(setup)` 独立根布局，**不包** ClerkProvider | 缺失变量名清单、publishable key 解码出的 Frontend API 主机名；不显示任何密钥值 | 无 | 所有人 |
| `/rooms` | `(app)`；`proxy.ts` 对 `/rooms(.*)` 执行 `auth.protect()`，`(app)/layout.tsx` 再调一次只作客户端导航兜底（FE-D14）；`users.viewer` 未建档时先 `users.ensureViewer` | 决策收件箱 | `rooms.listMine`、`invites.listMine`；接受邀请 `invites.accept({ invite: { by: "email", inviteId } })` | 登录 |
| `/rooms/new` | `(app)` | 建房表单（标题、场景、时区、我的角色；无预算） | `rooms.create` | 登录 |
| `/rooms/[roomId]` | `(app)/rooms/[roomId]/layout.tsx`（`RoomViewProvider` + 头部） | 房间页三栏（默认） | `rooms.view`、`timeline.page`（前 20 条） | 成员 |
| `/rooms/[roomId]/proposals/[proposalId]` | 同上 | 决策页（当前提案）/ 永久链接（历史提案只显示条款、存储状态与决定记录） | `rooms.view`；历史提案另用 `proposals.get` | 成员 |
| `/rooms/[roomId]/requests/[requestId]` | 同上 | 取舍页（open 请求可作答；已关闭请求只读显示关闭原因与回答摘要） | `humanRequests.get({ requestId })`（按 URL 中的 id 取，不用当前 `openRequest` 代替）；约束影响预览另读 `rooms.view` | 成员（选项只给 `toRole`） |
| `/rooms/[roomId]/brief` | 同上 | 我的简报；provider 目录编辑；finance 上限 / 基线 / 披露开关 | `briefs.mine`、`catalog.list` | 本人 |
| `/rooms/[roomId]/results` | 同上 | 执行结果、未达成说明、"为什么是这个结果"因果链、后续变更 | `executions.forRoom`、`timeline.page` | 成员（按投影） |
| `/rooms/[roomId]/timeline` | 同上 | 完整时间线与筛选 chips | `timeline.page` | 成员 |
| `/rooms/[roomId]/people` | 同上 | 成员与加入状态；creator 的邀请管理（`invites.create`、`invites.createLink`） | `rooms.view.members` / `seats` | 成员；邀请操作仅 creator |

- `rooms.view` 返回 `null`（未认证 / 非成员 / 不存在三者不可区分）→ `NotAvailable`："This room isn't available to you. If you were invited, open the invitation from your inbox."，不提示房间是否存在。
- 没有 `/admin`、reset、seed、"Preview as"、"Check confirmed options"、重发执行按钮（RA-U12–U15）。唯一的 Next Route Handler 是 `/api/health`（FE-D14）：它自己调 `auth()`，无会话时返回 401 JSON（spike：`auth.protect()` 对 API 也是 307，不能依赖它）；将来新增的 Route Handler 同此规则。
- 已登录但 Convex 未接受 token（`clerk.isSignedIn && !convexAuth.isLoading && !convexAuth.isAuthenticated`）时，`(app)` 布局显示 "Signed in, but the backend did not accept your session. See /setup."（`ConvexProviderWithClerk` 会吞掉 token 错误）。
- 除 canon §1.6 外，前端使用 12 补充定义的 `users.viewer` / `users.ensureViewer`、`catalog.list`、`proposals.get`、`turns.mine`、`executions.forRoom`、`tasks.markDone`、`invites.createLink`（唯一公开 action）；对返回形状的增量需求见 part3 §13.8.3。

## 13.3 决策收件箱 `/rooms`

四分区（CRITIQUES decisions 第 1 条），每张卡来自 `rooms.listMine` 的返回项（12 §12.17，增量见 part3 Δ4）：

| 分区 | 进入条件（服务端判定） | 卡片内容 | CTA |
| --- | --- | --- | --- |
| **Needs you** | 查看者有待办：open 请求 `toRole = me`；`awaiting_approval` 且我的槽位不是有效 approve 且 `passesChecks`；setup 缺我的输入；待接受邀请；provider 有未完成任务 | 类型色条（Approve / Choose / Confirm / Needs attention，色 + 图标 + 文字）、带版本号的 CTA、一句 blocks 说明（"Execution waits for all three approvals."） | "Review v3"、"Answer request"、"Confirm brief"、"Accept invitation" |
| **Agents working** | phase `negotiating` 且我无待办 | "Round 2 · Finance's agent reviewing" | 打开房间 |
| **Waiting on others** | 他人有待办、我没有 | 只写"谁在做什么"，不写内容："Waiting on Finance: approval of v3"；对 provider 的 `needs_input` 只写 "Waiting on others" | 打开房间 |
| **Done & no longer needed** | phase `executed`（且我无未完成任务）/ `stopped`（未达成或被取消）/ `closed`；以及失效通知（Δ4）。`executed` 房间没有归档路径（`executed` 与 `closed` 都是终态，04 M6；canon D18 的 `rooms.close` 只清理 `setup` / `open` 房间），所以本区提供 "Hide executed rooms" 筛选（`localStorage`，纯客户端）而不是任何写入 | "Executed · CO-1"、"No agreement · ended 11-09"、"You approved v1 under constraints v1 · No longer applies"、"Approval request for v2 withdrawn" | 打开结果页 |

- 排序：Needs you 按 `priority`（请求 > 审批 > 简报 > 任务）再按时间；其余按 `updatedAt`。卡片不含任何金额（Role A 的 "$X of $Y committed" 移除）。
- seeded / stub 房间卡带 `SimulatedBadge`。
- 读集有界（review r13）：每个房间读 room、当前 run、当前 run 的 open 请求、当前提案、我在当前提案上的最新审批行、我的最新简报版本，`setup` 房间另跑与 `rooms.view` 相同的 `roomReadiness`，`executed` 房间另读我的 open 任务——非 `setup` 约 7 次、`setup` 约 10 次索引点查（12 §12.17）；`rooms.listMine` 按成员行分页（每页 ≤ 50 个房间，`usePaginatedQuery`），四分区只对已加载的页分组，未加载完时显示 "Load more" 并提示可能还有更多房间。若实测仍重，再由 03 认可的按成员待办计数接替（开放问题）。
