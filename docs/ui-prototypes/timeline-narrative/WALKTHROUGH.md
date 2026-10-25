# 原型走查：时间线叙事优先（timeline-narrative）

> 双击 `index.html` 即可打开（纯静态，无构建、无网络请求）。界面文案为英文，本文档为中文。全部人物、公司、报价、金额都是模拟数据，界面顶部常驻 "Simulated data" 横幅，种子事件带 `Seeded · simulated` 标签。

## 1. 设计概念

整个房间是一条**按时间排列、只追加的叙事流**。每一个节点都是一个已经发生的事实：简报确认 → 代理回合 → 提案 → 规则校验 → 代理建议 → 人的审批 → 约束变更 → 阻断与审批失效 → 重新协商（含失败与重试）→ 取舍请求与回答 → 新提案 → 三方审批 → 执行。

三条设计主张：

1. **可追溯优先**：每个节点都带 "Because of / Led to" 因果链接，以及 "Trace why this happened" 按钮。点击后时间线只高亮该节点的全部祖先事件（其余变暗），回答"为什么会这样"。右侧"Why is it blocked?"、记录页"How CO-0042 came about"都复用同一套因果图（事件的 `causes` 字段）。
2. **叙事 + 固定摘要**：时间线回答"怎么走到这里"，右侧固定栏回答"现在是什么、我该做什么"（Your next step + Current proposal + finance 的 Budget controls）。读者不必读完整条时间线也能行动。
3. **谁在说话一眼可辨**：节点圆点与卡片按行动者区分——人（实心蓝圆，"Human decision"）、代理（虚线紫圈、虚线卡片，"Advisory"）、规则引擎（绿色方块）、系统（灰色菱形）。左栏有图例。代理的建议与人的批准永远是不同形状、不同颜色、不同节点。

## 2. 信息架构

```
Rooms（房间列表）
└─ Room: Loyalty launch scope change
   ├─ Timeline（默认）  左：章节导轨 Story so far + 图例
   │                    中：叙事时间线（筛选、展开/折叠、追溯高亮）
   │                    右：Your next step / Current proposal / Budget controls(finance)
   ├─ My private brief  我的私密简报、房间能看到我的什么、他方进度、我的代理收到什么
   └─ Records           变更单、预算承诺、任务、追溯链、审批记录、事件日志
```

路由用 hash（`#/rooms`、`#/room/scope-change`、`/brief`、`/records`），因此双击打开即可使用。

## 3. 每个页面的作用

| 页面 | 作用 | 关键交互 |
| --- | --- | --- |
| Rooms | 我参与的房间与"轮到你"提示 | 主房间卡片显示阶段、版本号、"Your approval is needed"等待办、最新事件；另两个房间仅作列表示意 |
| Timeline | 房间的主视图，一条可追溯的叙事 | 节点展开/折叠；筛选 Everything / Human decisions / Agent activity / Rules & constraints / Private to me；章节跳转；Trace 高亮；在节点内直接回答取舍、重试失败回合 |
| Current proposal（右栏） | 当前版本摘要与审批面板 | `Approve vN` / `Reject`（按钮文案带版本号）；禁用时旁边写原因；代理建议单独一块并注明不算批准；三人审批状态（Approved / Pending / No longer applies / Rejected）；"批准后将创建什么"预览；版本列表可跳到对应节点 |
| Budget controls（仅 finance） | 预算条与 `Lower cap to $4,800` | 触发约束 v2、阻断、审批失效、自动重新协商 |
| My private brief | 本人私密简报 | finance 在开场需要 `Confirm brief v1`；每条标注 Private / Shared with room；provider 看到自己的已确认报价表；"What your agent receives" 说明代理上下文边界；粘贴抽取为禁用占位 |
| Records | 执行结果与证据 | 变更单 CO-0042（基于 vN · constraints vM · quote、operation id）；预算承诺（finance 看到执行时快照）；任务（只有被指派人能勾选）；"How CO-0042 came about" 追溯链；全部审批记录（含失效的）；事件日志；未执行时列出阻断原因 |

