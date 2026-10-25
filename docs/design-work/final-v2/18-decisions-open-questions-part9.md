# 18 · 开放问题（part9）：§18.4.3 各章登记、未并入 N / U / V 的开放问题

> 分片见 `18-decisions-open-questions.md` 顶部。本表只收各章"开放问题"小节里**没有**并入 §18.4.1（U）、§18.4.2（N）或 §18.5（V）的条目，一行一条、只写要点与归属，原文以各章为准。已并入的条目不再复述要点，只在文末列编号映射，供从章节反查；这样同一问题只在一处有文字，避免两处漂移。

## 18.4.3 未并入的章节开放问题

| 章 · 编号 | 要点 | 归属 / 关联 |
| --- | --- | --- |
| 02 · Q2 / 03 · Q2 | `rooms.currentRunId` 指向最新 run（04）还是终态清空（INV-67） | 00-invariants 回改，按 04 |
| 02 · Q6–Q8 | 非目录子集形状的第二场景；一角色多人与跨房间预算；provider 未来硬字段必须进 `RuleInput` | 17 §17.3、E10、E11；06 / 09 |
| 03 · Q1 | 目录 draft → confirmed 原地改（04）vs 追加新行（03 / 09 / 11） | 按 03（ADR-X02），04 回改 |
| 03 · Q3 | `constraints_changed` payload 只放 `{fromVersion, toVersion}`，其余经 `restrictedRef` | 09 回改 |
| 03 · Q4 / Q8 / Q9 | `tasks.markDone` 命名；`executions.scenarioVersion` 类型；`MUTABLE_FIELDS` 对账 | 04 / 08 / 11 回改 |
| 03 · Q10 | 目录 / 任务标题可能含个人信息（进入快照，不可抹除，ADR-X04） | 13 确认页提示 |
| 04 · Q2 | `runs.cancel` / `requestRenegotiation` 只给 creator 是否过严 | 产品决策 |
| 04 · Q3 | `superseded` 语义扩为"非因约束变化而不再当前" | canon §1.3 文字同步 |
| 04 · Q5 | 每 turn attempt 上限 2（D17 公式）vs PD-11 的 3 次 | 以 10 为准 |
| 04 · Q7 | 无人可放松时只给 `end_run` 的请求，是否提示各方可主动改约束 | 13 文案 |
| 05 · 1 | 轮次用尽但有合格提案时走 `rounds_exhausted` 还是直接 `pending_approval` | 按 D08 字面；产品可再议 |
| 05 · 2 | 预算类无解永远路由给 finance 是否为期望行为 | 倾向是（与 01 F7 一致） |
| 05 · 3–5 | 话题表终值；fixture 默认披露影响调用次数；`questionKey` / `allowedActions` 字段入 03 | 14、03 |
| 06 · 3 | setup 阶段的确认是否各自递增 cv（现按"房间开放时 cv = 1"） | 09 / 12 Q10 |
| 06 · 5 | 候选截断按金额：必需项未披露时，便宜但缺必需项的组合可能挤满 12 格 | 16 离线评测比较备选排序 |
| 06 · 6 / 14 · 5 | 被阻断的 provider 候选不插提案（03 / 04）vs 05 走查记作 v2 | 合稿时统一 05 的版本号 |
| 06 · 8 | "全部读取字段都已披露即解密"需进 07 解密清单 | 07 |
| 06 · 9 | 回退分支 `disclose` 回答后 run 保持 `needs_input` 并开新请求 | 04 / 05 迁移 |
| 07 · 4 | 写入时物化评估结果，让 provider 查询读集不含预算（加固选项） | 03 / 06 |
| 07 · 5 | `approvals.note` 进本方代理上下文 | 05 / 10 对齐 |
| 07 · 7 | G701 基线取自 `ledgerEntries.baseline` 时按 finance 类投影 | 08 |
| 07 · 8 | 12 的 `sharedFacts.add` 是否删去 `value` 参数（值从本人简报复制） | 12 / 03 |
| 08 · O1 | 预算上调也作废审批，多一轮重批 | 按 D05；15 记"因失效而重批"指标 |
| 08 · O4 | `MAX_APPROVAL_ROWS_PER_PROPOSAL = 200` 触顶报 `internal` | 15 观测后再议 |
| 08 · O5 | 规则读 `localDate` 带来午夜后约 1 小时判定滞后；D22 措辞 | canon 澄清、15 监控 |
| 08 · O6 / O7 / O8 | 拒绝词表不编码数值；G701 工期链未建模；跨房间 G701 链不强制连续 | 05 / 14；17 |
| 09 · Q4 | 无关目录改动也作废全部审批 | 17 评估"只影响引用项时 bump"（v1 不做） |
| 09 · Q7 | `clock` 只检查 `pending_approval` 提案与 open 请求 | 17 E9 引入 `validUntil` 时扩展 |
| 09 · Q8 | 四个约束写入都带 `expectedConstraintsVersion` 的打断代价 | 观测后可降为可选 |
| 09 · Q10 | 硬投影不持久化 | 06 回改 |
| 10 · 1–4、6 | 401 / 403 自动熔断；吞吐标定与 `max_tokens`；美元上限默认值；运行时错误码归属；运行时事件受众与 `events.by_room_actor` 索引 | 10 / 15 / 07 / 03 |
| 11 · Q6–Q8 | `convex-helpers` 版本与冷却期；L3（eslint-plugin-boundaries）是否保留；`MUTABLE_FIELDS` 归属 | 11（Q8 已与 03 对齐） |
| 12 · Q1 / Q2 / Q6 / Q10 | 依赖的字段与索引入 03；`roomReadiness` 精确谓词；`disclose` 受众字段 `askedByRole`；cv 初值与 setup 递增 | 03 / 04 / 05 / 09 |
| 12 · Q4 | `choose_candidate` 复核失败暴露 1 位 | 接受（节流约束） |
| 14 · 3 | modifier 是否允许叠加；rush 是否按条目计费 | 14 / 产品 |
| 14 · 4 / 6 / 8 / 9 | cv 编号；拒绝 `reasonKey` 对 provider 的粒度；`preferredDate` 删除；canary 变体连续阻断的确定路径 | 09；07；13；16 |
| 15 · Q3–Q9 | dev deploy key 形态；预览回收；`cronJobs` 签名与 action 上限；价目表倍率与 thinking token 字段；`ConvexError` 是否被上报；`RUN_MAX` / `DAILY_MAX` 终值；活性巡检命名 | 15 / 10 / 12 |
| 16 · 2–4、7、9、10 | `vi.mock` 生效；convex-test id 确定性；`@edge-runtime/vm`；supersede 时回合事件；探针与节流交互；评测专用 dev 部署 | 16 / 10 / 09 / 15 |
| 17 · 3 | E3 链头锚点的外部存储选型与告警归属 | 15 |

