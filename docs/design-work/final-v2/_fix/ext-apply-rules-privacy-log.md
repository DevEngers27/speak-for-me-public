# 外部评审落地记录 · rules-privacy 组（06、07、14、16）

范围：`06-rules-engine*.md`、`07-permissions-privacy*.md`、`14-scenario-scope-change*.md`、`16-testing*.md`。处理对象是 `review-ext/workspace/consolidation/consolidated.json` 中 `class === "confirmed"` 且 `target.file` 落在上述章节的 30 项；另记 1 项落点在 03 的 not_mine。

做法：
- 每项先对照原文核对评审说法，再动手。
- 全部改动都是精确匹配、且只出现一次的局部替换，或在表格里插入新行。脚本和改前备份在 scratchpad `ext-apply-rules-privacy/`（`apply1.py`、`apply2.py`、`apply3.py`、`backup/`）。
- 表格列数已用脚本与备份逐表比对，没有变化。
- 正文里不写 CONS 编号。
- 需要改 canon 的内容只追加到 `_changes/CN-005-external-review-canon-items.md` 的本组小节（CONS-42、CONS-118 的 canon 部分，以及随 CONS-18 发现的 D10 措辞残留），canon 文本本身没有改动。

| id | 状态 | 文件与位置 | 改动摘要 |
| --- | --- | --- | --- |
| CONS-01 | applied | 06-part2 §5.1 第 2、5 步，`SharedLedger` 类型；§5.2 `viewFor` 代码与首条说明；06-part7 §11.1 `viewOf` 注释与 `shared` 入参 | 核实：原 `viewFor` 用 `briefs.disclosures` 判可见，并从 `full` 复制他方的值；手动共享、撤回和请求回答的披露都不改简报，导致撤回后仍能看到当前私密值。改动：`loadRuleInput` 改读 `sharedFacts` 每键最新行，组成 `shared`（撤回行不进入）；`viewFor(p, full, shared, viewer)` 中他方字段只取 `shared` 里查看者在受众内的值，不再从 `full` 复制；`buildHumanRequests` 回退项的"尚未披露"判定也改读 `shared`。签名仍是 CN-003 #5 的四参数形态，只换了第三个参数 |
| CONS-02 | applied | 06-part2 §5.2 `viewFor` 末尾与"派生值解密"说明；07-part5 §7.10 XP-2 | `capCents` 与 `committedCents` 都可见时派生 `headroomCents`，与 07 §7.8.5、`projectChecks` 和 XP-2 用同一谓词；只有上限时永不推出余量 |
| CONS-06 | applied | 14-part2 §6.4 `drop_items` 循环；06-part7 §11.4 `drop_items` 行 | 循环条件 `size <= req.length` 改为 `< req.length`，至少保留一个必需项；06 §11.4 把"可为空"改为"必须非空，否则 `item.required_missing`（12 §12.14）"，生成期与回答期调用同一 `validateBriefFields` |
| CONS-15 | rejected_after_reading | 07-part4 §7.8.3 第 62 行 | 见下文"驳回理由" |
| CONS-18 | applied | 06-part5 §7.1 `Line`；14-part2 §6.2 `materialize`；06-part8 §12.1 `materialize` 契约段 | `Line` 补 `kind: 'item' \| 'modifier'`（canon D25、03 `lineV`）；`materialize` 写入 `kind: r.kind`；写明缺字段的物化结果会在插入时被 `lineV` 拒绝。05 的插入示例与 INV-37 不在本组范围（见"留给其他组"）；canon D10 括注的残留已记入 CN-005 |
| CONS-19 | applied | 14-part2 §7 三条 `CheckDecl` 及其后说明 | `owner` / `requires: [[f]]` 改为 `ownerRole` / `inputs: [f]`；补一句：与 06 §7.1 一致，插件以 `satisfies ScenarioPlugin<ScopeChangeRuleInput>` 编译。`CheckCtx` 的形状（`{ input, x }`）仍待 CN-004 #3 裁定，本组未改 |
| CONS-21 | applied | 14-part2 §6.4 `feas` | feasibility 调用改为 `{ mode: 'feasibility', exclude }`，去掉 `limit` / `anchor` / `mustInclude` |
| CONS-22 | applied | 14-part2 §6.4 | 删除 `relaxations` 里生成 `choose_candidate` 的分支，改为 `ctx.kind !== 'infeasible'` 时返回 `[]`；`choose_candidate` 由引擎枚举（06 §11.2、§12.1 成员 12） |
| CONS-24 | applied | 16-part4 TC-EXE-12 | 不再要求"去掉写锁后必须出现重复"。改为三步：① 只断言写锁证据消失，区间读 OCC 仍可能挡住重复；② 用显式变异夹具同时去掉写锁和区间查重，证明探针本身灵敏；③ 恢复后零重复。生产重叠探针独立运行 |
| CONS-27 | applied | 06-part8 §12.1 成员 16 | `readiness(input, confirmedRoles)`：席位、基线和每个角色是否已有已确认简报由引擎读 `briefs` 判定，不从硬字段值推断（provider 没有硬字段）；场景只声明字段缺口和目录缺口。04 §4.2.1 的措辞要随之调整（见"留给其他组"） |
| CONS-33 | applied | 16-part3 TC-AUTH-06 | 禁令只针对调用者身份：`userId` / `memberId` / `actorUserId`，以及表示调用者自身角色的 `role`。白名单只有两处：`invites.create` / `createLink` 的目标 `role`，和 `rooms.create.myRole`（04 M1） |
| CONS-34 | applied | 16-part3 TC-AUTH-03 | 删去不存在的 `args.roomId`；改为先由 `requestId` 解析出房间，再做成员检查（`auth.not_member`）和 `toRole` 检查（`auth.role_forbidden`，12 §12.14） |
| CONS-35 | applied | 16-part3 TC-VER-06 | 例外集合改为非生产层的 `seed.reset`，加上只覆写 `REDACTABLE_FIELDS` 的 `privacy.redact`（canon D18）；审计事件与 `termsKey` 不变由 TC-PRIV-22 另行验证 |
| CONS-36 | applied | 16-part3 TC-VER-15 | 60 行 approve 不再靠 withdraw / approve 交替构造（withdraw 上限 10 先到）。改为跨合法约束版本累积：finance 在两个都能让提案通过的上限之间反复调整，D06 沿用同一提案，假时钟按节流窗口推进。customer 第 11 次 withdraw 的断言保留 |
| CONS-41 | applied | 07-part7 §7.15 LP-1 | 删去"输出空间无法跨边界写出任何东西"的绝对说法，改为：写不出任意文本或数值，但在合法选项里有偏选择仍能编码少量信息（R-6），这是被接受的残余信道，不是结构性保证 |
| CONS-42 | deferred_canon | 07-part7 §7.14.2 provider 行（未改） | 核实属实：同一 run 内 provider 能从快照里少了哪个候选，推出私密的复核失败，而 DX-12 只授权给 customer。正文是 canon D10 的原文，改它就要改 canon，因此只记入 CN-005（拟议：剔除集合按收件人拆分） |
| CONS-52 | applied | 06-part7 §11.1 入参、`passedToNext` 注释；§11.2 infeasible 行 | 增加可选入参 `toRole?: RoleKey`，供 `pass_to_next` 转交时固定收件人；`passedToNext` 由已 answered 的 `pass_to_next` 请求派生，不新增 runs 字段。**按 canon 调整了落地方式**：评审建议的参数名 `targetRole` 是 canon §1.2 明列的废弃收件人名，所以用 `toRole` |
| CONS-57 | applied | 06-part6 §10 `enumerateCandidates` 返回 | 快照模式下 `items` 与 `materialized` 用同一个 `ordered` 数组；注释写明调用方按 `candidateKey` 对应，不靠下标。feasibility 分支原本同序，未改 |
| CONS-59 | applied | 06-part6 §9.2 `createTurnTx` 行；06-part7 §10.1 第 4 条 | provider 回合的 `exclude` 先去掉上一轮被成功转发的 counter 键，再由 `mustInclude` 选入；被拒绝和复核失败的剔除不受影响（customer 评估快照本就剔除这两类键）。canon D10 对 counter 没有规定，05 §5.8.4 要求把它纳入快照，所以不涉及 canon |
| CONS-71 | applied | 06-part2 §5.1 第 1 步 | 插件经 `scenarioOf(room)` 取；房间钉住的版本未注册时报 `run.invalid_state{ guard: 'scenario_version' }`，不再抛 `internal`。**按 canon 调整了落地方式**：change 文本说"`rooms.create` 继续返回 `scenario.unsupported`"，但 canon §1.5 / C56、04 M1、INV-45 规定建房时也用同一个码，所以正文不引入 `scenario.unsupported` |
| CONS-72 | applied | 06-part6 §9.2 `sharedFacts.add` 行 | 签名改为 `{ roomId, field, audience, confirmOwnDisclosure }`，没有 value 参数（canon §1.6 / C51、12 §12.11）；值从本人简报或台账派生复制；读表和失败码与 12 §12.11 对齐。没有采用评审自造的 `fieldKey` / `toRoles` 签名 |
| CONS-73 | applied | 14-part6 §11 F（拆成分支 F-a / F-b）；14-part4 §9.5 叙事；14-part5 S13；14-part7 T14-V01–V07 | 新增分支 F-b：customer 选 $900，下调到 481237 后 v1 `budget.over`，超出 8982（只给 finance）；run 2 得 $800，余 1018。原来选 $800 并沿用提案的走法保留为 F-a。§9.5 的叙事改成两条分支。S13 的来源回合更正为"run 2 第 2 回合（第 2 轮 provider 回合）的 O1"。没有引入评审给的 401219 基线、旧键名和旧 A1 clarify 叙事 |
| CONS-74 | applied | 16-part4 TC-RULE-09；16-part3 TC-VER-03；16-part7 E-CUT、E-CLARIFY；同一缺陷在本组章节的残留：14-part2 stub 注释、14-part7 T14-R04 | counter 规则改为"快照已剔除 base，n = 0 时没有 counter，n ≥ 1 就提供"（05 §5.7.2）；"三条审批 stale"改为两条 `stale_approve` 加 finance `pending`（canon D27 / C57）；E-CLARIFY 的话题改用 `deadline_value`（14 §3）。change 中"n === 1 用 z.literal"没有落地：05 `buildTurnZod` 对 n = 1 也用 `z.enum`，无需特例 |
| CONS-76 | applied | 16-part7 §16.10.1；16-part2 §16.4.5 | E2E 的 mock 目标从 `callNegotiationModel` 改为公开接缝 `callModel`；16-part2 补上 mock 所用的入参类型 `CallModelRequest = { body, meta: { role, turnKind, attemptId } }`。10 §10.14.1 的 `callModel` 目前直接等于 `callNegotiationModel(body)`，需要 10 补适配层（见"留给其他组"） |
| CONS-84 | applied | 07-part5 §7.9 引言；§7.9.5 新增一行 | 写明矩阵按例外列出：未逐行列出的叶子（`rawOutputs.*`、`writeSeq`、`*FnId`、`*UserId` 等，03 §3.16.1 的 system 类）在 `DISCLOSURE` 中一律登记为 sys、代理 ✘；叶子清单由 TC-PRIV-10 从 schema 生成并要求与注册表精确相等，任何叶子要放宽，须先在矩阵加行。另新增一行列出上述内部叶子 |
| CONS-107 | applied | 16.md §16.0 目标段；16-part3 新增 TC-AUTH-14 / 15；16-part4 新增 TC-EXE-13、TC-RUN-27；16-part5 新增 TC-PRIV-25 | 新增五类回归用例：混合事件稀释节流计数、先改标题再改价、满目录与 50 任务准入（03 §3.13.1 `item.limit_exceeded`）、`rounds_exhausted` 的每个 `questionKey`、时间线提交组的每个分页切点。只有部署能证明的结论仍以 L2 证据为准。正文不引用 CONS 编号，改为引用设计条目 |
| CONS-115 | applied | 07-part7 §7.14.1 `feedback` | 改为 `{ roundNo; proposalVersion: number \| null; outcome }`：被阻断的候选没有版本号，记 null 并带公开轮次（05 §5.8.4）。按 CN-002 #5，counter 反馈只带 candidateKey，所以没有加 `forwardedCounterOptionKey` |
| CONS-116 | applied | 07-part7 §7.14.3 块表与引言；§7.14.1 `openRequestForMe` 注释 | 块表改为复述 05 §5.13.1（两个 user 块加末尾的中途 system 消息），并注明以 05 为准；`ownApprovalNotes` 放进块 A 的 `<principal_notes>`，并写明块 A 在 run 内可能变化，会让缓存断点失效；`openRequestForMe` 在 negotiating 期间恒为 null。05 侧也要补 `ownApprovalNotes`（见"留给其他组"） |
| CONS-118 | applied（canon 部分为 deferred_canon，已记入 CN-005） | 07-part9 §7.21 R-1；07-part6 §7.13 量化段 | 改为逐信道核算：DX-2 合计 ≤ 4.8 + 9.5 bit，DX-1 与 DX-11/13 各 ≤ 24 bit，DX-12 没有日总量桶；四项有上限的信道合计 ≤ 62 bit，但不再宣称这是全信道的每日上界。canon D12 ⑥ 的"合计每天至多数十 bit"记入 CN-005，与 state-protocol 组的 CONS-82 并案 |
| CONS-120 | applied | 06-part2 §3 依赖规则段 | 词汇 lint 改为整词匹配，并加显式白名单：`Effect.type` 的三个放松字面量、`RelaxEntry` 后缀、`date.after_deadline`、定界块属性 `provider.catalog_titles`（05 §5.13.2 把它放在 `core/engine`），以及 schema 声明里的示例注释；同时写明不得为绕过 lint 改用不受校验的任意 patch 对象。CN-004 #8 当时没有落地，这一项同时补上 |
| CONS-03 | not_mine | 03-schema-part7 §3.9 | 落点在 03，属于 model-schema 组。引用到的 14 §6.2 原文（人选的就是人看到的交付日）不需要改 |

