# 09 · 约束变化（part5）：历史、不变量、备选、测试、开放问题、与 canon 对照

> 分片清单见 `09-constraint-changes.md` 顶部。

## 9.10 历史保留与展示

| 保留什么 | 在哪里（全部只追加） | 谁能看 |
| --- | --- | --- |
| 每个 cv 的原因、操作者、变化来源 | `constraintRevisions` | 无直接公开 query；时间线经 `constraints_changed` 事件按受众渲染（canon D14） |
| 硬字段每个历史值 | `briefs` 版本 | 本人全量；他方只见本人勾选披露的字段 |
| 目录每次定价修订与标题编辑 | `catalogItems`（`retired` 行保留） | 全体成员（`draft` 行只 provider） |
| 台账每笔 | `ledgerEntries`（`baseline` / `commit`） | finance；customer 经 finance 的字段级开关 |
| 旧审批 | `approvals`（绑定 cv 与 `termsKey`） | 角色、决定、cv 全体可见；`note` 只本人 |
| 旧提案 | `proposals`（`stale` / `superseded` / `rejected`） | 全体；provider 只见 `fit` 与历史状态 |
| 执行时快照 | `executions.constraintsVersion`、`approvalIds`、`committedBeforeCents` / `committedAfterCents` | 结果页 |

展示规则（13 定稿文案）：
- 房间头部常驻 `Proposal vN · Constraints vM · Viewing as X`（canon D19）。
- 审批面板的 stale 行："No longer applies · approved under constraints v1"；customer / finance 另见"constraints changed by Finance"（角色由 revision 的 `actorUserId` 推出，`clock` 显示 "Date rolled over"），provider 只见 "Constraints changed"（03 §3.7 的披露类）。
- R2 沿用的提案（`createdAtConstraintsVersion` ≠ 当前 cv）显示 "Terms unchanged since v1 was proposed under constraints v1; now evaluated under constraints v2"——取代 RA-R11 的复制版本。
- 只有当前提案显示"在当前约束下的检查清单"；历史提案只显示历史状态，不在当前约束下实时重算（对 provider 尤其如此，canon D12 ①：重算的结论本身是预算探针）。
- 结果页只读执行快照；房间已 `executed`，之后不会再有约束变化（canon D04）。
- 审计："v1 在 cv 2 下为什么被阻断"= `checkProposal(v1, replayRuleInput(roomId, ref))`，`ref` 取那次判定的求值引用（9.3）：判定发生在 bump 到 cv 2 的事务里（9.8 主线的 R2 沿用预检）时，就是 revision 2 行的 `{ constraintsVersion: 2, localDate: revision.localDate }`；发生在捕获点（如 `executeIfComplete`）时取该处记下的引用。按查看者投影后显示。

## 9.11 不变量

| ID | 不变量 | 落点 |
| --- | --- | --- |
| INV-CC-01 | `rooms.constraintsVersion` 只在 `constraints.bump` 中改变，每次恰好 +1；`bump` 只被 `withConstraintChange`、`openIfReady`、`clock.rollLocalDate` 调用 | 结构测试 CC-17 |
| INV-CC-02 | 每次 bump 恰插入一行 `constraintRevisions`，`version` = 新 cv；每房间版本从 1 起连续、无重复 | `bump` 读写 `rooms`（OCC）；CC-16 |
| INV-CC-03 | 房间 `open` 时，一次写入改变了硬投影 ⇔ 该写入内发生 bump | `withConstraintChange`；CC-01/02/03 |
| INV-CC-04 | 来源表的确认写入（简报版本、目录确认 / 退役行、基线）只出现在 `withConstraintChange` 的 `apply` 回调或 `setup` 路径 | 结构测试 CC-17 |
| INV-CC-05 | bump 提交后：不存在 `constraintsVersionAtStart ≠ room.constraintsVersion` 的非终态 run、不存在旧 cv 的 open 请求、不存在当前 run 之外的 `active` 提案 | `disposeCurrentRun` + `react`；F1–F4 |
| INV-CC-06 | 任何时刻 `capCents ≥ committedCents`；`committedCents` 在 `open` 期间恒定 | 9.6.1 / 9.6.2 / 9.6.5 / 9.7；执行检查 |
| INV-CC-07 | 反应链一次 mutation 内至多 4 层；v1 恒为 1 层 | `MAX_REACT_DEPTH`；CC-15 |
| INV-CC-08 | 执行不 bump；`executed` / `closed` 房间不 bump | M21；入口守卫 |
| INV-CC-09 | 硬投影从不持久化；`constraintRevisions` 不含任何约束值 | 9.1.1、9.3；金丝雀 CC-21 |
| INV-CC-10 | 被人拒绝的提案永不因约束变化回到 `active` | 9.5；CC-10 |
| INV-CC-11 | 只改标题 / 任务模板不改变定价修订号、不 bump、不让任何提案被 `version.stale_source` 阻断 | 9.1.3；CC-11 |
| INV-CC-12 | 推进 `localDate` 本身不 bump；只有当前 `pending_approval` 提案或 open 请求选项的时间结论翻转才 bump | 9.6.7；CC-13 |

