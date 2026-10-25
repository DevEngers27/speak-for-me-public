# 06 · 确定性规则引擎与场景插件接口（part3：reasonCode 全表、派生与参数受众）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§6.1 全表、§6.2 从单一数组派生 validator / Zod / 模板表、§6.3 参数受众。旧码对照表在 part4 §6.4。

## 6. reasonCode

### 6.1 全表（`core/engine/reasonCodes.ts` 的全部成员）

所有者一栏只用于理解；**掩码依据是检查的所有者（§8），不是码**。`internal` 不是 reasonCode，属于 12 的错误命名空间（代码缺陷、完整性断言失败、插件契约违反）。provider 永远不收到任何**规则检查结果**（提案检查、`approval.not_executable`）的 `params`（D12 ①）；§6.3 的 `'caller'` 类参数只描述调用者自己的输入或配额（如标题被拒的 `field`、`retryAfterMs`），provider 作为调用者照收。

| code | 产生者 | 典型所有者 | params（受众，见 §6.3） | 典型后续 |
| --- | --- | --- | --- | --- |
| `output.not_json` | 10 `agents.runAttempt` 解析 | 本方 attempt | — | 重试一次 → `invalid_output` |
| `output.schema_violation` | 10 `safeParse` | 本方 | issue 路径只进 opsLog | 重试一次 |
| `output.truncated` | `stop_reason: max_tokens` | 本方 | — | 重试一次 |
| `output.refusal` | `stop_reason: refusal` | 本方 | — | attempt `refused`，不重试 |
| `output.unknown_reference` | 05 语义校验：引用未见过的 `proposalVersion` / `topicKey` / `reasonKey` / `toRole` | 本方 | `field`（本方） | 重试一次 |
| `action.not_allowed_for_role` | 05 `allowedActions(role, turnKind, n)` | 本方 | `action`（本方） | 重试一次 |
| `action.option_not_in_snapshot` | `turns.complete` 在 `turn.candidateSnapshot` 内解析失败 | 本方 | — | 重试一次 |
| `action.repeats_blocked` | `optionKey` 解析到 `excludedCandidateKeys(run)` 中的键（快照已剔除，出现即防御性断言，05） | 本方 | — | 重试一次 |
| `item.unknown` | E1（空范围）、E2；写入口 | 无（目录公开） | `itemKeys`（room） | 拒收 / 阻断 |
| `item.unconfirmed` | 写入口：引用只在草稿里出现的键 | 无 | `itemKeys`（写入者） | 等 provider 确认 |
| `item.retired` | E3 | 无 | `itemKeys`（room） | 已 bump，新 run 重谈 |
| `item.required_missing` | S1 `required_offered`（`reason: 'not_offered'`）、S2 `required_included`（`'not_included'`） | customer | `itemKeys`、`reason`（ifDisclosed `requiredItemKeys`） | `drop_items` 或重谈 |
| `item.duplicate` | E1；写入口（列表重复、对已有 itemKey 改 kind；后续房间里重新上架旧执行已交付的 itemKey，12 §12.12 ④、canon D04） | 无 | `itemKeys` | 拒绝 |
| `item.limit_exceeded` | `catalog.confirm`：在架 item 超过 12 个或 modifier 超过 2 个（**新增**，canon §1.5 未列） | 无 | `limit`（写入者） | 拒绝 |
| `date.invalid` | E1；写入口 | 无 | `field` | 拒绝 |
| `date.in_past` | E6 `deliveryDate < localDate`；写入口（截止日早于 localDate） | 无 | `localDate`（room） | clock bump 后重谈 |
| `date.after_deadline` | S3 | customer | `deadline`、`daysLate`（ifDisclosed `deadline`） | `extend_deadline` 或重谈 |
| `date.before_lead_time` | `humanRequests.answer`：`choose_candidate` 显示的交付日已早于 `localDate + effectiveLeadDays` | 无 | `earliestDate`（toRole） | 重新生成请求 |
| `date.out_of_range` | E6 `deliveryDate > localDate + 365`；写入口窗口、`leadDays` 越界 | 无 | `field`、`min`、`max` | 拒绝 |
| `budget.over` | B2 `committed + amount > cap` | finance | `overByCents`、`headroomCents`（ifDisclosed `headroomCents`） | 重谈 / `raise_cap` |
| `budget.below_committed` | B1（纵深防御，正常不可达）；`budget.setCap`、finance `briefs.confirm`（D23） | finance | `belowByCents` / `minAllowedCapCents`（owner） | 写入拒绝，不 bump、不写事件 |
| `amount.claim_mismatch` | E5：快照 `amountCents ≠ Σ lines.priceCents`，或 `lines` 与条款键不一致 | 无 | — | 缺陷信号，opsLog `rule_integrity` |
| `amount.out_of_range` | E1、E5、B2 求和越界；写入口 | 无 | `field` | 拒绝 |
| `version.stale_constraints` | `isExecutable` 守卫（`proposal.status === 'stale'`）；回合守卫 G3 判 attempt stale 的原因 | 无 | `checkedAgainst`（cv，room） | 新 run（D06） |
| `version.stale_source` | E4：`lines[].revision ≠` 当前行 | 无 | `itemKeys`（room） | 新提案 |
| `approval.stale` | `approvals.record` 的 `expected*` 不符；审批有效性显示（08） | 无 | `currentConstraintsVersion`（room；08 A12、12 §12.15 ⑦） | 刷新后按新版本重批 |
| `approval.missing_role` | `evaluateApprovalSet`（08） | 无 | `roles`（room） | 等待 |
| `approval.self_conflict` | `evaluateApprovalSet` / `approvals.record`（D24 第二道防线） | 无 | — | 阻断 |
| `approval.not_current` | `isExecutable` 守卫；`approvals.record` | 无 | — | 拒绝 |
| `approval.already_executed` | `approvals.record`（reject / withdraw 对已执行提案）、`isExecutable` | 无 | — | 拒绝；重复 approve 不报此码，而是成功返回 `{ status: 'executed', executionId, alreadyExecuted: true }`（12 §12.15 ②） |
| `approval.not_executable` | `approvals.record` 的 approve 前 `isExecutable`（= 当前性 ∧ `passesChecks`，08 §8.4.2）不通过（D02 使用；canon §1.5 的 `approval.*` 列表尚未列出，见 §15 第 1 条） | 无 | `reasonCodes`（逐码经 §8 投影：customer 得其可精确看见的码或掩码 `private.constraint_unmet`，provider 不收；参数名与 08 A12、12 §12.15 ⑨ 一致） | 不写行 |
| `disclosure.blocked` | `sharedFacts.add` 闸门；目录标题的定界词检查（§4；格式 / 长度问题是 `input.invalid`） | 写入者 | `field`（写入者） | 拒绝 |
| `disclosure.needs_own_confirmation` | `sharedFacts.add`：内容只含写入者本人的秘密 | 写入者 | `field`（写入者） | 本人确认后放行 |
| `run.call_limit` | 10：`runs.maxAttempts` 或美元预留用尽 | — | — | `needs_input` |
| `run.draining` | `opsFlags.draining` | — | — | 不新建 attempt |
| `run.invalid_state` | 04 状态守卫；`room.status === 'executed'` 后任何写入（D04） | — | — | 拒绝 |
| `run.rate_limited` | D12 ⑥ 约束变更类写入节流、`price_writes` 桶、每房间每日 run 数上限、每人每提案 approve 行上限（12 §12.2 B7） | 调用者 | `retryAfterMs`（调用者，12 §12.4） | 拒绝 |
| `private.constraint_unmet` | 只由 07 §7.11 的 `projectChecks` 产生（§8） | — | 无 | 显示"有一项他方的约束未满足" |

