# UI 原型 UX 评审汇总（4 个原型，2026-10-24）

## 决策收件箱优先（decisions）— 总分 47.5/60
入口：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/decision-inbox/index.html
走查：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/decision-inbox/WALKTHROUGH.md
分数：{"clarity": 8.5, "role_privacy": 7.5, "decision_support": 8, "twist_moment": 8.5, "traceability": 7, "feasibility": 8}
总评：这是四个候选里交互骨架最接近最终产品的一个，适合作为前端信息架构的主干：先用收件箱回答'现在该我做什么'，再进入决策页，房间页只作为次级入口。'代理建议 ≠ 人的批准'、审批绑定 (版本, 约束版本)、旧审批 No longer applies 但保留、按角色投影的视图模型，这几条核心都在界面和代码层面落实了，预算下调时刻也清楚可信。主要短板有三处。一是隐私：多次 Fits / Over 结果构成推断通道，可推出余额区间；代理预勾了共享项；紫色同时表示私密、代理和进行中。二是取舍页：没有逐项校验，也没有'两个都不要'的出口。三是可追溯性：事件之间没有链接，也缺少因果链视图。最终设计应吸收它的收件箱、决策页模板和角色化校验文案，同时补上影响预览、最后一票提示、撤回审批、Results 页的'为什么'视图，以及服务端的按受众事件模型。

### 最终设计应吸收
- 收件箱四分区作为每个角色登录后的默认首页：Needs you / Agents working / Waiting on others / Done & no longer needed。待办卡包含类型色条、带版本号的 CTA（'Review v3'）和一句 'blocks' 说明；Waiting 区只写'谁在做什么'，不写内容。
- 决策页统一模板：一句问题标题 + 'these exact terms under constraints vN' + 与上一版的差异 + 带 reasonCode 的确定性校验 + 紫色虚线 agent-box（advisory，'never counted as one'）+ 蓝色实线 human-box。协商细节折叠到 'Learn more'。
- 审批按钮文案写死版本绑定：'Approve v3 under constraints v3'。approvalsCard 中 agent 建议列与人的状态列分开；代理建议也绑定约束版本，约束一变就消失。
- 按角色改写的校验文案：'Over Finance’s budget cap'、'Misses a participant’s private date requirement'，并附注 'The date itself is private'。由服务端 per-viewer query 生成，不下发原值。
- Confirm brief 页：每条抽取结果附原文片段，提供 Keep / Discard 和逐条 'Share with room'，右侧实时预览 'What others will see'；金额类硬约束未确认时禁止确认。最终版应改成默认 private、没有'未审阅即自动保留'。
- 约束变化后的呈现组合：按角色裁剪的阻断横幅；Done 区写 'You approved v2 under constraints v1 · No longer applies' 和 'Approval request withdrawn'；v2 行保留在版本表里并标 Blocked + budget.over_cap；run 步骤实时推进。
- 取舍页布局：两张并排选项卡；只有目标人能看到与其私密简报相关的影响说明；代理写成 'leans toward…, cannot choose for you'；旁栏写 'What others see / What happens next'；选择本身若改变私密约束，就记成新的约束版本。最终版补上逐项校验列表，以及'都不要 / 转给 finance 或 provider'的出口。
- Run 卡片：步骤列表里包含 'failed schema validation (attempt 1 of 3) — retried automatically' 这样的 warn 步骤；失败时显示 'No partial result was saved. Proposals, approvals and constraints are unchanged.' 和 Retry 按钮。
- Results 页：未执行时列出 'What’s in the way'；执行后展示带 operation id 的变更单、执行时的预算快照（仅 finance）、只有被指派人能勾选的任务、包含失效审批的审批记录；变更单卡片写明 'Internal record only. No payment, transfer or e-signature'。
- provider 的 offers 表用 'Disclosed (used)' 标出哪些报价因被提案或取舍请求引用而对他方可见。
- 时间线把同一事件拆成私密版（finance 看到金额）和公共版（只有结果），给私密事件标 'Private to you'，给种子事件标 'Seeded fixture'，并支持按 Decisions / Constraints / Agent runs 过滤。最终版再给每条事件加上指向对象的链接，并在 Results 上提供一条'为什么是这个结果'的因果链视图。
- （来自问题的反向建议）改上限前做影响预览：例如 'Applying $4,800 will block v2 and void 2 approvals (Dana, Raj)'，二次确认后再递增约束版本。最后一票时按状态提示 'Your approval completes the set — this executes now'。

