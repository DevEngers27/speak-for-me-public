# 07 · 权限、隐私与威胁模型（part9：残余风险、不变量、备选与否决、开放问题、与 canon 的对照）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.21 残余风险（明确接受并告知用户）

| # | 风险 | 量化 / 处置 |
| --- | --- | --- |
| R-1 | 沿协商轨迹累积的推断（DX-1、DX-2、DX-11、DX-12） | 逐信道上界（§7.13，privacy-01；每房间每 24 小时）：DX-2 预检——provider 改价 ≤ 3 次（≤ 4.8 bit）、买方 `setCap` / 硬字段 ≤ 6 次（≤ 9.5 bit），每一次都对全员可见并使审批失效，但对 provider 不暴露变更者（DX-7）；DX-1 provider 提案结局与 DX-11 / DX-13 counter 转发——各 ≤ `run_starts` 6 × 每 run 4 = 24 次（各 ≤ 24 bit）；DX-12 `choose_candidate` 复核结局——每次 ≤ 1 bit，只受 D12 ⑥ 每小时 6 次节流，没有日总量桶。有日上限的四项合计 ≤ 63 bit，但这不是全信道总量：在 DX-12 等全部准入路径共用有效的日计数之前，本设计不宣称经验证的每日总量上界（canon D12 ⑥ 的"合计每天至多数十 bit"只对总量桶覆盖的信道成立，已列入 canon 修订）；速率限制只减速，不等于不披露。仅靠改价二分余量（$1 分辨率、$10k 区间约 14 bit）在 `price_writes` 桶下需要约 5 天而不是 2.3 小时。D12 ⑥ 的每小时 6 次只决定速率，不构成上界（已列入 canon 异议）。简报确认页文案改为："Other parties may learn whether a proposal fits your private limits — about one yes/no per proposal or constraint change. Repeated probing can narrow a range over time and is visible in the room history."（修正 security 底稿 "never the limits themselves" 的误导，评委指出） |
| R-2 | "等谁"对买方可见（DX-3） | provider 只见 `run_waiting` |
| R-3 | "无可行组合"结论可见（`needs_input` / `run_waiting`） | 同 DX-2 上界 |
| R-4 | Convex 控制台内部人员可读全部数据 | 团队成员最小化与生产访问审计（15） |
| R-5 | 模型提供方处理本角色视图 | 隐私说明如实写明"为你服务的代理会把你的简报与对你可见的共享信息发送给模型提供方"；提供方保留与训练政策待验证 |
| R-6 | 代理在合法选项中有偏选择（被目录 title 诱导或主动编码） | 每次 ≤ log₂(12) ≈ 3.6 bit，受 ⑤ 约束；代理建议永不等于批准 |
| R-7 | 查询重执行的时序侧信道（finance 改软字段时 provider 的 `rooms.view` 也会重执行） | 结果不变时客户端是否收到推送待验证；硬约束变化本来就公开（DX-5） |
| R-9 | finance 不带理由的拒绝本身透露所用键的受众（08 O15）：provider 看到 "Finance rejected v{n}." 而无理由，即可推出用的是 `buyers` 受众的键（v1 只有 `over_our_limit`） | 接受：≤ 1 bit，与"finance 拒绝了 vN"几乎同义、不带任何数字；若不接受，把 finance 的全部人类拒绝理由都标为 `buyers`（14 §3 一处改动） |
| R-10 | provider 能看出"哪个买方角色的回合之后出现了 `run_waiting`"（12 §12.25 Q18） | 接受：只暴露回合角色与顺序（本就由 `turn_scheduled` 公开），不暴露请求 kind / toRole / `failureKind`（03 §3.11.1 `turn_failed` 对他方渲染为 "{Role} agent finished"）；若不接受，改为 provider 只见合并的买方阶段，03 / 13 / 14 的模板与 `activeRole` 投影须同步 |
| R-8 | prod 是否下发 `logLines` 未知 | 设计不依赖：公共函数内只有 `publicOpsLog` 的闭集三键行（`{ fn, code, errorClass }`，无数值、无私密值），即使下发也只暴露"某函数走了某条已知分支" |

