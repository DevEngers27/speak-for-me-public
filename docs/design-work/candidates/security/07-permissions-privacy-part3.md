# 07 权限、隐私与威胁模型（part3：披露模型、字段×角色矩阵、表受众类别、reasonCode 可见性、动作×角色矩阵）

## 7.8 披露模型

核心 1 要求"对他方可见的内容都经过显式的披露决定"。本设计只有三种让私密信息跨越参与方边界的方式，全部可枚举、可审计：

1. **逐字段披露**：场景为每个私密字段声明 `disclosable`（允许的受众角色）。参与方在确认简报版本时为字段选择受众，结果写进该 `briefVersions.disclosures`（不可变）。撤回 = 确认一个去掉该披露的新版本；已被看到的值无法收回，界面在撤回时明示。备注类字段（`notes`）永远不可披露。
2. **发布目录**：provider 发布 `catalogVersions` 即把其中全部条目（标题、价格、日期）披露给全房间。发布按钮文案："Publish these quotes to everyone in the room"。provider 的未发布草稿只在 `briefDrafts` 中。
3. **固有披露（inherent）**：协作流程无法避免的派生事实，由引擎固定列出，参与方在确认简报时一次性确认（`inherentDisclosuresAck`）：
   - ID-1 席位占用、显示名、角色；
   - ID-2 简报是否已确认、版本号、确认时间、该次确认是否改变了硬约束；
   - ID-3 哪个角色在何时改变了硬约束（不含值）；
   - ID-4 每个提案对查看者的检查结果，按 7.12 的规则粗化；
   - ID-5 run 状态，含"无可行组合"和人工请求的目标角色；
   - ID-6 人的决定（谁、对哪个版本、何种决定、所选公开 reasonCode、可选备注）；
   - ID-7 变更单与任务（价格本就是公开提案的一部分）。

除此三种之外，没有任何代码路径能让 A1/A2/A3 资产出现在他方视图或他方代理上下文中。

## 7.9 字段×角色披露矩阵（首个场景 scope_change）

图例：✔ 总是可见；D 仅当所有者把该字段披露给该角色；✘ 永不。"代理"列：每个代理看到的恰好是其委托人的视图，再减去他方人类撰写的自由文本（见 7.13）。

| 字段 | 所有者/类别 | customer | provider | finance | fixture 中的披露设定 |
| --- | --- | --- | --- | --- | --- |
| `customer.requestedItemKeys` | customer / hard | ✔ | D | D | 披露给 provider、finance |
| `customer.requiredItemKeys` | customer / hard | ✔ | D | D | 披露给 provider、finance |
| `customer.deadline` | customer / hard | ✔ | D | D | 只披露给 finance（provider 侧金丝雀） |
| `customer.preferredDate` | customer / soft | ✔ | D | D | 披露给 provider |
| `customer.preferredItemKeys` | customer / soft | ✔ | D | D | 披露给 provider、finance |
| `customer.notes` | customer / note | ✔ | ✘ | ✘ | — |
| `provider.minChangeOrderCents` | provider / hard | ✘ | ✔ | ✘ 除非 D | 不披露（买方侧金丝雀） |
| `provider.notes` | provider / note | ✘ | ✔ | ✘ | — |
| 已发布目录 `catalogVersions` | provider / 公开硬约束 | ✔ | ✔ | ✔ | 发布即可见 |
| `finance.capCents` | finance / hard | D | D | ✔ | 不披露 |
| `finance.baselineCommittedCents` | finance / hard | D | D | ✔ | 不披露 |
| `finance.headroomCents`（派生：cap − 已承诺） | finance / derived | D | D | ✔ | 只披露给 customer |
| `finance.notes` | finance / note | ✘ | ✘ | ✔ | — |
| `commitments` 台账 | 系统写、finance 拥有 | ✘ | ✘ | ✔ | — |

房间级数据：

