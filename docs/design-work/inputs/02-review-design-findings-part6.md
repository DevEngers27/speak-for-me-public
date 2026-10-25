# 02 审查设计发现 · part6：06 规则引擎

> 分片清单见 part1。

### F06.1 一个纯函数，query 与执行 mutation 共用
- 问题：没有任何代码能独立核对提案（G3，README.md:399）；Role A 的校验只在前端（`rules.ts`）。
- 设计要求：校验是确定性纯函数，不调模型、不读数据库；同一个函数在 `rooms.view`（实时显示可执行性）和执行 mutation（落库前重算）里调用；proposal.validation 只是快照。
- 建议方案：`validateProposal(proposal, catalog, customerBrief, budget, committed, today) → reasonCode[]`，放 `convex/lib/validate.ts`（审查也写作 `checkProposal(options, mustHave, deadline, budget)`）。纯模块可以脱离 Convex 单测。
- 来源：architecture-09/-17、security-01、P4 第 4 点。

### F06.2 必须检查的项目
1. 未知 itemKey 拒绝（不在本房间已确认目录里）。
2. 必需条目：`requiredItemKeys ⊆ itemKeys`。P4 原文写"⊆ scope 或显式标 deferred"，gap1-07 写 `requiredScope ⊆ scope`。整理者建议：必需项被延后不能静默通过，应产出 MISSING_REQUIRED_ITEM 并走人工取舍。
3. 日期：`today <= deliveryDate <= deadline`，且 `deliveryDate >= max(所选条目的 earliestDeliveryDate)`。
4. 预算：`committed + amount <= total`，等于上限算通过（≤）。
5. 金额由目录求和（含满足条件的 confirmedTerms，如按首选日期交付才收的 rush_fee），不信任任何外部给出的总额。
- 来源：P4、gap1-07、security-13、security-22、product-03。

### F06.3 预算规则写成一句话
- 规则原文（审查建议直接用）："Budget check: committedCents + proposal.additionalCostCents <= totalBudgetCents, evaluated inside the approval/execution mutation against current stored values. Pending proposals do not reserve budget; one active proposal per room."
- `checkBudget` 返回结构化结果而不是布尔值：`{ ok, reasonCode: 'OK'|'OVER_BUDGET'|'BUDGET_BELOW_COMMITTED', headroomCents }`；headroomCents 只给买方（finance/customer）看。总额低于已承诺金额（BUDGET_BELOW_COMMITTED）时进入 needs_input。
- 必须在审批/执行 mutation 里重新读取当前存储值计算，靠事务 OCC 防并发；不能只在代理回合或客户端算一次。
- 来源：docs-02、security-13、P7 第 3 点。

### F06.4 Role A 分支的规则缺陷（重建时不得复制）
- `rules.ts:36-41` 名为 "Matches current constraints" 的检查只比较 constraintsVersion 是否相等，不检查必需范围与截止日；客户硬约束是自由文本，从未被检查。审计员复现：cap 降到 $4,800 后新增一个只含可延后条目、交付晚于截止日的 $700 选项，四项检查全部 Pass 并可执行。`bestFeasibleOption` 只是在剩余预算内选条目最多的选项。
- 要求：检查项命名如实（如 "Checked against constraints v{n}"），并补上必需条目与截止日两项检查；文档写明哪些项目尚未检查。
- 来源：gap1-07、P3 第 5 点。

### F06.5 可行组合由代码枚举
- 目录小（≤5 个条目最多 32 种组合）时直接穷举，过滤出满足全部硬约束的组合；模型只在候选里挑选并写理由。"无可行解"由代码判定，不调模型，直接生成人工请求。
- 【改写】场景插件要提供枚举器接口：小目录穷举，大目录需要上界或剪枝策略（如按必需项先固定、再按优先级加入可选项）。
- stub 代理按固定规则返回"预算内能装下的最大 required + should 组合"，与真实代理共用输出 schema，可用于开发与测试（见 10）。
- 来源：architecture-09/-14、P11 第 1 点、P19 轻量版。

### F06.6 "今天"与时区
- 问题：日期只校验格式不校验含义；"今天"用哪个时区没有约定（L1）。
- 审查建议：服务端计算 today；Convex 默认运行时对 `Intl.DateTimeFormat` 的 timeZone 选项支持情况未核实，因此黑客松期间固定 UTC-7 并注释为简化。【改写】房间或场景显式存 timeZone，today 按该时区计算；先验证运行时的 Intl 支持（待验证），不支持则用固定偏移表并在文档里写明限制。
- 报价有效期（validUntil）与审批有效期：审查认为版本机制已覆盖"条件变了旧批准失效"而砍掉；【改写】真实场景里报价会过期，列为开放问题（见 18），至少在目录项上保留可选的 validUntil 并把过期视为约束变化。
- 来源：security-22（L1）。

### F06.7 reasonCode 是规则与文本之间的唯一接口
- 校验输出 reasonCode 枚举，供三处使用：公共文本模板（F05.3）、按角色投影（F07.1–F07.2，provider 只看到 code 不看到数字）、人工请求选项的生成（F05.6）。至少包括 OK、FITS_BUDGET、OVER_BUDGET、BUDGET_BELOW_COMMITTED、MISSING_REQUIRED_ITEM、DATE_CONFLICT、UNKNOWN_ITEM、NEEDS_TRADEOFF（前两类与后几类分别来自 checkBudget 与 P10 的枚举，命名需统一）。
- 面向客户端的错误同样用 `ConvexError({ code })`，消息里不带数值（见 07）。
- 来源：security-02/-13/-17、P10。

### F06.8 场景插件接口的审查要求
- 目录在运行时可增改（评委/用户现场加选项），所以存储与校验用 `string[]` + 成员检查，不在代码里写死枚举；给模型的输出 schema 可按当前目录动态生成。
- 必需审批角色在 v1 是代码常量 `REQUIRED_APPROVER_ROLES = ['customer','provider','finance']`，插入提案时快照；结构化审批阈值（如 singleApprovalLimitCents）v1 不做，写明 "approval rules are fixed in code"。【改写】扩展点：金额超过 finance 设定阈值时 run 进入 needs_input 并点名 finance。
- 场景插件至少提供：目录与条目词表、约束字段、规则（validate、可行组合枚举、任务派生 taskTemplates）、公共文本模板、fixture（含可行、需降级、不可行三种变体）。
- 来源：P4 第 3 点、security-10、P18、architecture-10。