## 7.22 不变量

| ID | 谓词 | 落点 | 测试 |
| --- | --- | --- | --- |
| PV-INV-01 | 任一公开函数的返回值与 `ConvexError.data`，对查看者 V 不含 `DISCLOSURE` 判为 V 不可见的值，也不含其不在解密清单中的派生值 | XP-1…XP-8、§7.11 参数受众 | TC-PRIV-01/06/09 |
| PV-INV-02 | 他方私密值只经已确认目录或 `sharedFacts` 行跨越角色；每行 `sharedFacts.value` 等于写入时 `fromRole` 当前已确认简报（或 ledger 派生）的值 | `sharedFacts.add` 无 value 参数；`briefs.confirm` 内写入 | TC-PRIV-15 |
| PV-INV-03 | 投影与代理上下文代码从不读取他方 `briefs` 行；全量规则输入只经 `loadRuleInput` 进入规则函数 | ESLint 目录限制 + 调用图测试 | TC-PRIV-04/10 |
| PV-INV-04 | provider 可观测的规则信号 ∈ {`ok`, `blocked`} | XP-5 | TC-PRIV-08 |
| PV-INV-05 | `approvals` 每行都由 `approvals.record` 以人类身份写入；代理与 internal 函数不写 `approvals` / `sharedFacts` / `briefs` | §7.12.3 | TC-INJ-03 |
| PV-INV-06 | 对他方可见的文字只来自 `renderPublicText`；每个模板的实际读取 ⊆ 声明的 `reads` | §7.16 | TC-PRIV-11 |
| PV-INV-07 | `events.payload` 只含 room 类字段，无 `visibility` 字段 | §7.17 | TC-PRIV-03 |
| PV-INV-08 | 公共函数内无 `console.*`；公开路径的日志只经 `publicOpsLog`（键集合恰为 `{ fn, code, errorClass }`）；`opsLog` 只从 internal / action 可达；非 `ConvexError` 异常一律变为 `internal` | 构造器、`InternalCtx` 品牌、ESLint | TC-PRIV-16、16 S6 |
| PV-INV-09 | `(roomId, userId)`、`(roomId, role)` 各至多一个 `members` 行；角色只来自邀请 | `invites.accept` | TC-AUTH-05 |
| PV-INV-10 | 公开函数参数无身份字段；internal 函数显式 `actorUserId`；代理角色取自 `turns.role` | 构造器 + 快照 | TC-AUTH-06/10 |
| PV-INV-11 | 历史私密值只在其所属版本生效时的受众包含查看者时渲染 | `loadRestrictedForRender` | TC-PRIV-14 |
| PV-INV-12 | 每个写入的日期 ∈ `[localDate, localDate + 365]`；每个写入的 itemKey ∈ 已确认目录 | 写入闸门 | TC-PRIV-15 |
| PV-INV-13 | `humanRequests.options` 只由 `viewFor(toRole)` 计算 | `buildHumanRequests` + `assertOptionsProjected` | TC-PRIV-12 |
| PV-INV-14 | 约束变更类写入每用户每房间每小时 ≤ 6；每房间每 24 小时：价格类目录变更 ≤ 3 批、`setCap` + customer 硬字段 ≤ 6 次、run ≤ 6 个；每 run 每角色 `propose / counter` ≤ 4 | 节流计数（12 §12.2 第 7 条） | TC-AUTH-12、TC-AUTH-13、TC-RUN-18 |
| PV-INV-15 | 对 provider，预检结局相同的两次约束变更（无论由 finance、customer、人工请求回答还是直接改约束引起）产生规范化后逐字节相同的 `rooms.view` 与 `timeline.page` | DX-5 / DX-7、§7.17 | TC-PRIV-21 |
| PV-INV-16 | 代码常量 `DECLASSIFIED` 的键集合 = DX-1…DX-13；不在其中的派生值受众不宽于其输入受众交集 | `core/engine/privacy/disclosure.ts` | TC-PRIV-05、TC-PRIV-10 |

