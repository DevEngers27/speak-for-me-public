# 14 · 首个场景（part3：公共文本模板）

> 分片总表见 `14-scenario-scope-change.md` 顶部。本片：§8。

## 8. 公共文本模板（成员 `templates`）

### 8.1 规则

- 对他方可见的一切文字只由 `renderPublicText(templateKey, fields)` 从结构化字段渲染（D13）；模板英文、外置（D26 / PD-13）；槽位类型只有 `PublicCents`、`IsoDate`、`CatalogTitle`、`RoleLabel`、`VersionNo`、封闭枚举，没有自由 `string`；实现用 foundation text-templates 的 `defineTemplate`（占位符与槽位编译期一致、渲染时拒绝多余字段、输出统一编码）。
- 每个模板有三种受众变体：`room`（全员，provider 只看到这一种）、`buyer`（customer / finance，只读该买方按披露开关能看到的字段）、`owner`（被引用私密字段的所有者，或人工请求的 `toRole`）。选择变体的函数只看 `(viewer, 字段所有者, disclosures)`。
- 每个变体声明 `reads`；Proxy 读取测试断言"实际读到的字段集合 == 声明"（spike privacy-canary 抓到过声明漂移）。事件 `payload` 只放房间可见的结构化字段，私密数值经 `restrictedRef` 在渲染时按查看者连接（D14）。
- 不存在 deferred 措辞；customer 的 `owner` 变体现算"未纳入的愿望项"（D11）。模型 `rationale`、人类 `note`、简报 `notes` 永不进入任何模板。

### 8.2 提案（`proposal.created`）三受众示例（主线 v1，cv 1）

| 受众 | reads | 渲染 |
| --- | --- | --- |
| room（三方都有） | `actorRole`、`lines[].title`、`terms.modifiers`、`terms.amountCents`、`terms.deliveryDate` | "Provider agent proposes Audit log export + SSO login (SAML) + Usage dashboard for $900, delivery 2026-11-18." |
| buyer：finance | + `committedCents`、`capCents`、`headroomCents` | "+$900 change · committed $4,000 → $4,900 · cap $5,000 · headroom after $100." |
| buyer：customer（只开 `capCents`） | + `capCents` | "+$900 change · finance cap $5,000." |
| owner：customer（愿望清单所有者） | `preferredItemKeys`、`terms.itemKeys`、目录标题 | "Not included from your wishlist: Slack alerts." |

带 modifier 时 room 变体写作 "… proposes Audit log export + SSO login (SAML) with Rush delivery for $950, delivery 2026-11-12."。provider 另有 `proposal.fit`："Fit: ok" / "Blocked under the current constraints."（只对当前提案）。差异模板 `proposal.diff`（room）："Changes from v1: removed Usage dashboard; $900 → $800; delivery 2026-11-18 → 2026-11-16."

### 8.3 `constraints_changed` 的三种渲染

| 原因 | owner | buyer | room（provider） |
| --- | --- | --- | --- |
| finance 改上限（`budget.setCap`、finance `briefs.confirm`、`raise_cap` 回答） | finance："You changed the budget cap from $5,000 to $4,800 (constraints v2). 2 approvals no longer apply." | customer，`capCents` 已披露："Finance updated the budget cap to $4,800 (constraints v2). Proposals are being re-checked."；未披露："Finance updated the budget (constraints v2). Proposals are being re-checked." | "Constraints changed (v2). Proposals are being re-checked." |
| customer 改截止日 / 必需项（`briefs.confirm`、`extend_deadline` / `drop_items` 回答） | customer："You moved your deadline from 2026-11-20 to 2026-11-29 (constraints v3)." | finance，字段已披露："Customer moved the deadline to 2026-11-29 (constraints v3)."；未披露："Customer updated a private constraint (constraints v3)." | "Constraints changed (v3). Proposals are being re-checked." |
| provider 改目录（cause `catalog_changed`） | —（provider 的 `constraints_changed` 同 room 列；它自己的动作由下方目录事件呈现） | customer、finance："Provider changed the catalog (constraints v2). Proposals are being re-checked." | "Constraints changed (v2). Proposals are being re-checked." |
| `clock` | — | customer、finance："Delivery date 2026-11-18 of v1 has passed (constraints v2)." | "Constraints changed (v2). Proposals are being re-checked." |

`payload = { fromVersion, toVersion }`（03 §3.11.1，不含 cause、角色或任何数值——它对全房间可见，D14）；`restrictedRef = { table: 'constraintRevisions', id }`，渲染器经 revision 的 `cause` / `actorUserId` / `sourceRefs` 连接到简报版本行，finance / customer 变体里的 cause、变更角色、金额与日期都由此按查看者权限连接（03 §3.11.1 的披露类：cause 与变更角色只给 customer、finance）。provider 对**任何** cause 的 `constraints_changed` 都只见 "Constraints changed (v{n}). Proposals are being re-checked."（D14），包括目录与 `clock`——否则"非 clock、非目录"的递增就等于告诉 provider 是某个买方改了私密约束。

目录事实本身对三方同一句，但它来自目录自己的 room 类事件，不来自 `constraints_changed`：`catalog_item_retired { itemKey, revision }` → "Provider retired Audit log export from the catalog."；`catalog_item_confirmed { items[] }`（改价批）→ "Provider changed the price of Usage dashboard from $100 to $120."（旧价取上一 revision 行，目录行经路径 ① 公开；标题从 `catalogItems` 当前行读）。两条事件与 `constraints_changed` 同一提交，时间线相邻显示；这样目录变化对 provider 可见而无需偏离 D14，也不需要 canon 异议。以上与 spike privacy-canary 的"按受众三种模板零越权"一致，并修正了它 provider 文案里的 "Finance constraint changed"（fixtures-walkthrough review r06）。

