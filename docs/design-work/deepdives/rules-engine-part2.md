# 专题深潜：确定性规则引擎 · part2（§2 续、§3 具体设计）

### D8 必需范围的语义：必需项必须包含；"延后"与"移除"区分；重复与交叠拒绝而非静默去重

- 客户简报只有三类：`requiredItemKeys`、`deferrableItemKeys`、其余目录条目（视为 should，希望要但可谈）。必需与否是客户的判断，放在简报上，目录只描述供给（F02.1 整理者注）。
- 提案条款 `deferredItemKeys` 是"显式延后到后续阶段"；未出现在 `itemKeys` 与 `deferredItemKeys` 中的条目是"本次不做"。`diffTerms` 据此输出 `items_deferred` 与 `items_removed`（RA-R14）。
- 必需项出现在 `deferredItemKeys` 里不能静默通过：报 `MISSING_REQUIRED_ITEM`，参数 `deferredItemKeys` 标出被延后的必需项，并走人工取舍（F06.2 第 2 条整理者建议）。
- `itemKeys` 内重复 → `DUPLICATE_ITEM`；同一键既包含又延后 → `ITEM_OVERLAP`。**不做静默去重**：条款要能规范化为唯一的 `termsKey`，模型给出的畸形输出应该被拒收并有界重试（10），而不是被代码"修好"后当成模型的意思。
- 必需项不在目录、未确认或已过期 → `REQUIRED_ITEM_NOT_OFFERED`（与提案无关的阻断，可行组合必为空，取舍选项是 `confirm_offer` 或 `defer_required`）。

### D9 可行组合由代码穷举，帕累托前沿决定"单一方案 / 需要取舍 / 无解"

- **决定**：`findFeasibleOptions(base)` 固定包含全部必需项，对其余已确认、未过期条目做子集穷举；每个子集只取两个候选交付日（最早标准日、最早加急日，均不早于 today），因为更晚的日期在任何维度都不会更好。每个候选用**同一个** `evaluateScopeChange` 判定，绝不另写一套可行性规则（RA-R12 新设计要求）。
- 支配关系：A 支配 B 当且仅当 A 不更贵、A 的非必需条目集合 ⊇ B 的、B 满足首选日则 A 也满足，且至少一项严格更好。前沿 0 个 → `NO_FEASIBLE_OPTION`；1 个 → `single`；≥2 个 → `NEEDS_TRADEOFF`。
- 上限：非必需条目 > `MAX_OPTIONAL_ITEMS = 10` 时返回 `SEARCH_SPACE_TOO_LARGE`，由 05/09 决定升级给人；不做贪心近似（近似会让"无解"判定不再可靠）。
- **否决**：Role A 的"条目最多再最便宜"——条目数不是价值，且忽略必需范围与截止日（RA-B12）；让模型判断可行性——违反核心 4。
- **不变量**：前沿中的每个选项重新评估都 `executable`；每个可行选项要么在前沿中，要么被前沿某项支配（属性测试 P4）。

### D10 执行就绪单独成函数，`ALREADY_EXECUTED` 先于一切检查

- `evaluateExecutionReadiness` 合并引擎级守卫（当前提案、termsKey 一致、必需审批人非空、不同 userId、全部为当前的 approve）与 `evaluateScopeChange` 的阻断码。
- 已存在 `(proposalId, constraintsVersion)` 的执行时立即返回 `{ kind: 'already_executed', executionId }`，不再算预算——执行后台账已包含本提案，先算预算会把重复请求误报为超预算（RA-R08 已验证的顺序）。
- 决定状态：每个必需参与方取其对本提案的**最后一条**决定（按 `seq`），与 `(constraintsVersion, termsKey)` 比较得出 `approved / rejected / stale_approve / stale_reject / withdrawn / pending`（RA-R04 新设计要求）。`decision.userId` 与快照里的 `userId` 不一致的决定被忽略。

### D11 审批绑定用规范化字符串 `termsKey`，不用加密哈希

- `canonicalTermsKey(terms) = JSON.stringify({ v: 1, scenario, itemKeys: sorted, deferredItemKeys: sorted, deliveryDate })`，同步、纯、跨运行时一致，长度受条目数上界约束（< 1 KB）。
- 提案只追加不可改（I1），所以 `(proposalId, constraintsVersion)` 已足以绑定；`termsKey` 是纵深防御（检测数据被意外 patch）与跨提案"条款是否相同"的判定。
- **否决**：SHA-256 contentHash——Web Crypto 是异步 API，Convex 默认运行时可用性未在 inputs/04 中核实，收益只是缩短一个本来就不长的字符串。

