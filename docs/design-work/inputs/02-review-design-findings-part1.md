# 02 审查设计发现 · part1：读法、保留原则、01 产品层

> 全部分片（共 13 片，按顺序读；每片 ≤ 12,000 字节）：
> - part1：读法与来源、应保留的原则、被推翻的论点、01 产品层
> - part2：02 领域模型与不变量清单
> - part3：03 schema（一）逐表字段建议
> - part4：03 schema（二）唯一性、类型、金额与日期；04 状态机与两组守卫
> - part5：05 协商协议（信封 vs 模型输出、判别联合、模板化公共文本、升级给人）
> - part6：06 规则引擎（validateProposal、预算规则、Role A 规则缺陷、可行组合枚举、插件接口）
> - part7：07 权限与隐私（预算可见性、投影、动作×角色、代理上下文、事件、日志、威胁清单）
> - part8：08 审批与执行、09 约束变更
> - part9：10 代理运行时（一）生命周期、编排选型、重试预算、上限、延迟、stub、文件布局
> - part10：10 代理运行时（二）模型调用约束（请求形状、thinking/effort、max_tokens、结构化输出、上下文重建、用量）
> - part11：11 架构、12 API 函数清单、13 前端
> - part12：14 首个场景（候选目录与口径）、15 运维
> - part13：16 测试、17 路线、18 开放决定与待验证平台事实
> 文件名：`02-review-design-findings-partN.md`（N = 1…13）；索引：`02-review-design-findings.md`。

## 0. 读法与来源

- 输入：`scratchpad/full_draft.md`（综合报告 P1–P19、M1–M11、L1–L12）；红队修订版（`scratchpad/final/_a1.md` 的 P1–P6、`scratchpad/redteam_partial.md` 的 P13–P19、M/L 表与"红队复核记录"）；`scratchpad/findings.json` 中 `verified[].confirmed[].suggestion_fix`（审计员修正后的建议）。采信顺序：红队修订 > suggestion_fix > 草稿正文。
- 引用约定：`README.md:N` 指原仓库 `/Users/zhennn/cal-hack-2026-main/README.md`；`convex/schema.ts`、`src/lib/negotiation.ts`、`convex/lib/anthropic.ts` 指原仓库骨架；`types.ts / rules.ts / preview-store.ts / fixture.ts` 指 Role A 分支 `src/lib/workspace/`。
- 已丢弃：治理与认领、hold、排期与降级梯、赛道证据与叙事、Devpost、评审现场（三窗口、录屏、彩排、设备、账号登录演练）、仓库协作卫生（P1、P2 大部分、P3 的 git 操作、P6 的开通流程、P11 的人员并行、P16、P17、M3–M5、M7、M8、L3/L4 大部分、L8–L11）。这些条目里仍有设计含义的部分已改写吸收。
- 原审查中"24 小时内砍掉 / 降为 P1"的建议，本文一律改写为"没有时间约束时的正确做法"，标【改写】。
- 每条格式：问题 → 设计要求 → 建议方案 → 来源 id。平台行为未经本地验证的标"待验证"，最终以 `inputs/04-platform-constraints.md` 为准。

## 0.1 审查认定"做得对"、重建时应保留的原则

1. 真实与模拟的边界：区分 planned / implemented / tested / simulated（README.md:11-21、:47）；模拟数据在数据和界面上都要标注（README.md:65、:115）。
2. 代理只提议，人批准具体版本，代码负责权限、算术和约束（README.md:44、:281、:288）；只写内部记录，不转账、不签约、不改 ERP（:46）；幂等只承诺内部记录，不宣称外部 exactly-once（:211）。
3. 核心转折选得好：审批途中约束下降，旧方案被阻断（:245）。
4. 契约方向正确：金额为整数美分且非负（`negotiation.ts:7`）；日期用 `z.iso.date()`（审计员实测拒绝 2026-02-30、接受 2028-02-29）；消息带 baseProposalVersion 与 constraintsVersion；动作是枚举；approvals 同时绑定两个版本（`schema.ts:28-31`）；commitments 按 operationId 建索引（:33-35）；子表都有 roomId 前缀索引。README 已承认"索引不保证唯一"（:291）、"action 与 mutation 不是原子事务"（:211）、"不能把私密字段发到浏览器再隐藏"（:306）。
5. 默认安全：auth config 缺 issuer 时 fail-closed（`convex/auth.config.ts:5-6`，applicationID "convex" 与 `ConvexProviderWithClerk` 一致）；配置模块 server-only；环境检查只报告存在性、不打印值；Anthropic 客户端只在服务端创建、无默认模型。
6. Required scenarios 表（README.md:405-414）可直接转成测试清单：越权读 brief、预算变更后旧方案不可执行、超时或陈旧结果、重复执行。

