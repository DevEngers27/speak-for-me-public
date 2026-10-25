# 02 审查设计发现 · part7：07 权限与隐私

> 分片清单见 part1。

### F07.1 预算对谁可见：必须先拍板，且早于第一个 query
- 问题：README.md:239 说剩余预算是 finance 私密输入，`schema.ts:13` 却放在全员可见的 rooms 上；没有字段×角色、动作×角色矩阵。最自然的"整份返回 getRoom"会把 $5,000/$4,800 推到 provider 浏览器和 provider 代理上下文；简单隐藏又解释不了阻断原因。
- 建议方案（推荐：按买方/卖方划分）：finance 与 customer 同属采购方，可见数字；provider 永远不可见。所有角色都收到 `executable=false` 和 `blockedReasonCode='exceeds_budget'`，只有 finance/customer 额外收到 shortfallCents / headroomCents。provider 能由此推断"超预算"，这是可接受的最小披露，要在文档里写明。
- 文案陷阱：provider 窗口不能出现 "$4,900 被阻断"，provider 已知 $900，看到 $4,900 就能反推已承诺 $4,000。买方窗口显示 "+$900 change / $4,900 committed after approval / $4,800 cap / over by $100"，provider 只显示 "+$900 · Blocked: exceeds the finance limit"。
- 备选：把预算定义为 finance 授权共享的事实（finance 简报页默认勾选 "Share budget cap and committed spend with the room"），代价是改 README.md:239/:297 和越权用例。
- customer 代理可以看到预算，但它对他方的输出必须走模板（F05.3），否则买方代理自己就是泄露源。
- 来源：architecture-01、security-06、code-02、docs-03、product-09、process-14（P8、P7 第 2 点）。

### F07.2 服务端按角色投影，不把私密字段发到浏览器
- 设计要求：每个返回房间状态的 query 都经过 `projectRoomFor(role)`；Convex 没有字段级 ACL，投影是唯一防线。
- 建议方案：一个聚合的 `rooms.view({roomId})` 返回按角色投影的 DTO（声明 `returns`，见 F03.16），让各窗口拿到同一时刻的一致快照；另有 `rooms.listMine`、`briefs.mine`（只按 roomId + 当前用户查）、`turns.mine`（只返回本角色回合）。每个公共函数以 `requireMember` 开头。
- 反模式（Role A 分支）：`useWorkspace` 返回整个 WorkspaceState（全员 brief、报价、私有事件）再在浏览器按角色过滤，工作区 README.md:112 还说换后端只需"same shapes"。应拆成按角色裁剪的读模型：myBrief、roomSummary、briefStatuses（只含 version 与 confirmedAt）、publicEvents + myPrivateEvents。
- 来源：architecture-19、gap1-08、M9、P3 第 5 点。

### F07.3 认证 ≠ 授权；身份只从 ctx.auth 推导
- 业务函数不接受 userId 或 role 参数；`getViewer / requireMember / requireRole` 从 `ctx.auth` 取 tokenIdentifier，再查 members 得到角色。
- 约定：query 未认证返回 null，只有 mutation 抛错（M2）。
- 调度函数不继承用户身份，internal 函数绕过鉴权，所以授权检查必须落在公共入口；`requestNextTurn` 只收 roomId，调用者必须是成员，只能请求"轮到的"回合，不能指定替哪个角色跑，也不返回模型输出。
- proxy（Next 中间件）只负责界面跳转，授权在每个 Convex 函数里做；原 `src/proxy.ts` 缺 key 时放行（fail-open），与 auth.config 的 fail-closed 相反（L2）。
- 来源：security-09、M2、L2（code-18、security-23）。

### F07.4 动作×角色（审查给出的条目，07 需补全成矩阵）
- 预算上限和已承诺：只有 finance 能改（唯一写入口 updateBudget）。
- 目录价格：只有 provider 能改，改后需重新确认。
- 截止日与必需条目：只有 customer 能改。
- 各方只能改自己的简报；以上任何约束修改都 bump constraintsVersion。
- 只有 owner 能邀请；v1 不提供"移除成员"和"修改 approvalRequired"。
- 房主身份不带来审批权；创建房间限于允许名单（原 `ALLOWED_CREATORS` 环境变量；【改写】在产品里定义谁能创建房间）。
- 来源：P8、P18 第 3 点、security-05、M11。

