# 专题深潜：测试策略与运维（part 6/6）

> §5 反例与边界、§6 测试、§7 与其他专题的接口、§8 待验证清单。

## 5. 反例与边界

| # | 反例 / 边界 | 错误做法会怎样 | 本设计的处理 |
| --- | --- | --- | --- |
| X1 | convex-test 里 `Promise.all([approve, approve])` 得到 1 条执行，就宣称"并发安全" | convex-test 串行执行，结论是伪证 | 用例名带 `[serial]`；并发结论只能引用 L2 `ConcurrencyEvidence`（TD-2、TD-4） |
| X2 | 并行 `npx convex run` 全部成功且只有 1 条执行 | 可能只是 CLI 冷启动把调用错开，从未真正重叠 | 同一探针还要用 `action_promise_all` 方法；记录 `occRetriesObserved`；两法都过才算通过 |
| X3 | 金丝雀扫描只搜文本 `CANARY-FIN-7731` | 预算以数字形式泄露（`$4,817.31`、`481731`）被漏掉 | 数值金丝雀 + 多格式变体（`canaryNeedles`），且数值不与任何合法和相等 |
| X4 | 金丝雀值恰好等于某个合法派生值（例如上限 − 已承诺 = 目录价） | 扫描器在合法位置之外"命中"，误报或被迫放宽 | fixture 自检用例（L0）：金丝雀数值不等于任何目录价、任何子集和、任何上限差 |
| X5 | 扫描整个导出快照，发现 finance 金丝雀在 `privateBriefs` 中 | 那是合法位置，误报 | 白名单 `(table, field, ownerRole)`，与 07 同源 |
| X6 | 用 `vi.mock` 替换了模型，但真实部署的 `runTurn` 在默认运行时打包失败 | L1 全绿，上线即坏 | L2 `runtime_smoke` 在 main 合并后必跑 |
| X7 | 为了 L2 方便给公开 mutation 加 `actorOverride` 参数 | 生产可被任意冒充 | 只在 `devProbe.asIdentity`（internal、层级守卫）中代入身份；公开函数签名不变 |
| X8 | `DEPLOYMENT_TIER` 漏设 | 危险函数在未知层级运行 | `assertTier` 对缺失值一律拒绝（fail closed），`ops.configHealth` 报缺失 |
| X9 | 在 prod 上 `npx convex run seed:purgeSimulatedRooms` | 删除生产数据 | 层级守卫拒绝 + `confirmDeployment` 必须匹配部署名 + prod 根本不在允许列表 |
| X10 | 有活动 run 时部署 | 在途 action 被打断、无回调、房间卡在 running | 排空流程（4.6）+ 看门狗兜底 |
| X11 | E2E 用固定 `waitForTimeout(3000)` | 慢 CI 上偶发失败、快机器上掩盖竞态 | 只按可见状态等待 |
| X12 | L4 断言模型回复文本 | 当前模型不可复现，测试抖动 | 只断言结构性质与分布，漂移由人评审 |
| X13 | 把模型 rationale 写进日志便于调试 | 日志成为私密数据旁路 | `opsLog` 类型上禁止自由文本；调试只看 `agentTurns.output`（按角色可见） |
| X14 | 估算成本存库 | 价格变动后历史成本失真且看似权威 | 只存 token，读取时按带 `asOf` 的价格表估算并标注 |
| X15 | 用部署 URL 判断是否生产 | 换域名或自定义部署名后失效 | 显式 `DEPLOYMENT_TIER` |
| X16 | fork PR 跑需要密钥的 E2E | 密钥泄露风险 | `pr-e2e` 对 fork PR 跳过；`pr` 闸门不需密钥 |
| X17 | 时间相关 fixture 写死绝对日期 | 几周后 `DATE_IN_PAST` 让测试全红 | 相对锚点（fixtures-walkthrough D2），测试注入固定锚点 |
| X18 | 看门狗与迟到的 `completeTurn` 同时到达 | 两者都改回合状态 | 二者都是 mutation，OCC 串行化；后到者看到终态即空操作（L1 串行测两种顺序，L2 `watchdog_real` 测真实竞争） |

## 6. 测试（本专题自身如何被验证）

- `canary-scan.ts`、`ops-log.ts` 的类型约束、`assertTier`、`estimateCostMicros` 本身是纯函数，有 L0 用例（含"故意泄露"的正向用例：扫描器必须报出）。
- **变异检查**（手动，每季度或改动核心守卫时）：临时删除 `completeTurn` 的版本守卫、删除 `decide` 的状态守卫、在某个 query 返回值里加回 `totalCents`，确认对应的 L1 / L2 / 金丝雀用例变红；把结果记进 `probe-results/`。没有变红的用例视为无效。
- CI 自检：`pr` 工作流在无任何密钥的环境下必须通过（证明 TD-1 的不变量）。
- 证据可追溯：每份 L2 / L4 结果带 `gitSha` 与部署名；发布记录引用最近一次通过的 `approve_last_two` 证据。

## 7. 与其他专题的接口（按任务书第 5 节文件编号）

