# Speak for Me 原型：账本与对比优先（ledger-compare）

> 纯静态原型。双击 `index.html` 即可打开，不联网、不需要构建。界面文案为英文，本文为中文。
> 场景数据全部是模拟数据（simulated），页面顶部常驻黄色横幅标注。

## 1. 设计概念

一句话：**用户先看钱和版本，再看对话。**

三方协商的核心问题其实是三个：方案花多少钱、和上一版比改了什么、谁批准了哪一版。所以这个原型把三样东西放在最显眼的位置：

1. **预算账本**：四格（Cap / Committed / Pending / Headroom）加一根条形图，随状态实时变化；约束版本一变，四格闪一下。
2. **版本对比**：任意两版并排比较，差异单元格高亮，包括范围的增减和延后、金额差、日期差、所依据的约束版本，以及三方的代理建议和人的审批。
3. **方案 × 约束版本矩阵**：每一行是一个方案版本，每一列是一个约束版本，格子里写 Fits 或 Blocked。它直接回答了"为什么我之前批准的东西现在不算了"：条款没变，变的是列。

代理对话退到第二层：在"代理回合卡"里逐条显示公开消息，回合结束后自动折叠。

## 2. 信息架构

```
Rooms（房间列表）
└─ Room：Analytics portal: scope change
   ├─ Workbench   待办 / 约束变化横幅 / 代理回合 / 取舍请求 / 当前方案卡 ‖ 预算面板 / 审批面板 / 共享事实
   ├─ My brief    我的私密简报（条目、共享开关、报价、预算披露）‖ 他人能看到什么 / 他人简报进度
   ├─ Compare     两版并排对比 + 方案 × 约束版本矩阵
   ├─ Ledger      约束历史 + 承诺分录 ‖ （仅 Finance）改上限控件 + 预算面板
   ├─ Results     变更单 / 任务 ‖ 预算承诺快照 / 审批记录（未执行时列出阻断原因）
   └─ Timeline    事件时间线（All / Room-wide / Private to you）
```

房间头常驻 `Proposal vN` 与 `Constraints vM` 两个版本号；约束版本大于 1 时高亮。Workbench 标签上的红点表示"有事等你"。

**原型专用部分**（真实产品里没有）：

- 顶栏的 "View as" 角色切换，旁边标着 `PROTOTYPE ONLY`。真实产品里每人用自己的账号登录（Clerk）。
- 右下角折叠的 "Prototype controls"，里面有：下一步提示与 Go 按钮、"Fail the next agent run"、"Re-send final approval (duplicate)"、Reset scenario。

## 3. 演示路径（约 3 分钟）

1. Rooms 页以 Customer 身份进入房间，打开 My brief。简报是代理从粘贴文本抽取出的草稿，状态为 unconfirmed。可以切换每条的 "Share with room"，然后点 **Confirm brief v1**。
2. 三份简报都确认后，自动开始 **Agent run #1**：显示排队、进行中、进度条、逐条公开消息。依次是：Provider 提出全量 $1,400，规则检查失败；Customer 代理还价；Provider 提出一期 $900，检查 5/5 通过；三方代理都 recommend accepting。
3. 产生 v1（Blocked）和 v2（Awaiting approvals）。审批面板分两列："Agent (advisory)" 显示三个 "Recommends accepting"，"Human decision" 显示三个 Pending。
4. Customer 和 Provider 各点 **Approve v2 under constraints v1**。
5. **关键时刻**：切到 Finance 打开 Ledger，新上限默认 $4,800，点 **Apply as constraints v2**。之后：
   - 四格闪动，Cap 变为 $4,800（标注 was $5,000），Headroom 变为 −$100，条形图变红；
   - Workbench 顶部出现红色横幅 "Constraints changed: v1 → v2"；
   - v2 变为 Blocked，Approve 按钮禁用，旁边写明原因；
   - 两个已有审批变为 "Stale: no longer applies"，注明当时绑定的是 constraints v1，不删除；
   - 自动开始 Agent run #2（renegotiate）：可行性预检找到 2 个已确认报价，Customer 代理声明"不替客户做取舍"，然后升级为取舍请求。
6. 切到 Customer，看到 **Your decision is needed**，两张选项卡：
   - "On time, one module fewer"：$700，Nov 20，延后 Usage dashboard；
   - "All v2 modules, 7 days later"：$800，Nov 27，放弃 Nov 20 目标日期。
   每张卡都写明放弃了什么，并标注来源报价 id 与版本。
7. 选择后开始 Agent run #3，起草 v3。Compare 页默认显示 v2 vs v3。
8. 三方批准 v3 之后自动执行：生成变更单 CO-2026-014、承诺分录 CMT-0002、5 个任务。Results 页显示 Operation ID。点控制台的 "Re-send final approval" 只会在时间线里多一条 "Duplicate execution request ignored"，不会多写记录。

## 4. 三个角色看到什么、看不到什么

| 信息 | Customer | Provider | Finance |
| --- | --- | --- | --- |
| 预算上限、已承诺、余量 | 看得到（Finance 显式共享给同组织的 Customer） | **看不到**，只显示 "within / exceeds finance limit" | 全部，并标注披露对象 |
| 改上限的原因 | 看不到 | 看不到 | 看得到（标 private） |
| 约束版本号 | 看得到 | 看得到（需要据此重新审批，但看不到金额） | 看得到 |
| 方案金额（报价价格） | 被方案引用后看得到 | 自己的报价总是看得到；未被引用的标 "Private until cited" | 被引用后看得到 |
| Customer 的硬截止日 Nov 30 / 目标日 Nov 20 | 看得到（自己的） | 只看到检查结果 "Meets a customer private deadline" | 同 Provider |
| Provider 的产能约束 | 看不到 | 看得到（自己的） | 看不到 |
| Finance 的付款偏好 | 看不到 | 看不到 | 看得到（自己的） |
| 他人简报 | 只看到 "brief v1 confirmed 时间"，不看内容 | 同左 | 同左 |
| 承诺分录表 | 看得到 | 看不到，只在 Results 看到自己变更单的金额 | 看得到 |
| 时间线 | 每条事件按受众生成不同措辞；Provider 版本不含预算金额；私密事件带 "Private to you" | | |

