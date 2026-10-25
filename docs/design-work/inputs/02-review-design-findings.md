# 02 审查设计发现（索引）

> 本文是 41 个代理审查中与系统设计有关的发现，按任务书第 5 节的设计文件编号归类。正文分 13 片，每片 ≤ 12,000 字节；读法、来源与丢弃范围见 part1 第 0 节。条目编号 Fxx.y 中 xx 对应设计文件编号。

| 设计文件 | 分片 | 条目 |
| --- | --- | --- |
| 00 / 01 产品 | part1 | 0.1 保留原则、0.2 被推翻论点、F01.1–F01.5 |
| 02 领域模型 | part2 | F02.1–F02.9（含不变量 I1–I10） |
| 03 schema | part3、part4 | F03.1–F03.17 |
| 04 状态机 | part4 | F04.1–F04.7 |
| 05 协议 | part5 | F05.1–F05.7 |
| 06 规则引擎 | part6 | F06.1–F06.8 |
| 07 权限与隐私 | part7 | F07.1–F07.10 |
| 08 审批与执行 | part8 | F08.1–F08.6 |
| 09 约束变更 | part8 | F09.1–F09.4 |
| 10 代理运行时 | part9、part10 | F10.1–F10.17 |
| 11 架构 / 12 API / 13 前端 | part11 | F11.1–F11.5、12 函数表、F13.1–F13.4 |
| 14 场景 / 15 运维 | part12 | F14.1–F14.5、F15.1–F15.4 |
| 16 测试 / 17 路线 / 18 开放问题 | part13 | F16.1–F16.5、17 扩展点、18 开放决定 14 项与待验证清单 |

文件：`02-review-design-findings-part1.md` … `02-review-design-findings-part13.md`（同目录）。

## 设计者最先要知道的事

1. 两个真正的技术 blocker：价格无法锚定到已确认目录（F02.1、F06）；constraintsVersion 何时递增没有定义（F09.1）。
2. 模型只输出 action、itemKeys、deliveryDate、rationale 等；金额由目录求和，sourceRefs 由代码推出，身份与版本由服务端信封注入（F05.1–F05.2）。
3. 对他方可见的文本只由模板从结构化字段生成；模型自由文本只给本方，且不进其他代理上下文（F05.3）。
4. 预算单独成表；已承诺金额由 commitments 台账汇总，基线是一条 simulated commitment（F02.3–F02.4）。
5. 预算可见性推荐按买方/卖方划分；provider 窗口不能出现可反推已承诺额的总数（F07.1）。
6. 审批绑定 (proposalId, constraintsVersion)，同 (proposal, user) 只留最新决定；必需角色是代码常量并快照；完成判定按集合、要求不同 userId（F08.1–F08.2）。
7. 执行在最后一次审批的同一 mutation 内：状态守卫为主、`exec:${proposalId}:${constraintsVersion}` 为辅，同事务写变更单、承诺、任务（F08.4）。
8. 审批/执行守卫与回合持久化守卫是两组，不能混用（F04.2）。
9. updateBudget 的完整事务步骤与"阻断读取时派生"（F09.2–F09.3）。
10. scheduled action 至多一次不重试：try/catch + completeTurn/failTurn/retryTurn + 看门狗；重试只由一层负责（F10.1–F10.4）。
11. 模型请求只用所有目标模型都接受的形状；thinking 计入 max_tokens，parsed_output 为 null 不报错，必须查 stop_reason（F10.10–F10.12）。
12. 升级给人由代码决定，问题与选项由代码生成，answerRequest 只能由目标角色的人调用（F05.6）。
13. Role A 分支两个缺陷不得复制：只比版本号的"约束检查"、把整份状态发到浏览器再过滤（F06.4、F07.2）。
14. 14 项开放决定与一批待验证的平台事实（part13）。
