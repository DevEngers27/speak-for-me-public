# 00 · 统一口径 part5 — 已知冲突清单与裁决（C1–C60）

> 列出专题反驳、评委、techstack、spike、三份草稿之间的跨文档冲突，每条：谁对、改哪里。"改哪里"指 final-v2 对应章必须写成的样子；来源文件本身不改。

| # | 冲突 | 双方 | 裁决（谁对 → 改哪里） |
| --- | --- | --- | --- |
| C1 | 编排用 workflow 组件 vs 自建 scheduler 链 | spikes B7 / README §4 vs techstack D07、run-lifecycle D1 | 自建（D01）；10 吸收 spike 的三条硬要求：提交 mutation 过期拒绝 + 幂等 `(runId, turnSeq, attemptNo)`、attempt 级看门狗、不用 action-retrier |
| C2 | 执行键含不含 constraintsVersion | 旧 canon D03 `sha256(roomId, proposalId, cv)`、plugin / finance / agentquality / security / product 候选 `exec:{proposalId}:{cv}` vs invariants R-A、idempotent-execution D5、versioned-approvals D12、rules-engine-review r01、spike B2 | 后者对：`exec:${proposalId}`（D03）；03 建 `by_executionKey`；08 删除 cv 维度；旧 canon 错 |
| C3 | 执行后房间终结 vs 同房间追加轮 | 旧 canon D03 vs PD-05(b)、runtime 候选 ADR-25（executedItemKeys）、product ADR-27 | 终结 + 新房间（D04）；01/04/09/13 写 `startFollowUp`；17 收 PD-05(b)(c) |
| C4 | 执行是否递增 cv | plugin ADR-12、finance ADR-05、security ADR-17、runtime ADR-22 vs versioned-approvals D9、评委 I10 | 不递增（D03）：执行后房间终态，递增只会让已执行审批显示 stale |
| C5 | 评估回合并行 vs 串行 | 旧 canon D06 串行、minimal ADR-06 vs 8 份候选并行 + invariants R-D 屏障 | 串行（D08）；04 的 run 状态机没有屏障计数器 |
| C6 | 回合失败后 run 去向 | 旧 canon `paused` + 24h 看门狗 vs invariants R-D `needs_input`、PD-11 "该方本人重试" | `needs_input` + `agent_failed` 请求（D15）；04 删除 `paused` |
| C7 | today 是否进硬投影 | invariants R-I（todayAnchor 进投影、每日 cron bump）vs 旧 canon C9（绝对日期不重算）vs techstack D11（`rooms.localDate`） | 组合：绝对日期 + `localDate` 由 cron 推进 + 结论翻转才 bump（D22）；06/09/15 照此写 |
| C8 | 目录任何确认 bump vs 仅价格 / 工期 / 增删 | agentquality 候选 `catalogRevision` 守卫 vs 评委（标题改动冻结）、invariants 候选（标题也算规则字段） | 仅价格 / 工期 / 增删 / retire bump；标题与任务模板由提案快照承载；删除 `catalogRevision`（D05/D25） |
| C9 | 硬投影范围 | versioned-approvals 只投 `{itemKey, catalogItemId, priceCents, deliveryDate}` vs rules-engine 读 revision / status / validUntil / rushFee vs scenario-plugin 投影不含目录 | 投影从 `RuleInput` 派生，含目录 `(itemKey, revision, status, priceCents, leadDays)` 与修饰项（D05）；性质测试"投影相等 ⇒ 阻断集相等" |
| C10 | 约束变化后保留提案在旧 run vs supersede + 新 run 预检保留 | plugin R9 / versioned-approvals D6 保留旧 run vs run-lifecycle "总是 supersede"、minimal / eventsourcing / runtime "新 run" | 新 run + 预检保留同一 proposalId（D06）；04 的 run 迁移表写"旧 run superseded，新 run 可直接 pending_approval" |
| C11 | 单层 react vs 不动点 | eventsourcing runCommand 单层 vs 评委 | 不动点、深度 4（D06） |
| C12 | 持久化守卫比较 `run.constraintsVersionAtStart` vs 回合快照 | run-lifecycle G3 vs versioned-approvals D8 | 回合快照 `turn.constraintsVersion`（D07）；D06 下两者恒等，但 03 以回合字段为准 |
| C13 | 守卫命中只标 stale vs 必 reconcile | run-lifecycle `discardStale` vs invariants R-C、run-lifecycle-review r01 | 必 `runs.reconcile`（D07）；10/12 增加 `runs.reconcile` |
| C14 | 看门狗参数 `turnId` + `startedAt` vs `attemptId` | agentquality 候选 vs 旧 canon / run-lifecycle-review r07 | `attemptId`，读 `_scheduled_functions` 决定重登记（D07） |
| C15 | 流式 vs 非流式；max_tokens 8000 / 16000 / 6000 | spikes A6、techstack D14 vs np D10、run-lifecycle budget、各候选 | `stream().finalMessage()` + 16000（D09）；10 写出不等式 `timeout × HTTP 次数 + 落库余量 < action 上限` |
| C16 | `fallbacks` 默认开 vs 关 | techstack D17 开 vs 全部候选 / 旧 canon 关 | 关，开关保留，待 §8 #16 验证（D09）；18 记 ADR 并写明开启时的 beta 路径与 usage 拆行 |
| C17 | `thinking: {type:'adaptive'}` 显式传 vs 不传 | techstack D14 vs spikes A4（thinking 参数能 400） | v1 不传任何 `thinking`（D09）；fallbacks 开启后再评估 |
| C18 | ESLint 9（spike）vs 10（techstack）；Vitest 5.0.5 vs 4.1.11 | B10 vs D06 / X6 | spike 版本（D20）；ESLint 10 独立 PR |
| C19 | 四包 workspace vs 单包目录 | techstack D04 vs skeleton spike | 单包（D21），四包为升级路径 |
| C20 | 动作集与引用字段 | anthropic-zod `request_tradeoff` / `addressee` / `baseProposalId` vs protocol-rules `escalate` / `toRole` / `baseProposalVersion`；research 建议 `declare_infeasible` / `request_human_tradeoff` | protocol-rules 命名（§1.4）；research 的两个动作合并为 `escalate.kind` |
| C21 | 模型输出候选引用：`candidateKey` 字符串 vs 位置标签 `optionKey` | 多数候选 candidateKey vs np / spike optionKey | 模型只输出位置标签 `optionKey`，服务端映射 `candidateKey`（D10）：schema 变体与房间无关，可预热 |
| C22 | reasonCode 大写下划线 vs 小写点分 | privacy-canary、rules-engine、全部候选 vs protocol-rules、inputs/05 D | 小写点分（§1.5）；06 给出旧码 → 新码对照表 |
| C23 | contentHash（sha256）vs termsKey（规范串）vs contentKey | 旧 canon / agentquality / spike protocol-rules vs rules-engine D11、versioned-approvals D1、idempotent-execution、product、runtime vs finance / plugin | `termsKey` 规范串（D25）；`contentHash` / `contentKey` 为废弃别名 |
| C24 | deferredItemKeys 是否存在 / 公开 | 旧 canon §1.2（派生字段过矩阵）、9 份候选公开 vs invariants R-F、PD-03a、16 条评委反例 | 删除（D11）；03/06/08/14 不再有该字段，customer 视图现算 |
| C25 | 人工请求选项来源 | 候选用系统视图 vs invariants R-G、security ADR-07 | 目标角色视图（D11/D15） |
| C26 | provider 候选是否按预算过滤 | plugin / runtime 候选过滤 vs np D3、security ADR-07、minimal ADR-14、eventsourcing ADR-07 | 不过滤（D10） |
| C27 | 预算对 customer 固定可见 vs 需 finance 披露 | agentquality / eventsourcing / finance / plugin / product（默认披露）vs 评委、security ADR-03、minimal ADR-16、PD-01 | 披露开关默认关（D12 ④）；fixture 中 finance 披露 `capCents` |
| C28 | finance 无条件看 customer 简报 | eventsourcing 07 矩阵 vs 评委 | 一切跨角色字段都经 brief 确认时的勾选（D11）；同侧也不默认共享 |
| C29 | 事件可见性：写入时 `visibility` vs 全公开 + restrictedRef vs 双写两条 | 旧 canon D12 / runtime / finance 候选 vs privacy-disclosure PD-8 / security 候选 vs plugin 候选 | PD-8（D14）；旧 canon 错 |
| C30 | 哈希链 | eventsourcing 候选 vs 评委 | 不做；外部锚点进 17（D14） |
| C31 | `run_needs_input` / `human_request_opened` 对 provider 可见 kind / toRole | eventsourcing 07、D-FE-08 vs 评委 | provider 只见 `run_waiting`（D12 ⑦/D14） |
| C32 | 预算低于已承诺：拒绝 vs needs_input | invariants R-B、minimal / finance / plugin / product / security vs inputs/02、eventsourcing / runtime 候选、fixtures `below_committed` 变体 | 拒绝（D23）；fixture 变体改为"拒绝写入" |
| C33 | 调用上限落点 | 旧 canon D15 每房间累计 + run-lifecycle `usageCounters` vs techstack X2 | X2 四层 + 用户节流扩展到约束变更类写入（D17/D12 ⑥） |
| C34 | 排空用 `AGENTS_ENABLED=false` vs 独立标志 | testing-ops TD-11 vs review r06 | `opsFlags.draining`（D17） |
| C35 | 一人兼任 | PD-09b vs INV-15、techstack D20 | 不兼任（D24） |
| C36 | 邀请：链接 token 放路径 vs 邮箱定向 + fragment | 多数候选 `/invite/[token]` vs techstack D21 | techstack D21（D24） |
| C37 | fixture 数字 | protocol-rules vs fixtures-walkthrough / plugin / agentquality / privacy-canary | protocol-rules 为主 + canary 叠加（D27） |
| C38 | RUSH 费为插件常量 vs 目录修饰项 | eventsourcing 14 vs 核心 4 | 目录 `catalogItem(kind: modifier)`（D25） |
| C39 | `taskKey` 两段 vs 三段 | eventsourcing 03 vs 06 | 三段 `${executionId}:${itemKey}:${templateIndex}`（§1.2） |
| C40 | `requestRenegotiation` 允许状态 | plugin 04（四态）vs 12（仅 pending_approval）；product 允许 executed | creator 可从 `pending_approval` / `needs_input` 发起；`executed` 房间拒绝（D04）；04 与 12 同一张表 |
| C41 | 审批有效期 7 天 vs 不过期 | PD-08 vs research AE-6 / 旧 canon | 不过期（D15、U7） |
| C42 | 简报 LLM 抽取在 v1 | product / invariants 候选、CRITIQUES 原型 vs 简化 | 17（D26） |

