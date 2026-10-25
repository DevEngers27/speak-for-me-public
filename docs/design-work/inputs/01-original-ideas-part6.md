# 01 原始想法整理（part6）

> 分片清单、行号约定与标注含义见 01-original-ideas-part1.md。

## §7 数据模型草案与可见性

### 7.1 README 的集合与可见性表（R:295-304）

| 集合 | 内容 | 可见性（原文） |
| --- | --- | --- |
| rooms | Goal, state, current versions | Members |
| members | User, role, required approval | Return only what the workflow needs |
| privateBriefs | Goals, constraints, preferences, sharing settings, version | Owner and authorized agent service |
| proposals | Terms, cost, dates, references, version | Authorized members |
| approvals | Approver, proposal/constraint versions, time | Members |
| commitments | Approved spending and revision relationships | Authorized roles |
| tasks | Owner, deliverable, due date, status | Authorized members |
| events | Actor, action, version, outcome summary | Per-event access scope |

README 自己说明 "The current schema does not implement this authorization model"（R:306）。

### 7.2 schema.ts 的实际字段（S:9-46）

| 表 | 字段 | 索引 |
| --- | --- | --- |
| rooms | title: string, ownerId: string, status: state, proposalVersion: number, constraintsVersion: number, totalBudgetCents: number, committedCents: number | 无 |
| members | roomId: id(rooms), userId: string, role, approvalRequired: boolean | by_room, by_user_room |
| privateBriefs | roomId, ownerId: string, goals: string, hardConstraints: string[], preferences: string[], shareableFacts: string[], version: number | by_room_owner |
| proposals | roomId, runId: string, version, constraintsVersion, sourceRole: role, scope: string[], additionalCostCents, deliveryDate: string, publicSummary: string, sourceRefs: string[] | by_room_version |
| approvals | roomId, userId: string, proposalVersion, constraintsVersion, approvedAt: number | by_room_version |
| commitments | roomId, proposalId: id(proposals), operationId: string, amountCents, createdAt | by_operation, by_room |
| tasks | roomId, commitmentId: id(commitments), title, assigneeId: string, dueDate: string, status: todo / done | by_room |
| events | roomId, actorId: string, action: string, proposalVersion, summary, createdAt, visibility: room / private, visibleToUserId?: string | by_room |

### 7.3 逐表评估

