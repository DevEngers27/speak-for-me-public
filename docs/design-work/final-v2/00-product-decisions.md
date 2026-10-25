# 00 · 产品决策备忘录（给项目负责人拍板）

> 来源：任务书 00、inputs 05/06/07、candidates2 评委意见、deepdives 各专题及其 review、techstack ADR（D28/D31/D32/模型层）。本备忘录只列**技术上无法替你定**的事：每条给方案、后果、我的推荐、不拍板时的默认值、影响的章节。编号 PD-nn 会被 final-v2 各章引用。
> 约定：场景一 = 软件服务范围变更（customer / provider / finance）；场景二 = 用来验证插件边界的第二个场景。
> 分组：A 必须现在定（影响 schema 与协议，改起来要迁移）；B 可以用默认值先走（实现成本低、可后改）；C 以后再定。
> **canon 处置（canon 包修订 2026-10-24）**：本备忘录是限时草稿，写于 canon 之前。canon 已逐条处置：PD-01 / 03 / 13 原样生效；PD-02 / 04 / 06 / 08 / 10 / 11 只部分采纳；PD-05 与 PD-09 的推荐被否决；PD-06 / 07 / 12 / 14–16 仍是用户决策（canon part4 U1–U12 给出默认值）。被改写的条目在标题下以"canon："注明，逐条对照见 `00-product-decisions-part2.md` 末节"与 canon 的对照"。**各章一律以 canon 为准**，本文只保留为决策背景。

## A. 必须现在定

### PD-01 customer 能否看到预算数字
- 问题：finance 的预算上限 / 已承诺 / 余量，customer 能看到多少？数字、区间、还是只看"可行/不可行"？
- 为什么定不了：核心 1 要求"任何对他方可见的内容都经过显式披露决定"，但谁默认披露给谁是商业关系问题。inputs/07 有 16 条指出候选设计让 customer 通过"人工请求的选项"间接看到了 finance 未披露的数字。
- 方案：
  - a) 默认不披露，finance 可逐字段披露（cap / committed / headroom 三个开关）。隐私最好；customer 在选取舍选项时只看到"不可行"而看不到差多少；finance 多一步操作。
  - b) 默认披露 headroom 区间（如"$0–1,000"）。体验较好；但区间边界仍会随多次重算被二分出来。
  - c) 默认全披露给 customer（同一公司内部）。体验最好、实现最简单；跨公司场景不成立，场景二若是外部方则必须改回 a。
- 推荐：a。理由：披露开关是实现最简单的那一种（字段级 visibleTo），而且 a 能退化成 c（finance 把三个开关全打开），反之不行。
- 默认值（不拍板时）：a，fixture 里 finance 默认披露 `cap`、不披露 `committed/headroom`。
- 影响：02 域模型 `disclosure`、03 briefs/sharedFacts、05 人工请求选项生成、07 披露矩阵、14 fixture。

### PD-02 fit 信号与隐蔽信道政策
> canon：可见度取 (i) 只有 `ok` / `blocked`（U2 默认，原因类别是备选），不是推荐的 (ii)；每 run 每角色 `propose / counter` ≤ 4（不是 5）；"目录变更不自动重算"**否决**（会引入无人负责出口的等待态），改由节流与总量桶限制探针（D12 ⑥）；clarify 采纳 (α) 并扩大到任何角色都没有 `option_fits_constraints`（D12 ③）。
- 问题：provider 的代理与界面能看到多少"被规则挡住"的信息？是否对提案频率限流？clarify 是否允许问"这个价行不行"？
- 为什么定不了：spike C4 实测 itemKey 选择、日期、budget.over 各泄露约 1 bit，provider 反复提案可二分出预算；07 指出改目录价格 + 自动重算是零成本预言机。堵死全部信道会让协商体验明显变差（provider 不知道为什么被拒）。这是隐私 vs 成交效率的取舍。
- 方案（可组合）：
  - 可见度：(i) provider 只看到 `blocked`（不给原因）；(ii) 看到原因类别（预算 / 范围 / 日期）但不给参数；(iii) 看到裁剪过的参数（overByCents 等）。i→iii 隐私递减、成交率递增。
  - 限流：每个 run 内 provider 代理 propose/counter 上限 N（候选是 3–5）；provider 改目录价格不自动开 run，只标记"目录已变更，待 customer/finance 确认后重算"（堵住零成本预言机）。
  - clarify：(α) 禁止询问任何金额可行性，clarify 只能问范围语义与日期；(β) 允许问"候选 X 可行吗"但答复合并进限流计数；(γ) 不限制。
