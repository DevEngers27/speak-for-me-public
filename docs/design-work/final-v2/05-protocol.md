# 05 · 协商协议（part1：目标、决定总表、三层消息、动作集）

> 分片（按顺序读）：
> - `05-protocol.md`（本文件）：§5.0 目标与范围、§5.1 决定总表 P01–P16、§5.2 信封 / 模型输出 / 解析结果三层、§5.3 动作集与 `allowedActions`
> - `05-protocol-part2.md`：§5.4 `TurnSpec` 与输出 schema（Zod + 严格 JSON Schema 同源）、§5.5 解码层与 Zod 层各管什么
> - `05-protocol-part3.md`：§5.6 服务端校验流水线与 `validateMoveSemantics`、§5.7 候选快照与 `optionKey`
> - `05-protocol-part4.md`：§5.8 回合与轮次（串行时序、`resolveRound`、短路规则、上限、轮次用尽）
> - `05-protocol-part5.md`：§5.9 clarify 话题表、§5.10 escalate 策略检查、§5.11 人工请求的生成（五种 kind）与选项效果、§5.12 跨角色反馈（按受众）
> - `05-protocol-part6.md`：§5.13 提示词与上下文分块（`<untrusted_data>`、中途 `role:'system'`）、§5.14 stub / scripted 驱动的协议侧规则、§5.15 走查（$4,800 / $4,700 / 边界）
> - `05-protocol-part7.md`：§5.16 反例与边界、§5.17 不变量、§5.18 测试清单、§5.19 开放问题与待验证、§5.20 与 canon 的对照
>
> 底稿：`candidates2/agentquality/05-protocol-part1..2.md`（TurnSpec 同源生成 schema 与 Zod、resolveRound 优先级表、话题化 clarify）、`candidates/security/05-protocol*.md`（模型与代码分工、扁平 enum + `NONE` 哨兵退路、按目标视图生成请求选项）。吸收：`deepdives/negotiation-protocol*.md`（D1–D10、§3.3 语义校验、§3.7 请求结构、§3.8 提示块）及其反驳 r01–r14 的全部修正、`spikes/README.md` §0.1/§2/§5/§7。命名与关键决定以 `00-canon*.md` 为准；底稿与 canon 冲突处已改写，§5.20 逐条列出。

## 5.0 目标与范围

**目标**：把"代理只建议、代码负责数字与流程"（任务书核心 2、4）落到一份可以直接实现的协议：

1. 一个回合里哪些字段由服务端注入、哪些由模型产出，两者永不混用（模型永远不提供身份、版本快照、ID、金额、日期）。
2. 模型输出的根形状、六个动作、每个动作的载荷，以及它们在解码层和事后校验层分别被谁约束。
3. 每个角色在每种回合里能做什么；动作集随候选快照与 run 状态裁剪。
4. 回合与轮次的推进规则：谁先手、谁评估、何时短路、何时进入 `pending_approval` / `needs_input`。
5. clarify、escalate 与"无解 / 轮次用尽 / 回合失败"如何变成**恰好一个**发给具体的人的结构化请求。
6. 他方信息以什么形式进入一个代理的上下文；他方写的唯一文本（目录标题）如何定界。

**范围外**（只给接口）：表字段与索引（03）、run / turn / proposal / humanRequest 的完整迁移表（04）、`checkProposal` / `enumerateCandidates` / `buildHumanRequests` 的规则实现（06、14）、字段 × 角色矩阵与代理上下文白名单（07）、审批与执行（08）、约束递增与 `react()`（09）、调度、看门狗、重试、模型调用细节（10）。