### 章节定稿后新裁决的冲突（C43–C60，canon 包修订 2026-10-24；处置记录 `_fix/canon-log.md`）

| # | 冲突 | 双方 | 裁决（谁对 → 改哪里） |
| --- | --- | --- | --- |
| C43 | 测试编号两套：16 / 00-overview 沿用旧电池 CE-001…108（118），`00-invariants` 重写版 CE-001…170 | 00-overview §0.3 / §0.9、canon part7 旧 must_absorb vs 00-invariants、16 §16.11 现文 | **单一来源 = `00-invariants*.md`**：INV-01…78、CE-001…170；16 只从 CE-171 起新增并在 §16.11 映射；电池与定稿章节不一致时改电池本身（本次已把 16 §16.11.2 的修订并入电池）；00-overview §0.3 改引新编号；part7 的 16 must_absorb 同步 |
| C44 | `isExecutable` 含不含审批集合 | 04 §4.1.1 / 08 早稿（含）vs 02、INV-35、08 定稿（不含） | 不含：`isExecutable = 当前性 ∧ passesChecks`，`canExecuteNow = isExecutable ∧ allApproved`（§1.3） |
| C45 | D04"执行后任何写入拒绝" vs 执行后的任务勾选与 follow-up | canon D04 原文 vs §1.3 task、03 / 04 / 07 / 08 / 12 | 两项豁免：`tasks.markDone`、`rooms.startFollowUp`（D04） |
| C46 | 目录 `revision` 进投影、"仅改标题不 bump"、`lines[].revision` 判 stale_source 三者冲突 | D05 / D25 字面 vs 09 §9.1.3、03 §3.7、06 | `revision` = 定价修订号 + `editNo` 展示修订号；逻辑唯一 `(roomId, itemKey, revision, editNo)`（§1.1 / §1.2） |
| C47 | D06 预检保留的范围与提案状态时序 | D06 字面（任何非终态 run）vs 04 R2 / 09 V9（仅 `pending_approval`）；INV-32 / 08 的 `stale → active` 疑问 | 仅被取代 run 处于 `pending_approval` 时保留；同事务 `stale → active`（§1.3、D06） |
| C48 | `setup → open` 触发条件与首个 run 的 cause | INV-75 / INV §4 Q4（三席就位即 open，第三份简报以 `briefs_confirmed` 开 run）、14 早稿 `initial`、05 早稿 `restart` vs 04 M2 `openIfReady` | 04：就绪全部满足才 open，同事务 `bump(room_opened)` + 首个 run（cause `room_opened`）；run cause 四值（§1.2、§1.3、D12） |
| C49 | `rooms.currentRunId` 终态时是否清空 | INV-67 vs 03 / 04 / 08 | 不清空，指向最新 run（任何状态），只由 `startRunTx` 写（§1.2） |
| C50 | 人拒绝的 `reasonKey` 对谁可见 | 04 早稿 R10（进 provider 代理反馈）vs 05 §5.8.6 / 08 A13（代理不进）vs 07 DX-6（人可见） | 人按场景 audience 可见；任何他方代理上下文不含（D13） |
| C51 | `sharedFacts.add` 是否有 value 参数 | canon §1.6 原文与 12 早稿（有，闸门扫描）vs 03 / 07 LP-3（无） | 无 value 参数，值从本人当前简报复制，闸门不与他方秘密比对（§1.6、D12 ⑧） |
| C52 | 排空时系统路径是否建 run | D17 字面"runs.start 拒绝" vs 10 §10.12.3 / 04 | 公开入口拒绝；系统路径照常建 run、首回合停泊（D06、D17） |
| C53 | `ops.setDraining` 层级 | §1.6 原文 dev-only vs D17 / 12 / 15 | 全部层级 internal（§1.6） |
| C54 | 取舍卡"转交"出口 | part7 13 must_absorb / CRITIQUES vs D15 effect 集合 | 新增 `pass_to_next { toRole }`，只在 `infeasible`、按位置提供（D15） |
| C55 | 每回合自动重试次数 | PD-11 `MAX_AUTO_RETRIES = 3` vs D17 公式 / 10 / 04 | 每回合链至多自动重试 1 次（`MAX_ATTEMPTS_PER_TURN = 2`），run 上限 18（D17） |
| C56 | reasonCode 缺口与别名 | §1.5 原清单 vs 04 / 06 / 08 / 12 实际使用；INV 占位码 | §1.5 补录 `approval.not_executable` / `item.limit_exceeded` / `auth.*` / `invite.*` / `request.*` / `input.invalid` / `internal`；无可撤回 = `unchanged`；场景未注册 = `run.invalid_state{scenario_version}`；不设 `run.spend_limit` |
| C57 | D27 主线"3 条审批 stale""stub counter $800" | D27 原文 vs D02 / D03 / D08 与 05 / 08 / 09 / 14 走查 | 2 条 `stale_approve` + finance pending；provider 在 run 2 提出 v2 $800（D27） |
| C58 | 节流计数来源、批量确认与 setup 期 | D12 ⑥ 原文未定 vs 12 B7、07 §7.13 | 命令事件 + `events.by_room_actor` 按 distinct `commitTs`；批量计一次；setup 不豁免；另设 `price_writes` / `run_starts` / `room_create` 总量桶（D12 ⑥） |
| C59 | `restrictedRef` 目标表 | D14 原列四表 vs 03 `restrictedRefV` 八表 | 八表，条件是"本就按角色控制访问"（D14） |
| C60 | strict schema 生成器与 Zod 的落点；`modelGateway` 位置 | D09 `toStrictOutputSchema(zodSchema)` 住 core vs D21 core 禁 Zod；INV-42 `core/engine/modelGateway.ts` vs 10 | core 只做 JSON Schema 纯变换，Zod 构造在 `convex/model/agents/outputSchema.ts`；`callModel` 在 `convex/model/agents/modelGateway.ts`（D09、D21） |