### D12 按角色投影是引擎的最后一步，在 query 内完成

- `projectEvaluation(evaluation, viewerRole, disclosure)` 在 `rooms.view` 返回前调用：预算类码对 provider 去掉参数、`amounts` 置 null；依赖客户私密约束的码（`AFTER_DEADLINE`、`DATE_CONFLICT`、`MISSING_REQUIRED_ITEM`、`REQUIRED_ITEM_NOT_OFFERED`）在客户未共享对应字段时，对他方映射为 `PRIVATE_CONSTRAINT_UNMET`；客户的软偏好码（`MISSES_PREFERRED_DATE`、`SHOULD_ITEM_EXCLUDED`）对他方不可见。最终矩阵以 07 为准（Role A §5.2 开放问题 Q3）。
- `executable` 对所有角色可见：provider 能由此推断"有约束未满足"，这是 F07.1 接受的最小披露。

## 3. 具体设计

### 3.1 模块与文件

| 文件（草案路径 → 建议落点） | 内容 |
| --- | --- |
| `rules-engine/codes.ts` → `engine/rules/codes.ts` | `REASON_CODES`、检查顺序、上限常量 |
| `rules-engine/primitives.ts` → `engine/rules/primitives.ts` | `isCents`、`addCents`、`sumCents`、`isIsoDate`、`maxDateOf`、`duplicatesOf`、`isNonEmptyKey` |
| `rules-engine/engine.ts` → `engine/rules/engine.ts` | `CheckResult`、`runChecks`（依赖传播）、`assemble`（排序与聚合）、`decisionStates`、`evaluateExecutionReadiness` |
| `rules-engine/projection.ts` → `engine/rules/projection.ts` | `projectEvaluation` |
| `rules-engine/types.ts`、`scope-change.ts`、`terms.ts`、`feasibility.ts` → `scenarios/scope-change/` | 场景类型、`priceTerms`、`evaluateScopeChange`、`canonicalTermsKey`、`diffTerms`、`findFeasibleOptions`、`suggestRelaxations` |
| `rules-engine/fixture.ts` → `scenarios/scope-change/fixture.ts` | F14.2 目录 1 的模拟数据（`simulated: true`） |
| `rules-engine/today-adapter.ts` → `convex/lib/today.ts` | `todayInTimeZone`，唯一接触时钟的地方，不属于引擎 |
| `rules-engine/rules.test.ts`、`rules.property.test.ts` | 表驱动 28 例 + 属性 7 组，`node --test` 全部通过；`tsc --strict --noUncheckedIndexedAccess --erasableSyntaxOnly` 零错误 |

### 3.2 reasonCode 全表

