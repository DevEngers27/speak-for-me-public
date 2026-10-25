# 18 · 决策记录与开放问题（part1）：读法、评委反例类目、冲突索引

> 分片：`18-decisions-open-questions.md`（本文件：§18.0 读法、§18.1 评委反例类目 FF-01…FF-42、§18.2 冲突 C1–C42 → ADR 索引、§18.3 spike 与 research 要求的 ADR 覆盖）→ `-part2.md`（ADR-D01…D05）→ `-part3.md`（ADR-D06…D10）→ `-part4.md`（ADR-D11…D15）→ `-part5.md`（ADR-D16…D21）→ `-part6.md`（ADR-D22…D27）→ `-part7.md`（§18.4 开放问题：U1–U12 + 新发现与跨章冲突 N-01…N-33）→ `-part8.md`（§18.5 待验证清单、本章不变量、与 canon 的对照）→ `-part9.md`（§18.4.3 各章登记、未并入 N / V 的开放问题）→ `-part10.md`（§18.6 章节级决定 ADR-X01…X04：canon 未列、由各章做出的重大决定）。
> 底稿：`candidates/product/18-decisions-open-questions*.md`（ADR 格式）+ `00-canon-part2…part5.md`（D01–D27 与 C1–C42 是本章的唯一裁决来源）。素材：`judging/candidates1.json`（4 份候选 × 3 评委）与 `candidates2.json`（5 份候选 × 3 评委）的 130 条 fatal_flaws、`spikes/README.md` §7 / §8、`research/README.md` §6–§7、`techstack/README.md` §6、10 个专题 review 的待验证核对。

## 18.0 读法

- 每条 ADR 编号与 canon 裁决一一对应：**ADR-Dnn = canon Dnn**。格式：背景 → 选项 → 决定 → 被否决（含 canon 冲突编号 Cnn）→ 后果（正面、代价、**关闭了哪些评委反例类 FF-xx**、残余与待验证）。
- ADR-Dnn 不新增决定；与 canon 不一致之处只能出现在返回值的 canon_objections，本章按 canon 书写。
- 各章在 canon 未覆盖处自行做出的重大决定（改变并发模型、新增实体 / 表、在只追加纪律上开例外）以 **ADR-Xnn** 登记在 §18.6（part10），同样写背景 / 选项 / 决定 / 被否决 / 后果，另注明所在章与当时需要 canon 吸收的 N 编号；ADR-X 不推翻任何 canon 裁决。X01…X04 涉及的名字已于 2026-10-24 由 canon 吸收（N-09、N-31…N-33 已解决），它们现在是"细化 canon …"的决定记录。
- 评委反例以"候选 / 评委 F 序号"引用：候选缩写 `c1-inv`（领域与不变量优先）、`c1-sec`（安全、隐私与信任边界）、`c1-prod`（产品体验与可扩展引擎）、`c1-run`（运行时与可靠性）、`c2-min`（极简完整）、`c2-plg`（场景插件接口）、`c2-aq`（代理协商质量与评测）、`c2-es`（事件溯源与可审计性）、`c2-fin`（资金正确性与账务）；评委缩写 `sr` = security_runtime、`pe` = product_extensibility、`iv` = invariants。例：`c2-min/ivF1` = candidates2 极简候选的 invariants 评委第 1 条。

## 18.1 评委反例类目（130 条 fatal_flaws 归为 42 类）

