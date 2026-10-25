# 18 · 决策记录（part4）：ADR-D11…D15

> 分片见 `18-decisions-open-questions.md` 顶部。

## ADR-D11 派生字段与人工请求选项必须过披露矩阵

- **背景**：inputs/07 第 2 / 3 类共性缺陷共 32 条：`deferredItemKeys` 由 customer 私密简报减去提案得到却全员可见（FF-02，13 条）；人工请求 / 可行包选项用系统视角计算（FF-03）；事件溯源候选让 finance 无条件看 customer 简报（FF-22 之一，C28）；事后披露让历史评估泄露当时未披露的值（FF-34）；只改披露的版本不生效（FF-30）。
- **选项**：A 只在原始字段上做矩阵；B 派生字段全员可见；C 所有返回 DTO、事件渲染参数、代理上下文经同一 `projectForRole(role, dto)`，派生值继承输入中最严格的披露类（除非在 07 显式解密清单里），删除 `deferredItemKeys`，人工请求选项只用目标角色自身视图计算。
- **决定**：C。`deferredItemKeys` 不是条款：不存、不进 `termsKey`、不进变更单、不进公共模板；customer 自己的视图在投影时现算"未纳入的条目"。`humanRequest.options` 由 `buildHumanRequests(toRole, viewFor(toRole))` 计算，写入前 `assertOptionsProjected`；需要他方私密值才成立的选项只写 `blocked`。掩码检查对非所有者返回 `{ code: 'private.constraint_unmet' }`，不带原 `checkId`，通过的掩码检查直接省略；所有者按**检查**而不是按 code 判定。一切跨角色字段都经简报确认时的勾选，同侧也不默认共享。矩阵由测试自动对账（Proxy 读取测试 + 金丝雀 + 派生数值针脚）；非干扰性质测试：改他方私密值，本角色视图逐字节不变。
- **被否决**：A——派生值绕过矩阵；B（**C24**）——16 条评委反例；系统视角生成选项（**C25**）；finance 默认看 customer 简报（**C28**）；按 code 判定所有者——同一 code 可能来自不同角色的检查。
- **后果**：正面——私密值只能经显式披露离开所有者。代价——provider 的变更单只列包含项，看不到"延后了什么"（这本来就不是三方协议内容）；投影层成为高风险中心，必须被测试覆盖。关闭评委反例：FF-02、FF-03（与 D15）、FF-22（与 D12 ④）、FF-30（投影与代理上下文读每角色最新确认版本）、FF-34（历史提案不实时重算、不带检查：12 `proposals.get`，§18.4 N-07）。待验证：`returns` 是否拒绝多余字段只作测试期探测器（§18.5 V-R02）。

## ADR-D12 fit 信号与预算预言机政策

- **背景**：spike C4：itemKey 选择、日期、`budget.over` 各泄露约 1 bit；评委 21 条 FF-01（改价 → 预检、预览 query、候选按预算过滤、历史提案实时重算、原因类别）；PD-01 / PD-02；CRITIQUES：多次 Fits / Over 构成推断通道。
- **选项**：provider 可见度（i）只见 blocked（ii）原因类别（iii）裁剪参数；预览对所有角色求值 vs 只对看得到全部规则输入的发起人；目录变更自动重算 vs "待对方确认后重算"；customer 默认可见预算 vs 需 finance 披露。
- **决定**：政策性接受"每个提案 ≤ 1 bit"并设上界：① provider 对任何提案（含历史）只见 `fit: ok | blocked`，历史只显示 `superseded / rejected / executed / current`；② `rooms.previewChange` 只对发起变更且能看到全部规则输入的角色返回 `verdictAfter`（首个场景只有 finance 改上限），查看者自己的其他变更得 `{ verdict: 'recheck', nextConstraintsVersion, invalidatedApprovals, willSupersedeRun }`、变更种类不属于查看者 → `null`（形状以 12 §12.17 为准）；③ **任何角色**的 `clarify` 都不提供 `option_fits_constraints` 话题（canon 包修订 OBJ-28），可代答的 clarify 每角色每 run ≤ 1；④ 派生数值只给 finance，经 `capCents` / `committedCents` / `headroomCents` 三个开关才给 customer，`customerSeesBudget` 默认关（U1），fixture 只披露 `capCents`；⑤ 每 run 每角色 ≤ 4 次 `propose / counter`；⑥ 约束变更类写入（`briefs.confirm` / `catalog.confirm` / `catalog.retire` / `budget.setCap` / `runs.start` / `runs.requestRenegotiation` / `runs.retryTurn` / `humanRequests.answer`）每用户每房间每小时 ≤ 6 次（`run.rate_limited`）；⑦ `run_needs_input` 对 provider 只投影为 `run_waiting`；⑧ 写入时披露闸门（`sharedFacts.add`、目录标题定界与转义、日期窗口校验）。第三份简报确认仍自动 `runs.start`（修正草稿 R-H）。
- **被否决**：customer 固定可见预算（**C27**）；provider 看到原因类别（PD-02 ii，保留为 U2 备选）；`previewChange` 对所有角色求值；目录变更不自动重算（PD-02 推荐，否决：引入"目录已变更待确认"等待态且无人负责出口）；确认简报不自动开 run（多一个等待态）；`run_needs_input` 对 provider 带 kind / toRole（**C31**）。canon 包修订（2026-10-24）另否决"三席就位即 open"、第三份简报以 `briefs_confirmed` 开 run（**C48**：`openIfReady` 在就绪条件全部满足时同事务 `bump(room_opened)` 并开首个 run，cause `room_opened`）；`sharedFacts.add` 带 value 参数、闸门与他方秘密比对（**C51**：比对结果本身是预言机）；节流计数源未定、setup 期豁免、没有总量桶（**C58**：命令事件按 distinct `commitTs` 计、批量计一次、`price_writes` / `run_starts` / `room_create` 总量桶）。
- **后果**：正面——零成本、无痕的探针全部关闭：预览不给 provider 结论、候选不按预算过滤（D10）、历史不重算、每次探测都是可见的约束变更且受节流。残余——每个提案 1 bit，单用户每小时至多 6 次约束变更、每 run 至多 4 次提案；这是写进 07 威胁模型的政策性残余。代价——provider 不知道为什么被挡，收敛可能慢（U2）。关闭评委反例：FF-01（部分，残余如上）、FF-17（⑦）、FF-22（④）。待验证：真实 WebSocket 负载的金丝雀扫描（spikes §8 #11）。

