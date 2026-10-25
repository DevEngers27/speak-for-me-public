# 12 · 后端函数目录

> 分片：`12-api.md`（§12.0–12.4 目标、决定、通用约定、构造器层、错误码）→ `12-api-part2.md`（§12.5–12.7 users / health、rooms 写入、invites）→ `12-api-part3.md`（§12.8–12.12 约束写入流程、briefs、budget、ledger、sharedFacts、catalog）→ `12-api-part4.md`（§12.13–12.16 runs、humanRequests、approvals、tasks）→ `12-api-part5.md`（§12.17 房间与协商视图 query）→ `12-api-part6.md`（§12.18–12.19 代理运行时 internal 函数、事务内 helper）→ `12-api-part7.md`（§12.20 cron、运维、隐私与 seed）→ `12-api-part8.md`（§12.21–12.26 矩阵、不变量、备选与否决、开放问题、与 canon 的对照）。
> 底稿：`candidates/product/12-api*.md`（函数目录、返回、幂等）、`candidates/runtime/12-api*.md`（internal 与 `actorUserId`）。依据：canon §1.6、D02–D07、D12、D14–D18、D22–D25；`deepdives/idempotent-execution-part2.md` §2.2–2.3；techstack D08/X2/X3/X4；spikes §1、§7 12 段；架构见 11（构造器 §11.6）。**字段、索引与数据层 helper 以 03 为准**（写门面与房间写锁 §3.3、唯一写入口 §3.13），状态迁移以 04 为准，运行时语义以 10 为准，披露语义以 07 为准；本章给出每个函数的参数、返回、守卫顺序、读写表、幂等与失败码，并在 §12.25 列出与兄弟章仍未统一之处。

## 12.0 目标

1. 函数名与 canon §1.6 一一对应；canon 未命名、但实现与兄弟章所必需的函数按同一风格补齐，并逐个说明用途。
2. 每个函数写清：构造器（即鉴权方式）、`args` 与 `returns` validator、守卫顺序、读写哪些表、幂等性、失败码。前端、测试与 07 的动作 × 角色矩阵都从本章取数。
3. 公共面最小：浏览器只能调用 query 与 mutation；唯一的公开 action 是邀请链接 token 生成（D24）。
4. 失败一律是 `ConvexError({ code, params })`，`code` 与 reasonCode 同一命名空间、同一源文件，`params` 按调用者受众裁剪（D16）。

