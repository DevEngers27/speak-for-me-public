# 18 决策记录与开放问题（part1）：运行时与协议 ADR

> 分片：part1 运行时与协议（ADR-01…ADR-10）；part2 数据、审批、隐私与场景（ADR-11…ADR-22）；part3 其余决定（ADR-23…ADR-28）、输入冲突的裁决、开放问题、待验证清单。
> 格式：背景 → 选项 → 决定 → 后果。"偏离"标出与原 README（R）或 Role A 分支（RA）或审查建议（F）不同之处。

### ADR-01 编排：自建 scheduler 链
- **背景**：被调度的 action 至多一次、不重试，平台中断无回调（inputs/04 §1.5）；必须自建或用组件实现重试、超时、迟到拒收。
- **选项**：A 自建（mutation + scheduler + attempt 表 + watchdog）；B workflow（+ workpool）；C workpool / action-retrier 只管重试；D agent 组件。
- **决定**：A。
- **后果**：无新依赖、状态只有一个真相源、重试与用量完全可见；需要自己写约 4 个 internal 函数与一个纯策略模块（10 part3–part4）。D 与技术栈冲突（Vercel AI SDK v7）；B 的确定性约束让规则迭代期在途实例失败；B / C 都不解决迟到拒收与单活跃 run。迁移出口：只把模型调用调度换成 workpool（17 §17.5）。

### ADR-02 run / turn / attempt 三层，attempt 即用量账本
- **背景**：原方案只有 runId 字符串（DM-10）；审查建议 runs + agentTurns（attempt 为字段）。
- **选项**：A 两层（turn 上记 attempt 计数）；B 三层（attempt 独立成表）。
- **决定**：B，`modelCalls` 表同时是全局用量账本（抽取也写这里）。
- **后果**：每次 HTTP 请求一行（I12），迟到结果有独立身份可被拒收而不污染 turn；多一张表，但它替代了单独的用量表。偏离 F03.9（attempt 作为 turn 字段）。

### ADR-03 重试只在 attempt 层（SDK `maxRetries: 0`）
- **背景**：重试分层会相乘（F10.4：54 次）；原仓库客户端 `maxRetries: 1, timeout: 30_000`（AR-12）。
- **选项**：A SDK 重试 + 应用重试；B 只 SDK；C 只 attempt 层。
- **决定**：C；SDK 超时 60 s（实测后按 2 × p95 调整）。
- **后果**：失败请求全部可见可计费归因；可读取 429 `retry-after`；跨 action 生命周期。代价是每次重试多一次调度（毫秒级）。偏离 F10.4 红队修订（自建路线 SDK `maxRetries: 2`）与 AR-12。

### ADR-04 两阶段写回（record → apply）
- **背景**：持久化放在模型 action 里，写回失败会导致重复付费调用（F10.2）；单一提交 mutation 失败会连带丢失用量。
- **选项**：A action 内一次 `completeTurn`；B record（极小）+ 被调度的 apply（exactly once）。
- **决定**：B。
- **后果**：模型结果先落库；apply 的确定性缺陷不会触发新的模型调用（F14），watchdog 可据 `applyFnId` 判定；多一次调度跳转。

### ADR-05 代码枚举候选，模型只选 `candidateKey`
- **背景**：原方案让模型给出 scope、金额、sourceRefs（PR-04、PR-05）；审查建议模型给 itemKeys、金额由代码求和（F05.2）。
- **选项**：A 模型给 itemKeys + 代码求和校验；B 代码先枚举全部可行组合，模型只在其中选择。
- **决定**：B；JSON Schema 中 `candidateKey` 为本 run 候选的枚举（编译延迟过大时可关）。
- **后果**："模型不得发明金额 / 范围 / 日期"在结构上成立；无可行解由代码判定、不调模型；提示更短。代价：每个代理会知道"哪些组合可行"（T-08，已写入委托条款）；大目录需要剪枝（17 §17.2）。偏离 R 与 F05.2。

### ADR-06 一个 run 只属于一个约束版本；约束变化 = 取代旧 run + 新 run
- **背景**：审查 P5 两种写法冲突（F04.1 整理者注）；Role A 在同一状态上手工改值。
- **选项**：A 同一 run 回到 negotiating；B 旧 run superseded + 新 run。
- **决定**：B；新 run 可能是零回合的"重新审批"run。
- **后果**：R2 不变式简单可证；迟到结果判定只看 runId 与版本；run 历史清晰对应约束历史。run 行数增多（可接受）。

### ADR-07 提案完全不可变，状态与可执行性派生；约束变化不复制提案
- **背景**：审查建议 proposals 存可变 status（active / superseded / executed，F03.6）；Role A 在约束变化后复制 revalidated 版本（RA-R11）。
- **选项**：A 可变 status；B 完全不可变 + 派生。
- **决定**：B；约束变化后同一提案在新版本下重新评估，仍可执行则进入重新审批（04 T2）。
- **后果**：核心 6 最强形式；executed 由执行记录派生、current 由房间指针派生。偏离 F03.6 与 RA-R11（RA-R11 本就被否决）。

### ADR-08 协议：提议方提出、评审方并行评审；保留原五个动作
- **背景**：原方案五个动作，未定义轮次（GAP-10）；审查建议 provider 提议 + customer / finance 并行评估（F05.5）。
- **决定**：一轮 = 1 个 propose 回合 + 并行 review 回合；propose 回合动作 propose / clarify / reject，review 回合动作 recommend_accept / counter / clarify / reject；counter 是"偏好信号"而不是新提案，只有提议方写提案；maxRounds = 3（场景配置）。
- **后果**：每轮只有一个提案写入者，无并发冲突的提案；串行深度 2。偏离 R（counter 原义为还价提案）。

### ADR-09 clarify 只交给人；升级只由代码触发
- **背景**：GAP-11（被问方代理答还是本人答）；F05.6（是否打扰人由代码决定）。
- **决定**：clarify 只能选问题目录中的封闭问题，交给目标角色的**人**回答（回答即显式披露）；每 run 至多采纳 1 次；不可行、提议方拒绝、拒绝循环由代码升级。
- **后果**：代理不会替人披露任何信息（核心 1）；代价是澄清需要人参与，所以限 1 次。

### ADR-10 评审失败 fail-open，提议失败 fail-closed + 手动提案
- **背景**：模型持续失败时房间不能卡住（F10.1），也不能伪造代理意见（核心 8）。
- **决定**：评审回合失败记为 `no_recommendation`，本轮照常结束；提议回合失败 → run failed，可 resume（≤ 2 次）或由提议方的人手动选择候选。
- **后果**：代理是顾问而不是依赖（R9）；所有安全性仍由代码与人工审批保证。界面必须清楚标出"该方代理未给出建议"。