### 问题
- role_privacy：推断泄露。所有带价格的版本对 provider 和 customer 都显示 Fits / Over cap：v2 $900 先 Fits、下调后 Over，取舍页又说 $650 和 $800 两个选项 'fit'（nowCard：'Two confirmed options fit the new budget'）。provider 由此推出剩余额度在 $800 到 $900 之间不含 $900；它又知道 PO-3381 是自己的 $4,000 retainer，于是能把上限锁定在 [$4,800, $4,900) 区间。WALKTHROUGH 没有讨论这个推断通道，Confirm brief 页也没有让 finance 明确同意披露'通过 / 不通过'结果。
- role_privacy：data.js 的 finance 抽取结果中，nocap 和 signoff 两条默认 shared: true，'Share with room' 复选框已经被代理预先勾上。同时 confirmFinanceBrief 会把仍是 'Needs review' 的条目自动变成 confirmed（'Items still marked “Needs review” are kept as shown'）。披露和确认应当默认 private、逐条或明确批量操作，不应由代理预设。
- role_privacy / clarity：styles.css 的 --busy 紫色同时用于 agent-box / agent-chip、.priv（'Finance only'、'Private to you'、'Private until used'）、私密简报条目的 'Private' 徽章和 'In progress' 徽章。WALKTHROUGH 宣称的'紫色 = 代理建议'约定被稀释，用户可能把'私密'误读成'代理'。
- role_privacy（演示卫生）：原型条的 'Finance lowers cap to $4,800' 按钮和 guide 文案 'lower the cap to $4,800' 在 Viewing as Provider / Customer 时同样可见。演示 provider 视角时屏幕上直接出现预算数字，削弱隐私叙事。另外 OF-4 的 label 'Phase 1 — all modules, off-peak slot' 会出现在 v3 的 Approve 页和版本表里，与 provider 私密备注 'Off-peak team slot opens Nov 21' 措辞相同。
- role_privacy：选 OF-4 后，时间线上 'A participant updated a private constraint' 紧挨着 'Customer chose: all modules, one week later'。匿名化等于没做，反而显得像遮掩，应如实说明这是 customer 签字产生的约束版本。
- decision_support（取舍页）：选项卡上没有逐项的代码校验列表，只有 'fits the budget'。页面副标题说 'two confirmed options that pass the checks'，但在约束 v2 下 OF-4 的交付日期 Nov 27 晚于 Nov 20，date 校验其实不通过，要靠 customer 签字才成立，文案不准确。finance 的只读视图也没有给出每个选项的预算影响（OF-4 会用掉 100% 余量）。
- decision_support（取舍页）：customer 只能二选一，没有'两个都不要 / 请 finance 恢复上限 / 请 provider 给更便宜报价'的出口，也没有回答期限。03 输入 RA-R13 已采纳'三种取舍对应三种角色权限'，原型只覆盖了 customer 一种。
- decision_support（Approve 页）：最后一位审批人点击后会立即原子执行，但界面不按状态提示'你是最后一票，点击即写入变更单、承诺、任务'，只有一句通用的 'When the last required person approves…'。没有撤回审批的 UI，而 03 RA-R16 已决定执行前可以追加 withdraw。Reject 只弹一条 toast，审批也没有展示 contentHash 绑定。
- decision_support / twist_moment（Budget 页）：'Apply new cap' 提交前没有影响预览，比如'v2 将被阻断，Dana 和 Raj 的 2 个审批将失效'，只有通用说明。输入框接受 ≥ $4,000 的任意值，但 run 2 的 OF-3 / OF-4 选项和 'fits the budget' 文案是写死的：输入 $4,700 时 OF-4 实际超限，customer 选它后 v3 处于 Blocked、stage 停在 approval_v3，形成死路；输入 $4,600 时两个选项都不可行，界面仍然要求二选一。
- clarity：run 失败时，三个角色的 Needs you 都会出现 'An agent run failed'（kind: retry），责任分散，三人都可能去点 Retry 或都等别人。应该指定一个负责人（如房间创建者），或先自动退避重试再升级。finance 发起改上限的入口只在 Room > Budget 标签里，收件箱里没有入口。
- traceability：事件不链接到对象（提案、审批、取舍请求、约束版本）。Results 的变更单只写 'Based on proposal v3 · constraints v3'，没有给出因果链：cap 下调 → v2 blocked → 2 个审批失效 → hr_1 中 customer 的选择 → v3 → 3 个审批 → 执行。非 finance 角色看不到约束历史，取舍答案也不出现在 Results 上，回答'为什么是这个结果'要自己在时间线里拼。
- traceability：Proposals 表在执行后把原本 Blocked 的 v1 显示为 'Superseded'（store.js 的 proposalStatus 在 execution 后统一返回 superseded），丢掉了 v1 当初被阻断的原因。代理消息 transcript 按 run 编号而不是提案版本分组。
- feasibility：私密版和公共版事件靠 vis + hideFor 双写，实现上应改成按受众分行的事件表，或在服务端按模板渲染。#/decide/approve、#/decide/tradeoff 没有 room id 和 request id，真实路由需要 /rooms/[roomId]/requests/[requestId]。跨房间的收件箱需要派生的 per-user 待办表或索引，不能每次全表扫描。另外，run 每一步写一次库来驱动实时进度，需要控制写入频率。

### 优点
- Inbox（views-inbox.js）分成 Needs you / Agents working / Waiting on others / Done & no longer needed 四个区。每张待办卡有类型色条（Approve / Choose / Confirm / Needs attention）、带版本号的 CTA（Review v3），还有一句阻塞说明（例如 'Execution waits for all three approvals.'）。三个角色打开页面就知道轮到谁、自己在等谁。
- 决策页模板统一（views-decide.js）。顶部只问一个问题（'Approve proposal v3?'），副标题写 'these exact terms under constraints vN'。下面依次是条款、'What changed from v2' 差异、4 项带 reasonCode 的代码校验、紫色虚线 agent-box（写明 'It is not your approval and is never counted as one'）和蓝色实线 human-box。协商细节折叠在 'Learn more'。
- approvalsCard 每一行把 'Agent: accept' 芯片和人的徽章（Approved / Pending / No longer applies / Withdrawn）分成两列展示，永不合并。代理建议绑定约束版本（recs.cv === st.cv），约束一变就变成 'No current rec.'。
- 按角色投影做得到位。project.js 的 SFMProject(state, role) 只返回该角色可见的视图模型：budget、totalAfter 和 execution.budget 对非 finance 一律为 null；校验文案按角色改写，例如 'Over Finance’s budget cap'、'Misses a participant’s private date requirement'，并附 'The date itself is private to that participant.'。代码层面 provider 拿不到 cap 和 committed 数字。
- 审批绑定 (v, cv)，失效状态在读取时派生（approvalState: d.cv === st.cv），旧审批不删。Done 区显示 'You approved v2 under constraints v1 · No longer applies'，未批准的 finance 看到 'Approval request for v2 withdrawn'。'不可篡改历史'和'约束变化使旧审批失效'在界面上都有对应。
- 预算下调时刻：constraintBanner 按角色给出不同文案（finance 看到 $4,800 和 $4,900，他方只看到 'Amounts stay private to Finance'），v2 变为 Blocked 并显示 budget.over_cap，run_2.1 的步骤实时推进，时间线同时写入私密版和公共版事件。勾选 'Next agent run fails' 可以演示超时 3 次、'No partial result was saved' 和任何人都能 Retry。
- Confirm brief 页每条抽取结果都附原文片段（'From your text: …'），右侧实时预览 'What others will see'。cap 和 committed 未确认时不能确认简报，落实了'金额只来自人确认过的信息'。
- 取舍页只给目标人（customer）显示与其私密简报相关的影响说明，例如 audit log 赶不上 SOC 2、晚 7 天需要本人签字。代理只给倾向（'It cannot choose for you'）。旁栏写明 'What others see'。选'晚一周'会把签字记成一个新的约束版本（v2→v3），他方只看到 'A participant updated a private constraint'。
- Results 页在未执行时列出 'What’s in the way'。执行后显示带 operation id 的变更单、执行时的预算快照（仅 finance）、只有被指派人能勾选的任务、包含失效审批的完整审批记录，以及 'Repeat execution request' 的幂等演示。provider 的 offers 表用 'Disclosed (used)' 标出哪些报价已经因被引用而披露。

