# 03 · Convex schema v1（part1）：目标、决定、约定与代码校验

> 分片（按顺序阅读，共 12 片）：
> 1. `03-schema.md`（本文件）：3.0 目标、3.1 决定、3.2 约定与代码校验表
> 2. `03-schema-part2.md`：3.3 写门面与房间写锁（M-ROOM）、3.4 共享 validator
> 3. `03-schema-part3.md`：3.5 身份与房间（`users` / `rooms` / `members` / `invites`）、3.6 `briefs`
> 4. `03-schema-part4.md`：3.6（续）`sharedFacts`、3.7 `catalogItems` / `ledgerEntries` / `constraintRevisions`
> 5. `03-schema-part5.md`：3.8 运行时三层之 `runs` / `turns`
> 6. `03-schema-part6.md`：3.8（续）`attempts`（用量账本）/ `rawOutputs`
> 7. `03-schema-part7.md`：3.9 `proposals` / `approvals` / `humanRequests`
> 8. `03-schema-part8.md`：3.10 `executions` / `changeOrders` / `tasks`、3.12 `opsFlags` / `spendCounters`
> 9. `03-schema-part9.md`：3.11 `events`（payload 目录、`events.append`、节流计数）
> 10. `03-schema-part10.md`：3.13 唯一写入口目录（参数 / 守卫 / 读写 / 失败码）、3.14 唯一性落点
> 11. `03-schema-part11.md`：3.15 索引用途、3.16 字段披露类与 `REDACTABLE_FIELDS`、3.17 不变量落点
> 12. `03-schema-part12.md`：3.18 演进、3.19 测试清单、3.20 开放问题与待验证、3.21 与 canon 的对照
>
> 底稿：`candidates/invariants/03-schema-part1..3`（唯一性落点表、db 写门面 + lint、房间聚合写锁）、`candidates/runtime/03-schema-part2/3`（简报 / 目录 / 提案 / 运行时三层的字段）。吸收：techstack D02/X2/X3/D38、spikes §1 与 §7 03 段、`deepdives/idempotent-execution/schema-fragment.ts`、`deepdives/privacy-disclosure-part2.md`（字段 × 角色矩阵）、`deepdives/run-lifecycle/schema.ts` 及其反驳。08 §8.3、07 §7.8.3、05 §5.2、04 §4.1–4.2 已提出的字段需求逐项落到本章；命名一律以 `00-canon*.md` 为准。

## 3.0 目标

1. 给出 v1 全部 22 张表的字段、类型、索引，以及每条逻辑唯一性"由哪个索引 + 哪个唯一写入口 + 哪种并发机制"保证（Convex 没有唯一约束，`.unique()` 只是读取时断言，inputs/04 §1.6、privacy review #5）。
2. 把 `v.*` 管不到的值规则（负数、小数、`NaN`、空串、非法日期、超长文本，spikes §1 实测都能写入）全部落到具体的代码校验函数与失败码。
3. 存储只存事实：canon §1.3 列出的状态、不可变快照、只追加记录；可执行性、审批有效性、已承诺额、阶段一律不入库（02 §5）。
4. 每个字段都有披露类（07 §7.8.2 的 `DISCLOSURE` 注册表必须覆盖 schema 的每个叶子路径，TC-PRIV-10），本章给出默认类，07 §7.9 定最终矩阵。

