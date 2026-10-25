# 03 Role A 分支决定 · part5：§4 数据形状（二·续）决定、执行记录、事件、全局状态

## 4.4 RA-D12 `Approval` / `Rejection` — 修改后采纳

- **现状**：
  - 两张表（lib/workspace/types.ts:58-59），键都是 (roomId, userId, proposalVersion, constraintsVersion)，没有 proposalId、没有理由、没有唯一性约束；
  - approve 会删除同一用户对同一版本的旧拒绝：`state.rejections = state.rejections.filter((d) => !isCurrent(d))`（lib/workspace/preview-store.ts:253）。UI 在作出决定后把两个按钮都禁用，所以点不到，但存储逻辑允许改写历史（RA-B06）；
  - 不能撤回审批（preview-store.ts:275，文案 "Approvals cannot be withdrawn in the preview"）。
- **保留的部分**：
  - 拒绝必须被记录（product-12 指出旧 schema 缺这个）；
  - 决定同时绑定提案版本与约束版本。
- **问题**：
  1. 两表分开，"某人对某版本的最终决定"要跨表推断；
  2. 删除拒绝违反核心 6；
  3. 拒绝没有理由，无法驱动重新协商（RA-B16）；
  4. 绑定的是版本号，不是不可变内容（security-03）。
- **新设计要求**：

```ts
decisions: {
  roomId: Id<"rooms">; proposalId: Id<"proposals">; contentHash: string;
  constraintsVersion: number; participantId: Id<"participants">; userId: Id<"users">;
  kind: "approve" | "reject" | "withdraw"; reason?: string; createdAt: number;
}
```

  - 只追加；"当前决定"是该参与方对 (proposalId, constraintsVersion) 的最后一条记录；
  - "同一人不能重复批准"由 mutation 先读后写保证（Convex 事务语义以 inputs/04 为准）；
  - reject 的 reason 是否对他方可见、要不要模板化，由 07 决定。

## 4.5 RA-D13 `Commitment` 与变更单 — 修改后采纳

- **现状**：
  - `Commitment {id, roomId, proposalId, operationId, amountCents, createdAt}`（types.ts:60），没有变更单实体；
  - 结果页的 "Change order" 卡片由 commitment + proposal 现拼（components/workspace/results-page.tsx:33-47）；
  - 执行时 `room.committedCents +=`（preview-store.ts:124）；
  - 结果页用"当前已承诺 − 本次金额"推算"执行前"（results-page.tsx:27），对比表用同样的减法构造 basis（components/workspace/workbench.tsx:144-145）。两处都隐含一个房间只有一笔承诺（RA-B09）。
- **保留的部分**：承诺记录带 operationId、金额、所依据的提案。
- **新设计要求**：
  - `executions {operationId (唯一), roomId, proposalId, contentHash, constraintsVersion, decisionIds[], executedByUserId, executedAt, templateVersion}`；
  - `changeOrders {executionId, 冻结的条款快照}`：原 README 至少 6 处承诺写入变更单（docs-04、architecture-10）；
  - `commitments {executionId, budgetId, amountCents}`：预算 ledger 条目，committed 由它求和；
  - `tasks {executionId, ...}`；
  - 对比表、结果页的"执行前 / 后"直接读执行时的快照，不再用减法推算。

## 4.6 RA-D14 `Task` — 修改后采纳

- **现状**：
  - `Task {commitmentId, title, assigneeId, dueDate, status: "todo" | "done"}`（types.ts:61）；
  - 执行时每个范围项生成一个任务，全部指派给 provider 成员（找不到就给房主），截止日等于交付日（preview-store.ts:120-123）；
  - 只有被指派人能切换状态，状态可以来回切（preview-store.ts:352；results-page.tsx:53）。
- **保留的部分**：
  - 任务由批准的提案确定性派生；
  - 只写内部记录（核心 7）；
  - 只有被指派人能更新。
- **问题**：
  1. 审批人看不到批准后会生成哪些任务，任务内容不在被批准的内容里（security-04，RA-B19）；
  2. "全部派给 provider"是场景规则，被写在了引擎里。
- **新设计要求**：
  - 任务模板属于场景插件，模板版本记录在 execution 上；
  - 审批界面显示"批准后将创建的记录"预览（变更单、承诺金额、任务清单）；
  - 派生输入要么纳入 contentHash，要么明确声明"由模板确定性派生"（开放问题 Q10）。

## 4.7 RA-D15 `RoomEvent` — 修改后采纳

- **现状**：
  - `{id, roomId, actorId, action: string, proposalVersion, summary, createdAt, visibility: "room" | "private", visibleToUserId?}`（types.ts:63-73）；
  - 用了 12 种 action 字符串（清单见 §6.8）；
  - summary 是写入时渲染好的英文句子；
  - 可见性过滤在浏览器端做（results-page.tsx:21）；
  - 每个状态变化都与它的事件在同一次 mutate 中写入（preview-store.ts:64-73）。
- **保留的部分**：
  - 事件与状态同事务写入；
  - 同一动作对本人写详细的私密事件，对房间写摘要事件（preview-store.ts:185-192）；
  - 事件只记录动作、版本、结果，不记录隐藏推理（results-page.tsx:62 的说明文字）。
- **问题**（architecture-20，RA-B20）：
  1. action 是自由字符串；
  2. proposalVersion 必填，建房事件只好填 0；
  3. visibility 与 visibleToUserId 能组合出非法状态；
  4. 文本预渲染，无法按受众裁剪或本地化；
  5. 过滤在客户端完成。
- **新设计要求**：
  - `type` 是引擎或场景声明的枚举；
  - `payload` 是按 type 判别的结构化联合；
  - `audience: {kind: "room"} | {kind: "participant", participantId}`；
  - 可选的 proposalId / constraintsVersion / runId / executionId 用于追溯；
  - 文本在查询时按查看者渲染（§8.2）；查询只返回查看者可见的事件。

## 4.8 RA-D16 `WorkspaceState` 与 "same shapes" 迁移说明 — 否决

- **现状**：
  - types.ts:75-86 用一个对象装下所有房间、成员、全员简报（含报价价格）、提案、审批、拒绝、承诺、任务、事件（含私密事件）；
  - `useWorkspace` 返回整个对象（preview-store.ts:76）；
  - types.ts:3-4 写着 "B's queries can replace the local preview store without reshaping the UI"；README diff 第 112 行写着 "swapping `useWorkspace` and `previewActions` for queries and mutations with the same shapes"。
- **否决理由**：照字面实现就是把所有私密字段发到每个浏览器，再在 UI 里隐藏，直接违反核心 1 和原 README:306（gap1-08，RA-B03）。brief-page.tsx:17-18 拿到他人的简报对象（只显示版本号），results-page.tsx:21 在客户端过滤私密事件，都是这种形状的后果。作者在 preview-store.ts:12-13 和 README diff 第 104 行承认预览"cannot keep briefs private"，问题在于迁移说明会误导后端实现者。
- **新设计要求**：读模型按查看者裁剪，客户端不持有全量状态。至少包括：
  - `roomSummary`：共享字段与派生状态；
  - `myBrief`：本人草稿与确认版本；
  - `briefStatuses`：他方只有 version 与 confirmedAt；
  - `proposals`：公开条款与对我可见的检查结果；
  - `decisionStates`；
  - `visibleEvents`；
  - `myHumanRequests`；
  - `results`：变更单、任务、按角色裁剪的预算影响。
