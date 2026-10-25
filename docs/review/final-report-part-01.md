# Speak for Me 综合审查报告

> 审查对象：`/Users/zhennn/cal-hack-2026-main`（GitHub main 于 2026-10-24 01:31 PDT 的 zip 快照：601 行 README + 236 行骨架代码，业务功能零实现）。六个视角审查时本机时间约 Sat 02:00–02:16 PDT；红队复核于 Sat 03:35 PDT 完成，此时距 Devpost 截止（Sun 09:00 PDT，README.md:551）约 29.4 小时。
> 基线声明：六个视角审的是上述快照，**不含**本机 `/Users/zhennn/Documents/26Fall/cal-hack-2026` 上未提交的 `feature/role-a-frontend` 分支（见 P3）。凡涉及该分支的结论都标注"Role A 分支"。
> 条目末尾括号内为可追溯的来源 id（findings.json 的 verified/gapFindings 条目）；标注「待核实」的条目其核心论断依赖本地无法验证的外部事实。文中"P1 档""有余力再做"指 README.md:262 的 P1 优先级层，与本报告条目编号 P1 无关。

---

## 0. 总体判断

项目仍在起点：main 只有 236 行骨架，README 定了规则却无人、无时刻，距截止不到 30 小时。最大风险是治理真空加上做不完的 25 小时串行计划：没人拍板就没人能解除 hold、砍范围、定 schema。另有约 1,475 行未提交、无备份的 Role A 分支（本机另一份检出）已在事实上突破 hold，须最先处理——不是因为它最严重，而是一次误操作就会丢掉它，而且它已替 S1/S2 做了十余项决定。技术 blocker 只有两个：价格无法锚定到已确认报价（P4）；预算变更时 constraintsVersion 的递增规则未定义（P5）。其余 high 项大多是同一批根因在不同视角的投影，合并为 P1–P19 后，第 6 节给出按绝对时刻排列的执行顺序。

---

## 1. 关于本报告的去重

六个视角共 152 条发现：141 条确认、8 条待核实（verdict 为 uncertain）、3 条被推翻；四个盲区补查再加 32 条（30 条确认、2 条待核实）。批评者指出约 8 个根因（预算字段放在 rooms 上、缺 changeOrders/rejections/runs/invites、operationId 与幂等、publicSummary 泄露、无测试运行器、D 单点过载、无人认领与 hold、协商延迟对不上 40 秒 pitch）在四到六个视角里各出现一次，真正独立的问题只有 25–30 个。本报告按根因合并为 **19 条详细条目（P1–P19）+ 11 条 medium 表格行（M1–M11）+ 12 条 low 表格行（L1–L12）**，每条列出被合并的全部来源 id；184 条发现（含 3 条被推翻）都能在正文或第 3 节找到归宿。排序依据：审计员修正后的 `severity_adjusted`、confidence、修复成本，以及它是不是其他条目的前置。findings.json 中 9 条 severity_adjusted 为 blocker 的发现全部落在 P1、P2、P4、P5、P6 五条里。

---

## 2. 确认的问题

### 2.1 Blocker 与 High（详细）

#### P1 ·【blocker】治理真空：无人认领、无拍板人、hold 没有解冻时刻，且 hold 已在事实上被突破

- **一句话**：A/B/C/D 四个角色全部 Unassigned，没有队长；README 把解除 hold 写成"团队要求 + 完成或明确处理 S1–S5"，但没写谁来判定、什么时候；本机 Role A 分支已基于不含 hold 的旧版 README 开工（作者很可能没看到 hold 条款，但结果是 hold 已被突破）。
- **证据**：README.md:5、:42、:51、:53、:314-317、:319、:584；分支 HEAD b15184e 基于 8ce5dd3（README 409 行，无任何 hold 条款，第 5 行为 "Status: development starter initialized"），工作区 README.md:224 的 A 仍为 Unassigned；时间线：hold 版提交 19:27:06（推送到 origin 的时刻未知）→ Role A 所用的 8ce5dd3 zip 由 Claude.app 于 19:30:30 下载 → 快照提交 b15184e 19:30:53 → dev server 19:34:10 启动 → 工作区文件 19:39–19:55 创建。
- **为什么重要**：按 README.md:42 的规则，没人认领就不能并行实现；所有后续取舍（砍单、放弃赛道、冻结、超时代合并）都没有人有权拍板；B/C 可能分别按新旧两版 README 开工，再次分叉。
- **建议（审计员修正版）**：
  1. 全队用 5 分钟确认解除 hold，由队长宣布（README.md:5 写的是 "at the team's request"，不能一个人单方面宣布）；之后的砍单、放弃赛道由队长一人拍板。队长最好不是 B（B 在关键路径上最忙，见 P11）。
  2. 写进 README 的文字必须用英文（README.md:41），例如 "Hold lifted 2026-10-24 HH:MM PDT by <captain>; S1–S5 decisions recorded in <link>"，只由队长一人提交，避免四人同时改 README 顶部。
  3. 队长候选人现在就在团队频道发出"09:00 解除 hold，08:45 前认领角色"，启动会只做确认不做讨论；15 分钟后仍未认领的角色由队长直接指派。
  4. 把 S4 拆成 S4a（只做决策：账号归属、Clerk 实例类型、Convex 项目 owner、消费上限）和 S4b（开通并冒烟，作为恢复后的第一个任务），解开"恢复前要验证服务、验证服务要先开通"的歧义。
  5. 写明队长权限：里程碑 go/no-go、触发降级梯（P2）、放弃赛道、超时代合并、宣布冻结。
  6. 人数不足时的合并：3 人为 A（前端+Mana）、B（后端+部署）、C（agent+度量+seed/reset），D 的提交和证据由队长兼任；2 人为 A+D、B+C。认领时同时写目录归属：A 负责 `src/app`、`src/components`；B 负责 `convex/schema.ts` 和业务函数；C 负责 `convex/agents/*`，`src/lib/negotiation.ts` 与 B 共审；D 负责 fixtures、`.github`、docs。
  7. zhennn 在 Ownership 表填上 A，并在频道同步分支现状（见 P3）。
