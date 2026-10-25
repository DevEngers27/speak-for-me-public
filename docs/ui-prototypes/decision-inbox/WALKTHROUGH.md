# 决策收件箱优先 · 原型走查

> 目录：`ui-prototypes/decision-inbox/`。双击 `index.html` 即可打开，纯静态、不联网。界面文案为英文，本文为中文。
> 全部数据为模拟数据（界面上有 `Simulated` 与 `Seeded fixture` 标注）。顶部深色条是原型控制条（标 `Prototype only`），用角色切换代替真实登录。

## 1. 设计概念

首页不是"房间工作台"，而是**"现在需要你做什么"**。三类用户（客户、供应方、财务）都很忙，他们打开产品时最想知道三件事：

1. 有没有轮到我拍板的事？（Needs you）
2. 代理在不在干活、要不要我盯着？（Agents working）
3. 我在等谁？之前做过的决定还算不算数？（Waiting on others / Done & no longer needed）

每个待办点进去是一个**决策页**：顶部一句问题（"Approve proposal v3?"），下面只放做这个决定需要的条款、代码校验结果与证据，以及一个与"代理建议"在视觉上明确分开的"你的决定"区域。协商细节、代理消息、版本对比默认折叠在 "Learn more"，或放在房间的次级标签页里。

视觉语言里有两个固定约定：
- **紫色虚线框 = 代理的建议（advisory）**，**蓝色实线框 = 人的决定**。审批面板里每一行同时显示 "Agent: accept"（紫色）与人的状态徽章（Approved / Pending / No longer applies / Withdrawn），二者永远不合并。
- 状态徽章同时用颜色与文字；禁用按钮旁写原因。

## 2. 信息架构

```
Inbox（首页，决策收件箱）
 ├─ Needs you：Confirm（确认简报）/ Approve（批准具体版本）/ Choose（回答取舍）/ Needs attention（回合失败，可重试）
 ├─ Agents working：进行中的代理回合与当前步骤
 ├─ Waiting on others：在等谁（只说"谁在做什么"，不说内容）
 └─ Done & no longer needed：已做的决定、失效的审批、被撤回的审批请求、执行结果
Decision pages（从收件箱进入）
 ├─ #/decide/brief     确认简报（finance）
 ├─ #/decide/approve   批准当前版本（三方）
 └─ #/decide/tradeoff  回答取舍（customer；他方只读）
Rooms（房间列表）→ Room（单个房间）
 ├─ Overview           Now 卡片、当前方案、代理回合状态、审批、共享事实、简报版本
 ├─ Proposals & versions  版本对比表 + 每版的校验与审批（只追加）
 ├─ My private brief   本人私密简报、披露设置；provider 另有已确认报价
 ├─ Budget             仅 finance：预算约束、修改上限、约束历史
 ├─ Results            变更单、预算承诺、任务、审批记录、重复执行演示
 └─ Timeline           按角色过滤的事件时间线（可按类别筛选）
```

路由为 hash 路由（`#/inbox`、`#/room/results` 等），file:// 下可用。

## 3. 每个页面的作用

| 页面 | 作用 | 关键交互 |
| --- | --- | --- |
| Inbox | 一眼看到"轮到我"的决定；预算下调后顶部出现阻断横幅 | 点卡片进入决策页 |
| Confirm brief | finance 逐条确认代理从粘贴文本抽取的条目，每条显示来源片段；设置是否共享；右侧实时预览"他方会看到什么" | Keep / Discard / Share with room / Confirm brief v1（未确认上限与已承诺金额时拒绝并提示） |
| Approve | 展示 v 的确切条款、与上一版的差异、4 项代码校验、代理建议（紫框）与人的决定（蓝框）、审批面板、预算影响（按角色裁剪）、版本列表 | Approve vN under constraints vM；Reject（原型中只提示未模拟） |
| Choose (tradeoff) | 两个方案卡并排：按时少一个模块（$650，Nov 20）/ 全模块晚一周（$800，Nov 27）；对 customer 显示与其私密简报相关的影响说明与代理倾向；可写给房间的备注 | 选中方案 → Send my choice |
| Overview | 房间级"现在发生什么"，失败时直接给 Retry；当前方案摘要；代理回合步骤；审批；共享事实；各方简报只显示版本 | Retry run |
| Proposals & versions | 版本对比（v1 超预算且错过日期、v2 在约束 v2 下被阻断、v3 当前）；财务额外看到"执行后合计"列 | 展开每版的校验与审批 |
| My private brief | 本人可见的完整简报、每条是否共享；"房间能看到什么"；他方只显示版本号 | （编辑未在原型中实现） |
| Budget（finance） | 上限、已承诺、余量；修改上限（默认 $4,800 + 原因），说明会产生新约束版本并使旧审批失效 | Apply new cap |
| Results | 执行前列出阻断原因；执行后显示变更单（含 operation id）、预算承诺（finance 看快照明细，他方只看金额）、任务（只有被指派人能勾选）、完整审批记录（含"No longer applies"） | 勾选任务；Repeat execution request（演示幂等） |
| Timeline | 事件按角色过滤，私密事件标 "Private to you"，种子事件标 "Seeded fixture" | 按类别筛选 |

