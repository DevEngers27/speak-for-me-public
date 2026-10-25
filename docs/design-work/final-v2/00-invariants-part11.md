# 00 · 反例电池 part11 — 2.9 测试基础设施、2.10 端到端组合；§3 覆盖矩阵；§4 开放问题

> 分片清单见 `00-invariants.md`。2.9 来自 testing-ops X1–X18 与反驳 r02 / r03 / r07 / r08 / r12 / r13 / r16：这些不是产品反例，而是"测试本身假绿"的反例，16 章必须把它们写进纪律。

### 2.9 测试基础设施（防假绿）

| ID | 操作序列 | 挡住它的纪律 | 层 |
| --- | --- | --- | --- |
| CE-158 | 在 convex-test 里 `Promise.all([approve, approve])` 得到 1 条执行，报告写"并发安全" | 用例名必须带 `[serial]`；并发结论只能引用一份 `ConcurrencyEvidence`（RD） | CT（元） |
| CE-159 | 并行 `npx convex run` ×5 全部成功且只有 1 条执行，但 CLI 冷启动让调用从未重叠 | 证据记录客户端发起 / 返回时间，`maxOverlap >= 2` 才算有效样本；首选单进程多 `ConvexHttpClient` + `setAdminAuth`（`@internal`，跨版本待验证） | RD |
| CE-160 | 测试环境 `AGENT_MODE=stub`，脚本化模型队列从未被消费，RUN / STALE 组仍变绿 | convex 项目测试环境 `AGENT_MODE=live` + 假 key；`afterEach` 断言 `assertScriptConsumed()`；需要模型的用例断言 `recordedRequests.length > 0` | CT |
| CE-161 | 用 `finishAllScheduledFunctions(vi.runAllTimers)` 推进，看门狗与回合 action 同时触发 | `drainDue(t)` 只推进到期任务；看门狗用例显式 `vi.advanceTimersByTime(WATCHDOG_DELAY_MS)` | CT |
| CE-162 | `log_scan` 用 `npx convex logs --history 1000` 永不退出 / 回放不完整 | 流程开始前后台收集 `--jsonl`，结束后等待尾部再 kill；条目数为 0 判失败 | RD |
| CE-163 | 数值针脚 `481731` 命中 `_creationTime` 子串 | 数字边界正则 + 剔除 `_creationTime` / `commitTs` / `_id`；日期金丝雀不得等于任何公开日期 | P |
| CE-164 | 变异检查：分别删除 `by_executionKey` 查重、`approvals.record` 的 run 状态守卫、G1–G3 之一 | 对应 CE-097 / CE-048 / CE-121 必须变红；一键脚本，结果写入 `probe-results/` | CT + RD |

### 2.10 端到端走查（组合）

| ID | 操作序列 | 覆盖 | 层 |
| --- | --- | --- | --- |
| CE-165 | D27 主 fixture：就绪 → `openIfReady`（cv 1、run 1，cause `room_opened`）→ v1 $900 `pending_approval` → customer、provider 批准 → finance 降到 $4,800（cv 2）→ run 1 `superseded`、v1 `stale`、2 条 `stale_approve` + finance pending → run 2 预检不保留 v1、`negotiating` → stub provider 第 1 轮选 $900 被 `budget.over` 阻断（不插提案、不消耗版本号、不花评估调用）→ 第 2 轮选 $800 → v2（恰等于上限通过）→ customer、finance `recommend_accept` → 三方对 v2 批准 → 执行（`exec:<v2>`，已承诺 480000 = 上限）；全程三身份金丝雀（含派生值）扫描 WebSocket 帧、HTML、日志 | INV-01 … INV-78 全链 | E2E |
| CE-166 | 同上，provider 账号抓包全部订阅帧与错误响应 | INV-01 / 02 / 06 / 07 / 11 / 12 / 13 | E2E |
| CE-167 | 变体 $4,700：预检无解 → run 2 直接 `needs_input(infeasible)` → customer 视图（看不到已承诺额）候选集非空、被跳过 → finance 收到 `raise_cap` 480000 / 490000 + `end_run` → finance 选 480000 → bump（cv 3，cause `human_answer`）→ run 3 `negotiating` → v2 $800 → 执行；全程 `attempts` 为 0 直到 run 3 | INV-32 / INV-64 / INV-73 | E2E |
| CE-168 | 执行后 `startFollowUp`：新房间预填席位与 draft 目录（不含已交付条目）；finance 确认基线；customer 重确认简报（去掉已完成项）；新执行 | INV-52 / INV-58 / INV-50 | E2E |
| CE-169 | 最后一票按钮 `dblclick()` + 快速再点 | INV-29 / INV-46；后端用 `--identity` 查 `executions` 1 行（RD 方法 c） | E2E |
| CE-170 | 回合进行中刷新三个页面；断线重连 | INV-67 / INV-70：进度从服务端恢复，不重复 `runs.start`；无乐观更新 | E2E |

