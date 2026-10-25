# 01 原始想法整理（part1）

> 输入整理阶段产出，供所有设计代理使用。只做"吸收与评估"，不做设计；设计决定以 00-brief.md 为准。
> 来源：原黑客松仓库 /Users/zhennn/cal-hack-2026-main（只读）。原 README 自称处于"planning and team alignment"阶段（R:5），schema 与 Zod 契约都标为 Draft（S:7, N:3），代码只是骨架，所以本文把它们一律当作"想法"，不当作已验证的实现。

## 分片清单

| 文件 | 内容 |
| --- | --- |
| 01-original-ideas-part1.md | 分片清单、读取范围、行号约定、标注含义、一页总览、标注统计、§1 产品愿景与目标用户 |
| 01-original-ideas-part2.md | §2 角色与私密输入、§3 首个场景与示例数字（含算术核对） |
| 01-original-ideas-part3.md | §4 系统原则（团队规则及散落在全文中的原则） |
| 01-original-ideas-part4.md | §5 架构与服务连接草案 |
| 01-original-ideas-part5.md | §6 协商协议草案（动作、消息、轮次、升级、状态） |
| 01-original-ideas-part6.md | §7 数据模型草案与可见性表 |
| 01-original-ideas-part7.md | §8 审批 / 幂等 / 版本化要求、§9 可转为系统验收的条目 |
| 01-original-ideas-part8.md | §10 P1 / Later 功能、§11 丢弃清单、§12 原文空白与矛盾 |

同目录下的 01-original-ideas.md 只是指向本分片集的索引。

## 读取范围

README.md（601 行）、convex/README.md（15 行）、convex/schema.ts（47 行）、src/lib/negotiation.ts（22 行）、src/app/layout.tsx、src/app/page.tsx、src/app/rooms/page.tsx、src/app/setup/page.tsx；为核对 README 的说法，也读了 convex/lib/anthropic.ts、convex/auth.config.ts、convex/health.ts、src/lib/config.ts、src/proxy.ts。

## 行号约定

| 缩写 | 文件（均相对 /Users/zhennn/cal-hack-2026-main） |
| --- | --- |
| `R:n` | README.md 第 n 行 |
| `CR:n` | convex/README.md |
| `S:n` | convex/schema.ts |
| `N:n` | src/lib/negotiation.ts |
| `AN:n` / `AU:n` / `HL:n` | convex/lib/anthropic.ts / convex/auth.config.ts / convex/health.ts |
| `CF:n` / `PX:n` | src/lib/config.ts / src/proxy.ts |
| `UI/home:n` / `UI/rooms:n` / `UI/setup:n` / `UI/layout:n` | src/app/page.tsx / rooms/page.tsx / setup/page.tsx / layout.tsx |

`R:241-245` 表示连续行；源码多为单行 JSX，行号指向整段文案所在行。

## 标注含义

- **保留**：仍成立，可直接进入新设计（通常还需要具体化到字段、迁移或测试）。
- **重新评估**：方向对，但形状、范围或前提要改；每条附建议。
- **丢弃**：黑客松、赛道、团队分工或现场流程专属，不进入系统设计。

每条有稳定 ID，后续设计文档可直接引用：`V-` 愿景、`RO-` 角色、`SC-` 场景、`P-` 原则、`AR-` 架构、`PR-` 协议、`DM-` 数据、`AX-` 审批执行、`AC-` 验收、`FX-` 后续功能、`DX-` 丢弃、`GAP-` 空白与矛盾（GAP 不打标注，是给设计者的待决问题）。

## 一页总览

1. **产品**：多方 AI 协商工作台。链条是"私密委托 → 代理协商 → 代码校验 → 人批准具体版本 → 原子写入内部记录 → 约束变化后旧方案失效并恢复"。作者明确说差异化是这条完整链条，而不是"两个代理对话"（R:227, R:247）。
2. **首个场景**：软件服务范围变更，三方 customer / provider / finance。示例：总预算 $5,000、已承诺 $4,000、全量变更 $1,400、一期 $900（部分延后）；审批中预算降到 $4,800，使合计 $4,900 的旧方案不可执行（R:241, R:245）。
3. **权力分配**：代理提议与建议；人批准具体版本；代码负责权限、算术、硬约束、状态迁移和执行（R:44, R:281）。
4. **协议**：五个动作 propose / counter / clarify / recommend_accept / reject；消息携带房间、run、来源代理、基础提案版本、约束版本、结构化条款、可共享解释、来源引用；最多 3 个完整轮次后转人；畸形输出与超时有界重试（R:283-289, N:11-20）。
5. **状态**：draft → negotiating → needs_input / pending_approval → confirmed，外加 paused、failed（R:291, S:5）。
6. **数据**：8 个集合 rooms / members / privateBriefs / proposals / approvals / commitments / tasks / events，附可见性表（R:295-304, S:9-46）。
7. **审批与执行**：审批同时绑定提案版本和约束版本；最终批准时复核身份、成员、全部审批、预算、版本，一次原子写入协议、承诺、任务；唯一 operationId 防重，索引本身不保证唯一；拒绝过期模型结果；修改已确认协议开新流程并保留历史；只记录动作、来源、结果摘要，不记录隐藏推理（R:291）。
8. **验收**：G1–G7 与 6 个 Required scenarios 去掉赛道与证据格式后，几乎都能直接转成系统验收（R:397-416）。
9. **黑客松专属**：四个赞助赛道、Mana、Devpost、A/B/C/D 分工、25 小时节奏、Pitch、GitHub 协作清单——丢弃。
10. **最需要设计者处理的原文缺口**：财务预算既是 finance 的私密输入又放在成员可见的 rooms 表里；schema 没有变更单表；消息 schema 把服务端信封和模型输出混在一起；一个 status 同时代表房间、run、提案的状态；硬约束和来源引用都是自由字符串，代码无从校验（详见 §12）。