| 目标文件 | 本专题提供 | 本专题要求对方提供 / 遵守 |
| --- | --- | --- |
| 03-schema | — | `rooms.isSimulated`、`rooms.fixtureKey`、`rooms.archivedAt`；`events.requestId`（来自 `ctx.meta.getRequestMetadata()`）与 `commitTs` 字段；`modelCalls` 的 `latencyMs`、token 分项、`outcome`、`mode` |
| 04-state-machines | 表驱动迁移测试 | 导出 `TRANSITIONS` 常量与 `assertTransition`，测试直接遍历 |
| 06-rules-engine | L0 用例清单 | 规则是无 Convex 依赖的纯函数；每个 reasonCode 有常量 |
| 07-permissions-privacy | 金丝雀扫描器、白名单格式 | 披露矩阵以常量导出（`DISCLOSURE_MATRIX`），金丝雀白名单从它派生；`buildAgentContext` 为纯函数 |
| 08-approval-execution | L2 探针 `approve_last_two` / `execute_repeat` | 公开 mutation 是"取身份 → 调 handler"的薄壳，handler 可被 `devProbe.asIdentity` 复用；执行结果返回 `executionId` |
| 09-constraint-changes | CHG 组测试 | 导出 `CONSTRAINT_BUMPERS` 与"非递增写入"清单 |
| 10-agent-runtime | 模型接缝要求、`STUB_DELAY_MS`、排空流程 | `callModel` 单一模块；`AGENT_MODE` 只有 `live | stub`；`activeTurnCount` 可查询；看门狗期限常量可被测试读取；配置自检 |
| 11-architecture | 测试目录布局、Vitest projects | 引擎 / 场景为纯包；`convex/tsconfig.json` 单独类型检查 |
| 12-api | 负面鉴权矩阵的遍历来源 | 导出公开函数清单（含所需角色），AUTH 组遍历它；错误码枚举 |
| 13-frontend | E2E 选择器约定 | 关键控件带稳定的 `data-testid`（提案卡、审批按钮、run 状态、simulated 标注）；审批不做乐观更新 |
| 14-scenario-scope-change | 金丝雀 fixture 变体 `scopeChangeCanary` | fixture 为单一 TS 模块，四个变体与 `expectations` |
| 15-operations | 本文件 part5 全部 | — |
| 16-testing | 本文件 part3、part4、§5、§6 全部 | — |
| 18-decisions | TD-1 至 TD-12 可直接转为 ADR | 开放问题：预览部署 vs 本地部署；staging 同项目还是另建项目 |

## 8. 待验证清单

| # | 事项 | 依赖它的设计 | 验证方式 |
| --- | --- | --- | --- |
| V1 | convex-test 0.0.65 的 API：`convexTest(schema, modules)`、`withIdentity`、`finishInProgressScheduledFunctions` / `finishAllScheduledFunctions`、`import.meta.glob` 用法、要求的 Vitest 环境 | §3.3 | 安装后读类型与 README（inputs/04 待验证 #14） |
| V2 | convex-test 不模拟并发与 OCC | TD-2、TD-4 | 读源码；写一个故意无守卫的计数器用例对比 |
| V3 | `vi.mock` 能否替换 convex-test 所加载模块图中的 `modelClient` | TD-3 | 最小实验；失败则用 `__setModelClientForTests` 退路 |
| V4 | convex-test 中被测函数能否读到 `process.env`（`DEPLOYMENT_TIER`、`AGENT_MODE`） | §3.3 | 最小实验 |
| V5 | convex-test 中能否在 action 执行期间插入另一个 mutation | §3.5 测法 2 | 最小实验 |
| V6 | `npx convex run` 能否调用 internal 函数（admin 权限） | §3.6、§4.3 | 在 dev 部署上试一次 |
| V7 | 同一 action 内多个 `ctx.runMutation` 用 `Promise.all` 时是否真正并发提交 | §3.6 方法 (b) | 记录各 mutation 的开始 / 结束时间与 OCC 重试 |
| V8 | OCC 重试次数是否可观测（`npx convex insights` 是否列出写冲突） | `occRetriesObserved` | 读 insights 输出 |
| V9 | 预览部署在当前 Convex 计划可用、回收策略、`--preview-run` 失败时部署是否中止 | §3.7、§4.1 | 读 Convex 文档并试一次 |
| V10 | 本地部署能否在 CI（Linux runner）上无登录启动 | §3.7 退路 | 试一次 |
| V11 | `ctx.meta.getDeploymentMetadata()` 返回的字段（是否含部署名） | `confirmDeployment` | 读 `CVX:server/meta.ts` 类型并实测 |
| V12 | `npx convex env set` 后函数何时读到新值 | TD-11、§4.6 | 设置后立即调用一个读环境变量的 query |
| V13 | `purgeSimulatedRooms` 单事务可删除的文档数上限 | §4.3 | `getTransactionMetrics()` 实测 |
| V14 | Clerk 官方的 Playwright 测试支持形态（测试 token / 辅助包）与 dev 实例测试用户的登录方式 | §3.7 | 读 Clerk 文档 |
| V15 | Convex log streams 在当前计划可用 | §4.4 告警 | 读 Convex 文档 |
| V16 | Node 24 直接运行 `.ts` 脚本是否需要 `--experimental-strip-types` | §3.1 | 本地试一次；否则用 `tsx` |
| V17 | Opus 5.5 回合实测 p50 / p95（决定看门狗期限与 F10.6 目标是否现实） | §3.10、§4.4 | L4 至少 10 次 |
| V18 | `staging` 作为 prod 类型部署时的部署 key 与用量上限是否与 prod 隔离 | §4.1 | 读 Convex 文档；推荐另建项目以规避 |
