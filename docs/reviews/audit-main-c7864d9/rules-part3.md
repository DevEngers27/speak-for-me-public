# 审计：W1-1 规则引擎与插件契约（part 3/3）— 偏离清单

severity 口径：blocker = 违反八个核心之一；high = 后续任务会当作契约照抄；medium = 局部错误；low = 命名 / 文档。本清单没有 blocker：目前还没有任何写入口把这些函数的输出落库或下发。

### AUD-RULES-01 · high · INV-35 / 08 §8.4.2 / D02 —— isExecutable 的原因码和形状与 08 不一致
- 证据：`core/engine/rules/executable.ts:16-20`。room/run 守卫失败时推入 `run.invalid_state`，这个码不在 08 / 06 §9.1 给 isExecutable 的映射里；守卫码还可能叠加，例如 `approval.not_current` 与 `version.stale_constraints` 同时出现。探针 1 用真实状态（stale 提案、run 已 superseded）跑出 `['run.invalid_state','version.stale_constraints','budget.over']`；已执行提案跑出 `['run.invalid_state','approval.already_executed']`。设计 T06-U37 和 14 §11 D1 都只预期一个守卫码。测试 `rules.test.ts:151-155` 用的是不可达状态（提案已 stale，run 却仍是 `pending_approval` 的当前 run），正好把这个问题掩盖了。返回值是 `{ok, blocking, evaluation}`，不是 `{ok:true} | {ok:false, reasons:[{code}]}`。`isCurrentForApproval` / `allApproved` / `canExecuteNow` 都没有导出，INV-35 要求的命名分离只停留在一行注释里（approvals.ts:38）。
- 修法：照 08 §8.4.2 实现。只有一个守卫码：stale → `version.stale_constraints`，executed → `approval.already_executed`，其余 → `approval.not_current`；规则阻断照常列全。导出 `isCurrentForApproval`、`passesChecks`、`allApproved`、`canExecuteNow`。补 08 U13（集合不齐不影响 isExecutable；canExecuteNow 报 `approval.missing_role`），把 U37 改成 run 已 superseded 的真实状态。
- 归属：W1-1 follow-up，必须在 W2-2 开工前完成。

### AUD-RULES-02 · high · 06 §12.1 —— 插件契约少了成员
- 证据：`core/engine/plugin.ts:17-34, 46`。只有 15 个成员，缺必需成员 16 `readiness`（04 §4.2.1）以及可选成员 17 `rankForOwner`（05 §5.11.2）和 18 `humanReasonKeys`（07 DX-6）。注释写着 "readiness … belong to the engine"，与 §12.1 相反。`ProtocolDecl`（plugin.ts:8）缺 `tradeoffOwner`，topics 缺 `field` / `answer` / `questionTemplateKey`。注册校验里写死了 14 个键。
- 设计也不一致：R-D12、§12.3、§16 仍写"恰好 15 个成员"，§12.1 已改成"1–16 必需"。
- 修法：按 §12.1 补齐成员和注册校验（§12.2 #1），同时请设计组把 R-D12 / §12.3 / §16 的措辞统一。
- 归属：W1-1 follow-up，必须在 W1-3 前完成。

### AUD-RULES-03 · medium · canon D12 ③ —— option_fits_constraints 只对 seller 禁用
- 证据：plugin.ts:76 只在 askableBy 含 seller 时拒绝；探针 4 中 buyer 话题被接受；测试 review.test:249 只覆盖 seller。canon D12 ③（修正版）要求任何角色都不提供这个话题（对 customer 它是预算探针，对 finance 它是截止日探针）。06 §12.2 #5 和 INV-11 仍是旧口径。
- 修法：只要出现 topicKey `option_fits_constraints` 就拒绝注册，并补一个 buyer 用例。06 §12.2 #5 要同步修改。
- 归属：W1-1 follow-up（或 W1-3）。

