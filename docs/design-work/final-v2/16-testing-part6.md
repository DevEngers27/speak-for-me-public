# 16 · 测试策略（part6：L2 真实部署、L3 端到端）

> 分片列表见 `16-testing.md` 顶部。

## 16.8 L2：真实部署

### 16.8.1 spikes §8 的 18 项逐项分配（U11：实现第 1 周完成，结果写入 `probe-results/<date>-<probe>.json` 并回填 18 的待验证清单）

| # | 待验证项 | 探针 / 用例 | 层 | 负责章节 | 通过标准 |
| --- | --- | --- | --- | --- | --- |
| 1 | OCC：并发 `approvals.record` / `runs.start` / `invites.accept` 在空索引区间上，后提交者冲突重试并看到前者插入 | `approve_last_two`、`approve_last_repeat`、`approve_same_user`、`start_run_repeat`、`join_same_role`（§16.8.2） | L2 | 08、03、10 | 有效样本 ≥ 10 且全部满足不变量 |
| 2 | 被调度 action 至多一次、不重试；被调度 mutation 瞬时错误重试 | `scheduler_semantics`：dev-only internal action 按开关抛错，观察 `_scheduled_functions` 为 `failed` 且无第二次执行；mutation 瞬时错误无法注入，记为"依赖平台文档" | L2 | 04、10 | 观测与设计假设一致 |
| 3 | 生产中被调度函数无调用者身份 | `scheduled_identity`：已登录 mutation 调度的 dev-only 函数记录 `getUserIdentity() === null` | L2 | 07、12 | 为 `null`（设计不依赖） |
| 4 | 事务限额、action 超时、`ConvexError` data 到达前端的形状 | `limits_probe`（dev-only 函数在最大 fixture 上运行执行 helper 并读 `getTransactionMetrics()`）；`error_shape`：未登录调用公开 mutation，dev 与 prod 各一次，断言 `data.code === 'auth.unauthenticated'`（对 prod 无副作用） | L2 | 10、12、13 | 余量 ≥ 10 倍；data 原样到达 |
| 5 | `NaN` / `Infinity` 写入 `v.number()` | `nan_probe`：经公开 mutation 传入，断言代码层 `amount.out_of_range`；平台存储语义只记录 | L2 | 03、06 | 代码拒绝 |
| 6 | 默认运行时 `crypto.subtle` / `getRandomValues`、`"use node"` 差异 | `runtime_probe`：dev-only query / mutation / action 记录 `crypto.getRandomValues`、`crypto.subtle.digest`、`Intl.DateTimeFormat(…, { timeZone })`（V-D2）、`normalize('NFKC')`、正则后行断言是否可用 | L2 | 07（邀请）、06 / 09（时区）、07（`wrapUntrusted`） | 记录结论并据此删除或保留退路 |
| 7 | zod 进入 Convex 包后的体积与冷启动 | `bundle_probe`：部署输出体积 + stub 模式下 `agents.runAttempt` 首调延迟 | L2 | 10、11 | 记录 |
| 8 | 真实 codegen 与入库 `_generated` 一致 | CI `codegen_drift`：连 dev 部署跑一次 `convex dev --once` 后 diff | L2 | 11 | 无 diff |
| 9 | 组件的中断 / onComplete / cancel 语义 | **不适用**：v1 无组件（D01）；升级 workpool 时重开 | — | 10 | — |
| 10 | 客户端断线重发、响应式推送、`_creationTime` 与提交顺序、`commitTs` 唯一性 | E2E-02 / E2E-04；`commitTs_probe`：多房间并发写事件，检查跨事务 `(commitTs, seq)` 是否唯一（决定 L1 迁移的 UNIQUE 键，techstack O4） | L3 + L2 | 03、13 | 记录结论 |
| 11 | 真实 WebSocket 负载、日志、`ConvexError` 消息的金丝雀扫描；dev 上观察 `logLines` | TC-PRIV-18、`log_scan`（§16.8.3） | L3 + L2 | 07、16 | 零命中 |
| 12 | Clerk 真实登录到 Convex token、`aud` / `applicationID`、`email_verified` claim；缺变量推送报错形态 | E2E-08；对一次性 dev 部署推送缺 `CLERK_JWT_ISSUER_DOMAIN` 的配置 | L3 + L2 | 07、11、15 | 登录可用；推送失败 |
| 13 | API 接受 strict schema（`anyOf` 分支内 `const`、`format: date`、多分支、体积） | `schema_accept`：每个 `(role, turnKind, n)` 一次真实调用（dev key） | L4 | 05、10 | 无 400 |
| 14 | 解码是否真正强制 `const` / `enum` / `additionalProperties: false` | 诱导性提示批量调用，统计 `output.schema_violation` | L4 | 05、07 | 记录比率 |
| 15 | effort、thinking token、`max_tokens: 16000` 是否够用、拒绝率与 schema 违规率 | 评测 live 模式每路径 ≥ 10 次（§16.10） | L4 | 10、15 | 进入门槛表 |
| 16 | 网关重试前失败的 HTTP 尝试（429 / 连接错误）是否计费；`model_context_window_exceeded` 触发条件；`fallbacks` + `output_config.format` | live 批量 + 账单核对；`fallbacks` 保持关闭 | L4 | 10、15、17 | 记录 |
| 17 | 注入 soft 断言；真实模型是否只引用给定 `optionKey`、是否倾向 `escalate` | 评测 `E-INJ-*`、TC-INJ-09 | L4 | 05、07、16 | 门槛表 |
| 18 | GitHub 上 CI 实际运行；`pnpm dev` / Turbopack HMR | 推到测试仓库跑一次 | CI | 11、15 | 全绿 |

