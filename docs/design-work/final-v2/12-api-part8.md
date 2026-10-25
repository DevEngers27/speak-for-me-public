# 12 · 后端函数目录（part8）：矩阵、不变量、备选与否决、开放问题、与 canon 的对照

## 12.21 动作 × 角色矩阵（公共函数）

记号：✔ 允许；✘ 拒绝（mutation 抛错 / query 返回 null）；◐ 条件允许。矩阵以常量 `ACTION_MATRIX` 存在代码里（07 §7.12），16 的越权测试按它生成：每个 ✘ 都是一条必须失败的用例。

| 函数 | customer | provider | finance | 创建者附加 | 非成员 | 条件 |
| --- | --- | --- | --- | --- | --- | --- |
| `users.viewer` / `users.ensureViewer` / `rooms.create` / `rooms.listMine` / `invites.listMine` | ✔ | ✔ | ✔ | — | 已登录即可 | — |
| `invites.accept` | ✔ | ✔ | ✔ | — | 已登录即可 | 邮箱已验证且匹配，或持有效 token；房间 `setup`；一人一席 |
| `rooms.close`、`runs.requestRenegotiation`、`runs.cancel`、`invites.create`、`invites.createLink` | ✘ | ✘ | ✘ | ✔ | ✘ | 见各条目 |
| `rooms.startFollowUp` | ✔ | ✔ | ✔ | — | ✘ | 旧房间已执行（04 / 07 一致：旧房间任一成员） |
| `rooms.view`、`timeline.page`、`proposals.get`、`catalog.list`、`executions.forRoom` | ✔ | ✔ | ✔ | `rooms.view.seats` 含邀请状态 | null | 全部按查看者投影 |
| `humanRequests.get` | ✔ | ✔ | ✔ | — | null | 选项与回答只给 `toRole`；非 `toRole` 的买方只见 kind、toRole、状态；非 `toRole` 的 provider 只见 `run_waiting` |
| `rooms.previewChange` | ◐ `customer_hard` → `recheck` | ◐ `catalog` → `recheck` | ◐ `cap` → `after` | — | null | 变更种类的所有者 = 查看者 |
| `briefs.confirm`、`briefs.updateSoft`、`briefs.mine`、`turns.mine` | 本人 | 本人 | 本人 | — | ✘ | 只按 `(roomId, 本人角色)`；`briefs.updateSoft` 另需本角色已有已确认简报 |
| `budget.setCap`、`ledger.recordBaseline` | ✘ | ✘ | ✔ | — | ✘ | 基线只在 `setup` |
| `catalog.confirm`、`catalog.retire` | ✘ | ✔ | ✘ | — | ✘ | — |
| `sharedFacts.add` | ✔ | ✘（v1 provider 无可共享字段） | ✔ | — | ✘ | 只能共享本人简报中的 `SHAREABLE_FIELDS` |
| `runs.start` | ✔ | ✔ | ✔ | — | ✘ | 房间 `open`、就绪、无活跃 run、非排空 |
| `runs.retryTurn`、`humanRequests.answer` | ◐ | ◐ | ◐ | — | ✘ | 调用者角色 = 请求的 `toRole` |
| `approvals.record` | ◐ `terms` | ◐ `terms` | ◐ `budget` | — | ✘ | 角色在 `proposal.requiredApprovals` 中 |
| `tasks.markDone` | ◐ | ◐ | ◐ | — | ✘ | 角色 = `task.assigneeRole` |

代理运行时（internal，不经公共入口）能写的表只有 `attempts`、`rawOutputs`、`turns`、`runs`、`proposals`（经 `insertProposal`）、`humanRequests`（经 `openHumanRequestTx`，仅当代码判定需要人）、`spendCounters`、`events`；**永远不能**写 `approvals`、`briefs`、`catalogItems`、`sharedFacts`、`ledgerEntries`、`executions`、`changeOrders`、`tasks`、`members`、`invites`（07 §7.12.3）。`recommend_accept` 只写回合记录与本方 rationale，永不成为审批（核心 2）。

## 12.22 节流与幂等汇总

