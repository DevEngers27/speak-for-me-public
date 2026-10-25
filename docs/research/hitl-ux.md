# 研究：人在环中的审批与 AI 委托的 UX 模式（hitl-ux）

> 研究代理产出，访问日期统一为 2026-10-24。网页内容按数据对待。可信度：高 = 官方文档/同行评审论文；中 = 厂商博客、行业刊物、预印本；低 = 第三方博客/社区帖。
> 对应任务书文件编号：02 领域模型、03 schema、04 状态机、05 协议、07 权限隐私、08 审批执行、09 约束变更、10 运行时、13 前端。

## 0. 概述

调研对象分四类：
1. **代理 HITL 框架**：LangChain/LangGraph `HumanInTheLoopMiddleware` 与 Agent Inbox、Microsoft Research Magentic-UI、OpenAI ChatGPT agent 的确认机制。
2. **人机交互准则**：Microsoft HAX 18 条准则（Amershi et al., CHI 2019）、Google PAIR People + AI Guidebook（Explainability + Trust）、Smashing Magazine 2026 年的代理 UX 模式汇编。
3. **多方审批/版本产品**：GitHub 受保护分支（stale approval dismissal）、Ironclad 审批重置、DocuSign 信封更正、Bitbucket "changes since last review"、Google Docs 建议模式。
4. **实时协作与信任研究**：Liveblocks presence 模式、自动化偏差（automation bias）与"人在环中反而降低准确率"的实证。

一句话结论：成熟产品把"AI 建议"做成**带类型的、可编辑的待决项**（action request + allowed decisions），把"人的决定"做成**绑定到具体内容快照的不可变记录**；内容一变，旧批准自动标记为 stale 并要求重批（GitHub、Ironclad 都这样做）。信任来自"可以随时看到为什么、是谁、基于哪一版"，而不是来自更多的确认弹窗——确认过多会退化成橡皮图章（Magentic-UI 用户研究、自动化偏差文献）。

## 1. 提纲（逐项发现，正文见第 2 节；模式/反模式见第 3 节；设计含义见第 4 节；未解决问题见第 5 节）

- F1 待决项应是带类型的结构化对象，决策集合由服务端声明（LangChain HITL）
- F2 "回应"不能被当作"拒绝"；拒绝必须是显式类型（LangChain HITL 警告）
- F3 审批绑定内容快照，内容变化 → stale → 必须重批（GitHub、Ironclad）
- F4 审批重置要有明确的触发策略与可见原因（Ironclad reset 配置）
- F5 版本间差异视图："自你上次审阅以来的变化"（Bitbucket/GitHub）
- F6 先给计划再执行（Intent Preview / co-planning），用户可编辑、可"我自己来"
- F7 按不可逆程度分级确认（action guards），避免一律弹窗
- F8 审批疲劳与自动化偏差是真实风险；"人在环中"可能提高采纳但降低准确率
- F9 信任校准：说明数据来源、部分解释、按利害程度调节解释深度；慎用数值置信度
- F10 解释要"因为你说了 X，所以我做了 Y"，并可追溯到来源
- F11 多会话/多房间的"需要你处理"状态指示与可恢复的状态摘要
- F12 实时他方动作：presence 是临时态，持久事件另存；AI 代理作为一等参与者出现
- F13 失败与恢复：显式错误卡片 + 已做/未做清单 + 重试路径；取消/撤销必须与真实能力一致
- F14 多方签署：已完成的签署不可修改，修改需新信封（DocuSign）
- F15 AI 建议的视觉区分：建议态（suggesting）与已生效态分离，批量接受需谨慎
- F16 多人审批的聚合语义必须显式（Everyone must approve vs First to respond）

---

## 2. 逐项发现

### F1 待决项是带类型的结构化对象，允许的决策由服务端按项声明

**结论**：LangChain 的 HITL 中间件在中断时下发 `action_requests`（每项含 `name`、`args`、`description`）与 `review_configs`（每项含 `action_name`、`allowed_decisions`），决策类型为 `approve` / `edit` / `reject` / `respond`；恢复时按顺序回传 `decisions`，并要求持久化 checkpointer 与同一 `thread_id`。旧版 Agent Inbox 用 `allow_accept` / `allow_edit` / `allow_respond` / `allow_ignore` 四个开关控制界面按钮。界面按钮不是前端自行决定，而是由每个待决项的配置决定。

**证据**：
- https://docs.langchain.com/oss/python/langchain/human-in-the-loop （2026-10-24）——字段名、决策类型、batched 与 `per_call` 两种模式、`response_schema`。
- https://docs.langchain.com/oss/langchain/frontend/human-in-the-loop （2026-10-24）
- https://reference.langchain.com/javascript/types/langchain.index.HumanResponse.html （2026-10-24）——旧类型 `accept | ignore | response | edit`。

