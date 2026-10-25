# 06 · 确定性规则引擎与场景插件接口（part7：候选规则、buildHumanRequests 与 relaxations）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§10（续）、§11。

### 10.1 enumerateCandidates 的规则与理由

1. **按角色视图**：输入是 `viewFor(role)`；provider 视图没有预算字段，候选不按预算过滤（D10、C26）；评估方用各自视图。全局 `feasibility` 模式只给 `startRunTx` 预检与 `relaxations` 使用（`choose_candidate` 用 customer 视图下的 feasibility 枚举），结果不进入任何代理上下文；feasibility 模式**没有** `limit`，返回视图下全部可行候选，调用方不传上限。
2. **稳定排序**：呈现顺序按 `candidateKey` 码点序（首位锚点除外），不按任何角色偏好；超过 `limit`（12）时按公开数据 `(amountCents, candidateKey)` 选入——价格是公开目录数据，选择规则不读任何私密字段，故截断不泄露。
3. **锚点**：不是参数，由引擎按 `viewer === proposerRole ∧ turnKind === 'propose' ∧ roundNo === 1` 派生（只在第 1 轮 proposer 回合启用，调用方无法覆盖）；快照内的候选都已通过视图内可评估的检查（含已披露的必需项），所以"最便宜候选"即"视图下金额最低的含必需项候选"，引擎无需认识必需项。
4. **排除与必含**：`exclude = excludedCandidateKeys(run)`，派生不存（03 §3.5）：本 run 内已提出过的键（含被阻断、未插提案的 `turns.outcome.blockedCandidateKey`）∪ 被人拒绝提案的键 ∪ 本 run 内 `choose_candidate` 复核失败的键；customer 评估快照另排除 base 提案的键（05 §5.7.2）。**不**按沿用提案在新 cv 下的结论剔除（那是 D12 ① 禁止向 provider 暴露的实时重算结论）。`mustInclude` 是上一轮被转发的 customer counter 键（只要它在 provider 视图下通过）；该键可能已经由 counter 回合的 `outcome.candidateKey` 计入"已提出"子集（03 §3.5 由 turns 的 outcome 现算），而枚举先剔除 `exclude` 再找 `mustInclude`，所以 provider 回合的 `exclude` 必须先去掉这一个键。被人拒绝与复核失败的剔除不受影响：customer 评估快照本就剔除这两类键，customer 无法 counter 它们，被转发的键不可能同时属于它们。
5. **不崩溃**：插件 `candidateSpace` 遇到视图内必需键不在已确认 item 中时返回 `{ drafts: [], emptyReasons: ['item.required_missing'] }`；`materialize` 只接收由当前目录行生成的组合，永不处理旧提案。
6. **有界**：在架 item ≤ 12、modifier ≤ 2，组合数 ≤ 4,096 个子集 × (1 + modifier 数) ≤ 12,288；单次枚举的 isolate CPU 时间待验证（rules-engine-review C8 本机约 42 ms / 8k 次评估）。
7. **完备性**：feasibility 模式下，`candidateSpace` 生成的组合中凡全局可行者都在结果中；插件只允许省略被同一子集基础变体支配的 modifier 变体（14 S-D3：基础变体已满足截止日时不生成加急），暴力穷举对照（T06-P8）按同一生成规则比较；snapshot 模式下凡在视图内可行的组合，要么在快照中，要么因截断被排除且 `ok.length > limit`。

## 11. buildHumanRequests 与 relaxations

### 11.1 类型

