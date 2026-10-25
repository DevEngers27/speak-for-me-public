# 07 权限与隐私（part2）：动作×角色、代理上下文、委托条款、公开文本、事件可见性

> 分片清单见 part1。

## 7.4 动作×角色矩阵

| 动作（函数） | customer | provider | finance | 额外条件 |
| --- | --- | --- | --- | --- |
| 创建房间 `rooms.create` | 按 `ROOM_CREATION_POLICY` | 同左 | 同左 | 创建者选择自己的角色 |
| 邀请 / 撤销 `invites.create` / `revoke`；关闭房间 `rooms.close` | 仅创建者 | 仅创建者 | 仅创建者 | 房间 open |
| 接受邀请 `invites.accept` | 任何持令牌的已登录用户 | | | 04 I2 守卫 |
| 保存草稿 / 确认简报 `briefs.saveDraft` / `confirm` | 仅本人 | 仅本人 | 仅本人（含调整预算上限） | 房间 open；字段属于本角色 schema |
| 确认 / 撤回目录条目 `catalog.confirmItem` / `withdrawItem` | — | ✔（`ownsCatalog`） | — | 条目 itemKey 必须在 customer 的 requestedItems 中，或为 term 条目 |
| 记录基线承诺 `ledger.recordBaseline` | — | — | ✔ | 每房间一次 |
| 开始协商 `runs.start` | ✔ | ✔ | ✔ | 就绪；无活跃 run（有则返回它） |
| 恢复失败的 run `runs.resume` | ✔ | ✔ | ✔ | 04 T7 |
| 请求重谈 `runs.requestRenegotiation` | ✔ | ✔ | ✔ | 05 §5.9 |
| 手动提出候选 `proposals.proposeManually` | — | ✔（提议方） | — | 04 T8–T10 |
| 审批 / 拒绝 / 撤回 `decisions.decide` | ✔（terms） | ✔（terms） | ✔（budget） | 角色在提案 `requiredApprovals` 快照内；G-D* |
| 回答人工请求 `requests.answer` | 目标角色 | 目标角色 | 目标角色 | 04 H2 |
| 更新任务状态 `tasks.updateStatus` | — | ✔（被指派角色） | — | 任务属于本房间 |
| 发起简报抽取 `extraction.request` | 本人 | 本人 | 本人 | 10 part6 §10.22 |
| 读取房间数据（全部 query） | ✔ | ✔ | ✔ | 结果经 7.3 投影 |
| seed / reset / 熔断重置 / 故障注入 | — | — | — | 只有 internal 函数，经 CLI 调用（15） |

所有 public 函数第一行是 `requireUser` / `requireParticipant` / `requireRole` 之一；16 的 AU-* 用例对每个 public 函数做"未认证 / 非参与者 / 错角色"三种调用并断言被拒（AC-04）。

## 7.5 代理上下文组装：唯一入口、显式白名单

`assembleAgentContext(ctx, { room, run, turn }): AgentContext` 只在 `claimAttempt` 内调用（10 part3 §10.6.2），返回值只流向 `renderTurnRequest` 与 stub，从不进入任何 public 函数的返回值。

| 字段 | 来源 | 规则 |
| --- | --- | --- |
| `role` | `turn.roleKey` | 由服务端从 turn 推出，不来自任何参数 |
| `room` | rooms | 标题、目标、时区、今天（房间时区）、场景键与版本 |
| `principal` | 本角色参与者的最新确认简报版本 | 结构化字段全部 + `privateNotes`（不可信数据标签内） |
| `sharedFacts` | 其他角色的最新确认简报版本 | 只经 `projectBriefFor(turn.roleKey, v)`——与界面查询用同一个函数；另加本房间已回答请求中的 `share_answer` 公开答案 |
| `budgetView` | `scenario.budgetProjection(turn.roleKey, ruleInput)` | provider 为 null；customer 仅在预算受众内时有值 |
| `catalog` | 本版本有效目录 | 公开字段 |
| `candidates` | `run.candidates` 前 12 个（扣除 excluded） | 公开条款 |
| `currentProposal` | `run.currentProposalId` | 公开条款与版本 |
| `history` | 本 run 已完成回合的 `PublicTurnResult`；触发本 run 的拒绝（理由码，及本人选择公开的备注） | 不含任何 rationale、模型原文、他方请求 |