### AUD-RULES-04 · high · INV-64 / INV-65 / INV-10 / canon D15·C54 / 05 §5.11 —— buildHumanRequests 的契约
- 证据：`humanRequests.ts:8, 13-43`；`types.ts:21-23`。
  - (a) 收件人不是 relaxationOrder 末位时，没有 `pass_to_next {toRole}`（探针 3）。
  - (b) Effect 里没有 `blocked`。
  - (c) `HumanRequestDraft` 没有 `questionKey`（rounds / no_candidates / call_limit / spend_limit）。
  - (d) `run` 入参只有 `keepAsIsUsed`，没有 `limitHit` / `roundsExtended`，所以 attempt / 美元上限触发时仍然给出 `keep_as_is`（探针 2）。
  - (e) optionKey 是 `opt_N`，设计要求引擎编号为 `'A'..'E'`（03 §3.9、05 §5.11.1、schema.ts:478），代码也没有限制选项数不超过 5。
  - (f) 引擎生成的选项 templateKey 是 `end_run` / `keep_as_is` / `retry_turn` / `disclose`，14 §8.5 是 `request.*`。
  - (g) `clarify` 直接抛错，06 §11.1 要求它覆盖全部 5 种 kind。
  - (h) `rounds_exhausted` 和 `needs_tradeoff` 的 choose_candidate 本应由引擎按 customer 视图枚举（最多 3 个、按 rankForOwner 排序、当前提案仍通过时排第一），现在完全交给插件；provider 的 `agent_escalated`（cannot_deliver）也没有分支。
- 设计也不一致：14 §11 D2 漏写了 `pass_to_next`，06 §11.1 的类型里没有 questionKey。以 canon D15 为准。
- 修法：入参按 06 §11.1 改为 `{roundsExtended, limitHit, …}`；按 D15 补 `pass_to_next` / `blocked` / `questionKey`；optionKey 按 A..E 编号并限制最多 5 个；templateKey 加 `request.` 前缀；实现 clarify 和引擎侧的 choose_candidate 枚举。
- 归属：W1-5（open）。

### AUD-RULES-05 · high · INV-R11 / INV-R16 / INV-10 / 06 §8 —— 与 W1-4 的契约重复且互不兼容
- 证据：
  - 掩码有两份实现：`rules/view.ts projectEvaluation`（基于 rules 的 CheckResult：checkId/owner/status）和 `disclosure/index.ts:171-188 projectChecks`（另一个 CheckResult：ownerRole/inputs/passed；找不到 owner 时回退到按码取 owner，但 06 §8 规定按检查的 owner 掩码）。`projectForRole` 调用的是后者（disclosure:108, 118），06 §8 要求调用 projectEvaluation。
  - 请求选项有两套类型：rules 用 `effect.kind`，disclosure 和 schema 的 `requestEffectV` 用 `effect.type`。
  - W1-4 的 `assertOptionsProjected`（disclosure:241）只认 `projectRequestOptions` 构造出来的选项，buildHumanRequests 的输出无法通过它的断言。06 §11.3 #2 / #3 / #5 在引擎里都没有落实。PR r06 延后的就是这一条。
- 修法：保留一份实现：projectForRole 调用 projectEvaluation，删除重复的 CheckResult / projectChecks。RequestOption 按 03 统一用 `type` 判别。buildHumanRequests 的输出先经 projectRequestOptions 构造，再走 assertOptionsProjected，或者按 06 §11.3 #5 做重算深比较。补 §11.3 #2 / #3 的断言。
- 归属：W1-4 follow-up（projectForRole）+ W1-5（buildHumanRequests 接入）。

### AUD-RULES-06 · medium · 14 §6.4 / §7 / 06 §7.1 —— 插件可见接口与 14 的代码对不上
- 证据：`types.ts:14` 的 CheckCtx 是 `{input, proposal, terms, lines}`，14 §7 的三个检查解构的是 `{ input, x }`，照抄会得到 undefined，抛错后变成 `PluginContractError`。`candidates.ts:13` 对 `limit: Infinity` 抛 `invalid_limit`，而 14 §6.4 的 relaxations 正是在 feasibility 模式下传 Infinity；feasibility 模式本来就不截断。06 §7.1 也没有定义 CheckCtx 的形状。
- 修法：在 06 中钉死 CheckCtx（建议保留 `x` 作为 ProposalLike），14 和代码对齐；feasibility 模式忽略 limit，或允许 Infinity。
- 归属：W1-2（enumerate）+ W1-3（插件），06 / 14 需要同步改文字。

