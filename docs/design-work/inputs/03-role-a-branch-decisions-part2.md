# 03 Role A 分支决定 · part2：§2 结论总表

> 全部条目的一行裁决。详细现状、理由、缺陷与新设计要求见各条所在章节（§3–§8）。缺陷编号 RA-B 见 §9。
> 裁决：**采纳** / **修改后采纳** / **否决**。代码一律不复用，这里评估的是想法与形状。

## 2.1 数据形状（§3、§4）

| id | 决定（分支现状） | 裁决 | 一句话理由 |
| --- | --- | --- | --- |
| RA-D01 | Room 带共享目标 `goal` | 采纳 | 三方协商的锚点；原 README rooms 表已有 |
| RA-D02 | 预算 `totalBudgetCents` / `committedCents` 放在 Room 上，全员可见 | 修改后采纳 | 保留两个整数分字段与不变式；归属改为 finance，committed 由 ledger 派生，披露按矩阵 |
| RA-D03 | `room.proposalVersion` 兼作当前提案指针，`constraintsVersion` 计数 | 修改后采纳 | 计数保留；当前提案用 id 指针；约束版本递增点要补全 |
| RA-D04 | 7 值 `RoomStatus`，各动作手工赋值 | 修改后采纳 | 生命周期、run、提案可执行性、人工请求分层，能派生的不存 |
| RA-D05 | `Member{role, approvalRequired}`，每角色一人，身份 = 角色 | 修改后采纳 | 审批要求保留；席位与 Clerk 用户分离，需邀请流程 |
| RA-D06 | `BriefItem{text, kind, shared}` 自由文本 | 修改后采纳 | "硬约束/偏好 + 逐条披露"保留；硬约束必须结构化才能被代码检查 |
| RA-D07 | `ProviderOption{label, scope[], costCents, deliveryDate, confirmed}` | 修改后采纳 | 本分支最重要的决定：报价是用户确认的结构化数据；需稳定 id、版本、确认人、有效期 |
| RA-D08 | `PrivateBrief` 保存即确认、原地覆盖、`version` + `confirmedAt` | 修改后采纳 | 版本与"全员确认才开始"保留；草稿/确认分离，确认版本只追加 |
| RA-D09 | `ProposalOrigin = fixture / confirmed_option / revalidated / agent` | 修改后采纳 | 来源标注保留；拆成 authorKind、派生关系、isSimulated 三个正交维度 |
| RA-D10 | Proposal 字段集，只追加不修改 | 修改后采纳 | 加 contentHash、结构化来源引用、派生状态；sourceRole 不得误标 |
| RA-D11 | `deferredScope` 显式记录延后范围 | 采纳（改口径） | 按"客户请求范围 − 本提案范围"由代码计算，进入被批准内容 |
| RA-D12 | `Approval` 与 `Rejection` 两表，按版本号绑定 | 修改后采纳 | 合并为只追加的 decisions，绑定 proposalId + constraintsVersion + contentHash，拒绝带理由 |
| RA-D13 | `Commitment{operationId, amountCents}`，无变更单实体 | 修改后采纳 | 增加 executions（operationId 唯一）、changeOrders、预算 ledger |
| RA-D14 | 每个范围项派生一个任务，全部指派 provider | 修改后采纳 | 确定性派生保留；模板归场景插件，审批时可预览 |
| RA-D15 | `RoomEvent{action: string, summary 预渲染, visibility}` | 修改后采纳 | 同事务写事件保留；type 枚举、结构化 payload、受众判别联合、读时渲染 |
| RA-D16 | `WorkspaceState` 全量对象，"same shapes" 替换为 Convex 查询 | **否决** | 照做就是把全员私密数据发到浏览器（gap1-08）；改为按查看者裁剪的读模型 |
| RA-D17 | `AgentRole` 三值 enum，角色权限散落在 if 中 | 修改后采纳 | 角色由场景插件声明，引擎只认 roleKey |

## 2.2 确定性规则（§5、§6）

