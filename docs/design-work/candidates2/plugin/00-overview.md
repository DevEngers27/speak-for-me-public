# 00 概览（候选设计：场景插件接口优先）

## 1. 一句话
Speak for Me 是一个**场景中立的协商引擎**：房间、席位、私密简报、目录、账本、协商运行、提案、审批、执行、事件；场景以 `ScenarioPlugin` 注入形状与纯函数。首个插件 `software_change`（范围变更），第二插件 `event_budget`（活动预算）写到契约测试粒度，用来证明引擎边界。

## 2. 设计原则
1. 用两个场景逼出引擎边界；引擎中出现场景词即是缺陷（lint 守护）。
2. 代码枚举可行候选，模型只在候选中选择并向本方解释；金额由插件 `derive` 从已确认数据算出。
3. 能派生的不存（committed、可执行性、审批是否失效）；历史只追加。
4. 状态只经迁移表改变；两组守卫（回合持久化 / 审批执行）不混用。
5. 披露三层：表级、插件字段级、模板文本级；服务端投影是唯一防线。
6. 两个方案都完整时选简单的：静态插件注册、自建调度链、无 hash、无运行时插件加载。

## 3. 核心 8 条如何保证

| 核心 | 设计点 |
| --- | --- |
| 1 私密委托 | 简报 `disclosable/mandatoryFor` + 逐字段勾选（07 §4）；`rooms.view` 唯一读模型、按 viewer 投影、`returns` + `plugin.viewValidator`（07 §3）；代理上下文单一入口白名单（07 §6）；canary 测试（16 §4） |
| 2 代理只建议 | 动作集无"批准"（05 §3）；`recommend_accept` 不写 decisions；`requests.answer`/`decisions.decide` 只能由人调用（12） |
| 3 人批准具体版本 | decision 绑定 proposalId + contentKey + constraintsVersion（08 §1）；集合判定 `approvalSetComplete`（08 §2）；约束变化旧审批派生为 stale（04 §5） |
| 4 代码负责校验 | 候选由 `enumerate` 生成，模型只选键（ADR-02）；`evaluate` 引擎级 + 插件级检查（06 §4）；执行事务内重建 snapshot 复算（08 §4）；权限 helper（07 §1） |
| 5 执行幂等且原子 | 最后一票同一 mutation 内执行；状态守卫为主、`operationId = exec:${proposalId}:${cv}` 为辅；同事务写 executions/ledgerEntries/documents/tasks（08 §4）；并发脚本（16 §5） |
| 6 历史不可篡改 | 提案、决定、简报版本、目录修订、台账、cap 变化、事件只追加（02 I1）；`commitSeq` 全序事件（03） |
| 7 执行边界 | 只写内部表；外部集成走 outbox 扩展点（17） |
| 8 不伪造 | `simulated` 字段贯穿 seed/stub/目录/台账（02 I12）；界面常驻标签（13 §5）；不可行时代码开 humanRequest，不编造一致（05 §6）；禁止 seed 写中间审批状态（15） |

## 4. 术语表

| 术语 | 含义 |
| --- | --- |
| roleKey | 插件声明的角色键（如 `customer`）；引擎只认字符串 |
| participant | 房间席位 = (roleKey, userId) |
| brief / briefVersion | 私密简报草稿 / 已确认只追加版本 |
| hardKey | 插件给出的硬约束规范化串；变化才递增约束版本 |
| catalogEntry | 作者角色确认的供给条目（修订链） |
| ledger account / entry | 有上限的账户 / 只追加台账；committed = 求和 |
| snapshot | 规则的唯一输入（服务端） |
| selection / derived / contentKey | 提案的选择部分 / 插件派生的条款 / 规范化串 |
| candidate | `enumerate` 产出的、已通过全部检查的可选提案 |
| run / turn | 一次协商运行 / 一个角色代理的一次独立调用 |
| decision | approve / reject / withdraw，只追加 |
| humanRequest | 代码生成、指向具体角色的取舍问题 |
| execution | 一次原子执行，产出文档、台账条目、任务 |
| constraintsVersion | 约束集合版本，只经 `bumpConstraints` 递增 |

## 5. 与原方案的主要差异
1. 场景字段移出核心 schema（ADR-01）；2. 模型只选候选键（ADR-02）；3. 预算成为账本原语，committed 由台账求和（ADR-03）；4. 约束变化"能保留则保留"（ADR-04）；5. 决定只追加（ADR-06）；6. cap 不得低于 committed（ADR-09）；7. 硬约束对必要方强制披露（ADR-10）；8. 执行也递增约束版本（ADR-12）。详见 18。

## 6. 文件清单
00–18 共 19 个编号；03、06、14 各有 part2。
