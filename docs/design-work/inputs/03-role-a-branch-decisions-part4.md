# 03 Role A 分支决定 · part4：§3 数据形状（一·续）报价、简报生命周期、角色

## 3.7 RA-D07 `ProviderOption` — 修改后采纳（本分支最重要的数据决定之一）

- **现状**：`{id, label, scope: string[], costCents, deliveryDate, confirmed}`（lib/workspace/types.ts:27），挂在 provider 简报的 `options` 下（types.ts:34）。只有 provider 能填（lib/workspace/preview-store.ts:170），保存时校验 label、scope 非空、价格为非负安全整数、日期格式（preview-store.ts:171-175）。`confirmed` 是表单里的一个勾选框（components/workspace/brief-page.tsx:112）。只有 confirmed 的选项能成为提案（lib/workspace/rules.ts:76）。
- **保留的部分**：
  - 原 README:243 要求"价格、范围、日期只能来自用户确认的信息"，本分支给了它具体结构：报价是 provider 本人录入并确认的结构化记录；
  - 提案的金额、范围、日期直接从这条记录复制，不经过模型（核心 4）。
- **问题**：
  1. scope 是自由字符串，靠字符串相等匹配（rules.ts:87-88；preview-store.ts:222-223），没有范围目录，也没有稳定 id。
  2. confirmed 由客户端布尔决定，没有确认人、确认时间，也不知道确认的是哪个版本。编辑价格后仍保持 confirmed；房间已确认后仍可修改（RA-B21）。
  3. 报价在被提案引用之后再改，提案不会察觉，仍可批准、可执行（RA-B04）。
  4. 没有有效期（security-22），没有付款条款，没有容量约束。
  5. 报价放在私密简报里，一旦被提案引用就公开，但"何时由私密变公开"没有建模。brief-page.tsx:31 写着 "Option prices stay private until a proposal uses one"，这只在 UI 层成立，数据其实在同一份共享 state 里（gap1-08）。
- **新设计要求**（建议形状，最终以 03-schema 为准）：

```ts
// scenario: scope_change（场景插件拥有的表或文档类型）
scopeItems: { roomId: Id<"rooms">; key: string; title: string; requestedByParticipantId: Id<"participants"> }
offers: {
  roomId: Id<"rooms">; providerParticipantId: Id<"participants">;
  offerKey: string; version: number;              // (roomId, offerKey, version) 唯一
  label: string; scopeItemKeys: string[];
  priceCents: number;                              // 整数分
  deliveryDate: string;                            // YYYY-MM-DD，真实日历日
  validUntil?: string;
  status: "draft" | "confirmed" | "withdrawn";
  confirmedBy?: Id<"users">; confirmedAt?: number;
  origin: "manual" | "extracted" | "fixture"; isSimulated: boolean;
}
```

  - 确认是独立的服务端动作，写入 confirmedBy / confirmedAt。确认后的版本不可修改；改价就是新版本，并递增约束版本；
  - 提案以 `{offerKey, version}` 引用报价，价格、范围、日期由代码从报价复制。模型只能选择引用哪些报价，不能填数；
  - 报价被提案引用前，他方不可见；被引用后，其条款作为提案内容公开。这是一个隐式披露，07 必须写明，provider 确认报价时界面也要提示。

## 3.8 RA-D08 `PrivateBrief` 生命周期 — 修改后采纳

- **现状**：
  - 形状 `{roomId, ownerId, goals, items, options, version, confirmedAt}`（types.ts:29-37），与旧 schema 的 `{hardConstraints[], preferences[], shareableFacts[]}` 不同。README 的 "Schema proposals" 漏列了这项结构变化（gap1-08，RA-B27）。
  - 建房时为三方各建一份 version 0 占位（preview-store.ts:152）。
  - saveBrief 保存即确认：原地覆盖 goals / items / options，version+1，confirmedAt = now（preview-store.ts:177-181）。
  - 三份简报 version 都 > 0 时，房间从 draft 进入 negotiating（preview-store.ts:193）。
  - 没有改动时确认按钮禁用（brief-page.tsx:120）；编辑器以 `${userId}:${version}` 为 key，保存新版本后重挂载（brief-page.tsx:25）。
- **保留的部分**：
  - 简报带版本号和确认时间；
  - 全部必需简报确认后才开始协商；
  - 无改动不产生新版本。
- **问题**：
  1. 原地覆盖违反核心 6。sourceRefs 中的 "Provider brief v1 · option: Phase 1" 在 v2 之后无从解析（RA-B05）。
  2. 草稿与确认没有分开，也没有"抽取 → 确认"的生命周期（architecture-21）。
  3. 改动硬约束或报价时不递增约束版本，旧审批照样有效（RA-B02）。
  4. 房间已确认后仍可保存（RA-B21）。
- **新设计要求**：
  - `briefDrafts`：可变，仅本人可读写，可自动保存；
  - `briefVersions`：确认后不可变，只追加；
  - 确认动作计算"对规则有影响的结构化差异"，有差异就递增房间约束版本，并在确认前提示"这会让当前提案的已有审批失效"；
  - 房间关闭后简报冻结。

## 3.9 RA-D17 `AgentRole` 与角色权限 — 修改后采纳

