# 反驳评审：idempotent-execution（part 2/2）

> 接 idempotent-execution-review.md §2。

### r05（medium）race.sh 大概率测不到并发；可以直接测公共入口
- 每次 `npx convex run` 都要冷启动一个 Node 进程（数百毫秒到秒级），而 mutation 只需毫秒。两个后台进程在后端几乎不会重叠。期望值 1/1/3 在串行执行下同样成立，所以"30 次通过"不能证明 V1/V2。C5 的输出被丢进 /dev/null，"lastError"也就无从判定。
- **建议**：
  1. 在一个进程内并发发起请求：用 internal action 对多个 `ctx.runMutation` 做 Promise.all（是否真并行待验证），或者用 Node 脚本加 ConvexClient。
  2. 判据里必须包含"确实发生过冲突"的证据：同时段 `npx convex insights` 的 occRetried > 0，或者日志中出现重试；没有这一条，结论只能写"未观察到并发"。
  3. 改用 `npx convex run approvals:decide '<json>' --identity '{"tokenIdentifier":"…"}'`（已核实的 CLI 选项），走真实的鉴权路径，可以删掉 `testing:decideAs`。internal 函数本来就只有持 admin key 才能调用，`ENABLE_TEST_FUNCTIONS` 只能算附加防护。

### r06（low）`CONSTRAINTS_CHANGED` 的文案与 D11 相反
- 现在写的是"needs a new proposal / 否（等新提案）"。但按 D11 和 C15，正确做法是刷新后对同一提案重新批准。前端会因此误导用户去等新提案。
- **建议**：文案改为"约束已变化，请查看更新后的评估后重新决定"，并标为"刷新后可重试"。

### r07（low）文档内部不一致
- D6 写的返回是 `{kind:'already_executed'}`，代码里是 `executed{alreadyExecuted:true}`。
- §2.1 还写着 `proposals.constraintsVersion`，应为 `createdAtConstraintsVersion`。
- part1 的索引名 `by_proposal/by_operation/by_room` 与 schema 里的 `by_proposalId/…` 不一致。
- 金额单位混用：§2.5 用美分；§2.6、C5、C18、§4.4 用美元（4950、4800、5000/4000/+900）。
- D1 说退路可以"守卫原样复用"，但守卫写在 `decideCore` 里，`executeIfComplete` 并不包含守卫。
- **建议**：统一以上写法；把守卫抽成 `assertDecideGuards(ctx, …)`，两个入口共用。

### r08（low）代码层面的平台细节
- `fail(extra: Record<string, unknown>)` 无法通过类型检查：`ConvexError<TData extends Value>`，而 `unknown` 不属于 `Value`（`values/value.ts:66-75`）。改成 `Record<string, Value>`。
- `getRequestMetadata()` 返回 Promise（`meta.ts:200`），需要 await。
- 成员查询用 `.unique()`，遇到重复行会抛普通 Error。结果是 C14 描述的"不算齐"根本走不到，客户端只收到一个不透明的错误。改为 `take(2)`，多于一行时 `fail("INVARIANT_VIOLATION")`。
- 事件 payload 直接记录了客户端传来的 `reasonKey`，approve/withdraw 时也会写进去；审批行却会丢掉它。两处应统一使用过滤后的值。

### r09（low）未使用的索引，以及缺失的索引
- `by_proposalId_and_userId_and_seq` 在文中被称为"覆盖索引"，但 Convex 索引不提供唯一性，decide 也从不查询它，只是白白增加写入开销。要么删掉，要么像 r03 那样用起来。
- versioned-approvals 的 bumpConstraints 查询 `by_proposalId_and_constraintsVersion`，本专题的 schema 里没有这个索引。需要在 03 中统一。

### r10（low）withdraw 语义与另一专题分歧，相关反例和测试缺失
- 本专题在没有先前 approve 时也会插入 withdraw 行；versioned-approvals 在这种情况下返回 `NOTHING_TO_WITHDRAW`。
- withdraw 不写 run，所以"withdraw 与最后一票并发"是否安全，**完全取决于**区间读冲突。反例表缺这一行（应补为 C24），race.sh 也缺这个场景。
- 模型测试用 `.catch(() => undefined)` 吞掉了所有错误，包括 `INVARIANT_VIOLATION` 和普通 Error；而且只检查安全性，不检查活性。
- **建议**：withdraw 采用 `NOTHING_TO_WITHDRAW`；断言每个操作只出现预期的错误码；增加活性不变量"当前 cv 上必需的 approve 都已齐 ⇒ 已执行"；操作集补上 withdraw、成员替换、合规 bump 后 reject。

## 3. 过度设计检查
- `executions` 锚点表、按 operationId 查重后 fail closed、`checkExecutionInvariants`：成本低，审计价值明确，保留。
- `ENABLE_TEST_FUNCTIONS` 加上 `testing:decideAs`：可以用 `--identity` 替代，见 r05。
- `by_proposalId_and_userId_and_seq`：无用，见 r09。
- 第 9 步"unchanged 也做判定"：一次有界读取，换来收敛性，保留。
