# 三栏工作台原型 · WALKTHROUGH

> 目录：本文件所在目录。入口：`index.html`（双击打开，纯静态，不联网、不需构建）。所有人名、金额、报价、日期都是模拟数据，界面顶栏常驻 "Simulated data" 徽章，变更单卡上也标 "Simulated"。

## 1. 设计概念

一句话：**左边是"我知道的"，中间是"我们要决定的"，右边是"刚刚发生了什么"。**

- **左栏 · 我的简报与约束（私密区）**：米黄底加斜纹，每块都有锁形标签 "Only you can see this"。目的是让用户一眼分清哪些信息只有自己和自己的代理知道。左栏底部是 "What others can see from you"，把披露边界摊开给用户看。
- **中栏 · 当前方案卡**：一张卡说清这个版本的全部事实：范围、延后项、交付日、来源报价、记录时的约束版本、金额分解、代码校验结果，以及分成两块的"代理建议（advisory）"和"人的审批（binding）"。卡片下方是"最终批准后系统会创建什么"的预览，再往下是可折叠的历史版本表（只追加）。
- **右栏 · 代理回合 + 事件时间线**：代理回合逐个显示（排队、思考中、重试第 n/3 次、完成、失败、被跳过）；时间线最新在上，新事件闪一下高亮，私密事件带 "Private to you" 徽章。
- **顶部横幅**：左边一句话说房间状态和原因，右边是 "Needs you" 列表（带直达按钮）；没有待办时写明正在等谁。

## 2. 信息架构（hash 路由）

| 路由 | 页面 | 作用 |
| --- | --- | --- |
| `#/rooms` | Rooms | 房间列表。每张卡先显示 "Needs you: …"，再显示状态与版本号。预算只在 finance 视图里显示（带 Finance only 标签）。另有两个静态示例房间。 |
| `#/room` | Workbench | 三栏工作台，主要交互都在这里。 |
| `#/room/brief` | My brief | 简报确认页：私密条目逐条标注 Private / Shared，硬约束标出由哪条代码规则检查；finance 有一条"从粘贴文本抽取"的草稿，必须 Accept / Discard，未处理的不会进入简报；右侧是确认框、其他参与方进度（只有版本与时间）、披露清单。 |
| `#/room/results` | Results | 执行结果：变更单、预算承诺（finance 看执行时快照的完整台账，其他人只看本次金额）、任务（只有被指派人能勾选）、"这个结果怎么来的"溯源链、完整决定记录（含已失效的审批）。未执行时列出阻断原因。 |
| `#/room/timeline` | Timeline | 完整事件时间线，可按 Decisions / Constraints & briefs / Agent runs / Private to me 筛选。 |

页面右下角的 **Prototype controls** 抽屉不属于产品界面（明确标注 not product UI），提供：跳到 5 个关键时刻、一键"以 Finance 身份把预算降到 $4,800"、"让下一次重新协商失败"、"模拟重复提交执行"、重置。顶栏的角色切换标注 "Prototype only · view as"，代替真实登录。

## 3. 推荐点击路径（约 3 分钟）

1. 初始以 Customer 视角进入。横幅显示 "Collecting private briefs (2 of 3 confirmed)"，并写明在等 Finance。
2. 切到 **Finance**，进入 My brief：Accept 抽取草稿，点击 "Confirm brief v1"。
3. 回到 Workbench，看 run #1 逐步推进：Provider agent 提出 v1（全量 $1,400，Dec 4）→ 代码判定预算与交付期限两项失败 → 两个代理 reject → Provider agent 还价 v2（一期 $900，Nov 20，analytics 延后）→ 全部检查通过 → 三个代理都 "recommends accepting"。此时横幅是 "Awaiting human approval of v2 under constraints v1"，三方的人工审批全部还是 Pending。
4. 以 Customer、Provider 身份各点一次 "Approve v2 · constraints v1"。
5. 切到 Finance，在左栏 Budget 面板点 "Lower budget cap…"，输入 4800。弹窗实时预览后果（v2 会被阻断、2 个审批将失效、会自动开始重新协商），然后确认。
6. **预算下调时刻**（见第 5 节）。
7. 约 4 秒后，run #2 完成并向 Customer 发出取舍请求 HR-1。切到 Customer，选择 A 或 B，可以给自己的代理留私密备注，然后提交，生成 v3。
8. 三方依次批准 v3（constraints v2）→ 横幅显示 "Executing…" → 变为 Executed。进入 Results 查看变更单 CO-2026-014、承诺与 4 个任务。
9. 失败与重试：在抽屉里跳到时刻 3，勾选 "Make the next renegotiation run fail"，再点 "Budget cut"，会看到 Provider agent 失败 3 次、Run failed 卡和 Retry run 按钮。取消勾选后重试，流程恢复。