| 类 | 反例要点 | 条数 | 来源 | 关闭它的 ADR | 状态 |
| --- | --- | --- | --- | --- | --- |
| FF-01 | 零成本 / 无痕预算预言机：改价或改简报 → 预检 → 观察是否无解；预览 query 返回 feasibleAfter；候选集按预算过滤；历史提案实时重算；provider 看到原因类别 | 21 | c1-inv/srF2、c1-inv/ivF1、c1-sec/ivF5、c1-prod/peF1、c1-prod/ivF1、c1-prod/srF1、c1-prod/srF3、c1-run/srF1、c1-run/srF2、c1-run/peF2、c1-run/ivF2、c2-min/srF2、c2-min/peF1、c2-plg/ivF3、c2-plg/srF2、c2-plg/peF1、c2-aq/srF6、c2-aq/peF2、c2-fin/ivF2、c2-fin/srF6、c2-fin/peF6 | D12、D10、D17 | 部分关闭：无痕与零成本通道关闭；残余为政策性接受的每提案 ≤ 1 bit，频率有上界 |
| FF-02 | `deferredItemKeys` 等派生字段泄露 customer 未披露范围 / 偏好 | 13 | c1-sec/peF1、c1-sec/ivF1、c1-sec/srF1、c2-min/ivF1、c2-plg/ivF1、c2-plg/srF1、c2-aq/ivF1、c2-aq/peF1、c2-es/srF1、c2-es/peF1、c2-fin/ivF1、c2-fin/srF1、c2-fin/peF1 | D11 | 关闭 |
| FF-03 | 人工请求 / 可行包选项用系统视角计算，泄露他方未披露值 | 4 | c1-inv/srF1、c1-inv/peF1、c2-min/ivF6、c2-min/srF1 | D11、D15 | 关闭 |
| FF-04 | 并行评估一方失败、另一方被判 stale 后计数器永不归零，run 永久卡住 | 13 | c1-inv/srF4、c1-inv/peF2、c1-inv/ivF4、c1-sec/peF2、c1-sec/ivF3、c1-sec/srF2、c2-plg/srF4、c2-plg/peF2、c2-aq/ivF3、c2-aq/srF2、c2-aq/peF4、c2-es/ivF5、c2-es/peF6 | D08、D07、D15 | 关闭 |
| FF-05 | 执行后的后续 run 重复承诺已执行范围 | 15 | c1-inv/peF4、c1-inv/ivF3、c1-sec/peF3、c1-sec/ivF2、c1-sec/srF3、c1-prod/ivF3、c2-min/ivF3、c2-min/peF3、c2-plg/ivF5、c2-plg/peF5、c2-aq/ivF5、c2-aq/peF6、c2-es/ivF4、c2-fin/ivF3、c2-fin/srF3 | D04 | 关闭 |
| FF-06 | 交付日 `today + leadDays` 每次重算，跨午夜提案永久不可执行 | 9 | c2-aq/ivF2、c2-aq/srF5、c2-aq/peF3、c2-es/ivF3、c2-es/srF4、c2-es/peF4、c2-fin/ivF4、c2-fin/srF2、c2-fin/peF2 | D22 | 关闭 |
| FF-07 | `needs_input` 死路：无请求、请求悬空、`close` 选项替所有人关房、单层反应后无 open 请求 | 7 | c1-run/peF3、c2-min/ivF4、c2-min/peF2、c2-plg/ivF8、c2-plg/peF4、c2-es/peF5、c2-min/srF4 | D15、D06 | 关闭 |
| FF-08 | 审批有效性按当前版本派生，执行后 bump 把已执行审批显示为失效；重新选中旧提案让旧审批静默复活 | 2 | c2-min/ivF2、c2-min/peF4 | D04、D02 | 关闭 |
| FF-09 | 执行键含 cv 且执行 bump cv，第二道防线失效 | 1 | c2-plg/ivF5 | D03 | 关闭 |
| FF-10 | 目录只改标题即阻断提案（`catalogRevision` 守卫），provider 可冻结协商 | 2 | c2-aq/ivF4、c2-aq/srF4 | D05、D25 | 关闭 |
| FF-11 | 看门狗以 `turnId` + `startedAt` 计时，误杀 attempt 2 | 1 | c2-aq/srF3 | D07 | 关闭 |
| FF-12 | 约束变化后保留提案于旧 run，`constraintsVersionAtStart` 恒不符，reject 后永久卡住 | 1 | c2-plg/srF3 | D06 | 关闭 |
| FF-13 | `choose_candidate` 需要 `needs_input → pending_approval`，迁移表缺边 | 2 | c2-fin/ivF5、c2-fin/peF3 | D15 | 关闭 |
| FF-14 | 被人拒绝的提案在约束变化后复活进 `pending_approval` | 2 | c2-fin/ivF5、c2-fin/peF5 | D06 | 关闭 |
| FF-15 | 命令管线只做一层反应，answer → bump 不再开新 run | 1 | c2-es/peF5 | D06 | 关闭 |
| FF-16 | `committed ≤ cap` 可被违反：外部台账条目不查上限、不幂等；校验口径用旧值 | 3 | c1-inv/ivF2、c2-plg/ivF4、c2-plg/peF3 | D23 | 关闭 |
| FF-17 | `run_*` / `human_request_opened` 事件对 provider 暴露 kind、toRole、reasonCode | 2 | c2-es/ivF2、c2-es/srF2 | D14、D12 ⑦ | 关闭 |
| FF-18 | 哈希链链头同库，能力被夸大 | 1 | c2-es/srF5 | D14 | 关闭（不做；外部锚点进 17） |
| FF-19 | 加急费是插件常量，未经 provider 确认却计入金额 | 1 | c2-es/srF3 | D25 | 关闭 |
| FF-20 | 已声明的硬字段（provider `earliestStartDate`）不在规则输入里 | 2 | c2-es/ivF1、c2-es/peF3 | D05 | 关闭 |
| FF-21 | `taskKey` 两段 / 三段自相矛盾 | 1 | c2-es/peF7 | D03（canon §1.2 三段） | 关闭 |
| FF-22 | 预算对 customer 固定可见；finance 无条件看 customer 简报 | 2 | c2-aq/srF1、c2-es/peF2 | D12 ④、D11 | 关闭 |
| FF-23 | 审批无 `expectedConstraintsVersion`（TOCTOU） | 1 | c2-plg/peF6 | D02 | 关闭 |
| FF-24 | 调用上限存在 run 上、每新 run 归零；run 数上限把约束记录绑死 | 3 | c2-plg/srF5、c2-min/ivF5、c2-min/srF4 | D17 | 关闭 |
| FF-25 | Zod schema 经 `runQuery` 传递，过不了 Convex 值校验 | 1 | c2-min/srF3 | D09 | 关闭 |
| FF-26 | 被阻断尝试的计数随抛错回滚，上界形同虚设 | 1 | c1-prod/peF2 | D17、D12 | 关闭（v1 无人工提案入口；节流按已提交写入计数） |
| FF-27 | 两路索引合并分页不可实现 | 1 | c1-inv/peF5 | D14 | 关闭 |
| FF-28 | 插件规则版本升级未绑定在途审批 | 1 | c1-prod/ivF2 | — | **未关闭** → §18.4 N-08（08 O12） |
| FF-29 | 取舍 / 枚举在 mutation 内的最坏复杂度未分析；候选规模失控 | 3 | c1-inv/srF5、c1-inv/ivF5、c2-fin/srF5 | D10、D15 | 部分关闭（快照 ≤ 12、只算目标视图）；06 需性能用例 |
| FF-30 | 只改披露的简报版本不 bump，按"cv 引用的版本"投影则披露撤回不生效 | 1 | c1-inv/srF3 | D11、D05 | 关闭（投影与上下文读每角色最新确认版本；07/10 写明） |
| FF-31 | 回答请求触发的 bump 把这条请求自己取消，追溯断链 | 1 | c1-inv/peF3 | D15 | 关闭 |
| FF-32 | 引擎表写死场景字段，引擎 / 场景边界名不副实 | 3 | c2-min/peF5、c2-aq/peF5、c2-fin/peF7 | D21、D26 | 部分关闭（v1 一个场景；17 §17.3 R6 记录残余） |
| FF-33 | 新候选与旧提案 key 相同但来源不同，复用了不可执行的旧提案 | 2 | c1-run/peF1、c1-run/ivF3 | D06、D25 | 关闭 |
| FF-34 | 事后披露让历史评估泄露当时未披露的值 | 1 | c1-sec/ivF4 | D11、D12 ① | 关闭（历史提案不实时重算、不带检查：12 `proposals.get`、13 §13.9.2；N-07） |
| FF-35 | counter 的排序键列表构成容量信道 | 1 | c1-prod/srF2 | D10 | 关闭 |
| FF-36 | 私密必需项经全员可见的候选集被精确披露 | 1 | c1-run/ivF1 | D10 | 关闭 |
| FF-37 | 报价未绑定范围定义版本 | 1 | c1-prod/ivF4 | D25 | 关闭 |
| FF-38 | 并行评估的 counter 冲突无规则 | 1 | c2-fin/peF4 | D08 | 关闭 |
| FF-39 | 规则闸门死循环（被拒候选不排除） | 1 | c2-fin/srF4 | D10 | 关闭 |
| FF-40 | 规范化键不覆盖派生字段，执行内容与批准内容不同 | 1 | c2-plg/ivF2 | D25、D03 | 关闭 |
| FF-41 | 执行产物没有数据级模拟标注 | 1 | c2-plg/ivF7 | D18（canon §1.2 `provenance`） | 关闭 |
| FF-42 | 跨文件不一致：`requestRenegotiation` 允许状态、answer 关房、note 可见性、`already_executed`、模板参数、callLimit；并发最后两票的安全依赖未验证的 OCC 区间冲突 | 2 | c2-plg/ivF6、c2-fin/ivF6 | D04（C40）、D15、D13、D02、D17 | 关闭（OCC 区间冲突列入 §18.5 V-01） |

