# 10 · 代理运行时（part6：驱动与故障注入、失败模式总表、可观测性）

> 分片清单见 `10-agent-runtime.md` 开头。

## 10.18 驱动

### 10.18.1 接口（`convex/model/agents/drivers.ts`）

```ts
export type NormalizedResponse = {
  stopReason: string | null; stopCategory: string | null;
  text: string | null;                  // 最后一个非空 text 块（按 type 跳过 thinking 块）
  usage: Usage | null; requestId: string | null; messageId: string | null; responseModel: string | null;
};
export interface AgentDriver {
  readonly provenance: 'live' | 'stub';
  /** 只返回响应或抛 SDK 异常；分类、解析、校验全部在下游统一完成。 */
  decide(req: { input: AgentTurnInput; schema: Json; spec: TurnSpec; retryNote: ReasonCode | null }): Promise<NormalizedResponse>;
}
```

| 驱动 | 何处可用 | 行为 |
| --- | --- | --- |
| `LiveDriver` | dev / prod（`AGENT_MODE = live`） | `renderPrompt`（05 §5.13：每块按"净化 → `encodeBlock` → 加外层标签"组装，`wrapUntrusted` / `encodeBlock` 的唯一实现在 `core/engine/projection/`，本章不另写）→ `buildNegotiationRequest` → `callModel` → 归一化 |
| `StubDriver` | 所有环境；preview 唯一可用 | 05 §5.14 的确定性规则，返回 `{ stopReason: 'end_turn', text: JSON.stringify({ turn }), usage: 0, responseModel: 'stub:v1', requestId: null, messageId: 'stub:' + attemptNo }`；模拟 `STUB_LATENCY_MS`（默认 800 ms）以便界面呈现异步 |
| `ReplayDriver` | 仅测试 | 按 `(fixtureId, role, kind, roundNo)` 回放录制的 `{turn}` 文本 |
| `ScriptedDriver` | 仅测试 | 按队列返回指定响应或抛指定 SDK 异常（`RateLimitError`、`APIUserAbortError` 等）；队列耗尽抛 `ScriptExhausted` → 测试失败（防假绿） |

- 四个驱动都产出同一个 `NormalizedResponse`，之后的 `classifyResponse` → 宽松 Zod → `validateMoveSemantics` → `turns.complete` 完全相同（canon D26）。
- 选择：`driverFor(run.agentMode)` 只认 `live` / `stub`；测试通过对 `modelGateway.callModel` 这一个接缝 `vi.mock`，或用 `setDriverForTests`（只在 `DEPLOYMENT_TIER = test` 时可用）注入 replay / scripted。
- stub 的 attempt 与由此产生的提案、执行派生物 `provenance: 'stub'`；界面统一 "Simulated" 徽章（核心 8）。

### 10.18.2 故障注入（只在 `ALLOW_FAULT_INJECTION = true` 的非生产部署）

`rooms.testFaultPlan?`（03 §3.5 登记为 dev / preview / test 专用的可选字段，生产永不写入）只能由 `seed.*` internal mutation 写入（15 的 `assertTier` 守卫），形如 `[{ roundNo, role, attemptNo, fault }]`。`fault ∈ transport_error | rate_limit_429 | server_500 | overloaded_529 | timeout_abort | bad_request_400 | auth_401 | billing | refusal | max_tokens | invalid_json | schema_violation | unknown_option | context_overflow | lost_action | commit_throw`。StubDriver 命中匹配项时返回对应响应或抛对应异常；`lost_action` 不提交（配合假时钟逐个推进到看门狗，不能用一次性 `runAllTimers`，spikes §4）；`commit_throw` 让 `turns.complete` 抛错以覆盖 §10.6.2 的 catch 分支。由此 §10.19 的每一行都能在 convex-test 中确定性复现。

## 10.19 失败模式总表

"之后状态"指处理完成后的持久状态；"测试"列对应 16 的用例编号前缀 RT-。

