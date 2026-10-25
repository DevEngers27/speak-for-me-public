# 18 决策记录与开放问题 · part2：ADR-11 至 ADR-20、输入冲突裁决、开放问题、待验证

## ADR-11 预算低于已承诺：拒绝写入
- **背景**：审查建议 BUDGET_BELOW_COMMITTED → needs_input（F06.3、F09.4）；Role A 拒绝（RA-R10）。
- **决定**：拒绝写入，保持全局不变量 `committed ≤ cap`（EX-5）。
- **后果**：现实中"预算被砍到低于已承诺"的情形无法录入，需要先走"修订已执行变更单"（17 §4）。换来一条恒成立、可审计的不变量。

## ADR-12 事件受众只有 room 与 participant
- **背景**：原方案 room/private 二元（GAP-15）；审查多数主张事件全房间可见、私密细节放按角色控制的表；Role A 主张受众判别联合。
- **决定**：`room | participant` 二元；私密细节写成只给数据所有者的 participant 事件；需要多角色看到的数值走投影而非事件。
- **后果**：事件可见性规则只有一条（EV-3），payload validator 本身保证房间事件没有私密数值字段。

## ADR-13 披露 = 逐字段受众 + 策略性披露（acknowledgement）+ 派生闭包
- **背景**：Q1/F07.1：审查推荐买方（finance、customer）默认可见预算；原文把预算定为 finance 私密输入；核心 1 要求显式披露决定。
- **决定**：没有"按角色默认可见"的策略；finance 表单**预选**"披露上限与外部已承诺给 customer"，由 finance 确认时决定。策略性披露穷举在 07 §3，每项由确认时的 acknowledgement 记录。派生值只在全部输入可见时可见。
- **后果**：买方同侧的常见体验保留，同时每个跨方数值都能追溯到一次显式决定；provider 永远看不到可反推已承诺的总数（F07.1 文案陷阱由规则自动避免）。

## ADR-14 人工请求完整版，并行发送，数值只来自公开提案
- **背景**：审查给出完整版与轻量版（F02.7、F05.6）；Role A Q8 问并行还是顺序。
- **决定**：完整版 `humanRequests`；同一触发向所有能解决的角色并行发送，第一个改变规则字段的回答通过 bump 关闭其余；选项数值参数只来自公开提案或目标本人数据（HR-3）。
- **后果**：可追溯、可取消、绑定约束版本；恢复更快；不会因取舍选项泄露他方私密值。

## ADR-15 审批类别在数据层区分（terms / budget）
- 采纳 F08.3：provider、customer 签条款，finance 签预算承诺；同一绑定、同一完成判定。界面文案区分。代价只是一个快照字段。

## ADR-16 保留 finance 代理（评估回合，effort low）
- **背景**：F01.1、F10.17：代码已做预算算术，finance 代理可能是装饰。
- **决定**：保留一次评估调用，职责是为 finance 本人解释提案对其约束的影响并给出建议；产品文字如实写"finance 的代理不做算术，预算由代码校验"。
- **后果**：满足"每方有自己的代理"；每轮多一次调用（并行，不增加串行深度）。若用户决定纯确定性 finance，`RoleSpec.hasAgent = false` 即可，无需改引擎。

## ADR-17 模型与调用参数
- **决定**：全部调用点 `claude-opus-5-5`；effort：propose medium、evaluate low、抽取 low；不传采样参数、不 prefill、不强制 tool_choice、不传 thinking；`messages.create` + 自有 JSON Schema（保留 enum）+ Zod；服务端回退默认关闭，待验证与结构化输出兼容后开启（偏离技能"默认开启"的建议，理由是兼容性未知）。
- **后果**：成本较高（inputs/04 §4.10 估算每回合约 $0.07–0.09）；是否在评估回合改用较小模型留给用户决定（开放问题 1）。

## ADR-18 保留最小 users 表，以 tokenIdentifier 为外部键
- 采纳 F02.6 与 inputs/04 §3：tokenIdentifier 全局唯一；users 承载显示名；participants 引用 users id。

## ADR-19 seed 不写中间状态；变更单即 executions；不设 sharedFacts / changeOrders / budgets 表
- seed 只写房间、参与方与确认简报，中间状态由 stub 驱动真实流程产生（Role A Q11）；其余三张表与已有实体 1:1 或可派生，按"两方案都完整时选简单的"省去（02 part3 §1）。

## ADR-20 场景规模上限保证穷举
- 请求项 ≤ 8、变体 ≤ 3，使"无可行方案"成为可证明的陈述（06 §8）；放宽上限时必须引入非穷举标记（17 §9）。

## 输入冲突的裁决（按任务书第 3 节）

