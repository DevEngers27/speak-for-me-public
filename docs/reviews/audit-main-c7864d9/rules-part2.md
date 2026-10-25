# 审计：W1-1 规则引擎与插件契约（part 2/3）

## B. 06 §2 / §14 的 R 族不变量

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| INV-R1 | satisfied | eslint.config.mjs:21-48；scripts/check-boundaries.mjs | `core/**` 禁止 Date、Intl、fetch、crypto、process、console、Math.random、zod、convex；check-boundaries 用故意违规的样例证明规则会拒绝，并扫描整个仓库。rules/ 下没有违规。 |
| INV-R2 | satisfied | checkProposal.ts:73-74 | `blocking` 按 decls 顺序（CHECK_ORDER）去重；`passesChecks = blocking.length === 0`。测试：`collects late and over together in check order`、`below committed blocks…`。T06-P2 性质测试缺失（AUD-08）。 |
| INV-R3 | deviates | core/engine/reasonCodes.ts:8-66, 116, 139-189 | 本块写出的参数名都已在 PARAM_AUDIENCE 中声明（逐条手工核对）。但 canon §1.5 / 06 §6.1 要求的 `approval.not_executable`、`item.limit_exceeded` 不在 REASON_CODES 里；ParamAudience 缺 `'caller'` / `'projectedCodes'`；`run.rate_limited` 的参数是 `retryAfterMinutes`，06 §6.2 是 `retryAfterMs`。见 AUD-13。 |
| INV-R4 | satisfied | checkProposal.ts:13-17, 57-58 | 视图与全局用同一组检查；视图读不到的字段记 `unknown`，不阻断。测试：rules.test `partial view %s`。 |
| INV-R5 | satisfied | hardProjection.ts | 同 localDate、同台账、投影相等时，阻断集合和可行集都相等：review.test `T06-P4…`（2000 对）。 |
| INV-R6 | satisfied（引擎部分） | materialize.ts:41-46；candidates.ts:19 | 求和溢出的候选返回 null 并被丢弃，不崩溃（`drops overflow candidates`、`deduplicates drafts, skips overflow…`）。单行价上限和行数上限属于写入口（W2-1）；"每个候选至多 1 个 modifier" 引擎没有断言（探针 9），见 AUD-10。 |
| INV-R7 | satisfied（引擎部分） | rules/*（无时钟） | 引擎只读 `input.localDate`；lint 已覆盖。`rooms.view` 部分归 W2-1 / W2-6。 |
| INV-R8 | not_implemented_yet | materialize.ts:20-28 | E4 已按 revision 比较；revision 只在规则相关字段变化时递增，这是存储与 `catalog.confirm` 的契约，归 W2-1。 |
| INV-R9 | satisfied | candidates.ts:24 | 只有在该视图下 `passesChecks` 的候选才进入快照。测试：review.test 截断 golden、`deduplicates…filters blocked`。 |
| INV-R10 | satisfied（代码） | view.ts | 掩码只暴露 1 bit；探针 7：只改 customer 看不到的 cap 时，customer 的投影逐字节相同。性质测试 T06-P6 缺失（AUD-08）。 |
| INV-R11 | deviates | humanRequests.ts | 引擎把 `viewOf(toRole)` 交给插件，但不验证选项里的每个数字都能从该视图推出；§11.3 #2 / #3 也没有断言。见 AUD-05。 |
| INV-R12 | deviates (low) | eslint.config.mjs | 场景词汇 lint（T06-S2）没有配置。W1-1 的文件里没有场景词（`'provider'` 是 06 §8 规定的 audience 字面量），但 engine 的其他文件已经含有 customer / finance / requiredItemKeys。见 AUD-09。 |
| INV-R13 | not_implemented_yet | — | approve 前与执行事务内各调用一次 `isExecutable`，归 W2-2。 |
| INV-R14 | not_implemented_yet | — | query 不读 `Date.now()`，归 W2-1 / W2-6（convex 层 lint）。 |
| INV-R15 | satisfied（引擎部分） | materialize.ts:50-51；candidates.ts:21；executable.ts:14 | `termsKey = canonicalJson(terms)` 在物化时生成，枚举时和 isExecutable 时都会断言；篡改时抛 `IntegrityError`（`terms key tampering fails loudly`）。由谁写入归 W2-4。 |
| INV-R16 | deviates | — | `assertOptionsProjected`（06 §11.3 #5 的语义：用同一视图重算后深比较）没有接到 buildHumanRequests 上；PR r06 已延后。见 AUD-05。 |
| INV-R17 | not_implemented_yet | — | catalogItems 的 revision 与 kind 不可变，归 W2-1。 |

## C. 08（规则侧）与 14

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| 08 §8.4.1 | satisfied | approvals.ts | 同 INV-26 / 27；另加了 seq 合法性检查（r07）。08 U6 中"旧 cv 上的 withdraw → pending"没有单独的测试（AUD-08）。 |
| 08 §8.4.2 | deviates | executable.ts | 见 INV-35 和 AUD-01；`canExecuteNow` 与 U13 的集合不齐分支都不存在。 |
| 14 §4 字段 | not_implemented_yet | — | 字段由插件声明，归 W1-3。通用 hardProjection 读 `class:'hard'`，正好得到 14 要求的 `{capCents, requiredItemKeys, deadline, catalog}`。 |
| 14 §5 目录 | not_implemented_yet | plugin.ts:11 | `CatalogDecl` 类型与 14 一致；行校验 `validateCatalogRow` 归 W2-1。 |
| 14 §6 候选/物化/放松 | deviates | types.ts:14；candidates.ts:13；materialize.ts:40 | 14 §7 的检查解构 `{ input, x }`，代码的 CheckCtx 里没有 `x`；14 §6.4 在 feasibility 模式下传 `limit: Infinity`，引擎会抛 `invalid_limit`；lines 的排序方式与 §6.2 不同。见 AUD-06、AUD-10。 |
| 14 §11 变体 | deviates | executable.ts:16-20；humanRequests.ts | A、B、F（截断 golden）在引擎层面成立。D1 预期 `isExecutable(v1)` 恰好返回 3 个码，代码在真实状态下会多出 `run.invalid_state`（探针 1）。D2 给 customer 的请求按 canon C54 应带 `pass_to_next`（14 本身也漏写了，属于章间不一致）。 |
| 14 §12 算术 | satisfied | — | review.test `14 §12 full-scope parameters and variants D/E/F arithmetic`；rules.test 预算表（480000 / 479999 / 470000）。 |

## D. canon 决定

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| D01 | not_implemented_yet | — | scheduler 链（`turns.beginAttempt` 等）归 W2-4；纯规则层没有对应内容，commit 引用 D01 只是作为背景。 |
| D02（集合判定） | satisfied | approvals.ts | evaluateApprovalSet 是唯一实现；禁止计数式判定；按当前成员、两两不同、绑定 cv 与 termsKey。测试见 INV-26。 |
| D02（approve 前 isExecutable） | deviates | executable.ts；reasonCodes.ts | D02 要求不通过时抛 `approval.not_executable`，但这个码不在 REASON_CODES（AUD-13）；isExecutable 的原因码形状也与 08 不一致（AUD-01）。写入口本身归 W2-2。 |
| D03 | not_implemented_yet | core/engine/keys.ts:8 | `executionKey()` 已由 W0-2a 提供；`executeIfComplete` 的重读 + 重算归 W2-2。 |
| D10 | satisfied（纯函数部分） | candidates.ts；materialize.ts | 模型只选 optionKey 所依赖的快照：按视图枚举，≤12，按 candidateKey 排序，首轮锚点放最便宜的候选，不按预算过滤，可剔除；服务端物化的 `lines` 含 itemKey、revision、title、priceCents、leadDays，`amountCents = Σ`，交付日为绝对日期。`turns.complete` 归 W2-4。 |
| D12 | deviates | plugin.ts:76 | ① 已满足（view.ts:17）；④ 已满足（view.ts:36-45）；⑤ 已声明 `maxProposalsPerRolePerRun`。③ 已修正为任何角色都禁用 `option_fits_constraints`，代码只拦 seller（探针 4，AUD-03）。②⑥⑦⑧ 归 W2-1 / W2-3 / W1-4。 |

## E. 无法判断

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| 06 §1.4 #1 / T06-P1 | unverifiable | — | 要求在 query、mutation、vitest 三处得到逐字节相同的 Evaluation。现有代码是纯函数，但没有 convex-test 或真实部署的证据，也没有 T06-P1 的打乱顺序测试。需要 W2 的 convex-test 来证明。 |
| 06 §10.1 #6 | unverifiable | candidates.ts | 最坏 12,288 次物化 + 检查在 Convex isolate 中的 CPU 时间，需要 spikes §8 的真实部署测量（W2-8）。 |
