# 07 · 权限、隐私与威胁模型（part8：查询投影纪律、日志与错误纪律、威胁清单）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.18 查询投影纪律

1. 公共函数返回值只能由 `to*View` 构造器产生，参数类型为已投影部件（品牌类型 `Projected<T>`），不接受 `Doc<"briefs">` 等受限文档；`convex/views/**` 禁止对象展开（ESLint `no-restricted-syntax: SpreadElement`）。
2. 每个公共函数声明 `args` 与 `returns`；`returns` 只作测试期探测器：convex-test 经 `api` 引用调用（直接调 handler 会跳过校验，techstack D12）与 L2 中任何返回值校验失败都让测试失败，不称运行时防线（review r10）。
3. mutation 返回值同样受投影约束；唯一登记的例外是 `invites.createLink` 返回一次明文 token。
4. Next 预取只调用同一批投影 query；列表按索引分页，不 `collect` 无上界结果。
5. `loadRuleInput` 是受限读函数：结果只传入 `checkProposal` / `isExecutable`，再经 XP-5 投影，不进入 DTO 构造器的作用域。

## 7.19 日志与错误信息纪律

### 7.19.1 平台事实

- convex 浏览器客户端（`browser/sync/remote_query_set.ts`、`request_manager.ts`）：`QueryUpdated` / `QueryFailed` / `MutationResponse` 都带 `logLines`，客户端把它们打印到**调用者浏览器**的 console；失败时 `errorMessage` 一并下发。dev 部署已由源码证实，prod 是否下发待验证（spikes §8 #11）——设计按"会下发"处理。
- `ConvexError` 的 `message` 就是 `data` 的序列化（`values/errors.ts`），所以 `data` 本身就是纪律边界。
- `APIError.message` = `${status} ${error.message}`，取不到时用 `JSON.stringify(error)`（服务端错误体原样）；`APIError.error` 保存完整错误体。
- Zod 4.6.7 默认不在 issue 中带 `input`，但 `unrecognized_keys.keys` 与 record 键路径由模型决定。

### 7.19.2 规则

| # | 规则 | 落点 |
| --- | --- | --- |
| E1 | 公共 query / mutation 内的日志与异常消息视为**发给调用者**（`logLines` 可能下发到浏览器）：禁止 `console.*`。两个 logger（15 §15.6 唯一定义，三份白名单合并为一处）：`opsLog(ctx: InternalCtx, code, fields: SafeLogFields)` 要求 internal / action 构造器才能取得的品牌参数，公开构造器可达的模块 ESLint 禁止 import 它；`publicOpsLog(code: PublicOpsCode, { fn, errorClass })` 只接受闭集的码与 `{ fn, code, errorClass }` 三个键、不收数值，公开路径上的必需日志（08 S11 的 `approval.not_executable`、`rooms.view` 的空槽位、12 的 `humanRequests.answer` 收敛、03 的 `appendSharedFact`、构造器的 `unhandled`）一律改用它。构造器内置 `withSanitizedErrors`：非 `ConvexError` 异常 → `publicOpsLog('unhandled', { fn, errorClass })` + 抛 `ConvexError({ code: 'internal' })` | `convex/lib/functions.ts`、`convex/lib/opsLog.ts`；ESLint `no-console` + `no-restricted-imports`；TC-PRIV-16；16 S6：公共函数执行期间 console 只允许出现 `publicOpsLog` 格式且键集合恰为 `{ fn, code, errorClass }` 的行 |
| E2 | 浏览器只收 `ConvexError({ code, params })`；`params` 经与 DTO 相同的受众投影（§7.11 的参数受众表）；不含原始模型输出、不含他方数值；评估路径（provider 的 `rooms.view` 也会执行它）只抛 `ConvexError({ code })`，从不 `new Error(\`cap ${x}\`)` | 12 的错误码表；TC-PRIV-06 |
| E3 | 服务端日志只经 E1 的两个入口：internal / action 用 `opsLog(ctx: InternalCtx, code, fields: SafeLogFields)`（`pickAllowed` 按白名单键在运行时再过滤一次）；公开路径用 `publicOpsLog`，运行时断言键集合恰为 `{ fn, code, errorClass }` 且 `code ∈ PublicOpsCode`。`opsLog` 不能自己判断是否处于公开上下文，所以"公开路径不得调用它"只靠品牌参数（公开构造器的 ctx 不带 `InternalCtx`）+ ESLint 静态保证，不靠运行时自觉 | `convex/lib/opsLog.ts`；15 §15.6 |
| E4 | 模型原文只存 `attempts.rawOutputRef`（internal 表，无任何 query 暴露）；解析失败只记 issue 的 `code` 与路径，路径中不属于 schema 已知字段的段替换为 `*` 并截断（review r15） | 10 |
| E5 | SDK 错误映射为错误码后丢弃原消息与错误体（码名归 10）；请求头 `Authorization: Bearer` 脱敏 | 10 |
| E6 | `returns` 校验错误可能回显被拦字段：只在测试期作为探测器（§7.18） | 16 |
| E7 | prod 部署对非 `ConvexError` 消息的遮蔽只作兜底，不作防线；E2E 只断言 `code`，不断言错误原文 | 15、16 |
| E8 | Next 侧 Sentry `dataCollection` 全部键显式 `false`（techstack D30）；若接 Convex log streams（D31），`function_execution.error_message` 纳入金丝雀扫描 | 15 |

