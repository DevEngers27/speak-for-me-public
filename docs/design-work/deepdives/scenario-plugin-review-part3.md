# 反驳评审：场景插件接口 · part3（r09–r18、过度设计、接口要求）

### r09【medium】席位进投影，与 versioned-approvals B15 冲突
- 证据：part2 §3.5 的引擎投影包含 `seats: sortedRoleSeatAssignments`；versioned-approvals-part2 递增矩阵 B15 写的是"成员更替不 bump"，靠 INV-E3"approve 必须来自当前成员"让旧成员的审批自然失效。
- 建议：采用 B15 的做法，席位不进投影。否则换一个人就会让三方全部重新审批，而 INV-E3 已经覆盖了安全性。

### r10【medium】"总额低于已承诺"是可达状态还是写入拒绝，两边不一致；骨架的抬高选项数字也有错
- 证据：本专题把 `below_committed` 当作状态处理（checkBudget 分支、trigger、`Q_RAISE_CAP`），inputs/02 part6 第 21 行与 part8 第 72 行也写"→ needs_input"；而 versioned-approvals 矩阵 B1 和 frontend-ia-part3 第 49 行让 `updateBudget` 直接拒绝并回滚。照后者，`below_committed` 变体只能靠 seed 造出来，fixture 就描述了一个生产里不可能出现的状态（违反 SP-I12）。
- 骨架缺陷：scope-change.ts:128 的 `newTotalCents: committedCents` 让余量变成 0，抬高之后依然无解，应当是 `committedCents + minFeasibleAmount(ctx)`。
- 建议：09 拍板一种语义（按 inputs/02，倾向"允许写入、进入 needs_input"），另一方随之修改；fixture 期望跟着改。

### r11【medium】枚举上界和"完备性"定义自相矛盾；fixture 期望表达不了 rush 维度
- 证据：part3 §3.6 说"maxItems ≤ 12 可穷举，maxEvaluations = 4096 = 2^12"，但 scope_change 每个组合还要乘上 rush 开关，12 项就是 2^13；part5 C6 写的是"≤ 10 项"。`deliveryDate` 是连续维度，"与暴力穷举比较完全一致"必须先规定一个规范日期（例如最早可行日）。`FixtureVariant.expect.feasibleItemSets: ItemKey[][]` 无法区分 tradeoff 变体里的 LOGIN 加急与 LOGIN 标准两个候选。
- 建议：候选身份 = `candidateKey = canonical(itemKeys, rush, dateRule)`，期望按 candidateKey 写；上界统一成一个数字，并把维度乘积写进契约。

### r12【medium】`useRush` 可以白收加急费；attrs 注释暗示费用依赖软字段
- 证据：scope-change.ts:97 只要 `useRush` 就收费，`validateProposal` 只检查日期下界，所以交付日 today+14 时也可以收 $100。第 10 行注释写"delivery ≤ customer's preferredDate 时收取"，而 preferredDate 是软字段、不进投影；如果真按注释实现，金额会随软字段变化，破坏 SP-I4。F14.2 的 R 是整单一行费用，骨架却是逐条目的。
- 建议：rush 由代码按日期推导（交付日早于标准最早日才收），不做模型开关；或者加检查 `RUSH_NOT_REQUIRED`。整单还是逐条目，由 14 决定。

### r13【medium·简化】去掉 SHA-256：约束键和内容哈希都改成规范字符串
- 证据：rules-engine-part2 第 29 行与 versioned-approvals.md 第 51 行都否决了 SHA-256 contentHash（Web Crypto 异步，Convex 运行时可用性待验证）；本专题仍然用 `stableHash`，并且把它当同步函数写。
- 建议：`rooms.constraintsKey = canonicalJson(projection)` 直接比较字符串。投影只有几百字节，同时保留了可审计的约束历史（核心 6）。提案靠不可变性加 `termsKey` 规范字符串。这样待验证第 2 条就整个消失了。

### r14【medium】跨专题命名与语义不一致（任务书 §6"同一概念全篇一个名字"）

| 概念 | 本专题 | 其他专题 |
| --- | --- | --- |
| 插件接口 | `ScenarioPlugin<A,B,C,D,T>` | rules-engine-part3:31 `ScenarioRules<Terms, Base>` |
| 必需审批快照 | `requiredApprovers` | versioned-approvals `requiredApprovals` |
| 提案的约束版本 | `proposals.constraintsVersion` | versioned-approvals / idempotent-execution `createdAtConstraintsVersion` |
| 评估快照 | `validationSnapshot` | `validationAtCreation` |
| 来源变化 | `SOURCE_SUPERSEDED` / `ITEM_NOT_CONFIRMED` | rules-engine `SOURCE_CHANGED` / `UNCONFIRMED_ITEM`；versioned-approvals `SOURCE_ITEM_WITHDRAWN` |
| 截止日 | `DATE_AFTER_DEADLINE` | rules-engine `AFTER_DEADLINE` |
| 掩码码 | `CONSTRAINT_UNMET`（静态披露） | rules-engine `PRIVATE_CONSTRAINT_UNMET`（客户未共享时才掩码，动态） |
| 抬高预算选项 | `raise_cap` | negotiation-protocol `raise_budget` |
| 目录表 | `catalogItems` | privacy-disclosure `offerItems` |
| 共享字段 | `briefs.sharedFields` | `sharedFacts` / `shareableFacts`；简报历史 `briefVersions` 表 |
| 确认人 | `confirmedBy: tokenIdentifier` | inputs/04 含义 7：映射到内部 `users` 表 |