| 函数 | 节流桶 | 幂等类 | 重复调用的结果 |
| --- | --- | --- | --- |
| `briefs.confirm`、`budget.setCap`、`catalog.confirm`（一批一次）、`catalog.retire` | `constraint_writes` | 自然 | 内容相同 → `unchanged` |
| `runs.start` | `constraint_writes` | 自然 | 已有活跃 run → 返回它（`created: false`） |
| `runs.retryTurn`、`humanRequests.answer` | `constraint_writes` | 自然 | `already_answered` / `request.not_open` |
| `runs.requestRenegotiation` | `constraint_writes` | 状态守卫 | 第二次时 `expectedRunId` 已不符 → `run.invalid_state{run_changed}` |
| `briefs.updateSoft` | `soft_writes` | 自然 | notes 相同 → 返回当前 `briefVersion`，不写行 |
| `rooms.create` | `room_create` | 非幂等 | 新房间（前端禁用按钮） |
| `rooms.startFollowUp` | `room_create` | 派生键 | 返回既有后续房间 |
| `approvals.record` | —（撤回 ≥ 10 次另限） | 自然 + 派生键 | 同决定 → `unchanged`；已执行 → `alreadyExecuted` |
| `invites.accept` | — | 自然 | `already_joined` |
| `invites.create` / `invites.createLink` | — | 非幂等 | 新邀请并取代旧的 |
| `rooms.close`、`runs.cancel`、`tasks.markDone`、`ledger.recordBaseline`、`sharedFacts.add`、`users.ensureViewer` | — | 自然 | `unchanged` |
| `turns.complete` / `turns.fail` / `agents.watchdog` | — | 守卫 G0 | 第二次为空操作，用量只写一次 |
| `clock.rollLocalDate`、`humanRequests.expireDue`、`ops.livenessSweep`、`ops.purgeRawOutputs` | — | 自然 | 无到期项则空操作 |

## 12.23 不变量（API 层）

| # | 不变量 | 落点 |
| --- | --- | --- |
| API-1 | 每个 Convex 函数由构造器定义；公共函数声明 `args` 与 `returns` | 11 L5；构造器类型 |
| API-2 | 公共函数参数没有 `userId` / `role` / `memberId` / `actorUserId` | `arch:check` |
| API-3 | 唯一的公开 action 是 `invites.createLink` | `userAction` 白名单 |
| API-4 | 每个改变房间业务状态的 mutation 都经 `openRoomTx`；`executed` 房间只放行 `tasks.markDone` 与 `rooms.startFollowUp` | 03 SC-05；`RoomTx` 类型强制 |
| API-5 | `approvals` 只由 `approvals.record` 写；代理运行时没有任何写 `approvals` 的路径 | `arch:check` grep；§12.21 |
| API-6 | `executions` 只由 `executeIfComplete` 在 `approvals.record` 同一事务内写；`executionKey = exec:${proposalId}`；执行不递增 cv | 08；对账检查器 R1–R11 |
| API-7 | `rooms.constraintsVersion` 只由 `constraints.bump` 改（调用者只有 `withConstraintChange`、`openIfReady`、`clock.rollLocalDate`）；每次递增恰有一行 `constraintRevisions` | 09 INV-CC-01 |
| API-8 | 公共 query 不读时钟、不写表；未登录 / 非成员 / 不存在返回 null；他方私密值只经 `sharedFacts` 与已确认目录进入 DTO | 构造器；07 PV-05 |
| API-9 | 失败只以 `{ code, params }` 到达浏览器；`params` 按受众裁剪；provider 永不收到预算派生参数 | `withSanitizedErrors`；16 金丝雀 |
| API-10 | 节流桶内的函数成功时恰写一条带 `actorUserId` 的命令事件，按 distinct `commitTs` 计数 | `assertWithinRate` |
| API-11 | `needs_input` 的 run 恰有一个 open 请求；`negotiating` 的 run 要么有在途 attempt，要么回合在停泊 / 延迟中且有恢复路径 | `openHumanRequestTx`、`reconcileRun`、`ops.livenessSweep` |
| API-12 | 代表用户的内部函数带 `actorUserId`；被调度函数从不读身份 | 11 AR-5 |
| API-13 | `seed.*` 在 prod 由 `assertTier` 拒绝；`seed.reset` 只删 `provenance !== "live"` 的行；删除入口只有 `seed.reset` 与 `ops.purgeRawOutputs` | 03 §3.3.2 |
| API-14 | 时间线单索引单次 `paginate`、字符串游标、`EventView` 中无 `payload` / `restrictedRef` / `commitTs` | `timeline.page` |
| API-15 | 后续房间的目录永不含旧执行已交付的 itemKey：`startFollowUp` 不复制、`catalog.confirm` 拒绝重用（`item.duplicate`），因此其任何 `candidateSnapshot` 与提案都不含已交付条目（invariants-06） | §12.6、§12.12；16 CE-112 / CE-168 / TC-EXE-06 |
| API-16 | `ConvexError.data.code ∈ ERROR_CODES = REASON_CODES ∪ API_ERROR_CODES`；`API_ERROR_CODES` 恰为 §12.4 中不属于 `REASON_CODES` 的码 | `withSanitizedErrors`；06 T06-S4 |

