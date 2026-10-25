# 18 · 待验证清单（part8）与收尾

> 分片见 `18-decisions-open-questions.md` 顶部。阻塞级别：**M0** = 实现第 1 周必须有结论（否定即改设计）；**实现中** = 对应模块实现前；**上线前** = 首个真实用户进 prod 前。

## 18.5 待验证清单

### 18.5.1 spikes §8：必须在真实部署上验证的 18 项

| # | 领域 | 待验证项 | 影响章 | 验证方式 | 级别 |
| --- | --- | --- | --- | --- | --- |
| V-01 | Convex | OCC：并发 `approvals.record` / `executions.executeIfComplete` / `runs.start` 在空索引区间上后提交者是否冲突重试并看到前者插入，最终只有 1 行 | 03、08、10 | dev 部署单进程多 `ConvexHttpClient` 并发调用同一业务键并计数，记录 `maxOverlap ≥ 2` | M0 |
| V-02 | Convex | 被调度 action at-most-once 不重试；被调度 mutation 遇瞬时错误自动重试且 exactly-once | 04、10 | 注入可控失败，观察 `_scheduled_functions` 与业务表 | M0 |
| V-03 | Convex | 生产中被调度函数同样没有调用者身份 | 07、12 | 调度一个记录 `getUserIdentity()` 的函数 | M0 |
| V-04 | Convex | 事务限额、action 超时、生产错误格式（`ConvexError.data` 原样到达前端） | 08、10、12、13 | dev / prod 类型部署 + 前端调用；`getTransactionMetrics` | M0 |
| V-05 | Convex | `NaN` / `Infinity` 写入 `v.number()` 的行为 | 03、06 | dev 部署直接写入 | 实现中 |
| V-06 | Convex | 默认运行时 `crypto.subtle.digest` 可用性；`"use node"` 差异 | 06、10、17 E3 | 部署计算 SHA-256 的 query / mutation（v1 已用 `termsKey` 规范串规避） | 实现中 |
| V-07 | Convex | zod 4 进入 Convex 函数后的包体积与冷启动 | 10、11 | 推送后看部署大小与首调延迟 | 实现中 |
| V-08 | Convex | 真实 codegen 与离线 `_generated` 一致；连字符模块路径（场景目录在 `convex/` 外已规避） | 11 | 连 dev 部署跑 `convex dev` 后 diff | M0 |
| V-09 | 组件 | 平台中断时 workpool / workflow 的检测与上报、`onComplete` 语义（仅在升级时需要，17 E4） | 04、10 | dev 部署故障注入 | 升级前 |
| V-10 | Convex | 客户端断线重发、订阅推送、`_creationTime` 与提交顺序、`commitTs` | 03、13 | 浏览器端到端 | 实现中 |
| V-11 | 隐私 | 真实 WebSocket 负载、Convex 日志、`ConvexError` 消息的金丝雀扫描 | 07、16 | 三种身份订阅 `rooms.view` 等并抓包扫描 | 上线前 |
| V-12 | Clerk | 原生集成 `aud=convex` 的真实登录、`applicationID` 校验、缺变量时推送报错形态 | 07、11、15 | Clerk 开发实例 + dev 部署 | M0 |
| V-13 | Claude API | strict schema 是否被接受（`anyOf` 分支内 `const`、`format: date`、六个分支、约 7 KB） | 05、10 | 预发布少量真实调用 | M0 |
| V-14 | Claude API | 解码是否真正强制 `const` / `enum` 与 `additionalProperties:false` | 05、07 | 诱导性提示统计 `schema_mismatch` | 实现中 |
| V-15 | Claude API | `effort` 下 thinking token 量、`max_tokens: 16000` 是否够用、拒绝率与 schema 违规率 | 10、15 | 预发布批量跑 fixture | M2 |
| V-16 | Claude API | SDK 内部重试的失败尝试是否计费；`model_context_window_exceeded` 触发；`fallbacks` + `output_config.format` | 10、15、17 E13 | 预发布 + 账单核对 | M2 |
| V-17 | 模型行为 | 注入 soft 断言；真实模型是否只引用给定 `optionKey`、是否倾向 `escalate` | 05、07、16 | 预发布用 `claude-opus-5-5` 跑语料，只断言结构性质 | M2 |
| V-18 | Next / CI | GitHub CI 实跑（`actions/checkout@v7` 等）；`pnpm dev` / Turbopack HMR | 11、15 | 推到测试仓库跑一次 | M0 |

### 18.5.2 techstack §6（O1–O3 为采购决策，见 U9）