## 12.1 决定一览

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| B1 | 函数名以 canon §1.6 为准；补充函数（`users.viewer` / `users.ensureViewer`、`health.ping`、`invites.createLink` / `invites.insertLink`、`catalog.list`、`proposals.get`、`turns.mine`、`executions.forRoom`、`tasks.markDone`、`humanRequests.expireDue`、`agents.loadTurnContext`、`ops.*`、`privacy.redact`）沿用"领域.动作"风格；13 的页面需求由 `rooms.view`（含 `members` / `seats`）与这些 query 承担，不另设 `members.view` / `proposals.detail`（13 §13.8.3） | 命名一致，测试与矩阵可机械生成 | 候选里的 `decisions.decide` / `requests.answer` / `rooms.workspace` 等旧名（canon 废弃） |
| B2 | 每个函数归属一个构造器（§12.3），鉴权由构造器在调度前完成；被调度函数显式带 `actorUserId` | 鉴权不可遗漏；被调度函数内 `getUserIdentity()` 为 null（spike 实测） | 函数内手写鉴权 |
| B3 | 无公开 action，唯一例外 `invites.createLink`（安全随机数在 action 生成）；链接接受仍走 `invites.accept` mutation | action 断线即失败且不重发（inputs/04 §1.11）；mutation 有事务与安全重发 | 抽取、模型调用、链接接受暴露为公开 action |
| B4 | 错误码与 reasonCode 共用 `core/engine/reasonCodes.ts`：`ERROR_CODES = [...REASON_CODES, ...API_ERROR_CODES]`（06 §6.2，两数组不相交），`ConvexError.data.code` 的 validator 与 Zod enum 都由 `ERROR_CODES` 派生；`API_ERROR_CODES` 是 canon §1.5 域之外新增的 API 域 `auth.*`、`invite.*`、`request.*`、`input.*` 与顶层 `internal`，成员**恰为** §12.4 中不属于 `REASON_CODES` 的 13 个码，§12.4 是它们的语义表 | 前端只按 `code` 映射文案；一个来源派生 Convex validator 与 Zod enum | 大写下划线码（canon 废弃）；错误码与 reasonCode 分两套 |
| B5 | `approvals.record` 必带 `expectedConstraintsVersion` 与 `expectedTermsKey`（D02）；四个约束写入函数（`briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`）带 `expectedConstraintsVersion` | 人批准的是"这一版条款 × 这一版约束"；约束写入前展示的影响预览必须与提交时同一 cv（D19） | 无 expected 参数（TOCTOU）；草稿 revision 乐观锁（草稿不入库） |
| B6 | 客户端从不传幂等键；幂等来自状态守卫与服务端派生键（`executionKey = exec:${proposalId}`） | 客户端 operationId 实测写出两条 execution（D03） | 客户端 uuid |
| B7 | 五个节流桶：`constraint_writes`（D12 ⑥，每用户每房间每小时 ≤ 6）、`soft_writes`（`briefs.updateSoft`，每用户每房间每小时 ≤ 30）、`price_writes`（每房间 open 期间每 24 小时 ≤ 3 批改价 / 改工期 / 新增 / 撤下，且每个 open run 内同一 itemKey 改价 ≤ 1 次；`budget.setCap` 与 customer 硬字段变更共用每房间每 24 小时 ≤ 6 次的子桶）、`run_starts`（每房间每 24 小时 ≤ 6 个 run，含 `react()` 自动开局）与 `room_create`（techstack X2）；另有 08 的每人每提案 approve 行上限。计数源是已提交的事件或房间行，零依赖（07 §7.13：D12 ⑥ 只能减速、不能堵住 DX-2 的预检 1 bit 信道，总量桶把它压成每房间每天有限的 bit 数） | 堵住零成本预言机与滥用；v1 不装 rate-limiter 组件（D17） | `@convex-dev/rate-limiter`；在被拒路径写计数（会随抛错回滚） |
| B8 | query 永不读时钟；过期、跨午夜一律由 mutation / cron 以 `Date.now()` 权威判定（D22）；规则一律读 `rooms.localDate` | 缓存语义；显示与执行结论同源（09 §9.6.7） | query 内 `Date.now()` |
| B9 | 事件读取单索引、单次 `.paginate()`，游标是字符串，`commitTs` / `seq` 不进任何 DTO（D14、techstack X3） | 一个查询只允许一次 paginate；bigint 不出边界 | 双索引合并分页（候选，评委指出不可实现） |
| B10 | `rooms.previewChange` 按角色分支：只有 finance 改上限拿到 `verdictAfter`（且只含当前提案的预算检查，不做 feasibility 枚举），其他角色只拿 `recheck`；非所有者返回 `null`（D12 ②；形状以 §12.17 为唯一定义，07 / 09 / 13 / 14 只引用） | 预览 query 不留痕、不限频，不能成为他方私密约束的预言机 | 对所有角色求值（frontend-ia review r01） |
| B11 | `seed.*` 只在 dev / preview（`assertTier`）；`ops.*` 全部是 internal（只经 CLI 与部署 admin 权限），其中破坏性操作只在 dev / preview | 生产没有 reset；`rooms.close` 是 `setup` / `open` 房间唯一的清理，`executed` 房间保持只读（D18、04 M6）；运维 `privacy.redact` 只覆写 PII、不删行（§12.20） | 生产 demo seed；公开运维按钮 |
| B12 | 参数不能用 `undefined` 表达删除；"可为空"一律 `v.union(x, v.null())` 并显式传 `null`；`v.optional` 只用于"缺省即默认值"的参数 | 经参数传入的 `{ f: undefined }` 会被丢弃成空 patch（spike 实测） | `v.optional` 表达删除 |
| B13 | 每个改变房间业务状态的 mutation 在第一次写之前调用 03 的 `openRoomTx(ctx, roomId, { allow })`（房间写锁 M-ROOM：`rooms.writeSeq + 1`）；`allow` 默认 `["setup", "open"]` | 同房间"先查后写"在 OCC 下确定地串行；房间状态守卫与写锁合一（03 SC-05） | 只靠索引区间读冲突（未在真实部署验证，spikes §8 #1） |

## 12.2 通用约定

