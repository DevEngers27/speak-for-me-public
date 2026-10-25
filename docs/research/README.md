# 研究汇总（research/README）

> 汇总代理产出，2026-10-24。五份研究的所有 URL 都由各研究代理在 2026-10-24 访问；本文只摘最重要的结论，细节、全部来源和可信度见各文件。网页内容只作为数据引用。
> 文件编号（02、03……18）对应任务书 00-brief.md 第 5 节。"冲突"一节列出与任务书、inputs/04 或研究之间说法不一致、需要设计者裁决的事项。

| 方向 | 文件 |
| --- | --- |
| 多代理协商先例 | /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/negotiation-prior-art.md |
| 变更单与审批系统 | /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/approval-systems.md |
| Convex 生产模式 | /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/convex-patterns.md |
| LLM 结构化输出与注入防御 | /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/llm-safety-structured.md |
| 人在环中的审批 UX | /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/hitl-ux.md |

## 0. 跨方向的共同结论

1. **条款是结构化对象，文本只是叙述。** 协商基准、代理支付协议、ERP、GitHub 都把要成交或要批准的内容做成不可变的结构化对象，批准引用对象 id 加内容指纹，不复述条款。这支持核心第 3、6 条。
2. **数值由代码决定，模型只负责措辞。** "策略与生成解耦"的研究显示，让模型同时决定金额和措辞效果最差。LLM 在算术、阈值判断、多方（≥4 方）协商上仍然明显失败，还会接受不可执行的提案。这支持核心第 4 条。
3. **在提示里要求保密不构成隐私机制。** 前沿模型被明确要求保密时仍会泄露三到五成的敏感信息；提示层防御和分类器在自适应攻击下多数失效。能把泄露压到接近 0 的是结构性做法：上下文最小化、封闭语言（类型化信封）、出站确定性闸门。每个参与方的代理同时持有私密数据、读取他方输入、向外输出，即 Willison 所说的"致命三要素"齐全，必须结构性地拆掉其中一条。
4. **审批绑定快照，任何变化都要重新审批，不设容差。** GitHub 的 stale approval 是最强的同构先例；SAP 和 Ironclad 提供容差免重审和管理员越权，研究一致建议本系统**不**提供。
5. **Convex 没有唯一约束。** 唯一性和幂等只能靠"索引 + 唯一写入口 mutation 内先查后写"，由 OCC 可串行化保证。被调度函数没有身份；action 不重试、最多执行一次。所以运行时需要 attempt 行、watchdog 和过期守卫。
6. **"未达成"是正常结局，要正面展示。** Pactum 在 Walmart 的成交率约 64–68%；Project Deal 中没有人介入的全自主协商出现了编造事实和"主人不想要的成交"。

---

## 1. 多代理协商先例（negotiation-prior-art.md）

1. **结构化提案与自由文本分离，接受动作引用提案 id。** Magentic Marketplace 的支付引用 `proposal_id`；FIPA Contract Net 用 cfp→propose→accept-proposal 推进；A2A 1.0 区分中断态（`INPUT_REQUIRED`）和不可重启的终止态，任务产出放在 artifacts 里，不放在 messages 里。
   https://arxiv.org/html/2510.25779v1 · https://www.fipa.org/specs/fipa00029/XC00029G.html · https://a2a-protocol.org/latest/specification/
2. **策略与生成解耦。** OG-Narrator 由确定性 offer generator 决定报价，LLM 只做叙述，买方成交率从 26.67% 升到 88.88%。
   https://arxiv.org/abs/2402.15813v3 · https://arxiv.org/pdf/1808.09637
3. **多方协商和算术是瓶颈，贪婪方破坏性大。** GPT-4 的全体同意率随参与方增加而下降：3 方 90%，6 方 33%；一个贪婪的首提案方把成功率从 81% 拉到 27%。代理还会接受自己付不起的交易。
   https://arxiv.org/html/2309.17234v2 · https://ar5iv.labs.arxiv.org/html/2402.05863
4. **隐私泄露。** 在 MAGPIE 中，即使明确指示保密，泄露率仍达 35–50%。只给代理任务所需数据的 AirGapAgent，在攻击下保护率仍有 97%；Firewalled Agentic Networks 把对方自由文本转成封闭的键值语言后再处理。
   https://arxiv.org/abs/2510.15186 · https://arxiv.org/abs/2405.05175v2 · https://arxiv.org/html/2502.01822v4
5. **首提案偏置与锚定。** 第一个提案被选中的比例为 60–100%；最终价格与首个报价的 Spearman ρ = 0.716。发言顺序和展示顺序本身就是设计参数。
   https://arxiv.org/html/2510.25779v1
6. **授权分两段，且需要人类介入点。** AP2 区分 open mandate（在约束内自主行事）与 closed mandate（批准具体对象），可对应为"私密简报 + 人批准具体版本"。Project Deal 不让人介入，结果出现编造事实、重复购买等问题；同一研究中，弱代理系统性地吃亏，但当事人的满意度打分并无差别。
   https://ap2-protocol.org · https://www.anthropic.com/features/project-deal

## 2. 变更单与审批系统（approval-systems.md）

