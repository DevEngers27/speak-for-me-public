# 审计 · privacy 块（part2）：偏离清单 AUD-PRIVACY-01…17

路径缩写同 `privacy.md`（`D` / `AC` / `EV` / `PJ` / `RV` / `T/`）。

severity 口径：high = 后续任务会把它当契约照抄（照抄进 W2 的公开 query 就违反核心 1）；本块没有 blocker，因为投影器还没有接到任何公开函数。探针见 `scratchpad/audit-privacy-run/tests/audit/probe.test.ts`。

### AUD-PRIVACY-01 · high · provider 能看到他人的简报版本号与确认时间
- 对照：DX-7、PV-INV-15、T-38（privacy-02）；03 §3.11.1；12 §12.17 `members[].briefVersion`。
- 证据：`D:21` 把 `version confirmedAt` 设为 `room`。探针 P3：`projectForRole('provider', financeBrief)` 输出 `{"role":"finance","version":4,"confirmedAt":123,…}`。投影器没有房间状态输入，做不到"open 后置 null"。
- 后果：同一次提交里 finance 简报 +1、cv +1，provider 由此推出是 finance 改了上限。
- 修法：`Disclosures` 增加 `roomStatus`；房间 open 后且查看者不是所有者时，`version` / `confirmedAt` 置 null。07 只要求对 provider 置 null，12 写的是"非本人一律 null"，需要设计统一，在统一前先按更严的一方实现。补 TC-PRIV-21 型的逐字节测试。
- 归属：新开 W1-4F（排在 W2-1 之前）。来源：设计后改。

### AUD-PRIVACY-02 · high · 人类拒绝的 reasonKey 没有受众裁剪，buyers 键进入 provider 视图和事件 payload
- 对照：DX-6、D13（humanReasonKeys）、14 §3（`over_our_limit` 的受众为 buyers）、08 §8.6"buyers 键不进 payload"、INV-12、PV-INV-07。
- 证据：`D:27` 把 `reasonKey` 设为 `room`。P5：provider 投影得到 `"reasonKey":"over_our_limit"`；`isEventPayload(approval_recorded{reasonKey:'over_our_limit'})` 返回 true（`EV:116`）。引擎与场景里都没有 `humanReasonKeys`。`convex/schema.ts:12` 的 `rejectReasonKeyV` 同样收这个键。
- 修法：场景声明 `humanReasonKeys[{key, audience}]`；投影器对 provider 把 buyers 键置 null；payload 的 reasonKey 只收 room 受众的键，buyers 键经 `restrictedRef → approvals` 连接。
- 归属：W1-3（#11）声明 humanReasonKeys，W1-4F 改投影与 events.ts，#33 改 convex 的 payload 联合。来源：设计后改。

### AUD-PRIVACY-03 · high · 他方回合状态没有折叠成粗粒度
- 对照：07 §7.9.4 ●⁗（privacy-06）；03 §3.16.1；12 §12.17；13 E27。
- 证据：`D:29` 把 `turns.status` 与 `currentAttemptNo` 设为 `room`，没有任何映射。P4：provider 能看到 customer 回合的 `"status":"failed","currentAttemptNo":2`。provider 由此推出 `agent_failed` 请求发给了 customer，而 DX-3 规定 provider 只能看到 `run_waiting`。
- 修法：查看者不是所有者时，status 映射为 `scheduled | running | done`（failed / stale 都算 done）；attempt 级字段给 null。在 DISCLOSURE 里标注这个变换，W2 视图模型直接复用。
- 归属：W1-4F（或 W2-1 视图模型，二选一写进任务包）。来源：设计后改。

### AUD-PRIVACY-04 · high · 人工请求选项：读路径断言无法跨持久化，两套 RequestOption 互不兼容
- 对照：INV-10、PV-INV-13、D11（选项按目标视图生成，写入前断言）。
- 证据：
  - `D:128` 在投影时（读路径）调用 `assertOptionsProjected`，它靠 WeakMap 认对象身份（`D:205,242`），从库里读出的普通对象必然被拒。P1：`TypeError: Options must be projected for target role`。
  - `rules/humanRequests.ts:16-43` 产出 `effect.kind` + `shown` 形状的 `RequestOption`（`rules/types.ts:21`），从不调用 `projectRequestOptions`（后者用 `effect.type`）。
  - 电池 INV-10 绑定的 `optionsChecks` 只测这个未接线的 helper，有假绿风险。