## 3. 覆盖矩阵

| 核心 | 不变量 | 反例 |
| --- | --- | --- |
| 1 私密委托 | INV-01 … INV-19 | CE-001 … CE-035、CE-165、CE-166 |
| 2 代理只建议 | INV-20 … INV-23 | CE-036 … CE-041、CE-094 |
| 3 人批准具体版本 | INV-24 … INV-36、INV-33 | CE-042 … CE-072、CE-110、CE-111、CE-122 |
| 4 代码负责校验 | INV-37 … INV-45、INV-67 … INV-79 | CE-073 … CE-094、CE-121 … CE-146 |
| 5 执行幂等且原子 | INV-46 … INV-53、INV-M1 | CE-095 … CE-120、CE-169 |
| 6 历史不可篡改 | INV-54 … INV-58 | CE-049、CE-050、CE-057、CE-089、CE-108、CE-109、CE-113、CE-116、CE-131、CE-145、CE-168 |
| 7 执行边界 | INV-59 … INV-61、INV-52 | CE-147 … CE-151、CE-112 |
| 8 不伪造 | INV-62 … INV-66、INV-10、INV-40 | CE-152 … CE-157、CE-128、CE-138、CE-139、CE-167 |
| 测试纪律 | — | CE-158 … CE-164 |

16 章新增的 CE-171 … CE-175（披露配置失明、伪 itemKey、`sharedFacts` 夹带 value、`disclosure_changed` 渲染、headroom 共享后的 counter 上界）的定义与映射见 16 §16.11.3；此后任何章新增反例都从 CE-176 起、由 16 登记，编号不回收。

### 3.1 无直接反例覆盖的不变量（16 章必须补用例）

| 不变量 | 现状 | 建议用例 |
| --- | --- | --- |
| INV-03 代理上下文 ⊆ 投影 | 只被 CE-025 / CE-166 间接覆盖 | P：对每个 role 断言 `loadTurnContext` 输出键集 ⊆ `projectForRole(role)` 键集 ∪ 允许的本人字段；脚本化模型记录的请求体过三方金丝雀 |
| INV-28 `requiredApprovals` 快照不可变 | 无 | CT：插入后尝试改变场景常量 / patch 提案 → 结构测试拒绝；执行以快照为准 |
| INV-56 事件全序与"每个迁移至少一条事件" | 无 | CT：遍历 04 迁移表，每条迁移后 `events` 新增 ≥ 1 且 `(commitTs, seq)` 严格递增；同事务多事件 seq 连续 |
| INV-57 约束历史可复现 | 无 | CT：走完主线后对每个 cv 调 `replayRuleInput`，与当时的 `loadRuleInput` 逐字段相等，重算 v1 在 cv1 / cv2 下的阻断集合与当时事件一致（09 CC-16） |
| INV-45 场景注册 | CE-083 只覆盖"未注册" | P：插件一致性套件（纯函数、同输入同输出、无 I/O） |
| INV-76 终态无出边 | CE-143 仅穷举表 | CT：对每个终态 run 调用全部 mutation，断言状态不变 |
| INV-79 终结活性 | 04 SM-29 | CT：creator 账号失效后 `rooms.forceClose` 关房、open 请求置 `superseded`、run `canceled`；open 请求到期 → `ended_no_agreement`（16 TC-RUN-24） |
| INV-M1 房间写锁 | 无 | RD：去掉 `openRoomTx` 的 `writeSeq + 1` 后跑并发套件应出现重复行（变异须被抓住，16 TC-EXE-12） |
| INV-14 SSR 无受限 DTO | CE-019 | 构建期脚本：扫描 `.next` 静态产物与 RSC 负载中的金丝雀（skeleton spike 已有 secret marker 扫描，扩展为三方金丝雀） |

### 3.2 必须在真实部署（RD）上验证的反例

convex-test 串行执行、不模拟 OCC、不模拟平台限额与运行时差异（inputs/05 B1、testing-ops 反驳 C2），以下条目的 CT 版本只证明串行语义：