- 推荐：(ii) + 限流 N=5 + 目录变更不自动重算 + (α)。理由：(i) 实测让 stub provider 三轮全被拒后进死路（07"needs_input 死路"），(ii) 每次仅泄露类别不泄露量；限流与"目录变更需对方确认"把二分攻击成本抬到人工可察觉；(α) 让 clarify 不能成为第二条探针。
- 默认值：同推荐。若你选 (iii)，07 的 reasonCode params 要按受众裁剪（spike C4 已给出做法）。
- 影响：05 协议动作集与轮次、06 reasonCode 受众投影、07 事件可见性、09 约束变化触发、10 限流（rate-limiter 组件）、16 隐私金丝雀。

### PD-03 派生字段 `deferred` 的披露规则
- 问题：提案里"本次不做、延后"的条目列表（deferredItemKeys）是从 customer 私密的 required/niceToHave 推出来的。它对谁可见？
- 为什么定不了：07 出现频次最高（16 条）的缺陷就是它泄露 customer 未披露的偏好；但 provider 不知道什么被延后就写不出变更单。
- 方案：
  - a) 不存派生字段，提案只写"包含的条目"；"延后"只在 customer 自己的视图里现算。provider 变更单只列包含项。
  - b) 只有 customer 显式勾选"可共享"的 niceToHave 才进入 deferred；其余不出现在任何共享文本、事件、contentHash 里。
  - c) 全员可见（现状）——违反核心 1，否决。
- 推荐：a。理由：最简单且无泄露面；"延后项"本来就不是三方协议内容，它是 customer 的待办。b 要给披露 UI 加一层，并要把 deferred 纳入 contentHash（否则违反核心 3），复杂且仍有组合泄露。
- 默认值：a。
- 影响：03 proposals 字段（去掉 deferred）、06 computeTerms、08 变更单派生、13 customer 视图、14 模板。

### PD-04 人工取舍请求：出口集合与回答期限
> canon：采纳"出口由场景声明、选项只用提问对象自己的视图、7 天"；出口集合改为 D15 的 effect 表（`raise_cap` / `drop_items` / `extend_deadline` / `choose_candidate` / `disclose` / `retry_turn` / `pass_to_next` / `keep_as_is` / `end_run`），**没有** `close_room`；过期后 run → `ended_no_agreement`（不是新状态 `expired`），房间仍 `open`。
- 问题：代理 escalate 或系统无解时，向具体的人提出哪些可选出口？不回答多久算过期？过期后房间怎么办？
- 为什么定不了：出口集合决定了谁能被打扰（finance 加预算 / customer 砍范围 / provider 降价或改期）以及泄露了什么（07：选项由系统视角生成未经披露闸门）。期限是组织节奏问题。
- 方案：
  - 出口集合：(i) 固定四出口：`raise_cap`(finance)、`drop_items`(customer)、`move_date`(customer)、`close_room`(发起人)；provider 的"降价"不作为系统选项，只能由 provider 自己改目录。(ii) 由场景插件声明出口，引擎只提供"问题 → 单选 → 触发约束变更"的壳。
  - 选项内容：选项里出现的数字必须来自提问对象本人可见的字段（如给 customer 的 drop_items 选项不得带 finance 未披露的差额）。
  - 期限：72h / 7d / 不过期。过期后：自动关闭 run 为 `expired`（房间保留，可手工重开）或保持 waiting。
- 推荐：(ii)（引擎壳 + 插件出口，场景一注册上面四个）；选项按受众过滤；期限 7 天，过期 run 置 `expired` 且通知发起人，房间不关。理由：出口是场景知识，放插件才能验证场景二；7 天匹配审批轮次常见节奏（研究 06"审批轮有任务级期限"）。
- 默认值：同推荐，期限可配置项 `HUMAN_REQUEST_TTL_DAYS=7`。
- 影响：04 humanRequest 状态机、05 §7、06 插件接口 `requestExits`、09、12 `humanRequests.answer`、13。

