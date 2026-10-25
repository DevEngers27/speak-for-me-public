# 专题深潜：前端信息架构与视图模型（part 6：反例与边界、测试、接口、待验证）

> 接 frontend-ia-part5.md。

## 4. 反例与边界

| # | 反例 / 边界 | 错误做法 | 本设计的处理 |
| --- | --- | --- | --- |
| E1 | provider 反推已承诺额 | provider 窗口显示"$4,900 total, blocked" | provider 视图模型无 totalAfter / cap / shortfall 字段；budget 检查只给 reasonCode（I-FE-4） |
| E2 | 客户端过滤 | `useQuery(api.rooms.full)` 后 `if (role !== "finance") hide(cap)` | 不存在全量 query；组件不按 role 决定是否显示数据（I-FE-7） |
| E3 | Server Component 传 props | 在 page.tsx 里 `fetchQuery` 整个房间传给客户端组件 | 壳不取房间数据（I-FE-1） |
| E4 | 竞态批准 | 降预算的同一刻 customer 点批准，被记成对新约束版本的批准 | `expectedConstraintsVersion` → `STALE_VIEW`（D-FE-05） |
| E5 | 代理建议被当成批准 | 审批面板把 recommend_accept 显示为"Approved by Customer (agent)" | 面板输入类型不含代理字段（I-FE-8） |
| E6 | 旧审批消失 | 约束变更后清空审批列表 | 槽位显示 stale_* 与原因；Results 保留完整历史 |
| E7 | 日期偏一天 | `new Date("2026-11-20").toLocaleDateString()` 在 PST 显示 Nov 19 | 字符串拆分格式化（D-FE-12） |
| E8 | $800 边界 | 浮点比较或前端自算 `cap - committed - price < 0` | 前端不算可执行性；金额整数美分；服务端 `≤` 判定（14） |
| E9 | 离线点击 | 离线时点批准，重连后在新约束下提交 | 断线时 aria-disabled；服务端 STALE_VIEW 兜底 |
| E10 | 双击 | 连点两次产生两条决定或两次执行 | 进行中禁用；服务端幂等（08） |
| E11 | 选项泄露 | 所有人都能看到 finance 的选项"Raise budget by $100" | 非目标人只收到 `waiting` 分支 |
| E12 | 错误消息泄露 | customer 收到"Cap $4,800 is below total $4,900" | 错误只带 code；带数字的文案只在可见者的前端渲染 |
| E13 | 房间存在性探测 | 非成员访问返回"Forbidden"，可确认房间存在 | 一律 null → NotAvailable |
| E14 | 半配置 | Clerk key 格式错误导致全站 500，或缺 key 时放行 | `BackendNotConfigured`、/setup 诊断；Convex 侧 fail-closed（F11.3） |
| E15 | 无限列表 | 工作台 query 返回全部事件，房间越久越慢 | 事件与 transcript 分页且不在 rooms.view 中 |
| E16 | 同一用户两个角色 | 一人用两个 tab 以两个角色批准 | 前端无角色切换；每个 view 只有一个 viewer.role；后端要求不同 userId（F08.2） |
| E17 | 多会话切换 | Clerk 切换账号后旧角色数据残留 | 不启用多会话；若启用，`sessionId` 变化时卸载 RoomViewProvider（04 §3.4） |
| E18 | 模拟数据被当真 | 种子提案没有标识 | `isSimulated` 贯穿提案、来源、回合、记录 |

## 5. 测试

