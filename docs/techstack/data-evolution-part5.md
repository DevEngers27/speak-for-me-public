# 技术子决策：数据与演进 · part5（§7 如何验证、§8 来源）

> 分片清单见 data-evolution.md 顶部。

## 7. 如何验证（可执行步骤）

### 7.1 版本、兼容、许可证（实现前，2 分钟）

```sh
npm view @convex-dev/migrations@0.3.7 peerDependencies license   # 期望 convex ^1.42.0、convex-helpers ^0.1.115、Apache-2.0
npm view convex-helpers@0.1.129 peerDependencies license         # 期望 convex ^1.46.0、zod ^3.25||^4、typescript ^5.5||^6||^7、Apache-2.0
npm view temporal-polyfill@1.0.6 license                          # 期望 MIT
npm view dinero.js@2.0.2 license                                  # 期望 MIT（仅作否决依据）
```

在新仓库 `pnpm add @convex-dev/migrations@0.3.7 convex-helpers@0.1.129` 后 `pnpm install --frozen-lockfile && pnpm typecheck`，确认无 peer 警告（与 convex 1.48.0、zod 4.6.7、typescript 6.0.3）。

### 7.2 平台行为探针（dev 部署，每项一个最小函数）

| ID | 验证什么 | 步骤 | 通过标准 |
| --- | --- | --- | --- |
| V-D1 | Convex 默认运行时有无原生 `Temporal` | query 返回 `typeof Temporal` | 记录结果；无论有无，D1 方案不变 |
| V-D2 | 默认运行时 `Intl.DateTimeFormat` 支持 `timeZone` 与 `formatToParts` | query 返回 `todayInTimeZone(Date.UTC(2026,10,1,7,30), "America/Los_Angeles", -420)` 及 `Intl.DateTimeFormat().resolvedOptions().timeZone` | 返回 `"2026-11-01"`（本机 Node 已得此值，PROBE）；失败则启用 §6 退路 |
| V-M1 | 推送时存量校验 | 表里插一条无 `newField` 的文档 → schema 把 `newField` 改必需 → `npx convex dev` | 推送被拒；回填后推送成功 |
| V-M2 | `.staged()` 表校验器 | 同上改用 `defineTable(...).staged({ newField: v.string() })` → `npx convex deploy --dry-run` | 输出该表 validating / validated / failed（`NM:convex/CHANGELOG.md` 1.47） |
| V-M3 | 组件续跑与 dryRun | 定义一个对 250 条文档的迁移，`batchSize: 100`；先 `'{dryRun: true}'`，再正式跑，中途在 `migrateOne` 对第 150 条抛错，修复后重跑 | dryRun 无写入；重跑从失败批继续；`npx convex run --component migrations lib:getStatus` 显示完成 |
| V-M4 | 只追加表哈希不变 | 对 seed 出的提案跑一次"补派生字段"迁移，前后对每条重算 `contentHash` | 全部相等 |
| V-E1 | 备份含哪些数据、恢复是否保留 `_id` | dev 部署 `npx convex export --path /tmp/x.zip` → 新建 dev 部署 `npx convex import /tmp/x.zip` | 外键仍可解析，`_id`、`_creationTime` 一致；确认 ZIP 内 `privateBriefs/documents.jsonl` 存在（从而必须按机密管理） |
| V-E2 | prod 备份计划 | dashboard → Backups，确认 Pro 计划、每日 + 每周已勾选、含 file storage | 截图存档到运维记录 |
| V-I1 | 非法 / 他房 ID 统一 404 | 以成员 A 身份调用 `rooms.getForViewer` 传 `"garbage"`、他表 ID、不存在的房间 ID、非成员房间 ID | 四种都返回 `null` |

### 7.3 纯函数测试（vitest，无需 Convex）

1. `isoDate.test.ts`：固定用例 `2028-02-29` 合法、`2026-02-29` / `2026-02-30` / `2026-13-01` / `2026-1-01` 非法；`addDays("2026-12-31", 1) === "2027-01-01"`；`addDays("2028-02-28", 1) === "2028-02-29"`；`diffDays` 跨年。
2. 属性测试：对 1970-01-01 至 2100-12-31 随机 10,000 个日期与 −1000..1000 的 `n`，`addDays(d, n)` 等于 `Temporal.PlainDate.from(d).add({ days: n }).toString()`（`temporal-polyfill` 作 oracle）；`compareIsoDate` 与 `Temporal.PlainDate.compare` 一致。
3. `money.test.ts`：`parseUsdInput("1.005") === null`、`("19.99") === 1999`、`("4.35") === 435`、`("1,000") === null`、`("-1") === null`；`assertCents(0.5)`、`(-1)`、`(MAX+1)` 抛错；`sumCents` 越界抛错。
4. `limits.test.ts`：组合字符（`"é"` NFC 后计 1）、emoji（按码点计）、`\u0000` 拒绝、未配对代理项拒绝、上限边界 ±1。
5. 静态检查：ESLint `no-restricted-imports` 在 `engine/**` 禁止 `date-fns`、`dayjs`、`dinero.js`；`no-restricted-globals` 在 `engine/**` 禁止 `Date`、`Intl`（与 `DD:rules-engine.md:52` 一致）；全仓禁止 `convex-helpers/server/zod*`。

### 7.4 convex-test（确定性逻辑）