1. **身份只来自 `ctx.auth`**：参数里没有 `userId`、`role`、`memberId`、`actorUserId`；目标实体 id（`roomId`、`proposalId`、`requestId` …）允许。内部函数代表用户行事时带 `actorUserId`，由调度它的 mutation 在鉴权后填入。
2. **null 与抛错**：公共 query 对未登录、未建档、非成员、目标不存在一律返回 `null`（不可区分，防探测）；mutation 抛 `ConvexError({ code, params })`。
3. **`returns` 必填**：每个公共函数声明 `args` 与 `returns`；返回值只由 `convex/model/views/*` 逐字段构造（禁止展开），`returns` 只作测试期探测器。
4. **守卫顺序固定**：构造器鉴权 → 目标存在与归属 → `openRoomTx` 的房间状态白名单（`run.invalid_state{guard:"room_status"}`）→ run 状态 → `expected*` 比较 → 角色专属前置 → 输入值校验（金额、日期、长度、目录成员关系）→ 节流（只对会产生写入的路径）→ 写入。第一个失败的守卫决定错误码；之前没有任何写入。只读快速路径（`unchanged`、`already_*`）在 `openRoomTx` 之前返回，不占写锁。
5. **抛错 vs 返回**：被拒绝、没有写入的情况一律抛错（事务回滚）；"与当前状态相同"的重复调用返回 `{ status: "unchanged" }` 之类的成功值，不写行、不写事件、不计入节流。
6. **幂等分类**（每个函数在其条目中标注）：**自然幂等**（重复调用得到 `unchanged` 或同一结果）；**派生键幂等**（`executionKey`、`followsExecutionId`）；**非幂等**（`rooms.create`、`invites.create`、`seed.fromFixture`：每次产生新行，前端提交后禁用按钮）。在途 mutation 断线后由 Convex 客户端安全重发并在后端去重；用户连点两次是两次独立调用，由上面三类保证（inputs/04 §1.11）。
7. **节流**（03 §3.11.3）：`constraint_writes` 桶覆盖 `briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`、`runs.start`、`runs.requestRenegotiation`、`runs.retryTurn`、`humanRequests.answer`，每用户每房间滚动 1 小时 ≤ 6 次。计数源：这些函数成功时写的命令事件（`brief_confirmed`、`catalog_item_confirmed`、`catalog_item_retired`、`run_started{cause: "manual_start"}`、`run_renegotiation_requested`、`human_request_answered`），都带 `actorUserId`；`appendEvents` 只给每个命令事务中第一条这类事件打 `rateUser: 'constraint_writes'` 标记（调用方不能传入或省略）；`assertWithinRate` 读 `events.by_room_actor` 前缀 `(roomId, actorUserId, 'constraint_writes')` 且 `_creationTime > now − 1h` 的行（`take(6)`），行数即 **distinct `commitTs`**（一次命令事务恰计一次；审批、任务完成等无关事件不占扫描额度）。`soft_writes` 桶只覆盖 `briefs.updateSoft`（它不是约束写入，不占 `constraint_writes`），每用户每房间滚动 1 小时 ≤ 30 次：计数源是它成功时写的 `brief_soft_updated`（带 `actorUserId`），`appendEvents` 给它打 `rateUser: 'soft_writes'` 标记，`assertWithinRate` 读同一索引前缀 `(roomId, actorUserId, 'soft_writes')`（`take(30)`）。`room_create` 桶覆盖 `rooms.create` 与 `rooms.startFollowUp`，每用户滚动 1 小时 ≤ 10 次，计数源 `rooms.by_createdBy`（+ `_creationTime`）。`price_writes` 桶（privacy-01）：房间 `open` 期间，改变 `priceCents` / `leadDays`、新增或撤下目录项的 `catalog.confirm` / `catalog.retire` 每房间每 24 小时 ≤ 3 批（计数源：`appendEvents` 在 `catalog_item_confirmed{ priceChanged: true }` / `catalog_item_retired` 上打的 `rateRoom: 'price_writes'` 标记，读 `events.by_room_rate`，一个命令事务至多一行），且每个 open run 内同一 `itemKey` 改价 ≤ 1 次（以改价前的当前 `runId` 与 `itemKey` 为键判定，不比较时间戳：只有使该键 `revision` 变化的写入——即硬投影判定的 `priceChanged`——才算改价，只改 `title` / `taskTemplates` 的 `editNo` 行不算；房间 `open` 时改价必然 bump 并结束改价前的 run（D06），所以本条在每个 run 内由构造成立，不是额外的跨 run 日限，总量上界仍是上面的每 24 小时 ≤ 3 批）；`budget.setCap` 与 customer 的硬字段 `briefs.confirm` 共用每房间每 24 小时 ≤ 6 次的子桶（计数源 `brief_confirmed{ hardChanged: true }` 上的 `rateRoom: 'hard_writes'` 标记，读法同上）。这两个桶只在命令事务加锁时读到的房间状态为 `open` 时打标记：`setup` 期的首次确认与使房间打开的那次确认都不计入。`run_starts` 桶（privacy-12）：每房间每 24 小时 ≤ 6 个 run（不读事件：计数源是 `runs.by_room_runNo` 倒序前 7 行中 `startedAt > now − 24h` 的个数，人工 `runs.start` 与 10 §10.5.2 B6a 共用，含 `room_opened` 的首个 run 与 `react()` 自动开局——超限时 bump 照常记录、新 run 照常建立但首回合 `waitingReason: 'run_cap'`，由 10 §10.5.2 B6a 以 `beginFnId` 登记到滚动窗口腾出的时刻恢复（`runs.reconcile` 因此为 noop，`ops.livenessSweep` 只兜底——若由巡检恢复，它调用 reconcile 时会立即重派而绕过上限）；人工 `runs.start` 直接 `run.rate_limited`）。被拒调用回滚、不计数；`unchanged` 不写事件、不计数。超限抛 `run.rate_limited { retryAfterMs }`。
8. **时间**：mutation 用 `nowMs(ctx)` 与 `todayInTimeZone(nowMs, room.timeZone)`（11 §11.8），只用于推进日期与判定过期；规则检查与物化一律读 `rooms.localDate`（09 §9.6.7）。query 只读 `rooms.localDate` 与存储的 `expiresAt`，"是否已过期"的显示交给前端本地时钟。
9. **写入纪律**：所有写入经写门面与 `RoomTx`（03 §3.3）；每个事务内的事件经 `events.append` 分配 `seq`；事件 `payload` 只含房间可见字段，私密细节只放 `restrictedRef`（D14，事件目录见 03 §3.11.1）。
10. **已执行与已关闭房间**：`openRoomTx` 的 `allow` 默认不含 `executed` / `closed`，协商类写入一律 `run.invalid_state{guard:"room_status"}`（D04）；显式放行 `executed` 的只有 `tasks.markDone`（执行后的任务勾选）与 `rooms.startFollowUp`（只读旧房间、写新房间），见 §12.25 Q3。