**可信度**：高（官方文档）。

### F2 "回应"不等于"拒绝"；编辑要保守；部分无效的批量回答会导致重复执行

**结论**：LangChain 文档明确警告：`respond` 的消息被当作**成功的工具结果**，因此不能用它来否决有副作用的动作，否决必须用 `reject`。大幅 `edit` 可能让模型重新规划，导致重复执行或意外动作。`per_call` 模式下若一组回答中有一项无效，其他项可能已执行而中断仍显示待决，再次回答会**执行两次**——应先按 `response_schema` 校验或逐项提交。

**证据**：https://docs.langchain.com/oss/python/langchain/human-in-the-loop （2026-10-24）。社区解读（AgentMail）还指出"被忽略的项不能静默当作 no-op，否则会积压成陈旧工作和隐藏失败"：https://www.agentmail.to/insights/langchain-agent-inbox （2026-10-24，低）。

**可信度**：高（官方警告）；"忽略项"一条为低。

### F3 审批绑定内容快照；内容变化即 stale，必须重新批准

**结论**：GitHub 受保护分支的可选设置 "dismiss stale pull request approvals when new commits are pushed"：GitHub **记录批准时的 diff 状态**，该状态代表审阅者批准的变更集；若 diff 偏离此状态，批准被作为 stale 驳回，PR 在重新获得批准前不能合并。相关设置还有：限制谁能驳回审阅、要求 code owner 审阅、要求"最近一次可审阅推送"由推送者以外的人批准。

**证据**：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches （2026-10-24）。

**可信度**：高。与任务书核心第 3 条（人批准具体版本）完全同构，是最强的外部先例。

### F4 审批重置需要明确的触发策略，并对用户显示"为什么被重置"

**结论**：Ironclad 在 Workflow Designer 中为每个审批配置 "When should approval be reset?"：默认 Always；可选触发包括退回 Review、文档变更（含 redline）、属性更新；可收窄为"仅签署包文档的 redline"。退回 Review 时签署请求被取消、审批人被重置。管理员可在编辑属性时选择是否重置全部审批（但条款审批除外）。社区帖显示用户对"为什么别人的审批被重置而我的没有"感到困惑。

**证据**：
- https://support.ironcladapp.com/hc/en-us/articles/40675997675031-Configure-Approval-Resets-in-Workflow-Designer （2026-10-24）
- https://community.ironcladapp.com/discussion/6478/comparing-a-partially-executed-agreement （2026-10-24，低）

**可信度**：中高（官方帮助中心，但页面有 "Coming Soon" 横幅，选项名可能变动）。

**启示**：Ironclad 允许"永不重置"与管理员越权——这正是本系统**不应**提供的东西（违背核心第 3 条）。本系统应只保留"何种变更使哪些审批失效"的确定性规则，并在界面上显示失效原因。

### F5 版本差异："自你上次审阅以来的变化"是重新审批的核心视图

**结论**：Bitbucket 提供 "Changes since last review"，只在存在审阅者未看过的新提交时出现，用于迭代式复审。GitHub 网页端在文件变化后会取消该文件的 "Viewed" 标记并显示 outdated 标签，过时的评论被标为 "Outdated"、只在 Conversation 视图出现；但 GitHub 网页端没有自动生成"自上次审阅以来的累计 diff"（VS Code 扩展有 "Show Changes Since Last Review"）。审阅者抱怨要开两个窗口对照过时评论。

**证据**：
- https://www.atlassian.com/blog/bitbucket/iterative-review （2026-10-24，中，厂商博客）
- https://docs.plannotator.ai/learn/code-review/what-is-a-revision-diff （2026-10-24，低）
- https://discourse.llvm.org/t/hows-it-going-with-pull-requests/73467 （2026-10-24，低，用户反馈）

**可信度**：中（行为描述来自厂商博客和社区，GitHub 当前 UI 未逐项核对，标"待验证"）。

**启示**：重新审批时默认展示"相对于**我上次批准/查看的版本**"的字段级 diff，而不是相对于上一版；过时的评论/理由要在新版本旁边可见并标 outdated，不能藏起来。

### F6 先给计划再执行（Intent Preview / co-planning），提供"编辑"与"我自己来"

**结论**：
- Magentic-UI 的 co-planning：编排器先在任务不清楚时问一个有针对性的澄清问题，再生成自然语言步骤计划；用户可直接编辑或用文字反馈修改，**必须接受计划后才执行**；计划驱动进度条。co-tasking：用户可随时暂停并接管浏览器，恢复后交还控制权；代理打断用户只用于澄清或在其他代理失败后求助。
- Smashing Magazine（Victor Yocco，2026-02-11）的 Intent Preview：执行前以编号、平实语言列出步骤，三个选项 "Proceed with this Plan / Edit Plan / Handle it Myself"；建议度量接受率、"自己来"比例（>10% 触发模型复查）。
- Anthropic 的代理框架：Claude Code 以实时 to-do 清单展示计划，用户可在任何时刻提问或调整计划、随时停止并改向。

