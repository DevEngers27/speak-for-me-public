# 16 · 测试策略（part3：afterEach 对账与活性检查、用例目录上：AUTH / VER）

> 分片列表见 `16-testing.md` 顶部。

## 16.5 每个场景 afterEach：对账 R1–R11 与活性检查

对账检查器由 08 §8.8 定义（纯函数 `reconcileRoom` + internal query `internal.executions.checkInvariants`，码名沿用 finance 候选），本章只规定在哪里断言。`convex/test.setup.ts` 注册全局钩子：

```ts
afterEach(async () => {
  const t = currentConvexTest();
  if (!t || t.skipReconcile) return;                     // 只有显式故障注入用例可跳过，并须改用 expectFindings
  for (const roomId of await t.query(internal.testing.listRoomIds, {})) {
    expect(await t.query(internal.executions.checkInvariants, { roomId })).toEqual([]);
    expect(await t.query(internal.testing.checkLiveness, { roomId })).toEqual([]);
  }
});
```

`[construct]` 用例调用 `expectFindings(roomId, ['R7'])` 断言**恰好**出现预期发现。`internal.testing.*` 只在 `DEPLOYMENT_TIER !== 'prod'` 时注册（`assertTier`，D18）。

| 码（08） | 检查要点 |
| --- | --- |
| R1 `SEQ_GAP` | 审批 `seq` 每 `(proposalId, userId)` 从 1 连续且相邻行 `(decision, boundConstraintsVersion)` 不同；各角色 `briefs.version` 连续；`proposals.version` 房间内连续 |
| R2 `COUNTER_DRIFT` | `rooms.nextProposalVersion === max(version) + 1`；`committedBefore/AfterCents` 与 `Σ ledgerEntries` 一致；无 `committed*` 计数字段 |
| R3 `AMOUNT_RANGE` | 全部金额 `0 ≤ n ≤ 1e11` 的安全整数 |
| R4 `HEADROOM_NEGATIVE` | `committedAfterCents ≤ capCentsAtExecution`；当前 `Σ ledger ≤` 当前 `capCents` |
| R5 `ORPHAN_COMMITMENT` | `commit` 行有执行且金额与执行、变更单增量相等；`baseline` 行无 `executionId` |
| R6 `ORPHAN_CHANGE_ORDER` | 每条执行恰 1 张变更单、1 条 commit；任务与 `plannedTasks` 一一对应，`taskKey` 三段且唯一 |
| R7 `SIGNATURE_SET` | `approvalIds` 覆盖 `requiredApprovals`、全为 approve、绑定执行 cv 与 `termsKey`、各为该用户最新行、userId 两两不同 |
| R8 `TERMS_KEY` | `canonicalJson(terms) === termsKey`（提案、执行、变更单一致）；`Σ lines[].priceCents === terms.amountCents` |
| R9 `PRICE_SOURCE` | 变更单行与目录 `(itemKey, revision)` 一致且为最新已确认修订 |
| R10 `OPENING_BALANCE` | 离开 `setup` 后恰 1 条 baseline；commit ≤ 1；G701 金额链自洽 |
| R11 `PROPOSAL_STATUS` | 提案 / run / 房间的 `executed` 与执行行互相蕴含；`executionKey === exec:${proposalId}`；"集合齐且通过检查却未执行"的活性违例；已执行房间无 open 请求 |

本章追加的活性与结构检查（`internal.testing.checkLiveness`，同样 `assertTier`）：

| 码 | 检查 | 保证 |
| --- | --- | --- |
| LV-1 | run 为 `negotiating` ⇒ 恰一个非终态回合（= `activeTurnSeq`），且满足其一：有 `running` attempt；`beginFnId` 指向 `pending` 的 `turns.beginAttempt` 调度（退避 `backoff` / 次日 `spend_deferred`）；`waitingReason === 'draining'` 且 `opsFlags.draining` 仍置位（与 04 INV-SM-03 同一谓词，不另写一份） | D07 reconcile、04 §4.3.5 |
| LV-2 | run 为 `needs_input` ⇔ 恰有一个 `open` 人工请求 | D15 |
| LV-3 | 每房间至多一个非终态 run，且 `room.currentRunId` 指向它 | 04 |
| LV-4 | 每个 run 至多一个 `running` attempt；回合串行（`activeTurnSeq`） | D08 |
| EV-1 | 每个提案插入、审批行、约束递增、执行都至少对应一条事件；同事务事件 `seq` 连续 | D14、核心 6 |
| SF-1 | 每行 `sharedFacts.value` 等于 `fromRole` 在 `briefVersion` 的简报值（或 ledger 派生值） | 07 PV-INV-02 |