## 4. 三个角色看到什么、看不到什么

| 信息 | Customer | Provider | Finance |
| --- | --- | --- | --- |
| 自己的私密条目（如 Customer 最晚交付日 Dec 1、Provider 产能与毛利、Finance 上限与已承诺） | 自己的可见 | 自己的可见 | 自己的可见 |
| 他方私密条目 | 不可见 | 不可见 | 不可见 |
| 预算检查 | 只看到 "Within / Over Finance's limit"，并注明金额未共享 | 同左 | 完整算式：$4,000 + $900 = $4,900 ≤ $5,000 |
| 交付期限检查 | 完整说明（"Nov 20 ≤ your latest date Dec 1"），并注明该细节只有自己能看到 | 只看到 "Meets / Misses a private Customer delivery limit" | 同 Provider |
| 报价 | 只看到被提案引用的报价 | 全部 4 个已确认报价及价格；未引用的标 "Price private" | 只看到被引用的报价 |
| 预算面板与 "Lower budget cap" | 无 | 无 | 有 |
| 取舍请求 HR-1 | 可以作答，可留私密备注 | 只读："Only Customer can answer"，并注明对方私密理由不显示 | 只读，选项卡里能看到自己的预算算式 |
| 代理回合消息 | 自己代理的消息带私密细节（如 "Dec 4 is after your latest date"）；他方代理只显示公开版 | 同理（如校验失败的具体报价金额） | 同理（如 "$5,400 exceeds your $5,000 cap"） |
| 时间线 | 房间事件 + 自己的私密事件 | 同左 | 同左（如 "You changed the budget cap $5,000 → $4,800"），他人看到的是 "Finance updated a budget constraint" |

实现方式：渲染层只调用按角色裁剪的函数（`checksFor(p, cv, role)`、`eventsFor(role)`、`msgFor(msg, role)`），对应真实系统中服务端按查看者裁剪的读模型。切换角色时会清掉上一角色的提示条，避免私密数值残留。

## 5. 预算下调时刻的呈现

- **横幅**变为红色："Proposal v2 is blocked · agents are renegotiating (run #2)"，原因写明 "Constraints changed to v2… approvals given under older constraints no longer count. Agents… cannot approve anything."
- **方案卡**变红并显示 Blocked。卡顶出现 "What changed" 差异框：Finance 看到 "$5,000 → $4,800; v2 totals $4,900"，其他人看到 "Finance updated a budget constraint; v2 no longer fits it"。
- **审批区**：Customer 和 Provider 的旧批准不删除，显示删除线和 "No longer applies"，并注明 "approved under constraints v1"。代理建议也打删除线，标出所依据的约束版本。
- **按钮**："Approve" 与 "Reject" 都禁用，旁边写明原因（"fails a check under constraints v2"）。
- **版本号**：标题区的 "Constraints v2" 常驻；v2 卡写 "checked against constraints v2"，同时保留 "recorded under constraints v1"。
- **右栏**：run #2 自动开始。Provider agent 第 1 次输出被校验器拒绝（`source.unsourced`：$700 不在任何已确认报价里），显示 "attempt 2 of 3"；第 2 次给出 Q-3、Q-4 两个来自已确认报价的选项；Customer agent 以 `ask_human` 动作把选择交给人；Finance agent 确认两者都在限额内。
- **取舍请求**：Customer 视图出现醒目的 HR-1 卡。两个选项分别是 "On time, one module fewer"（$750，Nov 20，权限模块延后）和 "All 3 modules, one week later"（$800，Nov 27，正好等于新余额，用来测 ≤ 边界）。每个选项都附代码校验结果，并写明 "Agents did not pick: this is a human choice"。
- **其他分支**（同一套代码）：如果新上限只容得下一个选项，直接生成 v3 等待审批；如果一个都容不下（例如 $4,500），转为向 Finance 发请求（"Raise cap to $4,750" 或 "Keep cap, pause the room"）；如果新上限仍容得下 v2，v2 不被阻断，但旧审批同样失效，需要按新约束版本重新批准。
- 如果在 run 进行中再次改上限，进行中的 run 会被标为 "Discarded (stale)"，结果不写入（拒绝过期结果）。