```ts
// core/engine/humanRequests.ts —— 与 canon D15 的 humanRequests 行同形
export type Effect =                                             // 判别字段为 `type`，与 03 §3.9 requestEffectV / 05 / 12 的存储与线格式一致
  | { type: 'raise_cap'; amountCents: Cents }                    // finance：新上限（绝对值）
  | { type: 'drop_items'; itemKeys: ItemKey[] }                  // customer：从必需项中移除这些键
  | { type: 'extend_deadline'; date: IsoDate }                   // customer：新截止日
  | { type: 'choose_candidate'; candidateKey: string }           // customer：候选来自其自身视图
  | { type: 'disclose'; field: FieldKey; toRoles: RoleKey[] }    // 被问方披露自己的字段
  | { type: 'pass_to_next'; toRole: RoleKey }                    // infeasible 收件人：转交给 relaxationOrder 中的下一角色（canon D15）
  | { type: 'retry_turn' } | { type: 'keep_as_is' } | { type: 'end_run' }
  | { type: 'blocked' };                                         // 需要他方未披露值才成立的选项的持久化标记（canon D11 的 blocked）：不可回答、不带数字（03 §3.9）
export type RequestOption = {
  optionKey: string;                                             // 不透明 'A'..'E'（03 §3.9 / 05 §5.11.1，与模型的 'O1'..'On' 区分），绝不含数字业务值（fixtures-walkthrough r05）
  templateKey: TemplateKey;                                      // 按受众渲染（14 §8）
  effect: Effect;
  shown: { itemKeys?: ItemKey[]; modifiers?: ItemKey[]; amountCents?: Cents; deliveryDate?: IsoDate; deltaCents?: Cents };
                                                                 // 只放可由 viewFor(toRole) 推出的值（模板参数）；与 blocked 标记用途不同、两者并存，blocked 项的 shown 为空
};
export type HumanRequestKind = 'infeasible' | 'rounds_exhausted' | 'agent_escalated' | 'clarify' | 'agent_failed';
export type HumanRequestDraft = { kind: HumanRequestKind; toRole: RoleKey; options: RequestOption[] };
export function buildHumanRequests<RI>(p: ScenarioPlugin<RI>, x: {
  kind: HumanRequestKind; full: View<RI>; viewOf: (r: RoleKey) => View<RI>;   // viewOf = r => viewFor(p, full, shared, r) 的薄包装（§5.2）
  toRole?: RoleKey;                                  // 仅 pass_to_next 转交：R21 传入 effect.toRole，收件人固定为它，选项只由它的自身视图生成（字段名按 canon §1.2 的收件人字段）
  run: { excludedCandidateKeys: readonly string[];   // provider 快照用的完整集合：已提出（含被阻断）∪ 被拒 ∪ 复核失败
         chooseExcludedKeys: readonly string[];      // 人工选择与放松用：已阻断 ∪ 被拒 ∪ 复核失败（不含已提出而未被拒者，05 §5.10 / §5.11.2）
         currentCandidateKey?: string;               // 本 run 当前 active、未被拒且 customer 视图下仍通过的提案候选：choose_candidate 排第一
         passedToNext: readonly RoleKey[];           // 本 run 已作过转交的收件人（每个 (from, to) 至多一次，04 R21）；由本 run 已 answered 的 pass_to_next 请求派生，不另存 runs 字段
         roundsExtended: boolean; failedRole?: RoleKey;
         exhaustedCause?: 'rounds' | 'no_candidates' | 'call_limit' | 'spend_limit';   // 仅 rounds_exhausted：questionKey = request.rounds_exhausted.{cause}（05 §5.8.5、04 §4.8.3）
         escalation?: { kind: 'infeasible' | 'needs_tradeoff' | 'cannot_deliver'; toRole: RoleKey } };   // cannot_deliver：provider 在 propose 回合 reject(cannot_deliver)，不经策略检查，收件人为 provider 本人（05 §5.10）
  shared: SharedLedger;                              // 回退项"尚未向放松角色披露"按有效 sharedFacts 账本判定（§5.1 第 2 步、07 §7.8.3），不读 briefs.disclosures
}): HumanRequestDraft;                                           // 恰好一个
```

### 11.2 选择收件人与生成选项

