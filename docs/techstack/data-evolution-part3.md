# 技术子决策：数据与演进 · part3（§4.2–4.8 推荐细则）

> 分片清单见 data-evolution.md 顶部。

### 4.2 seed / reset 与授权

- 沿用 `DD:testing-ops-part5.md` §4.3 的函数表：`seed.fromFixture`（只追加，新房间 `isSimulated: true`、`fixtureKey`）、`seed.attachMember`（prod 拒绝）、`seed.e2eRoom`、`seed.archiveRoom`（reset 默认形式：`status → closed`、写 `archivedAt`）、`seed.purgeSimulatedRooms`（仅 dev/preview，`confirmDeployment` 必须等于当前部署名，只删 `isSimulated && fixtureKey` 的房间及其 `by_roomId` 子表，分批）。
- **授权模型**：全部是 `internalMutation`，只能经 `npx convex run`（需部署 key 或已登录 dashboard 的团队成员）调用；函数首行 `assertTier(allowed)` 读 `DEPLOYMENT_TIER`。不存在任何公开的 seed/reset 入口。
- 本决策补充三条：
  1. fixture 引用数据用**领域键**（`itemKey`、`role`），不写死 `_id`；seed 返回新建的 `_id` 映射给 E2E。
  2. fixture 日期全部 `addDays(today, n)`（与 `DD:scenario-plugin-part3.md` §3.9 一致），`today` 来自 `todayInTimeZone(Date.now(), fixture.timeZone)`；`anchorDate` 参数只在 test/dev 接受。
  3. **prod 禁用 `npx convex import --replace` 与 `--replace-all`**（后者删除导入文件中不存在的表，`CVX:cli/lib/command.ts:499-505`）；dev 想整库清空，优先新建一个 dev 部署。写入 15-operations 的运行手册与 CI 检查（`grep` 部署脚本）。

### 4.3 导出与备份

| 层 | 做法 | 依据 |
| --- | --- | --- |
| prod 自动备份 | Pro 计划开启每日（保留 7 天）+ 每周（保留 14 天），含 file storage | docs.convex.dev/database/backup-restore |
| 发布前 | 每次 `convex deploy --prod` 前手动 "Backup Now"（保留 7 天）；含收缩型迁移的发布必须有 | 同上；恢复是破坏性的，替换表数据 |
| 离线导出 | `npx convex export --path <dir> [--include-file-storage] --prod`，只由运维执行，写 `opsLog`；落盘位置必须加密，本地副本保留不超过 30 天 | `CVX:cli/convexExport.ts:10-25`；`command.ts:528-540` |
| 用户导出 | 房间记录导出 = 现有角色投影 query 的结果渲染成打印视图或 CSV（单元格以 `= + - @` 开头时加 `'` 前缀）；不导出原表、不导出他方私密简报 | inputs/02 part13（变更单导出建议）；`DD:scenario-plugin-part4.md` B14 |

不进备份的东西：代码、schema、crons、auth 配置、环境变量、待执行的调度函数（docs.convex.dev/database/backup-restore）→ 恢复后需重新部署代码，并由 watchdog 扫描处于 `running` 的 run 并判定过期（与 10-agent-runtime 对齐）。

### 4.4 保留期与 PII

**数据分类：**

| 类 | 例子 | 存放 | 保留 | 抹除方式 |
| --- | --- | --- | --- | --- |
| 身份 PII | 显示名、头像 URL、邮箱 | `users`（`tokenIdentifier`、`clerkUserId`、`displayName`）；邮箱不入库，需要时向 Clerk 取 | 账户存续期 | 覆盖为 `"Deleted user"`，`tokenIdentifier` 改为 `deleted:<userId>`，追加 `pii_redacted` 事件 |
| 机密业务输入 | 私密简报（预算上限、底线、截止日） | `privateBriefs`（仅本人与本人代理可读） | 随房间 | 房间关闭后可由本人发起抹除自由文本字段；结构化约束值保留（审计需要），因为它们本身不是个人数据 |
| 人写自由文本 | 审批备注、约束变更理由、取舍回答 | 可抹除字段，**不进入任何 `contentHash`** | 随房间 | 覆盖为 `"[redacted]"` + 事件 |
| 不可变业务记录 | 提案条款、审批绑定、执行记录、承诺、事件 | 只存 `userId`、角色、枚举、金额、日期、模板渲染文本（模板只插角色名，不插人名） | 随房间，prod 不硬删 | 不需要抹除：从构造上不含 PII |
| 模型调用 | prompt、响应 | `modelCalls` 只存元数据（模型、token 分项、延迟、`outcome`、请求哈希）；代理产出的动作按协议存入回合记录 | 元数据随房间 | prompt 原文默认不落库；dev 可开 `CAPTURE_PROMPTS=true`，存入 `debugCaptures` 并由 cron 7 天后删除，prod 拒绝开启 |
| 模拟数据 | seed 房间 | `isSimulated: true` | dev/preview 可清除 | `purgeSimulatedRooms` |

**备份与抹除的交互**：抹除后的数据仍在备份里，最长 14 天（每周备份保留期）随备份过期；任何恢复之后，运维必须重跑 `internal.privacy.reapplyRedactions`，其输入来自恢复范围之外保存的抹除清单（`opsLog` 导出或运行手册记录）。这是 v1 的人工步骤，列入开放问题。