## 三栏工作台（workbench）— 总分 46/60
入口：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/three-pane-workbench/index.html
走查：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/three-pane-workbench/WALKTHROUGH.md
分数：{"clarity": 8, "role_privacy": 7, "decision_support": 7, "twist_moment": 9, "traceability": 7, "feasibility": 8}
总评：三栏工作台是目前最接近可直接落地的方案：左栏放「我知道的」，中栏放「我们要决定的」，右栏放「刚刚发生了什么」，信息架构清楚。横幅、按版本绑定的审批按钮、advisory 和 binding 的分区，再加上预算下调的后果预览、阻断、失效、重谈链条，都很好地表达了任务书核心。主要扣分在隐私的边角分支和可信度：HR-2 把 Finance 的上限金额 $4,750 展示给了另外两方；HR-1 在报价被提案引用前就公开了价格；作答后凭空生成三个代理的「建议接受」；时间线把代理和代码的行为记在人的角色名下。溯源链也是写死的，执行时没有快照检查结果。建议以这套布局和交互为最终设计的骨架，同时修掉上述泄漏和伪造点，把 actor 拆成 human、agent、system，把溯源改成由事件派生。

### 最终设计应吸收
- 房间头部的版本徽章：'Proposal vN'、'Constraints vM'、'Viewing as X'。横幅采用「状态一句话 + why + Needs you 列表（带直达 CTA）+ 无待办时写 Waiting on」的结构，作为每个房间页的固定顶部。
- 审批按钮文案绑定版本（'Approve v2 · constraints v1'）。所有禁用按钮旁边都写明原因（.reason）。拒绝必须填写理由（模板加补充说明）。
- 方案卡内 advisory（虚线框）与 binding 两块并列。约束变化后，旧审批和旧建议都保留，加删除线和 'No longer applies · approved under constraints v1'。
- 约束变更确认前的后果预览弹窗：会阻断哪个版本、多少审批将不再算数、是否自动重新协商。正式版做成服务端 query previewConstraintChange，返回按查看者裁剪的结果。
- 被阻断方案卡顶部的 'What changed' 差异框：Finance 看到具体金额，其他人只看到「某方更新了一项约束」。
- 检查行格式：label、按角色裁剪的 detail、mono 字体的 reasonCode，以及 'Detail only you see' 标签。对他方的说法是 'Meets a private Customer delivery limit'。
- Agent turns 面板：queued/running/retrying/done/failed/skipped 图标，'attempt n of 3'，每次被校验器拒绝的尝试单独成行（source.unsourced）。整轮 run 的状态有 'Discarded (stale)'，失败卡标注 'No changes made' 并提供 Retry。这部分非常适合 Convex 实时订阅 runTurns 表。
- 左栏私密区视觉（米黄底、斜纹、锁）加 'What others can see from you' 披露面板。他方简报只显示版本号和确认时间。
- 取舍请求卡：每个选项附代码校验结果，写明 'Agents did not pick: this is a human choice'，给自己的代理留私密备注，非目标角色只读并显示 'Only Customer can answer'。正式版还要补上与本人简报条目的对照和与被阻断方案的差异。
- Results 页的 Decision record（包含已失效的审批与拒绝）、Finance 专属的执行时台账快照、只有被指派人能操作的任务、operation id 展示。溯源链改为由事件派生，每步可点击跳转。
- 简报页的抽取草稿：带来源片段、逐条 Accept / Discard，未处理的草稿明确排除。
- 完整时间线页的筛选（Decisions / Constraints & briefs / Agent runs / Private to me），私密事件带徽章，新事件高亮。事件文本按受众分行存储，不要像原型这样把私密变体放在房间可见事件里。

### 问题
- 【隐私泄漏 · 取舍请求卡 HR-2 分支】runs.js finishRenegotiation 在没有可行方案时生成给 Finance 的请求，选项标题是 'Raise cap to $4,750'。但 ui-center.js centerCol 对所有角色都渲染 requestCard(rq)，Customer 和 Provider 能看到这个上限金额。结合已公开的 Q-3 价格 $750，还能反推 committed = $4,000。非目标角色看到的选项必须裁剪（例如只显示 'Change a budget constraint'）。
- 【隐私与披露规则自相矛盾 · HR-1 选项卡与 Provider 报价面板】HR-1 的 option.summary 向三方显示 Q-3 $750、Q-4 $800，但此时没有任何提案引用这两个报价。Provider 左栏 quotesPanel 仍把它们标为 'Price private'，disclosedPanel 写的是 'Prices of quotes cited by a proposal' 才公开。正式版要么把「进入取舍选项」定义为一种显式披露（并在 Provider 侧提示），要么对非目标角色隐藏价格。
- 【推断泄漏未被承认】Provider 看到 v2（$900）显示 'Over Finance’s limit'，Q-4（$800）显示 'Within'，可以推出剩余额度在 [$800, $900) 之间。WALKTHROUGH 和界面都没有讨论「可行性信号本身就是披露」这件事。正式版的 07 披露矩阵需要写明这类派生信息的政策。
- 【伪造代理建议 · 方案卡 Agent recommendations】actions.js answerRequest 在 Customer 作答后直接调用 recommendAll()，为三个代理都写入 'recommends accepting v3'，但没有任何 run 或 turn 产生这些建议。这违反核心 8「不伪造」，也让 advisory 区失去可信度。正式版应当要么真的跑一轮确认 run，要么显示 'no recommendation'。
- 【代理与人混淆 · 时间线 actor】addProposal 的事件 actor 固定是 'provider'，timelineItems 显示为 'Proposal · Provider'（人的角色名），而提案其实来自 Provider agent，v3 甚至是代码按 HR-1 答案生成的。方案卡的 origin 也写成 'Provider agent, from customer decision HR-1'。actor 应区分 human、agent、system，这直接关系到核心 2。
- 【文案硬编码与事实不符 · requestCard】'Both options come from confirmed quotes and pass code checks…' 对 HR-2（选项是 Raise cap / Pause，都不是报价）同样显示，是错误陈述。拒绝路径产生的 HR-1，问题文本 'The budget limit now fits only a smaller first phase' 也与事实不符（预算没有变）。
- 【溯源是写死的 · Results 'How this result came to be'】ui-pages.js resultsPage 的步骤是静态字符串（例如 'run #1 produced v1 (blocked) and v2'），不是从事件派生的。走拒绝路径或上调预算路径时内容会错，而且各步不能点回对应的事件、审批或检查。execute() 也没有快照执行时的检查结果和 reasonCode，无法事后回答「当时凭什么通过」。
- 【事件缺失 · 约束变更取消请求】setCap() 把进行中的 humanRequest 置为 cancelled，但不写事件，时间线上看不到 'HR-1 cancelled because constraints changed'，是溯源断点。
- 【阻断时的提示不完整】v2 被阻断后，Customer 和 Provider 的 'Needs you' 里没有「你对 v2 的批准已因约束变更失效」这条（只有 v2 仍可行时才出现 stale 待办）。HR 打开后横幅改成 'Waiting on Customer'，阻断的来龙去脉只剩方案卡里能看到，第二次进入的用户容易困惑。
- 【方案卡内容矛盾与过载】被阻断的 v2 仍显示 'On final approval, the system creates…' 记录预览（条件里包含 stt === 'blocked'），与 Blocked 状态矛盾。中栏一张卡要装条款、金额、检查、建议、审批、记录预览、按钮，在 1280px 宽度下 split2 每列约 290px，信息密度过高。
- 【取舍证据不足 · HR-1】选项只有摘要、tradeoff 和检查结果，没有把选项和 Customer 自己的私密简报条目对照起来（例如 A 牺牲 c4 'Role-based permissions strongly wanted'，B 错过 c3 目标 Nov 20），也没有和被阻断的 v2 做差异对比。'All 3 modules' 与全量请求的 4 个模块容易混淆（analytics 仍被延后）。
- 【布局】≤1180px 时右栏（Agent turns 与时间线）掉到中栏下方，预算下调时最该看到的 run 实时进展会被推到首屏以外。原型抽屉在 >900px 时默认展开并固定在右下角，宽 330px，会遮住右栏底部的时间线。
- 【小的文案问题】Budget 面板按钮和弹窗都叫 'Lower budget cap'，但 setCap 也允许上调，应改为 'Change budget cap'。Provider 自己的报价旁边写 'Price private'，同时又显示着价格，应改为 'Not visible to others'。