| kind | 触发 | 收件人 | 选项 |
| --- | --- | --- | --- |
| `infeasible` | `startRunTx` 预检全局可行集为空；模型 `escalate(infeasible)` 经 05 §5.10 接受（先试模型给的 `toRole`，须满足同一条件）；`pass_to_next` 转交（收件人固定为入参 `x.toRole`，不走右列的选择算法）；R20 重跑预检仍无解 | 按 `relaxationOrder` 逐项：角色 R 的自身视图可行集为空（R 自己看得见冲突）且 `p.relaxations(R, viewOf(R))` 非空 → R；都不满足 → 回退到 `relaxationOrder[0]` 的角色 | R 的全部放松选项（条目对应的主效果在前）；回退时为该角色尚未向其他放松角色披露的硬字段各一个 `disclose { field, toRoles }`；R 不是 `relaxationOrder` 末位且 `run.passedToNext` 不含 R 时，再加 `pass_to_next { toRole: relaxationOrder 中 R 的下一个角色 }`（只取决于位置，不读任何视图值，canon D15）；末尾 `end_run` |
| `rounds_exhausted` | `roundNo === maxRounds` 仍无合格提案（D08，原因 `rounds`）；provider 快照剔除后为空或 provider 本 run 已提 4 次（`no_candidates`：provider 的提案上限不记作 `call_limit`）；run 的 attempt / 美元上限用尽（`call_limit` / `spend_limit` 只用于这两个 run 上限）。原因经 `run.exhaustedCause` 传入并写进 `questionKey`（05 §5.8.5、04 R6 / U5 / §4.8.3） | `relaxationOrder[0]` 的角色（customer） | ≤ 3 个 `choose_candidate`：`run.currentCandidateKey` 若有则排第一，其余由引擎在 customer 视图下 feasibility 枚举（`enumerateCandidates`；插件不自行枚举 `choose_candidate`）、排除 `run.chooseExcludedKeys`（刻意不用完整的 `excludedCandidateKeys`：已提出而未被拒、仍通过的候选正是人想选的，05 §5.11.2）、只由插件 `rankForOwner` 排序；`keep_as_is`（资格是**一个**谓词：原因为 `rounds` ∧ `roundsExtended` 为假 ∧ provider 视图剔除 `run.excludedCandidateKeys` 后仍有候选 ∧ 本 run provider 提案未满 4 次；`buildHumanRequests` 提供选项与 `humanRequests.answer` 复核（原因从请求的 `questionKey` 读回）调用同一谓词，04 §4.8.3）；`end_run`。`questionKey = request.rounds_exhausted.{exhaustedCause}`，不另设调用方标志 |
| `agent_escalated` | 模型 `escalate(needs_tradeoff)` 经 05 §5.10 接受；provider 在 propose 回合 `reject(cannot_deliver)`（05 §5.10，不经策略检查）。`escalate(infeasible)` 被接受时开的是上面的 `infeasible` 请求，不是本 kind（05 §5.11.2） | `needs_tradeoff` → customer（`ctx.kind = 'agent_escalated'`）；`cannot_deliver` → provider 本人 | customer：与 `rounds_exhausted` 相同的 `choose_candidate` ×≤3、`keep_as_is`（= 下一轮，轮次已尽等价 `end_run`，canon D15）、`end_run`；provider：`keep_as_is`（provider 同轮新开回合）、`end_run` |
| `agent_failed` | attempt 重试耗尽或不可重试（D15）；**不含** run 上限触发（那是 `rounds_exhausted`） | 失败回合的角色 | `retry_turn`、`end_run` |
| `clarify` | 代理 clarify 无法由已披露事实代答（05） | clarify 的 `toRole` | 由 05 按 `topicKey` 生成（`disclose { field, toRoles: [发问角色] }`、`keep_as_is`、`end_run`） |

全部 kind 都满足：恰好一个请求；选项非空且总含 `end_run`（或 `retry_turn` + `end_run`）；没有任何选项映射到 `rooms.close`（D15）；选项键不透明。

回退分支的意义：每一方单看自己都可行、合起来不可行（例如 customer 未向 finance 披露截止日，而便宜候选都晚于截止日）时，没有人能凭自己的视图算出"放松多少"。此时向 customer 请求披露（`disclose { field: 'deadline', toRoles: ['finance'] }`），回答后写入披露（D05：披露开关不递增），同事务重跑与 `startRunTx` 相同的预检（04 R20），finance 的视图就能看见冲突并收到带具体金额的 `raise_cap` 请求。customer 因此只多知道"合起来不可行"这 1 bit。

