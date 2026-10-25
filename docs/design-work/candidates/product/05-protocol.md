# 05 协商协议（part1）：信封与模型输出、动作集、schema 与校验

> 本章分 2 片：part1（本文件）两层结构、动作集、Zod 与 JSON Schema、四步校验、记录组装；part2 回合与轮次规则、决议算法、升级给人的三种请求、公共文本、完整示例、不可信文本边界。

## 5.1 两层结构

| 层 | 内容 | 由谁提供 | 存在哪里 |
| --- | --- | --- | --- |
| 服务端信封 `AgentEnvelope` | roomId、runId、turnId、seq、attempt、round、kind、roleKey、seatId、constraintsVersion、baseProposalId、allowedActions、allowedCandidateKeys、allowedTopicKeys | `scheduleTurn` 在 mutation 中从 run 与房间快照生成 | `turns` 行 |
| 模型输出 `ModelMove` | action 及其参数（候选键排序、原因码、话题）、rationale | 模型（或 stub） | `turns.move`（校验通过后） |
| 代码推导 | 被选中的候选、条款、金额、日期、来源引用、检查结果 | `completeTurn` 调用插件与引擎纯函数 | `turns.selection`、`proposals` |

模型永远不提供：身份、角色、版本号、ID、金额、日期、来源引用（GAP-04、F05.1）。提示中可以让模型看到版本号作背景，但输出 schema 中不存在这些字段，`completeTurn` 也不读取任何回显。

```ts
// engine/protocol.ts
export interface AgentEnvelope {
  roomId: string; runId: string; turnId: string;
  seq: number; attempt: number; round: number;
  kind: "propose" | "review";
  roleKey: string; seatId: string;
  constraintsVersion: number;
  baseProposalId: string | null;          // 本回合面对的当前提案
  allowedActions: MoveAction[];
  allowedCandidateKeys: string[];         // 作用域视图下的候选，按插件顺序，最多 40 个
  allowedTopicKeys: string[];
}
export type MoveAction = "propose" | "counter" | "recommend_accept" | "reject" | "clarify";
```

## 5.2 动作集

| 动作 | 含义 | propose 回合 | review 回合 | 参数 | 结果 |
| --- | --- | --- | --- | --- | --- |
| `propose` | 按偏好排序给出 1–5 个候选；代码选第一个通过全部检查的 | ✓ | — | `rankedCandidateKeys`、`rationale` | 新提案，或进入 a2 / 偏好请求 |
| `counter` | 不接受当前提案，给出偏好的替代候选（不直接生成提案） | — | ✓（候选 ≥ 2 时） | `rankedCandidateKeys`、`reasonCode`、`rationale` | 立场；下一轮提出方看到 |
| `recommend_accept` | 建议本人接受当前提案；提出方用它表示"坚持当前提案" | ✓（存在当前提案时） | ✓ | `rationale` | 立场；**永不写 decisions**（I-18） |
| `reject` | 本方可见的候选中没有本人可接受的，请本人亲自选择 | ✓ | ✓ | `reasonCode`、`suggestedCandidateKeys`（0–3）、`rationale` | `preference` 请求给本席位本人 |
| `clarify` | 需要他方披露某个事实才能判断 | ✓ | ✓ | `targetRoleKey`、`topicKey`、`rationale` | `disclosure` 请求给目标席位本人 |

- 保留原 README 的五个动作（PR-01），但每个动作的语义与参数都按"代理只建议、代码决定"重新定义。
- 没有"声明不可行"动作：不可行由代码在预检中判定，不调模型（F05.6、F06.5）。
- `allowedActions` 由 `scheduleTurn` 计算：当前提案不存在、不可执行或其候选已被排除时，propose 回合去掉 `recommend_accept`；作用域内候选少于 2 个时 review 回合去掉 `counter`；本 run 本席位已 clarify 过一次、或没有可问话题时去掉 `clarify`。

## 5.3 模型输出的 Zod schema（`engine/protocol.ts`）

