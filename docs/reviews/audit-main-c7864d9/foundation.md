# 审计：wave-0 地基 + W0-F 修复（main @ c7864d9）

范围：`core/engine/{money,dates,canonicalJson,keys,result,reasonCodes,stateMachines,actions,strictSchema,publicText,projection}.ts`、`convex/agents/modelGateway.ts`（含 `convex/lib/modelGateway.ts` 再导出）、`convex/lib/*`、`convex/schema.ts`、`core/scenarios/scope-change/`、`scripts/`、`tests/battery/index.ts`。只读审计，未改 `_audit` 下任何文件，未运行会写缓存的命令。

设计基准：`final-v2`（当前读到的版本）+ `_changes/CN-001`。注意：canon 包修订（2026-10-24）与 03 / 06 / 10 的部分条目是在本块合并**之后**改的（对照仓库内 `docs/design-work/final-v2` 快照 diff 得出）。这类偏离标注「设计后移」，仍按当前版本记为 deviates，但修法是「同步」而非「返工」。`17-tooling*.md` 不存在；17 是演进路线，工具链按 D20 与 11 §11.5、§11.9 审。

分片：本文件 = 不变量逐条表；`foundation-part2.md` = canon / 章节逐条表；`foundation-part3.md` = 偏离清单 AUD-FOUNDATION-01…18。

状态：S = satisfied，D = deviates，N = not_implemented_yet，U = unverifiable。

