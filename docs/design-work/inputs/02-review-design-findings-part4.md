# 02 审查设计发现 · part4：03 schema（二）横切规则、04 状态机

> 分片清单见 part1。

## 03 schema 横切规则

### F03.12 唯一性靠"同一 mutation 内先查后写 + OCC"
- 问题：Convex 没有唯一约束，索引不保证唯一（README.md:291、`convex/README.md:11`）；approvals 双击会插两行，members 可以一人插三条。
- 建议：所有"逻辑唯一"（invite code、(roomId, role) 成员、(proposalId, userId) 审批、(roomId, itemKey) 目录项、operationId）都在同一个 mutation 里用索引 `.unique()` 查后再写；同一 mutation 内的读写由 OCC 保证可串行化。设计文档要给每个唯一性写明"由哪个 mutation 守"。
- 来源：architecture-04、security-03/-05、P9、P15。

### F03.13 类型的单一来源：Convex `v` 管存储，Zod 只管模型 I/O
- 问题：Zod（`negotiation.ts`）与 Convex 校验器（`schema.ts`）两套定义已经漂移：role 重复定义、action 只在 Zod、roomId 一边是 string 一边是 Id、金额 `v.number()` 允许小数和负数（`negotiation.ts:4/:7/:8/:12`，`schema.ts:4/:11/:13/:25-26/:34`）。
- 建议：Convex `v` 管存储与函数参数，用 `Infer` 导出类型；Zod 只用于模型输入输出。`v.union(...ROLES.map(r => v.literal(r)))` 会丢失字面量类型，所以两处各写一份，再加编译期断言：`Infer<typeof roleV>` 与 `(typeof ROLES)[number]` 互相可赋值。不引入 convex-helpers 做 Zod 转换，不用 `v.int64()`。
- 来源：docs-13、code-09、architecture-24、security-15（M9）。

### F03.14 金额与日期
- 金额：`assertCents(n)` = `Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000`，在 updateBudget、目录写入、seed 等所有金额入口调用；UI 按美元输入时 `Math.round(parseFloat(x) * 100)`；v1 不支持负金额（不做退款）。
- 日期：存 `YYYY-MM-DD` 字符串，入口用 `z.iso.date()` 或 `/^\d{4}-\d{2}-\d{2}$/` 校验，格式通过后按字典序比较。日期语义规则见 06。
- 来源：architecture-24、security-15、security-22（M9、L1）。

### F03.15 契约文件位置与导入
- 契约放 `convex/lib/contract.ts`（或被 Convex 用相对路径导入的共享模块）；`convex/` 下不要用 `@/` 别名（Convex 打包器是否解析根 tsconfig paths 待验证，直接避开）。只依赖 zod 的模块被 Convex 相对导入时会一起打包（据 Convex 文档，未实测推送）。
- 来源：P11 第 6 点、architecture-24、M9。

### F03.16 公共 query 声明 `returns` 校验器
- `rooms.view` 等返回 DTO 的 query 声明 `returns`（`registration.d.ts:602` 已核实存在）；finance 专属字段在校验器里写 `v.optional`，代码只在 role 为 finance 时填充。据 Convex 文档，`v.object` 返回值校验会拒绝多余字段，因此误把私密字段混进 DTO 会直接报错（未本地运行，待验证）。
- 来源：architecture-19、M9。

### F03.17 schema 演进
- 推送 schema 时 Convex 会校验已有数据；新增字段先 `v.optional`，再回填；个人开发部署可以清表重新 seed。
- 来源：architecture-25、P6 第 5 点。

## 04 状态机（→ 04-state-machines）

### F04.1 状态只定义在 room 上，没有迁移规则
- 问题：`rooms.status` 一个字段承载全部流程，没有转移表；confirmed 之后的"新 flow"与非法迁移都不受约束（`schema.ts:5`；README.md:291）。
- 设计要求：room 与 run 分离；run 状态迁移由一张代码表守护。
- 建议方案：
  - `room.status` 只保留 `'open'|'closed'`。
  - `convex/lib/state.ts` 导出 `RUN_STATUSES`、`runStatus` validator、`ALLOWED: Record<From, To[]>` 和 `assertTransition(from, to)`；所有修改 run.status 的 mutation 都必须调用它。runs 表的 status 与它共用同一个联合类型，不要出现两套。
  - 最少迁移表（审查给出，需补全触发者与守卫）：

