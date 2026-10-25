# 专题深潜：披露矩阵与代理上下文组装（part1）

> 作者：privacy-disclosure 专题代理。依据 00-brief.md（核心 #1、#2、#4、#8）与 inputs/01–04。
> 分片：part1（本文件）目标、决定、披露类与字段×角色矩阵；part2 字段×角色矩阵（下）与动作×角色矩阵；part3 projectRoomFor、buildAgentContext 与模板渲染；part4 events 可见性、日志与错误纪律、反例与边界；part5 测试、威胁→防线→测试表、接口、待验证。
> 代码草案在 deepdives/privacy-disclosure/（disclosure.ts、project.ts、agentContext.ts、render.ts、events.ts、privacy.test.ts）。

## 1. 目标与范围

目标：把任务书核心 #1"私密委托"变成可执行、可测试的规则——每个字段属于哪个披露类、谁能做哪个动作、服务端怎样投影、代理看到什么、对他方的文字从哪里来、日志和错误里能出现什么。

范围（本专题负责）：
- 字段×角色披露矩阵：rooms、members、users、roomInvites、privateBriefs / briefVersions、sharedFacts、offerItems（目录）、proposals、approvals、budgets / budgetChanges、commitments、changeOrders、tasks、runs、agentTurns、humanRequests、events。
- 动作×角色矩阵：每个公共 mutation / query 的允许角色与守卫，含"代理（internal）"一列。
- `projectRoomFor(viewer)` 与 `buildAgentContext(roomId, role)` 的结构与白名单。
- 对他方可见文本只由代码模板渲染的规则；events 可见性模型；日志与错误纪律。
- 金丝雀、注入、越权测试设计；威胁→防线→测试表。

不在范围：表的完整字段与索引（03）、状态迁移守卫细节（04）、协议消息完整 schema（05）、规则检查实现（06）、执行事务（08）。本专题对这些只提出接口要求（见 part5 第 13 节）。

## 2. 决定与理由

