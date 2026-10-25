# 反驳评审：确定性规则引擎 · part2（§3 问题清单、§4 修订顺序）

## 3. 问题清单

### r01（high，核心 5）执行幂等键按 (proposalId, constraintsVersion)，而不是 proposalId
- 证据：part1 §1.4 第 4 条、D10、§6 的 08 行都要求"`executions` 按 `(proposalId, constraintsVersion)` 唯一"。idempotent-execution 的 `deriveOperationId = exec:${proposalId}` 明确写"不含 constraintsVersion……至多执行一次"，versioned-approvals D12 也是这样。另外，versioned-approvals-part3 第 30 行规定执行后 `room.currentProposalId` 仍指向这个提案。
- 反例：v1 下已执行 → finance 上调预算（cv 变为 2）→ 三方在 v2 上重新 approve（如果 04 没有拦住）。按 `(pr, 2)` 查不到执行，`ALREADY_EXECUTED` 不会短路；`is_current` 通过；台账已经含本提案的金额，但预算上调后仍然 FITS，于是 ready → 生成第二张变更单和第二条承诺。
- 修复：`ReadinessInput.executionId` 改为"该 proposalId 的任何执行"，与 08 的 `operationId` 统一，删掉 cv 维度。再加一条测试：执行后 bump，然后重新审批，结果必须是 `already_executed`。

### r02（high，核心 4/9 流程）必需项不在目录时 findFeasibleOptions 崩溃
- 证据：`feasibility.ts:44-47` 的 `enumerate(base, pool, req)` 把必需键放进 `fixed`，然后 `candidateDates(keys.map(k => byKey.get(k)!))`。探针输出：`E15 CRASH: Cannot read properties of undefined (reading 'standardDeliveryDate')`。§4 E15 声称返回 `none + REQUIRED_ITEM_NOT_OFFERED`，但测试里没有这条用例。
- 后果：§3.6 规定约束变更与后续调度在同一事务里，所以 `budgets.update` 会抛错回滚，finance 无法改预算。
- 修复：入口先判断：任一必需键不 live，就直接返回 `{ kind: 'none', blockingUnion: ['REQUIRED_ITEM_NOT_OFFERED'] }`。把 E15 补进表驱动测试。

### r03（high，核心 1）投影通过 checkId 和"条目是否出现"泄露私密约束
- 证据（`probe1.ts`）：在 provider 视角、截止日未共享时，结果是 `[["delivery_by_deadline","PRIVATE_CONSTRAINT_UNMET",{}]]`，`checkId` 直接说出了是哪条约束。`includes_should_items` 和 `meets_preferred_date` 通过时出现在列表里，失败时被 `continue` 删掉（`projection.ts:37`），所以"缺了这一条"本身就泄露了客户的软偏好。`OVER_BUDGET` 和 `BUDGET_BELOW_COMMITTED` 只去掉了参数，provider 仍能看到 code。交付日由 provider 控制，几轮提案就能把截止日和首选日二分出来。P7 只查 code 和字符串，测不到这个问题。
- 修复：投影按**检查**判定所有者，而不是按 code。对非所有者，私密检查无论 pass 还是 fail 都从列表里去掉，失败的合并成一条 `{ checkId: 'private_constraint', code: 'PRIVATE_CONSTRAINT_UNMET' }`。预算码对 provider 是否可见交给 07 明确决定。新增一条非干扰性质测试：改变客户的 deadline / preferredDate 或 finance 的 cap 时，provider 投影除 `executable` 外必须逐字节不变。代理上下文同样只能用投影后的结果。

### r04（medium，核心 3/4）SOURCE_CHANGED 按 revision 比较，导致"续期"永远救不回提案
- 证据：`types.ts:8` 写"price/dates/validity 任何变化都会 +1"，`scope-change.ts:107` 发现 revision 不同就报 `SOURCE_CHANGED`。§3.2 和 E14 给 `ITEM_EXPIRED` 的后续动作是"请 provider 续期"，但续期会让 revision +1，提案随之报 `SOURCE_CHANGED`，只能新开提案。
- 修复：`pricingSnapshot.lines` 存影响结果的字段（priceCents、本单用到的标准日或加急日、加急费金额），比较这些字段，不比较 revision。`validUntil` 的变化不算来源变化；它是否递增 cv 由 09 决定。

