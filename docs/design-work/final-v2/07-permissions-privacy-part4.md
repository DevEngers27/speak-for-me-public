# 07 · 权限、隐私与威胁模型（part4：披露模型）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.8 披露模型

### 7.8.1 受众类（引擎定义）

```ts
// core/engine/privacy/audience.ts（零依赖纯 TS）
export type Audience =
  | { kind: "room" }                        // 房间全部成员（已通过 member 检查）
  | { kind: "roles"; roles: RoleKey[] }     // 显式角色集合
  | { kind: "self" }                        // 行的所属角色 ownerRole（briefs.role、turns.role、humanRequests.toRole、ledgerEntries→finance）
  | { kind: "creator" }                     // 建房人（只用于邀请管理）
  | { kind: "system" };                     // 永不离开服务端
export function canSee(viewer: { role: RoleKey; isCreator: boolean }, a: Audience, ownerRole?: RoleKey): boolean {
  // room → true；roles → 包含 viewer.role；self → viewer.role === ownerRole；creator → isCreator；system → false
}
```

- `self` 以角色为单位（v1 一角色一人，D24）；`creator` 不带来业务字段读权；fail-closed。
- 代理读权 = 委托人读权 − `displayName`、房间 `title`、人类自由文本（§7.14）。

### 7.8.2 披露注册表 `DISCLOSURE`

```ts
// core/engine/privacy/disclosure.ts（引擎表）+ core/scenarios/scope-change/fields.ts（场景字段）
type FieldRule = {
  audience: Audience;
  agent: "same" | "never" | "untrusted";      // 进入委托人代理上下文的方式；untrusted = 包进 <untrusted_data>
  shareable?: { audiences: RoleKey[]; requiresAck: boolean };  // 仅场景简报字段：可经 sharedFacts 披露给谁
  derivedFrom?: string[];                      // 派生值的输入字段路径（污点传播，§7.8.5）
};
export const DISCLOSURE: Record<FieldPath, FieldRule> = defineDisclosure({ /* §7.9 的每一行 */ });
```

- **完整性**：`schema.tables[t].validator` 是公共字段（convex `server/schema.ts` 已核实）；测试递归遍历 `VObject.fields`、联合的 `.members`、数组元素，得到每个叶子路径，必须在 `DISCLOSURE` 中登记，新增字段未登记即失败（TC-PRIV-10）。
- **同源**：`projectForRole` 的各 XP 投影（§7.10）、金丝雀白名单（16）、代理上下文的排除断言都从 `DISCLOSURE` 派生，不另抄一份。

### 7.8.3 跨角色值的两条显式披露路径

**路径 ① 目录确认**：provider `catalog.confirm` 即把该条目的 `itemKey`、`title`、`priceCents`、`leadDays`、`kind`、`taskTemplates` 披露给全房间；按钮文案 "Confirm and show to customer and finance"。`draft` 条目只有 provider 可见。`title` 是唯一进入他方代理上下文的人写字符串（§7.15 LP-1）。

**路径 ② `sharedFacts` 披露账本**（只追加；跨角色私密值的唯一真相源）：

字段（03 §3.6 定稿，只追加）：`roomId`、`fromRole`、`field`（场景 `SHAREABLE_FIELDS` 的键）、`seq`（键内从 1 连续，"最新行"按它取）、`value`（`sharedFactValueV`：只有 `date` / `itemKeys` / `enum` / `cents`，无自由文本；`null` = 撤回）、`audience`（不含 `fromRole`）、`briefVersion`（值所属的 `fromRole` 简报版本）、`source`（`brief_confirm` / `manual` / `request_answer` / `ledger`）、`humanRequestId?`、`createdBy`、`provenance`、`createdAt`；索引 `by_room_from_field`；唯一写入 helper `appendSharedFact`。

**有效可见性**：对查看者 V 和 `(fromRole O, field F)`，取该键最新一行 R；若 `R.value !== null` 且 `V ∈ R.audience`，V 看到 `R.value`（标注 "as of O's brief vN"）；否则 V 看不到 F。投影与代理上下文只读这张表，**从不读取他方 `briefs` 行**（规则求值的 `loadRuleInput` 除外，见 §7.18）。

**写入规则**（每条都经 §7.15 LP-3 闸门；代理没有任何写入口）：

