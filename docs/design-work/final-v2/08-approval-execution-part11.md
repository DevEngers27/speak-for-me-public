# 08 审批与执行（part11）：8.11 不变量、8.12 备选与否决、8.13 开放问题、8.14 与 canon 的对照

## 8.11 不变量汇总

"INV"列为 `00-invariants*.md`（canon 对齐重写版）的对应编号，16 的用例矩阵按两者交叉引用。

| # | 不变量 | 落点 | 测试 | INV |
| --- | --- | --- | --- | --- |
| E1 | 提案 `executed` ⇔ 恰一条 `executions` 指向它；房间 `executed` ⇔ 本房恰一条执行；每房至多一条执行 | S3 快速路径；X1–X3；X11–X13 | R11；I1–I3；L2 S1/S2 | 46、47、52 |
| E2 | `approvals` 只追加；每个 `(proposalId, userId)` 的 `seq` 为 1..n 连续；相邻行 `(decision, boundConstraintsVersion)` 不同 | S9–S12；写入口白名单 | R1；U1；L2 S6 | 29、54 |
| E3 | 每行 `boundConstraintsVersion` = 写入时 `room.constraintsVersion` = `expectedConstraintsVersion`；`boundTermsKey` = `proposal.termsKey` = `expectedTermsKey`；`role` / `kind` 由服务端派生 | S7、S8、S12 | I4；R7、R8 | 25 |
| E4 | `executions.approvalIds` 与 `requiredApprovals` 一一对应；每行为该用户在该提案上的最新 approve、绑定执行时 cv 与 termsKey；userId 两两不同；签字人是该角色唯一的当前成员 | `evaluateApprovalSet`；X1 | R7；U2–U12；I13 | 26、27、28 |
| E5 | `executionKey = exec:${proposalId}`，全表唯一；客户端不提供任何幂等键 | X3 | R11(d)；L2 S1/S2 | 46 |
| E6 | `committedCents = Σ ledgerEntries.amountCents`；无计数器；台账只追加；曾打开的房间恰一条 baseline（`setup → closed` 的房间可为 0）、至多一条 commit 且只由执行写；`Σ ≤ capCents` 恒成立 | A11；X4、X8；`ledger.recordBaseline`；D23 | R2–R5、R10 | 50 |
| E7 | 执行快照不可变：G701 链连续（before = baseline + prior，after = before + delta ≤ cap）；`committedBefore/After` 只作展示；已执行提案的审批显示只读 `approvalIds` | `computeChangeOrderChain`；A9 | R4、R10；U14；V8 走查 | 50、53、58 |
| E8 | 变更单 `terms` / `lines` 与任务集合逐字段等于提案快照（`plannedTasks`）；`taskKey` 三段式唯一；预览与写入相同 | `planExecutionRecords`；X5、X10 | R6、R8；U15、U16；I20 | 37、49 |
| E9 | 任何 approve 行写入时，该提案在同事务内 `passesChecks` | S11 | I7；模型测试 | 31、35 |
| E10 | 有效 reject 使提案 `rejected`（终局），被拒提案永不复活；withdraw 只撤本人当前 cv 上的 approve，且只在执行前 | S10、§8.5.4、§8.5.5 | I8–I11；K26 | 30、29 |
| E11 | 活性：不存在"当前提案 `active` ∧ run `pending_approval` ∧ 当前 cv 下集合齐 ∧ `passesChecks` ∧ 未执行"；approve 收敛（`unchanged` 也判定） | A6；S13 | R11(e)；模型测试 | 47 |
| E12 | 执行不递增 cv；`executed` 房间除 `tasks.markDone` 与 `rooms.startFollowUp` 外拒绝一切写入；执行不调 action / 调度 / 外部系统 | A8、A9；X16 | 结构测试；I14 | 52、53、60 |
| E13 | 代理永不写 `approvals`，`recommend_accept` 不计票；`note` 只给本人；人的拒绝 `role` 对房间里的人可见，`reasonKey` 按场景声明的受众（`room` / `buyers`）可见、受众为 `buyers` 时不进事件 payload（07 DX-6、A13），二者都不进任何他方代理上下文（05 §5.12）；G701 金额对 provider 永不可见 | A13；投影表 | I18、I19、I21、I23；结构测试 | 20、21、22 |
| E14 | reject 永远可做：只受鉴权、房间 / 当前性状态守卫与 `expected*` 约束；不读整提案审批区间、不受任何决定次数上限、场景版本守卫或排空影响（按人限额与场景版本守卫只作用于 approve） | S5、S9、§8.5.4 | I15、I22；K28、K30、K32；模型测试（reject 允许错误集） | 30 |