### 16.8.2 并发探针：单进程多 `ConvexHttpClient`

目标部署：专用 dev 部署（`DEPLOYMENT_TIER=dev`；v1 无 staging，techstack D29）。状态准备同样走生产写入口（`seed.fromFixture` 经 `--identity`，再用公开 mutation 推到"最后一票之前"）；计数用 `internal.testing.roomCounts`（`assertTier` 拒绝 prod）。

```ts
// scripts/probes/concurrency.ts（tsx）
const clients = actingIdentities.map((identity) => {
  const c = new ConvexHttpClient(DEPLOYMENT_URL);
  (c as unknown as AdminAuthable).setAdminAuth(ADMIN_KEY, identity);   // @internal API：类型断言；跨版本稳定性待验证
  return c;
});
const results = await Promise.all(clients.map(async (c, i) => {
  const t0 = performance.now();
  try { const value = await c.mutation(api.approvals.record, argsFor(i)); return { ok: true, value, t0, t1: performance.now() }; }
  catch (e) { return { ok: false, code: codeOf(e), t0, t1: performance.now() }; }
}));
const maxOverlap = maxConcurrentIntervals(results.map((r) => [r.t0, r.t1]));   // 有效样本要求 ≥ 2
```

- 走真实公开函数与鉴权路径，没有冷启动，重叠窗口远紧于并行 CLI（review r16）。退路：N 个并行 `npx convex run <fn> '<json>' --identity '<json>'`（CLI 缺省 issuer `https://convex.test`，`tokenIdentifier = ${issuer}|${subject}`），同样记录 `maxOverlap`。第三种方法是 UI 双击（E2E-03）。
- 每个探针 K = 20 轮；`maxOverlap ≥ 2` 的轮次为有效样本；**有效样本 ≥ 10 且全部轮次满足不变量**才算通过。
- 不建 `devProbe.parallel` / `asIdentity`，12 不必为测试改成"薄壳 + handler"写法。

| 探针 | 操作 | 不变量（精确相等） |
| --- | --- | --- |
| `approve_last_two` | provider 与 finance 的最后两票各并发 3 次 | executions 1、ledger commit 1、changeOrders 1、tasks = `plannedTasks.length`、`room_executed` 事件 1 |
| `start_follow_up_twice` | 已执行房间里两名成员各并发 `rooms.startFollowUp` 3 次 | `rooms.by_followsExecutionId(executionId)` = 1；全部成功返回同一 `roomId`（TC-EXE-11） |
| `approve_last_repeat` | 同一最后审批人并发 5 次 | 同上；全部成功返回同一 executionId |
| `approve_same_user` | 未到最后一票的同一用户并发 approve 5 次 | 该 `(proposalId, userId, cv)` 的 approve 行 = 1（AP-1） |
| `start_run_repeat` | `ended_no_agreement` 后同一房间并发 `runs.start` 5 次（≤ 节流上限） | 非终态 run = 1；首回合 attempt = 1 |
| `join_same_role` | 5 个不同用户并发用同一链接邀请接受；变体：同一用户并发接受两个角色 | 该 `(roomId, role)` / `(roomId, userId)` 的 members = 1 |
| `cap_vs_last_approval` | `budget.setCap` 与最后一票并发 | 要么执行在前、随后 setCap → `run.invalid_state`；要么 setCap 在前、最后一票 → `approval.stale`；R4 恒成立 |
| `reject_vs_last_approval` / `withdraw_vs_last_approval` | reject 或 withdraw 与最后一票并发 | 不存在"已执行但该用户最新决定为 reject / withdraw" |
| `complete_vs_bump` | stub 驱动 + `STUB_DELAY_MS`（仅 dev / preview 生效）期间 `budget.setCap` | 旧回合结果 `stale` 并 reconcile；不存在"新 cv 下由旧回合产生的提案" |

