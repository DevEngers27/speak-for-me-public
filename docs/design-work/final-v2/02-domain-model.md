# 02 · 领域模型（part1）：目标与范围、决定

> 分片（按顺序阅读，共 7 片）：
> 1. `02-domain-model.md`（本文件）：2.0 目标与范围、2.1 决定 DM-01…DM-14
> 2. `02-domain-model-part2.md`：2.2 实体总览（可变性、唯一写者、所有者与披露类、解决的问题）、2.3 被删除或合并的概念、2.4 关系
> 3. `02-domain-model-part3.md`：2.5 版本化对象与"人批准的到底是什么"、2.6 计数器与版本号、2.7 run / turn / attempt 三层（attempt 即用量账本）
> 4. `02-domain-model-part4.md`：2.8 派生而不存（可执行性、审批有效性、已承诺额、阶段、fit…）、2.9 金额与日期命名、2.10 所有权规则
> 5. `02-domain-model-part5.md`：2.11 不变量清单 A（核心 1–3）
> 6. `02-domain-model-part6.md`：2.11 不变量清单 B（核心 4–8、生命周期与活性、时间与值域）
> 7. `02-domain-model-part7.md`：2.12 守卫 × 不变量矩阵、2.13 反例电池映射、2.14 开放问题、2.15 与 canon 的对照
>
> 底稿：`candidates/invariants/02-domain-model-part1..3`（"不变量 → 落点 → 唯一写者 → 守卫"的组织方式、只派生的量、守卫 × 不变量矩阵）与 `candidates2/minimal/02-domain-model.md`（"不要它行不行"、被删除概念的职责去向）。吸收：`00-invariants*.md`（canon 对齐重写版，本章的不变量编号 INV-01…INV-78 与反例 CE-001…CE-170 一律取自那里）、`deepdives/run-lifecycle*`（三层、守卫、重试分层）及反驳 r01–r15、`deepdives/versioned-approvals*`（绑定、只追加、递增、D6–D9）及反驳 r01–r15。命名与关键决定以 `00-canon*.md` 为准；字段精确写法见 03，迁移见 04。

## 2.0 目标与范围

**目标**

1. 用最少的实体覆盖任务书 §3 八条核心；每个实体都回答四个问题：它解决什么问题、不要它行不行、谁能写、谁能看。
2. 每条不变量落到具体表字段 + 唯一写者 + 守卫 + 失败码 + 至少一条反例（16 的用例矩阵）。
3. 存储只存事实（canon §1.3 列出的状态、不可变快照、只追加记录）；凡能由事实算出的——可执行性、审批有效性、已承诺额、余量、房间阶段、待办、fit——一律读时派生，从不入库。
4. 同一概念全篇一个名字：以 canon §1.1 为准，废弃别名不出现在任何表、字段或函数中。

**范围**：实体、关系、所有权、版本化对象、派生规则与不变量清单。不含：字段的 validator 写法与索引（03）、迁移表（04）、协议消息（05）、检查实现（06）、字段 × 角色矩阵的最终裁定（07）、执行事务步骤（08）、递增矩阵细节（09）。

## 2.1 决定

