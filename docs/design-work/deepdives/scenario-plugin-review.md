# 反驳评审：场景插件接口（scenario-plugin）

> 评审对象：deepdives/scenario-plugin.md、part2–part5、scenario-plugin/{contract,plugin,scope-change,event-budget}.ts。
> 依据：00-brief §2–§3；inputs/04 part1–part2；inputs/02 F05.2、F06、F08.5、F14.2；inputs/03 RA-B10；node_modules 中 convex 1.48、@anthropic-ai/sdk 1.1.0、zod 4.6.7 的源码；并横向对照 negotiation-protocol、versioned-approvals、rules-engine、fixtures-walkthrough、privacy-disclosure 各专题。
> 分片：本文件（总评、13 条待验证声明逐条核对、问题 r01–r03）→ scenario-plugin-review-part2.md（问题 r04–r08）→ scenario-plugin-review-part3.md（问题 r09–r18、过度设计、给其他专题的接口要求）。
> 探针：scratchpad/sp-review/probe.mjs（只读，import 仓库 node_modules 里的 zod 与 SDK helper，不改任何仓库）。

## 0. 总评

接口骨架方向正确：纯函数插件、引擎拥有金额算术与预算台账、reasonCode 加按角色披露、fixture 走生产写入路径，这几条都站得住。但有四处结构性问题，必须在合并进 06/08/09 之前改掉：

1. 模型输出契约与 05 冲突：本专题让模型填自由草稿（含 `deliveryDate`、`useRush`），05 让模型从代码生成的候选里选 `optionKey`。前者让模型自选日期，违反核心 4（r01）。
2. 同一用户对同一提案给两种 kind 的审批：与本专题自己的"userId 两两不同"规则矛盾，也与 versioned-approvals 的 INV-A4/INV-E3 矛盾（r02）。
3. 目录不在约束投影里：与 part2 §3.5 的文字、边界 B4、versioned-approvals 递增矩阵 B5 都冲突（r03）。
4. 评估用当前目录给旧提案重新定价：误报"代码缺陷"，条目撤下后 `rooms.view` 会直接抛错（r04）。

另有一处隐私泄露：masked 检查仍返回原 `checkId`（r05）。

## 1. 待验证声明逐条核对

| # | 声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | validator 不能表达整数与范围，金额在代码里用 `Number.isSafeInteger` 断言 | **属实** | inputs/04 part2 第 24–27 行；`CVX:values/validator.ts`。补充：`v.int64()` 是另一条路，但 float64 整数分已足够。另外 zod 4 的 `.int()` 本身就拒绝 2^53（探针输出 `int 2**53 false`），所以 `centsSchema` 里的 `.refine(Number.isSafeInteger)` 是多余的 |
| 2 | 默认运行时用 esbuild `platform: "browser"` 打包，所以 React UI 不能混进规则入口 | **事实属实，推论不成立** | `CVX:cli/lib/config.ts:633-657`（第 638 行）确实是 `platform: "browser"`；但 `CVX:bundler/debugBundle.ts:60-66` 同时开了 `bundle: true, jsx: "automatic"`，React 在 browser 平台完全能打包。真正的理由见 r15 |
| 3 | 相对路径打包 `convex/` 之外的 `packages/**`：待验证 | **源码高置信可行**，仍需一次最小部署实验 | esbuild `bundle: true` 跟随相对 import 本身不受目录限制；Convex 只用 `outbase: dir` 决定入口的输出路径，没有限制路径的插件（serverOnly/external/wasm 三个都不拦）；metafile 的输入一律 `path.resolve` 取绝对路径（`bundler/index.ts:109-121`）。退路 `convex/lib/` 有副作用，见 r15 |
| 4 | query/mutation 里能否用 `crypto.subtle.digest`：待验证 | **仍待验证**（本地没有证据） | 补充：`digest` 是异步 API，而 part2 §3.5 的代码按同步 `stableHash(projection)` 写。建议整个去掉哈希，见 r13 |
| 5 | `v.any()` 的嵌套深度、字段名字符、约 1 MiB 上限：待验证 | **部分核实** | `CVX:values/value.ts:199-218`：字段名不得以 `$` 开头，只能是非控制 ASCII（32–126），长度不超过 1024。嵌套深度和单文档上限本地没有数值，仍待验证 |
| 6 | zod 4.6.7 的 `z.iso.date()` 拒绝 2026-02-30 | **属实**（本机 Node 实测） | 探针：`2026-02-30 false`、`2027-02-29 false`、`2028-02-29 true`、`2026-13-01 false`。实现是纯正则（闰年分支写在 pattern 里），Convex 运行时应当一致，可在第一次部署时顺带复核 |
| 7 | `zodOutputFormat` 把 enum/const/数值约束降级成描述；strictObject 是否转成 `additionalProperties: false` 待验证 | **属实，且后半可以结案** | `SDK:lib/transform-json-schema.mjs:66-73` 给**所有** object 强制写 `additionalProperties: false`（探针里非 strict 的 `z.object` 同样是 false）；第 79–99 行只保留受支持的 `format` 和 `minItems ∈ {0,1}`，`enum`、`const`、`pattern`、`maxItems` 一律挪进 description。补充：API 本身支持 `enum/const`（技能 shared/tool-use-concepts.md:546），是 SDK helper 把它们剥掉了。所以"不动态生成 enum"的理由应写成 schema 稳定（新 schema 有编译开销，缓存 24 小时）加上 SDK 行为，而不是平台做不到 |
| 8 | 根级 anyOf 是否被接受不确定，所以外包一层对象 | **仍不确定，外包做法合理** | SDK 不拒绝根级 anyOf，`oneOf` 会被改写成 `anyOf`（transform 第 46–47 行）；技能文档没有写根级限制。外包一层零成本，保留。新发现：判别字段 `action: z.literal(...)` 被降级为 `{type:"string", description:"{const:...}"}`（探针），所以 `propose` 和 `counter` 在解码层形状完全相同，动作合法性只能靠 safeParse 判定 |
| 9 | 被调度的 mutation exactly-once；`runAt` 的精度与取消方式待验证 | **前半属实** | inputs/04 part1 §1.5（`scheduler.ts:37-38, 93-127, 141-160`）：`runAt` 的时间戳限制在前后 5 年内；对 mutation 的 `cancel` 是原子的。触发精度仍待验证 |
| 10 | `Intl.DateTimeFormat` 的 `timeZone` 支持待验证；插件只接收 `today` | **属实**（仍待验证） | rules-engine/today-adapter.ts 做了 try/catch 加固定偏移的退路，两边一致。注意 r08：`today` 在 query 里的缓存语义 |
| 11 | convex-test 串行、证明不了 OCC，所以并发幂等不放进一致性套件 | **引用准确，决定正确** | inputs/02 F08.5（confidence medium），inputs/04 part2 §1.12（待验证）。一致性套件本来就是纯函数测试，本不该测并发 |
| 12 | scope_change 的数字取自 F14.2 方案一；$800 是边界 | **属实** | inputs/02 part12 第 12、15 行：$450/$350/$500、R $100、总额 $5,000、基线 $4,000、cap $4,800 下 A+B 恰好等于 $800、$4,400 无解。偏差：F14.2 的 R 是"按首选日期交付时收取"的单一费用行，骨架做成了逐条目的 `attrs.rushFee`，而且由模型开关决定是否收取（r12）；F14.2 要求"主线用不落在边界上的值"，而 `tradeoff` 变体正好是主线演示 |
| 13 | 活动场景要求 08 的 approvals 带 `kind`，并允许同一用户给 terms 与 budget 两条决定 | **不成立** | approvals 确实有 `kind`（versioned-approvals/schema.ts:98），但那里的 kind 由 role 经 `APPROVAL_KIND_BY_ROLE` 派生（INV-A4），而且要求 userId 两两不同（INV-E3）；本专题 part3 §3.10 第 4 步同样要求"彼此不同的 userId"。在 `seats: 1` 下，这个要求组合永远无法满足（r02） |