## 驳回理由：CONS-15

评审的说法是："同一 briefVersion 内的手动授权会让历史事件追溯可见"。核对 07 §7.8.3 原文后，这个说法不成立：

- 原句："任何历史值……只在'该值所属版本生效时的受众'包含查看者时才渲染。实现：渲染器按 `(fromRole, field)` 取 `briefVersion ≤ 该值版本` 的最新 sharedFacts 行判定受众"。
- 写入规则写明，`briefVersion = N` 的行只能在 N 是当前版本时写入：manual 是"**无 value 参数**：值从 O 当前已确认简报复制"；request_answer 是"值从回答者当前简报复制"；`briefs.confirm` 写入的是新版本本身。
- 推论一：同版本内事后写入的授权行，只会让查看者看到 value_N。而在写入那一刻，按有效可见性规则（最新行、`value !== null` 且查看者在受众内），查看者本来就有权看 value_N。所以不会出现查看者从未获授权的值。
- 推论二：跨版本的追溯（v1 未共享、v2 共享时回看 v1 的值）正是 `briefVersion ≤ 该值版本` 截断要挡的情形，TC-PRIV-14 覆盖了这一点。
- 推论三：同版本内先共享后撤回时，历史显示被隐藏，属于 fail-closed，与"撤回不溯及既往：已被看到的值无法收回"一致。
- 执行快照：D04 规定执行后房间终态，不再写 `sharedFacts`，所以"执行时生效的行"就是最新行。
- 结论：现规则的粒度是"版本内的最后受众"，与原句的版本粒度语义一致，不构成核心 1 的泄露。按事件时点冻结披露引用需要改 03 的 schema，收益只是把 fail-closed 进一步收紧，本组不做。