1. **变更单是挂在已批准文档上的独立对象。** 审批期间，旧的已批准版本继续生效；所有必需审批完成后才产生新版本，revision 加 1。
   https://docs.oracle.com/en/cloud/saas/procurement/23d/oaprc/change-orders.html
2. **审批绑定 diff 快照，内容一变就 stale。** 本系统采用最严格的一档：数量或金额减少同样作废审批，这是从 SAP 容差机制吸取的教训。
   https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches · https://help.sap.com/saphelp_46C/helpdata/EN/ac/2d547bb435d1118b3f0060b03ca329/content.htm
3. **多方变更单。** AIA G701 要三方都签字才生效，金额与工期按累计链记录：原合同额 → 已批准变更累计 → 本次前金额 → 本次增减 → 新金额。这组字段可以直接用作 `changeOrders` 的金额与日期字段。
   https://help.aiacontracts.com/hc/en-us/articles/1500009322061-Instructions-G701-2017-Change-Order
4. **承诺会计。** 金额按类型分层，available 由计算得出、不存储；只追加的账本用反向分录纠错。资金检查（check）与资金预留（reserve）是两个步骤。
   https://docs.oracle.com/cd/G24469_01/fscm92pbr53/eng/fscm/fscc/UnderstandingPeopleSoftCommitmentControl-9f2424.html · https://docs.moderntreasury.com/platform/reference/ledger-transaction-object
5. **幂等与期限。** Stripe 保存第一次执行的结果，同一个 key 带不同参数时报错。Oracle 的审批期限按整个任务计算，不按每个审批人分别计算。
   https://docs.stripe.com/api/idempotent_requests.md · https://docs.oracle.com/en/cloud/saas/procurement/25c/oapro/approval-rules-management-for-procurement.html
6. **审计。** NIST 800-53 的 AU-9 要求保护审计信息，AU-10 要求不可否认，AC-5 要求职责分离。
   https://fedramp.gov/2026/reference/controls/audit-and-accountability/

## 3. Convex 生产模式（convex-patterns.md）

1. **唯一性 = 索引 + 唯一写入口。** OCC 是真正的可串行化，"查空后插入"在并发下安全。重复调用应返回已有结果，不抛错。用户连点是两次独立调用，客户端重连重发则由后端去重。
   https://docs.convex.dev/database/advanced/occ · https://docs.convex.dev/understanding/best-practices
2. **Scheduler。** 被调度的 mutation 恰好执行一次，被调度的 action 最多执行一次；在 mutation 内调度与该 mutation 原子。官方原文确认**身份不传播**到被调度函数；`_scheduled_functions` 的结果只保留 7 天；`cancel` 不会中断已经开始的函数。
   https://docs.convex.dev/scheduling/scheduled-functions
3. **Action。** limits 页写 Convex 运行时 30 分钟、Node 运行时 10 分钟，actions 页写 10 分钟，按 10 分钟设计。Convex 不重试 action；客户端直接调用 action 是反模式；所有 promise 必须 await。
   https://docs.convex.dev/functions/actions · https://docs.convex.dev/production/state/limits
4. **组件。** workpool 的 `onComplete` 文档写"always be called"，没写 exactly-once，完成后也不保留元数据；workflow 的步骤一改，在途实例就失败；action-retrier 的 `onComplete` 保证恰好执行一次；rate-limiter 的计数随事务回滚、fail closed。组件内拿不到 `ctx.auth`。
   https://github.com/get-convex/workpool · https://github.com/get-convex/workflow · https://github.com/get-convex/rate-limiter · https://docs.convex.dev/components/authoring
5. **授权与字段披露。** 用 `customQuery/customMutation` 注入 viewer，并用 ESLint 禁止直接导入裸构造器。RLS 过滤的是行不是字段，而且默认放行。字段级防线有两道：handler 内构造投影 DTO，加上严格的 `returns` validator（返回值多出字段时报错，而不是截断）。生产环境中 `ConvexError.data` 会原样到达客户端，其余错误被脱敏。
   https://stack.convex.dev/custom-functions · https://stack.convex.dev/row-level-security · https://docs.convex.dev/functions/validation · https://docs.convex.dev/functions/error-handling/application-errors
6. **测试与部署。** convex-test 支持 `withIdentity` 和假时钟，但不模拟 OCC、不跑 cron，并发测试要在本地开源后端或 dev 部署上做。staging 应使用独立的 Convex 项目；在 Vercel 上用 `npx convex deploy --cmd`；收紧 schema 时先 `.staged()`。
   https://docs.convex.dev/testing/convex-test · https://docs.convex.dev/production/hosting/vercel · https://docs.convex.dev/database/schemas

## 4. LLM 结构化输出与注入防御（llm-safety-structured.md）

1. **结构化输出只保证形状，而且官方的限定词是"in most cases"。** `refusal`（返回 HTTP 200）、`max_tokens` 截断、枚举大小写漂移都会产生不符合 schema 的结果。官方上限：strict 工具最多 20 个，可选参数最多 24 个，联合类型参数最多 16 个（`nullable` 也计入）。不支持 `minimum`/`maxLength` 等约束。改动 `output_config.format` 会让该会话线程的提示缓存失效；schema 本身会在 Anthropic 侧缓存 24 小时，所以私密值绝不能写进 schema。
   https://platform.claude.com/docs/en/build-with-claude/structured-outputs
