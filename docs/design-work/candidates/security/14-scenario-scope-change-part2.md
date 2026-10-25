# 14 首个场景（part2：fixture、脚本与金丝雀变体）

## 14.6 fixture 原则

1. fixture 是 `packages/scenario-scope-change/src/fixtures.ts` 中的 TS 常量，被 seed、convex-test、E2E 与文档示例共同导入；测试中的数字从 fixture 推出，不另写一份（F14.2）。
2. seed 只经过与生产相同的写入函数（`rooms.create` 的内部版本、`writeBriefVersion`、`writeCatalogVersion`、`activateRoomIfReady`），同一套校验；不直接拼文档（RA-F03 修正三）。
3. seed 停在激活点：不预置提案、不伪造任何人的决定（RA Q11）。之后的一切由 stub 或真实代理与真人操作产生。
4. 全部记录 `isSimulated: true`、`origin: "fixture"`；房间、目录、简报在界面上带 "Simulated data" 徽章；`baselineSource` 写明 "Simulated"。
5. fixture 定义初始状态；"降预算到多少"这类后续动作写成命名脚本（`scripts`），供 E2E 与演练调用真实的 public mutation。

## 14.7 `scope_change.main`

房间：标题 "Analytics portal change request (simulated)"；目标 "Agree scope, price and delivery for the Q4 analytics portal change."；时区 `America/Los_Angeles`；场景日期基准 2026-11-02。

目录 v1（provider 发布）：

| itemKey | 标题 | 价格 | 标准交付 | 加急交付 | taskTitle |
| --- | --- | --- | --- | --- | --- |
| `LOGIN` | Login & SSO revamp | $450 | 2026-11-20 | 2026-11-13 | Implement login & SSO revamp |
| `REPORTS` | Usage reports | $300 | 2026-11-20 | 2026-11-13 | Build usage reports |
| `EXPORT` | CSV/PDF export | $500 | 2026-12-04 | 2026-11-25 | Build CSV/PDF export |

订单级加急费 `rushFeeCents = 15000`（$150）。

简报 v1：

| 角色 | 硬约束 | 软偏好 | 备注（永不披露） | 披露设定 |
| --- | --- | --- | --- | --- |
| customer | requested `[EXPORT, LOGIN, REPORTS]`；required `[LOGIN]`；deadline `2026-11-27` | preferredItemKeys `[REPORTS]`；preferredDate `2026-11-13` | "REPORTS is needed for the December board review; early delivery is nice to have." | requested、required → provider、finance；deadline → finance；preferredDate → provider；preferredItemKeys → provider、finance |
| provider | minChangeOrderCents `40000`（$400） | — | "Team is fully booked after 2026-12-10. No fixed price without confirmed scope." | 不披露 |
| finance | cap `500000`；baseline `400000`；baselineSource "Simulated: existing SOW-2026-07 commitments" | — | "Q4 forecast is tight; prefer to keep a reserve." | headroom → customer |

与 README 数字的对应：全部三项加急 = 450 + 300 + 500 + 150 = **$1,400**（原文"全量变更"）；LOGIN + REPORTS 加急 = **$900**（原文"一期，EXPORT 延后"），执行后已承诺 **$4,900**；预算降到 **$4,800** 后余量 $800。

## 14.8 命名脚本

| 脚本 | 步骤 | 用于 |
| --- | --- | --- |
| `approve_phase1` | 等 run 1 进入 `awaiting_approval`；customer、provider 批准当前提案 | 主走查 |
| `twist_feasible` | finance `budget.update(480000, "Q4 budget revision")` | 主走查（14 part3） |
| `twist_infeasible` | finance `budget.update(440000, "Q4 budget revision")` | 无解变体 |
| `twist_boundary` | finance `budget.update(475000, …)`：余量 $750，恰好等于 LOGIN+REPORTS 标准交付价 | 边界测试（`≤`） |
| `approve_all` | 三方批准当前提案 | 执行 |
| `double_click_final` | 最后一位审批人并发提交两次 `decide` | 幂等测试 |

## 14.9 `scope_change.canary`（隐私测试专用）

结构与 main 相同，把私密值换成在整个系统里独一无二、不可能巧合出现的值：

| 位置 | 金丝雀 | 对谁不可见（扫描时的禁止集合） |
| --- | --- | --- |
| customer 备注 | `CANARY-CUS-5147` | provider、finance |
| customer deadline | `2026-11-27`（目录中没有这个日期） | provider |
| provider 最低接单额 | `40107`（$401.07） | customer、finance |
| provider 备注 | `CANARY-PRV-2290` | customer、finance |
| finance cap | `503917`（$5,039.17） | customer、provider |
| finance baseline | `400219`（$4,002.19） | customer、provider |
| finance headroom | `103698`（$1,036.98） | provider（customer 可见：已披露） |
| finance 备注 | `CANARY-FIN-7731` | customer、provider |
| 各方 rationale（stub 注入） | `CANARY-RAT-<role>` | 除本人外所有人 |

扫描器把每个数值展开成多种写法再匹配：整数美分、`$5,039.17`、`5039.17`、`5,039`、`$5k` 量级的近似不扫描（避免误报，这类近似泄露由"模型不产生任何公开文本"结构性排除）。

扫描对象（16 章 TC-PRIV-01/02/04/06/07）：每个角色调用全部 public query 的 JSON 返回；`events.list` 渲染文本；`ConvexError` 的 `data`；其他角色的 `AgentContext` 与 stub 捕获的请求体；预发布环境的 Convex 日志。

## 14.10 第二个 fixture 的位置

17 章的活动预算场景将提供自己的 fixture；本场景的 fixture 不承担跨场景测试。引擎级测试（权限矩阵、状态机、执行幂等）用本场景 fixture 驱动，但断言只针对引擎行为。
