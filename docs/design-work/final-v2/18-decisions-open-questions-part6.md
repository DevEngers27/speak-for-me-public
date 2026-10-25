# 18 · 决策记录（part6）：ADR-D22…D27

> 分片见 `18-decisions-open-questions.md` 顶部。

## ADR-D22 时间、today 与跨午夜

- **背景**：评委 9 条 FF-06：交付日 `today + leadDays` 每次重算，审批跨过房间时区午夜即永久 `NOT_EXECUTABLE`，且没有任何路径 bump 或重谈；草稿 R-I 把 `todayAnchor` 放进硬投影（每日午夜作废全部审批）；techstack D11 / D37：query 读 `Date.now()` 会返回陈旧结果；冲突 C7。
- **选项**：A 每次校验按当天 today 重算交付日；B `todayAnchor` 进投影、每日 cron bump；C 交付日在提案插入时物化为绝对日期、`rooms.localDate` 由调度推进、只在时间结论翻转时 bump。
- **决定**：C。引擎输入 `today: IsoDate` 由调用方传入，调用方一律传 `rooms.localDate`：规则检查、候选枚举、提案物化在 query 与普通 mutation（含 `approvals.record` 的纵深防御重算与执行）中都读它；只有 `rooms.create`、`clock.rollLocalDate` 及其事务 helper `rollLocalDateTx` 用 `todayInTimeZone(Date.now(), room.timeZone)` 计算真实日期；物化条款的 mutation（`insertProposal`、`choose_candidate`）在物化前若发现真实日期已超过 `localDate`，先同事务 `rollLocalDateTx`（结论翻转则 bump）再物化；其余 mutation 读 `Date.now()` 只用于判定过期。交付日 = `localDate(插入日) + max(leadDays)`，之后不重算；日期检查只有 `deliveryDate >= localDate`（`date.in_past`）与 `deliveryDate <= deadline`；审批与执行不因跨午夜而失效。`clock.rollLocalDate`（每小时 cron，或各房间本地午夜 `runAt`）推进 `localDate`，若推进后当前 `pending_approval` 提案或 open 请求选项的时间结论翻转（交付日已过 → `date.in_past`、`extend_deadline` 选项的日期已过；v1 目录没有 `validUntil`，报价有效期列入 17），则 `constraints.bump(cause: 'clock')` 走 D06；`localDate` 本身不在硬投影里。房间时区建房后固定。
- **被否决**：A——FF-06；B（**C7**）——每天作废全部审批；query 内 `Date.now()`——缓存语义不刷新。
- **后果**：正面——跨午夜不再静默失效；时间引起的失效与其他约束变化走同一条可追溯路径。代价——需要推进 `localDate` 的本地午夜 `runAt` 与小时兜底 cron；query 与 mutation 读同一个 `localDate`，结论一致，午夜后的滞后窗口由物化前的 `rollLocalDateTx` 消除。关闭评委反例：FF-06（以及 FF-07 中"全员 recommend_accept 但跨日后评估失败、run 卡在 negotiating"一支）。待验证：§18.5 V-R03（Convex 运行时 `Intl.DateTimeFormat` 的 `timeZone` 支持，V-D2；不通过则只存偏移并写明 DST 局限）、`runAt` 触发精度、dev 部署是否运行 cron。

## ADR-D23 预算低于已承诺：拒绝写入

- **背景**：inputs/02 与事件溯源 / 运行时候选主张"允许写入并进入 `needs_input`"；草稿 R-B 与极简 / 资金 / 插件 / 产品 / 安全候选主张拒绝；评委 FF-16：`committed ≤ cap` 被违反（校验用旧外部已承诺额；外部台账条目不查上限、不幂等）；冲突 C32。
- **选项**：A 允许写入并进入 `needs_input`；B 拒绝写入。
- **决定**：B。`budget.setCap` / finance `briefs.confirm` 中 `capCents < committedCents` 直接拒绝（`budget.below_committed`，`params.minAllowedCapCents` 只给 finance），不 bump、不写事件；`below_committed` 不是可达状态，fixture 不得用 seed 伪造；规则引擎保留同名码作为纵深防御。校验口径："新上限 vs 当前台账求和"，台账只有 setup 阶段一次性的 `baseline` 与执行写入的 `commit`。现实中的超额削减属于系统外处理或 17 E2 的冲销流程。
- **被否决**：A（**C32**）——系统内没有合法出路，且使"余量恒 ≥ 0"失效。
- **后果**：正面——`committedCents ≤ capCents` 恒成立，可在对账检查（08 R1–R11）里断言。代价——finance 无法在系统内记录"已超支"的现实，只能先走冲销（v1 没有）或系统外处理。关闭评委反例：FF-16（外部台账条目不再存在：基线只录一次，其余条目只由执行写）。