2. **输出中不要设 `reasoning`/`thinking`/`trace` 字段。** 这类字段会触发计费的 `reasoning_extraction` 拒绝，而且没有回退模型可用。拒绝要按 `stop_reason` 单独处理；Opus/Sonnet 可以用 `fallbacks:"default"` 加 beta 头，但回退后实际执行的模型可能不同，必须记录实际模型；Haiku 没有服务端回退。
   https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
3. **官方的间接注入防御。** 第三方内容只放进 `tool_result`，并先做 JSON 编码；不要把自己的指令放进 tool_result；mid-conversation system 消息只承载运营者信息（Sonnet/Haiku 在 tool_result 之后可能忽略它）；可以用 Haiku 做筛查，筛查请求本身被拒绝时按可疑处理。
   https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks · https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
4. **提示层与检测类防御只能降低概率。** 在 "The Attacker Moves Second" 的自适应攻击下，12 种防御中多数的攻击成功率超过 90%。可靠的边界来自架构：Action-Selector、Dual LLM、CaMeL 的能力标签（capability）、OWASP LLM01 中的"特权留在代码里、高风险动作要人工批准"。
   https://arxiv.org/abs/2510.09023 · https://arxiv.org/abs/2506.08837 · https://arxiv.org/abs/2503.18813 · https://genai.owasp.org/llmrisk/llm01-prompt-injection/
5. **致命三要素与 Rule of Two。** 参与方代理同时持有私密简报、读取他方输入、向外输出，三项齐全。推荐的拆法是：他方自由文本不进入本方代理的上下文，对他方可见的文本全部由代码模板渲染。Prompt Infection 研究表明，注入可以在代理之间接力传播。
   https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ · https://arxiv.org/abs/2410.07283
6. **价格与成本（修正 inputs/04）。** Sonnet 5.5 的缓存读是 **$0.10/MTok**，不是 inputs/04 写的 $0.20；Opus 5.5 是 $0.20。按估算，Opus 5.5 在 `medium` effort、缓存命中时约 $0.05/回合，一次协商（12 回合）约 $0.6–1.0。输出 token（尤其 thinking）是成本大头。
   https://platform.claude.com/docs/en/about-claude/pricing.md · https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md

## 5. 人在环中的审批 UX（hitl-ux.md）

1. **待决项要带类型，允许哪些决定由服务端声明。** "回应"不等于"拒绝"：LangChain 明确警告，`respond` 会被当作成功的工具结果。批量回答中有一项无效时，可能导致其他项重复执行。
   https://docs.langchain.com/oss/python/langchain/human-in-the-loop
2. **快照绑定与重置原因。** GitHub 用 stale dismiss 撤销过时的批准；Ironclad 可以配置重置触发条件，但也允许"永不重置"和管理员越权，本系统不应提供后两者。界面要显示审批为什么被重置。
   https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches · https://support.ironcladapp.com/hc/en-us/articles/40675997675031-Configure-Approval-Resets-in-Workflow-Designer
3. **重新审批时，默认展示"相对我上次批准或查看的版本"的 diff，而不是相对上一版。** 过时的理由要标 outdated，但保留可见。
   https://www.atlassian.com/blog/bitbucket/iterative-review
4. **审批疲劳与自动化偏差可以测量。** Claude Code 用户的权限提示批准率为 93%（另一来源写 97%）；Magentic-UI 的用户研究显示，用户在不确定时也倾向直接接受。所以代理的"建议接受"不能成为默认选项或最突出的按钮，不提供一键全部批准，并要测量审批前停留时间和 diff 打开率。
   https://www.anthropic.com/engineering/claude-code-auto-mode · https://arxiv.org/html/2507.22358v1 · https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html
5. **多人审批的聚合语义要显式定义。** Power Automate 区分 "Everyone must approve" 和 "First to respond"。本系统采用前者的按角色版本：每个必需角色都批准同一 hash，任一角色拒绝，该版本即终止。
   https://learn.microsoft.com/en-us/power-automate/all-assigned-must-approve
6. **解释与信任校准。** 给部分解释并标明数据来源，模型自报的置信度慎用。在多方场景里，"因为你说了 X"中的 X 可能来自他方的私密简报，所以理由必须分为本人可见和对他方公开两层。
   https://pair.withgoogle.com/chapter/explainability-trust/ · https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/

---

## 6. 对设计文档的直接含义（按任务书第 5 节编号，已合并去重）

标注：〔N〕协商先例，〔A〕审批系统，〔C〕Convex，〔L〕LLM 安全，〔H〕HITL UX。带 ⚠ 的条目在第 7 节有冲突说明，需要裁决。

