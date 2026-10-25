# 99 · 修订轮处置总表（part5）：§2 跨章核对阶段

> 分片见 `99-review-log.md` 顶部。核对者是唯一可以跨包改动的阶段：逐条处理 harness 下发的 98 条跨章备注（Xnn），再按 canon §1 对 03 / 04 / 05 / 07 / 08 / 09 / 10 / 12 / 14 / 00-invariants 做全仓 grep 对账（N-* 条目）。所有改动都是对现有文件的局部替换（脚本做精确串替换并断言唯一），改动前的全量备份在 scratchpad 的 `xcheck/backup-final-v2/`。

## 2.1 跨章备注索引（Xnn → 来源包 · 内容 · 最终处置）

| 编号 | 来源包 | 跨章备注（摘要） | 最终处置 |
| --- | --- | --- | --- |
| X01 | canon | 00-overview：§0.3 测试编号、§0.9 第 3 条、§0.6 术语同步、§0.10 补 C43–C60 | fixed |
| X02 | canon | 16：§16.11.2 删为指针、part9 开放问题 8、TC-RUN-14 按 CE-146、请求体无 reasonKey、pass_to_next 用例、CE-176 起编号 | fixed |
| X03 | canon | pass_to_next 落到 04 / 05 / 06 / 03 / 12 / 13 / 07 / 01 / 14 / 18 | fixed |
| X04 | canon | startRunInternal → startRunTx（10 / 05），10 part2 步骤 1 改为 openIfReady → react → startRunTx | fixed |
| X05 | canon | 05 §5.11.4 choose_candidate 复核失败 → superseded(regenerated) | fixed |
| X06 | canon | 18：C43–C60 进被否决、N-08、pass_to_next / keep_as_is 按 kind / D06 收窄 / D04 豁免的 ADR | fixed |
| X07 | canon | 关闭 04 Q1/3/4/5/6、09 Q1/2/3/5/6、12 Q3/5/14、11 Q6/7、13 问题 1、07 问题 9、08 O11 | fixed |
| X08 | model | canon D14 restrictedRef 八表 | fixed |
| X09 | model | canon D15 disclose { field, toRoles } | fixed |
| X10 | model | canon D18 privacy.redact 豁免；07 §7.24 第 11 条 | fixed |
| X11 | model | canon D10 剔除集合 | fixed |
| X12 | model | 00-invariants INV-67 / cause 名；03 §3.20 Q2/Q5、02 §2.14 Q2/Q5 | fixed |
| X13 | model | 12 §12.14 / Q6 disclose toRoles | fixed |
| X14 | model | 12 §12.9 删 preferredDate | fixed |
| X15 | model | 12 §12.11 守卫 ⑥ confirmed ∪ retired；§12.4 登记 item.unconfirmed | fixed |
| X16 | model | 16：TC-PRIV-15 cap_480000、startFollowUp 双击、privacy.redact L1、TC-RUN-03 事件名 | fixed |
| X17 | model | 14 §11 A1 / A3 事件名与选项键 | fixed |
| X18 | model | 06 R-D11 选项键 | fixed |
| X19 | model | 10：rawOutputs 64 KiB、保留期、B4/B5 措辞、§10.16.3 指标 | fixed |
| X20 | model | 15 §15.7 全局日美元不写事件 | fixed |
| X21 | model | 08 §8.11 O11 ①② 旧码 | fixed |
| X22 | state | 00-invariants INV-72 ② / CE-135、INV-73 补 pass_to_next 与回退 disclose、新增活性 INV | fixed |
| X23 | state | "rooms.close 是唯一清理"限定为 setup / open（canon D18、15、12 B11、18、INV-54） | fixed |
| X24 | state | 03 waitingReason 加 run_cap；10 列表同步 | fixed |
| X25 | state | 10 §10.9 reconcile 与 04 对齐；startRunInternal 别名 | fixed |
| X26 | state | 12 §12.8 沿用提案的前提 pending_approval | fixed |
| X27 | state | 12 约束效果未改投影 → R20 重跑预检 | fixed |
| X28 | state | 15 §15.5 WATCHDOG_DELAY_MS → ACTION_WALL_MAX_MS + 60 s | fixed |
| X29 | state | 15 O10 本地午夜 runAt | fixed |
| X30 | state | 17 E10 触发条件与 forceClose 兜底 | fixed |
| X31 | state | pass_to_next 落章（05 / 06 / 12 / 13 / 18） | fixed |
| X32 | state | constraints_changed actor = system；RoomCtx 类型 | fixed |
| X33 | state | 场景注册表取值函数正式名 scenarioOf | fixed |
| X34 | state | 16 纳入 SM-28…31、SM-13 / CC-23、CC-14 / CC-17 | fixed |
| X35 | protocol | canon D10 措辞及 04 U1、INV-09、02 INV-09、01 part3、18 D10 | fixed |
| X36 | protocol | canon D27 v2 $800（canon_objections 第 23 条过时） | fixed |
| X37 | protocol | canon D22 澄清 | fixed |
| X38 | protocol | 03 waitingReason run_cap；04 INV-SM-03 | fixed |
| X39 | protocol | 03 §3.9 disclose toRoles；12 §12.14 同步 | fixed |
| X40 | protocol | localDate 写者补 rollLocalDateTx（03、00-invariants / 02 INV-77） | fixed |
| X41 | protocol | 09 §9.6.7 G3 → G1 措辞 | fixed |
| X42 | protocol | 04 §4.3.5 巡检 5 分钟、opsLog 码、beginAttemptTx 参数；INV-70 | fixed |
| X43 | protocol | 12 §12.18 beginAttempt 参数 / 返回 / 检查范围、stopCategory | fixed |
| X44 | protocol | 12 B7 run_starts 恢复由 B6a beginFnId 承担 | fixed |
| X45 | protocol | 16：callModel、topicKey、≤152 变体、TC-INJ-08 / 01、privacy-12 L1、RT-14/15/16 | fixed |
| X46 | protocol | 11 §11.3 encodeBlock.ts | fixed |
| X47 | protocol | 07 §7.14.3 外层标签不经 encodeBlock | fixed |
| X48 | protocol | 14 §11 G2 source 属性、F 选项键 | fixed |
| X49 | protocol | 08 scope_mismatch → scope_insufficient | fixed |
| X50 | protocol | 01 part2 topicKey deadline_value | fixed |
| X51 | protocol | INV-55 阻断候选；INV-34 / 02 INV-34 错误码 | fixed |
| X52 | protocol | 05 vs 06 rounds_exhausted 的 choose_candidate 口径二选一 | fixed |
| X53 | rules | 09 第二份 hardProjection、loadRuleInput 引用 06 §5.1 | fixed |
| X54 | rules | 09 §9.6.3 / 03 §3.2 标题定界词 → disclosure.blocked | fixed |
| X55 | rules | 任务模板标题上限 80 / 120 对齐 | fixed |
| X56 | rules | preferredDate 残留（12、03、02、CE-006 / 045） | fixed |
| X57 | rules | 16 §16.7.4 C1 与 §16.7.1 金丝雀 | fixed |
| X58 | rules | 16 TC-PRIV-13 / 14 / 20 | fixed |
| X59 | rules | 旧事件名（01 part3 / part4、INV-20 / CE-036） | fixed |
| X60 | rules | isExecutable 过时说明（13 FE-D12、02 §2.8） | fixed |
| X61 | rules | canon §1.5 补两码 | fixed |
| X62 | rules | 03 §3.11.1 provider 对 constraints_changed 的渲染说明 | fixed |
| X63 | privacy | names-17 剩余（03 addMember、02 INV-15、03 storeLink、06 invite.*） | fixed |
| X64 | privacy | completeness-20 剩余（11 §11.10、13、18 ADR-D19） | fixed |
| X65 | privacy | completeness-23（00-overview §0.3） | fixed |
| X66 | privacy | canon D12 / D17 预言机措辞 | fixed |
| X67 | privacy | run_cap 进 03 / 04 | fixed |
| X68 | privacy | disclosure_changed / human_request_closed 并入规则（03、12） | fixed |
| X69 | privacy | 两个 logger（15 唯一定义、11 构造器与 lint、08 / 12 / 03 调用点） | fixed |
| X70 | privacy | 06 / 14 删除 feasibility 枚举 | fixed |
| X71 | privacy | 16 金丝雀数值以 14 §9.5 为准（告知） | fixed |
| X72 | privacy | INV-18 / CE-029 闸门码 | fixed |
| X73 | approval | canon D25 lines.kind | fixed |
| X74 | approval | canon 收录 scenario_migrated | fixed |
| X75 | approval | canon D04 两项豁免 | fixed |
| X76 | approval | 12 §12.15 ⑧ 读法与人均上限 | fixed |
| X77 | approval | approval_recorded payload 的 reasonKey 受众（03、12） | fixed |
| X78 | approval | 16 补 I22 / I23 与 reject 允许错误集 | fixed |
| X79 | approval | reject 后 createTurnTx 场景版本守卫（04 / 10）与 15 迁移流程 | fixed |
| X80 | approval | 14 S10 approval.not_current | fixed |
| X81 | approval | 08 O15 的 1 bit（14 / 07） | fixed |
| X82 | approval | 12 recordsPreview.commitCents 口径 | fixed |
| X83 | arch | previewChange 形状残留（01、16、00-invariants、02、canon D12 ②） | fixed |
| X84 | arch | 06 API_ERROR_CODES / 参数名 / 02 auth 码 | fixed |
| X85 | arch | 01 P2 批量 rows；18 N-24 / 09·Q9 | fixed |
| X86 | arch | seed 终止状态（canon D18、INV-63、CE-156、02、01 X8） | fixed |
| X87 | arch | 后续房间只复制未交付目录（canon D04 及 00-invariants / 02 / 16 / 08 / 01 / 13 / 06 / 03） | fixed |
| X88 | arch | 16 TC-PRIV-02 refusal 用例；07 处置 12 Q18 | fixed |
| X89 | arch | 06 T06-S4 断言；07 §7.11 version.stale_source 参数 | fixed |
| X90 | arch | 10 part5 指标 agents_deferred | fixed |
| X91 | product | canon 吸收 ADR-X01…X04；18 改称与 N 关闭；00-overview §0.6.2 | fixed |
| X92 | product | 02 part5 / part6 只留三列 | partially |
| X93 | product | 07 §7.24 第 11 条与"canon 已补录 tasks.markDone"的说法 | fixed |
| X94 | product | 16 TC-OPS-05 INV-57 → INV-59 | fixed |
| X95 | product | 10 part7 rawOutputs 保留期 | fixed |
| X96 | product | 01 X6 / X7 与 17 E10 的身份消失兜底 | fixed |
| X97 | product | 00-invariants 回改 8 条期望与补 INV-M1 | fixed |
| X98 | product | 告知：落在 product 章节的一侧已改完，勿重复 | fixed |
