#### P5 ·【blocker】演示核心时刻"预算降到 $4,800"：constraintsVersion 递增规则、改预算的入口、状态迁移、活动 run 锚点都没定义

- **一句话**：没有任何地方规定 `rooms.constraintsVersion` 何时加 1、谁能改预算、改完状态怎么迁移；B1–B5 没有"finance 改上限"的 mutation；rooms 没有 currentRunId；Role A 分支里 `saveBrief` 改硬约束也不递增。
- **证据**：`convex/schema.ts:12/:13/:21/:24`；README.md:245、:257、:291、:201、:211、:334 A4、:343 B3、:354 C4、:400 G4、:560；grep README 和 schema 找不到递增规则；Role A 分支 `preview-store.ts:298`（只在 changeBudgetCap 递增）、`:162-195`（saveBrief 不递增）。
- **为什么重要**：这是 pitch 0:00–0:15、视频开场、G4 共用的核心时刻，A/B/C 都要碰这一段却没有负责人。最容易犯的错是只 patch 预算不递增版本，旧审批仍"有效"，$4,900 方案照样可执行，开场即翻车。
- **建议（审计员修正版）**：
  1. 硬规则：`constraintsVersion` 只在三个 mutation 里加 1——`updateBudget`、`confirmBrief`、改变硬约束的 `answerRequest`；其余写入不得改它。实现唯一入口 `bumpConstraints(ctx, roomId, reason)`。`privateBriefs.version` 只用于该 brief 的乐观并发。
  2. 新增任务 B6 `updateBudget({roomId, newTotalCents, reason})`，B 实现、D 或队长做端到端验收。同一 mutation 依次：从 `ctx.auth` 取身份 → 查 members 确认 `role === "finance"`（不信任客户端）→ `assertCents` → 写 budgets（见 P8）→ `constraintsVersion + 1` → 把当前 run 标 superseded 并清空 activeRunId（`scheduler.cancel` 只是尽力，真正保证在落库守卫）→ 状态 pending_approval → negotiating（无可行解则 needs_input）→ 写一条房间可见、不含数字的事件 "Finance constraint changed; proposal v3 blocked"，含数字的记录按 P10 的方案写进只有 finance 能读的 budgetChanges 表而不是 events → `ctx.scheduler.runAfter(0, internal.agents.renegotiate, ...)`。
  3. 旧 approvals 不删不改，版本不匹配自然失效，历史得以保留（README.md:245）。
  4. "blocked" 不回写所有提案，而是读取时派生：`isExecutable = proposal.constraintsVersion === room.constraintsVersion && 预算通过`，`rooms.view` 实时计算，预算一提交三个窗口同一刻翻转（这正是 Convex 赛道最好的展示点）。
  5. 审批/执行 mutation 持久化前只检查三条：`status === 'pending_approval'`、`currentProposalId` 一致、`proposal.constraintsVersion === room.constraintsVersion`，然后重算预算（完整流程见 P9 第 3 点）；代理回合的三条守卫（currentRunId / nextTurnSeq / constraintsVersionAtStart）在 P14，是另一组，不混用。
  6. 补 `convex/lib/state.ts` 的 `assertTransition(from, to)` 转移表（英文），至少：negotiating → pending_approval | needs_input | failed | superseded；pending_approval → confirmed | negotiating | superseded；needs_input → negotiating | superseded；failed → negotiating。room.status 只保留 open/closed，run.status 用独立联合类型。
  7. A 在 finance 的 brief 页加 "Update budget cap" 表单（Role A 分支已有 `changeBudgetCap` 的 UI 入口可复用）；先用 `AGENT_MODE=stub` 在周六下午打通；演示前用 fixture 完整跑一次 $5,000 → $4,800 并记时间戳作为 D3 证据。
- **预计工作量**：B 1.5–2 小时（含 budgets 表、状态表、手工测试）、A 45 分钟；依赖 P8（预算放哪）、P14（runs）。
- （architecture-02, security-08, process-06, docs-03, architecture-18, gap1-07）

