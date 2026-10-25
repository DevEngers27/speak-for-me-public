# 反驳评审：版本化审批与约束失效（versioned-approvals）

> 评审对象：deepdives/versioned-approvals.md、-part2..part5.md、versioned-approvals/{schema,standing,constraints,decide}.ts。
> 对照：00-brief §3（核心 3/4/5/6）、inputs/04（part1 §1.3/§1.5，part2 §1.6/§1.7/§1.9/§1.12）、node_modules/convex 1.48 源码、兄弟专题 idempotent-execution、run-lifecycle、rules-engine（06）当前版本。
> 分片：本文件（总评、待验证声明逐条核对）→ versioned-approvals-review-part2.md（问题清单 r01–r15、冲突裁决建议）。

## 0. 总评

主干决定站得住：审批只追加 + 绑定 (proposalId, constraintsVersion)（D1/D2）、approve 带 `expectedConstraintsVersion` 做比较并设置（D3）、`isExecutable` 不入库、不比较提案的创建时版本（D7）、提案仍合规时保留 run 和提案（D6，满足回归 6 / RA-R11）、回合守卫改看回合快照的版本（D8），这些都与核心 3/5/6 一致，也已被 idempotent-execution 吸收。

最大的漏洞在 D4/D5 的"硬投影"：本稿声称"规则读到的东西变了 ⇔ 版本变了"，但它写的 `HardProjection` 与 06 的真实输入（`ScopeChangeInput`）对不上。06 读目录条目的 `revision / standardDeliveryDate / rushDeliveryDate / validUntil / status`、`rushFee`，还读 `today`，这些本稿的投影都没有。结果是可以构造出"规则结论变了、版本不变、run 卡在 pending_approval"的反例（r01、r02）。第二个问题是回合守卫 INV-T1 漏掉了回合本身的状态与 attempt 身份，和 run-lifecycle 的并行 step、重试机制合起来会重复落库（r03）。第三，part5 列的兄弟冲突已经过时：idempotent-execution 已改用 `exec:${proposalId}` 和 `createdAtConstraintsVersion`；还没解决的冲突是 `proposal.runId` 守卫、06 的 `(proposalId, constraintsVersion)` 执行键与 userId 快照、三份重复的审批集合判定、run-lifecycle 的命名与"总是取代 run"（r04、r05、r09）。

## 1. 待验证声明逐条核对

"源码"指本地 node_modules/convex/src 中的源码或注释；"文档"指 inputs/04 引用的 README 或文档；"未证"指本地没有证据。

