# 09 约束变更（part2）：瞬间阻断、重谈触发、历史保留、边界情形

> 分片清单见 part1。

## 9.6 派生可执行性与"瞬间阻断"

- 阻断不回写：提案没有 status 字段，`rooms.workspace` 每次计算都调用 `evaluateProposal(current, loadRuleInput(room), today)`（I10）。
- 因为预算变更、递增版本、取代旧 run 在同一个 mutation 里提交，所有订阅了 `rooms.workspace` 的窗口在**同一次推送**中同时看到：当前提案 Blocked、旧审批 stale、run 面板显示"Renegotiating under constraints v7"。阻断不等待模型；重谈结果随后异步出现（F09.3、AC-G6）。
- 买方窗口："+$900 change · $4,900 committed after approval · cap $4,800 · over by $100"；provider 窗口："+$900 · Blocked: exceeds the finance limit"（07 §7.3，F07.1 文案规则）。

## 9.7 何时自动重谈、何时只要求重新审批

| 变化时活跃 run 的状态 | 当前提案在新版本下 | 结果 |
| --- | --- | --- |
| awaiting_approval | 仍可执行（例如上调预算，或改了一个与它无关的目录条目） | T2：零回合 run，同一提案进入重新审批；不自动寻找"更好的"方案（Q7 的决定：上调不自动重谈，避免成本与抖动）；界面提示 "Constraints loosened — anyone can request renegotiation" |
| awaiting_approval | 不可执行 | 有候选 → T1 重谈（3 秒防抖）；无候选 → T3 问人 |
| running | — （本 run 的提案都基于旧版本） | 同上一行：按新版本重新判断；在飞回合迟到后 stale |
| waiting_human | — | 同上；旧请求 superseded。若变化正是对请求的回应（例如 finance 按请求提高了上限），新 run 通常直接有候选 |
| failed | — | 同上（变化可能正好解除了失败原因，例如 provider 撤回了导致问题的条目） |
| 无活跃 run（准备阶段、已执行、已关闭） | — | 不自动开始；只递增版本 |

**防抖**：系统触发的 run 第一个 attempt 延迟 3 秒（10 part4 §10.8）。finance 连续两次调整上限时，第一次触发的 run 在 claim 前就被第二次取代，attempt 标 skipped，不产生模型调用。

## 9.8 历史保留

| 历史 | 保存在 | 谁能看 |
| --- | --- | --- |
| 每个约束版本的完整输入指针与原因 | `constraintVersions` | 只供服务端评估与审计查询；界面按角色投影成"v6 → v7 · Finance · budget"（他方无数值） |
| 预算上限的每次变化与原因 | finance 的 `briefVersions`（`changeNote`）+ `budget_cap_changed` 事件 | finance + 预算受众 |
| 每个简报版本 | `briefVersions` | 本人；他方只见版本号与确认时间 |
| 每个目录版本（含撤回） | `catalogItems` | 全体 |
| 被取代的 run 及其回合、尝试 | `runs`、`turns`、`modelCalls` | 公开部分全体；理由本角色 |
| 旧审批（stale） | `decisions` | 全体（理由备注按本人选择） |
| 旧提案 | `proposals` | 全体 |

"约束变更历史"视图（结果与历史页）把以上按约束版本串起来：每个版本一行，显示原因、操作者角色、对当前提案的影响（变为 Blocked / 需要重新审批 / 无影响），数值按查看者投影。

## 9.9 边界情形

| 情形 | 处理 |
| --- | --- |
| provider 在 run 进行中改价（确认条目新版本） | 递增版本；当前 run superseded；新 run 的候选按新价格计算；引用旧条目版本的提案报 `engine.source_superseded`（RA-B04） |
| provider 撤回一个已被当前提案引用的条目 | 同上，报 `engine.source_withdrawn`；若撤回的是必需项唯一的报价 → 无候选 → 问 provider（`q.price_flex` 类请求的 edit_catalog 选项） |
| customer 把截止日提前，使当前提案晚于截止日 | 递增；当前提案报 `date.after_deadline`；他方（截止日未披露时）看到 "conflicts with a customer constraint"（RA-B02 回归 RG-02） |
| 上限恰好等于执行后已承诺额 | 通过（`≤`），见 14 主线与 RG-14 边界用例 |
| 上限低于已承诺额 | 允许记录；全部候选 `budget.cap_below_committed`；只问 finance |
| 执行后 finance 下调上限 | 递增；无活跃 run，不自动重谈；已执行的变更单不受影响（快照不变，RA-B09 回归 RG-11） |
| 同一事务内需要多次递增（例如种子数据一次写入多条约束） | 种子函数走与生产相同的入口，逐次递增；不提供"批量递增"捷径（RA-F03 修正三） |
| 递增时房间已关闭 | 所有约束写入口先检查 `room.status === "open"`，关闭后返回 `ROOM_CLOSED` |