## 12.3 构造器层

| 构造器（11 §11.6） | 鉴权与失败 | 本章使用它的函数 |
| --- | --- | --- |
| `anonQuery` | 无 | `health.ping` |
| `userQuery` | 无身份 / 未建档 → 返回 `null` | `users.viewer`（例外：未建档返回 `{ status: "unprovisioned" }`）、`rooms.listMine`（例外：返回空页 `{ page: [], isDone: true, continueCursor: "" }`，`returns` 不含 `null`）、`invites.listMine` |
| `userMutation` | `auth.unauthenticated` / `auth.user_not_provisioned` | `users.ensureViewer`（`provision: true`）、`rooms.create`、`invites.accept` |
| `memberQuery` | 非成员 / 目标不存在 → `null` | `rooms.view`、`rooms.previewChange`、`briefs.mine`、`catalog.list`、`proposals.get`、`humanRequests.get`、`turns.mine`、`executions.forRoom`、`timeline.page` |
| `memberMutation` | `auth.not_member` / `auth.role_forbidden` / `auth.not_creator` / `run.rate_limited` | `rooms.close`、`rooms.startFollowUp`、`invites.create`、`briefs.confirm`、`briefs.updateSoft`、`budget.setCap`、`ledger.recordBaseline`、`sharedFacts.add`、`catalog.confirm`、`catalog.retire`、`runs.start`、`runs.retryTurn`、`runs.requestRenegotiation`、`runs.cancel`、`approvals.record`、`humanRequests.answer`、`tasks.markDone` |
| `userAction` | 同 `userMutation` | `invites.createLink` |
| `sysQuery` | 仅内部 | `agents.loadTurnContext`、`invites.authorizeLink`、`ops.configHealth`、`ops.activeAttemptCount`、`ops.metrics`、`ops.auditUsers` |
| `sysMutation` | 仅内部；代表用户者带 `actorUserId` | `invites.insertLink`、`turns.beginAttempt`、`turns.complete`、`turns.fail`、`agents.watchdog`、`runs.reconcile`、`clock.rollLocalDate`、`humanRequests.expireDue`、`ops.setDraining`、`ops.livenessSweep`、`ops.purgeRawOutputs`、`privacy.redact`、`seed.fromFixture`、`seed.reset` |
| `sysAction` | 仅内部 | `agents.runAttempt`、`ops.checkModelConfig` |