## 4. 演示脚本（原型条的 Next 提示会一步步引导）

1. 以 Customer 打开：收件箱为空，"Waiting on others: Finance is confirming their private brief"。
2. 切到 Finance → 收件箱出现 **Confirm your private brief** → 确认 → 自动开始代理回合 run_1.1（步骤逐条推进，其中有一步"Customer agent output failed schema validation (attempt 1 of 3) — retried automatically"，展示自动重试）。
3. 回合完成 → 三人的收件箱都出现 **Approve proposal v2**，附"Your agent recommends accepting · advisory"。
4. Customer、Provider 批准 v2。
5. Finance 在 Budget 页把上限改为 $4,800（或点原型条上的快捷按钮）。
6. **预算下调时刻**（见第 6 节）→ 自动开始重新协商 run_2.1。若事先勾选 "Next agent run fails"，该回合会连续超时 3 次后失败，任何角色都可以 Retry。
7. 回合完成 → Customer 收件箱出现 **Choose: on time, or all modules?**；Provider、Finance 看到"Customer is choosing"。
8. Customer 选择并发送 → run_3.1 起草 v3（若选"晚一周"，customer 的签字使其私密日期约束更新，约束版本 v2→v3，他方只看到"A participant updated a private constraint"）。
9. 三人分别批准 v3 → 最后一票触发执行：变更单 CO-2026-014、一笔预算承诺、6 个任务，一次写入。
10. Results 页点 "Repeat execution request"：时间线记录"重复请求被忽略"，不产生重复记录。

## 5. 三个角色看到什么、看不到什么

| 信息 | Customer | Provider | Finance |
| --- | --- | --- | --- |
| 自己的私密简报全文 | 是 | 是 | 是 |
| 他方私密简报内容 | 否（只看到 "Brief v1 confirmed"） | 否 | 否 |
| 他方标记为 Shared 的条目 | 是 | 是 | 是 |
| 预算上限、已承诺、余量、执行后合计 | 否（只看 "Fits / Over Finance's budget cap"） | 否 | 是（标 "Finance only"） |
| customer 的截止日期 Nov 20 与"7 天宽限需本人签字"规则 | 是 | 否（只看 "Meets / Misses a participant's private date requirement"） | 否 |
| provider 的报价目录与价格 | 只看被提案或取舍请求引用的报价 | 是（全部 4 个，标注已被披露的） | 只看被引用的 |
| provider 的产能/成本私密说明 | 否 | 是 | 否 |
| 方案条款（范围、增量价格、交付日） | 是 | 是 | 是 |
| 取舍请求 | 完整（含与本人简报相关的影响说明、代理倾向） | 只读：两个方案的条款、最终选择与备注 | 同 Provider |
| 事件 | 公共事件 + 发给本人的私密事件 | 同左 | 同左；带金额的事件只有 finance 版本含金额 |
| 执行结果 | 变更单、承诺金额、任务 | 同左 | 另有执行时的预算快照（cap / before / after / left） |

实现上，界面只读 `project.js` 中 `SFMProject(state, role)` 返回的**按角色投影后的视图模型**：他方私密字段不进入视图模型，而不是拿到后再隐藏。这模拟了真实系统的服务端 per-viewer 查询（见第 8 节局限）。

## 6. 预算下调时刻的呈现

