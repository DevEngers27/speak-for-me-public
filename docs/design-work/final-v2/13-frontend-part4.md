# 13 · 前端信息架构（part4）：派生规则与前端类型

> 分片见 `13-frontend.md` 顶部。接 part3 §13.8。

## 13.9 派生规则

### 13.9.1 前端类型只从 `_generated/api` 推导

```ts
// src/features/room/types.ts —— 不手写任何与后端重复的形状
import type { FunctionReturnType } from "convex/server";
import type { PaginatedQueryItem } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";

export type RoomView = NonNullable<FunctionReturnType<typeof api.rooms.view>>;
export type Phase = RoomView["header"]["phase"];                 // 04 derivePhase 的 PhaseView
export type Fit = NonNullable<RoomView["currentProposal"]>["fit"]; // provider | buyer 判别联合
export type BudgetView = RoomView["budget"];                     // none | finance | customer
export type OpenRequest = NonNullable<RoomView["openRequest"]>;  // mine | waiting | run_waiting
export type InboxCard = PaginatedQueryItem<typeof api.rooms.listMine>;     // listMine 不返回 null（12 §12.17）

// 组件参数只接受投影后的类型；传入表文档类型在类型测试里必须编译失败
export function diffTerms(prev: NonNullable<RoomView["currentProposal"]>["terms"],
                          next: NonNullable<RoomView["currentProposal"]>["terms"]): DiffEntry[];
// @ts-expect-error —— Doc<"proposals"> 不能作为 diffTerms 的参数
diffTerms({} as Doc<"proposals">, {} as Doc<"proposals">);
```

### 13.9.2 服务端计算、前端只读的派生量

| 派生量 | 定义与归属 | 前端规则 |
| --- | --- | --- |
| `header.phase` | 04 的 `derivePhase`：`closed` → `executed` → `setup{gaps}` → 当前 run 终态 → `stopped{reason: canceled \| ended_no_agreement}` → `negotiating{roundNo, activeRole}` → `needs_input{you, waitingOn?}`（provider 无 `waitingOn`）→ `awaiting_approval{pendingRoles, youPending}` | 只映射为文案与 CTA；01 part4 X6 是它的"谁该行动"表 |
| `fit.passesChecks` | `checkProposal(ruleInput(today = room.localDate), proposal)` 无问题（06）；query 只读 `rooms.localDate`，永不读 `Date.now()`（D22） | "Ready for approval" / "Doesn't pass the current checks"；**与审批是否齐全无关** |
| `allApproved` | `evaluateApprovalSet(...).complete`（08 唯一实现） | 08 的 `isExecutable = isCurrentForApproval ∧ passesChecks`（不含审批集合），执行条件 `canExecuteNow = isExecutable ∧ allApproved`；前端只用 `passesChecks` 与 `allApproved` 两个词 |
| 槽位 `state` | `evaluateApprovalSet` 逐项结果：只看**当前提案**的审批行；`withdrawn` = 该人最新行为 `withdraw`；`stale_*` = 当前 cv 无有效行、最近一次更早 cv 的行为 approve / reject；执行后改读 `execution.approvalsSnapshot` | 旧提案上的决定只出现在结果页 DecisionRecord 与 `proposals.get().decisions`（review r03） |
| `myAction` | `canDecide`、`kind`、`disabledReasonCode`、`current`（+ Δ1 的 `completesSet`、`canWithdraw`） | 禁用原因码 → 文案：`approval.not_current` "A newer proposal replaced this one."；`approval.not_executable` "This version doesn't pass the current checks."；`run.invalid_state` "Agents are still working on this round." |
| `todos` | 服务端按查看者：`answer_request`（open 请求 `toRole = me`）、`decide_proposal`（`awaiting_approval` ∧ `passesChecks` ∧ 我的槽位 `pending` / `withdrawn`）、`redecide_proposal`（我的槽位 `stale_*`，D06 同一提案重批）、setup 缺口、`complete_task` 等，`priority` 小者优先 | 前端只排序与生成链接；空列表时显示 "Nothing needs you right now. Waiting on: …"（provider 在 `needs_input` 时写 "others"） |
| `inboxSection` | `rooms.listMine`：有 `topTodo` → `needs_you`；phase `negotiating` → `agents_working`；`setup` / `needs_input` / `awaiting_approval` 且无我的待办 → `waiting`；`stopped` / `executed`（无我的任务）/ `closed` → `done` | 卡片不含金额 |
| `run.status`（UI 枚举） | 12 由 runs 状态映射：`needs_input` 对 provider 显示为等待 | 10 新增状态时只改服务端映射函数，不会让 `returns` 失配把整页打进错误边界（review r04） |
| 历史提案 | `proposals.get` 对非当前提案不带 `fit` / `checks`，只带存储状态 | 永久链接显示条款、状态与决定记录；写明 "Checks are shown for the current proposal only."——这同时关闭了"按当前披露渲染旧检查参数"的事后披露泄露（评委 FF-34） |

### 13.9.3 前端允许做的派生（只用于展示，不涉及任何判定）

- 格式化：`formatCents`、`formatIsoDate`、相对时间。
- 串行 lane 推导：由 `run.activeRole` 与固定顺序 provider → customer → finance 推出 done / drafting / queued。
- 差异：`diffTerms(prev, next)`（场景纯函数，输入是已投影的 `terms`）。
- customer 本人未提交表单的 "What others will see" 预览：用 core 中与服务端相同的投影 / 模板纯函数，只处理本人数据。
- 会话内"新变化"标记（`useVersionWatch`）。

禁止：在前端计算是否超预算、是否可执行、某人的审批是否仍有效、谁该行动——这些只来自 `rooms.view`（I-FE-2）。
