# 18 决策记录与开放问题（part1）：ADR-01～ADR-09

> 本章分 3 片：part1（本文件）ADR-01～09；part2 ADR-10～18；part3 ADR-19～27、输入冲突的裁决记录、开放问题、待验证清单。
> 每条 ADR：背景 → 选项 → 决定 → 后果。"原方案"指原 README（01）与 Role A 分支（03）。

## ADR-01 引擎与场景插件的边界

- **背景**：任务书要求通用引擎 + 首个场景插件，且接口要能容纳第二场景；原 schema 把角色写成全局 enum、预算放在房间上（RO-01、DM-16）；Role A 把角色权限散落在各动作的 if 中（RA-D17）。
- **选项**：A 场景自带表与函数；B 插件 = 声明 + 纯函数，引擎拥有全部表与流程；C 配置 DSL 由引擎解释。
- **决定**：B。插件不碰数据库、时间与身份；引擎不认识任何场景名词。仓库用目录 + lint 划边界，不拆 pnpm workspace 多包。
- **后果**：第二场景只需新增插件与三处注册（06 第 6.16 节检验通过，并据此补了 `format`、`implicitInTerms` 两个接口项）；多币种、负金额、一席多人等需改引擎，已列入 17。DSL 被否决：规则本质是程序，DSL 要么表达力不足要么演化成语言。

## ADR-02 场景载荷如何存进 Convex

- **背景**：引擎表要存场景定型的数据（简报字段、清单项、条款）；Convex schema 是静态的；`v.union(...map)` 会丢失字面量类型（F03.13）。
- **选项**：A `v.any()` + 写入时 Zod 校验；B 每个场景私有表；C 引擎表中的载荷字段使用组合层显式联合的场景校验器。
- **决定**：C。`engineTables(P)` 工厂接收组合层传入的 `briefFields`、`listItemData`、`terms`、`selection` 校验器，场景校验器以 `scenario` 字面量判别。
- **后果**：存储有类型、推送 schema 时校验存量数据；加场景要改 `convex/schema.ts` 一行（组合层，不属于引擎）。Zod 只用于模型输入输出。

## ADR-03 共享清单通用化：范围清单与报价分开

- **背景**：原草案 `scope: string[]`、`sourceRefs: string[]` 是自由字符串，代码无法核对价格来源（GAP-07、F02.1）；Role A 的 `ProviderOption.scope` 也是字符串、确认是客户端布尔（RA-D07、RA-B21）。
- **选项**：A 只有 provider 的报价目录，customer 在简报里引用目录键；B 引擎通用 `listItems`（按 `listKey`），scope_change 声明两份清单：customer 的范围清单、provider 的报价。
- **决定**：B。确认是服务端动作、记录确认人与时间；确认后数据不可改，改价即新版本并递增约束版本；提案以 `{listKey, itemKey, version}` 引用。
- **后果**：未报价的请求项自然进入"延后"（修 RA-B13）；报价改价使引用旧版本的提案被 `SOURCE_SUPERSEDED` 阻断（修 RA-B04）；第二场景复用同一机制。多一份清单带来少量界面工作。

## ADR-04 预算放在哪里

- **背景**：原 schema 把 `totalBudgetCents`、`committedCents` 放在全员可见的 rooms 上（GAP-01、RA-B08）；审查建议独立 `budgets` 表 + `budgetChanges`（F02.4）；Role A 建议 finance 拥有的约束对象（RA-D02）。
- **选项**：A rooms 字段；B 独立 budgets/budgetChanges 表；C 上限是 finance 简报的规则字段，已承诺来自引擎台账 `commitments`（基线 + 执行）。
- **决定**：C。上限的变更历史就是 finance 的简报版本（不可变、带原因）；已承诺 = 台账 active 条目之和，不另存计数器（F02.3）。
- **后果**：所有约束变化走同一条"简报确认 / 清单确认 / 台账 → `bumpConstraints`"路径，比 B 少一张表、少一个入口；可见性由逐字段披露控制（默认披露给 customer）。跨房间共享预算需要新实体（17）。

## ADR-05 身份、席位与邀请

