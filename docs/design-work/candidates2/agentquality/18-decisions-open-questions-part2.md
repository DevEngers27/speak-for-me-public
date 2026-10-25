# 18 决策记录与开放问题（第 2/2 部分：ADR-11 至 ADR-19、开放问题、待验证）

### ADR-11 手写 JSON Schema 保留 enum；用 `messages.create` 而非 `parse`
- 背景：SDK 1.1.0 的 `zodOutputFormat` 把 enum / const 降为描述文字；`parse()` 失败抛错并丢失 usage（inputs/04 §4.4）。
- 决定：`TurnSpec` 同源生成 JSON Schema（含候选 enum）与 Zod；`create` + 先查 stop_reason + `safeParse` + `checkDecision`；扁平 schema 作为退路。
- 后果：候选键受解码约束（待验证 #6）；需维护一个小型 schema 生成器与快照测试。

### ADR-12 预算低于已承诺额时直接拒绝更新（与审查 F06.3 不同，与 RA-R10 一致）
- 选项：A 允许并进入 needs_input；B 拒绝。
- 决定：B。已承诺是内部记录，低于它意味着要修订已执行变更单，v1 不支持（17）。
- 后果：BUDGET_BELOW_COMMITTED 只是 budgets.update 的错误码；规则检查中保留同名码作为防御。

### ADR-13 模型与 effort
- 决定：`claude-opus-5-5`，`effort: "medium"` 显式设置，不传采样参数 / thinking / tool_choice / prefill；`max_tokens 8000` 非流式。Sonnet 5.5 / Haiku 5.5 只作为用户决策选项（技能规定不得自行降级）。服务端回退在待验证 #7 通过后开启。
- 后果：每 run 估算成本约 $0.5–1.5（inputs/04 §4.10 量级）；延迟需实测。

### ADR-14 回合失败使 run 进入 paused 而非终态 failed
- 决定：paused 可由成员 retry（受调用上限）或 owner cancel。
- 后果：没有死路（RA-B16）；需要 UI 显示原因。

### ADR-15 硬违规的代理提议不插入 proposals
- 决定：只记 turn（`blocked_by_rules` + validation）与公共事件。
- 后果：proposal 版本号只给"进入评审的内容"；追溯仍完整。

### ADR-16 人工请求用完整实体 humanRequests（而非 optionGroupId 轻量版）
- 后果：可追溯、可取消、绑定约束版本；多一张表。

### ADR-17 审批区分 terms 与 budget 两类签核
- 后果：provider 不为客户内部预算背书；界面文案区分；完成判定按 (role, kind) 集合。

### ADR-18 房间首次协商前的简报 / 目录确认不递增约束版本
- 规则："存在任意 run 之后，任何硬约束变化都 bump"。后果：版本号语义清晰（只服务于使审批失效）。

### ADR-19 并行 counter 冲突按场景 counterPriority 裁决（首个场景 customer > finance）
- 理由：范围与日期由 customer 拥有；finance 的预算已由代码硬保证。被弃用的 counter 记为 `counter_unused`，下一轮该角色仍可再次 counter。

## 开放问题

| # | 问题 | 当前倾向 |
| --- | --- | --- |
| Q1 | effort 用 low 还是 medium | 由 live 评测决定；不换模型 |
| Q2 | 候选列表给模型时是否包含系统排序提示 | 当前不给分数，只给事实 flags；评测比较 |
| Q3 | maxRounds 4 / modelCallLimit 16 是否合适 | 依评测的回合数分布调整 |
| Q4 | 报价与审批是否需要有效期 | v1 不做；目录项预留 `validUntil`，过期视为约束变化 |
| Q5 | customer 是否应能看到 finance 的软余量偏好 | 当前否 |
| Q6 | provider 由谈判结果推断余量（T7）是否需要缓解（例如批量揭示） | 当前接受 |
| Q7 | 是否保留 finance 的模型调用 | 当前保留（10 §10.16），评测看其 counter 是否有价值 |
| Q8 | 清晰的"不达成"出口文案与后续动作 | `no_change` → run canceled，房间可再次 start |
| Q9 | 评测中 oracle 偏好排序是否需要人工标注 | 首个场景用公式；第二场景前评估 |

## 待验证（实现前用最小实验确认，结论回填 10 / 15）

| # | 事项 | 影响 |
| --- | --- | --- |
| P1 | 结构化输出是否接受 `properties.decision.anyOf` 内带 `enum` 的分支（inputs/04 #6） | 选 union 或 flat schema |
| P2 | Opus 5.5 medium 的回合 p50 / p95（#5） | SDK timeout、watchdog、延迟目标 |
| P3 | Convex action 最长运行时间（#1） | 最坏墙钟预算 |
| P4 | SDK 在 Convex 默认运行时的打包与长请求（#4） | 是否 `"use node"` |
| P5 | `fallbacks` 与 `output_config.format` 同用（#7） | 是否开启回退 |
| P6 | mutation 中 `Date.now()` 与 `crypto.subtle` 的语义 / 可用性 | today 计算、contentHash 实现 |
| P7 | `Intl.DateTimeFormat` timeZone 支持 | 房间时区 |
| P8 | convex-test 对 `v.commitTs()`、调度推进的支持（#14） | 测试写法 |
| P9 | Clerk Convex JWT 是否带 name | 显示名来源 |
| P10 | SDK 内部重试的失败尝试是否计费（#10） | 成本报告口径 |