| id | 决定 | 裁决 | 一句话理由 |
| --- | --- | --- | --- |
| RA-R01 | 预算不变式 committed + cost ≤ cap；cap 不得低于 committed | 采纳 | 核心硬规则；改为在执行事务内对 ledger 重算 |
| RA-R02 | `checkProposal` 四项：terms / current / constraints / budget | 修改后采纳 | 形状与调用点保留；检查集不完整，"Matches current constraints" 名不副实 |
| RA-R03 | 条款校验：Zod `proposalTerms` 与 saveBrief 手写正则两套 | 修改后采纳 | 必须单一校验源；两套在日历日上已不一致（RA-B10） |
| RA-R04 | 审批同时绑定 proposalVersion 与 constraintsVersion；旧审批显示 stale 不计数、不删除 | 采纳（改绑定键） | 核心 3 的直接实现；绑定改为不可变内容 |
| RA-R05 | 必需审批人 = 当前 `approvalRequired` 成员，检查时动态读取 | 修改后采纳 | 提案创建时快照必需审批人集合 |
| RA-R06 | 批准要求检查全过，拒绝不要求 | 采纳 | 不让人批准一个不可执行的版本，但永远可以说不 |
| RA-R07 | 最后一票在同一事务内执行 | 采纳 | 无悬空的"全员已批未执行"状态；执行守卫全部重算 |
| RA-R08 | `operationId = roomId:p{v}:c{c}`，服务端派生，写前查重 | 修改后采纳 | 思路正确；改为由 proposalId + constraintsVersion 派生并有唯一落点 |
| RA-R09 | 重复执行写 `duplicate_execution_ignored` 房间事件 | 修改后采纳 | 返回幂等结果；重复计数进运维日志，不刷房间事件 |
| RA-R10 | 改上限：仅 finance、≥ committed、未变则拒、constraintsVersion+1、超限阻断 | 采纳（补后续流程） | 后续要走统一的约束变化流程（重新评估 → 协商或请求取舍） |
| RA-R11 | 上限变化后仍可行则复制出 `revalidated` 新提案版本 | **否决** | 审批已绑约束版本，复制是冗余绑定且把 finance 的动作记成 provider 的提案（gap1-06） |
| RA-R12 | `bestFeasibleOption`：剩余预算内范围条目最多、再最便宜 | 修改后采纳 | 降级为确定性可行性预检；不能代替协商，也不能忽略必需范围与截止日 |
| RA-R13 | 无可行解 → needs_input + 按角色的静态取舍提示 | 修改后采纳 | 三种取舍对应三种权限，保留；改为指向具体人的结构化 humanRequest |
| RA-R14 | `describeChange` 版本差异文本 | 采纳（结构化） | 先产出结构化 diff 再模板渲染；"移除"不等于"延后" |
| RA-R15 | saveBrief 校验：仅 provider 可列报价、安全整数价格、日期格式 | 修改后采纳 | 移到服务端共享 validator；确认硬约束/报价要递增约束版本 |
| RA-R16 | 不能撤回审批；approve 会删除自己的旧拒绝 | 否决（删除）/ 修改（撤回） | 历史只追加；撤回 = 追加一条 withdraw 决定，执行后不可撤回 |

## 2.3 状态与事件（§6.7、§6.8）

| id | 决定 | 裁决 | 一句话理由 |
| --- | --- | --- | --- |
| RA-S01 | 状态由各动作手工赋值；paused/failed 从未使用 | 修改后采纳 | 状态集合作参考，赋值方式否决：迁移表 + 守卫 + 派生 |
| RA-S02 | 每个动作全有或全无，返回 `{ok, message}` | 采纳（形状） | mutation 返回 typed result + reasonCode；message 不含他方私密值 |
| RA-S03 | 事件与状态变化同一事务写入 | 采纳 | 可追溯的前提（核心 6） |
| RA-S04 | 同一动作对本人写详细私密事件、对房间写摘要事件 | 采纳 | 受众分级文本的雏形 |
| RA-S05 | 已确认房间不可再改，"新开房间修订" | 修改后采纳 | 修订应在同一房间开新一轮并关联旧执行，保留历史 |
| RA-S06 | needs_input 只能靠改简报或改上限退出 | 修改后采纳 | 拒绝带理由，触发重新协商或人工请求，消除死路（RA-B16） |

