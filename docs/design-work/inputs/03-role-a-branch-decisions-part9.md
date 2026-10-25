# 03 Role A 分支决定 · part9：§7.4–7.6 工作台、结果与历史、可访问性

## 7.4 协商工作台 `/rooms/[roomId]` — 采纳（主体）/ 修改 / 否决（部分控件）

**现状布局**（components/workspace/workbench.tsx）：
- **左列**：
  1. "Decisions needed from you"（:44-50、56-61）：按角色现算的待办，包括确认简报、尚无提案、"Approve or reject proposal vN under constraints vM"、取舍提示（provider 的提示链接到简报页）。没有待办时显示 "Nothing right now. You are waiting on other participants."；
  2. 提案卡或已执行卡（:62-65）；
  3. 版本对比表 "Compare proposals"（:142-167）；
  4. "Agent messages (0)" 折叠区。数组恒为空，说明 "the preview never invents agent messages"，并写明代理消息"advisory: only people approve"（:16、67-70）。
- **右列**：
  1. Budget：已承诺 / 本提案 / 上限标记的条形图、数字、"Over the cap by $X. This version cannot execute."（:181-203）；
  2. Budget cap：只有 finance 可改，附 demo 提示（:205-226）；
  3. Approvals：每个必需审批人一行，approved / rejected / stale / pending 徽章加说明（:75-85）；
  4. Confirmed options："Check confirmed options" 按钮，附固定规则说明（:86-90）。

**提案卡**（:96-131）：
- 标题 "Proposal vN"，徽章 Ready for approval / Blocked；
- origin 标签加 "checked against constraints vN"，然后是 publicSummary；
- 条款：Scope、Deferred、Additional cost、Delivery、Sources；
- "Changes from vN" 版本差异；
- Checks 列表：Pass/Fail 加 detail；
- 按钮 "Approve vN"（检查未全过或已作决定时禁用）与 "Reject"（已作决定时禁用）；
- 按钮下的说明随状态变化，例如 "Your approval applies only to vN under constraints vM. An agent's recommendation never counts as approval."、"Approval stays disabled until every check passes."。

**对比表列**：Version（含 constraints 版本）、Scope（含 deferred）、Cost、Total spend（"of $cap"）、Delivery、Status（Executed / Superseded / Blocked / Current，带说明，例如 "Also over the current cap."）。当前版本行带 `aria-current`。

**采纳**：
- 待办置顶（RA-U02），符合原 README:260"默认展示结论、阻断和需要做的决定"；
- 提案卡整体结构、按钮文案带版本号、"代理建议不算批准"的说明、禁用原因写在按钮旁（RA-U03）；
- 对比表（RA-U04）、审批面板（RA-U06）、已执行卡；
- Agent messages 区"没有就空着"（RA-U07）。

**修改**：
- 待办由服务端 per-viewer 查询给出，包括 humanRequest 与"你的旧审批已失效"；
- 预算条与对比表中的 Total spend 只对有权限者显示金额，其余人看在预算内 / 超出的结论（RA-U05）；
- Agent messages 改为真实协商记录：公开消息、动作类型、基于的提案版本、run 状态。默认折叠，可展开；
- CapControl 移到 finance 的预算面板，去掉 "Demo: lower it to $4,800 during approval." 文案（:224，RA-U15）。

**否决**："Check confirmed options" 按钮。重新协商应当由约束变化或拒绝自动触发，或由有权限的人显式发起"请求重新协商"，而不是让任何人随时按一个规则选择器。

**新增**：
- run 进度：排队、进行中、失败可重试、过期被丢弃；
- humanRequest 卡片：问题加选项按钮，只对目标人显示操作；
- 提案卡里"批准后将创建的记录"预览（变更单、承诺金额、任务）；
- 共享事实面板：各方已披露的约束与偏好。

## 7.5 结果与历史 `/rooms/[roomId]/results` — 采纳（结构）/ 修改

**现状**（components/workspace/results-page.tsx）：
- **已执行时**：变更单卡（:33-47），包括 Based on proposal vN · constraints vM、Scope、Deferred、Committed、Delivery、Recorded、Operation ID，以及 "Send the execution request again" 按钮和说明 "Retries reuse the same operation ID…"。卡片注明 "An internal record only. No payment, transfer, or e-signature happens in this project."；
- **未执行时**："No executed agreement yet" 卡（:87-102），列出阻断原因：无提案、未通过的检查、尚未批准的人，并附回到工作台的链接；
- 任务列表：只有被指派人能勾选，显示指派角色与截止日（:49-58）；
- History：房间事件加只有本人可见的私密事件，最新在上，私密事件带 "Private to you" 徽章，行动者是自己时显示 "You"。说明文字 "The log records actions, versions, and outcomes, not hidden model reasoning."（:60-64；room-frame.tsx:63-81）；
- 侧栏 Budget impact：上限、执行前、本次、执行后、剩余（:67-76）；
- 侧栏 Approval record：全部审批与拒绝，标签为 Used for execution / Current / No longer applies（:77-81、104-122）。

**采纳**（RA-U11）：
- 整体结构；
- "未执行时列出阻断原因"；
- "只写内部记录，不付款、不签署"的声明（核心 7）；
- "不记录隐藏推理"的声明；
- 私密事件徽章；
- 只有被指派人能改任务。