| 反例 | 验证的平台事实 | 对应 spikes §8 |
| --- | --- | --- |
| CE-096、CE-097、CE-099、CE-100、CE-101、CE-119、CE-120、CE-020 | 索引区间读与并发插入冲突、后提交者重试并看到前者写入 | #1 |
| CE-122、CE-124 | 被调度 action at-most-once、在途 action 取消不掉、`_scheduled_functions` 状态可读 | #2、#9 |
| CE-054（RD 变体：调度一个记录 `getUserIdentity()` 的函数） | 生产中被调度函数无身份 → `actorUserId` 必传 | #3 |
| CE-017、CE-018 | `ConvexError.data` 原样到达前端；`logLines` / 非 ConvexError 消息在 prod 类型部署是否脱敏 | #4、#11 |
| CE-090（RD 变体：直接写 `NaN` / `Infinity`） | `v.number()` 对非有限数的行为 | #5 |
| CE-102 | 客户端断线重发与后端去重 | #10 |
| CE-002、CE-166 | 真实 WebSocket 负载、日志、错误消息的金丝雀扫描 | #11 |
| CE-022、CE-023 | Clerk 真实登录到 Convex token、`emailVerified` 声明、邀请页不经 `auth.protect()` | #12 |
| CE-086、CE-024、CE-076、CE-077 | API 是否接受 strict schema（enum / const / `additionalProperties: false`）、`stop_reason` 分支、`max_tokens: 16000` 是否够用、注入是否被服从（只记指标） | #13–#17 |
| CE-109 | `seed.reset` 在 dev 部署上与在途 mutation 的冲突；`getDeploymentMetadata().name` | testing-ops C13 |
| CE-159、CE-162、CE-164 | `setAdminAuth` 跨版本稳定性；`convex logs` 流式行为；变异检查脚本 | testing-ops r16 / r07 |

另有两类离线测不出、靠政策而非测试的条目：合法选择里约 1 bit 的隐蔽信道（itemKey、日期、`fit: blocked`）由 D12 政策设上界；语义改写泄露（"a bit under five grand"）由 INV-05"他方可见文本只来自模板"从结构上杜绝。

## 4. 开放问题（canon 包修订后的状态）

已裁决并落入正文（保留编号便于追溯）：

1. **INV-32 的提案状态时序** —— 已裁决（canon §1.3、D06、C47）：bump 先把提案置 `stale`（04 P4），预检保留时同事务 `stale → active`（04 P5）；保留只限被取代 run 处于 `pending_approval`。INV-32 / CE-058 / CE-065 / CE-129 已按此改写。
2. **缺失的 reasonCode** —— 已裁决（canon §1.5、C56）：无可撤回 → 返回 `unchanged`；`reasonKey` 不在场景枚举 → `input.invalid`；请求已关闭 / 非法 optionKey → `request.not_open` / `request.option_unknown`；场景未注册 → `run.invalid_state{ scenario_version }`。建议的 `approval.nothing_to_withdraw` / `approval.invalid_reason` / `config.invalid` 未采纳（各章已收敛到上述码）。
3. **目录 `validUntil`** —— 已裁决（canon D22）：v1 无 `validUntil`，D22 的例子已删去；17 引入报价有效期时须同时进硬投影或 clock 翻转清单。
4. **`room.setup → open` 的触发条件** —— 已裁决（canon §1.3、C48），**未采纳**本文件原建议的"三席就位即 open"：就绪条件全部满足（含三方简报、≥ 1 confirmed item、baseline）才由 `openIfReady` 打开房间并开首个 run（cause `room_opened`）。INV-67 / INV-75 / CE-146 / CE-154 已改写。
5. **`ledger.recordBaseline` 与 `capCents` 的顺序守卫** —— 已采纳（canon D23 对称守卫）：上限已确认时 `baseline ≤ capCents`，否则 `budget.below_committed`。INV-50 / CE-117 已改写。
6. **披露的溯及力** —— 已由 07 裁决（§7.8.3、PV-12）：所有角色的历史提案只显示存储状态；历史值按其所属版本的受众判定，不溯及既往。INV-11 / CE-032 已改写。
7. **场景 / 插件升级** —— 部分裁决：cause `scenario_migrated` 已登记（canon §1.2），未注册版本上 approve 被拒、reject / withdraw 照常（08 S5 / O12）；迁移脚本本身由 15 定义，ADR 见 18 N-08。
8. **`resolveRound` 与串行评估的顺序细节** —— 已由 05 裁决（§5.8.3），**未采纳**本文件原建议：customer `counter` 与 `reject` 不短路，finance 仍评估 base；可行的 counter 在下一轮转发给 provider。INV-74 已改写。
9. **节流的计数来源** —— 已裁决（canon D12 ⑥、12 B7）：命令事件 + `events.by_room_actor` 按 distinct `commitTs` 计数；批量目录确认计一次；另有 `price_writes` / `run_starts` / `room_create` 总量桶。INV-11 / CE-011 / CE-012 / CE-134 已改写。
11. **provider 为 `agent_failed` 收件人时的出口** —— 已裁决（canon D15）：creator 可随时 `runs.cancel` 结束被拖住的 run；不给 creator 代答他方请求的能力（请求只由 `toRole` 回答）。

仍开放：

10. **`requestId` 去重**：平台层是否对重发 mutation 去重仍待验证（spikes §8 #10）；若不去重，INV-29 的业务幂等是唯一防线，CE-102 必须在 RD 跑。
12. **`pass_to_next` 的体验**（canon D15 本次新增）：转交只按 `relaxationOrder` 位置提供，目标角色视图里若没有可放松选项，只能 `disclose` 或 `end_run`。是否需要在转交前提示"对方可能也无法放松"留给 13 的文案（不能依据他方私密值决定是否提示）。