## 9.12 备选与否决

| 备选 | 来源 | 否决理由 |
| --- | --- | --- |
| 每个调用点手写 `bump` | Role A、多数候选 | 漏递增（RA-B02）；改为投影比较自动判定 |
| 每次写约束来源无条件 bump | 部分候选 | 同值写入、改标题都作废全部审批；provider 改标题即可冻结协商（inputs/07） |
| 存投影哈希判断变化 | — | 上限值域小可枚举反推；同事务比较内存值即可 |
| `rooms.catalogRevision` 守卫 | agentquality 候选 | 改标题递增它却不 bump，在途回合全被判 stale、提案永久 `STALE_CATALOG`（inputs/07）；字段删除（canon D05） |
| `today` / `todayAnchor` 进投影，每日 cron bump | invariants R-I | 每天午夜作废全部审批（canon D22） |
| 不处理时间，审批时用当天重算交付日 | 多数候选 | 跨午夜提案永久不可执行且无出口（inputs/07 ≥ 8 条）；改为绝对日期 + 翻转才 bump |
| 上限可低于已承诺并进入 `needs_input` | inputs/02、eventsourcing CC-7、runtime 候选 | 无合法出口、余量为负、fixture 依赖不可达状态（canon D23） |
| 执行 bump | plugin / finance / security / runtime 候选 | 已执行审批随即显示 stale，执行后房间本就终态（canon C4） |
| 单层反应（一次 `react`） | eventsourcing 候选 | 回答触发的 bump 不再开新 run，run 停在无请求的 `needs_input`（inputs/07） |
| bump 后保留 run 于 `pending_approval` | versioned-approvals D6、plugin R9 | 旧 run 跨版本存活导致之后回合全被拒（活性死锁 1）；改为取代 + R2（canon C10） |
| 复制一个 revalidated 提案 | Role A RA-R11 | 噪音行，旧审批与新行脱钩 |
| 按类别失效（预算只作废 finance 审批） | — | 需要逐类证明无关性，规则一多就错（versioned-approvals D11） |
| 用被调度的 `afterConstraintChange` 异步开 run | product 候选 9.3 | 提交与跟进之间存在"run 已取代但无新 run"窗口，且其"提案仍可执行就直接返回"分支让 run 停在已取代态；canon D06 要求同事务 |
| 回填 `producedConstraintsVersion` 到来源表 | versioned-approvals | 违反只追加，信息已在 `sourceRefs`（r11） |
| `setup` 期逐条 bump | eventsourcing 候选（"无特例"） | 无 run / 提案 / 审批可失效，只产生噪音版本；开房一次 bump 到 v1 让"cv ≥ 1 ⇔ 房间已开"成立 |
| 场景升级时对所有房间 bump | product 候选 | v1 房间钉住 `scenarioVersion`，不存在就地升级 |

## 9.13 测试清单（16 引用）

