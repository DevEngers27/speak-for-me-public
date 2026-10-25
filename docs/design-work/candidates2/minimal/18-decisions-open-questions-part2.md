# 18 决策记录与开放问题 · part2：ADR-11 … ADR-19、偏离清单、开放问题

### ADR-11 所有简报确认都递增约束版本（含软偏好、备注）
- 选项：A 区分硬/软字段；B 一律递增。
- 决定：B；确认前提示将失效的审批数。
- 后果：规则一句话、不会漏判；代价是改偏好也会重谈。开放问题 Q1。

### ADR-12 模型只选 itemKeys；交付日、金额、延后项全部由代码计算
- 决定：模型输出没有任何数字或日期字段。
- 后果：核心 4 在 schema 层就成立；首个场景交付日不可协商（加急/延后条款见 17 号）。

### ADR-13 席位合并邀请与用户
- 决定：`seats` 一行 = 一个角色 = 一个邀请 = 至多一个用户；无 users、roomInvites 表；显示名按房间快照。
- 后果：(roomId, role) 唯一性在创建时一次性保证；一个角色多人需要升级席位模型（Q7）。

### ADR-14 provider 的候选只用 provider 可见约束
- 背景：审查建议"代码枚举可行组合，模型只挑选"。
- 决定：系统视角枚举只用于"无解"判定与人工请求；给 provider 代理的候选不含私密约束。
- 后果：候选边界不泄露 finance 余量；provider 可能提出被代码挡下的提案（如 v1 $1,400），这是有意义的协商步骤，并在历史里如实可见。

### ADR-15 提案无状态字段；`proposalId` 即执行幂等键【偏离原想法】
- 背景：原 README 用 operationId；Role A `roomId:p{v}:c{c}`。
- 决定：proposal 不可变、无 status；`changeOrders.by_proposal` 先查后写。
- 后果：少一个派生键与一个可能不一致的状态字段。

### ADR-16 预算可见性：finance 逐项决定是否给 customer；provider 永不可见【偏离审查推荐】
- 背景：开放决定 1 推荐 customer 默认可见；核心 1 要求"对他方可见的内容都经过显式披露决定"。
- 决定：预算字段是 `disclosable`，受众只有 customer；fixture 中 finance 勾选披露。
- 后果：满足核心 1 字面要求；provider 只看到 `OVER_BUDGET` 代码（最小披露）。

### ADR-17 人的拒绝只有 reasonCode，没有自由文本
- 后果：关闭"人写的备注泄露数字"通道；需要解释时在房间外沟通。若用户需要，可加"只给本方可见的备注"。

### ADR-18 模型调用规范
- 决定：`claude-opus-5-5`，effort medium（每调用点可配），`messages.create` + 自校验，max_tokens 8000，SDK timeout 60 s / maxRetries 1，不传采样参数/thinking/prefill/强制 tool_choice；服务端回退在验证 #7 前关闭。
- 后果：符合 inputs/04；Sonnet/Haiku 只能由用户拍板（Q2）。

### ADR-19 简报草稿不入库
- 决定：只有已确认版本入库；表单预填最新版本；不保存粘贴原文。
- 后果：少一个私密数据面；跨设备草稿丢失（可接受）。

## 与原 README / Role A 的偏离清单（汇总）

| 原想法 | 本设计 | ADR |
| --- | --- | --- |
| rooms 上的预算与 committedCents | finance 简报字段；committed 派生 | 02、04 |
| events 表 | 派生时间线 | 01 |
| commitments 表（必填 proposalId） | 变更单内嵌承诺 + 基线字段 | 04 |
| operationId | proposalId 即幂等键 | 15 |
| 一个 rooms.status 承载全部 | 只有 run/turn 存状态 | 08 |
| 代理消息混装信封、publicSummary 自由文本 | 信封/输出分离；公开文本模板化 | 12、05 |
| clarify 可指向 human | 代码决定升级；clarify 只问本方委托人 | 05 §7 |
| Role A：只有改上限递增版本 | 任何简报确认递增 | 02、11 |
| Role A：revalidated 复制提案 | 新 run 由 provider 代理重新提出 | 05 |
| Role A：approve 删除旧拒绝；Approval/Rejection 两表 | 单表只追加 | 10 |
| Role A："same shapes" 全量状态 | 按查看者投影的 `rooms.view` | 07 |
| Role A：bestFeasibleOption 当协商 | 枚举只用于无解判定与候选 | 14 |
| 审查：预算低于已承诺 → needs_input | 拒绝写入 | 09 |
| 审查：customer 默认可见预算 | finance 显式披露 | 16 |
| 审查：users、roomInvites 表 | seats | 13 |

## 开放问题（需用户拍板）

| # | 问题 | 当前默认 |
| --- | --- | --- |
| Q1 | 软偏好（preferredDate、notes）改动是否应不使审批失效 | 失效（ADR-11） |
| Q2 | 是否允许某些调用点用 Sonnet 5.5 / Haiku 5.5 | 全部 Opus 5.5 |
| Q3 | 服务端回退是否开启 | 验证 #7 后决定 |
| Q4 | 延迟实测后是否开启并行评估 | 串行 |
| Q5 | 私密简报/rationale 的保留期限与归档清除；模型供应商数据保留政策 | 未定 |
| Q6 | 报价与审批是否有有效期 | 无 |
| Q7 | 一个角色多名用户与审批策略 | 不支持 |
| Q8 | 谁能创建房间（`ALLOWED_CREATORS` 策略） | 名单为空 = 任何登录用户 |
| Q9 | 人拒绝时是否允许本方可见备注 | 不允许 |
| Q10 | 是否改名（工作名 Speak for Me） | 不改 |

## 待验证平台事实（实现前逐条做最小实验）

1. 结构化输出是否接受根级 `anyOf`（本设计已外包 `{message}` 规避）。
2. SDK 1.1.0 在 Convex 默认运行时的长请求行为（否则 `runTurn` 移入 `"use node"`）。
3. Convex action 最长运行时间；OCC 冲突重试上限与并发索引区间冲突。
4. `v.object` returns 校验是否拒绝多余字段。
5. 默认运行时 `Intl.DateTimeFormat` timeZone 支持。
6. Clerk Convex JWT 是否带 name/email（否则显示名由用户填写，本设计已如此）。
7. `fallbacks` 与 `output_config.format` 同用。
8. Opus 5.5 回合 p50/p95（决定 TURN_DEADLINE_MS、effort、max_tokens）。
9. convex-test 0.0.65 的身份模拟与调度推进 API。
10. 被调度函数是否带调度者身份（本设计不依赖）。
