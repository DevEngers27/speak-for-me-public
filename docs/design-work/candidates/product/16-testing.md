# 16 测试策略

## 16.1 测试层与工具

| 层 | 工具 | 覆盖 | 运行时机 |
| --- | --- | --- | --- |
| L1 纯函数单测 | Vitest（+ fast-check 属性测试） | `engine/*`、`scenarios/*/`（候选、检查、取舍、模板、stub、校验器）、协议 schema、决议策略、签核判定、阶段派生、规范化键 | 每次提交 |
| L2 Convex 函数测试 | `convex-test`（版本 0.0.65，API 名称待验证）+ Vitest 假时钟 | 状态机迁移、鉴权与投影、隐私金丝雀、调度链（stub 模式完整 run）、过期拒收、约束变化流程 | 每次提交 |
| L3 真实部署并发 | `scripts/concurrency-*.ts` 对 dev/staging deployment 并行调用公共函数 | OCC 下的唯一性与幂等（convex-test 串行执行，证明不了，F08.5） | 合并前、每次发布 |
| L4 端到端 | Playwright，3 个 Clerk 测试账号，staging，`AGENT_MODE=stub` | 三窗口实时翻转、完整旅程、双击、刷新后进度仍在 | 每日与发布前 |
| L5 模型评测 | `tests/evals/`，真实模型，fixture 变体 | 结构性质、隐私、延迟 p50/p95、成本 | 换模型/effort/提示时；发布前一次 |
| L6 冒烟 | 部署后脚本 | 页面能渲染、认证链路、`health.config` | 每次部署 |

数字一律从 `scenarios/scope-change/fixtures/standard.ts` 推出，测试中不另写一份（F14.2）。

## 16.2 L1：规则与协议（节选）

| 用例 | 期望 |
| --- | --- |
| 预算边界：上限 $4,750、已承诺 $4,000、`LOGIN+REPORTS@standard` $750 | `BUDGET_FITS`，余量 0 |
| 超出 $1 与超出 $1,000 | 两者 `verdict_only` 投影文本完全相同 |
| `LOGIN+REPORTS+EXPORT@standard` | 同时报 `BUDGET_EXCEEDED` 与 `DEADLINE_MISSED`（RA-F03） |
| 只含可延后项、晚于截止日的候选（RA-B01 复现数字） | `REQUIRED_ITEM_MISSING` + `DEADLINE_MISSED`，不可执行 |
| 条款中任一金额或日期被篡改 | `TERMS_MISMATCH` |
| 引用的报价行被新版本取代 / 撤回 / 过期 | `SOURCE_SUPERSEDED` / `SOURCE_WITHDRAWN` / `SOURCE_EXPIRED`（RA-B04） |
| 日期 `2026-02-30` | 校验器在保存时拒绝（RA-B10） |
| 金额 `-1`、`1.5`、`2^53` | `assertCents` 拒绝 |
| 属性：任意 fixture 变体下 `enumerate` 输出确定、无重复、`toTerms` 金额 = 行价之和 + 费用 | 恒成立 |
| 属性：作用域视图过滤出的候选 ⊇ 完整视图的可执行候选 | 恒成立（隐藏约束只会让候选变"未知"，不会误删） |
| `buildMoveSchema` 与 `modelMoveV` 对同一组样例结论一致 | 一致 |
| 输出含多余字段、候选键不在允许集合、话题与目标角色不匹配 | `AGENT_OUTPUT_INVALID` |
| `stop_reason` 为 `max_tokens` / `refusal`；text 块为空 | 分别 `AGENT_TRUNCATED` / `AGENT_REFUSED` / `AGENT_OUTPUT_INVALID`，绝不当作"无动作" |
| 决议算法：全部 accept / 有 counter 且未到上限 / 到上限 / 有 clarify | 与 05 第 5.7 节一致 |
| 取舍：变体 B | finance 两档 $4,450、$4,750；provider 加报价行；customer 无请求 |

## 16.3 L2：状态机、权限、隐私

**权限（对每个公共函数四类负面用例）**：未认证、非成员、错角色（例如 provider 调 `ledger.addBaseline`、customer 调 `lists.confirm` quote）、非目标（回答别人的请求）。另有：自选角色加入（无邀请）被拒；一人占第二个席位 → `ALREADY_SEATED`；非 finance 改上限被拒；非成员触发 run 被拒。

