# 04 状态机（part2）：房间、提案、审批决定、人工请求、邀请、两组守卫、就绪条件

> 分片清单见 part1。

## 4.5 房间（room）

| # | from → to | 触发函数（调用者） | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| M1 | ∅ → open | `rooms.create`（允许创建房间的用户，07 §7.2） | 场景存在；标题、目标、时区合法 | 插入 room（constraintsVersion 0）、创建者的 participant（创建者选择自己的角色）、`constraintVersions` v0；事件 `room_created` |
| M2 | open → closed | `rooms.close`（房间创建者） | — | 活跃 run → cancelled（T13）；open 邀请 → revoked；open 请求 → cancelled；简报、目录冻结（后续写入返回 `ROOM_CLOSED`） |

v1 不提供重新打开；需要继续协商就新建房间（可从旧房间复制目录与简报草稿，17）。

## 4.6 提案（派生，文档不可变）

```ts
function proposalStatus(p, room, executionByProposal): "executed" | "current" | "superseded" {
  if (executionByProposal.has(p._id)) return "executed";
  return room.currentProposalId === p._id ? "current" : "superseded";
}
function proposalExecutable(p, room, ruleInput, today): { executable: boolean; checks: Check[] } {
  if (proposalStatus(p, room, …) !== "current") return { executable: false, checks: [notCurrentCheck] };
  return evaluateProposal(p.terms, ruleInput, today);       // 06：引擎检查 + 场景检查
}
```

- `rooms.currentProposalId` 只在三处改变：`applyTurnOutput`（代理提出新候选）、`proposals.proposeManually`、种子数据。它不会因约束变化而改变——约束变化后同一提案在新版本下被重新评估（RA-R11 的替代方案：不复制提案）。
- 提案在新约束版本下仍可执行时进入"重新审批"（T2）；不可执行时界面显示 Blocked 及按查看者投影的原因（07 §7.3）。

## 4.7 审批决定（派生，`decisions` 只追加）

参与者 p 对提案 P 的状态，取 `decisions` 中 (P, p) 的最新一行 d，与房间当前约束版本 C 比较：

| 最新一行 | `d.constraintsVersion === C` | `!==` C |
| --- | --- | --- |
| 无 | pending | pending |
| approve | approved | stale_approve |
| reject | rejected | stale_reject |
| withdraw | withdrawn（等同 pending，可再次决定） | pending |

允许的追加（`decisions.decide` 内校验）：

| 当前派生状态 | approve | reject | withdraw |
| --- | --- | --- | --- |
| pending / withdrawn / stale_* | 允许（需可执行） | 允许 | 不允许（无可撤回） |
| approved | 幂等返回（不追加） | 允许（改变主意） | 允许（执行前） |
| rejected | 允许（需可执行，且 run 仍为 awaiting_approval） | 幂等返回 | 允许 |

注意：一次 reject 会立即让 run superseded 并触发重谈（T12 → T1），所以"先拒绝后改批准"在实际流程里只会落到新 run 的新当前提案上。执行之后不再接受任何决定（G-D7）。

## 4.8 人工请求（humanRequests）

| # | from → to | 触发函数（调用者） | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| H1 | ∅ → open | `planHumanRequests`（startRunTx T3、concludeRound T5） | 场景规划器产出至少一个选项 | 每个目标角色一行；事件 `request_opened`（受众：目标角色详细、全房间摘要） |
| H2 | open → answered | `requests.answer`（目标角色的参与者） | `request.constraintsVersion === room.constraintsVersion`；run 为当前活跃 run 且 waiting_human；optionKey 属于该请求 | 依选项效果（下表） |
| H3 | open → superseded | `bumpConstraints`、`supersedeRunTx`、T8/T9 手动提案 | — | `closedReason` |
| H4 | open → cancelled | `rooms.close` | — | — |

选项效果（`option.effect`，由场景定义，05 §5.7）：

| effect | 回答时发生什么 |
| --- | --- |
| `share_answer` | 回答作为该角色对全房间的显式披露写入请求记录；当前 run superseded，新 run（trigger `request_answered`）在上下文的共享事实中看到它；不改变约束版本 |
| `edit_constraints` | 只记录意向并返回深链（如打开预算或简报编辑器）；真正生效要等本人确认新的简报版本 / 目录条目，那一步调用 `bumpConstraints`，届时本 run 与其他 open 请求一起被取代 |
| `propose_manually` | 只记录意向并打开手动提案界面（仅提议方角色）；提议方真正提交手动提案时 run → awaiting_approval（T9），其余 open 请求 superseded |
| `decline` | 记录"不愿改变"；若本 run 所有 open 请求都已 decline，写事件 `negotiation_blocked`，run 保持 waiting_human（outcome `blocked`），界面明确显示"在当前约束下无法达成一致"——系统不伪造一致（核心 8） |