检查文案也按查看者裁剪（`checkText(role, check)`）：同一个 `deadline.within_hard_limit`，Customer 看到 "Meets your hard deadline (Nov 30)"，另外两方看到 "Meets a customer private deadline"。

## 5. 预算下调时刻的呈现

| 位置 | 变化 |
| --- | --- |
| 房间头 | `Constraints v2` 高亮，状态从 Pending approval 变为 Agents negotiating，再变为 Needs input |
| 预算面板 | 四格闪动；Headroom 变为负数并标红；条形图里当前方案超出 Cap 标线，变红；下方写 "Over the cap by $100" |
| Workbench | 红色横幅说明 v1→v2 发生了什么；v2 卡片红边、Blocked，Approve 禁用并给出原因 |
| 审批面板 | 旧审批变为 Stale，注明 "Given under constraints v1"；代理建议列不变，以此强调两列是两回事 |
| 代理回合 | 若下调时有回合正在进行，该回合显示 **Discarded**（结果不应用到新约束），然后在新约束下重新开始 |
| Compare 矩阵 | v2 在 constraints v1 列为 Fits，在 v2 列为 Blocked |
| Ledger | 约束历史追加 v2，v1 行划线保留 |
| Timeline | constraints_changed、approvals_stale、proposal_blocked、run_started 依次出现，三方措辞不同 |
| Provider 视图 | 不出现任何金额，只写 "v2 exceeds finance limit" 和 "Finance changed budget constraints (v1 → v2)" |

## 6. 与任务书核心的对应

| 任务书核心 | 原型中的体现 |
| --- | --- |
| 1 私密委托 | 字段级披露（Share with room、Shared with Customer / Hidden from Provider、Private until cited）；Provider 的预算视图只有结论；检查文案按角色裁剪。注意：原型为了能点，把全部数据放在浏览器里；真实系统必须在服务端按查看者裁剪，见第 8 节 |
| 2 代理只建议 | 审批面板把 "Agent (advisory)" 和 "Human decision" 分成两列；按钮旁写 "Your agent's recommendation is not your approval"；代理遇到偏好冲突时明确"不替客户选择"，转为取舍请求 |
| 3 人批准具体版本 | 按钮写成 "Approve v2 under constraints v1"；审批面板标题旁有 "binds v2 + constraints v1"；约束一变旧审批即 Stale |
| 4 代码负责校验 | "Rule checks (code, not the model)" 列出 5 项 reasonCode；价格与日期必须与已确认报价一致（`source.offer_confirmed`）；公共摘要由模板生成，不让模型写金额 |
| 5 执行幂等且原子 | 最后一票触发一次性写入（变更单 + 承诺 + 任务）；Operation ID 可见；重复请求被忽略并记录 |
| 6 历史不可篡改 | 约束只追加；提案条款创建后不变（矩阵按列重新计算是否可执行，不复制提案）；Results 的审批记录保留 Stale 审批；时间线完整 |
| 7 执行边界 | 多处声明 "Internal records only: no payment, transfer or e-signature" |
| 8 不伪造 | 顶部横幅、房间卡上的 simulated 徽章、"Seeded fixture (simulated)" 来源；代理消息只显示公开文本，并声明不展示隐藏推理；没有可行方案时向人请求，不编造一致意见 |

## 7. 状态覆盖

- **代理回合进行中**：紫色卡片，带旋转图标、"In progress · round 1 of max 3"、进度条，消息逐条出现。并说明 "Nothing is written until the run completes under constraints vN"。
- **失败与重试**：勾选控制台的 "Fail the next agent run" 后，下一次回合在第 3 步失败，显示红色卡片，写明 "failed schema validation (2 of 2 attempts). Nothing was written."。待办里出现 Retry，重试会作为新 attempt 运行。页面在回合中途刷新也会被判定为失败，可以重试。
- **过期丢弃**：回合进行中下调预算，该回合标为 Discarded，然后自动重启。
- **无可行方案**：把上限降到 $4,700 以下（例如 $4,600），此时没有报价可行，请求会发给 Finance（"Raise the cap to …" / "Keep current cap"）。
- **只有一个可行方案**：例如上限 $4,750 时，代理直接起草 v3，不发取舍请求。
- **拒绝与撤回**：Reject 和 "Withdraw my decision" 都会记录，并且只追加。

## 8. 已知局限

- 角色切换只是原型手段，全部私密数据都在同一个浏览器内存和 localStorage 中，**不能证明任何隐私属性**。真实实现必须由服务端 per-viewer 查询裁剪。
- 代理回合是脚本化的 setTimeout，不调用模型；消息内容是固定模板加少量分支。
- 拒绝之后不会触发重新协商（只记录决定）。简报确认后的再编辑（产生 v2、递增约束版本）没有建模。
- 只建模了上限变化这一种约束变化；报价改价、硬约束修改没有建模。
- 只有一个房间可交互，另外两个房间卡只是占位。
- 邀请与加入、通知、多场景都没有体现。
- 可访问性只做了基础部分：语义 section、aria-live、aria-current、禁用原因文字、颜色加文字。没有做键盘焦点管理，每次状态变化都会整页重渲染，也没有暗色模式。
- 时间显示用的是本机时区；事件时间相对于首次打开时生成。
