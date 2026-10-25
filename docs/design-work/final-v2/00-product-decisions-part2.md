# 00 · 产品决策备忘录 · part2（B 可以用默认值先走 / C 以后再定 / 汇总表）

## B. 可以用默认值先走（实现成本低，后改不需迁移或迁移简单）

### PD-08 审批撤回与过期规则
> canon：只采纳"可撤回"——撤回只能撤本人在当前 cv 上的 approve、执行前有效、不能撤回 reject，撤回原因**不**要求填写也不公开（`note` 只给本方）；审批轮**不过期**（7 天审批过期否决，U7、D15）；"任一 reject 结束本轮"采纳（D02）。
- 问题：已投的 approve 能否撤回？什么情况下自动失效？审批轮有没有期限？
- 为什么定不了：技术上三种都能做（审批只追加，撤回也是追加一行，spike B3）；但"能否反悔"是信任关系与流程纪律问题。
- 方案：(a) 全部审批到齐并执行前随时可撤回，撤回后 run 退回 pending_approval；(b) 不可撤回，只能等约束变化使其 stale；(c) 可撤回但要填原因且事件对全房间可见。过期：审批轮期限（与 PD-04 同一个 TTL）到期未齐 → run 置 `expired`。任一 reject 结束整轮（研究 06）。
- 推荐：c + 7 天过期。理由：撤回必须存在（人会看错版本），公开原因抑制滥用；过期避免房间永远挂着。
- 默认值：c，TTL 7 天，reject 即结束本轮。
- 影响：04 审批状态、08 §审批撤回/过期、12 `approvals.revoke`、13。

### PD-09 同一用户兼任多角色
> canon：推荐的 (b) **否决**，v1 采用 (a) 禁止兼任——一人一房一席、一席一人，审批的 distinct userId 只作第二道防线（D24、U8）；成员表唯一键是 `(roomId, userId)` 与 `(roomId, role)` 两条，不是 `(roomId, userId, role)`。
- 问题：一个用户能否在同一房间同时是 customer 与 finance（小公司常见）？
- 为什么定不了：研究 06 引 NIST AC-5"同一人不能满足两个必需角色"，但这是风控政策，不是技术约束；禁止会让单人演示/小团队无法用。
- 方案：(a) 禁止；(b) 允许成员身份兼任，但审批时"同一 userId 不能满足两个必需审批角色"（需要另一个人投其中一票）；(c) 完全允许，含审批。
- 推荐：b。理由：保留核心 3 的职责分离意义，又不阻碍一个人配置房间；实现只是审批守卫多一个判断。演示/测试账号用 fixture 里三个用户。
- 默认值：b。
- 影响：02 roomMembers 唯一键 (roomId,userId,role)、07 动作矩阵、08 必需审批人判定、16。

### PD-10 房间加入方式
> canon：改为"默认邮箱定向（`invites.create`，`invitedEmail` 必填、`emailVerified` 必须为真）；不知道邮箱时用单次链接（唯一公开 action `invites.createLink`，token 在 URL fragment、只存 `tokenHash`、72h）"（D24），不是"链接 + 可选邮箱绑定"；表名为 `invites`。
- 问题：邮箱定向邀请（必须用该邮箱登录才能接受）还是开放链接（谁拿到谁进）？
- 为什么定不了：techstack identity-auth I1 已定"应用内邀请链接 + tokenHash + 72h 过期 + 绑定角色席位"，`invitedEmail` 可选——是否强制绑定邮箱是安全与便利的取舍。
- 方案：(a) 强制邮箱绑定（最安全，邮箱填错要重发）；(b) 链接 + 可选邮箱绑定，发起人决定；(c) 纯链接。
- 推荐：b，默认勾选绑定邮箱。理由：私密简报一旦交给错误的人就无法撤回，默认偏安全；但允许发起人在演示/内部场景解除绑定。
- 默认值：b。
- 影响：03 roomInvites、07 成员授予、12 `invites.create/accept`、13 邀请页。