**证据**：
- https://arxiv.org/html/2507.22358v1 （Magentic-UI 技术报告第 3、4 节，2026-10-24）
- https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ （2026-10-24）
- https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents （2026-10-24）

**可信度**：高（Magentic-UI 论文、Anthropic 一手）；Smashing 为中（行业刊物，度量阈值是作者的经验值）。

### F7 按不可逆程度分级确认，而不是一律弹窗

**结论**：
- Magentic-UI 的 action guards 采用开发者设定的三级不可逆启发式：总是不可逆（如上传文件）→ 必须批准；可能不可逆（如点按钮）→ LLM 评判是否需批准；从不不可逆（如滚动）→ 自动执行。审批只有 approve/disapprove 两个选项；站点白名单外的访问需要显式批准。
- AWS Well-Architected Agentic AI Lens（AGENTSEC04-BP02）："把每个代理动作都送人审会产生橡皮图章式批准"；风险分级应以**确定性逻辑**（策略引擎、规则分类器）为权威信号，LLM 分类最多是被确定性层复核的可选输入，因为分类器同样会被不可信内容影响。基线：只读自动、低风险写单人批准、高风险（金融、删除、对外沟通）更严格（单人/多人/带外）。持久信任授权必须限定到具体命令/参数形状/资源，可审计可撤销，禁止通配授权。
- Anthropic 框架：Claude 默认只读，修改前需批准；用户可为每个动作设 always allow / needs approval / block。

**证据**：
- https://arxiv.org/html/2507.22358v1 （第 6.3、6.4 节，2026-10-24）
- https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html （2026-10-24）
- https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents （2026-10-24）

**可信度**：高。

**启示**：本系统里"审批"只有一种：人对提案版本的批准，且永远必需（核心第 2、3 条），不存在"自动批准"档位。分级思想应用在**代理动作**和**通知打扰程度**上：代理的 `propose` / `counter` / `clarify` 无需人确认；向人请求取舍、请求披露私密字段、触发执行属于必须人参与的高风险点。

### F8 审批疲劳与自动化偏差是真实且可测的风险

**结论**：
- Anthropic 报告 Claude Code 用户批准了约 93% 的权限提示，更多的提示让人对每一个的注意力下降；后续 claude.com 博客给出 97% 的批准率，并称受控实验中人工审阅只识别出 13.6% 的危险命令（两个数字口径不一致，未能核对）。
- Magentic-UI 用户研究（n=12）：有人在不确定流程是否正确时仍接受输出（"I'm just gonna trust it"）；参与者多只在"看起来不对"时才检查；计划变更批准紧接着动作批准被认为过度；多人希望在 action guard 出现时有"第三个选项"；缺少清晰状态摘要使恢复任务困难。
- 自动化偏差文献把错误分为遗漏错误（没发现自动化漏掉的问题）与执行错误（照做错误建议），自动化程度和工作负荷显著影响其发生（Goddard et al., 2012，经二手检索确认）。SSRN 工作论文 "Putting a Human in the Loop: Increasing Uptake, but Decreasing Accuracy of Automated Decision-Making"：允许人调整算法建议提高了采纳率，但人的调整降低了最终决策质量，且人对最不准确的建议反而更少干预（摘要页 403，经检索摘要确认，标"待核对原文"）。
- 2024 年临床决策支持研究（n=210）：主观感知收益越高，错误同意率越高。

**证据**：
- https://www.anthropic.com/engineering/how-we-contain-claude （2026-10-24，93% 的出处，经检索摘要）
- https://www.anthropic.com/engineering/claude-code-auto-mode （2026-10-24）
- https://claude.com/blog/auto-mode-default-in-claude-code （2026-10-24，97% 与 13.6%）
- https://arxiv.org/html/2507.22358v1 （第 7.4 节，2026-10-24）
- https://papers.ssrn.com/abstract=4285645 （2026-10-24，403，仅检索摘要）
- https://journals.sagepub.com/doi/10.3233/SHTI240871 （2026-10-24）
- https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1118723/pdf （Kupfer et al. 2023，2026-10-24）

**可信度**：中高（一手来源，但个别数字口径冲突，SSRN 原文未读）。

**启示**：代理的"建议接受"在界面上**不能**成为默认选中或视觉上最突出的按钮；审批前必须让人看到关键事实（金额、范围差异、日期、约束版本、校验结果），并在必要时要求一次轻量的主动确认（例如显示"本版本相比你上次批准：总价 −8,000，移除 2 个范围项"）。

### F9 信任校准：说明数据来源、部分解释、按利害调节解释深度，慎用数值置信度