## 8.12 备选与否决汇总

| 被否决的方案 | 否决理由 | 见 |
| --- | --- | --- |
| 独立 "Execute" 按钮 / 齐后 `runAfter` 调度执行 | 存在"已齐未执行"中间态；执行失败无人收到错误 | A6 |
| 客户端 operationId / uuid | 两次点击两个 id → 两条执行（spikes B2 实测） | A7 |
| `exec:${proposalId}:${cv}` | 同一提案跨 cv 重批后可执行两次（canon C2；反例 K23） | A7 |
| sha256 `contentHash` / 哈希执行键 | `crypto.subtle` 运行时待验证；提案不可变时无收益 | A1、A7 |
| patch 式审批 upsert | 丢历史（核心 6，spikes B3） | A2 |
| 计数式完成判定 | 双击或一人多角色提前凑满 | A3 |
| `requiredApprovals` 存 userId 快照 | 与"当前成员"语义冲突（review r04） | A3 |
| 一人兼任两角色、审批不计两票 | 多一套例外路径（D24、U8） | A3 |
| 全局 `TOO_MANY_DECISIONS`，及其变体"全提案审批读上限 → `internal`" | 会挡住唯一逃生口 reject（review r03、invariants-01）；改为 approve 按人限额、reject 只读本人最新一行 | A2、S9、§8.7.4 |
| 场景版本守卫对全部决定生效 | 版本提升会让所有旧版本房间无法 reject（invariants-16）；只对 approve 生效 | A10、S5 |
| 可撤回拒绝 / 拒绝冷静期 | 集成层走不到（va-review r07）；复杂度高 | A5 |
| reject 后提案保持 active | 后续无关 bump 让预检复活被拒提案 | A5 |
| 执行递增 cv | 已执行审批显示 stale，改写历史（canon C4） | A8 |
| 执行时按当前模板派生任务 | 所见非所写（review r02） | A10 |
| 审批 7 天过期 | U7 默认不过期（canon C41）；过期需要时钟派生与额外出口 | §8.13 O2 |
| 审批期间预留额度 | 并发提案互锁；研究建议只提示 | A11 |
| 存 `committedCents` 计数器 / `budgets` 表 | 第二真相源（F02.3） | A11 |
| `ledger.addExternalEntry` | 非幂等、不查上限，Σ 可超 cap（inputs/07） | A11 |
| 以 `changeOrders` 作幂等锚点 | 第二场景产物不一定叫变更单；审批快照需引擎级的家 | A7 |
| `humanRequests.answer` 带 `alsoApprove` | 一次点击混合两个决定 | A6 |
| `reasonKey` 一律对他方的人隐藏 / 一律房间可见 / 把它喂给 proposer 代理 | 第一种与 07 DX-6 冲突；第二种让 `over_our_limit` 把预算 bit 带给 provider（privacy-07）；第三种与 05 §5.12 冲突（canon C28：同侧也不默认共享） | A13 |
| approve 用 `Date.now()` 推出的真实日期判规则 / 就地滚动 `localDate` | 前者与界面结论不一致且窗口内无出口；后者与 09 §9.6.7 "规则一律读 `localDate`"重复并扩大冲突面 | A12 |
| `approval.stale` 作为返回值 | 与 04 / 12 / 13 不一致；唯一的额外收益随"规则读 `localDate`"消失 | A12 |
| 同房间追加轮 | 每项都有重复承诺反例（D04） | A9 |
| 预算 override | 研究建议若需要做成独立必需审批角色（17） | A11 |
| `race.sh` 每次 `npx convex run` 冷启动、`testing:decideAs` + `ENABLE_TEST_FUNCTIONS` | 进程冷启动让请求几乎不重叠，测不出并发；公开入口加 `setAdminAuth` 即可（review r05） | §8.9.4 |