| # | 决定 | 理由 | 被否决的备选 | 带来的不变量 |
| --- | --- | --- | --- | --- |
| DM-01 | 存储的状态只有 canon §1.3 列出的值；`isExecutable`、审批有效性、`committedCents`、`headroomCents`、房间阶段、待办、对 provider 的 `fit` 一律派生 | 存了就会与指针漂移（Role A RA-B17）、跨午夜静默失效（inputs/07 ≥ 8 条）；派生让"约束一变，所有窗口同时翻转"不依赖回写 | `isExecutable` / `endorsed` / `approved` / `blocked` / `phase` 字段；minimal 底稿"提案无 status"（canon 保留 `status` 以表达 rejected / stale 等不可派生的历史事实） | INV-26、INV-35、INV-50 |
| DM-02 | 硬约束只有三个来源：finance 简报 `hardFields.capCents`、customer 简报 `hardFields.{requiredItemKeys, deadline}`、provider 确认的 `catalogItems`；`rooms.constraintsVersion` 只经 `constraints.bump`，是否递增由硬投影前后比较决定 | 约束变化只有一条路径，"改了预算忘了 bump"在结构上不可能（canon D05）；投影与规则读同一 `RuleInput`，"规则输入变了 ⇔ 版本变了" | `budgets` 表（第二入口）；invariants 底稿的 `constraintSets` 指针元组 + `committedCents` 快照（多一张须证明一致的表；已承诺额在 `open` 期间恒定，无需快照）；逐处手写 bump（RA-B02 漏递增） | INV-24、INV-57 |
| DM-03 | 提案条款不可变；`version` 按房间单调分配；`termsKey = canonicalJson(terms)`；插入时快照 `lines[]` 与 `plannedTasks[]`；被规则阻断的候选不插提案 | 绑定 `proposalId` 即绑定条款，`termsKey` 是可读、可复核的第二绑定；快照保证所见即所写（08 G9）；不插阻断提案让每个提案在插入时都合规，provider 只得到 1 bit | sha256 `contentHash`（`crypto.subtle` 待验证且无收益）；版本按 run 重置；执行时重算任务模板；复制 revalidated 版本（RA-R11） | INV-28、INV-37、INV-55 |
| DM-04 | `approvals` 只追加；当前决定 = `(proposalId, userId)` 上 `seq` 最大行；撤回也是追加 `withdraw`（只撤本人 approve）；reject 终局；绑定 `(proposalId, boundConstraintsVersion, boundTermsKey)` 且入参必带 `expected*` | 核心 6：重批不改写旧审批；`expected*` 关闭 TOCTOU；reject 立刻改变 run，"撤回拒绝"在集成层本就走不到（versioned-approvals r07） | upsert（spikes B3 证伪）；审批轮 `approvalRounds` 表（轮 = 提案 × cv，已由绑定字段表达）；绑定 `proposalVersion` 整数 | INV-25 – INV-31 |
| DM-05 | 运行时三层：run（生命周期、上限）→ turn（可被守卫拒收的逻辑槽位，持有 cv 快照与候选快照）→ attempt（一次计费调用，**同时是用量账本**）；不设 `modelCalls` | 迟到结果、看门狗超时、重试都需要"每次调用一行"；把用量放在调用自己的行上，任何结局都有地方记账 | 两层（turn 内计 attempt 号，看门狗以 `turnId` 计时会误杀 attempt 2）；四层（再加 modelCalls：同一事实两处存） | INV-40、INV-68 – INV-72 |
| DM-06 | 一房一执行：执行后 `room.status = 'executed'` 终态；后续变更用 `rooms.startFollowUp` 开新房间 | 零新不变量得到同一旅程；同房间追加轮需要"已执行范围"进入规则、枚举与简报语义，每一处都被评委打出重复承诺反例（canon D04） | 同房间追加轮（PD-05b，`executedItemKeys`）；修订 / 冲销（17） | INV-52、INV-58 |
| DM-07 | 已承诺额 = `Σ ledgerEntries.amountCents`，不存计数器；`baseline` 只在 `setup` 由 finance 录一次，`commit` 只由执行写；新上限必须 ≥ 已承诺额 | 账本即真相，available 现算（研究：PeopleSoft Commitment Control）；没有可编辑的"外部已承诺"，评委反例"改 external 让 committed > cap"在结构上不存在 | `budgets.committedCents` 计数器；invariants 底稿的 finance 简报 `externalCommittedCents`（评委 EX-5 反例） | INV-39、INV-50 |
| DM-08 | 跨角色私密值只有两条显式披露路径：目录确认（`catalog.confirm`）与 `sharedFacts` 披露账本（由 `briefs.confirm` 的逐字段勾选、`sharedFacts.add`、`humanRequests.answer(disclose)` 写入，全部过闸门）；他方投影与代理上下文从不读他方 `briefs` 行 | 把"谁能看到什么"的真相收敛到一张只追加表，按值所属版本判定历史可见性（07 PV-05 / PV-12） | finance 无条件看 customer 简报（C28）；投影直接读简报 `disclosures`（撤回在下一次 bump 前不生效，candidates1 评委） | INV-01、INV-18、INV-19 |
| DM-09 | 房间写锁 M-ROOM：一切改变房间业务状态的 mutation 都经 `openRoomTx` 把 `rooms.writeSeq + 1` | 同房间"先查后写"在 OCC 下串行，正确性不押在"索引区间读进入读集"这一待验证细节上（03 §3.3） | 只靠区间读冲突（withdraw 与最后一票并发的安全性完全依赖它，idempotent-execution r10） | INV-27、INV-29、03 §3.14 |
| DM-10 | `provenance ∈ live \| seeded \| stub` 是数据字段，派生记录按 `seeded > stub > live` 继承 | 核心 8 落到数据而不止界面；变更单脱离房间打印时仍带标注 | `isSimulated` 布尔（分不清 seed 与 stub） | INV-62 |
| DM-11 | 一人一房一席、一席一人；成员只经 `addMember` 插入（`rooms.create` / `invites.accept` / `rooms.startFollowUp`）；v1 不换人 | NIST AC-5 职责分离；`evaluateApprovalSet` 的 distinct userId 是第二道防线 | 兼任且"同人不计两票"（PD-09b：审批守卫多一套例外路径） | INV-15、INV-16 |
| DM-12 | "今天"是房间属性 `rooms.localDate`（只由创建与 cron 写，query 不读时钟）；交付日在提案插入时物化为绝对日期、不重算；时间只在结论翻转时以 `cause: 'clock'` bump | 跨午夜既不静默卡死、也不每日作废全部审批（canon D22） | `today + leadDays` 每次重算；`todayAnchor` 进投影（R-I） | INV-36、INV-77 |
| DM-13 | 引擎 / 场景边界：引擎表持有"从已确认目录中选子集"的协商形状（`catalogItems`、`terms`、`lines`、`plannedTasks`）与以 `schemaKey` 判别的场景字段（简报硬 / 软字段）；第二场景若不是目录子集形状，`terms` 改为联合（17） | 首个场景与契约测试场景 `procurement_rfq` 都是目录子集选择；不为假想场景预建抽象（任务书 §6"反对过度设计"） | 每场景独立表（v1 无收益）；`attrs: v.any()`（读出要再 parse，失败即数据损坏）；minimal 候选被评委指出"引擎表写死 scope_change 字段却声称可扩展" | INV-45 |
| DM-14 | 核心 7：领域中不存在任何外部 ERP / 支付 / 电子签署实体；执行产物只有内部记录（`executions`、`changeOrders`、`ledgerEntries(commit)`、`tasks`）；代码库对外部 ERP / 支付 / 签署 / 邮件 SDK 零依赖 | 执行边界要由结构保证而不是由约定保证；外部集成将来只经 outbox（17） | v1 预留外部集成表（无消费者、增加攻击面） | INV-59 – INV-61 |

每条决定对应的 ADR 与反例在 18；被删除的候选概念及其职责去向见 2.3。