| 来源 | 函数 | 写什么 |
| --- | --- | --- |
| `brief_confirm` | `briefs.confirm`（O 本人）经 `materializeDisclosures` | 对每个可共享字段 F：若新版本的值或受众（来自参数 `disclosures`）相对最新行有变化，插入一行 `{value: 新值, audience, briefVersion: N}`；若受众变为空且之前非空，插入撤回行 `value: null`。表单默认勾选沿用最新行的受众 |
| `manual` | `sharedFacts.add({ roomId, field, audience, confirmOwnDisclosure })`（O 本人） | **无 value 参数**：值从 O 当前已确认简报复制；用于不改简报内容时扩大或缩小受众；写事件 `disclosure_changed` |
| `request_answer` | `humanRequests.answer`（toRole 本人，选项 effect 为 `disclose { field }`） | 受众 = 最新行受众 ∪ {提问方角色}；值从回答者当前简报复制 |
| `ledger` | `briefs.confirm`（finance）与 `ledger.recordBaseline` 经 `materializeDisclosures` | 派生字段 `committedCents` / `headroomCents` 的值或受众变化时重写；执行后房间终态，不再变化 |

撤回不溯及既往：已被看到的值无法收回，取消勾选时界面明示。

**按值所属版本判定（禁止溯及既往）**：任何历史值（事件中的旧上限、执行时的已承诺额）只在"该值所属版本生效时的受众"包含查看者时才渲染。实现：渲染器按 `(fromRole, field)` 取 `briefVersion ≤ 该值版本` 的最新 sharedFacts 行判定受众，而不是取当前行。修正 security 底稿被评委指出的"事后披露泄露历史值"（TC-PRIV-14）。

### 7.8.4 场景 scope_change 的可共享字段（`SHAREABLE_FIELDS`）

| fromRole | field | 值类型 | 允许受众 | requiresAck | 产品默认勾选 | 主 fixture（14 §9.2） | canary 变体（14 §9.5） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| customer | `requiredItemKeys` | itemKeys | provider、finance | 是 | 无 | provider、finance | provider、finance |
| customer | `deadline` | date | provider、finance | 是 | 无 | provider、finance | 仅 finance（provider 侧金丝雀：截止日对 provider 隐藏，候选集不被截止日过滤） |
| customer | `preferredItemKeys` | itemKeys | provider、finance | 否 | 无 | provider | provider |
| finance | `capCents` | cents | customer | 是 | 无（U1） | customer | customer |
| finance | `committedCents`（派生：Σ `ledgerEntries.amountCents`） | cents | customer | 是 | 无 | 无 | 无 |
| finance | `headroomCents`（派生：cap − committed） | cents | customer | 是 | 无 | 无 | 无 |
| provider | — | — | — | — | — | provider 的硬数据只有目录，经路径 ① 公开 | 同 |

v1 没有 `preferredDate`（03 §3.6、14 §4）。主 fixture 的披露设定决定 provider 首轮快照的大小与走查的调用次数（14 §9.2、05 §5.15 以"主 fixture"列为准），"deadline 只给 finance"只在 canary 变体出现（completeness-02、names-34）。16 §16.7.4 的隐私扫描跑在 canary fixture 上：配置 C1 = 本表"canary 变体"列，C2 = "主 fixture"列，C0 = 全部不共享，Ck = 单字段单受众（3 × 2 + 3 × 1 = 9 个）。

- 永不可共享：所有 `softFields.notes`、`approvals.note`。finance 的预算数字永不可共享给 provider（canon D12 ④、PD-12；扩展点列入 17）。
- 金丝雀与非干扰测试必须覆盖"每个可共享字段对每个可能受众**未披露**"的配置（16 披露配置扫描）：评委发现 security 底稿的 fixture 恰好披露了被泄露字段，测试因此失明。

### 7.8.5 派生值继承最严格类（污点传播）

规则：派生值的受众 = 其全部输入受众的交集（最严格者）；只有出现在 §7.8.6 解密清单中的派生值例外。测试按 `derivedFrom` 自动检查：派生字段的受众不得宽于输入交集，除非列在 `DECLASSIFIED` 常量（由 TC-PRIV-10 消费，修正 review r16）。