## 已并入 §18.4.1 / §18.4.2 / §18.5 的章节条目（只列编号映射）

- **→ N**：01 · 1–6 → N-03 / N-02 / N-06 / N-04 / N-17 / N-11；02 · Q1 → N-22；02 · Q3、03 · Q7 → N-05 / N-30；02 · Q4 → N-31；02 · Q5、03 · Q5、04 · Q8 → N-25；03 · Q6、10 · 5 → N-18；04 · Q1、09 · Q1 → N-27；04 · Q4、12 · Q3 / Q5 → N-26；04 · Q6、06 · 1 → N-05；05 · 6 → N-28；06 · 2、09 · Q2 → N-09；06 · 7 → N-13；07 · 3 → N-29（已解决）；07 · 6、08 · O11 / O14 → N-30；07 · 9、16 · 8 → N-21；08 · O12 → N-08；09 · Q3 → N-32；09 · Q5 / Q6 → N-04；09 · Q9 → N-24（已解决）；13 · 1–4 → N-01 / N-07 / N-10 / N-12；17 · 1 / 2 / 4 → N-14 / N-15 / N-16。
- **→ U**：08 · O2 → U7；11 · Q9 → U10 / U12；15 · Q1 → U9；17 · 5 → U6。
- **→ V**：03 · V-S1–V-S5 → V-T04 / V-01 / V-05 / V-R08 / V-R04、V-T05；05 · V1–V8 → V-13、V-14、V-R27 等；07 · V-1–V-8 → V-R01、V-R02、V-03、V-R04、V-T08 等；08 · O9 / O10 / O13 → V-04 / V-01 / V-10；11 · Q1–Q5 → V-08、V-13 / V-15（默认运行时流式）、V-R04、V-T05、V-07；12 · Q7 / Q8 → V-01、V-04、V-R01；13 · 5 / 6 → V-T06 / V-T09、V-R13 / V-R15；14 · 7 → V-R12；15 · Q2 → V-T09；16 · 1 / 5 / 6 → V-R21 / V-R22 / V-R13。
- **已定**：07 · 11（运维人工 `privacy.redact`，自助删除不提供 → ADR-X04、N-33、17 E17）；12 · Q9（`runs.retryTurn` 是 `answer(retry_turn)` 的别名）；15 · Q10（`rawOutputs` 保留期 dev 30 天 / prod 7 天，法务确认见 N-18）。