```ts
// convex/lib/opsLog.ts —— convex/ 下唯一允许 console 的文件。字段白名单 SafeLogFields / SafeValue 只在 15 §15.6.2 定义一处，
// 本章不再另列（privacy-10：07 / 15 / 08 三份白名单合并）；这里只固定两个入口的签名与可达性约束。
declare const internalCtxBrand: unique symbol;
export type InternalCtx = { readonly [internalCtxBrand]: true };   // 只有 internal* / action 构造器注入；公开构造器的 ctx 没有它
export function opsLog(ctx: InternalCtx, code: OpsLogCode, fields: SafeLogFields): void;   // 可带 15 白名单内的数值（count / ms / tokens…）
export function publicOpsLog(code: PublicOpsCode, f: { fn: PublicFnName; errorClass?: ErrorClassName }): void;
// PublicOpsCode：闭集，成员以 15 §15.6.2 为唯一定义（'unhandled'、'approval.not_executable'、'approval.self_conflict'、'view.vacant_slot'、
// 'request.effect_noop'、'request.answer_converged'、'shared_fact.audience_violation'、'invariant.open_request_at_execution'、'invariant.guard_bypassed'、
// 'invariant.room_already_executed'、'invariant.duplicate_execution'、'invariant.approval_seq_duplicate'、'invariant.execution_plan'、'rule_integrity'）；
// 输出行恰为 { fn, code, errorClass }，不收数值、不收自由字符串——它会随 logLines 进入调用者浏览器（§7.19.1）。
```

**禁止进入日志**：prompt、system 文本、`AgentContextData`、简报任何字段、notes、rationale、模型原文、目录 title、预算数字、`displayName`、`tokenIdentifier`、邮箱、邀请 token、Zod issue 的 `message` / `input` / `keys`、第三方异常的 `message` / `stack` / 错误体。追溯性不靠日志：谁在何时用了多少 token、哪个回合产出哪个提案由 `attempts` 与 `events` 的结构化字段承担。

## 7.20 威胁清单（威胁 → 防线 → 测试）

测试编号见 16（L0 纯函数、L1 convex-test、L2 真实部署、L3 端到端、S 静态）。

