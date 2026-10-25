## 6. 未来 24 小时建议行动顺序

> 时间均为 PDT。红队复核时本机为 Sat 03:35，距 Sun 09:00 约 29.4 小时。每块注明对应条目；"‖" 表示可并行。4 人版按 A/B/C/D 各一人；2 人版的差异在每块末尾单独列出。

### 关键依赖链与外部阻断项（先看这一段）

按先后关系，下面任何一环没通过，后面的块都会顺延：

1. 团队在频道确认解除 hold → 指定 captain（P1）。在此之前只做不消耗服务的事：clone、装依赖、写 fixture 草稿、认领名单。
2. 仓库 owner（guanchen-1104）发 collaborator 邀请；zhennn 本机没有 GitHub 凭据，先 `gh auth login`（P3）；每人在真实 clone 上工作（M7）。
3. Clerk dev 实例建好拿到 issuer → Convex project owner 执行 `npx convex env default set CLERK_JWT_ISSUER_DOMAIN …` → **之后**任何人才第一次运行 `convex dev`（P6）；B 的 `codegen --init` 和 `_generated` 提交依赖这一步，其他人引用 `_generated` 的 PR 才能过 CI（L4）。
4. Anthropic key + spend limit → C 的真实调用与模型实测（P13）；12:00 没有额度就立即找现场赞助商/主办方，同时全程 stub 并如实标注。
5. M2 的 `health.viewer` 返回 tokenIdentifier → 三个演示账号在演示部署各登录一次 → D 的 seed 才能写 members（P12、P15）。
6. P7 fixture 定稿 → C 的 prompt、B 的校验器、M1 的测试、A 的方案卡、P18 的挑战场景。
7. Vercel 读私有仓库需 owner 授权 GitHub App（owner 不在线就由有权限成员用 Vercel CLI 部署）→ 空壳部署 → Clerk 允许域名（P6）。
8. 16:00 stub 全链路 → 20:00 真实代理（L0）→ 01:00 全链路（L1）→ 02:00 冻结 → 07:00 README 定稿 → tag → deploy → 07:30 提交。

外部阻断项与兜底：owner 需在三个时刻在线（现在/09:00 邀请、10:00 Vercel 授权、Sun 06:00 转公开），提前约好；Mana 访问 30 分钟内验证、最迟 12:00 放弃（P17）；Devpost 规则（代码可见性、赛前代码、赛道叠加、评审形式）12:00 前拿到答复，最坏情况开幕后重建约 240 行脚手架约 1 小时（M3）；Clerk Device Trust 用全新 profile 实测，20:00 前完成（M8）；依赖安装在稳定网络下完成，现场备手机热点。

### 现在 → 09:00（异步，不消耗任何服务）
- **立即**：zhennn 在 `feature/role-a-frontend` 上 `git add -A && git commit`，`git bundle` 离机备份，然后 `gh auth login`（P3）。
- 队长候选人在频道发出"09:00 解除 hold，08:45 前认领 A/B/C/D"，附本报告，并请全队在频道回复确认（P1）。
- 仓库 owner 发 collaborator 邀请；每人在稳定网络下 `git clone` 真实 main 并 `npx --yes pnpm@11.25.0 install --frozen-lockfile && pnpm check`，失败者切 Node 24.x（M7、L3）。
- 账号持有人若还醒着，且团队已在频道确认解除 hold：在 Anthropic Console 建 workspace 和 key、设 spend limit（P6）。未确认前不要开通任何服务（README.md:51 的 provision services 与 P17 对 Mana 的处理口径一致），推迟到 09:15。
- 可睡前完成：S1 认领草稿、S3 fixture 数字草稿（P7），不花额度。
- **2 人版**：同上；两人现在就定好 A+D / B+C 的分工。

