# 评审：fixtures-walkthrough（part2：其余问题、声明核对、命名对照）

## 2. 问题清单（续）

### fixtures-walkthrough-r08 · low · 执行键与审批人字段在三个专题里三种写法
- 描述：本文 `operationId = "exec:" + p2 + ":4"`；idempotent-execution 的 `pure.ts:91` 是 `` `exec:${proposalId}` ``；rules-engine D10 用 `(proposalId, constraintsVersion)`。本文 `requiredApproverRoles: string[]`；versioned-approvals 的 schema 是 `requiredApprovals: { role, kind }[]`，`kind` 由 role 派生。
- 建议：以 08 / idempotent-execution 为准。提案不可变、只绑定一个 cv，`exec:${proposalId}` 已经足够。审批人字段统一为 `requiredApprovals`。

### fixtures-walkthrough-r09 · low · "唯一允许的提案字段变更"说法不实
- 描述：第 10 步称 p1 置 `superseded` 是"唯一允许的提案字段变更"，第 12 步又把 p2 置 `executed`；第 6 步说 p1 "不改"；无解变体里 p1 永远停在 `active`，实际已被阻断。
- 建议：按 versioned-approvals：`status`（active/superseded/executed）与 `statusChangedAt` 是仅有的可变字段，阻断一律读取时派生；走查文字照此改。

### fixtures-walkthrough-r10 · low · `budgetDisclosure: 'buyer_side'` 放错了层
- 描述：fixture 把它放在 finance brief 里，等于暗示 finance 可以改它，而且没说改它算不算约束变更。PD-2 是场景级声明 `sides = { buyer: ['customer','finance'], seller: ['provider'] }`；`budgetDisclosure`、`buyer_side` 在其他专题里都搜不到。
- 建议：从 brief 里删掉，场景插件导出 `sides`，fixture 引用即可。

### fixtures-walkthrough-r11 · medium · 固定锚点的 golden 测试会被"不早于今天"校验打破
- 描述：D2 说注入固定锚点 2026-10-26 就能保证可重复，但 `validateBrief` 要求日期"不早于房间时区的今天"，06 的候选日也要求不早于 today。真实日期过了 2026-11-16 以后，convex-test 主线第 2 步就会失败。
- 证据：part2 第 2 步守卫；rules-engine D9；§7 第 3 条没有提到时钟。
- 建议：所有"今天"都只从一个 helper `roomToday(ctx, timezone)` 取（底层是 `Date.now()`）；golden 测试冻结时钟（convex-test 的假时钟 API 待验证，见 inputs/04 待验证第 14 条），或令锚点 = 冻结的今天。

### fixtures-walkthrough-r12 · low · seed 依赖了几项未核实的运行时能力
- 描述：`anchorDate` 缺省为"房间时区的下一个周一"，依赖 Convex 默认运行时的 `Intl.DateTimeFormat` 时区支持（待验证）。邀请码要在 internalMutation 里生成随机数并存 `tokenHash`：随机源与 Web Crypto（异步）在默认运行时是否可用，inputs/04 没有核实，rules-engine D11 也正因此否决了 SHA-256。
- 建议：CLI 必须显式传 `anchorDate`，在本机算好，删掉缺省值；随机码与哈希标"待验证"，备选是在 Node action 里生成后传给 mutation。另外 `npx convex run` 支持 `--identity`（`convex/src/cli/lib/run.ts:143-160` 伪造身份，tokenIdentifier = `${issuer}|${subject}`），可以用来做 dev 脚本化走查，不必让 seed 直写 members。

### fixtures-walkthrough-r13 · low · 金丝雀与数字黑名单不全，整数金额不利于扫描
- 描述：§5.5 的黑名单缺基线 `400000` / `4,000`、原上限 `500000` / `5,000`、余量 `100000` / `80000` / `5000`，而且只扫 provider 视图。customer 的私密备注不应出现在 finance 视图里，finance 的也不应出现在 customer 视图里，这个方向没有扫。privacy-disclosure part5 特意用 481_237 这类奇数美分，避免整数子串误报或漏报。
- 建议：另设 `privacyCanary` 变体，沿用 PD 的奇数美分并做六种写法扫描；主线 fixture 保留整数讲故事。金丝雀扫描按"本人以外的全部角色"做双向扫描。

### fixtures-walkthrough-r14 · low · 小幅过度设计与终态缺位
- 描述：(a) `purgeDemoRoom` 自我续调度的分批硬删除只在 dev 用，而归档已经满足需求，v1 用不上它。(b) 第 6 步先插入 `negotiating` 再同事务迁到 `needs_input`，多一次无意义的迁移。(c) `closed_no_agreement` 在 run-lifecycle 的 `runStatusV` 里不存在（现有 negotiating/pending_approval/needs_input/failed/superseded/cancelled/confirmed）。
- 建议：(a) 移到 17-roadmap，或只保留"dev 部署整库清空"的运维说明。(b) 直接以 `needs_input` 插入。(c) 优先复用 `cancelled`，配一个新的 `endedReason: 'no_agreement'`，不新增终态；若 04 坚持新增，再同步 RL 的 schema。

