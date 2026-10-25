# 16 测试策略（part1）：层次、纯函数单测、convex-test 流程与故障注入

> 分片：part1 本页；part2 并发与幂等、隐私金丝雀与注入、模型评估、端到端、静态检查、回归清单、完成定义。
> 原则：每条核心与每个失败模式都有可运行的验收测试；数字从 14 的 fixture 推出，不另写一份；不假设模型同输入同输出，只断言结构性质（F16.4）。

## 16.1 层次与工具

| 层 | 工具 | 覆盖 | 不能证明什么 |
| --- | --- | --- | --- |
| 纯函数单测 | vitest | 规则、候选、重试策略、响应分类、JSON Schema、提示渲染、模板与投影、状态机表、校验器 | 数据库与调度行为 |
| Convex 函数测试 | convex-test 0.0.65 + vitest 假时钟（API 名待验证，inputs/04 §1.12） | 鉴权、守卫、状态迁移、事件、调度链、watchdog、stub 全流程、故障注入 | **并发与 OCC**（函数串行执行）、平台限额、真实超时 |
| 并发脚本 | 针对真实 dev / staging deployment 的 Node 脚本（`scripts/concurrency-*.ts`） | 单活跃 run、最后两票、审批与约束变化竞争、唯一性 | — |
| 端到端 | Playwright，三个独立浏览器上下文、三个 Clerk 测试账号 | 实时翻转、双击、刷新后状态、各角色旅程、可访问性冒烟 | 模型质量 |
| 模型评估 | staging 上的 live 模式脚本（`tests/eval/`） | 输出合法率、延迟分布、评审表态与本方偏好一致率、成本 | 确定性 |

CI 运行前三层中的前两层（无凭据）；并发脚本、e2e、评估在 staging 部署后的流水线阶段运行。

## 16.2 纯函数单测（节选，按模块）

| id | 模块 | 断言 |
| --- | --- | --- |
| RG-01 | rules | cap $4,800、已承诺 $4,000 时，一个只含 EXPORT、交付晚于截止日的条款同时报 `scope.required_missing` 与 `date.after_deadline`，不可执行（RA-B01 回归） |
| RG-03 | rules | 提案引用 LOGIN v1，目录中 LOGIN 已是 v2 → `engine.source_superseded`（RA-B04） |
| RG-08 | validate | `2026-02-30`、`2026-11-31` 被 `assertCalendarDate` 拒绝；`2028-02-29` 通过（RA-B10） |
| RG-09 | rules | fixture 全量方案（LOGIN+REPORTS+EXPORT 加急，$1,400，11-27）同时报 `budget.over_cap` 与 `date.after_deadline`（RA-F03） |
| RG-14 | rules | 余量恰好等于金额（$800 / $4,800）通过；$4,799 时不通过（边界） |
| RG-15 | rules | cap < committed → 全部候选为空且报 `budget.cap_below_committed` |
| RG-16 | candidates | 枚举结果与 14.9 表格一致（键、金额、日期、排序，且每个候选 `deferredItemKeys = requested − itemKeys`，RA-B13）；排序函数只依赖公开字段（把 customer 的 importantItemKeys 改掉，排序不变） |
| RP-01 | retryPolicy | 对每种 outcome × 已用次数组合，`decideRetry` 结果与 10 part4 §10.7.1 表一致（表驱动，穷举） |
| CL-01 | classify | 用录制的 `Message` JSON 夹具覆盖：end_turn 合法、无 text 块、JSON 截断、Zod 失败、候选不在集合、refusal（`stop_details.category` 为 null 与非 null）、max_tokens、pause_turn；每种都返回预期 outcome 且带 usage |
| CL-02 | classify | `APIConnectionTimeoutError`、`APIConnectionError`、429（带 / 不带 retry-after）、500、529、400、401、403、404、`billing_error` 的映射 |
| JS-01 | jsonSchema | 生成的 schema 只含支持子集的键；根为对象、无根级 anyOf；`additionalProperties:false` 全覆盖；clarify 额度用完时 action 枚举不含 clarify；评审 schema 的 counter 枚举不含当前候选 |
| RQ-01 | promptRender | 请求参数键 ⊆ 允许集合；最后一条消息不是 assistant；system 段对同一（场景版本，角色，PROMPT_VERSION）逐字节稳定；不含时间戳与 id |
| TP-01 | templates | 对 provider 能力集渲染全部事件与检查模板，输出中不出现任何预算数值（用 fixture 数值做正则） |
| SM-01 | stateMachines | 每个状态机：表中每条迁移 `assertTransition` 通过，表外每对 (from, to) 抛错 |
| TK-01 | termsKey | 条目顺序不同的同一条款得到相同 termsKey；任一字段变化 termsKey 变化 |

