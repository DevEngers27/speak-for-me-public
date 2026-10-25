# 不变量审计汇总（main @ c7864d9）

三名审计员分块把 main 上已合并的代码逐条对照不变量：rules 是 W1-1 规则引擎与插件契约；privacy 是 W1-4 的披露矩阵、投影、代理上下文与事件载荷；foundation 是 wave-0 地基与 W0-F。每条偏离再由一名反驳者独立复核。设计基线是 scratchpad 中的当前 final-v2，加上 `_changes/` 里的 CN-001 和 CN-002。整个过程只读，没有修改审计 worktree。

本页的严重度是反驳者复核后的结果，详表里保留的是审计员的原始定级。续篇见 [README-part2.md](README-part2.md)，包括被反驳的条目、需要设计方裁决的矛盾，以及对下一波的建议。

## 1. 总评

已合并代码在方向上体现了设计意图。没有发现违反八条不可协商核心的代码，也没有任何 high 或 blocker 级偏离通过复核。

- 审计员共提出 48 条偏离。复核后确认 31 条（medium 17 条、low 14 条），反驳 17 条。
- 审计员原报 high 的 16 条中，13 条确认但降为 medium 或 low，3 条被反驳。
- 所有确认的偏离目前都还是潜伏的。main 上没有任何公开函数或写入口调用这些代码，危害要等 W2 照抄这些契约时才会出现。

**已落地并经核实的核心**

- 规则：
  - 预算是闭区间，below_committed 与 over 互斥。
  - checkProposal 一次收齐全部阻断并去重。
  - 交付日在物化时就定为绝对日期。
  - 掩码按检查的 owner 判定，provider 只拿到 fit。
  - evaluateApprovalSet 与 08 §8.4.1 逐行一致。
  - hardProjection 有 2000 对的性质测试。
  - 引擎纯度由 lint 和 check-boundaries 双重保证。
- 隐私：
  - 投影器 fail-closed：未注册的字段直接丢弃，未投影的嵌套对象直接抛错。
  - 他方的人工请求，provider 只能看到 run_waiting。
  - 执行单和变更单的金额快照经 sharedFacts 按值所属版本判定。
  - 不可信标题已转义 `<>&`（INV-05）。
- 地基：
  - CN-001 规定的网关重试语义已满足：SDK 不重试，网关只在一层重试 429 和连接错误，230 s 截止早于 275 s 看门狗。
  - 隐私相关机制普遍偏严，危害在功能与契约层面，不会造成泄露。

**等后续波次的部分**（共 52 行记为 not_implemented_yet）

- 人工请求与审批的写入口：openHumanRequestTx、approvals.record、catalog.confirm
- rooms.view 与 timeline.page 的视图模型
- runAttempt / decideRetry
- registry / pluginFor / runPluginConformance
- Convex 业务函数与前端

**两个贯穿性原因**

1. 设计副本漂移。仓库内的 `docs/design-work/final-v2`（快照 e2f99d0）比 scratchpad 里的当前 final-v2 旧。31 条中约 12 条属于"设计后改"：RULES-02/03/13、PRIVACY-01/02/03/07/09/10、FOUNDATION-02/08/09。实现者照当时的副本写，并没有写错，修法是同步，而不是返工。
2. 设计自相矛盾。被反驳的 17 条里，至少 7 条的根源是章节之间互相冲突（见 part2 §5）。这类问题需要设计方发变更通知裁决，改代码解决不了。

**W2 开工前最该修的**

- 隐私投影：PRIVACY-06/01/02/03
- 错误边界：FOUNDATION-01
- 原因码表：RULES-13，与 FOUNDATION-02 是同一缺陷
- isExecutable 契约：RULES-01
- 网关的回合指令通道与结果词汇：FOUNDATION-03/05
- schema 增量：FOUNDATION-09

## 2. 各块计数

| 块 | satisfied | deviates | not_impl. | unverifiable | 行数 | 提出 | 确认 | 反驳 | 详表 |
|---|---|---|---|---|---|---|---|---|---|
| rules（W1-1） | 25 | 13 | 11 | 2 | 51 | 13 | 7 | 6 | [rules.md](rules.md) · [rules-part2.md](rules-part2.md) · [偏离清单](rules-part3.md) |
| privacy（W1-4） | 14 | 22 | 22 | 1 | 59 | 17 | 13 | 4 | [privacy.md](privacy.md) · [偏离清单](privacy-part2.md) |
| foundation（wave-0） | 27 | 15 | 19 | 2 | 63 | 18 | 11 | 7 | [foundation.md](foundation.md) · [foundation-part2.md](foundation-part2.md) · [偏离清单](foundation-part3.md) |
| 合计 | 66 | 50 | 52 | 5 | 173 | 48 | 31 | 17 | |