### AUD-RULES-07 · medium · 06 §7.1（核心 8 的徽章信号）—— seededLedger 写死为 false
- 证据：`checkProposal.ts:74` 写的是 `seededLedger: false`。RuleInput 里没有台账来源信息，seeded 的基线会永远被报告为"非 seeded"。INV-62 的徽章另由 room / proposal 的 provenance 驱动，所以不算 blocker。
- 修法：`loadRuleInput` 把台账 provenance 放进 RuleInput 并据此派生；在做到之前删掉这个字段，不要输出写死的值。
- 归属：W2-1（loadRuleInput）+ W1-1 follow-up。

### AUD-RULES-08 · medium · 06 §13 / 08 §8.8.4 —— 设计要求的测试缺失
- 缺失：T06-P1（打乱顺序后结果不变）、P2、P6（非干扰性质，目前只有 1 个示例）、P7、P8（与暴力穷举对照）、P9（不抛错的 fuzz）、P10；T06-S3 `runPluginConformance`（未实现）、S4（PARAM_AUDIENCE 覆盖所有实际写出的参数名）、S6（只有一个 isExecutable 导出的结构测试）；08 U6（旧 cv 上的 withdraw → pending）、U13（canExecuteNow）。另外 U37 用的是不可达状态（见 AUD-01）。
- 归属：W1-1 follow-up（P1、P2、P6、S4、S6、U6、U13）、W1-2（P7、P8、P10）、W1-5（P9）、W1-3（S3）。

### AUD-RULES-09 · low · INV-R12 / T06-S2 —— 场景词汇 lint 缺失
- 证据：eslint.config.mjs 中没有这条规则；`core/engine/{reasonCodes,actions,agentContext,events,money,disclosure}` 已经含有 customer / finance / requiredItemKeys。W1-1 的文件里没有。
- 修法：加上 `no-restricted-syntax` 词汇规则，对设计允许的字面量（如 `audience:'provider'`）做白名单。
- 归属：工具链 follow-up。

### AUD-RULES-10 · low · 14 §6.2 / §5 / INV-R6 —— materializeTerms 的排序与 modifier 数量
- 证据：`materialize.ts:40` 先放 items 再放 modifiers，得到 `[audit_log_export, sso_login, rush]`；14 §6.2 要求所有行统一按 itemKey 排序，即 `[audit_log_export, rush, sso_login]`（探针 6）。两个 modifier 的候选也被接受（探针 9）。
- 修法：所有行统一用 codeUnitCmp 排序；`modifiers.length > 1` 时抛 `PluginContractError`。
- 归属：W1-2。

### AUD-RULES-11 · low · INV-45 / 06 §12.2 —— Legacy 重载绕过注册校验
- 证据：plugin.ts:36-44 保留了 LegacyPlugin 重载；`core/scenarios/scope-change/index.ts:6` 用它注册，§12.2 的校验全部被跳过。
- 修法：W1-3 完成后删除这个重载。
- 归属：W1-3。

### AUD-RULES-12 · low · 06 §12.1 FieldDecl.semantic —— 预算检查的 owner 在缺省时变成公开
- 证据：checkProposal.ts:11-12。owner 取 `budgetOwner ?? null`，字段名写死成 capCents / committedCents / headroomCents，没有按 `semantic` 驱动。如果某个场景在 RuleInput 里填了 capCents，却没有声明 `budget_cap` 字段，B1 / B2 就变成公开检查（fail-open）。
- 修法：B 检查按 `semantic` 字段驱动；如果 RuleInput 中有预算值却没有 budgetOwner，就拒绝。
- 归属：W1-1 follow-up。

### AUD-RULES-13 · high · canon §1.5 / D02 / 06 §6.1–6.2 —— 原因码表缺码，参数名漂移
- 证据：`reasonCodes.ts:8-66` 缺 `approval.not_executable`（D02 规定 approve 前不可执行时抛这个码）和 `item.limit_exceeded`。ParamAudience（:116）只有 room / owner / ifDisclosed，缺 `'caller'` 和 `'projectedCodes'`；`approval.not_executable.reasonCodes` 没有受众声明。`run.rate_limited` 的参数是 `retryAfterMinutes`，06 §6.2 的跨章契约是 `retryAfterMs`。W2-2 现在没办法抛出一个带正确类型的 `approval.not_executable`。
- 修法：按 06 §6.2 补齐码表和 PARAM_AUDIENCE，修正参数名，同步更新 validator / Zod 派生和模板表。
- 归属：W0-3 follow-up（reasonCodes.ts），必须在 W2-2 前完成。