## ADR-D13 公共文本模板化

- **背景**：research：明确要求保密仍有 35–50% 泄露；spike C5：只有"模板从白名单字段渲染"能把泄露压到接近 0；原文 GAP-06（`publicSummary` 必填自由文本）；spike C3：人类拒绝备注房间可见是第三条泄露路径。
- **选项**：A 模型写公共措辞 + 数字扫描；B 模型写、人审后公开；C 对他方可见的全部文本只由 `renderPublicText(templateKey, fields)` 从白名单结构化字段渲染。
- **决定**：C。模板按受众分变体（`room` / `buyer` / `owner`），参数类型不含自由 `string`；模型 `rationale` 只给本方，不存在 `publicRationale` / `publicSummary`；人类自由文本（`approvals.note`、`briefs.softFields.notes`）只给本方，不进他方代理上下文、不进事件；唯一进入他方上下文的人写字符串是目录 `title`（≤ 80 码点、`^[^<>\r\n]+$`、`<untrusted_data>` 定界块内）。"模板不碰私密字段"三层证明：品牌类型（`PublicCents` 等）、显式取字段 + 运行时复核、Proxy 读取测试对账 `reads` 声明。
- **被否决**：A——扫描挡不住语义改写（"a bit under five grand"）；B——延迟高且仍会泄露；拒绝备注房间可见——spike 实测的泄露路径。canon 包修订（2026-10-24）另否决人拒绝的 `reasonKey` 进入 provider 代理反馈（**C50**：人按 `humanReasonKeys[].audience` 可见，任何他方代理上下文不含）。
- **后果**：正面——跨代理注入与泄露的主通道被结构性关闭；本地化只需补翻译。代价——代理无法用文字"说服"他方，只能以动作与 `reasonKey` 表达立场——这正是"代理只建议、人决定"想要的。关闭评委反例：FF-42 的 note 可见性矛盾；结构性关闭 spikes §8 末段的语义改写类。待验证：spikes §8 #17（真实模型注入 soft 断言）。

## ADR-D14 事件可见性模型

- **背景**：旧 canon 用写入时 `visibility` 字段；插件候选双写两条事件；事件溯源候选的 `run_*` 对 provider 全量可见（FF-17）、哈希链能力被夸大（FF-18）；另一候选的两路索引合并分页不可实现（FF-27）。
- **选项**：A 写入时 `visibility: 'all' | {roles}`；B 每个受众各写一条；C 事件全部对房间成员可读、`payload` 只含房间可见字段、私密细节经 `restrictedRef` 在渲染时连接；是否做哈希链。
- **决定**：C（privacy-disclosure PD-8）。`events` 无 `visibility` 字段；`timeline.page` 按查看者选择渲染变体（例：`constraints_changed` 对 finance 带新旧值、对 customer 带"finance 更新了预算"或按开关带 cap、对 provider 只有 "Constraints changed"）；`run_needs_input` / `human_request_opened` 对 provider 渲染为 `run_waiting`；私密历史（rationale、被阻断原因、取舍选项）不做成事件。排序与游标 `(roomId, commitTs, seq)`，`events.append` 唯一写入口并为同事务多条事件分配 `seq`，游标为字符串，`commitTs` 不进 DTO。不做哈希链。
- **被否决**：A（**C29**）——分页后过滤页大小不均，漏写即整条泄露；B——两行漂移；哈希链 + 每日校验（**C30**）——有写权限者可整条重算，只能发现意外损坏；外部锚点进 17 E3。canon 包修订（2026-10-24）另否决`restrictedRef` 只限四表（**C59**：八表，条件是本就按角色控制访问）。
- **后果**：正面——单索引分页、无受众字段可漏写；时间线可安全对全房间开放。代价——渲染时连接受限行。关闭评委反例：FF-17、FF-18、FF-27。待验证：techstack O4（不同事务的 `commitTs` 是否唯一，决定 L1 迁移的 UNIQUE 键）、游标单调性。

