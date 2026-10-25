# 01 · 产品：用户、角色、范围与旅程（part1）

> 分片：`01-product.md`（本文件：目标、§1.1 组织假设、§1.2 角色、§1.3 做 / 不做、§1.4 LLM 职责边界、§1.5 体验原则、§1.6 一等结局、§1.7 旅程总览）→ `01-product-part2.md`（customer 旅程 C1–C12）→ `01-product-part3.md`（provider 旅程 P1–P8、finance 旅程 F1–F8）→ `01-product-part4.md`（横切体验 X1–X10、derivePhase"谁该行动"表、旅程 → 函数 / 表 / 事件追溯、度量、不变量、备选与否决、开放问题、与 canon 的对照）。
> 底稿：`candidates/product/01-product*.md`（三方旅程写到函数 / 表 / 失败码、X1–X11 追溯表）+ `candidates/runtime/01-product.md` §1.4（代理不可用时的 fail-open / fail-closed）。命名与决定以 canon 为准；底稿中的 `seats` / `decisions` / `listItems` / `budgets.quickUpdate` / 同房间后续变更等已按 canon 改写。示例数字取自 canon D27 主 fixture，全部 `provenance: 'seeded'`（界面带 `SimulatedBadge`）；精确日期与约束版本号以 14 的走查为准，本章用房间 `localDate = 2026-11-02` 作说明锚点。

## 目标

1. 说清楚谁在用、每个角色把什么私密地交给代理、能做什么、看见什么。
2. 划清系统边界：做什么、常设不做什么、v1 暂不做什么（进 17）。
3. 每个关键旅程写到"看到什么 → 做什么 → 调用哪个函数（12）→ 写哪些表（03）→ 可能的失败码"，并保证**每个卡住的状态都对应一个具体的人与一个具体的动作**（part4 的 derivePhase 表）。
4. 把"未达成 / 需要人取舍"作为一等结局设计，而不是错误路径。

## 1.1 用户与组织假设（待验证）

| 假设 | 内容 | 若不成立 |
| --- | --- | --- |
| H1 组织形态 | 外包软件工作室（provider）+ 中小型客户；客户方有独立于项目负责人的预算负责人（finance） | 一人不能兼任两角色（U8 / D24），小企业需两位成员，或退化为两方场景；记入 18 开放问题 |
| H2 provider 的动机 | 报价被结构化引用、审批过的变更单与任务直接落地、少邮件来回 | 任何登录用户都可建房并选自己的角色，provider 也可以先建房再邀请客户 |
| H3 规模 | 每房 3 个席位、目录 ≤ 12 项（候选快照 ≤ 12）、每 run ≤ 3 轮、并发 run ≤ 50（D01 升级触发线） | 超出时改枚举策略（06）与编排（D01 → workpool） |

## 1.2 首个场景的三个角色

角色、字段、审批类型由场景插件声明（06），引擎只认 `role` 字符串。所有跨角色字段都经 `briefs.confirm` 时的逐字段勾选（`disclosures`），**同侧也不默认共享**（C28）；模型 `rationale` 与人写备注永远只给本方（D13）。

| 角色 | 私密输入（硬字段决定 cv，软字段不决定） | 对他方可见的内容 | 本方代理 | 本人职责 | 审批 `kind` / 按钮 |
| --- | --- | --- | --- | --- | --- |
| customer | 硬：`requiredItemKeys`、`deadline`；软：偏好条目、偏好日期、`notes`；全部默认私密，可逐字段披露 | 自己勾选披露的字段（写入 `sharedFacts`，值只能是日期 / itemKey[] / 枚举） | evaluate 回合：`recommend_accept` / `counter` / `reject` / `clarify` / `escalate` | 确认简报、回答请求、批准 / 拒绝 / 撤回、可选的 `choose_candidate` | `terms` / "Accept terms of vN under constraints vM" |
| provider | 硬：报价目录 `catalogItems`（`kind: item \| modifier`，`priceCents`、`leadDays`，加急 rush 也是 modifier，D25）；软：`notes`（产能、分期偏好） | **确认后的目录行**（`itemKey`、`title` ≤ 80 码点、价格、工期）对房间可见——这是报价本身；确认对话框明示 | propose 回合：`propose` / `reject(cannot_deliver)` / `clarify` / `escalate`（无 `recommend_accept`，无 `option_fits_constraints` 话题） | 确认 / 下架目录行、回答请求、批准 / 拒绝、完成任务 | `terms` / "Accept terms of vN under constraints vM" |
| finance | 硬：`capCents`（finance 简报字段，`budget.setCap` 是便捷入口）；setup 阶段一次性基线 `ledger.recordBaseline`（可为 0）；软：`notes` | **默认对谁都不披露**；三个字段级开关 `capCents` / `committedCents` / `headroomCents` 只能对 customer 打开（U1，默认关）；provider 永远看不到任何预算数字 | evaluate 回合：只做评估与解释（不能 `counter`），算术由代码完成 | 录入基线、设上限、批准预算承诺、回答 `raise_cap` 请求 | `budget` / "Approve budget commitment of +$X for vN under constraints vM" |

