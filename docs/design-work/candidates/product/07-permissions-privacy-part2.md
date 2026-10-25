# 07 权限与隐私（part2）：披露矩阵、读模型投影、有界推断披露

## 7.4 字段 × 角色披露矩阵（scope_change 默认值）

图例：**全** = 可见原值；**结** = 只见检查结论（pass/fail + 原因码，无数值）；**—** = 不可见；"默认 X" = 字段拥有者可在简报中改变披露，表中是默认受众。

### 私密简报与台账

| 数据 | 拥有者 | customer | provider | finance | 本方代理 | 他方代理 |
| --- | --- | --- | --- | --- | --- | --- |
| `customer.requiredItemKeys` | customer | 全 | 全（默认 room） | 全（默认 room） | 全 | 随其主人 |
| `customer.hardDeadline` | customer | 全 | —（默认私密） | —（默认私密） | 全 | 随其主人 |
| `customer.preferredDate` | customer | 全 | — | — | 全 | — |
| `provider.minChangeValueCents` | provider | — | 全 | — | 全 | — |
| `finance.budgetCapCents` | finance | 全（默认 customer） | — | 全 | 全 | customer 代理随 customer |
| 派生 `committedCents`、台账条目 | finance | 全（默认 customer） | — | 全 | 全 | 同上 |
| 各方私密备注 `notes` | 本人 | 仅本人 | 仅本人 | 仅本人 | 全 | **永不** |
| 共享说明 `sharedNote` | 本人 | 需披露项 | 需披露项 | 需披露项 | 全 | 披露时，位于不可信定界块 |
| 简报版本号与确认时间 | 本人 | 全 | 全 | 全 | 全 | 全 |
| 约束修订的字段名 `changedRuleFieldKeys` | — | 只见对自己披露的字段名 | 同左 | 同左 | — | — |

"他方代理随其主人"：代理看到的永远等于其主人能看到的（I-29）。

### 共享对象

| 数据 | customer | provider | finance |
| --- | --- | --- | --- |
| 已确认清单项（范围、报价，含价格） | 全 | 全 | 全 |
| 清单草稿 | 作者 | 作者 | 作者 |
| 提案条款（含 `amountCents`、交付日、延后项） | 全 | 全 | 全 |
| 提案检查（见下表） | 投影 | 投影 | 投影 |
| 买方预算行（批准后已承诺、上限、余量、超出额） | 全（默认） | — | 全 |
| 签核：类型、时间、原因码 | 全 | 全 | 全 |
| 签核备注 `note` | 本人 | 本人 | 本人 |
| run 进度、各代理回合状态、公开立场 | 全 | 全 | 全 |
| 代理 rationale、被阻断候选原因、用量明细 | 本席位 | 本席位 | 本席位 |
| 房间累计模型调用次数与估算成本 | 全 | 全 | 全 |
| 人工请求详情与选项 | 目标 | 目标 | 目标 |
| 人工请求存在与状态（"Waiting on Finance"） | 全 | 全 | 全 |
| 执行记录条款、任务 | 全 | 全 | 全 |
| 执行快照：上限、执行前后已承诺 | 全（默认） | — | 全 |

### 检查投影（由 06 第 6.4 节规则自动生成）

| checkId | inputs | customer | provider | finance |
| --- | --- | --- | --- | --- |
| `budget` | finance.budgetCapCents、committedCents | 全（默认） | 结 | 全 |
| `required_items` | customer.requiredItemKeys | 全 | 全（默认） | 全（默认） |
| `deadline` | customer.hardDeadline | 全 | 结（默认） | 结（默认） |
| `provider_minimum` | provider.minChangeValueCents | 结 | 全 | 结 |
| `date_not_past`、`non_empty`、`expedite_available` | 公开 | 全 | 全 | 全 |
| `source_resolvable`、`source_current`、`source_unexpired`、`terms_consistent` | 公开 | 全 | 全 | 全 |

**文案陷阱**（F07.1）：provider 窗口不得出现"批准后已承诺 $4,900"——provider 知道 +$900，就能反推已承诺 $4,000。provider 只看到 "+$900 · Blocked: exceeds the finance limit"；买方看到 "+$900 change · $4,900 committed after approval · $4,800 cap · over by $100"。"结"类文案对任何超出额都完全相同（超 $1 与超 $1,000 无差别）。

## 7.5 按查看者裁剪的读模型