### F07.5 代理上下文组装：单一入口、显式白名单
- 问题：谁的代理读谁的 brief 没有落点；按 roomId collect 整表再在 JS 里过滤是典型泄露点。
- 建议方案：`buildAgentContext(roomId, role)`（或 `internal.briefs.getForAgent({roomId, role})`）写成 internalQuery，返回显式白名单对象：本角色已确认的 brief、其他各方的 shareableFacts、公开提案的结构化字段、按 F07.1 规则投影后的预算；不 spread 整个文档。role 由服务端从 run 的下一个回合推导。代码审查清单禁止代理代码按 roomId 整表 collect。单测用 canary 断言 provider 的上下文 JSON 里没有 finance 的 canary。
- 来源：security-09、architecture-21、P10。

### F07.6 事件可见性
- 推荐：events 是全房间可见的公共时间线，只放模板文本或 reasonCode；角色私密细节放本来就按角色控制访问的表（budgetChanges 只给 finance，agentTurns 只给本角色，humanRequests 按 targetRole）。私密历史（brief 编辑、模型原文）不做成事件。
- 如果确实需要"仅部分角色可见"的事件：用判别联合 `{kind:'room'}|{kind:'roles', roles}`，读取时按索引分别取再在服务端过滤。在 query 函数内部过滤是安全的，危险的是把未过滤结果返回客户端。
- 来源：security-11、architecture-20（红队：与 docs-03 口径不同，见 18）。

### F07.7 共享事实需要逐项、结构化的披露决定
- shareableFacts 改为固定词表里的 `{field, value}`（如 deadline、requiredItemKeys），表单逐项标注 "This will be visible to other parties"；提交即确认。
- 来源：security-16、architecture-21（M6）。

### F07.8 日志与错误信息纪律
- 代理 action 不 `console.log` prompt、brief 或模型原文，只记 runId、turnSeq、token 数、latencyMs、errorCode；写进代码审查清单（"no console.log of briefs, prompts, or raw model output"）。
- 面向客户端的错误统一 `throw new ConvexError({ code: 'OVER_BUDGET' })`，消息不带数值；生产部署会隐藏非 ConvexError 的消息，多一层兜底。
- 可追溯性（谁在何时用了多少 token）靠 agentTurns 的结构化字段，不靠日志正文。
- 来源：security-17、architecture-08（P10）。

### F07.9 邀请与角色授予的威胁
- 若"知道 roomId 就能自选角色加入"，任何注册用户都能以 finance 身份进房、读预算、审批（Convex ID 会出现在 URL 里）；一人插三条 member 就能一人满足"三方均批准"。对策见 F02.6、F03.2、F08.2（不同角色必须不同 userId）。
- Clerk 侧：开发实例改 Restricted 注册并预建账号（免费版可用性待验证）。
- 来源：security-05、architecture-11（P15）。

### F07.10 威胁清单（审查覆盖到的）
1. 越权读：provider 直接查 finance 的 privateBriefs，或从 rooms.view/WebSocket 负载拿到预算。
2. 自选角色与一人多角。
3. 代理泄露自己委托人的私密值（主泄露路径）。
4. 跨代理 prompt injection（他方文本进入上下文）。
5. 公共文本、日志、错误消息里的数字。
6. 费用滥用：任何能登录的人反复触发模型调用（见 10 的上限与总开关）。
7. 导出文件的 CSV 公式注入（`= + - @ \t \r` 开头的单元格加 `'` 前缀，或只做页面/打印视图）。
8. 配置半残：proxy fail-open、格式错误的 key 让全站 500（审计员复测属实）。
- 来源：P8、P10、P15、M11、L2、L5（security-26）。
