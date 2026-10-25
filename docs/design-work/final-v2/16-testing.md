# 16 · 测试策略（part1：目标、决定、分层）

> 分片：
> - `16-testing.md`（本文件）：§16.0 目标与范围、§16.1 决定 TD-01…TD-14、§16.2 分层
> - `16-testing-part2.md`：§16.3 工具链与配置、§16.4 convex-test 基础设施（身份、走生产写入口的 fixture、`drainDue`、看门狗推进、模型接缝 `callModel` + `vi.mock`、防假绿纪律、`[construct]` 白名单）
> - `16-testing-part3.md`：§16.5 每个场景 afterEach 的对账 R1–R11 与活性检查、§16.6 用例目录（上）：AUTH、VER
> - `16-testing-part4.md`：§16.6 用例目录（下）：EXE、RUN、RULE、OPS / LIM
> - `16-testing-part5.md`：§16.7 隐私与注入测试：金丝雀三身份双向扫描、派生数值针脚、数字边界正则、`lintCanaries`、披露配置扫描、非干扰性质测试、Proxy 读取测试、矩阵对账、PRIV / INJ 用例
> - `16-testing-part6.md`：§16.8 L2 真实部署（spikes §8 的 18 项逐项分配、单进程多 `ConvexHttpClient` 并发探针与 `maxOverlap ≥ 2` 证据、日志扫描）、§16.9 L3 端到端
> - `16-testing-part7.md`：§16.10 L4 / 离线评测（vitest project runner、评测集、指标与发布门槛）
> - `16-testing-part8.md`：§16.11 反例电池 CE-001…CE-175（00-invariants 的 170 条 + 本章 5 条）→ 用例矩阵
> - `16-testing-part9.md`：§16.12 CI 闸门与变异检查、§16.13 不变量、§16.14 备选与否决、§16.15 开放问题与待验证、§16.16 与 canon 的对照
>
> 底稿：`candidates2/agentquality/16-testing-part1..2.md`（离线评测与发布门槛、纯归约器思路）、`candidates/security/16-testing*.md`（非干扰 metamorphic 测试、金丝雀多写法扫描、TC 编号体系）。吸收：`deepdives/testing-ops*.md`（L0–L4 分层、L2 证据结构）及反驳 r01–r20 的全部修正；`spikes/README.md` §1/§4/§7 16 段/§8；`techstack/README.md` D12/D18/X6；`foundation/convex-test-utils`、`foundation/e2e-harness`；`00-invariants-part2..3.md` 的反例电池（按 canon part5 摘要修订）。命名与决定以 `00-canon*.md` 为准；测试编号与 07 §7.20 威胁表一一对应。

## 16.0 目标与范围

**目标**：每条核心（任务书 §3）、每条 canon 决定、每个 07 威胁都有可运行的测试证据，并且测试报告如实写明每层能证明什么、不能证明什么。核心映射之外，已知的边界缺陷各有专门回归用例：节流计数的混合事件稀释（TC-AUTH-14）、只改标题后改价（TC-AUTH-15）、满目录与 50 任务准入（TC-EXE-13）、`rounds_exhausted` 的每个 `questionKey`（TC-RUN-27）、时间线提交组的每个分页切点（TC-PRIV-25）；只有部署能证明的结论（并发、OCC）仍以 L2 证据为准。

| 核心 | 需要的证据 | 主要层 |
| --- | --- | --- |
| 1 私密委托 | 任何身份调用任何公开 query 的返回、错误 data、事件渲染、代理上下文与模型请求体、WebSocket / SSR / RSC 负载、日志中都不出现他方私密值或其非解密派生值；非干扰性质成立 | L0、L1、L3、L2（日志） |
| 2 代理只建议 | 代理输出永远不写 `approvals`；越界动作被拒 | L0、L1 |
| 3 人批准具体版本 | `expected*` 不符不写行；约束变化后旧审批失效、同一 `proposalId` 重批 | L1 |
| 4 代码负责校验 | 金额 / 条目 / 日期只来自快照与目录；`stop_reason` 非正常不被当作"无动作" | L0、L1 |
| 5 执行幂等且原子 | 并发最后一票、重复调用、重发只产生一条 execution / ledger commit / changeOrder 与一组 tasks | L1 `[serial]` + **L2（唯一能证明 OCC 的层）** + L3 |
| 6 历史不可篡改 | 只追加表无 patch / delete；撤回是追加 | S、L1 |
| 7 执行边界 | 代码库无外部 ERP / 支付 / 签署依赖；`modelGateway` 以外无网络调用 | S |
| 8 不伪造 | seed / stub 产物带 `provenance` 并在界面显示 | L1、L3 |