| # | 声明 | 结论 | 证据 | 对设计的影响 |
| --- | --- | --- | --- | --- |
| V1 | mutation 内读到本事务先前的写入（read-your-writes） | **基本成立，仍待验证** | 间接证据：`server/database.ts:380-384` 写明"在写入它的 mutation 内读回 commitTs 字段得到的是占位符"，说明同事务可以读回自己写的文档。"索引区间查询能看到本事务刚插入的行"在本地没有明文 | `withConstraintChange` 的 after 投影依赖它。建议实现首周在真实 dev 部署上用 30 行探针确认（insert 后 withIndex 查询），不要只靠 convex-test |
| V2 | 读写同一文档的两个 mutation 被 OCC 串行化，后提交者自动重试 | **成立（源码）；重试上限未证** | `cli/insights.ts:12-17` 有 `occRetried` / `occFailedPermanently` 两种 insight；`cli/lib/mcp/tools/insights.ts:101-117` 写明永久 OCC 失败会让函数执行失败（severity error） | 永久失败会以普通的 mutation 失败返回客户端，UI 需要通用重试提示；热点 `rooms` 文档要避免无谓写入 |
| V3 | 索引区间读进入读集，与区间内的并发插入冲突 | **有源码注释支持（比 inputs/04 的"文档推论"强），并发行为仍需实测** | `server/meta.ts:168-171`："按 commitTs 索引读时用 snapshotTs 作上界，可以避免与并发插入冲突"，反过来说明不加上界就会冲突；`server/registration.ts:1250-1254`：只追加表上"唯一的读冲突来自并发追加" | INV-A5（seq 唯一）、G8 去重成立的前提。decide 不写 room，seq 唯一完全靠这一条，必须进 16 的真实部署并发测试（part4 #30 应补"同一用户并发两次 approve → 只有一行"） |
| V4 | 索引末尾自动追加 `_creationTime` 作平局字段；`_creationTime` 是墙钟，不保证提交顺序 | **成立（源码）** | `server/system_fields.ts:56-61`（`IndexTiebreakerField = "_creationTime"`）；`server/schema.ts` 中 `index()` 的返回类型把它追加到字段末尾；`server/meta.ts:176-178` 说明 `_creationTime` / `Date.now()` 用墙钟、不保证遵循提交顺序 | D2 用显式 seq 是对的 |
| V5 | `scheduler.cancel` 不能中止在途 action；对已完成的函数调用会抛错 | **成立（源码）** | `server/scheduler.ts:141-160` | "尽力 cancel"必须包 try/catch 或先查 `_scheduled_functions` 状态；正确性仍靠持久化守卫 |
| V6 | 被调度的 action 至多执行一次、不重试，所以不需要 lease，(runId, turnSeq, cv) 守卫就够 | **前半句成立，推论不成立** | `server/scheduler.ts:37-40` 确认 at-most-once。但 run-lifecycle 有 watchdog 超时、`retryTurn` 新建 attempt（同一 turnSeq）和并行 slot（同一 turnSeq 多个角色），在途 action 又取消不掉（V5） | 见 r03：守卫必须包含回合行本身的状态（run-lifecycle 的 G0 `turn.status === 'running'`），否则超时后迟到的结果会和重试结果各落库一次 |
| V7 | `identity.tokenIdentifier` 全局唯一且稳定 | **成立（源码），有前提** | `server/authentication.ts` 中 `UserIdentity.tokenIdentifier` 的注释："A stable and globally unique string … JWT claims: sub + iss" | 它包含 issuer，所以 Clerk 实例换域名（dev 换到 prod）就会变。另外它和兄弟专题用的 `v.id("users")` 冲突，见 r08 |
| V8 | returns validator 对 `v.object` 会拒绝多余字段 | **本地无法验证** | 返回值校验在后端执行；`server/impl/registration_impl.ts:185-194` 只把 validator 序列化后导出 | 维持"待验证"。按已证事实，防泄露应靠显式构造返回对象（白名单），returns validator 只作第二道防线 |
| V9 | `ConvexError` 的 data 能把结构化的 `{ code, currentConstraintsVersion }` 带到客户端 | **成立（客户端源码）** | `browser/sync/client.ts:883-889`（`errorData !== undefined` 时构造 ConvexError）；`browser/logging.ts:168-173`（`forwardData` 把 `error.data` 设为 `result.errorData`）；`values/errors.ts` 中 data 的类型为 `Value` | G6 的刷新提示可行。注意 data 会原样到达浏览器，`PROPOSAL_INVALID` 的 reasonCodes 必须先按角色过滤（本稿已这样做） |
| V10 | 复合索引前缀 + `order("desc").first()` 按剩余字段（seq）倒序 | **成立（与 inputs/04 §1.9 一致），本地源码没有明文** | `server/query.ts:170-176` 只说明 asc/desc；inputs/04 §1.9："排序只能按所用索引的字段（加 `_creationTime`）" | 风险低；part4 #1 的单测已覆盖 |
| V11 | mutation 中可以用 `Date.now()` | **可用，影响小** | `server/meta.ts:174` 把 `Date.now()` 与缓存语义并列提及；兄弟专题的代码也普遍在 mutation 中使用 | 06 的 `today` 由 `Date.now()` 推导，它不只影响时间戳，还影响规则结论，见 r02 |
| V12 | 首个场景每个角色恰好一人、一人不占多个角色（acceptInvite 守卫保证） | **设计要求成立，保证尚未落地** | inputs/02 F02.6："首个场景每个角色一人；一人不能占多个角色"；acceptInvite 由 07 负责，目前没有代码 | `summarizeApprovals` 用 `members.find` 取第一个持有人，数据异常时结果不确定；idempotent-execution 遇到 `holders.length !== 1` 会拒绝算齐，见 r13 |
| A1 | 06 的 `evaluateProposal` 与 `hardProjection` 共用 `loadConstraintInputs`，并能报 `SOURCE_PRICE_CHANGED` / `SOURCE_ITEM_WITHDRAWN` | **不成立** | 06 没有 `loadConstraintInputs`，输入类型是 `ScopeChangeInput { today, catalog, customer, budget, terms, pricingSnapshot }`（rules-engine/types.ts:32-39）；它只有一个 `SOURCE_CHANGED`（按 revision 与价格逐行比对，rules-engine.md:76、codes.ts）；目录条目的 status 只有 `confirmed / unconfirmed`，没有"撤回"概念 | r01、r09 |
| A2 | v1 一房一预算、每房至多一个活动 run，承诺台账只在当前提案执行时变化 | **在 v1 范围内成立** | inputs/03 Q2 仍是开放问题；run-lifecycle-part2 由 `startRunInternal` 单一入口加 OCC 保证"每房至多一个活跃 run" | D9 在 v1 成立；共享预算时必须重做（本稿已列为 O4） |
| A3 | 兄弟冲突：idempotent-execution D5 用 `exec:${proposalId}:${constraintsVersion}`，守卫含 `proposal.constraintsVersion === room.constraintsVersion` | **已过时** | idempotent-execution.md:55 已改为 `exec:${proposalId}`，并写明"与 versioned-approvals D12 一致"；:77-80 已采纳 `createdAtConstraintsVersion` 和"不比较创建时版本" | 真正剩下的冲突见 r04（`proposal.runId` 守卫、06 的执行键、userId 快照、重复的判定函数） |
| A4 | 兄弟冲突：run-lifecycle G3 比较 `run.constraintsVersionAtStart`，并假设 bumpConstraints 总是在同一事务里取代 run | **冲突属实** | run-lifecycle.md:77（G3）；run-lifecycle-part2.md:42、:115（bump 总是走 supersedeRun + startRunInternal） | 按 D6/D8 裁决，但字面量与签名以 run-lifecycle 为准，见 r05 |
