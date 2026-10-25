# 16 · 测试策略（part8：反例电池 CE-001…CE-175 → 用例矩阵）

> 分片列表见 `16-testing.md` 顶部。电池正文见 `00-invariants-part7..11.md`（canon 对齐重写版，CE-001…CE-170，"16 的用例矩阵从这里取编号"）；本章新增 CE-171…CE-175。**这是全设计唯一的 CE 编号体系**：其他章（含 00-overview §0.3 的"八条核心 → 测试编号"表）引用 CE 时一律用本编号，旧电池的 CE-001…118 编号作废（completeness-23）。每个 CE 至少映射一个可运行用例（TI-08）；与 canon 或已定稿章节不一致的电池条目在 §16.11.2 记录修订，用例按修订后的期望断言。

## 16.11 反例电池 → 用例矩阵

### 16.11.1 映射

| CE | 用例 | 层 |
| --- | --- | --- |
| 001 | TC-AUTH-03、TC-PRIV-01 | L1 |
| 002、019 | TC-PRIV-18、TC-PRIV-09 | L3 |
| 003 | TC-PRIV-05（C0 配置）、TC-PRIV-10 | L1 |
| 004 | TC-RULE-14 | L0 |
| 005、006 | TC-PRIV-08、TC-PRIV-05、TC-RULE-07 | L0、L1 |
| 007、008 | TC-PRIV-12、TC-PRIV-05 | L1 |
| 009 | TC-RUN-18、TC-PRIV-08 | L1 |
| 010 | TC-PRIV-20、TC-RULE-09 | L0、L1 |
| 011、012、134 | TC-AUTH-12；TC-PRIV-02（`run_waiting`） | L1 |
| 013 | TC-PRIV-13 | L1 |
| 014 | TC-RULE-07（候选只取已确认目录）、TC-PRIV-01 | L0、L1 |
| 015、033 | TC-PRIV-02 | L1 |
| 016、017、155 | TC-VER-10、TC-PRIV-06 | L0、L1 |
| 018 | TC-PRIV-16；L2 dev 上观察 `logLines`（§16.8.1 #11） | S、L1、L2 |
| 020 | TC-AUTH-05；L2 `join_same_role` 的同用户变体 | L1、L2 |
| 021、022 | TC-AUTH-04；E2E-08 | L1、L3 |
| 023 | E2E-08 | L3 |
| 024 | TC-INJ-01 | L0、L1 |
| 025 | TC-INJ-02 | L1 |
| 026、038、040、094 | TC-INJ-04 | L1 |
| 027、035 | TC-PRIV-08（含 `projectChecks` 参数受众表单测） | L0 |
| 028 | TC-PRIV-11 | L0 |
| 029、090、173、174 | TC-PRIV-15、TC-RULE-05 | L0、L1 |
| 030 | TC-PRIV-05 | L1 |
| 031 | TC-INJ-06、TC-PRIV-01 | L1 |
| 032 | TC-PRIV-14 | L1 |
| 034、172 | TC-PRIV-01 的披露配置扫描（§16.7.4） | L1 |
| 036 | TC-INJ-03 | L1 |
| 037、084、151 | TC-AUTH-06 | S、L1 |
| 039、078、079 | TC-RULE-09 | L0 |
| 041 | E2E-09 | L3 |
| 042 | TC-VER-04 | L1 |
| 043、089 | TC-RULE-04、TC-VER-08 | L0、L1 |
| 044、045、046 | TC-VER-09（046 另见 TC-EXE-08） | L1 |
| 047 | TC-VER-01 | L1 |
| 048 | TC-VER-02 | L1 |
| 049、055、105 | TC-VER-05 | L1 |
| 050、064、132 | TC-VER-13 | L1 |
| 051 | `[construct]` #3（§16.4.6） | L1 |
| 052 | TC-VER-12 | L1 |
| 053、058、059、065、129 | TC-VER-03；065 另见 R11 | L1 |
| 054 | TC-AUTH-07 | L1 |
| 056 | TC-VER-05 + TC-AUTH-12（`approvals.record` 不计节流）+ TC-VER-15（approve 60 行 / withdraw 10 行上限只挡 approve / withdraw，reject 永远可做，08 I22） | L1 |
| 057 | TC-VER-08、TC-VER-06 | S、L1 |
| 060、141 | TC-RUN-08 | L1 |
| 061 | TC-RUN-19 | L1 |
| 062、067、145 | TC-RUN-09（含 `react()` 深度 ≤ 4、`constraintRevisions.sourceRefs` 指向请求） | L1 |
| 063、127 | TC-RUN-03 | L1 |
| 066 | TC-RUN-20 | L1 |
| 068 | TC-AUTH-08 | L1 |
| 069、070 | TC-RUN-17 | L1 |
| 071 | TC-EXE-10（cron 未跑时 approve 以 `room.localDate` 判定并照常执行，不出现"审批有效但不可执行"；`rollLocalDate` 使结论翻转后旧 cv 的 approve → `approval.stale`，08 I16 / K27） | L1 |
| 072 | TC-RULE-13 的插件一致性套件；升级策略见 §16.15 | L0 |
| 073、074 | TC-RULE-01 | L0 |
| 075、076、077 | TC-RUN-05（077 另见 TC-RUN-10） | L1 |
| 080、142 | TC-RUN-11 | L1 |
| 081、082、091 | TC-RULE-13 | L0 |
| 083、118、130 | TC-AUTH-09（130 另见 TC-EXE-06） | L1 |
| 085 | TC-RULE-08 + 静态：internal query 返回值不含 Zod 对象 | L0、S |
| 086 | L4 `schema_accept`（§16.8.1 #13） | L4 |
| 087 | TC-RULE-03、TC-RUN-09；(b) 分支 TC-RUN-21（`pass_to_next`） | L0、L1 |
| 088、171 | TC-RUN-18 | L1 |
| 092 | TC-RUN-06（被阻断提案不花评估调用） | L1 |
| 093 | 10 的启动自检单测（I1 加载余量 + 总截止 + 落库余量 < action 上限；I3 加载余量 + 总截止 < `WATCHDOG_FIRST_MS`；I4 每链 ≤ 6；I6 SDK 重试为 0） | L0 |
| 095 | TC-VER-11 `[serial]` | L1 |
| 096 | L2 `approve_same_user` | L2 |
| 097 | L2 `approve_last_two`（L1 `[serial]` 对应 TC-EXE-01） | L2 |
| 098 | TC-RULE-11 | L0 |
| 099 | L2 `cap_vs_last_approval` | L2 |
| 100 | L2 `reject_vs_last_approval` | L2 |
| 101 | L2 `withdraw_vs_last_approval` | L2 |
| 102、170 | E2E-04；L2 观测（§16.8.1 #10） | L2、L3 |
| 103、107 | TC-EXE-01 | L1 |
| 104、147、148 | TC-OPS-05 | S |
| 106 | TC-EXE-09 | L1 |
| 108 | TC-AUTH-09 | L1 |
| 109 | TC-OPS-03 | L1、L2 |
| 110、111、115 | TC-EXE-05 | L0、L1 |
| 112、168 | TC-EXE-06（后续房间不含已交付条目、已交付键 `item.duplicate`）、TC-EXE-11（每个 execution 至多一个后续房间）；E2E-11 | L1、L2、L3 |
| 113 | R2 / R10（afterEach） | L1 |
| 114 | TC-EXE-04 | L1 |
| 116 | TC-EXE-06 + 调用图静态测试（执行路径不调用 `constraints.bump`） | S、L1 |
| 117 | TC-VER-10 同组（`ledger.recordBaseline` 第二次 → `run.invalid_state { guard: 'baseline_exists' }`） | L1 |
| 119 | L2 `start_run_repeat` | L2 |
| 120 | L2 `join_same_role` | L2 |
| 121 | TC-RUN-01 | L1 |
| 122 | TC-RUN-02；L2 `complete_vs_bump` | L1、L2 |
| 123、124、125 | TC-RUN-04（124 另见 L2 `scheduler_semantics`） | L1、L2 |
| 126、140 | TC-RUN-10 | L1 |
| 128、138 | TC-RUN-09、TC-RUN-21（`pass_to_next` 后仍恰一个 open）、TC-RUN-22（R20 回退）；LV-2（afterEach） | L1 |
| 131 | TC-EXE-07 | L1、L3 |
| 133 | TC-RUN-07 | L1 |
| 135、137 | TC-RUN-15 | L1 |
| 136、146 | TC-RUN-14（(a) 公开 `runs.start` → `run.draining`；系统路径建 run、首回合停泊；解除后自动恢复）、TC-RUN-26（(b) `run_starts` 桶） | L1 |
| 139 | TC-RUN-16 | L1 |
| 143 | TC-RULE-15 | L0 |
| 144 | TC-RUN-12 | L1 |
| 149 | §16.3 架构探针 | S |
| 150、153 | E2E-06 | L3 |
| 152、157 | TC-OPS-02（157：`runs.agentMode` 在 run 开始时快照） | L1 |
| 154 | TC-RUN-07 同组（就绪不满足 → `run.invalid_state { guard: 'not_ready' }`） | L1 |
| 156 | TI-06 静态检查（白名单外 `t.run` 写表） | S |
| 158 | TI-02 / §16.4.6 | — |
| 159 | §16.8.2 | L2 |
| 160 | TD-04 / §16.4.5 | L1 |
| 161 | TD-05 / §16.4.4 | L1 |
| 162 | §16.8.3 | L2 |
| 163 | §16.7.2 | L0 |
| 164 | §16.12 变异检查 | L1、L2 |
| 165、167 | E2E-01（167 为 $4,700 变体） | L3 |
| 166 | E2E-07 | L3 |
| 169 | E2E-03 | L3 |
| 175 | TC-PRIV-02（`disclosure_changed` 对受众外：同提交含约束变更时并入，否则中性文本）、TC-PRIV-21 | L1 |

