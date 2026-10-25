# 05 协商协议（事件溯源候选）· part1：信封、候选、模型输出

> 分两片：part1（本文件）信封、候选集、动作 schema；`05-protocol-part2.md` 回合与轮次规则、澄清/升级/不可行、人工请求结构、公共文本。

## 1. 决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| P-1 | **服务端信封与模型输出分两层**；模型永不提供身份、版本、ID、金额、日期 | 模型自报版本会使过期检查失效（F05.1）；金额必须来自已确认目录（核心 4） | 一个混合 schema |
| P-2 | **代码先枚举候选（candidate），模型只能按 `candidateId` 选择** | 价格、范围、日期全部由代码从目录与约束算出；模型发明金额在结构上不可能 | 模型输出 itemKeys + deliveryDate 再校验：仍可能凑出非法日期/组合，需更多重试 |
| P-3 | 动作是判别联合，按角色给不同的动作子集 | 每个角色只能做协议允许的事 | 所有角色共用一个大 schema |
| P-4 | 模型自由文本只有 `rationale`，只给本方看，不进事件、不进他方上下文 | 关闭"代理泄露委托人私密值"与跨代理注入两条路（F05.3/F05.4） | 公开模型写的 publicSummary + 正则过滤 |
| P-5 | 升级给人由代码决定；问题与选项由代码生成 | 代理不能决定打扰谁（F05.6） | 模型 clarify 带 `target:'human'` |
| P-6 | 每个回合产生的业务事实都是事件（`turn_completed` 记录动作与 candidateId）；回合遥测在 `agentTurns` | 时间线可追溯"谁在第几轮提议了什么"，而不暴露 rationale | 把整段模型输出写进事件 |

## 2. 服务端信封（不由模型产生）

```ts
// convex/engine/protocol/envelope.ts —— 全部取自 agentTurns 行的快照
export type TurnEnvelope = {
  roomId: Id<"rooms">; runNo: number; turnSeq: number; attempt: number;
  role: Role; phase: "propose" | "evaluate"; round: number;
  constraintsVersion: number;          // = run.constraintsVersionAtStart
  baseProposalVersion?: number;        // evaluate 回合必有
  candidateIds: string[];              // 本回合允许的选择
};
```

`completeTurn` 只拿信封快照与当前房间比较（04 §3），**不读模型回显的任何版本号**。prompt 中可以出现版本号作背景，但输出 schema 中没有这些字段。

## 3. 候选集（candidate）

候选 = 一个可报价的完整方案，由场景插件的 `enumerateCandidates` 纯函数产生（06 §4）：

```ts
type Candidate = {
  candidateId: string;                 // 稳定、可读："C-LOGIN_SSO+USAGE_REPORTS-rush"
  itemKeys: string[];                  // 已排序
  lines: Line[];                       // (itemKey,itemVersion,title,priceCents) —— 来自当前已确认目录
  terms: TermLine[];                   // 如 RUSH $100
  deliveryDate: string;                // 由 leadDays 与 today(房间时区) 算出
  amountCents: number;                 // 代码求和
  deferredItemKeys: string[];          // 客户请求范围 − 本方案范围
  checks: Record<ReasonCode, boolean>; // 全量校验结果（只在服务端）
};
```

**按角色投影给代理的候选**（07 §6 的披露规则在这里落地）：

| 字段 | provider 代理 | customer 代理 | finance 代理 |
| --- | --- | --- | --- |
| candidateId、itemKeys、amountCents、deliveryDate、deferredItemKeys | ✓ | ✓ | ✓ |
| 是否满足 customer 已共享硬约束（必需项、截止日） | ✓ | ✓ | ✓ |
| 是否满足 customer 私密偏好（preferredDate） | ✗ | ✓ | ✗ |
| 是否在预算内 / headroomAfter | ✗ | ✓ | ✓ |

provider 代理拿到的候选**不按预算过滤**：按预算过滤等于把余量区间告诉卖方。provider 只能从 finance/customer 的 counter 或提案被标为 `EXCEEDS_FINANCE_LIMIT` 中得知"某方案超限"——这正是 07 §2 认定的最小披露。

候选数上限 `MAX_CANDIDATES = 12`：首个场景目录 3 项 × 交付方式 2 种，全枚举 ≤ 14 种，先过滤掉违反已共享硬约束的，再按（满足必需项、包含 desired 数、金额）排序取前 12。

## 4. 模型输出 schema（Zod，仅模型 I/O）

```ts
// convex/engine/protocol/modelOutput.ts
const rationale = z.string().min(1).max(1200);          // 长度真正靠 max_tokens 限制
const proposeV = (ids: [string, ...string[]]) => z.object({
  action: z.literal("propose"), candidateId: z.enum(ids), rationale });
const counterV = (ids) => z.object({ action: z.literal("counter"), candidateId: z.enum(ids), rationale });
const acceptV = z.object({ action: z.literal("recommend_accept"), rationale });
const rejectV = z.object({ action: z.literal("reject"),
  reasonCode: z.enum(["NEEDS_TRADEOFF", "OVER_LIMIT", "SCOPE_INSUFFICIENT", "DATE_UNACCEPTABLE"]), rationale });
const clarifyV = z.object({ action: z.literal("clarify"),
  topic: z.enum(["confirm_required_items", "confirm_deadline", "confirm_budget_headroom", "confirm_lead_time"]),
  question: z.string().min(1).max(600) });             // 只给本方委托人

export function outputSchemaFor(env: TurnEnvelope) {
  const ids = env.candidateIds as [string, ...string[]];
  const message = env.phase === "propose"
    ? z.discriminatedUnion("action", [proposeV(ids), clarifyV])
    : z.discriminatedUnion("action", [acceptV, counterV(ids), rejectV, clarifyV]);
  return z.strictObject({ message });                    // 外包一层对象，避开根级 anyOf（待验证项）
}
```

| 角色 · 阶段 | 允许动作 |
| --- | --- |
| provider · propose | propose、clarify |
| customer · evaluate | recommend_accept、counter、reject、clarify |
| finance · evaluate | recommend_accept、counter、reject、clarify |

**传给 API 的 JSON Schema 自行生成**（`buildJsonSchema(env)`），保留 `enum`/`const`（API 支持，inputs/04 §4.4），不经 `zodOutputFormat`（它会把 enum/const 降级为描述文字）。生成后仍用上面的 Zod `safeParse` 校验——这是唯一可信的校验。

**代码层附加校验**（`completeTurn` 中，Zod 之后）：
1. `candidateId ∈ env.candidateIds`（Zod enum 已覆盖，重复检查作防线）；
2. `recommend_accept` 只能指向 `validation.ok` 的提案；finance 对 OVER_BUDGET 提案只能 counter/reject；否则视为 `invalid_output`；
3. counter 的 candidateId 必须 ≠ 当前提案的 candidateId；
4. 任何多余字段 → strictObject 拒绝 → invalid_output。

## 5. 服务端组装的协议记录（落库形态）

```ts
// 写进 agentTurns.output（本角色可读）
type TurnOutputRecord = { envelope: TurnEnvelope; message: ModelMessage; validatedAt: number };
// 写进事件 turn_completed（全房间可见，无 rationale/question）
{ type: "turn_completed", runNo, turnSeq, role, action, candidateId?, reasonCode?, baseProposalVersion? }
```

`clarify.question` 与 `rationale` 一样只存 `agentTurns.output`；事件里只有 `topic` 对应的 reasonCode（如 `CLARIFY_DEADLINE`）。