| 层 | 测试 | 方法 |
| --- | --- | --- |
| 投影纯函数 | `projectBudget` 对 provider 永远返回 `{ visibility: "verdict" }`；对 customer / finance 返回正确的 headroom / shortfall；$800 恰好等于余量时 status = within | vitest，表驱动 |
| 投影纯函数 | `deriveSlotState`：当前版本 approve → approved；旧约束版本 → stale_approved + constraints_changed；旧提案 → newer_proposal；无决定 → pending | vitest |
| 投影纯函数 | `deriveTodos`：customer 审批失效时出现 redecide_proposal；目标人有 answer_request；无事可做时为空 | vitest |
| 隐私金丝雀 | 用 fixture 把 cap 设为金丝雀值（如 `481_337` 美分）、committed 设为 `400_013`；对 provider 调 rooms.view / results.view / proposals.detail / events.timeline / runs.transcript，`JSON.stringify` 结果中不得出现这两个值、它们的格式化串，以及 committed + proposal 的和 | convex-test + `withIdentity`（API 名称待验证 §7 #6） |
| returns 严格性 | 故意让投影多返回一个字段，断言 query 抛校验错误 | convex-test（依赖 §7 #2） |
| 竞态 | 先读 view 得到 cv=1，再 updateBudget，再用 cv=1 调 decide，断言 `STALE_VIEW` 且无审批写入 | convex-test |
| 三窗口翻转 | Playwright 三个浏览器上下文（三个 Clerk 测试用户）打开同一工作台；finance 降预算；断言三个窗口在 5 秒内（无刷新）出现 Blocked，customer 槽位 "No longer applies"，provider 页面文本不含 "$4,900"、"$4,800"、"$100" | e2e，针对 dev 部署；Clerk 测试登录方式待验证 §7 #7 |
| 双击 | Playwright 快速双击"Accept terms"，查询审批只一条；最后一票双击后 changeOrders 只一条 | e2e + 真实部署（convex-test 不模拟并发，04 §1.12） |
| 对话框翻转 | 打开批准对话框后另一窗口降预算，断言确认按钮 aria-disabled 且出现提示 | e2e |
| 断线 | 模拟离线（Playwright `context.setOffline(true)`），断言 ConnectionBanner 出现、关键按钮 aria-disabled | e2e |
| 日期 | 在 `TZ=America/Los_Angeles` 下渲染 `2026-11-20` 显示为 Nov 20 | vitest |
| 可访问性 | axe 扫描三个角色的工作台、简报页、结果页无 serious / critical；禁用按钮可被 Tab 聚焦并读出原因 | e2e + @axe-core/playwright |
| 空状态 | 新房间（无简报）、无提案、无事件、无执行四种快照 | 组件测试 |
| 模拟标识 | 种子房间所有提案卡与来源显示 Simulated | 组件测试 |

## 6. 与其他专题的接口（任务书第 5 节文件编号）

| 文件 | 本专题需要它提供 | 本专题提供给它 |
| --- | --- | --- |
| 02-domain-model | 实体名与"每个房间每个角色一位成员"的假设 | 视图模型清单作为读模型需求 |
| 03-schema | 表与字段名：rooms、members、privateBriefs、offers、proposals、approvals（kind、decision、constraintsVersion）、budgets、budgetChanges、commitments、changeOrders、tasks、events、runs、agentTurns、humanRequests；`isSimulated` 字段；读模型所需索引（by_roomId_and_version、by_proposalId_and_userId、by_roomId_and_status 等） | `lastConstraintChange` 需要的数据来源（constraintChanges 表或 events 的结构化 payload） |
| 04-state-machines | run 状态值、请求状态值、提案状态；`derivePhase` 的输入 | `roomPhaseV`（UI 派生阶段，不存储） |
| 05-protocol | transcript 公共文本模板、动作枚举、人工请求的问题 / 选项结构（optionKey、mode、changesConstraints、editTarget） | `requestOptionV` 的字段需求；"不给代理写自由文本"的 v1 决定 |
| 06-rules-engine | reasonCode 全集、check 结果结构、`validateProposal` 纯函数（rooms.view 与 previewChange 共用） | `checkResultV`；按受众投影 check params 的要求 |
| 07-permissions-privacy | 字段 × 角色披露矩阵的最终裁决（尤其预算数字是否对 customer 可见）、事件可见性 | `budgetViewV` 判别联合、I-FE-3 / 4 / 7、金丝雀测试 |
| 08-approval-execution | 审批 kind、`decide` 的幂等返回、记录派生（RecordsPreview 用同一派生函数） | `decide({ proposalId, decision, expectedConstraintsVersion, reasonKey? })` 签名需求；五态槽位定义 |
| 09-constraint-changes | 递增点列表、`budgets.update` 事务、请求取消规则 | `constraints.previewChange` 需求；所有约束改动 mutation 接受 `expectedConstraintsVersion` |
| 10-agent-runtime | run 字段（round、activeRole、turnsCompleted、maxTurns、staleTurnsDiscarded）、谁能 retry、stub 标识 | `runStatusV`；回合不播报的决定 |
| 11-architecture | `app/` 目录、`components/` 与 `convex/` 的依赖方向；view-model validator 所在模块（建议 `convex/views/`，前端从 `_generated/api` 推类型） | 页面壳 / 客户端岛划分 |
| 12-api | 函数目录 | §3.4 query 清单与 §3.7 错误码表 |
| 13-frontend | — | 本文即其草稿 |
| 14-scenario-scope-change | 目录 label、货币、fixture 数字（$5,000 / $4,000 / $900 / $4,800）、受众文案模板 | 预算下调走查在三窗口中的呈现（§3.6） |
| 15-operations | /setup 诊断项、seed / reset CLI | 不在产品界面的运维功能清单 |
| 16-testing | 测试基础设施（convex-test、Playwright、Clerk 测试用户） | §5 测试清单 |
| 18-decisions | — | D-FE-01 至 D-FE-12 可作为 ADR 候选 |