### 优点
- 顶部横幅把状态、原因和待办放在一起：左边是一句话状态加 why（例如 'Awaiting human approval of v2 under constraints v1'），右边是 'Needs you' 列表，每条带直达按钮（Review brief / Answer / Review v2 / Retry run）。没有待办时写明 'Waiting on: Customer (decision HR-1)'。三种角色进入工作台后一眼就知道轮到谁、自己该做什么（ui-common.js banner/bannerState，engine.js todosFor/waitingOn）。
- 审批按钮文案绑定具体版本：'Approve v2 · constraints v1'。按钮禁用时旁边的 .reason 写明原因（blocked、协商进行中、等待决定、已批准等待他人）。核心 3「人批准具体版本」直接落在按钮上（ui-center.js proposalCard）。
- 方案卡把 'Agent recommendations · advisory'（虚线框）和 'Human approvals · binding' 分成两块。三个代理都建议接受后，人工审批仍显示 Pending。约束变化后，代理建议和旧审批都打删除线并标注 'approved under constraints v1'，而不是删掉，核心 2 和核心 6 表达得很清楚。
- 预算下调做得最好：Finance 的 'Lower budget cap…' 弹窗在确认前实时预览后果（v2 会被阻断、N 个审批将不再算数、会自动开始重新协商）。确认后横幅变红；方案卡顶部出现按角色裁剪的 'What changed' 差异框（Finance 看到 $5,000 → $4,800，他人只看到 'Finance updated a budget constraint'）。run #2 自动开始，Provider agent 的 $700 被 source.unsourced 拒绝并重试 2/3，最后 Customer agent 用 ask_human 把选择交给人，整条链可信。
- 检查项的呈现可以直接用于正式版：每条检查都有 label、按角色裁剪的 detail、reasonCode（mono 字体），以及 'Detail only you see' 标签。他方看到的是 'Meets a private Customer delivery limit'、'Within Finance’s budget limit'。主路径里 Provider 在任何位置都看不到 cap 或 committed 的数字（engine.js checks/checksFor，ui-center.js moneyBlock）。
- 左栏私密区的视觉语言一致：米黄底加斜纹加锁，每条标 Private / Shared with room。底部 'What others can see from you' 把披露边界摊开给用户看。他方简报只显示版本号和确认时间。这些都符合 Role A 裁决 RA-U08/U09。
- 失败和过期都有明确状态：重试计数 'attempt n of 3'，每次失败尝试保留为 retryline。'Run #2 failed' 卡写明 'No changes made' 并提供 Retry run。约束变更时进行中的 run 标为 'Discarded (stale)'，play() 遇到 cv 不一致时拒绝写入。
- Results 页有 Finance 专属的执行时台账快照、只有被指派人能勾选的任务、operation id，以及包含失效审批的 Decision record。抽屉里的重复提交只记一行 'duplicate ignored'，幂等性看得见。
- 简报页的抽取草稿带来源片段，必须逐条 Accept / Discard，未处理的草稿明确提示会被排除，符合核心 4 与 RA-U10。
- 代码分层（data → engine 派生与投影 → actions → runs → ui-*）与 Convex 的 query/mutation/action+scheduler 几乎一一对应。checksFor、eventsFor、msgFor 就是正式版每个查看者的读模型。

## 时间线叙事优先（timeline）— 总分 45.5/60
入口：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/timeline-narrative/index.html
走查：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/timeline-narrative/WALKTHROUGH.md
分数：{"clarity": 8, "role_privacy": 6, "decision_support": 7, "twist_moment": 8.5, "traceability": 9, "feasibility": 7}
总评：“时间线叙事优先”在可追溯性和预算下调这一刻上是目前最扎实的方案。因果链接、Trace 高亮、版本绑定审批、失效但保留的审批记录，加上“约束变更 → 阻断 → 失效 → 自动重谈 → 取舍”这条节点序列，几乎可以原样用作最终设计的骨架。它最大的硬伤在角色隐私：把整个房间当作单一受众，让 provider 看到预算余量的具体数字（$1,000 → $800、over by $100），取舍措辞也泄露了 customer 的私密截止日，这与 RO-04、RA-T03 和“provider 看不到预算数字”的评审标准冲突。决策支持也有几处需要修：代理建议被写成人的批准的因果前驱，Reject 的理由是编造的，审批卡缺少校验清单和版本差异，取舍一键生效且没有出口。最终设计建议吸收它的三栏布局、行动者视觉语法、因果追溯和预算下调序列；同时把披露改成按受众裁剪，给约束变更加上影响预览和原因，并把所有待办行动统一放到右侧栏。用 Next.js + Convex 实现的难度中等：events 表带 causes 和 visibility 字段、runSteps 用实时订阅、投影放在 query 里都很自然，但 payload 快照、causes 的服务端过滤、长时间线的分页追溯需要额外设计。

