#### P18 ·【high】Hyphenate 官方要求的"现场可被新场景挑战"和"真实、混乱的数据"在验收里没有对应项

- **一句话**：README 转述的 "a live demo that may be challenged with a new scenario" 和 "realistic data and a messy problem" 在 Required scenarios 和 Hyphenate 证据表里都没有落点；G4/A4/演示流程写死 $5,000 → $4,800/$4,900；没有评委现场改参数的入口和预演的挑战场景；评审当天来访组数与额度未估算（**gap4-06 待核实**）。
- **证据**：README.md:63、:65、:69-74、:78、:230、:241、:254、:279、:334、:351、:400、:407-414、:416、:540、:72、:552-554。
- **为什么重要**：评委问"预算改成 $4,500 会怎样"，如果要改代码或重新 seed 才能回答，首要赛道（奖金最高）的 "proof it works" 当场失分；数据太干净也拉低 messy problem 和原创性。
- **建议（审计员修正版）**：
  1. G4 参数化（英文）："For any stored budget, a proposal is executable only if committedCents + additionalCostCents <= totalBudgetCents; lowering the cap below the projected total blocks the old plan and starts renegotiation or human input."
  2. 新增 G8："A teammate-chosen budget/quote/deadline entered through the UI (no redeploy, no code change) produces the correct block/feasible/infeasible result within seconds (deterministic check); negotiation completes within the latency budget or escalates."（不要求 60 秒跑完协商）。
  3. 权限分离：cap 和已承诺只 finance 能改；选项价格只 provider 能改且改后重新确认；截止日只 customer 能改；三者都 bump constraintsVersion。
  4. 优先级：finance 的 cap 输入框复用转折 mutation（30 分钟）→ provider 改单条价格（1 小时）→ 报价邮件抽取放可降级档（2–3 小时，Sat 20:00 没做完改预填）。
  5. 预演 3 个挑战场景（可行、需降级、不可行）各彩排一次并记录预期结果作为 D3。具体数值以 P7 唯一定义的 fixture 为准：若 P7 采用 product-03 的四行目录（A $450 / B $350 / C $500 / R $100），则 $4,400 无解、$4,500 仍可行（只做 A）、$4,800 恰好允许 A+B 标准交付 $800（边界）；若 P7 采用 $750 变体（docs-02/security-13），边界用例要同步改。Required scenarios 补一行 "Judge-supplied parameter change → validator re-evaluates; feasible proposal or tradeoff request"；准备"挑战房间"与"脚本房间"分开；备一份可粘贴的 brief 模板；"基于真实 SOW 结构的数据"砍掉。
  6. D 向主办方确认来访组数和每组时长；C 用第一次真实运行推算单轮 token 和费用，spend limit 至少留 3 倍余量。
- **预计工作量**：改 G 项 10 分钟；cap 输入 30 分钟（B+A）；变体 fixture 30–45 分钟（D）；三场景彩排 30–45 分钟。
- （product-08, docs-05, gap4-06）

#### P19 ·【high】"向具体的人请求取舍"没有协议结构：问谁、有哪些选项、回答怎么回到协商都没定义

- **一句话**：状态机有 needs_input、Zod 有 clarify，但消息只有自由文本 publicSummary，没有 targetRole/question/options 字段，schema 里没有问题表或决策表。
- **证据**：README.md:245、:255、:332 A2、:354 C4、:410、:416、:63、:316、:324、:398 G2；`src/lib/negotiation.ts:11-20、:17`；`convex/schema.ts:5、:9-47`。
- **为什么重要**：appropriate escalation 是 Hyphenate 官方评估项，也是 P7 无解结局的落脚点；没有结构，界面只能显示一段模型文字，人没法点选，也回不到协商流程；G2 的 "escalate unresolved questions" 拿不出证据。如果主线结局选"交给 customer 取舍"，本条升为不可砍。
- **建议（两种任选）**：
  - **轻量版**：不新增实体，复用 proposals/approvals——代码枚举目录里满足硬约束的组合（≤5 条目最多 32 种，直接穷举），生成 2–3 个候选 proposal 共用 optionGroupId、status 'option'；`rooms.status` 置 needs_input 并记 targetRole；customer 批准其中一个即进正常审批流程，其余 superseded；方案卡加 "Choose this option" 按钮；房间可见的选项摘要由代码模板从结构化字段生成（与 P10 一致），LLM 为每个选项写的解释只存为本方可见的 rationale；金额和日期来自代码；无可行组合时生成 needs_input 事件提示 finance "raise cap or approve partial scope"。
  - **完整版**：`humanRequests {roomId, runId, targetRole, kind:'tradeoff'|'clarify', question, options:[{key, label, impact:{deltaCents?, deferItemCodes?}}], status:'open'|'answered'|'cancelled', answerKey?, answeredBy?, answeredAt?, constraintsVersion}`，by_room_status；只有代码判定无可行解或轮次用尽才创建（模型的 clarify 只提供措辞，不由模型决定是否打扰人）；`answerRequest` 是需要身份的 public mutation（`requireRole(targetRole)`），改变硬约束则 bump 并启动 trigger 为 human_answer 的新 run；约束变化时取消所有 open 请求。
- **预计工作量**：B 1–1.5 小时，A 30 分钟–1 小时，C 15 分钟；依赖 P4、P7、P9。
- （architecture-12, product-13）

---