### 11.3 relaxations 的通用约束（scope_change 的具体算法在 14 §6.4）

1. 只读传入的 `View`：`raise_cap` 的金额 = 该视图里的 `committedCents + 候选金额`，只有预算拥有者的视图能算出；`drop_items` / `extend_deadline` 只用 customer 视图（customer 默认看不到 committed，故这些选项里不出现任何预算推导的数字，inputs/07 第 53 条）。
2. 每种效果 ≤ 3 个选项，按"放松幅度最小"升序，同幅度按 `candidateKey` 码点序；数值去重。
3. 每个放松选项必须能让放松后的**该视图**可行集非空（单步放松，组合放松留给 17）。
4. `choose_candidate` 的候选由引擎在 customer 视图下枚举（不是 `relaxations` 的输出），生成时**不**用全局输入预筛（预筛会把 finance 的余量泄露给 customer）；回答时 `humanRequests.answer` 用全局输入复核，不通过则以同一 kind 重新生成请求（04 R19 自环），该键随之进入 `excludedCandidateKeys`——每次失败泄露 ≤ 1 bit，受 D12 ⑥ 的回答节流约束。
5. `pass_to_next` 不是 relaxation：它由 `buildHumanRequests` 按 `relaxationOrder` 中收件人的**位置**追加（收件人不是末位、本 run 未转交过），不读任何视图值，所以选项是否出现不泄露下一角色的约束是否卡住；`RelaxCtx.excludedCandidateKeys` 传入的是 `run.chooseExcludedKeys`。
6. `assertOptionsProjected(toRole, options)`（签名与 03 §3.9、05 §5.11.1 一致）：写入 `humanRequests` 前，用 `viewFor(toRole)` 重算一遍选项并深比较；再静态检查 `shown` 中每个金额 / 日期 / 键都可由该视图推出、`blocked` 项不带任何数字。不一致 → `internal`，不写请求。

### 11.4 回答时的规则校验（状态迁移归 04，函数归 12）

| 效果 | 规则侧校验 | 结果 |
| --- | --- | --- |
| `raise_cap` | `validateCapChange(amountCents, committed)`；与现值相等 → 无变化 | 新 finance 简报版本 → `constraints.bump`（D06 不动点） |
| `drop_items` | `validateBriefFields`（剩余必需项仍是合法键列表且**必须非空**，否则 `item.required_missing`，12 §12.14；生成选项时 14 §6.4 至少保留一个必需项，生成期与回答期调用同一 `validateBriefFields`） | 新 customer 简报版本 → bump |
| `extend_deadline` | 日期窗口 `localDate ≤ date ≤ localDate + 365` | 新 customer 简报版本 → bump |
| `choose_candidate` | 显示的交付日 `≥ addDays(localDate, effectiveLeadDays)`，否则 `date.before_lead_time`；插入当天物化后 `checkProposal(全局)` 通过 | 插入 `origin: 'human_choice'` 提案，run → `pending_approval`；否则重新生成请求 |
| `disclose` | 字段属于回答者且在 `disclosableTo` 内，否则 `disclosure.blocked` | 写披露（不 bump）→ `clarify` 请求：发问方同轮新回合；`infeasible` 回退请求：同事务重跑预检 → 新请求或进入协商（04 R14 / R20） |
| `pass_to_next` | `toRole` 等于 `relaxationOrder` 中收件人的下一角色，且 `run.passedToNext` 不含收件人 | 旧请求 `answered` → 以 `toRole` 的自身视图调用 `buildHumanRequests(kind: 'infeasible')` → 恰好一个新请求；不 bump、不建回合（04 R21） |
| `retry_turn` / `keep_as_is` / `end_run` | `rounds_exhausted` 的 `keep_as_is`：用提供时的同一资格谓词复核（§11.2），不成立等价 `end_run` | 04 / 10 |

请求在任何 bump 时被置为 `superseded`（D06），因此回答到达时规则输入不可能已经越过请求生成时的约束版本；`humanRequests.answer` 仍按当前输入重做上表校验（纵深防御）。