## 16.6 用例目录（上）

层：S 静态、L0 纯函数、L1 convex-test、L2 真实部署、L3 端到端。"来源"指 07 威胁（T-xx）、反例电池（CE-xxx）、原 README 验收或 Role A 回归（RA-xx）。

### 16.6.1 鉴权（AUTH）

| 编号 | 层 | 用例与断言 | 来源 |
| --- | --- | --- | --- |
| TC-AUTH-01 | L1 | 未登录调用公开函数快照中的每个 query 返回 `null`、每个 mutation 抛 `auth.unauthenticated`；不经 Next，直接用函数引用调用 | T-01、T-20 |
| TC-AUTH-02 | L1 | `outsider` 对真实房间、成员对已被 `seed.reset` 删除的房间 id：query `null`、mutation `auth.not_member`，两者响应逐字节相同 | T-01 |
| TC-AUTH-03 | L1 + S | 公开函数参数快照中不存在 `v.id("briefs" \| "turns" \| "attempts" \| "ledgerEntries" \| "sharedFacts")`；`humanRequests.answer({ requestId, optionKey })` 没有 `roomId` 参数：先由 `requestId` 解析出 `request.roomId`，再按该房间做成员检查（他房间的 `requestId` → `auth.not_member`，与不存在不可区分）与 `toRole` = 调用者角色检查（否则 `auth.role_forbidden`，12 §12.14）；`briefs.mine` 只返回本角色版本 | T-01、CE-001 |
| TC-AUTH-04 | L1 | 邮箱邀请：`emailVerified: false` → `invite.email_unverified`、邮箱不符 → `invite.invalid`；过期（推进 72h）/ 已用 / 已被取代 / 随机 token → 同一个 `invite.invalid`；`invites` 行中扫描不到明文 token；明文只出现在 `invites.createLink` 的返回值 | T-10、T-18、CE-021/022 |
| TC-AUTH-05 | L1 `[serial]` + L2 | 同一用户接受第二个角色 → `invite.already_member`；第二个用户接受已占角色 → `invite.seat_taken`；`verifyQueryThenInsertDedup` 含 `bypass` 步；并发结论见 L2 `join_same_role` | T-10、CE-020/120 |
| TC-AUTH-06 | S + L1 | 公开函数快照（名称 + args 键集合）：出现 `userId` / `memberId` / `actorUserId` 参数，或表示调用者自身角色的 `role` 参数即失败；白名单只有 `invites.create` / `invites.createLink` 的 `role`（邀请的目标席位，不是调用者身份）与 `rooms.create` 的 `myRole`（建房人为自己选的席位，经场景角色校验，04 M1），其余调用者角色一律由成员身份派生；internal 函数不出现在 `api`；给 `approvals.record` 多传 `role` 被参数校验拒绝；调用图：`executions.executeIfComplete` 只被 `approvals.record` 调用、`constraints.bump` 只被 `CONSTRAINT_BUMPERS` 调用；业务模块直接 import `query` / `mutation` 报 lint 错误 | T-16、CE-037/084/151 |
| TC-AUTH-07 | L1 | 动作 × 角色矩阵：由 07 §7.12 导出的 `ACTION_MATRIX` 生成，每个公开 mutation 一条 `roleMatrix(t, roles, call)` 断言，期望形如 `{ customer: "ok", provider: "auth.role_forbidden", finance: "auth.role_forbidden", outsider: "auth.not_member", anonymous: "auth.unauthenticated" }` | T-01、T-11、CE-054 |
| TC-AUTH-08 | L1 | creator（customer）不能替 finance 批准、不能改他人简报、不能回答他人请求；非 creator 调 `rooms.close` / `runs.requestRenegotiation` / `runs.cancel` / `invites.create` → `auth.not_creator` | T-11、CE-068 |
| TC-AUTH-09 | L1 | `executed` 房间：`briefs.confirm`、`budget.setCap`、`catalog.*`、`runs.*`、`humanRequests.answer` → `run.invalid_state`，`approvals.record` → `approval.already_executed`；`tasks.markDone` 与 `rooms.startFollowUp` 仍成功；`closed` 房间全部写入 `run.invalid_state` | D04、CE-083/108/118/130 |
| TC-AUTH-10 | S + L1 | internal 函数参数含 `actorUserId`；internal 函数体内出现 `ctx.auth` 即失败；被调度的 `agents.runAttempt` 内身份为 `null`、角色取自 `turns.role`，传入别人的 `actorUserId` 不改变角色 | T-36 |
| TC-AUTH-11 | L3 + S | 无会话 `fetch('/api/health')` → 401 JSON（不是 307）；页面路由 → 跳转登录；`/invite`、`/setup` 可访问；缺 Clerk 配置 → `/setup`。静态：`src/app/**/route.ts` 的清单恰为 `api/health/route.ts`（v1 唯一 Route Handler，无业务数据，07 §7.5.2、13 FE-D14），且该文件调用 `auth()` 并在 `userId` 为空时返回 401；proxy 的 `auth.protect()` 只匹配 `/rooms(.*)` | T-20、PV-01、completeness-20 |
| TC-AUTH-12 | L1 | 同一用户同一房间 1 小时内第 7 次约束变更类写入（`briefs.confirm` / `catalog.confirm` / `catalog.retire` / `budget.setCap` / `runs.start` / `runs.requestRenegotiation` / `runs.retryTurn` / `humanRequests.answer`）→ `run.rate_limited { retryAfterMs }`；推进 1 小时后恢复；其他用户不受影响；`approvals.record` 不计数。为隔离小时桶，前 6 次只用不触及 24 小时总量桶的写入（只改软字段的 `briefs.confirm`、只改 `title` 的 `catalog.confirm`），总量桶由 TC-AUTH-13 单独断言 | T-09、T-17、CE-011/012/056/134 |
| TC-AUTH-13 | L1 | 每房间 24 小时总量桶（12 §12.2 第 7 条，07 §7.13，privacy-01）：先推进假时钟 25 小时使 seed 期计数滑出窗口。① `price_writes`：provider 每隔 1 小时做一次价格类 `catalog.confirm`（每次改不同 itemKey 的 `priceCents` 或 `leadDays`；`catalog.retire` 同样计数），第 4 次 → `run.rate_limited`，cv、`catalogItems`、事件均不变；只改 `title` / `taskTemplates` 的确认照常成功且不占额度；推进到第 1 次的 24 小时之后恢复。② 硬字段子桶：finance `budget.setCap`、finance 改 `capCents` 的 `briefs.confirm`、customer 改 `deadline` / `requiredItemKeys` 的 `briefs.confirm` 交替进行、每次间隔 1 小时（不触发小时桶），合计第 7 次 → `run.rate_limited`（无论由谁发起：桶按房间计）；约束类 `humanRequests.answer` 经 `brief_confirmed{ hardChanged }` 同样计数；只改软字段或披露的确认不计。③ `run_starts`：creator 每隔 1 小时 `runs.cancel` 后人工 `runs.start`，24 小时内第 7 个 run → `run.rate_limited`；由 bump 引起的 `react()` 自动开局不抛错、bump 照常记录（超限时的回合等待语义以 12 为准）。①②③ 各在独立场景中运行（② 的 6 次 bump 经 `react()` 恰好占满 `run_starts`，与 ③ 混跑会互相污染）。④ 被拒调用不写任何行与事件，`retryAfterMs` 只在调用者的 `ConvexError.data` 中。⑤ 量化对照：脚本化 provider 只靠改价二分余量，24 小时内能得到的预检结局 ≤ 3 个 | T-09、privacy-01 |
| TC-AUTH-14 | L1 | 节流计数不被混合事件稀释：同一用户在 1 小时窗口内穿插 ≥ 50 条不计数的本人事件（如反复调用 `sharedFacts.add` 改受众产生的 `disclosure_changed`），之后第 7 次计数类写入仍 → `run.rate_limited`；每房间 24 小时桶同样在窗口内穿插大量不计数事件（审批、披露、任务）后，`price_writes` 第 4 批、硬字段子桶第 7 次仍按阈值拒绝，`run_starts` 第 7 个按开局方式区分：人工 `runs.start` → `run.rate_limited`，系统开局（`react()`）→ 首回合记 `waitingReason: 'run_cap'` 停泊、不抛错——计数只看计数类命令事件，与窗口内其他事件的条数无关（读法以 12 §12.2 第 7 条、03 §3.11.3 定稿为准）；并发下的计数正确性只由 L2 证明 | T-09、privacy-01 |
| TC-AUTH-15 | L1 | 只改标题与改价交错（`price_writes` 的"每个 open run 内同一 itemKey 改价 ≤ 1 次"以改价前的当前 `runId` 与 `itemKey` 为键，12 §12.2 第 7 条）：房间 `open`，对同一 itemKey 先只改 `title`（`editNo + 1`、不 bump）→ 改 `priceCents` 成功（bump，D06 结束当前 run 并开新 run）→ 新 run 内再只改 `title` → 再改价仍成功；只改标题的行不计入 `price_writes` 批次、不被当作改价（"改价"指定价修订号 `revision` 变化，canon §1.2）；再改价一次成功后，同一 24 小时内第 4 个改价批次 → `run.rate_limited`（假时钟在步骤之间推进 > 1 小时、总计 < 24 小时，使 `constraint_writes` 小时桶不干扰，拒绝只来自 `price_writes`）。不断言"同一 run 内第二次改价"：房间 `open` 时改价必然 bump，该情形构造上不可达 | T-09、D25 |
| TC-AUTH-16 | L1 | `briefs.updateSoft` 在本角色尚无已确认简报时 → `run.invalid_state{ guard: "brief_missing" }`（与 `budget.setCap` / `sharedFacts.add` 同一守卫，不另设码），`briefs` 行数与事件不变；`briefs.confirm` 之后再调用成功，返回 `{ briefVersion: 2 }` | 12 §12.9 |
| TC-AUTH-17 | L1 | `briefs.updateSoft` 的 `notes` 按 NFC 后的码点计长：NFC 后 2,001 码点 → `input.invalid{ field: "notes" }`，不写行、不写事件；原始 2,002 码点、NFC 合成后 2,000 码点的文本成功；增补平面字符按 1 个码点计；含 `<` / `>` 的文本被接受，且在本方请求体中只以 `encodeBlock` 转义后的形式出现在 `<principal_notes>` 块内；空串成功并清空 notes | 12 §12.9、05 §5.13.2 |
| TC-AUTH-18 | L1 | `executed` 与 `closed` 房间以不同于当前的 notes 调用 `briefs.updateSoft` → `run.invalid_state{ guard: "room_status" }`，不写简报版本、不写事件（TC-AUTH-09 写入清单的补充） | D04、12 §12.9 |
| TC-AUTH-19 | L1 | `soft_writes` 桶（12 §12.2 第 7 条、03 §3.11.3）：同一用户同一房间 1 小时内第 31 次改变 notes 的 `briefs.updateSoft` → `run.rate_limited { retryAfterMs }`，不写行；前 30 次不占 `constraint_writes`（紧接着的 `briefs.confirm` 照常成功）；notes 未变的调用不计数；推进 1 小时后恢复；其他用户不受影响 | 12 §12.9 |