#### P6 ·【blocker】外部服务开通链与环境拓扑全部待定；部分子项待核实

- **一句话**：Clerk/Convex/Anthropic 账号归属、模型 ID 与额度、密钥分发渠道、共享演示 deployment、托管平台、Clerk 实例类型都没定；`convex/auth.config.ts` 缺 issuer 直接 throw，`convex/_generated` 未生成；README.md:509 要求单独的生产 Clerk 实例，而生产实例通常需要自有域名和 DNS（**待核实**，外部事实）。
- **证据**：README.md:51、:160、:215、:326、:479、:482-484、:493-494、:497、:509、:585、:204、:221、:361、:537；`convex/auth.config.ts:5-6`；`.env.example:11-14`；`convex/` 下没有 `_generated` 和 `convex.config.ts`；本机 `convex codegen --dry-run` 报 "No CONVEX_DEPLOYMENT set"（无凭据的 CI 不可能生成）；convex 1.48 CLI 有 `npx convex env default set`、`convex deploy --cmd`、本地匿名 deployment、`codegen --init`；`pnpm-lock.yaml` lockfileVersion 9.0。
- **为什么重要**：G1/G2/G6 的真实验证、C 的真实模型调用、提交清单的 demo URL 都卡在这条链上，每晚一小时全部顺延；各人 dev deployment 数据不互通会让"A 看不到 C 的数据"白耗联调时间；照 :509 配生产实例可能在域名上耗掉数小时。真正能卡死的是 Anthropic 账号和额度（README.md:585）。
- **建议（审计员修正版）**：
  1. S4a 决策（10 分钟，README 只写决策不写值，英文）：账号持有人；黑客松托管演示用 **Clerk development instance**（接受开发模式标识，写进 Known limitations）；Convex 项目 owner；集成/演示用同一项目的 **production deployment**，只从 main 部署，任何人不对它跑 `convex dev`；每人保留自己的 dev deployment。
  2. owner 在**任何队友首次** `convex dev` 之前执行 `npx convex env default set CLERK_JWT_ISSUER_DOMAIN <Frontend API URL>`（issuer 是公开值，可直接写进群里和 README），已存在的 deployment 用 `npx convex env set` 补。
  3. `ANTHROPIC_API_KEY` 只配在 prod 和 C 的 dev deployment，其余用 `AGENT_MODE=stub`；在 Anthropic Console 设 workspace spend limit，每人单独 key 便于追踪和吊销；`CLERK_SECRET_KEY` 走密码管理器，不进聊天；`CONVEX_DEPLOY_KEY` 只放托管平台；评审结束后轮换全部 key（写进 D5 清单）。
  4. S4b 90 分钟冲刺：建 Clerk dev 应用 + Convex project + key → 空壳部署一次（Vercel 构建命令 `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`；Vercel 读私有仓库需 owner 授权 GitHub App；lockfileVersion 9.0 可能让平台选 pnpm 9/10，要确认按 `packageManager` 用 11.25.0，必要时 `ENABLE_EXPERIMENTAL_COREPACK=1`，Node 用 24.x）→ 登录 → `/setup` 显示 Convex 接受 Clerk token（见 M2）→ 一次 `client.models.list()` 冒烟。T+90 仍未打通的项切后备：现场用本机 `next start` 连 prod Convex；额度不通只能如实标注，不能伪造真实调用。
  5. B 第一小时提交 `convex/_generated` 和 `convex/tsconfig.json`（`npx convex codegen --init`；在第 2 点完成之前可用本地匿名 deployment 并本地设 issuer 变量生成）；此后改 `convex/` 函数的 PR 必须同时提交重新生成的 `_generated`，冲突时任取一边重跑 codegen；`health.ts` 换 `_generated/server` 的 `query`；不在 CI 加 codegen 步骤。schema 迭代：个人 dev 部署清表重 seed，prod 新字段先 `v.optional`。
  6. README.md:509 改写（英文）为 "For the hackathon we use a Clerk development instance and the Convex production deployment; production Clerk requires a custom domain and is out of scope."；README.md:221 改为 "right after S4b, deploy the empty shell and verify hosted sign-in; redeploy after each merge to main"。
  7. 否决"先推不带 auth 的 schema"：这要改掉有意的 fail-closed（`auth.config.ts:4`、README.md:494），默认环境变量已解决该问题。