`budget.fits` 不是码：D27 文中的"budget.fits"指 B2 检查 `status: 'pass'`。

### 6.2 从单一数组派生

```ts
// core/engine/reasonCodes.ts —— 用 foundation errors-result 的 defineReasonCodes 承载参数类型与受众
export const REASON_CODES = [
  'output.not_json', 'output.schema_violation', 'output.truncated', 'output.refusal', 'output.unknown_reference',
  'action.not_allowed_for_role', 'action.option_not_in_snapshot', 'action.repeats_blocked',
  'item.unknown', 'item.unconfirmed', 'item.retired', 'item.required_missing', 'item.duplicate', 'item.limit_exceeded',
  'date.invalid', 'date.in_past', 'date.after_deadline', 'date.before_lead_time', 'date.out_of_range',
  'budget.over', 'budget.below_committed', 'amount.claim_mismatch', 'amount.out_of_range',
  'version.stale_constraints', 'version.stale_source',
  'approval.stale', 'approval.missing_role', 'approval.self_conflict', 'approval.not_current',
  'approval.already_executed', 'approval.not_executable',
  'disclosure.blocked', 'disclosure.needs_own_confirmation',
  'run.call_limit', 'run.draining', 'run.invalid_state', 'run.rate_limited',
  'private.constraint_unmet',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type Params = Record<string, string | number | boolean | string[]>;   // 可变数组，避免与 validator 推断冲突（r11）

// 同一文件、同一 validator 派生：API 层的码（集合与语义以 12 §12.4 为准，共 13 个；不进 PARAM_AUDIENCE 之外的任何投影）。
// 不设：invite.expired / invite.email_mismatch（折叠进 invite.invalid，防探测）、approval.nothing_to_withdraw（返回 unchanged）、
// approval.invalid_reason（input.invalid { field: 'reasonKey' }）——12 §12.4 与 §12.25 Q10 / Q20
export const API_ERROR_CODES = [
  'auth.unauthenticated', 'auth.user_not_provisioned', 'auth.not_member', 'auth.role_forbidden', 'auth.not_creator',
  'invite.invalid', 'invite.email_unverified', 'invite.seat_taken', 'invite.already_member',
  'request.not_open', 'request.option_unknown',
  'input.invalid', 'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const ERROR_CODES = [...REASON_CODES, ...API_ERROR_CODES] as const;   // ConvexError.data.code 的全集；测试断言两数组不相交

export const PARAM_AUDIENCE = {
  'budget.over': { overByCents: { ifDisclosed: 'headroomCents' }, headroomCents: { ifDisclosed: 'headroomCents' } },
  'budget.below_committed': { belowByCents: 'owner', minAllowedCapCents: 'owner' },
  'date.after_deadline': { deadline: { ifDisclosed: 'deadline' }, daysLate: { ifDisclosed: 'deadline' } },
  'item.required_missing': { itemKeys: { ifDisclosed: 'requiredItemKeys' }, reason: { ifDisclosed: 'requiredItemKeys' } },
  'item.unknown': { itemKeys: 'room' }, 'item.retired': { itemKeys: 'room' }, 'version.stale_source': { itemKeys: 'room' },
  'date.in_past': { localDate: 'room' }, 'version.stale_constraints': { checkedAgainst: 'room' },
  'approval.stale': { currentConstraintsVersion: 'room' },
  'approval.not_executable': { reasonCodes: 'projectedCodes' },
  'run.rate_limited': { retryAfterMs: 'caller' },
  'item.unconfirmed': { itemKeys: 'caller' }, 'item.limit_exceeded': { limit: 'caller' },
  'disclosure.blocked': { field: 'caller' }, 'disclosure.needs_own_confirmation': { field: 'caller' },
  'date.before_lead_time': { earliestDate: 'caller' },
  // ……其余码的每个参数都必须出现在此表；未出现的参数在投影时一律丢弃（fail-closed）。
  // 参数名是跨章契约：07 §7.11、08、12 §12.4 与 13 的文案只能读这里声明的名字（例：item.required_missing 的 itemKeys / reason，
  // run.rate_limited 的 retryAfterMs，approval.not_executable 的 reasonCodes），改名必须同步改本表，T06-S4 对账
} as const satisfies Partial<Record<ReasonCode, Record<string, ParamAudience>>>;

// convex/lib/validators.ts —— 只在边界
export const vReasonCode = v.union(...REASON_CODES.map((c) => v.literal(c)));   // 类型推断已在 convex 1.48 核实（rules-engine-review C4）
export const zReasonCode = z.enum(REASON_CODES);
export const vCheckResult = v.object({                                       // 与 §7.1 CheckResult 同形；07 §7.11 projectChecks 读 ownerRole / inputs
  checkId: v.string(),
  ownerRole: v.union(roleV, v.null()),                                        // roleV：03 §3.4，同一文件
  inputs: v.array(v.string()),
  status: v.union(v.literal('pass'), v.literal('fail'), v.literal('not_evaluated'), v.literal('unknown')),
  code: v.union(vReasonCode, v.null()),
  params: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))),
});
```

