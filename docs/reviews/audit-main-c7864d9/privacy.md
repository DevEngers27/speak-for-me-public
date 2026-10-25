# 审计 · W1-4 披露矩阵 / 投影 / 代理上下文 / 事件载荷（privacy 块）

- 代码：`/Users/zhennn/speak-for-me-wt/_audit` @ c7864d9（origin/main，只读）。
- 设计：`scratchpad/design/final-v2`（2026-10-24 14:3x 读取版本）；`_changes/` 只有 CN-001（模型网关，与本块无关）。未见半修改文件。
- 范围：INV-01…19（1.1 私密委托）、03 §3.16.1 字段披露类、13 视图模型、PV-INV-01…16、PV-01…16、canon D11–D14、D23（本文件 A–E 节）；偏离清单 AUD-PRIVACY-01…17 在 `privacy-part2.md`。
- 方法：逐行读 `core/engine/disclosure/index.ts`、`agentContext.ts`、`events.ts`、`projection.ts` 及相关 `rules/*`；把 worktree 复制到 `scratchpad/audit-privacy-run/` 跑现有测试（7 文件，76 通过 / 11 todo），另加 19 个探针 `scratchpad/audit-privacy-run/tests/audit/probe.test.ts`（P1…P19，worktree 未改动）。
- PR #35 外部评审 r01–r06 复核为已修；W1-4-c01（issue #38）仍在 main，按要求计 deviates。
- 背景：仓库内 `docs/design-work/final-v2` 是旧稿（没有 privacy-02/05/06、DX-11…13、humanReasonKeys、D12③"任何角色"、"v1 删除 preferredDate"）。下文标"设计后改"的偏离，实现时依据的旧稿并未要求；标"实现偏差"的在旧稿里已有要求。
- 计数（59 行）：satisfied 14 · deviates 22 · not_implemented_yet 22 · unverifiable 1。

路径缩写：`D` = `core/engine/disclosure/index.ts`，`AC` = `core/engine/agentContext.ts`，`EV` = `core/engine/events.ts`，`PJ` = `core/engine/projection.ts`，`RV` = `core/engine/rules/view.ts`，`T/` = `tests/engine/`。

