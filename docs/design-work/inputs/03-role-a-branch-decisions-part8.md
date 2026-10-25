# 03 Role A 分支决定 · part8：§6.7–6.8 状态与事件模型

## 6.7 RA-S01 / RA-S05 / RA-S06 状态迁移 — 修改后采纳（集合作参考，赋值方式否决）

**现状迁移表**（全部由动作手工给 `room.status` 赋值，lib/workspace/preview-store.ts）：

| 动作 | 谁可以 | 守卫 | 状态变化 |
| --- | --- | --- | --- |
| createRoom（:138） | 任意角色 | title、goal 非空；committed ≤ cap | — → draft |
| saveBrief（:162） | 本人 | goal 非空；报价合法 | 三份简报 version 都 > 0 时 draft → negotiating；其余不变 |
| proposeFromOptions（:199） | 任意角色 | 未 confirmed；provider 有已确认报价 | 有可行报价 → pending_approval（新提案）；无 → needs_input |
| approve（:241） | 必需审批人 | 未 confirmed；检查全过；未重复 | needs_input → pending_approval（当前版本无拒绝时）；最后一票 → confirmed |
| reject（:266） | 必需审批人 | 未 confirmed；未批准过 | → needs_input |
| changeBudgetCap（:287） | finance | 未 confirmed；cap ≥ committed；值有变化 | → pending_approval（仍可行，复制版本）/ needs_input（阻断） |
| resendExecution（:330） | 任意角色 | — | 不变 |
| toggleTask（:348） | 被指派人 | — | 不变 |

**观察**：
- paused、failed 从未进入；
- proposeFromOptions 不要求三份简报都已确认，draft 状态下也能产生提案（RA-B15）；
- confirmed 之后一切修改都被拒绝，界面提示 "Start a new room to revise it"（preview-store.ts:292）；
- 一次拒绝就让房间进入 needs_input。退出方式只有改简报或改上限，因为 proposeFromOptions 会拒绝重复提出同一个最优报价："already uses the best confirmed option … Change a brief or the budget cap first"（preview-store.ts:217-221）。拒绝没有理由，也不触发任何后续，是一条死路（RA-B16）；
- status 与数据可能不一致。例如 A 拒绝后 B 批准，房间仍是 needs_input。存储逻辑里只有 A 本人改为批准、删掉自己的拒绝，房间才回到 pending_approval（preview-store.ts:253-255）；而 UI 在 A 作出决定后禁用了两个按钮，所以房间实际停在 needs_input，直到约束变化。

**裁决与新设计要求**：
- **RA-S01**：七个状态名可以作为 04 的参考词汇，但分层（RA-D04）；每条迁移只由一个函数触发并带守卫；blocked、needs_input、pending_approval 尽量从数据派生，不手工赋值；
- 开始协商的守卫：全部必需简报已确认，且场景要求的结构化字段齐全；
- **RA-S05**：已执行的协议不可修改，这一点保留；但修订应在同一房间开新一轮（新 negotiation round），关联旧 execution，不应要求新建房间（原 README:291 "Revisions to confirmed agreements start a new flow and preserve history"）；
- **RA-S06**：拒绝必须带理由（可选模板 + 自由文本），并触发两种后续之一：可行集合内还有其他方案 → 重新协商 run；否则 → humanRequest。

## 6.8 RA-S02 / RA-S03 / RA-S04 事件与动作结果 — 采纳（形状）/ 修改（内容）

**现状事件清单**（12 种 action，全部写在 preview-store.ts 中）：

| action | 写入者 | 受众 | 文本中的敏感内容 |
| --- | --- | --- | --- |
| room_created | createRoom | room | 上限、已承诺金额 |
| brief_confirmed（私密版） | saveBrief | 本人 | 硬约束、偏好、共享条目、已确认报价的数量 |
| brief_confirmed（房间版） | saveBrief | room | 共享条目数量 |
| proposal_recorded | proposeFromOptions | room | 报价 label、金额（随提案公开，可接受） |
| no_feasible_option | proposeFromOptions | room | 剩余预算 |
| approved / rejected | approve / reject | room | 版本号 |
| executed | execute | room | 承诺金额、任务数、operationId |
| duplicate_execution_ignored | resendExecution | room | operationId |
| constraints_changed | changeBudgetCap | room | 新旧上限 |
| proposal_revalidated | changeBudgetCap | room | 合计金额 |
| proposal_blocked | changeBudgetCap | room | 合计金额与新上限 |
| task_updated | toggleTask | room | 任务标题 |

**采纳**：
- **RA-S02**：每个动作全有或全无。mutate 先重读、克隆、修改，只有 ok 才保存（preview-store.ts:64-69），返回 `{ok, message}`（preview-store.ts:18），UI 在 aria-live 区域显示；
- **RA-S03**：事件与状态在同一次 mutate 中写入（preview-store.ts:71-73）；
- **RA-S04**：同一动作对本人写详细私密事件、对房间写摘要事件（preview-store.ts:185-192）。

