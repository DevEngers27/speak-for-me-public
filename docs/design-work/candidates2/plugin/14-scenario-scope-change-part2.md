# 14 首个场景插件：`software_change`（part2：fixture、走查、UI 片段）

## 1. 主 fixture `feasible`（全部 simulated；日期在 seed 时按 `dateShiftDays` 平移，保证 `today` 早于全部日期）

| entryKey | kind | 价格 | standardDate | expeditedDate | taskTitles |
| --- | --- | --- | --- | --- | --- |
| `LOGIN` | work_item | $450 | 2026-11-20 | 2026-11-13 | Rebuild login flow; SSO regression tests |
| `REPORTS` | work_item | $300 | 2026-11-20 | 2026-11-13 | Monthly report page |
| `EXPORT` | work_item | $500 | 2026-12-04 | 2026-11-27 | CSV/PDF export |
| `EXPEDITE` | expedite_fee | $150 | — | — | — |

- customer：`requiredEntryKeys=[LOGIN]`，`niceToHaveEntryKeys=[REPORTS, EXPORT]`，`deadline=2026-11-27`（硬），`preferredDate=2026-11-13`（软），`notes="Reports feed the Dec 1 board review; launch date is flexible."`（私密）。canary：`notes` 末尾含 `CANARY-CUS-4410`。
- provider：`minimumMarginNote="Prefer bundles that include REPORTS. CANARY-PRV-2290"`。
- finance：账户 `change_budget` cap $5,000，baseline 条目 $4,000（`kind:'baseline', simulated:true, label:'Existing SOW commitments'`）；`notes` 含 `CANARY-FIN-7731`。
- 算术核对：全量 LOGIN+REPORTS+EXPORT+EXPEDITE = 450+300+500+150 = **$1,400**（与原 README 一致，超余量 $1,000）；一期 LOGIN+REPORTS+EXPEDITE = **$900**，承诺后 **$4,900**（与原 README 一致）。

### 1.1 $5,000 上限下的枚举结果（余量 $1,000）

| candidateKey | 选择 | 金额 | 交付 | 通过 | niceToHave | 首选日 | rank |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `c_LOGIN+REPORTS_exp` | L+R+加急 | $900 | 11-13 | ✓ | 1 | ✓ | 1 |
| `c_LOGIN+REPORTS_std` | L+R | $750 | 11-20 | ✓ | 1 | ✗ | 2 |
| `c_LOGIN_exp` | L+加急 | $600 | 11-13 | ✓ | 0 | ✓ | 3 |
| `c_LOGIN_std` | L | $450 | 11-20 | ✓ | 0 | ✗ | 4 |
| — | L+E 标准 | $950 | 12-04 | ✗ `sc.deadline_missed` | | | |
| — | L+E+加急 | $1,100 | 11-27 | ✗ `ledger.over_cap` | | | |
| — | L+R+E 标准 | $1,250 | 12-04 | ✗ 两项 | | | |

## 2. 变体 fixture

| fixtureKey | 与主 fixture 的差异 | 预期路径 |
| --- | --- | --- |
| `feasible` | 无 | 提案 → 审批中途降到 $4,800 → 重谈 → 执行 |
| `tradeoff` | customer notes 改为 "Launch must be Nov 13; reports can wait." | 降预算后 provider 选 L+R 标准，customer 代理 `object` 偏好 `c_LOGIN_exp` → 轮次用尽 → humanRequest 给 customer |
| `infeasible` | finance 降到 $4,400（余量 $400 < LOGIN $450） | 枚举为空 → 不调模型 → humanRequest 给 finance（`raise_cap_to_min` = $4,450） |
| `boundary` | 降到 $4,750 | L+R 标准 $750 = 余量，判通过（`<=`） |

## 3. 预算下调完整走查（`feasible`）