| # | 待验证项 | 影响章 | 验证方式 | 级别 |
| --- | --- | --- | --- | --- |
| V-T04 | 不同事务的 `commitTs` 是否唯一（决定 L1 迁移 UNIQUE 键是否带 `roomId`） | 03、D14 | dev 部署高并发写事件后统计重复 | 实现中 |
| V-T05 | Convex 运行时 `Intl.DateTimeFormat` 的 `timeZone` 支持（V-D2） | 06、09、15、D22 | 部署一个用 `formatToParts` 计算房间本地日期的 mutation | M0 |
| V-T06 | `use-intl` 与 `next-intl` 对照 spike | 13 | 实现前最小 spike | 实现中 |
| V-T07 | 03 / 05 是否接受结构化公共文本 `{templateKey, params}` | 03、05、13 | 设计评审（canon D13 已采纳模板化） | M0 |
| V-T08 | Clerk dev 实例 `email_verified` claim 实测；上线前解码生产 token 核对 `iss` | 07、12 | Clerk 开发实例 + `/setup` 显示 claim 名 | M0 / 上线前 |
| V-T09 | 非 Pro 计划能否 `npx convex export`；`_generated/schema` 是否生成；shadcn Base UI `Button` 是否透传 `focusableWhenDisabled`；pnpm symlink 下显式 glob 的必要性 | 15、11、13、16 | 各做一次最小实验 | 实现中 |
| V-T10 | `@anthropic-ai/sdk` 1.1.0 → 1.3.x 的升级时点（升级前重跑 PROBE / 结构化输出 / 参数 400 用例） | 10、D20 | 回归套件 | 实现中 |

### 18.5.3 专题 review 新增

| # | 待验证项 | 来源 | 影响章 | 验证方式 | 级别 |
| --- | --- | --- | --- | --- | --- |
| V-R01 | query / mutation 的 `logLines` 与失败 `errorMessage` 在 **prod** 类型部署是否下发浏览器 | privacy r02 | 07、12、15、16 | prod 类型部署中故意 `console.log` 金丝雀并抓 WebSocket 帧 | M0 |
| V-R02 | `returns` validator 是否拒绝多余字段、校验失败消息是否回显被拦字段；convex-test 是否执行 returns 校验 | privacy r10、frontend C2、VA V8 | 12、13、16 | dev 部署故意多返回一个金丝雀字段 | M0 |
| V-R03 | 同 V-T05 | rules C1、scenario #10 | 06、09 | — | M0 |
| V-R04 | mutation 内 `crypto.getRandomValues` / `crypto.subtle` 可用性（邀请 token；v1 在 action 中生成） | fixtures review、identity | 07、12 | 部署探针 | 实现中 |
| V-R05 | 生产部署是否把非 `ConvexError` 消息遮蔽（取决于部署类型） | frontend C14、testing C15、idempotent #6 | 12、13、16 | prod 类型部署故意抛普通 Error | M0 |
| V-R06 | Convex 运行时是否提供 `AbortSignal.timeout`（退路 `AbortController` + `setTimeout`） | run-lifecycle r05 | 10 | action 内探针 | 实现中 |
| V-R07 | 平台中断后 `_scheduled_functions.state` 是否变为 `failed` | run-lifecycle #4 | 10 | 故障注入 | 实现中 |
| V-R08 | `v.id("_scheduled_functions")` 作为应用表字段能否推送（`normalizeId` 为退路） | run-lifecycle #12 | 03、10 | 推送 schema | 实现中 |
| V-R09 | 同一 mutation 内索引区间查询能否看到本事务刚插入的行（read-your-writes） | VA V1 | 09、D05 | convex-test + dev 部署 | 实现中 |
| V-R10 | OCC 持续冲突的重试次数与错误形态 | idempotent #4 | 08、12 | 热点写压测 + `npx convex insights` | 实现中 |
| V-R11 | 单事务实际读写上限（最大 fixture 的执行 mutation 与 `seed.reset` 单批） | idempotent #12、testing r11 | 08、15 | convex-test `transactionLimits: true` + `getTransactionMetrics` | 实现中 |
| V-R12 | convex-test `withIdentity` 是否接受传入 `tokenIdentifier`、假时钟 API | privacy #7、testing V1 | 16 | 安装后读类型 | M0 |
| V-R13 | Clerk 的 Playwright 多测试用户登录（`@clerk/testing` / testing token） | frontend C13、testing C16 | 13、16 | 读文档 + 试一次 | 实现中 |
| V-R14 | Convex 客户端对同一服务端时刻多个 query 更新是否原子应用（设计不依赖） | frontend C1 | 13 | 记录渲染次数 | 低 |
| V-R15 | 静默断网的检测时延（约 60s）；Playwright `setOffline` 是否关闭已建立的 WebSocket | frontend r06 | 13、16 | E2E 实测 | 实现中 |
| V-R16 | query 中 `Date.now()` 的缓存与重跑语义（设计已禁止在 query 中读时钟） | rules C2、scenario r08 | 06、13 | 文档 + 实验 | 低 |
| V-R17 | `npx convex env set` 后函数何时读到新值 | testing C14 / V12 | 15 | 设置后立即读 | 实现中 |
| V-R18 | Convex log streams 在当前计划可用 | testing C17 / V15 | 15、U9 | 读文档 | 上线前 |
| V-R19 | Opus 5.5 回合 p50 / p95（定看门狗期限与 U4 预期） | testing C19 / V17 | 10、15 | L4 至少 10 次 | M2 |
| V-R20 | action 内 `Promise.all` 多个 `runMutation` 是否真正并发提交 | testing C7 / V7 | 16 | 记录开始 / 结束时间与 OCC 重试 | 实现中 |
| V-R21 | `ConvexHttpClient.setAdminAuth` 与 deploy key 取得 admin key 的方式 | testing V19 | 16 | dev 部署试一次 | 实现中 |
| V-R22 | preview 类型部署默认环境变量的设置方式与生效时机 | testing V20 | 15 | 试一次 | 实现中 |
| V-R23 | 真实平台上 action 内 `runQuery` / `runMutation` 是否继承调用者身份 | testing V21 | 07、16 | 探针 | 实现中 |
| V-R24 | `v.any()` / 嵌套对象的深度与单文档 1 MiB 上限的确切值 | scenario #5 | 03 | 推送大文档 | 实现中 |
| V-R25 | `ctx.scheduler.runAt` 的触发精度（`clock.rollLocalDate`、请求 TTL） | scenario #9 | 09、15 | dev 部署观测 | 实现中 |
| V-R26 | dev 部署是否运行 cron；缺少必需环境变量时 deploy 是否失败 | research §6-18 | 15 | 试一次 | M0 |
| V-R27 | 结构化输出 schema 的编译缓存按什么判定同一性（D09 使 schema 只随 role / turnKind / n 变化） | negotiation r09 | 05、10 | 预发布观测首调延迟 | M2 |
| V-R28 | 部署 action 的并发配额与调度积压对看门狗期限的影响 | run-lifecycle r05 / r07 | 10 | dev 部署压测 | 实现中 |