**结论**：Google PAIR Guidebook（Explainability + Trust）：目标是让用户在系统强的地方依赖、弱的地方复核；说明用了什么数据、是个人数据还是聚合数据；把解释挂在用户动作上；高利害、低频决策给更详细的解释；多数情况给**部分解释**（影响信任与决策的那部分）；置信度若不改变决策或会诱发盲信就不要显示；数值百分比易被误读，分类（高/中/低）需定义阈值和每档对应动作；低置信度时给 N-best 备选，促使用户自己判断。错误发生后要说明恢复路径并提供修正或转人工。

**证据**：https://pair.withgoogle.com/chapter/explainability-trust/ （2026-10-24）；Microsoft HAX 18 条准则按"初始 / 交互中 / 出错时 / 随时间"四阶段组织（G1 "Make clear what the system can do"、G2 "Make clear how well the system can do what it can do"、G3 "Time services based on context" 已确认；其余条目标题未在本次检索中逐条核对）：https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/ 、https://www.microsoft.com/en-us/haxtoolkit/library/ （2026-10-24）。

**可信度**：高。

**启示**：本系统不需要模型置信度百分比——可执行性由确定性校验给出（通过/失败 + reasonCode），这比模型自报置信度更可信。界面上应把"代码校验结果"与"代理理由"并列且视觉区分。

### F10 解释的形式："因为你说了 X，所以我做了 Y"，并可追溯到来源

**结论**：Smashing 的 Explainable Rationale 模式：结果卡片 + "Why I took this action" 列表，结构为 "Because you said X, I did Y"，反模式是原始技术日志或复杂条件逻辑。Anthropic 框架：解释让用户能发现坏数据、弱来源并纠偏；细节过少无法判断进度、过多则淹没用户。AWS：审阅者只看到动作本身而看不到推理链、数据来源和潜在后果时，审阅沦为形式。

**证据**：
- https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ （2026-10-24）
- https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents （2026-10-24）
- https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html （2026-10-24）

**可信度**：中高。

**启示（关键冲突）**：在多方场景，"因为你说了 X"中的 X 可能是**他方的私密简报**。理由文本必须分两层：对本人的理由可以引用本人的私密约束；对他方可见的理由只能引用已披露的共享事实与公共模板（07）。每条理由里的引用应是结构化的 `sourceRef`（共享事实 id / 目录项 id / 本人简报字段），由服务端按查看者过滤。

### F11 多会话/多房间的"需要你处理"指示，与可恢复的状态摘要

**结论**：
- Magentic-UI 支持多会话并行切换，每个会话有状态指示，需要用户输入时显示红点；用户研究指出缺少清晰状态摘要时很难恢复任务（P5、P8）。
- Linear Inbox：snooze 让通知在设定时间回到未读，但**有新活动则立即取消 snooze 并通知**；2026-09 新增 Priority 标签页，把"需要你处理"与"可以等"分开，默认由 Linear 选择、可按来源或过滤器自定义。
- AWS：审批流必须有超时与升级路径，否则审阅者不在时执行无限停滞；超时的安全兜底通常是"阻止操作"。

**证据**：
- https://arxiv.org/html/2507.22358v1 （第 4、7.4 节，2026-10-24）
- https://linear.app/docs/snooze 、https://linear.app/docs/triage （2026-10-24）
- https://linear.app/changelog/2026-09-03-priority-inbox （2026-10-24）
- https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html （2026-10-24）

**可信度**：高（论文 + 官方文档）；Linear Priority 为官方 changelog，细节未逐项核对。

**启示**：角色工作台顶部需要一个"等你处理"队列，条目只来自服务端派生的待办（待你审批的提案版本、发给你的取舍请求、待你决定的披露），每条显示"为什么是你、截止时间、超时后会怎样"。超时默认安全：请求过期 → 不执行，转回协商或标记阻塞，不能默认同意。

### F12 实时他方动作：presence 是临时态，事件是持久态；代理作为一等参与者出现

**结论**：Liveblocks 把 presence 定义为与连接绑定、断开即消失的临时状态，持久内容放 Storage；AvatarStack 去重同一用户多标签页、超出部分折叠为 "+N"；typing 指示在超时或失焦时清除，关闭标签页自动消失；AI 代理可通过 Node SDK 发布 presence，"像人一样出现在 `useOthers` 中"，并用短 TTL 在崩溃或完成时自动消失。常见坑：每个事件都广播、颜色冲突、无插值跳动、"僵尸光标"。

**证据**：
- https://liveblocks.io/docs/use-cases/presence （2026-10-24）
- https://liveblocks.io/blog/new-react-components-for-adding-realtime-presence-and-contextual-commenting-to-your-app （2026-10-24）

**可信度**：中（厂商文档，描述的是其产品能力，但模式本身通用）。

