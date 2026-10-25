# 16 测试（第 1/2 部分：分层、确定性测试、隐私、幂等与并发）

## 16.1 分层

| 层 | 载体 | 覆盖 | 何时跑 |
| --- | --- | --- | --- |
| 纯函数单测 | vitest（engine/、scenarios/） | validateProposal、materializeTerms、enumerateCandidates、analyzeFeasibility、buildRoleView、buildOutputJsonSchema/Zod、checkDecision、reduceRun、模板渲染、isComplete | 每次提交 |
| Convex 函数测试 | convex-test（API 名称待验证 #14）+ vitest 假时钟 | 状态机迁移、守卫、权限、投影、调度链（stub 驱动） | 每次提交 |
| 离线代理评测（确定性） | `evals/` + stub / scripted 驱动 | 协议与归约在各 fixture 下的行为 | 每次提交 |
| 离线代理评测（live） | `evals/` + live 驱动 | 代理质量、延迟、成本 | promptVersion / 模型 / effort 变更时，及每晚 |
| 并发与幂等 | 针对真实 dev 部署的 node 脚本 | 双击、并发最后一票、并发 budgets.update 与 completeTurn | 发布前 |
| 端到端 | Playwright，三个身份三个浏览器上下文 | 实时翻转、双击只执行一次、刷新后进度、Blocked 文案按角色 | 发布前 |

## 16.2 规则与流程用例（数字从 fixture 推出）
- 编造 itemKey 被拒；恰好等于余量通过（V-BOUNDARY）；超出被拒；无解进入 needs_input 且零模型调用；低于已承诺被拒且无写入。
- 必需条目缺失、交付晚于截止日都被报出（Role A RA-F03 / F06.4 回归）。
- 重复批准只计一次；同一人不能占两角；约束变更后旧批准不计；被拒后不能执行；approve 不可执行版本被拒、reject 永远允许。
- parsed 为空、无 text 块、`max_tokens`、`refusal` 都不被当作"无动作"。
- G-T：attemptNo 不匹配的迟到提交被拒；catalogRevision 变化后的提交被拒。

## 16.3 隐私与权限
- **投影测试**：以每个角色身份调用每个公共 query，对返回 JSON 深度扫描：provider 的返回中不得出现 `totalCents`、`committedCents`、`headroomCents`、`shortfallCents` 键，也不得出现这些数值（500000、480000、400000 及其美元格式）。
- **上下文金丝雀**：`buildRoleView` 单测断言 provider 视图不含 `CANARY-FIN`、`CANARY-CUS`；customer 视图不含 `CANARY-PRO`、`CANARY-FIN`。
- **全链金丝雀**：stub 与 live 各跑一遍 14.8 走查后，扫描所有跨方可见记录（events 渲染结果、proposals、decisions、humanRequests 他方视图、changeOrders）与 provider 会话 WebSocket 负载：零命中。
- **日志扫描**：Convex 日志导出中搜索金丝雀与预算数字：零命中。
- **负面鉴权**：非成员读房间返回 null；非 finance 调 budgets.update、非目标角色 answer、非成员 runs.start、owner 以非角色身份批准，全部被拒。

## 16.4 幂等与并发（真实部署）
- 脚本对同一 proposal 并发 5 次最后一票 `decisions.submit`：changeOrders、commitments 各只多一行，tasks 数等于条目数。
- 并发 `budgets.update` 与评估方 `completeTurn`：要么 turn 先提交后被 bump 作废，要么 turn stale；不得出现"新约束下引用旧候选的 endorsed 提案"。
- 并发两个评估方 completeTurn：恰好一个执行 resolveRound（检查 runs.roundIndex 只 +1）。
- convex-test 中的同类测试如实标注"串行执行，不证明 OCC"。