### 02 领域模型
- **对象分层**：`Proposal` 是不可变的版本对象，带 `seq`、`contentHash`、`parentProposalId`，每个金额、日期、范围项都带 `sourceRef`；`NegotiationMessage` 或公共叙述只承载文本；`AgentTurn`/`AgentSuggestion` 是代理产出，其中的 `recommend_accept` 只是一个字段；`ApprovalRound` 是挂在一个版本上的一轮审批；`Approval` 是人的决定，只追加；`HumanRequest` 是向具体的人请求取舍、澄清或披露；`Execution` 派生出 `ChangeOrder`、`Commitment`、`Task`。〔N〕〔A〕〔L〕〔H〕⚠ 命名需统一（7.3）。
- **文本信任等级**：`trustClass` 取 `operator_template | principal_private | principal_pasted_external | counterparty_structured | model_generated`。不变量：`model_generated` 文本不经披露渲染，不得成为他方可见内容。〔L〕
- **不变量**：审批有效 ⇔ 它的 `contentHash` 与 `constraintVersion` 都等于当前值，且没有被撤回（由计算派生，不存状态）；变更链满足 `amountAfter(n) == amountBefore(n+1)`；`available` 不存储；"未达成"（exhausted/infeasible/needs_human）是一等结局。〔A〕〔H〕〔N〕
- **授权语义**：私密简报相当于 open mandate，人对具体版本的批准相当于 closed mandate。〔N〕
- **用户主键**用 `tokenIdentifier`。事件只追加，按 `commitTs` 排序。不设热点计数器行。〔C〕

### 03 schema
- 每条唯一性不变量写成"索引 + 唯一写入口函数"一对，包括：`users.by_tokenIdentifier`、`agentRuns.by_roomId_and_status`（每个房间一个活跃 run）、`agentTurns (runId, turnIndex)`、`agentAttempts (runId, turnIndex, attemptNo)`、`executions.by_executionKey`、`proposals.by_run_hash`（用于检测重复和停滞）。〔C〕〔N〕⚠ 审批的唯一键（7.2-5）
- `approvalRounds{proposalId, contentHash, constraintVersion, requiredRoles, status, expiresAt, closedReason}`；`approvals` 只插入，每行记录 `decision`、`contentHash`、`constraintVersion`、`roleGrantId`、`displayedSummaryHash` 和服务端时间。〔A〕
- `changeOrders` 采用 G701 字段：`baselineAmountMinor / priorApprovedDeltaMinor / amountBeforeMinor / deltaMinor / amountAfterMinor / dateBefore / dateAfter / daysDelta / isSimulated`。`commitments` 账本只插入，`kind` 取 commit/release，带 `reversesCommitmentId`。金额用整数最小货币单位，并做 `isSafeInteger` 校验。〔A〕〔C〕
- `modelCalls`：`requestedModel / servedModel / fallbackUsed / effort / stopReason / refusalCategory / outcome / usage`（含 cacheRead、cacheWrite、thinking）`/ schemaId / promptHash / requestId / isStub`。〔L〕
- `humanRequests{kind, options[]（含 consequenceSummary 与 validatedBy）, allowedDecisions, deadlineAt, onTimeout}`；理由拆成 `rationalePrivate` 和 `rationalePublic`，各带 `sourceRefs`；记录每人上次查看或批准的版本，作为 diff 基线。〔H〕
- 私密值只存在服务端表中，绝不写进发给 API 的 JSON schema。fixture 简报带仅服务端可见的 `canaryToken`。遵守单文档 1 MiB、数组 8192 元素、每表 32 个索引的上限；回合内容按行拆分。〔L〕〔C〕

### 04 状态机
- **run**：`queued→running⇄awaiting_human→{converged|exhausted|infeasible|superseded|canceled|failed}`，终止态不可重启。`converged` 要求所有必需方对同一 `contentHash` 给出 `recommend_accept`，且在当前约束版本下规则通过。infeasible 与停滞由代码判定。〔N〕
- **approvalRound**：`open→satisfied→executed`，另有 `rejected | expired | superseded | withdrawn`；`satisfied` 状态下有人撤回则回到 `open`；不设容差免重审。审批记录本身只追加，没有"复活"迁移，重新批准就是插入新行。〔A〕〔H〕⚠ 7.3-3
- **humanRequest**：`open→answered | expired | cancelled`，过期时一律安全兜底（不执行）。〔H〕
- **模型调用结果到 run 的迁移**（每类最多重试一次）：`max_tokens` → 提高上限后重试；`refusal` → 回退（`reasoning_extraction` 不重试）；`schema_invalid` → 把错误作为 user 轮文本反馈；规则拒绝 → 把 `reasonCode` 回给代理；注入筛查命中 → `needs_human`。〔L〕
- **实现纪律**：一条迁移对应一个 mutation，守卫检查当前状态和 `constraintVersion`；超时迁移由 watchdog mutation 触发；迟到的结果由过期守卫拒绝。run 正在产生新版本或约束变更正在处理时，旧版本的批准入口禁用。〔C〕〔H〕