## 12.4 错误码（API 层抛出的码；规则检查码见 06）

| code | 触发 | `params`（受众） | 前端处理 | 可重试 |
| --- | --- | --- | --- | --- |
| `auth.unauthenticated` | 写函数无身份 | — | 跳登录 | 登录后 |
| `auth.user_not_provisioned` | 有身份无 `users` 行 | — | 先 `users.ensureViewer` 再重试 | 是 |
| `auth.not_member` | 非成员，或目标文档 / 房间不存在（二者不可区分） | — | `NotAvailable` | 否 |
| `auth.role_forbidden` | 角色不在允许集；非请求的 `toRole`；非必需审批人；非任务被指派角色（query 从不抛它：`previewChange` 对非所有者返回 `null`） | — | 隐藏入口并刷新 | 否 |
| `auth.not_creator` | 仅创建者可做的操作 | — | 同上 | 否 |
| `invite.invalid` | 邀请不存在、已过期、已被取代、已被他人使用、邮箱不匹配、token 哈希不匹配（统一一个码，防探测） | — | "This invite is no longer valid" | 否 |
| `invite.email_unverified` | 邮箱定向邀请但 `identity.emailVerified !== true` | — | 引导验证邮箱 | 验证后 |
| `invite.seat_taken` | 该角色已有成员（03 `addMember`） | `role` | 刷新 | 否 |
| `invite.already_member` | 本人已在该房间占一席（一人一房一席，D24） | `role`（本人的） | 跳转房间 | 否 |
| `request.not_open` | 请求已回答、已过期或已被取代 | — | 刷新 | 否 |
| `request.option_unknown` | `optionKey` 不在该请求的选项中，或指向不可回答的 `blocked` 说明项 | — | 刷新 | 否 |
| `input.invalid` | 文本长度 / 字符集 / 枚举 / 条数上限 / 角色字段变体不符 | `field` | 表单字段提示 | 修改后 |
| `run.invalid_state` | 房间或 run 状态不允许（含已执行房间的写入，D04） | `guard`：`room_status` \| `run_status` \| `run_changed` \| `not_ready` \| `baseline_exists` \| `brief_missing` \| `no_failed_turn` \| `scenario_version` | 刷新 | 否 |
| `run.draining` | `opsFlags.draining` 置位时人工开局或需要新 live attempt 的回答 | — | "Maintenance in progress, try again shortly" | 稍后 |
| `run.rate_limited` | 五个节流桶之一超限（B7）；同一提案上本人撤回 ≥ 10 次或 approve 行 ≥ 60（08 S9 / S10；reject 永不受限） | `retryAfterMs` | 倒计时 | 是 |
| `version.stale_constraints` | 约束写入的 `expectedConstraintsVersion` 与房间不符 | `currentConstraintsVersion` | 重新拉取影响预览 | 刷新后 |
| `approval.stale` | `expectedConstraintsVersion` 或 `expectedTermsKey` 不符（D02） | `currentConstraintsVersion` | stale 横幅，对同一提案重新决定 | 刷新后 |
| `approval.not_current` | 提案不是当前 run 的当前提案，或已 `rejected` / `superseded` / `stale`，或房间仍在 `setup` | — | 刷新 | 否 |
| `approval.already_executed` | 执行后的 reject / withdraw | — | 跳结果页 | 否 |
| `approval.not_executable` | approve 前同事务 `isExecutable` 不通过（纵深防御，正常路径不触发） | `reasonCodes`：按调用者投影，provider 不带 `params` | 显示阻断原因；服务端同时 `publicOpsLog('approval.not_executable', { fn })`（公开路径只用闭集三键 logger，15 §15.6.2） | 否 |
| `approval.self_conflict` | 同一 `userId` 满足两个必需角色（D24 下不可达，第二道防线） | — | 显示 internal 文案 | 否 |
| `budget.below_committed` | 新上限 < 已承诺；或基线 > 现有上限；或 `raise_cap` 目标 < 已承诺（D23） | `minAllowedCapCents`（只发给 finance，调用者本人） | 字段提示 | 修改后 |
| `amount.out_of_range` | 金额非安全整数、为负、超过 1e11，或目录单价超过 `MAX_CATALOG_ROW_CENTS` | `field` | 字段提示 | 修改后 |
| `date.invalid` / `date.in_past` / `date.out_of_range` | 非 `YYYY-MM-DD` 真实日期 / 早于 `localDate` / 晚于 `localDate + 365` | `field` | 字段提示 | 修改后 |
| `item.unknown` / `item.duplicate` / `item.retired` / `item.required_missing` / `item.limit_exceeded` | itemKey 不在已确认目录 / 重复、改变 `kind`，或在后续房间重用旧执行已交付的 itemKey（§12.12 守卫 ④）/ 已下架 / 删除后必需项为空 / 目录超过 12 个 item 或 2 个 modifier（06 新增码） | `field`；`item.unknown` / `item.duplicate` 另带 `itemKeys`（调用者本人写入的键） | 字段提示 | 修改后 |
| `item.unconfirmed` | 简报、共享事实或回答引用的键只在 `draft` 行出现（后续房间里 provider 尚未重新确认的复制条目；03 §3.13.1、06 §4、14 §4） | `itemKeys`（调用者本人写入的键） | "Waiting for Provider to confirm this item" | provider 确认后 |
| `disclosure.blocked` | 字段不在 `SHAREABLE_FIELDS` 或受众超出允许受众（07 LP-3）；或 `catalog.confirm` 的标题含提示定界词（`field: "title"`，§12.12 ⑤） | `field` | 共享字段：说明不能分享；`title`：提示换一个标题（13 §13.10 C） | 否 |
| `disclosure.needs_own_confirmation` | 硬字段对他方披露但未带 `confirmOwnDisclosure: true` | `field` | 展示将公开的本人值并二次确认 | 确认后 |
| `internal` | 非 `ConvexError` 异常（`withSanitizedErrors` 统一转换）或内部不变量被破坏 | — | "Something went wrong" | 视情况 |