## 4. 推荐点击路径（约 3 分钟）

1. 顶部切到 **Finance**（橙色虚线框标明 "Prototype only"，真实产品用登录身份）→ 右栏 `Confirm brief v1`。
2. 看代理回合 #1 实时推进（紫色 "Running"、转圈、逐步出现的步骤）：v1 全量 $1,400 → 规则校验 2 项失败 → 客户代理还价 → v2 一期 $900 → 校验全过 → "Agents recommend accepting v2"（Advisory）。
3. 切 **Customer** 批准 v2，切 **Provider** 批准 v2。注意右栏审批行变化，以及代理建议仍然只是建议。
4. 切 **Finance**，在 Budget controls 点 `Lower cap to $4,800`。（也可以用右下角 Prototype controls 的 "Jump to the budget-cut moment" 一步到这里。）
5. 时间线出现新章节 "Constraint change"：约束变更节点（琥珀色左边框）→ "Proposal v2 blocked"（红框，默认展开）→ "2 approvals of v2 no longer apply"。右栏 Current proposal 变红、按钮禁用并写明原因；审批行显示 "No longer applies"。
6. 重新协商回合 #2：第 1 次尝试被校验拒绝并丢弃（provider 视角额外看到 "Only you" 细节：引用了不存在于已确认报价中的 $850），自动重试，规则预检找到两个已确认报价，但都不能同时满足所有约束与偏好 → 生成取舍请求。
7. 切 **Customer**，在时间线的 "Decision requested from you" 节点选择：
   - "On time, one module fewer"（$700，Nov 20，Receipt emails 延后）：约束保持 v2；
   - "All modules, one week late"（$800，Nov 27）：等于客户放宽自己的私密截止日，约束 v2 → v3，时间线多一个约束变更节点。
8. 代理回合起草 v3 → 校验 → 建议 → 三人依次批准 → "Executed: change order CO-0042"。打开 Records 查看变更单、承诺、任务、追溯链。
9. Prototype controls 里点 "Send duplicate execute request"：时间线记录 "Duplicate execution request ignored"，不产生第二份记录。
10. 失败路径：Reset 后在 Prototype controls 勾选 "Force the next renegotiation round to fail 3 times"，再走到预算下调：回合 #2 三次失败 → "Agent round failed after 3 attempts" 节点与 `Retry negotiation` 按钮（任何参与方可点）→ 新回合 #3 成功。

## 5. 三个角色分别看到什么、看不到什么

| 信息 | Customer（Avery） | Provider（Priya） | Finance（Marcus） |
| --- | --- | --- | --- |
| 自己的私密简报全文 | 是 | 是 | 是 |
| 他人的私密条目 | 否，只看到"brief v1 confirmed + 时间"和对方选择共享的条目 | 同左 | 同左 |
| 客户截止日 Nov 20 | 是（校验写成"Nov 20 is on or before your deadline"） | 否：显示 "meets a participant's private deadline (value not shared)" | 同 provider |
| 预算上限 $5,000 / 已承诺 $4,000 | 否：只看到 finance 授权共享的 "available for this change: $1,000 → $800" | 同左 | 是：完整算式 "$4,000 + $900 = $4,900 ≤ cap $5,000"，预算条与 "Total after" |
| 报价价格 | 只有被提案引用的报价（引用即披露） | 全部已确认报价 | 同 customer |
| 代理上下文 | 时间线中 "Your agent's context for round #n"（Private to you），列出包含与"永不包含" | 同左 | 同左 |
| 失败尝试的细节 | 只看到"被拒绝并丢弃，未向他人展示" | 额外看到自己代理引用了 $850 的原因 | 同 customer |
| 取舍请求 | 可操作：两个选项卡片 + "Choose this option"，含对自己私密截止日的影响 | 只读：选项条款 + "Only Avery can answer" | 只读，另看到每个选项的 "Total after … of cap" |
| 执行记录 | 变更单、承诺金额、任务（只能勾自己的） | 同左 | 另有承诺前/后/上限/剩余的执行时快照 |