| # | 失败模式 | 检测 | 处理 | 之后状态 |
| --- | --- | --- | --- | --- |
| F01 | 总截止到期（发送前、退避中或发送中）/ 连接超时 | `classifyError` → `timeout / model_timeout` | 不重试（截止到期一律不可重试，§10.10.1） | turn `failed` → `agent_failed` |
| F02 | action 被平台中断、部署打断 | 看门狗读到 `failed` | `action_crashed`，自动重试 1 次 | 新 attempt；再失败 → turn `failed` → `agent_failed` |
| F03 | 输出不合规（无 text、非 JSON、Zod 失败、快照外 optionKey、动作不允许、引用错误） | 05 §5.6 | `invalid_output`，带重试提示重试 1 次 | 同上 |
| F04 | 拒答 | `stop_reason: refusal` | `refused`，不重试 | `agent_failed` 请求给该角色 |
| F05 | 截断 | `stop_reason: max_tokens` | `output.truncated`，网关在同一次调用内重发 1 次；第二次截断 `retryable: false`，不再开 `auto_retry` | 同 F01 |
| F06 | 429 / 连接错误 | 网关按 `retry-after` 重发 1 次（退避 ≤ 8 s 且不超过剩余总截止）；仍失败 → `transport` | attempt 层不再重试 | 同 F01 |
| F07 | 5xx / 529 / 流中 overloaded / 408 / 409 | `classifyError` → `transport`（408 / 409 → `api_error`） | 不重试（网关只重试 429 与连接错误） | 同 F01 |
| F08 | 400 / 413 / 422 | `bad_request` | 不重试，告警（请求形状或 schema 被拒是缺陷） | `agent_failed` |
| F09 | 401 / 403 / 计费 / 缺密钥 | `auth` / `quota_exhausted` / `config_invalid`（缺密钥，`GatewayConfigError`） | 不重试，严重告警；运维视情况置 `AGENTS_ENABLED=false`（v1 不做自动熔断，§10.23 Q1） | `agent_failed` |
| F10 | 自动重试后旧 attempt 迟到 | G0 | 只补记 usage（`lateUsage`） | 不影响新 attempt |
| F11 | 两人同时 `runs.start` / 与约束变更并发 | rooms 文档 OCC | 后到者返回已有 run | 恰好一个非终态 run |
| F12 | 回合进行中约束变化 | bump 同事务 supersede；之后 G1 / G3 或 `loadTurnContext` 为 null | 迟到结果 `stale`，未开始的不调模型 | 新 run 照常推进 |
| F13 | `turns.complete` 抛错（缺陷） | action catch | `turns.fail(internal)` 记 usage，不重试，告警 | `agent_failed` |
| F14 | complete 与 fail 都抛错 | 看门狗读到 `success` 而 attempt 仍 running | `internal`；usage 只在 `opsLog` | 同上 |
| F15 | 重试相乘 | 设计消除：SDK 不重试（I6），两层按错误类别互不重叠 | 每次调用 ≤ 3 次发送，每条链 ≤ 6 次 HTTP（I4），每 run ≤ 18 个 attempt | — |
| F16 | 每 run attempt 上限 | `beginAttempt` B4 | 不建 attempt | `needs_input` + `rounds_exhausted`（`call_limit`） |
| F17 | 每 run 美元上限 | B5 | 同上 | 同上（`spend_limit`） |
| F18 | 全局日美元上限 | B6 | 延期到次日，不抛错 | run 仍 `negotiating`，回合状态不变、`waitingReason: spend_deferred` |
| F19 | 排空中 | B3 | 停泊 | 回合状态不变、`waitingReason: draining`；解除排空后 `runs.reconcile` 恢复 |
| F20 | `AGENTS_ENABLED=false` | action 内检查 | `agents_disabled`，不重试 | `agent_failed` |
| F21 | 调度积压，看门狗到期时 action 还没开始 | `_scheduled_functions` 为 `pending` | 重登记（≤ 3 次）；用尽后逻辑 `timeout`，物理租约内暴露照计、同回合重试不早于租约到期（§10.8） | 不误判；同一回合不重叠两个物理调用，迟到的 action 因 G0 不调模型 |
| F22 | 看门狗在 attempt 完成后才触发 | attempt 非 running | 空操作 | 不变 |
| F23 | 守卫命中后 run 没有在途工作 | 提交路径调用 `runs.reconcile` | 重新调度 / 补开回合 / 转 `needs_input` | 永不停在无出口的 `negotiating` |
| F24 | 不兼容部署时有 attempt 在途 | 由排空纪律避免；万一发生，提交参数校验失败 | 走 F13 | `agent_failed` |
| F25 | run 被取消或房间关闭 | 04 把非终态回合标 `stale` | 迟到结果 `stale` | 终态 |
| F26 | `spendCounters` 当日行 OCC 冲突 | 平台自动重试 | v1 接受；冲突率上升后分片 | — |
| F27 | 目录标题注入 | 05 §5.13 定界 + 枚举约束 | 影响上限是"在合法选项间选择"，counter 信道 ≤ 3.6 bit / 次 | — |
| F28 | 上下文溢出 | `stop_reason: model_context_window_exceeded` | `context_overflow`，不重试，告警（07 的上下文裁剪缺陷） | `agent_failed` |
| F29 | 意外的缓存未命中 | §10.17 断言 | 只记日志 | — |
| F30 | 任何原因导致的卡住 run | `ops.livenessSweep`（每 5 分钟） | `runs.reconcile` + 告警 | 恢复或转 `needs_input` |
| F31 | 房间 24 h 内系统开局的 run 超过 `run_starts` 上限 | `beginAttempt` B6a | 首回合延期到窗口滑出，不抛错 | run 仍 `negotiating`，回合状态不变、`waitingReason: run_cap`、`beginFnId` pending |
| F32 | 链已用尽的回合被重派（缺陷） | `beginAttempt` B4a | 回合 `failed`，告警 | 失败方的 `agent_failed` 请求 |
| F33 | 房间钉住的场景版本已不在注册表（违反 15 §15.5.1 的迁移纪律），而 reject 后要建下一回合 | 04 U1 `createTurnTx` 的场景版本前置（`scenarioOf(room)` 不可解析） | 不建回合、不调模型 | run `needs_input` + 本应行动角色的 `agent_failed`（只有 `end_run`）；08 S5 只拦 approve，reject 本身照常成功 |

