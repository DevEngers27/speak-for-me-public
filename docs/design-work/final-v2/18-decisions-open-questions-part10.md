# 18 · 章节级决定（part10）：ADR-X01…X04

> 分片见 `18-decisions-open-questions.md` 顶部。本节登记**各章自行做出、canon 未列**的重大决定，满足任务书 §6"每个重要决定都写目标、决定、理由、被否决的备选、不变量、开放问题"。规则：ADR-X 不推翻任何 canon 裁决，只记录 canon 未覆盖处的落地选择；每条写明决定所在章、与哪条 canon 的关系、需要 canon 吸收的条目（§18.4.2 的 N 编号）。canon 吸收后，对应 ADR-X 改称"细化 canon Dnn / §1.x"，正文不变。收录标准：改变并发模型、新增实体 / 表、或在只追加纪律上开例外；只影响一章的局部选择不收录（见 §18.6.1）。

## 18.6 章节级决定

### ADR-X01 房间写锁 M-ROOM（细化 canon D02 / D03 / D24）

- **所在章**：02 DM-09 / INV-M1、03 SC-05 / §3.3、11 A4 / §11.7、08 §8.5（S9、S12）与 §8.7（K2、K3、K24）、10 §10.13 第 3 条。
- **目标**：同房间的"先查后写"守卫——`approvals.record` 读审批区间后插入、`invites.accept` 读两条成员索引后插入、`insertProposal` 读 `nextProposalVersion`、`executeIfComplete` 读 `by_executionKey`——在并发下有确定的冲突点。
- **背景**：Convex 没有行锁与唯一约束，只有 mutation 级 OCC。canon D02 / D03 / D24 的"先查后写 + OCC"隐含一个前提：并发插入会让读过同一索引区间的事务冲突。该前提只有源码注释旁证，convex-test 测不了（spikes §1），真实部署验证是 §18.5 V-01；idempotent-execution r10 指出 withdraw 与最后一票并发的安全性完全押在它上面。
- **选项**：A 只靠索引区间读冲突（canon 原文的隐含做法）；B 每个改变房间业务状态的 mutation 在第一次写之前经 `openRoomTx(ctx, roomId, { allow })` 重读房间并把 `rooms.writeSeq + 1`，房间作用域表只能经它返回的 `RoomTx` 写（类型强制）；C 按业务键另设锁文档（每提案、每席位一个）。
- **决定**：B。`openRoomTx` 同时承担房间状态白名单（`executed` / `closed` 默认拒绝；`tasks.markDone` 与 `rooms.startFollowUp` 显式放行，N-26）；不进 query；全局写（`users.ensureViewer`、`opsFlags`、`spendCounters`、`rawOutputs`）不经它；巡检 cron 按房间扇出、每房一个 mutation。
- **被否决**：A——正确性押在未验证的平台细节上，V-01 一旦否定，审批、席位、执行三条唯一性同时失守；C——多一种实体、锁粒度更细却没有收益：同房间写入本就稀疏，而 `constraints.bump`、`startRunTx` 等写入无论如何都要写 `rooms`。
- **后果**：正面——同房间写事务确定串行，区间读冲突降为第二道防线；V-01 否定时只剩跨房间的全局行需要另行处理。代价——同房间全部写入串行：一次代理提交（`turns.complete` / `turns.fail` / `agents.watchdog` / `turns.beginAttempt`）与一次人类写入相撞时后者 OCC 重试（10 §10.13）；每房 3 人、每分钟个位数写入加至多一个在途回合，可以接受。不变量：INV-M1（02 新增）。验证：V-01 的 RD 套件把"移除写锁"的变异列为灵敏度对照（02 Q4），V-R10 记录 OCC 重试次数与错误形态。
- **与 canon**：不改变任何裁决，是 D02 / D03 / D24"先查后写"的加固；canon §1.2 已登记 `writeSeq`、00-invariants 已补 INV-M1（N-31 已解决）。

### ADR-X02 目录定价修订号 `revision` + 展示修订号 `editNo`（细化 canon D05 / D25）

- **所在章**：09 CC-D3 / §9.1.3、03 §3.7 revision 契约、06 INV-R8、12 §12.12 `catalog.confirm`、02 §2.5–§2.6。
- **目标**：同时满足 canon D05"只改 `title` / `taskTemplates` 不 bump、硬投影含 `revision`"与 D25"`version.stale_source` 比较 `lines[].revision`"，并让目录保持纯只追加。
- **背景**：canon §1.1 写"`(itemKey, revision)` 只追加"。若标题编辑产生新 revision，投影改变 → bump（违反 D05，重现 FF-10"标题冻结协商"）且 `version.stale_source` 误报；若不产生新行，就只能原地改标题（违反只追加，核心 6）。D25 的被否决项"按 revision 比较来源（续期即 stale）"与其决定句也互相拉扯（ADR-D25 残余）。
- **选项**：A 标题原地 patch；B 标题编辑也 `revision + 1`；C `revision` 只随 `priceCents` / `leadDays` / `status` 变化 +1，同一 revision 内 `title` / `taskTemplates` 的变化只让 `editNo + 1`（新 revision 从 0 起）；D 恢复房间级 `catalogRevision`（C8 已否决）。
- **决定**：C。索引 `by_room_item (roomId, itemKey, revision, editNo)`，"当前行" = 该前缀上 `(revision, editNo)` 最大者；draft 行 `revision 0` 从不修改，确认总是插新行；唯一写入 helper `appendCatalogRow`。
- **被否决**：A——改写历史；B——FF-10 回归；D——C8。
- **后果**：正面——标题编辑零失效（09 走查 V6：同 revision、`editNo 1`，不 bump，两条 approve 仍有效）；改价必 bump；`version.stale_source` 只在守卫层作纵深防御出现。代价——多一个字段与四段复合索引，所有"当前行"读取必须经同一 helper（02 part4）。不变量：INV-CC-11（09）。
- **与 canon**：调和 D05 / D25，不改其结论；canon §1.1 / §1.2 已改为 `(roomId, itemKey, revision, editNo)`（C46，N-09 已解决）。

