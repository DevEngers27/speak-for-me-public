# 16 · 测试策略（part9：CI 闸门与变异检查、不变量、备选与否决、开放问题、与 canon 的对照）

> 分片列表见 `16-testing.md` 顶部。部署流程本身归 15；本章只定义闸门。

## 16.12 CI 闸门与变异检查

| 阶段 | 触发 | 步骤 | 密钥 |
| --- | --- | --- | --- |
| PR 闸门 | 每个 PR（含 fork） | `pnpm install --frozen-lockfile`（`catalog:`、`minimumReleaseAge: 10080` 例外清单到期检查、`allowBuilds` 只放行 `esbuild` / `unrs-resolver`）→ lint（分层 `no-restricted-imports`、引擎纯度、构造器、`no-console`、`SpreadElement`、jsx-a11y）+ 架构探针 → typecheck（应用与 `convex/tsconfig.json`，后者 `types: ["node"]`）→ codegen 漂移检查 → Vitest `core` / `convex` / `evals`（确定性）/ `web` → `next build`（按环境带变量构建） | 无 |
| PR 端到端 | 非 fork PR，受保护环境 | 预览部署 + `seed.fromFixture` → Playwright E2E-01…11 → 对录制的帧与 HTML 做 S7 扫描 | 预览部署 key、Clerk dev keys |
| main 夜间 | 合并到 main 后；改动执行 / 审批 / 调度 / 投影代码的 PR 可手动触发 | 专用 dev 部署上的 L2 探针（§16.8）→ `ConcurrencyEvidence` 与 `log_scan` 证据作为 artifact | dev 部署 key |
| 发布到 prod | 人工批准 | 要求最近一次通过的 `approve_last_two`、`approve_last_repeat`、`cap_vs_last_approval`、`join_same_role` 证据晚于最后一次触及执行 / 审批 / 调度代码的提交 → 排空（`ops.setDraining(true)`，等 `activeAttemptCount === 0` 或看门狗上界）→ `npx convex deploy` → 冒烟（`error_shape`）→ 清除 draining | prod 部署 key |
| L4 | 改提示 / schema / 模型 / effort 时手动；每周 `runtime_smoke` | §16.10 | 评测 workspace key |

第三方 Action 锁 SHA；每个 job 设超时与并发组。

**变异检查**（`scripts/mutation-check.ts`，每次发布前与改动关键守卫时运行，结果写入 `probe-results/`）：在临时工作树里逐个打补丁并运行指定用例，**用例必须变红**，否则视为无效测试、发布失败：

| 补丁 | 必须变红的用例 |
| --- | --- |
| 删除 `executeIfComplete` 中按 `by_executionKey` 的查重 | TC-EXE-01、`bypass` 步（以及下一次 L2 `approve_last_repeat`） |
| 删除 `approvals.record` 的 `run.status` 与 `expected*` 守卫 | TC-VER-01/02 |
| 删除 `turns.complete` 的 G1–G3 | TC-RUN-01/03 |
| 让 XP-5 对 provider 返回 `checks` | TC-PRIV-01/08、灵敏度对照 |

## 16.13 不变量

| ID | 谓词 | 落点 |
| --- | --- | --- |
| TI-01 | `pnpm test` 不访问网络、不需要部署、不需要任何密钥 | TD-01；PR 闸门在无密钥环境运行 |
| TI-02 | 任何"并发 / 幂等已验证"的结论都引用一份 L2 `ConcurrencyEvidence`；L1 同类用例名带 `[serial]` | TD-02、§16.4.6 |
| TI-03 | 每个公开函数都出现在 TC-AUTH-07 矩阵与 S1 / S3 扫描面（由公开函数快照驱动，新增函数自动纳入） | §16.6.1、§16.7.3 |
| TI-04 | 每个 convex-test 场景结束时 R1–R11 与 LV / EV / SF / AP 检查全部通过 | §16.5 |
| TI-05 | 脚本化模型队列恰好耗尽；需要模型的用例至少记录一次请求 | TD-04 |
| TI-06 | `[construct]` 白名单之外没有 `t.run` 写表；fixture 只走生产写入口 | TD-06 |
| TI-07 | 注册了看门狗的链路不使用 `vi.runAllTimers` | TD-05 |
| TI-08 | 反例电池每一项映射到至少一个可运行用例，或写明使其不可达的 canon 决定 | §16.11 |
| TI-09 | 每个可共享字段在至少一个金丝雀配置里对每个可能受众未披露 | §16.7.4 |
| TI-10 | `DISCLOSURE` 中每个非 room 类字段都有对应金丝雀或针脚 | §16.7.1、TC-PRIV-10 |
| TI-11 | spikes §8 的 18 项在首次 prod 部署前都有结果记录 | §16.8.1 |
| TI-12 | 测试中的金额与日期一律从 fixture 模块推出；确认顺序读 `fx.confirmOrder` | §16.4.3 |
| TI-13 | 非干扰测试的 `DECLASSIFIERS` 键集合恰为 07 的 `DECLASSIFIED`（DX-1…DX-13） | §16.7.5、TC-PRIV-05 |
| TI-14 | 活性检查 LV-1 与 04 INV-SM-03 使用同一谓词实现，不另写一份 | §16.5 |