| code | 严重度 | 检查 | 触发条件（全部整数/字符串比较） | 参数 | 典型后续 |
| --- | --- | --- | --- | --- | --- |
| `CONSTRAINTS_INCOMPLETE` | block | constraints_present | 客户简报未确认或预算未设 | `missing[]` | 向缺失方请求 |
| `CONSTRAINT_INCONSISTENT` | block | constraints_consistent | 必需/可延后键重复或交叠、deadline 非法、preferredDate > deadline、cap 非法、台账求和越界、today 非法 | `problems[]` | 保存入口本应拦截；出现即 bug |
| `EMPTY_SCOPE` | block | terms_shape | `itemKeys.length === 0` | — | 拒收模型输出 |
| `DUPLICATE_ITEM` | block | terms_shape | 同一列表内重复 | `itemKeys[]` | 拒收 |
| `ITEM_OVERLAP` | block | terms_shape | 同一键既包含又延后 | `itemKeys[]` | 拒收 |
| `INVALID_DATE` | block | terms_shape | `deliveryDate` 不是真实日历日 | `field` | 拒收 |
| `UNKNOWN_ITEM` | block | items_known / terms_shape | 键不在本房间目录或不是合法键 | `itemKeys[]` | 拒收 |
| `UNCONFIRMED_ITEM` | block | items_confirmed | 包含了 `status !== 'confirmed'` 的条目 | `itemKeys[]` | 请 provider 确认 |
| `ITEM_EXPIRED` | block | items_current | `today > validUntil` | `itemKeys[]` | 请 provider 续期 |
| `REQUIRED_ITEM_NOT_OFFERED` | block | required_offered | 必需项不在目录/未确认/过期 | `itemKeys[]` | humanRequest：confirm_offer 或 defer_required |
| `MISSING_REQUIRED_ITEM` | block | required_included | `required ⊄ itemKeys` | `itemKeys[]`、`deferredItemKeys[]` | 重谈或请客户取舍 |
| `SHOULD_ITEM_EXCLUDED` | info | includes_should_items | 有 should 条目未包含 | `itemKeys[]` | 只给客户看 |
| `BEFORE_EARLIEST_DELIVERY` | block | pricing | 交付日早于所选条目最早可交付日（含加急） | `earliestDate` | 拒收或改日 |
| `AMOUNT_OUT_OF_RANGE` | block | pricing / budget | 求和超过 `MAX_CENTS` | — | 出现即 bug |
| `RUSH_FEE_APPLIED` | info | no_rush_fee | 交付日落在 `[rushMin, std)` | — | 模板说明加急费 |
| `SOURCE_CHANGED` | block | source_unchanged | 快照行的 revision/价格与当前目录不一致 | `itemKeys[]` | 需要新提案 |
| `DELIVERY_IN_PAST` | block | delivery_not_past | `deliveryDate < today` | `today` | 重谈 |
| `AFTER_DEADLINE` | block | delivery_by_deadline | `deliveryDate > deadline` | `deadline` | 重谈或 extend_deadline |
| `DATE_CONFLICT` | block | date_window | `max(today, 所选条目最早可交付日) > deadline`，任何日期都不行 | `windowStart`、`windowEnd` | 必须改范围或截止日 |
| `MISSES_PREFERRED_DATE` | info | meets_preferred_date | `deliveryDate > preferredDate` | — | 只给客户看 |
| `BUDGET_BELOW_COMMITTED` | block | budget_state | `cap < committed` | `belowByCents` | 只能 finance 处理 |
| `FITS_BUDGET` | (pass) | budget | `committed + additional <= cap` | — | 模板"在财务上限内" |
| `OVER_BUDGET` | block | budget | `committed + additional > cap` | `overByCents` | 重谈或 raise_cap |
| `ALREADY_EXECUTED` | 终态 | readiness 前置 | 已有执行 | `executionId`（返回值） | 幂等返回 |
| `NOT_CURRENT_PROPOSAL` | block | is_current | 不是 `rooms.currentProposalId` | — | 拒绝审批 |
| `TERMS_KEY_MISMATCH` | block | terms_key_matches | 存储的 termsKey ≠ 由存储条款重算 | — | 出现即 bug |
| `NO_REQUIRED_APPROVERS` | block | has_required_approvers | 快照为空 | — | 出现即 bug |
| `APPROVER_IDENTITY_CONFLICT` | block | distinct_approvers | 两个必需参与方是同一 userId | — | 阻断（I7） |
| `APPROVAL_REJECTED` | block | approvals_not_rejected | 有当前有效的拒绝 | `participantIds[]` | 重谈 |
| `APPROVAL_PENDING` | block | approvals_complete | 有未决、撤回或过期的决定 | `participantIds[]` | 等待 |
| `APPROVAL_STALE` | info | approvals_fresh | 有绑定旧约束版本或旧条款的决定 | `participantIds[]` | 界面提示"需要重新批准" |
| `NO_FEASIBLE_OPTION` | 结论 | findFeasibleOptions | 前沿为空 | `blockingUnion[]` | `suggestRelaxations` → humanRequest |
| `NEEDS_TRADEOFF` | 结论 | findFeasibleOptions | 前沿 ≥ 2 | `frontier` | 交给代理挑选或请客户取舍（05） |
| `SEARCH_SPACE_TOO_LARGE` | 结论 | findFeasibleOptions | 非必需条目 > 10 | `optionalCount` | 升级给人 |
| `PRIVATE_CONSTRAINT_UNMET` | 投影 | projectEvaluation | 他方私密约束未满足且未共享 | — | 模板"有一项对方约束未满足" |
| `OK` | (pass) | 其他检查通过 | — | — | — |

### 3.3 依赖图（决定哪些检查标 `not_evaluated`）

```text
constraints_present → constraints_consistent → {required_offered, required_included, delivery_*, date_window,
                                                 meets_preferred_date, budget_state, items_current, includes_should_items}
terms_shape → items_known → items_confirmed → {items_current, pricing, date_window}
pricing → {no_rush_fee, source_unchanged, budget};  budget_state → budget
```

规则：依赖未 `pass` 的检查记为 `not_evaluated`，不进入 `blocking`。因此"空范围"只报 `EMPTY_SCOPE`，不会连带 `MISSING_REQUIRED_ITEM`；"预算低于已承诺"只报 `BUDGET_BELOW_COMMITTED`，不连带 `OVER_BUDGET`。