### r05（medium）termsKey 有三种定义，且引擎实际依赖它
- 证据：本专题定义为 `JSON{v,scenario,itemKeys,deferredItemKeys,deliveryDate}`，不含金额。idempotent-execution 是 `${sortedKeys}|${cents}|${date}`，含金额、不含延后项。versioned-approvals D1 写"由 03 决定是否保留"。scenario-plugin 用的是含 `sourceRefs.revision` 的 `contentHash`。而 `decisionStates` 强制比较 `termsKey`（C12）。
- 修复：06 只保留一个 `termsKey` 定义，建议用本专题的 JSON 形式加上 `additionalCostCents`（来自不可变快照，便于人读作证据），并写进 03 的 `approvals` 必需字段。D11 的文字改为"必需绑定字段"，删去"纵深防御"的说法。

### r06（medium）与 scenario-plugin 的命名和所有权冲突
- reasonCode：scenario-plugin 是开放的 `string`，用正则校验（`contract.ts:8,15`）；本专题是封闭的 `as const` 枚举。同义的码名不同：`DATE_IN_PAST`/`DELIVERY_IN_PAST`、`DATE_AFTER_DEADLINE`/`AFTER_DEADLINE`、`DATE_BEFORE_LEAD_TIME`/`BEFORE_EARLIEST_DELIVERY`、`ITEM_BOTH_INCLUDED_AND_DEFERRED`/`ITEM_OVERLAP`。`DEFERRED_NOT_ALLOWED` 在本专题没有对应码，本专题也没有"延后了不可延后条目"的规则。versioned-approvals 的 `SOURCE_ITEM_WITHDRAWN` 也不在 `REASON_CODES` 里。
- 其他形状：checkId 一边是点分的 `scope.not_past`，一边是 snake_case。目录状态一边是 `draft|confirmed|withdrawn`，一边是 `confirmed|unconfirmed`。加急费一边按条目计（`rushItemKeys`、`attrs.rushFee{feeCents, leadTimeDays}`），一边是整单一次加每项 `rushDeliveryDate`。`PriceLine` 形状不同。预算字段有 `capCents`、`totalCents`、`totalBudgetCents` 三种叫法。函数名 `preflightFeasibility` 与 `findFeasibleOptions` 不同。scope_change 的规则有**两份实现**。
- 修复：06 的接口一节给出"概念 → 唯一名字 → 所有者"对照表；scope_change 规则只保留一份实现（建议本专题这份，因为它可运行、有测试），scenario-plugin 只定义契约。Q-R5（加急费按整单还是按条目）在 14 拍板。

### r07（medium）就绪判定有三份实现，语义不一致
- 证据：本专题 `evaluateExecutionReadiness`/`decisionStates`，idempotent-execution `evaluateApprovalSet`，versioned-approvals `isExecutable`。字段与语义的差异：`Decision.kind` 对 `decision`；`seq` 按房间递增对按 (proposalId, userId) 递增；必需审批人绑定**快照里的 userId**，而 versioned-approvals D7 要求"该角色**当前**成员"，换人后旧快照会让提案永远卡住；本专题没有 run 状态守卫（`pending_approval`），也没有审批种类 `terms|budget`。
- 修复：就绪判定归 08 一处实现；06 只提供 `evaluation.blocking` 和 reasonCode。删除 `engine.ts` 里的 readiness，或把它明确为 08 实现的参考。

### r08（medium，核心 3/4/8）"目录修改必递增"没有落点，且 rushFee 不是受控来源
- 证据：见 C13。`Catalog.rushFee` 只有 `{chargeKey, amountCents}`，没有 revision、status、simulated（`types.ts:16`），但它是金额来源；它变化时只能靠 `totalChanged` 间接触发 `SOURCE_CHANGED`，报出的 `itemKeys` 还是空的。
- 修复：要求 09 的目录 hardProjection 覆盖 `priceTerms`/`evaluate` 读到的全部字段（priceCents、standardDeliveryDate、rushDeliveryDate、status、validUntil、rushFee）。rushFee 做成和目录条目同级的受控条目，带 revision、status、simulated。`revision` 定义为"该 itemKey 的第几行"，与 versioned-approvals 的插新行模型对齐。