## 3. 待验证声明逐条核对

| # | 声明 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | 组合金额、工作量、交付日、各 cap 可行集 | **成立**（附说明） | 实跑 node 24.21.0：14 个组合全部与 §3.6 一致，C3=75_000 / 2026-11-23。fixture 文件只含 `enumerateAll`，没有可行性和前沿代码，所以"可行集为实际输出"并不成立；本评审用独立脚本复算：500_000→{C1–C4}、480_000/475_000→{C1,C2,C3}、474_999→{C1,C2}、440_000/390_000→∅，前沿与本文一致（前提是按本文的支配规则，见 r01） |
| 2 | mutation 写入与 `runAfter(0)` 原子提交，提交后才执行 | **成立** | inputs/04 要点 2、part2 含义 2（回滚则调度一并消失） |
| 3 | 被调度 action 至多一次、不重试；在途不可 cancel | **成立** | `convex/src/server/scheduler.ts:37-40`（at most once, not retried）、`:141-150`（in progress 会继续跑完）。补充：守卫是唯一的写入保证，但还需要 watchdog 检测丢失（04 要点 4） |
| 4 | 索引无唯一约束，靠单一写入口先查后写加 OCC | **成立** | `convex/src/server/schema.ts:173-185` 的 `IndexOptions` 只有 `staged`；04 §1.6。并发下区间读冲突仍待验证 |
| 5 | convex-test 串行、不模拟 OCC | **未核实**（结论稳妥） | 04 §1.12 标"待验证"，本机未安装 convex-test；"并发幂等必须在真实部署验证"这个结论不依赖前提，成立 |
| 6 | `npx convex run` 可调 internal；`--prod` 指向生产 | **成立**（源码级） | `cli/run.ts:35` 示例 `--prod`；`cli/lib/command.ts:178` "this project's default production deployment"；`cli/lib/run.ts:47` `setAdminAuth(adminKey, identity)`，以管理员身份调用 |
| 7 | 单 mutation 读写上限数值未知 | **成立**（确实未知） | 04 §1.3：本地无数值；可用 `ctx.meta.getTransactionMetrics()` 实测剩余额度 |
| 8 | Convex 运行时 `Intl.DateTimeFormat` 时区可用 | **未核实** | 04 与本地源码均无依据；见 r12 |
| 9 | Clerk JWT 是否带 name/email | **未核实**；已知不保证 | `convex/src/server/authentication.ts:75-80`：只保证 `tokenIdentifier` 与 `issuer`，设计不能依赖 name |
| 10 | `tokenIdentifier` 全局唯一，可作 `members.userId` | **成立** | `authentication.ts` 中 `tokenIdentifier` 的注释 "stable and globally unique"；04 要点 6 |
| 11 | 买方/卖方预算披露是 07 的决定 | **成立**（形式不同） | privacy-disclosure.md PD-2 采纳 F07.1；但 07 用场景级 `sides`，不是 brief 字段（r10） |
| 12 | 05 若坚持 `deliveryDate`；帕累托/conflictPolicy、`closed_no_agreement` 待认可 | **不成立/冲突** | 05 用的是 `optionKey`，既不是 `deliveryDate` 也不是 `deliveryTier`；06 的支配规则不同（r01）；RL 没有该终态（r14）；`conflictPolicy` 在其他专题里不存在 |
| 13 | provider 只能推断 [$750, $900) 且可接受 | **不成立**（泄露更多，且需 07 拍板） | 05 D3 接受同等泄露，但 PD-2 字面禁止；还有其他推断途径（r06） |

## 4. 跨专题命名对照（合并 14 前统一）

| 概念 | 本文 | 应采用（来源） |
| --- | --- | --- |
| 模型提案 | `itemKeys + deliveryTier` | `optionKey`（05 model-output.ts） |
| 可行性与前沿 | `precheck` / `enumerateCandidates` / `customerPareto` | `findFeasibleOptions` / `paretoFrontier` / `suggestRelaxations`（06） |
| run 触发 | `budget_change` | `constraint_change`（RL schema） |
| run 结束原因 | `constraints_changed` | `superseded_by_constraint_change`（RL） |
| 回合状态 | `queued`、`blocked_by_rules`、`turn_rejected_stale` | `running` / `invalid_output`（`rules_rejected`）/ `stale`（`guard_rejected`）（RL） |
| 审批人 | `requiredApproverRoles` | `requiredApprovals: { role, kind }[]`（versioned-approvals） |
| 执行键 | `exec:${p}:${cv}` | `exec:${proposalId}`（idempotent-execution） |
| 人工回答 | 选项键为候选 id 或 `raise_cap_to:N` | 选项种类 `choose_candidate` / `raise_budget` …，键不透明（05 part4） |
| 预算披露 | brief 字段 `budgetDisclosure` | 场景级 `sides`（07 PD-2） |