- 修法：把断言移到写入路径（`openHumanRequest`）；读路径改为结构校验，并只给 `toRole` 返回 options；统一成一个 `RequestOption` 类型，让 `buildHumanRequests` 经 `projectRequestOptions(toRole, …, viewFor(toRole))` 输出；电池改测真实调用链。
- 归属：W1-5（#13）与 W1-4F。来源：实现偏差。

### AUD-PRIVACY-05 · high · 多套投影实现并存，引擎入口导出的不是 disclosure 版
- 对照：D11"同一 `projectForRole`"；07 §7.10"每条投影只有一个实现函数"；INV-01、INV-06。
- 证据：
  - `core/engine/index.ts:16` 经 `export * from "./projection"` 导出的是矩阵版 `projectForRole(matrix, role, dto)`（`PJ:519-553`）；disclosure 版没有从 index 导出（P11：两者不是同一个函数，index 里也没有 `DISCLOSURE`）。
  - `RV:6-47` 另有 `viewFor` / `projectEvaluation`：可见检查带 `checkId`，用的 disclosures 形状也不同。
  - 两套 `CheckResult` 不兼容：rules 是 `owner/status`，disclosure 是 `ownerRole/passed/inputs`。P10：把规则输出喂给 `projectChecks` 会抛 `Cannot read properties of undefined (reading 'every')`。
  - `inputs` 是合取，`CheckDecl.requires` 是析取范式（DNF）。`privacyReview.test.ts:39` 锁定了"owner 自己的检查因 inputs 名不在可共享列表而被掩码"（P13），与 §7.11 规则 2 的"或"不符。
  - W1-4 任务包写明要对接已有的 `core/engine/rules/` 检查结果。
- 修法：只保留 disclosure 一个出口并从 index 导出；矩阵版改名（如 `projectByMatrix`）；`projectChecks` 直接消费 rules 的 `CheckResult`，可见性由 `requires` 的任一组全部可见判定，owner 直接放行；`RV` 改为委托给 disclosure；电池 INV-06 改测真实链路。
- 归属：W1-4F，与 W1-1 维护者协作，排在 W2-1 之前。来源：实现偏差。

### AUD-PRIVACY-06 · high · 可见性来自调用方自报，不来自 sharedFacts 行；ownerRole 可被覆盖
- 对照：PV-05、PV-INV-02、INV-02（"当前简报版本"）、07 §7.8.1（self 取行的所属角色）。
- 证据：
  - `D:42,73-83`：budget 与 checks 的放行依据是 `Disclosures.fields: string[]`，与 sharedFacts 无关（只有执行快照走 `snapshot`），也没有版本绑定（P18）。
  - `D:103` 中 `disclosures.ownerRole ?? data.role`，调用方可以覆盖行自带的所有者。P2：`projectForRole('provider', financeBrief, {ownerRole:'provider'})` 输出了 `hardFields.capCents`。
- 修法：投影器内部由 `projectSharedFacts(role, rows)` 推出可见字段；为 briefs / turns / approvals / attempts / humanRequests 禁止 ownerRole 覆盖（只取 `role` / `toRole`）；补"把 ownerRole 设为查看者也拿不到"的测试。
- 归属：W1-4F。来源：实现偏差。

### AUD-PRIVACY-07 · high · DECLASSIFIED 没有按 DX-1…DX-13 编号
- 对照：PV-06、PV-INV-16、TC-PRIV-05 元断言、07 §7.8.6（DX-11…13 由 privacy-05 新增）。
- 证据：`D:72` 只有 10 个字段路径（P12），缺 DX-3 的 toRole、DX-5、DX-7、DX-11…13；没有 `DECLASSIFIERS`，`Object.keys(DECLASSIFIERS)==DECLASSIFIED` 这条元断言无从写起。
- 修法：`DECLASSIFIED = ['DX-1'…'DX-13']`，每项对应字段路径与提取器；非干扰测试只允许这些提取器的输出变化。
- 归属：W1-4F，并同步到 16 的电池任务。来源：设计后改。

