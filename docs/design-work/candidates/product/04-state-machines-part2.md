# 04 状态机（part2）：提案与签核

## 4.5 提案 proposal

### 存储状态

| 从 | 到 | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| — | `active` | `runtime.completeTurn`（代理 propose 选中可执行候选） | 系统（代理回合） | G-PERSIST；候选键 ∈ `turn.allowedCandidateKeys`；G-EVAL（I-14） | `insertProposal`：分配版本、旧当前提案 → `superseded`、`room.currentProposalId`、`run.lastProposalId`、事件 `proposal_created` |
| — | `active` | `requests.answer`（`choose_candidate`） | 目标席位本人 | G-REQ；G-EVAL（失败 → `CANDIDATE_BLOCKED`，请求保持 open） | 同上；`author.kind = "human"`；`alsoApprove` 时同事务记录本人 approve；同组 preference 请求 → `superseded` |
| — | `active` | `proposals.proposeCandidate` | 具备 `proposal.author` 的席位 | G-AUTH；G-OPEN；`room.negotiationOpen`；候选键属于本人作用域视图的候选（`CANDIDATE_UNKNOWN`）；G-EVAL（`CANDIDATE_BLOCKED`，返回按角色投影的原因码）；若有 running/stalled run → 先 `finishRun(cancelled)` | 同上 |
| `active` | `superseded` | `insertProposal`（新提案） | 系统 | — | `supersededAt`、`supersededByProposalId` |
| `active` | `executed` | `executeIfComplete` | 系统（最后签核者的事务） | G-SIGN；G-EVAL；签核集合完成 | `room.currentProposalId` 清空 |

`superseded` 与 `executed` 是终态。提案没有 `blocked`、`rejected` 存储状态。

### 派生状态（读时计算）

| 派生 | 判定 |
| --- | --- |
| `executable` | `status === "active"` 且 G-EVAL 通过 |
| `blocked` | `status === "active"` 且 G-EVAL 失败；原因 = 失败检查（按查看者投影） |
| `rejected_by` | 当前约束版本下最新决定为 reject 的席位集合（不阻止执行：那些席位可以改为 approve） |

一个被 reject 的提案仍是当前提案，直到新提案出现；这样"拒绝后又改主意"不需要重建提案。

## 4.6 签核 decision（只追加记录，派生每席位状态）

### 每席位派生状态

`pending`、`approved`、`rejected`、`stale_approve`、`stale_reject`，判定见 03 第 3.14 节。界面对 stale 解释："You accepted v1 under constraints v6 — constraints are now v7."

### `decisions.record` 的守卫与结果

参数：`{ proposalId, kind: "approve" | "reject" | "withdraw", expectedConstraintsVersion, expectedTermsKey, reasonCode?, note? }`。

| kind | 守卫（按顺序，第一个失败即抛错，整笔不写） | 幂等短路 | 写入 | 后续 |
| --- | --- | --- | --- | --- |
| approve | G-AUTH；G-OPEN；提案存在（`INVALID_INPUT`）；`status === "executed"` → 若本房间已有该提案的执行则返回 `{status:"executed", executionId}`；提案非当前或非 active → `PROPOSAL_NOT_CURRENT`；`expectedConstraintsVersion` 不符 → `CONSTRAINTS_CHANGED`；`expectedTermsKey` 不符 → `TERMS_CHANGED`；席位不在 `requiredSignoffs` → `ROLE_NOT_PERMITTED`；G-EVAL 失败 → `PROPOSAL_NOT_EXECUTABLE` | 该席位在当前约束版本的最新决定已是 approve → 返回 `{status:"already_recorded"}`（仍会尝试 `executeIfComplete`，覆盖"上次提交后执行未发生"的极端情况） | 追加 decision（`signoffKind` 取自快照）；事件 `decision_recorded` | 同事务 `executeIfComplete`（08）；返回 `{status:"recorded"}` 或 `{status:"executed", executionId}` |
| reject | G-AUTH；G-OPEN；当前且 active（`PROPOSAL_NOT_CURRENT`）；版本与 termsKey 匹配；`reasonCode` ∈ 场景 `rejectReasonCodes`（`INVALID_INPUT`）；`note` ≤ 500 | 最新决定已是相同原因的 reject → `already_recorded` | 追加 decision；事件（只含原因码） | `ctx.scheduler.runAfter(0, internal.negotiation.afterRejection, {roomId, proposalId, constraintsVersion})` |
| withdraw | G-AUTH；G-OPEN；当前且 active；版本匹配；该席位当前最新决定为 approve（否则 `INVALID_INPUT`） | — | 追加 decision；事件 | 无 |

- 拒绝不要求可执行（人永远可以说不，RA-R06）；批准要求可执行（不让人批准一个不能执行的版本）。
- 执行后对该提案的任何 decision 都返回 `ALREADY_EXECUTED`（approve 除外，见上表的幂等返回）。
- `note` 只对本席位与本方代理可见（07）；事件与他方视图只有原因码。

### `negotiation.afterRejection`（internal mutation，调度执行）

1. 读房间；若 `room.constraintsVersion !== args.constraintsVersion` 或 `room.currentProposalId !== args.proposalId` 或已有 active run → 什么都不做（已有更新的状态接管）。
2. 把被拒提案的 `candidateKey` 加入本约束版本的排除集合（存于新 run 的 `excludedCandidateKeys`；同一约束版本内的多次拒绝累积，来源是 `decisions` 中该约束版本的 reject 记录）。
3. 预检：`analyzeFeasibility(view, excluded)`；有可执行候选 → `startRun(trigger:"rejection")`；否则 → `openTradeoffRequests`（09 第 9.6 节），被排除的候选在分析中视为不可行。
4. 若同一约束版本内由拒绝触发的 run 已达 3 次 → 不再自动开 run，改为向拒绝者发 `preference` 请求（列出最多 3 个其作用域内的可执行候选与 "None of these"），防止"拒绝 → 新提案 → 再拒绝"的无限循环。

### 为什么签核不设独立存储状态

- 备选：approvals 表上存 `status: valid | stale | revoked` 并在约束变化时批量更新。
- 否决理由：约束变化时要批量改写旧记录，既违反"只追加"，又在大房间产生写放大；派生判定只需比较两个整数，读时成本可忽略（F04.5）。
