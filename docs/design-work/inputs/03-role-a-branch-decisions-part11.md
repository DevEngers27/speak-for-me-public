# 03 Role A 分支决定 · part11：§9 缺陷总清单

> 来源栏：审查 id 来自 41 代理审查（findings.json）；"新发现"是本次通读代码发现、审查未覆盖的问题。位置相对 src/，lib/workspace 简写为 lw/，components/workspace 简写为 cw/。严重度按"照搬进新设计会造成的后果"评估。每条都应在新设计中有对策，并在 16 号文档中有回归测试（§10.2）。

## 9.1 高（违反不可动摇的核心）

| id | 缺陷 | 位置 | 违反的核心 | 来源 | 对策所在文档 |
| --- | --- | --- | --- | --- | --- |
| RA-B03 | "same shapes" 迁移说明：useWorkspace 返回含全员简报、报价价格、私密事件的全量 state，照做就是把私密数据发到浏览器再隐藏 | lw/preview-store.ts:76；lw/types.ts:3-4、75-86；README diff:112 | 1 私密委托 | gap1-08 | 07 读模型、12 查询签名 |
| RA-B01 | "Matches current constraints" 只比较 constraintsVersion；必需范围、截止日从不检查，按演示脚本可执行违反客户硬约束的方案（已复现） | lw/rules.ts:36-41、20-47 | 4 代码负责校验 | gap1-07 | 06 检查集、14 场景规则 |
| RA-B02 | saveBrief 修改硬约束或报价不递增 constraintsVersion（只有 changeBudgetCap 递增），旧审批继续有效 | lw/preview-store.ts:162-195、298 | 3 人批准具体版本 | gap1-07（核实结论） | 09 递增点清单 |
| RA-B04 | 没有来源核对：提案的价格、范围、日期从不与引用的已确认报价比对；报价在提案后被改价，旧提案照样可批、可执行 | lw/rules.ts:20-47；lw/preview-store.ts:177-181 | 4 | 新发现 | 06 sourceMatch 检查、03 offer 版本 |
| RA-B05 | 简报原地覆盖，旧版本丢失；sourceRefs 是 "Provider brief v1 · option: Phase 1" 这样的字符串，v2 之后无法解析 | lw/preview-store.ts:177-181、229；fixture.ts:68、75 | 6 历史不可篡改 | 新发现（相关 architecture-21） | 02/03 briefVersions、offer 引用 |
| RA-B08 | 预算上限与已承诺放在 room 上全员可见；四类房间事件把上限、剩余额、合计写进全员文本 | lw/types.ts:17-18；lw/preview-store.ts:156、213、301、323；cw/workbench.tsx:181-203；cw/room-list.tsx:63 | 1 | architecture-01、code-02、docs-03、product-09 | 07 披露矩阵、§8.2 受众渲染 |
| RA-B24 | 简报页写 "Option prices stay private until a proposal uses one"，只在 UI 层成立，数据在共享 state 里 | cw/brief-page.tsx:31 | 1（声明失实） | gap1-08 | 07、13 文案纪律 |

## 9.2 中（破坏一致性、可追溯性或流程完整性）

