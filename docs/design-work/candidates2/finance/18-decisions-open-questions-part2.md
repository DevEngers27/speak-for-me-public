# 18 决策记录与开放问题（part2：ADR-11 至 ADR-20、开放问题）

## ADR-11 编排自建（scheduler + 看门狗）
- 选项：自建；`@convex-dev/workflow`；`@convex-dev/agent`。
- 决定：自建。回合 = startTurn（同事务调度 action 与看门狗）→ runTurn action → completeTurn/failTurn。
- 后果：无确定性约束与部署打断在途 workflow 的问题；agent 组件要求 Vercel AI SDK，与技术栈冲突；过期拒绝本来就要自建。代价是自写 attempt 与看门狗（约 200 行）。

## ADR-12 待批提案不预占预算
- 决定：一房一预算、同时一个当前提案，执行事务内重算，不做 encumbrance 分录。
- 后果：简单；多房间共享预算时必须引入预占或账户级锁（17）。

## ADR-13 软约束不递增约束版本
- 决定：preferredDate、wantedItemKeys 顺序、privateNotes、披露开关的变化不 bump，不使签字失效，只影响下一次协商。
- 后果：签字只对硬约束敏感；若软偏好变化让某方不想要当前方案，他们可以 reject 或 requestRenegotiation。

## ADR-14 不拆 monorepo 包
- 决定：engine / scenarios / agents 用目录与 lint 约束边界；第二个场景出现时再评估拆包。

## ADR-15 任何约束变化都 supersede 活动 run 并新建 run
- 背景：审查 F04.1 整理者注：两种写法（同 run 回 negotiating vs 新 run）必须二选一。
- 决定：新 run（trigger constraint_change）。回合守卫只需比较 `run.constraintsVersionAtStart`；每个 run 对应一个约束版本区间，审计清楚。

## ADR-16 finance 代理保留模型调用，但硬规则全部在代码
- 背景：审查 F10.17：finance 完全不调模型则"三个代理"名不副实。
- 决定：finance 代理对通过规则闸门的提案就软偏好（例如保留储备）表态；违反预算的提案由 rule 回合直接拒绝，不调模型。界面如实标注 "rule" 与 "agent" 回合。

## ADR-17 contentKey 用规范化字符串而非哈希
- 决定：`contentKey` 纯字符串（条目@修订:价格、费用、总额、日期、延后项、简报版本）。避开 Convex 运行时 `crypto.subtle` 的不确定性；可读、可在对账中直接比较。

## ADR-18 事件带受众判别联合
- 背景：审查多数意见是 events 全房间可见、私密细节放分表；但买方需要"预算变化""承诺入账"的时间线。
- 决定：`audience: {kind:"room"} | {kind:"roles", roles}`；room 受众 payload 不含私密数值（写入 helper 用 TypeScript 类型分开两类 payload）；读时在 query 内过滤再返回。
- 后果：一张表满足两类时间线；过滤在服务端完成，不违反核心 1。

## ADR-19 期初承诺由 finance 在 setup 阶段录入一次
- 背景：ORIG 的 $4,000 基线存不进 commitments；审查建议 seed 写一条 simulated baseline。
- 决定：`opening_balance` 是产品功能（finance 录入，带 note），seed 只是调用它并标 simulated；也可显式声明为零。active 后不可再录。
- 后果：真实使用也有期初；"基线"的含义清楚（房间外既有承诺）。新增。

## ADR-20 模型默认 `claude-opus-5-5`、effort `medium`、回退关闭
- 背景：技能规定默认 Opus 5.5，不得自行降级；回退与结构化输出同用待验证。
- 决定：默认 Opus 5.5 + medium；白名单仅含它；是否允许 Sonnet/Haiku 用于某些调用点、是否开启服务端回退，交给用户拍板（OQ-1、OQ-2）。

## 与原方案 / Role A 的偏离汇总

| 原方案 | 本设计 | ADR |
| --- | --- | --- |
| rooms 上存预算与已承诺 | 两本只追加台账，余额派生 | 01 |
| 剩余预算 finance 私密 | 买方可见、provider 不可见 | 02 |
| 模型给金额、scope 字符串、sourceRefs | 模型只选 candidateKey | 07 |
| approvals 只存版本号 | decisions 只追加，绑定 proposalId + cv + contentKey | 09、17 |
| RA：降上限复制 revalidated 提案 | 不复制；同一提案重新签字 | 06 |
| RA：approvalRequired 可改字段 | requiredSignatures 场景常量并快照 | — |
| 审查：低于已承诺 → needs_input | 直接拒绝 | 04 |
| 审查：(proposal,user) 只留最新决定 | 只追加分录 | 09 |
| 审查：执行不 bump | 执行 bump（commitment_recorded） | 05 |
| ORIG：clarify 可让模型决定升级给人 | 代码决定；clarify 只问本方的人 | 03 |
| RA："Send the execution request again"、Preview as | 删除，幂等性放测试 | — |

## 开放问题

| id | 问题 | 当前倾向 |
| --- | --- | --- |
| OQ-1 | 是否允许某些调用点（如 finance 软偏好评估）用 Sonnet 5.5 / Haiku 5.5 降本 | 需用户拍板；默认全部 Opus 5.5 |
| OQ-2 | 是否开启服务端回退 `fallbacks: "default"` | 待验证其与 `output_config.format` 兼容后由用户决定 |
| OQ-3 | 签字是否需要时间有效期 | v1 不做；见 17 |
| OQ-4 | 冲销 / 已执行变更单修订的 finance 流程 | 17 已给形状，v2 设计 |
| OQ-5 | 延后条目在执行后是否自动生成后续变更占位 | v1 只记录 deferredItemKeys |
| OQ-6 | 修改 goal 是否算约束变化 | 否（非硬约束），但写事件 |
| OQ-7 | 一个角色席位能否多人（如两位 finance 审批人） | v1 一人；扩展需"角色内任一人签字"规则 |
| OQ-8 | provider 是否应看到 customer 未共享约束的投影码 CUSTOMER_CONSTRAINT | 是（最小披露）；需产品确认 |
| OQ-9 | `todayIn(timeZone)` 在 Convex 默认运行时的 Intl 支持 | 待验证；退路固定偏移表 |
| OQ-10 | 结构化输出是否接受 `enum` 与根级 anyOf（影响 candidateKey 是否受解码约束） | 待验证；不接受则靠事后校验 |
| OQ-11 | `crypto.subtle` 在 mutation 中可用性（邀请 tokenHash） | 待验证；退路见 03 |
| OQ-12 | Opus 5.5 回合 p95 与 45s 超时是否匹配 | 待实测 ≥ 10 次 |
| OQ-13 | 建房允许名单的产品化（谁能建房） | v1 环境变量 |