**U1 `customerSeesBudget` 默认关（用户决策）**：customer 默认看不到上限、已承诺、余量；finance 打开哪个开关，customer 才看到哪个值，派生值（`overByCents` / `headroomCents` / `shortfallCents`）只有在其全部输入都已披露时才给 customer（D11/D12 ④）。主 fixture 中 finance 只披露 `capCents`。后果：customer 对预算检查只看到掩码结论 `private.constraint_unmet`（未通过时）或什么也不显示（通过时）；给 customer 的取舍选项只用 customer 自己的视图计算，绝不出现 finance 未披露的差额（D11/D15）。备选（默认披露余量区间 / 全披露）见 canon U1。

## 1.3 系统做什么 / 不做什么

**做（v1）**：建房、邮箱定向邀请（或单次链接，token 在 URL fragment，72h）、一人一房一席；只追加的私密简报版本与逐字段披露；provider 目录的确认 / 下架（只追加 revision）；finance 上限与一次性基线；代码枚举候选并快照、确定性校验预算 / 必需项 / 日期 / 来源；三方隔离代理按串行回合协商（`maxRounds = 3`）；无解、轮次用尽、代理升级、澄清、代理失败时向**恰好一个**具体的人发结构化请求（7 天期限）；人对"提案 × 约束版本"审批、可撤回本人 approve；最后一个必需审批同事务原子执行（变更单、预算承诺、任务）；约束变化让旧方案、旧审批自动失效并重新预检；按查看者投影的实时界面与时间线；用量与估算成本记录；stub 驱动与 seed fixture 的显式标注。

**常设不做（核心 7 与边界）**：转账与付款；电子签名或任何有法律效力的合同；写入外部 ERP / 会计 / 项目管理系统（只留 outbox 扩展点，17）；代理替人批准或替人披露；代理生成金额、价格、日期；把私密字段发到浏览器再隐藏；代理之间的自由文本对话；审批容差、管理员越权批准；**"单方先执行、后议价"**（FAR unilateral change order / AIA CCD，与核心 2、3、5 冲突，research §7.1-1，17 明确列为不做）；端到端加密或"数据不出设备"承诺（私密上下文会由服务端发给模型提供方，07 写明）。

**v1 暂不做（列入 17，canon D26）**：LLM 从粘贴文本抽取简报（v1 只有结构化表单）；邮件 / Slack 通知（v1 只有站内收件箱）；审批有效期与报价有效期（审批不过期，U7）；成员更换、一席多人、多席位；跨房间共享预算；同房间追加轮与修订 / 冲销（release 账本）；外部集成；事件哈希链的外部锚点；界面多语言（v1 英文，文案外置）；第二个场景（只写 `procurement_rfq` 契约测试 fixture，U6）。

## 1.4 LLM 的职责边界：为什么还需要代理

价格来自已确认目录、合规由代码判定之后，"哪些组合可行"是代码可解的小组合问题。代理只做代码做不好的事：

| 由代码完成（确定性） | 由代理（模型）完成 | 由人完成 |
| --- | --- | --- |
| 权限、算术、硬约束校验、候选枚举与快照（≤ 12，按 `candidateKey` 稳定排序，首发候选为卖方视图下金额最低的含必需项候选）、状态迁移、何时必须问人、问题与选项的生成、对他方可见的全部文本 | 在快照候选之间按本方**软偏好与备注**取舍（例："报表要赶 11-24 董事会，早一周无所谓"）；用固定 `reasonKey` / `topicKey` 表达立场；给委托人写简短私密理由（≤ 1,200 码点） | 确认简报与披露、确认目录、设上限与基线、回答请求、批准 / 拒绝 / 撤回、关闭房间、发起后续变更 |

finance 代理保留评估回合，产品文案如实写"预算由代码校验；finance 的代理只解释与建议"（D26）。三方代理都调用 `claude-opus-5-5`、协商 effort `medium`（U5）；stub 模式与 live 共用 `AgentDriver.decide(input)` 与全部下游，stub 产物标 `provenance: 'stub'`。

## 1.5 体验原则