### 05 协议
- **服务端信封与模型输出分离。** 信封里的 `runId / turnIndex / attemptId / expectedConstraintVersion / proposalHash` 由服务端填写，用作过期守卫的输入；不匹配时返回 `stale_rejected`，只记录用量。action 只调用一次 `runMutation` 提交结果。〔C〕〔L〕
- **AgentTurnOutput**：根为 object，含 `action` 枚举和单个 `anyOf` 负载，全部字段 required。schema 手写，保留 `enum`/`const`，不用 `zodOutputFormat` 生成；服务端用同一个 Zod schema 做 `safeParse`。〔L〕⚠ 动作枚举命名（7.3-2）；根级 `anyOf` 能否编译待验证
- **模型不输出价格。** 范围项只用 `catalogItemId` 加数量，日期只能取自可行集合，引用已确认的数值时只输出 `factId`，金额由代码按目录计算。未定价的提案不能进入审批（`PRICE_NOT_DEFINITIZED`），要向具体的人请求补充。〔N〕〔L〕〔A〕
- **不设推理字段。** 改用 `noteForPrincipal`（仅本人可见，限制长度）和 `publicMessage`。〔L〕⚠ 对外文本的生成方式（7.3-1）
- **他方输入只以结构化投影进入代理上下文。** 投影做 JSON 编码后放进 `tool_result`，并标注来源；澄清问题用 `questionType` 枚举加参数表示；代理之间没有私聊通道。〔L〕〔N〕
- **回合规则**：固定轮转，设硬上限（`maxTurns`、单回合超时、墙钟预算）；开场候选由代码生成，或轮换首发言方，以消除首提案偏置。〔N〕
- **取舍请求**：最多 3 个经确定性校验的选项，不设默认选项，每个选项附后果说明；人的自由文本不得被解释为同意。代理应先用已披露事实和目录尝试解决，不行再升级给人。没有任何代理动作能改变审批状态。〔H〕

### 06 规则引擎
- 提案在对他方可见之前先校验。违反提出方自身硬约束、超预算、缺少必需范围项、日期不可行、数值没有 `sourceRef` 的提案，作为规则拒绝处理，并把 `reasonCode` 回给提出方代理。〔N〕〔L〕
- 纯函数接口：`checkBudget` 返回 `pass | fail | warn`（warn 对应 early warning 阈值）；`isApprovalValid` 只做相等比较；`computeChangeOrderChain` 生成并校验 G701 金额链。v1 不提供 budget override，将来如需要，做成一个独立的必需审批角色。〔A〕

### 07 权限与隐私
- **授权实现**：用 `customQuery/customMutation` 构造器注入 viewer，加 ESLint 禁止裸构造器；采用显式授权加默认拒绝，不用 RLS。被调度函数和组件内没有身份，`actorUserId` 显式传参。〔C〕
- **字段披露两道防线**：handler 内按角色构造投影 DTO，加上所有公开 query 的严格 `returns` validator。`ConvexError.data` 只放 `reasonCode`。`preloadQuery` 的结果会到达浏览器。〔C〕
- **出站披露闸门（确定性代码）**：检查数值是否在允许集合内，再对私密数值的多种格式、关键短语和 `canaryToken` 做精确或正则扫描，命中即阻断。Haiku 筛查、system 策略、JSON 定界只算降低概率的层，**不是**安全边界。〔L〕〔N〕
- **代理上下文组装顺序**：`tools` → 冻结的 `system`（断点 1）→ 本人简报与共享事实的 JSON（断点 2）→ 本回合增量。代理以 AI 身份发言，不得编造个人事实。〔L〕〔N〕
- **威胁模型**至少覆盖：泄露私密值、诱导接受、粘贴邮件中的注入、代理接力感染、编造金额、system 提示泄露、无界消耗、Markdown 图片外泄、人设操纵、同模型合谋、锚定。〔L〕〔N〕
- **审批人资格**：必须持有当前有效的 `roleGrant`；同一 userId 不能同时满足两个必需角色（职责分离）。审批记录（谁、何时、哪一版、什么决定）对全房间可见，理由只显示公共部分；默认不向他方显示"谁在看哪一版、看了多久"。〔A〕〔H〕⚠ 7.1-5、7.1-6

### 08 审批与执行
- **审批绑定** `proposalId + contentHash + constraintVersion + 审批人角色快照`。系统先冻结并校验提案，再交给人批准；`recommend_accept` 永远不计入审批；审批与执行全程不经过模型。〔N〕〔A〕〔L〕
- **执行时序**：唯一写入口 `executeApprovedProposal` 先按 `executionKey` 去重（同一个 key 带不同 fingerprint 时返回冲突）→ 在同一事务内重新读取约束版本与全部审批，重新判定有效性 → 重新运行 `checkBudget` → 一次插入 `changeOrder`、`commitments`、`tasks`、`execution`、`event`，任何一步失败就整体回滚。单个事务的上限是 16,000 个文档或 16 MiB。〔A〕〔C〕⚠ `executionKey` 的定义（7.3-4）
- v1 在审批过程中不预留额度，pending 只作提示；`expireRound` 由 scheduler 触发，迁移前先检查状态以保证幂等。〔A〕
- **审批卡片**必须显示：版本号、hash 短码、约束版本、全部 `reasonCode`、相对"你上次批准的版本"的 diff、他方的审批进度；缺任何一项都不能批准。执行按钮不做 optimistic UI；不提供撤销执行，只允许在执行前撤回审批。〔H〕