（个别反例同时属于两类，故各类条数之和大于 130。）

## 18.2 冲突 C1–C42 → ADR 索引

| C | 主题 | ADR | C | 主题 | ADR |
| --- | --- | --- | --- | --- | --- |
| C1 | workflow vs 自建链 | D01 | C22 | reasonCode 命名 | D16 |
| C2 | 执行键含不含 cv | D03 | C23 | contentHash vs termsKey | D25 |
| C3 | 执行后终结 vs 追加轮 | D04 | C24 | deferredItemKeys | D11 |
| C4 | 执行是否 bump | D03 | C25 | 请求选项来源 | D11 |
| C5 | 并行 vs 串行评估 | D08 | C26 | provider 候选是否按预算过滤 | D10 |
| C6 | 回合失败后 run 去向 | D15 | C27 | 预算对 customer 可见 | D12 |
| C7 | today 是否进投影 | D22 | C28 | finance 无条件看 customer 简报 | D11 |
| C8 | 目录确认何时 bump | D05 | C29 | 事件可见性模型 | D14 |
| C9 | 硬投影范围 | D05 | C30 | 哈希链 | D14 |
| C10 | 约束变化后保留提案的位置 | D06 | C31 | `run_needs_input` 对 provider | D12 |
| C11 | 单层 react vs 不动点 | D06 | C32 | 预算低于已承诺 | D23 |
| C12 | 守卫比较回合快照 | D07 | C33 | 调用上限落点 | D17 |
| C13 | 守卫命中必 reconcile | D07 | C34 | 排空标志 | D17 |
| C14 | 看门狗参数 | D07 | C35 | 一人兼任 | D24 |
| C15 | 流式与 max_tokens | D09 | C36 | 邀请形态 | D24 |
| C16 | fallbacks 默认 | D09 | C37 | fixture 数字 | D27 |
| C17 | thinking 参数 | D09 | C38 | RUSH 常量 vs 修饰项 | D25 |
| C18 | ESLint / Vitest 版本 | D20 | C39 | taskKey 段数 | D03 |
| C19 | 四包 vs 单包 | D21 | C40 | `requestRenegotiation` 允许状态 | D04 |
| C20 | 动作集与引用字段 | D09 | C41 | 审批有效期 | D02 |
| C21 | candidateKey vs optionKey | D10 | C42 | 简报抽取在 v1 | D26 |

