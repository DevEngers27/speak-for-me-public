#### P13 ·【high】模型选型与 @anthropic-ai/sdk 1.1.0 的硬约束：参数、thinking、结构化输出、信封字段

- **一句话**：`ANTHROPIC_MODEL` 不校验，而当前一代模型能接受的参数互不相同（强制 tool_choice、`thinking:disabled`、`between_tools` 只在部分模型可用）；SDK 默认发送 anthropic-version 2026-10-21，`temperature/top_p/top_k`、assistant prefill 在所有模型上 400，且只有对象字面量里的 temperature 能被 tsc 拦下；thinking 默认开启并计入 `max_tokens`，Opus 5.5 关不掉，effort 默认随模型变（Haiku/Opus medium、Sonnet high），是每回合延迟和成本的主要杠杆；工厂的 `timeout: 30_000` 覆盖了 SDK 按 max_tokens 推算的默认超时；`max_tokens` 过小会让 `messages.parse` 返回 `parsed_output: null` 而不报错；`zodOutputFormat` 把 enum/const/maxLength 降到 description；草案 `agentMessage` 把 roomId/runId/sourceRole/版本号混进模型输出，直接喂 `zodOutputFormat` 会让模型自报版本号、过期检查失效；propose 不带 terms、reject 带 terms 都能通过；回传 thinking 块同时改写 system 在 2026-08-31 后创建的账户上会 400。
- **证据**：`convex/lib/anthropic.ts:6-13、:12`；SDK `client.js:966`、CHANGELOG 1.0.0 BREAKING、grep temperature 只命中 CHANGELOG、`shouldRetry` 不重试 400、`messages.js:32-36`、`parser.js:29-49/:63`、`transform-json-schema.js:82-112`、`helpers/zod.d.ts:12`、`messages.d.ts:3641-3648/:3655-3667/:5264`；`src/lib/negotiation.ts:7、:11-20`；tsc 探测只拦字面量 temperature；本地复现 `zodOutputFormat(agentMessage)` 的 required 含 roomId/runId/sourceRole/版本号；README.md:201、:284、:287、:484、:585、:200；参考资料 model-migration.md（Opus 5.5 BC1–3、Sonnet 5.5、Haiku 5.5）。
- **为什么重要**：换模型就 400 会正好发生在评委换场景时；不设 effort 时成本相差约 40 倍（按 9 次调用、3K 入/2K 出估算，Opus 5.5 ≈ $0.47、Sonnet 5.5 ≈ $0.23、Haiku 5.5 ≈ $0.012，需实测）；靠 `temperature:0` 可复现本来就做不到，G2/G4 回归不能假设同输入同输出；`parsed_output: null` 可能被状态机当作"代理没有提议"继续推进；旧建议中的"低温度"在此 SDK 里没有对应参数。
- **建议**：
  1. S4 把"每个调用点用哪个模型 + effort"列为决策写进 Open decisions；`createAgentClient` 用常量白名单校验 `ANTHROPIC_MODEL`；拿到 key 先 `client.models.list()` / `models.retrieve(id)` 核对账户可用 ID 和 capabilities。
  2. 只用所有当前一代模型都接受的请求形状：不传 temperature/top_p/top_k、不 prefill、不强制 tool_choice、不传 thinking 或只传 `{type:"adaptive"}`、显式 `output_config.effort`；简报抽取（若保留，见 M6）用 Haiku 5.5 effort low；谈判回合用同一组 fixture 对比 Opus 5.5 low / Sonnet 5.5 low / Sonnet 5.5 between_tools 的质量和 p50/p95 再定；G2 验收必须在最终演示模型上完成。
  3. 重试与超时只写一份预算：传输层重试只由一层负责（自建路线 SDK maxRetries 2、默认 timeout 60–90 s；Workflow 路线 SDK 设 0）；应用级只对 invalid_output / 失败自动重试 1 次（见 P14）；演示路径单次尝试 timeout 15–20 s，并把"最坏调用数 × 单次超时"算出来写进 P12 的延迟预算，超出就改参数而不是现场等。`max_tokens` 先给 thinking 留余量再按实测 `output_tokens_details.thinking_tokens` 收紧；解析前检查 `stop_reason` 只接受 end_turn，max_tokens 和 refusal 走可恢复失败分支；`BadRequestError` 视为不可重试的编程错误；超时重试单独计数。
  4. 契约拆两层：`agentModelOutput` 用 `z.discriminatedUnion('action', [...])`——propose/counter 必带 itemCodes/deferredItemCodes/deliveryDate/rationale，clarify 带 targetRole/question，recommend_accept 只带 rationale（不自报 proposalVersion），reject 带 reasonCode；外包一层 `z.strictObject({message: ...})` 避免根级 anyOf（Claude 结构化输出是否接受根级 anyOf 不确定）；`AgentEnvelope`（runId、turnSeq、sourceRole、baseProposalVersion、constraintsVersion）由服务端从 turn 快照注入，持久化时与当前 room 比对，任何情况下不读模型回显的版本号。调用用 `client.messages.parse({ model, max_tokens, messages, output_config: { effort: 'low', format: zodOutputFormat(agentModelOutput) } })` 读 `parsed_output`，parse 抛错按 invalid_output 计入有界重试；需要 schema 层强制枚举可用 `jsonSchemaOutputFormat(schema, { transform: false })` 并自行 Zod 校验；所选模型不支持 `output_config.format` 就退回 `tool_choice: auto` + `strict: true` 并检查是否真的调用了工具。
  5. 每回合无状态从 Convex 重建上下文，不回传 thinking 块；约束变化只追加一条 `role:"system"` 消息、不改写顶层 system；兜底：捕获该 400 后剥离 thinking/redacted_thinking 块重试一次。
  6. usage 逐次记录 input/output/thinking_tokens/cache_read 和 request id；稳定 system + brief 放请求前缀开 prompt caching；成本只用控制台账单换算并标估算，不在仓库硬编码价格。
  7. `sourceRefs` 用已确认 fixture ID，不用原生 Citations（与 `output_config.format` 互斥，代理间转发带 citations 的文本也会 400）。演示前用最终 schema 预热一次（新 schema 首次有编译延迟，缓存 24 小时）。
  8. agent action 用 Convex 默认 isolate 运行时（按 Convex 打包参数本地 esbuild 打包 0 错误 0 警告），放 `convex/agents.ts`，不要放 `convex/actions/` 目录（缺 "use node" 会直接报错）；首次 `backend:dev` 即打包验证；只有真实推送失败才改 "use node" 并把 internal mutation 拆到别的文件。