**范围外**：负载与吞吐测试（v1 用户量极小，只测并发正确性）、混沌工程、多区域、外部告警平台选型。

## 16.1 决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| TD-01 | 单一运行器 Vitest 5.0.5（canon D20，修正 techstack X6 的 4.1.11）分四个 project：`core`（node，`core/**`）、`convex`（edge-runtime，convex-test 0.0.65）、`evals`（node，离线评测）、`web`（jsdom，`src/**` 组件）；L3 用 Playwright 1.64 + `@clerk/testing`。`pnpm test` 不访问网络、不需要部署、不需要密钥（前提：`convex/_generated` 已提交，D20） | convex-test 建立在 Vitest 上；一个运行器覆盖 L0 / L1 / 评测，CI 最简单 | `node --test`（承载不了 convex-test，`.ts` 互导有 TS5097）；Jest |
| TD-02 | 五层 + 静态检查，每层只宣称它能证明的东西；任何"并发 / 幂等已验证"的结论必须引用一份 L2 证据，L1 同类用例名带 `[serial]` | convex-test 用事务锁串行化顶层函数、无冲突检测（review C2 源码证实）；把并发结论写在 L1 上是伪证 | convex-test 里 `Promise.all` 当并发证据 |
| TD-03 | 模型调用唯一接缝 `callModel`（`convex/model/agents/modelGateway.ts`，10 §10.14.1、canon D21）；它是代码库中唯一构造 Anthropic 客户端的地方。L1 用 `vi.mock` 替换该模块注入脚本化响应；`scripted` / `replay` 驱动就是这个 mock 的两种实现，live 驱动的下游（`stop_reason` 分支、JSON 解析、`safeParse`、语义校验）因此被真实执行；`stub` 驱动（canon D26 `AgentDriver` 接口的 `StubDriver` 实现）不经过该接缝 | 模型是唯一不可控输入；隔离成一个函数，其余全部可确定性测试，且生产代码无测试分支（review r01） | 部署上放 `AGENT_MODE=scripted` 从库里读脚本（可被误开的后门）；nock 录制 HTTP（绑死 SDK 细节） |
| TD-04 | 防假绿纪律：脚本队列耗尽即抛错；`afterEach` 断言队列已耗尽；需要模型的用例断言 `recordedRequests.length > 0`；`drainDue` 对 `failed` 的调度函数报错；扫描器必须通过灵敏度对照（去掉防线的对照组必须被抓到） | review r02：测试环境若是 stub，脚本化用例可能"变绿"却从未走到 live 分支 | 只看最终状态 |
| TD-05 | 调度推进只用 `drainDue`（只推进当前到期的任务）；看门狗与重试用例显式推进到其 `scheduledTime`；凡注册了看门狗的链路禁止 `vi.runAllTimers` 与 `finishAllScheduledFunctions(vi.runAllTimers)` | `runAllTimers` 会让看门狗与 `runAfter(0)` 的 action 同时启动并竞态（review r03；spike 证伪"runAllTimers 能测 watchdog"） | `foundation/convex-test-utils` 的 `drainScheduled` 原样用于代理链路（它包的正是 `runAllTimers`） |
| TD-06 | fixture 一律走生产写入口重放（canon D18）；`t.run` 直接写表只允许出现在登记在册的 `[construct]` 纵深用例（§16.4.6） | 索引不唯一，绕过入口会让 `.unique()` 从此失败关闭（spike B1）；seed 中间状态会伪造不可达状态 | `t.run` 批量造数 |
| TD-07 | 隐私证据四件套：构造保证（L0 白名单断言）+ 观测扫描（金丝雀）+ 性质测试（非干扰）+ 矩阵对账（注册表完整性、Proxy 读取、键集合快照） | 只做构造会漏旁路（错误、日志、事件）；只做扫描覆盖不到未跑到的分支；只做二者测不出"派生值泄露" | 只扫字面金丝雀 |
| TD-08 | 金丝雀：三身份双向扫描、派生数值针脚、数字边界正则、`lintCanaries`、**披露配置扫描**（每个可共享字段在至少一个配置里对每个可能受众未披露） | review r12 / r13；评委发现 security 底稿 fixture 恰好披露了被泄露的字段，测试失明 | 单一 fixture 配置 |
| TD-09 | 并发证据只在真实 dev 部署取得：一个 Node 进程里 N 个 `ConvexHttpClient`，各自 `setAdminAuth(adminKey, actingIdentity)` 后 `Promise.all` 调用**公开**函数，记录每次调用的发起 / 返回时间，`maxOverlap ≥ 2` 的轮次才是有效样本；退路并行 `npx convex run --identity`；再加 UI 双击 | 走真实公开函数与鉴权路径，重叠窗口比并行 CLI 紧（review r16）；insights 只接受用户登录，CI 拿不到 OCC 计数（r08） | `devProbe.parallel` + `asIdentity`（为测试改变 12 的写法、绕过真实鉴权） |
| TD-10 | spikes §8 的 18 项真实部署验证逐项分配到探针 / 用例、负责章节与通过标准，实现第 1 周完成（U11 默认） | 这些平台事实决定了多处防线是否只是纵深 | 上线后再看 |
| TD-11 | 离线评测 runner 是 Vitest 的 `evals` project（techstack D18），与 Convex 路径共享引擎代码；确定性模式（stub / scripted / replay）进 PR 闸门；live 模式只在改提示、schema、模型或 effort 时运行，只断言结构性质与分布 | 不依赖 Node 类型剥离直跑 `.ts`（无扩展名导入与 enum 会失败）；模型不可复现 | promptfoo（判分需要运行引擎代码、依赖面大） |
| TD-12 | 每个 convex-test 场景 `afterEach` 调用 08 的 `internal.executions.checkInvariants`（R1–R11）与本章的 `internal.testing.checkLiveness`（LV / EV / SF），断言全部为空 | 正常路径不可能违反；任何违反都是代码缺陷的直接证据 | 只在专门用例里检查 |
| TD-13 | 反例电池 CE-001…CE-175 是用例矩阵的索引：每个 CE 至少映射一个可运行用例；与 canon 或已定稿章节不一致的电池期望在 §16.11.2 记录修订 | 评委在 9 份候选里都构造出了违反核心的反例；电池把它们变成回归 | 只按功能写用例 |
| TD-14 | PR 闸门无密钥（fork PR 也安全）；L2 / L3 / L4 使用受保护环境；变异检查脚本化，只针对四条关键守卫 | 生产部署前必须有并发证据；手动季度变异检查会流于形式（review 简化表） | 每 PR 跑 L2 |