### PD-11 代理失败时谁负责重试
> canon：采纳"仅该方本人重试、拒绝类不自动重试"；自动重试次数改为**每回合链至多 1 次**（`MAX_ATTEMPTS_PER_TURN = 2`，run 上限 `maxAttempts = 18`），不是 `MAX_AUTO_RETRIES = 3`（D17、C55）；失败后 run 进 `needs_input` + `agent_failed` 请求给失败方（选项 `retry_turn` / `end_run`），没有 `agent_failed` 这个 run 状态。
- 问题：模型调用失败（超时、拒绝、schema 不合、预算用尽）后，自动重试几次？用尽后由谁点"重试"——该方本人、发起人，还是系统放弃本轮？
- 为什么定不了：自动重试花钱（PD-06），人工重试打扰谁是体验与责任归属问题；spike B5 确认被调度 action 失败不自动重试，必须自己选策略（workflow 组件内置退避）。
- 方案：(a) 自动退避 3 次，再失败 run 进 `agent_failed`，仅该方成员可点重试（私密上下文属于他）；(b) 任一成员可重试；(c) 不自动重试，直接问人。
- 推荐：a；拒绝类（refusal / 注入检测）不重试直接进人工取舍。
- 默认值：a，`MAX_AUTO_RETRIES=3`。
- 影响：04 run 状态、10 重试/超时、12 `runs.retryTurn`、13 错误态、15 告警。

### PD-12 三项采购：Convex Pro、Vercel Pro + 域名、Axiom
- 问题：techstack D32/D28/D31 都标 needs_decision。
- 为什么定不了：都是钱与第三方数据处理方。
- 方案后果：
  - Convex Pro（$25/开发者/月）：有它才有 log streams、exception reporting、周期备份；不买走 X5 退路（opsLog + 看门狗 cron + CI 定时 `convex export`，非 Pro 能否 export 待验证）。
  - Vercel Pro（$20/席位/月）+ 自有域名：商用不能用 Hobby；Clerk 生产实例不接受 `*.vercel.app`，所以域名是硬需求，Pro 是条款需求。
  - Axiom：只给 prod 接日志流；多一个数据处理方，但金丝雀扫描能覆盖 `error_message`。不接则只有 Sentry + opsLog。
- 推荐：上线 prod 前三项都买（约 $45/月 + 域名）；设计与 dev 阶段先不买，按 X5 退路写 15 章。
- 默认值：设计按"已采购"写，并保留 X5 退路小节；真正下单时间点 = 第一次真实用户进 prod 前。
- 影响：11 环境配置、15 可观测性/备份、18。

### PD-13 界面语言与是否做中文
- 问题：v1 界面英文还是中文？是否双语？
- 为什么定不了：取决于首批用户是谁。技术上 techstack frontend-ui 已定 next-intl（无路由前缀）且公共文本存 `{templateKey, params}`，加语言只需翻译文件。
- 方案：(a) v1 仅英文，文案全部外置；(b) v1 仅中文；(c) v1 双语。
- 推荐：a，并把 `zh-CN.json` 列为 v1.1 的第一项（Clerk 本地化包、CJK 字体回退、文本膨胀走查）。理由：评测与 fixture 都是英文，模型提示词英文；双语会让每个模板改动双倍。
- 默认值：a。
- 影响：13 前端 IA、14 模板 key、17。

## C. 以后再定（不阻塞设计与首轮实现）

### PD-14 产品名是否沿用 Speak for Me
- 问题：工作名是否成为正式名？
- 为什么定不了：品牌问题。技术上包名/表名不含产品名，改名零成本。
- 备选：沿用；或在首个外部用户前改名（候选可来自"三方 / 协商 / 版本化审批"主题）。
- 默认值：文档与代码一律 Speak for Me，`APP_NAME` 单点配置。
- 影响：00 概览、13 页面标题。

### PD-15 评测判分模型
- 技能要求由用户选：Haiku 5.5（便宜，可每个 PR 跑）或 Opus 5.5（最可靠）。默认 Opus 5.5 low，离线跑。影响 16。

### PD-16 是否开 Anthropic 组织账号做对账
- 仅对账需要（techstack D35）。默认不开，靠自记账。影响 15。

## 汇总表