**启示**：本系统不需要光标级 presence（不是协同编辑器）。需要的是两类信号：(a) 持久事件流（谁在何时对哪个版本做了什么，来自 events 表，按查看者过滤）；(b) 轻量临时信号（"provider 的代理正在起草还价"、"finance 正在查看 v3"），后者必须带 TTL / 心跳，run 崩溃后不能永远显示"正在思考"。代理与人的头像要并列显示但用不同标识（例如"代 provider 的代理"），绝不能让代理动作看起来像人的动作。

### F13 失败与恢复：显式错误卡片、已做/未做清单、重试路径；取消与撤销必须与真实能力一致

**结论**：
- Smashing 的 "Empathic Apologies and Clear Remediation"：错误卡片承认错误、列出已执行的纠正动作、给出下一步与人工支持入口；Action Audit & Undo：时间线 + 状态（成功/进行中/已撤销）+ 明确的撤销时限（"Undo available for 15 minutes"），反模式是隐藏动作何时变为不可逆。
- 行业综述指出：取消按钮若只停止视觉显示而后台仍在运行，是误导且不安全的（低可信度，二手）。
- LangChain：部分无效的批量回答会导致已执行动作再被执行一次（F2）。
- Slack 交互消息的惯用法：收到按钮交互后先 `ack()`，再用 `response_url`（`replace_original`）或 `chat.update` 改写原消息，把"批准/拒绝"按钮替换成结果状态——防止重复点击，同时让其他人看到谁做了什么。
- Convex optimistic update 在 mutation 完成后回滚并以服务端结果为准；客户端生成的临时 id 或时间戳在回滚时会闪烁；文档未描述失败时的特殊处理。

**证据**：
- https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ （2026-10-24）
- https://docs.slack.dev/tools/bolt-python/concepts/actions 、https://api.slack.com/interactivity/handling （2026-10-24）
- https://docs.convex.dev/client/react/optimistic-updates （2026-10-24）
- https://geosurge.ai/corpus/gen-3157/front-end-innovation/agentic-interaction-design.html （2026-10-24，低）

**可信度**：中高。

**启示**：审批与执行按钮**不要**用 optimistic update 显示"已批准/已执行"——必须等服务端确认，因为守卫可能失败（版本已过期、约束已变）。按钮点击后立即进入 pending 态并禁用，服务端返回后把按钮区替换成结果（"你于 14:02 批准了 v3（约束版本 c7）"）。对于不可撤销的执行，界面应明说"不可撤销"，不提供假的 Undo；可提供的只是"撤回审批（执行前）"。

### F14 多方签署：已完成的签署不可修改，修改需新一轮

**结论**：DocuSign 的"更正信封"只能用于进行中的信封；社区版主表示收件人完成其部分后不能再对该收件人做更正，需要新建信封（可复制信封与字段数据加速）；更改收件人邮箱会发新链接、旧链接失效；发送方处于 "Correcting" 状态时会阻塞未签署者直到保存或取消。第三方称修改已签文件会使签名作废（与官方社区说法不完全一致）。

**证据**：
- https://community.docusign.com/esignature-111/hi-i-have-a-document-which-was-signed-by-4-people-but-later-found-out-that-one-of-the-signatures-was-wrong-can-i-edit-and-ask-the-person-to-sign-again-although-the-process-was-complete-1702 （2026-10-24，低-中）
- https://documentation.kw.com/html/kellercloud/command/opportunities/documents/docusign/correct-envelope.html （2026-10-24，中，集成方文档）
- https://www.bardeen.ai/answers/what-does-correct-mean-in-docusign （2026-10-24，低）

**可信度**：中低（未取到 DocuSign 官方 "Correct an envelope" 文章，标"待验证"）。

**启示**：与 F3 一致——"修改"不是编辑旧对象，而是追加新版本并让旧签署/审批失效；"正在修改中"是一个对他方可见的阻塞状态（本系统对应：run 进行中或约束变更处理中时，旧版本的审批按钮应禁用并说明原因）。

### F15 AI 建议的视觉区分：建议态与生效态分离，批量接受需谨慎

**结论**：Google Docs 中 Gemini 的改写以待审的建议呈现，官方帮助页描述可一键 "Accept all"/"Reject all"；Suggesting 模式下插入以下划线、删除以删除线显示，由所有者接受或拒绝。一键全部接受方便但会削弱逐项审阅（与 F8 的自动化偏差一致）。

**证据**：
- https://support.google.com/docs/answer/14206696?hl=en （2026-10-24）
- https://thebricks.com/resources/how-to-suggest-edits-in-google-docs （2026-10-24，低）

**可信度**：中（官方页面与二手描述有差异）。

**启示**：代理的提案在界面上始终以"建议态"呈现（明确标注"由 X 的代理提出"、未经任何人批准），只有当全部必需审批到齐并执行成功后，结果才以"已生效"样式出现在执行记录区。不提供"一键批准全部"。