## 6. 与任务书核心的对应

| 核心 | 原型中的体现 |
| --- | --- |
| 1 私密委托 | 私密区视觉语言；"What others can see from you"；按角色裁剪的检查说明、代理消息、事件；他方只看到简报的版本与时间 |
| 2 代理只建议 | 方案卡把 "Agent recommendations · advisory" 与 "Human approvals · binding" 分成两块；全部代理建议接受后，人工审批仍是 Pending；代理在取舍处用 `ask_human`，不替人选 |
| 3 人批准具体版本 | 按钮文案带版本号："Approve v2 · constraints v1"；约束变化后旧审批显示 "No longer applies"；执行 operation id 由 (提案版本, 约束版本) 决定 |
| 4 代码负责校验 | 每条检查有 reasonCode（`budget.over_cap`、`deadline.violated`、`source.matches_quote`…）；代理编造的价格被 `source.unsourced` 拒绝并重试；提案只能来自已确认报价 Q-1…Q-4；抽取草稿必须人工确认 |
| 5 执行幂等且原子 | 最后一票触发 "Executing…" 后一次写入变更单、承诺、任务；抽屉里的 "Simulate duplicate execution submit" 只会记一行 "duplicate ignored"，不会产生新记录 |
| 6 历史不可篡改 | 版本表只追加、状态按当前约束重新派生；约束历史；决定记录保留旧审批与拒绝；溯源链 |
| 7 执行边界 | 变更单卡写明 "An internal record only. No payment, transfer or e-signature happens." |
| 8 不伪造 | 全局 Simulated 徽章；fixture 事件写明 "from fixture (simulated)"；没有发生的代理消息不显示；run 失败时明确写 "No proposal, approval or record was changed" |

## 7. 代码结构

`data.js`（fixture）→ `engine.js`（检查、派生状态、按角色投影）→ `actions.js`（动作，返回 `{ok,msg}`）→ `runs.js`（代理回合模拟）→ `ui-*.js`（渲染）→ `app.js`（路由、事件委托、弹窗、抽屉）。状态存在 localStorage（读写都包在 try/catch 里），刷新后保留；刷新时正在进行的 run 会被标为中断失败，可以重试。

## 8. 已知局限

- 三方数据都在同一个浏览器 JS 里，角色切换只是视图投影，**不能证明任何隐私属性**。真实系统必须由服务端裁剪。
- 代理回合是写死的脚本，加定时器推进，不是真实的模型调用。重新协商只覆盖"预算变化"和"拒绝"两种触发。
- 简报编辑（v2）、邀请与加入、新建房间、执行后的修订轮次、审批撤回都没有实现，只有文案说明。
- 拒绝后的重新协商复用了同一套候选报价逻辑，没有体现拒绝理由对代理行为的影响。
- 只做了单一房间；多标签页之间不同步，没有模拟实时订阅。
- 只有浅色主题；可访问性只做了基础：语义区块、aria-live、禁用按钮旁写明原因、状态同时用颜色和文字表达。没有做键盘焦点管理与读屏测试。
- 时间都按本地时区显示，未处理时区规则。