- seed：`seed.fromFixture` 两次 → 两个房间，都 `isSimulated: true`，旧房间未被删除；`DEPLOYMENT_TIER=prod` 且无 `ALLOW_DEMO_SEED` 时抛错；`purgeSimulatedRooms` 在 `prod` / `staging` 抛错，`confirmDeployment` 不匹配抛错，不删除 `isSimulated: false` 的房间。
- PII：对某用户执行 `privacy.redactUser` 后，扫描全部表，`displayName` 原值只出现 0 次；所有提案 `contentHash` 不变；新增一条 `pii_redacted` 事件。
- 文本：每个公开 mutation 对超长参数返回同一错误码（如 `TEXT_TOO_LONG`），状态不变。

### 7.5 运维演练（staging，每季度一次）

1. 手动备份 → 记录 `snapshot_{ts}.zip` 名。
2. 在一次性部署上 `npx convex import --replace <zip>` 恢复。
3. 重跑 `internal.privacy.reapplyRedactions`，再跑 7.4 的 PII 扫描。
4. 部署代码，确认 watchdog 把恢复前处于 `running` 的 run 判定为过期。
5. 记录耗时与问题到 `opsLog`。

## 8. 来源（访问日期均为 2026-10-24）

**本地文件（只读）**
- `/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/design/00-brief.md` §3（核心不变量）
- `design/inputs/04-platform-constraints.md`、`-part1.md`、`-part2.md`（§1.6 唯一性与 commitTs、§1.8 validator 与金额）
- `design/inputs/02-review-design-findings-part4.md` F03.13、F03.14；`-part13.md`（导出建议）
- `design/inputs/01-original-ideas-part2.md` SC-08、`-part8.md` GAP-24
- `design/deepdives/testing-ops-part2.md` TD-8；`testing-ops-part5.md` §4.3；`rules-engine.md` D 节；`rules-engine-part3.md` §3.8；`scenario-plugin-part3.md` §3.9；`scenario-plugin-part4.md`；`negotiation-protocol-part3.md:30`
- `/Users/zhennn/cal-hack-2026-main/package.json`（convex 1.48.0、zod 4.6.7、typescript 6.0.3、engines.node `>=24.19.0 <25`）
- `NM:convex/CHANGELOG.md` 1.47 节（`.staged()` 表校验器、staged 索引）
- `NM:convex/src/server/schema.ts:895-903`（`schemaValidation` 默认 true）
- `NM:convex/src/server/database.ts:73`（`normalizeId`）
- `NM:convex/src/cli/convexExport.ts:10-25`；`NM:convex/src/cli/lib/command.ts:476-540`（`--replace`、`--append`、`--replace-all`、`--include-file-storage`）

**npm registry（`npm view`）**
- `@convex-dev/migrations` 0.3.7，Apache-2.0，发布 2026-10-10，peer `convex ^1.42.0`、`convex-helpers ^0.1.115`；README（分批、续跑、`dryRun`、`runner`、`getStatus`、`cancel`、部署命令）
- `convex-helpers` 0.1.129，Apache-2.0，2026-10-21，peer `convex ^1.46.0`、`zod ^3.25.0 || ^4.0.0`、`typescript ^5.5 || ^6.0.0 || ^7.0.0`、`react ^17 || ^18 || ^19`
- `dinero.js` 2.0.2，MIT，2026-03-13（exports 含 `./bigint`、`./currencies`）
- `temporal-polyfill` 1.0.6，MIT，2026-10-13，unpacked 1,027,316 B
- `@js-temporal/polyfill` 0.5.1，ISC，最后更新 2025-03-31（未采用）
- `date-fns` 4.4.0，MIT，2026-05-29；`@date-fns/tz` 1.5.0，MIT，2026-05-21
- `dayjs` 1.11.23，MIT，2026-08-17
- `convex-test` 0.0.65，Apache-2.0，2026-10-23，peer `convex ^1.43.0`

**网页**
- https://docs.convex.dev/production/state/limits （文档 1 MiB、事务 16 MiB / 16,000 写 / 32,000 扫描、数组 8,192、字符串长度无单独限制、顶层字段名 64）
- https://docs.convex.dev/database/backup-restore （手动备份 7 天；自动备份需 Pro，每日 7 天、每周 14 天；恢复是破坏性的；不含代码、环境变量、待执行调度函数；ZIP 格式）
- https://docs.convex.dev/database/import-export/export （`npx convex export --path`）
- https://docs.convex.dev/database/import-export/import （ZIP 恢复保留 `_id` 与 `_creationTime`；导入原子，`--append` 除外；有数据时默认失败）
- https://docs.convex.dev/database/document-ids （ID 是全局唯一字符串，可放 URL；外部 ID 用 validator 或 `normalizeId` 校验）
- https://stack.convex.dev/intro-to-migrations （在线 vs 离线；先加可选字段；双写 / 双读；改类型的六步）
- https://cdn.jsdelivr.net/gh/tc39/proposal-temporal@main/README.md （Stage 4；Chrome 144 2026-01-13、Firefox 139 2025-05-27、Node 26 2026-05-05；Safari 无记录）

**本地探针（PROBE，Node v24.21.0）**
- `typeof Temporal` → `"undefined"`
- `Math.round(parseFloat("1.005") * 100)` → `100`；`4.35 * 100` → `434.99999999999994`
- `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", ... }).format(Date.UTC(2026,10,1,7,30))` → `"2026-11-01"`