| 冲突 | 来源 | 裁决 | 依据 |
| --- | --- | --- | --- |
| 预算可见性 | 原文 finance 私密 / 审查买方默认可见 / Role A 只看结论 | ADR-13 | 核心 1 |
| 低于已承诺 | 审查 needs_input / Role A 拒绝 | ADR-11 | 核心 4、5 的可校验性 |
| 决定 patch / 只追加 | 审查 / Role A | 只追加（ADR-09） | 核心 6 |
| 提案 status 字段 / 派生 | 审查 / Role A | 派生（ADR-06） | 核心 6 |
| 内容哈希 | Role A 要 / 审查不要 | 不要（ADR-06） | 简单性 |
| 候选集给模型 | 审查 | 不给（ADR-07） | 核心 1 |
| 约束变化时 run | 审查内部两种写法 | 新 run（ADR-10） | 核心 3、守卫简单 |
| 事件可见性 | 审查 / Role A | ADR-12 | 核心 1、简单性 |
| priority 放目录还是客户简报 | 审查两说 | 必需性在 customer 简报（整理者建议） | 必需是 customer 的判断 |
| 必需项能否"显式延后"而合法 | 审查两说 | 不能，走取舍（06 §3 #7） | 核心 4 |
| 技能"默认开启回退" vs 兼容性未知 | inputs/04 | 默认关闭待验证（ADR-17） | 不编造平台行为 |

## 开放问题（需要用户或产品决定）

1. 评估回合或抽取是否改用 Sonnet 5.5 / Haiku 5.5（成本约 1/2 与 1/40）；需同一组 fixture 的质量与延迟对比。
2. 服务端回退在验证兼容后是否默认开启。
3. 小企业"一人兼 finance 与 customer"是否支持（17 §6），以及以什么房间模式支持。
4. 删除权与不可篡改历史的平衡：删除账户时匿名化 users、notes 墓碑化、结构化规则字段保留——是否可接受。
5. 产品 UI 语言与 i18n 优先级（P-25）。
6. 默认建房策略：任意登录用户还是允许名单。
7. 轮次用尽但存在有效提案时直接进入审批（当前设计，界面标注"代理有异议"）——是否改为先问 customer。
8. 审批有效期（批准后 N 天失效）是否需要。
9. 报价行 `validUntil` 是否在 provider 表单中设默认值。
10. customer 修改请求项（REQUEST_CHANGED）时，是否允许对"只新增可延后项"的情形自动保留当前提案的可执行性（当前设计：一律阻断）。
11. 是否建议改名（例如 "Mandate"、"Tri-Party Desk"）；文档统一沿用 Speak for Me。
12. 首个场景的组织形态假设（14 §1）需要用户访谈验证。
13. v1 是否包含邮件通知（当前：不包含，17 §2）。

## 待验证的平台事实（实现前用最小实验确认，结果回填对应章节）

| # | 事项 | 影响 |
| --- | --- | --- |
| V1 | Convex action 最长运行时间、mutation 限额（inputs/04 #1） | 10 §5 的 deadline 与超时 |
| V2 | OCC 持续冲突重试次数；索引区间读是否触发冲突（#2） | M-ROOM 使设计不依赖后者；`users.ensure` 依赖它 |
| V3 | mutation 内 `crypto.getRandomValues` / `crypto.subtle` 的可用性与语义 | 邀请 token 是否可在 mutation 内生成与哈希 |
| V4 | SDK 1.1.0 在默认运行时的打包与长请求（#4） | executeTurn 是否需 "use node" |
| V5 | Opus 5.5 回合 p50/p95（#5） | 10 §5 目标、effort |
| V6 | 结构化输出对 enum/const、非根 anyOf、可选属性的接受（#6） | 05 part1 §4 的 schema 形态 |
| V7 | `fallbacks` 与 `output_config.format` 同用（#7） | ADR-17 |
| V8 | `v.id("_scheduled_functions")` 是否可用作字段 validator | 03 §12，否则存 string |
| V9 | 默认运行时 `Intl.DateTimeFormat` 的 timeZone 支持 | 06 §5 的 todayIn |
| V10 | Clerk 的 Convex JWT 是否带 name；原生集成还是 JWT 模板（#13） | users.displayName 初值、配置步骤 |
| V11 | `returns` 的 `v.object` 是否拒绝多余字段 | 07 §6 第二道防线 |
| V12 | convex-test 0.0.65 的 API（身份、调度推进）（#14） | 16 §1 |
| V13 | SDK 内部重试的失败尝试是否计费（#10） | 成本估算偏差说明 |
| V14 | 测试中为三个账号获取 Convex 身份的方式（Clerk 测试 token） | 15 §2 的 drive-demo、16 §6 |
| V15 | 枚举 9 万节点在 mutation 内的实际耗时 | 06 §8 的规模上限 |