- **预计工作量**：决策 15 分钟 + README PR 15 分钟；零技术依赖；是其余所有条目的前置。
- （product-01, process-01, docs-01, architecture-15, product-10, process-13, gap1-04）

#### P2 ·【blocker】计划不可行：25 小时串行节奏表没有绝对时刻，P0 没有降级梯，砍单清单砍不到任何 P0 项，赛道没有放弃顺序

- **一句话**：Development rhythm 六阶段合计 2+4+6+6+4+3+ ≥ 25 小时且只有相对时长，周六 09:00 开工就只剩 24 小时；P0 六项四页全部必做；唯一的砍单规则（:543）砍的是 P1 清单里的 second template、不在 P0 表里的 complex imports（:264 的 Later 只有 complex PDF parsing）和全文只出现一次的 animation；四个角色的 Track focus 都带 Microsoft，却没写什么时候放弃哪条赛道。
- **证据**：README.md:534-541、:532、:551（"Late projects are not judged. Submit a draft on Saturday evening"）、:543、:262、:264、:251-258、:228、:260、:230、:139、:314-317。
- **为什么重要**：照表执行必然挤掉最后 3 小时的冻结、录制和提交；没有事先排好的降级顺序，最先被丢掉的会是排在最后的审批、转折和执行，而这正是演示核心（README.md:560 的 pitch 从它开场）。
- **建议（审计员修正版）**：
  1. 把节奏表改成绝对时刻里程碑（见第 6 节），开发总量压到约 17–18 小时，留 ≥1 小时提交缓冲。
  2. 把 P0 表换成三档清单并写进 README 的 Scope and pages（英文）：
     - **不可砍**：一个 seed 房间加三个预置账号；一个 `/rooms/[id]` 工作台按角色渲染私有简报卡、当前方案卡（含 blocked 状态）、批准按钮、事件时间线、执行结果；一个 Convex action 跑 1–2 轮真实 Claude 协商；代码做预算校验；一个改约束的 mutation 同时递增 constraintsVersion 并阻断旧方案；一个用 operationId 原子写入 change order、commitment、tasks 的 mutation；三会话实时同步；可重复执行的 seed/reset（否则没法彩排）。
     - **可降级**：房间创建和邀请改 seed；私有简报抽取改结构化表单加本人确认（表单本身不可砍，见 M6；真实抽取只保留一处作为 LLM 价值展示——provider 粘贴报价邮件抽取成目录行，Sat 20:00 没做完就改预填）；四页合并成"角色工作台"和"结果/历史"两页；协商上限从 3 轮降到 2 轮、转折后只跑 1 轮；clarify 改 needs_input 加文本框；finance 代理降为确定性校验加解释。
     - **直接砍**：README.md:262 的整个 P1 清单（event-budget 模板、更清晰的 diff、可下载变更单、成本展示）、metrics 仪表盘、并发压测（Convex mutation 本身是带 OCC 的可串行化事务，保留一份"连点两次"的证据即可，见 P9 第 7 点）。
  3. 降级触发时刻统一为：Sat 12:00 S4 go/no-go；14:00 三个账号未进同一房间，立即砍 invite、合并页面；20:00 未达 L0，全员停下 L1 补 L0；Sun 01:00 未达 L1，冻结在 L0 并按 L0 如实写 Devpost；Sun 03:00 托管未成功，改本地演示加标注录屏。
  4. L0 必须保留真实 Clerk 身份，不要做"单浏览器角色切换器"（违反 README.md:306；Role A 分支的 "Preview as" 只能留在本地预览）；agent 一轮是三方各一次独立调用，不要一次调用看三方 brief（违反 README.md:45、:285）。
  5. 赛道放弃顺序 Hyphenate > Convex > Mana > Microsoft（越靠前越晚放弃）；Mana 不能当"有空再做"（证据只能在过程中产生，见 P17）；从 A/B/C 的 Track focus 删掉 Microsoft，由 D 统一负责。
  6. 如果 finance 代理降为确定性，G2（README.md:398 "three isolated agents call the model"）和 pitch 的"三个代理"就不再成立：要么保留 finance 为只解释不算术的 LLM 回合，要么同步改 G2 文案并在 Devpost 如实写 "two LLM agents + deterministic finance policy"（README.md:47）。