### PD-05 已执行后的房间：谁能解除/重开，能否对已执行范围再协商
> canon：推荐的 (b) **否决**，v1 采用 (a) 的变体——执行后房间终态，后续变更经 `rooms.startFollowUp` 开新房间（预分配同三席、目录复制为 draft、基线预填），不引入 `executedScope`（D04、U3）；(c) 列入 17。
- 问题：执行完成后房间进入什么状态？谁能重开？新一轮协商是否可以再碰已承诺的条目（退回/替换）？
- 为什么定不了：07 有 6 条指出"执行后再 run 会重复承诺已执行范围"，根因是没定义"已承包范围"的产品语义。退单涉及财务冲销，是政策。
- 方案：
  - a) 执行即终态：房间 `executed` 后只读；要改需开新房间，新房间引用旧变更单；已执行条目在新房间里从 required 中扣除（引擎提供 `executedScope` 给插件）。
  - b) 同房间可重开追加轮（只能新增条目，已执行条目不可触碰），由发起人或 finance 重开。
  - c) 允许对已执行范围发起"修订变更单"（含释放承诺 release），需三方重新审批。
- 推荐：b 作为 v1，c 列为路线图。理由：b 覆盖"先做 LOGIN 再谈 REPORTS"的旅程 8，且用一条规则（候选 ∩ executedScope = ∅）就能守住不重复承诺；c 需要 release 账本与冲销审批流（研究 06 的 commit/release 分层账本可支撑，但 v1 不必）。
- 默认值：b；重开权限 = 房间发起人或任一 finance 成员。
- 影响：02 不变量、03 rooms.status / executions、04 房间状态机 R7、06 候选枚举排除 executedScope、08、09 §6、17。

### PD-06 模型、effort 与月度预算上限
> canon：仍是用户决策（U5），默认全 `claude-opus-5-5`、协商回合统一 `effort: 'medium'`（v1 无抽取路由）、dev $100 / prod $300 每月；run 的美元上限用尽不进 `budget_exhausted` 新状态，而是 customer 的 `rounds_exhausted` 请求（`questionKey: spend_limit`，D17）。
- 问题：全部路由用 `claude-opus-5-5`（techstack 模型层 A1，effort：propose/review=medium，extract=low）还是分级？每月模型花费上限多少？
- 为什么定不了：技能硬规则是"用户没点名就不得降级"；分级省钱但丢跨路由缓存并多一套回退语义；预算上限是钱。
- 方案：
  - a) 全 Opus 5.5 + 按路由 effort（推荐默认）。质量最高；一个 run（3 方 × ≤5 轮）估 $0.6–1.5（含缓存）。
  - b) 提议用 Opus、评审用 Sonnet 5.5：约省 30–40%，缓存按模型隔离。
  - c) 抽取/摘要用 Haiku 5.5：再省，但 Haiku 没有服务端回退，拒绝即转人工。
  - 预算封顶机制已定（先预留后结算），缺的是数字：建议 dev+preview 合计 $100/月、prod $300/月起，超限 run 进入 `budget_exhausted` 由人决定。
- 推荐：a，上限 dev $100 / prod $300 每月，评测跑完 low vs medium 后再定是否降 effort。
- 默认值：同推荐；评测判分模型在你决定前也用 Opus 5.5 low。
- 影响：10 模型调用规范与成本记录、15 用量告警、16 评测、18。

### PD-07 第二个场景选哪个
- 问题：用哪个场景验证插件边界？候选：活动预算 event_budget（组织者 / 场地方 / 财务）、采购询价 procurement_rfq（需求方 / 供应商 / 采购）、排班交换 shift_swap（两位员工 / 主管）。
- 为什么定不了：它决定引擎必须抽象到什么程度（角色数是否可变、是否有"目录"、审批人是否必须 ≥2）。抽象过头是过度设计，抽象不足则场景二要改引擎。
- 方案后果：event_budget 与场景一最像（三方、目录、预算），对边界考验最弱但实现最便宜；procurement_rfq 引入多供应商（角色实例数 >1），逼出 roleKey + 席位数抽象；shift_swap 没有金额，逼出"规则全在插件、引擎不含金额"的边界，但审批人只有 1 个会碰核心 3 的"必需审批人 ≥2"假设。
- 推荐：procurement_rfq 作为设计验证对象（只写 17 与契约测试 fixture，不实现 UI），理由是它恰好暴露场景一没覆盖的两点（同角色多席位、多个候选并排比较），而且不动"必须有金额与至少两个审批角色"的引擎假设。
- 默认值：procurement_rfq。
- 影响：06 插件接口、02/03 roleKey 与席位、05 多提案并排、16 契约测试、17。