所有 `params` 由抛出处按 07 的受众表裁剪；未标注受众的参数一律丢弃（fail closed）。provider 永不收到 `overByCents`、`headroomCents`、`deadline` 一类参数（canon §1.5）。07 §7.7、04、08、09、13、16 均按本表书写错误码。

**码集合与参数名的单一来源**（names-33）：
- `API_ERROR_CODES` = `auth.unauthenticated`、`auth.user_not_provisioned`、`auth.not_member`、`auth.role_forbidden`、`auth.not_creator`、`invite.invalid`、`invite.email_unverified`、`invite.seat_taken`、`invite.already_member`、`request.not_open`、`request.option_unknown`、`input.invalid`、`internal`（13 个）。上表其余码都在 06 的 `REASON_CODES` 中（含 `run.draining`、`run.rate_limited`、`approval.not_executable`、`item.limit_exceeded`）。
- 不设的码与其去向：邀请过期、邮箱不符、已被使用都折叠进 `invite.invalid`（防探测，不设 `invite.expired` / `invite.email_mismatch`）；"无可撤回的 approve"返回 `unchanged`（§12.25 Q10，不设 `approval.nothing_to_withdraw`）；reject 的 `reasonKey` 不在场景枚举 → `input.invalid{ field: "reasonKey" }`（不设 `approval.invalid_reason`）；"目标不存在"与"非成员"同为 `auth.not_member`（不设 `auth.not_found`）。
- 参数名以本表为准并登记进 06 `PARAM_AUDIENCE`：`run.rate_limited { retryAfterMs }`（毫秒，不用分钟）、`approval.not_executable { reasonCodes }`、`budget.below_committed { minAllowedCapCents }`、`approval.stale` / `version.stale_constraints { currentConstraintsVersion }`。
- 测试（16 / 06 T06-S4）：本表每个码 ∈ `ERROR_CODES`；`API_ERROR_CODES` 与"本表码集合 − `REASON_CODES`"相等；每个抛出点的 `params` 键 ⊆ `PARAM_AUDIENCE[code]`。