## A. INV-01…19（00-invariants-part2，核心 1）

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| INV-01 | deviates | `core/engine/index.ts:16`；`PJ:519`；`D:96`；`RV:6,14` | 唯一出口不成立：index 导出的是 projection.ts 的矩阵版 `projectForRole`（语义不同），disclosure 版没有从 index 导出（探针 P11），rules 另有 `viewFor` / `projectEvaluation`（AUD-05）。矩阵本身有三行与 07 §7.9 不符：briefs.version、turns.status、approvals.reasonKey（AUD-01/02/03）。 |
| INV-02 | deviates | `D:73-83,99,112` | provider 恒 `undefined`；customer 按三个开关看；cap+committed 推出 headroom ✓（`budgetChecks`、`independently gates committed and headroom…`）。但开关来自调用方传入的自由列表 `Disclosures.fields`，不来自 sharedFacts 最新行，也没有绑定"当前简报版本"（AUD-06）。 |
| INV-03 | satisfied | `AC:27-46` | 只接收 `Projected` 视图，每块按白名单取键；provider 没有 budget；剔除 draft 目录；`openRequestForMe` 必须 `toRole===role` 且状态为 open。测试：`contextChecks`、`nonInterference`（含 context 比对）、`rejects unprojected and non-target request contexts…`。 |
| INV-04 | satisfied（本块外） | `core/engine/strictSchema.ts:78`；`strictSchema.test.ts:385-460` | 禁用属性名测试在 W0-3；`baseProposalVersion` / `proposalVersion` 按 canon §1.4 进允许表。电池里 INV-04 仍是 todo。 |
| INV-05 | satisfied（引擎部分） | `core/engine/publicText.ts`（W0-2b）；`AC:39`；`PJ:1341` | 没有自由 text 槽，有品牌类型与 Proxy reads 测试；目录标题经 `wrapUntrusted(maxChars:80)`，`<>&` 被转义。事件 × 受众模板目录缺失见 AUD-16。 |
| INV-06 | satisfied | `D:172-188`；`core/engine/reasonCodes.ts:139-190` | provider 只得 `{kind:'fit'}`；掩码合并为一条，不带 checkId；通过的检查直接省略；未声明的 param 丢弃。测试：`privacyChecks`、`collapses multiple secret failures…`、`reads only declared visible check parameters`。规则管线的 `CheckResult` 不能直接喂入（AUD-05）。 |
| INV-07 | satisfied | `D:114,132-135`；`EV` | `notIncludedItemKeys` 只为 customer 现算，存储里的值被忽略；payload 中没有 `deferred*`。测试：`computes notIncludedItemKeys only from the customer private list…`。电池 INV-07 仍是 todo，可以转正。 |
| INV-08 | satisfied | `D:48-71`；`T/privacyAssertions.ts:28-37` | `DERIVED_FROM` 污点对账（`validates every lineage…`）；C0 配置下每角色变异 20 次，view / events / context 逐字节比对。缺口：只扫了 C0（16 §16.7.4 的 C1/C2/Ck 由电池任务补）；解密清单问题见 AUD-07。 |
| INV-09 | not_implemented_yet | `core/engine/rules/candidates.ts`（W1-1）；`AC:44` | 快照由 `turns.beginAttempt` 写入（W2-4 #18）。本块只读快照、不重算 ✓。枚举逻辑归规则块审计。 |
| INV-10 | deviates | `D:128,207-243`；`rules/humanRequests.ts:16-43`；`rules/types.ts:21` | 读路径对 options 调 `assertOptionsProjected`，而它依赖的 WeakMap 品牌存库后就丢了，所以从库里读出的请求对目标角色投影必定抛错（P1）。规则侧 `buildHumanRequests` 产出另一套 `RequestOption`（`effect.kind` / `shown`），从不经过 `projectRequestOptions`。电池 INV-10 绑定的是没有接线的 helper（AUD-04）。 |
| INV-11 | deviates | `AC:34` | provider 的 fit 只有两值、历史不重算 ✓（`omits historical fit and checks…`）。clarify 话题只对 provider 剔除 `option_fits_constraints`，canon D12③ 修订后要求对任何角色剔除（P7，AUD-10，设计后改）。previewChange、≤ 4、≤ 6 分属 W2-3 / W2-4 / W2-1。 |
| INV-12 | deviates | `EV:4-135,153-162` | 封闭 payload、没有 visibility、restrictedRef 八表 ✓（`checks the full event catalog…`）。`approval_recorded.reasonKey` 允许 buyers 键 `over_our_limit`（P5；08 §8.6"buyers 键不进 payload"）（AUD-02）。`run_ended.endedReason` 与 03 §3.8 不一致，`room_closed` 缺 `by`（P8，AUD-11）。渲染器（run_waiting 等）没有实现（AUD-16）。 |
| INV-13 | not_implemented_yet | — | `withSanitizedErrors` / `publicOpsLog` 属 W2-1（#15）与 15 章。 |
| INV-14 | not_implemented_yet | — | SSR / RSC 负载属 W2-6（#20）。 |
| INV-15 | not_implemented_yet | — | `addMember` 唯一性，W2-1。 |
| INV-16 | not_implemented_yet | — | 邀请，W2-1。 |
| INV-17 | not_implemented_yet | `AC:28` | 构造器与 `actorUserId` 属 W2-1。纯函数侧已校验 `view.role===role` ✓。 |
| INV-18 | not_implemented_yet | `D:157-170` | `sharedFacts.add` 闸门属 W2-1。读侧已按判别联合校验值形状（`rejects primitive and malformed shared-fact values…`）。 |
| INV-19 | deviates | `T/disclosureCompleteness.test.ts:4-27`；`D:140-144` | 完整性测试用手抄的顶层字段表，不遍历 `convex/schema.ts` 的叶子路径（#38 仍开）；可共享字段由引擎硬编码，不是场景声明（AUD-13、AUD-08）。 |