**修改**：
- Budget impact 按角色裁剪，并读执行时的快照，不再用减法推算（RA-B09）；
- Approval record 由服务端返回完整的 decisions 历史，包括撤回和旧拒绝。现在 approve 删除拒绝的逻辑会让 "Every approval and rejection" 这句说明失真（RA-B06）；
- 历史支持按提案版本、约束版本筛选；从变更单能一路追溯到批准它的决定、所依据的报价版本、当时的约束快照（核心 6）。

**否决**：重发执行按钮（RA-U12）。

## 7.6 可访问性与细节 — 采纳

- 语义化 `section` + `aria-labelledby`；
- `aria-current` 同时标记当前 tab 与对比表中的当前提案行；
- 预算条 `role="img"`，aria-label 完整描述各项金额（workbench.tsx:189）；新设计里描述内容同样按角色裁剪；
- 禁用按钮旁必有文字原因；
- 宽表放在横向滚动容器里；
- 窄屏改为单列（app/globals.css 的 960px / 720px 断点）；
- 状态徽章同时用颜色和文字，不只靠颜色（room-frame.tsx:10-16）。

# §8 fixture、公共文本、格式化

## 8.1 fixture 的结构与数字（lib/workspace/fixture.ts）

**房间**：`demo-scope-change`，"Software service scope change"，房主 customer，status pending_approval，proposalVersion 2，constraintsVersion 1，上限 500_000，已承诺 400_000（:18-23）。三方都是必需审批人（:24-28）。

**三份简报**（version 1，分别在 40 / 35 / 30 分钟前确认）：

| 角色 | 硬约束 | 偏好 | 报价 |
| --- | --- | --- | --- |
| customer | c1 共享 "Change items 1 and 2 are required in the first delivery."；c3 **私密** "First delivery is needed by 2026-11-20." | c2 共享 "Change item 3 can be deferred to a later phase." | — |
| provider | p1 共享 "No fixed-price commitment without a confirmed scope."；p3 **私密** "Team capacity covers items 1 and 2 before 2026-11-20." | p2 共享 "Prefer phased delivery." | full：items 1–3，140_000，2026-12-04；phase-1：items 1–2，90_000，2026-11-20；都已确认 |
| finance | f1 共享 "Spending above the room budget cap is not allowed."；f2 共享 "Every new commitment needs finance approval." | f3 **私密** "Prefer milestone-based payment." | — |

**两个提案**（origin fixture，constraintsVersion 1）：
- v1 全量：$1,400，2026-12-04，合计 $5,400，超上限 $400；
- v2 一期：$900，2026-11-20，延后 item 3，合计 $4,900，可行。

**事件** e1–e6：时间相对于 fixture 创建时刻（60 / 40 / 35 / 30 / 20 / 15 分钟前），保证种子历史早于任何真实操作（:13-14）。

**演示脚本**（README diff 第 110 行）：customer 批准 v2 → finance 把上限降到 $4,800 → v2 被阻断，customer 的审批在每个标签页变成 stale → "Check confirmed options" 找不到 ≤ $800 的报价，要求取舍 → provider 在简报中新增并确认一个更便宜的报价 → 再检查，生成新版本 → 三方批准 → 变更单、承诺、任务各写一次 → 重发执行被忽略并记录。

**裁决**：
- **RA-F01 数字 — 采纳（补路径）**：$5,000 / $4,000 / $1,400 / $900 / $4,800 与原 README:241-245 一致。降到 $4,800 后剩余正好 $800，两个已确认报价都不可行（gap4-02，RA-B29），14 号文档必须设计这一步。注意：gap4-02 建议的"再推迟一项（Phase 1a）"会违反客户硬约束 c1（items 1、2 必需）。所以 ≤ $800 的方案仍须覆盖 1、2 项：要么 provider 降价或缩小交付内容后重新确认，要么把范围项拆得更细，让"必需"与"可延后"落在不同的细项上。$800 恰好等于剩余额，适合作为边界测试（≤ 判定）。
- **RA-F02 名称与日期 — 修改后采纳**："Change item 1/2/3" 与日期是占位（fixture.ts:3-5 的注释）。14 号文档需要给出具体、可信的范围目录与日期，在数据（isSimulated）与界面上都标注为模拟数据。
- **RA-F03 结构 — 采纳（修正）**：
  - 保留：三份简报都是"共享 + 私密"混合；两个提案演示"超预算 → 可行"；事件用相对时间；
  - 修正一：v1 交付 2026-12-04 晚于客户截止 2026-11-20，新规则应同时报出 budget.over 与 deadline.violated；
  - 修正二：fixture 的硬约束改用结构化字段表达；
  - 修正三：种子数据走与生产相同的校验路径写入，不直接拼对象。能否直接写入"已有审批"这样的中间状态，列为开放问题 Q11；
  - c3（截止日）与 p3（容量）在 fixture 中是私密的。这正好是"私密约束由代码检查、结果按披露矩阵展示"的典型用例，14 应保留这一设置，作为隐私测试的种子。
- **RA-F04 — 采纳**：fixture 产生的记录一律标 "simulated"，例如 originLabel "Seeded fixture (simulated)"、事件文本 "Seeded fixture v1: …"（fixture.ts:88-89）。