### 最终设计应吸收
- 房间页用三栏：左侧章节导轨（Story so far，加图例），中间只追加的叙事时间线，右侧 sticky 摘要栏（Your next step → Current proposal → 角色专属控件）。窄屏时摘要栏移到最上方（order:-1）。
- 行动者视觉语法：人是实心圆，代理是虚线圈加虚线卡片并标 Advisory，规则引擎是方块，系统是菱形。代理建议既是独立节点，也是右栏独立区块，文案固定为“does not count as anyone's approval”。
- 每个事件节点都有“Because of / Led to”链接和“Trace why this happened”按钮，点击后祖先高亮、其余变暗，并出现 Tracing 横幅。这张因果图同时用于“Why is it blocked?”和 Records 的“How CO-xxxx came about”。但代理建议应改为非因果的“Seen at decision time”链接。
- 版本绑定的审批 UI：按钮写“Approve vN”，附说明“applies only to vN under constraints vM”。失效审批显示“No longer applies · Approved under constraints v1; constraints are now v2”并保留在 Approval record 里，用 Used for execution / No longer applies / Replaced 三种标签区分。
- 预算下调的四节点序列：Constraint change（琥珀）→ Proposal blocked（红框，默认展开，写“Nothing was deleted”）→ N approvals no longer apply → 自动重新协商，写明 Triggered by。右栏同步变红，禁用按钮旁写原因，头部常驻“Proposal vN · Constraints vM”双版本号。下调前应补一个影响预览对话框和原因字段。
- 代理回合作为活节点：有状态 pill 和“attempt x of 3”，步骤逐条出现；失败尝试写“discarded, nothing shown to others”，只给责任方一条“Only you”细节；失败三次后出现 run_failed 节点，任何参与方都可以 Retry。
- 集中的服务端投影函数（describe / checkLine 的模式）：同一事件按查看者渲染不同文本。finance 看完整算式，customer 看“your deadline”，其他人看“a participant's private deadline (value not shared)”。最终版需要在此基础上改成按受众（同组织 / 对方）披露，provider 只看到结论。
- 取舍卡：每个选项按角色列出利弊，并写出对本人私密约束的后果（“Choosing this updates your private deadline to Nov 27 (new constraints version)”）。非目标角色只读，看到“Only Avery can answer”。最终版加上确认步骤和“Neither / request other options”出口，并把卡片同时放进右栏。
- 每轮生成一个只对本人可见的“Your agent's context for round #n”节点，分 Included 和 Never included 两列。简报页加上“What the room can see from you”和“What your agent receives”。
- finance 预算卡里的“Room sees: $X available”这一行，让披露方实时看到自己的披露结果。最终版可以按受众分行，例如“Customer sees … / Provider sees pass/fail only”。
- 右栏的“What happens when all three approve”预览（变更单、承诺金额、任务数，one transaction, internal records only），以及 Records 里 finance 专属的执行时预算快照（Before / This / After / Cap at execution / Remaining）。
- 时间线筛选 chips（Everything / Human decisions / Agent activity / Rules & constraints / Private to me），加上 Expand all / Collapse all。阻断、失败、执行、待回答的取舍这几类节点默认展开。

### 问题
- 【隐私，最严重】provider 能看到预算余量的具体数字。constraint_change 节点的 sub 写着“Available for this change: $1,000 → $800”；blocked 节点和 checkLine 写“Over budget: $900 > $800 available…, over by $100”；run#2 的步骤写“two confirmed quotes fit $800: Q-CORE and Q-P1X”；取舍卡写“$800 of $800 available”；tradeoff 的 sub 写“within $800”。原型把整个 room 当作单一受众，但 customer 和 finance 同属 Larkspur，provider 是外部卖方。按 inputs/01 RO-04，剩余预算是 finance 的私密输入；RA-T03 点名的泄露位置正是 blocked / no_feasible / constraints_changed 这几类事件。应改为按受众披露：customer 可以看余量，provider 只看到“exceeds the buyer's budget constraint”这类结论。
- 【隐私】取舍措辞让人能推断出 customer 的私密截止日。provider 和 finance 看到的选项标题是“All modules, one week late”，交付日 Nov 27，同时还有“− Misses a participant's private deadline unless they change it”；tradeoff 节点对他方的 sub 写“involves Avery's own priorities and private deadline”。三者合起来几乎就是“截止日 = Nov 20”。v1 / v2 校验对 provider 的 pass/fail 结果也能夹出这个区间。原型没有让 Avery 做显式披露这一步。
- 【不伪造 / 决策】点 Reject 不收集任何理由，但 describe() 为 decision 事件硬编码了 'Recorded with reason: "Needs changes before I can commit."'，等于替人编造了理由。Reject 之后提案仍是 Ready，不触发重新协商，流程走到死路。
- 【代理建议与人的批准】decide() 把 rec_v（代理建议节点）写进人的 decision 事件的 causes。结果每条人的批准都显示“Because of: Agents recommend accepting v3”，Records 的 How CO-0042 came about 链条里建议也排在批准之前，暗示批准是由建议导致的。应改成一种单独的“Seen at decision time”上下文链接，不要当因果边。
- 【决策证据】右栏 Current proposal 在 Ready 状态只有一个状态 pill 和条款表，四项校验清单要回时间线里找；也没有和上一版本的差异对比。例如 v3（Q-CORE）对比 v2：Receipt emails 推迟、少 $200，或者晚一周，审批人得自己比。
- 【清晰度】行动入口分散。Approve 只在右栏，取舍回答只在时间线节点里，Retry 两处都有，Confirm brief 在右栏和简报页。在 awaiting_tradeoff 阶段，右栏 Current proposal 仍显示被阻断的 v2，并写着过时的“A new version is being negotiated”，而当下真正要做的取舍卡不在右栏。
- 【决策】取舍卡上的“Choose this option”点一次就立即执行：可能把 customer 的硬约束从 cv2 改到 cv3，并马上开始起草 v3。没有确认步骤，没有撤销窗口，也没有“Neither / ask finance to revisit / request other options”这样的出口。
- 【预算下调的可信度 / 可追溯】Budget controls 里的“Lower cap to $4,800”是硬编码金额的一键按钮，样式和真实产品控件一样。它没有金额输入，没有原因字段，也没有影响预览（例如“v2 will be blocked: $4,900 > $4,800; 2 approvals will stop counting”）。constraint_change 的 causes 只有 finance 的简报，所以“为什么砍预算”这个问题无从回答。
- 【与已有决定冲突】Prototype controls 的“Send duplicate execute request”会写一条房间可见事件“Duplicate execution request ignored”。这与 RA-R09 / RA-B25 冲突：那里定的是幂等返回同一结果、计数只进运维日志、不刷房间事件，否则任何成员都能刷屏。
- 【实时协作】没有“since you last looked”标记或通知。customer 和 provider 的 v2 审批失效后，只有头部 pill 和右栏状态变了，时间线没有“New since your approval”分隔线，也没有收件箱提示。真实多用户环境里，审批被作废的人很可能不知道。
- 【小问题】agent 回合进行中 Approve 被禁用，aside 里算出了 dis='Agents are working' 却没有显示出来，与 WALKTHROUGH 说的“禁用时旁边写原因”不符。Records 的“Show this chain in the timeline”先改 hash 再 setTimeout(trace)，随后的 hashchange 处理会 scrollTo(0,0) 并重新渲染，很可能丢掉滚动定位。每个 agent 步骤都整页 innerHTML 重渲染，键盘焦点会丢失。Reset 里 keepSpeed = S.speed || 1 把 Instant（0）当成假值，重置后速度变回 Normal。
- 【可追溯粒度】run 内部的步骤（预检找到 Q-CORE / Q-P1X、各次失败尝试）只是字符串，不是事件，trace 追到“Agent round #2”就停了，无法从结构上回答“为什么只有这两个选项”。
- 【实现可行性】全部私密数据都在浏览器 JS 里（文档已承认）。describe() 依赖实时全局状态（S.tradeoff、S.exec、S.cv、SFM.BUDGET 常量），而不是事件 payload 快照，迁到 Convex 时需要改成写入时存结构化快照。causes 数组和祖先计数（Tracing 横幅里的“N linked events”）必须在服务端过滤，否则会泄露他人私密事件的存在。