### 4.5 ID 与领域键

- 所有外键 `v.id("table")`；公开函数参数 `v.id("rooms")`，参数校验即保证表名正确。
- 路由 `/rooms/[roomId]`：页面把 URL 字符串交给 `rooms.getForViewer({ roomId: v.string() })`，内部 `ctx.db.normalizeId("rooms", s)`；**格式非法、不存在、非成员三种情况返回同一个 `null`**，前端统一显示 404，不泄露房间是否存在。
- `_id` 不是秘密：邀请用独立随机令牌（见 07-permissions-privacy），授权永远是成员检查。
- 领域键规则：`itemKey` 匹配 `^[A-Z][A-Z0-9_]{0,63}$`，房间内唯一（索引 `by_roomId_and_itemKey` + 单一写入口查重），创建后不可改名；`operationId = "exec:" + proposalId`（确定性执行键）；`scenarioKey`、`fixtureKey`、`reasonCode` 为代码常量。
- 面向人的编号：提案用房间内递增 `version`（已有）；变更单显示为 "Change order · v{proposalVersion}"，不另设全局编号。

### 4.6 金额：`engine/money.ts`

```ts
export type Cents = number & { readonly __brand: "Cents" };
export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000，与 F03.14 一致；常量可调
export function assertCents(n: unknown, field: string): asserts n is Cents; // isSafeInteger && 0 <= n <= MAX
export function parseUsdInput(s: string): Cents | null; // /^\d{1,7}(\.\d{1,2})?$/，按字符串拆整数与小数，不用 parseFloat
export function sumCents(xs: readonly Cents[]): Cents;  // 每步 assert，结果也 assert（台账合计可另设上限）
export function formatUsd(c: Cents, locale?: string): string; // Intl.NumberFormat，只在 UI / 模板层
```

- 为什么不用 `Math.round(parseFloat(x) * 100)`：它会把 `"1.005"` 静默变成 `100`（PROBE：本机 Node 24.21 输出 100），而用户输入的三位小数应当被拒绝而非四舍五入。
- 房间加 `currency: v.literal("USD")`：不增加成本，第二币种出现时改为 union 即可（扩展期迁移）。
- 引擎内只有整数运算，没有乘以小数的地方（加急费是固定金额，`DD:scenario-plugin-part4.md:13`）；若将来出现百分比费用，规则写死"按分向下取整"，并重新评估 dinero.js。

### 4.7 日期：`engine/isoDate.ts` + `convex/lib/today.ts`

```ts
export type IsoDate = string & { readonly __brand: "IsoDate" };
export function isIsoDate(s: string): s is IsoDate;          // 正则 + 月份天数 + 闰年
export function compareIsoDate(a: IsoDate, b: IsoDate): -1 | 0 | 1; // 字典序
export function addDays(d: IsoDate, n: number): IsoDate;     // days-from-civil 整数算法，不用 Date
export function diffDays(a: IsoDate, b: IsoDate): number;
// convex/lib/today.ts（适配器，唯一碰时钟处）
export function todayInTimeZone(nowMs: number, timeZone: string, fallbackUtcOffsetMinutes: number): IsoDate;
```

- `timeZone` 写入时校验：`new Intl.DateTimeFormat("en-US", { timeZone })` 不抛错；失败则拒绝保存（不是静默回退）。
- 时刻字段（`decidedAt`、`archivedAt` 等）用 epoch 毫秒 `v.number()`；事件全序用 `commitTs`；`_creationTime` 只作展示。
- UI 显示日历日时**标注房间时区**（"Nov 14 (America/Los_Angeles)"），时刻按查看者本地时区显示，避免两类混淆。
- `temporal-polyfill` 只作 devDependency：属性测试用它的 `Temporal.PlainDate` 当 oracle，对 1970–2100 随机日期比对 `addDays/diffDays/isIsoDate`。

### 4.8 文本上限：`engine/limits.ts`

| 字段 | 上限（码点） | 备注 |
| --- | --- | --- |
| `rooms.title` | 1–120 | |
| `users.displayName` | 1–80 | |
| 领域键（`itemKey`、`optionKey`、`termId`） | 1–64 | 另有正则 |
| `catalogItems.title` / `.description` | 1–120 / ≤ 2,000 | |
| 私密简报单个自由文本字段 / 整份简报自由文本合计 | ≤ 4,000 / ≤ 16,000 | 控制代理上下文体积 |
| 代理 `rationale` | 1–1,200 | 与 `DD:negotiation-protocol-part3.md:30` 一致 |
| 审批备注、约束变更理由、取舍自由回答 | ≤ 500 / 1–500 / ≤ 1,000 | |
| 模板渲染的公共摘要、事件 summary | ≤ 1,000 / ≤ 500 | 模板产物也要 assert，防止模板拼接失控 |
| 数组：目录条目 / 提案 `itemKeys` | ≤ 50 / ≤ 50 | 与可行性搜索上限协调 |

`assertText(field, s)`：NFC 归一化 → trim → 拒绝除 `\n`、`\t` 外的控制字符与未配对代理项 → 按码点（`[...s].length`）比上限。最坏情况 4 字节/码点，16,000 码点 ≈ 64 KB，远低于 1 MiB 文档上限。同一张表生成 Zod `.max()`（模型输出本地校验；API 不强制长度，见 inputs/04 要点 16）与前端 `maxLength`。

