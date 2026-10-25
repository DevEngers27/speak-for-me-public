# 10 代理运行时（part2）：失败模式总表

> 分片清单见 part1。函数与守卫编号（G-C*、G-A*）定义在 part3；重试分类与预算定义在 part4 §10.7–10.9。

## 10.5 失败模式总表

"检测"指系统在哪里发现；"之后状态"指该失败处理完后的持久状态；"测试"列对应 16 中的用例 id。

| # | 失败模式 | 检测 | 处理 | 之后状态 | 测试 |
| --- | --- | --- | --- | --- | --- |
| F01 | 模型请求超时（SDK timeout 触发） | action 捕获 `APIConnectionTimeoutError` → outcome `transport_timeout` | 计入 transport 类重试（≤ 2 次，退避 2s / 8s） | 新 attempt scheduled；用尽 → turn failed `RETRY_EXHAUSTED` | RT-01 |
| F02 | action 被平台中断（超出运行上限、部署、进程丢失），没有任何回调 | watchdog 到期时 attempt 仍为 scheduled / running | attempt → timed_out；timeout 类重试 ≤ 1 次 | 同上 | RT-02 |
| F03 | 输出格式错误（无 text 块、JSON 解析失败、Zod 失败、候选不在集合内、动作与回合类型不符） | action 内 `classifyResponse` → `invalid_output{code}` | invalid_output 类重试 ≤ 1 次，第二次请求末尾追加中途 system 消息说明错误码（不回显模型原文） | 新 attempt；再失败 → turn failed | RT-03 |
| F04 | 拒答（`stop_reason: refusal`） | 分类 → `refused{category}` | refusal 类重试 ≤ 1 次（同一请求） | 再拒答 → turn failed `MODEL_REFUSED` | RT-04 |
| F05 | 截断（`stop_reason: max_tokens`） | 分类 → `truncated` | truncation 类重试 ≤ 1 次，`max_tokens × 1.5`（上限 16,000） | 再截断 → turn failed | RT-05 |
| F06 | 429 限流 | `RateLimitError` → `api_error{status:429}` | rate_limit 类重试 ≤ 2 次，延迟取 `retry-after-ms` / `retry-after`，缺省 10s / 30s | 同上 | RT-06 |
| F07 | 5xx / overloaded / 408 / 409 | `api_error{status}` | server 类重试 ≤ 2 次，退避 4s / 15s | 同上 | RT-07 |
| F08 | 400 bad request（请求形状错误、参数被拒） | `BadRequestError` | 不重试；视为编程错误，写 ops 告警 | turn failed `MODEL_BAD_REQUEST` | RT-08 |
| F09 | 401 / 403 / `billing_error`（密钥失效、额度耗尽） | `api_error{status, type}` | 不重试；**打开全局熔断**（`systemState.agents`），之后所有 claim 直接 abort | turn failed `MODEL_AUTH` / `MODEL_QUOTA`；所有房间转入手动路径 | RT-09 |
| F10 | 同一 turn 两个 attempt 同时在飞（旧 attempt 超时后迟到） | apply 守卫 G-A2：`turn.currentAttemptId !== attemptId` | 旧结果记用量、标 stale | 不影响新 attempt | RT-10 |
| F11 | 并发启动 run（两人同时点"开始协商"，或约束变更与手动启动并发） | `startRunTx` 读 `rooms.currentRunId`，OCC 冲突重试 | 后到者看到已存在的活跃 run，直接返回它 | 恰好一个活跃 run | RT-11（真实部署并发脚本） |
| F12 | 约束在回合进行中变化 | `bumpConstraints` 同事务把活跃 run 置 superseded；之后 apply 守卫 G-A3 / G-A4 拒收 | 已 scheduled 的 attempt 尽力 `scheduler.cancel` 并标 skipped；在飞的 attempt 迟到后标 stale | 旧 run superseded，新 run 按 09 流程创建 | RT-12 |
| F13 | 模型调用成功，但 record 写回失败 | action 内 catch | 调用 `recordAttemptFailure`（只写 usage 与错误码）；仍失败 → watchdog 判 timed_out → 按 timeout 类重试（会再付一次费，受预算约束） | 新 attempt 或 turn failed | RT-13 |
| F14 | record 成功，但 apply 抛出确定性错误 | watchdog 发现 attempt 停在 received，`_scheduled_functions` 中 apply 为 failed | 不重新调用模型；turn failed `APPLY_FAILED`，保留模型输出供排查 | proposer → run failed；reviewer → 记为 no_recommendation | RT-14 |
| F15 | 重试相乘 | 设计上消除：SDK `maxRetries: 0`，只有 attempt 层重试 | 四级预算：turn ≤ 3 次、run ≤ 24 次、房间 ≤ 150 次、部署每日 ≤ `AGENT_DAILY_CALL_LIMIT` | — | RT-15 |
| F16 | 本系统调用预算耗尽（run / 房间 / 每日） | claim 守卫 G-C6 | attempt skipped `CALL_BUDGET_EXCEEDED`，turn failed（不可重试） | proposer → run failed，界面提示手动选择 | RT-16 |
| F17 | 总开关关闭（`AGENTS_ENABLED=false`）或熔断打开 | claim 守卫 G-C5 | attempt skipped，turn failed `AGENTS_DISABLED` / `AGENTS_CIRCUIT_OPEN` | 手动路径 | RT-17 |
| F18 | watchdog 在 attempt 已完成后才触发 | watchdog 读到终态 | no-op | 不变 | RT-18 |
| F19 | `scheduler.cancel` 对已完成或已开始的函数 | try/catch 吞掉异常 | 依赖 apply 守卫兜底 | — | RT-12 |
| F20 | 评审回合持续失败 | turn failed | **fail-open**：记为 `no_recommendation`，本轮照常结束 | 提案仍进入人工审批，界面显示"该方代理未给出建议" | RT-19 |
| F21 | 提议回合持续失败 | turn failed | **fail-closed**：run → failed；人可 `runs.resume`（≤ 2 次）或 `proposals.proposeManually` | failed | RT-20 |
| F22 | 代理来回还价不收敛 | round 计数 | 第 maxRounds 轮结束时停止，当前提案带"未收敛"说明进入人工审批；提议方重复提出同一候选时提前结束（proposer_held） | awaiting_approval | RT-21 |
| F23 | 人拒绝后反复重谈（拒绝循环） | 同一约束版本下由拒绝触发的 run 数（`runs` 索引 `by_room_and_constraintsVersion` 计数，04 §4.2.3） | 达到 3 次后不再自动重谈，向提议方的人发 `blocked` 请求 | waiting_human | RT-22 |
| F24 | 部署发生在 attempt 在飞期间，且协议输出形状改变 | attempt 记录 `protocolVersion`；apply 守卫 G-A6 比较当前 `PROTOCOL_VERSION` | 不匹配 → stale `PROTOCOL_CHANGED`，按 timeout 类重试 | 新 attempt 用新协议 | RT-23 |
| F25 | 房间在 run 进行中被关闭 | `rooms.close` 把活跃 run 置 cancelled | 同 F12 | cancelled | RT-24 |
| F26 | 热点文档 OCC 冲突放大 | 设计上规避：计数器放在 `usageCounters`（部署级 8 分片），不放在被守卫频繁读取的 `rooms` 上 | — | — | RT-25 |
| F27 | 调度器延迟导致 attempt 在开始前就过了 deadline | watchdog 先到：attempt scheduled → timed_out；之后 claim 守卫 G-C1 发现非 scheduled → abort | 按 timeout 类重试 | — | RT-26 |
| F28 | 目录条目标题中的提示注入 | 输出被 JSON Schema 枚举约束，只能选已有候选；理由文本只给本方看 | 影响上限被限制为"在合法候选间选择"，见 07 威胁模型 | — | PV-07 |