| 派生值 | 输入 | 继承的受众 |
| --- | --- | --- |
| `committedCents` | `ledgerEntries` | finance；customer 仅当 finance 共享 `committedCents` |
| `headroomCents` | `capCents`、`ledgerEntries` | finance；customer 仅当共享 `headroomCents`，或同时共享 `capCents` 与 `committedCents` |
| `overByCents` / `shortfallCents` | `amountCents`（公开）、headroom | 同 headroom |
| `executions.committedBeforeCents` / `committedAfterCents` | ledger、提案金额 | 同 committed（按执行时生效的 sharedFacts 行判定） |
| 单条检查结论（`budget.over`、`date.after_deadline`、`item.required_missing`…） | 该检查的输入 | 检查所有者；他人仅当已获全部输入（§7.11） |
| `turn.candidateSnapshot` | `viewFor(turn.role)` | `self`（turn.role） |
| `humanRequests.options` | `viewFor(toRole)` | `self`（toRole）；写入前 `assertOptionsProjected` |
| customer 视图里的"未纳入条目" | customer 简报 − `terms.itemKeys` | customer；现算、不存、不进 `termsKey`（D11） |
| 评估代理的动作与 `reasonKey` | 评估方视图 | `self`（评估方） |
| 审批有效性（`effective` / `stale_approve` / `withdrawn`） | `approvals`、`room.constraintsVersion`（均公开） | room |

### 7.8.6 显式解密清单（v1 全集）

