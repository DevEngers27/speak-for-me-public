# 02 审查设计发现 · part9：10 代理运行时（一）生命周期、编排、上限、延迟

> 分片清单见 part1。

### F10.1 平台事实：scheduled action 至多一次、不重试
- `node_modules/convex/.../scheduler.d.ts:18-21` 写明 scheduled action "execute at most once ... not retried"；action 与 mutation 不在同一事务（README.md:211）。原设计没有 try/catch、失败状态和恢复机制，action 抛错后房间会永远停在 negotiating。
- 来源：architecture-06、P14。

### F10.2 run 生命周期（自建方案，审计员修正版）
- `startRun` 幂等：当前 run 仍在 negotiating 时直接返回它；只有房间成员能触发。
- `runTurn` action 整体包 try/catch：成功调 `completeTurn`，失败调 `failTurn`。
- `completeTurn` 在同一个 mutation 里先过回合持久化守卫（F04.2），再写结果（agentTurn、可能的新 proposal、事件）并调度下一回合，两者原子完成。持久化放在独立的 mutation 里，不放在模型 action 内部，否则持久化失败会触发重复付费的模型调用。
- `failTurn` 记录 errorCode，turn → failed，run → needs_input 或 failed，写事件。
- `retryTurn`：沿用同一 turnSeq，attempt + 1；界面在 failed 状态显示 "Retry turn"。
- 应用级自动重试最多 1 次（只针对 invalid_output 与可重试失败）。
- 看门狗：startTurn 时 `runAfter(60_000, internal.agents.turnWatchdog, {turnId})`，60 秒后仍 running 就置 failed。原建议降为 P1；【改写】应纳入 v1。整理者理由：action 超时或被部署打断时不会进入 catch，房间会卡住（具体行为待验证）。
- 部署会打断进行中的 action（Workflow 下还会触发确定性错误），运维上要求有活动 run 时不部署（见 15）。
- 来源：architecture-05/-06、code-08、gap3-05（P14 第 2 点）。