| ID | 原作者的想法 | 出处 | 标注 | 评估与建议 |
| --- | --- | --- | --- | --- |
| DM-01 | rooms：目标、状态、当前版本，成员可见；schema 还放了 totalBudgetCents、committedCents | R:297, S:10-14 | 重新评估 | ① 预算是 finance 的私密输入（R:239），放在成员可见的房间文档里违背核心 #1（GAP-01）；② committedCents 是可变计数器，应来自承诺台账或带来源的约束版本；③ 单一 status 混合多种状态（PR-20）；④ 版本计数器可以作为"当前指针"保留，但历史要有自己的表；⑤ README 说有 goal，schema 只有 title；⑥ 缺场景标识（引擎 + 插件） |
| DM-02 | members：用户、角色、是否必需审批；by_user_room 索引 | R:298, S:15-17 | 保留 | 基本形状成立。重新确认：(userId, roomId) 唯一性不能靠索引（CR:11），要在 mutation 中检查；需要成员状态（邀请中 / 活跃 / 已移除）；approvalRequired 改由策略派生（RO-07）；userId 是 Clerk subject 字符串还是 users 表 ID 交 03 |
| DM-03 | privateBriefs：目标、硬约束、偏好、共享设置、版本；仅本人与授权代理服务可见 | R:299, S:18-22 | 重新评估 | ① 硬约束是自由字符串，代码无法校验（GAP-08）→ 场景定义的结构化约束字段 + 给代理看的自由备注；② 缺"抽取 → 本人确认"状态（RO-11）；③ shareableFacts 改为逐字段披露；④ 只有 version 数字，patch 后旧版本丢失 → 需要不可变版本；⑤ by_room_owner 不保证唯一 |
| DM-04 | proposals：条款、成本、日期、引用、版本；授权成员可见 | R:300, S:23-27 | 重新评估 | 保留"版本化、只追加"的意图；需要补：提案状态（或可派生）、父版本 / 基础版本、提出方参与方、内容哈希（审批绑定用）、条目级条款、代码算出的合计与校验结果（reasonCode）、runId 改为引用 run 表；(roomId, version) 唯一性不靠索引 |
| DM-05 | approvals：审批人、提案版本与约束版本、时间；成员可见 | R:301, S:28-31 | 重新评估 | 保留"审批绑定提案版本 + 约束版本"；补：引用 proposalId 而非只用版本号、决定（approve / reject）、审批人所代表的参与方/角色、撤回与过期状态、绑定时的内容哈希；过期审批保留不删（R:245） |
| DM-06 | commitments：已批准支出与修订关系；授权角色可见；operationId + by_operation 索引 | R:302, S:32-35 | 重新评估 | 保留 operationId 幂等思路；README 自己指出索引不强制唯一（R:291, CR:11）→ 在同一 mutation 中查后插（依赖 Convex 事务串行化，待 04 确认）；补 README 提到但 schema 没有的修订关系（如 supersedes）、状态、约束版本快照、对变更单的引用 |
| DM-07 | tasks：负责人、交付物、截止日期、状态 todo / done | R:303, S:36-40 | 保留 | 基本形状成立。补：从提案条目派生任务的规则、对变更单的引用、负责人是参与方而非任意用户、状态集是否要 in_progress / cancelled |
| DM-08 | events：执行者、动作、版本、结果摘要；按事件设访问范围；schema 用 room / private + visibleToUserId | R:304, S:41-46 | 重新评估 | 保留"只追加的事件日志"；二元可见性不够（GAP-15）→ 受众集合（全房间 / 指定角色 / 指定参与方 / 仅系统）；执行者类型（user / agent / system）；动作 enum；引用 proposalId、runId、约束版本；summary 自由文本有泄露风险（P-13） |
| DM-09 | 变更单 change order 是执行产物之一 | R:7, R:241, R:258, R:344 | 重新评估 | schema 里没有变更单表（GAP-02）→ 新增，作为执行事务的主记录，承诺与任务挂在它下面 |
| DM-10 | 协商 run 只以 runId 字符串出现 | S:24, R:284, R:355 | 重新评估 | 新增 run 表（以及可能的回合表）承载生命周期、轮次计数、重试、失败原因、用量 |
| DM-11 | 约束版本只有 rooms.constraintsVersion 计数器，但要求保留约束变更历史 | S:12, R:245 | 重新评估 | 新增不可变的约束版本表（或私密简报版本即约束版本），09 定义哪些修改递增版本 |
| DM-12 | 人工请求（澄清、取舍）在界面与流程中出现，但没有表 | R:245, R:332, R:354 | 重新评估 | 新增人工请求表：对象参与方、问题/选项、状态、回复、关联 run 与版本 |
| DM-13 | sourceRefs 引用"确认过的信息"，但没有来源实体 | N:9, S:26, R:243 | 重新评估 | 新增来源实体：场景目录条目、报价、预算记录等，带"由谁确认、何时、是否模拟"（GAP-07） |
| DM-14 | 邀请两位参与方 | R:253 | 重新评估 | 新增邀请表或使用 Clerk 组织/邀请能力（待 04） |
| DM-15 | 记录模型用量与成本 | R:200, R:355, R:262 | 重新评估 | 新增用量记录（按 run / 调用），供成本显示与度量 |
| DM-16 | 全局 role enum | S:4 | 重新评估 | 角色由场景插件声明（RO-01） |
| DM-17 | 金额字段用 v.number() 存整数美分 | S:13, S:25, S:33 | 重新评估 | 整数美分规则保留；用 v.number() 加整数校验还是 v.int64() 交 03（以 04 为准） |
| DM-18 | 日期用 v.string() 存 ISO 日期 | S:26, S:38 | 保留 | 补充时区与比较规则（GAP-24） |
| DM-19 | 所有 ID 中的 ownerId / userId / actorId / assigneeId 都是裸字符串 | S:11, S:16, S:19, S:29, S:38, S:42 | 重新评估 | 统一身份引用方式（users 表 ID 或 Clerk subject），03 统一命名 |

### 7.4 对可见性表的评估

| 集合 | 原可见性 | 标注 | 说明 |
| --- | --- | --- | --- |
| rooms | Members | 重新评估 | 预算字段搬走后才成立 |
| members | 按需返回 | 保留 | 07 写清每个角色能看到的成员字段 |
| privateBriefs | 本人 + 授权代理服务 | 保留 | 核心 #1 原文；"代理服务"指为本人服务的代理上下文，不是全部代理 |
| proposals | Authorized members | 重新评估 | 提案中可能含 provider 报价明细、finance 余量等，需要字段级披露而不是整条可见/不可见 |
| approvals | Members | 保留 | 审批事实对房间公开有助于透明；拒绝理由是否公开待定 |
| commitments | Authorized roles | 重新评估 | 金额会暴露预算信息；07 决定 customer / provider 能看到什么 |
| tasks | Authorized members | 保留 | provider 需要看到分配给自己的任务 |
| events | 按事件 | 保留 | 方向正确，实现方式见 DM-08 |