| ID | 内容 | 层 |
| --- | --- | --- |
| CC-01 | 递增矩阵 M1–M30 表驱动：给定前后输入断言是否 bump 与 `cause` | 纯函数 + CT |
| CC-02 | 性质：`localDate` 与 `committedCents` 相同时投影相等 ⇒ 任意生成提案的阻断集合相等（与 06 HP1–HP4 共用生成器） | 纯函数（性质测试） |
| CC-03 | 性质：改任一投影字段 ⇒ 投影不等；只改标题 / 任务模板 / 软字段 / 披露 / 数组顺序 ⇒ 相等 | 纯函数 |
| CC-04 | `budget.setCap` 同值 → `unchanged`，无简报、无 revision、无事件、不计节流 | CT |
| CC-05 | 9.8 主线逐步断言：每步的 cv、revision 行、run / 提案 / 请求状态、审批派生值、事件、三方 DTO（含 provider 只见 `fit` 与 `run_waiting`） | CT |
| CC-06 | V1：$4,700 → R3 且 stub 调用次数为 0 → `raise_cap` 回答 → cv 3 → 新 run；revision 3 行 | CT |
| CC-07 | V2：$4,799.99 → 不可行 | 纯函数 + CT |
| CC-08 | V3：$3,900 → `budget.below_committed`；所有表行数不变 | CT |
| CC-09 | V4：上调 → R2 沿用同一 `proposalId`、零调用、旧审批 stale、重批后 `executions.constraintsVersion = 2` | CT |
| CC-10 | V5：被拒提案不复活 | CT |
| CC-11 | V6：改标题不 bump、审批仍有效、执行成功且变更单用快照标题 | CT |
| CC-12 | V7：无关改价 bump 并经 R2 沿用 | CT |
| CC-13 | V8：假时钟跨午夜；翻转 → bump(`clock`)；不翻转 → 只改 `localDate` | CT |
| CC-14 | V9：回合在途时 bump → 新 run `negotiating`（不经 R2 沿用 v2，provider 回合重新提出、两位评估方重新评估）、迟到结果 `stale`、用量照记、未读上下文的 action 不调模型 | CT |
| CC-15 | 每种 `cause` 下反应链 1 层；注入递归反应 → 第 4 层抛 `constraints.react_depth_exceeded` 且整笔回滚（行数不变） | CT |
| CC-16 | revision 版本连续；每条求值记录按其求值引用 `{ constraintsVersion, localDate }` 调 `replayRuleInput`，与当时 `loadRuleInput` 逐字段相等；同一 cv 跨午夜的两条记录重放出各自的 `localDate`；不存在的 cv → `replay.unknown_version` | CT |
| CC-17 | 结构：`constraintsVersion` 的 patch 只在 `bump`；`bump` 只被三处调用；来源确认写入只在 `withConstraintChange` / `setup` 路径；`bump` / `react` / `withConstraintChange` 内不调用 `openRoomTx`（写锁由入口持有，04 §4.1.2） | AST |
| CC-18 | `ledger.recordBaseline`：超过上限拒绝；`open` 中拒绝；重复录入拒绝 | CT |
| CC-19 | `executed` 房间的 `budget.setCap` / `briefs.confirm` / `catalog.*` → `run.invalid_state`，不 bump | CT |
| CC-20 | 真实部署并发：最后一票与 `budget.setCap` 交错 50 次只出现 9.9 V10 两种结果；两个约束写入并发 → 版本连续 | RD |
| CC-21 | 隐私：`constraints_changed` 三受众渲染（finance 新旧值、customer 按披露、provider 通用句）；三方金丝雀扫描所有订阅不含 revision 内容或上限值（provider） | CT + E2E |
| CC-22 | `rooms.previewChange`：finance 得 `verdictAfter`；customer / provider 得 `recheck` | CT |
| CC-23 | 约束效果回答但投影未变（注入）→ 不 bump、按 04 R20 重跑预检（与 04 SM-13 共用） | CT |

## 9.14 开放问题

- **Q1**（已裁决，canon D06 / §1.3 修订）：只在被取代 run 被取代前处于 `pending_approval` 时沿用其提案（9.4 `keepCandidateId`、9.5 表、V9、CC-14）；`negotiating` / `needs_input` 中的提案代理评估未完成或已被代理否决，一律重新评估（04 §4.15 Q1）。
- **Q2**（已关闭）：定价修订号 + `editNo`（9.1.3）是同时满足 canon D05（仅改标题不 bump、投影含 `revision`）与 D25（`lines[].revision` 判 `version.stale_source`）的唯一读法；canon §1.1 / §1.2 已采纳（逻辑唯一 `(roomId, itemKey, revision, editNo)`），03 §3.7 与 06 §6.2 同此。
- **Q3**（已关闭）：canon §1.1 已补录 `constraintRevision`（03 §3.7 落地）。
- **Q10**（已关闭）：06 §5.3 已改为同事务 before / after 比较、投影不持久化（与 9.1.1、03 §3.7 一致）。
- **Q4**：统一失效让无关目录改动也作废全部审批（V7）。若实际使用中骚扰明显，17 可评估"只在影响当前提案引用项时 bump"——它会破坏"投影相等 ⇒ 阻断相等"的简单性质，v1 不做。
- **Q5 / Q6**（已关闭）：canon D27 已改写（C57）为"2 条 `stale_approve` + finance pending"与"provider 在 run#2 提出 v2 $800（stub 第 1 轮选 $900 被阻断、第 2 轮选 $800）"，$4,700 变体为 finance 的 `raise_cap` 480000 / 490000；05 / 08 / 14 的走查同此。
- **Q7**：`clock` 只检查 `pending_approval` 提案与 open 请求选项；`negotiating` 依赖 R5 前的重算。若 17 引入报价有效期（`validUntil`），`timeVerdicts` 须加入目录项过期。
- **Q8**：四个约束写入按 12 B5 都带 `expectedConstraintsVersion`（`version.stale_constraints`）。代价：他人的并发约束变化会让自己的提交被拒一次、需看过新预览再提交；这正是"按所见预览确认"的意图，但若实际使用中 provider 的目录编辑频繁打断 finance，可把它降为可选参数。
- **Q9**（已关闭）：`catalog.confirm` 统一为批量 `rows[]`（≤ 14 行、计一次节流，12 §12.12 为准）；`kind` 变化统一报 `item.duplicate`。
- **Q11**（已关闭）：9.6.7 (b) 让物化条款的 mutation 在 `rooms.localDate` 落后时同事务调用 `rollLocalDateTx` 先推进日期；canon D22 修订已明文允许（只有 `clock.rollLocalDate` 及其事务 helper `rollLocalDateTx` 与 `rooms.create` 计算真实日期），每房间本地午夜 `runAt` 精确推进、小时 cron 兜底也已写入 D22。