- **预计工作量**：60–90 分钟，1 人主导（环境负责人，建议 D；B 只在需要时协助）；Anthropic 额度是外部依赖，最好启动会前确认。
- （code-01, process-04, docs-07, code-03, architecture-16, product-18, docs-11, code-19, process-15, docs-14, architecture-25, code-24, process-18, code-15, security-21）

#### P7 ·【high】演示数据与结局没定：只有几个总额，口径混用，预算公式未成文，降到 $4,800 后没有任何 ≤$800 的已确认选项

- **一句话**：README 只给了 $5,000/$4,000/$1,400/$900/$4,800，没有行项目、日期、可延期项；"$900 一期"和"$4,900 方案"混用；校验公式、等于上限的边界、总额低于已承诺的处理都没写；S3 未完成，fixture 归属三处不一致；按现有数字（含 Role A 分支的 fixture）降预算后没有可行选项，结局（重谈还是升级）无法预先确定，G4 写不出预期，无法彩排；转折也没有可信诱因。
- **证据**：README.md:241、:243、:245、:325、:334、:400、:410、:416、:560、:71 vs :317 vs :325；`src/lib/negotiation.ts:7`；`convex/schema.ts:13/:25`；Role A 分支 `fixture.ts:48-51` 只有 full/phase-1 两个选项，`brief-page.tsx:104-116` 新增选项需手填四字段再勾选 Confirmed。
- **为什么重要**：这是整场演示最关键的 15 秒，也是 C 的 prompt、B 的校验测试、A 的方案卡、G4 预期和 pitch 开场的共同输入；每组评委都要重放，没有确定结局就没法彩排。
- **建议（审计员修正版）**：
  1. 30–60 分钟内锁定一套带明细的 fixture，用英文 TS 模块（如 `convex/fixtures/scopeChange.ts`，Next 和 Convex 都能 import，测试也能引用），所有数据标 simulated，演示数字在代码里只定义一次。示例一：A 登录改造 required $450、B 报表 should $350、C 导出 deferrable $500、R 加急费 $100（按首选日期交付时收）；全量 A+B+C+R = $1,400；一期 A+B+R = $900，承诺后 $4,900；cap 降 $4,800 后两个选项——A+B 标准交付晚一周免 R = $800（恰等于余量，校验必须用 ≤，本身是边界测试）、A+R 按时 $550 但无 B；customer brief 写首选日 X（soft）/硬截止 X+14（hard），"要日期还是要 B"交 customer 取舍，一次演示 renegotiate 和人类升级；备用无解值 cap $4,400（余量 $400 < A）。示例二：A $500/B $400/C $500，降预算后 A + 简化版 B' $250 = $750。两者任选，**主线用不落在边界上的值，$800 留作测试用例**；M1、P18、L8 的数字一律引用这份 fixture。
  2. 统一口径：UI 同时显示 "+$900 change / $4,900 committed after approval / $4,800 cap / over by $100"（完整分解只在 finance 和获准的 customer 视图；provider 只看 "+$900 · Blocked: exceeds finance constraint"，否则可反推余量）；README 的 A4、G4 和演示段落改用同一说法。
  3. 公式写进 S2（英文）："Budget check: committedCents + proposal.additionalCostCents <= totalBudgetCents, evaluated inside the approval/execution mutation against current stored values. Pending proposals do not reserve budget; one active proposal per room."；`checkBudget` 返回 `{ok, reasonCode: OK | OVER_BUDGET | BUDGET_BELOW_COMMITTED, headroomCents}`，total < committed 进 needs_input。
  4. 转折诱因低成本版：事件时间线显示 "Q4 budget revision: cap reduced by $200"，由标注 simulated 的按钮触发；检测叙事放在"customer 和 provider 已经签过的字自动失效"。进阶版（另一笔 $200 发票记入 $4,200）只在 budgets 表就绪时做，且要同步改所有台词数字。
  5. 归属：fixture 内容由 D 写、C 审（prompt 依赖它）；seed/reset 两个 internal mutation 由 D 在 schema v1 冻结后写、B 审（几十行 Convex 代码，不要再加给关键路径上的 B，见 P11、P16）；在 Mana 里做 fixture 设计可顺带产生赛道证据（P17）。G4 改为单一期望结局；第二个 fixture 变体（故意无解）用于 Required scenarios 第 2 行和评委挑战。
