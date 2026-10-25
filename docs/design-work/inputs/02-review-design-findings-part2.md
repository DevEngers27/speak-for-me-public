# 02 审查设计发现 · part2：02 领域模型与不变量

> 分片清单见 part1。

## 02 领域模型（→ 02-domain-model）

### F02.1 缺少"已确认报价条目 / 目录"实体（技术 blocker 之一）
- 问题：`scope`、`sourceRefs` 是自由字符串数组，`additionalCostCents` 由模型给出（`negotiation.ts:6/:7/:9`，`schema.ts:18-27`）。审计员用 zod 4.6.7 复现：`{scope:["whatever"], additionalCostCents:1, deliveryDate:"2020-01-01", sourceRefs:["made-up-quote-999"]}` 能通过 `proposalTerms.safeParse`，`scope:[" "]` 也能通过。代码无从核对价格来源（README.md:399 G3）。
- 设计要求：价格、范围项、日期只能来自用户确认过的目录；模型只能引用目录键。
- 建议方案：新增目录实体（审查里分别叫 quoteOptions / providerOptions / offerItems）：roomId、itemKey（房间内唯一）、title、priceCents、earliestDeliveryDate 或 leadTimeDays、taskTemplates、confirmedBy/confirmedAt、simulated；可选 confirmedTerms（termId、kind 如 rush_fee、deltaCents、condition）。customer brief 用同一套词表给出 requiredItemKeys / deferrableItemKeys / deadline。提案只存 itemKeys，金额由服务端按目录求和，sourceRefs 由代码从 itemKeys 推出。代理提出目录外的新选项时落库为 unconfirmed，provider 本人确认后才可被选（原建议"时间够再做"；【改写】应纳入 v1，它正是"缺信息时向人请求"的落点）。
- 整理者注：P4 把 priority（required/should/deferrable）放在选项上，architecture-09 放在 customer brief 上。必需与否是 customer 的判断，建议放在 customer brief，目录只描述供给。
- 来源：security-01、product-04、architecture-09、code-04、gap1-06、gap1-07（P4）。Role A 的 `types.ts:26-27` ProviderOption{costCents, deliveryDate, confirmed} 可作起点。

### F02.2 变更单是核心产出物，但模型里不存在
- 问题：README 至少 6 处承诺写入 change order（README.md:7、:202、:241、:257、:258、:291），数据表和 schema 都没有；:291 还叫它 agreement。
- 设计要求：术语统一为 change order；一次执行产生 changeOrder、commitment、tasks，三者互相引用。
- 建议方案：tasks 按 approvedItemKeys 和 taskTemplates 确定性派生，每个条目一个任务，assignee 为 provider，不调模型。修订已确认协议 = 开一个新 run（README.md:291）；修订链（supersedesId）原建议砍掉，【改写】v1 可以不做，但 17 路线要定义"对已执行变更单的修订"怎么表示。
- 来源：architecture-10、docs-04、product-12、code-07、security-04（P9）。

### F02.3 已承诺金额只能有一个真相源
- 问题：`rooms.committedCents` 与 commitments 表是两份真相；基线 $4,000 存不进 commitments（proposalId 必填）（`schema.ts:13、:32-35`）。
- 建议方案：commitments 作为台账，kind 区分 baseline 与 change_order；committed = 按 by_room 汇总，不单独存储；seed 写一条标 simulated 的 baseline。备选（不推荐）：保留存量字段，但只在执行 mutation 内与插入 commitment 同步更新。
- 来源：architecture-23、security-04、security-14（P9 第 5 点、L6）。

### F02.4 预算是独立实体，不放在 rooms 上
- 问题：`schema.ts:13` 把 totalBudgetCents/committedCents 放在全员可见的 rooms 上，与 README.md:239（剩余预算是 finance 私密输入）和 :297 矛盾。
- 建议方案：budgets 每房间一行（不另设 version，版本只认 rooms.constraintsVersion）；已承诺金额不放这里；预算变更历史存 budgetChanges（仅 finance 可读）。备选：预算放进 finance 的结构化 brief。v1 范围是一房间一预算；多个房间共享同一项目预算会超额承诺，列为已知限制与扩展点。
- 来源：architecture-01、security-06、code-02、docs-03、product-09、process-14、security-14（P8、L6）。