### 09 约束变更
- 预算下调在**一个事务**内完成：递增 `constraintVersion` → 把所有 open/satisfied 的审批轮置为 superseded → 作废活跃 run → 调度重新协商或创建人工请求。与并发审批的竞争由 OCC 串行化。〔C〕〔A〕
- 新 run 引用旧 run，但不继承旧共识；逐个通知受影响的人"你对 vN 的批准已失效"，写明谁把哪个约束从什么改成了什么。失效的审批在历史里用删除线样式保留。〔N〕〔H〕
- 已执行的变更单不改动；如果因此超额，向财务请求取舍，不自动冲销。〔A〕⚠ 7.1-4

### 10 代理运行时
- **编排**：主方案是自建调度链：`agentAttempts` 行，`runAfter(0)` 启动 action，`runAfter(deadline)` 启动 watchdog；watchdog 读取 `_scheduled_functions` 后决定按退避重试还是转人工。需要全局并发上限时可加 workpool 的 `maxParallelism`（设 `retry:false`，在 `onComplete` 里做过期守卫）。不采用 workflow。〔C〕
- **超时**：action 按 10 分钟设计；SDK `timeout` 不超过 5 分钟，`maxRetries` 设 0，重试交给 attempt 机制。用 rate-limiter 的 token bucket 按 roomId/userId 限制 token 用量。〔C〕
- **调用规范**：用 `messages.create`，不用 `parse()` → 先记 usage → 按 `stop_reason` 分支 → `safeParse` 并对枚举做大小写归一 → 跑规则引擎。默认 `claude-opus-5-5`，显式设置 effort（协商回合用 `medium`），`max_tokens` 约 16000。每条请求路径都带 `fallbacks:"default"`。〔L〕
- **一致性**：同一房间的所有代理用同一模型和 effort 并记录下来；协议 schema 按协议版本固定，JSON 做确定性序列化，监控缓存命中；每个 run 设 token 和金额上限；stub 模式的输出标注 `isStub`。〔N〕〔L〕
- **"正在进行"信号**要有心跳和 TTL；run 失败时生成可见的失败事件；重试是追加一个新 run，不覆盖旧 run。〔H〕

### 11 架构 / 12 API
- 目录结构：`convex/functions.ts` 放自定义构造器，`convex/model/` 放纯 TS 逻辑，外面只包薄的函数层。在 `convex.config.ts` 声明 `ANTHROPIC_API_KEY`、`CLERK_JWT_ISSUER_DOMAIN`、`AGENT_MODE(live|stub)`。不要用环境变量条件导出函数或改变 cron。〔C〕
- 所有公开函数都要有 `args` 和 `returns` validator；被调度或被 `run*` 调用的函数一律 internal；不暴露公开 action。预期失败用返回判别联合或 `ConvexError({reasonCode})` 表达，并在每个函数上标注。`approve`、`executeIfReady` 重复调用时返回已有记录。被调度函数的参数要保持向后兼容。〔C〕

### 13 前端
- `ConvexProviderWithClerk` 放在 Client Component 包装器里，`ClerkProvider` 在外层；登录态用 `useConvexAuth` 和 `<Authenticated>`；同一页最多一个 `preloadQuery`；query 里不用 `Date.now()`。〔C〕
- **工作台自上而下**："等你处理"队列（每项写明为什么是你、截止时间、超时后果）→ 当前提案卡片（stale 徽章、自你上次以来的 diff、校验结果与代理意见分栏、审批进度条）→ 区分人和代理的时间线 → 仅本人可见的私密简报 → 已生效的执行记录。〔H〕
- 建议态与生效态在视觉上分开；`recommend_accept` 徽标与人工批准明确区分；多个候选方案并排展示，以减轻首提案偏置；显示回合 k/N 和终止原因，"未达成"按正常结局展示。〔H〕〔N〕
- 模型文本按纯文本渲染，不渲染 Markdown 图片或链接，CSP 限制 `img-src`；`noteForPrincipal` 只在本人工作台出现；状态变化用 `aria-live` 宣告；按 `reasonCode` 映射文案。〔L〕〔H〕〔C〕
- 财务视图分 baseline / committed / pending / available 四栏；变更单详情展示 G701 金额与日期链，模拟数据要标注。〔A〕

### 14 首个场景
- 金额只来自报价目录，范围项只用目录 id，日期只来自可行集合。预算下调的走查要覆盖完整链条：superseded → 旧审批失效 → 由代码生成中性开场候选 → 重新协商 → 重新审批 → 执行。〔N〕〔A〕
- 要确定是否只支持单币种、是否涉及税（AIA 与 ERP 都按单一币种计算）。范围条目中如果出现"渗透测试"等词，需要实测 `cyber`/`general_harms` 误拒率。〔A〕〔L〕

### 15 运维
- 环境分 dev、staging（独立的 Convex 项目加 Clerk dev 实例）、prod（`pk_live_`）。Vercel 上用 `npx convex deploy --cmd`，Production 与 Preview 用不同的 deploy key，seed 用 `--preview-run`。〔C〕
- 调度结果只保留 7 天，workpool 完成后也不留元数据，追溯所需的数据要写进自有表。接入 Log Streams 和 Exception Reporting。产品指标：审批前停留时间、diff 打开率、取舍请求中选"其他"的比例、因失效而重新批准的次数。〔C〕〔H〕

