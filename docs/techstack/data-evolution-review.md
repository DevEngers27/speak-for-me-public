# 反驳评审：数据与演进（data-evolution.md + part2–part5）

> 评审日期 2026-10-24。引用缩写：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`，`DD:` = `design/deepdives/`。npm 数据来自本评审重新运行的 `npm view`（缓存在 scratchpad/rv-npm），网页为当天抓取。

## 0. 结论

**verdict：accept_with_changes。** 方向正确、克制：不引入运行时依赖（金额、日期自写）、迁移组件推迟到第一次回填时才装、seed/reset 不删真实历史、ID 不做 slug，都与任务书 §3 核心 #3/#4/#6/#8 一致，没有发现与核心冲突的推荐。13 条待验证声明中 11 条成立、1 条部分错误（staged 索引不是 1.47 新增）、1 条措辞不准（`--replace-all` 语义）。真正需要改的是 4 处内部矛盾：`formatUsd` 放在禁用 `Intl` 的 `engine/` 里；query 里读时钟的问题没处理（前一轮 rules-engine 评审已给出修法）；`fallbackUtcOffsetMinutes` 与"写入时用 Intl 校验 timeZone"互相抵消；只追加表"只允许补派生字段"的规则与 PII 抹除覆盖自由文本互相冲突。

## 1. 声明逐条核对

| # | 作者声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | `@convex-dev/migrations` 0.3.7：Apache-2.0，2026-10-10，peer `convex ^1.42.0`、`convex-helpers ^0.1.115` | 成立 | `npm view @convex-dev/migrations@0.3.7`：license Apache-2.0；peer 两项一致；time `0.3.7: 2026-10-10T00:07:10Z`；无 `dependencies`；unpacked 234,644 B。12 个月内发布 0.3.0（2025-11-13）→0.3.7，共 8 个正式版，维护活跃 |
| 2 | `convex-helpers` 0.1.129 peer 与 convex 1.48.0 / zod 4.6.7 / TS 6.0.3 / React 19.3.1 兼容 | 成立（未安装验证，与作者一致） | `npm view convex-helpers@0.1.129`：peer `convex ^1.46.0`、`zod ^3.25.0 \|\| ^4.0.0`、`typescript ^5.5 \|\| ^6.0.0 \|\| ^7.0.0`、`react ^17.0.2 \|\| ^18 \|\| ^19`，另有可选 peer `hono ^4.0.5`、`@standard-schema/spec ^1.0.0`（作者漏列，均 optional，无影响）；latest=0.1.129，modified 2026-10-21。已装版本：convex 1.48.0、zod 4.6.7、typescript 6.0.3、react 19.3.1、next 16.4.3、@clerk/nextjs 7.9.20（各 `NM:*/package.json`）。part2 表里写成"`zod ^4`、`typescript ^6`"是简写，建议照抄原文 |
| 3 | README：默认每批 100、失败从失败批续跑、拒绝重复 worker、dryRun 跑一批后抛错、runner/next 串行、getStatus/cancel | 成立 | `npm view @convex-dev/migrations readme` 第 208–216 行（重复 worker、续跑、`reset`、`dryRun`）、220–275 行（串行）、319–345 行（cancel/getStatus）、363 行（部署命令）、395 行（默认 100/批）、420–425 行（批内默认串行） |
| 4 | 1.47 新增 `.staged()` 表校验器**和 staged 索引**；`schemaValidation` 默认 true | **部分错误** | `.staged()` 表校验器确为 1.47 新增（`NM:convex/CHANGELOG.md:48-59`）。staged 索引早在 **1.26.0** 加入（同文件 767-782 行）；1.47 只是让 `deploy` 在大表建索引时要求确认并建议 `staged: true`（33-38 行）。`schemaValidation` 默认 true 成立（`NM:convex/src/server/schema.ts:900-901`） |
| 5 | `--replace-all` 会删除导入文件中不存在的表；export 支持 `--include-file-storage` | 措辞不准，结论成立 | `NM:convex/src/cli/lib/command.ts:497-505`：删除"导入文件**和** schema 里都没有"的表，**清空** schema 里有、导入文件里没有的表。对我们的效果仍是整库破坏。`--include-file-storage` 在 528-540 行，成立 |
| 6 | 限额：文档 1 MiB、事务读写各 16 MiB、写 16,000、扫描 32,000、数组 8,192、字符串无单独限制 | 成立 | docs.convex.dev/production/state/limits（2026-10-24）。补充两条作者没用上的：mutation 用户代码执行时间 1 秒；字符串必须是合法 Unicode、不得有未配对代理项（平台已拒绝，`assertText` 的同类检查只起"早报错、统一错误码"作用） |
| 7 | 备份：手动 7 天；自动需 Pro，每日 7 天 / 每周 14 天；恢复覆盖数据；不含代码、环境变量、调度函数 | 成立 | docs.convex.dev/database/backup-restore。补充：恢复**不删除**部署里已有的文件；可从同团队其他部署恢复，但不能跨部署恢复到 dedicated 部署 |
| 8 | ZIP 导入保留 `_id`、`_creationTime`；原子（`--append` 除外） | 成立 | docs.convex.dev/database/import-export/import；该页还以 `npx convex import --prod --replace backup.zip` 作为恢复示例（见 r07） |
| 9 | Temporal Stage 4；Chrome 144（2026-01-13）、Firefox 139、Node 26（2026-05-05）；Safari 无记录；Node 24.21 无 Temporal | 成立 | tc39/proposal-temporal README（jsDelivr，2026-10-24）；本评审复跑 `node -e 'typeof Temporal'`（v24.21.0）→ `undefined` |
| 10 | Convex 默认运行时有无 Temporal、Intl 是否支持 timeZone：待验证 | 仍待验证（标注正确） | docs.convex.dev/functions/runtimes 列出的全局只有网络、编码、Streams、Web Crypto、Timing，未提 Intl/Temporal；`DD:rules-engine-review.md:21` 也未能核实 |
| 11 | temporal-polyfill 1.0.6 MIT 1,027,316 B；dinero.js 2.0.2 MIT 2026-03-13；date-fns 4.4.0 MIT；dayjs 1.11.23 MIT | 成立 | `npm view`：temporal-polyfill 2026-10-13；dinero.js unpacked 857,982 B；date-fns 2026-05-29；dayjs 2026-08-17；@date-fns/tz 1.5.0 MIT；convex-test 0.0.65 Apache-2.0 2026-10-23 |
| 12 | `Math.round(parseFloat('1.005')*100)` 得 100，F03.14 的写法会静默舍入 | 成立 | 复跑得 100；另 `"1.015"`→101（不是 102），说明误差方向也不稳定。F03.14 原文确实规定该写法（`design/inputs/02-review-design-findings-part4.md:19`） |
| 13 | `ctx.db.normalizeId` 存在于 1.48 | 成立 | `NM:convex/src/server/database.ts:73`；注释写明"不保证存在"，与 §4.5 "三种情况统一 null"相容 |

## 2. 问题清单

| id | 严重度 | 问题 | 证据 | 建议修改 |
| --- | --- | --- | --- | --- |
| data-evolution-r01 | medium | `formatUsd` 用 `Intl.NumberFormat`，却放在 `engine/money.ts`；同一份备忘录 §7.3 第 5 条又在 `engine/**` 用 `no-restricted-globals` 禁 `Intl`，引擎纯度规则也禁 `Intl`。照写会让 lint 失败，或迫使有人给引擎开口子 | part3 §4.6 代码块；part5 §7.3-5；`DD:rules-engine.md:52` | `money.ts` 只留 `assertCents / parseUsdInput / sumCents`；`formatUsd` 移到 UI 层（如 `app/lib/format.ts`）。若引擎或场景模板需要在公共文本里写金额，提供纯整数字符串实现 `formatCentsUsd(c)`（千分位 + 两位小数，不依赖 locale），并加属性测试与 `Intl` 结果比对 |
| data-evolution-r02 | medium | 没有规定 `todayInTimeZone` 不能在 query 里调用。Convex 文档：query 依赖当前时间会返回过期结果，并频繁失效缓存。上一轮评审已给出修法，本备忘录没吸收 | docs.convex.dev/understanding/best-practices（Date.now in queries）；`DD:rules-engine-review-part2.md:42` | 写明：`todayInTimeZone` 只在 mutation / cron 里调用；cron（每小时，或房间本地午夜 `runAt`）写 `rooms.localDate`；query 只读这个字段；mutation 里仍按 `Date.now()` 权威重算。加 convex-test：query 代码路径不调用 `Date.now` |
| data-evolution-r03 | low-medium | `fallbackUtcOffsetMinutes` 与"写入时 `new Intl.DateTimeFormat(..., { timeZone })` 不抛错才允许保存"互相抵消：运行时不支持 timeZone 时所有房间都建不了，退路永远用不上；支持时退路是死代码 | part3 §4.7 第 1 条；part1 §1 "房间存 timeZone 与 fallbackUtcOffsetMinutes"；`DD:rules-engine-review-part2.md:42` 已称其"过度设计" | 先跑 V-D2 再定，二选一：Intl 可用 → 删除 `fallbackUtcOffsetMinutes`，签名改为 `todayInTimeZone(nowMs, timeZone)`；不可用 → 只存偏移，UI 写明夏令时限制。§6 风险表同步改 |
| data-evolution-r04 | low-medium | §4.1 第 4 条说只追加表（`approvals`、`constraintChanges` 等）只允许回填新增的派生可选字段；§4.4 的 PII 抹除却要把这些表里的审批备注、变更理由覆盖成 `"[redacted]"`。两条规则矛盾，评审员会拿 §4.1 拦下抹除代码 | part2 §4.1-4；part3 §4.4 "人写自由文本" 行 | 在 §4.1 第 4 条里把"可抹除字段覆盖为固定值 `"[redacted]"`"列为第二种、也是最后一种允许的写法：只能经 `privacy.*` 单一入口；字段必须在一张 `REDACTABLE_FIELDS` 常量表里；该表与 `contentHash` 覆盖字段做编译期互斥断言；测试抹除前后 `contentHash` 不变（part5 §7.4 已有，补上表名） |
| data-evolution-r05 | low | "1.47 新增 staged 索引"不对，staged 索引自 1.26.0 起就有 | `NM:convex/CHANGELOG.md:767-782`（1.26.0 节）对比 33-38、48-59 行 | 改为"1.47 新增 `.staged()` 表校验器；staged 索引（1.26 起）可在后台回填"。V-M2 不受影响 |
| data-evolution-r06 | low | `--replace-all` 语义写得不准 | `NM:convex/src/cli/lib/command.ts:497-505` | 改为"删除导入文件和 schema 中都没有的表，并清空 schema 中有、导入文件中没有的表"。结论（prod 禁用）不变 |
| data-evolution-r07 | low-medium | prod 一律禁止 `npx convex import --replace` 并加 CI grep，但官方文档正是用 `npx convex import --prod --replace backup.zip` 从 ZIP 恢复。离线导出的 ZIP（§4.3 "离线导出"行）要恢复进 prod，这是唯一路径；一刀切会让灾难恢复要么违规、要么没有手册 | docs.convex.dev/database/import-export/import（恢复示例） | CI grep 只禁止自动化脚本里出现 `--replace` / `--replace-all`；运行手册保留一条应急流程：先 "Backup Now"，双人确认，写 `opsLog("restore", …)`，平台备份优先走 dashboard 恢复，只有离线 ZIP 才用 `import --prod --replace` |
| data-evolution-r08 | low | 推荐依赖 Convex Pro 计划，这是新的成本决定，任务书和 inputs/04 都没有，备忘录也没给不买 Pro 时的做法 | `grep -i "Pro\|备份" design/inputs/04-platform-constraints*.md` 无结果；backup-restore 页"Periodic backups require a Convex Pro plan" | 列入开放问题（18-decisions）。不买 Pro 的退路：CI 定时 `npx convex export --prod` 写入加密存储（已有 `opsLog` 与 30 天保留规则可复用），加上每次发布前手动备份 |
| data-evolution-r09 | low | 否决 `$3 v.int64()` 的理由是 bigint 不能 `JSON.stringify`、在 props 和日志里难处理；可同一份方案又用 `commitTs` 做事件全序，而 `v.commitTs()` 的值本身就是 int64（bigint） | `NM:convex/src/values/validator.ts:212-222`（"an int64 (`bigint`) assigned from the transaction's commit timestamp"）；part1 §0 日期行 | 补一条规则：`commitTs` 只用于索引排序，不进入任何 `returns` DTO；需要给前端顺序时返回字符串或房间内 `seq`。`$3` 的否决理由改成"金额不需要 bigint，`commitTs` 是平台强制的唯一例外" |
| data-evolution-r10 | low | "抹除清单保存在恢复范围外"没有具体机制：`opsLog` 和 `pii_redacted` 事件都在 Convex 表里，恢复时会被一起覆盖 | part3 §4.4 末段；backup-restore 页（恢复会清空现有数据） | 用已有步骤解决：恢复手册第一步是 "Backup Now"，`reapplyRedactions` 从这份恢复前快照导出的 `events`（`type = pii_redacted`）读取清单；不需要新的外部存储 |
| data-evolution-r11 | low | 组件 README 初始化代码写的是 `import schema from "./_generated/schema.js"`，但 convex 1.48 的 codegen 模板里没有 schema 产物。照抄 README 可能编译失败 | README 第 96、149 行；`NM:convex/src/cli/codegen_templates/` 只有 api/dataModel/server 等模板，没有 schema | 在 V-M3 里加一项"待验证"：安装后确认 `_generated/schema` 是否生成，不生成就改用 `import schema from "./schema"` |
| data-evolution-r12 | low | 文本上限的说法是"同一常量、同一语义"，其实有两处不一致：前端 `maxLength` 按 UTF-16 码元计数；Zod 4.6.7 的 `.max()` 按码点计数（这点与 `assertText` 一致），但它不做 NFC，分解形式的文本会多算 | `NM:zod/v4/core/checks.js:271-273`（超长时改用 `codePointLength`）；探针：`z.string().max(1)` 接受 `"😀"`、拒绝 `"é"` | 前端计数器复用 `engine/limits.ts` 的码点计数函数，不只依赖 `maxLength`；模型输出先做 NFC 再过 Zod。差异只会让前端或 Zod 更严，不是安全问题 |

## 3. 主动检查

- **兼容性**：推荐方案的依赖只有可选的 `@convex-dev/migrations`（以及它带来的 peer `convex-helpers`）和 devDependency `temporal-polyfill`，与 Next 16.4.3、React 19.3.1、Clerk 7.9.20 都没有交集。peer 范围已逐项满足（见表 #2）。Node 24 本地测试不需要原生 Temporal，因为 polyfill 只当 oracle 用。
- **许可证**：全部是 MIT 或 Apache-2.0，不涉及 copyleft。
- **维护活跃度**：migrations 12 个月内 8 个正式版；convex-helpers 2026-10-21；temporal-polyfill 2026-10-13；均活跃。作者"锁定精确版本 + `migrateOne` 写成纯函数"这条退出策略合理。
- **与任务书冲突**：没有发现。PII 分类让核心 #6"历史不可篡改"与可删除个人数据并存，r04 补完即可自洽。
- **过度设计**：总体克制。需要收敛的有两处：`fallbackUtcOffsetMinutes`（r03），以及 `debugCaptures` 加 7 天 cron（只在 dev 用，可以先不做，到需要调 prompt 时再加）。`.staged()` 只写成"大表时可用"，没有要求 v1 使用，可以接受。
- **被忽略的更简单方案**：① 时钟问题直接沿用 `rooms.localDate` 方案（r02），不必每个 query 自己算；② 恢复后重放抹除用"恢复前先备份"即可（r10）；③ 不买 Pro 时，CI 定时 export 足以覆盖 v1 的备份需求（r08）。

## 4. 来源（2026-10-24）

- npm registry：`npm view` @convex-dev/migrations、convex-helpers、temporal-polyfill、dinero.js、date-fns、@date-fns/tz、dayjs、convex-test、@js-temporal/polyfill、convex
- `NM:convex/CHANGELOG.md`；`NM:convex/src/server/schema.ts`；`NM:convex/src/server/database.ts`；`NM:convex/src/cli/lib/command.ts`；`NM:convex/src/cli/convexExport.ts`；`NM:convex/src/values/validator.ts`；`NM:convex/src/cli/codegen_templates/`；`NM:zod/v4/core/checks.js`
- https://docs.convex.dev/production/state/limits ；https://docs.convex.dev/database/backup-restore ；https://docs.convex.dev/database/import-export/import ；https://docs.convex.dev/functions/runtimes ；https://docs.convex.dev/understanding/best-practices/
- https://cdn.jsdelivr.net/gh/tc39/proposal-temporal@main/README.md
- `design/inputs/02-review-design-findings-part4.md` F03.13/F03.14；`DD:rules-engine.md:52`；`DD:rules-engine-review-part2.md:42`；`DD:rules-engine-review.md:21`
- 探针（Node v24.21.0）：`typeof Temporal`、`parseFloat` 舍入、`Intl` 时区格式化、Zod `.max()` 对 emoji 与组合字符的计数