- **背景**：原 members 需预知 userId、无邀请、`approvalRequired` 可改（RO-07、GAP-17）；Role A 身份由角色推出、每角色一人（RA-D05）；平台：只有 `tokenIdentifier` 全局唯一（04 平台约束 1.7）。
- **选项**：A 直接用 Clerk subject 字符串；B `users` 表映射 `tokenIdentifier`，席位与用户分离，邀请绑定席位；C 用 Clerk Organizations 表达角色。
- **决定**：B。一人一席；房主不带签核权；邀请令牌只存哈希、7 天、单次；签核要求由场景声明并快照进提案。
- **后果**：杜绝"知道 roomId 自封 finance"与"一人多席满足三方批准"（F07.9）；不支持换人与一席多人（17）。C 被否决：会产生第二个权限真相源（04 平台约束 3.4）。

## ADR-06 代理编排：自建 scheduler 链

- **背景**：被调度 action 至多一次、不重试；action 与 mutation 不同事务（04 平台约束 1.4–1.5）；审查列出自建 / Workflow / Agent 组件三选项（F10.3）。
- **选项**：A mutation + `ctx.scheduler` + turn 表 + 看门狗；B `@convex-dev/workflow`；C `@convex-dev/agent`。
- **决定**：A（10 第 10.2 节）。
- **后果**：无确定性重放约束，规则迭代不破坏在途实例；需要自己写重试、看门狗、孤儿扫描（10、15 已设计）。若出现全局 429 风暴，再引入 workpool 限流（17）。C 与已定 SDK 冲突。

## ADR-07 run 是有界的协商片段

- **背景**：原方案一个 `status` 混合房间、run、提案、审批（GAP-05、PR-20）；审查的 run 状态含 `pending_approval → confirmed`，并对"约束变化后旧 run superseded + 新 run"还是"同一 run 回到 negotiating"未决（F04.1）。
- **选项**：A run 覆盖协商到执行的全过程；B run 只覆盖代理协商，结局为 `proposal_ready / needs_input / superseded / cancelled`；审批与执行由提案与签核状态表达；约束变化总是开新 run。
- **决定**：B。房间只存 `open/closed`，其余阶段派生（04 第 4.9 节）。
- **后果**：持久化守卫只需比较 `run.constraintsVersion`；审批不必等 run 结束（run 进行中当前提案若可执行仍可签核）；run 记录可读地回答"这一段是在哪个约束版本下谈的"。代价是房间阶段需要派生函数。

## ADR-08 签核模型

- **背景**：原 approvals 只绑定两个版本号、无 decision、无唯一性（DM-05）；审查建议同 (proposal, user) 只保留最新（patch，F03.7）；Role A 建议只追加的 decisions 并支持撤回（RA-D12、RA-R16）；审查还建议区分 terms/budget（F08.3）。
- **选项**：A approvals 行 patch 为最新决定；B 只追加的 `decisions`，当前状态 = 每席位在当前约束版本下的最新一条。
- **决定**：B，加 `signoffKind`（terms/budget）与 `withdraw`。绑定 `proposalId` + `constraintsVersion` + `termsKey` 副本。
- **后果**：满足核心 6（旧决定全部保留，修 RA-B06、RA-B30）；完成判定读取整个提案的签核区间，借 OCC 防并发；执行后不可撤回。比 A 多一个"取最新"的纯函数，成本可忽略。

## ADR-09 约束变化不复制提案

- **背景**：Role A 在上限变化后若方案仍可行就复制一个 `revalidated` 新版本（RA-R11），并把 finance 的动作记成 provider 的提案（RA-B07）；审查建议不递增提案版本（F04.7）。
- **选项**：A 复制新版本；B 提案不变，签核绑定约束版本，可执行性实时派生。
- **决定**：B。G-SIGN 不要求 `proposal.constraintsVersion === room.constraintsVersion`；同一提案在新约束版本下重签即可执行。
- **后果**：没有条款完全相同的重复版本；作者信息不失真；界面需明确提示 "Terms unchanged · constraints v6 → v7 · re-approval needed"。
