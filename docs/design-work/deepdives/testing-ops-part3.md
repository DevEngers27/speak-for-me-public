# 专题深潜：测试策略与运维（part 3/6）

> §3 具体设计（上）：目录布局、L0 纯函数、L1 convex-test、模型接缝、过期结果拒绝。示例代码在 `deepdives/testing-ops/`。

## 3. 具体设计

### 3.1 测试目录与命名

| 位置 | 内容 | 运行器 / 环境 |
| --- | --- | --- |
| `packages/engine/src/**/*.test.ts` | 引擎纯函数（规则、版本、审批集合判定、披露裁剪、模板） | Vitest `node` |
| `packages/scenario-scope-change/src/**/*.test.ts` | 场景插件（目录求和、可行组合枚举、fixture 自洽） | Vitest `node` |
| `convex/**/*.test.ts` | convex-test 用例（函数级） | Vitest `edge-runtime` |
| `convex/test/` | 测试工具：`setup.ts`（`makeT`、身份、seed）、`scriptedModel.ts`、`canary.ts` | — |
| `e2e/*.spec.ts` | Playwright 三账号用例 | Playwright |
| `scripts/probes/*.ts` | L2 部署探针（并发、日志扫描、运行时冒烟） | Node 24 `--experimental-strip-types`（是否需要该标志：待验证）或 `tsx` |
| `scripts/evals/*.ts` | L4 模型评估 | 同上 |

- 包名与目录以 11-architecture 为准；本专题只要求"引擎与场景是无 Convex 依赖的纯包"，使 L0 不需要 edge-runtime。
- 用例 ID：`T-<层>-<领域>-<序号>`，如 `T-L1-EXEC-03`；回归用例在名称里带来源，如 `RA-B02`、`F09.4`。用例矩阵见 part4 §3.11。
- Vitest 用 `projects`（或 workspace，取决于所装版本，待验证）区分 `unit`（node）与 `convex`（edge-runtime），一条 `pnpm test` 跑两者，见 `testing-ops/vitest.config.ts`。

### 3.2 L0 纯函数单测

被测函数清单（名称以 06 / 07 / 10 专题为准，这里列出必须是纯函数的理由）：

| 函数 | 断言重点 | 核心 |
| --- | --- | --- |
| `assertCents(n)` | 负数、小数、`NaN`、`> 100_000_000` 被拒；`0` 与上界通过 | 4 |
| `parseIsoDate(s)` | `2026-02-30`、`2026-2-3`、带时间的字符串被拒（RA-B10） | 4 |
| `priceSelection(catalog, itemKeys)` | 金额只来自目录求和；未知 itemKey 抛 `UNKNOWN_ITEM`；重复 itemKey 被拒 | 4 |
| `validateProposal(input)` → `reasonCode[]` | 每个 reasonCode 至少一正一反用例；恰好等于余量通过（`<=`）；超 1 分被拒；必需项缺失、晚于硬截止各自报码；v1 fixture 同时报 `BUDGET_OVER` 与 `DEADLINE_VIOLATED`（RA-F03） | 4 |
| `findFeasibleOffers(catalog, constraints)` | 降到 $4,800 后的可行集合与 14 号场景走查一致；cap $4,400 返回空集 | 4 |
| `isApprovalComplete(snapshotRoles, decisions)` | 按集合判定；同一 userId 不能满足两个角色；重复 approve 只计一次；最新决定覆盖旧决定 | 3、5 |
| `deriveExecutionKey(proposalId, constraintsVersion)` | 稳定、服务端派生（`exec:${proposalId}:${constraintsVersion}`） | 5 |
| `deriveTasks(approvedItemKeys, templates)` | 确定性；同输入同输出；不调模型 | 5、7 |
| `projectRoomForViewer(state, viewer)` | 每个角色的返回值键集合与 07 的披露矩阵逐格一致（表驱动，矩阵直接从 07 的常量导入，不另抄一份） | 1 |
| `buildAgentContext(role, inputs)` | provider 上下文不含 finance 的任何字段与金丝雀；不含他方自由文本；稳定前缀字节级不变（缓存不被静默打破） | 1、TD-6 |
| `renderPublicText(templateKey, fields)` | 只用结构化字段；provider 侧模板不含金额以外的预算信息（F14.5） | 1 |
| `parseModelOutput(response)` | 只有 `stop_reason === "end_turn"` 且 Zod 通过才返回 `ok`；`max_tokens`、`refusal`、空 content、半截 JSON、多余动作都返回带 `errorCode` 的失败，**永不返回"无动作"** | 4 |
| `estimateCostMicros(usage, model)` | `input_tokens` 只是未缓存部分，提示总量 = 三项之和（inputs/04 §4.8）；未知模型返回 `null` 而不是 0 | 运维 |

