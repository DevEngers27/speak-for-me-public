# 12 后端函数目录（part1）：约定、users、rooms、invites、briefs、lists、ledger

> 本章分 2 片：part1（本文件）；part2 proposals、decisions、requests、negotiation、history、records、health、internal 与 ops、DTO 摘要。
> 路径约定见 11 第 11.3 节（`convex/briefs.ts#confirm` = `api.briefs.confirm`）。`P.*` 是组合层的场景载荷校验器（03 第 3.1 节）。

## 12.1 通用约定

1. 每个公共函数声明 `args` 与 `returns` 校验器；返回值是投影后的 DTO（07 第 7.5 节）。
2. 身份只来自 `ctx.auth`；参数中不出现"我是谁"（I-1）。query 未认证/非成员返回 `null`；mutation 抛 `ConvexError({ code, params? })`，码见 06 第 6.6 节。
3. 写操作带 `expectedConstraintsVersion`（会改约束或依赖约束的操作）或 `revision`（草稿），做乐观并发；不匹配即 `CONSTRAINTS_CHANGED` / `STALE_DRAFT`，整笔不写。
4. "幂等"列说明重复调用的结果；所有 mutation 都可安全地被 Convex 客户端在重连后重发（04 平台约束 1.11）。
5. action 只用于必须做外部 I/O 或安全随机/哈希的入口（邀请、抽取）；客户端调用 action 在断线时会直接失败，界面提供重试。

## 12.2 users（`convex/users.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `ensureMe` | mutation | `{}` | `v.id("users")` | 已登录 | 是（按 `tokenIdentifier` 先查后插） |
| `me` | query | `{}` | `null \| {userId, displayName, email?}` | 已登录 | — |
| `setDisplayName` | mutation | `{displayName: v.string()}` | `v.null()` | 已登录；1–60 字符 | 是 |

## 12.3 rooms（`convex/rooms.ts`）

```ts
create = mutation({
  args: { scenarioKey: v.string(), title: v.string(), goal: v.string(),
          timeZone: v.string(), myRoleKey: v.string() },
  returns: v.object({ roomId: v.id("rooms"), seatId: v.id("seats") }),
});   // 已登录；白名单与频率限制；场景已注册、角色合法、时区为有效 IANA；非幂等（每次一个新房间）
listMine = query({ args: {}, returns: v.union(v.null(), v.array(roomListItemDTO)) });
workspace = query({ args: { roomId: v.id("rooms") }, returns: v.union(v.null(), workspaceDTO) });
updateInfo = mutation({ args: { roomId: v.id("rooms"), title: v.optional(v.string()), goal: v.optional(v.string()) },
                        returns: v.null() });   // 房主；不递增约束版本；幂等
close = mutation({ args: { roomId: v.id("rooms") }, returns: v.null() });   // 房主；已关闭则无操作
```

`roomListItemDTO = { roomId, title, scenarioKey, myRoleKey, phase, yourTurn: string[] /* 例如 "confirm_brief" "approve" "answer_request" */, isSimulated, lastActivityAt }`。`workspaceDTO` 见 07 第 7.5 节。

## 12.4 invites（`convex/invites.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 幂等 / 说明 |
| --- | --- | --- | --- | --- | --- |
| `create` | action | `{roomId, seatId}` | `{url, expiresAt}` | 房主（经 `runQuery` 校验） | 生成 32 字节令牌并哈希 → `internal.invites._store`；同席位旧 pending 被撤销；明文只出现在本次返回值 |
| `revoke` | mutation | `{inviteId}` | `null` | 房主 | 是 |
| `listForRoom` | query | `{roomId}` | `[{inviteId, seatId, roleKey, status, expiresAt}]` | 房主 | 永不返回令牌或哈希 |
| `preview` | action | `{token}` | `{roomTitle, goal, roleKey, roleLabel, inviterName, joinDisclosure, status}` 或 `{error}` | 已登录 | 只读 |
| `accept` | action | `{token}` | `{roomId, seatId}` | 已登录 | 同一用户重复接受同一邀请返回同一结果；调度一次 `afterConstraintChange` |
| `_store` / `_lookup` / `_accept` | internal | — | — | 仅内部 | 先查后写（03 第 3.21 节） |

## 12.5 briefs（`convex/briefs.ts`）

