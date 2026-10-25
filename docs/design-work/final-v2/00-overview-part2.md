# 00 · 概览 part2：术语表、不变量摘要、否决项、开放问题、canon 对照

> 分片：`00-overview.md`（§0.1–§0.5）→ 本文件（§0.6–§0.10）。

## 0.6 术语表（以引用方式逐字采用 canon §1.1–§1.3）

本章的术语表就是 `00-canon.md` §1.1（实体与表、废弃别名、关系）、§1.2（关键字段）、§1.3（存储状态与"派生而不存储"的量）的原文，**逐字适用、不在此复制**：canon 是唯一文本，复制件在 canon 修订后必然漂移，canon part6 对本章"术语表逐字采用"的要求由此以引用方式满足。动作枚举与模型输出根见 canon §1.4，reasonCode 风格见 §1.5，核心函数名见 §1.6。本章只补两类 canon 没有的名字。

### 0.6.1 叙述用补充术语（不进 schema）

| 术语 | 含义 | 出处 |
| --- | --- | --- |
| round（轮） | proposer 1 个 propose 回合 + 其余角色按场景顺序各 1 个 evaluate 回合 | D08 |
| fit 信号 | provider 对提案只能看到的 `ok \| blocked` | D12 ① |
| 硬投影 | `scenario.hardProjection(input)` 的规范串，前后不等才递增约束版本；不持久化 | D05、09 §9.1.1 |
| 买方视图 / 卖方视图 | 按 `projectForRole` 得到的 customer、finance / provider 视图 | D10、D11 |
| 一等结局 | `executed`、`ended_no_agreement`（含请求过期与 `end_run`）、`canceled`、`closed` | 01 §1.6 |
| `phase`（`derivePhase`） | 读时派生的界面阶段：`setup{gaps}` / `negotiating` / `needs_input` / `awaiting_approval` / `stopped` / `executed` / `closed`，不存储 | 04、01 X6 |
| `passesChecks` / `allApproved` | 当前约束下全部检查通过 / 必需审批齐全，二者分开命名；`isExecutable = 当前性 ∧ passesChecks`（不含审批集合）、`canExecuteNow = isExecutable ∧ allApproved` 由 canon §1.3 定义（C44） | D19、canon §1.3、13 §13.9.2 |

### 0.6.2 原由各章引入、现已由 canon 吸收的名字（只留指针；定义以 canon 为准，决定记录在 18 §18.6）

| 名字 | canon 落点 | 章节定义处 | 决定记录 |
| --- | --- | --- | --- |
| `rooms.writeSeq`、`openRoomTx` / `RoomTx`（房间写锁 M-ROOM） | canon §1.2 `writeSeq`、§1.6 helper；00-invariants INV-M1 | 03 §3.3 | ADR-X01（N-31 已解决） |
| `catalogItems.editNo` | canon §1.1 / §1.2 `revision` / `editNo` | 03 §3.7、09 §9.1.3 | ADR-X02（N-09 已解决） |
| `constraintRevisions` | canon §1.1 | 03 §3.7、09 §9.3 | ADR-X03（N-32 已解决） |
| `rawOutputs` | canon §1.1 | 03 §3.8 | ADR-X03（N-32 已解决） |
| `privacy.redact`、`REDACTABLE_FIELDS` | canon D18（只追加表唯一例外） | 03 §3.3.2、§3.16.2 | ADR-X04（N-33 已解决） |

## 0.7 全篇不变量摘要（详表见 02，测试见 16）

1. 私密简报字段只经 `briefs.mine` 返回本人；对他方可见的任何值都来自显式披露或模板白名单字段；派生值继承最严格披露类。
2. `approvals` 的每一行都由已认证的人经 `approvals.record` 写入；代理产物永不进入 `approvals`。
3. 一个审批计入完成判定 ⇔ 它是该 `(proposalId, userId)` 的 `seq` 最大行、`decision = approve`、`boundConstraintsVersion = room.constraintsVersion`、`boundTermsKey = proposal.termsKey`，且被选中的 `userId` 两两不同。
4. 金额只等于已确认目录行价格之和（整数分），日期只等于插入日 `localDate + max(leadDays)` 的绝对日期；模型输出中不存在金额 / 日期 / 版本 / 身份字段。
5. 同一 `proposalId` 至多一行 `executions`；执行与最后一个必需审批同事务；`committedCents = Σ ledgerEntries.amountCents ≤ capCents` 恒成立（`budget.below_committed` 拒绝写入）。
6. 只追加表只有 insert；例外只有两个——`seed.reset` 仅在 dev / preview 删 `provenance !== 'live'` 的房间，`privacy.redact` 只把 `REDACTABLE_FIELDS` 覆写为 `"[redacted]"`（与 `termsKey` 覆盖字段不相交，18 ADR-X04）；`rawOutputs` 不属只追加表，到期删除。执行后审批有效性从 `executions.approvalIds` 读取，不再实时派生。
7. 任意时刻每个房间至多一个非终态 run；run 为 `negotiating` 时其当前回合必有 running attempt、已登记的调度（`beginFnId`），或带 `waitingReason` 的停泊且其唤醒者已登记（`runs.reconcile` 维护，INV-70）；任何非终态房间都有不依赖 creator 的终结路径（INV-79）；进入 `needs_input` 时恰好一个 open `humanRequest`。
8. 所有 seeded / stub 产物在数据（`provenance`）与界面（`SimulatedBadge`）两层标注。

