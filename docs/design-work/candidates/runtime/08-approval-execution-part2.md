# 08 审批与执行（part2）：撤回与过期、并发与重复、执行派生、执行边界、拒绝之后

> 分片清单见 part1。

## 8.5 撤回与过期

- **撤回**（RA-R16、Q6）：执行前，参与者可以对自己的 approve 或 reject 追加一条 `withdraw`；无需理由（理由是可选备注）。撤回后状态回到 pending，可以再次决定。执行后不接受任何决定。
- **过期（stale）**：不是定时任务，而是派生——约束版本变化后，旧版本上的决定显示为 stale_approve / stale_reject，界面解释"You approved v3 under constraints v6; constraints are now v7"（RA-B30 修正：旧拒绝也显示为 stale，而不是 pending）。
- **时间维度的失效**：v1 没有"审批 N 天后失效"。但 `date.in_past` 检查会让交付日已过的提案自然不可执行；报价有效期（`validUntil`）是开放问题（18 Q-05）。

## 8.6 并发与重复的逐案分析

| 情形 | 发生了什么 | 结果 |
| --- | --- | --- |
| 同一人双击 approve | 第二次在第 7 步看到自己已是 approved | `unchanged`，无写入 |
| Convex 客户端断线重连重发同一 mutation | 平台去重（inputs/04 §1.11）；即使执行两次也同上 | 无重复 |
| 最后两票并发（customer 与 finance 同时批准，provider 已批准） | 两个事务都写入 decisions 的同一索引区间并读取它；OCC 让后提交者重试，重试时看到对方的 approve，由它执行；先提交者当时看到的是"未齐" | 恰好一次执行（AP-05，在真实部署上并发验证，因为 convex-test 不模拟 OCC，F08.5） |
| 批准与预算下调并发 | 两者都读写 rooms / runs。下调先提交 → 批准重试时 G-D5 失败（`STALE_VIEW`），界面刷新显示阻断；批准先提交（且凑齐执行）→ 下调重试时看到执行已发生，正常递增版本（执行发生在下调之前的串行顺序里，合法） | 不会出现"按旧约束执行、新约束却已生效"的交错 |
| 批准与提议方手动替换提案并发 | 都读写 `rooms.currentProposalId` / run | 后提交者看到新状态：批准方得到 `NOT_CURRENT`，或替换方在执行后得到 `INVALID_STATE` |
| 已执行后再点批准 | 第 4 步返回已有执行 | 幂等 |

重复执行请求不写房间事件（RA-R09、RA-B25），只在 ops 计数 `duplicate_execution_attempts` 中 +1。

## 8.7 执行派生（首个场景）

`scenario.deriveExecution(proposal, ruleInput) → ExecutionDerivation`，纯函数、确定性、不调模型：

| 产物 | 规则 |
| --- | --- |
| 变更单 1 条 | 冻结 `terms` 的全部字段 + `committedBeforeCents`（台账汇总）、`committedAfterCents`、`capCentsAtExecution` + 提案版本与约束版本 + 来源 `catalogItemIds` |
| 执行承诺 1 条 | `kind: "execution"`、`amountCents = terms.amountCents`、`executionId` |
| 任务 N 条 | 每个 `terms.itemKeys` 中的条目一条：标题取该条目版本的 `taskTitle`，指派给目录所有者角色（provider），截止日 = `terms.deliveryDate`，状态 todo。加急费条款不生成任务；延后项不生成任务（是否生成"后续变更占位"是 Q9，见 17） |

`derivationVersion = "scope_change.exec.v1"` 写入 executions，规则改变时更新版本号。

**审批前预览**：`proposals.executionPreview({ proposalId })` 用同一个 `deriveExecution` 计算，按查看者投影后显示"批准后将创建：Change order（+$800）、Budget commitment（买方可见：$4,000 → $4,800 of $4,800）、Tasks: Deliver SSO login migration, Deliver monthly usage reports (due 2026-11-20)"（RA-B19、RA-U03）。任务模板不纳入 termsKey，而是"由已批准条目确定性派生"，并在预览中明示（Q10 的决定）。

## 8.8 执行边界（核心 7）

- 只写内部记录：executions、变更单、承诺台账、任务。不转账、不签署有法律效力的文件、不调用任何外部系统。
- 变更单页面与打印视图顶部固定文字："Internal record. Not a contract. No payment or signature is created by this system."；fixture 房间另加 "Simulated data"。
- 幂等只对内部记录承诺；不宣称对任何外部系统 exactly-once（P-05）。未来的外部集成走 outbox（17 §17.3），由独立的消费者在执行事务提交后读取。

## 8.9 拒绝之后（消除死路，RA-B16）

1. 拒绝必须带场景词表中的理由码：`price_too_high`、`date_too_late`、`scope_insufficient`、`prefer_other_option`、`other`；备注可选，受众由本人选择。
2. 同一事务内：当前 run superseded（endedReason rejected）；新 run 以 trigger `rejection` 创建，被拒提案的候选进入 `excludedCandidateKeys`。
3. 新 run 的代理在 history 中看到"Customer rejected v3: date_too_late"（与公开备注，如有）。
4. 剩余候选为空，或本约束版本下由拒绝触发的 run 已达 3 个 → 新 run 直接 waiting_human，请求发给提议方的人（手动选择或修改目录）与拒绝者（`edit_brief` / `decline`）。
5. 拒绝永远允许（即使提案已不可执行），并且只影响当前 run；旧 run 的提案与决定原样保留。
