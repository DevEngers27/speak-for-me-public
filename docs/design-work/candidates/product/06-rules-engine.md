# 06 确定性规则与场景插件（part1）：校验管线、RuleView、检查与 reasonCode

> 本章分 3 片：part1（本文件）校验管线、规则视图、检查结果、reasonCode 目录、可行性分析；part2 场景插件接口（TypeScript）与"引擎提供什么"；part3 用第二场景"活动预算"检验边界。
> 命名约定（全篇）：reasonCode 与错误码用 `UPPER_SNAKE`；其他枚举值用 `lower_snake`；检查 id 用 `lower_snake`。

## 6.1 职责分界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| 场景插件（纯函数） | 字段与清单的形状、候选枚举、金额与日期的计算、场景检查、取舍选项、记录派生、模板 | 读写数据库、身份、时间获取、版本、状态迁移 |
| 引擎纯核心 `engine/` | 规则视图的投影、引擎级来源检查、候选按角色过滤、签核完成判定、状态迁移表、规范化键、模板分发 | 任何场景名词（预算、范围、报价） |
| 引擎 Convex 适配 `convex/engine/` | 鉴权、读写、组装规则视图、调用纯函数、事务内重算、调度 | 场景规则本身 |

**规则只信任存储值**：模型、客户端提交的金额、日期、合计一律不被采信；代码从已确认的清单项重新计算并比对。

## 6.2 校验管线与调用点

| 调用点 | 输入 | 运行的校验 | 失败后果 |
| --- | --- | --- | --- |
| 模型输出到达 `runtime.completeTurn` | 模型 JSON | ①stop_reason=end_turn ②JSON 解析 ③Zod 严格校验 ④语义校验：候选键属于本回合允许集合、话题属于允许话题、原因码属于枚举 | 回合 `invalid_output`，计入有界重试 |
| 由候选创建提案（代理、人、请求回答） | candidateKey | ⑤`toTerms` 计算条款 ⑥全部检查（引擎 + 场景）在**当前**规则视图下通过 | 不创建提案；代理收到按角色投影的原因码；人收到 `CANDIDATE_BLOCKED` |
| 签核 `decisions.record`（approve） | proposalId, 期望约束版本, 期望 termsKey | 状态守卫（04）+ 全部检查重算 | `PROPOSAL_NOT_EXECUTABLE` 等，整笔不写 |
| 执行（同一事务） | 当前规则视图 | 状态守卫 + 全部检查重算 + 签核集合判定 + operationKey 查重 | 不执行，事务回滚 |
| 约束变化后的跟进 `negotiation.afterConstraintChange` | 当前提案 | 全部检查 | 决定"只需重签 / 重新协商 / 取舍请求" |
| 读模型 `rooms.workspace` | 当前提案与候选 | 全部检查 → 按查看者投影 | 只影响显示 |

存储的 `proposals.creationChecks` 只是创建时快照，用于审计；任何决策都重新计算（不变量 I-10，02）。

## 6.3 规则视图 RuleView

```ts
// engine/ruleView.ts —— 纯类型，场景以泛型参数填充
export type IsoDate = string; // "YYYY-MM-DD"，已校验真实日历日
export interface RuleView<T extends ScenarioTypes> {
  scenarioKey: T["key"];
  constraintsVersion: number;
  today: IsoDate;                       // 按 rooms.timeZone 计算，由引擎传入
  roles: { [R in T["roleKey"]]: {
    seatId: string;
    briefVersion: number | null;        // null = 未确认
    fields: T["briefFields"][R] | null; // 最新确认版本的规则字段与偏好字段
  } };
  lists: { [L in T["listKey"]]: ListItemView<T["listItemData"][L]>[] }; // 只含 confirmed 的当前版本
  ledger: { committedCents: number; activeEntryCount: number };
}
export interface ListItemView<D> {
  itemKey: string; version: number; data: D;
  validUntil?: IsoDate; expired: boolean;   // expired = validUntil < today
}
```

- 由 `convex/engine/ruleView.ts#buildRuleView(ctx, room)` 在 query/mutation 内组装：读最新确认的 `briefVersions`（每席位一条）、`listItems` 的 `by_room_list_status`（status confirmed）、`commitments` 汇总（status active）、`today`。
- 组装结果含全部私密值，只在服务端存在；从不返回客户端。

### 按角色的作用域视图

```ts
export type Visibility = "visible" | "hidden";
export interface ScopedRuleView<T> extends RuleView<T> {
  viewerRoleKey: T["roleKey"];
  hiddenFields: FieldRef[];            // 对该角色不可见的输入
}
export type FieldRef =
  | { kind: "brief"; roleKey: string; fieldKey: string }
  | { kind: "derived"; factKey: string };          // 例如 committedCents
export function scopeView<T>(view: RuleView<T>, viewer: string,
  disclosures: DisclosureMap, plugin: ScenarioPlugin<T>): ScopedRuleView<T>;
```

`scopeView` 把不可见字段替换为 `undefined` 并记入 `hiddenFields`。它用于两处：本方代理的上下文与候选列表（10）、"Choose an option myself" 的候选浏览器（13）。

## 6.4 检查结果

```ts
export interface CheckOutcome {
  checkId: string;                     // "budget"
  status: "pass" | "fail" | "unknown"; // unknown 只出现在作用域视图上（输入被隐藏）
  reasonCode: string;                  // pass 也有码，例如 BUDGET_FITS
  params: Record<string, number | string | string[]>; // 例如 { overByCents: 10000 }
  inputs: FieldRef[];                  // 声明式，供投影
}
export interface ProjectedCheck {
  checkId: string; status: "pass" | "fail";
  reasonCode: string;
  detail: "full" | "verdict_only";     // verdict_only 时 params 被移除
  params?: CheckOutcome["params"];
}
```