## ADR-D24 成员、席位与邀请

- **背景**：PD-09b 主张成员可兼任、审批不计两票；PD-10 主张链接 + 默认绑定邮箱；techstack D20–D23 与 identity-auth review（token 放路径会经 `redirect_url` 与日志泄露；`email_verified` claim）；research：NIST AC-5 职责分离；冲突 C35 / C36。
- **选项**：允许兼任多角色；邀请 token 放路径 `/invite/[token]`；Clerk Organizations 表达角色；邮箱定向邀请为默认、单次链接（fragment）为备选。
- **决定**：一人一房一席、一席一人（`members` 上 `(roomId, userId)` 与 `(roomId, role)` 两条逻辑唯一，由事务 helper `addMember` 单一写入口 + 先查后写 + 房间写锁 / OCC 保证；`addMember` 被 `rooms.create`、`invites.accept`、`rooms.startFollowUp` 三处调用）；同一 `userId` 不能满足两个必需审批角色（D02 的第二道防线）。邀请默认邮箱定向（`invitedEmail` 必填、无 token，被邀请人登录后按已验证邮箱列出并接受，`identity.emailVerified` 必须为 true）；不知道邮箱时用单次链接，token 放 URL fragment（`/invite#t=…`），邀请页不调 `auth.protect()`、`Referrer-Policy: no-referrer`，只存 `tokenHash`（在 action 中生成随机数与哈希）；72h 过期。creator 无额外审批权；v1 不支持换人与解绑。Clerk 只做认证（原生集成 `aud="convex"`，不用 Organizations）；`users` 以 `tokenIdentifier` 为键，用户入库走 `users.ensureViewer` mutation（techstack D23）而非 webhook。
- **被否决**：可兼任（**C35**）——审批守卫要多一套"同人不计两票"例外路径；路径 token（**C36**）；Organizations——第二个权限真相源。
- **后果**：正面——"知道 roomId 自封 finance""一人多席凑齐三方批准"在结构上不可能。代价——演示需要三个 Clerk 账号（fixture 用 `--identity`）；换人要关房重建（17 E10）。待验证：`email_verified` claim 在 Clerk dev 实例的实测（techstack O8，§18.5 V-R30）、mutation 内 `crypto` 可用性（V-R04，退路即"token 在 action 中生成"）、上线前解码生产 token 核对 `iss`。

## ADR-D25 提案不可变性、`termsKey` 与来源快照

- **背景**：冲突 C23（sha256 `contentHash` vs 规范串 `termsKey` vs `contentKey`）、C38（加急费是插件常量还是目录修饰项）；评委 FF-19（加急费未经 provider 确认却计入金额）、FF-37（报价未绑定范围定义版本）、FF-40（规范化键不覆盖派生字段，执行内容与批准内容不同）；rules-engine review r04 / r05。
- **选项**：sha256 `contentHash`；规范串 `termsKey`；执行时重算任务模板；按 revision 比较来源；加急费常量 vs `catalogItem(kind: 'modifier')`。
- **决定**：`proposals` 行写后不改（只有 `status` 经迁移表变化）；`terms = { itemKeys[], modifiers[], deliveryDate, amountCents }`，`lines[] = {itemKey, revision, title, priceCents, leadDays}` 与 `plannedTasks[]`（由插入时的 `taskTemplates` 派生）一起快照；`termsKey = canonicalJson(terms)`；`amount.claim_mismatch` 用"快照金额 vs 按 `lines` 重算"发现；`version.stale_source` 用"`lines[].revision` vs 当前目录"发现（由 D05 的 bump 保证它只在守卫层出现）。rush 等加急是 provider 确认的 `catalogItem(kind: 'modifier')`；计费口径由 14 定（默认整单一次）。候选身份 `candidateKey = canonical(itemKeys, modifiers)`；同一 run 内重复提出已阻断 candidateKey → `action.repeats_blocked`。
- **被否决**：sha256 `contentHash`（**C23**）——运行时待验证且无收益；执行时重算任务模板——所见非所写；按 revision 比较来源导致续期即 stale（canon 原文所列否决项）；加急费插件常量（**C38**）。
- **后果**：正面——审批绑定的就是执行写入的；标题与任务模板改动不影响在审提案。代价——提案行稍大（含快照）。关闭评委反例：FF-19、FF-37、FF-40，并与 D05 关闭 FF-10、与 D06 关闭 FF-33。残余：canon 原文同时写"`version.stale_source` 比较 `lines[].revision`"与"否决按 revision 比较（续期即 stale）"；03 / 06 / 09 以"定价修订号 + `editNo`"调和（标题与任务模板编辑只增 `editNo`、不改定价修订号），需 canon §1.1 补列（§18.4 N-09，canon_objections；该调和的完整决定记录见 §18.6 ADR-X02）。