## 5.1 决定总表

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| P01 | 回合信封（runId、turnSeq、roundNo、kind、role、`constraintsVersion` 快照、`baseProposalId/Version`、`candidateSnapshot`）只由创建回合的 mutation 写入 `turns` 行；`turns.complete` 的守卫只读 turn 行与当前 room / run，从不读模型输出里的任何东西判断身份或版本 | 不存在的字段无法被伪造；F05.1 复现过"信封字段进模型 schema → 模型编造版本 → 过期检查失效" | 让模型回显信封再比对（只增加 invalid_output 概率） |
| P02 | 模型输出根固定为 `{ turn: AgentModelOutput }`，`turn` 是按 `action` 判别的联合；全部字段 required，可空用 `nullable`；全部 `strictObject`；无 `z.record`、无 `.default()` | spike 实测：判别联合作根时 `jsonSchemaOutputFormat` 抛错、`zodOutputFormat` 生成无 type 的根；`z.record` 被改写成只能输出 `{}` | 判别联合作根；扁平对象作主形态（降为退路，§5.4.5） |
| P03 | 六个动作 `propose / counter / clarify / recommend_accept / reject / escalate`（canon §1.4）；`request_tradeoff` 并入 `escalate.kind = 'needs_tradeoff'` | spike §0.1 统一口径；"不可行"与"需要取舍"是同一种"建议打扰人"，是否真的打扰由代码判定 | research 的 `declare_infeasible` + `request_human_tradeoff` 两个动作 |
| P04 | `propose / counter` 只输出位置标签 `optionKey`（`O1..On`，n ≤ 12），只在本回合 `turn.candidateSnapshot` 内解析；金额、日期、条目、修饰项由服务端物化 | "模型不得发明金额"在结构上成立；schema 只随 n 变化，跨房间可共享与预热 | 模型自填 `itemKeys + deliveryDate`；用 `candidateKey` 字符串作输出 |
| P05 | 模型只能引用它见过的四类值：`optionKey`、提案 `version`（小整数）、场景声明的 `topicKey` / `reasonKey`、`toRole`。`counter.baseProposalVersion`、`recommend_accept.proposalVersion`、`reject.proposalVersion` 必须等于信封里的 `baseProposalVersion` | 引用而非 ID：服务端把版本号映射回 `Id<"proposals">`；不一致即 `output.unknown_reference` | 引用 `baseProposalId`（模型无法见到真实 ID，只会编造） |
| P06 | `rationale` 是唯一自由文本，只给本方（本方视图与本方代理之后的上下文），≤ 1,200 码点；他方代理上下文、事件、公共模板里没有任何代理写的文字 | 跨代理注入的唯一通道是他方自由文本；不让它存在比"定界 + 声明不可信"更强 | `publicRationale` / `publicSummary`（spike 实测泄露率 35–50%） |
| P07 | 角色 × 回合矩阵固定：provider 只有 propose 回合；customer、finance 只有 evaluate 回合；**finance 不能 counter；provider 没有 recommend_accept** | 范围取舍是 customer 的判断；provider "接受 counter" 就是在下一轮 propose 同一候选，规则统一无特例 | 三方都能 counter（并行 counter 需要合并规则） |
| P08 | `allowedActions(role, kind, ctx)` 随快照与 run 状态裁剪：快照无替代候选去 `counter`；本 run 已用过 clarify / escalate 去对应动作；propose / counter 次数达上限去对应动作 | 让"必然失败的输出"在解码层就不可能出现，而不是耗一次重试（np-review r09） | 动作集只按 (role, kind) 固定 |
| P09 | 评估回合**串行**（customer → finance），run 任意时刻至多一个在途 attempt；`resolveRound` 是纯函数；遇到必须打扰人的结果立即短路 | canon D08；并行评估在 5 份候选中都构造出了屏障死锁 | 并行评估 + `pendingEvaluations` 计数器或屏障 |
| P10 | provider 选中的候选被 `checkProposal` 阻断时**不插入提案行、不消耗版本号**：`turns.outcome = { candidateKey, blockedCandidateKey }` 记录事实，该键进入本 run 的剔除集合，不花评估调用，provider 下一回合只得到 `fit: 'blocked'`（03 §3.8、04 §4.3.4、06 §9.2） | 被阻断的候选从未成为任何人可审批的对象，不应占用提案历史与 `currentProposalId`；版本号只给进入过评估的条款；历史由 `turns` 承担；D12 ① 每候选 ≤ 1 bit | 阻断的候选照常插入提案（会让 R2 / `rounds_exhausted` 拿一个从未被评估的提案去沿用或送审，且 03 的 `insertProposal` 先断言 `passesChecks`）；把 reasonCode 反馈给 provider |
| P11 | provider 的候选**不按预算过滤**、不按任何角色的偏好排序（按 `candidateKey` 稳定排序，第 1 轮首位固定为 provider 视图下金额最低的含必需项候选）；快照剔除 `excludedCandidateKeys(run)` = 本 run 已提出过的（含被阻断、未插提案的）∪ 被人拒绝的 ∪ `choose_candidate` 复核失败的 `candidateKey`（与 03 §3.4 / §3.8、06 §10.1、07 §7.14.2、14 S8 同一定义，派生不存）。**这比 canon D10 字面（只剔除已阻断）更严**，作为偏离登记在 §5.20 并已提交 canon 修订 | canon D10；按预算过滤会把余量夹进窄区间；排序泄露偏好；首发由代码给出抑制锚定；run 内 cv 不变，重提已提出或被拒的候选不可能得到新的规则结论，只多花调用、让人重复审批同一条款 | 按预算过滤；按 customer 偏好排序 |
| P12 | clarify 只选话题 `topicKey`，问题与选项由场景话题表生成；**任何角色**的话题表都没有 `option_fits_constraints`（canon D12 ③ 修订）；每角色每 run 至多 1 次 clarify（无论代码代答还是问人） | canon D12 ③；np-review r02：可代答的 fit 话题是零成本预算探测器 | 自由文本问题；无上限的代码代答 |
| P13 | `escalate` 不带选项；代码做策略检查后决定是否打扰人、打扰谁，选项由 `buildHumanRequests(toRole, viewFor(toRole))` 只用目标角色自己的视图生成 | 让模型决定"要不要打扰人"等于把权限交给模型（F05.6）；选项按目标视图防止披露越权（canon D11/D15） | 模型给出 `escalate.options` 并由服务端定价 |
| P14 | 进入 `needs_input` 必须恰好开一个 open 请求；五种 kind：`infeasible` / `rounds_exhausted` / `agent_escalated` / `clarify` / `agent_failed`；没有任何选项映射到 `rooms.close` | canon D15；"需要人取舍"是一等结局，不能有无人负责的等待 | 并行向多人发请求；`paused` 状态 |
| P15 | 他方信息只以结构化、按受众裁剪的形式进入上下文：轮次结果（不含他方 reasonKey、不含 rationale）、已披露的 shared facts、候选快照；目录标题包在 `<untrusted_data>` 内，整块 JSON 编码并把 `<` `>` `&` 转义为 `\u003c` `\u003e` `\u0026`；本回合指令走中途 `role:'system'` 消息 | 中途 system 消息是用户内容无法伪造的运营者通道，且不破坏已缓存前缀；同侧也不默认共享（canon C28） | 把回合指令拼进 user 文本；回放多轮 assistant 历史 |
| P16 | stub 与 live 共用 `AgentDriver.decide(input)` 接口与全部下游（同一 JSON 文本 → 同一解析、同一语义校验、同一 `turns.complete`）；replay / scripted 驱动只在测试中 | 确定性测试与演示降级不能走另一条代码路径；canon D26 | stub 直接产出结构化对象跳过解析 |