### AUD-PRIVACY-08 · medium · 引擎硬编码 scope_change 场景字段
- 对照：PV-04、07 §7.8.2（"场景字段由场景声明"）、D21 插件边界。
- 证据：`D:24`（budget family）、`D:78-82,140-144,229`（`SHAREABLE_FIELDS`、hasField 的字段名、disclose 选项列表）全是 scope_change 的字段名。插件契约已有 `FieldDecl.disclosableTo`（`plugin.ts:10`），却没被使用；也缺各字段的允许受众与 `requiresAck`。
- 修法：从 `plugin.fields`（disclosableTo、semantic）推导；引擎只保留引擎表。
- 归属：W1-3（#11）与 W1-4F。来源：实现偏差。

### AUD-PRIVACY-09 · medium · 可共享字段里仍有 v1 已删除的 preferredDate
- 对照：07 §7.8.4、03 §3.6、14 §4。
- 证据：`D:141`、`D:229`，P9 显示 disclose 选项接受 `preferredDate`。`convex/schema.ts:67` 也还留着这个字段。
- 修法：引擎和 schema 同时删除。
- 归属：W1-4F 与 #33。来源：设计后改。

### AUD-PRIVACY-10 · medium · `option_fits_constraints` 只对 provider 剔除
- 对照：canon D12③（修订后对任何角色都不提供）、INV-11、LP-5。
- 证据：`AC:34` 只在 `role === 'provider'` 时过滤。P7：customer 与 finance 的上下文仍带这个话题。
- 修法：对所有角色都过滤；在 `allowedActions` / clarify 话题表的源头（W1-5）同样删除。
- 归属：W1-4F 与 W1-5（#13）。来源：设计后改。

### AUD-PRIVACY-11 · medium · 事件载荷枚举与 03 / convex schema 不一致
- 对照：03 §3.11.1、03 §3.8 `runs.endedReason`、DX-8。
- 证据：
  - `EV:66-70` 的 `run_ended.endedReason` 含 `canceled`（不是合法值），缺 `renegotiation_requested`、`canceled_by_creator`、`room_closed`。P8：后三个值返回 false，`canceled` 返回 true。
  - `EV:127` 的 `room_closed` 不接受 `by: 'ops'`。
  - `convex/schema.ts:152` 这一行是正确的，所以两份契约已经分叉。
- 修法：对齐 03；建议从同一份声明生成引擎目录和 convex validator，并加一条"两者键集与枚举相等"的测试。
- 归属：W1-4F，或 #33（W0-4 follow-up）。来源：实现偏差（旧稿已有正确枚举）。

### AUD-PRIVACY-12 · medium · DISCLOSURE 的 agent 列没有任何代码读取；attempts 的代理可见性写错
- 对照：07 §7.8.2（代理上下文的排除断言从 DISCLOSURE 派生）、§7.9.4（attempts 不进代理上下文，✘）、W1-4-c01。
- 证据：全仓库没有任何地方读 `rule.agent`；`AC:29-45` 用手写的键表。`D:30` 的 `attempts.status / attemptNo / stopReason / errorCode / move…` 标为 `self`（agent 为 `'same'`，P19）。
- 修法：`buildAgentContext` 的白名单与 TC-PRIV-04 的排除断言都从 `DISCLOSURE[*].agent` 推导；attempts 这几个字段改为 `agent: 'never'`。
- 归属：W1-4F（可并入 #38）。来源：实现偏差。