| id | 缺陷 | 位置 | 影响 | 来源 | 对策 |
| --- | --- | --- | --- | --- | --- |
| RA-B06 | approve 删除同一用户对同一版本的旧拒绝（UI 点不到，存储逻辑允许） | lw/preview-store.ts:253 | 核心 6 | 新发现 | 08 decisions 只追加 |
| RA-B07 | 上限变化后复制 revalidated 版本：冗余递增，且 sourceRole 记为 provider、实际操作者是 finance | lw/preview-store.ts:306-316 | 可追溯性 | gap1-06 | 09 不复制提案 |
| RA-B09 | committedCents 是可变计数；检查结果随时间变化；对比表与结果页用减法推"执行前"，隐含一房一承诺 | lw/preview-store.ts:124；cw/workbench.tsx:144-145；cw/results-page.tsx:27 | 核心 5、6 | security-04 | 08 ledger 与执行快照 |
| RA-B11 | 没有日期语义：不查截止日、不查过去日期；fixture v1 交付晚于客户截止，却只报超预算 | lw/rules.ts:21-24；fixture.ts:36、67 | 核心 4 | security-22、gap1-07 | 06、14 |
| RA-B12 | bestFeasibleOption 按范围条目数选，可能选中只含可延后项的报价 | lw/rules.ts:74-78 | 核心 4 | gap1-07 | 06 findFeasibleOffers |
| RA-B16 | 拒绝是死路：没有理由，不触发后续；同一最优报价不能重提，只能靠改简报或改上限退出 | lw/preview-store.ts:217-221、266-285 | 流程 | 新发现 | 04、05 拒绝后续 |
| RA-B17 | status 由各动作手工赋值，会与数据漂移；paused、failed 从未使用 | lw/preview-store.ts 各动作；lw/types.ts:7 | 一致性 | architecture-17 | 04 分层与派生 |
| RA-B20 | 事件模型过松：action 自由字符串、proposalVersion 必填、可见性组合非法、预渲染文本、客户端过滤 | lw/types.ts:63-73；cw/results-page.tsx:21 | 核心 1、6 | architecture-20 | 03、07 |
| RA-B21 | 报价 confirmed 是客户端勾选框，无确认人与时间；编辑后仍保持 confirmed；房间确认后仍可保存简报 | cw/brief-page.tsx:112；lw/preview-store.ts:162-195 | 核心 4 | 新发现 | 03 offers、04 守卫 |
| RA-B22 | 任意角色建房并输入上限与已承诺基线，基线没有来源 | lw/preview-store.ts:138-149；cw/room-list.tsx:91-92 | 核心 4 | 新发现（相关 product-09） | 07、09 |
| RA-B29 | 按 fixture 数字，降到 $4,800 后没有任何可行的已确认报价 | fixture.ts:49-50 | 场景可演示性 | gap4-02 | 14 |

## 9.3 低（质量、卫生、文档）

| id | 缺陷 | 位置 | 来源 | 对策 |
| --- | --- | --- | --- | --- |
| RA-B10 | 两套日期校验不一致：saveBrief 接受 2026-02-30（滚动成 03-02），`z.iso.date()` 拒绝，报价永远过不了 terms 检查（zod 4.6.7 实测） | lw/preview-store.ts:174；lib/negotiation.ts:8 | 新发现；architecture-24 | 06 共享 validator |
| RA-B13 | deferredScope 用报价范围并集计算，未被任何报价覆盖的请求项会消失 | lw/preview-store.ts:222-223 | 新发现 | 06、14 |
| RA-B14 | 规则选出的提案 sourceRole 写死 "provider" | lw/preview-store.ts:226、309 | gap1-06 相关 | 03 authorKind |
| RA-B15 | 任意角色可在三份简报未全确认时触发出提案 | lw/preview-store.ts:199-206 | 新发现 | 04 开始协商守卫 |
| RA-B18 | 必需审批人在检查时动态读取，没有快照 | lw/rules.ts:58 | 新发现 | 08 |
| RA-B19 | 执行生成的任务在审批时不可见 | lw/preview-store.ts:120-123 | security-04 | 08 记录预览 |
| RA-B23 | 共享条目从未展示给他方，没有共享事实通道 | cw/brief-page.tsx:19、28-31 | 新发现 | 07 sharedFacts、13 |
| RA-B25 | 每次重复执行请求都写一条房间事件，任何成员可刷屏 | lw/preview-store.ts:340-343 | 新发现 | 08、15 |
| RA-B26 | 身份由角色推出，每角色一人 | lw/types.ts:105；cw/room-frame.tsx:31 | 分支自述为预览限制 | 07 Clerk 身份 |
| RA-B27 | README "Schema proposals" 漏列 privateBriefs 结构改动、confirmedAt、createdAt | README diff:112 | gap1-08 | — |
| RA-B28 | 产品界面写死演示提示 "Demo: lower it to $4,800 during approval." | cw/workbench.tsx:224 | 新发现 | 13 |
| RA-B30 | 旧拒绝在审批面板显示为 pending，而不是 stale | lw/rules.ts:64-66 | 新发现 | 08、13 |
| RA-B31 | localStorage 跨标签页的"读 → 改 → 写"不是原子的，两标签页并发操作可能互相覆盖 | lw/preview-store.ts:64-69 | 新发现（仅说明为何需要服务端事务） | 11 |

## 9.4 不纳入本清单的审查发现

gap1-01 至 gap1-05、gap4-03、gap4-08 讨论的是快照基线、未提交与备份、hold 流程、Mana 赛道证据、现场演示模式与重置手册，属于黑客松治理与现场运维，按任务书不进入新设计。只保留其中一条设计含义：演示 / 种子数据必须标注 simulated，且 seed / reset 是正式的运维功能（RA-U14）。