## 5.2 三层：信封 / 模型输出 / 解析结果

| 层 | 内容 | 谁写 | 存放 | 给模型看？ |
| --- | --- | --- | --- | --- |
| 信封 | `roomId`、`runId`、`turnSeq`、`roundNo`、`kind`（`propose` \| `evaluate`）、`role`、`constraintsVersion`（快照）、`baseProposalId`、`baseProposalVersion`、`candidateSnapshot[]`、`allowedActions[]`、`promptVersion` | 创建回合的 mutation（`runs.start`、`turns.complete` 推进、`humanRequests.answer` 恢复、`runs.reconcile`） | `turns` 行（03） | 部分：roundNo、maxRounds、base 提案版本号与条款、候选表，作为背景；**输出 schema 里没有回显字段** |
| 模型输出 | `{ turn: AgentModelOutput }`，唯一自由文本 `rationale` | 模型 / stub / scripted | 解析后的 move 存 `turns.result`（本方可见）；原文只进 `attempts.rawOutputRef`（内部表，无 query 暴露） | — |
| 解析结果 | 提案条款与 `termsKey`、fit 结论、clarify 的答案或请求、escalate 的请求、下一回合或 run 迁移 | `turns.complete` 内的纯函数（`materializeTerms`、`checkProposal`、`resolveRound`、`buildHumanRequests`） | `proposals`、`humanRequests`、`runs`、`events` | 以按受众裁剪的结构化形式进入后续回合（§5.12） |

Zod schema 与 Convex validator 分开定义：Zod 只在 Convex 边界（`convex/model/agents/outputSchema.ts`，与 10 §10.6 的文件布局一致；canon D21 引擎纯度规则禁止 `core/` 引入 zod）；存储镜像 `agentMoveV` 在 `convex/lib/validators.ts`（03 §3.4）。CI 加一条编译期断言：`Infer<typeof agentMoveV>` 与 `z.infer<ReturnType<typeof buildTurnZod>>['turn']` 双向可赋值。

## 5.3 动作集与 `allowedActions`

### 5.3.1 动作与载荷（canon §1.4，逐字采用）

