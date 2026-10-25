# 18 · 开放问题（part7）：用户决策 U1–U12 与各章新发现

> 分片见 `18-decisions-open-questions.md` 顶部。全篇按 canon 默认值书写；下表写明每项改动会牵动哪些章。

## 18.4 开放问题

### 18.4.1 用户决策（canon part4，默认值已写入各章）

| # | 问题 | 默认 | 备选 | 改为备选时牵动 | 谁定 / 何时 |
| --- | --- | --- | --- | --- | --- |
| U1 | `customerSeesBudget`：customer 是否默认看到 finance 的预算数字 | 关；finance 三个字段级开关（`capCents` / `committedCents` / `headroomCents`），fixture 只开 `capCents` | 默认披露余量区间 / 全披露 | 07 矩阵、13 `budgetViewV` 的 `disclosed` 分支、14 fixture 与金丝雀期望、16 扫描期望 | 项目负责人，实现前 |
| U2 | provider 的 fit 信号粒度 | 只有 `ok` / `blocked` | 原因类别（预算 / 范围 / 日期）不带参数 | 06 reasonCode 受众、07 威胁模型残余、13 检查视图、16 推断用例 | 项目负责人，实现前 |
| U3 | 执行后房间 | 终态 + `startFollowUp` 新房间（D04） | 同房间追加轮（PD-05b，17 E1 的前置不变量全部要做） | 02 / 04 / 06 / 08 / 09 / 13 / 14 | 项目负责人；改动需先写新 ADR |
| U4 | 评估回合串行的墙钟（每轮约 3 次串行调用） | 接受 | 并行（需重新设计屏障） | 04、05、10 | 项目负责人，M2 测得 p50 / p95 后复核 |
| U5 | 模型与 effort | 全 `claude-opus-5-5`、协商 `medium`；dev $100 / prod $300 每月 | 评估回合 `low`；Sonnet / Haiku（需用户指定） | 10、15、16 评测 | 项目负责人；M2 评测后 |
| U6 | 第二场景（只做契约测试） | `procurement_rfq` | `event_budget` / `shift_swap` | 06 插件接口、16 契约测试、17 §17.3 | 项目负责人 |
| U7 | 审批是否可撤回、是否过期 | 可撤回本人 approve（不可撤回 reject）；不过期 | 7 天过期（PD-08） | 04 审批状态、08、13 槽位、17 E9 | 项目负责人 |
| U8 | 一人兼任两角色 | 不支持（D24） | 允许兼任但审批不计两票 | 03 唯一性、07 动作矩阵、08 判定 | 项目负责人；H1 验证后复核 |
| U9 | 采购：Convex Pro / Vercel Pro + 自有域名 / Axiom（techstack D28 / D31 / D32） | 设计按已采购写并保留 X5 退路 | 不买 | 15 可观测性、备份、日志去向 | 项目负责人；首个真实用户进 prod 前 |
| U10 | ESLint 10 升级时机 | 独立 PR，v1 用 9.39.5 | 立即 | 11、15 | 实现者 |
| U11 | spikes §8 的 18 项真实部署验证由谁、何时做 | 实现第 1 周（M0），按 §18.5 的影响章分配 | — | 全部 | 项目负责人指派 |
| U12 | 产品名 | 沿用 Speak for Me，`APP_NAME` 单点 | 改名 | 00、13 页面标题 | 项目负责人 |

### 18.4.2 写作中的新发现与跨章冲突（需 canon 修订、集成者统一或产品拍板）