**投影规则**（07 第 7.4 节的矩阵由此生成）：检查的所有 `inputs` 对查看者可见（本人拥有、或已披露给查看者、或公开）→ `full`；否则 → `verdict_only`。"每个检查的通过/失败及原因码对全体席位可见"是**披露基线**的一部分，在接受邀请时展示并同意（07）。

## 6.5 引擎级检查（所有场景共用）

场景条款必须包含引擎标准字段 `refs: ItemRef[]`（`{listKey, itemKey, version}`）。引擎据此运行：

| checkId | 失败 reasonCode | 判定 |
| --- | --- | --- |
| `source_resolvable` | `SOURCE_UNKNOWN` | 每个 ref 指向存在的 listItem |
| `source_current` | `SOURCE_SUPERSEDED` / `SOURCE_WITHDRAWN` | 被引用版本仍是该 itemKey 的 confirmed 当前版本 |
| `source_unexpired` | `SOURCE_EXPIRED` | 被引用项 `validUntil` 未早于 today |
| `terms_consistent` | `TERMS_MISMATCH` | `plugin.candidates.toTerms(selectionOf(terms), view)` 与存储的条款规范化后逐字节相等（防止任何"声明的金额"与计算不符） |

引擎检查的输入全部公开，投影恒为 `full`。

## 6.6 reasonCode 目录

| 范围 | 码 |
| --- | --- |
| 引擎检查 | `SOURCE_UNKNOWN` `SOURCE_SUPERSEDED` `SOURCE_WITHDRAWN` `SOURCE_EXPIRED` `TERMS_MISMATCH` |
| scope_change 检查（14） | `SCOPE_NONEMPTY`/`EMPTY_SCOPE`、`REQUIRED_ITEMS_MET`/`REQUIRED_ITEM_MISSING`、`DEADLINE_MET`/`DEADLINE_MISSED`、`DATE_VALID`/`DATE_IN_PAST`、`BUDGET_FITS`/`BUDGET_EXCEEDED`、`MINIMUM_MET`/`BELOW_PROVIDER_MINIMUM`、`EXPEDITE_OK`/`EXPEDITE_UNAVAILABLE` |
| 函数错误（`ConvexError({code})`） | `UNAUTHENTICATED` `NOT_A_MEMBER` `ROLE_NOT_PERMITTED` `NOT_REQUEST_TARGET` `ROOM_CLOSED` `INVALID_INPUT` `STALE_DRAFT` `BRIEF_INCOMPLETE` `CONSTRAINTS_CHANGED` `TERMS_CHANGED` `PROPOSAL_NOT_CURRENT` `PROPOSAL_NOT_EXECUTABLE` `ALREADY_EXECUTED` `INVITE_EXPIRED` `INVITE_USED` `INVITE_REVOKED` `ALREADY_SEATED` `RUN_ACTIVE` `NOT_READY` `AGENTS_DISABLED` `RATE_LIMITED` `REQUEST_CLOSED` `CANDIDATE_UNKNOWN` `CANDIDATE_BLOCKED` `BASELINE_LOCKED`；场景守卫 `CAP_BELOW_COMMITTED` |
| 代理回合（10） | `AGENT_TIMEOUT` `AGENT_TRANSPORT_ERROR` `AGENT_RATE_LIMITED` `AGENT_REFUSED` `AGENT_OUTPUT_INVALID` `AGENT_TRUNCATED` `AGENT_CONFIG_ERROR` `CALL_BUDGET_EXHAUSTED` |
| 立场原因（scope_change） | 拒绝：`SCOPE_INSUFFICIENT` `TOO_LATE` `TOO_EXPENSIVE` `TERMS_UNCLEAR` `OTHER`；还价：`PREFER_MORE_SCOPE` `PREFER_EARLIER_DELIVERY` `PREFER_LOWER_COST` `OTHER` |

错误消息纪律：客户端只拿到码和公开参数（例如版本号），永远不带对方私密数值（07 第 7.8 节）。

## 6.7 可行性分析

```ts
export interface FeasibilityReport {
  constraintsVersion: number;
  evaluated: { candidateKey: string; outcomes: CheckOutcome[]; executable: boolean }[];
  executableKeys: string[];        // 按插件的确定性顺序
  excludedKeys: string[];          // 本约束版本内被人拒绝过的候选
  truncated: boolean;              // 超过 maxCandidates 被剪枝
}
export function analyzeFeasibility<T>(plugin: ScenarioPlugin<T>, view: RuleView<T>,
  excluded: Set<string>): FeasibilityReport;
```

用途：①run 开始前的预检（无可执行候选 → 不调模型，直接生成取舍请求）；②确定提出方排序中第一个可执行候选；③取舍选项的生成输入（`plugin.tradeoffs(view, report)`）；④stub 代理的确定性策略输入。

## 6.8 确定性纪律

- 插件函数不得读时间、随机数、环境变量；`today` 由引擎传入。
- 金额一律安全整数美分，`assertCents(n)`：`Number.isSafeInteger(n) && 0 <= n && n <= 10_000_000_000`（≤ 1 亿美元，即 100,000,000.00）；求和后再断言一次。
- 日期一律 `YYYY-MM-DD`，入口用 `isIsoCalendarDate`（拒绝 2026-02-30），通过后按字典序比较；截止日语义"当天结束前交付即满足"（`deliveryDate <= hardDeadline`）。
- 候选与原因码输出顺序确定（插件给出全序比较器），同一输入永远同一输出；属性测试覆盖（16）。
- 规范化键 `canonicalKey(value)`：对象键排序、数组按插件声明保持或排序、无空白的 JSON。`termsKey = canonicalKey(terms)`，存于提案并复制到签核记录。