## 8.13 开放问题

| # | 问题 | 当前默认 | 需要谁 |
| --- | --- | --- | --- |
| O1 | 预算**上调**等有利变更也作废审批（K22），多一轮重批 | 照 D05 一律 bump；15 记录"因失效而重批的次数"指标，数据不佳再议 | 用户 / 09 |
| O2 | 审批是否设有效期 | 不过期（U7、canon C41）；若改为 7 天，须新增派生态 `approval.expired` 与 cron 出口并写进 04 | 用户 |
| O3 | （已关闭）`input.invalid`、`auth.*`、`approval.not_executable` 等已补进 canon §1.5 与 06 §6.2 的 `API_ERROR_CODES` | 按 12 / 06 的码表写 | — |
| O4 | （已关闭）全提案读上限会挡住 reject（invariants-01）；改为 reject / withdraw 只读本人最新一行、approve 按人限额 `MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL = 60` → `run.rate_limited`（S9、§8.7.4） | 15 对接近上限的房间告警 | 15 |
| O5 | 规则读 `room.localDate` 带来房间本地午夜后 ≤ 约 1 小时的判定滞后（09 §9.6.7）；canon D22 写"mutation 用 `todayInTimeZone` 权威计算"，09 / 08 解释为"只有推进 `localDate` 的 cron 用它" | 接受；15 监控 `clock.rollLocalDate` 的延迟；canon 措辞待澄清 | canon、09、15 |
| O6 | `rejectReasonKeyV` 的取值必须是类别级、不编码数值 | 05/14 审定词表，16 加"词表不含数字"测试 | 05、14 |
| O7 | G701 的工期链（原完工日 → 增减天数 → 新完工日）v1 未建模（场景没有基线工期），只记新交付日 | 列入 17 | 14、17 |
| O8 | 跟进房间之间的 G701 链：新房间 baseline 是 finance 确认的预填值，可与前序 `committedAfterCents` 不同，跨房间链不强制连续 | v1 只保证房内链连续，`followsExecutionId` 提供追溯；跨房间连续性列入 17 | 17 |
| O9 | 事务限额（V9）；第二场景的执行计划可能更大 | 50 任务上限 + `getTransactionMetrics` 实测；超限时启用 A6 退路（须新增"已齐待执行"派生态） | 16、17 |
| O10 | OCC 与区间读冲突、客户端重发去重（V1–V4，spikes §8 #1 / #10） | L2 探针，实现第 1 周按 U11 分配 | 16 |
| O11 | 兄弟章对 `approvals.record` 的分歧（08 的选择 ← 理由；①② 两项各章已统一为 12 §12.4 的 `auth.role_forbidden` / `auth.not_member`，07 / 04 / 00-invariants INV-31 不再使用旧码，只留编号以便追溯）：①②已统一；③陈旧：04 / 12 抛 `approval.stale` → 08 跟随抛出（canon D02 的"返回"按"以该码回应"理解）；④无可撤回的 withdraw：04 `approval.not_current` / `approval.stale`、12 `unchanged` → 12；⑤run 非 `pending_approval`：12 `run.invalid_state{guard:'run_status'}` / 04 `approval.not_current` → 04（canon §1.5 的语义）；⑥`executed` 房间：INV-52 `run.invalid_state` / 04、12 `approval.already_executed` → 04、12；⑦`executeIfComplete` 内 `by_executionKey` 命中：12 返回 `alreadyExecuted` → 08 fail closed（守卫已过却命中即 E1 破坏，idempotent-execution D5，review 认可保留）；⑧参数：07 要求 `roomId`、04 用判别联合 → 12 的平铺参数、由 `proposalId` 解析房间；⑨事件名：03 `room_executed` / `task_completed` / `proposal_status_changed`，12 `task_done`，04 `proposal_rejected` → 03（事件目录归 03）；⑩任务勾选函数：04 `tasks.complete` / 03、12 `tasks.markDone` → 12；⑪`proposals.get.decisions` 的 `reasonKey`：12 已补齐并按 `humanReasonKeys[].audience` 裁剪（已关闭） | 由集成者按此表回改 04 / 07 / 12 / 00-invariants | 集成 |
| O12 | 场景新版本上线后的房间迁移：S5 只对 approve 生效（reject / withdraw 照常），approve 返回 `run.invalid_state{guard:'scenario_version'}` 直到迁移 | 15 定义迁移：对受影响房间 `constraints.bump(cause: 'scenario_migrated')` 后重批（03 §3.7 与 09 §9.3 的 `revisionCauseV` 已列该 cause；canon §1 尚未收录，已记入跨章说明），或在房间全部终态前不提升场景版本；reject 后的回合由 04/10 的 `createTurnTx` 版本守卫转 `needs_input` | 15 |
| O13 | mutation 内 `ctx.meta.getRequestMetadata()` 可用性与 `requestId` 形态（inputs/04 §1.10） | 只用于 opsLog，不可用时省略 | 待验证 |
| O14 | （已关闭）人拒绝后 proposer 代理的反馈不含 `reasonKey`（04 R10 已回改）；人的视图按 reasonKey 声明的受众（`room` / `buyers`，A13、07 DX-6） | — | — |
| O15 | provider 从"不带理由的 finance 拒绝"可推出所用键为 `buyers` 受众（v1 只有 `over_our_limit`，A13） | 接受：与"finance 拒绝了 vN"本身几乎同义，落在 D12"每个提案 ≤ 1 bit"内；若不接受，14 把 finance 的全部人类拒绝理由标为 `buyers` | 14、07 |