## 2.4 页面、fixture、文本、格式（§7、§8）

| id | 决定 | 裁决 | 一句话理由 |
| --- | --- | --- | --- |
| RA-U01 | 四页面：房间列表 / 我的私密简报 / 工作台 / 结果与历史 | 采纳（扩充） | 与原 README 一致；补邀请、人工请求、协商记录 |
| RA-U02 | 工作台置顶 "Decisions needed from you" | 采纳 | 默认展示结论、阻断和需要你做的决定；改为服务端 per-viewer 待办 |
| RA-U03 | 提案卡：条款 + 来源 + 差异 + 检查清单 + 带版本号的批准按钮 + "代理建议不算批准" | 采纳 | 让人清楚自己批准的是哪一个具体版本 |
| RA-U04 | 版本对比表（Executed / Superseded / Blocked / Current） | 采纳 | 状态改为服务端派生；金额列按角色裁剪 |
| RA-U05 | 预算条与数字全员可见 | 修改后采纳 | 非 finance 只看在预算内/超出的结论 |
| RA-U06 | 审批面板 approved / rejected / stale / pending | 采纳 | 增加 stale_reject 与撤回 |
| RA-U07 | Agent messages 折叠区，没有就空着，不伪造 | 采纳（原则） | 换成真实协商记录与 run 进度 |
| RA-U08 | 简报页 "What the room can see" 披露预览 | 采纳 | 必须由服务端披露模型生成，反映真实可见内容 |
| RA-U09 | 他方简报只显示版本与确认时间 | 采纳 | 即读模型 briefStatuses |
| RA-U10 | "Extract from pasted text" 占位 | 采纳（实现） | 抽取 → 结构化草稿 → 本人逐条确认 |
| RA-U11 | 结果页：变更单、任务（仅指派人可改）、历史（私密徽章）、预算影响、审批记录、阻断原因 | 采纳 | 预算影响按角色裁剪；从变更单可追溯到决定与来源 |
| RA-U12 | "Send the execution request again" 按钮 | **否决** | 演示道具；幂等性放进自动化测试 |
| RA-U13 | "Preview as" 按标签页切换角色、预览横幅 | **否决** | 身份来自 Clerk；保留"模拟数据"徽章给 isSimulated 房间 |
| RA-U14 | Reset local preview | 修改后采纳 | 改为 dev/demo 环境的 seed/reset 运维工具 |
| RA-U15 | 产品界面里写死 demo 提示（"lower it to $4,800"） | **否决** | 演示文案不进产品 |
| RA-F01 | 数字 $5,000 / $4,000 / $1,400 / $900 / $4,800 | 采纳（补路径） | 与原 README 一致；降到 $4,800 后无可行报价，14 号文档必须设计这一步 |
| RA-F02 | 范围项 "Change item 1–3"、日期为占位 | 修改后采纳 | 换成具体的范围目录与日期，并标注 simulated |
| RA-F03 | fixture 结构：三份简报共享/私密混合、v1 超预算、v2 可行、相对时间事件 | 采纳（修正） | v1 同时违反截止日，新规则应同时报出 |
| RA-F04 | origin 文案 "Seeded fixture (simulated)" | 采纳 | 核心 8 |
| RA-T01 | 对他方可见文本全部由代码模板从结构化字段生成 | 采纳 | 默认路径；代理写的解释另设约束并标注 |
| RA-T02 | 事件文本写入时渲染成英文存库 | **否决** | 存结构化 payload，读时按受众与语言渲染 |
| RA-T03 | 房间事件模板含上限、剩余预算等金额 | 修改后采纳 | 按披露矩阵为每类事件定义各受众版本 |
| RA-X01 | 整数分、严格解析 `parseDollars` | 采纳 | 币种改为房间/场景配置，服务端再解析 |
| RA-X02 | 日历日期存字符串、以 UTC 渲染 | 采纳 | 避免跨日偏移 |
| RA-X03 | 事件时间固定 America/Los_Angeles | 修改后采纳 | 显示按查看者时区；"今天"与截止判定按房间时区 |