### r09（medium）query 里取今天的方式与时区退路
- 证据：C1、C2。`rooms.view` 是最热的订阅；在里面调 `Date.now()` 会降低缓存效果，而且跨午夜不保证刷新。`today-adapter.ts` 的 catch-all 会静默降级。
- 修复：query 不读时钟。改为由一个调度 mutation（每小时一次的 cron，或在房间本地午夜 `runAt`）写 `rooms.localDate`，query 读这个字段；mutation 里仍用 `Date.now()` 做权威重算。房间创建时校验 `timeZone`，非法就拒绝。先做 V1：如果 Intl 可用，删除 `fallbackUtcOffsetMinutes`（过度设计）；如果不可用，只存偏移，并写明夏令时限制。

### r10（low-medium）模型输出的日期 schema 放弃了解码约束
- 证据：C7。zod 4.6.7 的 `z.iso.date()` 会拒绝 `2026-02-30`、`2026-11-31`、`2026-02-29`，与 `isIsoDate` 只在 `0000-01-01` 上不同（`probe4.mjs`）。
- 修复：模型输出用 `z.iso.date().refine(isIsoDate)`，保住 `format: "date"`，`isIsoDate` 仍是最终裁决；同时删掉"SDK 降级格式"的说法。

### r11（low）Params 只读数组与 Convex validator 类型不兼容
- 修复：`Params` 改为 `Record<string, string | number | boolean | string[]>`，或在边界复制一份。

### r12（low）I5 依赖未验证的 OCC 区间冲突
- 修复：§3.6 改写为"依赖 inputs/04 待验证 #2"。把 §5.3 的真实部署并发脚本列为实现门槛；明确要求两条读取都走索引：decisions 按 proposalId，executions 按 proposalId（与 r01 一致）。

### r13（low，核心 8）取舍请求的内容不精确
- 证据：`suggestRelaxations` 每次都追加不带参数的 `confirm_offer`；E23 的 fixture 里所有条目都已确认，仍然会向 provider 发请求。`blockingUnion` 来自所有候选的并集，再加一个交付日取 today 的探针。在 E15b（必需项过期、cap 500000）中，它混进了 `BEFORE_EARLIEST_DELIVERY` 和 `OVER_BUDGET`（`probe1.ts`），但真实原因只有一个。
- 修复：只有当某个未确认或已过期条目一经确认就能让某个候选可执行时，才产出 `confirm_offer`，并带上 `itemKeys`。`blockingUnion` 改为"只含必需项的最小候选"的阻断码，去掉 today 探针。

### r14（low，过度设计/简化）两次穷举、两个上限
- 证据：`MAX_OPTIONAL_ITEMS=10` 数的是非必需条目，`MAX_RELAXATION_ITEMS=12` 数的是全部条目。11 个可选加 1 个必需时，`findFeasibleOptions` 返回 too_large，`suggestRelaxations` 却照常运行。两次枚举的池子还是包含关系。`suggestRelaxations` 求承诺总额时用的是裸 `reduce`，违反 D5"一切加法走 addCents"。`ScenarioRules.projection` 是 07 的职责。
- 修复：只做一次枚举，枚举超集并记录每个候选的 blocking，前沿和放宽建议都从这一次结果派生；只保留一个上限；承诺总额改用 `sumCents`；把 `projection` 从插件接口移到 07。

### r15（low）fixture 与 14 冲突
- 修复：14 回到 F14.2 第 1 套数字，或者本专题测试改为从 14 的 fixture 推导；无论哪种，都必须保留"标准交付恰等于余量"这个边界。

### r16（low，核心 8）模拟标记没有传到评估结果
- 证据：`BudgetInput.commitments` 丢掉了 `simulated`；`rushFee` 没有这个标记；`Pricing.lines` 和 `Evaluation` 都不带模拟来源。
- 修复：`PricingLine` 增加 `simulated`，`Evaluation` 增加 `simulatedSources: string[]`，界面据此标注。

### r17（low）小语义问题
- `not_evaluated` 的检查带 `code: 'OK'`，按 code 过滤的消费者会把它当成通过；建议改为 `code: null`。
- 有人拒绝时，同一参与方同时出现在 `APPROVAL_REJECTED` 和 `APPROVAL_PENDING` 里，因为 `engine.ts:140` 的列表包含 `rejected`；建议把它从那个列表中移除。

## 4. 建议的修订顺序

1. r01、r02、r03：直接违反核心，先改，并各补一条回归或性质测试。
2. r05、r06、r07、r08：与 03/08/09/14 对齐命名和所有权，由 06 产出术语对照表。
3. r04、r09、r10、r13：语义修正。
4. r11、r12、r14–r17：清理。
