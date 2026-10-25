# 18 决策记录与开放问题（事件溯源候选）

格式：背景 / 选项 / 决定 / 后果。"偏离"标出与原 README（R）或 Role A 分支（RA）的不同。

## ADR-01 追加写事件日志为事实来源，投影同事务更新
- 背景：核心 6 要求历史不可篡改、可追溯；R 只有 events 表作为附属日志。
- 选项：A 普通可变表 + 审计事件；B 事件为源、投影同事务；C 事件为源、异步投影器。
- 决定：B。Convex 单 mutation 原子，使投影与日志零延迟一致；C 在 Convex 上没有收益。
- 后果：每个命令双写；`applyEvent`/`redactEvent` 是关键代码；获得回放校验、约束历史、追溯链、命令去重。偏离 R（events 降为附属）与 RA（事件文本写入时渲染，RA-T02）。

## ADR-02 房间是唯一聚合与流；每命令写流头
- 选项：每实体一流 / 房间一流。决定：房间一流。
- 后果：同房间命令被 OCC 串行化，所有唯一性检查共享一个冲突点；跨房间预算（17）是主要演进成本。

## ADR-03 事件引用领域键，不引用投影 `_id`
- 决定：proposalVersion、runNo、requestNo、operationId 等为对外与事件中的标识；API 参数也用领域键。
- 后果：投影可随时重建；URL 只含 roomId。偏离 R（approvals 引用 proposal 文档 id 的隐含设计）。

## ADR-04 哈希链（SHA-256）
- 背景：Convex 无 WORM；dashboard 可改行。决定：每事件 prevHash/hash，每日 cron 验证。
- 后果：可检测而非可阻止篡改；`crypto.subtle` 可用性待验证，退路 `@noble/hashes`。

## ADR-05 诚实退回普通表
- 决定：users、invites、briefDrafts、agentTurns 不事件化（理由 02 DM-6）。
- 后果：agentTurns 不能由回放重建（遥测丢失不影响业务状态）；rationale 不在日志中，追溯到"模型为什么这么选"依赖 agentTurns 行（终态后冻结）。

## ADR-06 候选由代码枚举，模型只选 candidateId
- 偏离 R：R 的协议让模型给 scope/additionalCostCents/sourceRefs。决定：模型无法表达金额、日期、条目。
- 后果：模型价值集中在选择、解释、发现需要人取舍；可行性完全确定。

## ADR-07 provider 代理的候选不按预算过滤
- 决定：卖方只得到"超出 finance 限额"的结论（07 §2）。后果：可能多一轮；不泄露余量区间。

## ADR-08 买方/卖方披露划分
- 偏离 R:239（剩余预算是 finance 私密输入）：customer 也可见预算数字。理由：customer 与 finance 同属采购方，customer 代理需要它做取舍；provider 永不可见。

## ADR-09 约束变更 = 旧 run superseded + 新 run
- 裁决 F04.1 的二选一。后果：每个 run 有固定约束锚点；回合守卫简单。

## ADR-10 审批绑定版本，决定只追加；撤回 = withdraw 决定
- 偏离 RA-R16（approve 删除旧拒绝；不能撤回）。

## ADR-11 预算可低于已承诺（记录现实）
- 偏离 RA-R10（拒绝）。决定：接受并进入 BUDGET_BELOW_COMMITTED，向 finance 请求。理由：系统记录事实，不能拒绝记录真实的预算削减。

## ADR-12 任何硬约束变化（含上调预算）都使旧审批失效
- 裁决 Q7。后果：上调也要重新审批；软约束不推进版本。

## ADR-13 执行在最后一票的 mutation 内，单事件投影三表
- 采纳 RA-R07、F08.4；任务在 plan 阶段派生并写入事件（裁决 Q10）。

## ADR-14 自建编排，不用 workflow/agent 组件
- 理由：日志已是持久化历史；workflow 的确定性重放与"改代码破坏在途实例"在迭代期是实际成本；agent 组件与技术栈冲突。

## ADR-15 finance 代理保留模型调用，只做选择与解释
- 裁决 F10.17。产品叙述："三个隔离的代理都调用模型；所有算术与预算判断由代码完成"。

## ADR-16 模型：默认 claude-opus-5-5、effort medium；v1 不开启服务端回退
- 理由见 10 §7、§11。Sonnet/Haiku 只能由用户决定。

## ADR-17 否决 Role A 的 revalidated 复制提案、"same shapes" 全量状态、Preview as、重发执行按钮
- 理由：冗余绑定与错误归属（RA-R11）、把私密数据发到浏览器（RA-D16）、身份来自 Clerk、幂等放进自动化测试。

## ADR-18 seed 走命令管线，不直接写投影；不做删除式 reset
- 偏离 RA-U14（Reset local preview）。后果：演练每次新房间。

## 开放问题

| # | 问题 | 当前倾向 | 需要谁决定 |
| --- | --- | --- | --- |
| O1 | 不可删除的日志与个人数据删除请求的冲突：整房间删除是否足够？是否要加密粉碎？ | v1 整房间删除（运维记录）；加密粉碎列入 17 | 用户 / 法务 |
| O2 | 是否允许一个角色多名成员（两名 finance）？完成判定改为"任一成员" | v1 一人 | 用户 |
| O3 | 报价与审批是否设有效期 | v1 无；目录项预留 validUntil | 用户 |
| O4 | customer 是否应能看到预算数字（ADR-08 偏离 R:239） | 可见 | 用户 |
| O5 | 是否允许 provider 看到"已承诺后总额"以外的任何预算信号（例如超出比例） | 否 | 用户 |
| O6 | 是否对部分调用点改用 Sonnet/Haiku 降低成本 | 不改，等实测 | 用户 |
| O7 | 是否开启服务端回退 | 否，待验证 #7 | 用户 |
| O8 | 修改 room.goal 是否算约束变化 | 否（goal 不参与校验） | 用户 |
| O9 | 取舍请求同时发给多方还是只发给一方 | 一方（按 reasonCode 选择最相关的人） | 用户 |
| O10 | 延后范围执行后是否自动生成后续变更占位 | 否；结果页显示 deferred 列表 | 用户 |

## 待验证（本设计依赖的平台事实）

1. `defineTable(v.union(...))` 上建公共字段索引（03 part1）。
2. mutation 内 `crypto.subtle.digest` 可用性（ADR-04）。
3. 1.48 `ctx.runMutation` 子事务抛错回滚、错误数据透传给父 mutation（03 part3 §5）。
4. 单 mutation 读写上限是否容纳整房间重建（百级事件）。
5. 自建 JSON Schema 中嵌套 `anyOf`/`const`/`enum` 的接受情况；每回合不同 enum 的编译延迟（10 §9）。
6. Opus 5.5 medium 单回合 p95；SDK 在默认运行时的长请求行为。
7. `Intl.DateTimeFormat` timeZone 支持（06 §6）；Clerk JWT 是否带 name。
8. convex-test 0.0.65 的身份模拟与调度推进 API。
