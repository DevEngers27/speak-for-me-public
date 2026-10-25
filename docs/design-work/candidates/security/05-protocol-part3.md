# 05 协商协议（part3：完整消息示例）

示例使用 14 章 fixture `scope_change.main`：目录 LOGIN $450（标准 11-20 / 加急 11-13）、REPORTS $300（11-20 / 11-13）、EXPORT $500（12-04 / 11-25），订单级加急费 $150；customer 请求三项、必需 LOGIN（披露给 provider、finance），截止 2026-11-27（只披露给 finance），首选 11-13（披露给 provider）；provider 最低接单额 $400（不披露）；finance 上限 $5,000、基线已承诺 $4,000，headroom 只披露给 customer。今天 2026-11-02（America/Los_Angeles）。

## 5.10 run 1，第 1 轮：provider 的 propose 回合

provider 视图下的候选（含 LOGIN、价格 ≥ $400；provider 看不到截止日与预算，所以不按它们过滤），按场景排名（覆盖请求项多者优先 → 交付日离首选日近者优先 → 覆盖偏好项多者优先 → 价格低者优先）：

| id | itemKeys | 交付 | 日期 | 价格 |
| --- | --- | --- | --- | --- |
| C1 | EXPORT, LOGIN, REPORTS | rush | 2026-11-25 | $1,400 |
| C2 | EXPORT, LOGIN, REPORTS | standard | 2026-12-04 | $1,250 |
| C3 | LOGIN, REPORTS | rush | 2026-11-13 | $900 |
| C4 | LOGIN, REPORTS | standard | 2026-11-20 | $750 |
| C5 | EXPORT, LOGIN | rush | 2026-11-25 | $1,100 |
| C6 | EXPORT, LOGIN | standard | 2026-12-04 | $950 |
| C7 | LOGIN | rush | 2026-11-13 | $600 |
| C8 | LOGIN | standard | 2026-11-20 | $450 |

prompt 中 `<turn>` 块（节选）：

```json
{"turnKind":"propose","round":1,"maxRounds":3,
 "candidates":[{"candidateId":"C1","itemKeys":["EXPORT","LOGIN","REPORTS"],"delivery":"rush",
                "deliveryDate":"2026-11-25","priceCents":140000}, "…"],
 "allowedActions":["propose"],
 "clarifyTargets":["customer.deadline","finance.headroomCents"]}
```

模型原始输出（经结构化输出约束）：

```json
{"action":"propose","candidateId":"C1","rejectReason":"NONE","clarifyTarget":"customer.deadline",
 "rationale":"Full scope with rush delivery covers every requested item and is closest to the preferred date. Asking for the deadline so we know whether standard dates for EXPORT are acceptable."}
```

服务端处理（`completeTurn`，同一事务）：
1. 回合持久化守卫通过；`interpretOutput` 得到 `{ action: "propose", candidate: C1, clarify: customer.deadline }`。
2. `insertProposal`：`deriveTerms(C1, catalog v1, customer.requestedItemKeys)` → terms `{ itemKeys: [EXPORT, LOGIN, REPORTS], deferredItemKeys: [], deliveryOption: "rush", deliveryDate: "2026-11-25", lines: [EXPORT 50000, LOGIN 45000, REPORTS 30000], fees: [rush_fee 15000] }`，`priceCents = 140000`，version 1，`requiredApproverRoleKeys = [customer, provider, finance]`。
3. `agentNotes`（provider 私有）写入 rationale。
4. 为 customer 生成 disclosure 请求（deadline → provider）。
5. 调度 customer 与 finance 的 review 回合（round 1）。
6. 事件：`proposal_created { proposalVersion: 1, authorKind: "agent", authorRoleKey: "provider", priceCents: 140000 }`、`request_opened { targetRoleKey: "customer", kind: "disclosure" }`。

各方此时看到的 v1 检查结果（X5 粗化）：finance "Over budget by $400"；customer（已获 headroom）同上；provider "Blocked: buyer-side constraint"。

## 5.11 第 1 轮 review 与裁决