### 09:00–10:00 启动会（S1–S5 限时 60 分钟，队长主持）
- 09:00–09:15：认领四角色 + 队长，宣布解除 hold，写进 README（P1、P16）；用 5 分钟先联合定下预算可见性二选一（P8），因为 schema v1 要以它为输入。
- 09:15–09:45（可分两桌并行）：
  - 桌 1（队长 + A + D）：三档清单与降级梯、赛道顺序、里程碑时刻表、D 减负、Devpost/GitHub 全员加入（P2、P16）；fixture 数字与结局定稿（P7）；Mana 模块与负责人、访问验证安排（P17）。
  - 桌 2（B + C）：schema v1 清单（P4、P5、P9、P14、P15、M6、M9，以 Role A 分支的 ProviderOption/Rejection/operationId 为输入，拍板 P3 第 4 点）；信封/模型输出两层契约（P13）；build-vs-adopt 默认选 scheduler 自建（P14）；延迟预算与重试最坏值（P12、P13 第 3 点）。
- 09:45–10:00：S4a 决策（账号归属、Clerk dev 实例、Convex prod 作为共享、模型与 effort、消费上限；P6、P13）；Open decisions 六列表填默认值（M3）；D 发出赛事问询：评审形式、赛道叠加、Convex 奖励、来访组数，以及代码可见性与 hacking start（M4、M3）。
- **2 人版**：合并成一桌 45 分钟；直接采用默认值（预算 finance+customer 可见、scheduler 自建、谈判模型待实测后定）；砍：邀请流程、brief 抽取、四页合并两页、finance 代理改确定性、Microsoft 访谈、convex-test、第二 fixture 变体、provider 改价。

### 10:00–12:00 基础设施冲刺 ‖ 契约落地
- 环境负责人（建议 D 或 B）：Clerk dev 应用 → Convex project + `env default set` issuer（**早于任何人首次 `convex dev`**）→ key 配 prod/C 的 dev → 空壳部署（Vercel + `convex deploy --cmd 'pnpm build'`，需 owner 授权 GitHub App，Vercel 环境变量放 CONVEX_DEPLOY_KEY）→ 用全新浏览器 profile 登录（顺便实测 Device Trust，M8）→ `/setup` BackendCheck → `models.list()` 冒烟（P6、M2）。
- B：schema v1（budgets、quoteOptions、changeOrders、runs、agentTurns、roomInvites、approvals 改造、events 改造）+ 函数签名桩（codegen 前用 `*Generic`）+ `npx convex codegen --init` + 提交 `_generated` 和 `convex/tsconfig.json`（P4、P5、P9、P14、P15、M9、P11）。
- C：拆 `agentModelOutput`/envelope、`buildAgentPrompt` 纯函数、`callModel` 封装、stub 实现（P13、P11）；顺手写 `completeTurn`/`failTurn` 两个 internal mutation 的草稿交 B 审（P14）。
- A：先花 20 分钟写 `/setup` 的 BackendCheck 组件供环境负责人冒烟（M2）；rebase Role A 代码到真实 main 为新分支（P3），改用 `anyApi` + fixture mock；Mana 访问验证通过后，在 Mana 里对比较视图做一轮真实迭代并保存链接（P17）。
- D：fixture TS 模块（C 审）、挑战变体、Mana 访问验证、赛事问询跟进、访谈邀约（M5 要求 10:00 前发出）（P7、P17、P18、M4、M5）。
- **2 人版**：B+C 先做 schema v1 + codegen + 环境冲刺（环境由 B+C 承担，A+D 配 Clerk/Vercel）；A+D 做 fixture + rebase。

### 12:00 检查点（go/no-go）
- S4 四项：Clerk dev 可登录（含 Device Trust 流程）；Convex prod 收到 token（BackendCheck 截图）；Anthropic key 可调用（记下 p50 延迟）；Mana 可访问。赛事问询答复到位，缺的按最保守假设。任一失败按 P2 降级：Mana 不通→从 Devpost 去掉；key 不通→立即找赞助商/主办方，同时全程 stub 并如实标注；Clerk/Convex 不通→优先排查，不启用"模拟身份"。

