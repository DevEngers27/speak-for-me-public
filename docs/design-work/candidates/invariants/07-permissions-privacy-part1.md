# 07 权限与隐私 · part1：认证与授权、席位授予、披露模型、字段 × 角色矩阵

## 1. 认证 ≠ 授权（P-10、F07.3）

- **认证**：Clerk 签发会话 token，`ConvexProviderWithClerk` 把它交给 Convex；`convex/auth.config.ts` 以 `CLERK_JWT_ISSUER_DOMAIN` 为 domain、`applicationID: "convex"`，缺变量即抛错（fail-closed，inputs/04 §3.2）。
- **身份映射**：`requireViewer(ctx)` 取 `identity.tokenIdentifier` → `users`（ID-1）。首次进入应用时客户端调用 `users.ensure`（幂等 upsert）。query 未认证返回 `null`；mutation 未认证抛 `ConvexError({ code: "UNAUTHENTICATED" })`。
- **授权**：完全在 Convex 函数里按 `participants` 判断：`requireParticipant(ctx, roomId, { open?: true, role?: RoleKey })`。Next 的 `proxy.ts` 只做"未登录跳转登录页"的乐观检查，不是授权（inputs/04 §3.5）。
- **被调度函数没有用户身份**：所有 internal 函数不做鉴权，因此鉴权必须在调度它们的公共 mutation 里完成；internal 函数参数里的 `actorUserId` 由该公共 mutation 写入（inputs/04 §1.7）。
- **配置缺失**：开发环境缺 Clerk/Convex 配置时显示"Backend not configured"页面；不存在任何"未认证也能读写"的路径，因为 Convex 侧 `getUserIdentity() = null` 一律拒绝。

## 2. 席位授予（解决 GAP-17、F07.9）

1. 建房：`rooms.create({ title, goal, timeZone, ownerRole })`，创建者成为房主并占据自选角色（一般是 customer）。创建策略由环境变量 `ROOM_CREATION_POLICY = any_signed_in | allowlist` 控制，另有每用户 open 房间上限（默认 20），防止滥用模型调用。
2. 邀请：房主对每个空缺角色调用 `invites.create`（action，生成 32 字节随机 token，只存哈希，明文只返回一次，有效期 7 天）。房主通过任意外部渠道把链接 `/invite/{token}` 交给对方；v1 不发邮件（17）。
3. 接受：`invites.accept({ token })`（action 计算哈希后调用 internal mutation `acceptByHash`）在这一个 mutation 内检查 ID-3、ID-4、ID-6，插入参与方并把邀请标为 accepted。角色只来自邀请行。
4. 一人一席（ID-4）使"三方均批准"必然来自三个不同的人；房主身份不带来审批权（ID-7）。跨组织成员无特殊处理：provider 是外部公司的人，只要持有邀请即可加入，看到的数据与其他角色一样受投影约束。
5. v1 不提供移除成员与转移房主（18 开放问题）。

## 3. 披露模型（核心 1 的落地）

**字段分类**（由场景 `FieldSpec` 声明，14 §2 给出完整清单）：
- 规则字段：确定性规则读取，改动 bump 约束版本；
- 软字段：只影响 info 检查与代理判断；
- 备注：自由文本，只进入本方代理上下文，**永不可披露**（避免把未经审视的长文本推给他方与他方代理）；
- 可披露：规则或软字段中被标为 disclosable 的，可由所有者逐项选择受众（`room` 或若干角色）。

**一个值对查看者 V 可见，当且仅当属于以下之一**（BR-4）：
1. V 是所有者本人；
2. 所有者在**当前**确认版本的 `disclosures` 中把该字段披露给了包含 V 的受众；
3. 下表列举的**策略性披露**之一，且所有者在确认简报时勾选了对应 acknowledgement（显式决定）；
4. 派生值，其 `requires` 中每个字段对 V 都满足 1–3（**派生闭包**）；
5. 存在位：某检查通过/失败、某请求选项"存在可行方案"、某回合失败的类别。

策略性披露（穷举，任何新增必须改本表与 16 的隐私测试）：