- 建议：在 00-overview 的术语表里统一。静态披露还是动态披露要由 07 拍板：rules-engine 的动态方案更贴近"已共享就可以说"的直觉，本专题列为开放问题。

### r15【low】SP-D11 的理由要改；退路 `convex/lib/` 有副作用
- 真正的理由是：`convex/` 下每个 `.ts/.tsx` 都是入口模块（`CVX:bundler/index.ts:457-480`，只跳过 `_generated`、点文件、`schema.ts`、多点文件名、含空格的路径），只要 registry 误 import 了 `ui.tsx`，React 就会进服务端包，`"use client"` 的语义也会混乱。esbuild 的 `platform: "browser"` 并不阻止打包 React。
- 退路的副作用：放进 `convex/lib/` 后，每个引擎和场景文件都会被注册成函数模块；目录名 `scope-change` 含连字符，Convex 模块路径对字符的限制本地查不到（待验证）。建议目录名直接用 scenarioKey `scope_change`。

### r16【low】`v.any()` 字段的键名约束应写进一致性套件
- `CVX:values/value.ts:199-218`：键不得以 `$` 开头，只能是 ASCII 32–126，长度 ≤ 1024。`TradeoffOptionSpec.effect.patch`、`params`、`summaryParams` 都是 `Record<string, JsonValue>`，键名不受 strictObject 约束。
- 建议：一致性套件增加"所有落库 JSON 的键匹配 `/^[A-Za-z][A-Za-z0-9_]*$/`"；嵌套深度与 1 MiB 上限保持待验证。

### r17【low】由私密硬字段决定的审批人集合是旁路泄露
- event_budget 的 `hostSelfApproveLimitCents` 是 `shareable: false`，但"必需审批人多了 finance terms"对 planner 可见，等于泄露"金额超过了某个私密阈值"。删掉 r02 的变体之后，这条风险随之消失；如果保留，07 需要为 `requiredApprovals` 定义逐角色的投影。

### r18【low】目录"当前确认版本"的定义有歧义
- part2 §3.3 写的是"同 itemKey 最大 revision 且 status 为 confirmed"：如果代理建议的 draft 占用了 revision n+1，这个条目就"消失"了；`by_room_status` 查 confirmed 还会返回历史行。
- 建议：draft 不占 revision 号（确认时才分配）；"当前" = 非 draft 行中最大 revision 的那一行，`withdrawn` 为终态。

## 3. 过度设计

| 组件 | 问题 | 建议 |
| --- | --- | --- |
| 6 个 UI 槽位 + 描述符驱动的通用表单 + DTO 泛型 | v1 只有一个场景，两套渲染路径要同时维护 | v1 只做通用渲染加 `proposalTermsCard` 一个槽位，其余放进 17 |
| `supportedVersions` 多版本并存 | v1 没有存量房间；同时评估多个版本需要保留旧代码 | 只保留 `scenarioVersion` 钉住，部署时版本不符就拒绝写入（B10），多版本迁移列为开放问题 |
| ESLint + dependency-cruiser 双工具 | 一个 `no-restricted-imports` 就能覆盖 SP-I13/I14 | 只保留 ESLint，C14 用它的结果 |
| 完整的 event_budget 骨架 | 价值在压力点表，代码本身引出了 r02、r17 | 保留压力点表与类型级草图，删掉条件审批变体 |
| `draftTermsSchema` + `buildTerms` + `enumerateFeasible` 三条 terms 来源 | 见 r01 | 收敛为"候选快照"一条 |
| `checkTradeoffAnswer`（两个骨架都是 `() => ok`） | 引擎已有"bump 即取消 open 请求"（versioned-approvals INV-H1）加回答时 `evaluateProposal` 复核 | 删掉，靠 r07 的快照复核 |

## 4. 对其他专题的要求（修订后）

- 05：模型只输出 `optionKey`；`request_tradeoff` 或引擎 `pareto_choice` 二选一（r01、r06）。
- 06：`evaluateProposal` 在来源失败时短路；插件调用包 try/catch；码名按 r14 统一（r04）。
- 07：masked 不返回原 checkId；人工请求的 blockers 走披露表；静态还是动态掩码由 07 拍板（r05、r14）。
- 08：维持"每个 role 一种 kind、userId 两两不同"，不支持同人多 kind（r02）。
- 09：目录进引擎投影、席位不进；`below_committed` 语义二选一；每日重新校验（r03、r08、r09、r10）。
- 14：rush 按整单还是逐条目、由日期推导；候选身份 candidateKey；should 项语义（r11、r12、B5）。