## 12.24 备选与否决

| 备选 | 来源 | 否决理由 |
| --- | --- | --- |
| `decisions.decide` 按 `by_proposal_user` upsert | product / runtime 候选、convex-test spike | 覆盖决定违反核心 6；改为只追加（D02） |
| 客户端 `operationId` 防重复执行 | 多份候选 | spike 实测两次点击两条 execution；改服务端派生 `executionKey`（D03） |
| `proposals.proposeCandidate` / `proposeManually` 公共函数 | product / runtime 候选 | 人选候选只经 `humanRequests.answer(choose_candidate)`（D15），避免第二条插入提案的路径与可反复调用的"候选被阻断"预言机 |
| `briefs.previewConfirm` / `lists.previewConfirm` 返回 `feasibleAfter`、`briefs.previewConstraintImpact` | product / runtime 候选 | 无痕、不限频的可行性预言机（评委多条核心 1 反例）；改为 `rooms.previewChange` 角色分支（D12 ②） |
| `sharedFacts.add` 接受自由 value 并在运行时比对他方秘密 | 早期设计 | 自由值是搬运通道，比对结果本身是预言机（07 LP-3）；改为无 value、从本人简报复制 |
| `extraction.request` / `briefs.extractDraft` 公开 action | product / runtime 候选 | LLM 简报抽取列入 17（D26） |
| `invites.acceptLink` 公开 action | 07 早期稿 | 多一个公开 action；哈希可在 mutation 内用可注入实现完成（07 已改为单一 `invites.accept`） |
| `ops.purgeRoom` 用于生产、`ALLOW_DEMO_SEED` | runtime 候选、testing-ops | 生产无 reset，归档是唯一清理（D18） |
| `@convex-dev/rate-limiter` 或在被拒路径写计数器 | techstack X2 退路、product 候选 | 被拒路径的写入随抛错回滚，计数形同虚设（评委反例）；改为对已提交事件计数 |
| 约束写入返回 run 去向 | runtime 候选 | 对 provider 可能多泄露一位；界面读已投影的 `rooms.view` |
| 公开 `usage.roomSummary` | runtime 候选 | v1 成本只在 `ops.metrics`（15）；面向用户的用量视图列入 17 |
| `ops.warmSchemas`：部署后对 25 个结构化输出 schema 变体各发一次付费请求预热 | 05 §5.5.3、早期 12 / 15 | 调用不写 `attempts`、不经美元预留与全局日花费计数，违反"每次模型调用恰一行"（03 §3.8）与 D17 的上限落点；v1 由首个真实回合承担一次编译开销，将来若要预热，必须走与业务调用相同的预留 / 用量 / `attempts` 记账 |

## 12.25 开放问题（含与兄弟章尚未统一之处）

