# 06 · 确定性规则引擎与场景插件接口（part4：旧大写码 → 新码对照表）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§6.4。来源缩写：RE = deepdives/rules-engine `codes.ts`；SEC = candidates/security/06；PLG = candidates2/plugin/06；SP = deepdives/scenario-plugin；PR = spikes/protocol-rules `reasonCodes.ts`；PC = spikes/privacy-canary；FW = deepdives/fixtures-walkthrough；NP = deepdives/negotiation-protocol；其他 = canon、inputs/07、草稿中出现的码。迁移规则：实现中**不得**出现左列任何字面量（lint 正则 `\b[A-Z][A-Z0-9]+(_[A-Z0-9]+)+\b` 扫 `core/`、`convex/` 的字符串字面量，白名单只有环境变量名）。

### 6.4 对照表

| 旧码 | 来源 | 新码 / 处置 | 说明 |
| --- | --- | --- | --- |
| `OK`、`FITS_BUDGET`、`budget.within` | RE、PR | 删除：检查 `status: 'pass'`，`code: null` | r17：`code: 'OK'` 会被误读为通过 |
| `CONSTRAINTS_INCOMPLETE` | RE | 不是规则码；`runs.start` 守卫返回 `run.invalid_state` | 三份简报未确认时 run 不会开始 |
| `CONSTRAINT_INCONSISTENT` | RE | 写入口逐字段码（`date.invalid`、`item.duplicate`、`amount.out_of_range`）；规则内出现即 `internal` | 已确认数据不可能不一致 |
| `EMPTY_SCOPE`、`scope.empty` | RE、PR | `item.unknown`（`itemKeys: []`） | 条款只由代码物化，出现即缺陷 |
| `DUPLICATE_ITEM`、`scope.duplicate_item` | RE、PR | `item.duplicate` | |
| `ITEM_OVERLAP`、`OVERLAPPING_ITEMS`、`ITEM_BOTH_INCLUDED_AND_DEFERRED` | RE、PC、SP | 删除 | 无 `deferredItemKeys`（D11） |
| `UNKNOWN_ITEM`、`scope.unknown_item`、`engine.catalog_unknown` | RE、SEC、PC、PR、PLG | `item.unknown` | |
| `UNCONFIRMED_ITEM`、`ITEM_NOT_CONFIRMED`、`source.unconfirmed` | RE、SP、PR | 写入口 `item.unconfirmed`；规则中草稿行不进 `RuleInput`，故为 `item.unknown` | |
| `withdrawn` 状态相关、`SOURCE_ITEM_WITHDRAWN` | PR、versioned-approvals | `item.retired` | 目录状态 `retired` |
| `ITEM_EXPIRED` | RE、SP | 删除（v1 无报价有效期，D26）；17 引入时新增 `item.expired` | |
| `INVALID_DATE`、`date.invalid_format` | RE、PC、PR | `date.invalid` | |
| `AMOUNT_OUT_OF_RANGE`、`budget.invalid_amount`、`amount.invalid_cents`、`BAD_CENTS` | RE、PR、SP | `amount.out_of_range` | |
| `SOURCE_CHANGED`、`CATALOG_STALE`、`STALE_CATALOG`、`SOURCE_SUPERSEDED`、`engine.content_drift`、`source.catalog_version_mismatch` | RE、SEC、其他、SP、PLG、PR | `version.stale_source` | 按 `lines[].revision` 比较，标题改动不触发（INV-R8） |
| `AMOUNT_MISMATCH` | SP | `amount.claim_mismatch` | 快照金额 vs Σ lines，不按当前目录重定价（r04） |
| `TERMS_KEY_MISMATCH`、`version.content_hash_mismatch`、`CONTENT_CHANGED`（审批侧） | RE、PR、草稿 | 完整性失败 → `internal`；审批的 `expectedTermsKey` 不符 → `approval.stale` | |
| `REQUIRED_ITEM_NOT_OFFERED` | RE | `item.required_missing`（checkId `required_offered`，`reason: 'not_offered'`） | 不崩溃（r02） |
| `MISSING_REQUIRED_ITEM`、`scope.required_missing`、`sc.required_missing` | RE、SEC、PR、PLG | `item.required_missing`（checkId `required_included`） | |
| `SHOULD_ITEM_EXCLUDED`、`ITEM_NOT_REQUESTED`、`DEFERRED_MISMATCH`、`DEFERRED_NOT_ALLOWED` | RE、SEC、SP | 删除 | customer 视图现算"未纳入条目"，不是检查（D11） |
| `BEFORE_EARLIEST_DELIVERY`、`DATE_BEFORE_LEAD_TIME`、`date.before_earliest` | RE、SP、PR | `date.before_lead_time` | 只在 `choose_candidate` 回答时出现 |
| `DELIVERY_IN_PAST`、`DATE_IN_PAST` | RE、SEC、SP | `date.in_past` | |
| `AFTER_DEADLINE`、`DATE_AFTER_DEADLINE`、`date.after_deadline` | RE、SEC、SP、PR | `date.after_deadline` | |
| `DATE_CONFLICT` | RE、FW | `date.after_deadline` | 交付日由代码物化，窗口冲突即该候选超期；放松走 `extend_deadline` |
| `DATE_OUT_OF_RANGE` | PC | `date.out_of_range` | |
| `DATE_MISMATCH` | inputs/07 引用 | 删除 | 绝对日期不重算（D22） |
| `MISSES_PREFERRED_DATE`、`PREFERRED_AFTER_DEADLINE` | RE、FW | 删除 | v1 无 `preferredDate`；软偏好不进规则 |
| `RUSH_FEE_APPLIED`、`DELIVERY_OPTION_UNAVAILABLE` | RE、SEC | 删除 / `item.unknown`（引用不存在的 modifier） | 加急是条款中显式的 modifier 行（D25） |
| `NOT_DELIVERABLE` | FW | 删除 | v1 无 provider 私密产能表；provider 硬字段只有目录（D05） |
| `BELOW_PROVIDER_MINIMUM` | SEC | 删除 | 同上 |
| `BUDGET_BELOW_COMMITTED`、`budget.total_below_committed` | RE、PR | `budget.below_committed` | 写入口拒绝，规则中只作防御（D23） |
| `OVER_BUDGET`、`ledger.over_cap`、`budget.over` | RE、SEC、PLG、PR、PC | `budget.over` | |
| `ledger.account_unknown` | PLG | 删除 | 一房一账本 |
| `CONSTRAINTS_STALE`、`CONSTRAINTS_CHANGED` | SP、FW | `version.stale_constraints` | |
| `NOT_CURRENT_PROPOSAL` | RE、SP | `approval.not_current` | |
| `ALREADY_EXECUTED` | RE | `approval.already_executed` | |
| `NO_REQUIRED_APPROVERS` | RE、SP | `internal` | `requiredApprovals` 由 `roles` 派生，空即缺陷 |
| `APPROVER_IDENTITY_CONFLICT` | RE | `approval.self_conflict` | |
| `APPROVAL_PENDING`、`approval.missing` | RE、PR | `approval.missing_role` | |
| `APPROVAL_STALE` | RE | `approval.stale` | |
| `APPROVAL_REJECTED`、`approval.rejected` | RE、PR | 删除：提案状态 `rejected`；对其 approve → `approval.not_current` | reject 终局（D02） |
| `PROPOSAL_BLOCKED`、`NOT_EXECUTABLE` | SEC、草稿 | `approval.not_executable` | |
| `NOTHING_TO_WITHDRAW` | 00-invariants 草稿 | 不是码：返回 `unchanged`（08 S10、12 §12.25 Q10） | 没有可撤回的当前 approve；不设 `approval.nothing_to_withdraw` |
| `TOO_MANY_DECISIONS` | 草稿 | 删除 | D02 否决全局上限 |
| `INVALID_STATE`、`RUN_NOT_AWAITING_APPROVAL` | 草稿 | `run.invalid_state` | |
| `NO_FEASIBLE_OPTION` | RE | 不是码：`humanRequests.kind = 'infeasible'` | |
| `NEEDS_TRADEOFF` | RE、FW | 删除；模型 `escalate { kind: 'needs_tradeoff' }` 经策略检查 → `kind: 'agent_escalated'` | |
| `ROUNDS_EXHAUSTED`、`ROUND_LIMIT` | SP、NP | 不是码：`humanRequests.kind = 'rounds_exhausted'` | |
| `SEARCH_SPACE_TOO_LARGE`、`SEARCH_INCOMPLETE` | RE、SP | 删除：在架 item ≤ 12、modifier ≤ 2 保证穷举；超限在写入口 `item.limit_exceeded` | |
| `CATALOG_FULL` | SP | `item.limit_exceeded` | |
| `PRIVATE_CONSTRAINT_UNMET`、`CONSTRAINT_UNMET` | RE、SP | `private.constraint_unmet` | 无 checkId、无参数（D11） |
| `PLUGIN_CONTRACT_VIOLATION`、`RESERVED_CHECK_ID`、`engine.selection_invalid`、`engine.derive_failed`、`SCENARIO_UNAVAILABLE` | SP、PLG | `internal`（opsLog `plugin_contract`） | 插件契约错误是代码缺陷 |
| `FIELD_NOT_SHAREABLE` | SP | `disclosure.blocked` | |
| `DISCLOSURE_BLOCKED`、`NEEDS_OWN_DISCLOSURE_CONFIRMATION` | PC | `disclosure.blocked`、`disclosure.needs_own_confirmation` | |
| `OUTPUT_NOT_JSON`、`OUTPUT_SCHEMA_VIOLATION`、`MISSING_TERMS`、`OUTPUT_TRUNCATED` | PC、NP | `output.not_json`、`output.schema_violation`、`output.schema_violation`、`output.truncated` | |
| `ACTION_NOT_ALLOWED_FOR_ROLE` | PC | `action.not_allowed_for_role` | |
| `OPTION_NOT_IN_SNAPSHOT` | NP | `action.option_not_in_snapshot` | |
| `SEMANTIC_*`、`TRANSPORT_*` | NP | `output.unknown_reference` / `action.*`；传输错误不是码，记 `attempts.status = 'error'` | |
| `CALL_LIMIT` | NP | `run.call_limit` | |
| `CAPACITY_CONFLICT` | NP | 不是码：模型 `reject { reasonKey: 'cannot_deliver' }` | `reasonKey` 是场景声明的封闭枚举 |
| `QUANTITY_STALE`、`EXCLUSIVE_GROUP_CONFLICT`、`CAPACITY_EXCEEDED`、`eb.*` | SP、PLG（第二场景草图） | 不进 v1；17 的契约测试场景自行声明 | |

对照表本身进入 16 的迁移测试：表左列每个字面量在仓库内零出现；右列每个新码在 `REASON_CODES` 中存在，或明确标"删除 / 不是码"。