```ts
type ConcurrencyEvidence = {
  probe: string; method: "multi_http_client" | "parallel_cli" | "ui_double_click";
  deployment: string; tier: "dev"; gitSha: string; n: number; rounds: number; validRounds: number;
  maxOverlapPerRound: number[];
  results: { ok: number; rejected: number; errorCodes: Record<string, number> };
  invariant: { name: string; expected: number; observed: number[]; pass: boolean };
  occRetriesObserved: "unknown";   // insights 只接受用户登录且为 72h 聚合，CI 不可得；需要时人工 `npx convex insights --details --json`
  startedAt: string; finishedAt: string;
};
```

### 16.8.3 其他 L2 探针

- `log_scan`：流程**开始前**后台启动 `npx convex logs --jsonl` 子进程持续写文件（该命令是永不退出的轮询流，`--history` 只回放服务端缓冲，review r07）；流程结束后等约 10 秒、kill 子进程、交给扫描器；证据记录条目数与时间范围，**条目数为 0 判失败**。接入 log streams（D31）后切换。
- `runtime_smoke`（每周）：dev key 经 `modelGateway` 发一次最小真实调用，记录 `stop_reason`、usage、延迟，证明 SDK 在默认运行时可打包运行。

## 16.9 L3：端到端（三身份三会话）

- 载体：`foundation/e2e-harness`，槽位 A / B / C 映射 `roleLabels: { A: 'customer', B: 'provider', C: 'finance' }`；`E2E_AUTH=clerk`；Clerk dev 实例的 `+clerk_test` 测试身份（固定 OTP，无密码策略）；`globalSetup` 用 `sk_test_` 密钥铸造 testing token（`clerkSetup({ dotenv: false })`），登录态只存内存。
- 后端：每个 PR 一个预览部署，`npx convex deploy --preview-create <branch> --preview-run seed:fromFixture`；预览默认环境变量：`CLERK_JWT_ISSUER_DOMAIN`、`DEPLOYMENT_TIER=preview`、`AGENT_MODE=stub`（预览不持 Anthropic key）、`AGENTS_ENABLED=true`、`E2E_CUSTOMER_SUBJECT` / `E2E_PROVIDER_SUBJECT` / `E2E_FINANCE_SUBJECT`（Clerk 用户 id，不是密钥）；`seed.fromFixture` 无参数时从这些变量拼 `tokenIdentifier`。`--preview-run` 在推送之后、无身份、以 `{}` 运行，失败时函数已推送且 CLI exit 1：整个 job 失败，下次 push 由 `--preview-create` 重建（review r09）。
- 密钥只在受保护环境：预览部署 key、Clerk dev secret / publishable key；fork PR 跳过 L3。
- 等待只按可见状态（`BasePage.readyTestId`、`expect(locator).toHaveText`），不用固定 sleep（实时页面永远到不了 networkidle）；关键控件带稳定 `data-testid`。

| 用例 | 步骤与断言 |
| --- | --- |
| E2E-01 主线 | D27 主 fixture：三方确认 → stub 提案 → 三方批准 → 已执行；三个窗口不刷新依次看到进度、提案卡、审批进度、变更单 |
| E2E-02 降预算 | 已有两票时 finance 降到 $4,800：另两个窗口同一推送内翻转；旧审批显示 "No longer applies · approved under constraints v1"；stale 横幅；新 run 自动开始 |
| E2E-03 双击 | 最后一票按钮 `dblclick()` 再快速点击：只出现一个执行结果，管理员查询计数为 1 |
| E2E-04 刷新 | 回合进行中刷新三个页面：进度从服务端恢复，无重复开始 |
| E2E-05 非成员 | 第四个账号打开房间 URL：与不存在的房间相同的"无权访问"页 |
| E2E-06 标注 | seed 房间、stub 提案、变更单显示 `SimulatedBadge` |
| E2E-07 负载扫描 | provider 与 customer 会话执行 S7 扫描（TC-PRIV-18）；页面 console 无错误 |
| E2E-08 身份与邀请 | 未验证邮箱不能接受定向邀请；链接 token 只在 fragment、跳转 URL 不含 token；`/api/health` 无会话 401（TC-AUTH-11）；登录后 `rooms.listMine` 可用 |
| E2E-09 决策页文案 | 按钮 "Approve v3 under constraints v3"；最后一票提示 "Your approval completes the set — this executes now"；代理框 "Suggestion only, never counted as approval"（D19） |
| E2E-10 可访问性 | `/rooms` 与房间页过 `@axe-core/playwright` 门禁（techstack D26） |
| E2E-11 后续房间 | 执行后 `rooms.startFollowUp`：新房间预填三席与 `draft` 目录；finance 确认基线；旧房间只读 |