### 16 测试
- **convex-test** 覆盖：状态机、权限矩阵（`withIdentity`）、披露投影、watchdog（假时钟）、stub 掉的 fetch。**并发与幂等**测试在本地开源后端或 dev 部署上并行调用：连点只产生一条 `changeOrder`；同一个 key 带不同参数返回冲突；satisfied 之后预算下调，执行时被拒绝；金额或数量减少同样作废审批。〔C〕〔A〕
- **隐私金丝雀**：遍历他方可调用的全部 query 返回值，以及事件、日志、错误信息和浏览器负载。**注入语料**包括：payload splitting、JSON 逃逸、伪造 system 标签、隐藏 Unicode、粘贴邮件、装可怜人设、贪婪方、锚定。**模型结果分支**要测：refusal（含 null 类别）、截断的 JSON、枚举大小写漂移、回退后 `servedModel` 变化。〔L〕〔N〕
- **协商指标**：一致率、出现过可行提案的比例、被规则拦截的错误提案比例、金丝雀泄露率、收敛回合数、停滞率、人工请求率；用 MAST 给 trace 打标签；定期做自适应红队。〔N〕〔L〕

### 17 路线图
- override 角色、escalation 与 renewal、外部 ERP 写入（把 `executionKey` 用作对方系统的 idempotency key 或 `external_id`）、通知（只深链到工作台，不在通知里放批准按钮）、可选的跨提供商交叉检查。〔A〕〔H〕〔N〕
- "单方先执行、后议价"（FAR unilateral change order / AIA CCD）⚠ 7.1-1。

### 18 决策与开放问题
- **ADR 候选**：①策略与措辞解耦，金额由代码计算；②固定轮转加硬上限；③不设代理私聊通道；④同一房间用同一模型；⑤禁止跨方自由文本进入代理上下文，公共文本模板化；⑥运行时编排：自建调度链，还是 workpool 或 workflow；⑦授权实现：自定义构造器，还是 RLS；⑧用户入库：`store` mutation，还是 Clerk webhook；⑨Clerk 环境变量命名；⑩审批不设容差、不提供越权。〔N〕〔L〕〔C〕〔A〕〔H〕
- **需要用户拍板**：注入筛查是否用 Haiku 5.5。inputs/04 记录的技能规则是"未经用户指定一律用 Opus"。〔L〕
- **待实测或待验证**：`maxTurns` 与停滞阈值 K；开场锚点怎样算中性；是否需要 LLM 调解者；根级 `anyOf` 能否编译，联合类型如何计数；Opus 5.5 的延迟 p50/p95；缓存 TTL 用 5 分钟还是 1 小时；action 超时是 10 还是 30 分钟；workpool 怎样检测超时；OCC 持续冲突时的行为；dev 部署是否运行 cron；缺少必需 env 时 deploy 是否失败；`fallbacks` 能否与 `output_config.format` 同用（inputs/04 第 7 项）；审批期限的默认值与计时起点；审批人撤回时是否必须填写理由；pending 是否软预留额度；`displayedSummaryHash` 的规范化口径。

---

## 7. 冲突与需要设计者裁决的事项

### 7.1 与任务书（00-brief.md）的张力

1. **"单方先执行、后议价"与核心第 5 条冲突。** 〔A〕把 FAR unilateral change order / AIA CCD 放进路线图，但核心第 5 条要求"全部必需审批到齐后"才执行，核心第 2、3 条也不允许绕过人对具体版本的批准。**建议**：在 01/17 中把它明确列为"不做"；如果将来要做，只能建模为新增一个必需审批角色，仍走审批。
2. **代理动作集比任务书多。** 核心第 2 条列了五种动作（提议、还价、澄清、建议接受、拒绝），研究增加了 `declare_infeasible` 和 `request_human_tradeoff`（或 `escalate`）。这不违背核心，但 05 必须写明这两个动作同样不能改变审批状态，只会生成 run 结局或 `humanRequest`。
3. **审批容差。** Ironclad 和 SAP 提供容差免重审与管理员越权，与核心第 3 条冲突，研究已一致否决。建议登记为 ADR，防止以后被重新引入。
4. **已执行的记录遇到约束变化怎么办，任务书没有定义。** 第 1 节说"任何约束变化都让旧方案和旧审批自动失效"，但没说已执行的变更单和预算承诺如何处理。〔A〕建议不改、不自动冲销、超额时向财务请求取舍。**需要裁决**：是否允许以 `release` 反向分录加新审批的方式撤销。
5. **职责分离会影响 seed 和演示。** 〔A〕建议同一 userId 不能同时满足两个必需角色。任务书没有这条要求，而 inputs/02、03 已否决单浏览器角色切换器，所以演示需要三个 Clerk 账号。**需要裁决**：v1 是否强制职责分离。
6. **审批记录与查看活动的可见性。** 核心第 1 条要求他方可见的内容都经过显式披露决定。〔H〕建议审批记录对全房间可见、查看活动默认隐藏。这需要在 07 的披露矩阵里作为显式决定落地，不能默认处理。
7. **人类拒绝理由中的自由文本。** inputs/03 RA-S06 采纳了"拒绝必须带理由：可选模板加自由文本"。如果 7.3-1 采用严格模板化，这段自由文本只能给本人和审计看，不能进入他方代理的上下文，最多经过披露闸门后展示给他方的人。**需要裁决**。