| 数据 | customer | provider | finance | 他方代理 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 房间标题、目标、时区、生命周期、约束版本号 | ✔ | ✔ | ✔ | 目标作为不可信数据 | 目标由房主撰写 |
| 席位显示名 | ✔ | ✔ | ✔ | 只见角色 | 代理不需要人名 |
| 提案条款与价格 | ✔ | ✔ | ✔ | ✔ | 不可变、公开 |
| 提案检查结果 | 按 7.12 | 按 7.12 | 按 7.12 | 同其委托人 | 读时计算 |
| 决定：角色、种类、reasonCode | ✔ | ✔ | ✔ | ✔ | ID-6 |
| 决定备注 `note` | ✔ | ✔ | ✔ | 只有本方代理看本方备注 | 人类自由文本不进他方代理 |
| `agentNotes`（rationale） | 本人 | 本人 | 本人 | ✘ | 资产 A3 |
| 人工请求内容 | 目标人 | 目标人 | 目标人 | ✘ | 存在性见 ID-5 |
| 变更单、任务 | ✔ | ✔ | ✔ | — | ID-7 |
| 执行时预算快照 | 若当时 headroom 已披露给 customer，则见 headroom 前/后 | ✘ | ✔ 全部 | ✘ | 读执行快照，不用减法推算 |
| run 状态、轮次、各角色回合进度 | ✔ | ✔ | ✔ | — | 不含回合动作与理由 |
| 模型用量、错误码 | ✘ | ✘ | ✘ | ✘ | 仅运维（internal 指标 query） |

注意：**评审回合的结论（某代理建议接受或拒绝）不对他方公开**。他方只看到"Reviews complete"。理由：代理结论是委托人私密偏好的函数，公开它等于公开偏好；而人的决定（ID-6）是人自己的显式表态。

## 7.10 生成矩阵的代码

矩阵不手写在页面里，而由场景声明生成，引擎在三个地方共用同一份判断：`computeSharedFacts`（UI 与代理上下文）、`viewEvaluation`（检查结果投影）、`budgetPanelFor`（预算面板）。

```ts
// packages/engine/src/disclosure.ts（纯函数）
export function visibleFields(owner: BriefVersionLike, viewerRoleKey: string, decl: FieldDecl[]): SharedFact[] {
  if (owner.roleKey === viewerRoleKey) return [];         // 本人数据走 briefs.mine，不走共享事实
  return owner.disclosures
    .filter((d) => d.audience.includes(viewerRoleKey))
    .map((d) => {
      const f = decl.find((x) => x.fieldKey === d.fieldKey);
      if (!f || f.class === "note" || !f.disclosable?.audiences.includes(viewerRoleKey)) {
        throw new Error("DISCLOSURE_DECL_MISMATCH");      // 写入时已校验；读时再断言一次
      }
      return { ownerRoleKey: owner.roleKey, fieldKey: f.fieldKey, value: f.read(owner), sinceVersion: owner.version };
    });
}
```

`f.read` 对派生字段（`headroomCents`）在服务端用当前台账计算；它只在 `computeSharedFacts` 内被调用，调用结果直接成为 DTO 或代理上下文的一部分。

## 7.11 表受众类别（一表一受众）

| 类别 | 含义 | 表 |
| --- | --- | --- |
| R 房间可见 | 任一成员可读全部字段（`participants.userId` 除外，DTO 不输出） | `rooms`、`participants`、`catalogVersions`、`proposals`、`decisions`、`runs`、`changeOrders`、`tasks`、`events` |
| P 参与方私有 | 只有所属参与方可读 | `briefDrafts`、`briefVersions`、`agentNotes`、`humanRequests`（目标人） |
| F 角色私有 | 所有者角色可读，其他角色只能拿到受控投影 | `commitments`（finance） |
| O 房主可见 | — | `roomInvites` |
| S 仅系统 | 只被 internal 函数与运维 query 读取 | `users`（本人行经 `users.me`）、`constraintSnapshots`、`agentTurns`、`modelCalls`、`counters` |

规则：
1. R 表新增字段必须是"对全体成员公开"的值，代码评审清单与 TC-PRIV-03 的 schema 分类测试共同把关。
2. 跨受众读取只允许以下五条受控投影，每条只有一个实现函数：X1 `computeSharedFacts`（P→他方）、X2 `budgetPanelFor`（F→customer）、X3 `turnProgressFor`（S→R：只输出 roleKey、kind、status）、X4 `requestBadgesFor`（P→R：只输出目标角色与种类）、X5 `viewEvaluation`（规则结果→按查看者粗化）。
3. 任何其他从 P/F/O/S 表读出数据并返回给客户端的代码都视为缺陷。