## 0.8 备选与否决（概览层面）

| 备选 | 否决理由 | 裁决出处 |
| --- | --- | --- |
| workflow 组件编排回合 | 状态仍需落自有表；确定性约束与协议频繁迭代冲突；带组件后 codegen 不能离线 | D01 / C1 |
| 执行键 `exec:${proposalId}:${cv}` 或 sha256 | 同提案跨 cv 重批可执行两次；`crypto.subtle` 可用性待验证且哈希无收益 | D03 / C2 |
| 同房间追加轮（PD-05b） | 需要 `executedItemKeys` 进入规则、枚举、简报语义与审批快照，每项都有评委反例 | D04 / C3 |
| 并行评估 + 计数器屏障 | 一方失败另一方被判 stale 后计数永不归零 | D08 / C5 |
| 事件写入时 `visibility` 字段 / 双写 | 分页后过滤页大小不均；漏写即整条泄露 | D14 / C29 |
| 四包 workspace 立即落地 | Convex 打包 `convex/` 外相对导入未实测；单包已被 spike 验证 | D21 / C19 |
| v1 做 LLM 简报抽取、通知、有效期 | 扩大泄露面与范围；均列入 17 | D26 / C42 |

## 0.9 开放问题

1. 用户决策 U1–U12（canon part4）：本章按默认值书写，任何一项改动会影响 §0.3 的设计点（尤其 U1 `customerSeesBudget`、U2 fit 信号粒度、U3 执行后房间、U4 串行墙钟）。
2. 文档地图中其他章的分片以最终 `ls` 为准；18 章汇总各章新发现的开放问题。
3. （已关闭）测试编号已统一：16 §16.11 采用 `00-invariants*.md` 重写版的 CE-001…170（另增 CE-171…175，此后从 CE-176 起）与 INV-01…79、INV-M1，本章 §0.3 按此书写；8 条不一致的电池期望已由 canon 包并入电池（canon C43，18 N-21 已解决）。
4. （已关闭）§0.6.2 的名字已由 canon 吸收（§1.1 / §1.2 / §1.6 / D18），18 N-09、N-31…N-33 已解决。

## 0.10 与 canon 的对照

本章只使用 canon 规范名；D01–D27 在 §0.1–§0.4、§0.7–§0.8 中只被引用（每处已标 Dnn），没有细化或偏离，不再逐条复列。下表只列细化、章节级补充与 part6 must_absorb 的落点。

| canon 条目 | 本章的处理 | 位置 |
| --- | --- | --- |
| §1.1–§1.3 术语、字段、状态 | 以引用方式逐字采用，不复制（复制件在 canon 修订后必然漂移）；另列叙述用补充术语 | §0.6、§0.6.1 |
| 原 canon 未覆盖、现已吸收的名字 | 房间写锁、`editNo`、`constraintRevisions` / `rawOutputs`、`privacy.redact` 进入核心 5 / 6 的设计点与不变量摘要第 6 条；canon §1.1 / §1.2 / §1.6 / D18 已吸收，决定记录仍在 18 ADR-X01…X04（细化 canon） | §0.3、§0.6.2、§0.7 |
| C43–C60（canon 包修订新裁决） | C43 编号单一来源 → §0.3 与 §0.9 第 3 条；C44 `isExecutable` / `canExecuteNow` → §0.6.1；C45–C60 的状态、出口、上限与命名细节（执行后两项豁免、D06 只沿用 `pending_approval`、`openIfReady` 与 run cause 四值、`currentRunId` 不清空、`pass_to_next`、`MAX_ATTEMPTS_PER_TURN = 2`、码表补录、D27 主线、节流桶、`restrictedRef` 八表、strict schema 落点）由 04 / 05 / 08 / 09 / 10 / 12 / 14 承担，本章经 §0.6 的引用自动适用，§0.3 / §0.7 只引用不复述 | §0.3、§0.6、§0.7 |
| part6 00-overview must_absorb | 术语表逐字采用（§0.6，以引用方式）；差异补三条（§0.4 第 1–3 行）；八条核心各列设计点与测试编号（§0.3，编号与 16 / `00-invariants` 一致）；文档地图 19 章与分片（§0.5） | — |