## 留给其他组（本组没有改的跨章残留）

- 04 §4.2.1："引擎检查席位与基线，其余由场景声明"应补上"及每个角色是否已有已确认简报"，与 06 §12.1 成员 16 的新签名对齐（CONS-27）。
- 05 §5.13.1 块 A：`<principal_notes>` 应列出本人审批备注 `ownApprovalNotes`，并说明它会让块 A 在 run 内变化、使断点 2 的缓存失效（CONS-116）。
- 10 §10.14.1：`callModel` 应成为接收 `{ body, meta }` 的适配层，只把 `body` 交给 `callNegotiationModel`；16 §16.4.5 的 mock 已按这个形状书写（CONS-76）。
- 12 §12.2 第 7 条：`price_writes` 的每 run 改价规则已由 12 改为以改价前的当前 `runId` 与 `itemKey` 为键（不再比较 `confirmedAt` 与 `run.startedAt`），本条已无残留；`constraint_writes` 的读法也已改为只含计数标记行的 `events.by_room_actor` 前缀读（`take(6)`、按 distinct `commitTs` 计，12 §12.2 第 7 条、03 §3.11.3），`take(50)` 被其他本人事件稀释的问题同样已无残留。16 的 TC-AUTH-14 按正确行为断言，读法由 12 / 03 修正（对应 CONS-10）；TC-AUTH-15 已按 12 现文重写（改价必然 bump，同一 run 内第二次改价构造上不可达）。
- 05 的提案插入示例与 00-invariants INV-37：`lines[]` 要补 `kind`（CONS-18 中不属于本组的部分）。
- 03 §3.5 / §3.8：剔除集合由 turns 的 outcome 现算，会把 counter 的 `outcome.candidateKey` 计入"已提出"。06 已在 provider 回合减去被转发的键，03 可以在这里注明同一点（CONS-59）。
- CN-004 #3 `CheckCtx` 的形状仍待裁定；14 §7 暂按 `{ input, x }` 书写。
- 04 §4.3.3 R3：`disclosures` 改名为 `shared`（类型 `SharedLedger`），`viewFor(plugin, input, shared, r)`，`buildHumanRequests` 的入参字段同步改名为 `shared`（CONS-01）。已落地：state-protocol 组在 fixup 轮改为从 `loadRuleInput` 的同一次读取得到 `{ input, shared }`，删掉单独的 `effectiveDisclosures` 读。
- 08 §8.3.2 读表（part3 第 30 行）：删掉 `briefs` 行的"各方 `disclosures`"，改为 `sharedFacts` 有效行（06 §5.1 第 2 步、07 §7.8.3）（CONS-01）。已落地（fixup 轮跨组交接）。