## 7.12 reasonCode 可见性与动作×角色矩阵

查看者看到某条检查结果的规则：若该 code 无所有者、或查看者就是所有者角色、或该 code 依赖的字段全部已披露给查看者，则看到原 code 与参数；否则只看到其公开粗类。粗化后去重，因此 provider 无法从"几条失败"推断失败原因的数量。

| code | 所有者 | 依赖字段 | 公开粗类 | 参数 |
| --- | --- | --- | --- | --- |
| `UNKNOWN_ITEM` / `CATALOG_STALE` / `DELIVERY_OPTION_UNAVAILABLE` | — | — | `CATALOG` | itemKeys |
| `DELIVERY_IN_PAST` | — | — | `TIMING` | — |
| `ITEM_NOT_REQUESTED` | customer | `requestedItemKeys` | `BUYER_CONSTRAINT` | itemKeys |
| `DEFERRED_MISMATCH` | customer | `requestedItemKeys` | `BUYER_CONSTRAINT` | — |
| `MISSING_REQUIRED_ITEM` | customer | `requiredItemKeys` | `BUYER_CONSTRAINT` | missingItemKeys |
| `AFTER_DEADLINE` | customer | `deadline` | `BUYER_CONSTRAINT` | daysLate |
| `OVER_BUDGET` | finance | `headroomCents` | `BUYER_CONSTRAINT` | shortfallCents |
| `BELOW_PROVIDER_MINIMUM` | provider | `minChangeOrderCents` | `SELLER_CONSTRAINT` | gapCents |

示例（fixture，预算降到 $4,800 后的提案 v1：LOGIN + REPORTS 加急 $900）：finance 看到 `OVER_BUDGET（shortfall $100）`；customer（已获 headroom 披露）看到同样内容；provider 只看到 "Blocked: buyer-side constraint"。

动作×角色矩阵（✔ 允许；— 不适用；条件列的守卫在 04/08/09 中有迁移级定义）：

| 动作 | 函数 | customer | provider | finance | 附加条件 |
| --- | --- | --- | --- | --- | --- |
| 建房 | `rooms.create` | 任一有建房资格的用户 | | | `ROOM_CREATION` 策略 |
| 发邀请、撤销邀请 | `invites.issue` / `invites.revoke` | 仅房主 | 仅房主 | 仅房主 | 席位 open、房间未关闭 |
| 接受邀请 | `invites.accept` | 持有效令牌的非成员 | | | 7.7 |
| 关闭房间 | `rooms.close` | 仅房主 | 仅房主 | 仅房主 | 未关闭 |
| 编辑并确认本人简报 | `briefs.saveDraft` / `briefs.confirm` | ✔ 本人 | ✔ 本人 | ✔ 本人 | 房间未关闭 |
| 粘贴抽取草稿 | `briefs.extractDraft` | ✔ | ✔ | ✔ | 每用户每日上限 |
| 发布目录 | `catalog.publish` | ✘ | ✔ | ✘ | 每日 ≤ 5 次 |
| 修改预算上限 | `budget.update` | ✘ | ✘ | ✔ | 新上限 ≥ 已承诺 |
| 批准、拒绝、撤回 | `decisions.decide` | ✔ | ✔ | ✔ | 角色在提案的 `requiredApproverRoleKeys` 快照中；携带期望约束版本 |
| 回答人工请求 | `requests.answer` | 目标人 | 目标人 | 目标人 | 请求 open 且约束版本未变 |
| 请求重新协商 | `runs.requestRenegotiation` | ✔ | ✔ | ✔ | run 不在 running；每用户每日上限 |
| 重试失败的 run | `runs.retry` | ✔ | ✔ | ✔ | run 为 failed |
| 更新任务状态 | `tasks.updateStatus` | ✘ | 被指派人 | ✘ | — |
| 查看本人台账 | `budget.myLedger` | ✘ | ✘ | ✔ | — |
| 查看房间、事件、结果 | `rooms.view` / `events.list` / `results.view` | ✔ | ✔ | ✔ | 按投影 |