### 12:00–16:00 核心 mutation ‖ 工作台
- B（按顺序，合计约 4–4.5 小时，原清单按各条工作量合计 6–7 小时装不下）：`assertTransition` + `state.ts`（20 分钟）→ `requireMember` + `rooms.view` 投影（1 小时）→ `updateBudget`（B6）+ `bumpConstraints`（1.5 小时）→ `approve` 内含执行与幂等（1–1.5 小时）（P5、P9、P8）。`startRun`/`completeTurn`/`failTurn` 的守卫由 C 写、B 审（P14）；`acceptInvite` 推到 16:00–20:00，14:00 检查点前用 seed 直接写 members（P15）。
- A：`/rooms/[id]` 工作台接 `rooms.view`、方案卡（含 blocked 与口径分解）、批准/拒绝、finance 的 cap 输入框、回合状态显示；主路径先于细节，加入码页放到 16:00 后（P5、P7、P12、P18）。
- C：真实调用实测三模型 p50/p95 和质量，定模型与 effort；接 `runTurn` action（try/catch）+ `startRun`/`completeTurn`/`failTurn`；模板化公共文本 + 私有 rationale；buildAgentContext 白名单（P13、P14、P10）。
- D：`seedDemoRoom(phase)` / `resetDemoRoom` internalMutation（与 B 配合；seed 的 userId 取自三账号登录后的 tokenIdentifier）、零依赖 `node --test` 校验器测试、完成访谈（P12、M1、M5）。
- **14:00 检查点**：三个真实账号进同一房间（凭 seed；加入码为后补）；演示部署上 BackendCheck 显示 token 被接受。未通 → 砍邀请 UI 只用 seed、四页并两页。
- **2 人版**：B+C 只做 updateBudget、approve/execute、startRun/completeTurn；A+D 做工作台 + seed；不做邀请 UI、不做回合并行、协商上限 1 轮；14:00 检查点改 15:00。

### 16:00–20:00 stub 全链路 → 真实代理
- 16:00 目标：用 stub 在 Convex prod 跑通 seed → 提案 → 批准 → 改上限阻断（三窗口同步翻转）→ 重新提案 → 执行写入 changeOrder/commitment/tasks；首次跑通立即录屏（P11、P5、P9、M3）。
- 16:00–20:00：C 用真实代理替换 stub（provider propose → customer/finance 并行评估），接 canary 测试；B 补 `acceptInvite` 和 P19 轻量版候选方案；A 补 needs_input 选项卡、事件时间线、加入码页；D 整理访谈、Mana 链接无痕验证、挑战场景预演（P12、P10、P19、P15、M5、P17、P18）。
- **20:00 检查点（L0）**：G2/G3 通过（同 fixture 跑 5 次 ≥4 次产出通过校验的方案，最终模型）；提交 Devpost 草稿，四人接受邀请；粗剪录屏。未通 → 全员停 L1 补 L0；finance 改确定性并同步 G2 文案。
- **2 人版**：真实代理只跑 provider 1 次 + customer 1 次，finance 确定性；P19 用 needs_input 事件 + 文本框即可；Devpost 草稿由 A+D 20:00 提交。

### 20:00–02:00 转折路径与证据（01:00 为 L1 检查点）
- 真实路径跑通 G4（降预算 → 阻断 → 1 轮重谈 → 新审批 → 执行）和 G5（双击/`convex run` 两次只一条 commitment），记 D3 时间戳（P5、P9、M1）。
- 三个挑战场景各再彩排一次（队长或 D 出题，A 操作）；provider 改单条价格（有余力）；prompt caching；usage 写 agentTurns（P18、P13、P14）。
- D（22:00 前）：runbook（两种模式）、G 表补 fixture/步骤/标准/证据四列、密钥扫描预演、README 面向评委版提纲（M7、M3）。
- 22:00：D（提交负责人）先睡至 02:00。
- **01:00 检查点（L1）**：全链路通过。未通 → 冻结在 L0，Devpost 按 L0 如实写。
- 01:00–02:00：只做 L1 收尾和阻断演示的 bug 修复，不开新功能；02:00 进入冻结。
- **2 人版**：22:00–23:00 任一人先睡 3 小时，另一人继续；01:00 检查点改 02:00。

