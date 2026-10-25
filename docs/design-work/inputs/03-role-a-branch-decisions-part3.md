# 03 Role A 分支决定 · part3：§3 数据形状（一）房间、预算、版本、状态、成员

> 引用格式 `文件:行`，路径相对 /Users/zhennn/Documents/26Fall/cal-hack-2026/src。"新设计要求"是给 02/03/07/09 设计者的输入，最终形状以设计文档为准。

## 3.1 RA-D01 `Room.goal` — 采纳

- **现状**：`goal: string`，注释标为 "schema proposal"（lib/workspace/types.ts:12）；建房要求 title 与 goal 非空（lib/workspace/preview-store.ts:140-142）；RoomFrame 在标题下展示（components/workspace/room-frame.tsx:52）。
- **理由**：原 README 的 rooms 表写了 Goal；共享目标是三方协商的锚点，也是三个代理上下文里唯一一定相同的文本。
- **新设计要求**：goal 是房间共享事实，全体成员可见，只作说明、不进入确定性规则。修改 goal 是否算约束变化列为开放问题 Q12（建议：不算；场景的结构化共享事实，例如客户请求的范围，才算）。

## 3.2 RA-D02 预算字段放在 Room 上 — 修改后采纳

- **现状**：`totalBudgetCents`、`committedCents` 在 Room（types.ts:17-18）。任意角色建房时输入（preview-store.ts:138-149；components/workspace/room-list.tsx:91-92），校验 committed ≤ cap（preview-store.ts:143）。房间卡片、BudgetCard 对全员显示金额（room-list.tsx:63；components/workspace/workbench.tsx:181-203）。room_created、no_feasible_option、constraints_changed、proposal_blocked 四类房间事件把上限、剩余额写进全员可见文本（preview-store.ts:156、213、301、323）。执行时 `room.committedCents += amount`（preview-store.ts:124）。
- **保留的部分**：上限与已承诺两个整数分量；不变式 committed ≤ cap；"cap 不得低于已承诺"（preview-store.ts:293）。
- **问题**：
  1. 原 README:239 把 Remaining budget 列为 finance 的私密输入，与"放在全员可读的 room 上"冲突。审查 architecture-01、code-02、docs-03、product-09 都指出了这一点（RA-B08）。
  2. committed 是可累加计数器（security-04），初值由建房人随手输入，没有来源，也不能追溯是哪几笔承诺构成的（RA-B09、RA-B22）。
  3. 预算与房间一对一，现实中一个项目预算可能被多次变更共同消耗（开放问题 Q2）。
- **新设计要求**：
  - 预算是 finance 席位拥有的约束对象（独立 budget 实体，或 finance 简报的结构化字段），设定与修改都需要 finance 权限；
  - committed = baseline + Σ commitments。baseline 是一条带来源标注、由 finance 确认的记录；
  - 他方能看到什么由 07 的字段×角色矩阵决定。建议默认：他方只看到"在预算内 / 超出预算"的结论和阻断 reasonCode，不看数额；finance 可以对某个数额做一次显式披露，披露本身留记录。

## 3.3 RA-D03 两个版本计数 — 修改后采纳

- **现状**：`room.proposalVersion` 既是计数器，又是"当前提案"指针，靠 `p.version === room.proposalVersion` 查找（lib/workspace/rules.ts:17-18）。`constraintsVersion` 建房时为 1（preview-store.ts:147），只在 changeBudgetCap 中 +1（preview-store.ts:298）。
- **保留的部分**：两个单调递增的计数器是版本绑定的基础；房间标题区常驻显示 "Proposal vN · Constraints vM"（room-frame.tsx:53），让所有人有版本意识。
- **问题**：
  1. 用版本号间接找当前提案，依赖版本号唯一，而唯一性没有落点（architecture-04）；
  2. 约束版本只覆盖预算上限，简报里的硬约束、报价改动都不递增（gap1-07，RA-B02）。
- **新设计要求**：
  - room 保存 `currentProposalId`；proposal 的 version 由创建它的 mutation 从 room 计数器分配，(roomId, version) 唯一；
  - 09 号文档逐项列出约束版本递增点，至少包括：预算上限、baseline；客户必需范围、截止日；报价的确认、撤回、改价（新版本）；必需审批人集合；任何被规则读取的结构化字段；
  - 每次递增写一条不可变约束快照，记录变更人、原因、按受众存储的前后值。