编译期穷尽：模板表 `satisfies Record<ReasonCode, TemplateKey>`；`PARAM_AUDIENCE` 由单测断言"每个检查可能写出的参数名都已声明"（运行 §13 的全部用例，收集实际出现的参数名与表对账）。`ConvexError` 只携带 `{ code, params }`，`params` 先经 §6.3 投影（D16）。

### 6.3 参数受众

```ts
type ParamAudience = 'room' | 'owner' | 'caller' | 'projectedCodes' | { ifDisclosed: FieldKey };
```

- `'room'`：参数值本身是公开数据（目录键、房间 `localDate`、约束版本号）。
- `'owner'`：只给检查所有者。
- `'caller'`：只给本次调用者（写入口的写入者、回答请求的 `toRole`、被节流的人）；它描述的是调用者自己的输入或配额，不含他方数据。
- `'projectedCodes'`：值是 reasonCode 列表，逐码按 §8 的检查所有者规则投影后再下发（不可精确看见的失败码合并为一条 `private.constraint_unmet`），provider 不收。
- `{ ifDisclosed: f }`：所有者以外的**买方**只有在所有者把字段 `f` 披露给他时才看到；`f` 是派生字段时按 07 §7.8.5 以"可得"判定（`f` 本身已共享，或其全部输入都已共享；`headroomCents` 即可得 headroom：共享了 `headroomCents`，或同时共享了 `capCents` 与 `committedCents`）；provider 无论如何不收参数。
- 只有当整条检查对查看者"精确可见"（§8 的所有者或显式解密）时才考虑参数；掩码的检查连码都换掉，参数自然不出现。
- `headroomCents` 是派生值，customer 只有在可得 headroom（共享了 `headroomCents`，或同时共享了 `capCents` 与 `committedCents`，07 §7.8.5）时才看到 `overByCents` 与 `headroomCents`；只打开 `capCents` 不够（派生值继承最严格的输入类，D11）。