## 16.14 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| Jest、`node --test` | 承载不了 convex-test；`.ts` 互导问题 |
| Vitest 4.1.11（techstack X6） | canon D20：spike 已在 5.0.5 实测通过 |
| 模型文本快照测试 | 当前模型不可复现，只制造噪声；只断言结构性质与分布 |
| convex-test 内 `Promise.all` 当并发证据 | convex-test 串行化顶层函数、无冲突检测 |
| `devProbe.parallel` + `asIdentity` + 公开函数"薄壳"约束 | 为测试改变 12 的写法，且绕过被测的真实鉴权路径（review r16） |
| 部署上的 `AGENT_MODE=scripted` | 生产代码里可被误开的后门 |
| nock 一类 HTTP 录制回放 | 绑死 SDK 的 HTTP 细节，升级即失效 |
| 以 insights 的 OCC 计数作 CI 证据 | 只接受用户登录、72 小时聚合（review r08） |
| `npx convex logs --history` 作阻塞步骤 | 永不退出，且只回放缓冲（review r07） |
| `AGENTS_ENABLED=false` 排空 | 把在途多步 run 全打成失败（canon D17、C34） |
| `finishAllScheduledFunctions(vi.runAllTimers)` 推进代理链路 | 看门狗与 action 竞态（review r03） |
| 把 `returns` 当运行时防线 | 校验失败消息可能回显被拦字段 |
| promptfoo | 判分要运行引擎代码，依赖面大（techstack D18） |
| v1 staging 层 | techstack D29：三层 dev / preview / prod；L2 用专用 dev 部署 |
| E2E 用密码登录、登录态落盘 | e2e-harness 只用 `+clerk_test` OTP 与内存登录态 |
| 手动季度变异检查 | 无载体会流于形式；改为脚本化、只针对四条守卫 |

## 16.15 开放问题与待验证

1. `ConvexHttpClient.setAdminAuth` 是 `@internal` API：跨版本稳定性与"从 deploy key 取得 admin key"的方式待验证（V19）；不可用时退回并行 CLI。
2. `vi.mock` 在 convex-test 模块图中是否生效（review C3，可能成立）；退路为 10 的 `setDriverForTests`。
3. 两次重放的 convex-test id 是否确定（非干扰测试已做规范化，不依赖）。
4. `@edge-runtime/vm` 长期未发版的风险；Vitest 5 下 `test.projects` 与 `server.deps.inline` 的配置位置。
5. 预览部署在当前 Convex 计划可用、回收策略、预览默认环境变量的设置方式（V9 / V20）。
6. Clerk testing token 在 CI 中对 dev 实例的实际表现（首次 CI 运行验证）。
7. supersede 时是否给每个被置 stale 的回合写事件（10 / 09 决定，测试跟随；review r04）。
8. （已关闭）R1–R11 已按 08 §8.8 写入（`internal.executions.checkInvariants`）；电池的 8 条不一致期望已由 canon 包并入 `00-invariants`（C43），§16.11.2 只留指针。
9. `start_run_repeat` 等探针与节流 ⑥ 的交互（N ≤ 5，同一用户不超限）。
10. 评测 live 模式在 dev 部署上运行时与开发者日常使用的 dev 部署隔离方式（建议专用 dev 部署，15 定）。
11. （已关闭）00-overview §0.3 已按 §16.11 的编号重写（completeness-23）。
12. （已关闭）`waitingReason: 'run_cap'` 已进入 03 §3.8 与 04 INV-SM-03，LV-1 与其共用同一谓词（TI-14），TC-RUN-26 断言该等待态。
13. （已关闭）15 §15.6.2 已定义两个 logger、`PublicOpsCode` 闭集与 `InternalCtx` 品牌，08 / 12 / 03 公开路径的调用点已改为 `publicOpsLog`；S6 以该闭集为准。

## 16.16 与 canon 的对照

本章落实的 canon 决定：