## 3.4 RA-D04 `RoomStatus` — 修改后采纳

- **现状**：沿用旧 schema 的 7 个值 draft / negotiating / needs_input / pending_approval / confirmed / paused / failed（types.ts:7；convex/schema.ts:5）。paused 与 failed 在预览里从未被设置。各动作各自给 status 赋值（迁移表见 §6.7）。
- **问题**：一个字段混了四件事：房间生命周期（draft、confirmed）、协商进度（negotiating）、人工输入（needs_input）、当前提案能否执行（pending_approval 与"被阻断"）。它由每个动作手工维护，容易与数据不一致（architecture-17，RA-B17）。
- **新设计要求**：
  - room 只保留生命周期，例如 draft → active → closed；
  - run 有自己的状态（排队、进行中、成功、失败、过期）；
  - proposal 的 current / superseded / blocked / executed 从数据派生；
  - "需要输入"由未关闭的 humanRequest 派生；
  - paused / failed 只在定义了触发条件的层级出现（例如 run 重试耗尽）。

## 3.5 RA-D05 `Member` — 修改后采纳（审批要求）/ 否决（角色即身份）

- **现状**：`{roomId, userId, role, approvalRequired}`（types.ts:22）。建房时自动把三个预览身份加为成员并各建一份 version 0 的简报（preview-store.ts:150-153），没有邀请。`useRoom` 按角色找"我"（room-frame.tsx:31），隐含每个角色恰好一人。身份是 `preview:${role}`（types.ts:105）。
- **保留的部分**：成员带"是否必需审批"；房间内的角色决定能做哪些动作。
- **否决的部分**：身份由角色字符串推出、建房即自动拥有全部成员。新设计中身份来自 Clerk 会话，服务端从 `ctx.auth` 取，不信任客户端传入的角色（原 README:306）。
- **新设计要求**：
  - participant（房间里的角色席位）与 user（Clerk subject）分开，需要邀请与接受流程；
  - 席位的审批要求来自场景规则；
  - 提案创建时快照必需审批人集合（见 RA-R05）；
  - 一个席位是否允许多人（例如两名 finance）列为开放问题 Q13。

## 3.6 RA-D06 `BriefItem` — 修改后采纳

- **现状**：`{id, text, kind: "hard_constraint" | "preference", shared: boolean}`（types.ts:24）。文本自由输入，id 由浏览器 `crypto.randomUUID()` 生成（components/workspace/brief-page.tsx:100），每行有 "Share with room" 勾选框（brief-page.tsx:97）。
- **保留的部分**：
  - 简报条目分"硬约束 / 偏好"两类；
  - 每一条单独决定是否共享。这是核心 1"对他方可见的内容都经过显式披露决定"的直接体现。
- **问题**：
  1. 硬约束是自由文本，规则从不读取。fixture 中 "Change items 1 and 2 are required in the first delivery."（lib/workspace/fixture.ts:34）、"First delivery is needed by 2026-11-20."（fixture.ts:36）都没有被任何检查使用（gap1-07，RA-B01）。
  2. shared 只有一档，受众固定为全房间，不能只对某一方披露。
  3. 共享条目从未真正呈现给他方。它只出现在本人侧栏的 "What the room can see" 预览里（brief-page.tsx:19、28-31），他方页面没有展示共享事实的地方；fixture 的 sourceRefs 却引用了 "Customer brief v1 · shared: item 3 can be deferred"（fixture.ts:75）（RA-B23）。
- **新设计要求**：
  - 简报分两层：
    - 结构化约束：字段由场景插件定义，例如客户 `requiredScopeItemIds`、`deadline`，finance `budgetCapCents`，provider 的容量。确定性规则读取这一层。
    - 自由文本：目标与偏好，只进入本方代理的上下文。
  - 披露决定单独记录为 `disclosure {subject: fieldKey | itemId, audience: room | participantId, decidedBy, decidedAt}`。已披露内容进入共享事实（sharedFacts），代理只能看到本方简报和已披露事实；
  - 工作台和代理上下文都需要一个"共享事实"的呈现位置；
  - 自由文本可以由 AI 抽取为结构化草稿，但必须本人逐条确认才生效（RA-U10）。
