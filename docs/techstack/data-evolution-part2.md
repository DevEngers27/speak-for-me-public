# 技术子决策：数据与演进 · part2（§3 评估、§4.1 迁移规则）

> 分片清单见 data-evolution.md 顶部。

## 3. 评估

### 3.1 迁移（M1–M5）

| 维度 | M1 组件 | M2 自写 | M3 离线 | M4 关校验 | M5 只 upcast |
| --- | --- | --- | --- | --- | --- |
| 成熟度 | 0.x，Convex 官方组件，持续发布 | 取决于我们 | 简单但需停机 | — | — |
| 与 Convex 1.48 兼容 | peer `^1.42.0` 满足；需 `convex.config.ts` 里 `app.use(migrations)` | 原生 | 原生 | 原生 | 原生 |
| 与 Next 16 / React 19 | 无前端依赖 | 无 | 无 | 无 | 无 |
| 许可证 | Apache-2.0（附带 peer `convex-helpers` 0.1.129，Apache-2.0，peer `convex ^1.46.0`、`zod ^4`、`typescript ^6`，均满足） | — | — | — | — |
| 维护 | 2026-10-10 发布 0.3.7 | — | — | — | — |
| 学习成本 | 低：`migrations.define({ table, migrateOne })`，CLI `npx convex run` | 中：自己处理游标、失败续跑、并发 worker | 低 | 低 | 中：每个读取点都要 upcast |
| 迁移成本 / 退出 | `migrateOne` 是普通函数，换实现只改外壳 | — | — | 难回头：脏数据进库 | 读取代码永久膨胀 |
| 对核心不变量 | 需加规则：只追加表只能补可选派生字段（见 §4.1） | 同左 | 停写期间审批/执行不可用 | 破坏 #4（形状不再由平台兜底） | 对只追加表最安全 |

组件能力（读自 `npm view @convex-dev/migrations readme`，2026-10-24）：分批（默认 100/批，可调）在线运行；记录状态防止重复运行，失败后从失败批续跑；已在运行时拒绝重复 worker；`dryRun: true` 跑一批后抛错不提交；`next` / `runner([...])` 串行多个迁移；`getStatus --watch`；`cancel`；可替换为自定义 `internalMutation`（若用了写入拦截）；推荐部署命令 `npx convex deploy --cmd '...' && npx convex run migrations:runAll --prod`。

### 3.2 金额（$1–$3）

| 维度 | $1 整数分 + 自写 | $2 dinero.js 2.0.2 | $3 `v.int64()` |
| --- | --- | --- | --- |
| 精度 | 安全整数内精确；上限 1 亿分远小于 2^53 | 精确，支持 bigint 后端 | 精确 |
| 与 Convex 存储 | 直接存 | 对象需 `toSnapshot` 后存，读出再 `dinero(...)` | bigint 存取原生，但 JSON 序列化、React props、日志要特殊处理 |
| 我们的运算 | 加、比、求和、格式化 | 另含分配、换算、百分比（v1 用不上） | 同 $1 |
| 许可证 / 维护 | — | MIT；v2 在 2026 年才转正，生态仍以 v1 教程为主 | 平台 |
| 学习成本 | 极低 | 中（函数式 API、currency 对象、scale） | 低，但 bigint 坑多 |
| 对不变量 | `assertCents` 在所有金额入口执行，与 F03.14 一致 | 不改变校验需求 | 与 F03.13"不用 `v.int64()`"冲突 |

### 3.3 日期（D1–D5）

关键事实：Temporal 已到 TC39 Stage 4，Chrome 144（2026-01-13）、Firefox 139（2025-05-27）、Node 26（2026-05-05）已发布，Safari 无发布记录（tc39/proposal-temporal README，2026-10-24）。本项目 `engines.node` 为 `>=24.19.0 <25`（`ORIG:package.json`），本机 Node v24.21.0 下 `typeof Temporal === "undefined"`（PROBE）。Convex 默认运行时是否有 Temporal、是否支持 `Intl` 的 `timeZone`：待验证。