## 7.23 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 固定角色规则 `canSeeBudget = customer`（C27） | 未经 finance 任何披露决定，违反核心 1 |
| provider 看到原因类别（预算 / 范围 / 日期，PD-02 ii） | 每次多泄露约 1.6 bit；U2 默认只给 `ok` / `blocked` |
| 事件写入时 `visibility` 字段（旧 canon，C29） | 分页后过滤页大小不均；漏写即整条泄露 |
| 双写两条事件（room 级 + owner 级） | 两份事实来源，易漂移 |
| 哈希链 + 每日校验（C30） | 有写权限者可整条重算，只能发现意外损坏；外部锚点进 17 |
| 投影实时读取他方 `briefs.disclosures` | 与 `sharedFacts` 形成两个真相源，且投影代码必须读他方简报行 |
| `sharedFacts.add` 接受自由 value，并在运行时比对他方秘密 | 自由值是搬运通道；比对结果本身是预言机 |
| 让模型写公共措辞再正则扫描数字 | 研究显示泄露率 35–50%；改写泄露（"a bit under five grand"）扫不出来 |
| 把 `returns` 当运行时防线 | 校验失败消息可能回显被拦字段 |
| 每个模板参数自带 audience 再投影（三层投影） | 两套投影逻辑会分叉；保留一层 view-model 投影 + 金丝雀（review r16） |
| Clerk Organizations / publicMetadata 表达角色 | 第二个权限真相源（D24） |
| 链接 token 放路径（C36） | 经 `redirect_url` 与日志泄露 |
| v1 即提供"finance 向 provider 披露预算"开关 | 多一类投影分支与测试矩阵，收益小；列入 17 |

## 7.24 开放问题与待验证

**开放问题**

1. U1：`customerSeesBudget` 默认关（三开关），用户可改为默认披露 headroom。
2. U2：provider 的 fit 粒度（默认 `ok` / `blocked`）。
3. （已关闭）DX-2 的改价预检信道：在 D12 ⑥ 之外增设 `price_writes` 总量桶与 setCap / 硬字段子桶（§7.13、12 B7）；是否进一步让预检结果对 provider 不可区分（例如 `needs_input` 时也先建一个空回合）列入 17。
4. 写入时物化评估结果（`proposalEvaluations`，review r04），使 provider 的查询读集不含预算：作为加固选项，若采纳由 03 / 06 定表。
5. `approvals.note` 进入**本方**代理上下文（本章选择进入 principal 块）；05 / 10 需对齐。
6. 评估方代理的 `reasonKey` 不跨角色传递，proposer 只收到 `not_accepted`（PV-10）；05 的反馈块格式须对齐。
7. 08 的 G701 "基线"若取自 `ledgerEntries.baseline`，该字段属 finance 类，须走 XP-7。
8. （已关闭）错误码已与 12 §12.4 对齐（`auth.not_member` / `auth.role_forbidden` / `auth.not_creator` / `invite.seat_taken` / `request.not_open`），12 §12.11 的 `sharedFacts.add` 已无 `value` 参数；03 §3.13.1 `addMember` 与 02 INV-15 已是 `invite.seat_taken`，06 的码数组已不含 `invite.expired` / `invite.email_mismatch`（names-17）。
9. （已关闭）`00-invariants` 的 INV-18 / CE-029 已按本章语义书写：非本角色可共享字段或越界受众 → `disclosure.blocked`，本人硬字段对他方披露未确认 → `disclosure.needs_own_confirmation`，`sharedFacts.add` 无 value 参数。
10. （已关闭）canon D04 已列出执行后两项写入豁免（`tasks.markDone`、`rooms.startFollowUp`，C45）。
11. （已裁决）v1 提供**运维人工发起**的 `privacy.redact`（internal，全部层级，只覆写 `REDACTABLE_FIELDS`，事件 `pii_redacted`，§7.12.2）；canon D18 现文已列为只追加表的唯一例外（跨章核对阶段写入，18 ADR-X04）；自助删除不提供（17）。
12. （已关闭）`disclosure_changed` 与 `human_request_closed` 对 provider 的并入规则已写进 03 §3.11.1 的渲染表与 12 §12.17 的 `timeline.page` 视图模型（含"他人发起的约束变更提交对 provider 无 actor 标签"）（privacy-02）。
13. （已关闭）公开路径上的日志点（08 §8.5.3 S11 与 §8.6.6、12 §12.4 / §12.14 / §12.15 ⑨、03 `appendSharedFact`）已改用 `publicOpsLog`；15 §15.6.2 是两个 logger、`PublicOpsCode` 闭集与合并后 `SafeLogFields` 的唯一定义（privacy-10）。