- 表驱动：fixture 是单一 TS 模块（F14.2），用例里的数字一律从 fixture 推出，例如 `const headroom = budget.totalCents - baseline.amountCents`，不写字面量 `80000`。
- 属性测试（可选，引入 fast-check 前需评审）：对 `priceSelection` 与 `isApprovalComplete` 做随机输入的不变量检查。v1 不强制。
- 静态检查（核心 7）：一个 L0 用例扫描 `convex/` 源码，除 `convex/agents/modelClient.ts` 外不得出现 `fetch(`、`new Anthropic(`；执行模块不得 import 任何网络库。实现为读文件 + 正则，简单可靠。

### 3.3 L1：convex-test 基础设施

- 工厂：`makeT()` = `convexTest(schema, modules)`，`modules = import.meta.glob("../**/*.ts")`（API 名称与 glob 写法依 convex-test 0.0.65 文档，待验证）。
- 身份：三个固定身份，`tokenIdentifier` 与 Clerk 的真实格式同构（`<issuer>|<subject>`），见 `testing-ops/convex-test-setup.ts`：
  - `asCustomer = t.withIdentity({ issuer: TEST_ISSUER, subject: "user_customer", tokenIdentifier: \`${TEST_ISSUER}|user_customer\` })`，provider、finance 同理，外加 `asStranger`（已登录非成员）与匿名 `t`。
- 种子：测试不调用 `seed.fromFixture` 的 CLI 版本，而是调用同一个内部函数 `internal.seed.fromFixture`，再用 `internal.seed.attachMember` 把三个测试身份写成成员（该函数受 `assertTier`，测试环境的层级来自 `process.env.DEPLOYMENT_TIER = "test"`；convex-test 中 `process.env` 是否对被测函数可见：待验证，退路是在 `vitest.config.ts` 的 `env` 字段注入）。
- 调度推进：`vi.useFakeTimers()`；用 `t.finishInProgressScheduledFunctions()` 推进一步，用 `t.finishAllScheduledFunctions(vi.runAllTimers)` 跑完整条链（名称待验证）。
- 模型接缝注入：`vi.mock("../agents/modelClient", () => scriptedModelModule)`，脚本队列按 `(role, turnSeq)` 取响应；队列耗尽即抛错，防止测试悄悄走到未定义的分支。见 `testing-ops/scripted-model.ts`。
- 退路（若 `vi.mock` 在 convex-test 的模块图中不生效）：`modelClient` 导出 `__setModelClientForTests(impl)`，函数体首行 `if (process.env.DEPLOYMENT_TIER !== "test") throw`；这是唯一允许的测试钩子，仍不是公开 Convex 函数。

### 3.4 L1 用例分组