### 16.6.2 版本与审批（VER）

| 编号 | 层 | 用例与断言 | 来源 |
| --- | --- | --- | --- |
| TC-VER-01 | L1 | 旧 `expectedConstraintsVersion` → `approval.stale`，`approvals` 行数不变 | T-12、CE-047 |
| TC-VER-02 | L1 | 旧 `expectedTermsKey` → `approval.stale`；对非 `run.currentProposalId` 的提案 → `approval.not_current` | T-12、CE-048 |
| TC-VER-03 | L1 | $800 提案 `pending_approval` 时 finance 降到 $4,800（恰等于）：旧 run `superseded`、新 run 直接 `pending_approval` 且 `currentProposalId` 不变（不复制版本）、两条旧审批（customer、provider）派生为 `stale_approve`、finance 仍为 `pending`（第三票落下时提案已在同一 mutation 内执行，三条 stale 不可达，canon D27）、对同一 `proposalId` 重批后执行；上调变体同样 bump 且旧审批 stale | D06、CE-053/058/059/129 |
| TC-VER-04 | L1 | 两方已批后 customer 把截止日提前到交付日之前：cv + 1、两条审批 stale、提案 `stale`、新 run `negotiating`；对旧提案批准被拒 | RA-B02、CE-042 |
| TC-VER-05 | L1 | approve → withdraw → approve：三行保留，当前为 approve；reject 之后 withdraw 被拒（码以 08 为准），提案 `rejected`，run 进下一轮或 `needs_input` | D02、CE-049/055/105 |
| TC-VER-06 | S | 只追加表（`proposals`、`approvals`、`events`、`briefs`、`sharedFacts`、`ledgerEntries`、`catalogItems`、`executions`、`changeOrders`、`constraintRevisions`）无 `db.replace` / `db.delete`；`db.patch` 只允许经迁移助手改 `status` 字段（AST 检查 patch 对象字面量的键集合 = `{status}` 或迁移表声明的字段）；例外只有 dev / preview / test 的 `seed.reset` 与 `privacy.redact`（只覆写 `REDACTABLE_FIELDS`：AST 检查其 patch 键集合 ⊆ 该表清单，canon D18、12 §12.20），其余任何覆写 / 删除即失败；抹除的 `pii_redacted` 审计事件与 `termsKey` 不变由 TC-PRIV-22 单独验证 | T-21、核心 6 |
| TC-VER-07 | L2 | 探针 `cap_vs_last_approval`（§16.8） | T-22、CE-099 |
| TC-VER-08 | S + L1 | 静态：`constraintsVersion` 只在 `constraints.bump` 内被写；L1：遍历 `CONSTRAINT_BUMPERS`（硬字段变化的 `briefs.confirm`、`budget.setCap`、价格 / 工期 / 新增的 `catalog.confirm`、`catalog.retire`、约束类 `humanRequests.answer`、结论翻转的 `clock.rollLocalDate`），每个恰好 + 1 并写一行 `constraintRevisions { cause }` | D05、CE-057 |
| TC-VER-09 | L1 | 不递增：目录仅改 `title` / `taskTemplates`、软字段与备注、`sharedFacts.add`、setup 期成员加入、执行、无翻转的 `rollLocalDate`、`setCap` 到相同值——cv 不变、审批仍有效、在审提案不被阻断（`lines` 快照） | D05、CE-044/045/046 |
| TC-VER-10 | L1 + L0 | `budget.setCap` / finance `briefs.confirm` 低于已承诺 → `budget.below_committed`，`params` 只有 `minAllowedCapCents`（调用者是 finance），不 bump、不写事件、不产生简报版本；fixture 校验器拒绝伪造 `below_committed` 状态 | D23、CE-016/017/117/155 |
| TC-VER-11 | L1 `[serial]` | 同人对同 `(proposalId, boundConstraintsVersion)` 重复相同决定 → `unchanged`，不插行 | D02、CE-095 |
| TC-VER-12 | L1 `[construct]` | 同一 userId 占两个角色（绕过 D24）→ `evaluateApprovalSet` 判不齐（`approval.self_conflict`），不执行 | T-10、CE-052 |
| TC-VER-13 | L1 | customer reject v1 后 provider 改无关条目价格（bump）：新 run 预检**不**保留被拒提案 | D06、CE-050/064/132 |
| TC-VER-14 | L0 | 性质测试："硬投影相等 ⇒ 阻断集合相等"（200 组随机输入，表驱动） | D05、INV-24 |
| TC-VER-15 | L1 | 审批行数上限只挡 approve / withdraw，永不挡 reject（08 I22、S9 / S10）：provider 对当前提案积满 60 行 approve 后（同一 cv 上只靠 withdraw / approve 交替最多 11 行——withdraw 上限 10 先到；其余 approve 行跨合法约束版本累积：finance 在两个都使该提案仍通过的上限之间反复 `budget.setCap`，D06 每次沿用同一 `proposalId`、旧审批 stale，provider 在新 cv 上再 approve；假时钟按 `constraint_writes` 与硬字段子桶的窗口推进，finance 全程不 approve 以免执行），第 61 次需要写新行的 approve → `run.rate_limited`，而本 cv 上已是 approve 时的重复 approve 仍返回 `unchanged` 并完成收敛检查；customer 第 11 次 withdraw → `run.rate_limited`；此后任一方 reject 仍成功（只读本人最新一行）；全程无 `internal`。08 §8.9 的随机操作序列测试同时收紧：reject 的允许错误集**不含** `run.rate_limited`、`run.invalid_state{ guard: 'scenario_version' }` 与 `internal`（08 E14） | D02、CE-055/056、invariants-01 |
| TC-VER-16 | L1 | `briefs.updateSoft` 不递增：房间 `open`、当前提案 `pending_approval` 且已有两条审批时更新 notes → cv 不变、无新 `constraintRevisions` 行、run / 提案 / 审批 / 请求状态不变；新简报版本 `source: "soft_update"`，`hardFields` / `disclosures` / 其余软字段与上一版逐字段相等；本事务事件恰为一条 `brief_soft_updated{ briefVersion }`，无 `brief_confirmed` / `constraints_changed` / `disclosure_changed`；`sharedFacts` 行数不变 | D05、CE-045、12 §12.9 |
