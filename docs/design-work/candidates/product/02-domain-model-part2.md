# 02 领域模型（part2）：不变量清单与落点

> "落点"列写明由哪个函数、哪个索引或哪个测试守护。函数名见 12，索引见 03，测试见 16。所有"逻辑唯一"都靠**单一写入口 mutation 内按索引先查后写 + OCC**（04 平台约束 1.6），不存在绕过入口的写路径。

## 2.6 身份与成员

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-1 | 每个公共函数的调用者身份只来自 `ctx.auth.getUserIdentity().tokenIdentifier` → `users`；业务函数不接受 `userId`、`roleKey`、`seatId` 作为"我是谁"的参数 | `convex/engine/authz.ts#requireViewer/requireSeat`；16 鉴权用例 |
| I-2 | 每个 `(roomId, roleKey)` 恰好一个席位；每个席位至多一个用户；每个用户在一个房间至多一个席位 | `rooms.create` 一次性建席位；`invites._accept` 在同一 mutation 内查 `seats.by_room_user` 与席位状态；索引 `by_room_role`、`by_room_user` |
| I-3 | 不同必需签核角色必须由不同用户签出 | 由 I-2 推出；执行时再断言 `distinct(userId)`（防御性） |
| I-4 | 已关闭房间只读 | 所有写函数入口 `assertRoomOpen` |

## 2.7 简报、清单、台账与约束

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-5 | 简报版本不可变；`(seatId, version)` 唯一且从 1 连续 | `briefs.confirm` / `briefs.quickUpdate` / `requests.answer` 都经 `convex/engine/briefs.ts#appendBriefVersion`：读 `by_seat_version` 的最大版本 + 1 后插入 |
| I-6 | 清单项：`(roomId, listKey, itemKey, version)` 唯一；同一 itemKey 至多一个 confirmed、至多一个 draft；confirmed 的 `data` 不再修改 | `lists.saveDraft`、`lists.confirm`、`lists.withdraw` 经 `convex/engine/lists.ts`；索引 `by_room_list_key_version` |
| I-7 | `rooms.constraintsVersion` 只经 `bumpConstraints` 改变，单调 +1；每个版本恰有一条 `constraintRevisions` | `convex/engine/constraints.ts#bumpConstraints` 是唯一写入口；代码审查规则 + 测试"任何 patch rooms.constraintsVersion 的调用只出现在此文件"（lint 规则） |
| I-8 | 规则字段、已确认清单项、台账任一变化都必须递增约束版本；偏好字段、备注、披露变化不得递增 | `appendBriefVersion` 比较规则字段规范化摘要 `ruleDigest`；`lists.confirm/withdraw`、`ledger.*` 无条件调用 bump |
| I-9 | （场景 scope_change）台账总额始终 ≤ 当前预算上限 | `briefs.*` 写 finance 上限时守卫 `CAP_BELOW_COMMITTED`；`ledger.addBaseline` 守卫；执行事务内预算检查 |
| I-10 | 可执行性（executable）永远实时计算，不以任何存储值为准 | `engine/evaluate.ts#evaluateProposal` 被所有调用点调用；`proposals.creationChecks` 只读于审计 |

## 2.8 提案与签核

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-11 | 提案条款不可变；只有 `status`、`supersededAt`、`supersededByProposalId` 可改 | `convex/engine/proposals.ts` 只暴露 `insertProposal` 与 `setStatus` |
| I-12 | `proposals.version` 来自 `rooms.proposalSeq + 1`，在插入的同一 mutation 内分配，永不重置；`(roomId, version)` 唯一 | `insertProposal`；索引 `by_room_version` |
| I-13 | 每房间至多一个 `active` 提案，且等于 `rooms.currentProposalId` | `insertProposal` 在同一事务把旧的当前提案置 `superseded`；执行把它置 `executed` 并清空指针 |
| I-14 | 提案只在其全部检查（引擎 + 场景）于创建时的约束版本下通过时才能被创建 | `insertProposal` 内部调用 `evaluateProposal`，任何失败抛 `CANDIDATE_BLOCKED` |
| I-15 | 签核只追加；某席位对某提案的"当前状态"= 该席位在**当前约束版本**下的最新一条决定（withdraw 视为未决） | `engine/signoff.ts#signoffStates` |
| I-16 | approve 只能记录在：当前提案、status active、当前约束版本下可执行、`expectedConstraintsVersion` 与 `expectedTermsKey` 匹配 | `decisions.record` 的守卫（04 第 4.6 节） |
| I-17 | reject 与 withdraw 不要求可执行，但要求提案为当前且未执行；withdraw 只能撤回自己在当前约束版本下的 approve | 同上 |
| I-18 | 代理的 `recommend_accept` 永远不写 `decisions` | `runtime.completeTurn` 只写 turns/events；`decisions` 的唯一写入口是 `decisions.record` 与 `requests.answer`（`alsoApprove` 时，以本人身份） |