| action | 载荷（全部 required） | 允许的回合 | 语义 | 产生的记录 |
| --- | --- | --- | --- | --- |
| `propose` | `optionKey`、`rationale` | provider · propose | 从本方候选中选一个作为新提案 | `proposals` 新版本（`origin: 'agent'`）、`turns.result` |
| `counter` | `optionKey`、`baseProposalVersion`、`rationale` | customer · evaluate | 不接受 base，建议另一个候选（本方隐含背书） | `turns.result`；可行则作为下一轮 provider 回合的反馈（§5.8.4）；**不直接成为提案** |
| `clarify` | `toRole`、`topicKey`、`rationale` | 任一回合 | 请求代码向信息所有者澄清一个话题 | 代码代答写入发问方下一回合的 `clarifyAnswers`；或开 `kind: 'clarify'` 请求（§5.9） |
| `recommend_accept` | `proposalVersion`、`rationale` | customer / finance · evaluate | 建议本方的人接受 base；**永不写 `approvals`** | `turns.result` |
| `reject` | `proposalVersion`、`reasonKey`、`rationale` | evaluate；provider · propose（`proposalVersion: null`，`reasonKey: 'cannot_deliver'`） | 不接受且不还价 | `turns.result`；provider 的 `cannot_deliver` 开 `agent_escalated` 请求（§5.11） |
| `escalate` | `kind: 'infeasible' \| 'needs_tradeoff'`、`toRole`、`rationale` | 任一回合 | 建议打扰人；是否打扰、打扰谁由代码判定 | 接受 → 一个请求；不接受 → 按 `reject(other)` 处理（§5.10） |

### 5.3.2 角色 × 回合矩阵（代码常量 `BASE_ACTIONS`）

| 角色 \ 回合 | propose | evaluate |
| --- | --- | --- |
| provider | `propose`、`clarify`、`reject`（仅 `cannot_deliver`）、`escalate` | — |
| customer | — | `recommend_accept`、`counter`、`reject`、`clarify`、`escalate` |
| finance | — | `recommend_accept`、`reject`、`clarify`、`escalate` |

### 5.3.3 裁剪（纯函数，`core/engine/protocol/allowedActions.ts`）

```ts
export type ActionCtx = {
  snapshotSize: number;          // candidateSnapshot.length（evaluate 快照不含 base 自身，§5.7）
  clarifyUsedInRun: boolean;     // 本角色本 run 是否已 clarify（代答或问人都算）
  escalateUsedInRun: boolean;    // 本角色本 run 是否已 escalate
  proposeCountInRun: number;     // provider 本 run 已 propose 次数（含被阻断的）
  counterCountInRun: number;     // customer 本 run 已 counter 次数
  providerRejectLocked: boolean; // provider 的 cannot_deliver 已被人以 keep_as_is 驳回；派生：本 run 存在 toRole = provider、kind = agent_escalated 且以 keep_as_is 回答的请求（03 不存此字段）
  topicKeys: readonly string[];  // 场景话题表中本角色可问的话题
};
export const MAX_PROPOSALS_PER_ROLE_PER_RUN = 4; // canon D12 ⑤

export function allowedActions(role: Role, kind: TurnKind, c: ActionCtx): AgentAction[] {
  const base = BASE_ACTIONS[role][kind];
  if (!base) throw new Error(`no ${kind} turn for ${role}`);       // 编程错误
  return base.filter((a) => {
    switch (a) {
      case 'propose':  return c.snapshotSize >= 1 && c.proposeCountInRun < MAX_PROPOSALS_PER_ROLE_PER_RUN;
      case 'counter':  return c.snapshotSize >= 1 && c.counterCountInRun < MAX_PROPOSALS_PER_ROLE_PER_RUN;
      case 'clarify':  return !c.clarifyUsedInRun && c.topicKeys.length > 0;
      case 'escalate': return !c.escalateUsedInRun;
      case 'reject':   return !(role === 'provider' && c.providerRejectLocked);
      default:         return true;                                    // recommend_accept
    }
  });
}
```

- canon 的"n < 2 去 counter"按"快照包含 base"计数；本设计的 evaluate 快照**不含 base**（base 单独出现在 `<room_state>`，§5.7.2），所以等价条件是 `snapshotSize ≥ 1`。这样 counter 的 `optionKey` 枚举天然不含 base，`counter == base` 在解码层不可能出现。
- provider 回合在创建前保证 `snapshotSize ≥ 1` 且 `proposeCountInRun < 4`；否则不创建回合，直接走轮次用尽（§5.8.5）。因此 provider 回合的动作集永远含 `propose`。
- 裁剪结果写进 `turns.allowedActions`（信封的一部分），`validateMoveSemantics` 与 `TurnSpec` 都从它读取，不重新计算。