| 步 | 谁 / 函数 | 读写 | 结果 |
| --- | --- | --- | --- |
| 1 | owner `seed.createFromFixture`（CLI） | 写 rooms、ledgerAccounts、ledgerEntries(baseline)、catalogEntries(confirmed, simulated)、briefDrafts×3、invites×3 | constraintsVersion = 1 |
| 2 | 三人 `invites.accept`；各自 `briefs.confirm` | 插 participants、briefVersions；customer 硬约束首次确认 → `bumpConstraints`（v2）；provider/finance 的 hardKey 为空串不递增 | 全部就绪 |
| 3 | 任一参与方 `runs.start` | 守卫：全部席位有人、全部简报已确认、无活动 run；插 run#1(negotiating)、turn#1(provider)，同事务 `runAfter(0, internal.agentTurns.run)` | "Provider agent drafting…" |
| 4 | `internal.turns.complete`（provider 选 `c_LOGIN+REPORTS_exp`） | 回合守卫通过；重新 derive/evaluate；插 proposal seq 1（$900，11-13）；调度 customer、finance 两个并行评估回合 | 公共行："Provider proposes LOGIN + REPORTS for +$900, delivery 2026-11-13; EXPORT deferred." |
| 5 | 两个评估回合均 `recommend_accept` | 第二个 complete 发现 `pendingTurnSeqs` 为空 且全部推荐 → run → pending_approval | 三人看到审批按钮 |
| 6 | customer、provider `decisions.decide(approve)` | 插 decisions（constraintsVersion = 2） | 2/3 |
| 7 | finance `ledger.updateCap({accountKey:'change_budget', newCapCents: 480000, reason:'Q4 budget revision'})` | 守卫：ownerRole、cap ≥ committed($4,000)；patch account；插 ledgerCapChanges；`bumpConstraints`（v3）；评估当前提案：$4,000 + $900 > $4,800 → 不可保留 → run#1 superseded、proposal seq 1 superseded；插 run#2(trigger constraints_changed) + provider 回合 | 所有窗口同一刻：seq 1 显示 Blocked；两条旧 approve 显示 "stale" |
| 8 | provider 回合（余量 $800）选 `c_LOGIN+REPORTS_std` | 插 proposal seq 2（$750，11-20，parent = seq 1） | customer 代理读 notes（"reports feed board review"）→ recommend_accept；finance → recommend_accept |
| 9 | 三人 approve（constraintsVersion = 3）；最后一票的 mutation 内执行 | 守卫全过；重建 snapshot 重算：$4,000 + $750 ≤ $4,800；`operationId = exec:<seq2Id>:3` 未命中；插 executions、outcomeDocuments(change_order)、ledgerEntries(+$750)、tasks×3（LOGIN 两条、REPORTS 一条）；`bumpConstraints`（v4，账本变化）；run#2 → confirmed | 已承诺 $4,750；EXPORT 记为 deferred |

各窗口看到的预算文字（步骤 7 之后，seq 1）：
- finance / customer："+$900 change / $4,900 committed after approval / $4,800 cap / over by $100"
- provider："+$900 · Blocked: exceeds the finance limit"（不出现 $4,900，避免反推已承诺 $4,000）

## 4. 不可行走查（`infeasible`）
步骤 7 改为 cap $4,400：`enumerate` 返回空 → `tradeoffs` 产出 finance 请求："No option fits the remaining budget. Required scope needs at least +$450." 选项 `raise_cap_to_min`（新上限 $4,450）/ `keep_cap_close`。finance 选前者 → `applyAnswer` 产出 `ledger_cap` 补丁 → 走与 `ledger.updateCap` 相同的内部函数（reason = "Answered request #n"）→ v4 → 新 run，候选只有 `c_LOGIN_std`。

## 5. UI 片段（插件提供的渲染组件，引擎页面按 slot 嵌入）

| slot | 组件 | 内容 |
| --- | --- | --- |
| `briefForm.customer` | `CustomerBriefForm` | 目录条目勾选（必需 / nice-to-have）、截止日、首选日、notes；强制披露字段旁标 "Visible to the provider (required to make a valid offer)" |
| `catalogEditor` | `CatalogEditor` | provider 编辑条目，价格只在确认前可改，确认后改价 = 新修订 |
| `proposalTerms` | `ChangeTerms` | 条目、加急、金额、交付日、deferred 列表（数据来自 `project.derived(viewer)`） |
| `outcome` | `ChangeOrderView` | 变更单与任务（打印视图，无 CSV） |

引擎页面不 import 任何插件组件的内部类型，只经 `plugin.ui[slot]` 取组件（Next 侧注册表，见 11）。