- **预计工作量**：启动会内 30 分钟；执行时可节省 3–5 小时。
- （product-02, process-02, docs-01, process-08, docs-10, process-19, product-14, product-11）

#### P3 ·【high，但建议最先执行】本机 Role A 分支：约 1,475 行从未提交、无备份、本机无 GitHub 凭据，且与 main 没有共同历史

- **一句话**：`/Users/zhennn/Documents/26Fall/cal-hack-2026` 的 `feature/role-a-frontend` 上有 14 个未跟踪文件（1,362 行）和 6 个已修改文件（+113/−7），实现了四页本地预览、确定性规则和 $4,800 转折的模拟流程；根提交是手造快照，直接合并会在 6 个文件上 add/add 冲突；六个视角都没审过这些代码。
- **证据**：`git status --short` 6 M + 3 ??（三个未跟踪目录）；`git rev-list --max-parents=0 HEAD` 输出 b15184e（"Snapshot of origin/main at 8ce5dd3 (copied from browser, no upstream history)"）；`git reflog` 只有 2 条、stash 空；`gh auth status` 未登录，osxkeychain 无条目，known_hosts 无 github.com，`tmutil destinationinfo` 无目的地；scratchpad 模拟合并：`fatal: refusing to merge unrelated histories`，加 `--allow-unrelated-histories` 后 README.md、`src/app/globals.css`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/rooms/page.tsx`、`src/lib/negotiation.ts` 全部 CONFLICT；其中 5 个代码文件 main 与 8ce5dd3 逐字节相同（补丁可干净应用），README 有 3 处冲突；dev server pid 4796 自 19:34 运行，祖先进程是 Claude.app（红队复核时仍在运行，未动）。
- **为什么重要**：一次 `git checkout .` 就会丢掉全部工作；按 README.md:50 无 commit 不算完成；队友看不到，B/C 无法基于它并行。同时它已经替 S1/S2 做了十余项决定（`types.ts:26-27` ProviderOption、`:49` deferredScope、`:39/:54` origin、`:59` Rejection、`:12` goal、`rules.ts:80` 服务端确定性 operationId、`rules.ts:25-26` 预算不变式、`rules.ts:55-68` 双版本审批、`preview-store.ts:287-326` 改上限阻断），也带着两个缺陷：`rules.ts:36-41` 的 "Matches current constraints" 只比版本号，不查必需范围和截止日（审计员已复现：cap $4,800 后新增仅含可延后项、交付晚于截止日的 $700 选项，四项检查全 Pass 并可执行；`preview-store.ts:162-195` 的 `saveBrief` 改硬约束也不递增版本）；工作区 README.md:112 的 "same shapes" 迁移说明会让 B 把整个 WorkspaceState（全员 brief、报价、私有事件）发到浏览器。
- **建议**：
  1. 立即本地 `git add -A && git commit`（不需凭据），然后 `git bundle create <外部路径>/role-a.bundle --all` 做离机备份。这是给 zhennn 本人的操作；本次审查对该目录只读，没有执行任何 git 写操作，也没有碰 dev 进程。
  2. 不要推这个分支去开 PR。拿到 collaborator 权限后 clone 真实 origin/main，`git switch -c feature/role-a-frontend origin/main`，复制 14 个未跟踪文件，对 5 个代码文件应用 `git diff` 补丁，手工把 "Local preview (Role A frontend)" 一节移进 601 行 README（放在 "## Repository map" 之前，同步 :438、:516-517，把 :20 改成 "simulated local preview only"）；:5/:51 的 hold 文字留给团队决定。
  3. zhennn 跑 `gh auth login`，或把 bundle/patch 交给 guanchen-1104 代为整合。
  4. 在 S1 把 `types.ts`/`rules.ts`/`preview-store.ts` 作为议程输入，并拍板两点：约束变化是否递增 proposal version（审批已绑定 constraintsVersion，再递增是冗余）；revalidated 版本的 sourceRole/actor 记为 system 或 finance，不能仍是 provider。
  5. 把 "Matches current constraints" 改名为 "Checked against constraints v{n}"，给 customer brief 加结构化 requiredScope 和 deadline，在 checkProposal 加两项检查；把 `useWorkspace` 拆成按角色裁剪的读模型（myBrief、roomSummary、briefStatuses、publicEvents + myPrivateEvents），删掉 "same shapes" 说法，README.md:112 补 privateBriefs 结构变更和 confirmedAt。
  6. 对 `src/lib/workspace/*.ts`、`src/components/workspace/*.tsx` 补一轮 code/architecture/security 审查；审查报告中相关发现标为"有提案（feature/role-a-frontend，未合并）"。
- **预计工作量**：提交+备份 5 分钟；重建分支 30–45 分钟（依赖 owner 发 collaborator 邀请）；补审 1 小时。
- （gap1-01, gap1-02, gap1-03, gap1-06, gap1-07, gap1-08, process-11, docs-21）

#### P4 ·【blocker】没有已确认报价/范围条目实体：价格、范围、来源全由模型自填，代码无从核对，G3 做不到

- **一句话**：`scope`、`sourceRefs` 是自由字符串数组，`additionalCostCents` 由模型产出，schema 和 README 数据表都没有报价目录；模型可以编一个 $850 再附 `sourceRefs:["provider quote"]` 通过校验。
- **证据**：`src/lib/negotiation.ts:6/:7/:9`；`convex/schema.ts:18-22、:23-27`；README.md:243、:342 B2、:399 G3、:71、:410、:295-304；审计员用仓库自带 zod 4.6.7 复现：`{scope:["whatever"], additionalCostCents:1, deliveryDate:"2020-01-01", sourceRefs:["made-up-quote-999"]}` 通过 `proposalTerms.safeParse`，`scope [" "]` 也通过。
- **为什么重要**："模型提议、代码校验"是 Hyphenate（limited access、proof it works）和 Microsoft responsible design 的核心论据；评委一问"你怎么知道这个价格是真的"就失分；它也是无解判定（README.md:410）和压缩延迟的基础。现在没有任何代码依赖它，改成本最低；晚改要连带改 C 的 prompt 和 A 的方案卡。
- **建议（审计员修正版）**：
  1. 新增 `quoteOptions`/`providerOptions` 表：roomId、optionKey（房间内唯一，先查后插）、title、itemKeys、priceCents、earliestDeliveryDate、priority（required/should/deferrable）、leadTimeDays、taskTemplates、confirmedBy/confirmedAt（fixture 由 seed 直接写成已确认）、simulated；可选 `confirmedTerms`（termId、kind 如 rush_fee、deltaCents、condition）。customer brief 加 requiredItemKeys/deferrableItemKeys 和 deadline（YYYY-MM-DD），与选项共用同一套词表。
  2. **不让模型输出金额和日期**：模型只输出 action、optionKeys/itemIds、termIds、deliveryDate、rationale；`additionalCostCents` 由服务端按目录求和；`sourceRefs` 由代码从 itemKeys 推出。不要让模型输出 `v.id("quoteOptions")`，用 optionKey 字符串再由服务端映射。
  3. 存储层和校验层用 `string[]` + 成员检查，不要在 Zod 里写死 `z.enum([...fixture IDs])`（挑战场景要现场加选项）；给模型的输出 schema 可按当前目录动态生成 z.enum，但 SDK 1.1.0 会把 enum 降到 description（P13），最终仍靠 parse 后的 Zod 校验。
  4. 写纯函数 `validateProposal/checkProposal(options, mustHave, deadline, budget)` 放 `convex/lib/`，返回 `reasonCode[]`，query 和执行 mutation 共用；检查：requiredItemKeys ⊆ scope 或显式标 deferred、deliveryDate ≤ deadline 且 ≥ max(earliestDeliveryDate)、committed + additional ≤ cap、未知 itemId 拒绝。
  5. 时间够再做：provider 代理提出"新选项"时落库为 unconfirmed、房间转 needs_input、provider 本人确认后才可被选中（对应 README.md:243 和 Hyphenate 的 escalation）。
  6. Role A 分支的 `ProviderOption{costCents, deliveryDate, confirmed}`（`types.ts:27`）可作起点。测试见 M1。
- **预计工作量**：B 1–1.5 小时（表+纯函数+测试）、C 30 分钟改 prompt、A 1 小时选项表单（Role A 分支的 `brief-page.tsx:103-117` 已有雏形）；必须在 S2 冻结前、C 写 prompt 前完成；依赖 P7 的 fixture。
- （security-01, product-04, architecture-09, code-04, gap1-06, gap1-07）