### 16.11.2 电池修订（已并入 00-invariants，本节只留指针）

早稿在这里列出的 8 条"按 canon / 定稿章节修订后的期望"（CE-013 / 027 / 029 / 054 / 128 / 133 / 151 / 167）已由 canon 包直接改写进 `00-invariants-part7…11` 的电池本身（canon C43：电池与定稿不一致时改电池，不在别处另立期望）。本章用例一律按电池现文断言，映射见 §16.11.1。

### 16.11.3 本章新增（CE-171…CE-175；此后新增反例从 CE-176 起，由本节登记、编号不回收）

另：跨章核对阶段补录的 INV-79（终结活性）由 TC-RUN-24 覆盖，INV-M1（房间写锁）由 TC-EXE-12 覆盖；04 的 SM-28 / 29 / 30 / 31 与 09 的 SM-13 / CC-14 / CC-17 / CC-23 分别由 TC-RUN-22 / 24 / 23 / 21 与 TC-RUN-22 / 23 承接。

| CE | 操作序列 | 挡住 | 用例 |
| --- | --- | --- | --- |
| 171 | finance 把 `headroomCents` 共享给 customer；customer 代理的 counter 由含预算的视图枚举，通过全量检查的 counter 被转发进 provider 快照（counter 不是提案，不进提案列表） | DX-11 / DX-13 上界：每 run 每角色 ≤ 4 次 counter、每房间每 24 小时 ≤ 6 个 run；provider 只见被转发候选的 `optionKey` 与 "countered"，未转发的 counter 不留痕 | TC-RUN-18、TC-PRIV-05 |
| 172 | 金丝雀 fixture 恰好把被泄露的字段披露给了攻击者角色，测试因此失明（评委对 security 底稿的发现） | 披露配置扫描 C0 / C1 / Ck | §16.7.4 |
| 173 | 简报或共享事实写入形如 `CAP_480000` 的伪 itemKey | 目录成员校验 → `item.unknown` | TC-PRIV-15 |
| 174 | `sharedFacts.add` 夹带自由 `value` | 无 value 参数，值从本人当前简报复制 | TC-PRIV-15 |
| 175 | `disclosure_changed` 对非受众渲染出字段名或值；或与 cv + 1 同一提交单独渲染 "Finance updated what they share"，从而暴露约束变更者 | 新旧受众外：同一提交含 `constraints_changed` 时并入、不单独渲染，否则只见 "{role} updated what they share" | TC-PRIV-02、TC-PRIV-21 |
