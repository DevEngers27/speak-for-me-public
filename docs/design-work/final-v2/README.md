# final-v2 目录索引

| 文件 | 内容 |
| --- | --- |
| 00-canon.md | **法律**：§1 术语与命名表（实体 / 表 / 字段 / 状态 / 动作 / reasonCode / 函数名与事务 helper 名，含废弃别名）；页首列出 canon 包修订的改动面 |
| 00-canon-part2.md | §2 关键决定裁决表 A：D01 编排、D02 审批、D03 执行键、D04 执行后房间、D05 递增矩阵、D06 约束变化后 run、D07 守卫与 reconcile、D08 串行评估、D09 模型输出路径、D10 optionKey、D11 派生字段过披露 |
| 00-canon-part3.md | §2 裁决表 B：D12 fit 信号与预言机政策（含节流桶）、D13 公共文本（含拒绝理由的受众）、D14 事件可见性、D15 人工请求（含 `pass_to_next` 与 `keep_as_is` 按 kind）、D16 日志纪律、D17 上限与排空、D18 seed/reset、D19 前端 |
| 00-canon-part4.md | §2 裁决表 C：D20 依赖版本、D21 仓库布局、D22 时间、D23 预算低于已承诺、D24 成员与邀请、D25 提案不可变与 termsKey、D26 v1 范围、D27 fixture；用户决策清单 U1–U12 |
| 00-canon-part5.md | §3 已知冲突清单与裁决 C1–C42，章节定稿后新裁决的 C43–C60；对三份草稿的逐项处置摘要 |
| 00-canon-part6.md / -part7.md | §4 各章底稿（base_files）、必读素材（files）与必须吸收的要点（must_absorb），00–09 / 10–18 |
| 00-invariants.md … -part11.md | 不变量总表 INV-01…79 与 INV-M1（part2–part6）与反例电池 CE-001…170（part7–part11）、覆盖矩阵、开放问题；canon 对齐版，**INV / CE 编号的全仓单一来源**（canon C43），16 章新增反例从 CE-171 起 |
| 00-product-decisions.md / -part2.md | 产品决策备忘录（限时草稿，写于 canon 之前；各条标题下注明 canon 处置，逐条对照见 part2 末节；各章以 canon 为准） |
| 00-overview.md … 18-decisions-open-questions.md | 按任务书 §5 结构撰写的最终设计（须与 canon 一致） |
| _fix/ | 修订轮的问题清单与各包处置记录（`<包名>-log.md`）；canon 包的记录是 `_fix/canon-log.md`，跨章一致性核对的记录是 `_fix/xcheck-log.md` |
| 99-review-log.md … -part7.md | 修订轮处置总表：九个包全部 issue 按 id 排序的处置与位置、跨章核对阶段的 Xnn 索引与修正清单、未解决项（最后一个分片末尾） |

优先级：任务书 > canon > inputs/05 > inputs/04 > 专题 > 候选 > techstack / spike 原文。各章写作者在动笔前必须读完 canon 全部七个分片，以及 part6/part7 为本章列出的 base_files 与 files。

## 开放问题（需用户决策，默认值已写入 canon part4）
1. U1 `customerSeesBudget` 默认关。
2. U2 provider 只见 `ok` / `blocked`。
3. U3 v1 一房一执行，后续变更开 `startFollowUp` 新房间。
4. U4 评估回合串行（每轮约 3 次串行调用）。
5. U5 全 Opus 5.5、协商 effort medium；月预算 dev $100 / prod $300。
6. U6 第二场景契约测试用 `procurement_rfq`。
7. U7 审批可撤回本人 approve、不过期。
8. U8 一人不兼任两角色。
9. U9 Convex Pro / Vercel Pro + 域名 / Axiom 采购。
10. U10 ESLint 10 升级时机。
11. U11 spikes §8 的 18 项真实部署验证由谁、何时做。
12. U12 产品名。