### 7.2 与 inputs/04（平台约束）的出入

1. **价格修正**：Sonnet 5.5 缓存读是 $0.10/MTok，inputs/04 §4.1 写的是 $0.20。Opus 5.5 的 $0.20 无误。〔L〕
2. **结论落定**：被调度函数**不**携带调度者身份，有官方原文；inputs/04 标的是待验证。〔C〕
3. **action 超时**：inputs/04 写"待验证（通常 10 分钟）"；limits 页写 Convex 运行时 30 分钟、Node 运行时 10 分钟。设计按 10 分钟，并要确定 Claude 调用跑在哪个运行时。〔C〕
4. **schema 生成方式**：inputs/04 §4.4 的示例用 `zodOutputFormat` 生成 schema，而它自己实测发现该函数会把 `enum`/`const` 降级成描述文字。研究建议手写 JSON Schema，Zod 只用于 `safeParse`。建议以研究为准，并修正示例。〔L〕
5. **审批唯一键**：inputs/04 part2 把"每版本每人一条审批"列为唯一性不变量，〔C〕也沿用了 `(proposalVersionId, participantId)`；而〔A〕主张 `approvals` 只插入，可以有 approve→revoke→approve 多行，以最新一条决定为准。**需要裁决**。推荐：唯一键改为"每轮每个角色同时最多一条有效批准"，由写入口检查；撤回和重新批准都追加新行。
6. **SDK 参数收紧**：inputs/04 记录 SDK 默认 `timeout` 600 秒、`maxRetries` 2。研究建议 `timeout` 不超过 300 秒、`maxRetries` 0。这不算冲突，但 10 中要写明。〔C〕
7. **成本估算**：inputs/04 估一次协商 $0.8–1.1，〔L〕估 $0.6–1.0，差异来自 token 假设，以实测为准。
8. **Clerk 接入**：当前推荐在 Clerk Dashboard 激活 Convex integration（`aud` 已预映射），不再需要手建 JWT template；变量名在两份官方文档里不同（`CLERK_JWT_ISSUER_DOMAIN` 与 `CLERK_FRONTEND_API_URL`），需要统一。调度参数的合计上限两页文档有出入（8 MB 与 16 MiB），按 8 MB 设计。〔C〕

### 7.3 研究之间的不一致（需要统一）

1. **他方可见文本怎么生成。** 〔N〕给了两个选项：双阶段叙述，或单次调用后做泄露扫描；并且把他方的 `publicMessage` 作为不可信数据传入。〔L〕主张 `publicMessage = {templateKey, params}`，由代码渲染，他方自由文本默认不进入代理上下文。inputs/01 PR-08 允许"模型自由文本经披露检查后对他方可见"。**推荐**〔L〕的严格方案作为 v1 默认，它拆掉了致命三要素中的一条，也最符合核心第 1、4 条；双阶段叙述作为路线图选项。**需要裁决**。
2. **动作枚举命名。** 〔N〕用 `propose | counter | request_clarification | recommend_accept | reject | declare_infeasible | request_human_tradeoff`，〔L〕用 `clarify | escalate | infeasible`。建议采用〔N〕这套，名字更明确，并在全篇统一。
3. **审批记录的存储形态。** 〔H〕在 approval 行上放 `invalidatedAt` 和 `invalidationReason`，需要 patch；〔A〕主张 approvals 只插入，有效性由计算派生，失效原因记在 `approvalRounds.closedReason` 和事件里。**推荐**〔A〕，这样更符合核心第 6 条；界面上的划线和失效原因从 round 与事件派生。
4. **`executionKey` 的定义。** 〔C〕用 `proposalVersionId`，〔A〕用 `hash(room, proposalVersion, round)`。如果"一个版本最多执行一次"是不变量，用 `proposalId` 就够了，并另存 `requestFingerprint`。**需要裁决**：同一版本过期后重开一轮审批，能否再次执行。
5. **代理产出的层次。** 研究中先后出现 `AgentTurn`、`AgentSuggestion`、`agentAttempts`、`modelCalls`。建议分三层：`agentTurns`（逻辑回合，`runId+turnIndex` 唯一）→ `agentAttempts`（同一回合的多次尝试）→ `modelCalls`（每次 API 调用的元数据）。被规则拒绝的建议只留在 turn 的结果里，不生成 `Proposal`，以保持 Proposal 不可变、不出现 `rule_rejected` 状态。
6. **名称统一。** `contentHash`，不用 proposalHash 或 proposalContentHash；版本实体统一叫 `proposals`（每行一个版本，带 `seq`）还是 `proposalVersions`，由设计者选一个，全篇一致；预算对象用 `commitment`，不用 encumbrance。
7. **取舍选项从哪里来。** 〔H〕把它列为开放问题（代理提出还是规则引擎枚举），〔N〕倾向由代码生成开场候选。建议由规则引擎在可行集合中枚举，代理只能从中挑选、排序和写说明。**需要裁决**。