- **现状**：
  - `agentRole = z.enum(["customer", "provider", "finance"])`（lib/negotiation.ts:4），本分支补了 `export type AgentRole`（negotiation.ts:21）；
  - roles 与 roleLabel 写在 types.ts:88-90；
  - 取舍提示按角色写死（components/workspace/workbench.tsx:18-22）；
  - "只有 provider 能填报价"（preview-store.ts:170）、"只有 finance 能改上限"（preview-store.ts:291）、"任务指派给 provider"（preview-store.ts:120）散落在各个动作里。
- **理由**：任务书要求引擎能容纳第二个场景。角色、角色可做的动作、角色专属的结构化字段、任务派生规则都属于场景，不该写成引擎里的 enum 和 if。
- **新设计要求**：
  - 引擎只认 `roleKey: string`；
  - 场景插件声明 `roles[]`：label、是否必需审批、可编辑的结构化字段、可触发的动作、可回答的 humanRequest 类型；
  - 07 的动作×角色矩阵由这份声明生成；引擎在每个入口按声明校验。

# §4 数据形状（二）提案、决定、执行记录、事件、全局状态

## 4.1 RA-D10 `Proposal` 字段 — 修改后采纳

- **现状**：`{id, roomId, runId, version, constraintsVersion, sourceRole, scope, deferredScope, additionalCostCents, deliveryDate, publicSummary, sourceRefs: string[], origin, createdAt}`（types.ts:41-56）。预览从不修改已有提案，只追加（preview-store.ts:225、308）。
- **保留的部分**：
  - 字段集基本对：范围、延后范围、金额、日期、公开摘要、来源、基于的约束版本、产生它的 run；
  - 只追加不修改，符合核心 6。
- **问题**：
  1. 没有状态或可执行性字段，每次在 UI 里现算（architecture-17）。
  2. 没有内容哈希，审批只能绑定版本号（security-03）。
  3. sourceRefs 是人类可读字符串，例如 "Provider brief v1 · option: Phase 1"（preview-store.ts:229），机器无法核对（RA-B05）。
  4. sourceRole 被写死成 "provider"，即使提案是固定规则选出的、由任意角色触发的（preview-store.ts:226），或者是 finance 改上限后复制出来的（preview-store.ts:309）（RA-B14）。
  5. runId 是伪造字符串 "preview-<时间戳>" 或 "fixture-run"。
  6. 没有行项目（每个范围项多少钱），也没有付款条款（finance 的私密偏好 f3 "Prefer milestone-based payment" 无处落地）。
- **新设计要求**：
  - **不可变内容**：`terms {scopeItemKeys, deferredScopeItemKeys, priceCents, deliveryDate, offerRefs: {offerKey, version}[], paymentTerms?}`；`contentHash` 由 terms 的稳定序列化计算；
  - **服务端信封**：roomId、version、runId?、authorKind、authorParticipantId?、constraintsVersionAtCreation、derivedFromProposalId?、createdAt、isSimulated；
  - **派生结果**：当前约束版本下的 checks[]，以及 current / superseded / blocked / executed，不存或只作缓存；
  - **publicSummary**：由代码模板从 terms 生成（§8.2）。代理撰写的解释另设字段，并标注为代理撰写。

## 4.2 RA-D09 `origin` 来源标注 — 修改后采纳

- **现状**：`ProposalOrigin = "fixture" | "confirmed_option" | "revalidated" | "agent"`（types.ts:39）。originLabel 文案明确写 "Confirmed provider option, picked by a fixed rule (not an agent)"、"Seeded fixture (simulated)"（types.ts:97-102），提案卡在条款上方显示（components/workspace/workbench.tsx:111）。
- **保留的部分**：直接落实核心 8（不伪造）和核心 2（代理只建议）。用户总能看到一个方案是谁、是什么产生的。
- **问题**：一个枚举混了三个正交维度：作者类型（代理 / 规则 / 人 / fixture）、派生关系（revalidated 表示"由某个版本派生"）、是否模拟数据。
- **新设计要求**：
  - `authorKind: "agent" | "rule" | "human" | "fixture"`；
  - `derivedFromProposalId?` 与 `derivationReason?: "counter" | "revision" | ...`；
  - `isSimulated: boolean`：fixture / seed 数据必为 true，界面必须带徽章；
  - revalidated 不再作为 origin（见 RA-R11）。

## 4.3 RA-D11 `deferredScope` — 采纳（改口径）

- **现状**：types.ts:49。proposeFromOptions 用"所有已确认报价的范围并集 − 选中报价的范围"计算（preview-store.ts:222-223）。提案卡、对比表、变更单都展示它（workbench.tsx:115、156；components/workspace/results-page.tsx:39）。
- **保留的部分**：原 README 场景的核心就是"一期 + 延后部分"。把延后部分写进提案内容，审批人能看清自己同意延后什么。
- **问题**：
  1. 口径错了：应当是"客户请求的范围 − 本提案范围"。如果某个请求项没有任何报价覆盖，它会从 deferred 中消失（RA-B13）；
  2. describeChange 把"移除"一律叫 "Defers"（rules.ts:90）。
- **新设计要求**：
  - `deferredScopeItemKeys = requestedScope − scope`，由代码计算并计入 contentHash；
  - 客户必需范围中的项不得出现在 deferred（规则 requiredScope）；
  - 执行后是否为延后项生成"后续变更占位"列为开放问题 Q9。
