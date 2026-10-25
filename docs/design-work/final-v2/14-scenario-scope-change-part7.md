# 14 · 首个场景（part7：测试、不变量、开放问题、与 canon 的对照）

> 分片总表见 `14-scenario-scope-change.md` 顶部。本片：§13–§16。

## 13. 测试（数字全部由 fixture 推出；规则级用例见 06 §13）

| 编号 | 层 | 用例 | 期望 |
| --- | --- | --- | --- |
| T14-F01 | 纯函数 | `toFixtureTypesInput(main, a)` 经 fixture-types `loadFixture`，锚点 a ∈ {2026-11-02, 2027-02-20} | 结构、交叉引用、期望金额自检全部通过；§9.3 每条期望与 `checkProposal` 结论一致 |
| T14-F02 | 纯函数 | `materializeFixture` | 截止日 = `addDays(a, 18)`（2027-02-20 → 2027-03-10）；fixture 源码中除 `goldenAnchor` 外无绝对日期（lint） |
| T14-F03 | convex-test | `seed.fromFixture('main')` | 只经 §9.1 的生产 mutation 链写入；全部行 `provenance: 'seeded'`；seed 结束时无提案、审批、执行，run 1 已由第三份确认按生产路径开始 |
| T14-R01 | 纯函数 | `candidateSpace` + 检查 | provider 视图 2 个候选（§6.1）；全局可行集：cap 500000 → `[$800, $900]`，480000 → `[$800]`，470000 → `[]` |
| T14-R02 | 纯函数 | 截止日改为锚点 +13（2026-11-15） | 基础 `audit_log_export+sso_login` 11-16 超期 → 生成 `@rush`（11-12，$950）且可行；rush 只计一次；截止日满足时不生成 rush |
| T14-R03 | 纯函数 | `materialize` | 金额 = Σ 行；交付日 = `localDate + effectiveLeadDays`；`plannedTasks` 来自任务模板，rush 不产生任务 |
| T14-R04 | 纯函数 | `stubDecide` | run 1 provider 选 O2；run 2 第 1 轮选 O2（被阻断）、第 2 轮选 O1；customer 在 v1 / v2 上 `recommend_accept`（S4 的 customer 快照 n = 1，v1 的愿望重合不低于快照最优，所以不 counter）；finance 通过即接受、不通过 `reject(over_budget)`；快照（已剔除 base）n = 0 时 `allowedActions` 不含 counter |
| T14-R05 | 纯函数 | `relaxations` | A：finance `raise_cap` 480000 / 490000；D：customer `drop_items [audit_log_export]`；E：`extend_deadline` 11-29 / 12-03 |
| T14-T01 | 纯函数 | 模板 | §8 所有示例句逐字一致；每个变体 Proxy 实际读取 = `reads`；provider 收到的全部文本不含预算数值与私密截止日；provider 与 finance 的全部文本不含按角色的代理动作（"agent declined" / "recommends" / 代理 `reasonKey`，privacy-04、16 TC-PRIV-20）；provider 对四种 cause 的 `constraints_changed` 渲染逐字相同（§8.3） |
| T14-G01 | convex-test | 主走查 S0–S13（stub，`drainDue` 只推进到期任务） | 每步断言 cv、run / 提案 / 审批状态、事件类型序列（类型名逐个取自 03 §3.11.1 的 `eventPayloadV`，含 `proposal_status_changed`）、三方 `rooms.view` golden JSON（S7 后三方对 v1 都只见 "This version no longer applies (constraints v2)"）；`rooms.previewChange` 返回值与 12 §12.17 的 validator 逐字段一致；终态与 §10 S13 表一致 |
| T14-V01–V07 | convex-test | 变体 A–G | A/B/D/E 的无解 run 中 turns 与 attempts 为 0；C 无写入、无事件、cv 不变；D 全程无异常；E 午夜前后审批均有效、交付日过去才 bump；F 截断 golden、F-a 的 D06 沿用同一 `proposalId`、F-b 下调后 v1 `budget.over`（超 8982 只给 finance）且 run 2 以 $800 执行；G 标题闸门两种码（尖括号 → `input.invalid`，定界词 → `disclosure.blocked`）与代理零审批 |
| T14-C01 | convex-test | canary 扫描 | `lintCanaries` 通过；三身份双向扫描（rooms.view、timeline、请求 DTO、ConvexError、他方代理上下文、stub 捕获请求体、日志）零越权 |
| T14-I01 | 纯函数 + convex-test | 注入语料子集（目录标题 INJ-15、shared fact INJ-17）配本 fixture | invariant 断言全部成立（零越权、零代理审批、公共文本来自模板、金额 = 目录求和） |
| T14-E01 | 真实 dev 部署 | 两个最后一票并发提交（spikes §8） | 恰一条 execution、一条 commit 台账、一张变更单 |