## 2.9 执行

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-19 | 执行只在：提案为当前且 active、全部检查在当前视图下通过、提案快照中的每个必需签核席位在当前约束版本下最新决定为 approve | `convex/engine/execution.ts#executeIfComplete`，与最后一次 approve 同一事务 |
| I-20 | 每个 `(proposalId, constraintsVersion)` 至多一条执行；每个提案至多执行一次 | 主防线：`proposal.status === "active"` 守卫；辅助：`executions.by_operation` 先查后写，`operationKey = "exec:" + proposalId + ":" + constraintsVersion` |
| I-21 | 执行记录、承诺、任务、提案状态、约束递增在同一事务提交；重复调用返回已有执行 | `executeIfComplete`；16 并发脚本 |
| I-22 | 执行只写内部表；不调用任何外部系统 | 架构规则：执行模块不得导入 action/HTTP 客户端（lint） |

## 2.10 协商运行

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-23 | 每房间至多一个 `running` 或 `stalled` 的 run，等于 `rooms.activeRunId` | `negotiation.startRun`（internal helper）检查 `activeRunId` 为空；run 结束时同事务清空 |
| I-24 | 回合结果只有在满足全部持久化守卫时才落库：回合 `running`、在 `run.openTurnIds` 中、run 是房间的 active run、`room.constraintsVersion === run.constraintsVersion` | `runtime.completeTurn`；否则回合 `stale` |
| I-25 | 模型输出不含身份、版本、金额、日期；信封字段全部来自回合快照 | 05 的 schema 中不存在这些字段；`completeTurn` 不读取模型回显 |
| I-26 | 只有就绪的房间才能开始 run；无可执行候选时不调用模型 | `startRun` 调用 `plugin.readiness` 与 `analyzeFeasibility` |
| I-27 | 每房间模型调用次数有上限；全局开关关闭时不发起调用 | `runtime.reserveCall`（internal mutation，原子 +1 并检查） |

## 2.11 隐私与文本

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-28 | 任何 query 的返回值不含对查看者未披露的私密字段或由其直接计算出的数值（披露基线中的检查结论除外） | 每个公共 query 声明 `returns` 校验器；投影函数 `engine/projection.ts`；16 金丝雀扫描 |
| I-29 | 席位 S 的代理上下文只含：S 的最新确认简报、披露给 S 的字段与派生事实、公开清单与提案、模板化的历史 | `runtime.getTurnInput`（internal query）是唯一组装入口；单测断言他方金丝雀不出现 |
| I-30 | 对他方可见的文本只由模板从结构化字段生成；代理 rationale 只对本席位可见，且不进入任何其他代理的上下文 | 事件 payload 无自由文本字段（共享说明除外，见 I-31）；`turns` 只能经 `history.myAgentNotes` 按席位读取 |
| I-31 | 唯一跨席位的自由文本是人亲自写并标为共享的 `sharedNote`；它进入他方代理上下文时位于不可信数据定界块内 | `briefs.confirm` 长度上限；10 的上下文模板 |
| I-32 | 事件 payload 只含 id、枚举、版本号与公开金额，不含私密值 | `events` 的 payload 校验器没有私密字段；16 扫描 |

## 2.12 人工请求与标注

| id | 不变量 | 落点 |
| --- | --- | --- |
| I-33 | 请求只能由目标席位的用户回答；回答前再次检查 `status === "open"` 与 `constraintsVersion` 未变 | `requests.answer` |
| I-34 | 任何约束变化都关闭全部 open 请求：若变化由目标席位按某选项意图完成 → `answered`，否则 → `superseded` | `bumpConstraints` |
| I-35 | `rooms.isSimulated` 决定整房是否模拟；真实房间不接受 fixture 写入；stub 代理产生的回合与提案带 `agentMode: "stub"` | `ops/seed.ts` 只能新建模拟房间；`startRun` 记录 `agentMode` |
| I-36 | 任务只由执行派生；只有被指派席位能改状态 | `executeIfComplete`；`records.updateTask` |