## 9.15 与 canon 的对照

- §1.2：`constraintsVersion` 唯一写入口 `constraints.bump`；`localDate` 只由调度 mutation 推进，query 不读 `Date.now()`；`actorUserId` 显式传入（9.3、9.6.7）。
- §1.6：`budget.setCap`（`newCap >= committedCents` 否则 `budget.below_committed`）、`briefs.confirm`、`catalog.confirm` / `catalog.retire`（价格 / 工期 / 增删 bump，仅标题不 bump）、`ledger.recordBaseline`（`setup` 一次）、`humanRequests.answer`、`constraints.bump`（含 `react()` 不动点）、`clock.rollLocalDate`、`rooms.previewChange` 照用（9.6）。
- D03：执行不 bump，`executionKey = exec:${proposalId}`（M21、9.8.2 步 12）。
- D04：执行后房间终态，约束写入 `run.invalid_state`（9.5、CC-19）；`startFollowUp` 新房间从 cv 0 起（M27）。
- D05：递增矩阵（含不递增项）、硬投影形状逐字采用、目录在投影内、性质测试、不比较 `catalogRevision`（9.1、9.2）。
- D06：bump 同事务取代 run、active → `stale`、请求 → `superseded`、`react()` 深度 4、预检沿用同一 `proposalId`、被拒提案不参与、回答产生的 bump 同链（9.4、9.5、V4、V5）；沿用只限被取代 run 处于 `pending_approval`（canon D06 / §1.3 修订，9.14 Q1、V9）；系统路径不因排空 / `run_starts` 节流抛错（9.4.1 第 3 条）。
- D11 / D15：infeasible 请求按目标角色自身视图生成，`raise_cap` 只给 finance（V1）。
- D12 ②⑥⑧：`previewChange` 只对 finance 给结论，且只回答当前提案的预算检查（不做 feasibility 枚举，privacy-03）；约束写入节流另加 `price_writes` 桶（07 §7.13）；日期窗口与标题闸门（9.6）。
- D14：`constraints_changed` 三受众渲染，revision 不存值；事件 `actor` 为 system，变更角色只经 `restrictedRef` 在渲染时按查看者连接（9.3、9.4、9.10）。
- D17：系统路径不因排空 / 上限抛错（9.4.1 第 3 条）。
- D18 / D27：fixture 数字与五个变体；主线按 D27（C57 修订）：2 条 `stale_approve` + finance pending、run#2 提出 v2 $800；$4,700 → finance `raise_cap` 480000 / 490000；$3,900 为拒绝写入，不 seed（9.8、9.9）。
- D22：绝对交付日、`localDate` 由本地午夜 `runAt` 精确推进 + 小时 cron 兜底、物化前同事务 `rollLocalDateTx`、结论翻转才 `bump(cause: clock)`，否决 todayAnchor（9.6.7、V8、9.14 Q11）。
- D23：低于已承诺拒绝、只给 finance `minAllowedCapCents`、规则码只作防御（9.7、V3）。
- D19（经 12 B5）：约束写入带 `expectedConstraintsVersion`，返回 `confirmResultV` 不含 run 去向（9.6）。
- D25：提案只改 status；`lines` / `plannedTasks` 快照让改标题不影响提案（9.1.3、V6）。
- C4、C7、C8、C9、C10、C11、C32：分别落在 M21、CC-D7、CC-D3、CC-D2、9.5、9.4、9.7。
- canon 包修订新增的 C46、C47、C52、C54、C57：分别落在 9.1.3（定价修订号 + `editNo`）、9.4 / 9.5 / V9（只沿用 `pending_approval`）、9.4.1 第 3 条（系统路径照常建 run）、M17（`pass_to_next` 不 bump）、9.8 / V1（D27 主线与 $4,700 变体）。