- D01：无组件 → codegen 可离线，CI 漂移检查；spikes §8 #9 标为不适用。
- D02 / D03：`expected*`、只追加、userId 两两不同、`executionKey = exec:${proposalId}`、同事务执行（TC-VER-*、TC-EXE-*、R2 / R7）。
- D04：执行后房间终态与 `startFollowUp`（TC-EXE-06、TC-AUTH-09、E2E-11、CE-108/112/118/130/168）。
- D05 / D06：递增矩阵、不递增清单、硬投影性质测试、新 run 预检保留同一 proposalId、被拒提案不复活（TC-VER-03/08/09/13/14）。
- D07：守卫 G0–G3、必 reconcile、看门狗以 `attemptId` 登记并读 `_scheduled_functions`（TC-RUN-01…04、LV-1）。
- D08：串行回合（TC-RUN-06，删除并行屏障类反例）。D09：流式、16000、白名单参数、`fallbacks` 关、schema 在 action 内构造、SDK 不重试而网关单层重试（429 / 连接错误与截断各 ≤ 1 次）、总截止早于 `WATCHDOG_FIRST_MS` 且到期不可重试（§16.4.5、TC-RULE-08、TC-RUN-05）。D10：候选快照与角色作用域（TC-RULE-07、TC-PRIV-08）。
- D11：投影、派生值污点、请求选项按目标视图、掩码、非干扰（`declassified` 恰为 DX-1…DX-13 并有元断言）、矩阵由测试自动对账（§16.7）。D12 ①–⑧（TC-PRIV-08/13/15/20、TC-AUTH-12、TC-RUN-18）；D12 ⑥ 只决定速率，总量上界由 12 B7 的每房间 24 小时桶给出（TC-AUTH-13，privacy-01；canon 原句"堵住零成本预言机"的偏离已列入 canon 异议）。D13 模板三层证明（TC-PRIV-11）。D14 事件模型（TC-PRIV-02/03），含约束变更提交对 provider 作者中立（TC-PRIV-21，privacy-02）。D15 人工请求出口与期限（TC-RUN-08…12/16/19）。
- D16：`logLines` 纪律与错误投影（TC-PRIV-06/16、`log_scan`）；公开路径只允许 `publicOpsLog` 闭集三键行（S6，privacy-10）。D17：节流、四层上限、`draining`（TC-AUTH-12、TC-RUN-14/15）。D18：seed / reset 走生产写入口、`assertTier`、`provenance`（§16.4.3、TC-OPS-02/03）。
- D20：Vitest 5.0.5、convex-test 0.0.65、glob `['./**/*.*s', '!./**/*.*.*s']`、`_generated` 入库、`@edge-runtime/vm`。D21：分层 lint 与引擎纯度探针。D22：绝对交付日、`localDate`、query 与 mutation 的规则一律读 `room.localDate`（cron 未跑时照常执行，翻转后才 bump；TC-RUN-17、TC-EXE-10，completeness-09）。D23：低于已承诺拒绝（TC-VER-10）。D24：邀请与一人一席（TC-AUTH-04/05）。D26：stub / scripted / replay 共用下游，v1 无抽取。D27：主 fixture 与变体数字（§16.10.2、§16.7.1）。U11：spikes §8 实现第 1 周逐项完成。

与已定稿章节的对齐：R1–R11 与 `checkInvariants` 取自 08 §8.8；模型接缝 `callModel`（`convex/model/agents/modelGateway.ts`）与 `setDriverForTests` 取自 10 §10.14；错误码取自 12 §12.4；`previewChange` 形状取自 12 §12.17；`approvals.record` 返回值以 `status` 判别（08 §8.5.2、12 §12.15）；节流桶取自 12 §12.2 第 7 条；`humanRequests.expireDue` 与活性谓词 INV-SM-03 取自 04；fixture 字段名、`confirmOrder` 与 canary 数值取自 14 §9.2 / §9.5；CE 编号是全设计唯一体系（§16.11）。

相对底稿的改写：agentquality 的 `paused` → `needs_input` + `agent_failed`；`catalogRevision` 守卫 → 删除（D05）；LOGIN / REPORTS / rush fixture → D27 目录；`decisions.submit` → `approvals.record`；security 的 `STALE_VIEW` / `PROPOSAL_BLOCKED` 等大写码 → 点分小写；执行后 cv + 1 的用例（TC-EXE-06 旧版）→ 执行不 bump；`AGENTS_ENABLED=false` 限额用例 → `draining` 与四层上限；`isSimulated` → `provenance`；L5 模型评估并入 L4 / `evals` project。