## 10.20 可观测性

- **日志白名单**（`opsLog(ctx, code, SafeLogFields)`，签名与白名单以 15 §15.6.2 为唯一定义，canon D16）：`evt`、`roomId`、`runId`、`turnId`、`attemptId`、`role`、`kind`、`attemptNo`、`origin`、`status`、`reasonCode`、`errorCode`、`httpStatus`、`latencyMs`、`inTok`、`outTok`、`cacheReadTok`、`cacheWriteTok`、`thinkingTok`、`costMicroUsd`、`provenance`、`schemaVersion`、`promptVersion`、`staleGuard`。禁止：提示、上下文、模型原文、`rationale`、简报字段、提案金额、请求头（含 `authorization`）。Zod 失败只记 issue 路径（未知段替换为 `*`）。
- **公开函数**里禁止 `console.*`（`logLines` 会随响应发给调用者浏览器，dev 已实证、prod 待验证）；运行时函数全是 internal，同样只走 `opsLog`。
- **告警**（ops 级别 error）：`bad_request`、`auth`、`quota_exhausted`、`model_not_found`、`context_overflow`、`unexpected_stop`、`config_invalid`、`internal`、`turn_commit_threw`、`constraints_drift`、巡检发现卡住的 run、当日美元超过全局上限的 80%、`cache_miss_unexpected` 比例异常。
- **用户可见的运行时状态**（13 订阅按角色裁剪的 query）：回合级 "Provider agent drafting…" / "Retrying" / "Taking longer than usual" / "Agents paused until tomorrow" / "Simulated"；attempt 明细只对本方成员可见（07 的 `restrictedRef`），永不返回 `rawOutputRef` 的内容。