canon 包修订新增的 C43–C60（章节定稿后新裁决）：

| C | 主题 | ADR | C | 主题 | ADR |
| --- | --- | --- | --- | --- | --- |
| C43 | 测试编号单一来源 | —（文档纪律：00-invariants / 16，非架构决定） | C52 | 排空时系统路径建 run | D06、D17 |
| C44 | `isExecutable` 不含审批集合 | D02 | C53 | `ops.setDraining` 层级 | D17 |
| C45 | 执行后两项写入豁免 | D04 | C54 | `pass_to_next` 转交出口 | D15 |
| C46 | `revision` + `editNo` | D05（X02） | C55 | 每回合自动重试次数 | D17 |
| C47 | D06 只沿用 `pending_approval` | D06 | C56 | reasonCode 缺口与别名 | D16 |
| C48 | `setup → open` 与首个 run 的 cause | D12 | C57 | D27 主线 | D27 |
| C49 | `currentRunId` 不清空 | D06 | C58 | 节流计数源与总量桶 | D12 |
| C50 | 人拒绝的 `reasonKey` 受众 | D13 | C59 | `restrictedRef` 八表 | D14 |
| C51 | `sharedFacts.add` 无 value 参数 | D12 | C60 | strict schema / `modelGateway` 落点 | D09 |

## 18.3 spike 与 research 要求的 ADR 覆盖

| 来源要求 | 对应 ADR |
| --- | --- |
| spikes §7-18 ① 编排引擎（workflow vs 自建链，不用 action-retrier） | D01 |
| ② 审批只追加 vs 当前行 + 事件表 | D02 |
| ③ 执行唯一键的派生方式 | D03 |
| ④ `create()` / 流式 + 自行 `safeParse`，统一 strict schema 生成器 | D09 |
| ⑤ `{turn}` 根、动作集与引用字段（版本号 vs Id） | D09、D10 |
| ⑥ reasonCode 命名与 params 受众裁剪 | D16、D11 |
| ⑦ codegen 与 CI 漂移检查（与 ① 联动） | D20、D01 |
| ⑧ `customerSeesBudget` 与隐蔽信道政策 | D12（U1、U2） |
| ⑨ `contentHash` 运行时与 zod 包体积 | D25（改用规范串，无需哈希）；包体积列入 §18.5 V-07 |
| research §6-18：策略与措辞解耦、固定轮转 + 硬上限、无代理私聊、同房同模型、禁止跨方自由文本、编排、授权构造器、用户入库、Clerk 变量、无容差无越权 | D10 / D13、D08、D13、D09、D13、D01、D21、D24、D20 / D24、D02 |