触发后同时发生：
- **约束版本 v1 → v2**；房间标题区 "Constraints v2"。
- **收件箱顶部红色横幅**（三人都有，文案按角色裁剪）："Constraints changed (now v2). Proposal v2 can no longer execute."。Finance 版写明 "$4,800 上限，v2 合计 $4,900"；他方版写 "Finance updated a budget constraint… Amounts stay private to Finance"。
- **旧审批失效但保留**：已批准者的 "Done" 区出现 "You approved v2 under constraints v1 · No longer applies"；尚未批准的 finance 看到 "Approval request for v2 withdrawn"。审批面板中 v2 各行变为 "No longer applies" / "Withdrawn"，代理建议也因绑定旧约束版本而不再显示为当前建议。
- **v2 变为 Blocked**，校验列表出现 `budget.over_cap`；版本对比表保留 v2 行。
- **代理回合**：收件箱 "Agents working" 与房间 Overview 显示 run_2.1 步骤（加载新约束 → 可行性预检找到 2 个已确认报价 → 提出 OF-3 / OF-4 → customer 代理判定需要人取舍 → 开启决策请求）。
- **时间线**新增：constraints_changed（finance 私密版含金额、他方公共版不含）、proposal_blocked、approval_stale（本人私密 + 公共计数）、run_started 等。
- 随后 **Choose** 出现在 customer 的收件箱，横幅文案变为 "Agents need a person to choose a tradeoff"。

## 7. 与任务书核心的对应

| 核心（00-brief §3） | 原型中的体现 |
| --- | --- |
| 1 私密委托 | 角色投影层；他方简报只显示版本；披露是逐条 "Share with room"；私密约束的校验结果按角色改写文案（"a participant's private date requirement"） |
| 2 代理只建议 | 紫框 "advisory" 与蓝框 "Your decision" 分离；审批面板中 "Agent: accept" 与人的徽章分列；收件箱卡片写 "Your agent recommends accepting · advisory"；取舍页代理只给"倾向"，并说明"It cannot choose for you" |
| 3 人批准具体版本 | 按钮文案 "Approve v3 under constraints v3"；约束变化后旧审批 "No longer applies"；决策页说明"条款或约束变化会再次请求批准"；不能批准 Blocked 版本 |
| 4 代码负责校验 | 4 项确定性校验（budget / scope / date / source）带 reasonCode；价格只来自 provider 已确认报价（OF-1…OF-4），模型不产生金额；finance 未确认金额前不能确认简报 |
| 5 执行幂等且原子 | 最后一票触发一次性写入（变更单 + 承诺 + 任务）；重复审批点击提示 "Already recorded… Nothing duplicated"；"Repeat execution request" 以相同 operation id 被忽略并记入时间线 |
| 6 历史不可篡改 | 版本对比表只追加；审批记录保留失效审批；约束历史；时间线可追溯每一步 |
| 7 执行边界 | 变更单卡片写明 "An internal record only. No payment, transfer or e-signature" |
| 8 不伪造 | `Simulated` 徽章、`Seeded fixture` 事件标注；代理消息区"没有就空着"；回合失败如实显示 "No partial result was saved" |

另外对应 03 输入中的交互决定：待办置顶、按钮带版本号、禁用原因写在旁边、对比表 `aria-current`、"未执行时列出阻断原因"、只有被指派人能改任务、预算金额只对 finance 显示、取舍请求有明确目标人与选项、否决 "Check confirmed options" 按钮（重新协商由约束变化自动触发）、否决重发执行按钮（原型里的重复请求按钮明确标注为 prototype 演示）。

## 8. 已知局限

- 所有假数据都在浏览器 JS 中；"按角色投影"只是模拟服务端行为，打开开发者工具仍能看到全部数据。真实系统必须在服务端投影。
- 只覆盖一条主线：Reject、编辑简报、邀请/加入、新建房间、上调预算、多次下调后的复杂分支均未模拟（Reject 只给提示）。下调后若新上限仍容纳 v2，原型会保留 v2 并要求重新批准，但这条支路未精修。
- 代理回合是定时器脚本，不调用模型；"自动重试"与"失败 3 次"是固定剧本。刷新页面会把进行中的回合标为失败（如实呈现为可重试），而不是在后台继续。
- 状态存于 localStorage（不可用时照常运行但刷新即重置），不跨标签页实时同步；真实系统用实时订阅让三方同时看到阻断。
- 取舍选项的文案与"代理倾向"是写死的；真实系统应由模板 + 结构化数据生成，且问题文本不含他方私密值。
- 没有通知（邮件/推送）与截止时间提醒；收件箱只在打开时可见。
- 时间是模拟时钟（Oct 24, 09:xx），不处理时区。
- 可访问性只做了基础：语义标签、aria-live、焦点样式、状态文字+颜色；未做完整读屏测试。
