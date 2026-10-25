# 06 · 外部研究结论（5 个方向，27+ 来源，2026-10-24）

> 完整报告：/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/README.md 与同目录各专题文件（negotiation-prior-art、approval-systems、convex-patterns、llm-safety-structured、hitl-ux）。本文件只列对设计有直接约束力的结论；与任务书核心冲突时以任务书为准。

## 协商协议先例
- 结构化提案与自由文本分离是通行做法；出价由确定性代码决定、LLM 只负责措辞时成交率显著提高（OG-Narrator 26.7% → 88.9%）。
- LLM 在多方协商中会算错分、提出不可执行方案、接受付不起的交易；参与方越多越难（3 方 90% → 6 方 33%）。**金额与可行性必须由代码判定。**
- 明确要求保密仍有 35–50% 泄露率；上下文最小化 + 封闭语言（只允许白名单键）能把泄露压到接近 0。
- 首提案偏置与锚定（最终价与首个报价 ρ=0.716）：开场候选由代码生成或轮换首发言方；多候选并排展示。
- 硬回合上限 + 显式终止条件 + 一个角色拥有终止前最终决定权；"未达成 / 需要人取舍"是一等结局。A2A 的中断态（INPUT_REQUIRED）与终止态（COMPLETED/FAILED/CANCELED/REJECTED，不可重启）可直接借用。

## 变更单与审批系统
- 审批绑定内容快照，内容一变即作废，不设容差（GitHub stale review、Oracle Fusion revision、SAP 容差的反例）。
- 金额用"基线 → 已批准累计 → 本次前 → 本次增减 → 新额"链表达（AIA G701），并记工期增减与新完工日。
- 承诺用只追加的分层账本（commit / release，带反向引用），available 现算不存储（PeopleSoft Commitment Control）。
- 幂等键保存首次结果并原样返回，同键不同参数报错（Stripe）。
- 审批行存角色快照、内容哈希、服务端时间；同一人不能满足两个必需角色（NIST AC-5）。任一 Reject 结束整轮；审批轮有任务级期限。

## Convex 生产模式、LLM 安全、人在环中 UX
- 见 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/research/README.md 的对应章节与"对设计文档的直接含义"（按 02–18 文件编号已合并去重，并标出与任务书或 inputs/04 冲突、需要设计者裁决的项）。