## B. 03 字段披露类与 13 视图模型

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| 03 §3.16.1 | deviates | `D:21,29` | 多数类与 03 一致：runs 的美元字段和 `lastFailure` 为 system；请求的 kind / toRole 只给买方（toRole 本人也可见）；ledger 只给 finance；sharedFacts 行级受众；attempts.usage 为 system（比 03 更严，与 07 一致）。不一致之处："turns 他方只见粗粒度状态"没有实现（P4，AUD-03）；按 07 / 12 修订，简报版本号对 provider 应为 null（AUD-01）。 |
| 13 视图模型 | not_implemented_yet | — | `rooms.view` 等视图模型属 W2-1 / W2-6。接线时要对齐的命名：`notIncludedItemKeys` ↔ `notIncludedForMe`，`ChecksView.kind` ↔ `fit.audience`，runs 的 `'waiting'` ↔ `run_waiting`（AUD-14）。 |

## C. PV-INV-01…16（07 §7.22）

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| PV-INV-01 | deviates | `D:21,27,29` | 投影输出里仍有 provider 不应看到的东西：他方的 briefVersion / confirmedAt、buyers 级 reasonKey、他方回合的 failed 状态（P3/P5/P4，AUD-01/02/03）。 |
| PV-INV-02 | deviates | `D:42,77-83,112` | 读侧的跨角色预算值经 `Disclosures.fields` 放行，不经 sharedFacts 行（AUD-06）。写侧（无 value 参数）属 W2-1。 |
| PV-INV-03 | not_implemented_yet | `RV:6-9` | ESLint 目录限制与调用图测试属 W2-1 / W2-5。提醒：`viewFor` 的 disclosures 是 `briefs.disclosures` 式的 `Record<field, role[]>`，接线时不得取自他方 briefs 行（AUD-05）。 |
| PV-INV-04 | satisfied | `D:108,174`；`AC:41` | provider 只得 ok / blocked。测试：`omits historical fit…`、`providerDeadlineChecks`、`privacyChecks`。 |
| PV-INV-05 | not_implemented_yet | — | `approvals.record` 唯一写入口，W2-2（#16）。 |
| PV-INV-06 | satisfied（引擎） | `publicText.ts`；`publicText.test.ts:175-249` | "模板实际读取 ⊆ reads"的 Proxy 测试在 W0-2b。事件模板缺失见 AUD-16。 |
| PV-INV-07 | deviates | `EV:116` | buyers 级的 `over_our_limit` 进了 payload 白名单（AUD-02）。 |
| PV-INV-08 | not_implemented_yet | — | 公开路径日志，W2-1 / 15 章。 |
| PV-INV-09 | not_implemented_yet | — | W2-1。 |
| PV-INV-10 | not_implemented_yet | `AC:28` | W2-1 / W2-5；纯函数侧的角色校验 ✓。 |
| PV-INV-11 | deviates（low） | `D:84-88,146-155` | "取 briefVersion ≤ v 的最新行"实现正确 ✓（`keeps historical disclosure version-scoped…`、`gates G701…`）。但 `atVersion` 是单个数字，所有 fromRole 共用（P14，AUD-15）。 |
| PV-INV-12 | not_implemented_yet | `PJ:1341` | 写入闸门属 W2-1；标题正则 helper `wrapCatalogTitle` 已有。 |
| PV-INV-13 | deviates | `D:128,241` | 同 INV-10（AUD-04）。 |
| PV-INV-14 | not_implemented_yet | — | 节流与总量桶，W2-1 / W2-4。 |
| PV-INV-15 | deviates | `D:21` | provider 能看到他人的 briefs.version；作者中立的合并渲染器不存在（AUD-01、AUD-16，设计后改）。 |
| PV-INV-16 | deviates | `D:72` | `DECLASSIFIED` 是 10 个字段路径，不是按 DX-1…DX-13 编号，也没有 `DECLASSIFIERS`（P12，AUD-07，设计后改）。 |