## 2. 问题（r01–r03；r04–r08 见 part2）

### r01【high】模型自由填写条款草稿，与 05 冲突，并让模型自选日期
- 现状：SP-D7 加上 scope-change.ts:41-46，`draft = { itemKeys, deferredItemKeys, deliveryDate: z.iso.date(), useRush }`，交给 `buildTerms` 规范化。
- 冲突：negotiation-protocol/model-output.ts:79-82 的 `propose/counter` 只有 `{ action, optionKey, rationale }`，模型只能从 `enumerateFeasible` 产出的候选快照里选；fixtures-walkthrough-review 也写明"候选的日期和金额由代码派生，模型写不出日期"。核心 4 规定"价格、范围项、日期只能来自用户确认过的信息"，而模型在 `[earliest, deadline]` 区间里自选一个日期，不属于这类信息。
- 后果：两条进入 `terms` 的路径（自由草稿与候选），两套校验面；B1/B2 这些边界只在自由草稿路径上才会出现。
- 建议：插件对模型的契约改为"候选目录"：`enumerateFeasible` 返回带稳定 `candidateKey` 的 `T` 快照，模型只回 `optionKey`。删掉 `draftTermsSchema`；`buildTerms` 改名为 `normalizeTerms`，只供代码与人工路径使用。clarify 的载荷由 05 定义。

### r02【high】同一用户双 kind 审批自相矛盾，"条件审批人"的验证是空的
- 证据：event-budget.ts:117-121 在超额时追加 `{finance, terms}`，而 finance 是 `seats: 1`；part3 §3.10 第 4 步与 SP-D8 都要求"彼此不同的 userId"，所以这条要求永远完成不了。versioned-approvals INV-A4（kind 由 role 派生）与 INV-E3（userId 两两不同）也不允许这样做。
- 更深的问题：两条审批绑定的是同一个不可变提案和同一个约束版本，追加的 `{finance, terms}` 不增加任何安全性，所以并没有证明"条件审批人"能被接口表达。
- 建议：删掉这个变体，v1 维持"每个 role 一种 kind、userId 两两不同"。要证明条件审批，就换成一个**不同角色**的条件要求（例如超过阈值时追加 `{ role: "host_lead", kind: "terms" }`），否则就把"条件审批人"移进 17 路线。不要因此要求 08 支持同人多 kind。

### r03【high】目录不在约束投影里，B4 与过期递增的承诺落空
- 证据：part2 §3.5 写的是"投影必须包含已确认目录的定价相关字段"，B4 期望"哈希变 → 版本 +1"，versioned-approvals 递增矩阵 B5/B6 也是目录变更即递增。可实际的引擎投影只有 `{ scenario, budgetTotalCents, seats, scenario_hard }`，scope-change.ts:87-88 的 `hardConstraintProjection` 不含目录，`Constraints` 类型里也没有目录。
- 后果：改价、撤下、`catalog.expire` 都不会让 `constraintsVersion` 递增；旧审批在版本意义上仍然"当前"，只靠 `SOURCE_SUPERSEDED` 挡住执行；`catalog.expire` 写了也不会触发重新协商。
- 建议：目录字段归引擎所有，就由引擎把 `catalog: sort([{ itemKey, revision, status }])` 拼进自己那部分投影；插件投影明确不含目录。一致性测试增加一条："确认、撤下、过期任一条目，投影必须变化"。
