# 04 状态机（part1）：约定、守卫分组、房间、席位与邀请、简报与清单项

> 本章分 4 片：part1（本文件）4.1–4.4；part2 4.5 提案、4.6 签核；part3 4.7 run、4.8 回合；part4 4.9 房间派生阶段、4.10 人工请求、4.11 任务与台账条目。
> 每张迁移表：从 → 到、触发函数（12）、触发者、守卫、副作用。所有修改状态字段的代码都调用 `engine/state.ts#assertTransition(machine, from, to)`，迁移表是代码常量，与本章一致。

## 4.1 约定与守卫分组

| 守卫组 | 内容 | 用于 |
| --- | --- | --- |
| G-AUTH | 已认证 → `users` 行存在 → 是房间成员 → 席位角色具备所需能力（由插件 `capabilities` 生成） | 所有公共 mutation |
| G-OPEN | `room.status === "open"` | 所有写操作 |
| G-SIGN（签核/执行） | 提案是 `room.currentProposalId` 且 `status === "active"`；`expectedConstraintsVersion === room.constraintsVersion`；`expectedTermsKey === proposal.termsKey`；调用者席位在 `proposal.requiredSignoffs` 中 | `decisions.record`、`executeIfComplete` |
| G-EVAL | 在当前规则视图下全部检查通过 | approve、执行、创建提案 |
| G-PERSIST（回合持久化） | `turn.status === "running"`；`turnId ∈ run.openTurnIds`；`run.status ∈ {"running","stalled"}`；`room.activeRunId === run._id`；`room.constraintsVersion === run.constraintsVersion` | `runtime.completeTurn`、`runtime.failTurn`、`runtime.turnWatchdog` |
| G-REQ（回答请求） | `request.status === "open"`；调用者席位 = `targetSeatId`；`request.constraintsVersion === room.constraintsVersion` | `requests.answer` |

G-SIGN 与 G-PERSIST 是两组独立守卫，不混用（F04.2）：前者保护"人批准的版本"，后者保护"代理结果不落在过期状态上"。注意 G-SIGN **不要求** `proposal.constraintsVersion === room.constraintsVersion`：同一提案可以在新约束版本下重新签核（不复制提案，ADR-09），可执行性由 G-EVAL 实时判定。

## 4.2 房间 room（存储状态）

| 从 | 到 | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| — | `open` | `rooms.create` | 登录用户 | 场景已注册；`myRoleKey` 属于场景角色；每用户每日建房上限；创建者白名单（若配置） | 建席位 ×N、草稿 ×N、本人席位 filled、`constraintRevisions` v0、`negotiationOpen: true`、事件 `room_created`、`seat_joined` |
| `open` | `closed` | `rooms.close` | 房主 | G-OPEN | active run → `finished/cancelled`；open 请求 → `cancelled`；事件 `room_closed` |

`closed` 是终态。房间不再有 draft/negotiating/confirmed 等混合状态（PR-20、RA-D04），协商与审批进度见 4.9 的派生阶段。

## 4.3 席位 seat 与邀请 invite

**席位**：

| 从 | 到 | 触发函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| `open` | `filled` | `rooms.create`（房主本人席位）；`invites._accept` | 该用户在本房间无其他席位（`ALREADY_SEATED`）；席位仍为 open | 写 `userId`、`displayName` 快照、`joinedAt`；事件 `seat_joined` |

v1 无 `filled → open`（不支持移除成员或换人，17）。

**邀请**：

| 从 | 到 | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| — | `pending` | `invites.create`（action）→ `invites._store` | 房主 | G-OPEN；席位 open | 同席位旧 pending → `revoked`；事件 `invite_created` |
| `pending` | `accepted` | `invites.accept`（action）→ `invites._accept` | 任意登录用户 | 令牌哈希匹配；`now < expiresAt`（否则 `INVITE_EXPIRED`）；席位仍 open | 席位 filled（见上） |
| `pending` | `revoked` | `invites.revoke`；新邀请 | 房主 | — | 事件 `invite_revoked` |

`expired` 为读时派生（`status === "pending" && now >= expiresAt`）。同一用户重复接受同一邀请返回成功（幂等）。

## 4.4 简报与清单项

### 简报（每席位）的派生状态

| 派生状态 | 判定 |
| --- | --- |
| `unconfirmed` | 无任何 `briefVersions` |
| `confirmed` | 有版本，且草稿规范化内容 = 最新版本 |
| `dirty` | 有版本，且草稿与最新版本不同（界面提示 "Unconfirmed changes"） |

**迁移（写操作）**：

| 操作 | 触发函数 | 守卫 | 结果 |
| --- | --- | --- | --- |
| 保存草稿 | `briefs.saveDraft` | G-AUTH（本席位）；G-OPEN；`revision` 匹配（否则 `STALE_DRAFT`）；长度上限 | 草稿 `revision + 1` |
| 确认 | `briefs.confirm` | 同上；`draft.basedOnVersion === 最新版本号`（否则 `STALE_DRAFT`）；`suggestedFieldKeys` 为空；插件 `validate` 无问题（否则 `BRIEF_INCOMPLETE`/`INVALID_INPUT`）；场景守卫（finance 上限 ≥ 已承诺，否则 `CAP_BELOW_COMMITTED`） | 内容与最新版本相同 → 返回 `unchanged`，不写；否则 `appendBriefVersion`：若 `ruleChanged` → `bumpConstraints(cause:"brief_confirmed")`；事件 `brief_confirmed` |
| 快速更新 | `briefs.quickUpdate` | 同确认，另加 `expectedConstraintsVersion` 匹配 | 以最新版本 + 补丁生成新版本（origin `quick_update`），草稿同步为新版本 |
| 回答请求的补丁 | `requests.answer`（`patch_brief`） | G-REQ + 同确认的校验 | 新版本（origin `request_answer`），请求 `answered` |

简报版本本身不可变，没有状态迁移。

### 清单项 listItem

| 从 | 到 | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| — | `draft` | `lists.saveDraft` | 具备 `list.author:<listKey>` 的席位 | G-OPEN；`itemKey` 格式；插件 `lists[listKey].validate`（例如报价行引用的范围项必须已确认、加急日 ≤ 标准日、金额 `assertCents`）；`maxItems` | 版本号 = 当前最大版本 + 1 |
| `draft` | `draft` | `lists.saveDraft` | 作者 | 同上 | 原地更新草稿 |
| `draft` | （删除） | `lists.discardDraft` | 作者 | — | 草稿从未公开，可删除 |
| `draft` | `confirmed` | `lists.confirm`（批量） | 作者 | 同 saveDraft 的校验再跑一次 | 同 itemKey 旧 confirmed → `superseded`；`bumpConstraints(cause:"list_changed")`（一批一次）；事件 `list_items_confirmed` |
| `confirmed` | `withdrawn` | `lists.withdraw` | 作者 | 需公开原因码 | `bumpConstraints`；事件 `list_item_withdrawn` |
| `confirmed` | `superseded` | `lists.confirm`（同 itemKey 新版本） | 作者 | — | 见上 |

确认对话框必须先调用 `lists.previewConfirm`（query），列出将被阻断的提案与将过期的签核（P7）。
