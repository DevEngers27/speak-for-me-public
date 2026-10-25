# 01 原始想法整理（part5）

> 分片清单、行号约定与标注含义见 01-original-ideas-part1.md。

## §6 协商协议草案

### 6.1 原作者的规则（R:279-291 原意概括）

- 动作：propose、counter、clarify、recommend acceptance、reject（R:283）。
- 每条消息携带：room ID、run ID、source agent、base proposal version、constraints version、structured terms、shareable explanation、source references（R:284）。
- 每个代理只收到自己的简报和授权共享事实；对他方的消息优先用允许列表字段（R:285）。
- 起步上限 3 个完整协商轮次；未解决就停下来等人（R:286）。
- 畸形输出或超时有界重试，然后暴露可恢复的失败（R:287）。
- 代理"建议接受"不是人的批准（R:288）。
- Zod 草案只是起点契约，不实现预算校验、编排或审批（R:289）。
- 状态：draft → negotiating → needs input / pending approval → confirmed，外加 paused、failed（R:291）。

### 6.2 原 Zod 契约字段（N:4-20）

| 结构 | 字段 | 类型与约束 |
| --- | --- | --- |
| agentRole | — | enum customer / provider / finance |
| proposalTerms | scope | string[]，每项非空，至少 1 项 |
| proposalTerms | additionalCostCents | int，≥ 0，≤ Number.MAX_SAFE_INTEGER |
| proposalTerms | deliveryDate | z.iso.date() |
| proposalTerms | sourceRefs | string[]，每项非空，至少 1 项 |
| agentMessage | roomId, runId | string，非空 |
| agentMessage | sourceRole | agentRole |
| agentMessage | baseProposalVersion, constraintsVersion | int，≥ 0 |
| agentMessage | action | enum propose / counter / clarify / recommend_accept / reject |
| agentMessage | terms | proposalTerms，可选 |
| agentMessage | publicSummary | string，非空 |

### 6.3 条目

