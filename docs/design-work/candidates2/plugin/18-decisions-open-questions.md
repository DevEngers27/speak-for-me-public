# 18 决策记录与开放问题

> 格式：背景 / 选项 / 决定 / 后果。标【偏离 README】或【偏离 Role A】者为与原想法不同之处。

## ADR-01 引擎与场景以 ScenarioPlugin 接口分离，并用第二场景校验【偏离 README】
- 背景：README 把范围/报价/日期写进核心 schema（`scope`、`additionalCostCents`、`deliveryDate`）；任务书要求引擎能容纳第二场景。
- 选项：A 内建场景字段；B 通用 JSON + 插件纯函数；C 运行时可加载插件。
- 决定：B，插件编译期静态注册；第二场景 `event_budget` 写到契约测试粒度但 v1 不上线。
- 后果：引擎表里没有金额与日期字段（账本原语除外）；需边界 lint；`rooms.view` 的场景部分由插件 `viewValidator` 约束。

## ADR-02 模型只选候选键，不构造条款【偏离 README】
- 背景：README 让代理输出 scope/金额/日期/sourceRefs，再由代码核对。
- 选项：A 模型给条款再核对；B 模型给 itemKeys，代码算金额；C 代码枚举候选，模型选 candidateKey。
- 决定：C。目录 ≤ 8 项时穷举；更大由插件剪枝。
- 后果：发明金额在结构上不可能；不可行判定不调模型；LLM 价值集中在软偏好取舍与本方解释（10 §9）。代价：代理不能提出目录外方案（17 扩展点）。

## ADR-03 账本是引擎原语【偏离 Role A】
- 背景：Role A 把 `totalBudgetCents/committedCents` 放在 Room，committed 是可累加计数。
- 决定：`ledgerAccounts`（cap，ownerRole，visibleTo）+ 只追加 `ledgerEntries`；committed = 求和；baseline 是一条 simulated 条目；插件只声明 `ledgerImpact`。
- 后果：两场景共用预算检查；执行事务内统一复算；多房间共享预算有清晰迁移路径。

## ADR-04 约束变化：能保留则保留，否则旧 run superseded + 新 run【偏离 Role A】
- 选项：A 同一 run 回 negotiating；B 总是新 run；C 复制 revalidated 提案（Role A）。
- 决定：先判定当前提案在新 snapshot 下是否仍成立（含 contentKey 不变）；成立则保留（旧审批自然 stale，重新批准同一 proposalId）；否则 B。否决 C。
- 后果：不浪费模型调用；不出现"finance 的动作被记成 provider 的提案"。

## ADR-05 编排自建 scheduler 链 + watchdog
- 选项：自建 / workflow / workflow+agent 组件。
- 决定：自建；SDK `maxRetries:1, timeout:45s`，应用层自动重排 1 次，watchdog 120 s。
- 后果：需要 turns 表与两组守卫；部署时有在途 run 会让回合失败（可人工重试）。

## ADR-06 decisions 只追加（approve/reject/withdraw）【偏离 02 审查的 upsert 建议】
- 决定：采纳 Role A 修订意见（RA-R16），撤回是追加；当前决定 = 最新一条。
- 后果：完整审计；集合判定需取每人最新一条。

## ADR-07 审批区分 terms 与 commitment
- 决定：数据层 `kind`，同一流程；scope change：customer/provider = terms，finance = commitment。

## ADR-08 预算可见性按账户 visibleTo 声明
- 决定：scope change：finance 与 customer 可见数字，provider 只见 reasonCode 与本次变更金额；provider 视图不出现"批准后已承诺总额"。

## ADR-09 cap 不得低于 committed【与 02 审查 F09.4 不同】
- 背景：审查建议 `BUDGET_BELOW_COMMITTED → needs_input`。
- 决定：`ledger.updateCap` 直接拒绝（`LEDGER_CAP_BELOW_COMMITTED`），保持"Σ entries ≤ cap 恒成立"。
- 后果：已承诺的钱不能靠本系统撤销；若现实中预算被砍到已承诺以下，finance 需先在外部处理，再登记。开放问题 OQ-6。

## ADR-10 硬约束字段对必要的对方强制披露
- 背景：Q3（私密硬约束不满足时对他方显示什么）。
- 决定：插件可将字段声明 `mandatoryFor`；表单显式提示；reasonCode 本身会泄露约束存在，这样做是承认事实而非伪装保密。

## ADR-11 软约束不递增 constraintsVersion
- 决定：hardKey 之外的字段变化不使审批失效。

## ADR-12 执行后递增 constraintsVersion
- 决定：台账变化即约束变化；保持"约束集合任何变化都递增"的单一规则。

## ADR-13 保留最小 users 表；userId = tokenIdentifier 映射
## ADR-14 finance 代理保留一次评估调用（解释与 ask_principal），校验全归代码；产品文案如实描述
## ADR-15 v1 不开启服务端模型回退（与 `output_config.format` 同用待验证），默认 `claude-opus-5-5` / effort medium，不自动降级

## 开放问题

| id | 问题 | 当前倾向 |
| --- | --- | --- |
| OQ-1 | 协商回合是否允许改用 Sonnet/Haiku（成本约 2×/40× 差） | 需用户决定；先用 Opus 5.5 实测 |
| OQ-2 | 是否开启服务端回退 | 待验证 #7 后决定 |
| OQ-3 | decisions.note 是否对同 side 可见 | v1 只给本人 |
| OQ-4 | 报价有效期 validUntil 是否进 v1 | 17 扩展点 |
| OQ-5 | 一个席位多名用户 | v1 否 |
| OQ-6 | 预算砍到已承诺以下的现实流程 | ADR-09 暂拒绝 |
| OQ-7 | 修改 goal 是否算约束变化 | 否（goal 不进 snapshot） |
| OQ-8 | 延后条目执行后是否生成后续占位 | v1 只在变更单列出 deferred |
| OQ-9 | 产品改名 | 保留 Speak for Me |
| OQ-10 | 插件运行时加载 | v1 否 |

## 待验证（实现前用最小实验确认）
Intl 时区支持（`snap.today`）；`v.object` returns 拒绝多余字段；属性级 `anyOf` + `enum` 在结构化输出中被接受；SDK 在默认运行时可用；action 最长运行时间；convex-test API；OCC 下索引区间读冲突；Opus 5.5 回合 p95；账户创建日期与"保留思考"约束；`v.commitTs()` 在索引中的排序行为。