```ts
myDraft = query({ args: { roomId: v.id("rooms") },
  returns: v.union(v.null(), v.object({
    draft: v.object({ fields: P.briefFields, notes: v.string(), sharedNote: v.string(),
      disclosures: v.array(disclosureV), revision: v.number(), basedOnVersion: v.number(),
      suggestedFieldKeys: v.array(v.string()) }),
    latest: v.optional(v.object({ version: v.number(), confirmedAt: v.number() })),
    status: v.union(v.literal("unconfirmed"), v.literal("confirmed"), v.literal("dirty")),
    issues: v.array(fieldIssueV),
    disclosurePreview: v.array(v.object({ roleKey: v.string(),
      sees: v.array(v.object({ label: v.string(), valueText: v.string() })) })),
  })) });                                                      // 本席位

saveDraft = mutation({ args: { roomId: v.id("rooms"), revision: v.number(), fields: P.briefFields,
    notes: v.string(), sharedNote: v.string(), disclosures: v.array(disclosureV),
    acceptSuggestedFieldKeys: v.optional(v.array(v.string())) },
  returns: v.object({ revision: v.number(), issues: v.array(fieldIssueV) }) });   // 本席位；revision 不符 → STALE_DRAFT

previewConfirm = query({ args: { roomId: v.id("rooms"), patch: v.optional(P.briefFields) },
  returns: v.union(v.null(), impactDTO) });                   // 本席位；patch 用于 quickUpdate 的预览

confirm = mutation({ args: { roomId: v.id("rooms"), basedOnVersion: v.number(), revision: v.number(),
    changeReason: v.optional(v.string()), publicReasonCode: v.optional(v.string()) },
  returns: v.object({ version: v.number(), unchanged: v.boolean(), constraintsVersion: v.number() }) });
  // 本席位；内容未变 → unchanged:true，不写（幂等）；规则变化 → bumpConstraints

quickUpdate = mutation({ args: { roomId: v.id("rooms"), fieldPatch: P.briefFields,
    expectedConstraintsVersion: v.number(), changeReason: v.optional(v.string()),
    publicReasonCode: v.optional(v.string()) },
  returns: v.object({ version: v.number(), unchanged: v.boolean(), constraintsVersion: v.number() }) });
  // 本席位；补丁只能含规则字段；值未变 → unchanged

myVersions = query({ args: { roomId: v.id("rooms") }, returns: v.union(v.null(), v.array(briefVersionDTO)) });
extractDraft = action({ args: { roomId: v.id("rooms"), text: v.string() },          // text ≤ 8,000 字符
  returns: v.object({ suggestedFieldKeys: v.array(v.string()), notice: v.optional(v.string()) }) });
```

`impactDTO = { ruleChanged, changedRuleFieldKeys, nextConstraintsVersion?, currentProposal?: { version, willBeBlocked, reasonTexts: string[] /* 按本人投影 */ }, staleApprovalRoleKeys: string[], feasibleAfter: boolean }`。`feasibleAfter` 只给本人，属于 07 第 7.6 节的有界推断披露。

## 12.6 lists（`convex/lists.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 幂等 / 说明 |
| --- | --- | --- | --- | --- | --- |
| `view` | query | `{roomId, listKey}` | `listItemDTO[]`（confirmed 当前版本 + 作者自己的 draft + 历史版本摘要） | 成员 | — |
| `saveDraft` | mutation | `{roomId, listKey, itemKey, data: P.listItemData, validUntil?}` | `{itemId, version, issues}` | `list.author:<listKey>` | 同 itemKey 草稿原地更新 |
| `discardDraft` | mutation | `{roomId, listKey, itemKey}` | `null` | 作者 | 无草稿则无操作 |
| `previewConfirm` | query | `{roomId, listKey, itemKeys}` | `impactDTO` | 作者 | — |
| `confirm` | mutation | `{roomId, listKey, itemKeys, expectedConstraintsVersion}` | `{constraintsVersion}` | 作者 | 全部已是 confirmed 且无草稿 → 无操作；一批一次 bump |
| `withdraw` | mutation | `{roomId, listKey, itemKey, publicReasonCode, expectedConstraintsVersion}` | `{constraintsVersion}` | 作者 | 已撤回 → 无操作 |

## 12.7 ledger（`convex/ledger.ts`）

| 函数 | 类型 | args | returns | 鉴权 | 幂等 / 说明 |
| --- | --- | --- | --- | --- | --- |
| `view` | query | `{roomId}` | `null \| {entries: [{seq, kind, label, amountCents, status, executionNumber?, createdAt}], committedCents, capCents?}` | 能看见 `committedCents` 的席位（finance；默认 customer） | — |
| `addBaseline` | mutation | `{roomId, label, amountCents, expectedConstraintsVersion}` | `{commitmentId, constraintsVersion}` | `ledger.manage` | 非幂等（每次一条）；界面防双击；加入后总额 > 上限 → `CAP_BELOW_COMMITTED` |
| `voidBaseline` | mutation | `{commitmentId, reason, expectedConstraintsVersion}` | `{constraintsVersion}` | `ledger.manage` | 已作废 → 无操作；首次执行后 → `BASELINE_LOCKED` |
