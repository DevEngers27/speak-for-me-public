# 反驳评审：场景插件接口 · part2（r04–r08）

> 接 scenario-plugin-review.md；下接 scenario-plugin-review-part3.md。

### r04【high】评估用当前目录给旧提案重新定价：误报 AMOUNT_MISMATCH，撤下后 query 崩溃
- 证据：part3 §3.6 的 `plugin.priceTerms(p.terms, ctx)` 用的 `ctx.catalog` 是"当前确认快照"（plugin.ts:101，不含已撤下条目）；scope-change.ts:102、104、144 都写的是 `ctx.catalog.get(k)!`。
- 场景一：REPORTS 从 $350 改为 $300。旧提案除了 `SOURCE_SUPERSEDED`，还会报 `AMOUNT_MISMATCH`，而 part3 §3.7 把后者定义为"代码缺陷信号，同时写运维计数"，这是误报。
- 场景二：provider 撤下 LOGIN。`get` 返回 undefined，`.revision` 抛出 TypeError（不是 `PluginContractError`），`rooms.view` 对全房间报错。
- SP-I4 自己写的是 `catalogAt(proposal.sourceRefs)`，与实现不一致；rules-engine-part2 第 70 行把同一情形定为业务码 `SOURCE_CHANGED`。
- 建议：`resolveSources` 一旦有失败就短路，跳过定价与插件检查，追加一条 `engine.amount { ok: false, reasonCode: "NOT_EVALUATED_SOURCE_CHANGED" }`；或者为旧提案按 `sourceRefs` 构造钉住版本的目录视图。所有插件调用都包在 try/catch 里，统一转成 `PLUGIN_CONTRACT_VIOLATION`，保证 query 永远不抛错。

### r05【high·核心 1】masked 检查泄露 checkId；通过的检查也显示"未满足"
- 证据：part3 第 77–79 行，masked 分支返回 `checkId: c.checkId`。对 provider 来说，`scope.deadline` 等于直接告诉它"customer 有截止日且没满足"，Q3 想要的最小披露就失效了。同一分支不判断 `c.ok`，通过的 masked 检查也会渲染成 "A Customer constraint is not met"。
- 相关泄露：`TradeoffRequestSpec.blockingReasonCodes` 是不带 ownerRole 的 `ReasonCode[]`；scope-change.ts:136 发给 provider 的 `Q_CHEAPER_ITEM` 直接放了 `enumeration.blockersSeen`，其中可能有 `DATE_AFTER_DEADLINE`。
- 建议：masked 时 `checkId` 改为不透明的 `masked:${ownerRole}:${i}`；通过的 masked 检查对他方直接省略。人工请求的 blockers 按 `spec.ownerRole` 走同一张披露表渲染。金丝雀测试 C10 扩展到 checkId 和人工请求 DTO。

### r06【medium】tradeoff 变体的期望在引擎流程里走不到
- 证据：part4 §4.1 的规则是"bump 后 `enumerateFeasible` 非空就开新 run，空才 `buildTradeoffRequests`"；`TradeoffInput.trigger` 只有 `no_feasible | rounds_exhausted | below_committed | proposal_rejected`。scope-change.ts:129 的 `candidates.length >= 2` 分支只有轮次用尽或被拒时才会进入。而 `tradeoff` 变体期望的是直接向 customer 发请求（F14.2"要日期还是要 B"）。part3 §3.6 的 `SEARCH_INCOMPLETE` 在 trigger 枚举里也不存在。
- 建议：增加 trigger `pareto_choice`（bump 后出现 ≥2 个互不支配的候选时，由引擎调用）和 `search_incomplete`；或者明确交给 05 的 `request_tradeoff` 动作。两者择一，写进 05/09。

### r07【medium】`choose_candidate.candidateIndex` 在回答时重新计算，人选的不是人看到的
- 证据：contract.ts:119 的 `{ target: "choose_candidate"; candidateIndex }`。候选日期等于 `today + leadTime`，跨天以后重新枚举，同一个下标就对应不同的 `deliveryDate`。negotiation-protocol-part4 第 17 行已经要求"from a snapshot, never recomputed"。
- 建议：把候选的 `terms` 和 `price` 快照进 option，回答时用 `evaluateProposal` 复核；复核失败就拒绝并重新生成请求。

### r08【medium】时间驱动的不可行没有任何触发；"永远实时"说过头了
- 证据：`today` 不进投影（part2 §3.5 最后一条）。按最早日期提出的候选（例如 LOGIN+REPORTS+rush，交付日 today+5），第二天 `earliest` 变成 today+6，就会报 `DATE_BEFORE_LEAD_TIME`。可是没有任何写入会让 run 离开 `pending_approval`，房间会一直停在"等审批但不可执行"的状态。另外 `CVX:server/meta.ts:173-174` 说明 query 里调用 `Date.now()` 会限制缓存，而订阅的重算是由写入驱动的（跨天是否推送：待验证），所以 SP-I6"永远实时计算"在 query 里并不成立。
- 建议：(a) 引擎在房间时区的每日零点用 `runAt` 调度 `internal.rooms.revalidate`（exactly-once 的 mutation）：当前提案不再可执行时，迁移 run 并发起人工请求；(b) `enumerateFeasible` 选日期时留一天以上余量，或按"执行日"重新定义交付日；(c) 界面写成 "Checked as of {time}"。