## 16.3 convex-test：stub 全流程与故障注入

**主线**：FL-01 按 14.9 的 10 步执行（stub 模式、假时钟推进调度），每步断言表行（run、turn、attempt、proposal、decision、execution 的状态与数量）、事件序列、各角色 `rooms.workspace` 投影（买方 / provider 两套文案）。FL-02…FL-05 覆盖变体 B（无可行 → 请求 → provider 降价 → 执行；以及三方 decline → `negotiation_blocked`）、C、D、E。

**故障注入**（`seed.setTestFaultPlan`，10 part6 §10.21）——每个用例对应 10 part2 的失败模式：

| id | 注入 | 期望 |
| --- | --- | --- |
| RT-01 | 提议回合 attempt 1 `transport_error` | attempt 2 在 2 s × 抖动后调度；最终 accepted；两行 modelCalls |
| RT-02 | `timeout_hang`（不调用 record） | 推进到 deadline → watchdog 标 timed_out → attempt 2 |
| RT-03 | `invalid_json` 然后合法 | 第二次请求带 `retryNote`（断言渲染出的请求末尾有 system 消息） |
| RT-04 | `refusal` × 2（提议回合） | turn failed `MODEL_REFUSED` → run failed；`canProposeManually` 为 true |
| RT-05 | `max_tokens` 然后合法 | 第二次 maxTokens = 12,000 |
| RT-06 / RT-07 | `rate_limit_429`（retry-after 7 s）/ `server_500` | 延迟取 retry-after / 退避表 |
| RT-08 | `bad_request_400` | 不重试，`MODEL_BAD_REQUEST`，ops 告警日志 |
| RT-09 | `auth_401` / `billing` | 熔断打开；随后另一房间的 claim 直接 skipped `AGENTS_CIRCUIT_OPEN` |
| RT-10 | attempt 1 挂起，watchdog 后 attempt 2 成功，然后 attempt 1 迟到 record | attempt 1 只补 usage（`lateResult`），不 apply；turn 结果来自 attempt 2 |
| RT-12 | 提议回合在飞时 finance 下调上限 | 旧 run superseded；迟到结果 stale（`RUN_NOT_RUNNING`）；新 run 正常 |
| RT-13 | `record_throw` | `recordAttemptFailure` 写入；watchdog → timed_out → 重试 |
| RT-14 | `apply_throw` | watchdog 发现 received + apply failed → turn failed `APPLY_FAILED`，**没有**新的模型调用 |
| RT-15 | 汇总 RT-01…RT-09 的全部调用 | `createAnthropic()` 构造参数 `maxRetries: 0`（单测）；每个注入的 HTTP 失败恰好对应一行 modelCalls；任一 turn 的 attempt 数 ≤ 3、任一 run 的调用数 ≤ 预算 |
| RT-16 | run 调用预算设为 2 | 第 3 次 claim skipped `CALL_BUDGET_EXCEEDED` |
| RT-17 | `AGENTS_ENABLED=false` | 提议回合 skipped → run failed → 手动提案 → 执行成功（R9） |
| RT-18 | 正常完成后推进到 deadline | watchdog no-op |
| RT-19 | 评审回合 `server_500` × 3 | 记为 no_recommendation，本轮照常结束，进入审批 |
| RT-20 | 提议回合重试耗尽后 `runs.resume` | 新 turn（`resumedFromTurnId`），成功后继续；第 3 次 resume 被拒 |
| RT-21 | stub 评审始终 counter | 3 轮后 awaiting_approval（round_cap）；调用数 = 3 + 6 |
| RT-22 | 同一约束版本下连续 3 次拒绝 | 第 4 次重谈直接 waiting_human（blocked） |
| RT-23 | attempt 的 protocolVersion 改为旧值后 apply | stale `PROTOCOL_CHANGED` 并重试一次 |
| RT-24 | run 进行中关闭房间 | run cancelled，attempt skipped / stale |
| RT-26 | 调度延迟超过 deadline（先推进时钟再执行 action） | watchdog 先到；claim abort（G-C1） |
