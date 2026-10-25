# 01 产品（part4）：横切体验与旅程追溯

## X1 代理失败与重试

| 情况 | 系统行为 | 用户看到 | 用户能做 |
| --- | --- | --- | --- |
| 回合超时 / 5xx / 429 | 应用级自动重试 1 次（新 attempt，10 第 10.5 节） | 进度条 "Provider agent retrying…" | 等待 |
| 两次 attempt 都失败 | run → `stalled`，写 `run_stalled` 事件 | "Provider agent couldn't finish (timed out twice). [Retry] [Stop negotiation] [Choose an option myself]" | 任一成员 `negotiation.retryRun`；`negotiation.cancelRun`；有 `proposal.author` 能力的席位从候选浏览器手动提出 |
| 模型拒答（`refusal`）或输出无法通过校验两次 | 同上，原因码 `AGENT_REFUSED` / `AGENT_OUTPUT_INVALID` | "The agent could not produce a valid move." | 同上 |
| 400 请求错误（配置 bug） | 不重试，run `stalled`，运维告警 | "Agents are temporarily unavailable." | 同上；运维修复后重试 |
| 运维关闭 `AGENTS_ENABLED` | 新 run 不启动（`AGENTS_DISABLED`），进行中的回合在下一次调用前停止 | 横幅 "Agents are paused by the operator. You can still edit briefs, choose options yourself and approve." | 人工路径照常 |

**"Choose an option myself"**：打开候选浏览器（按本人可见约束过滤的候选，与本方代理看到的集合相同），选择后 `proposals.proposeCandidate({roomId, candidateKey, expectedConstraintsVersion, alsoApprove})` 生成人提出的提案。若该候选未通过本人不可见的约束，返回按角色投影的原因（例如 provider 只看到 "Exceeds the finance limit"），与代理受到的有界推断披露相同（07）。这保证模型不可用时流程仍能走完。

## X2 迟到的模型结果

- run 2 的 provider 回合正在调用模型时，Priya 又改了一次预算 → 约束递增 → run 2 被标记 `superseded`，room.activeRunId 清空 → 稍后模型结果到达，`runtime.completeTurn` 的持久化守卫拒收 → 回合 `stale`，只记录用量与原因，写全房间事件 "An agent result was discarded because constraints changed."；run 3 由新的约束变化自动启动。
- 用户不会看到基于旧约束的提案。

## X3 审批与约束变化同时发生

- Maya 点接受的同时 Priya 提交了预算下调。两个 mutation 读写同一个 room 文档，OCC 让后提交者重试：
  - 若 Priya 先提交：Maya 的 mutation 重试时发现 `expectedConstraintsVersion` 不符 → 抛 `CONSTRAINTS_CHANGED`，什么都不写；界面："Constraints changed while you were approving. Nothing was recorded. Review the latest proposal."
  - 若 Maya 先提交：接受记录在 v6 上，随即因 v7 变成 `stale_approve`。
- 两种结果都不会产生"批准了一个看不到的版本"。

## X4 最后两个签核并发

- 两个席位同时点最后的签核：完成判定读取该提案全部签核的索引区间，并发插入会造成 OCC 冲突，后者重试时看到前者的记录并完成执行；执行前再按 `operationKey` 查重。结果：恰好一条执行记录、一条承诺、N 条任务，两个客户端都收到同一个 `executionId`（真实部署并发测试见 16）。

## X5 断线重发与连点

- Convex 客户端重连后重发在途 mutation；`decisions.record` 对"同席位、同提案、同约束版本、同决定"返回 `already_recorded`；执行后再收到 approve 返回 `{status:"executed", executionId}`。
- 邀请接受是 action，断线时直接失败（04 平台约束 1.11），用户再点一次；内部 mutation 对"同一用户已持有该席位"返回成功。

## X6 无路可走

- 取舍请求全部被拒（例如 finance 选 "Keep $4,400"，provider 选 "I can't offer anything else"）→ 派生阶段 `blocked`，工作台解释："No option fits the room's constraints, and the people asked declined to change them."
- 出口：任何人修改自己的简报或清单（会自动重新预检）；任何人 `negotiation.requestRun`（若仍无解，直接返回新的取舍请求，不调模型）；房主关闭房间。代理不会在无变化时反复运行。

## X7 邀请与席位

- 邀请过期 → 房主重新邀请（旧令牌自动 revoked）。v1 不支持移除成员或换人（17）；房主可撤销尚未接受的邀请。
- 一个用户在一个房间只能占一个席位；房主身份不带来额外审批权。

## X8 模拟模式与 fixture 房间

- seed 出来的房间整房标记 `isSimulated`，横幅 "Simulated room · seeded from fixture scope_change/standard"；报价行徽章 "Simulated quote"；stub 代理的回合与提案徽章 "Simulated agent"。
- 真实房间与模拟数据不混用：`isSimulated` 在房间上决定，子记录继承，不能在真实房间里插入 fixture 数据（15）。
- 预置的阶段快照（例如"v2 待批"）只能通过在 stub 模式下真实跑一遍流程得到，不直接写中间状态。

## X9 关闭房间

- 房主 `rooms.close` → 房间只读；进行中的 run → `cancelled`；未关闭请求 → `cancelled`；未执行的提案保持原样（不可再签核）；历史全部保留。

## X10 多标签页、登出

- 同一用户多标签页同时在线，订阅各自实时更新；草稿用 `basedOnVersion` 乐观并发。
- 登出后所有 query 返回 `null`（未认证不抛错），界面回到登录；前端不把 query 结果写入 localStorage。

## X11 旅程 → 函数 / 表 / 事件追溯

| 步骤 | 函数（12） | 写入表（03） | 事件类型 |
| --- | --- | --- | --- |
| C1 建房 | `rooms.create` | rooms, seats, briefDrafts | room_created, seat_joined |
| C2/P1 邀请与加入 | `invites.create` / `invites.accept` | invites, seats | invite_created, seat_joined |
| C3/P2 清单确认 | `lists.saveDraft`, `lists.confirm` | listItems, constraintRevisions, rooms | list_items_confirmed, constraints_changed |
| C4/P3/F2 简报确认 | `briefs.saveDraft`, `briefs.previewConfirm`, `briefs.confirm` | briefDrafts, briefVersions, constraintRevisions, rooms | brief_confirmed, constraints_changed |
| F3 台账基线 | `ledger.addBaseline` | commitments, constraintRevisions, rooms | ledger_changed, constraints_changed |
| C6 协商 | `negotiation.afterConstraintChange`（internal）→ `runtime.runTurn` → `runtime.completeTurn` | runs, turns, proposals, rooms | run_started, agent_proposed, agent_stance, run_finished |
| C7/F6 签核与执行 | `decisions.record` | decisions；完成时 executions, commitments, tasks, proposals, rooms, constraintRevisions | decision_recorded, execution_completed, constraints_changed |
| F5 下调预算 | `briefs.quickUpdate` | briefVersions, constraintRevisions, rooms, runs, humanRequests | brief_confirmed, constraints_changed, run_finished |
| C9b/F7 回答请求 | `requests.answer` | humanRequests；按选项写 briefVersions 或 proposals/decisions | request_closed, 及其引发的事件 |
| X1 重试 | `negotiation.retryRun` | runs, turns | run_resumed |
| P8 任务 | `records.updateTask` | tasks | task_updated |