**隐私金丝雀**（fixture 变体 E）：
1. 以 provider 身份调用全部 query，序列化返回值：不含 `CANARY-FIN-7731`、`CANARY-CUS-1193`、数值 501700 / 400000（上限与已承诺）、`hardDeadline` 日期；不含 `capCents`、`committedCents`、`headroomCents` 字段。customer、finance 视角同理检查各自不可见项。
2. `getTurnInput` 对 provider 回合：`AgentContextData` 与 `callModel` 实际请求体（stub 下拦截）中无他方金丝雀。
3. 跑完一个完整 run 后扫描 `events`（全部 `data`）与渲染后的时间线：零命中。
4. `history.myAgentNotes` 只返回本席位回合。

**状态机与流程（stub 模式，假时钟推进调度）**：
- 标准走查 14.12 全流程：就绪 → run 1 → v1 → 接受 → 降预算 → 阻断与 stale → run 2（stub 走 a2）→ v2 → 三方签核 → CO-1、承诺 1 条、任务 2 条、约束 v8、`negotiationOpen=false`。
- 回合进行中改预算：迟到结果 `stale`，不产生提案（AC-S5）。
- 看门狗：action 不返回 → `timed_out` → 自动重试 → 再超时 → stalled → `retryRun` 恢复。
- 拒绝后：开新 run 且被拒候选不在 `allowedCandidateKeys`；同一约束版本第 4 次拒绝转为偏好请求（RA-B16）。
- 约束变化后旧拒绝显示 `stale_reject`（RA-B30）；拒绝 → 撤回 → 批准三条记录都在（RA-B06）。
- 约束变化后提案仍可执行：不复制提案、同一提案可重签并执行（RA-R11）。
- customer 改截止日（规则字段）使两条已有签核 stale、执行被拒（RA-B02）；只改偏好日不影响签核。
- 任一必需简报未确认时不能开 run、不能手动提出（RA-B15）。
- 执行后台账再增加，旧变更单的"执行前/后"不变（RA-B09）。
- `CAP_BELOW_COMMITTED`、`BASELINE_LOCKED`、`RATE_LIMITED`、`AGENTS_DISABLED` 各一例。

## 16.4 L3：真实部署并发脚本

| 脚本 | 操作 | 断言 |
| --- | --- | --- |
| `concurrency-approve-same-user` | 同一身份并发 5 次 approve | `decisions` 只多 1 行 |
| `concurrency-last-two` | 两个不同身份同时完成最后两个签核（重复 20 次） | 每次恰好 1 条执行、1 条承诺、N 条任务；两客户端拿到同一 `executionId` |
| `concurrency-approve-vs-budget` | approve 与 quickUpdate 并发 | 要么签核 `CONSTRAINTS_CHANGED`，要么签核在旧版本并随即 stale；从不执行超预算方案 |
| `concurrency-accept-invite` | 两个用户同时接受同一席位的邀请 | 恰好一人入座 |
| `concurrency-start-run` | 并发 requestRun ×5 | 恰好一个 active run |

身份模拟方式（`npx convex run --identity` 或测试用 Clerk 令牌）待按工具实际能力确定；证据中写明方法与次数（F08.5）。

## 16.5 L4：端到端（Playwright）

1. 三个浏览器上下文各登录一个测试账号；建房、邀请、加入、确认简报与清单。
2. 断言：第一个提案在三个窗口出现且无需刷新；provider 页面 DOM 中无预算数字。
3. finance 降预算：三个窗口在同一推送中显示 Blocked；customer 的签核显示 "no longer applies"。
4. 新提案出现；最后签核者双击 approve：只出现一个 CO-1。
5. 刷新所有页面：状态一致。

## 16.6 L5：模型评测

- 不断言文本，只断言结构性质：动作合法、候选键在允许集合、`proposal_ready` 时提案可执行、公共文本全部来自模板、rationale 不出现在他方任何输出中。
- 隐私：变体 E/F 下 provider 代理的输出与公共历史中无预算数字（注入用例 F05.4）。
- 质量：标准 fixture 下 customer 代理在"报表 vs 早交付"上与备注意图一致的比例；记录样本数。
- 延迟与成本：最终模型 + 最终 effort 至少 10 次，记录 p50/p95、token、估算成本，回填 10 第 10.5 节（待验证项 #5）。

## 16.7 完成定义

每个功能合并前：有 L1/L2 验收用例（含负面用例）；涉及唯一性或幂等的有 L3 脚本；涉及界面实时行为的有 L4 步骤；失败用例保留在记录中（P-18、AC-09）。原 README 的 Required scenarios（AC-S1～S6）与 Role A 回归清单（§10.2 的 15 条）全部映射到以上用例。