## ADR-D15 人工取舍请求：结构、出口与期限

- **背景**：原文 GAP-11 / GAP-12；inputs/07 三条旅程死路；PD-04；research A2A 中断态；评委 FF-07（无请求、请求悬空、`close` 选项替所有人关房）、FF-13（`choose_candidate` 缺迁移边）、FF-31（回答触发的 bump 把这条请求自己取消，追溯断链）；冲突 C6（回合失败后 `paused` vs `needs_input`）。
- **选项**：只覆盖两种取舍；`close` 作为选项；同时向多人发请求；回合失败进 `paused` + 24h 看门狗 vs `needs_input` + `agent_failed` 请求。
- **决定**：`humanRequests { roomId, runId, kind, toRole, options: [{optionKey, templateKey, effect}], status, expiresAt, answeredBy?, answerOptionKey? }`；`kind` ∈ `infeasible` / `rounds_exhausted` / `agent_escalated` / `clarify` / `agent_failed`；`effect` ∈ `raise_cap` / `drop_items` / `extend_deadline` / `choose_candidate` / `disclose { field, toRoles }` / `retry_turn` / `pass_to_next { toRole }` / `keep_as_is` / `end_run`。出口：约束效果 → `constraints.bump`（D06 不动点）；`choose_candidate` → 复核通过则 `origin: human_choice` 提案（或复用本 run 当前仍通过的提案）、run `needs_input → pending_approval`，不通过则旧请求 `superseded(regenerated)` 并重新生成；`disclose` → `sharedFacts`，clarify 请求继续协商、infeasible 回退请求同事务重跑预检；`retry_turn` → 新 turn + attempt；`pass_to_next` → 本请求 `answered`、按目标角色自身视图给 `relaxationOrder` 中的下一角色开 `infeasible` 请求、不 bump（只按位置提供，末位没有，每 run 每对角色一次）；`keep_as_is` 按 kind（`clarify` = 拒绝披露、发问方同轮新回合；`rounds_exhausted` = 延长一轮且每 run 一次、上限触发时不提供；customer `agent_escalated` = 下一轮；provider `agent_escalated` = 同轮新回合；`infeasible` / `agent_failed` 不提供）；`end_run` → `ended_no_agreement`。没有任何选项映射到 `rooms.close`。进入 `needs_input` 必须恰好开一个 open 请求；无解时按 `relaxationOrder`（customer `drop_items` → finance `raise_cap`）选第一个按自身视图存在可放松选项的角色；轮次用尽 → customer 的 `rounds_exhausted`。期限 `HUMAN_REQUEST_TTL_DAYS = 7`，到期 → `expired`、run `ended_no_agreement`、站内通知 creator。审批轮不设过期。实现要求（落 04 / 09 / 12）：回答先把请求标 `answered` 并写 `answeredBy` / `answerOptionKey`，再经同一入口 bump，约束修订记录的 `sourceRefs` 指向该请求。
- **被否决**：仅两种取舍；`close` 作为选项（FF-07）；并行向多人发请求（回答冲突需合并规则，FF-42 c）；`stop_run` 后 run 停在 `needs_input` 无 open 请求；`paused` 状态（**C6**）。canon 包修订（2026-10-24）另否决：只在"下一角色确有可放松选项"时才提供转交、或根本不提供转交（**C54**：选项是否出现本身会泄露他方约束是否卡住，所以 `pass_to_next` 按位置提供）；`keep_as_is` 统一解释为"下一轮"（被拒的 clarify 白耗一轮，最后一轮直接结束 run）。
- **后果**：正面——每个卡住状态都有具体的人与出口（01 part4 X6）；选项不泄露他方值（与 D11）。代价——单收件人有时先问到"不是最优"的人，由 `pass_to_next` 转交缓解（N-01 已解决）。关闭评委反例：FF-07、FF-13、FF-31、FF-03（与 D11）、FF-42（c）。待验证：到期 cron 在 dev 部署是否运行（research §6-18）、`runAt` 精度（scenario-plugin #9）。
