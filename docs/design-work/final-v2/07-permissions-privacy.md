# 07 · 权限、隐私与威胁模型（part1：目标与范围、决定总表）

> 分片：
> - `07-permissions-privacy.md`（本文件）：§7.0 目标与范围、§7.1 决定总表
> - `07-permissions-privacy-part2.md`：§7.2 信任边界、§7.3 资产、§7.4 攻击者模型
> - `07-permissions-privacy-part3.md`：§7.5 认证与授权（Clerk / proxy / 构造器 / `actorUserId`）、§7.6 成员、席位与邀请、§7.7 鉴权与房间状态错误码
> - `07-permissions-privacy-part4.md`：§7.8 披露模型（受众类、`sharedFacts` 披露账本、finance 三开关、派生值污点、显式解密清单 DX-1…DX-13）
> - `07-permissions-privacy-part5.md`：§7.9 字段 × 角色披露矩阵（全部表）、§7.10 受控投影 XP-1…XP-8
> - `07-permissions-privacy-part6.md`：§7.11 规则结论的可见性（fit / 掩码 / params 受众）与 `rooms.previewChange`、§7.12 动作 × 角色矩阵、§7.13 频率上界
> - `07-permissions-privacy-part7.md`：§7.14 代理上下文组装、§7.15 四条新泄露路径及防线、§7.16 公共文本、§7.17 事件可见性（PD-8）
> - `07-permissions-privacy-part8.md`：§7.18 查询投影纪律、§7.19 日志与错误纪律（logLines 下发浏览器）、§7.20 威胁清单 T-01…T-40
> - `07-permissions-privacy-part9.md`：§7.21 残余风险、§7.22 不变量、§7.23 备选与否决、§7.24 开放问题与待验证、§7.25 与 canon 的对照
>
> 底稿：`candidates/security/07-permissions-privacy*.md`（一表一受众、受控投影、非干扰定义、威胁模型）。吸收：`deepdives/privacy-disclosure*.md`（披露类、解密清单、矩阵、代理上下文、事件 PD-8、日志纪律）及其反驳 r01–r16 的全部修正、`spikes/README.md` §4/§6/§7 07 段/§8、`foundation/context-projection`。命名、关键决定一律以 `00-canon*.md` 为准；与底稿冲突处已改写，改写点在 §7.25 逐条列出。

## 7.0 目标与范围

**目标**：把任务书核心 1（私密委托）、核心 2（代理只建议）和核心 4 中"权限由代码校验"变成可执行、可测试的规则：

1. 谁能登录、谁能进哪个房间、以什么角色、能调用哪个函数（认证 vs 授权）。
2. 每张表的每个字段对谁可见；派生值（余量、可行性、候选集、人工请求选项、规则结论）对谁可见；跨角色的值经过哪条显式披露路径。
3. 代理上下文里有什么、没有什么；他方撰写的唯一文本怎样进入；代理输出能影响什么。
4. 对他方可见的文字只从哪里来；事件、日志、错误信息、浏览器负载里能出现什么。
5. 威胁 → 防线 → 测试的完整映射（测试编号对应 16 章）。

**范围外**：表的完整字段与索引（03）、迁移守卫细节（04）、协议消息完整 schema（05）、规则检查实现（06）、执行事务（08）、运行时细节（10）、函数目录全量签名（12）。本章对它们提出接口要求，并在 §7.24 列出需要对齐的点。

## 7.1 决定总表

