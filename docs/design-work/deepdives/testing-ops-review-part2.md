# 反驳评审：测试策略与运维（part 2/3）

> 问题 r01–r10。每条：问题 → 证据 → 建议修复。严重度：blocker / high / medium / low。

## r01 [high] 模型接缝 `callModel` 在 10 里不存在，且三处路径互不一致
- **问题**：TD-3、§3.3、INJ-02/03、L0 静态检查都依赖"所有 Claude 调用经过单一模块 `callModel`"。但 run-lifecycle 的 `runTurn` 在 action 内直接 `new Anthropic(...)` + `client.messages.create(...)`，stub 分支直接调 `stubAgent(tc)`，两条路径都不经过任何可替换模块。testing-ops 内部的路径也不统一：TD-3 写 `convex/agents/modelClient.ts`，§3.3 写 `vi.mock("../agents/modelClient")`，`scripted-model.ts` 的注释写 `../agentRuntime/modelClient`，`stale-turn.test.ts` 写 `./modelClient`。
- **证据**：`RL:runTurn.ts:37-43`（`new Anthropic`、`client.messages.create`）、`:27-31`（stub 分支）；testing-ops.md TD-3、part3 §3.2 末条与 §3.3。
- **修复**：由 10 定义唯一接缝 `convex/agentRuntime/modelClient.ts`：`export async function callModel(req: TurnRequest, opts: { signal: AbortSignal }): Promise<ModelCallResult>`。`ModelCallResult` 取 SDK `Message` 的最小子集：`stop_reason`、`content`、`usage`（四项 token）、`model`、`_request_id`，让 `runTurn` 后续的 `stop_reason` 检查和 `safeParse` 逻辑不变。`runTurn` 只通过它调模型；L0 静态检查的白名单、`vi.mock` 路径、`scripted-model.ts` 统一用这一个路径。stub 不放进 `callModel`，保持 run-lifecycle 现有的独立分支（它本来就不该假装调用了模型）。

## r02 [high] 测试环境把 `AGENT_MODE` 设成 stub，脚本化模型永远不会被调用
- **问题**：`vitest.config.ts` 注入 `AGENT_MODE: "stub"`。startRun 把它快照进 `run.agentMode`，`runTurn` 走 `stubAgent`，`enqueue(...)` 的脚本不会被消费，STALE-02、RUN 组、INJ-02/03 实际测的是 stub。要走 live 分支，又同时需要 `AGENTS_ENABLED=true`、TD-3 的"live 需要 key"不变量，以及 §4.2 的配置自检（缺 key 就 `config_invalid`）。现有配置下脚本化模型无法触达，而用例仍可能"变绿"：STALE-02 的 `every(status !== "succeeded")` 在 stub 回合被看门狗或别的路径打断时同样成立。
- **证据**：`testing-ops/vitest.config.ts` 的 `env`；`RL:runTurn.ts:27-36`；testing-ops.md TD-3 的不变量；part5 §4.2 的启动自检。
- **修复**：convex 项目的测试环境改成 `AGENT_MODE=live`、`AGENTS_ENABLED=true`、`ANTHROPIC_API_KEY=test-not-a-real-key`、`DEPLOYMENT_TIER=test`；需要 stub 的用例用 `vi.stubEnv("AGENT_MODE", "stub")`，在调用 startRun 之前设置。再加两条"防假绿"纪律：`afterEach` 断言脚本队列已被耗尽（`assertScriptConsumed()`）；需要模型的用例断言 `recordedRequests.length > 0`。配置自检对 `DEPLOYMENT_TIER=test` 只校验"key 存在"，不校验前缀。

