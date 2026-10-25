# 01 产品

## 1.1 用户与角色

| 角色 | 是谁 | 私密输入（结构化） | 代理职责 | 人的独占权力 |
| --- | --- | --- | --- | --- |
| customer | 需求方项目负责人 | 必需 / 期望 / 可延后条目、硬截止日、首选日期（软）、取舍偏好、备注 | 守住必需范围与截止日，在软偏好间权衡 | 改范围与日期、批准条款（terms）、回答取舍 |
| provider | 外部服务方 | 报价目录（价格、标准/加急工期）、是否可加急、产能备注 | 提出可交付组合，解释交付风险 | 改目录与价格、批准条款（terms） |
| finance | 需求方财务 | 预算上限（budgets 表）、软余量偏好、备注 | 从支出角度评估，必要时还价到更省的组合 | 改预算、批准预算承诺（budget） |
| owner | 创建房间的人（同时占一个角色） | — | — | 邀请、关闭房间；**不带审批权** |

规则：每个角色恰好一人；一人不能占两个角色；角色只能经邀请码绑定（07）。

## 1.2 首个场景：软件服务范围变更（模拟数据）

已承诺 $4,000 / 预算 $5,000。customer 要 LOGIN（必需）、REPORTS（期望）、EXPORT（可延后）；provider 报价 LOGIN $450、REPORTS $300、EXPORT $500、加急费 RUSH $150。全量 $1,400 超预算；一期 LOGIN + REPORTS 加急 $900 可行，交付 2026-11-20。审批途中 finance 把预算降到 $4,800：旧 $900 方案立即阻断；重新协商在"按时但没有 REPORTS（$600）"与"有 REPORTS 但晚一周（$750）"之间取舍。完整数字与走查见 14。

## 1.3 系统做什么 / 不做什么

| 做 | 不做（v1） |
| --- | --- |
| 私密简报录入、草稿与确认、逐字段披露 | 从邮件/PDF 抽取（17） |
| provider 报价目录的确认与修订 | 代理发明目录外条目（只能请求 provider 补充，17） |
| 代理在代码枚举的候选中协商；回合级进度实时可见 | token 级流式、代理之间自由聊天 |
| 代码校验预算、必需范围、日期、来源 | 让模型声称"符合预算" |
| 人对具体版本审批（terms / budget 两类签核） | 代理代签、电子签名的法律效力 |
| 全部审批到齐后原子写变更单、预算承诺、任务 | 转账、改外部 ERP、发送合同 |
| 约束变更即时阻断旧方案并重新协商或请求取舍 | 多房间共享项目预算（17） |
| 离线评测代理质量 | 线上 A/B、自动调参 |

## 1.4 关键用户旅程

### J1 建房与入席
1. owner（customer）`rooms.create`，选场景 `scope_change`，得到房间与本人 customer 席位。
2. owner 为 provider、finance 各生成一次性邀请码（`invites.create`），线下发送。
3. 对方登录（Clerk）后 `invites.accept(code)`，成为成员，显示名快照。

### J2 私密准备
1. 每人在"我的简报"填写结构化字段，逐字段勾选"对房间可见"；页面右侧展示服务端生成的"房间将看到什么"。
2. provider 录入目录条目并确认；finance 设定预算。
3. 三方简报均已确认、目录非空且已确认 → 房间显示"可以开始协商"。

### J3 协商
1. 任一成员点击"开始协商"（`runs.start`）。代码先求联合可行集：为空 → 直接给约束所有者发取舍请求（J5）；非空 → 调度 provider 代理首个回合。
2. 每个窗口看到回合级进度："Provider agent drafting…"、"Customer agent reviewing v1…"。
3. 公共时间线只出现模板文本，例如 "Provider agent proposes LOGIN + REPORTS (rush) — +$900, delivery 2026-11-20; EXPORT deferred."。
4. 各方在"我的代理"面板看到本方代理的私有理由。
5. 两个评估方代理都建议接受 → 提案进入待审批。

### J4 审批与执行
1. 提案卡显示条款、来源（目录修订号）、检查清单（按角色裁剪）、版本号与约束版本；按钮文案 "Accept terms v3 (constraints v2)" / "Approve budget commitment v3"。
2. 横幅："Agent recommendations are not approvals."
3. 最后一票提交时同一事务生成变更单、预算承诺、任务；所有窗口实时显示 "Executed"。连点或并发只产生一份。

### J5 约束变更与取舍
1. finance 把预算改为 $4,800（`budgets.update`，需填原因）。
2. 同一事务：约束版本 +1，当前 run 作废，旧提案在所有窗口翻转为 "Blocked"（provider 只见 "Blocked: exceeds the finance limit"）。
3. 代码判定仍有可行组合 → 新 run 自动开始；若两个评估方因软偏好无法收敛 → 代码给 customer 发选择请求，两个选项附价格与日期。
4. 若降到 $4,400（无可行组合）→ 不调用模型，直接给 finance 发请求："Raise the cap to at least $4,450" / "Keep the cap; no change this cycle"。

### J6 回看
结果页可从变更单追溯到：哪次 run、哪些回合、哪个目录修订、哪些人的哪条决定、当时的约束版本。

## 1.5 产品文案约束
- 任何代理产物显示 "Agent suggestion"；任何 stub/replay 产物额外显示 "Simulated agent"。
- fixture 数据显示 "Simulated example data"。
- 不出现演示脚本提示语（例如"现在把预算改成 $4,800"）。