deviates 按不变量行计，一条偏离可能覆盖多行。5 行 unverifiable 都需要 W2 的 convex-test、真实部署或设计裁决才能判断：

- rules：T06-P1 要求三处得到逐字节相同的 Evaluation；12,288 次物化在 isolate 中的 CPU 时间。
- privacy：D12 ⑥ 的计数源依赖 priceChanged / hardChanged，但 03 中没有这两个字段。
- foundation：V4（AbortSignal.timeout/any 是否可用）、V1（v.commitTs 的提交语义）。

## 3. 确认的偏离（31 条，按严重度）

id 省略了前缀 `AUD-`。

| id | 不变量 | 严重度 | 一句话 | 建议归属 |
|---|---|---|---|---|
| PRIVACY-06 | PV-05 / 07 §7.8.1 / INV-02 | medium | 可见性取自调用方自报的 `fields`，而不是 sharedFacts 最新行；`ownerRole` 能覆盖行的所有者，从而放宽 self 字段 | W1-4F |
| PRIVACY-01 | DX-7 / PV-INV-15 / T-38 | medium | 房间 open 后，provider 仍能看到他方 briefs.version / confirmedAt，可借此推出谁改了约束 | W1-4F（排在 W2-1 前） |
| PRIVACY-02 | D13 / DX-6 / 08 I23 | medium | 拒绝的 reasonKey 没有按 humanReasonKeys 的受众裁剪，`over_our_limit` 进入 provider 视图和事件 payload | W1-3 + W1-4F + #33 |
| PRIVACY-03 | 07 §7.9.4 ●⁗ / DX-3 | medium | 他方回合的 status 没有折叠为 scheduled/running/done，provider 能由 failed 推出请求的收件人 | W1-4F 或 W2-1 视图模型 |
| PRIVACY-08 | PV-04 / 07 §7.8.2 | medium | 引擎硬编码了 scope_change 的字段和可共享表，没有从 plugin.fields 推导 | W1-3 + W1-4F |
| PRIVACY-11 | INV-12 / DX-8 / 03 §3.8 | medium | 引擎事件目录里 endedReason 的枚举与 03 和 convex 分叉；room_closed 不接受 `by:'ops'` | W1-4F 或 #33 |
| FOUNDATION-01 | D16 / INV-13 / canon §1.5 | medium | 错误边界把所有规范化错误都压成 internal；兜底码用的是 run.invalid_state；仍在用大写的 UNAUTHENTICATED | W1 函数构造器任务（首个业务 mutation 之前） |
| FOUNDATION-02 | canon §1.5 / 06 §6.3 / 12 §12.4 | medium | 码表缺 not_executable、limit_exceeded 和 13 个 API 码；没有 caller/projectedCodes 两个受众；参数名是 retryAfterMinutes | reasonCodes 同步任务（W2-2 之前） |
| RULES-13 | canon §1.5 / D02 / 06 §6.2 | medium | 与 FOUNDATION-02 是同一缺陷（W0-3 引入），两块各记了一次 | 同上，合并修复 |
| RULES-01 | INV-35 / 08 §8.4.2 | medium | isExecutable 会叠加 run.invalid_state 等多个守卫码，返回形状也不对；缺少 isCurrentForApproval / allApproved / canExecuteNow；U37 用的是不可达状态 | W1-1 follow-up（W2-2 之前） |
| RULES-04 | D15 / C54 / INV-64 / 05 §5.11 | medium | buildHumanRequests 缺 pass_to_next、questionKey 和 limitHit 条件；选项没有按 A..E 编号；templateKey 缺 request. 前缀；遇到 clarify 直接抛错 | W1-5（PR #36 已在修） |
| RULES-02 | 06 §12.1 | medium | ScenarioPlugin 缺成员 16 readiness 和可选成员 17、18；ProtocolDecl 缺 tradeoffOwner 和 topics 的扩展字段 | W1-1 follow-up（W1-3 之前），同时同步设计副本 |
| FOUNDATION-03 | 05 §5.13 / P15 / 10 §10.14.1 | medium | 网关一律禁止 messages 中出现 system，因而拒绝设计规定的 [user, system] 回合指令 | W2 agents runtime；先做 V3/V10 验证 |
| FOUNDATION-05 | 10 §10.15 / canon §1.3 / 04 A5 | medium | 网关的错误码与状态词汇和 AttemptErrorCode 对不上，超时被记成 error；retryable 的语义没有定义 | W2 turns.fail / decideRetry |
| FOUNDATION-08 | canon §1.2 / INV-05 | medium | itemKey 正则在代码里有四五份；33–40 字符的合法 key 会让 renderPublicText 抛错 | 引擎同步小任务；W1 catalog |
| FOUNDATION-09 | 03 / D15 / D17 / INV-70 | medium | schema 落后于当前的 03（attempts 字段、spendCounters、rooms 索引、scenario_migrated、disclose.toRoles），并缺 run_cap 和 pass_to_next | schema 增量任务；先补 03 |
| FOUNDATION-11 | D09 / 10 §10.14.3 | medium | fallback 用的是虚构的 beta 头和模型，而且可以经 env 打开；按设计 v1 应硬性拒绝 | W2 agents runtime |
| RULES-03 | canon D12 ③ / INV-11 | low | defineScenario 只在 seller 可提问时才拒绝 option_fits_constraints | W1-1 follow-up 或 W1-3 |
| PRIVACY-10 | canon D12 ③ / INV-11 | low | buildAgentContext 只对 provider 剔除这个话题（与 RULES-03 同源） | W1-4F + W1-5 |
| RULES-06 | 14 §6.4 / §7 / 06 §7.1 | low | CheckCtx 里没有 `x`；feasibility 模式下传 `limit: Infinity` 会抛错 | W1-2 + W1-3（06/14 同步改文字） |
| RULES-08 | 06 §13 / 08 §8.8.4 | low | 缺测试：T06-P1/P2/P6–P10、S3/S4/S6、08 U6/U13 | W1-1 follow-up / W1-2 / W1-5 / W1-3 |
| PRIVACY-07 | PV-06 / PV-INV-16 | low | DECLASSIFIED 是 10 个字段路径：没有 DX 编号，没有 DECLASSIFIERS，缺 DX-11…13 | W1-4F |
| PRIVACY-09 | 07 §7.8.4 | low | 可共享字段、disclose 选项和 convex schema 里仍有 v1 已删除的 preferredDate | W1-4F + #33 |
| PRIVACY-12 | 07 §7.9.4 / PV-04 | low | DISCLOSURE 的 agent 列没有代码读取；attempts 的三个字段应改为 agent:'never' | W1-4F（并入 #38） |
| PRIVACY-13 | INV-19 / TC-PRIV-10 | low | 完整性测试用的是手抄的顶层字段表，没有遍历 schema 的叶子路径 | #38 |
| PRIVACY-14 | canon D12 ⑦ / 07 §7.9.4 | low | provider 看到的 needs_input 被投影成 'waiting'，应为 run_waiting | W1-4F |
| PRIVACY-17 | 07 §7.14.3 / 05 §5.13.2 | low | 不可信封装用的是 NFC；没有定界词替换和 FNV boundary；source 名不同 | W2-5（#19）；修在 W0-2b 的 projection.ts |
| FOUNDATION-04 | D21 / 11 §11.3 | low | 网关放在 convex/agents/，另有 lib 再导出和三个别名；canon 要求放在 convex/model/agents/ | W2 agents runtime；先改 16 TD-03 |
| FOUNDATION-12 | 10 §10.16.1 / §10.11 | low | UsageRecord 缺 thinkingTokens；不读 stop_details；成本按请求的模型计算；没有 AbortSignal 退路 | W2 agents runtime + V4 |
| FOUNDATION-16 | INV-13 / 11 §11.5 | low | convex/** 缺 no-console（L7）及其反例夹具；L11 没有配置 | W1 工具链小任务 |
| FOUNDATION-17 | 03 / 07 / D18（卫生） | low | 注释和测试名过时；有占位 users 表；REDACTABLE_FIELDS 存了两份；有第二个 IsoDate 品牌；whoami 返回 tokenIdentifier | 任意 W1 小修 |

去重后共 30 个独立修复项：RULES-13 与 FOUNDATION-02 是同一项。RULES-03 与 PRIVACY-10 同源，但改的是两个文件。
