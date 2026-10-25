# 03 Role A 分支决定 · part10：§8.2–8.3 公共文本生成、格式化

## 8.2 公共文本的生成方式

**现状**：
- 对他方可见的文本全部由代码模板从结构化字段拼出，没有任何一句是模型生成的：
  - publicSummary：`${option.label}: ${scope}; deferred: ${deferred}.`（lib/workspace/preview-store.ts:228）；
  - 事件 summary：每种 action 一个模板，金额经 formatCents 格式化（preview-store.ts 各处 `log(...)`）；
  - 检查 detail：例如 "$4,000 committed + $900 = $4,900, within the $5,000 cap."（lib/workspace/rules.ts:30-45）；
  - 审批状态说明：例如 "Approved v2 under constraints v1; that approval no longer applies."（rules.ts:61-66）；
  - 版本差异：rules.ts:83-94。
- 文本在写入时渲染成英文，存入 `summary` 字段（lib/workspace/types.ts:69），查看时原样显示。
- 同一动作写两种粒度：
  - 私密版："You confirmed brief v2: 2 hard constraints, 1 preference, 2 shared, 1 confirmed option."；
  - 房间版："Service provider confirmed their private brief v2. Contents stay private; 2 items are shareable."（preview-store.ts:185-192）。
- 直接进入公共文本的用户自由文本只有两类：报价 label 和范围项名称（进入 publicSummary 与任务标题）。用户标记为 shared 的条目文本本应公开，但从未展示给他方（RA-B23）。
- 代理消息区刻意为空：`const agentMessages: AgentMessage[] = []`，注释 "the preview never invents agent messages"（components/workspace/workbench.tsx:15-16）。

**裁决**：
- **RA-T01 采纳**："对他方可见的文本由代码模板从 allowlist 字段生成"作为默认路径（核心 1、4，原 README "Prefer allowlisted fields for public messages"）。
  - 代理撰写的解释（例如为什么建议延后某项）若要展示，单独作为 `agentExplanation` 字段，并且：标注"由 <角色> 的代理撰写，仅供参考"；
  - 有长度上限；
  - 经过确定性检查：文本中出现的金额与日期必须等于提案条款中的值，不得出现条款之外的数字。具体规则由 06 / 07 决定；
  - 绝不替代模板生成的 publicSummary。
- **RA-T02 否决**：不再存预渲染文本。事件与动作结果存 `{type, payload}`，查询时按查看者的角色、披露决定、语言渲染。同一个 constraints_changed 事件，对 finance 显示"上限 $5,000 → $4,800"，对他方显示"预算约束已更新（v1 → v2），当前方案需要重新评估"。
- **RA-T03 修改**：Role A 有四个房间事件模板泄露 finance 的数额（RA-B08）：
  - room_created：上限与已承诺（preview-store.ts:156）；
  - no_feasible_option：剩余预算（preview-store.ts:213）；
  - constraints_changed：新旧上限（preview-store.ts:301）；
  - proposal_blocked：合计与新上限（preview-store.ts:323）。
  新设计为每种事件类型定义各受众的渲染版本，并在 07 的事件可见性表中列出。"N items are shareable" 这类计数元数据风险低，可以保留，但也要在矩阵中写明。
- **模板本身的位置**：引擎事件（成员、决定、执行、run）的模板属于引擎；场景事件（报价、预算、范围）的模板属于场景插件，以便第二个场景复用引擎。

## 8.3 格式化与输入解析（lib/workspace/format.ts）

**现状**：
- `formatCents`：整美元不显示分，否则显示两位（:1-2、8）；
- `formatDate`：把 `YYYY-MM-DD` 拼成 `T00:00:00Z` 后以 UTC 格式化，避免跨时区错一天（:3-4、9）；
- `formatTime`：事件时间固定 America/Los_Angeles 并显示时区缩写（:5-6、10）；
- `parseDollars`：去掉 `$`、`,`、空格后只接受 `^\d{1,9}(\.\d{1,2})?$`，返回整数分，其余返回 null（:12-18）；
- `centsToInput`：整数分转回输入框文本（:20）。

**裁决**：
- **RA-X01 采纳（整数分与严格解析）**：
  - 金额全程整数分，不经过浮点；
  - 币种改由房间 / 场景配置（Role A 写死 USD）；
  - 服务端用同一个解析与校验函数再处理一次，客户端解析只为即时反馈；
  - Convex 中金额字段需要整数约束（architecture-24 指出旧 schema 用 `v.number()`，没有整数约束；具体 validator 以 inputs/04 为准）。
- **RA-X02 采纳**：日历日期存为 `YYYY-MM-DD` 字符串，以 UTC 渲染；必须校验真实日历日（RA-B10）。
- **RA-X03 修改**：
  - 事件时间按查看者时区显示；
  - "今天"、"是否已过截止"、报价有效期等判断按房间时区计算（security-22）；
  - 房间创建时确定时区，并作为共享事实展示。