### 优点
- 布局是叙事加固定摘要：中间是只追加的时间线，回答“怎么走到这里”；右侧 sticky 栏依次是 Your next step、Current proposal、Budget controls（仅 finance），回答“现在是什么、我该做什么”。三个角色在每个阶段都有一句针对自己的下一步，Rooms 页还有“● Your approval is needed / A decision is requested from you”提醒。
- 行动者有统一的视觉语法：人是实心蓝点，标“Human decision”；代理是紫色虚线圈加虚线卡片，标“Advisory”；Rules engine 是绿方块，System 是灰菱形。左栏有图例。代理建议在时间线里是独立节点，在右栏是独立的 .advice 区块，文案写明“does not count as anyone's approval and cannot trigger execution”。
- 审批绑定到具体版本：按钮文案是“Approve v2 / Approve v3”，下方说明“applies only to v2 under constraints v1”。decisionFor() 用 cv 比对，把旧审批派生为 stale，而不是删除。审批行显示“No longer applies · Approved under constraints v1; constraints are now v2”，Records 的 Approval record 用 Used for execution / No longer applies / Replaced 三种标签保留全部决定。
- 预算下调时刻的节点序列完整：constraint_change（琥珀边，constraints v1 → v2）→ blocked（红框，默认展开，写明“Nothing was deleted”）→ stale（“2 approvals of v2 no longer apply”）→ 自动触发 Agent round #2，并写明“Triggered by: Constraints changed”。与此同时右栏变红、Approve 禁用并写原因，房间头部显示“Renegotiating · Proposal v2 · Constraints v2”，左栏章节导轨跳到 Constraint change。
- 可追溯性是这套原型最强的一点。每个事件有 causes 字段，节点展开后显示“Because of / Led to”链接和“Trace why this happened”按钮，点击后祖先事件高亮、其余变暗，并出现 Tracing 横幅。右栏的“Why is it blocked?”、“Trace how v3 came about”和 Records 的“How CO-0042 came about”复用同一张因果图，能从变更单一路追回三份简报。
- describe.js / describe-helpers.js 是一个集中的按查看者投影层。checkLine 按角色输出：finance 看到“$4,000 committed + $900 = $4,900 > cap $4,800”，customer 看到“your deadline Nov 20”，provider 看到“meets a participant's private deadline (value not shared)”。这和 RA-T02“存结构化 payload、读时按受众渲染”的决定一致。
- 代理回合本身是一个活节点：有 Running / Retrying / Needs a person 状态、“attempt 2 of 3”和逐步出现的步骤。第一次尝试被校验拒绝并丢弃，对外只写“Nothing was shown to other participants”；provider 额外看到一条“Only you”细节：引用了不在已确认报价里的 $850。强制失败三次后出现 run_failed 节点，任何参与方都能点 Retry negotiation，这条失败路径对信任很有说服力。
- 取舍卡按角色生成利弊。customer 的“All modules, one week late”卡片直接写出后果：“Choosing this updates your private deadline to Nov 27 (new constraints version)”。provider 和 finance 只读，看到“Only Avery can answer”；finance 额外看到“Total after: $4,800 of cap $4,800 (exactly at cap)”。
- 私密边界在界面上看得见：每轮都有一个只对本人可见的“Your agent's context for round #n”节点，分 Included 和 Never included 两列；简报页每条都标 Private / Shared with room，并有 What the room can see from you 区块；finance 的预算卡有一行“Room sees: $800 available”，让披露方看到自己的披露后果。
- 执行边界和不伪造的标注一致：顶部常驻 Simulated data 横幅，种子事件标“Seeded · simulated”，报价标 simulated 标签，执行节点写“Internal records only. No payment, transfer or e-signature”，并显示 operation id；Records 里 finance 看到的是执行时快照，不会事后重算。

