# 03 Role A 分支决定 · part12：§10 对最终设计的要求、回归测试、开放问题

## 10.1 按最终设计文档编号整理的吸收要求

| 文档 | 必须吸收（来自本分支的想法） | 必须修正（来自本分支的缺陷） |
| --- | --- | --- |
| 02 领域模型 | 用户确认的结构化报价；提案 origin；deferredScope；拒绝作为一等记录；operationId；两个版本计数；简报"硬约束 / 偏好 + 逐条披露" | participant 与 user 分离；offer / scopeItem 实体；briefDraft / briefVersion；约束快照；提案不可变内容 + contentHash；decisions 单表；execution / changeOrder / commitment / task；humanRequest；结构化事件 |
| 03 schema | Role A 的字段名可作词汇参考（goal、deferredScope、confirmedAt、approvalRequired） | operationId 与 (roomId, version)、(roomId, offerKey, version) 的唯一性落点；金额整数约束；枚举与 Zod 单一来源（RA-B10） |
| 04 状态机 | Role A 迁移表（§6.7）作为起点；"最后一票即执行"；confirmed 不可修改 | 房间 / run / 提案 / 决定 / 人工请求分层；派生而非手工赋值；开始协商的守卫；拒绝后续（RA-B15、RA-B16、RA-B17） |
| 05 协议 | 代理消息"没有就空着"；代理建议永远不是批准 | 代理只能选择 offerRefs，不能填价格、范围、日期；recommend_accept 不写入 decisions |
| 06 规则引擎 | 检查清单形状、批准前与执行前双调用点、预算不变式、describeChange、可行性判定由代码完成 | reasonCode 检查集（§5.2）；sourceMatch；日期语义；findFeasibleOffers（§6.3）；共享 validator |
| 07 权限与隐私 | 逐条披露；他方简报只见版本与确认时间；私密事件只给本人；公共文本模板化 | 按查看者裁剪的读模型（§4.8）；预算与事件金额的披露矩阵；报价"被引用即公开"的显式声明；错误信息纪律；私密约束违反时对他方显示什么（Q3） |
| 08 审批与执行 | 双版本绑定与 stale 展示；approve 要求检查通过；幂等执行与重复请求不重复写 | 绑定 proposalId + constraintsVersion + contentHash；撤回 = 追加；必需审批人快照；执行快照；记录预览；重复请求返回幂等结果 |
| 09 约束变化 | finance 专属改上限、不得低于已承诺、任何变化递增版本、超限立即阻断 | 递增点清单（§3.3）；不复制提案（RA-R11）；约束变化后的统一流程（§6.1）；上调预算的处理（Q7） |
| 10 代理运行时 | 规则选出的方案如实标注 | stub 模式用 findFeasibleOffers 作确定性替身，authorKind = "rule" |
| 13 前端 | 四页面 IA、待办置顶、提案卡、对比表、审批面板、结果页、可访问性细节（§7） | 去掉 Preview as、重发执行、Check confirmed options、demo 文案；新增邀请、humanRequest、run 进度、共享事实、记录预览 |
| 14 场景 | 数字 $5,000 / $4,000 / $1,400 / $900 / $4,800；三方简报的共享 / 私密混合；v1 超预算、v2 可行 | 具体范围目录与日期；硬约束结构化；降到 $4,800 后的可行路径（§8.1）；v1 同时违反截止日 |
| 15 运维 | 种子数据相对时间、可重置 | seed / reset 是运维工具，不在产品界面；重复执行计数进日志 |
| 16 测试 | 演示脚本可以直接改写成端到端用例 | §10.2 回归清单 |

## 10.2 由缺陷导出的回归测试（建议写入 16 号文档）

1. **RA-B01**：上限 $4,800、已承诺 $4,000，provider 确认报价 {item 3, $700, 2026-12-20}。该报价必须报出 requiredScope 与 deadline 两个 reasonCode，不可批准、不可执行。
2. **RA-B02**：两方已批准后，customer 确认新简报版本把截止日提前。约束版本 +1，两条审批变为 stale，执行被拒。
3. **RA-B04**：提案引用 offer v1 后，provider 确认 offer v2（改价）。旧提案在新约束版本下报 sourceMatch 或 offer superseded，不可执行。
4. **RA-B03 / RA-B08 隐私金丝雀**：在 provider 报价价格、finance 上限、customer 私密截止日中放入独特金丝雀值。以 customer 身份调用全部查询，返回值中不得出现另两方的金丝雀；房间事件渲染文本中不得出现上限数字。
5. **RA-B06**：同一参与方先拒绝、后撤回、再批准。三条 decision 都保留，当前决定为 approve。
6. **RA-R11**：降上限后当前提案仍可行。不产生新提案版本；旧审批 stale；对同一 proposalId 重新批准后可以执行。
7. **RA-R08**：并发提交最后两票，以及对同一 operationId 重复调用执行。只有一条 execution、一条 commitment、N 条 task；重复调用返回同一 executionId，不新增房间事件。
8. **RA-B10**：报价日期 2026-02-30 在保存时就被同一个 validator 拒绝。
9. **RA-F03**：fixture v1 同时报出 budget.over 与 deadline.violated。
10. **RA-B15**：任一必需简报未确认时，不能开始协商、不能产生提案。
11. **RA-B09**：已执行提案的预算展示读执行快照。之后同一预算再有新承诺，旧变更单显示的"执行前 / 后"不变。
12. **RA-B16**：带理由的拒绝会产生一个重新协商 run 或一条 humanRequest，房间不会停在无出路的状态。
13. **RA-R05**：提案创建后新增一名必需审批人，视为约束变化，原有"全员已批准"失效。
14. **边界**：报价恰好 $800、已承诺 $4,000、上限 $4,800，判定为预算内。
15. **RA-B30**：约束变化后，旧拒绝显示为 stale_reject，而不是 pending。

## 10.3 开放问题（交给设计者在 18 号文档中裁决）

| id | 问题 | 背景 |
| --- | --- | --- |
| Q1 | 他方能否看到预算金额、超出额，还是只看结论？ | RA-D02、RA-T03；原 README 把剩余预算列为 finance 私密输入 |
| Q2 | 一房一预算，还是项目级预算账户被多个房间共享？ | RA-D02；共享时执行事务要锁 budget 级不变式 |
| Q3 | 私密硬约束（例如未共享的截止日）不满足时，对他方显示什么？ | RA-R02；reasonCode 本身也会泄露信息 |
| Q4 | 报价何时由私密转为公开？provider 确认时是否必须看到提示？ | RA-D07 |
| Q5 | 是否把"条款签核"（provider）与"预算承诺"（finance）拆成两类审批？ | RA-R05；product-21 |
| Q6 | 审批撤回：是否允许、是否需要理由、截止到何时？ | RA-R16 |
| Q7 | 上调预算是否自动触发寻找更优方案的重新协商？ | RA-R10 |
| Q8 | 取舍请求同时发给三方还是按顺序发？ | RA-R13 |
| Q9 | 延后范围在执行后是否生成后续变更占位？ | RA-D11 |
| Q10 | 任务模板是否纳入被批准内容（contentHash）？ | RA-D14 |
| Q11 | seed 能否直接写入"已有审批"等中间状态，还是必须经过真实 mutation？ | RA-F03 |
| Q12 | 修改 goal 是否算约束变化？ | RA-D01 |
| Q13 | 一个角色席位是否允许多名用户（例如两名 finance）？ | RA-D05 |
