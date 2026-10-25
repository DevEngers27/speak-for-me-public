# 00 概览（part2）：术语表与阅读路线

## 0.6 术语表（全篇一个概念一个名字）

| 中文 | 标识符 | 定义 |
| --- | --- | --- |
| 房间 | `rooms` | 一次多方协商的容器；绑定场景与版本、时区、币种；持有版本计数器与"当前"指针 |
| 场景 / 场景插件 | `scenarioKey`、`ScenarioPlugin` | 声明 + 纯函数的业务包；首个为 `scope_change`（06） |
| 角色 | `roleKey` | 场景声明的身份（customer / provider / finance），引擎只认字符串 |
| 席位 | `seats` | 房间中某角色的位置；至多一个用户；一人一席 |
| 房主 | `ownerUserId` | 建房者；只能邀请、改信息、关闭房间，无额外签核权 |
| 邀请 | `invites` | 指向席位的一次性令牌（只存哈希） |
| 披露基线 | `joinDisclosure` | 接受邀请时同意的、对全体可见的派生结论（检查通过/失败与原因码） |
| 简报草稿 / 简报版本 | `briefDrafts` / `briefVersions` | 可变的私密草稿；确认后的不可变版本 |
| 规则字段 / 偏好字段 | `FieldSpec.kind = "rule" / "preference"` | 前者是规则输入，变化递增约束版本；后者只影响代理判断 |
| 私密备注 / 共享说明 | `notes` / `sharedNote` | 只进本方代理的自由文本 / 人亲自写并选择披露的自由文本 |
| 披露 | `disclosures` | 对本席位某字段、派生事实或共享说明的受众决定 |
| 共享事实 | `sharedFacts` | 他方披露给我的字段值（读模型，不存储） |
| 共享清单 / 清单项 | `listItems`、`listKey` | 版本化的公开条目；scope_change 有 `scope`（范围项）与 `quote`（报价行、加急费） |
| 台账 / 承诺 | `commitments` | 金额条目：`baseline`（基线）与 `execution`（执行产生） |
| 已承诺 | `committedCents` | 台账 active 条目之和（派生） |
| 约束 / 约束版本 | `constraintsVersion` | 规则输入的整体版本；只经 `bumpConstraints` 递增 |
| 约束修订 | `constraintRevisions` | 每个约束版本的不可变快照（原因、操作者、`inForce`） |
| 规则视图 / 作用域视图 | `RuleView` / `ScopedRuleView` | 某时刻全部规则输入（服务端私有）/ 按某角色可见性裁剪后的视图 |
| 检查 / 原因码 | `CheckOutcome`、`reasonCode` | 一条确定性规则的结论；码为 UPPER_SNAKE |
| 投影 | `ProjectedCheck`、DTO | 按查看者可见性裁剪后的结果；`full` 或 `verdict_only` |
| 候选 / 候选键 | `selection`、`candidateKey` | 代码枚举的一种组合，如 `LOGIN+REPORTS@standard` |
| 条款 | `terms`、`termsKey` | 人批准的完整内容（含金额、日期、延后项、来源引用）及其规范化字符串 |
| 提案 | `proposals` | 一份不可变条款 + 必需签核快照；`active / superseded / executed`；可执行性派生 |
| 签核 / 决定 | `decisions`（approve / reject / withdraw） | 席位对"提案 × 约束版本"的一次表态，只追加 |
| 签核类型 | `signoffKind`（`terms` / `budget`） | 接受条款 / 批准预算承诺 |
| 签核状态 | `SignoffState` | pending / approved / rejected / stale_approve / stale_reject（派生） |
| 执行记录（变更单） | `executions`、`CO-n` | 最后签核同事务写入的主记录，冻结条款 |
| 操作键 | `operationKey` | `exec:{proposalId}:{constraintsVersion}`，执行幂等的辅助防线 |
| 任务 | `tasks` | 执行派生的内部任务，指派给席位 |
| 协商运行 | `runs` | 一次有界的代理协商片段；`running / stalled / finished` + 结局 |
| 回合 | `turns` | 某代理在 run 中的一次尝试（每 attempt 一行） |
| 信封 | `AgentEnvelope` | 服务端从回合快照生成的身份、版本与允许集合 |
| 动作 / 立场 | `ModelMove`：propose / counter / recommend_accept / reject / clarify | 代理的结构化输出；对他方只以结构化立场呈现 |
| 提出方 / 审阅方 | `proposerRoleKey` / `reviewerRoleKeys` | 每轮先手提出者 / 并行审阅者 |
| 人工请求 | `humanRequests`：tradeoff / preference / disclosure | 发给具体席位的结构化请求 |
| 取舍请求 | `tradeoff` | 无可行方案时，按"最小放宽"给每个可行动角色的选项 |
| 偏好请求 | `preference` | 代理请本人在候选中亲自选择 |
| 披露请求 | `disclosure` | 他方代理请求某字段；本人决定是否共享 |
| 派生阶段 | `phase` | setup / negotiating / stalled / needs_input / awaiting_approval / blocked / executed / closed |
| 持久化守卫 / 签核守卫 | G-PERSIST / G-SIGN | 回合结果落库前 / 签核与执行前的两组独立检查 |
| 有界推断披露 | — | 为解释阻断而接受的、有上界的可行性信号（07 第 7.6 节） |
| stub 模式 | `AGENT_MODE=stub`、`agentMode` | 确定性代理替身，产物标注 "Simulated agent" |
| 模拟房间 | `isSimulated` | fixture 生成、整房标注的房间 |

金额口径（本次变更金额、批准后已承诺、上限、余量、超出额）见 02 第 2.5 节。

## 0.7 阅读路线

- **想先看体验**：01 part2–part4（三方旅程与失败体验）→ 14 part3（预算下调完整走查）→ 13。
- **想先看正确性**：02 part2（不变量）→ 04（迁移表与守卫）→ 08 第 8.7 节（执行事务）→ 09 第 9.3–9.4 节（约束变化）→ 16。
- **想先看可扩展性**：06 part2（插件接口）→ 06 part3（第二场景检验）→ 11（依赖规则）→ 17。
- **想先看隐私**：07 全部 → 05 第 5.10、5.12 节 → 10 第 10.10 节。
- **想看与原方案的取舍**：00 第 0.5 节 → 18。