### F16 多人审批的聚合语义必须显式

**结论**：Power Automate 的审批类型区分 "Everyone must approve"（任一拒绝即整体拒绝）与 "First to respond"（第一个回应决定结果），并另有自定义回应的"等全部/等一个"。多人审批的聚合规则是一个需要显式配置并对参与者可见的策略。GitHub 也区分"必需审阅数"与"code owner 必审"。

**证据**：
- https://learn.microsoft.com/en-us/power-automate/all-assigned-must-approve （2026-10-24）
- https://learn.microsoft.com/en-us/learn/modules/approvals-power-automate/2-types （2026-10-24）
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches （2026-10-24）

**可信度**：高。

**启示**：本系统的必需审批是"每个必需角色都批准同一版本"（等价于 Everyone must approve，按角色而非按人）；任一必需角色拒绝 → 该版本终止，进入重新协商或请求取舍。界面需显示审批进度条：哪些角色已批准此版本、哪些未批、哪些的批准因版本变化而失效。

---

## 3. 可直接用于角色工作台的模式与反模式

### 3.1 模式（建议采纳）

| # | 模式 | 来源 | 在本系统中的形态 |
| --- | --- | --- | --- |
| P1 | 类型化待决项 + 服务端声明允许的决策 | LangChain HITL（F1） | `humanRequests` / 待审批项带 `kind` 与 `allowedDecisions`，前端只渲染服务端给出的按钮 |
| P2 | 审批绑定快照，变化即 stale | GitHub、Ironclad（F3、F4） | `approvals` 存 `proposalId` + `proposalHash` + `constraintVersion`；任一变化 → `stale`，显示失效原因 |
| P3 | "自你上次批准以来"的字段级 diff | Bitbucket、GitHub（F5） | 重审时默认对比"我上次批准/查看的版本"，范围项增删、金额、日期逐字段标红绿 |
| P4 | 计划先行 + 编辑 + 我自己来 | Magentic-UI、Smashing（F6） | 代理提案卡片三个出口：批准此版本 / 要求代理修改（给出指令）/ 我直接改条件（改本人约束或手动还价） |
| P5 | 按风险分级打扰，确定性分级 | AWS、Magentic-UI（F7） | 代理内部动作不打扰人；只有审批、取舍、披露三类进入人的队列；分级由代码决定 |
| P6 | "等你处理"队列 + 超时安全兜底 | Magentic-UI、Linear、AWS（F11） | 工作台顶部队列，每项写"为什么是你、截止、超时后果（不执行）" |
| P7 | 双层理由：本人可见 / 他方可见 | Smashing、Anthropic、AWS（F10） | `rationalePrivate`（引用本人简报）与 `rationalePublic`（只引用共享事实与模板），按查看者服务端过滤 |
| P8 | 校验结果与代理意见并列且视觉区分 | PAIR（F9） | "代码校验：通过/失败 + reasonCode"徽章与"代理建议：建议接受"文字分栏，前者权威 |
| P9 | 结果替换按钮 | Slack（F13） | 点击批准后按钮区变 pending，服务端确认后替换为"你于 hh:mm 批准 v3（约束 c7）"，他方实时看到 |
| P10 | 代理作为一等但可区分的参与者 | Liveblocks（F12） | 时间线中代理动作带"代 X 的代理"标签与不同图标；临时"正在起草"信号带 TTL |
| P11 | 显式聚合语义的审批进度 | Power Automate、GitHub（F16） | 进度条：customer ✓ / provider ✓ / finance 待批；失效的批准显示为划掉 + 原因 |
| P12 | 取舍请求给 N 个具体选项 | PAIR N-best、Smashing Escalation（F9、F6） | 向具体的人请求取舍时给 2–3 个由代码验证过可行的选项 + "其他（自由输入）"，每个选项附后果 |

### 3.2 反模式（明确避免）

| # | 反模式 | 证据 | 为什么在本系统更危险 |
| --- | --- | --- | --- |
| A1 | 把代理的"建议接受"渲染成已批准、或把批准按钮设为默认焦点 | F8、F15 | 违背核心第 2 条；自动化偏差 |
| A2 | 用 `respond` 式自由文本回复代替显式拒绝 | F2 | 代理可能把拒绝理解为成功结果 |
| A3 | 允许"永不重置审批"或管理员越权保留旧审批 | F4 | 违背核心第 3 条 |
| A4 | 每一步都要人确认 | F7、F8 | 93%–97% 的批准率说明人会停止阅读 |
| A5 | 只显示动作，不显示依据与后果 | F10（AWS） | 审阅沦为形式 |
| A6 | 审批/执行用 optimistic UI 先显示成功 | F13 | 守卫失败时出现"已批准又消失"，破坏信任且可能引发重复点击 |
| A7 | 假的撤销/取消 | F13 | 执行记录不可撤销，只能追加更正 |
| A8 | "正在思考"永久挂起（僵尸 presence） | F12 | run 崩溃后用户误以为仍在处理 |
| A9 | 把他方的私密约束写进对他方可见的理由 | F10 | 违背核心第 1 条 |
| A10 | 隐藏过时的评论/批准 | F5 | 破坏可追溯性（核心第 6 条） |
| A11 | 一键批准全部 / 批量批准多版本 | F15 | 削弱逐版本审阅 |
| A12 | 用模型自报的置信度百分比代替确定性校验 | F9 | 违背核心第 4 条，且百分比易被误读 |