## 7. 待验证清单

| # | 事项 | 影响 | 验证方式 |
| --- | --- | --- | --- |
| 1 | Convex 客户端对同一服务端时刻的多个 query 更新是否原子地一起应用（源码可见服务端以单条 `Transition` 消息下发、客户端一次 `remoteQuerySet.transition`，`convex/src/browser/sync/client.ts:467-471`；是否为正式保证不确定） | D-FE-02 的强度（本设计不依赖它） | 读文档 / 实验：两 query 同时变化时记录渲染次数 |
| 2 | `returns` validator 是否拒绝返回值中的多余字段（object validator 对未知字段的行为） | D-FE-03 的运行时防线 | convex-test 或 dev 部署实验 |
| 3 | 同一客户端多个相同参数的 `useQuery` 是否共享一个订阅 | 订阅数量 | 读 `convex/react` 源码 |
| 4 | `useConvexConnectionState()` 字段（convex 1.48 类型中存在 `isWebSocketConnected`、`hasEverConnected`、`hasInflightRequests` 等，`browser/sync/client.d.ts:116-136`）在断线时的更新时机 | ConnectionBanner | 实验 |
| 5 | query 中使用 `Date.now()` 的行为与缓存影响 | 到期显示只在客户端计算 | 读 Convex 文档 |
| 6 | convex-test 的身份模拟 API 名称（`withIdentity`） | 金丝雀测试 | 安装后读类型（04 待验证 #14） |
| 7 | Clerk 在 Playwright 中以多个测试用户登录的推荐方式（如 `@clerk/testing`）与开发实例限制 | 三窗口 e2e | 读 Clerk 文档 |
| 8 | 默认 `useQuery` 出错时抛给错误边界；`useQuery_experimental` 返回 `{status:"error"}`（1.48 类型可见，`react/client.d.ts:346-354`），是否在 v1 采用 | 错误处理风格 | 读类型 / 实验 |
| 9 | `preloadQuery` + Clerk `getToken({ template })` 与原生 Convex 集成两种 token 模式的组合（若后续启用预取） | D-FE-01 的优化 | 实验（04 待验证 #13） |
| 10 | Next 16 `error.tsx` / `global-error.tsx` 约定在 16.4 中是否不变 | 错误边界 | 读 Next 16 文档 |
| 11 | 生产环境下非 ConvexError 的消息被隐藏（F07.8）的确切行为 | 错误文案 | dev / prod 部署对比 |
