# 反驳评审：确定性规则引擎（rules-engine）

> 评审对象：deepdives/rules-engine.md、-part2/3/4.md 与 deepdives/rules-engine/*.ts。
> 依据：00-brief §3 核心 1/3/4/5/6/8；inputs/04（要点 3、5、16，part1 §1.3，part2 唯一性与待验证总表 #2）；inputs/02 F14.2（part12）；兄弟专题 versioned-approvals、idempotent-execution、scenario-plugin、fixtures-walkthrough。
> 探针全部在 scratchpad/re-review/ 运行（node_modules 软链到原仓库，只读）；没有修改任何源仓库或 rules-engine 文件。
> 分片：本文件（§1 结论、§2 待验证声明逐条核对）→ rules-engine-review-part2.md（§3 问题清单 r01–r17、§4 建议的修订顺序）。

## 1. 总体结论

- 纯函数、整数分、日历日字符串、"不短路 + 依赖传播"的检查模型、`ALREADY_EXECUTED` 先于预算这几项核心决定站得住。复现结果：`node --test` 35/35 通过（Node 24.21）；`tsc 6.0.3 --strict --noUncheckedIndexedAccess --erasableSyntaxOnly` 零错误；RA-R02 的 $700 用例与 $800 = 余量的边界用例行为与文档一致。
- 有三处会直接违反核心：
  1. 执行幂等键写成 `(proposalId, constraintsVersion)`，与核心 5 以及 idempotent-execution D5、versioned-approvals D12 的 `exec:${proposalId}` 冲突（r01）。
  2. 必需项不在目录时，`findFeasibleOptions` 会抛 TypeError，§4 E15 宣称的行为不成立，而且没有测试覆盖（r02）。
  3. `projectEvaluation` 只替换 `code`，保留了 `checkId`，并且按通过/失败决定条目是否出现，所以 provider 能从投影里读出私密约束（r03）。
- 跨专题的命名分歧很多：termsKey 有三种定义，reasonCode 一份是开放字符串、一份是封闭枚举，rush 模型和预算字段名也不一样。06 必须先定一张"唯一所有者 + 术语表"，否则 03/08/14 无法对齐（r05–r08）。

## 2. 待验证声明逐条核对

| # | 声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| C1 | Convex 默认运行时 `Intl.DateTimeFormat` 支持 `timeZone` 与 `formatToParts` | **未能核实**（仍待验证） | `convex/src` 中只有 CLI 用 `Intl`，运行时侧没有证据。另一个问题：`today-adapter.ts:14` 的 `catch {}` 会把非法 IANA 名触发的 `RangeError` 也吞掉，静默退回固定偏移，配置错误因此不会被发现（见 r09） |
| C2 | query 中 `Date.now()` 跨午夜要等下一次数据变化才刷新 | **部分核实** | `convex/src/server/meta.ts:173-174` 写明 `getSnapshotTs()` "limits caching of the query's result the same way `Date.now()` does"，说明 `Date.now()` 会影响 query 缓存。订阅是否只在数据变化时重跑，本地没有源码证据，仍待验证。设计上的含义见 r09 |
| C3 | mutation 读同一快照并受 OCC 保护，所以并发的最后两票只有一次执行成功（I5） | **基本成立，但引用夸大** | inputs/04 part1 §1.3 只说明原子提交与 OCC。"两个并发事务都读到空的索引区间时会冲突"在 part2 第 8 行与待验证总表 #2 中被明确标为待验证，convex-test 也无法验证。更准确的表述是：两票都提交，恰有一票执行；前提是两票都按索引读了 decisions 与 executions 区间（见 r12） |
| C4 | `v.union(...REASON_CODES.map(c => v.literal(c)))` 的类型推断与参数个数 | **类型已核实** | 探针 `probe2.ts` 用 tsc 6.0.3 + convex 1.48.0 双向断言 `Infer<typeof vReasonCode>` 与 `ReasonCode` 相等，非法字面量会报错。`validator.ts:366` 的签名是 `<T extends Validator[]>(...members: T)`。运行时构造 37 个成员没有异常（`probe5.mjs`）。后端对 union 成员数是否有上限仍待验证，风险低 |
| C5 | `v.record(v.string(), v.union(string, number, boolean, array(string)))` 可作 `params` 的 validator | **已核实，有一个类型坑** | 能构造，JSON 也正确。但引擎的 `Params` 用了 `readonly string[]`，赋给 validator 推断出的 `string[]` 时报 TS2322（`probe2.ts:17`）。结果是 `returns: vCheckResult` 或 `ctx.db.insert` 会编译失败（r11） |
| C6 | `v.*` 只表达形状，范围与格式必须在代码中校验 | **已核实** | inputs/04 要点 5；`validator.ts` 文档注释 |
| C7 | SDK 1.1.0 `zodOutputFormat` 把 enum、格式、数值约束降级为描述文字 | **部分错误** | 实测（`probe4.mjs`）：`z.enum` 变成 `description: "{enum: …}"`；`z.iso.date()` 生成的 schema **保留了 `format: "date"`**，只有 `pattern` 被挪进描述。这与 inputs/04 part5 "保留受支持的 format" 一致。所以"格式也被降级"不成立，而用 `z.string()` 会丢掉唯一一个解码期仍受约束的日期约束（r10）。"代码必须复核"这一结论仍然正确 |
| C8 | 单个 mutation 内约 8k 次评估的 CPU 时间远低于限额 | **本机部分核实** | `probe3.ts`：目录 12 条（2 条必需）时 `suggestRelaxations` 约 8192 次评估，冷启动 47 ms、预热后 42 ms；10 条可选时 `findFeasibleOptions` 11 ms（Node 24 JIT）。Convex isolate 的速度和限额数值都待验证（inputs/04 待验证 #1），但余量大约一个数量级 |
| C9 | Node ≥ 23.6 可直接运行只用可擦除语法的 `.ts` | **已核实（本机）** | 35/35 通过；tsc 带 `--erasableSyntaxOnly` 零错误。inputs/04 的基线是 `Node >=24.19`，只要 CI 遵守 engines 字段，问题就不存在。另有两处待验证：Convex 的 tsc 类型检查需要 `allowImportingTsExtensions`（要求 noEmit）；Next 和 Convex 的打包器都要接受带 `.ts` 后缀的相对导入 |
| C10 | Zod 4 `z.enum` 接受 `as const` 只读元组 | **已核实** | zod 4.6.7 下 `z.enum(REASON_CODES)` 推断正确，非法值报错（`probe2.ts`） |
| C11 | F14.2 目录 1 的数字与本专题自定的日期 | **数字已核实；与 14 的 fixture 冲突** | inputs/02 part12 F14.2 第 1 套：A $450、B $350、C $500、R $100、基线 $4,000、cap $5,000→$4,800、无解值 $4,400，与 `fixture.ts` 一致。日期满足 F14.2 的相对关系（首选日 X、截止日 X+14、标准交付晚一周）。但 fixtures-walkthrough 的 fixture 用的是 REPORTS 30000、加急 15000、首选日 11-16、截止日 11-30，偏离了 F14.2，而且丢掉了 $800 = 余量的边界（r15） |
| C12 | 提案只追加，因此 `(proposalId, constraintsVersion)` 足以绑定审批，`termsKey` 只是纵深防御 | **前提成立，结论与代码不符** | 核心 6 与 versioned-approvals D1 都采纳了只追加。但 `engine.ts:92` 的 `decisionStates` 要求 `last.termsKey === binding.termsKey`，也就是说 `termsKey` 是审批行的**必需字段**，并不只是纵深防御。而 versioned-approvals D1 写的是"由 03 决定是否保留"（r05） |
| C13 | 目录条目任何影响价格、日期、有效期的修改都递增 `revision` 与 `constraintsVersion` | **未成立，并与兄弟专题冲突** | versioned-approvals 用 hardProjection 比较来决定是否递增，而它的目录投影只有 `priceCents` 和单个 `deliveryDate`（`versioned-approvals/constraints.ts:12`），没有 `rushDeliveryDate`、`validUntil`、`status`、`rushFee`。改价在那边是"插新行 + 旧行 superseded"，不是 `revision += 1`（versioned-approvals-part2 B5）。另外，本专题自己的 `rushFee` 没有 revision 和 status（r08） |

### 2.1 本评审额外复核为真的内容

- `isIsoDate` 与 `Date.UTC` 往返参考实现在 5000 个随机样本上一致（P5）；对合法的 4 位年份，字典序等于时间序。
- E5（RA-R02 回归）：`blocking = [MISSING_REQUIRED_ITEM, AFTER_DEADLINE, DATE_CONFLICT]`，预算检查为 `FITS_BUDGET`。
- E1/E2：cap 480000 时 80000 判为 FITS，479999 判为 `OVER_BUDGET(overByCents 1)`。
- E23：cap 440000 时结果为 `none`，`raise_cap.minCapCents = 445000`，与 F14.2"$4,500 仍可行"一致。
- 前沿 `LOGIN@11-20=45000, LOGIN@11-13=55000, LOGIN+REPORTS@11-20=80000` 可以复现。
- 每个子集只取两个候选交付日（最早标准日、最早加急日）的论证，在当前支配关系下成立：更晚的日期不会更便宜，也不会更容易满足首选日。