| 维度 | D1 自写 + Intl | D2 Temporal polyfill 运行时 | D3 date-fns | D4 dayjs | D5 epoch 毫秒 |
| --- | --- | --- | --- | --- | --- |
| 与引擎纯度规则（不用 `Date/Intl`） | 满足：纯整数算法 | `PlainDate` 运算确定，可满足 | 违反：API 以 `Date` 为核心 | 违反：包装 `Date` | 每个比较点都要时区换算 |
| 日历日语义 | 原生就是日历日 | `PlainDate` 正是日历日 | `Date` 是时刻，本地时区 off-by-one 风险 | 同左 | 不是日历日 |
| 与 Convex / Next / React | 无依赖 | 体积 unpacked ~1.0 MB，需打进 Convex 与浏览器包 | 可用，但不需要 | 可用 | — |
| 许可证 / 维护 | — | MIT，2026-10-13 | MIT，2026-05-29 | MIT，2026-08-17 | — |
| 学习成本 | 4 个函数，约 60 行 | 中 | 低 | 低 | 低，但易错 |
| 退出 | 原生 Temporal 普及后把 `isoDate.ts` 内部换成 `Temporal.PlainDate`，存储格式不变 | 移除 polyfill 即可 | — | — | 迁移存量数据 |

### 3.4 ID、文本、PII、备份

- **I1 vs I2/I3**：`_id` 是全局唯一字符串，可放 URL（docs.convex.dev/database/document-ids）；外部来的 ID 用参数 validator `v.id("rooms")` 或 `ctx.db.normalizeId` 校验表名（`CVX:server/database.ts:73`）；ZIP 备份恢复保留 `_id` 与 `_creationTime`（docs.convex.dev/database/import-export/import）。I3 只解决"好看"，却要第二套唯一性（索引无唯一约束，见 inputs/04 §1.6）。
- **T1 vs T2**：T2 意味着一个 900 KB 的"审批备注"合法，会撑爆代理上下文与事件流；T1 一张表统一入口、UI、Zod。
- **P1 vs P2/P3**：P2 直接违反 #6；P3 需要密钥管理与 action 解密，Convex mutation 不能 `fetch` 外部 KMS，复杂度不匹配 v1。
- **E1 vs E2**：E1 平台原生、恢复路径已知；E2 把私密数据复制到第三方仓库，扩大攻击面，留作后续扩展点。

## 4. 推荐与理由

（§4.2 起见 part3；否决理由与风险见 part4；验证与来源见 part5。）

### 4.1 迁移规则

1. **扩展**：新字段先 `v.optional(...)`，类型变更先 `v.union(old, new)`；同次部署的代码"读两种、写新形状"。Convex 后端先于 Next 前端部署，扩展期函数签名对旧前端向后兼容。
2. **回填**：`migrations.define({ table, migrateOne })`，先 `dryRun: true`，再正式运行；部署流水线 `npx convex deploy --cmd 'pnpm build' && npx convex run migrations:runAll --prod`。
3. **收缩**：数据全部满足后把字段改为必需或删除；推送失败即说明回填未完成（平台兜底）。大表先用 `.staged()` 验证再移入 `defineTable`。
4. **只追加表**（`proposals`、`approvals`、`events`、`constraintChanges`、`changeOrders`、`commitments`）：
   - 禁止修改 `contentHash` 覆盖的字段、版本号、金额、日期、`itemKeys`。
   - 允许回填**新增的可选派生字段**（由已有字段确定性算出），并在 `opsLog` 写一条 `migration_applied { name, table, count }`。
   - 形状演进优先读取端 `upcastX(doc)`；场景条款 `proposals.terms`（场景自定义）带 `termsSchemaVersion`，由场景插件提供 `upcastTerms(fromVersion, terms)`。
5. **何时安装组件**：v1 从零建库，首发不需要回填；第一次需要回填时安装并 `app.use(migrations)`。流程现在写进 15-operations。