实现纪律：
1. 用显式对象字面量逐字段构造，不 spread 任何数据库文档；`AgentContext` 类型不含 `any` / `unknown` 字段。
2. 不按 roomId 整表 collect 再在 JS 里过滤简报；按 `by_room_and_roleKey_and_version` 精确取每个角色的最新版本，再投影。
3. 单测 CTX-01：三方简报的每个私密字段写入不同金丝雀串（如 `CANARY-FIN-7731`），对每个角色组装上下文并渲染提示，断言只有本角色的金丝雀出现。

## 7.6 委托条款与披露决定

简报确认页展示委托条款（`delegationTermsVersion = "deleg.v1"`，英文原文由产品定稿，要点如下），确认动作即表示接受，版本写入 `briefVersions`：

1. Your agent negotiates for you by choosing among options that already satisfy every party's hard constraints. It never approves anything; only you can approve.
2. Your agent may tell other parties which option it prefers, using a fixed list of reasons. It never reveals your private values or notes.
3. Other parties' agents will learn which options are feasible, which can hint at the range of your hard constraints, but never the values themselves.
4. Fields you mark as visible are shown to the selected parties exactly as entered.
5. Your brief and these notes are sent to the AI model provider to run your agent (07 §7.12).

逐字段披露控件：每个可选受众的字段旁有 "Visible to: Only me / Customer & Finance / Everyone in the room"（选项由场景 `allowedAudiences` 决定）；侧栏 "What others can see" 由服务端 `briefs.disclosurePreview` 用同一投影函数生成，显示每个他方角色看到的真实内容（RA-U08）。provider 确认目录条目时的提示："Confirmed items and prices become visible to everyone in this room."（ADR-20，Q4）。

## 7.7 对他方可见文本的生成

- 唯一来源：结构化字段 + 模板（I8）。模板是英文字符串表，按（事件类型 / 检查码 / 问题键，查看者能力）选择，能力由投影函数给出（例如 `hasBudgetFigures`、`seesCustomerDeadline`）。
- 渲染发生在 query 中、服务端：`events.list`、`rooms.workspace` 返回渲染好的字符串和安全的结构化字段，**不返回 payload 原文**。
- 同一事件对不同查看者措辞不同，但只存一条事件、只存所有受众都能看的数据（03 §3.12）；需要更多数值的受众另有一条 `roles` 受众事件（例如 `budget_cap_changed` 只发给预算受众）。
- 用户自由文本进入他方视图的只有：目录条目标题与描述（provider 显式确认公开）、requestedItems 标题（customer）、选择公开的拒绝备注。全部有长度上限，按纯文本渲染（React 默认转义），不解释 Markdown / HTML。
- 模型自由文本永远不进入他方视图（I8）。

## 7.8 事件目录与可见性

| 事件类型 | 受众 | payload（只含受众内都可见的数据） |
| --- | --- | --- |
| `room_created`、`participant_joined`、`room_closed` | room | 标题；角色与显示名 |
| `invite_created` | participant（创建者） | 角色、过期时间 |
| `brief_confirmed` | room | 角色、版本、`ruleChanged`（不含字段值） |
| `catalog_item_confirmed` / `catalog_item_withdrawn` | room | itemKey、版本、标题、价格、日期 |
| `constraints_changed` | room | 新版本号、原因类型与角色（不含数值）："Finance updated a constraint (v6 → v7). Proposal v3 needs re-evaluation." |
| `budget_cap_changed`、`baseline_recorded` | roles（finance + 预算受众） | 旧 / 新上限、原因备注；基线金额 |
| `run_started`、`run_awaiting_approval`、`run_waiting_human`、`run_failed`、`run_resumed`、`run_superseded`、`reapproval_required`、`negotiation_blocked` | room | run 序号、触发 / 结局 / 失败码 / 目标角色 |
| `proposal_created` | room | 版本、作者类型与角色、候选键、条目、延后项、交付方式与日期、变更金额 |
| `agent_verdict` | room | 角色、轮次、动作、候选键、理由码 |
| `request_opened` | roles（目标角色） | 问题键与参数（目标可见） |
| `request_answered` | room | 目标角色、选项键；share_answer 时含公开答案 |
| `decision_recorded` | room | 角色、决定、提案版本、约束版本、理由码 |
| `execution_completed` | room | 提案版本、变更单 id、变更金额、任务数 |
| `task_status_changed` | room | itemKey、新状态 |

不做成事件的：简报编辑细节、模型原文、stale attempt、重复执行请求（只进 ops 计数，RA-R09）。私密历史在各自按角色控制的表里（简报版本、回合理由、请求），不需要"私密事件"。