### 02:00–06:00 冻结、错峰睡眠、录制
- 02:00 功能冻结；此后只修 bug、录视频、写赛道段落、改 README；演示期间禁止部署新功能（P14）。
- 班次（任一时刻至少一名能修 bug 的人和一名能部署的人醒着）：A 02:00–02:45 录正式视频（关键时刻开场，标注 recorded 段落），03:00–06:00 睡；C 02:00–05:00 值守修 bug，05:00–08:00 睡；B 在 L1 达成后睡到 04:00，04:00 起值守并掌握部署；D 02:00 起写旁白剪辑、README 评委版（M3）、Known limitations、四赛道各 20 秒插段、Open decisions 收尾、答题卡（P16、P12）。
- **2 人版**：Y（A+D，负责提交）00:00–03:00 睡；X（B+C）03:00–06:00 睡；Y 06:00 起做提交，X 06:00 起值守。

### 06:00–08:00 提交
- 06:00 密钥扫描 → owner 转公开（若规则要求或团队同意；owner 需在线）；所有链接无痕窗口验证并记时间（M3）。
- 06:00–07:00：README 定稿并合并；Devpost 四赛道段落与 real/simulated 声明；视频 07:00 前 unlisted 上传。
- 07:00–07:30：README 合并后打 tag `devpost-final`，`pnpm backend:deploy` 到演示部署并部署前端同一 commit，停掉所有指向演示部署的 `convex dev`（M3）。
- **07:30 提交完整版**；08:30 队长检查确认页；08:00–09:00 只改 Devpost 文案和链接验证，代码只在发现阻断演示的 bug 时修补，并在 09:00 前重新打 tag 部署（P2、gap4-07）。
- **2 人版**：同上，Y 提交，X 08:30 复核。

### 09:00–10:30 评审准备
- 三个浏览器 profile 分别登录 Customer/Provider/Finance，顶部色块；`resetDemoRoom(pending_approval_v2)` 一次，计时"重置到三窗口刷新"；完整计时彩排 2 次（含一次"中途失败 → 切录屏"）；手机热点就位；"脚本房间"与"挑战房间"分开（P12、M8、P18）。
- **2 人版**：Y 讲述 + Q&A，X 操作三窗口 + 救场；彩排 1 次。

### 10:30–12:30 现场评审
- 分工：Speaker（英文）、Driver（一台笔记本三窗口）、Recovery（dashboard、reset、切录屏）、每赛道 Q&A owner；每组评委之间 Recovery 执行 reset；评委出新场景用挑战房间（P16、P18、P12）。
- 不在评审期间部署任何代码（P14）。

### 4 人与 2 人版本的差异汇总
| 项 | 4 人 | 2 人 |
|---|---|---|
| 角色 | A/B/C/D + 队长兼 D | X = B+C，Y = A+D；Y 兼队长与提交 |
| 必须先做 | P1、P2、P3、P6、P7 同上 | 同上，但 S1–S5 压到 45 分钟并直接用默认值 |
| 直接砍 | README.md:262 的 P1 清单全部（event-budget、diff、下载变更单、成本展示）、metrics 仪表盘、并发压测 | 以上 + 邀请 UI（seed 写 members）、brief 抽取（表单）、四页并两页、provider 改价、第二 fixture 变体、convex-test、Microsoft 访谈（最多 1 人 15 分钟）、Mana 只做 fixture/校验器一次并存链接（12:00 不通即放弃）、看门狗、度量脚本 |
| 协商 | 1–2 轮，三方真实调用，customer/finance 并行 | 1 轮，provider + customer 真实调用，finance 确定性 + 模板，Devpost 写 "two LLM agents + deterministic finance policy" |
| 升级结构 | P19 轻量版（候选 proposal） | needs_input 事件 + 文本框 |
| 里程碑 | 14:00 / 20:00 / 01:00 / 02:00 冻结 / 07:30 提交 | 15:00 / 20:00 / 02:00 / 03:00 冻结 / 07:30 提交 |
| 睡眠 | D 22–02；A 03–06；C 05–08；B L1 后至 04:00 | Y 00–03；X 03–06 |
| 现场 | Speaker、Driver、Recovery、4 名 Q&A owner | Y 讲 + 答问，X 操作 + 救场 |

---

## 7. 审查覆盖说明