customer 视图候选（含 LOGIN、日期 ≤ 11-27、价格 ≤ headroom $1,000）：C3 LOGIN+REPORTS rush $900、C4 LOGIN+REPORTS standard $750、C7 LOGIN rush $600、C8 LOGIN standard $450。

```json
{"action":"counter","candidateId":"C1","rejectReason":"NONE","clarifyTarget":"NONE",
 "rationale":"Full scope exceeds the available budget. LOGIN + REPORTS with rush delivery keeps the preferred 11-13 date and REPORTS, which your notes say is needed for the December board review."}
```

（customer 回合的候选 id 在本回合内重新编号：此处 C1 = LOGIN+REPORTS rush。）

finance：

```json
{"action":"reject","candidateId":"NONE","rejectReason":"OVER_BUDGET","clarifyTarget":"NONE",
 "rationale":"This change would put committed spend above the cap. I recommend rejecting it."}
```

`resolveRound`：counter 只有 customer 的一个 → 插入提案 v2（LOGIN+REPORTS rush $900，author customer 代理，derivedFrom v1）→ round 2，调度 provider 与 finance 评审。round 2 两者都 `recommend_accept`，v2 当前 cv 下通过 → run → `awaiting_approval`。公开时间线只显示 "Reviews complete"，不显示谁建议了什么。

## 5.12 约束变更后的 run 2（摘要，完整走查见 14）

finance 把上限降到 $4,800（cv 1 → 2）：v2 阻断（$4,900 > $4,800）；全局预检非空 → run 2 `running`。provider 候选排除 v1、v2 这两个在 cv 2 下对 provider 显示为 blocked 的条款，排名第一的是全部三项标准交付 $1,250（2026-12-04）→ v3：超预算且晚于截止日，provider 只看到 "Blocked: buyer-side constraint"。customer 与 finance 在各自视图（余量 $800、截止 11-27）下都还价 LOGIN+REPORTS standard $750，去重后按优先级记为 customer 的还价 → v4；provider 与 finance 评审后 v4 进入审批。

## 5.13 无解变体 `scope_change.infeasible`（上限降到 $4,400）

- 降预算后预检：任何含 LOGIN 的组合 ≥ $450 > 余量 $400 → `globalFeasible` 为空 → run 2 直接 `needs_human`，不调用模型。
- 生成请求（各自视图）：finance "Raise your cap to at least $4,450 (+$50) to allow LOGIN (standard, 2026-11-20)"；customer "Make LOGIN optional, which would allow REPORTS (standard)"；provider "Publish a revised catalog"。
- 若 customer 先选"让 LOGIN 变为可选"：新 customer 简报版本 → cv 3 → 预检：REPORTS standard $300 低于 provider 最低接单额 $400，REPORTS rush $450 超过余量 → 仍为空 → run 3 `needs_human`。customer 视图内有候选（REPORTS standard $300），于是收到 `adopt_candidate` 请求；若选中，生成的人工提案显示 "Blocked: seller-side constraint"——customer 只通过"提出一个提案"获得这 1 位信息。finance 同时收到新的放宽请求。
- 若 finance 选"提高到 $4,450"：cv 3 → 预检非空 → run 3 `running`，provider 提出 LOGIN standard $450。

## 5.14 拒绝与失败的消息形态

| 情形 | 模型输出 | 服务端结果 |
| --- | --- | --- |
| 候选 id 不在列表（解码约束失效或被注入） | `{"action":"propose","candidateId":"C99",…}` | `OUTPUT_SEMANTIC`，回合 failed，自动重试一次 |
| review 回合输出 `propose` | — | `OUTPUT_SEMANTIC` |
| `stop_reason = max_tokens` | 截断 JSON | `STOP_MAX_TOKENS`，可重试；用量照记 |
| `stop_reason = refusal` | 可能为空 | `STOP_REFUSAL`，不重试，run → failed，界面 "Retry turn" |
| 迟到（cv 已变） | 任意 | `rejected_stale`，不写提案与笔记，事件 `stale_result_discarded` |
| rationale 中出现预算数字 | `"…the cap is $4,800…"` | 只存进 finance 本人的笔记；他方无任何渠道看到（TC-PRIV-07） |