典型投影结果分两层看（14 主线数字，finance 只披露 `capCents`）。

① `projectChecks` 纯函数本身（07 §7.11，T06-U29 的对象）：对 v1 条款（$900）在 cap 480000 下的 `Evaluation` 投影——

| 查看者 | `projectChecks` 输出 |
| --- | --- |
| finance | `budget.over {overByCents: 10000, headroomCents: 80000}` |
| customer（只开 `capCents`） | `{ code: 'private.constraint_unmet' }`（掩码项；预算检查的所有者是 finance，customer 缺 committed / headroom，无法解密） |
| customer（另开 `headroomCents`） | `budget.over {overByCents: 10000, headroomCents: 80000}` |
| provider | `fit: 'blocked'` |

② `rooms.view` 实际渲染（14 §10 S7：上限降到 $4,800 后 v1 已 `stale`）：`rooms.view` 只对 `run.currentProposalId` 调用 `checkProposal` / `projectChecks`（§8 末段），所以对 stale 的 v1，三个买方查看者都只见状态守卫给出的公开码 `version.stale_constraints {checkedAgainst: 2}`（"This version no longer applies (constraints v2)"），finance 也不显示 `budget.over`；provider 只见状态 `superseded`（stale 对 provider 映射为 superseded，D12 ①），不显示 fit。①的投影结论只在被检查的提案是**当前**提案时才渲染给人（主线里 v1 在 cv 1 下、v2 在 cv 2 下都通过，所以买方只见 `fit: 'ok'`、没有失败项；finance 在改上限前看到的"$4,900 > $4,800"来自 `rooms.previewChange` 的 `verdictAfter`，不是对 stale v1 的重算）。