### F10.3 编排：自建 vs 组件（需要 ADR）
- 三个选项：(1) 基于 `ctx.scheduler` 自建；(2) `@convex-dev/workflow`（+workpool、convex-helpers；审查时 0.4.10，peer convex ^1.46）；(3) 再加 `@convex-dev/agent`（0.7.8，必需 ai ^7 与 @ai-sdk/*）。只需要重试时 action-retrier（0.3.1）更轻。黑客松默认 (1)；【改写】无时间约束时按 ADR 决定（见 18），以下事实供决策：
- Workflow：每个 run 一个 workflow，workflowId 当 runId；每回合先 `step.runAction(turn)` 再 `step.runMutation(validateAndPersist)`；显式写 maxAttempts，且只有一层负责重试；处理函数必须确定性，部署时改 step 结构或参数会让正在跑的 workflow 失败（determinism violation）；取消不会中断进行中的 action，迟到写回仍要在 mutation 层拒收；需要 `convex/convex.config.ts`。
- Agent 组件：不推荐。要把模型调用换成 Vercel AI SDK，与 `@anthropic-ai/sdk` 并存；若仍采用，线程必须按 room×role 隔离（共用一个房间级线程时，默认 recentMessages=100 会把线程里已存的消息带进每个代理的上下文），`searchOtherThreads` 必须保持 false（开启后会跨同一 userId 的所有线程检索）；它提供的 usage 只有 token。
- 无论哪条路都要自建：每房间一个活动 run、迟到写回拒收、私密过滤、延迟与成本统计。组件只覆盖约一半缺口（gap3-06）。
- 来源：gap3-01…gap3-07、architecture-13（P14 第 1、3、4 点，红队修订第 6–7 条）。

### F10.4 重试与超时只写一份预算
- 问题：重试分多层会相乘：3 轮 × 3 角色 × 3 次 step 尝试 × 2 次 SDK 尝试 = 54 次调用。原客户端 `timeout: 30_000` 覆盖了 SDK 按 max_tokens 计算的超时，`maxRetries: 1`（`convex/lib/anthropic.ts:12`），是在选模型之前定的；超时属可重试错误，一个慢回合要约 60 秒加退避才最终失败，期间两次请求可能都已在服务端生成 token。
- 建议方案（红队修订）：传输层重试只由一层负责（自建路线 SDK `maxRetries: 2`、默认 timeout 60–90 s；Workflow 路线 SDK 设 0）；应用级只对 invalid_output/失败自动重试 1 次；交互路径单次 timeout 15–20 s。把"最坏调用数 × 单次超时"算出来写进延迟预算，超出就改参数。最坏调用数写成常量，用量记录带 attempt 序号；超时重试单独计数。
- 来源：gap3-05、gap2-04、architecture-06、code-17（P13 第 3 点红队修订）。

### F10.5 调用上限与总开关
- 只有房间成员能触发回合；每房间调用上限（约 30 次）记在 runs.callCount，调用模型前由 internalMutation 原子 +1，超限进入 needs_input 并提示。
- 全局开关：Convex 环境变量 `AGENTS_ENABLED=false` 时 action 开头直接返回，界面给明确提示。
- 每日全局上限：审查认为单文档计数在并发下有 OCC 冲突、收益小，可选；【改写】若需要，用按日分片的计数文档，或以模型供应商控制台的 workspace 花费上限为准，二者都写进 15。
- 开发与生产用不同 key、不同 workspace，各设花费上限。
- 来源：security-12、docs-17、M11（P14 第 2 点红队修订第 5 条）。

### F10.6 延迟预算与回合可视化
- 审查给出的目标："per agent turn p95 <= 8 s; post-change negotiation <= 3 turns, <= 30 s total; each turn persisted and rendered live; per-call timeout 15–20 s, then recoverable failure."
- 手段：限 max_tokens（先给 thinking 留余量，见 part10）；结构化输出避免格式重试；选账户实际可用的低延迟模型并显式设 effort；customer 与 finance 并行评估（F05.5）；可行组合由代码枚举使 prompt 很短；无可行解直接生成人工请求，不调模型；界面显示每个代理的回合状态（"Provider agent drafting…"），不做 token 级流式。
- 实际延迟取决于所选模型，必须用最终模型实测（至少 10 次，记 p50/p95）后再定参数（待验证）。
- 来源：product-07、architecture-14、docs-08、gap4-01（P12 第 1–2、6 点）。

### F10.7 stub 模式
- `AGENT_MODE=stub`：确定性 stub 读目录，按固定规则返回"预算内能装下的最大 required + should 组合"，与真实代理共用同一个输出 schema 和全部后续流程。用途：无模型额度的开发、确定性测试、演示降级。stub 产生的回合在数据与界面上标注 simulated。
- 来源：P11 第 1 点、P5 第 7 点。

### F10.8 预跑与回放必须标注
- 预先跑好的协商结果、由真实运行存档生成的快照，展示时要标注来源（如 "recorded run at HH:MM"、"seeded from run <id>"），不能让人以为是现场生成。
- 来源：architecture-14（Claims 规则）、P12 第 3–4 点。

### F10.9 运行时与文件布局
- 代理 action 可以用 Convex 默认 isolate 运行时：审计员按 Convex 打包参数本地 esbuild 打包，0 错误 0 警告。放在 `convex/agents.ts` 一类文件，不要放 `convex/actions/` 目录（据 gap2-08，在该目录下缺 "use node" 会直接报错，待验证）；只有真实推送失败才改 "use node"，并把 internal mutation 拆到别的文件。
- 模型调用拆成只依赖 zod 和 SDK 的纯模块：`buildAgentPrompt(brief, sharedFacts, history)` 与 `callModel()`，可在 Convex 之外用脚本直接调试（`node --env-file-if-exists=.env.local scripts/try-agent.ts`）。
- 来源：gap2-08、P11 第 4 点、P13 第 8 点。