| id | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| PD-1 | **披露类（disclosure class）是字段的属性**，写成代码常量 `DISCLOSURE`（engine 表由引擎声明，场景字段由场景插件声明）。类只有五种：`room`、`roles`（显式角色集合，场景用 side 糖衣声明）、`self`、`owner`、`system`。 | 矩阵变成代码后，投影、上下文组装、金丝雀测试都从同一张表派生，不会漂移。 | 每个 query 手写裁剪：会漂移，Role A 就是这样漏的（RA-B03）。 |
| PD-2 | **预算按买方/卖方划分**：首个场景声明 `sides = { buyer: ['customer','finance'], seller: ['provider'] }`。预算数字（上限、已承诺、余量、缺口、执行后合计）类为 `roles: buyer`；provider 永远拿不到任何预算数字或可反推它的派生值。 | 采纳 F07.1 推荐；customer 与 finance 同属采购方，customer 需要据此做取舍。 | 预算 finance 独享（customer 无法理解阻断原因）；预算作为 finance 授权共享事实（列为扩展点，见 PD-12）。 |
| PD-3 | **派生值继承输入中最严格的类**（污点传播），除非出现在显式的**解密清单**（declassification list，第 4 节）里。 | 泄露常发生在派生值：provider 看到"可行组合列表"等于看到余量。规则化后可审计。 | 逐个判断派生字段：容易漏，如 F07.1 的 "$4,900 被阻断"。 |
| PD-4 | **已确认的目录条目对全房间公开**（title、priceCents、earliestDeliveryDate、simulated）；provider 点"确认"即显式披露决定，按钮文案写明 "Visible to customer and finance"。草稿条目只有 provider 可见。 | 买方必须能核对"金额 = 目录求和"（核心 #4）；提案本来就会展示逐项价格。 | "用到才公开"（Role A brief-page.tsx:31 的说法）：买方无法核算候选组合，且 Role A 只在 UI 层成立（RA-B24）。 |
| PD-5 | **私密简报只有本人可见**，同侧也不共享（finance 看不到 customer 简报）；共享只经 `sharedFacts`：场景词表中的结构化 `{field, value}`，逐项勾选，默认不勾，值只能是日期、itemKey 数组、枚举，不允许自由文本。 | 核心 #1 要求"显式披露决定"；结构化值不会携带注入文本。 | 自由文本 shareableFacts（原 schema）：既是泄露通道又是注入通道（F07.7）。 |
| PD-6 | **对他方可见的文本只由模板渲染**：存 `{type, payload}`，读取时按查看者渲染；模板参数类型里没有自由 `string`；模板拿到的是已按查看者投影过的参数。 | 采纳 F05.3、RA-T01/T02；"渲染器只拿到投影后的参数"是第二道防线，即使模板写错也取不到无权字段。 | 写入时预渲染文本（RA-T02 否决）；模型写公开摘要再正则扫数字（F05.3 否决）。 |
| PD-7 | **模型自由文本（rationale）只给本方**，存在 agentTurns，类 `self`；clarify 的问题也改为结构化 `topic + itemKeys/date`，自由措辞只进 rationale。 | 关闭"代理说出自己委托人私密值"这一主泄露路径，同时关闭跨代理注入通道。 | 05 草案的 `clarify.question: string` 直接转给他方——这是遗留的泄露通道（本专题对 05 的接口要求）。 |
| PD-8 | **events 全部房间可见，payload 只含 `room` 类字段**；受限细节存在本来就受角色控制的行里（budgetChanges、agentTurns、humanRequests），事件只存 `restrictedRef`，渲染时按查看者决定是否连接。没有 `visibility` 字段。 | 采纳 F07.6 多数意见并给出折中：同一事件对不同角色有不同详略（RA-T02），但存储层没有"部分可见事件"，分页不需要过滤，忘记过滤也不会漏。 | `{kind:'roles'}` 判别联合（F07.6 备选）：分页后过滤导致页大小不均，且一旦漏写过滤就整条泄露。 |
| PD-9 | **公共 query 只返回 DTO**：显式逐字段挑选，禁止 `...doc`；声明 `returns` 校验器；受限段落用 `v.optional`，只在查看者有权时填充。 | Convex 没有字段级 ACL（F07.2）；`returns` 校验在多填字段时报错是额外一道网（是否拒绝多余字段待验证）。 | 返回整文档再由前端过滤（RA-B03）。 |
| PD-10 | **代理上下文单一入口**：`internal.agentContext.forTurn({ turnId })` 从回合记录推导 roomId 与 role，调用纯函数 `buildAgentContext`，返回显式白名单对象；其他角色的简报、rationale、人类自由文本、displayName 一律不进入。 | F07.5；role 不从参数取，杜绝"替别人跑"。 | 按 roomId collect 全部 briefs 再在 JS 里过滤（F07.5 点名的泄露点）。 |
| PD-11 | **日志与错误只含白名单字段和错误码**：`logEvent(code, fields)` 是 convex/ 下唯一允许的日志出口；`ConvexError({ code })` 不带数值；第三方错误映射成错误码后丢弃原消息。 | F07.8；Convex 日志会记录 console 输出与异常消息，生产环境的消息遮蔽只是兜底（待验证）。 | 依赖生产环境自动隐藏非 ConvexError 消息：开发部署照样泄露，且不覆盖 console。 |
| PD-12 | v1 不提供"finance 向卖方披露预算"开关；词表留扩展点 `finance.budgetCapToSeller`。 | 反对过度设计；先把默认最安全路径做扎实。 | v1 即支持：增加一类投影分支和测试矩阵，收益小。 |

## 3. 披露类（引擎定义）

```ts
// engine/privacy/classes.ts
export type Audience =
  | { kind: 'room' }                       // 房间全部活跃成员
  | { kind: 'roles'; roles: RoleKey[] }    // 显式角色集合；场景用 side 声明
  | { kind: 'self' }                       // 记录的所属角色（ownerRole）
  | { kind: 'owner' }                      // 房主（只用于邀请与运营汇总）
  | { kind: 'system' };                    // 永不离开服务端

export function canSee(viewer: Viewer, a: Audience, ownerRole?: RoleKey): boolean {
  switch (a.kind) {
    case 'room':   return true;                         // viewer 已通过 requireMember
    case 'roles':  return a.roles.includes(viewer.role);
    case 'self':   return ownerRole !== undefined && viewer.role === ownerRole;
    case 'owner':  return viewer.isOwner;
    case 'system': return false;
  }
}
```