---

## 4. 对本系统设计的含义（按任务书文件编号）

### 02 领域模型
- 区分三种"人参与"对象，不混用一个 approval 概念：`Approval`（人对某提案版本的批准/拒绝，绑定快照）、`HumanRequest`（系统或代理向具体的人请求取舍/澄清/披露，带选项与截止）、`AgentRecommendation`（代理的建议接受/拒绝，只是提案的附属意见，永远不计入审批）。依据 F1、F2、F8。
- 不变量：`AgentRecommendation` 不能派生 `Approval`；`Approval` 只能由已认证的、持有该必需角色的人创建（F3、F16）。
- `Approval` 的有效性是派生属性：`effective = decision == "approve" && proposalHash == current && constraintVersion == current && !withdrawn`。依据 GitHub 存 diff 快照的做法（F3）。

### 03 schema
- `approvals`：`proposalId`、`proposalContentHash`、`constraintVersion`、`roleKey`、`userId`、`decision: "approve" | "reject"`、`reason?`、`createdAt`、`invalidatedAt?`、`invalidationReason?`（枚举：`proposal_superseded` / `constraint_changed` / `withdrawn` / `run_cancelled`）。失效原因必须是枚举，供界面显示"为什么失效"（F4）。
- `humanRequests`：`kind`（`tradeoff` / `clarification` / `disclosure`）、`targetUserId`/`targetRoleKey`、`options: Array<{ optionId, label, consequenceSummary, validatedBy: reasonCode[] }>`、`allowedDecisions`、`deadlineAt`、`onTimeout`（固定为安全兜底，如 `block` / `return_to_negotiation`）、`status`、`resolvedBy`、`resolution`。依据 F1、F11、AWS 超时要求。
- 每个人的"上次查看/批准的提案版本"需可查询（可从 `approvals` + 一个轻量 `proposalViews` 表得到），用于"自上次以来"的 diff（F5）。
- 理由字段拆分：`rationalePrivate`（仅本人与其代理可读）与 `rationalePublic`；`sourceRefs: Array<{ kind: "sharedFact" | "catalogItem" | "ownBrief" | "rule", id }>`，`ownBrief` 引用不得出现在 `rationalePublic`（F10）。
- 临时活动信号（"代理正在起草"）不要写进不可变事件表；用 run 状态 + `heartbeatAt` 派生，过期即不显示（F12）。

### 04 状态机
- 审批状态：`active` → `invalidated`（守卫：提案被新版本取代、约束版本递增、run 被取消）/ `withdrawn`（守卫：本人、执行前）。不存在 `invalidated` → `active` 的迁移；重新批准是新记录（F3、F14）。
- `HumanRequest`：`open` → `answered` / `expired` / `cancelled`（守卫：底层提案或约束已变，请求不再适用时自动取消并显示原因）。`expired` 的后果必须是安全的（不执行）（F11）。
- 提案层面的"正在修改中"阻塞态（类似 DocuSign Correcting）：当 run 正在产生新版本或约束变更正在处理时，旧版本的批准入口禁用，界面说明"正在生成新版本 / 约束已变化"（F14）。

### 05 协议
- 代理动作集里"建议接受"与"拒绝"是代理意见，不是决定；协议里不应有任何代理动作能直接改变审批状态（F2、F8）。
- 向具体的人请求取舍的消息结构：`{ requestKind, targetRoleKey, question, options[≤3], defaultOption: null, consequences per option, sourceRefs }`。不提供默认选项，避免把代理偏好变成默认（F8、F9 N-best）。选项必须先经确定性校验（reasonCode）才能展示（F7 AWS"确定性分类为权威"）。
- 人的回答类型必须显式：选择某选项 / 自由输入新约束 / 拒绝全部；自由文本不得被解释为同意（F2）。
- 澄清问题的门槛：参照 Magentic-UI "只在需要澄清或其他途径失败后才打断人"，协议应要求代理先用已披露事实与目录尝试，再升级到人（F6）。