## 3.1 决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| SC-01 | 一张 `convex/schema.ts`，引擎表与首个场景的字段共存；场景相关的嵌套形状（简报硬 / 软字段、条款）用以 `schemaKey` 判别的联合，v1 只有 `scope_change.*.v1` 成员 | 单包布局（canon D21）；第二场景 = 联合加成员 + 契约测试（canon D26），引擎表不改 | 立即拆 `scopeChange_` 前缀表（第二场景落地前无收益）；`attrs: v.any()` + Zod（读出要再 parse，失败即数据损坏） |
| SC-02 | 硬约束三个来源：finance `briefs.hardFields.capCents`、customer `briefs.hardFields.{requiredItemKeys, deadline}`、provider 确认的 `catalogItems`；没有 `budgets`、`budgetChanges`、`constraintSets`、`catalogRevision` | 约束变化只有 `constraints.bump` 一条路径（canon D05）；"改了预算忘了 bump"在结构上不可能 | budgets 表（第二入口）；constraintSets 指针元组（多一张须证明一致的表）；`rooms.catalogRevision` 守卫（只改标题就冻结协商，C8） |
| SC-03 | 只追加表：`briefs`、`sharedFacts`、`catalogItems`、`ledgerEntries`、`constraintRevisions`、`approvals`、`executions`、`changeOrders`、`events`；`proposals` 只有 `status` / `statusChangedAt` 可变；`tasks` 只有完成字段可变 | 核心 6；"当前值"由最新行派生 | upsert 审批（spikes B3 证伪）；patch 覆盖简报 |
| SC-04 | `attempts` 即用量账本，不建 `modelCalls`、`usageCounters` | 每次模型调用（含 stub、迟到、被拒收）都有自己的一行；同一事实不存两处（canon §1.1 修正草稿） | run-lifecycle 的 modelCalls + usageCounters（三个真相源，techstack X2） |
| SC-05 | 房间写锁（M-ROOM）：凡改变房间业务状态的 mutation 都经 `openRoomTx` 把 `rooms.writeSeq + 1` | 同房间"先查后写"在 OCC 下串行，正确性不押在"索引区间读进入读集"（V3，仅源码注释旁证）上；`approvals` 的 withdraw 与最后一票并发、`members` 的并发加入因此都有确定的冲突点 | 只靠区间读冲突（idempotent-execution review r10：withdraw 的安全性完全依赖它） |
| SC-06 | 金额 `v.number()` 存整数分 + `assertCents`；日期 `v.string()` 存 `IsoDate` + `isIsoDate`；不用 `v.int64()` | bigint 在客户端、JSON、DTO 中更麻烦；安全整数范围远超需要 | `v.int64()`；浮点美元 |
| SC-07 | 节流用"索引计数"，不另建表：受节流的公开 mutation 成功时写带 `events.actorUserId` 的命令事件，`appendEvents` 给每个命令事务恰一行打计数标记（`rateUser` / `rateRoom`），`assertWithinRate` 用索引 `events.by_room_actor`（键含标记）+ `_creationTime` 窗口按 distinct `commitTs` 计数（canon D12 ⑥、D17；12 §12.2 B7；3.11.3） | 零新依赖、零新表（00-invariants INV-11）；计数对象本来就要写；一个事务恰计一次；索引键含标记，无关事件不占扫描额度 | `@convex-dev/rate-limiter`（v1 不引入，techstack X2）；独立计数表；按事件条数计数（一次回答同时写两条命令事件会被计两次）；先 `take(50)` 混合事件再按类型过滤（无关事件可把计数稀释为 0） |
| SC-08 | `provenance ∈ live \| seeded \| stub` 是数据字段；派生记录按 `seeded > stub > live` 继承；身份类（`users` / `members` / `invites`）与运维表不带，由 `rooms.provenance` 覆盖 | 核心 8 落到数据（canon §1.2） | `isSimulated` 布尔（分不清 seed 与 stub） |
| SC-09 | 用户只以 `v.id("users")` 被引用；`tokenIdentifier` 只出现在 `users` 一处 | Clerk 实例迁移（tokenIdentifier 含 issuer）只改一处；DTO 永不出现它（07 §7.5.1） | `userId: v.string()` 存 tokenIdentifier（versioned-approvals review r08） |
| SC-10 | 事件顺序 `(roomId, commitTs, seq)`；`seq` 由 `events.append` 在同一事务内从 0 分配；`commitTs` 不进任何 DTO | 同一 mutation 的多条事件 `commitTs` 相同（techstack X3）；bigint 不出边界 | 只用 `_creationTime`（墙钟，不保证提交序）；房间级 `eventSeq` 计数器（M-ROOM 已足够，多一个字段多一处可漂移） |

## 3.2 约定

1. **单一类型来源**：字面量集合在 `core/engine/*.ts` 以 `as const` 数组定义（状态见 04 §4.1.2、reasonCode 见 06），`convex/lib/validators.ts` 逐个手写 `v.union(v.literal(...))`，并对两边做双向类型相等断言（`v.union(...xs.map(v.literal))` 会丢失字面量类型，不这样写）：

```ts
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _roleSync: Equals<Infer<typeof roleV>, RoleKey> = true;   // 漂移即编译失败
```

2. **`v.*` 只校验形状**（spikes §1 实测：负数、小数、`NaN`、空串都能写入；`NaN` / `Infinity` 在真实部署上的行为待验证，§8 #5）。下表的值规则在每个唯一写入口的第一步执行，同一函数在前端表单复用（只为即时反馈）：