**修改**：
- 动作返回 `{ok: true, ...结果} | {ok: false, reasonCode, params}`，文本由客户端或查询按受众渲染。message 不得含他方私密值。反例："The cap cannot be below committed spend ($4,000)"（preview-store.ts:293）只能返回给 finance，而这条恰好只有 finance 能触发，属于碰巧安全；
- 事件 type 枚举化，payload 结构化；
- 删除 proposal_revalidated（RA-R11）；
- duplicate_execution_ignored 改为运维日志（RA-R09）；
- 带金额的房间事件按披露矩阵拆成受众版本（RA-T03）；
- 新增事件类型至少包括：participant_invited / participant_joined、offer_confirmed / offer_withdrawn、constraints_changed（结构化，带快照引用）、run_started / run_completed / run_failed、agent_message_posted、human_request_opened / human_request_answered、decision_recorded（approve / reject / withdraw）、execution_completed（替代 executed）。

# §7 四个页面的信息架构与交互

## 7.1 全局框架与导航 — 修改后采纳

- **现状**：
  - 顶部导航 Overview / Rooms / Setup，外加 "Preview as" 角色下拉框（app/layout.tsx diff；components/workspace/role-switcher.tsx）；页脚写 "Local preview · Simulated data only"；
  - RoomFrame（components/workspace/room-frame.tsx:43-61）包括：返回链接、标题、goal、状态徽章、"Proposal vN · Constraints vM"、"Viewing as <角色>"、预览横幅，以及三个 tab：Workbench / My private brief / Results & history；
  - 每个动作的结果显示在 `aria-live="polite"` 区域（room-frame.tsx:22-24）。
- **裁决**：
  - RoomFrame 结构采纳。版本号常驻标题区，是很好的"版本意识"设计；
  - aria-live 反馈采纳；
  - "Preview as" 与预览横幅否决（RA-U13），身份来自 Clerk；
  - 保留"模拟数据"徽章或横幅，只用于 isSimulated 的房间和记录。

## 7.2 房间列表 `/rooms` — 修改后采纳

- **现状**（components/workspace/room-list.tsx）：
  - 房间卡片：标题链接、状态、goal、"Proposal vN · Constraints vM · $X of $Y committed"，以及"轮到你"徽章 "Your brief is not confirmed" / "Your approval is needed"（:54-66）。后者只在当前提案检查全过、且我的状态为 pending 或 stale 时出现（:58-59）；
  - 新建表单：title、shared goal、budget cap、already committed（:68-96）；
  - Invitations 占位卡（:40-43）；
  - Reset 卡，带 `window.confirm` 二次确认（:27-29）。
- **裁决**：
  - "轮到你"徽章采纳并扩展：待回答的 humanRequest、待确认的抽取结果、被拒绝后需要处理的提案；
  - 预算数字从卡片移除，或只对 finance 显示；
  - 新建表单拆分：建房人填 title、goal、场景；预算由 finance 在自己的预算面板中填写并确认；
  - 增加邀请与加入流程；
  - Reset 移到 dev / demo 环境的运维工具（RA-U14）。

## 7.3 我的私密简报 `/rooms/[roomId]/brief` — 采纳（信息架构）/ 修改（交互）

- **现状**（components/workspace/brief-page.tsx）：
  - 编辑器：goal 文本框；条目行（文本、类型下拉、"Share with room"、Remove）；provider 专属的报价行（Label、Scope items 逗号分隔、Price、Delivery date、Confirmed、Remove）；"Confirm brief v{n+1}" 按钮无改动时禁用，旁边显示 dirty 提示（:56-124）；
  - 侧栏一："What the room can see"，列出本人已确认版本中标记共享的条目；provider 另有一句 "Option prices stay private until a proposal uses one"（:27-32）；
  - 侧栏二："Other participants"，他方只显示 "brief vN confirmed <时间>" 或 "not confirmed yet"，并写明内容不会显示（:33-39）；
  - 侧栏三："Extract from pasted text"，禁用的文本框，说明抽取需要代理服务，抽取结果也需要本人确认（:40-44）。
- **采纳**：
  - 三块侧栏的信息架构：我能决定什么可见（RA-U08）、他方进度只有版本与时间（RA-U09）、抽取后必须确认（RA-U10）；
  - "确认产生新版本"的心智模型。
- **修改**：
  - 草稿自动保存，确认是单独动作。确认前列出"对规则有影响的变化"，并警告"这会让约束版本 +1，当前提案的已有审批将失效"；
  - 范围项从场景目录中选择，不再用逗号分隔的自由文本；
  - 报价的确认是单独按钮，确认后锁定，改价即新版本；
  - "What the room can see" 由服务端披露模型生成，显示他方真实能看到的内容，包括"报价被提案引用后会公开"；
  - 抽取：粘贴文本 → 服务端代理抽取为结构化草稿，每条标注来源片段 → 本人逐条确认、修改或丢弃。未确认的不生效（核心 4）。