## 4.9 邀请与参与者

| 对象 | # | from → to | 触发函数 | 守卫 |
| --- | --- | --- | --- | --- |
| invite | I1 | ∅ → open | `invites.create`（房间创建者，public action → internal mutation） | 角色属于场景且尚无参与者；每角色至多一个 open 邀请（新建会先 revoke 旧的） |
| invite | I2 | open → accepted | `invites.accept`（任意已登录用户，持有明文令牌） | 令牌哈希匹配；未过期；角色仍空缺；该用户在本房间尚无参与者 |
| invite | I3 | open → revoked | `invites.revoke`（房间创建者）、`rooms.close` | — |
| invite | — | 派生 expired | 读取时 `now > expiresAt` | — |
| participant | P1 | ∅ → active | `rooms.create`（创建者）、`invites.accept` | 同 I2；在同一 mutation 内按 `by_room_and_roleKey`、`by_room_and_userId` 先查后插 |

v1 不支持移除参与者或更换角色（F07.4）；若将来支持，必须视为约束变化（必需审批人集合变化，RA-R05）。

## 4.10 两组守卫，互不混用（F04.2）

| 组 | 用在 | 守卫 | 失败时 |
| --- | --- | --- | --- |
| 审批守卫 G-D | `decisions.decide` | G-D1 房间 open；G-D2 调用者是参与者，且其角色在 `proposal.requiredApprovals` 快照中；G-D3 `room.currentProposalId === proposalId`；G-D4 当前活跃 run 为 awaiting_approval 且 `run.currentProposalId === proposalId`；G-D5 `args.expectedConstraintsVersion === room.constraintsVersion` 且 `args.expectedTermsKey === proposal.termsKey`；G-D6（仅 approve）当前可执行；G-D7 该提案未执行 | `ConvexError` 对应码：`ROOM_CLOSED` / `FORBIDDEN_ROLE` / `NOT_CURRENT` / `INVALID_STATE` / `STALE_VIEW` / `NOT_EXECUTABLE` / `ALREADY_EXECUTED`；无任何写入 |
| 执行守卫 G-E | `executeIfReady`（与最后一次 approve 同事务） | G-E1 按集合判定：每个必需（角色, 审批类型）都有一个当前约束版本下最新决定为 approve 的参与者，且这些参与者 userId 互不相同；G-E2 用重新汇总的账本重新评估可执行，且汇总值等于约束快照中的值；G-E3 `operationKey` 未被使用 | G-E1 不满足：只记录决定、不执行；G-E2 不满足：抛 `ENGINE_LEDGER_DRIFT`（不变量被破坏，整个事务回滚）；G-E3 命中：返回已有执行（幂等） |
| 回合持久化守卫 G-A | `applyAttemptResult` | 见 10 part3 §10.6.5 | attempt → stale |
| 认领守卫 G-C | `claimAttempt` | 见 10 part3 §10.6.2 | attempt → skipped / failed |

审批守卫从不读取 turn / attempt；回合守卫从不读取 decisions。两者唯一的交点是 `rooms.constraintsVersion` 与 `rooms.currentRunId`，都只由 `bumpConstraints` 与 `startRunTx` / `supersedeRunTx` 修改。

## 4.11 就绪条件（开始协商的前置守卫，RA-B15、GAP-20）

`scenario.readiness(ruleInput) → { ok: true } | { ok: false; missing: ReadinessGap[] }`，首个场景要求：

1. 三个角色都有 active 参与者；
2. 三个角色都至少有一个已确认的简报版本，且其结构化必填字段齐全（customer：requestedItems、requiredItemKeys、deadline；finance：budgetCapCents；provider：无必填结构化字段，只需确认）；
3. 目录中至少一个 confirmed 条目，且 customer 的 requiredItemKeys 全部能在目录中找到（找不到 → `missing: ["catalog_covers_required"]`，此时应向 provider 请求报价而不是开始协商）；
4. 已记录基线承诺（可以为 0，但必须由 finance 显式确认，见 09 §9.3）。

界面在房间顶部以清单形式展示 `missing`，每项指向负责的角色（"Waiting for Finance to confirm the budget"）。