**待验证**

| # | 事项 | 影响 | 验证方式 |
| --- | --- | --- | --- |
| V-1 | prod 是否下发 `logLines` / `errorMessage` | E1 是否只是纵深 | spikes §8 #11，L2 |
| V-2 | `returns` 对多余字段是否报错、报错消息是否回显值 | §7.18 第 2 条 | L2（techstack D12） |
| V-3 | 生产中被调度函数是否无身份 | §7.5.4（设计不依赖） | spikes §8 #3 |
| V-4 | mutation 内 `crypto.getRandomValues` / `crypto.subtle` 可用性 | 邀请链接是否需要 action | spikes §8 #6 |
| V-5 | 中途 `role: "system"` 消息在 SDK 1.1.0 与 `claude-opus-5-5` 上的位置约束 | §7.14.3 第 5 项 | spikes §8 #13，L4 |
| V-6 | Clerk token 中 `email_verified` / `name` claim 实测 | §7.6 邮箱邀请 | spikes §8 #12 |
| V-7 | 查询结果未变时是否推送 | R-7 | L3 |
| V-8 | Convex 默认运行时的 `normalize('NFKC')` 与正则后行断言 | `wrapUntrusted` | L2 |

## 7.25 与 canon 的对照

本章落实的 canon 决定：

- §1.1 / §1.6 命名：`members`、`invites`、`briefs`（`hardFields` / `softFields` / `disclosures` / `confirmedBy`）、`sharedFacts`、`catalogItems`、`ledgerEntries`、`proposals`、`approvals`、`humanRequests`、`runs`、`turns`、`attempts`、`executions`、`events`；函数 `rooms.view` / `rooms.close` / `rooms.startFollowUp` / `invites.create` / `invites.accept` / `briefs.confirm` / `briefs.mine` / `budget.setCap` / `ledger.recordBaseline` / `sharedFacts.add` / `catalog.confirm` / `catalog.retire` / `runs.*` / `approvals.record` / `humanRequests.answer` / `timeline.page` / `turns.beginAttempt` / `turns.complete` / `turns.fail` / `runs.reconcile` / `agents.runAttempt` / `agents.watchdog` / `executions.executeIfComplete` / `events.append`。
- §1.2：`actorUserId`（§7.5.4）、`toRole`、`reasonKey`、`provenance`、`termsKey`、`localDate`；§1.4：`rationale` 只给本方、不进他方上下文；§1.5：`private.constraint_unmet` 掩码、params 受众 fail-closed、provider 永不收到 `overByCents` / `headroomCents` / `deadline`。
- D02：`expectedConstraintsVersion` / `expectedTermsKey`、userId 两两不同；D03：`executionKey = exec:${proposalId}`；D04：`executed` 终态 + `startFollowUp`；D05：仅 title 不 bump；D07：守卫与 reconcile；D09：schema 在 action 内构造；D10：候选快照、角色作用域、不按预算过滤、按 `candidateKey` 排序、首发最低价候选。
- D11：`projectForRole` 统一入口（XP-1…XP-8）、派生值继承最严格类、删除 `deferredItemKeys`、请求选项按目标视图、掩码按检查判所有者、非干扰性质、矩阵由测试对账。
- D12 ①–⑧：fit 两值且历史不重算；`previewChange` 只对 finance；任何角色都无 `option_fits_constraints`；三开关默认关、fixture 只披露 `capCents`；每 run 每角色 ≤ 4 次提案；约束变更类写入每小时 ≤ 6；`run_waiting` 投影；写入时闸门与日期窗口；最后一项就绪条件满足时 `openIfReady` 同事务开首个 run（cause `room_opened`）。
- D13 公共文本模板化与三层证明；D14 事件 PD-8、`restrictedRef`、`(roomId, commitTs, seq)`、无哈希链；D15 `disclose` 写 `sharedFacts`、无 close 选项、`agent_failed` 请求；D16 日志纪律；D17 节流与 `draining`；D18 `provenance`；D19 "Suggestion only" 与禁用乐观更新；D21 构造器；D22 日期窗口基于 `localDate`；D23 `budget.below_committed` 的 params 只给 finance；D24 邀请与一人一席；D26 v1 无 LLM 抽取；D27 fixture 披露设定。冲突裁决 C26–C31、C35、C36。