## ADR-D26 范围取舍：v1 包含什么

- **背景**：PD-06 / 07 / 13；各候选 ADR（finance 代理是否保留）；negotiation-protocol D9；testing-ops TD-3；冲突 C42（简报 LLM 抽取在 v1）。
- **选项**：v1 做 LLM 抽取、通知、有效期；第二场景 `event_budget` 写到骨架；finance 代理不调模型。
- **决定**：三方代理都调用模型（finance 代理只做评估与解释，产品文案如实写"预算由代码校验"）；stub 与 live 共用 `AgentDriver.decide(input)` 与全部下游，`replay` / `scripted` 驱动只在测试；简报由结构化表单填写，LLM 抽取列入 17；审批有效期、报价有效期、通知、成员更换、多席位、跨房间预算、外部集成、修订 / 冲销、哈希链外部锚点全部列入 17；v1 只有 `scope_change`，第二场景只写 `procurement_rfq` 契约测试 fixture（U6）；界面英文、文案外置（PD-13）。
- **被否决**：v1 做抽取 / 通知 / 有效期（**C42**）——扩大泄露面与范围；`event_budget` 骨架——引出同人多 kind 等伪问题。
- **后果**：正面——攻击面与实现范围收敛到核心 1–8。代价——用户填结构化表单、没有邮件提醒（收件箱是唯一渠道）。关闭评委反例：FF-32 部分（只有一个场景，边界由契约测试检验）。相关用户决策：U5、U6、U12。

## ADR-D27 首个场景 fixture 数字

- **背景**：冲突 C37：fixtures-walkthrough / 插件 / 代理质量 / 隐私金丝雀候选各有一套目录数字，彼此不一致且脱离已实测的走查；protocol-rules spike 已复现 README 数字。
- **选项**：protocol-rules 数字为主 + 金丝雀叠加；fixtures-walkthrough 的 $450 / $300 / $500 / $150 目录与"主线不压边界"原则。
- **决定**：主 fixture = protocol-rules：目录 5 项合计 $1,400（必需 `sso_login` + `audit_log_export` = $800，+`usage_dashboard` = $900）；截止 2026-11-20（相对锚点存储）；上限 $5,000 / 基线已承诺 $4,000；主线：v1 $900 → finance 降到 $4,800（cv+1）→ 旧提案 `version.stale_constraints` + `budget.over`、已有审批 stale → stub counter 只含必需项 $800（恰等于余量）→ 重批 → 执行；变体：$4,700 → `escalate / infeasible` → finance `raise_cap` 请求、零模型调用；$4,799.99 → `budget.over`；$3,900 → `below_committed` 拒绝写入；canary 变体叠加三方金丝雀串与奇数美分（如 481,237）并过 `lintCanaries`；标题注入变体。
- **被否决**：其他候选的目录数字（**C37**）；"主线不压边界"——边界恰等于上限是核心规则，必须在主线被看见，"不压边界"的担忧由减一分变体覆盖。canon 包修订（2026-10-24）另否决"3 条审批 stale"与"stub counter $800"（**C57**：第三票同事务执行，下调时至多 2 条 `stale_approve`；$800 是 provider 在 run 2 的 propose）。
- **后果**：正面——走查已由 spike 实测复现，14 / 16 / 13 / 01 共用同一组数字。残余已消除：canon D27 已按真实流程改写（C57）——第三票同事务执行，下调时只有 customer、provider 两条 `stale_approve`、finance 待批；$800 由 provider 在剔除阻断键的新快照中直接提出（N-04 已解决）。
