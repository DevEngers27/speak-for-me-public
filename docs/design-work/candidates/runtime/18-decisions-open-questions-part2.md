# 18 决策记录与开放问题（part2）：数据、审批、隐私、模型与运维 ADR

> 分片清单见 part1。

### ADR-11 预算数字：买方可见（由 finance 选择），provider 永不可见
- **背景**：R:239 说剩余预算是 finance 私密输入；schema 却放在全员可见的 rooms 上（GAP-01）；审查推荐按买方 / 卖方划分（F07.1）。
- **选项**：A 只有 finance 可见；B 买方可见、provider 不可见；C finance 可共享给全房间。
- **决定**：预算数字作为一组跟随 finance 对 `budgetCapCents` 的披露选择：可选 private 或 roles[customer]，默认 roles[customer]；场景声明 provider 不在允许受众内。所有人都看到可执行结论与阻断原因码。
- **后果**：满足核心 1（显式披露决定：finance 在确认页看到并可修改该选项）；customer 的代理在预算受众内时也能看到数字，但它对他方的输出只经模板（T-03）。provider 能从"被阻断"推断"超预算"，这是写明的最小披露。偏离 R（默认对 customer 披露），与 F07.1 一致。

### ADR-12 预算存放：finance 简报字段 + 承诺台账 + 约束快照
- **背景**：原方案 rooms 上的 `totalBudgetCents / committedCents`（DM-01）；审查建议独立 budgets + budgetChanges 表（F02.4、F03.3）。
- **选项**：A 独立 budgets / budgetChanges 表；B 上限是 finance 简报的硬约束字段，已承诺额来自 `commitments` 台账，二者在每个约束版本快照。
- **决定**：B。
- **后果**：所有约束变化走同一入口（`briefs.confirm` → `bumpConstraints`），不需要单独的 `updateBudget` 流程与 budgetChanges 表；预算历史就是 finance 的简报版本历史（含 changeNote）。偏离 F02.4 / F03.3。

### ADR-13 决定只追加，绑定 (proposalId, constraintsVersion, termsKey)，并要求客户端回传所见版本
- **背景**：审查建议同一 (proposal, user) 只留最新决定（patch，F08.1）；Role A 建议只追加 decisions（RA-D12）；核心 6 要求旧审批全部保留。
- **决定**：只追加；当前决定 = 最新一行；`decide` 必须带 `expectedConstraintsVersion` 与 `expectedTermsKey`，不一致即 `STALE_VIEW`。不用内容哈希（提案不可变，proposalId 即证明）。
- **后果**：撤回、旧拒绝、stale 全部可追溯；"人批准的就是他看到的"被强制。偏离 F08.1。

### ADR-14 审批区分 terms 与 budget
- **背景**：三方批准同一版本把服务商条款签核与客户内部预算承诺混在一起（F08.3，Q5）。
- **决定**：同一流程、两种审批类型：customer / provider "Accept terms"，finance "Approve budget commitment"；类型在提案创建时快照。
- **后果**：权责清楚、文案诚实；没有两套流程的复杂度。

### ADR-15 人工请求：完整实体，按阻断原因并行发给能解除阻断的人
- **背景**：GAP-12、F02.7、Q8；轻量版（候选提案共用 optionGroupId）与完整版二选一。
- **决定**：完整版 `humanRequests`，由场景规划器按诊断（预算 / 截止日 / 必需项）生成，每个目标角色一个请求、多个选项；并行发送，第一个约束变化取代其余请求；全员 decline → `negotiation_blocked`。
- **后果**：可追溯、可取消、绑定约束版本；不伪造一致（核心 8）。

### ADR-16 服务端回退（fallbacks）默认关闭
- **背景**：技能建议对 Opus 5.5 默认开启并告知用户（inputs/04 §4.5）；但它是 beta，与 `output_config.format` 能否同用待验证（#7），且会改变实际产出模型与 usage 语义。
- **决定**：v1 关闭，配置开关保留；拒答由 attempt 层重试一次 + 手动路径兜底。V5 验证通过后重新评估。
- **后果**：这是对技能默认建议的**有意偏离**，需要用户知悉并确认（Q-03）。

### ADR-17 模型与 effort
- **背景**：技能规定默认 `claude-opus-5-5`，不得自行降级（inputs/04 §4.1）；延迟与成本主要由 effort 决定。
- **决定**：全部调用点用 `claude-opus-5-5`（白名单 + 环境变量覆盖）；提议 effort `medium`，评审与抽取 `low`，以 EV-03 一致率决定是否上调。
- **后果**：Sonnet 5.5 / Haiku 5.5 只作为用户的成本决策选项（Q-02），不在默认配置中。

### ADR-18 成本与故障的全局护栏：四级预算 + 总开关 + 熔断
- **决定**：turn / run / 房间 / 部署每日四级调用上限；`AGENTS_ENABLED` 总开关；401 / 403 / billing / 404 打开熔断，只能人工重置。
- **后果**：费用滥用与额度耗尽都有确定的终态与界面提示；不引入 rate-limiter 组件（计数放在 `usageCounters`，部署级分片避免热点）。

### ADR-19 事件：只追加、受众判别联合、payload 受众安全、读时渲染、commitTs 全序
- **背景**：原方案 room / private 二元可见性（GAP-15）；审查多数意见"事件全房间可见、私密细节放按角色控制的表"，红队指出口径不一（F07.6）；Role A 写入时渲染文本（RA-T02 否决）。
- **决定**：受众 `room | roles | participant`；每种事件类型声明允许的受众与 payload schema，payload 只含受众内每个人都能看的数据；需要更多数值的受众另发一条 roles 事件；查询服务端渲染，payload 不出服务端。私密历史仍放在按角色控制的表中，不做"私密事件流"。
- **后果**：两种审查口径的折中：既不把私密数值放进全员行，又能给预算受众看到带数字的时间线。

### ADR-20 目录条目确认即对房间披露
- **背景**：provider 的报价既是私密输入又是提案必须引用的来源（GAP-26、Q4）；Role A 只在 UI 层"报价被引用前保密"（RA-B24）。
- **决定**：确认 = 对全房间公开（确认时明示）；provider 的私密内容放在简报备注与软偏好中。
- **后果**：候选可以对所有代理与人公开展示；"价格从哪来"不存在隐式披露。

### ADR-21 身份与席位
- **决定**：内部 `users` 表映射 `identity.tokenIdentifier`（全局唯一）；`participants` 是房间内的角色席位，只经邀请授予；每角色一人、一人一角色；创建者无额外审批权；不使用 Clerk Organizations。
- **后果**：消除自选角色与一人多角（T-02）；跨组织成员靠邀请链接；一角色多人留待 17。

### ADR-22 执行递增约束版本；执行后与放宽约束都不自动重谈
- **决定**：执行改变台账，所以 `bumpConstraints(execution_recorded)`；房间此时无活跃 run，不自动开始协商。上调预算等放宽且当前提案仍可执行时，只要求重新审批，不自动寻找更好方案（Q7）；任何人可 `requestRenegotiation`。
- **后果**：后续修订总在新的、包含本次执行的约束版本上评估；避免放宽约束引发不必要的模型调用与审批抖动。