| # | 问题 | 本章默认 | 需要谁确认 |
| --- | --- | --- | --- |
| Q1 | （已关闭）`rooms.by_followsExecutionId` 已在 03 §3.5 / §3.14 登记；`startFollowUp` 只复制未执行的目录项（§12.6） | — | — |
| Q2 | 就绪谓词是否要求至少一个已确认 `kind: "item"` 目录项与基线已录 | 要求（§12.8） | 04 / 09 |
| Q3 | （已关闭）canon D04 已列 `tasks.markDone` 与 `rooms.startFollowUp` 为执行后仅有的两项写入豁免（C45） | — | — |
| Q4 | `choose_candidate` 全视图复核失败会向 customer 暴露"有隐藏约束挡住它"的 1 位 | 接受：受节流约束，候选本就来自 customer 自己的视图 | 07 |
| Q5 | （已关闭）canon §1.6 已把 `ops.setDraining` 改为全部层级 internal（C53） | — | — |
| Q6 | （已关闭）`disclose` 改为 `{ field, toRoles }`：受众 = 该字段最新行受众 ∪ `toRoles`，`toRoles` 在生成选项时写定（clarify 为发问角色，infeasible 回退为尚未获披露的放松角色），不再从 `sourceTurnId` 反推（canon D15、03 §3.9、§12.14） | — | — |
| Q7 | OCC 与房间写锁下 `invites.accept`、`approvals.record`（最后两票）、`runs.start` 的唯一性 | 设计成立，待实测 | 16（spikes §8 #1） |
| Q8 | prod 中 `ConvexError.data` 是否原样到达前端、`logLines` 是否下发 | 按最坏情况设计（D16） | 16（§8 #4、#11） |
| Q9 | `runs.retryTurn` 与 `humanRequests.answer(retry_turn)` 重复 | 保留为别名（canon §1.6 列出），共用 `applyHumanAnswer` | — |
| Q10 | `approvals.record` 的"无可撤回"：08 S10 定为 `unchanged`（03 Q7 曾列 `approval.nothing_to_withdraw`） | `unchanged`，不设新码 | 06（码表） |
| Q11 | （已关闭）`attempts.origin` = `turn_start / auto_retry / retry_turn`（10 已回改） | — | — |
| Q12 | （已关闭）run 的 attempt / 美元上限 → customer 的 `rounds_exhausted`（`questionKey` `call_limit` / `spend_limit`，无 `keep_as_is`；04 R6 / U5、05 §5.8.5、10 B4 / B5、§12.18） | — | — |
| Q13 | （已关闭）`ops.livenessSweep` 每 5 分钟、`ops.activeAttemptCount`（04 / 10 / 15 已同名） | — | — |
| Q14 | （已关闭）canon D18 已改为：`seed.fromFixture` 是 internal mutation，以 fixture 身份为 actor 复用同一入口逻辑；真实部署探针另用 `npx convex run --identity` 调公开函数（OBJ-50） | — | — |
| Q15 | （已关闭）注册函数放 `convex/agents.ts`，实现放 `convex/model/agents/`（10 §10.6 已回改） | — | — |
| Q16 | （已关闭）03 §3.12 已改为 stub 不受排空约束 | — | — |
| Q17 | （已关闭）canon D18、00-invariants INV-63 / CE-156、02 INV-63、01 X8 均已改为：缺省第三份确认按生产路径自动开 run 1（stub）；`stopBeforeRole` 留一方不确认以停在 `setup`；seed 自身永不写提案 / 审批 / 执行（§12.20） | — | — |
| Q18 | provider 能从"哪个买方角色的回合之后出现 `run_waiting`"推出是 customer 侧还是 finance 侧把 run 带进 `needs_input`（privacy-06 的残余） | 接受（D12 每提案 ≤ 1 bit 政策）；07 §7.21 已登记为残余推断 R-10；备选（未采纳）：provider 投影把买方回合合并为一个"Buyer review"阶段（`activeRole` 只取 `provider` / `null`，时间线模板同步） | （已处置：07 R-10） |
| Q19 | （已关闭）`rooms.previewChange` 的形状以 §12.17 为唯一定义；01 F5、16 TC-PRIV-13 与 §16.8 第 013 行、00-invariants INV-11 / CE-013、02 INV-11 与 canon D12 ② 均已按本节改写 | — | — |
| Q20 | （已关闭）06 §6.2 `API_ERROR_CODES` 恰为 §12.4 的 13 个码，`approval.not_executable` 参数为 `reasonCodes`，02 INV-17 / INV-44 已用 12 的 auth 码（names-33） | — | — |
| Q21 | （已关闭）"只复制未交付的目录行，已交付键在后续房间不得重用"（invariants-06）已写入 canon D04、00-invariants INV-52 / CE-112 / CE-168、02 INV-52、08 A9、01 part2，16 TC-EXE-06 / TC-EXE-11 断言后续房间 provider 快照不含旧执行的 itemKey，13 读 `rooms.view.followUpOf.deliveredItems` | §12.6、§12.12、API-15 | — |