原型里"看不到"的效果由 `describe.js` 的按角色投影实现；真实系统中这一步必须在服务端完成（见第 8 节局限）。

## 6. 预算下调时刻的呈现

- **节点序列**：`Finance changed the budget constraints`（constraints v1 → v2，琥珀边）→ `Proposal v2 blocked under constraints v2`（红框，默认展开，列出全部校验，说明"Nothing was deleted"）→ `2 approvals of v2 no longer apply`（"Kept in history; no longer counted"）→ `Agent round #2 · Renegotiation`（自动触发，Because of 指向阻断与失效节点）。
- **右栏同时变化**：状态徽章 Blocked、红色解释框（按角色投影的超额原因）+ "Why is it blocked?"、Approve 按钮禁用并写原因、审批行变为 "No longer applies · Approved under constraints v1; constraints are now v2"。
- **房间头部**：状态 "Renegotiating"，"Proposal v2 · Constraints v2" 版本号常驻。
- **左栏章节导轨**："Constraint change" 成为当前章节。
- **Records**：未执行时列出阻断原因；审批记录里 v2 的两条审批标为 "No longer applies"，执行后 v3 的三条标为 "Used for execution"。

## 7. 与任务书核心的对应

| 核心 | 原型中的体现 |
| --- | --- |
| 1 私密委托 | 私密事件带 "Private to you"，只出现在本人时间线；预算与截止日按角色投影；"What your agent receives"/"Your agent's context" 明示上下文边界；报价"被引用才披露" |
| 2 代理只建议 | "Agents recommend accepting vN" 是独立的紫色虚线节点与右栏独立区块，文案写明不算批准、不能触发执行；人的批准是蓝色实心节点 "Human decision"；取舍由代理升级给具体的人，代理"may not make this trade-off for a person" |
| 3 人批准具体版本 | 按钮 "Approve v2"；说明 "applies only to v2 under constraints v1"；约束变更后旧审批显示 "No longer applies"，必须重新批准 v3 |
| 4 代码负责校验 | "Rules engine" 节点列出预算、必需范围、截止日、来源四项；失败尝试因"价格不在已确认报价中"被拒；所有金额来自 `QUOTES` |
| 5 执行幂等且原子 | 最后一票触发一次执行，展示 operation id；重复请求节点 "ignored, same operation id" |
| 6 历史不可篡改 | 时间线只追加；提案节点写明 "append-only"；旧提案显示 Superseded、旧审批保留；追溯链从变更单回到简报 |
| 7 执行边界 | 执行节点与变更单卡写明 "Internal records only. No payment, transfer or e-signature" |
| 8 不伪造 | 顶部模拟数据横幅、`Seeded · simulated`、报价 `simulated` 标签；无可行方案时请求人而不是强行一致 |

## 8. 已知局限

- 所有角色数据都在浏览器 JS 里，投影只是视觉演示，不能证明隐私；真实系统需服务端按查看者裁剪。
- 角色切换代替登录，仅为原型。
- 只有一个完整房间；邀请、建房、简报编辑、粘贴抽取、改价都是占位。
- Reject 只记录决定（可改为批准），不会触发重新协商；审批撤回、过期、并发冲突、过期模型结果丢弃没有演示。
- 代理回合是脚本化的 setTimeout，不是真实协商；"Force failure" 只作用于下一次重新协商回合。
- 预算下调只在首个方案等待审批（approval 阶段、constraints v1）时可用，且只能下调一次；执行后再改预算、重新协商途中再改预算等时机没有演示。
- 状态不持久化，刷新即重置；时间为模拟时钟。
- 时间线很长时缺少虚拟滚动与按版本筛选（只有按类型筛选）。