```ts
import { z } from "zod/v4";

export function buildMoveSchema(e: AgentEnvelope, s: {
  rejectReasonCodes: [string, ...string[]]; counterReasonCodes: [string, ...string[]];
  maxRanked: number; targetRoleKeysByTopic: Record<string, string>;
}) {
  const rationale = z.string().min(1).max(1200);
  const keys = z.enum(e.allowedCandidateKeys as [string, ...string[]]);
  const variants: z.ZodObject[] = [];
  if (e.allowedActions.includes("propose")) variants.push(z.strictObject({
    action: z.literal("propose"),
    rankedCandidateKeys: z.array(keys).min(1).max(s.maxRanked), rationale }));
  if (e.allowedActions.includes("counter")) variants.push(z.strictObject({
    action: z.literal("counter"),
    rankedCandidateKeys: z.array(keys).min(1).max(s.maxRanked),
    reasonCode: z.enum(s.counterReasonCodes), rationale }));
  if (e.allowedActions.includes("recommend_accept")) variants.push(z.strictObject({
    action: z.literal("recommend_accept"), rationale }));
  if (e.allowedActions.includes("reject")) variants.push(z.strictObject({
    action: z.literal("reject"), reasonCode: z.enum(s.rejectReasonCodes),
    suggestedCandidateKeys: z.array(keys).max(3), rationale }));
  if (e.allowedActions.includes("clarify")) variants.push(z.strictObject({
    action: z.literal("clarify"),
    topicKey: z.enum(e.allowedTopicKeys as [string, ...string[]]),
    targetRoleKey: z.string(), rationale }));
  return z.strictObject({ move: z.discriminatedUnion("action", variants as any) });
}
export type ModelMove = z.infer<ReturnType<typeof buildMoveSchema>>["move"];
```

Convex 侧对应的存储校验器是 03 第 3.18 节的 `modelMoveV`；两者字段一一对应，由单测断言（同一组样例分别通过两种校验）。

## 5.4 发给 API 的 JSON Schema（自建，保留 enum）

SDK 1.1.0 的 `zodOutputFormat` 会把 `enum`/`const` 挪进描述文字（04 平台约束 4.4 实测），候选键就不受解码约束。因此 `convex/runtime/schema.ts#toOutputJsonSchema(e, s)` 直接生成 API 支持的子集：

```json
{
  "type": "object", "additionalProperties": false, "required": ["move"],
  "properties": {
    "move": { "anyOf": [
      { "type": "object", "additionalProperties": false,
        "required": ["action", "rankedCandidateKeys", "rationale"],
        "properties": {
          "action": { "type": "string", "enum": ["propose"] },
          "rankedCandidateKeys": { "type": "array", "minItems": 1,
            "items": { "type": "string", "enum": ["LOGIN+REPORTS@expedited", "LOGIN+REPORTS@standard", "LOGIN@expedited"] },
            "description": "1 to 5 keys, most preferred first" },
          "rationale": { "type": "string", "description": "Private note to your principal, at most 1200 characters" } } },
      { "...": "其余允许的动作同理" }
    ] }
  }
}
```

- 根是对象、联合放在 `move` 属性内，避开"根级 anyOf 是否被接受"的不确定性（待验证 #6）。
- 不支持的约束（`maxItems`、长度、`targetRoleKey` 与话题的对应）写在 `description` 中，由 Zod 与语义校验强制。
- 候选键 enum 随回合变化：每个 schema 首次请求有编译开销、之后缓存 24 小时（04）；同一房间的候选集合在同一约束版本内稳定，开销可接受。上线前用 fixture 预热。

## 5.5 四步校验（`runtime.completeTurn` 内，均为纯函数）

| 步骤 | 检查 | 失败码 |
| --- | --- | --- |
| ①响应 | `stop_reason === "end_turn"`；存在 text 块 | `max_tokens` → `AGENT_TRUNCATED`；`refusal` → `AGENT_REFUSED`；其他 → `AGENT_OUTPUT_INVALID` |
| ②解析 | `JSON.parse` 成功 | `AGENT_OUTPUT_INVALID` |
| ③形状 | `buildMoveSchema(e, s).safeParse` 成功（严格对象，拒绝多余字段） | `AGENT_OUTPUT_INVALID`（`errorDetail` 只存 Zod 路径，不存内容） |
| ④语义 | `action ∈ allowedActions`；候选键 ∈ `allowedCandidateKeys` 且不重复；`clarify` 的 `targetRoleKey === 话题声明的目标角色`；`reject.suggestedCandidateKeys` 当前可执行或为空；rationale 去除控制字符 | `AGENT_OUTPUT_INVALID` |

模型调用（action 中）只做 ①②前的传输与用量记录；②③④在 `completeTurn`（mutation）中重做一遍，因为 action 的结论不可信任到落库时（状态可能已变）。

## 5.6 记录组装

`completeTurn` 写入的 `turns.move` 是校验后的 `ModelMove`；对他方公开的只是由它派生的结构化事件 `agent_stance`（动作、候选键、原因码、话题），rationale 只存在 `turns.move.rationale`，只经 `history.myAgentNotes` 返回给本席位（I-30）。