## 8.14 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| §1.1 实体与表 | `approvals` / `executions` / `changeOrders` / `ledgerEntries`（`baseline` / `commit`）/ `tasks` 的字段与索引（part3）；无 `budgets` / `commitments` / `decisions` / `operationId` / `deferredItemKeys`；validator 只引用 03 §3.4，`lineV` 带 `kind`（canon D25 的 `lines` 待补 `kind`） |
| §1.2 关键字段 | `boundConstraintsVersion` / `boundTermsKey` 与 `expectedConstraintsVersion` / `expectedTermsKey`（A1、S8）；`executionKey = exec:${proposalId}`（A7）；`taskKey` 三段式（X10）；`termsKey = canonicalJson(terms)`（X5）；`provenance` 派生（`inheritProvenance`，03 §3.3.3）；`actorUserId` 显式传入执行；金额 `*Cents` + `assertCents`；日期 `IsoDate` |
| §1.3 状态 | 提案 `active → executed / rejected`、run `pending_approval → executed / negotiating / needs_input`、room `open → executed`、task `open → done`；审批有效性 `effective / stale_approve / stale_reject / withdrawn` 与 `isExecutable` 均派生（part4） |
| §1.5 reasonCode | 使用 `approval.stale`（`params.currentConstraintsVersion`）、`approval.not_current`、`approval.already_executed`、`approval.self_conflict`、`approval.missing_role`（判定原因）、`approval.not_executable`（D02）、`run.invalid_state`、`run.rate_limited`、`private.constraint_unmet`（投影）；缺口见 O3 |
| §1.6 函数名 | `approvals.record`、`executions.executeIfComplete`、`events.append`、`clock.rollLocalDate`（结论翻转才 bump）、`ledger.recordBaseline`、`budget.setCap`、`rooms.startFollowUp`、`rooms.view`、`timeline.page`；纯函数 `evaluateApprovalSet`、`isExecutable`、`checkProposal`、`canonicalJson`、`buildHumanRequests`、`projectForRole` |
| D02 审批判定与只追加 | A1–A5；`evaluateApprovalSet` 为唯一实现；同 cv 相同决定 `unchanged`；reject 终局、withdraw 只撤本人 approve；approve 前同事务 `isExecutable`（当前性 ∧ 规则，§8.4.2，审批集合另名 `allApproved`）；无全局决定上限，reject 不读整区间、不受场景版本守卫（E14）；approve 按人限额 → `run.rate_limited` |
| D03 执行键与时机 | A6、A7、A8；X1–X17；执行用 `plannedTasks` 快照；`approvalIds` 冻结；执行不 bump |
| D04 一房一执行 | A9；S4；`tasks.markDone` 与旧房间任一成员的 `rooms.startFollowUp` 是仅有的执行后写入例外（canon D04 现文已列这两项豁免，C45）；后续房间只复制未执行的目录项并预填 baseline（§8.6.5、V8） |
| D05 递增矩阵 | 标题 / 任务模板改动不 bump 由提案快照承载（A10）；`ledgerEntries` 不在投影（A8）；上调同样 bump（K22） |
| D06 约束变化后处置 | 审批守卫看当前 run 的 `currentProposalId`（K25）；保留分支走查（§8.10.2）；被拒提案不复活（K26、I10） |
| D07 持久化守卫与 reconcile | 迟到回合 / 看门狗不触碰审批（K10、K21） |
| D08 串行回合 | reject 后进入下一轮或 `rounds_exhausted`（§8.5.4） |
| D10 候选快照 | 被拒 `candidateKey` 进入派生剔除集合 `excludedCandidateKeys(run)`（canon D10 现文） |
| D11 派生字段过矩阵 | 投影表（§8.6.6）；人类拒绝 `reasonKey` 按 `humanReasonKeys[].audience` 投影（A13）；`approval.not_executable` 的 `params` 按角色裁剪 |
| D12 fit 信号与预言机 | provider 只见 ok / blocked、无 `params`；G701 金额只给 finance，customer 经三开关（U1 默认关）；`approvals.record` 不在节流清单内，reject 永远可做 |
| D13 公共文本模板化 | 事件渲染模板；`note` 只给本人；`reasonKey` 为封闭枚举 |
| D14 事件可见性 | `approval_recorded` / `room_executed` payload 白名单 + `restrictedRef`；`buyers` 受众的 `reasonKey` 不进 payload、只经 `restrictedRef` 对买方渲染；重复调用不写事件 |
| D15 人工请求 | 轮次用尽时恰一个 customer `rounds_exhausted` 请求；无 `rooms.close` 选项 |
| D16 错误纪律 | `ConvexError({ code, params })`、`withSanitizedErrors`、禁 `console.*`、`opsLog` 白名单（A12） |
| D17 排空 | `draining` 下 reject 照常成功（K30） |
| D18 seed / reset | seed 走生产入口；reset 只删非 live 房间（K19）；产物 `provenance` |
| D19 决策页 | 按钮文案绑定版本、最后一票提示、stale 横幅、冻结显示、agent 虚线框（§8.9.5） |
| D21 布局 | 纯函数在 `core/engine/`；执行模块纯度 lint（§8.3.5） |
| D22 时间 | 交付日不重算；规则读 `room.localDate`（A12、09 §9.6.7、K27、I16）；审批不因跨午夜失效 |
| D23 低于已承诺 | V3 走查；R4(c) |
| D24 成员与席位 | distinct userId 第二道防线；多席位 → `approval.self_conflict`；`auth.not_member` / `auth.role_forbidden`（12 §12.4） |
| D25 提案不可变 | `termsKey` 规范串；`lines` / `plannedTasks` 快照；执行时复核 `amount.claim_mismatch` 等价断言 |
| D26 v1 范围 | 无审批有效期、无通知、无外部集成（outbox 列入 17） |
| D27 fixture | §8.10 主线 $900 → $4,800 → $800 恰等于上限执行；变体 $4,700 / $4,799.99 / $3,900 / canary |
| canon C2、C4、C24、C40、C41 | 执行键不含 cv；执行不 bump；`deferredItemKeys` 删除；重谈后旧提案审批报 `approval.not_current`；审批不过期 |
| U3、U7、U8 | 一房一执行；可撤回本人 approve、不可撤回 reject、不过期；不兼任 |