- **六个视角**：产品与赛道策略（product-01..25）、架构与数据模型（architecture-01..25）、安全/隐私/资金正确性（security-01..26，另 1 条被推翻）、代码与工程链（code-01..25，其中 2 条被推翻）、文档一致性与可信度（docs-01..26）、团队流程与执行计划（process-01..25）。共 152 条发现：141 条 confirmed、8 条 verdict 为 uncertain（列入第 3 节待核实表）、3 条 refuted。
- **四个盲区补查**：本机 Role A 分支与审查基线的关系（gap1-01..08）、`@anthropic-ai/sdk` 1.1.0 与模型约束（gap2-01..08）、run 编排 build-vs-adopt（gap3-01..08）、评审当天两小时的运营（gap4-01..08）。共 32 条，均已核验（2 条 uncertain）。
- **代理数量与流程**（按输入字段推断）：每个视角由两名独立审查者产出、一名合并者去重并逐条核对引用、一名审计员复核 verdict/严重度/建议可行性，合计约 24 个代理；四个盲区各一名补查代理加核验；一名批评者给出总体评价；本报告由综合者产出，红队复核者按本记录修订。严重度字段以审计员的 `severity_adjusted` 为准，建议以 `suggestion_fix` 为准。
- **验证方式**：所有代码引用按文件:行号核对；README 引用按行号和原文片段核对；用仓库自带 zod 4.6.7 复现契约行为（safeParse）；用仓库自带 tsc 6.0.3 探测哪些非法参数能过类型检查；用仓库 esbuild 0.27.0 按 Convex 参数打包 agent 入口；用 Node 24 `node --test` 验证零依赖测试路径；在 scratchpad 模拟 `git merge` 复现 unrelated histories 冲突；本机实跑 `pnpm install --frozen-lockfile`、`pnpm check`、`next start`、`next dev`（副本）、`env:check`、pnpm 配置读取；读取 node_modules 中 Convex 1.48.0（scheduler、registration、CLI 命令）、`@anthropic-ai/sdk` 1.1.0（client、parser、transform-json-schema、types）、Next 16.4.3 文档、Clerk 组件源码；`npm view` 核对 `@convex-dev/workflow`/`agent`/`action-retrier`、ai、next、@clerk 的版本与发布时间；WebFetch 核对 Clerk 测试邮箱/Device Trust 文档、Convex Agent/Workflow 文档、Cal Hacks 5.0 旧规则；用 `stat`/quarantine 属性还原 zip 下载与提交时间线。
- **已知局限**：
  1. 审查基线是 GitHub main 于 01:31 PDT 的快照；仓库私有，01:31 之后 main 是否变化、CI 实际运行状态无法核实。
  2. 本机 Role A 分支只在盲区补查中做了部分核对（gap1-06/07/08），没有经过完整的 code/architecture/security 审查。
  3. 以下外部事实无法本地核实：评审形式与来访组数、奖项能否叠加、Mana 额度与访问、Devpost 对代码可见性和赛前代码的规则、官方 hacking start 时间、Clerk 生产实例的域名要求与 Device Trust 行为、Convex 默认环境变量对已有 dev deployment 是否生效、Vercel 对私有仓库非 owner 提交的限制、赞助商原始评分规则（只看了 README 的转述）。
  4. 实际模型延迟、thinking 开销和成本未测（ANTHROPIC_MODEL 未定且 hold 禁止消耗额度），相关秒数和美元估算均为推算。
  5. 本机 Node 为 24.21.0，与 `.node-version` 的 24.19.0 不同；运行时验证未在 24.19.0 上复跑。
  6. Convex 打包器是否解析根 tsconfig 的 `@/` 别名、Claude 结构化输出是否接受根级 anyOf、convex-test 是否模拟并发，均未实测，报告中已按"避开"处理。
  7. 部分交叉引用（如某发现引用另一视角的编号）无法在仓库内核实，只影响措辞不影响结论。
  8. 红队复核只重新核对引用、口径与一致性，没有重跑任何命令；对 Role A 检出目录只执行只读的 git 命令，未改动文件、未触碰 dev 进程。

---