## 标注统计

（按全部带标注的条目计，GAP 不计）

| 章节 | 前缀 | 保留 | 重新评估 | 丢弃 |
| --- | --- | --- | --- | --- |
| §1 愿景与用户 | V | 11 | 4 | 0 |
| §2 角色与私密输入 | RO | 10 | 4 | 1 |
| §3 首个场景 | SC | 8 | 4 | 0 |
| §4 系统原则 | P | 24 | 5 | 2 |
| §5 架构 | AR | 18 | 7 | 0 |
| §6 协议与状态 | PR | 11 | 13 | 0 |
| §7 数据模型 | DM | 3 | 16 | 0 |
| §8 审批 / 幂等 / 版本化 | AX | 14 | 2 | 0 |
| §9 验收 | AC | 27 | 0 | 1 |
| §10 P1 / Later | FX | 2 | 6 | 5 |
| §11 丢弃清单 | DX | 0 | 0 | 15 |
| 合计（213 条） | | 128 | 61 | 24 |

另有 26 条 GAP（§12）与 §7.4 的 8 行可见性评估不计入。读法：原则、审批、验收几乎全部保留；数据模型与协议的"形状"大多要重做，但其背后的意图（版本化、只追加、幂等、上下文隔离）保留。

## §1 产品愿景与目标用户

| ID | 原作者的想法 | 出处 | 标注 | 评估与建议 |
| --- | --- | --- | --- | --- |
| V-01 | 产品是多方 AI 协商工作台：私密委托、共享提案、人工审批、执行记录 | R:227, R:7 | 保留 | 与 00-brief §1 一致 |
| V-02 | 目标用户：小企业的项目负责人、服务提供方、财务人员 | R:7 | 保留 | provider 通常属于另一家公司，意味着房间要容纳跨组织成员与邀请（GAP-17） |
| V-03 | 访谈有外包、采购或财务协调经验的人，记录流程、痛点与据此做出的改动 | R:362, R:123 | 重新评估 | 是产品验证活动，不是系统功能；放进 17-roadmap。"至少一次访谈"这类黑客松数字丢弃 |
| V-04 | 每个参与方把目标与约束委托给自己的 AI | R:7, R:45 | 保留 | 即核心 #1 私密委托 |
| V-05 | 首个场景：比较范围、报价、交付日期，检查预算，请求人类决定，批准后创建内部变更单、预算承诺和任务 | R:7, R:229 | 保留 | 成为首个场景插件的职责边界 |
| V-06 | 更广的产品以后支持其他协商场景；第二个场景要等 G1–G7 通过后再加 | R:9, R:40 | 重新评估 | brief 已定"通用引擎 + 首场景插件"。保留"先把一个场景做扎实"，但引擎接口从第一天按多场景设计；P1 的 event-budget 模板是第二场景的天然候选（FX-01） |
| V-07 | 演示一条财务工作流"从输入到记录结果" | R:9, R:231 | 保留 | 去掉 "for this event"，变成端到端闭环原则：确认过的输入 → 协商 → 审批 → 真实的内部记录 |
| V-08 | 差异化是私密委托、协商、版本化审批、恢复、执行证据的完整链条；不宣称"两个代理对话"新颖或"世界首个" | R:247 | 保留 | 同时是对外文案纪律 |
| V-09 | 一句话角色陈述："An AI service-change coordinator and budget-review assistant that checks quotes, negotiates feasible scope, and escalates commitments to authorized people." | R:67 | 重新评估 | 原为 Hyphenate 赛道而写；可作首场景的定位初稿，引擎层定位需要更通用的说法 |
| V-10 | 首页三步：Set your boundaries / Compare proposals / Approve the outcome；文案 "Approve a specific version before any budget record or task changes." | UI/home:4 | 保留 | 三步分别对应核心 #1、#4、#3，可作为产品文案种子；hero "Independent goals. Shared decisions." 可沿用 |
| V-11 | 界面默认展示结果、阻塞和需要做的决定；详细代理消息可展开 | R:260 | 保留 | 重要的 UX 原则，进入 13-frontend |
| V-12 | 四个页面：房间列表、我的私密简报、协商工作台、结果与事件历史 | R:228, R:260, R:331 | 重新评估 | 四类信息需求保留；页面结构由 13-frontend 按角色工作台重新设计（例如财务需要"待我审批"入口） |
| V-13 | 系统要像一份可以委托出去的工作：有限权限、清晰工作记录、适当升级 | R:63, R:74 | 保留 | 剥离赛道语境后就是最小权限、事件追溯、向人请求 |
| V-14 | 有用性度量：得到有效提案的时间、人工干预次数、硬约束违规数、模型成本，并报告样本数与失败 | R:124, R:418 | 保留 | 进入 15-operations 的度量；未测量前不得宣称改进百分比（R:129） |
| V-15 | 一个"无可行方案时不强行达成一致"的产品：缺信息就问人 | R:416, R:354 | 保留 | 即核心 #8 的后半句，见 PR-11 |