### 对三份草稿的逐项处置摘要

- 旧 `00-canon*.md`：D01/D02/D04(→D05)/D05(→D06)/D08–D11/D13–D14/D16–D18 的实质保留并细化；D03（执行键）、D06（paused）、D12（事件 visibility）、D15（每房间累计上限）、§1.2 `contentHash` / `deferredItemKeys` / `modelCalls` 表 / `catalogRevision` 字段按本版修正。
- `00-invariants*.md`：已重写为 canon 对齐版（INV-01…78、CE-001…170），并在 canon 包修订中按 C43–C60 与各章定稿逐条改写（命名、cause、错误码、helper 名、D06 收窄、D15 新出口、D27 主线；记录见 `_fix/canon-log.md`）；它是不变量与反例电池编号的**单一来源**（C43），02 / 04 / 08 / 09 / 16 引用其编号。（下面一句针对的是草稿旧编号，仅作历史：凡与 R-D / R-H / R-I 相关的旧 INV-11 / 20 / 38 / 50 / 54 与旧 CE-009 / 084 / 085 / 091 / 092 已在重写版中按 D08 / D12 / D22 改写；`request_tradeoff` → `escalate`、`operationId` → `executionKey`、两段 taskKey → 三段亦已落实。）
- `00-product-decisions*.md`：PD-05 改为 D04 默认；PD-09 改为 D24 默认；PD-02 / 04 / 08 / 10 / 11 只部分采纳（见 `00-canon.md` 页首与 `00-product-decisions-part2.md` 末节"与 canon 的对照"）；PD-01 / 03 / 13 原样生效；PD-06 / 07 / 12 / 14–16 为用户决策，默认值见 part4。