## 本章不变量

1. 每条 ADR-Dnn 与 canon Dnn 一一对应，且不新增 canon 之外的决定；各章在 canon 未覆盖处做出的重大决定（改变并发模型、新增实体 / 表、在只追加纪律上开例外）必须以 ADR-Xnn 登记在 §18.6，注明所在章与需要 canon 吸收的 N 编号，且不推翻任何 canon 裁决。
2. 每条 C1–C42 恰好在一个 ADR 的"被否决"中出现，C44–C60 同样出现在 §18.2 第二张索引表所列 ADR 的"被否决"中（C43 是文档纪律，不进 ADR）。
3. 每条评委 fatal_flaw 至少归入一个 FF 类，每个 FF 类要么被 ADR 关闭、要么标"部分 / 未关闭"并进入 §18.4。
4. 每个待验证项都有影响章、验证方式与阻塞级别；任何 M0 项被否定，先改设计再进入 M1。
5. 一个开放问题只在一处有文字：并入 N / U / V 的章节条目在 §18.4.3 只保留编号映射。

## 与 canon 的对照

| canon | 本章落实 |
| --- | --- |
| part2–part4 D01–D27 | part2–part6 的 ADR-D01…D27，各含背景 / 选项 / 决定 / 被否决 / 后果 |
| part5 C1–C60 | §18.2 两张索引；C1–C42 与 C44–C60 在对应 ADR 的"被否决"中以 **Cnn** 标出 |
| part4 U1–U12 | §18.4.1 |
| canon 未覆盖、由各章做出的重大决定（细化而非偏离） | §18.6 ADR-X01 房间写锁、X02 `revision` + `editNo`、X03 `constraintRevisions` / `rawOutputs`、X04 `privacy.redact`；原需 canon 吸收的 N-09、N-31…N-33 已解决（canon §1.1 / §1.2 / D18） |
| part7 18 must_absorb | 每条 ADR 一个、每条 C 出现在被否决项（§18.2）；后果回答关闭了哪些评委反例（§18.1 FF 类 + 各 ADR）；开放问题 = U1–U12 + 新发现与跨章冲突 N-01…N-33（§18.4.2）+ 各章未并入的开放问题（§18.4.3，part9）；待验证清单 = spikes §8 18 项（V-01…V-18）+ techstack §6（V-T04…V-T10）+ 专题 review 新增（V-R01…V-R28，含 `logLines`、`Intl` 时区、mutation 内 `crypto`、`returns` 多余字段、`commitTs` 唯一性），每项标影响章与验证方式（§18.5） |
| spikes §7-18 九条 ADR 要求 | §18.3 |
| research §6-18 ADR 候选、§7.1–7.3 冲突 | §18.3；§7.1-1"单方先执行"→ 17 §17.4；§7.1-3 审批容差 → ADR-D02 被否决；§7.1-4 已执行记录遇约束变化 → ADR-D04；§7.1-5 职责分离 → ADR-D24；§7.1-7 拒绝自由文本 → ADR-D13；§7.3-1 公共文本 → ADR-D13；§7.3-4 `executionKey` → ADR-D03；§7.3-7 取舍选项来源 → ADR-D11 / D15 |