## 账本与对比优先（ledger）— 总分 45/60
入口：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/ledger-compare/index.html
走查：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/ui-prototypes/ledger-compare/WALKTHROUGH.md
分数：{"clarity": 7, "role_privacy": 8, "decision_support": 7, "twist_moment": 8, "traceability": 7, "feasibility": 8}
总评：「账本与对比优先」在三个最难的点上给出了这批原型里很可能最扎实的界面答案：版本意识、建议与批准分离、预算下调的连锁反应。其中'方案 × 约束版本'矩阵、两列审批面板、提案来源行和执行预告条应当直接进入最终设计。主要硬伤是可追溯性：检查用的是当前 committed，没有用约束快照或执行快照，执行后已执行的 v3 会被标成超支、在矩阵里显示 Blocked（已用 node 复现）；committed 也不在约束版本里，审批绑定有漏洞。决策支持还偏薄：代理建议没有理由，偏好满足度看不到，取舍卡缺少'都不要'的出口和预算影响，拒绝后整个房间停住且状态显示错误。隐私上数字没有泄露，但 within/exceeds 加多方案 Fits 能让 Provider 推断出余量区间，最终设计要把它作为显式的披露决定，同时把'constraints vN'改写成用户能懂的说法。

### 最终设计应吸收
- '方案 × 约束版本'可执行性矩阵作为 Compare 页的核心组件：行是不可变的提案，列是约束版本，格子由服务端派生 Fits/Blocked。修正点：用每个约束版本自带的 committed 快照计算，已执行的版本从执行快照读取。Provider 版本隐去 cap，并评估区间推断。
- 审批面板两列布局 'Agent (advisory)' 与 'Human decision'。按钮文案绑定具体版本（把 'constraints vM' 换成人话标签）。Stale 审批原位保留，并注明 'Given under …'。
- 提案卡来源行 'Drafted by run #N from confirmed offer X vK · created under constraints v1 · checked against constraints v2'。最终版再加一段：来源于哪个人工取舍回答（request id、谁、何时）。
- 执行预告条 'Approval by all three will create: 1 change order · 1 commitment $X · N tasks · written once, atomically · internal records only'。
- 按角色裁剪的预算面板，由服务端 query 返回判别联合：{kind:'full'|'shared'|'limit_only'}。limit_only 只给 'within / exceeds finance limit'，并说明 'Budget figures are private to Finance'。
- 同一个 reasonCode 按查看者渲染文案（checkText(role, code, params)），检查清单标题写 'Rule checks (code, not the model)' 并附 reasonCode。
- 代理回合卡五态：queued、running（进度条，加 'Nothing is written until the run completes under constraints vN'）、failed（Retry 作为新 attempt，注明 'Nothing was written'）、discarded（约束变化，结果丢弃）、completed（折叠，显示公开消息数）。
- 约束变化横幅 'Constraints changed: v1 → v2'，写明哪些版本失效、哪些审批不再计数，附 Compare 和 Ledger 快捷入口。最终版加上按人的已读状态，新方案就绪后降级为信息条。
- 取舍选项卡结构：标题写取舍本身（'On time, one module fewer'），下面是金额 · 日期、包含的范围、'Gives up: …'、'Source: confirmed offer id vK'、'Agents could not choose this for you'，并说明回答后仍需审批。最终版补上承诺后余量、检查通过数，以及'都不要 / 提问'的出口。
- diff 行 'Changes from v2: Cost −$200 · Defers Usage dashboard · Delivery +7 days · Constraints v1 → v2 · Compare side by side'，以及 Compare 表里差异单元格高亮、范围项用 +/删除线/(deferred) 三种标记。
- Results 页：审批记录区分 'Used for execution' 和 'No longer applies'；承诺快照（Cap at execution / Committed before / This commitment / After / Headroom left）注明 'Read from the execution snapshot'；显示 Operation ID 与被忽略的重复请求次数。
- Brief 页右栏 'What others can see' 镜像，以及 Provider 报价表的 'Private until cited' 和 'Visible: cited by vN' 可见性徽章。
- 房间列表的 'Your turn: …' 徽章、Workbench 标签红点，以及 Workbench 顶部 'Decisions needed from you' 待办列表（每条带直达按钮）。
- 时间线三档过滤 All / Room-wide / Private to you，每条带 'type · actor'，按受众措辞，私密事件打 'Private to you' 徽章。
- 约束历史表只追加：Finance 看得到私密原因列，Customer 看得到 cap，Provider 只看到'有新版本'。