## r03 [high] 计时推进写法会触发看门狗竞态；STALE-02 的回合根本不会启动
- **问题 1**：`t.finishAllScheduledFunctions(vi.runAllTimers)` 在等待期间会反复调用 `advanceTimers`。`vi.runAllTimers` 不看延迟、一次触发所有待定计时器，于是 `WATCHDOG_DELAY_MS` 的看门狗和 `appRetryDelayMs` 的重试会跟 `runAfter(0)` 的 `runTurn` 同时启动。看门狗 mutation 往往先于 action 的 `completeTurn` 拿到锁，把回合判成 `timeout` 并自动重试。RUN 组的回合链会出现非确定性的超时。
- **问题 2**：`finishInProgressScheduledFunctions()` 只等待已经 inProgress 的函数。STALE-02 在 fake timers 下调用 startRun 之后没有推进计时器就直接调用它，此时没有任何函数在执行，回合不会运行，后面的断言没有意义。
- **证据**：`CT:dist/index.d.ts` 两个方法的注释（"1. Use vi.runAllTimers() or similar to advance time such that a function is scheduled. 2. Use finishInProgressScheduledFunctions()"）；`CT:dist/index.js:2540-2595`（等待期间循环调用 `advanceTimersIfActive()`）；`RL:mutations.ts:114-128`（看门狗见 running 即判失败）。
- **修复**：`convex/test/setup.ts` 提供 `drainDue(t)`：循环执行 `vi.advanceTimersByTime(0)` 和 `await t.finishInProgressScheduledFunctions()`，直到没有到期的任务，只推进"现在到期"的函数。看门狗用例显式 `vi.advanceTimersByTime(WATCHDOG_DELAY_MS)`；重试用例显式推进 `appRetryDelayMs`。有看门狗的链路禁用 `vi.runAllTimers`。如果要用 `finishAllScheduledFunctions`，传 `() => vi.advanceTimersByTime(0)`。

## r04 [medium] STALE-01 的断言和调用签名都与 run-lifecycle 不符
- **问题**：在 run-lifecycle 里，`updateBudget` → 09 `bumpConstraints` → `supersedeRun` → `staleRunningTurns`，已经把 running 回合置为 `stale`（`errorCode: "run_superseded"`），**不写事件**。之后迟到的 `completeTurn` 守卫 G0 失败，走 `discardStale(G0)`：不改状态、不写 `turn_rejected_stale`，只记 `modelCalls(outcome: discarded_stale)`。所以 `staleEvents.length === 1` 必然失败。另外，测试给 `completeTurn` 传 `{ turnId, rawText, stopReason }`，§3.5 正文写 `{ turnId, output }`，run-lifecycle 的签名是 `{ turnId, output: agentModelOutputV, usage: usageV }`。convex-test 会做参数校验，测试直接抛 `ArgumentValidationError`。
- **证据**：`RL:lifecycle.ts:125-141`；`RL:mutations.ts:83-89, 150-160`；`testing-ops/stale-turn.test.ts`。
- **修复**：STALE-01 改为断言 `turn.status === "stale"`、`errorCode === "run_superseded"`、存在一条 `modelCalls.outcome === "discarded_stale"`、`proposals` 行数不变、新 run 的首回合存在。另加 STALE-03 专测守卫本身：用 `t.run` 直接改 `room.constraintsVersion`，不走 supersede（这是测试里的状态构造，不是后门），再调 `completeTurn`，断言回合变为 `stale` 并写入一条 `turn_rejected_stale`。"supersede 时是否给每个被 stale 的回合写事件"属于 10 与 09 的决定，应在 18 中登记，测试跟随该决定。

## r05 [medium] 调用上限的去向与 10 冲突
- **问题**：RUN 组写"`callCount` 达上限进入 `needs_input`"，run-lifecycle 是 `reserveCall` 返回 `call_cap_reached` → run `failed`（`endedReason: "call_cap_reached"`），只能 cancel 后重开。
- **证据**：part3 §3.4 RUN 行；`RL:lifecycle.ts:41-44, 160-167`；`RL:state.ts:74`。
- **修复**：以 10 为准，或者在 18 中把"达上限后转人工"立为开放问题。测试应从 `ERROR_POLICY` 表驱动生成，不要另抄一份语义。

## r06 [high] 排空流程会把所有在途多步 live run 打成 failed
- **问题**：TD-11 / §4.6 用 `AGENTS_ENABLED=false` 排空。在 run-lifecycle 里这是 kill switch：`scheduleAttempt` / `reserveCall` 返回 `agents_disabled`（不自动重试），随后 `failRun`；`runTurn` 在调模型前再查一次，回合 `failed`（E8："run failed；重新打开后 Retry"）。所以排空期间，任何需要下一步的 run 都会失败。`activeTurnCount` 归零是因为回合被判失败，不是因为跑完了。每次生产发布都会制造一批用户可见的失败 run，与 TD-11 "把被打断变成例外"的目标相反。此外它依赖 V12（env 变更何时生效），而 V12 未验证。
- **证据**：`RL:lifecycle.ts:20,44`；`RL:runTurn.ts:34-36`；`RL:state.ts:73`；run-lifecycle-part3 E8。
- **修复**：把"排空"和"kill switch"分成两个语义。在数据库里放一个运维文档 `opsFlags.draining`（mutation 写，事务内可见，L1 可测，不依赖 env 生效时机）：draining 时 `startRun` 拒绝新 run（`agents_draining`，界面提示"维护中，稍后重试"），已有 run 照常推进。排空的等待条件改为 `activeRunCount === 0`（`ACTIVE_RUN_STATUSES` 中带在途回合的 run），超时上限为看门狗期限乘以剩余步数的上界；超时后照常部署，由看门狗兜底。部署完成后清除 draining。`AGENTS_ENABLED` 只保留紧急止血用途。