| from | to | 触发 |
| --- | --- | --- |
| negotiating | pending_approval | 回合产出可行提案 |
| negotiating | needs_input | 代码判定无可行解，或轮次用尽 |
| negotiating | failed | 回合失败（failTurn） |
| negotiating | superseded | 约束变更，新 run 取代 |
| pending_approval | confirmed | 全部必需审批到齐并执行 |
| pending_approval | negotiating | 被拒，或约束变更后在同一 run 内重谈 |
| pending_approval | superseded | 约束变更，新 run 取代 |
| needs_input | negotiating | 人工请求被回答 |
| needs_input | superseded | 约束变更 |
| failed | negotiating | retryTurn |

  - confirmed 是终态；修订已确认协议就是开一个新 run。
- 整理者注：P5 第 2 点写"状态 pending_approval → negotiating"，同时又说"把当前 run 标 superseded 并新建 run"。两种写法不能同时成立，04 必须二选一：约束变更时是"旧 run → superseded + 新 run（trigger budget_change）"，还是"同一 run 回到 negotiating"。architecture-02 与 security-08 的 updateBudget 步骤都是前者。
- 来源：architecture-18、architecture-02、architecture-05（P5 第 6 点）。

### F04.2 两组守卫，不能混用（红队修订）
- 审批 / 执行守卫（在 approve 与执行 mutation 中）：`run.status === 'pending_approval'`、`room.currentProposalId === proposalId`、`proposal.constraintsVersion === room.constraintsVersion`。
- 回合持久化守卫（在 completeTurn 中）：`room.currentRunId === runId`、`run.nextTurnSeq === turnSeq`、`room.constraintsVersion === run.constraintsVersionAtStart`；任一不满足就写 `turn_rejected_stale` 事件并丢弃结果。
- 来源：final/_a1.md P5 第 5 点修订、redteam_partial.md P14 第 2 点修订、architecture-05。

### F04.3 回合（turn）状态
- `running → succeeded | invalid_output | failed | stale`。invalid_output 计入有界重试；failed 可由 retryTurn 以同一 turnSeq、attempt + 1 重来；stale 是持久化守卫拒收后的终态。
- 来源：architecture-13、architecture-06（P14）。

### F04.4 提案状态
- `active | superseded | executed`（轻量版人工取舍再加 `option`）。"可执行 / 被阻断"不入库，读取时派生：`isExecutable = proposal.constraintsVersion === room.constraintsVersion && validateProposal(...)` 通过。每房间同时只有一个 active 提案，"待批提案不预占预算"由此自然成立。
- 来源：architecture-17、docs-02、P7 第 3 点。

### F04.5 审批没有独立状态
- 审批只存最新 decision；"已失效"由 `approval.constraintsVersion !== room.constraintsVersion` 或 proposalId 不是当前提案派生出来，界面显示为 invalidated，记录不删不改（README.md:245）。reject 之后 run 转 negotiating 或 needs_input，并写事件。
- 来源：architecture-02/-04、security-03。

### F04.6 人工请求与邀请
- humanRequest：`open → answered | cancelled`；任何约束变更都取消所有 open 请求。
- invite：`unused → accepted`；【改写】加 expiresAt 后增加 `expired`（读取时派生即可）。
- 来源：architecture-12、security-05。

### F04.7 Role A 分支里需要拍板的版本语义
- 约束变化时要不要递增 proposal version？审批已经绑定 constraintsVersion，再递增是冗余。建议不递增。
- 约束变化后重新校验得到的版本，其 sourceRole/actor 应记为 system（或 finance），不能仍记为 provider。
- 来源：gap1-06（P3 第 4 点）。
