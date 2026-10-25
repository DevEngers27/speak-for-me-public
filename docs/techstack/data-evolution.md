# 技术子决策：数据与演进（schema 迁移 · seed/reset · 导出备份 · 保留与 PII · ID · 金额 · 日期 · 文本上限）

> 分片：本文件（§0 结论、§1 需求与约束、§2 候选表）→ data-evolution-part2.md（§3 评估、§4.1 迁移规则）→ data-evolution-part3.md（§4.2–4.8 其余推荐细则）→ data-evolution-part4.md（§5 否决理由、§6 风险与退出）→ data-evolution-part5.md（§7 如何验证、§8 来源）。
> 日期 2026-10-24。引用缩写沿用 inputs/04：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`，`CVX:` = `NM:convex/src/`；`DD:` = `design/deepdives/`；`PROBE:` = 本代理在 scratchpad 里跑的只读 node 片段。

## 0. 结论（先读这一节）

| 子决策 | 推荐 | 一句话理由 |
| --- | --- | --- |
| schema 迁移 | **扩展 → 回填 → 收缩**三步；回填用 `@convex-dev/migrations`（首个需要回填的变更时再安装）；大表用 1.47 起的 `defineTable(...).staged()` 与 staged 索引；**只追加表不做语义改写**，旧形状靠读取端 `upcast*` 兼容 | Convex 推送时按 schema 校验存量数据，正好强制"先放宽、后收紧"；组件给出可续跑游标、`dryRun`、状态查询，自写要重造这些 |
| seed / reset | 采纳 `DD:testing-ops-part5.md` §4.3：`seed.fromFixture` 只追加并标 `isSimulated`；reset 的默认形式是归档；硬删除 `purgeSimulatedRooms` 只在 dev/preview，需 `confirmDeployment`；prod 禁用 `npx convex import --replace / --replace-all` | 核心 #6、#8；`--replace-all` 会删掉导入文件里没有的表（`CVX:cli/lib/command.ts:499-505`） |
| 导出与备份 | prod：Pro 计划的每日自动备份（保留 7 天）+ 每周一次（保留 14 天）；发布前手动备份；`npx convex export` 只由持部署 key 的运维执行；面向用户的导出是**按角色投影后的**房间记录（打印视图 / 防公式注入的 CSV），从不导出原表 | 备份 ZIP 含全部私密简报，必须按机密数据管理；用户导出复用披露矩阵，不另开数据通道 |
| 保留期与 PII | 业务记录随房间保留、不硬删；PII 只放在**可抹除字段**（`users` 表、人写的自由文本），不可变记录只存 `userId` 与枚举；抹除 = 覆盖可抹除字段 + 追加 `pii_redacted` 事件；模型原始 prompt 默认不落库 | 让"历史不可篡改"（#6）与"可删除个人数据"不冲突：哈希与不可变字段从设计上不含 PII |
| ID 与 slug | 内部引用一律 Convex `_id`（`v.id(...)`）；URL 用 `_id`（`/rooms/[roomId]`）；**不做标题 slug**；需要跨房间/跨环境/跨版本稳定的东西用**领域键**（`itemKey`、`scenarioKey`、`fixtureKey`、`reasonCode`、`operationId`） | 标题常含机密语境，slug 会进 URL、浏览器历史、Referer、日志；`_id` 不是秘密，鉴权从不依赖它不可猜 |
| 金额 | **整数分 `v.number()` + 自写 `money.ts`**（`assertCents`、字符串解析美元输入、`sumCents`、`formatUsd`）；房间存 `currency: "USD"` 字面量留扩展点 | v1 只有加、比、求和；dinero.js 对象不能直接入库，每个边界都要转换 |
| 日期与时区 | 日历日存 `YYYY-MM-DD` 字符串（品牌类型 `IsoDate`）；**自写 `isoDate.ts`**（校验、字典序比较、`addDays`、`diffDays`，纯整数算法，不用 `Date`）；`todayInTimeZone` 用 `Intl.DateTimeFormat`（唯一碰时钟处）；时刻用 epoch 毫秒 `v.number()`，全序用 `commitTs`；`temporal-polyfill` 只作**测试 oracle**（devDependency） | 引擎禁止 `Date/Intl`（`DD:rules-engine.md:52`）；Node 24 无原生 Temporal，Safari 稳定版未发布 |
| 文本上限 | 一张 `TEXT_LIMITS` 常量表 + `assertText(field, s)` 在每个 mutation 入口执行（NFC、trim、按码点计长、拒绝控制字符）；同一常量生成 Zod `.max()` 给模型输出 | `v.string()` 不表达长度（inputs/04 §1.8）；Convex 只限文档 1 MiB，不限字符串长度 |

## 1. 需求与约束（引自任务书与 inputs）

**任务书核心（`design/00-brief.md` §3）中受本决策直接影响的：**
- #3 人批准具体版本：审批绑定不可变提案内容 → 迁移不得改动提案的条款、金额、日期、版本号。
- #4 代码负责校验：金额与日期由确定性代码计算比较 → 需要无浮点误差的金额与无时区漂移的日期运算。
- #5 执行幂等：执行键 `operationId` 必须是确定性的领域键，而不是随机值。
- #6 历史不可篡改：提案只追加；旧审批、约束变更历史全部保留 → seed/reset 不能删真实历史；迁移不能语义改写只追加表；PII 抹除不能破坏可追溯性。
- #8 不伪造：seed 数据标 `isSimulated`，界面显示。
- #1 私密委托：备份与导出含私密简报，需同等保护。

**平台硬约束（inputs/04）：**
- `v.number()` 是 float64，整数分在 `Number.isSafeInteger` 内精确；`v.*` 不表达范围、长度、格式（inputs/04 part2 §1.8）。
- 索引无唯一约束，唯一性靠单一写入口查重（inputs/04 part2 §1.6）。
- Convex 推送时默认校验存量数据是否满足 schema（`CVX:server/schema.ts:895-903` `schemaValidation` 默认 true）；1.47 新增 `.staged()` 表校验器后台验证（`NM:convex/CHANGELOG.md` 1.47 节）。
- 事务限额：单事务读写各 16 MiB、写 16,000 文档、扫描 32,000 文档；单文档 1 MiB；数组 8,192 元素；顶层字段名 64 字符；**字符串长度无单独限制**（docs.convex.dev/production/state/limits，2026-10-24）。
- `_creationTime` 是墙钟，不保证提交顺序；全序用 `v.commitTs()`（inputs/04 part2 §1.6）。

**已有深潜里的相关决定（本文与之对齐，不推翻）：**
- 金额 `assertCents(n) = Number.isSafeInteger(n) && 0 <= n <= 100_000_000`；日期 `YYYY-MM-DD`，字典序比较（`inputs/02-review-design-findings-part4.md` F03.14）。
- 房间存 `timeZone`（IANA）与 `fallbackUtcOffsetMinutes`；`today` 由适配器 `todayInTimeZone` 计算，引擎只收 `today: IsoDate`；所有日期为房间时区日历日，含端点（`DD:rules-engine-part3.md` §3.8）。
- seed/reset 授权、`DEPLOYMENT_TIER`、`ALLOW_DEMO_SEED`（`DD:testing-ops-part5.md` §4.3；`DD:testing-ops-part2.md` TD-8）。
- 模型输出字段边界 `rationale` 1–1200、键 1–64（`DD:negotiation-protocol-part3.md:30`）。

## 2. 候选方案表

| # | 领域 | 候选 | 版本 / 许可证 / 最近发布（npm view，2026-10-24） |
| --- | --- | --- | --- |
| M1 | 迁移 | 扩展-回填-收缩 + `@convex-dev/migrations` | 0.3.7 / Apache-2.0 / 2026-10-10；peer `convex ^1.42.0`、`convex-helpers ^0.1.115` |
| M2 | 迁移 | 扩展-回填-收缩 + 自写分页批处理（`paginate` + `scheduler.runAfter` 自链） | 无依赖 |
| M3 | 迁移 | 离线迁移（停写 → 改数据 → 部署） | — |
| M4 | 迁移 | 关闭 `schemaValidation`，代码容忍任意形状 | — |
| M5 | 迁移 | 只读取端 upcast，永不回填 | — |
| S1 | seed/reset | 只追加 seed + 归档式 reset + 分层硬删（TD-8） | — |
| S2 | seed/reset | `npx convex import --replace-all fixture.zip` 整库重置 | convex CLI 1.48.0 |
| S3 | seed/reset | 阶段快照（预置到"已协商到 v3"的状态） | — |
| E1 | 备份 | Convex 自动备份（Pro）+ 手动备份 + `npx convex export` | 平台功能 |
| E2 | 备份 | 流式导出到外部仓库（Data Sync API / 第三方） | 平台功能，计划要求待验证 |
| P1 | PII | 可抹除字段分离 + 抹除事件 | — |
| P2 | PII | 硬删除用户全部数据 | — |
| P3 | PII | 字段级加密 + 销毁密钥（crypto-shredding） | — |
| I1 | ID | Convex `_id` + 领域键，不做 slug | 平台 |
| I2 | ID | 标题 slug（`/rooms/acme-q4-scope`） | — |
| I3 | ID | 自生成 ULID/nanoid 作为公开 ID | 需新依赖 |
| $1 | 金额 | 整数分 `v.number()` + 自写 `money.ts` | 无依赖 |
| $2 | 金额 | `dinero.js` v2 | 2.0.2 / MIT / 2026-03-13 |
| $3 | 金额 | `v.int64()`（bigint）存分 | 平台 |
| D1 | 日期 | `YYYY-MM-DD` + 自写 `isoDate.ts` + `Intl` 求 today；`temporal-polyfill` 仅测试 | `temporal-polyfill` 1.0.6 / MIT / 2026-10-13 |
| D2 | 日期 | `YYYY-MM-DD` + `temporal-polyfill` 作运行时依赖 | 同上 |
| D3 | 日期 | `date-fns` 4 + `@date-fns/tz` | 4.4.0 / MIT / 2026-05-29；tz 1.5.0 / MIT |
| D4 | 日期 | `dayjs` + utc/timezone 插件 | 1.11.23 / MIT / 2026-08-17 |
| D5 | 日期 | 存 epoch 毫秒（截止日 = 当天 23:59:59 某时区） | — |
| T1 | 文本 | `TEXT_LIMITS` 常量 + 入口 `assertText` + 同源 Zod `.max()` | — |
| T2 | 文本 | 只靠 Convex 1 MiB 文档上限 | — |