### 8.4 检查结果（买方；provider 只有 fit）

| 码 | finance | customer |
| --- | --- | --- |
| `budget.over` | "Over budget by $100 ($4,900 > $4,800)." | 开 `headroomCents`："Over the available budget by $100."；否则折叠为 `private.constraint_unmet` |
| `private.constraint_unmet` | — | "A constraint private to another participant is not met." |
| `date.after_deadline` | 截止日已披露："Delivery is 14 days after the customer's deadline (2026-11-20)." | "Delivery 2026-12-04 is 14 days after your deadline 2026-11-20." |
| `item.required_missing` | 已披露："Missing a required item: Audit log export." | 同左；`not_offered`："Audit log export is no longer in the provider's confirmed catalog." |
| `version.stale_constraints` | "This version no longer applies (constraints v2)."（stale 提案只显示这一条，不重算预算与掩码检查，06 §8） | 同左 |
| `item.retired` / `version.stale_source` | "Audit log export was retired from the catalog." / "The catalog changed since this version: Usage dashboard." | 同左 |

### 8.5 等待、人工请求与审批

| 模板 | room（provider） | buyer | owner（`toRole`） |
| --- | --- | --- | --- |
| `run.waiting`（`run_needs_input` / `human_request_opened` 对 provider 的投影，D12 ⑦） | "Waiting on another participant." | "Waiting on Finance to decide on the budget." | "Your decision is needed: {question}" |
| `request.infeasible.finance` | — | — | "No option fits a $4,700 cap. The cheapest option (Audit log export + SSO login (SAML), $800) needs a cap of $4,800." |
| `request.raise_cap` | — | — | "Raise the cap to $4,800 (+$100). Makes Audit log export + SSO login (SAML) ($800, delivery 2026-11-16) fit." |
| `request.drop_items` | — | — | "Make Audit log export optional. Enables, for example, SSO login (SAML) for $500, delivery 2026-11-13." |
| `request.extend_deadline` | — | — | "Move your deadline to 2026-11-29. Enables Audit log export + SSO login (SAML) with Rush delivery for $950." |
| `request.choose_candidate` | — | — | "Go with Audit log export + SSO login (SAML) for $800, delivery 2026-11-16. This creates a new version for everyone to approve; it approves nothing by itself." |
| `request.disclose` | — | — | "Share your deadline with Finance so the budget owner can see the conflict." |
| `request.pass_to_next`（canon D15 `pass_to_next`，只在 `infeasible` 请求、收件人不是 `relaxationOrder` 末位时出现） | — | — | "Pass this to Finance. Finance will get their own version of this question; nothing changes until someone acts."（不提示对方是否卡住：是否出现只取决于位置） |
| `request.keep_as_is` / `request.end_run` / `request.retry_turn` | — | — | "Give the agents one more round." / "End this negotiation without agreement." / "Retry your agent's turn." |
| `turn.blocked`（provider 候选被规则阻断，不成为提案；事件 `turn_completed`，payload 无原因，07 DX-1） | —（provider 是被阻断选项的所有者，只见 owner 变体） | customer、finance："A provider option was blocked by the current constraints."（无条款、无金额、无原因） | provider："Round {n}: your option was blocked under the current constraints." |
| `agent.recommended`（`turn_completed` 的 owner 变体） | 不渲染按角色的动作——room 与 buyer 只见轮次结局（DX-4）："v1 is ready for approval" / "Agents start round 2" | 同左 | 本方代理框："Your agent recommends accepting v1. Suggestion only, never counted as approval." |
| `approval.recorded` | "Customer approved v2 under constraints v2." / "Customer withdrew approval of v2." / "Finance rejected v3." | 拒绝时按 `humanReasonKeys[].audience` 追加理由：`room` 受众的键对全员追加（"Reason: scope insufficient."），`buyers` 受众的 `over_our_limit` 只对 customer / finance 追加，provider 只见 "Finance rejected v3." | — |

### 8.6 执行与 setup

| 模板 | room | buyer | owner |
| --- | --- | --- | --- |
| `execution.recorded` | "Change order CO-1 recorded: v2 under constraints v2, $800, 2 tasks for the provider. Internal record only — no payment, transfer or signature happens in this system." | customer（未开预算开关）："+$800 recorded in the change order." | finance（AIA G701 金额链，08）："Baseline $4,000 · previously approved changes $0 · committed before $4,000 · this change +$800 · committed after $4,800 · cap $4,800." |
| `execution.tasks`（provider 自己的任务区） | — | — | "Build audit log CSV export — due 2026-11-16 · Implement SAML SSO login — due 2026-11-16." |
| `ledger.baseline_recorded`（事件 `baseline_recorded`） | "Finance recorded existing commitments (simulated)." | — | finance："Baseline commitments: $4,000 (simulated)." |
| `catalog.item_confirmed`（事件 `catalog_item_confirmed`，setup 期首批） | "Provider confirmed the catalog: 5 items and 1 option (simulated)." | — | — |
| `catalog.item_retired` / `catalog.price_changed`（事件 `catalog_item_retired` / 改价批 `catalog_item_confirmed`，见 §8.3） | "Provider retired Audit log export from the catalog." / "Provider changed the price of Usage dashboard from $100 to $120." | 同左 | 同左 |

`provenance` 为 `seeded` / `stub` 的行在界面统一带 `SimulatedBadge`（"Simulated example data"、"Recorded agent output (stub mode)"），模板文字本身不承担标注（核心 8）。