## r07 [medium] `log_scan` 用的 `npx convex logs` 永不退出，回放也不完整
- **问题**：`npx convex logs --history 1000 --jsonl` 是 `for (;;)` 的轮询流，CI 步骤会一直挂到 job 超时。`--history` 只回放服务端缓冲里现存的最近 n 条，整轮流程早期的日志可能已被挤出，"零命中"可能只是没扫到。
- **证据**：`NM:convex/src/cli/lib/logs.ts:62-147`；`NM:convex/src/cli/logs.ts`（summary "Watch logs"）。
- **修复**：探针在流程**开始前**后台启动 `npx convex logs --jsonl` 子进程，持续收集到文件；流程结束后再等待约 10 秒让尾部日志到达，然后 kill 子进程，把收集到的 JSONL 交给 `canary-scan`。证据里记录收集到的条目数与时间范围，条目数为 0 判为失败（防假绿）。log streams 可用后再切换（C17）。

## r08 [medium] `occRetriesObserved` 在 CI 中不可得；方法 (b) 也无法按 requestId 区分子调用
- **问题**：insights 拒绝 deploy key 和 project key，只能由已登录用户人工查询，而且是 72 小时聚合。此外 action 内各 `runMutation` 的 `getRequestMetadata().requestId` 与父 action 相同（`meta.ts` 注释："Functions called from within a function … will have the same request metadata as the parent function"），方法 (b) 无法用 requestId 把 OCC 事件对应到具体子调用。
- **证据**：`NM:convex/src/cli/insights.ts:129-137`；`NM:convex/src/server/meta.ts:101-110`。
- **修复**：证据结构里 `occRetriesObserved` 在 CI 中恒为 `"unknown"`，不参与 pass 判定。重叠的证明改为客户端侧记录：每次调用的发起与返回时间，计算最大并发重叠数，`maxOverlap >= 2` 才算有效样本。需要 OCC 证据时，由人工执行 `npx convex insights --details --json`，按 CLI 方法的 request_id 关联。

## r09 [medium] 预览部署的环境变量和 E2E 成员身份没有来源
- **问题**：新建的预览部署从项目的"预览类型默认环境变量"取变量（`npx convex env default set --type preview`）。文档没有要求设置 `CLERK_JWT_ISSUER_DOMAIN`、`DEPLOYMENT_TIER=preview`、`AGENT_MODE=stub`、`AGENTS_ENABLED`。缺 issuer 时推送失败；缺 tier 时 `assertTier` 按 fail-closed 拒绝，`--preview-run seed:e2eRoom` 失败，而这时函数已经推送，CLI 以 exit 1 结束。`seed.e2eRoom` 要用 E2E 账号的 tokenIdentifier（`<Clerk issuer>|<user_id>`），但 §4.2 只把 E2E 邮箱和密码放在 CI 密钥里，Convex 部署拿不到。`--preview-run` 以 `{}` 参数、无身份调用。E2E-03 用 CLI 查计数时，还需要 `--preview-name <branch>`（隐藏选项）配合预览部署 key。
- **证据**：`NM:convex/src/cli/envDefault.ts`；`deploy.ts:372-385`；`lib/command.ts:199-205`。
- **修复**：§4.1 / §4.2 增加"预览默认变量清单"。新增 `E2E_CUSTOMER_SUBJECT` / `E2E_PROVIDER_SUBJECT` / `E2E_FINANCE_SUBJECT`（Clerk 用户 ID，不是密钥），配为预览默认变量。`seed.e2eRoom` 不收参数，从这些变量拼 tokenIdentifier。文档写明 `--preview-run` 失败时的部署状态，以及 CI 的处理方式：失败即整个 job 失败，下次 push 由 `--preview-create` 重建。