| 组 | 代表用例 | 断言 |
| --- | --- | --- |
| AUTH 负面鉴权 | 匿名 / 非成员 / 错角色调用每个公开函数 | 统一抛 `ConvexError({ code: "FORBIDDEN" })` 或返回 `null`（按 12 的约定）；错误消息不含资源是否存在的信息 |
| DISC 披露 | 以每个角色调用每个公开 query，对返回 JSON 做"键集合 + 金丝雀值"双重断言 | 键集合等于 07 矩阵；provider 返回值中不存在 `totalCents` / `committedCents` 键，也不存在这两个数值（F16.3） |
| SM 状态机 | 对 04 的每条迁移：守卫满足 → 迁移成功并写事件；守卫不满足 → 拒绝且状态不变 | 迁移表驱动：从 04 导出 `TRANSITIONS` 常量，测试遍历它，非法迁移由 `assertTransition` 抛错 |
| APPR 审批 | 重复批准只一条有效决定；撤回是追加；约束变更后旧审批 stale；同一 userId 不能占两个角色 | `approvals` 行数与 `currentDecision` 派生值 |
| EXEC 执行 | 最后一票同 mutation 内执行；对同一提案再次调用返回同一 `executionId` 且不新增事件；被拒提案不能执行；预算重算超限则 blocked | 三张执行表行数精确等于预期（**串行语义**，并发见 L2） |
| RUN 回合链 | 开始协商 → 脚本化响应 → 提案 → 下一回合；`invalid_output` 有界自动重试 1 次；`failTurn` 后 `retryTurn` 沿用 `turnSeq`、`attempt + 1`；`callCount` 达上限进入 `needs_input` | `agentTurns` 序列与 `runs` 状态 |
| STALE 过期拒绝 | 见 §3.5 | `turn_rejected_stale` 事件、无新提案、旧审批不计入 |
| WD 看门狗 | 回合保持 `running` 超过期限 | `turnWatchdog` 置 `failed`、写 `turn_failed` 事件；回合已完成时看门狗是空操作（幂等） |
| CHG 约束变更 | 每个递增点（09 列出的全部 mutation）都使 `constraintsVersion + 1`；其他写入都不改它 | 遍历 09 导出的 `CONSTRAINT_BUMPERS` 列表；再对"非递增 mutation"列表断言不变 |
| HUM 人工请求 | 无可行解时由代码生成 `humanRequests`，不调模型（脚本队列为空也不报错）；`answerRequest` 只能由目标角色调用 | 请求的 `options` 来自 `findFeasibleOffers` |
| SIM 不伪造 | stub 回合 `authorKind: "rule"`；seed 房间 `isSimulated: true`；对应 query 返回值带这些标注 | 字段存在且被各角色视图透传 |

### 3.5 过期结果拒绝：三种测法

过期拒绝依赖 F04.2 的回合持久化守卫：`room.currentRunId === runId`、`run.nextTurnSeq === turnSeq`、`room.constraintsVersion === run.constraintsVersionAtStart`。

1. **守卫单元（最确定）**：手工构造一个 `running` 回合，先调用 `updateBudget`，再直接 `t.mutation(internal.agentRuntime.completeTurn, { turnId, output })`。断言：回合 → `stale`；事件 `turn_rejected_stale`；`proposals` 行数不变；`runs` 新 run 未受影响。
2. **调用中变更（贴近真实）**：脚本化模型在返回前执行一个回调，回调里 `await asFinance.mutation(api.budgets.updateBudget, …)`，模拟"模型思考期间 finance 降预算"。然后推进调度。断言同上，另断言旧 run 为 `superseded`、新 run 以新 `constraintsVersion` 开始。这要求 convex-test 允许在 action 执行期间插入另一个 mutation（action 非事务，理论上可以）：待验证；不支持时退回测法 1。示例见 `testing-ops/stale-turn.test.ts`。
3. **真实部署（L2）**：探针在 `live` 或带人工延迟的 stub（`STUB_DELAY_MS`，仅非生产层级生效）下启动回合，延迟期间 `npx convex run budgets:updateBudget --identity <finance>`，再查回合与事件。这是唯一覆盖"cancel 不能中止在途 action"（inputs/04 §1.5）的测法。

同类的"过期审批"用例（RA-B02、RA-R05、RA-R11）放在 APPR / CHG 组：约束变更后用旧审批调执行必被拒；对同一 `proposalId` 在新版本下重新批准后可执行（不复制提案，RA-R11）。

### 3.6 L1 的诚实标注

- convex-test 中两次连续调用"只产生 1 条执行记录"只证明**串行幂等**（状态守卫 + 执行键查重）。用例名统一带后缀 `[serial]`，测试报告里不得写成"并发安全"（F08.5）。
- convex-test 不模拟限额、超时、`"use node"` 差异与错误消息（inputs/04 §1.12，待验证）；凡涉及这些的断言放 L2。
