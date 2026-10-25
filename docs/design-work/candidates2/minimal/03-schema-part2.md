# 03 Convex schema v1 · part2：场景内容、唯一性、不变量落点、演进

## 1. 简报内容的判别联合（首个场景）

```ts
// convex/scenarios/scopeChange/validators.ts
import { v } from "convex/values";
const cents = v.number(); const isoDate = v.string();

export const customerBriefV = v.object({
  kind: v.literal("scope_change.customer"),
  requiredItemKeys: v.array(v.string()),   // 必须交付（硬）
  wantedItemKeys: v.array(v.string()),     // 想要但可延后（软：协商目标）
  deadline: isoDate,                       // 硬截止日（含当天）
  preferredDate: v.optional(isoDate),      // 软偏好，只进本方代理上下文
});
export const providerBriefV = v.object({
  kind: v.literal("scope_change.provider"),
  items: v.array(v.object({                // 报价目录：确认即对房间公开（07 §3）
    itemKey: v.string(),                   // /^[A-Z][A-Z0-9_]{1,31}$/，版本间稳定
    title: v.string(),                     // ≤ 80
    priceCents: cents,
    earliestDeliveryDate: isoDate,
    taskTitle: v.string(),                 // 派生任务标题模板（无占位符，避免模型参与）
  })),
  preferredItemKeys: v.array(v.string()),  // 私密：provider 更愿意做的条目
});
export const financeBriefV = v.object({
  kind: v.literal("scope_change.finance"),
  totalBudgetCents: cents,                 // 硬上限
  priorCommittedCents: cents,              // 本房间以外已承诺金额（基线；fixture 标 simulated）
});

// convex/scenarios/registry.validators.ts —— 每加一个场景就并入联合
export const briefContentV = v.union(customerBriefV, providerBriefV, financeBriefV);
```

内容级规则（`validateBriefContent(role, content, previous?)`，06 §2）：
- customer：`required ∩ wanted = ∅`；两者都必须是当前 provider 目录的 itemKey（若 provider 尚无版本则延后到 run 开始前检查，见 04 守卫 G-START）；`deadline ≥ today(room)`。
- provider：itemKey 唯一、格式合法；`assertCents(priceCents)`；`earliestDeliveryDate ≥ today`；至少 1 项，至多 `MAX_ITEMS = 8`（穷举上界 2^8 = 256，06 §4）。
- finance：`assertCents` 两个字段；`totalBudgetCents ≥ committedCents(room)`，否则 `BUDGET_BELOW_COMMITTED` 拒绝写入（ADR-09）。

## 2. 每条"逻辑唯一"由谁守

Convex 没有唯一约束（inputs/04 §1.6）。每条唯一性 = 覆盖该键的索引 + 唯一写入口 + 同一 mutation 内先查后写（OCC）。

| 逻辑唯一 | 索引 | 唯一写入口 | 守法 |
| --- | --- | --- | --- |
| (roomId, role) 一个席位 | `seats.by_room_role` | `rooms.create`（唯一插入 seats 的函数） | 一次性按 `scenario.roles` 插入；之后无插入路径 |
| (roomId, userId) 一个席位 | `seats.by_room_user` | `seats.claim`、`rooms.create` | claim 前 `.unique()` 查本房间是否已有该用户 |
| 邀请令牌一次性 | `seats.by_inviteHash` | `seats.claim` | 查到且未过期 → patch `userId` 并删除 `inviteHash`；并发两人认领同一席位 → OCC 让后者重试时查不到 |
| (roomId, role, version) 简报版本 | `briefs.by_room_role_version` | `applyBriefVersion`（helper，被 `briefs.confirm`/`requests.answer` 调用） | 读最新版本，要求 `expectedVersion === latest.version`，插入 `latest+1` |
| 房间约束版本单调 | rooms 文档 | `applyBriefVersion` | 同事务 `patch(room, {constraintsVersion: +1})` |
| 提案版本 | rooms 文档 `proposalSeq` | `agents.completeTurn` | 同事务读-加-写 |
| 每房间一个活动 run | rooms 文档 `currentRunId` | `startRun`（helper） | 先终止旧 run，再插新 run 并改指针 |
| 每回合一个在途尝试 | runs 文档 `activeTurnId` | `scheduleTurn`（helper） | 插入 turn 后改指针；结果提交时比对指针 |
| 每提案至多一张变更单 | `changeOrders.by_proposal` | `approvals.decide` | 执行前 `.unique()` 查；命中则返回已有 id |
| 每请求只回答一次 | humanRequests 文档 | `requests.answer` | `answer` 已存在 → 返回 `ALREADY_ANSWERED` |

**不需要唯一性的地方**：`approvals` 只追加，"最新一行"才算数；重复点击产生的同值决定被 `decide` 识别为无操作（最新决定相同则不插）。

## 3. 不变量 → schema/代码落点（对应 02 §5）

| 不变量 | schema 层 | 代码层 |
| --- | --- | --- |
| I1 只追加 | 四张表无可变字段 | `convex/lib/db.ts` 不导出这四张表的 patch helper；lint 规则禁止 `ctx.db.patch("proposals"…)` |
| I3 约束版本单入口 | — | `applyBriefVersion` 是唯一写 `constraintsVersion` 的代码 |
| I5 金额来自目录 | `proposals.lines` 快照 | `computeTerms` |
| I9 预算重算 | `changeOrders.commitment` 快照 | `validateProposal` 在 `decide` 内 |
| I13 金额范围 | `v.number()` | `assertCents` |
| I14 派生不入库 | 无 status/executable 字段 | `convex/engine/derive.ts` |

## 4. 类型单一来源

- **存储与函数参数**：Convex `v`（本文件），`Infer<typeof X>` 导出 TS 类型。
- **模型输入输出**：Zod 只用于 `AgentOutput`（05 §4）与 `briefPatch` 的客户端表单校验复用。
- 角色与 reasonCode 是场景常量数组 `as const`；引擎表中存 `v.string()`，入口 `assertRole/assertReasonCode`；编译期断言 `type _ = Assert<Equal<Role, (typeof ROLES)[number]>>`。
- `convex/` 内不用 `@/` 别名，全部相对导入（F03.15，Convex 打包器对 tsconfig paths 的支持待验证，直接避开）。

## 5. 公共 query 的 `returns`

`rooms.view`、`rooms.timeline` 声明 `returns` validator；私密/买方字段在 DTO validator 里是 `v.optional`，只有投影函数在有权限时填充。据 Convex 文档 `v.object` 返回值校验会拒绝多余字段，可兜底"误把私密字段带进 DTO"（待验证，16 号有用例）。

## 6. 演进规则

1. 新增字段先 `v.optional`，回填后再收紧；开发部署可清表重 seed。
2. 新场景：新增 `briefContentV` 联合成员与 `scenarioKey`；引擎表不改。
3. `rooms.scenarioVersion` 记录插件版本；规则变化影响旧房间时，旧房间按其版本的规则模块运行（v1 只有版本 1，接口预留）。
4. 不使用 `v.int64()`（金额上限 1e8 远小于 2^53）；不使用 `v.commitTs()`：本设计没有需要全序游标的事件流（时间线是展示，`_creationTime` 足够；若引入通知订阅再评估）。

## 7. 删除与保留

- v1 不提供删除任何业务数据的公共函数（核心 6）。
- 私密简报的保留期限与删除（GAP-21）是开放问题：候选方案是房间级"归档并清除 notes 字段"的运维操作，需用户拍板（18 号 Q5）。