## 14. 不变量（场景级；引擎级见 06 §14）

- INV-S1 每份提案的 `amountCents` = 插入时已确认行价格之和；rush 每份提案至多计一次，且只在"提出方视图不知道截止日"或"基础变体晚于截止日"时出现。
- INV-S2 `deliveryDate = 插入日 localDate + effectiveLeadDays`，插入后从不重算；跨午夜不使审批失效，交付日真的过去才由 `clock` bump。
- INV-S3 硬字段只经 `briefs.confirm`、`budget.setCap`、`humanRequests.answer`（`raise_cap` / `drop_items` / `extend_deadline`）、`catalog.confirm` / `catalog.retire` 改变，且都经 `constraints.bump`；`capCents < committedCents` 永不落库。
- INV-S4 fixture 不含提案、审批、执行、事件；seed 行全部 `seeded`，stub 产物全部 `stub`，界面统一徽章。
- INV-S5 任何 schema、模板、变更单中都不存在 deferred 列表；"未纳入的愿望项"只出现在 customer 的 owner 变体。
- INV-S6 provider 永不收到预算字段、reasonCode 与参数；customer 只按 finance 的三个开关看到预算字段。

## 15. 开放问题

1. U1：`customerSeesBudget` 默认关，fixture 只开 `capCents`；若用户改为默认披露 headroom，§8.4 的 customer 列与 §11 A 的 customer 文案随之改变，规则不变。
2. U2：provider 只见 `ok` / `blocked`；若改为原因类别，§8 需增加 provider 变体。
3. modifier 是否允许叠加（v1 每个候选至多一个）；rush 是否改为按条目计费（D25 默认整单一次）。
4. 房间开放时 cv 的编号（09；本章按开放时 cv = 1 书写）。
5. （已统一）被阻断的 provider 候选不插提案、不消耗版本号（03/04/05/06/08/09 同口径，$800 为 v2）。
6. （已裁决）人类拒绝理由的受众由 `humanReasonKeys[].audience` 声明（`room` / `buyers`）；代理拒绝对他方一律不按角色显示（§3、07 DX-6、08 A13）。
7. convex-test 中冻结系统时间的可行性（待验证）；不可行时 golden 期望改写为相对 `room.localDate`。
8. `preferredDate` 这类软日期偏好被删去；若 13 需要"希望更早交付"的表达，再以软字段加回（不进规则、不进投影）。
9. canary 变体里 stub 因截止日私密而连续三轮被阻断：这是确定的测试路径（覆盖 `rounds_exhausted` 与 D06 沿用），真实模型行为由 16 的离线评测观察。
10. 任务模板标题的码点上限：03 §3.2 `TEXT_LIMITS` 为 80，12 §12.12 ⑥ 为 120；本章按 80 书写（与目录标题同一闸门最简单），待 03 / 12 对齐。