### 07 权限与隐私
- 理由与解释是隐私泄露高风险点："因为你说了 X"中的 X 对他方必须经过披露决定（F10）。对他方可见的解释只能由公共模板 + 共享事实生成。
- 实时信号也受披露矩阵约束：他方能看到"finance 正在查看 v3"吗？建议默认只显示角色级活动（"finance 已查看"），不显示停留时长、不显示私密字段编辑活动（F12）。
- 审批记录对房间所有成员可见（谁、何时、哪个版本、决定），但审批理由若引用私密约束则只显示公共部分（F3、F10）。

### 08 审批与执行
- 审批卡片必须展示：版本号、内容哈希短码、约束版本、代码校验结果（全部 reasonCode）、相对"你上次批准版本"的 diff、他方审批进度；缺任一项不应可批（F3、F5、F10、F16）。
- 聚合语义：每个必需角色批准同一 `proposalContentHash` + `constraintVersion`；任一拒绝即该版本终止（F16）。
- 执行按钮/自动执行：不使用 optimistic UI；客户端只显示 pending，服务端事务完成后以结果替换按钮（F13 Slack、Convex）。重复点击由幂等键在服务端吸收，界面上显示同一个结果而非报错。
- 不提供"撤销执行"，只提供执行前"撤回审批"；执行后的修正是追加新的变更（F13、F14）。

### 09 约束变更
- 约束变更导致审批失效时，界面要逐条告诉受影响的人："你对 v3 的批准已失效，原因：finance 将预算从 120k 调整为 100k（约束版本 c7 → c8）"，并给出下一步（等待重新协商 / 回答取舍请求）（F4、F11）。
- 被失效的审批在历史中保留并可见（划掉样式），不能隐藏（F5 反模式 A10）。

### 10 运行时
- run 的"正在进行"信号需要心跳与超时；run 失败时生成可见的失败事件（错误卡片：发生了什么、已做/未做、可否重试、谁可以重试），而不是静默停在"思考中"（F12、F13）。
- 重试按钮只对有权限的角色显示，且重试是新 run（追加），不覆盖旧 run（F13）。
- 若使用 LLM 辅助判断"是否需要打扰人"，只能作为建议，最终由确定性规则决定（F7 AWS）。

### 13 前端
- 角色工作台信息架构建议：顶部"等你处理"队列（P6）→ 当前提案卡片（P2/P3/P8/P11）→ 协商时间线（人与代理动作区分，P10）→ 我的私密简报与约束（仅本人）→ 执行记录（生效态，P9）。
- 建议态与生效态在视觉上必须分开：代理提案用"草案/建议"样式与"由 X 的代理提出"标签；执行记录用"已生效"样式（F15）。
- 失效与过时状态显式化：stale 徽章 + 原因 + "查看与你上次批准版本的差异"链接（F3、F5）。
- 可访问性：状态变化（批准失效、新请求到达）用 `aria-live="polite"` 宣告；不要只靠颜色区分建议/生效/失效（PAIR 与 HAX 的通用要求，此条为推论）。
- 计量（参照 Smashing 指标，作为 15 运维的产品指标）：审批前在卡片上的停留时间、打开 diff 的比例、取舍请求的"其他（自由输入）"比例、因失效而重批的次数——用来发现橡皮图章（F8）。

---

## 5. 未解决的问题

1. **审批前是否需要"主动确认"摩擦**：例如要求审批人勾选"我已看过与上次版本的差异"。能减少自动化偏差，但会增加疲劳；需要原型测试。目前没有找到直接针对多方协商审批的实证。
2. **"自上次以来"的基线选择**：对从未批准过的人，以"上次查看的版本"还是"首个版本"为基线？查看记录是否算隐私（他方能否看到我看过哪一版）？
3. **实时信号的披露粒度**：他方能否看到"customer 正在查看 v3"？这可能泄露谈判态度（犹豫时长）。建议默认不显示查看活动，待 07 决定。
4. **取舍请求的选项生成**：选项由代理提出、代码校验，还是由规则引擎从约束空间枚举？前者更灵活，后者更可信；与 05/06 联动决定。
5. **超时策略**：取舍请求超时后是 `block` 还是 `return_to_negotiation`？是否允许房间级配置？AWS 只给出"默认阻止"的通用建议。
6. **数据冲突待核对**：Claude Code 批准率 93%（anthropic.com/engineering）与 97%（claude.com 博客）口径不同；SSRN 论文原文未能访问（403）；HAX 18 条准则的完整标题本次只核对了前 3 条；DocuSign 官方"更正信封"文章未取到；GitHub "changes since last review" 的当前网页行为未逐项核对。
7. **代理理由的长度与层级**：Anthropic 框架承认"细节过少无法判断、过多会淹没"，尚无定论；建议默认一行摘要 + 可展开的结构化依据（sourceRefs），需要可用性测试。
8. **移动端与通知**：审批是否允许在通知里直接完成（如 Slack 式按钮）？本系统要求看到 diff 与校验结果后才可批，建议通知只深链到工作台，不在通知中提供批准按钮——待 13/17 决定。