| # | 威胁与具体路径 | 防线（落点） | 测试 |
| --- | --- | --- | --- |
| T-01 | 越权直读私密表：猜 `briefs` / `humanRequests` / `attempts` id | 无接受私密 id 的公开函数；按 `viewer.role` 走索引；非成员 `null` / `auth.not_member`（§7.5.3） | TC-AUTH-02/03 |
| T-02 | 整份状态发到浏览器再隐藏（Role A RA-B03） | DTO 逐字段 + XP 投影 + 禁止展开 + `returns` 探测（§7.18） | TC-PRIV-01/10 |
| T-03 | 公共文本、事件里出现私密数字 | 模板三层证明；payload 白名单（§7.16–7.17） | TC-PRIV-02/03/11 |
| T-04 | 他方私密值进入本方代理上下文 | `loadTurnContext` 单一入口，只读 `viewFor` + sharedFacts（§7.14） | TC-PRIV-04/05 |
| T-05 | 代理把本方私密值写进跨方内容（主路径） | 输出只有 optionKey / 枚举；`rationale` / `reasonKey` 只给本方 | TC-PRIV-07/20 |
| T-06 | 跨代理注入：目录 title、显示名、房间标题、审批备注 | 只有 title 进入他方上下文且定界转义；中途 system 只由代码生成 | TC-INJ-01/06/08 |
| T-07 | 粘贴文本注入 | v1 无 LLM 抽取（D26）；notes 只进本方 principal 块 | TC-INJ-02 |
| T-08 | 日志与错误泄露 | §7.19 | TC-PRIV-06/16、TC-OPS-01 |
| T-09 | provider 推断余量：fit 二分、改价触发预检（零模型调用、2.3 小时到 $1，privacy-01）、反复请求重谈；反向 finance 用 `setCap` 探测 customer 必需项 | DX 上界、⑤⑥ 节流、`price_writes` / 硬字段子桶 / `run_starts` 每房间每 24 小时总量桶、历史不重算（§7.13） | TC-PRIV-08、TC-AUTH-12、TC-AUTH-13、TC-RUN-18 |
| T-10 | 角色冒充、一人多席凑齐审批 | 邀请绑定角色；accept 守卫；`evaluateApprovalSet` 要求 userId 两两不同 | TC-AUTH-04/05、TC-VER-12 |
| T-11 | creator 越权替人批准、改他人简报 | creator 能力清单（§7.5.5） | TC-AUTH-08 |
| T-12 | 旧审批匹配新内容 / 旧页面点批准 | `expectedConstraintsVersion` + `expectedTermsKey`；只追加；当前成员规则 | TC-VER-01/02/04 |
| T-13 | 重复执行（双击、并发最后一票、重发） | `executionKey = exec:${proposalId}` + 同事务执行 | TC-EXE-01/02/03 |
| T-14 | 模型发明价格、条目、日期 | `optionKey` 只在快照解析；服务端物化 `terms` | TC-INJ-04、TC-RULE-* |
| T-15 | 过期结果覆盖新状态 | 守卫 G0–G3 + 必 `runs.reconcile` | TC-RUN-01…04 |
| T-16 | internal 能力外露（seed / reset / `executeIfComplete`） | internal + `assertTier` + 公开函数快照 | TC-AUTH-06、TC-OPS-03 |
| T-17 | 成本滥用 | 四层上限 + `opsFlags.draining`（D17） | TC-RUN-14/15、TC-AUTH-12 |
| T-18 | 邀请 token 泄露或暴力尝试 | 256 位、只存哈希、fragment、`no-referrer`、72h、一次性 | TC-AUTH-04 |
| T-19 | 模拟数据被当真 | `provenance` 数据级 + `SimulatedBadge` | TC-OPS-02 |
| T-20 | 配置失效开放 | `auth.config.ts` 缺变量抛错；proxy 503 / `/setup`；identity 为 null 一律拒绝；Route Handler 自己 401 | TC-OPS-04、TC-AUTH-11 |
| T-21 | 历史篡改（patch / delete 只追加表） | 只追加表静态扫描 | TC-VER-06 |
| T-22 | 约束变更与最后一票竞态 | 两者都读写 room 文档，OCC 串行 + `expected*` | TC-VER-07（L2） |
| T-23 | 模型提供方处理私密上下文 | 只发本角色视图；隐私说明如实（残余 R-5） | 文档评审 |
| T-24 | 被注入或失误的代理给出误导建议 | 界面先展示代码检查与确切条款，代理建议在虚线框 "Suggestion only, never counted as approval"；批准只依赖代码 | TC-INJ-03 |
| T-25 | 导出公式注入 | v1 无 CSV；将来导出时 `= + - @ \t \r` 开头加 `'` | — |
| T-26 | `logLines` / `errorMessage` 下发调用者浏览器 | E1–E3（公开路径只有 `publicOpsLog`） | TC-PRIV-16、E2E-07 |
| T-27 | 语义合法日期编码秘密（LP-2） | 日期窗口、交付日由代码物化 | TC-PRIV-15 |
| T-28 | 目录标题未定界（LP-1） | 正则 + `wrapUntrusted` + `encodeBlock` | TC-INJ-01 |
| T-29 | shared fact 搬运他方秘密（LP-3） | 写入闸门、无 value 参数 | TC-PRIV-15 |
| T-30 | 金丝雀与公开值重合，测试失明（LP-4） | `lintCanaries` | TC-PRIV-17 |
| T-31 | 任一角色的 clarify 成为他方私密约束的预言机（LP-5） | 任何角色都无 `option_fits_constraints`（L0 遍历全部 schema 变体） | TC-PRIV-20 |
| T-32 | 事后披露泄露历史值（LP-7） | 按值所属版本判定 | TC-PRIV-14 |
| T-33 | 派生字段泄露（deferred 类，评委 16 条） | D11 删除 + 污点规则 + 披露配置扫描 | TC-PRIV-05/10 |
| T-34 | 人工请求选项由系统视角生成（评委 16 条） | `buildHumanRequests(toRole, viewFor(toRole))` + `assertOptionsProjected` | TC-PRIV-12 |
| T-35 | SSR / 预取 / WebSocket 分块绕过扫描 | 投影在 Convex 内；E2E 按 `transitionId` 拼接 `TransitionChunk` 后扫描，另扫 SSR HTML 与 RSC 负载（review r07） | TC-PRIV-18 |
| T-36 | 被调度函数冒用或缺失身份 | 无身份；`actorUserId` 显式；角色取自记录（§7.5.4） | TC-AUTH-10 |
| T-37 | `returns` 校验失败回显被拦字段 | 只作测试期探测器 | TC-PRIV-06 |
| T-38 | provider 从"他人简报版本 +1 / `brief_confirmed` / `human_request_answered` / `disclosure_changed` 与 cv +1 同一提交"推出是谁改了约束及方向（privacy-02） | 版本号只给买方；同一提交的这些条目对 provider 并入无作者的 "Constraints changed (vN)"（DX-5 / DX-7、§7.17） | TC-PRIV-21 |
| T-39 | 未登记的派生信道：counter 转发结局、`choose_candidate` 复核结局、被转发候选的隐含 fit（privacy-05） | 解密清单 DX-11…DX-13 + 频率上界；`DECLASSIFIED` 键集合与清单逐项相等 | TC-PRIV-05 元断言 |
| T-40 | 公开路径上的必需日志经 `logLines` 下发浏览器（privacy-10） | `publicOpsLog` 闭集三键；`opsLog` 需 `InternalCtx`，公开可达模块禁止 import | TC-PRIV-16、S6 |