| 值类 | 规则（`core/engine/values.ts`） | 失败码 |
| --- | --- | --- |
| 金额 `*Cents` | `Number.isSafeInteger(n) && 0 <= n && n <= 1e11`（`assertCents`）；求和走 `sumCents`，溢出视为非法 | `amount.out_of_range` |
| 微美元 `*MicroUsd` | 安全非负整数（`assertMicroUsd`） | `internal`（只由服务端写） |
| 日期 `IsoDate` | `^\d{4}-\d{2}-\d{2}$` + 真实日历日（拒绝 `2026-02-30`），字典序比较；禁止 `new Date("YYYY-MM-DD")` | `date.invalid` |
| 日期窗口 | `localDate <= d <= addDays(localDate, 365)`（`deadline`、shared fact 日期；v1 没有 `preferredDate`，14 §4；canon D12 ⑧） | `date.out_of_range` |
| 天数 `leadDays` | 整数，`0 <= n <= 365` | `date.out_of_range`（06 §4） |
| 键 `itemKey` / 修饰项键 | `^[a-z][a-z0-9_]{1,39}$`；房间内 item 与 modifier 共用一个键空间 | `input.invalid` |
| 人写文本 | NFC → trim → 按码点计长（`assertText(s, limit)`，techstack D40）；见下表上限 | `input.invalid` |
| 目录 `title` / 任务模板 `title` | 额外要求 `^[^<>\r\n]{1,80}$`（唯一进入他方代理上下文的人写字符串，canon D13） | `input.invalid{field:"title"}` |
| 目录 `title`（定界词） | 格式合法后再做 NFKC 归一，含提示词定界词（`untrusted_data`、`room_state`、`candidates`、`shared_facts`、`clarify_answers`、`principal_brief`、`principal_notes`、`turn_instruction`、`system` 的原文或 `&lt;` 形式）即拒绝（06 §4、12 §12.12 ⑤、14 §5 同一两码划分） | `disclosure.blocked{field:"title"}` |
| 计数 / 序号 | 非负安全整数；`version`、`seq`、`rowNo`、`runNo`、`turnSeq`、`attemptNo` 从 1 起（`templateIndex` 从 0 起） | `internal`（只由服务端写） |
| `timeZone` | IANA 名，`Intl.DateTimeFormat(…, { timeZone })` 不抛错（Convex 运行时 `Intl` 时区支持待验证 V-D2） | `input.invalid` |

文本上限 `TEXT_LIMITS`：房间 `title` 120（07 §7.6）；`displayName` 80；目录与任务模板 `title` 80；`softFields.notes` 2,000；`approvals.note` 500（且不含 `\r` 与 U+0000–U+001F，`\n` 除外，08 §8.3.5）；模型 `rationale` 1,200（canon §1.4，先 NFC 再过 Zod）；`invitedEmail` 254（小写化）。

3. **optional / nullable / 删除**：`v.optional(x)` 表示"尚未发生 / 不适用"（如 `acceptedAt`）；`v.union(x, v.null())` 表示"明确为空"的业务语义（如 `runs.activeTurnSeq: null` = 当前没有可持久化的回合、`sharedFacts.value: null` = 撤回、`createdBy: null` = 系统）。清空可选字段只能在 handler 内 `patch({ f: undefined })`；函数参数不能用 `undefined` 表达删除（spikes §1：参数里的 `{ f: undefined }` 会被丢弃成空 patch）。
4. **字段名**：`v.object` 与 `v.record` 的键不得以 `_` 或 `$` 开头（convex `validator.ts` 已核实）。因此 DTO 用 `id` 而非 `_id`；Zod 生成的 JSON Schema（含 `$defs`）永不入库，也不经 `runQuery` 传递（inputs/07：Zod 对象过不了 Convex 值校验）。
5. **索引命名**：canon 已点名的沿用（`by_executionKey`、`by_proposal_user`、`by_turn`、`by_room_order`、`by_room_user`、`by_room_role`），其余同一风格 `by_<字段缩写>_<字段缩写>`；Convex 自动在索引末尾追加 `_creationTime` 作平局字段，本章的"区间计数"利用它，但**任何业务排序都不读 `_creationTime`**（墙钟，不保证提交序）。
6. **时间戳**：`*At` 为 mutation 内 `Date.now()` 的毫秒值，只作展示与过期判定；query 永不读时钟（canon D22），过期类判定（邀请、请求）在 mutation / cron 内做，列表只返回 `expiresAt` 由前端显示。
7. **场景版本**：`rooms.scenarioVersion: v.number()` 建房钉住；所有引用场景版本的字段同为 `v.number()`（08 §8.3.3 的 `executions.scenarioVersion` 以此为准）。