| # | 内容 | 受众 | 依据 / acknowledgement |
| --- | --- | --- | --- |
| P1 | 参与方的角色、显示名、是否已加入 | 房间 | 加入房间即同意 |
| P2 | 每方简报是否已确认、版本号、确认时间、是否改了规则字段及类别（scope / schedule / offer / budget） | 房间 | 同上；类别让各方理解"为什么旧审批失效" |
| P3 | customer 的 `requestedItems`（键、标题、描述） | 房间 | `requested_items_public`：请求本身是协商对象 |
| P4 | 被任一提案或 choose_package 选项引用的报价行（label、价格、最早交付日、taskTitle，以引用时的快照为准） | 房间 | `offer_lines_public_on_use`（Role A Q4） |
| P5 | 每个提案每项检查的 status 与 reasonCode（不含参数） | 房间 | `check_outcomes_public`：审批人必须知道为什么不能批准 |
| P6 | 代理动作：动作类型、选择的行/项、counter 的 include/exclude、reasonCode | 房间 | `agent_moves_public`：委托代理协商即授权它做结构化动作 |
| P7 | 人工决定：角色、kind、版本、reasonCode；note 仅当作者勾选 notePublic | 房间 | 决定时的显式选择 |
| P8 | 执行：编号、提案、金额、任务 | 房间 | 执行是共同结果 |
| P9 | run 与回合状态、失败类别 | 房间 | 运行透明 |
| P10 | 某角色有待回答的请求（不含选项与原因参数） | 房间 | 让他方知道在等谁 |
| P11 | 取舍选项中的存在位（"若把 X 改为可延后则存在可行方案"） | 请求目标 | 取舍必需的最小信息 |
| P12 | 本房间模型调用次数与估算成本合计 | 房间 | 成本透明（FX-04） |

**已接受的残余推断风险**：provider 反复提案并观察 OVER_BUDGET 存在位，理论上可二分逼近余量；轮次上限（每 run 3 轮）与房间调用预算把它限制在少数几次，属于真实谈判中"太贵了"信号的同等信息量（18 ADR-08）。

## 4. 字段 × 角色矩阵（scope_change；A = 总是，D = 仅当所有者披露给该角色，C = 派生闭包，— = 永不，本 = 所有者）

| 字段 / 派生量 | customer | provider | finance |
| --- | --- | --- | --- |
| customer.requestedItems | 本 | A（P3） | A（P3） |
| customer.requiredItemKeys | 本 | D | D |
| customer.deadline | 本 | D | D |
| customer.preferredDate | 本 | D | D |
| customer.notes | 本 | — | — |
| provider.offerLines（未被引用的行，或被引用行的当前值） | D | 本 | D |
| provider.offerLines（被引用行的引用时快照） | A（P4） | 本 | A（P4） |
| provider.capacityNotes、notes | — | 本 | — |
| finance.budgetCapCents | D（表单默认预选"披露给 customer"） | D | 本 |
| finance.externalCommittedCents | D（同上） | D | 本 |
| finance.paymentNotes、notes | — | — | 本 |
| 余量、超出额、批准后已承诺总额 | C | C | 本 |
| `changeReason` | 本 / 若 changeReasonShared 则 A | 同左 | 同左 |
| 提案条款（行、金额、交付日、延后项） | A | A | A |
| 检查 status、reasonCode | A（P5） | A | A |
| 检查参数 | C | C | C |
| 决定（含 publicNote） | A（P7） | A | A |
| 执行编号、金额、任务 | A（P8） | A | A |
| 执行 budgetSnapshot | C | C | 本 |
| 代理 rationale、回合完整输出 | 仅本角色 | 仅本角色 | 仅本角色 |
| 人工请求的选项与参数 | 仅目标 | 仅目标 | 仅目标 |
| modelCalls 明细 | 仅本角色 | 仅本角色 | 仅本角色 |

各角色的代理看到的与其委托人完全相同（RN-6），外加委托人自己的完整简报。

**示例（预算下调后的同一检查，三方各自看到什么）**：
- finance："+$900 · Over budget: $4,900 committed after approval vs $4,800 cap (over by $100)"。
- customer（finance 按预设披露了上限与外部已承诺）：同上。
- provider："+$900 · Blocked: exceeds the finance limit"。provider 已知 $900，若看到 $4,900 就能反推已承诺 $4,000，所以 `committedAfterCents` 依赖 finance.externalCommittedCents 而对 provider 不可见（F07.1 的文案陷阱）。