## 16.2 分层

| 层 | 载体 | 证明什么 | 不能证明什么 | 何时跑 |
| --- | --- | --- | --- | --- |
| S 静态 | ESLint、AST / 正则扫描、类型测试 | 依赖方向、引擎纯度、构造器使用、无 `console.*`、只追加表无 patch / delete、公开函数参数无身份字段、`modelGateway` 以外无 `fetch(` / `new Anthropic(`、无外部 ERP / 支付 / 签署依赖 | 运行时行为 | 每次提交 |
| L0 纯函数 | Vitest `core` | 规则、金额、日期、`enumerateCandidates`、`evaluateApprovalSet`、`resolveRound`、`buildHumanRequests`、`projectForRole` / XP、`renderPublicText`、`toStrictOutputSchema`、`canonicalJson`、`encodeBlock`、`wrapUntrusted`、扫描器自身 | 任何 Convex 语义 | 每次提交 |
| L1 后端模拟 | Vitest `convex` + convex-test | 状态机迁移、守卫、鉴权矩阵、逐 query 披露、调度链（回合、看门狗、重试）、过期拒绝、幂等的**串行**语义、事务限额（`transactionLimits: true`） | 并发 / OCC、真实运行时差异、生产错误格式、部署打断、调度器瞬时错误重试 | 每次提交 |
| L2 部署探针 | `scripts/probes/*.ts`（`tsx` 锁版本）对专用 dev 部署 | OCC 下的唯一性与幂等、调度器真实行为、身份、运行时能力、日志零泄露、生产数值限额抽样 | 浏览器行为 | main 夜间；改动执行 / 审批 / 调度 / 投影代码的 PR 手动触发；发布前必须有最近一次通过的证据 |
| L3 端到端 | Playwright + `foundation/e2e-harness`，三个 Clerk 测试身份、三个浏览器上下文，后端预览部署（stub） | 实时翻转、双击只执行一次、刷新后进度、WebSocket / SSR / RSC / console 零泄露、界面模拟标注、API 路由 401 | 模型质量 | 每个非 fork PR |
| L4 模型评估 | Vitest `evals` live 模式，dev Anthropic key | 真实模型输出的结构性质、注入鲁棒性指标、p50 / p95 延迟、token 与估算成本、缓存命中 | 确定性 | 改提示 / schema / 模型 / effort 时；每周只跑 `runtime_smoke` |