## 12.26 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| §1.6 函数名 | 全部采用：`rooms.create/close/view/listMine/startFollowUp`、`invites.create/listMine/accept`、`briefs.confirm/mine`、`budget.setCap`、`ledger.recordBaseline`、`sharedFacts.add`、`catalog.confirm/retire`、`runs.start/retryTurn/requestRenegotiation/cancel`、`turns.beginAttempt/complete/fail`、`runs.reconcile`、`agents.runAttempt/watchdog`、`approvals.record`、`executions.executeIfComplete`、`humanRequests.answer`、`constraints.bump`、`clock.rollLocalDate`、`events.append`、`timeline.page`、`ops.setDraining`、`seed.fromFixture/reset`（§12.5–12.20） |
| §1.5 reasonCode | 错误码与 reasonCode 同一文件同一风格：`ERROR_CODES = REASON_CODES ∪ API_ERROR_CODES`；`API_ERROR_CODES` 恰为新增的 13 个 `auth.*`、`invite.*`、`request.*`、`input.invalid` 与 `internal`；`run.rate_limited { retryAfterMs }`；参数名登记进 06 `PARAM_AUDIENCE`（§12.4、API-16） |
| D02 / D03 | 只追加；`expected*`；同决定 `unchanged`；withdraw 只撤本人 approve；reject 终局；approve 前同事务 `isExecutable`（= 当前性 ∧ `passesChecks`，不含审批集合，08 §8.4.2）；最后一票（`canExecuteNow = isExecutable ∧ allApproved`）同事务执行；`executionKey = exec:${proposalId}`；`approvalIds` 冻结；任务来自 `plannedTasks`；执行不递增；客户端不传幂等键（§12.15、§12.19） |
| D04 | 已执行房间拒绝协商类写入；`startFollowUp` 预分配席位、**只把未交付的**目录行复制为 draft（细化 D04，已交付键在后续房间不得重用，API-15，§12.25 Q21）、基线预填需确认；审批由快照显示；后续房间以 `rooms.view.followUpOf` 只读显示已交付条目（§12.6、§12.12、§12.17） |
| D05 / D06 / D22 | 约束写入经 `withConstraintChange` 硬投影比较；标题与模板不递增；`setup` 不递增、打开时 cv 1；supersede + 不动点；同一 `proposalId` 重批；query 不读时钟，`clock.rollLocalDate` 结论翻转才递增（§12.8、§12.20） |
| D07 / D08 / D09 / D10 | G0–G3 与 reconcile；看门狗以 `attemptId` 读 `_scheduled_functions`；provider 被阻断不花评估调用；schema 在 action 内构造；`stream().finalMessage()`；只在快照内解析 `optionKey`（§12.18） |
| D11 / D12 / D13 / D14 | `projectForRole` 与 `sharedFacts` 唯一跨角色通道；provider 只见 `fit: ok \| blocked`；`previewChange` 角色分支（§12.17 唯一定义：非所有者 `null`、本角色变更 `recheck`、finance 改上限 `after` / `rejected`）；`checks` 只带服务端渲染的 `text`、无开放 `params` record；他方回合失败不入 DTO（privacy-06，残余推断见 Q18）；节流 ⑥；`run_waiting` ⑦；披露闸门与日期窗口 ⑧；公共文本只由模板渲染；事件全员可读 + `restrictedRef`（§12.2、§12.11、§12.17） |
| D15 | 请求结构与 8 种效果的出口；先置 answered 再执行；无选项映射到 `rooms.close`；7 天过期 cron；回合失败走 `agent_failed`（§12.14、§12.20） |
| D16 / D17 / D18 | `{ code, params }` 与 `withSanitizedErrors`；节流、`maxAttempts`、美元预留 / 结算、全局日额度 `deferred`、`draining` 只停泊 live；seed 走生产入口、缺省终点为"run 1 已由第三份确认开始"、`stopBeforeRole` 终点为 `setup`（D18 原文的中间态不可达，Q17）、reset 按层级与部署名守卫（§12.2、§12.18、§12.20） |
| D23 / D24 / D25 / D26 | 上限低于已承诺直接拒绝；邮箱定向 + fragment 链接、一人一席、`emailVerified`；`termsKey = canonicalJson(terms)` 与快照；无抽取 action（§12.7、§12.10、§12.24） |