| # | 问题 | 来源 | 当前处理 | 建议 / 需要谁 |
| --- | --- | --- | --- | --- |
| N-01 | 取舍卡的"转交给另一位参与者"出口：canon D15 的 effect 集合没有对应项 | 13 §13.6、part7 13 must_absorb | **已解决**：canon D15 新增 `pass_to_next { toRole }`（C54）：只在 `infeasible` 请求、按 `relaxationOrder` 位置提供，不 bump；04 R21、05 §5.11、06 §11、12 §12.14、13 §13.6、14 §11 已落地 | — |
| N-02 | `rooms.startFollowUp` 预分配席位前是否需要另两方确认 | 01 C12、12 §12.6 | 12 已定任一原成员可发起、每执行至多一个后续房间 | 07 决定是否需要"接受加入"一步 |
| N-03 | 模型长时间不可用时 `agent_failed` 请求是否给 customer 增加 `choose_candidate` 出口 | 01 X1 | v1 只有 `retry_turn` / `end_run`（fail-closed） | 产品决策；采纳则改 D15 出口表 |
| N-04 | canon D27 的"3 条审批 stale"与"stub counter $800"在真实协议中都不出现：第三票同事务执行；被阻断提案不进评估回合 | 01 C7、09 Q5/Q6、14 S7–S8 | **已解决**：canon D27 已改写（C57）为 2 条 `stale_approve` + finance 待批、provider 在 run 2 提出 v2 $800 | — |
| N-05 | canon §1.5 码表缺：`approval.not_executable`（D02 已用）、`approval.nothing_to_withdraw`、`item.limit_exceeded`、`input.invalid`、`auth.*`、`invite.*`、`request.*`、`version.stale_constraints` 的写入语义 | 01、13、04 Q6、06 #1、08 O3、00-invariants §4.2 | **已解决**：canon §1.5 已补录 `approval.not_executable`、`item.limit_exceeded`、`input.invalid`、`auth.*`、`invite.*`、`request.*` 与 `version.stale_constraints` 的写入期含义；无可撤回 = `unchanged`（C56） | — |
| N-06 | 房间 `title` 是成员可见的人写文本 | 01 C1、13 | 12 已写明：显示给成员、不进任何代理上下文、约束同目录标题 | 07 在矩阵中登记为例外 |
| N-07 | 永久链接是否展示"当时为何被挡"（评委 FF-34） | 13 §13.9.2、12 `proposals.get` | 历史提案不带检查 | 若产品需要，07 先定义快照披露规则 |
| N-08 | 插件规则版本升级与在途审批（评委 FF-28） | 18 §18.1、08 O12 | **已解决**：cause `scenario_migrated` 已登记在 canon §1.2 与 03 §3.7 / 09 §9.3；迁移纪律见 15 §15.5.1（注册表只增不删、删除前检查非终态房间、必要时 `bump(scenario_migrated)`），兜底见 08 S5 / 04 U1 / 10 F33 | — |
| N-09 | "仅改标题不 bump"与"`version.stale_source` 比较 `lines[].revision`"的调和 | 18 ADR-D25、09 Q2、06 #2 | **已解决**：canon §1.1 / §1.2 已采用 `(roomId, itemKey, revision, editNo)` 与定价修订号定义（C46）；ADR-X02 改称"细化 canon D05 / D25" | — |
| N-10 | `rooms.listMine` 读集在房间数多时 | 13 §13.3 | 非 `setup` 每房 ≤ 7、`setup` ≤ 10 次点查，按成员行分页（每页 ≤ 50） | 03 认可后可加按成员待办计数 |
| N-11 | 简报草稿是否本机暂存：12 建议可用 `localStorage`，13 选择只在内存 | 01、12 §12.8、13 | 13：只在内存 + 离开提示 | 产品决策（私密草稿落盘的风险 vs 长表单丢失） |
| N-12 | `/setup` 不包 ClerkProvider，"后端是否接受 token"只能在 `(app)` 横幅诊断 | 13 §13.2 | 横幅 + `/setup` 说明 | 11 / 15 确认 |
| N-13 | 枚举与取舍在 mutation 内的最坏复杂度（FF-29；06 #7：最坏 12,288 次物化 + 检查） | 18 §18.1 | 快照 ≤ 12 | 06 / 16 性能用例；超限时 modifier 变体只在可行性模式生成 |
| N-14 | 跨房间预算：他房执行改变本房已承诺额是否进入本房硬投影 | 17 E11 | v1 不做 | 实现前 ADR |
| N-15 | LLM 简报抽取在"唯一公开 action 是 `invites.createLink`"约束下的返回路径 | 17 E7 | v1 不做 | 12 设计 |
| N-16 | 修订在新房间进行时必需审批人是否须与原执行一致 | 17 E2 | v1 不做 | 08 / 17 |
| N-17 | 组织形态假设 H1 / H2 | 01 §1.1 | 按假设设计 | 用户访谈（17 §17.5） |
| N-18 | 私密简报的保留期与删除（GAP-21）、模型提供方的数据保留与训练政策（GAP-23）、`rationale` / `rawOutputs` 保留期（10 #5） | 01、03 Q6、10 | 不做承诺；`rawOutputs` 保留期 dev 30 天 / prod 7 天（15 §15.8，canon §1.1） | 07 / 15 与法务 |
| N-19 | 评测判分模型（PD-15）与是否开 Anthropic 组织账号对账（PD-16） | 16 / 15 | 默认 Opus 5.5 low、不开 | 项目负责人（模型由用户指定） |
| N-20 | 注入筛查是否另用 Haiku 5.5（research §6-18） | 07 / 10 | v1 不做筛查调用 | 项目负责人 |
| N-21 | `00-invariants` 电池有 8 条期望与 canon / 12 / 14 不一致（INV-18 的闸门码语义，CE-013 / 027 / 029 / 054 / 128 / 133 / 151 / 167；如 CE-167 写 $4,700 先问 customer，05 / 09 / 14 / 16 均为跳过 customer、finance 收到 `raise_cap`）。编号本身已统一：16 §16.11 与 00 §0.3 都采用 `00-invariants` 重写版的 CE-001…170（16 另增 CE-171…175） | 00 §0.9、16 §16.15 第 8 条 | **已解决**：8 条期望已由 canon 包直接改写进电池（C43），16 §16.11.2 删为指针 | — |
| N-22 | `isExecutable` 的定义：02 Q1 取"状态 + 规则"、审批另名 `allApproved`；canon D19 / 13 取"08 的 `isExecutable` 含审批，检查通过另名 `passesChecks`"；12 用"`isExecutable` 的规则段" | 02 Q1、08、12、13 | **已解决**：canon §1.3 定义 `isExecutable` = 当前性 ∧ `passesChecks`（不含审批集合），`canExecuteNow = isExecutable ∧ allApproved`（C44）；02 / 04 / 08 / 12 / 13 已同口径 | — |
| N-23 | 13 对 12 返回形状的增量需求 Δ1–Δ6（`completesSet` / `canWithdraw`、finance 预算的派生字段、`proposalHistory.proposalId`、`listMine.waitingOn` / `notice`、`timeline.actorKind`、`run.staleDiscarded`） | 13 §13.8.3 | 13 写明未并入时的退路 | 12 定稿时并入 |
| N-24 | `catalog.confirm` 单条 vs 批量 | 09 Q9、12 §12.12 | **已解决**：12 §12.12 定为唯一签名 `rows[]`（1–14 行，一批计一次节流；单行也传 `rows: [row]`），03 / 09 / 13 / 14 / 01 均按此书写 | — |
| N-25 | run 的 `cause` / `endedReason` / 延长标记 / `retry_turn` 建 turn 还是 attempt / 排空中开房等命名与行为在 03 / 04 / 05 / 10 / 12 之间不一致 | 04 Q8 | **已解决**：按 04 统一（`runs.cause` 四值、`roundsExtended`、`endedReason`、`retry_turn` 新建 turn、排空中开房首回合停泊），canon §1.2 / C48 已收录；跨章核对阶段回改了 05 / 10 / 12 的残留 | — |
| N-26 | canon D04"执行后任何写入拒绝"需要显式豁免 `tasks.markDone` 与 `rooms.startFollowUp`；`ops.setDraining` 需在 prod 可用 | 04 Q4、07 #10、12 Q3 / Q5 | **已解决**：canon D04 已列两项豁免（C45），§1.6 `ops.setDraining` 全部层级（C53） | — |
| N-27 | D06 字面允许"被取代 run 处于 `negotiating` / `needs_input` 时的 active 提案"经预检直接进入 `pending_approval`，跳过未完成的代理评估 | 04 Q1、09 Q1 | **已解决**：canon D06 已收窄为"仅被取代 run 处于 `pending_approval`"并同事务 `stale → active`（C47） | — |
| N-28 | `clarify` 请求的 `keep_as_is` 是"同一轮重开发问方回合"（05）还是 D15 通用的"进入下一轮" | 05 #6 | **已解决**：canon D15 已补裁 `keep_as_is` 按 kind（`clarify` = 拒绝披露、发问方同轮新回合） | — |
| N-29 | 改价预检信道是否在每小时 6 次之外再加每房间每日上限 | 07 §7.24 第 3 条 | **已解决**：07 §7.13 与 12 §12.1 B7 增设 `price_writes` 桶（房间 `open` 期间改价 / 工期 / 增删目录的批次每房间每 24 小时 ≤ 3）与 setCap / 硬字段子桶 | 是否让预检结果对 provider 不可区分列入 17（07） |
| N-30 | `approvals.record` 在兄弟章间的失败码与参数分歧（角色不符、非成员、无可撤回、事件名、任务函数名、`proposals.get.decisions` 缺 `reasonKey`） | 08 O11 | **已解决**：各章已按 12 §12.4 的码统一（08 O11 ①② 已改述），事件名按 03 §3.11.1、任务函数 `tasks.markDone`、`proposals.get.decisions` 已带裁剪后的 `reasonKey` | — |
| N-31 | 房间写锁 M-ROOM（`rooms.writeSeq` + `openRoomTx`）改变了并发模型，但 canon §1.2 没有 `writeSeq`、00-invariants 没有 INV-M1 | 02 DM-09 / Q4、03 SC-05、11 A4、10 §10.13 | **已解决**：canon §1.2 已登记 `writeSeq`，00-invariants 已补 INV-M1（part6 §1.11）；ADR-X01 改称"细化 canon D02 / D03 / D24" | — |
| N-32 | `constraintRevisions`（canon part6 09 must_absorb 要求）与 `rawOutputs`（D16 的 `rawOutputRef` 目标）不在 canon §1.1 实体表 | 09 Q3、03 §3.7 / §3.8 | **已解决**：canon §1.1 已补 `constraintRevisions` 与 `rawOutputs` 两行；ADR-X03 改称"细化 canon D05 / D16" | — |
| N-33 | `privacy.redact` 是只追加表上唯一允许的覆写，canon D18 / §1.1 未登记；07 §7.24 第 11 条称"canon D18 已加豁免"与 canon 现文不符 | 03 §3.3.2 规则 6、07 §7.12.2、12 §12.20 | **已解决**：canon D18 已写明 `privacy.redact` 是只追加表的唯一例外（跨章核对阶段同步），07 §7.24 第 11 条的说法现已属实；ADR-X04 改称"细化 canon D18" | — |

各章"开放问题"小节里未并入上表或 §18.5 的条目见 `18-decisions-open-questions-part9.md`（§18.4.3）；各章在 canon 未覆盖处做出的重大决定见 `18-decisions-open-questions-part10.md`（§18.6）。