错误码与 12 §12.4、`sharedFacts` 字段与 03 §3.6、`invites`（`mode` / `open → accepted | superseded`）与 03 §3.5、`rooms.create { myRole }` 与 12 §12.6、`openIfReady` 与 04 M2 一致。

本轮修订（v2 复核问题）对 canon 的落实与偏离：

- D11 / D12：解密清单扩到 DX-1…DX-13（counter 转发结局、`choose_candidate` 复核结局、被转发候选的隐含 fit，privacy-05），`DECLASSIFIED` 键集合与清单相等；DX-9 改为"counter 不是提案"。
- D12 ⑥：保留每小时 6 次作为速率限制，但**不再宣称它堵住零成本预言机**——总量上界来自 12 B7 的 `price_writes` / 硬字段子桶 / `run_starts` 每房间每 24 小时桶（privacy-01）；canon 原句"堵住零成本预言机"的措辞偏离已列入 canon 异议。
- D12 ⑦ / D14：provider 对约束变更提交只见无作者的 "Constraints changed (vN)"，他人简报版本号为 `null`，`brief_confirmed` / `human_request_answered` / `human_request_closed` / `disclosure_changed` 在同一提交内并入（privacy-02）。这是 D14"渲染时按查看者连接"的细化，不引入 `visibility` 字段。
- D16：公开路径只允许 `publicOpsLog`（闭集三键），`opsLog` 需 `InternalCtx`（privacy-10），比 canon"公共函数内禁止 `console.*`"更具体，不冲突。

相对底稿（security 候选）的改写：`participants` → `members`；`decisions` → `approvals`；`agentNotes` → 本方回合输出；`catalogVersions` → `catalogItems`；`operationKey` 含 cv → `executionKey`；粗类 `BUYER_CONSTRAINT` → provider `fit` + 他人 `private.constraint_unmet`；headroom 默认对 customer 可见 → 三开关默认关；目录发布每日 5 次 → 约束变更类写入每小时 6 次；执行后 bump cv → 不 bump；`briefDrafts` / 抽取 → 删除（D26）；`runs.retry`（failed）→ `runs.retryTurn`（`needs_input` + `agent_failed`）；`STALE_VIEW` → `approval.stale`；`admin.purgeRoom` + `ALLOW_PURGE` → `seed.reset` + `assertTier`；`deferredItemKeys` 公开 → 删除；"评审结论不公开"保留并扩展为"代理动作与 `reasonKey` 只给本方"。