## 16. 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| D05 / C8 / C9 | 目录改价、改 `leadDays`、新增、撤下（含 rush）递增；只改标题 / 任务模板不递增；硬投影含目录（§5、06 §5.3） |
| D06 | §11 F：下调后提案仍通过 → 新 run 直接 `pending_approval`、沿用同一 `proposalId`、各方重批；§10 S7：不通过 → 新 run 协商 |
| D08 | provider 提案被阻断不调评估（§11 A3、F）；评估串行 customer → finance |
| D10 / C21 / C26 | 模型只选 `optionKey`；首轮锚点为最便宜候选；provider 候选不按预算过滤；按 `candidateKey` 码点序 ≤ 12（§6.1、§11 F golden） |
| D11 / C24 / C25 | 无 deferred；customer 现算"未纳入的愿望项"；请求选项只用 `toRole` 视图（§6.4） |
| D12 / C27 / C31 / U1 | provider 只见 `fit`；`previewChange` 只对 finance 求值且只回答当前提案的预算检查、不做 feasibility 枚举，返回形状逐字取自 12 §12.17（S7，privacy-03）；stale 提案对任何人都不重算（S7，privacy-09）；provider 不能问预算话题；finance 只披露 `capCents`；`run_waiting` 投影；评估方代理的动作不渲染给他方（§3、§8.5 `agent.recommended` / `turn.blocked`） |
| D13 | 公共文本三受众模板、`reads` 对账、无自由字符串槽位；目录标题闸门（格式 / 长度 → `input.invalid`，定界词 → `disclosure.blocked`，与 06 §4、12 §12.12 同口径；§5、§9.6、§11 G） |
| D14 | `constraints_changed` 三种渲染；payload 只有 `{ fromVersion, toVersion }`（早稿把 cause / actorRole 放进 payload 已改正：payload 全房间可见，provider 会读到"finance 改了约束"）；cause、角色与数值经 `restrictedRef → constraintRevisions` 按查看者连接；provider 对任何 cause（含目录、clock）都只见 "Constraints changed (v{n})"；目录事实对三方同一句，但由 room 类的 `catalog_item_retired` / `catalog_item_confirmed` 事件渲染，不经 `constraints_changed`，因此无需偏离 D14（§8.3、§11 D1） |
| D15 | 每个无解或用尽都恰好一个请求、`relaxationOrder`、`pass_to_next` 按位置提供（§11 D、E 的 customer 请求有，A 的 finance 请求没有）、无 `close` 选项、`keep_as_is` 每 run 一次（§11 A、D、E、F） |
| D18 | seed 走生产写入口、停在首个 run 开始、不预置提案审批执行（§9.1、T14-F03） |
| D22 / C7 | 日期相对锚点存储、按 `localDate` 物化；插入时绝对日期不重算；`clock` 翻转才 bump（§6.2、§11 E） |
| D23 / C32 | `below_committed` 为拒绝写入（§11 C） |
| D25 / C38 | rush 为 `catalogItem(kind: 'modifier')`、整单一次；`lines` / `plannedTasks` 快照 |
| D26 | stub 与模型共用输出 schema 与下游（§6.3） |
| D27 / C37 | 目录 5 项 $1,400、必需 $800、v1 $900、下调 $4,800 后 stale + `budget.over`、$800 恰等于上限通过、$4,700 零调用请求、减一分、低于已承诺拒绝、canary 奇数美分、标题注入（§9–§12） |

| must_absorb | 落点 |
| --- | --- |
| 目录 5 项 $1,400；必需 $800；v1 $900；cap → $4,800 后 stale + `budget.over`；$800 恰等于上限通过；$4,700 escalate 零调用 | §9.2、§10 S4–S11、§11 A、§12 |
| 边界减一分、`below_committed` 拒绝、canary、标题注入变体 | §11 B、C、F、G；§9.5–§9.6 |
| rush 为 `catalogItem(kind modifier)`；`relaxationOrder = [customer.drop_items, finance.raise_cap]` | §2 S-D1/S-D7、§5、§6.4 |
| 公共模板三受众示例；`constraints_changed` 三种渲染 | §8.2、§8.3 |
| 走查每步标 cv / 提案 / 审批 / 事件 / 各角色所见 | §10 S0–S13、§11 A/D 表 |
| 日期相对锚点存储、按 `localDate` 物化 | §9.1、§9.2、T14-F02 |

两处原与 canon D27 文字的差异（canon 包已据此改写 D27，C57；以下保留为说明）：① D27 写"3 条审批 stale"，但最后一票会在同一 mutation 内执行（D02/D03），下调前最多只能有 2 条审批，本章写 2 条；② D27 写"stub counter 只含必需项 $800"，按 D08（provider 每轮先提、被阻断不调评估）与 D10（快照剔除本 run 已提出的键），$800 由 provider 在新 run 第 2 轮提出（第 1 轮的 $900 被阻断）、customer 建议接受，金额与结论相同。