| # | 决定 | 理由（一句） | 来源 |
| --- | --- | --- | --- |
| PV-01 | 认证只在 Clerk（原生集成，`aud = "convex"`），授权只在 Convex 函数内；`proxy.ts` 只做页面的乐观登录跳转；任何 Route Handler 自己调用 `auth()` 并返回 401 JSON，不依赖 proxy | spike 实测 `auth.protect()` 对 API / JSON 请求也是 307 到登录页，而不是 404；页面跳转只影响体验，不是防线 | inputs/05 B9、spikes §3、techstack D23 |
| PV-02 | 所有公开函数经 `convex/lib/functions.ts` 的构造器 `userQuery / userMutation / memberQuery / memberMutation / anonQuery` 定义，内置鉴权与 `withSanitizedErrors`；公开函数参数里没有 `userId`、`role`、`actorUserId`；被调度的 internal 函数没有身份，必须显式接收 `actorUserId`，鉴权在调度前完成 | spike 实测被调度 mutation / action 内 `getUserIdentity()` 为 `null`；鉴权不可遗漏只能靠单一入口 | canon D21、§1.2 `actorUserId`；inputs/05 B4；techstack D08 |
| PV-03 | 一人一房一席、一席一人；邀请默认邮箱定向（`identity.emailVerified === true`），不知道邮箱时用单次链接（token 在 URL fragment，只存 `tokenHash`），72h；v1 不支持兼任与换人 | 同一人满足两个必需审批角色会击穿核心 3；路径里的 token 会经 `redirect_url` 进日志 | canon D24、C35、C36 |
| PV-04 | 披露类是字段的属性，写成代码常量 `DISCLOSURE`（引擎表由引擎声明、场景字段由场景声明），受众类五种：`room` / `roles` / `self` / `creator` / `system`；注册表必须覆盖 schema 的每个字段，由测试对账 | 矩阵变成代码后，投影、上下文组装、金丝雀测试都从同一份声明派生，不会漂移 | privacy-disclosure PD-1、review r08；canon D11 |
| PV-05 | 跨角色的私密值只经两条显式披露路径：① provider 确认目录（`catalog.confirm` 即披露该条目的 title / 价格 / 工期）；② `sharedFacts` 披露账本（由 `briefs.confirm` 的逐字段勾选、`sharedFacts.add`、`humanRequests.answer` 的 `disclose` 选项写入，全部经写入闸门）。没有第三条路径。投影代码从不读取他方 `briefs` 行 | 核心 1 要求"显式披露决定"；把"谁能看到什么"的真相收敛到一张只追加表，审计面最小 | canon D11、D15、§1.1 `sharedFact`；spikes §7 02 段 |
| PV-06 | 派生值继承其输入中最严格的披露类；例外只能出现在显式解密清单 DX-1…DX-13（§7.8.6），清单含"可行性 1 bit"、"等谁"、counter 转发结局与 `choose_candidate` 复核结局；代码常量 `DECLASSIFIED` 的键集合与清单逐项相等（TC-PRIV-05 元断言） | 泄露常发生在派生值：候选集、余量、阻断原因、请求选项 | privacy-disclosure PD-3；canon D11、D12 |
| PV-07 | finance 预算数字（`capCents`、`committedCents`、`headroomCents`）各有一个字段级披露开关，默认全关（U1）；fixture 中 finance 只把 `capCents` 披露给 customer；provider 永远拿不到任何预算数字或可反推它的派生值 | `customerSeesBudget` 是用户决策；开关能退化为"全披露"，反之不行 | canon D12 ④、U1、C27 |
| PV-08 | 规则结论投影：provider 对任何提案只见 `fit: 'ok' \| 'blocked'`，无 reasonCode、无 checkId、无 params；其他角色按"检查所有者"掩码：查看者是所有者或已获全部输入的披露 → 原码 + 受众裁剪后的 params，否则 `{ code: 'private.constraint_unmet' }`，通过的掩码检查直接省略；params 按受众白名单 fail-closed | 每个提案对 provider 至多泄露 1 bit；原码与 params 是余量 / 截止日的直接通道 | canon D11、D12 ①、§1.5 |
| PV-09 | `rooms.previewChange` 只对 finance（发起上限变更、且新结论只依赖其自有输入与已知 fit）返回 `verdictAfter`；其他角色只得到 `{ verdict: 'recheck', invalidatedApprovals }` | 对 customer / provider 返回结论等于零成本预言机 | canon D12 ② |
| PV-10 | 代理上下文单一入口：`buildAgentContext` 只消费 `viewFor(turn.role)` 与 `turn.candidateSnapshot`（回合创建的 mutation 写入）；他方撰写且进入上下文的唯一字符串是目录 `title`（定界 + 转义）；代理输出（动作、`reasonKey`、`topicKey`、`rationale`）只给本方；对他方代理的反馈只有公开提案、`fit` 与不带角色和原因的 `not_accepted`；他方代理的动作与理由同样**不渲染给他方的人**（14 §3 / §8.5、13 §13.5：provider 的人只见 "v{n} not accepted" 或轮次结局，不见 "Customer agent declined"，privacy-04） | 关闭"代理说出委托人私密值"与"跨代理注入"两条主通道 | canon D10、D13；privacy-disclosure PD-7/PD-10 + r09 |
| PV-11 | 对他方可见的文字只由 `renderPublicText(templateKey, fields)` 从白名单结构化字段渲染，模板按受众分变体，参数类型不含自由 `string`；"模板不碰私密字段"用三层证明：品牌类型、显式取字段 + 运行时复核、Proxy 读取测试对账 `reads` | spike 证伪"TS 结构类型足以证明模板不碰私密字段" | canon D13；inputs/05 C5 |
| PV-12 | 事件采用 PD-8：`events` 对房间成员全部可读，没有 `visibility` 字段；`payload` 只含 room 类字段；私密细节经 `restrictedRef` 在 `timeline.page` 渲染时按查看者连接；每个私密值按**它所属的版本**的披露判定是否可渲染（禁止溯及既往）；由他人引起的约束变更提交对 provider 只渲染一条无作者的 "Constraints changed (vN)"，同一提交的 `brief_confirmed` / `human_request_*` / 受众外 `disclosure_changed` 并入其中，他人简报版本号对 provider 为 `null`（DX-7、§7.17，privacy-02） | 存储层没有"部分可见事件"，分页无需过滤，漏写过滤也不会整条泄露 | canon D14、C29；candidates1 评委"事后披露泄露历史值" |
| PV-13 | 公共 query / mutation 只返回逐字段挑选的 DTO（禁止 `...doc`）；声明 `returns`，但 `returns` 只作测试期探测器，不称运行时防线 | `returns` 校验失败的消息可能回显被拦字段 | privacy-disclosure PD-9 + r10；techstack D12 |
| PV-14 | 公共函数内的日志与异常消息视为"发给调用者浏览器"：禁止 `console.*`，非 `ConvexError` 一律经 `withSanitizedErrors` 变为 `ConvexError({ code: 'internal' })`；日志分两个入口（15 §15.6 唯一定义）：internal / action 路径用要求 `InternalCtx` 品牌参数的 `opsLog(ctx, code, SafeLogFields)`，公开路径只能用 `publicOpsLog(code: PublicOpsCode, { fn, errorClass })`（闭集码、恰三个键、不收数值），ESLint 禁止公开构造器可达的模块 import `opsLog`（§7.19 E1，privacy-10） | convex 客户端源码证实 `logLines` 与 `errorMessage` 随响应下发并打印到调用者浏览器 console（dev 实证，prod 待验证） | canon D16；privacy-disclosure r02 |
| PV-15 | 写入时语义闸门：日期窗口 `localDate ≤ d ≤ localDate + 365`、itemKey 必须是已确认目录成员、目录 title `^[^<>\r\n]{1,80}$`、文本 NFC 并按码点计长、`sharedFacts` 闸门 | spike 实测合法格式的日期、伪 itemKey、shared fact 都能搬运秘密 | canon D12 ⑧；inputs/05 C3 |
| PV-16 | 隐蔽信道不靠"堵死"而靠"量化上界"：每 run 每角色 ≤ 4 次 `propose / counter`；约束变更类写入每用户每房间每小时 ≤ 6 次（D12 ⑥，只决定速率）；**总量**由每房间每 24 小时的桶封顶——`price_writes`（改价 / 改工期 / 增删目录 ≤ 3 批）、`setCap` 与 customer 硬字段共用 ≤ 6 次、`run_starts` ≤ 6 个 run（§7.13、12 B7）；超限一律 `run.rate_limited`；每次约束变更对全体成员可见并使审批失效，但变更者身份对 provider 不可见（DX-5 / DX-7） | 合法选择里的约 1 bit 信道无法消除；只有速率限制时 provider 约 2.3 小时即可把余量二分到 $1（privacy-01），总量桶把它压到每房间每天有限的 bit 数，并让探测可被人察觉 | canon D12 ⑤⑥；spikes §8 末段；privacy-01 |