| # | 公开的派生值 | 输入里的受限数据 | 公开给 | 每次泄露上界 | 约束机制 |
| --- | --- | --- | --- | --- | --- |
| DX-1 | 当前提案 `fit: 'ok' \| 'blocked'`；以及 provider 候选被规则阻断的事实（不成为提案：买方只见"本轮有一个 provider 选项被阻断"，不含条款与金额；provider 只见 `blocked`） | 全部硬约束 | room（provider 只见这一位） | 1 bit / 提案或被阻断候选 | 每 run 每角色 ≤ 4 次 `propose / counter`（D12 ⑤）；历史与 `stale` 提案不重算（D12 ①、06 §8） |
| DX-2 | **可行性 1 bit**：约束变更后新 run 的预检结论（保留当前提案直接 `pending_approval`、`negotiating` 还是 `needs_input`；provider 看到的是 "awaiting approval"、"agents working" 还是 `run_waiting`）；**不含**变更者是谁（DX-5 / DX-7） | 全部硬约束 | room | 每次约束变更 ≤ log₂3 ≈ 1.6 bit（三种结局；对二分余量有效的约 1 bit） | 约束变更类写入每用户每房间每小时 ≤ 6 次（D12 ⑥）只能减速；真正的总量上界来自 `price_writes` 桶（每房间 open 期间每 24 小时 ≤ 3 批改价，每个 open run 内同一 itemKey 改价 ≤ 1 次）与 `setCap` / customer 硬字段的每房间每 24 小时 ≤ 6 次子桶（§7.13、12 B7）；每次目录改价对全员可见（`catalog_item_confirmed` 事件带新价）且使全部审批失效 |
| DX-3 | **等谁**：open 人工请求的存在、`kind`、`toRole` | 哪条约束在起作用（`relaxationOrder` 确定性选择） | 目标角色：全文；其他买方（customer / finance）：`kind` + `toRole`；provider：只有 `run_waiting`（D12 ⑦） | ≈ 2 bit / 请求 | 每 run 至多一个 open 请求（D15） |
| DX-4 | 回合结局：全部评估建议接受且 `passesChecks` → `pending_approval`，否则进入下一轮（`roundNo`）；他方只见结局，**不见哪位评估方的代理做了什么动作**（`turn_completed` 对他人只是 "finished"，14 §8.5 的 room / buyer 变体只渲染 "v1 is ready for approval" / "Agents start round 2"） | 评估方视图 | room | 1 bit / 轮 | `maxRounds = 3` |
| DX-5 | `constraints_changed` 的发生与新 `constraintsVersion` | 简报 / 预算 / 目录 | room；变更角色与 cause 只给 customer / finance（经 `restrictedRef → constraintRevisions`），provider 只见 "Constraints changed"（无作者；provider 只能区分"自己的目录变更"与"他人的变更"，不能区分 customer 与 finance） | 1 bit / 变更 | 同 DX-2；16 TC-PRIV-21 元形态测试：不同买方引起的同结局 bump，provider 的 `rooms.view` 与 `timeline.page` 规范化后逐字节相同 |
| DX-6 | 人的审批决定：角色、`decision`、绑定版本、`reasonKey` | 决定者的私密理由 | 角色 / 决定 / 版本：room；`reasonKey` 按场景 `humanReasonKeys[].audience`（`room` 或 `buyers`，如 finance 的 `over_our_limit` 不给 provider，08 A13、14 §3），选项旁标注实际受众 | 人的显式表态 | `note` 只给本方；任何他方代理上下文不含 `reasonKey` |
| DX-7 | 简报确认状态（`confirmed / not_confirmed`）；版本号与披露变更的发生 | 简报内容 | 确认状态：room；**版本号只给买方**（customer / finance）——房间 `open` 后 provider 对非本人的 `briefVersion` 一律 `null`，他人的 `brief_confirmed` 对 provider 并入同一提交的 "Constraints changed (vN)"，否则"finance 简报 +1 与 cv +1 同一提交"就暴露了是谁改了上限（privacy-02；03 §3.11.1、12 §12.17）。`disclosure_changed`：新旧两行受众内的查看者见字段与值（或 "no longer shared with you"）；受众外的查看者，若同一提交含 `constraints_changed` 则**并入**该条、不单独渲染（否则 "Finance updated what they share" 与 cv +1 同一提交同样暴露变更者——改上限会经 `materializeDisclosures` 重写已共享的 `capCents` 行），否则只见 "{role} updated what they share"。由他人发起的约束变更提交内全部条目（含 `constraints_changed` 本身与同提交的 `run_started` 等）对 provider 的 `actorLabel` 一律为空（§7.17） | 只暴露"有人重新确认 / 改过披露"；约束变更提交对 provider 只是一条无作者的 "Constraints changed (vN)" | — |
| DX-8 | `run.endedReason` ∈ `executed` / `constraints_changed` / `renegotiation_requested` / `no_agreement` / `request_expired` / `canceled_by_creator` / `room_closed`（03 §3.8 的枚举） | 全部 | room | 1 bit / run | — |
| DX-9 | customer 的 counter **不是提案**（05 §5.8.4：通过全量检查才转发进 provider 的下一快照），只经 DX-11 外显 | 已共享给 customer 的预算 | 见 DX-11 | 见 DX-11 | 见 DX-11 |
| DX-10 | 执行结果：变更单、任务、金额（目录价之和） | — | room | — | 预算快照按 §7.8.5 |
| DX-11 | counter 的转发结局：给 customer 的是 `turns.result.counterForwarded`（转发与否）；给 provider 的是 "The customer suggested O4" 加该候选进入其快照（等于告知一个它没提过的候选能通过全量检查） | 全部硬约束 | customer 本方；provider | 每次 counter ≤ 1 bit 全局可行性（候选 ≤ 12 选 1 的选择本身 ≤ log₂(n) bit 只含 customer 已可见的值） | 每 run ≤ 4 次 counter（D12 ⑤）；每房间每 24 小时 ≤ 6 个 run（`run_starts`，12 B7）；进入 provider 上下文的只有被转发候选的 `optionKey` / 条款 |
| DX-12 | `choose_candidate` 的复核结局：`humanRequests.answer` 返回 `applied` 还是 `regenerated`（全局复核是否通过） | 全部硬约束 | customer（`toRole`） | 每次回答 ≤ 1 bit | 受 D12 ⑥ 节流；候选本就来自 customer 自己的视图（12 Q4） |
| DX-13 | provider 对被转发候选的 `fit` 隐含：被纳入快照即 "ok" | 全部硬约束 | provider | 包含在 DX-11 的 1 bit 内 | 同 DX-11 |

**不在清单里的派生值一律继承最严格输入的类。** 非干扰定义（可测试）：对任一角色 R，若两个房间状态只在"对 R 不可见的字段值"上不同，且两者经 DX-1…DX-13 对 R 公开的值相同，则 `rooms.view`、`timeline.page`、`briefs.mine`、R 的代理上下文的规范化 JSON 逐字节相同（TC-PRIV-05；16 §16.7.5 的 `declassified()` 必须恰好实现 DX-1…DX-13，每个 DX 一个提取器 `DECLASSIFIERS[dx]`，元断言 `Object.keys(DECLASSIFIERS) == DECLASSIFIED`；新增派生信道必须先进清单，不得在测试里临时放白名单）。该定义按单个状态成立；沿协商轨迹累积的推断（多次 DX-1 / DX-2 / DX-11 / DX-12）不被它捕获，只由上表的频率上界约束，并在 §7.21 残余风险中量化。