### F02.5 协商运行（run）与代理回合（turn）是一等实体
- 问题：runId 只是字符串（`schema.ts:24`），没有 runs/agentTurns、currentRunId、轮次、重试次数、用量。
- 设计要求：每房间至多一个活动 run；每个回合有记录（输入版本快照、输出、用量、失败原因）；proposals 引用产生它的 turn。
- 来源：architecture-05、architecture-13、code-08、docs-15（P14）。

### F02.6 成员、邀请、角色授予、用户标识
- 问题：没有 invites；members 要预先知道 userId；谁授予角色、每个角色是否唯一、ownerId 有什么权限、用 subject 还是 tokenIdentifier、显示名从哪来，都没定义（`schema.ts:11、:15-17`；`convex/health.ts:9` 返回 subject）。
- 设计要求：角色只由服务端按邀请绑定；首个场景每个角色一人；一人不能占多个角色；userId = `identity.tokenIdentifier`（`authentication.d.ts:89-102`：tokenIdentifier 全局唯一，subject 跨 provider 不唯一）；房主身份不带来审批权。
- 建议方案：邀请表加 acceptInvite（字段见 F03.2）；displayName 在加入时快照（取不到 identity.name 就让用户填；Clerk 的 Convex JWT 是否带 name/email 待验证）。审查认为 users 表"可砍"，【改写】可保留一张最小 users 表承载显示名与偏好，由 02 决定。
- 来源：architecture-11、security-05、code-11、security-24（P15）。

### F02.7 "向具体的人请求取舍"是实体
- 问题：状态有 needs_input、Zod 有 clarify，但没有 targetRole/question/options 字段，也没有问题表或决策表（`negotiation.ts:11-20`；README.md:245、:255、:410、:416）。
- 建议方案：humanRequests 完整版（字段见 F03.10，流程见 F05.6）；轻量版是候选 proposals 共用 optionGroupId。没有时间约束时推荐完整版：可追溯、可取消、绑定约束版本。
- 来源：architecture-12、product-13（P19）。

### F02.8 私密简报需要生命周期和按角色的结构
- 问题：privateBriefs 缺 role、draft/confirmed 状态、confirmedAt；shareableFacts 是自由文本，没有逐项确认（`schema.ts:18-22`）。
- 建议方案：按角色给结构化字段：customer 有 requiredItemKeys、deferrableItemKeys、deadline（hard）、preferredDate（soft）；provider 关联目录；finance 引用 budgets，不重复存预算。shareableFacts 改为固定词表里的 `{field, value}`。不保存原始粘贴文本；抽取结果只作为草稿返回给本人，提交表单才算确认。
- 来源：architecture-21、security-16、process-22（M6）、gap1-08。

### F02.9 不变量清单（审查散见各处，此处汇总）
- I1 提案只追加；条款不可 patch；唯一可变的是 status（或改用 rooms.currentProposalId 表达"当前"）。
- I2 proposal.version 在同一个 internal mutation 里读 rooms.proposalVersion、加 1、再插入，永不因新 run 重置。
- I3 constraintsVersion 只能经 `bumpConstraints` 改变。
- I4 审批绑定 (proposalId, constraintsVersion)；同一 (proposalId, userId) 只保留最新决定。
- I5 每个提案至多执行一次：状态守卫为主，operationId 为辅；`committed + amount <= total` 在执行事务内重算。
- I6 每房间至多一个活动 run；迟到的回合结果被拒收。
- I7 必需审批角色是代码常量并快照进 proposal；不同角色必须是不同 userId。
- I8 对他方可见的文本只由模板从结构化字段生成。
- I9 金额是 0 ≤ n ≤ 上限的安全整数美分。
- I10 可执行性（executable）永远实时计算，不以存储值为准。