### 问题
- 【已用 node 复现，严重】执行后检查会用新的已承诺额重新计算：data.js 的 headroom() 始终用当前 committed（已含 CMT-0002）。执行 v3（$700）后：Workbench 的提案卡（views-work.js proposalCard 无论什么状态都渲染 checksList）在已执行的 v3 上显示 '✗ Over the cap by $600'；Compare 的 'Checks vs constraints v2' 显示 4/5；矩阵里 v3@constraints v2 和 v2@constraints v1 都变成 Blocked。已执行方案被标成不可执行，直接破坏可追溯性。根因是约束版本只记了 cap，没有记当时的 committed，也没有从执行快照读取。
- 【设计缺口】committed 由全局账本派生，不进约束版本：如果另一笔承诺落账，方案可行性会变，但约束版本不递增，旧审批也不会变 stale，审批绑定出现漏洞。最终设计要么把 committed 快照纳入约束版本，要么任何账本变动都递增版本。
- 预算四格算术对不上（components.js ledgerPanel）：v2 被阻断时 Pending 显示 $0（'v2 is blocked'），Headroom 却减去了 v2 的 $900，显示 −$100。Cap 4,800 − Committed 4,000 − Pending 0 ≠ −100。Finance 会觉得数字错了。应把 Headroom 标成 'if v2 executed'，或者 Pending 照常显示 $900 并加 blocked 标记。
- 拒绝走进死路且状态文案错误：app.js roomStatus 只区分 blocked，被拒绝的提案仍显示 'Pending approval'；todos 只在 pStatus==='awaiting' 时产生，拒绝后三方都没有待办；nextStep 返回 'Explore'。Reject 按钮与 Approve 同样醒目，却没有理由输入，也不会触发后续。
- 推断泄露没有被当作披露决定处理：Provider 能在矩阵里看到每个方案在各约束版本下的 Fits/Blocked 和金额，预检步骤还写着 '2 confirmed offer(s) fit' 并列出 $700/$800，而 $900 被阻断。由此 Provider 能把 v2 下的余量夹在 $800 到 $900 之间。'within / exceeds' 在多方案下等于区间披露，需要显式决策，或改成更粗的结论。
- 取舍请求卡（components.js requestCard）证据不足：没有'都不要 / 提问 / 让 Provider 出新报价'的出口。Customer 有共享预算权限，卡上却不显示各选项的承诺后余量（$100 对比 $0），也不显示检查通过数。标题是启发式硬编码（'On time, one module fewer' 默认只少一个模块且按时）。回答后卡片因为 openRequest() 只取 open 状态而消失，v3 的来源行也没有链接回这次回答。
- 代理建议没有理由：recBadge 只显示 'Recommends accepting' 标签，看不到依据。检查只覆盖硬约束，Customer 的偏好（c3 Nov 20 目标、c4 dashboard）是否满足没有逐条映射。draft 计划里三方代理立即 ALL_ACCEPT，看起来像橡皮图章，削弱了'建议 ≠ 批准'的说服力。
- 'constraints v1/v2' 是引擎术语，出现在按钮、chip、横幅、审批面板各处，没有任何解释。Customer 和 Provider 未必理解'约束版本'。应改成人话，比如 'Budget & rules v2 · set by Finance 10:42'，再用 tooltip 说明为什么要重新审批。
- 约束变化横幅（views-work.js constraintBanner）要到执行后才消失：v3 已经可以审批时，Workbench 顶部仍是红色 'Re-check required'，压在 v3 卡上方，造成告警疲劳。没有'已读'，也没有'自你上次查看以来'的概念。
- 审批面板的 vchip 在 v2 被阻断时显示 'binds v2 + constraints v2'，暗示 v2 还能在 v2 约束下审批，与禁用的 Approve 按钮矛盾。
- 重谈过程中 Provider 完全被动：无可行方案的分支（engine.js plan renegotiate f.length===0）只升级给 Finance（提高上限或维持），从不请 Provider 确认更便宜的新报价。feasibleOffers 排除了所有试过的报价，Finance 把上限调回来后 v2 的报价也不会再被考虑。两个取舍选项恰好是 Provider 事先确认好的报价，看起来像查表而不是协商。
- Finance 的关键动作只放在 Ledger 页：Finance 的 Workbench 待办只有 'Approve or reject v2'，没有指向改上限的入口，演示要靠 Prototype controls 引导。Customer 拥有共享预算权限，却在 raise_cap 选项里看到 'the minimum viable amount'，金额被隐藏，披露不一致。
- 原型实现问题：每个回合步骤（750ms）整页 innerHTML 重渲染，Finance 在回合进行中输入的新上限和选择的原因会被重置为默认值。WALKTHROUGH 卖点之一'回合中途降预算 → Discarded'因此很难手动演示，焦点也会丢失。
- 'approvers.required_set' 恒为 pass，把 '5 of 5 checks' 凑满，有虚报之嫌。WALKTHROUGH 说 v1 显示 Blocked，代码里非最新版本 pStatus 返回 'superseded'，badge 显示 Superseded，文档与代码不一致。
- 事件把三方措辞放在同一个对象里（text: {finance, customer, provider}）。直接移植到 Convex 会把所有受众版本发给每个客户端，必须改成结构化 payload 加服务端按查看者渲染（WALKTHROUGH 只笼统提到服务端裁剪）。

### 优点
- 钱和版本放在第一层：房间头常驻 Proposal vN / Constraints vM 两个 chip（约束版本变化后高亮），四格预算面板（Cap / Committed / Pending / Headroom）加条形图和 Cap 标线，在 Workbench 和 Ledger 两页都能看到。三个角色都能一眼看出现在是哪一版、在哪个约束下。
- 审批面板（components.js approvalsPanel）把 'Agent (advisory)' 和 'Human decision' 分成两列。按钮文案是 'Approve v2 under constraints v1'，旁边写 'Your agent's recommendation is not your approval'。约束一变，旧审批显示为 'Stale: no longer applies' 并注明 'Given under constraints v1'，代理建议那一列不变。这个反差把核心 2、3 演示得很清楚。
- 'Fit by constraints version' 矩阵（views-compare.js matrix）：条款不变，按列重新计算 Fits/Blocked，可以直接回答'为什么我批准过的东西现在不算了'。代码里没有复制提案，这与否决 revalidated 复制版本（RA-R11）的结论一致。
- 预算面板按角色裁成三种形态（budgetAccess: full / shared / limit_only），检查文案按查看者渲染（checkText(role, check)）。逐页核对过，Provider 在 Workbench、Compare、Ledger、Results、Timeline、横幅、取舍卡中都看不到预算金额或剩余额度。Customer 的 Nov 30 截止日对他方只显示为 'Meets a customer private deadline'。
- 代理回合卡状态齐全：queued、running（进度条，并注明 'Nothing is written until the run completes under constraints vN'）、failed（Retry 作为新 attempt）、discarded（约束在回合中途变化，结果丢弃）、completed（自动折叠）。重新协商前先做确定性可行性预检，与 RA-R12/R13 一致。
- 下调预算后的连锁反应编排完整：四格闪动，Headroom 变负并标红；红色横幅 'Constraints changed: v1 → v2' 带 Compare 和 Open ledger 快捷入口；v2 卡红边，Approve 按钮禁用并写明原因；旧审批变 Stale；新回合自动开始；Customer 收到取舍卡。时间线里三方措辞各不相同，Provider 版本不出现任何数字。
- 可追溯性元素丰富：提案卡上的来源行 'Drafted by agent run #N from confirmed offer X v1 · created under constraints v1 · checked against constraints v2'；diff 行 'Changes from v2: Cost … · Defers … · Constraints v1 → v2 · Compare side by side'；Results 页的审批记录区分 'Used for execution' 和 'No longer applies'；承诺快照注明 'Read from the execution snapshot, not recomputed'；显示 Operation ID 和被忽略的重复请求次数。
- 执行预告条：'Approval by all three will create: 1 change order · 1 budget commitment of $X · N tasks. Written once, atomically. Internal records only.' 让人在批准前就知道后果和执行边界。
- 派生优先的状态模型适合 Convex：pStatus、审批是否 stale、房间状态都由 constraints、decisions、proposals、ledger 读时派生，不手工赋值，与 RA-S01 一致。opId 是 'exec:room:pV:cV'，天然可以做成唯一键。
- WALKTHROUGH 诚实：明确说角色切换和浏览器内数据不能证明任何隐私属性，拒绝后不重新协商、简报再编辑没有建模等局限都列出来了。