| 编号 | 决策 | 组 | 推荐 | 默认值 |
| --- | --- | --- | --- | --- |
| PD-01 | customer 看预算 | A | 默认不披露，finance 字段级开关 | 同 |
| PD-02 | fit 信号与信道 | A | provider 只看原因类别；run 内限 5 次；目录变更不自动重算；clarify 不问金额 | 同 |
| PD-03 | deferred 披露 | A | 不存派生字段，customer 本地现算 | 同 |
| PD-04 | 取舍请求出口/期限 | A | 插件声明出口；选项按受众过滤；7 天过期 | 同 |
| PD-05 | 执行后重开 | A | 同房间追加轮，已执行范围不可触碰；发起人/finance 可重开 | 同 |
| PD-06 | 模型/effort/预算 | A | 全 Opus 5.5，medium/low；dev $100、prod $300 每月 | 同 |
| PD-07 | 第二个场景 | A | procurement_rfq（只做契约测试） | 同 |
| PD-08 | 审批撤回/过期 | B | 可撤回需原因且公开；7 天过期；reject 结束本轮 | 同 |
| PD-09 | 一人多角色 | B | 成员可兼任，审批两个必需角色不能同一人 | 同 |
| PD-10 | 加入方式 | B | 链接 + 默认绑定邮箱 | 同 |
| PD-11 | 代理失败重试 | B | 自动 3 次，再由该方本人重试 | 同 |
| PD-12 | 三项采购 | B | 上线前全买；设计按已采购写并留退路 | 同 |
| PD-13 | 界面语言 | B | 英文，文案外置，中文列 v1.1 | 同 |
| PD-14 | 产品名 | C | 暂沿用 | 同 |
| PD-15 | 判分模型 | C | Opus 5.5 low | 同 |
| PD-16 | Anthropic 组织 | C | 不开 | 同 |

> 你只需对 A 组 7 条回"同意 / 改为 x"。B、C 组若 48 小时内无异议即按默认值进入 final-v2 各章。（上表是备忘录原推荐；实际进入各章的是下节"canon 裁决"列。）

## 与 canon 的对照（canon 包修订 2026-10-24）

| 编号 | 备忘录推荐 / 默认 | canon 裁决（各章按此写） | 依据 |
| --- | --- | --- | --- |
| PD-01 | 默认不披露，finance 三个字段级开关；fixture 披露 cap | 原样采纳；仍是用户决策 U1 | D12 ④、U1 |
| PD-02 | 原因类别；限流 5；目录变更不自动重算；clarify 不问金额 | 只有 `ok` / `blocked`（U2）；`propose / counter` ≤ 4；不自动重算的方案否决，改为 `constraint_writes` 节流 + `price_writes` / `run_starts` 总量桶；任何角色都没有 `option_fits_constraints` | D12 ①③⑤⑥、C58 |
| PD-03 | 不存 deferred，customer 本地现算 | 原样采纳 | D11、C24 |
| PD-04 | 插件声明出口；受众过滤；7 天；含 `close_room`；过期 run 置 `expired` | 出口 = D15 effect 表（新增 `pass_to_next`，`keep_as_is` 按 kind），无 `close_room`；过期 → `ended_no_agreement` | D15、C54 |
| PD-05 | 同房间追加轮 | 否决；终态 + `startFollowUp` 新房间；追加轮与修订 / 冲销列入 17 | D04、C3、U3 |
| PD-06 | 全 Opus 5.5，medium / low；$100 / $300；超限 `budget_exhausted` | 用户决策 U5，默认全 `claude-opus-5-5` + `medium`；run 美元上限用尽 → `rounds_exhausted(spend_limit)` | D09、D17、U5 |
| PD-07 | `procurement_rfq`（只做契约测试） | 默认同推荐；用户决策 U6 | D26、U6 |
| PD-08 | 可撤回需公开原因；7 天过期；reject 结束本轮 | 可撤回本人 approve（不需原因、`note` 只给本方）；不过期；reject 终局并结束本轮 | D02、D15、U7、C41 |
| PD-09 | 可兼任，审批不计两票 | 否决；不兼任 | D24、C35、U8 |
| PD-10 | 链接 + 默认绑定邮箱 | 默认邮箱定向；不知道邮箱时单次链接（fragment + `tokenHash` + 72h） | D24、C36 |
| PD-11 | 自动 3 次，再由该方本人重试 | 每回合链自动重试 ≤ 1 次；失败方本人 `retry_turn` | D15、D17、C55 |
| PD-12 | 上线前全买，设计按已采购写并留退路 | 默认同推荐；用户决策 U9 | U9 |
| PD-13 | 英文，文案外置，中文 v1.1 | 原样采纳 | D26 |
| PD-14 | 暂沿用 Speak for Me | 默认同推荐；用户决策 U12（`APP_NAME` 单点） | U12 |
| PD-15 | 判分模型 Opus 5.5 low | 用户决策，默认同推荐（16） | — |
| PD-16 | 不开 Anthropic 组织账号 | 用户决策，默认同推荐（15） | — |