## D. PV-01…16（07 §7.1 决定总表）

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| PV-01 | not_implemented_yet | — | Clerk / proxy，W2-1 / W2-6。 |
| PV-02 | not_implemented_yet | — | 构造器族与 `withSanitizedErrors` 属 Convex 块。 |
| PV-03 | not_implemented_yet | — | 席位与邀请，W2-1。 |
| PV-04 | deviates | `D:7-40,140-144` | 注册表已有，受众类有 room / self / creator / system / 角色集，另加了 buyersOrSelf ✓。问题：场景字段在引擎里硬编码（AUD-08）；`agent` 列没有任何代码读取（AUD-12）；完整性对账靠手抄（AUD-13）。 |
| PV-05 | deviates | `D:42,73-83` | 跨角色的值除了 sharedFacts，还能经调用方的 fields 列表放行（AUD-06）。 |
| PV-06 | deviates | `D:72` | 同 PV-INV-16（AUD-07）。 |
| PV-07 | satisfied | `D:99,112,154`；`AC:36` | provider 恒拿不到预算和派生值；finance → provider 的共享行被硬性剔除；`minAllowedCapCents` 只给 finance。测试：`budgetChecks`、`independently gates committed and headroom…`。 |
| PV-08 | satisfied | `D:172-188` | 同 INV-06；重复实现的风险见 AUD-05。 |
| PV-09 | not_implemented_yet | — | previewChange，W2-3（#17）。 |
| PV-10 | satisfied | `AC:27-46` | 单一入口；反馈只有 `{proposalVersion, outcome}`；他方 rationale / reasonKey 没有入口；标题经定界。clarify 话题的偏差计入 INV-11。 |
| PV-11 | satisfied（引擎） | `publicText.ts` | 品牌类型、reads 声明、Proxy 测试三层都在（W0-2b）；场景与事件模板缺失见 AUD-16。 |
| PV-12 | deviates | `EV`；`D:146-155` | payload、restrictedRef、按值所属版本判定 ✓。问题：over_our_limit 进了 payload；作者中立与合并渲染缺失（AUD-02/16/01）。 |
| PV-13 | satisfied（引擎） | `D:109-131` | 逐字段按白名单构造，嵌套对象未投影即抛错；`returns` 探测属 W2-1。 |
| PV-14 | not_implemented_yet | — | 日志纪律，W2-1 / 15 章。 |
| PV-15 | not_implemented_yet | `PJ:1341` | 写入闸门，W2-1。 |
| PV-16 | not_implemented_yet | — | 频率上界，W2-1 / W2-4。 |

## E. canon D11–D14、D23

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| D11 | deviates | 见 INV-01/10/19 | 派生值取最严格类、删除 deferred、掩码检查 ✓。不成立的三项：统一入口、选项写入前断言、矩阵自动对账（AUD-05/04/13）。 |
| D12 | deviates | `AC:34`；`D:136` | ① ✓。③ 只对 provider 剔除（AUD-10）。④ ✓（三开关的来源见 AUD-06）。⑦ humanRequests → `run_waiting` ✓，但 runs.status → `'waiting'`，命名不一致（AUD-14）。⑧ 读侧值形状 ✓。②⑤⑥ 与自动开局属 W2。 |
| D12 ⑥ 总量桶计数源 | unverifiable | `EV:19-26` | 07 §7.13 与 12 B7 用 `catalog_item_confirmed{priceChanged}` / `brief_confirmed{hardChanged}` 计数，但 03 §3.11.1 的事件目录（以及 convex 的 `eventPayloadV`）都没有这两个字段，代码随 03。这是设计冲突，等 03 / 12 裁决。 |
| D13 | deviates | `EV:116`；`D:27` | 模板引擎 ✓。人类拒绝的 reasonKey 应按 `humanReasonKeys[].audience` 渲染、buyers 键不给 provider，引擎里没有这个概念（AUD-02，设计后改）。 |
| D14 | deviates | `EV` | 没有 visibility、payload 白名单、restrictedRef ✓。over_our_limit、endedReason、room_closed 与 03 不符（AUD-02/11）；受众渲染器没有归属任务（AUD-16）。 |
| D23 | satisfied（引擎） | `reasonCodes.ts:169-172`；`D:112`；`AC:36` | `minAllowedCapCents` / `belowByCents` 只给 owner（finance）；预算 DTO 与代理上下文对 customer 都剔除了它。拒绝写入与三处对称守卫属 W2-1。 |

注：D12① 要求 provider 的历史只显示 `superseded / rejected / executed / current`，07 §7.9.3 则允许所有角色看到 `stale`，两处互相矛盾。代码对 provider 原样透传 `stale`（P17），等设计统一后再判，不计入偏离。