- `self` 以角色为单位，不以 userId：首个场景每角色一人（F02.6），代理以角色为委托人。若将来一角色多人，`self` 仍指"同角色成员"，在 17 路线中重新评估。
- `owner` 不带来任何业务字段的读取权（房主身份不带审批权，F07.4）。
- 代理的读取权等于其委托人角色的读取权，再减去"人类自由文本"和"displayName"（PD-10）。

## 4. 解密清单（派生值的显式例外，v1 全集）

| # | 派生值 | 输入里的受限数据 | 公开给 | 理由 / 可接受的最小披露 |
| --- | --- | --- | --- | --- |
| X1 | `proposal.executable: boolean` | 预算、customer 硬约束 | room | 所有审批人必须知道能否推进 |
| X2 | `blockedReasonCodes: BlockReason[]`（枚举集合，不带数值与条目） | 同上 | room | provider 可推断"超预算/缺必需项/晚于截止"，这是 F07.1 认可的最小披露 |
| X3 | `constraintsVersion` 计数与"某类约束已变更"（`constraintKind`，不带新旧值） | 预算、简报 | room | 审批失效必须可解释（核心 #3） |
| X4 | `run.endedReasonCode`（如 `no_feasible_option`、`rounds_exhausted`） | 预算、简报 | room | 解释为何停在 needs_input |
| X5 | 人工请求的存在、`targetRole`、`kind`、`status` | 视请求而定 | room | 其他方需要知道在等谁 |
| X6 | 各方简报 `confirmed` 状态、确认版本号、共享事实条数 | 简报 | room | 开始协商的守卫需要可见（RA-T03 认可计数元数据） |

不在清单里的派生值一律继承最严格输入的类。例：`candidates`（代码枚举的可行组合）若用预算过滤过，类为 `roles: buyer`；给 provider 的候选只能用 provider 可见数据计算（见 part3）。

## 5. 字段×角色披露矩阵（上）

记号：● 可见；○ 不可见；◐ 有条件（见备注）。cus=customer，pro=provider，fin=finance，own=房主附加权限，sys=仅服务端。代理列等于其委托人列，例外在备注中写明。

### 5.1 rooms / users / members / roomInvites

| 表.字段 | cus | pro | fin | 类 | 备注 |
| --- | --- | --- | --- | --- | --- |
| rooms.title, goal | ● | ● | ● | room | 房主撰写的自由文本：人可见；进代理上下文时只放 `goal`，且置于不可信数据块 |
| rooms.scenarioKey, status, timezone, currency, createdAt | ● | ● | ● | room | |
| rooms.constraintsVersion, proposalVersion | ● | ● | ● | room | X3 |
| rooms.currentRunId, currentProposalId | ● | ● | ● | room | ID 本身不敏感 |
| rooms.fixtureKey / simulated | ● | ● | ● | room | 核心 #8：模拟数据必须标注 |
| rooms.ownerUserId | ○ | ○ | ○ | sys | DTO 只给 `ownerMemberId` 与 `isOwner` |
| users.tokenIdentifier | ○ | ○ | ○ | sys | 身份主键，永不返回 |
| users.displayName | ◐ | ◐ | ◐ | room | 只经 members 快照给同房间成员；不进任何代理上下文（注入面） |
| members.role, displayName, joinedAt | ● | ● | ● | room | |
| members.userId | ○ | ○ | ○ | sys | DTO 给 `isMe: boolean` |
| roomInvites.role, status, expiresAt, createdAt | own | own | own | owner | |
| roomInvites.tokenHash | ○ | ○ | ○ | sys | 明文邀请码只在 `invites.create` 的返回值里出现一次 |