- **预计工作量**：决策+fixture 45–60 分钟；`checkBudget` 纯函数加 4–5 条测试 30 分钟（B）。
- （product-03, docs-02, security-13, product-24, process-05, gap4-02, product-15）

#### P8 ·【high】预算可见性自相矛盾：README 说剩余预算是 finance 私密输入，schema 却放在全员可见的 rooms 表上，没有披露矩阵

- **一句话**：README.md:239 把 Remaining budget 列为 Finance 私密输入，:297 的 rooms 内容不含预算，`convex/schema.ts:13` 却把 `totalBudgetCents/committedCents` 放在 rooms 上；预算对 provider/customer 可见到什么粒度、谁能改预算，没有任何决定，也没有字段×角色、动作×角色矩阵。
- **证据**：`convex/schema.ts:10-14、:16、:44-45`；README.md:239、:297、:298、:306、:285、:45、:334、:402、:416、:403、:247。
- **为什么重要**：B 最自然的 `getRoom`（整份返回）会把 $5,000/$4,800 推到 provider 的浏览器和 provider agent 的上下文，报价贴着上限开，"私有委托"卖点和 G1/G7 同时失守；反过来简单隐藏又解释不了阻断原因。Convex 没有字段级 ACL，泄露不是必然的，但这个草案会诱导出泄露实现，定得越晚返工越大。
- **建议（审计员修正版）**：S1 用 10–15 分钟拍板并用英文写进 README，二选一（第 6 节把它排在启动会最前 5 分钟，因为 schema v1 以它为输入）：
  - **推荐方案（按买方/卖方划分）**：finance 和 customer 可见数字（同属采购方，pitch 开场也更好讲），provider 永远不可见。新建 `budgets` 表 `{roomId, totalBudgetCents, (committedCents 或由 commitments 汇总), updatedBy, updatedAt}`，rooms 删掉两个预算字段只留 constraintsVersion；写 `projectRoomFor(role)`/`rooms.view` 服务端投影：所有角色收到 `executable=false` 和 `blockedReasonCode='exceeds_budget'`，只有 finance/customer 额外收到 `shortfallCents`；provider 文案 "Blocked: exceeds the finance limit"（不能显示 $4,900，否则可反推 $4,000）；agent 上下文按同样规则；events 房间级摘要不写金额；只有 `updateBudget` 一个写入口；后端测试：以 provider 身份调用每个公共 query，断言返回 JSON 里没有 totalCents/committedCents（同时满足 G1）。
  - **备选方案**：把预算定义为 finance 授权共享的事实，finance brief 页默认勾选 "Share budget cap and committed spend with the room"，零代码改动，但要同步改 README.md:239 和 :297，并把 G1 用例改为"provider 直接查 finance 的 privateBriefs 被拒"。
  - 无论选哪种，约束不只来自 finance（customer 的截止日和必选功能也是约束）：矩阵写成"预算约束只有 finance 能改；各方只能改自己的简报；任何约束修改都 bump constraintsVersion"。
- **预计工作量**：决策 15 分钟；B 建表 + requireRole + 投影 30–60 分钟；A 两套文案 15 分钟。
- （architecture-01, security-06, code-02, docs-03, product-09, process-14）