- **预计工作量**：决策 15 分钟；C 拆 schema + 封装调用 45 分钟–1 小时；B 在 completeTurn 比对 15 分钟；模型对比实测 30 分钟（耗少量额度，先设上限）。
- （gap2-01, gap2-02, gap2-03, gap2-04, gap2-05, gap2-06, gap2-07, gap2-08, code-17, architecture-07, security-07, code-06, architecture-22）


#### P14 ·【high】run 生命周期、恢复与 build-vs-adopt：runId 只是字符串，scheduled action 至多一次且不重试，编排方式从未被评估

- **一句话**：没有 runs/agentTurns 表、currentRunId、轮次、重试计数、用量字段；`node_modules/convex` 的 `scheduler.d.ts:18-21` 写明 scheduled action "execute at most once ... not retried"，设计里没有 try/catch、失败状态和恢复机制，action 与 mutation 不在同一事务；README 默认 scheduler 自建却从未把 `@convex-dev/workflow`/`agent` 当替代方案评估；重试分多层会相乘（3 轮 × 3 角色 × 3 step × 2 SDK = 54 次）；公开 demo 没有调用上限或总开关。
- **证据**：`convex/schema.ts:24、:10-14、:41-46`；`scheduler.d.ts:18-21`；README.md:48、:154、:164、:178、:201、:211、:274、:279、:286-287、:291、:324、:355 C5、:363 D3、:124、:215、:326、:570；`convex/lib/anthropic.ts:5-15` 无计数；npm：workflow 0.4.10（peer convex ^1.46、workpool、convex-helpers）、agent 0.7.8（必需 ai ^7 + @ai-sdk/*）、action-retrier 0.3.1；Workflow README：取消不中断进行中的 action，改 step 结构或参数会 determinism violation。
- **为什么重要**：双击"开始协商"或预算变更后旧链没停，两条代理链互相覆盖并重复花额度；action 抛错后无人接手，房间永远停在 negotiating，评委面前冷场，最可能撞在"换新场景"时；没有用量字段 C5 和 Microsoft 指标只能估算而 README.md:47 禁止编造；B/C 若各写一套重试会重叠矛盾（目前是推测，但零成本可避免）；评审前夕拿到公开 URL 的人可以反复触发把额度烧光。
- **建议（审计员修正版）**：
  1. S2 加 30 分钟子决定：(1) `ctx.scheduler` 自建；(2) `@convex-dev/workflow`（+workpool）；(3) 再加 Agent 组件。黑客松默认选 (1)。
  2. 自建方案：`runs` 表（roomId、status 与 state.ts 共用联合类型、trigger:'initial'|'budget_change'|'human_answer'、constraintsVersionAtStart、round、maxRounds、nextTurnSeq、endedReason?、startedBy、createdAt，by_room）；rooms 加 `currentRunId`；`agentTurns`（roomId、runId、turnSeq、role、attempt、status:running|succeeded|invalid_output|failed|stale、baseProposalVersion、constraintsVersion、output?、resultProposalId?、model、inputTokens?、outputTokens?、latencyMs?、errorCode?、startedAt、finishedAt?，by_run_seq）；删掉 leaseToken（turnSeq 守卫足够）；`startRun` 幂等；`runTurn` action 整体 try/catch，成功调 `completeTurn`、失败调 `failTurn`（记 errorCode、置 failed/needs_input、写事件）；`completeTurn` 在同一 mutation 写结果并调度下一回合；持久化前三条守卫：`room.currentRunId === runId`、`run.nextTurnSeq === turnSeq`、`room.constraintsVersion === run.constraintsVersionAtStart`，任一不满足写 `turn_rejected_stale` 事件并丢弃（这是回合守卫；审批/执行的守卫在 P5，另一组，不混用）；应用级自动重试最多 1 次；UI 在 failed 显示 Retry turn 按钮调 `retryTurn`（同 turnSeq，attempt+1）；每房间调用上限约 30，每日上限约 500 为可选（单文档计数在并发下有 OCC 冲突，黑客松流量下可接受，但别设太低以免排练用完）；Convex 环境变量 `AGENTS_ENABLED=false` 关闭模型调用并给 UI 明确提示；只有房间成员能触发回合；演示期间禁止部署（写进提交清单）；看门狗 `runAfter(60_000, turnWatchdog)` 降为有余力再做；演示 maxRounds 1–2。
  3. 若选 Workflow：每个 run 一个 workflow，workflowId 当 runId；for round ≤ 3 / for role：先 `step.runAction(turn)` 再 `step.runMutation(validateAndPersist)`（持久化失败不会重新付费调模型）；显式写 maxAttempts，且只有一层负责重试；改 workflow 代码前先取消正在跑的 run（取消不会中断进行中的 action，迟到写回仍要在 mutation 层拒收）；前置条件 `convex/convex.config.ts` + `_generated` 已提交（可用本地匿名 deployment 生成，但要设 CLERK_JWT_ISSUER_DOMAIN）。"每个 room 一个活动 run"、迟到写回拒收、私密过滤、延迟和金额统计无论哪条路都要自建。
  4. 不采用 Agent 组件：要换成 Vercel AI SDK v7，与现有 `@anthropic-ai/sdk` 并存，触发 README.md:48/:164 的 documented change；如果仍采用，线程必须按 room×role 隔离（共用一个 room 级线程时，默认 `recentMessages=100` 会把线程里已存的消息带进每个代理的上下文），`searchOtherThreads` 保持 false（开启后会跨同一 userId 的所有线程检索）；它提供的 usage 也只有 token。
  5. 最坏调用数写成常量进 S4 花费计划，usage 记录带 attempt 序号；Convex 贡献段落由 D 如实写明编排由谁提供（自建在 scheduler 上，或 `@convex-dev/workflow`），不要为了赛道叙事引入组件。
- **预计工作量**：决策 30 分钟；schema 15 分钟 + startRun/守卫 45 分钟（B）；try/catch/failTurn/Retry 45 分钟（C）；总开关和上限 30 分钟；Workflow 路线另加约 1 小时。
- （architecture-05, architecture-06, code-08, docs-15, architecture-13, gap3-01, gap3-02, gap3-03, gap3-04, gap3-05, gap3-06, gap3-07, gap3-08, architecture-18, security-12, docs-17）

#### P15 ·【high】房间邀请、角色授予、用户标识没有数据模型，任何登录用户都可能自选 finance

- **一句话**：P0 要求"创建房间并邀请两位参与者"，但没有 invites 表，members 要事先知道 userId；角色由谁授予、每角色是否只能一人、ownerId 权限、userId 用 subject 还是 tokenIdentifier、如何显示成员名字都没定义。
- **证据**：README.md:253、:207、:306、:570、:397 G1；`convex/schema.ts:11、:15-17`；`convex/health.ts:9` 返回 subject；`authentication.d.ts:89-102`（tokenIdentifier 全局唯一，subject 跨 provider 不唯一）；`src/app/rooms/page.tsx:4`。
- **为什么重要**：做成"知道 roomId 自选角色就能加入"，任何注册用户都能以 finance 身份进房、读预算、审批（Convex ID 会出现在 URL 里）；一人插三条 member 就能一人满足"三方均批准"；Convex query 不能调 Clerk API 取名字。
- **建议（审计员修正版）**：`createRoom` 同时为三个角色各生成一次性加入码，`roomInvites {roomId, role, code, createdBy, acceptedBy?, acceptedAt?}`，索引 by_code（token 用 `crypto.randomUUID()`，只在 owner 的查询返回；tokenHash/expiresAt 有时间再加）；`acceptInvite({code})` 同一 mutation 确认码未用、角色无人占、该 userId 未在本房间，插 members 并快照 displayName（`identity.name` 取不到就让用户填；Clerk 的 Convex JWT 模板是否带 name/email 未核实）、标记已用；角色永远由服务端按邀请绑定；userId 统一 `identity.tokenIdentifier` 写进契约，`health.viewer` 改返回 tokenIdentifier 方便 seed 取三账号 ID（dev/prod issuer 不同要分别 seed）；房主不因此获审批权；MVP 不提供移除成员/改 approvalRequired 的 mutation；`getViewer/requireMember` 从 `ctx.auth` 推导，业务函数不接受 userId/role 参数；Clerk dev 实例改 Restricted 注册并预建三个演示账号（免费版可用性待核实）；兜底：D1 的 seed internalMutation 直接为三个已知 tokenIdentifier 写 members，Devpost 如实写明"邀请流程为预置"。users 表可砍。
- **预计工作量**：B 1 小时、A 加入页 20–30 分钟；可降级为 seed 15 分钟；G1 前置，前 6 小时内完成。
- （architecture-11, security-05, code-11, security-24）

#### P16 ·【high】D 单点过载，现场无分工：pitch 表没有讲述人、操作人、救场人、英文答问人，没有 Devpost 备份提交人

- **一句话**：D（Unassigned）在 README 约 30 行职责；pitch 表只有 Time/Content 两列；"rehearse" 只在最后 3 小时出现一次；fixture 归属在 :71（B+C）、:317（D）、S3 之间不一致；G4/Hyphenate/Responsible design 标为 A+B+C 或 All，没有主责。
- **证据**：README.md:57、:73-74、:90-91、:93、:142、:159-162、:215、:221、:317、:319、:361-365、:395、:554、:558-564、:312-317、:365、:541、:553、:72、:126、:127、:400。
- **为什么重要**：最后 6 小时 D 要同时处理部署修复、视频、四段赛道说明、Devpost，一人掉线提交就失败（"Late projects are not judged"）；一边讲一边切三个窗口容易冷场；赛道典型问题落到没准备的人身上。
- **建议（审计员修正版）**：
  1. 指定队长（可兼 D；若 D 由有黑客松经验者担任并兼 captain/timekeeper，则把 D 的工程集成职责剥离出去——交给 A 或 C 分担，不要再压给已在关键路径上的 B，见 P11）。
  2. 重新分工：fixture 内容归 D（C 审，prompt 依赖它）；seed/reset 两个 internal mutation 由 D 在 schema v1 冻结后写、B 审（不要把 fixture 和 reset 整体压给已是瓶颈的 B）；部署链由环境负责人/账号持有人一次打通（P6），之后合并 main 自动部署，前端托管配置归 A，D 只验证 URL；度量给 C（C5 本来就有）；视频由 A 在 02:00 UI 冻结后录屏、D 写旁白并剪辑；访谈给 C 或 D；D 保留计时与 go/no-go、证据汇总、Devpost 和赛道段落。
  3. 周六上午把四人全加进 Devpost 项目和 GitHub；20:00 提交草稿；07:30 前提交完整版；08:30 由队长作为备份检查确认页。
  4. 所有 A+B+C 任务改为一名主责加协助；用英文更新 README.md:314-317 和 :584。
  5. pitch 表加 Speaker / Driver / Recovery / Q&A owner 四列：1 名英文讲述人；1 名 Driver 在一台笔记本并排操作三窗口（可外接第二屏）；1 名 Recovery 盯 Convex dashboard、负责 reset 和切录屏；每赛道一名 Q&A owner 加英文答题卡（每赛道 3–5 题：Convex 具体提供了什么行为；Mana 在哪一刻改变了产出；Hyphenate 哪些真实、哪些模拟；Microsoft 用户理解与度量）。
  6. 状态用 GitHub Issues 或频道置顶跟踪，D 在检查点汇总进 README 一次，不要四人同时改 README 顶部；站会对齐里程碑各 10 分钟。
- **预计工作量**：分工 15 分钟 + README 10 分钟；答题卡 30 分钟。
- （product-10, docs-06, process-10, gap4-05, process-23）

#### P17 ·【high；对 Mana 赛道本身是 blocker】Mana 证据为零，原定模块已在 Mana 之外写完

- **一句话**：Mana 赛道（$5,000，meaningful use 占 30%）要求 1–2 个公开链接和一个"Mana 改变了构建"的具体时刻，当前证据为零、访问与额度未验证、无 go/no-go；计划把它交给同时负责四页和实时对比的 A 做 proposal-comparison UI；本机分支已在 Claude 桌面会话里把比较表、版本差异、检查清单写完，"在 Mana 中原型化/实现"这条路已不可用，只剩"在 Mana 中调试/迭代"或换模块。
- **证据**：README.md:99、:103-107、:109、:111、:113、:115、:157、:220、:230、:314、:327、:331-335、:558-566、:158/:505；本机 `workbench.tsx:142-179`、`rules.ts:82-94`；dev server 祖先进程 Claude.app；11 个 workspace 文件 19:39–19:46 创建；工作区 README.md:114 "Not covered: Mana evidence (A5)"。
- **为什么重要**：证据只能在开发过程中产生，事后补录与 "Never fabricate historical Mana usage" 直接冲突；每晚一小时就少一小时可记录的真实使用；把现有 comparison 说成 Mana 产出违反 Claims 规则。
- **建议（审计员修正版）**：
  1. 不要在 hold 解除前用 Mana（会消耗 hacker credits，README.md:51 禁止）；解除后第一批任务：30 分钟内验证 mana.space/a/calhacks 的访问和额度，30 分钟内不通队长可当场决定放弃，最迟 Sat 12:00 go/no-go，不通就从 Devpost 去掉 Mana，时间让给 Hyphenate。
  2. 负责人不要是 A；或 A 只在等 B 接口的 1–4 小时空档，用 Mana 基于 fixture mock 对比较视图做一轮真实迭代并保留前后对比。
  3. 把 Mana 用途换到关键路径产物：P7 的 fixture 设计、P4 的确定性校验器 `checkBudget/isExecutable`、陈旧审批测试矩阵、协商 prompt 与输出 schema 迭代。
  4. Mana 产出先审阅再以补丁进 GitHub，commit message 注明来源，PR 描述写一行英文 "Mana impact: …"；关键时刻必须真实发生（如 Mana 会话发现加急费数字对不上、发现 ≤ 和 < 的边界 bug）。
  5. D 每 3–4 小时保存公开链接，无痕窗口验证可打开且不含密钥和私有数据；准备 20–30 秒插段；在 README.md:109 和 S5 记录模块调整。
- **预计工作量**：访问验证 15–30 分钟；嵌入 fixture/校验器工作额外成本接近零；链接验证 3–4 次各 10 分钟；插段 30 分钟。
- （product-06, gap1-05, process-12）