| ID | 原作者的想法 | 出处 | 标注 | 评估与建议 |
| --- | --- | --- | --- | --- |
| PR-01 | 五个动作 propose / counter / clarify / recommend_accept / reject | R:283, N:17, R:255 | 保留 | 作为模型可选的动作集。原文没有"声明不可行 / 请求人工取舍"的动作，升级完全由编排决定；05 需决定是加一个模型动作还是由服务端规则判定后生成人工请求 |
| PR-02 | 消息携带房间、run、来源代理、基础提案版本、约束版本、结构化条款、可共享解释、来源引用 | R:284 | 重新评估 | 拆成两层：服务端信封（roomId、runId、回合序号、来源参与方、baseProposalVersion、constraintsVersion，由服务端根据 run 上下文填写）与模型输出（action、条款、解释、来源引用、问题）。模型不得填写身份与版本字段；若回显，服务端比对不一致即拒绝（GAP-04） |
| PR-03 | agentMessage 中 terms 对所有动作都可选，sourceRefs 只在 terms 里 | N:9, N:18 | 重新评估 | 改为按 action 的判别联合：propose/counter 必须带条款；clarify 必须带结构化问题与提问对象；reject 必须带 reasonCode；recommend_accept 必须指明认可的提案版本（原文让 baseProposalVersion 一字两用）；来源引用不应只挂在 terms 下 |
| PR-04 | 条款 scope 是自由字符串数组 | N:6, S:25 | 重新评估 | 范围项应引用场景目录中确认过的条目 ID，代码才能校验必需范围和价格；同时显式列出延后项（"some work deferred"，R:241） |
| PR-05 | 条款金额 additionalCostCents 由消息给出，非负 | N:7 | 重新评估 | 核心 #4"模型不得发明金额"：模型选择条目，金额由代码按确认过的报价计算并与模型声明比对；非负约束无法表达缩减范围带来的退减（GAP-25） |
| PR-06 | 单一 deliveryDate | N:8, S:26 | 重新评估 | 可能需要按里程碑/条目的日期；z.iso.date() 是 Zod 4 写法，版本以 04 为准（待验证） |
| PR-07 | 付款条件、产能、不可接受条款在条款里没有字段 | R:238-239 vs N:5-10 | 重新评估 | 由场景插件定义条款扩展字段（GAP-14） |
| PR-08 | 对他方可见的内容优先允许列表字段；但 publicSummary 是必填自由文本 | R:285, N:19 | 重新评估 | 对他方可见的文本由结构化字段 + 模板生成；模型自由文本仅给本方看，或经披露检查后才对他方可见（GAP-06） |
| PR-09 | 每个代理只拿到自己的简报与授权共享事实 | R:285, R:352 | 保留 | 07 的上下文组装函数是唯一入口，16 用金丝雀验证 |
| PR-10 | 最多 3 个完整协商轮次，未解决就停下来等人 | R:286, R:353 | 保留 | 3 作为默认值，做成场景可配置；"一个完整轮次"的定义（谁先手、三方各一回合？）原文没有（GAP-10） |
| PR-11 | 现有选项无解时，向相关的人提出具体的取舍请求；不伪造一致 | R:245, R:354, R:410 | 保留 | 原文没有取舍请求的结构；05 需定义：目标参与方、可选项、每个选项的后果（金额、范围、日期）、截止与回复方式；"相关的人"如何确定是空白（GAP-12） |
| PR-12 | 畸形输出或超时有界重试，然后暴露可恢复的失败 | R:287, R:355 | 保留 | 10 定义重试次数、退避、失败状态以及人如何恢复 |
| PR-13 | 拒绝过期回复；超时可恢复 | R:403, R:413, R:345 | 保留 | 与 AR-04 同源 |
| PR-14 | Zod 草案只是形状契约，不等于业务校验 | R:289 | 保留 | 形状校验与规则校验分两层（AR 5.3） |
| PR-15 | 模型的四类工作：简报解读、提案、还价、解释 | R:155 | 保留 | 10 按这四类分别定义提示、输出 schema 与模型选择 |
| PR-16 | 记录每个 run 的延迟、调用次数和可得的成本数据；证据摘要不含隐藏推理 | R:355, R:200 | 保留 | 需要 run/用量表（DM-10、DM-15） |
| PR-17 | 人在界面上"回答澄清" | R:332 | 重新评估 | 代理间的 clarify 应先由被问方代理在其授权简报范围内回答，答不了才变成对人的请求；原文未定（GAP-11） |
| PR-18 | 协调预算变化与重新协商 | R:354 | 保留 | 09 定义约束变化如何取消进行中的 run、如何开新 run |
| PR-19 | 修改已确认协议开始新流程并保留历史 | R:291 | 保留 | "新流程"是同房间新 run 还是新房间未定（GAP-13） |

### 6.4 状态列表

原状态集（R:291, S:5）：`draft`、`negotiating`、`needs_input`、`pending_approval`、`confirmed`、`paused`、`failed`，只作为 rooms.status 一个字段（S:11）。

| ID | 原作者的想法 | 出处 | 标注 | 评估与建议 |
| --- | --- | --- | --- | --- |
| PR-20 | 上述 7 个状态，作为房间的单一状态 | R:291, S:5, S:11 | 重新评估 | 一个字段混合了房间、run、提案、审批的状态。brief 要求分开的状态机：房间、协商 run、提案、审批、人工请求（04） |
| PR-21 | confirmed 作为终态 | R:291 | 重新评估 | 含义不清：是"全部批准"还是"已执行"？建议区分 approved 与 executed，执行本身应是一次原子迁移 |
| PR-22 | paused 状态 | R:291 | 重新评估 | 谁触发、为什么、如何恢复都没写（GAP-18）；可能被"约束变更导致 run 取消 + 等人"覆盖 |
| PR-23 | failed 状态 | R:291, R:287 | 重新评估 | 需区分可恢复失败（重试、换输入）与终止失败；可恢复失败不应让房间进入终态 |
| PR-24 | 缺失的状态 | R:245, R:291 | 重新评估 | 提案需要 superseded / not executable（被新提案或新约束版本取代）；审批需要 stale / revoked；房间需要 closed / cancelled。这些在原状态集中都没有 |
