# 18 决策记录与开放问题 · part1：ADR-01 … ADR-10

格式：背景 / 选项 / 决定 / 后果。标【偏离原想法】或【偏离 Role A】的条目与原 README 或 Role A 分支不同。

### ADR-01 十张表，时间线派生，不设 events 表【偏离原想法】
- 背景：原 README 有 events 表；审查建议 17 张表并争论事件可见性（开放决定 3）。
- 选项：A events 表 + visibility；B events 全公开 + 私密细节放分表；C 不存事件，从只追加源表派生时间线。
- 决定：C。
- 后果：没有第二份真相、没有"公共事件文本"这个泄露面、开放决定 3 消失；代价是 `rooms.timeline` 要合并 8 张表（有界 take），且 run 状态的中间迁移只能由提案/审批/回合行重建（足够追溯，不是逐条状态日志）。若将来要做通知游标，再加带 `commitTs` 的事件表（17 号）。

### ADR-02 约束 = 角色简报版本；预算、目录都在简报里【偏离原想法、偏离 Role A】
- 背景：原 schema 把预算放 rooms；审查建议 budgets/budgetChanges/offerItems 三张表；Role A 只在改上限时递增版本（RA-B02）。
- 选项：A 每类约束一张表，各自调用 bumpConstraints；B 全部硬约束都是某角色已确认简报的字段。
- 决定：B。唯一写入口 `applyBriefVersion`，规则"任何简报确认 → constraintsVersion +1"。
- 后果：约束历史 = 简报版本链（带作者、原因、changeCode）；递增点不可能漏；目录条目天然已确认，不需要 unconfirmed 状态。代价：provider 改一个价格要提交整份目录新版本（表单预填，成本低）。

### ADR-03 编排自建，不用 Convex 组件
- 背景：F10.3 三选项。
- 决定：`ctx.scheduler` + `runs.activeTurnId` + 看门狗；SDK 负责传输层重试。
- 后果：代码约 200 行；没有 workflow 的确定性约束与升级失败问题；迁移路径保留（17 号）。

### ADR-04 承诺内嵌在变更单，基线在 finance 简报【偏离原想法】
- 背景：原 README 有 commitments（必填 proposalId，存不下基线）；审查推荐 commitments 台账（kind baseline/change_order）。
- 选项：A commitments 台账；B 变更单内嵌 `commitment` 快照 + `finance.priorCommittedCents`。
- 决定：B。`committedCents = priorCommittedCents + Σ changeOrders.commitment.amountCents`，单一真相、无存量字段。
- 后果：少一张表、少一个唯一性；"外部支出增加"成为 finance 简报变化并自动走约束变化流程（F01.5 进阶）。限制：多房间共享预算时必须换成账户级台账（17 号）。

### ADR-05 约束变化一律取代当前 run 并新开 run
- 背景：F04.1 整理者注要求二选一。
- 决定：旧 run → superseded，新 run（trigger constraint_change）；已执行的 run 不受影响，也不自动开新 run。
- 后果：一组守卫（GT 的 `currentRunId` 比较即可拦截全部过期结果）；代价是即使旧提案在新约束下仍可行，也要 provider 代理重新提出（一次调用），作者如实（不复制提案，RA-R11）。

### ADR-06 回合串行，一个在途回合
- 背景：审查建议 customer/finance 并行以降延迟。
- 决定：串行 provider → customer → finance；单指针守卫。
- 后果：每轮延迟多一跳（约 +1 个回合时长）；换来更简单的守卫与测试。延迟实测不达标时开启并行（17 号）。

### ADR-07 引擎表中角色是 `v.string()` + 入口断言
- 背景：F03.13 建议字面量联合 + 编译期断言。
- 决定：引擎表存 string，`assertRole(scenario, role)` 在所有入口；场景内部 TS 类型是字面量联合。
- 后果：第二场景不改引擎 schema；代价是 schema 层不拦非法角色（单一写入口已拦）。

### ADR-08 房间没有状态字段
- 背景：原 schema 用 rooms.status 承载全部流程；Role A 有 7 值 RoomStatus（RA-D04）。
- 决定：房间阶段派生（inviting/briefing/run.status）；v1 无关闭/归档。
- 后果：没有与 run 状态重复的第二状态机；归档放 17 号。

### ADR-09 预算低于已承诺：拒绝写入【偏离审查建议】
- 背景：F06.3 建议进入 needs_input；Role A 拒绝（RA-R10）。
- 决定：拒绝（`BUDGET_BELOW_COMMITTED`），与 Role A 一致。
- 后果：系统里不存在"没有任何合法出路"的状态；现实中的超支需在系统外处理，finance 可通过调整 `priorCommittedCents` 如实记录。

### ADR-10 审批只追加；撤回 = 追加 reject；不分 terms/budget 字段【偏离 Role A】
- 背景：Role A 两张表、approve 会删除旧拒绝（RA-B06）；审查建议 upsert 最新决定 + 可选 kind。
- 决定：单表只追加，当前决定 = 最新行；同值重复点击不插；签核类别由角色推出（文案不同）。
- 后果：历史完整、无唯一性需求；"撤回但不拒绝"不存在（撤回即让协商继续）。