## 1. 不变量（只选落点在 03 / 04 / 10 网关 / 11 / 16 / 17 的条目）

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| INV-04 | S | core/engine/strictSchema.ts:68-137,364-388 | 根必须恰为 `{turn}`，全 required，`additionalProperties:false`，`oneOf→anyOf`，保留 enum/const，无 type 抛错，属性名禁表含金额 / 版本 / 身份，白名单例外 `proposalVersion`/`baseProposalVersion`/`toRole`（与修订后 canon §1.4 一致）。测试：strictSchema.test.ts「assertNoForbiddenPropertyNames … reject money, version, and identity」「requires root to be an object { turn }」。真实 `AgentModelOutput` 的快照测试归 W2 outputSchema。残留：`z.record` 被静默变成空对象（AUD-13） |
| INV-05 | S | core/engine/publicText.ts:276-735,1186-1330；projection.ts:1341 | 公共模板只允许 enum/token/amount/date/integer/list/fragment，`slot.text` 在 definePublicTemplate 被拒；token 只认 ItemKey 正则；标题 `wrapCatalogTitle` ≤80 码点、拒 `<>\r\n`、`<untrusted_data>` 定界。测试：publicText.test.ts「forbids free-text slots」「only reads declared reads fields … Proxy」；tests/foundation/wave0.test.ts「validates catalog titles」。ItemKey 正则与 canon 不同见 AUD-08，默认模板问题见 AUD-10 |
| INV-07 | S | convex/schema.ts（proposals/changeOrders/events 无 deferred*）；convex/lib/schemaTypes.ts:48-53 | schema 字段与契约逐表相等（tests/schema/schema.test.ts「%s fields and indexes match 03」）。`REDACTABLE_FIELDS ∩ TERMS_KEY_FIELDS = ∅` 成立但没有显式断言 |
| INV-12 | S | convex/schema.ts:116-166 | `eventPayloadV` 封闭联合、无 `visibility`、`restrictedRefV` 恰为 D14 的 8 张表、`run_needs_input`/`human_request_opened` 只有 `runNo`。测试：schema.test.ts「event catalog matches 03 §3.11.1」。设计内张力（不算代码偏离）：03 把 `turn_failed.failureKind`、`approval_recorded.reasonKey` 放进房间可读 payload，靠渲染器裁剪，与 INV-12「payload 只含房间可见字段」字面冲突，需 03/07 裁决 |
| INV-13 | D | convex/lib/errors.ts:34,114-127；convex/engine/auth.ts:13 | 边界把除 `{code:'UNAUTHENTICATED'}` 外的**一切** ConvexError 变成 `internal`，规范化的业务错误到不了浏览器；`toPayload` 兜底码是 `run.invalid_state` 而非 `internal`；无 `opsLog('unhandled')`；大写 `UNAUTHENTICATED`；convex 无 `no-console` lint。AUD-01、AUD-16 |
| INV-15 | N | convex/schema.ts:211-213 | 索引 `by_room_user`/`by_room_role` 已在；唯一写入口 `addMember`（W1 rooms/invites）未实现 |
| INV-22 | S | core/engine/actions.ts:151-214 | 静态矩阵正确（finance 无 counter、provider 无 recommend_accept、propose 回合无 counter）。测试：actions.test.ts「exhaustive 3×2×6 actionAllowed」。动态裁剪（`n<2` 去 counter、counter 排除 base、≤4 次）属 W2 `allowedActions`。残留 fail-open 见 AUD-14 |
| INV-24 | N | convex/schema.ts:297-308 | `constraintRevisions` 形状与 §1.1 一致；`constraints.bump`、`hardProjection` 比较不在本块 |
| INV-29 | N | convex/schema.ts:464 | `by_proposal_user [proposalId,userId,seq]` 在；`approvals.record` 未实现 |
| INV-40 | D | convex/agents/modelGateway.ts:2353-2432,2185-2238 | usage/stop_reason/requestId 在分支前记录；refusal→refused、context_window→error(context_overflow)、其他 stop→unexpected_stop、JSON.parse→validate，均有测试（modelGateway.test.ts:290-438）。偏离：截断后的同调用重试在 230 s 总预算里几乎必然超时，最终返回 `error/timeout`，`output.truncated` 被掩盖（AUD-06）；错误词汇与 03/10 不对齐（AUD-05） |
| INV-42 | D | modelGateway.ts:29-149,402-750,1311-1360 | 满足：model/effort/max_tokens 钉死、`output_config.format=json_schema`、stream+finalMessage、SDK 重试 0 + 网关一层（按 CN-001）、总截止 230 s < 看门狗 275 s、模块加载即断言不等式、禁 thinking/采样/工具/预填、fallbacks 默认关。偏离：路径与接缝（AUD-04）；`MODEL_FALLBACKS=on` 可被打开，v1 应拒绝（AUD-11）；拒绝 05 §5.13 的中途 system 消息（AUD-03）；不校验传入 schema 是否严格（AUD-07） |
| INV-43 | S | core/engine/money.ts:39-124；dates.ts:85-122 | `assertCents` 0…1e11 安全整数，入口与求和后各断言，错误不回显金额；IsoDate 真实历法、无 Date/Intl。测试：money.test.ts「enforces the canon ceiling…」「revalidates every operand…」；dates.test.ts「validates the Gregorian calendar」。日期窗口在 rules/checkProposal.ts:45（W1-1） |
| INV-46 | S | core/engine/keys.ts:8-10；convex/schema.ts:515 | `exec:${proposalId}`，无 cv 无哈希；`by_executionKey`。测试：keys.test.ts「pins canon string keys without hashes or version segments」 |
| INV-49 | S | keys.ts:11-14；schema.ts:543,554 | 三段 `taskKey` + `by_taskKey`；`plannedTasks` 快照字段在 proposals。itemKey 段校验过宽见 AUD-08 |
| INV-54 | N | convex/lib/schemaTypes.ts:21-47；scripts/lib/convex-ops.mjs | 只追加表与可变字段登记在；写门面 / lint / `seed.reset` 的 `assertTier` 未实现（W1 db.ts、seed）。CLI 侧已拒 prod 并要求 `--confirm-deployment` |
| INV-55 | S | core/engine/canonicalJson.ts:61-127；schema.ts:437 | 键序无关、拒 NaN/稀疏/循环/非普通对象，`termsKey` 为字符串。测试：canonicalJson.test.ts「is independent of key insertion order」等 |
| INV-56 | N | schema.ts:575-588 | `by_room_order (roomId, commitTs, seq)`、`seq` 字段在；`events.append` 未实现 |
| INV-59 | S | eslint.config.mjs:20-46；scripts/check-boundaries.mjs；package.json:27-35 | 直接依赖只有 next/react/convex/clerk/zod/server-only；core 纯度规则与 14 个故意违规夹具（`pnpm test:boundaries`）。依赖白名单读 package.json 的用例仍是 it.todo（battery pure/07） |
| INV-61 | N | core/engine/publicText.ts:1468-1537 | 引擎级模板 `change_order_disclaimer` 不存在（AUD-10）；变更单在 W3 |
| INV-62 | S | schema.ts（rooms/proposals/executions/ledgerEntries/changeOrders/tasks/attempts 的 `provenance`） | 必填 `live|seeded|stub`，无 `simulated` 别名；fixture 只允许 seeded/stub（convex/lib/fixtureSchema.ts:76） |
| INV-63 | N | core/scenarios/scope-change/fixtures/*；convex/lib/scopeChangeFixture.ts | fixture 与金丝雀自检在（tests/scenario/canaries.test.ts）；`seed.fromFixture` 未实现 |
| INV-66 | N | schema.ts:318 | `runs.agentMode` 快照字段在；`AgentDriver` 未实现 |
| INV-67 | N | schema.ts:339-340 | 03 用 `by_room_runNo` + `currentRunId` 代替 INV-67 的 `by_room_status`，与 03 一致；`startRunTx` 未实现 |
| INV-68 | S | schema.ts:322-326 | `activeTurnSeq`，无 `pendingTurnSeqs`/`openTurnCount`；schema.test.ts 字段逐表相等 |
| INV-69 | N | schema.ts:156 | `turn_rejected_stale{guard}` 在；守卫未实现；`attempts.staleGuard` 缺（AUD-09） |
| INV-71 | N | schema.ts:387-389 | `watchdogFnId`/`watchdogArmCount`/`deadlineAt` 在；看门狗未实现 |
| INV-72 | D | schema.ts:358 | 四层上限字段在，但 `turns.waitingReason` 没有 `run_cap`（canon D06/D07/D12 ⑥/D17、04 §4.3.1 都要求），系统开局超 `run_starts` 时无处停泊（AUD-09） |
| INV-73 | S | core/engine/stateMachines.ts:68-84；schema.ts:99-109 | `needs_input→pending_approval`（R15）等边齐全，`RUN_TRANSITIONS` 导出。测试：stateMachines.test.ts「supports every numbered design transition row … R4 and R19」 |
| INV-76 | S | stateMachines.ts:56-84 | 终态无出边。测试：stateMachines.test.ts「terminal states have no outgoing edges…」 |
| INV-77 | N | core/engine/dates.ts:225-231 | 引擎只提供固定偏移的 `isoDateFromEpochMs`；`todayInTimeZone`（Intl，V-D2）归 W1 rooms.create / clock |
| INV-78 | S | dates.ts:185-214；publicText.ts:130-142 | 字典序单一实现，publicText 已改用 `parseIsoDate`（W0R-06 已修）。残留：publicText 另有一个 `IsoDate` 品牌类型（AUD-17） |