1. **默认展示结论、阻断与"需要你做的决定"**；代理回合、完整历史可展开（V-11）。默认首页是跨房间的决策收件箱 `/rooms`（D19）。
2. **版本意识常驻**：房间头部始终显示 `Proposal vN · Constraints vM · Viewing as X`；每个审批按钮写明版本；旧审批保留并标 "No longer applies · approved under constraints vK"。
3. **代理只建议**：代理立场显示在虚线框 "Suggestion only, never counted as approval"，与实线的人类决定区分；永不出现"代理已批准"。
4. **阻断必须有原因，原因按查看者投影**：customer / finance 看到自己有权看的检查与 reasonCode；他方私密约束未满足一律显示 "A participant's private constraint isn't met"；provider 只看到 "Fits / Doesn't fit the room's private constraints"。
5. **诚实标注**：seeded / stub 数据在数据与界面两层都有徽章；没有代理消息就空着，不编造。
6. **人永远可以说不**：reject 在 `pending_approval` 时总可用；approve 只在当前提案通过全部检查时可用；撤回只撤本人 approve。
7. **没有死路**：每个非终态都有具体的行动人与出口（part4 derivePhase 表），且没有任何取舍选项会替所有人关闭房间。

## 1.6 一等结局：未达成与需要人取舍

research：Pactum 实际成交率约 64–68%；Project Deal 无人介入时出现编造事实与"主人不想要的成交"；A2A 把 `INPUT_REQUIRED` 作为中断态、终止态不可重启。因此：

| 结局 | 存储状态 | 用户看到 | 之后能做什么 |
| --- | --- | --- | --- |
| 已执行 | run `executed`、room `executed`（终态） | 变更单、预算承诺（按披露）、任务；"Internal record only. No payment, transfer, or signature happens in Speak for Me." | provider 完成任务；任一成员发起 `rooms.startFollowUp` 新房间 |
| 需要某个人取舍（中断） | run `needs_input` + 恰好一个 open `humanRequest` | 目标人看到问题与选项（只用其自身视图计算）；其他买方看到 "Waiting on Finance"；provider 只看到 "Waiting on others" | 目标人回答；7 天未答 → `expired`，run `ended_no_agreement` |
| 未达成 | run `ended_no_agreement`（终态；room 仍 `open`） | 正面展示 "No agreement was reached. Nothing was committed." + 按查看者投影的阻断原因 | 任一方修改自己的约束（自动开新 run）、`runs.start` 重新协商（节流）、creator `rooms.close` |
| 取消 | run `canceled` | "Negotiation was stopped by the room creator." | 同上 |
| 关闭 | room `closed`（终态） | 只读历史 | — |

"未达成"不是失败提示，它与"已执行"同级出现在收件箱的 "Done & no longer needed" 分区，并保留全部历史。

## 1.7 旅程总览

阶段由 run、请求、提案、房间状态派生（04 的 `derivePhase`），不另存字段。

| 阶段 | 进入条件 | 派生 `phase` | 谁在等谁 | 退出 |
| --- | --- | --- | --- | --- |
| S0 建房与邀请 | 登录用户 `rooms.create` 并选择自己的角色 | `setup` | creator 等其他席位 | 三席位都已 `invites.accept` |
| S1 简报与目录 | 席位就绪 | `setup` | 各方确认简报；provider 确认目录；finance 录入基线 | 最后一个就绪条件满足的同一事务 `openIfReady` 打开房间并开首个 run（cause `room_opened`，D12 修正草稿） |
| S2 协商 | 就绪；或约束变化（D06）；或提案被拒；或请求回答 | `negotiating` | 人等代理（回合进度实时可见） | `pending_approval` / `needs_input` / 被 supersede |
| S3 需要输入 | 无解、轮次用尽、代理升级、可升级的澄清、代理失败 | `needs_input` | 被点名的那一个人 | 回答 → 按 effect 迁移；过期 → `ended_no_agreement` |
| S4 审批 | 全部评估方 `recommend_accept` 且通过全部检查；或 `choose_candidate`；或约束变化后预检保留同一提案 | `awaiting_approval` | 尚未有效批准的必需审批人 | 最后一票 → 同事务执行；reject → 下一轮或 `needs_input`；约束变化 → D06 |
| S5 已执行 | 执行事务提交 | `executed` | provider 完成任务 | `rooms.startFollowUp`（新房间）或保持终态 |
| S6 未达成 / 取消 | `end_run`、请求过期、creator 取消 | `stopped`（reason：`ended_no_agreement` / `canceled`） | 任一方可改约束或重开 | 新 run 或 `rooms.close` |