Convex 没有字段级 ACL，**投影是唯一防线**（F07.2）。规则：
1. 每个公共 query 先 `seatOrNull`，再调用 `engine/projection.ts` 的投影函数构造 DTO，**逐字段显式赋值**，不 spread 任何文档。
2. 每个公共 query 声明 `returns` 校验器；私密段落写成 `v.optional(...)`，只在查看者有权时填充；多余字段会被返回值校验拒绝（据文档，待验证），作为第二道防线。
3. Next 的 Server Component props、`preloadQuery` 结果、`useQuery` 结果都来自这些 query，因此都已裁剪（04 平台约束 5.1）。
4. 他方简报在读模型中只以 `briefStatuses: {seatId, roleKey, version, confirmedAt}` 与 `sharedFacts` 出现（RA-U09）。

`rooms.workspace` 返回值（节选，完整见 12）：

```ts
export const workspaceDTO = v.object({
  room: v.object({ id: v.id("rooms"), title: v.string(), goal: v.string(), scenarioKey: v.string(),
    timeZone: v.string(), currency: v.literal("USD"), status: v.string(),
    constraintsVersion: v.number(), proposalVersion: v.optional(v.number()),
    phase: v.string(), blockedReason: v.optional(v.string()), isSimulated: v.boolean() }),
  me: v.object({ seatId: v.id("seats"), roleKey: v.string(), isOwner: v.boolean(),
    capabilities: v.array(v.string()) }),
  seats: v.array(v.object({ seatId: v.id("seats"), roleKey: v.string(), displayName: v.optional(v.string()),
    filled: v.boolean(), brief: v.optional(v.object({ version: v.number(), confirmedAt: v.number() })) })),
  sharedFacts: v.array(v.object({ fromRoleKey: v.string(), fieldKey: v.string(), label: v.string(), valueText: v.string() })),
  current: v.optional(proposalCardDTO),          // 条款 + 投影后的检查 + 签核状态 + 记录预览
  buyerBudget: v.optional(v.object({              // 只有能同时看到上限与已承诺的查看者才有
    capCents: v.number(), committedCents: v.number(), headroomCents: v.number(),
    committedAfterCents: v.optional(v.number()) })),
  run: v.optional(runProgressDTO),               // 各代理回合状态与公开立场
  myRequests: v.array(requestCardDTO),           // 目标是我的请求（含选项）
  waitingOn: v.array(v.object({ roleKey: v.string(), kind: v.string() })), // 别人的请求，仅角色与类型
  todo: v.array(v.object({ kind: v.string(), label: v.string(), href: v.string() })),
  lastExecution: v.optional(executionSummaryDTO),
  usage: v.object({ modelCalls: v.number(), estimatedCostMicros: v.number() }),
});
```

## 7.6 有界推断披露（ADR-13）

"某提案是否超预算"本身来自 finance 的私密数据。系统必须让各方知道提案为何被阻断，所以接受以下**有界**的推断披露，并在披露基线中写明：

| 渠道 | 泄露的是什么 | 上界 | 缓解 |
| --- | --- | --- | --- |
| 当前提案的检查结论（"结"） | 一个候选是否满足某私密约束 | 每个提案一次 | 结论文案不含数值、不分超出幅度 |
| 提出方的排序被阻断（`turns.selection.blocked`，只给提出方席位与其代理） | 排序中每个被阻断候选的结论 | 每轮 ≤ 5 × 2 次尝试，每约束版本 ≤ `maxRounds` 轮（scope_change ≤ 30 个结论） | 只回原因码；不告知"最多能花多少" |
| 候选浏览器中手动提出被阻断 | 单个候选的结论 | 每约束版本每席位 ≤ 10 次 | 频率限制；超限返回 `RATE_LIMITED` |
| `preference` 请求列出的可执行候选（给请求目标本人：代理 `reject`、提出方 a2 失败、同版本第 4 次拒绝） | 最多 3 个候选"可执行" | 每 run 每席位 1 次；每约束版本每席位 ≤ 3 次 | 候选只从目标本人的作用域视图中选取；不附任何他方参数 |
| 取舍请求的选项（例如给 finance 的"上调到 $4,450 可使 LOGIN 标准交付可行"） | 该候选通过了他方私密检查 | 每约束版本每席位 ≤ 3 个选项 | 选项只给目标本人；只给"最小放宽"与一个更高档 |
| 简报确认预览 `impactDTO.feasibleAfter`（只给本人） | 拟议变更后"是否存在可行候选"一个布尔 | 每次预览 1 位；query 无法限频，接受脚本化探测的风险 | 不返回哪个候选可行；不返回他方检查的任何参数 |

不在任何渠道泄露的：上限、已承诺、余量、截止日期、最低金额的数值；"上调到 $X"之类的取舍选项只给 finance 本人。finance 若希望减少来回，可以主动把上限或余量披露给 provider。
