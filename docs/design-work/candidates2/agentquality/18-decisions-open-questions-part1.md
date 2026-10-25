# 18 决策记录与开放问题（第 1/2 部分：ADR-01 至 ADR-10）

格式：背景 / 选项 / 决定 / 后果。"偏离"标注与原 README（ORIG）或 Role A 分支（RA）的差异。

### ADR-01 协商核心写成纯归约器
- 背景：代理质量要可评测；Convex 函数难以在大量 fixture 上快速重复运行。
- 选项：A 逻辑写在 Convex 函数里；B 纯 `reduceRun(state, event) → {state, effects}`，Convex 只做加载 / 守卫 / 落库。
- 决定：B。
- 后果：评测与生产共用代码；effects 是封闭联合，需维护一个应用 effects 的适配器（Convex 与内存各一份）。

### ADR-02 离线评测集与发布门槛，结果存仓库文件
- 背景：原方案没有任何质量度量；模型无采样参数，不能靠固定输出测试。
- 选项：A 只做单测；B 评测结果入 Convex 表；C 评测器 + JSON 报告进仓库。
- 决定：C；门槛见 16 §16.7。
- 后果：提示词变更有客观依据；需要独立评测 workspace 与花费上限。

### ADR-03 模型只输出 candidateKey 与私有理由（偏离 ORIG）
- 背景：ORIG 让模型输出 scope、additionalCostCents、sourceRefs、publicSummary；审查复现了伪造条目与金额（F02.1、F05.1–F05.3）。
- 选项：A 模型输出条款 + 代码校验；B 模型输出 itemKeys + 日期，代码求和；C 代码枚举候选，模型只选键。
- 决定：C。金额、日期、sourceRefs、公开文本全由代码派生。
- 后果：模型不可能发明金额（核心 4）；动作空间封闭，注入最坏后果有界；代价是候选数量受枚举能力限制（大目录见 17）。

### ADR-04 交付日期由交付模式与工期计算（偏离 ORIG、RA）
- 背景：ORIG 的 deliveryDate 由模型给；RA 的报价带固定 deliveryDate。
- 选项：A 模型给日期，代码校验；B 每条目固定日期；C 每条目 standard / rush 工期，组合日期 = max。
- 决定：C；rush 作为 fee 条目计价。
- 后果：日期可证明来源于目录；"按时 vs 范围"成为有信息量的软取舍。

### ADR-05 回合策略：提议 → 代码裁决硬违规 → 并行评估 → 代码裁决本轮（偏离 ORIG）
- 背景：ORIG 一次一回合串行，最多约 9 次调用；审查要求降低串行深度（F05.5）。
- 选项：A 严格轮流；B 提议 + 并行评估；C B + 硬违规由代码直接裁决、无解不调模型。
- 决定：C。maxRounds 4、modelCallLimit 16（场景可配）。
- 后果：串行深度每轮 2；provider 不知预算时的超预算提议只花 1 次调用；需要处理并行 counter 冲突（ADR-19）。

### ADR-06 clarify 只给话题键，问题发给信息所有者本人（偏离 ORIG）
- 背景：ORIG `clarify { target: agent | human }` 让模型决定是否打扰人；代理之间自由提问会形成跨方自由文本通道。
- 选项：A 代理间自由问答；B 模型决定是否升级；C 代码话题表：模型选 topicKey，代码生成问题与选项发给 ownerRole 的人。
- 决定：C；每角色每 run 一次。
- 后果：保留"澄清"能力且不引入跨方自由文本；回答本身是显式披露决定（核心 1）；话题需由场景预先定义。

### ADR-07 自建 scheduler 链编排
- 背景：inputs/04 §2 比较了 workflow / workpool / action-retrier / agent。
- 选项：A 自建；B workflow；C agent 组件。
- 决定：A。
- 后果：无新依赖；需自写 watchdog、attempt 管理、调用计数；迁移路径见 17。agent 组件因要求换 AI SDK 被否决。

### ADR-08 预算按买方 / 卖方划分可见性（偏离 ORIG、RA）
- 背景：ORIG 说预算是 finance 私密输入，schema 却放在全员可见的 rooms；RA 全员可见。
- 选项：A 仅 finance；B finance + customer（买方），provider 只见原因码；C 全员可见。
- 决定：B。customer 代理也能看到余量，但它对外只经模板。
- 后果：customer 可以有效还价；provider 能由谈判结果推断余量区间（T7，已接受）。

### ADR-09 状态分层：run / turn / proposal / humanRequest 各有迁移表（偏离 ORIG、RA）
- 背景：ORIG 与 RA 用一个 room 状态承载全部流程，手工赋值（RA-S01）。
- 决定：room 只有 open / closed；其余各自迁移表 + `assertTransition`；可执行性派生。
- 后果：非法迁移可测；UI 的"阶段"由多个状态组合派生。

### ADR-10 否决 RA 的全量前端状态与 revalidated 复制提案
- 背景：RA `WorkspaceState` 把全员私密数据发到浏览器再过滤（RA-D16）；改上限后复制出 revalidated 新提案（RA-R11）。
- 决定：服务端按角色投影的读模型；约束变化不复制提案，阻断读时派生，重新协商由新 run 产生新提案。
- 后果：核心 1、3 在数据流层面成立；提案版本只代表"进入评审的内容"。