### AUD-PRIVACY-13 · medium · 矩阵完整性测试靠手抄，不是叶子路径对账
- 对照：INV-19（"由测试自动对账而非手抄"）、TC-PRIV-10、07 §7.8.2、issue #38（W1-4-c01 仍开）。
- 证据：`T/disclosureCompleteness.test.ts:4-27` 是静态的顶层字段表，只检查键是否存在，不检查受众与 agent 类。注册表也只有顶层键：嵌套叶子（`terms.*`、`taskTemplates[]`、`hardFields.*`）完全交给调用方先 `pickExact`，DISCLOSURE 管不到这些路径。
- 修法：在 convex 测试项目里递归遍历 `schema.tables[t].validator`（`VObject.fields`、union 的 `members`、数组元素），逐个叶子路径对账，并断言 07 §7.9 规定的 (audience, agent)。
- 归属：#38。来源：实现偏差。

### AUD-PRIVACY-14 · low · provider 的 run 等待状态命名不一致
- 对照：D12⑦、07 §7.9.4、13 `OpenRequest` 的 `run_waiting`。
- 证据：`D:136` 把 provider 的 `needs_input` 改成 `'waiting'`，同一文件 `D:105` 用的是 `'run_waiting'`（P6）。
- 修法：统一为 `run_waiting`，或使用 12 定义的 UI 枚举常量。
- 归属：W1-4F。来源：实现偏差。

### AUD-PRIVACY-15 · low · 历史判定的 atVersion 跨 fromRole 共用
- 对照：PV-INV-11、07 §7.8.3（按 `(fromRole, field)` 取 `briefVersion ≤ 值版本` 的行）。
- 证据：`D:146-150` 用同一个 `atVersion` 过滤所有行。P14：`atVersion=1` 把 finance 的 v3 行也滤掉了，而 v3 是 finance 自己的版本号，与 customer 的版本号无关。
- 修法：改为 `atVersion: Partial<Record<Role, number>>`，或要求调用方每次只传一个 fromRole 的行，并在函数内断言。
- 归属：W1-4F。来源：实现偏差。

### AUD-PRIVACY-16 · medium · 事件 × 受众渲染模板没有交付，归属 issue 已关闭
- 对照：D13、D14、PV-11、PV-12、PV-INV-15、07 §7.16 / §7.17（`constraints_changed` 的四种渲染、provider 作者中立合并、`run_waiting`、`turn_failed` 对他方显示 "finished"）。
- 证据：`core/engine/publicText.ts` 只有 3 个示例模板（W0-2b）。issue #12 写的范围是 "projectForRole matrix, all templates, event append helper"，W1-4 任务包标题也写了 "public text templates"，但 PR #35 没有做模板，#12 已经关闭。W2 的 `timeline.page` 目前没有可依赖的模板目录。
- 修法：新开任务（W2-1 的 `timeline.page` 之前），按 03 §3.11.1 的每个 type × room / buyer / owner 定义模板，并配 TC-PRIV-21 的逐字节测试。
- 归属：新开 W1-4T，或并入 W2-1（#15）。来源：任务范围缺口。

### AUD-PRIVACY-17 · low · 目录标题的不可信封装与 07 §7.14.3 有出入
- 对照：07 §7.14.3、05 §5.13.1。
- 证据：`AC:39` 与 `PJ:699-745`：规范化用 NFC 而不是 NFKC；没有把定界词替换为 `[removed-delimiter]`；没有 FNV-1a boundary；source 是 `catalog.title`，规范是 `provider.catalog_titles`；标题按条目嵌在 catalog 里（提示词组装时必须提出来，成为独立的顶层块）；超长时截断而不是拒绝（写入侧校验在 W2-1）。转义 `<>&` 已经满足 INV-05，所以列为 low。
- 修法：在 W2-5 的提示词构造器（05 §5.13）里按规范组装，并补 TC-INJ-08。
- 归属：W2-5（#19）。来源：实现偏差。

## 小结
- high 7 条（01–07）、medium 7 条（08–13、16）、low 3 条（14、15、17）。
- 设计后改：01、02、03、07、09、10。实现偏差：04、05、06、08、11、12、13、14、15、17。任务范围缺口：16。
- 建议在 W2-1（rooms.view / timeline.page）开工前先做一个 W1-4F，一次性处理 01–08、10–12、14、15；13 并入 #38，16 单独立项。