## 0.2 被推翻或弱化的论点（设计时不要再当事实用）

- "rooms query 必然泄露预算"：Convex query 可按字段投影，缺的是披露决策（P8）。
- "rooms 没有状态字段就表达不了方案过期"：比较两个 constraintsVersion 即可推导（P9）。
- "用低温度保证可复现"：SDK 1.1.0 下 temperature/top_p/top_k 会 400，当前一代模型本来也做不到可复现（P13）。
- "换 Clerk 实例后 ID 会变，所以选 tokenIdentifier"：两种 ID 都会变；选 tokenIdentifier 的真实理由是它全局唯一（P15）。
- "每次至少两次协商运行"：无可行解可由代码判定，不必调模型（P12）。
- "组件可替自建省约 12 小时"：无出处，组件只覆盖调度、重试、取消约一半缺口（gap3-06）。
- "模型抽取 brief 是必做项"：没有任何验收项要求（M6）。
- "auth.config 导入即抛错是缺陷"：是有意的 fail-closed（code-15 被推翻）。

## 01 产品层（→ 00-overview / 01-product）

### F01.1 必须回答"为什么需要三个 LLM 代理"
- 问题：价格来自已确认目录、预算由代码校验之后，协商接近一个代码可解的小组合问题；finance 代理的"检查支出"与确定性校验重叠（README.md:281、:247、:239、:342）。
- 设计要求：写清 LLM 的职责边界，不让模型做代码能做的事，也不让代理沦为装饰。
- 建议方案：组合枚举交给代码。LLM 负责三件事：把混乱输入（邮件、需求描述）变成待人确认的结构化约束；在不泄露底线的前提下向各方解释取舍、提出分期拆分；判断何时需要人来决定，并把问题措辞具体化。首个场景只做范围、价格、日期三个维度，付款条件作为扩展。finance 代理只解释不算术；若完全去掉 finance 的模型调用，产品叙述要如实写成"两个 LLM 代理 + 确定性 finance 策略"。"不泄露对方底线"做成可测试项：provider 代理的上下文和输出里不含 finance 上限数值。
- 来源：product-11（M10）、architecture-14、P2 第 6 点。

### F01.2 每方代理是独立调用
- 设计要求：不得用一次调用让模型同时看到三方 brief（README.md:45、:285）。一个回合 = 一个角色的一次独立调用，上下文由服务端按角色组装（见 07）。
- 来源：P2 第 4 点。

### F01.3 验收参数化，不绑定一组固定数字
- 问题：G4、A4 和演示流程写死 $5,000 → $4,800 / $4,900（README.md:400、:334），系统却要能接受任意新场景（README.md:63、:65）。
- 设计要求：任何经 UI 输入的预算、报价、截止日（不改代码、不重新部署）都在数秒内得到正确的 block / feasible / infeasible 判定（确定性校验）；协商在延迟预算内完成，否则升级给人。
- 建议方案：验收句式改为 "For any stored budget, a proposal is executable only if committedCents + additionalCostCents <= totalBudgetCents; lowering the cap below the projected total blocks the old plan and starts renegotiation or human input."。可行、需降级、不可行三类挑战场景都进回归用例；"真实、混乱的数据"由报价邮件抽取（可选能力）承接。
- 来源：product-08、docs-05（P18）。

### F01.4 目标用户与采用路径是假设
- 小企业里财务常常就是项目负责人本人；服务商为何愿意进客户的工作区也没有答案。产品文档把这两点标为 hypothesis，并写清首个场景假定的组织形态（如"外包工作室 + 有独立预算负责人的中型客户"，或企业内部采购）。
- 来源：product-19（L10）。

### F01.5 约束变化要有可见的原因
- 问题：预算下调由身兼审批人的 finance 手动触发，削弱了"系统检测"的说服力。
- 建议方案：约束变更事件带原因字段（如 "Q4 budget revision: cap reduced by $200"）；价值叙述放在"已签的批准自动失效、各方同步看到阻断"。进阶：另一笔支出记入同一预算，使已承诺金额上升；这要求 commitments 能容纳来自本房间以外的记录（见 F02.4 的预算归属问题）。
- 来源：product-15（P7 第 4 点）。