### ADR-X03 `constraintRevisions` 与 `rawOutputs` 两张表（细化 canon D05 / D16）

- **所在章**：09 §9.3 / Q3、03 §3.7 与 §3.8、02 §2.2、10 §10.7、15 §15.8。
- **目标**：回答"约束版本为什么是 N、谁改的、改了哪些来源"并可重放（核心 6；canon part6 的 09 must_absorb）；模型原文只存内部表、永不经 query 或日志外泄（canon D16 的 `attempts.rawOutputRef`）。
- **背景**：两项要求都来自 canon，但 §1.1 实体表没有对应的表。事件 payload 只能放房间可见字段（D14），`cause`、变更角色、新旧值是受限信息，必须有一行可供 `restrictedRef` 指向。
- **选项（约束历史）**：A 只靠事件；B 每个 cv 快照全部约束值（invariants 底稿的指针元组 + `committedCents` 快照）；C 每个 cv 一行只追加 `{version, previousVersion, cause, actorUserId?, sourceRefs, localDate}`，不存约束值，由 `sourceRefs` 折叠重放。**选项（原文）**：A 存在 `attempts` 行内；B 不存；C 独立内部表、无任何 query、到期删除。
- **决定**：两者都选 C。`constraintRevisions` 唯一写者 `constraints.bump`，`(roomId, version)` 从 1 连续；`constraints_changed` 事件 payload 只有 `{fromVersion, toVersion}`，其余经 `restrictedRef` 按查看者连接（07 DX-5）；硬投影串不持久化（含 finance 私密值）。`rawOutputs` 只由 `turns.complete / fail` 写、只由 `ops.purgeRawOutputs`（每日 cron）删，dev 保留 30 天、prod 7 天（15 §15.8），排障只经 dashboard 直读，金丝雀扫描覆盖，不在 `REDACTABLE_FIELDS`（到期即删）。
- **被否决**：约束历史 A——受限信息无处可放，`constraints_changed` 的三种受众渲染需要一行可连接的记录；B——约束值多存一份必然漂移，且快照 `capCents` 扩大私密值的存储面。原文 A——`attempts` 含 `self(role)` 字段并长期保留，原文混入会扩大投影面与保留期；B——D16 要求可追溯排障。
- **后果**：正面——INV-57"约束历史可复现"可测（09 `replayRuleInput`）；原文与业务表、日志隔离（INV-13）。代价——两张表；`rawOutputs` 是只追加纪律之外的第二个删除入口（03 §3.3.2 规则 5）。残余：原文与 `rationale` 的保留期需 07 / 15 与法务确认（N-18）。
- **与 canon**：两者都是 canon 已有要求的落地形态；canon §1.1 已补列两张表（N-32 已解决）。

### ADR-X04 PII 抹除 `privacy.redact`（细化 canon D18）

- **所在章**：03 §3.3.2 规则 6 与 §3.16.2、07 §7.12.2 与 §7.24 第 11 条、11 §11.7、12 §12.20。
- **目标**：在只追加表（核心 6）上给合规抹除请求一条走唯一写入口、可审计、不破坏审批绑定的路径。
- **背景**：canon D18 只写"prod 无 reset；`rooms.close` 是唯一清理"；GAP-21（私密简报的保留与删除）与 techstack D38 要求 PII 只落在可抹除字段。
- **选项**：A 不提供抹除（法律请求来时只能直接改库，绕过唯一写入口与审计）；B 删除整行或整房（审计链断，`termsKey` 与审批绑定无法复核）；C internal `privacy.redact`：只把 `REDACTABLE_FIELDS`（`users.displayName`、`members.displayName`、`invites.invitedEmail`、`rooms.title`、`briefs.softFields.notes`、`approvals.note`）覆盖为固定串 `"[redacted]"`，同事务写 `pii_redacted {table, field}` 事件，编译期断言该清单与 `termsKey` 覆盖字段不相交；D 自助删除。
- **决定**：C，运维经 CLI 人工发起，全部层级可用；D 列入 17 E17。恢复后以恢复前快照中值为 `"[redacted]"` 的 `(table, rowId, field)` 为清单重放 `privacy.redact`（15 §15.11 第 6 步；techstack D39）。
- **被否决**：A——迟早出现绕过入口的手工改库；B——核心 6 与审批绑定失效；D——v1 范围外（D26）。
- **后果**：正面——抹除后全部 `termsKey` / `boundTermsKey` / `executions.termsKey` 不变（03 SC-T7）。代价——只追加纪律多一个受控例外；目录与任务标题进入提案与任务快照，不可抹除，只能在确认页提示"不要填写个人信息"（03 Q10）。
- **与 canon**：canon D18 已写明它是只追加表上唯一允许的覆写（跨章核对阶段同步，N-33 已解决），07 §7.24 第 11 条的说法现已属实。

## 18.6.1 未收录为 ADR-X 的章节级选择

以下是有出处、影响限于一两章或已有编号的局部选择，不另写 ADR：`catalog.confirm` 批量签名（12 §12.12，N-24 已解决）；`rooms.previewChange` 的唯一返回形状（12 §12.17）；`price_writes` 节流桶（07 §7.13，N-29 已解决）；`/api/health` 是唯一 Route Handler（11 §11.10、13 FE-D14）；13 对 12 的增量 Δ1–Δ6（N-23）；`isExecutable` 的唯一定义（N-22，待 canon）。
