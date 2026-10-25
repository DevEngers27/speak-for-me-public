# 16 测试策略（part2：用例目录）

层：L1 纯函数、L2 convex-test、L3 真实部署脚本、L4 Playwright、L5 模型评估、S 静态。"来源"列指向 07 威胁、02 不变量、原 README 验收（AC-*）或 Role A 回归（RA-*）。

## 16.7 鉴权（AUTH）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-AUTH-01 | L2 | 未认证调用每个 public query 返回 null、每个 mutation 抛 `UNAUTHENTICATED` | T-01、AC-10 |
| TC-AUTH-02 | L2 | 非成员对任一 roomId 调用全部房间函数：query null，mutation `NOT_FOUND`；与"房间不存在"的返回逐字节相同 | T-01、AC-S3 |
| TC-AUTH-03 | L2 | provider 用 finance 的 `briefVersions`/`agentNotes`/`humanRequests` id 尝试读取：不存在任何接受这些 id 的 public 函数；`briefs.myDraft` 只返回本人 | T-01、AC-G1 |
| TC-AUTH-04 | L2 | 已登录非成员不持令牌无法加入；持过期/已用/撤销令牌得到同一个 `INVITE_INVALID` | T-10、T-18 |
| TC-AUTH-05 | L2 | 建房后每个角色恰好一个席位；不存在新增席位的函数 | I-01 |
| TC-AUTH-06 | L2+L3 | 同一用户用两个令牌加入同一房间：第二次 `ALREADY_SEATED`；L3 并发接受两张令牌只成功一张 | I-02、T-10 |
| TC-AUTH-07 | S+L2 | public 函数无 `userId/roleKey/participantId` 参数；向 `decide` 额外传 `roleKey` 被参数校验拒绝 | I-03 |
| TC-AUTH-08 | L2 | 房主（customer）不能为 finance 批准、不能改他人简报、不能改必需审批人（无入口） | T-11 |
| TC-AUTH-09 | S | public 函数快照；internal 函数不出现在 `api` | T-16 |
| TC-AUTH-10 | L1+L2 | 令牌 32 字节、库中只有哈希；72 h 后 `peek` 为 null | T-18 |
| TC-AUTH-11 | L2 | 房间关闭后所有业务 mutation `ROOM_CLOSED` | I-28 |

## 16.8 隐私（PRIV）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-PRIV-01 | L2 | canary fixture，多时间点扫描全部 query × 三角色（16 §16.3） | T-02、RA-B03 |
| TC-PRIV-02 | L2 | 渲染全部事件 × 三角色扫描；provider 视图无执行后合计 | T-03、RA-B08、AC-G7 |
| TC-PRIV-03 | S | 事件载荷字段全部在公开白名单 | T-03、I-21 |
| TC-PRIV-04 | L1+L2 | 每个角色的 `AgentContext` 与请求体中无他方金丝雀 | T-04、AC-06 |
| TC-PRIV-05 | L2 | 非干扰：扰动不可见字段，视图与上下文逐字节不变 | T-04、T-09 |
| TC-PRIV-06 | L2 | 全部错误路径的 `ConvexError.data` 扫描 | T-08 |
| TC-PRIV-07 | L2 | stub rationale 注入金丝雀，他方零命中 | T-05、I-29 |
| TC-PRIV-08 | L1 | provider 候选集在 finance 上限任意变化（粗化不变）时不变；`viewEvaluation` 对 provider 永不输出 `OVER_BUDGET` | T-09 |

## 16.9 注入（INJ）

TC-INJ-01 至 TC-INJ-05 见 16 §16.5（L2，其中 01/02 另在 L5 用真实模型重复）。

## 16.10 版本与审批（VER）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-VER-01 | L2 | 用旧 `expectedConstraintsVersion` 批准 → `STALE_VIEW`，无决定写入 | T-12 |
| TC-VER-02 | L2 | 降预算后当前提案仍可行：不产生新提案版本；旧批准 stale；同一 proposalId 重新批准后可执行 | RA-R11、I-11 |
| TC-VER-03 | L2 | 两方已批准后 customer 提前截止日：cv +1，两条批准 stale，执行被拒 | RA-B02、AC-G4 |
| TC-VER-04 | L2 | 对非当前提案批准 → `STALE_VIEW` | T-12 |
| TC-VER-05 | L2 | 拒绝 → 撤回 → 批准：三条都保留，当前为 approve；旧拒绝在 cv 变化后显示 `stale_reject` | RA-B06、RA-B30 |
| TC-VER-06 | S | 不可变表无 patch/replace/delete | T-21 |
| TC-VER-07 | L3 | 降预算与最后一票并发 100 次：要么执行在前且降预算按新已承诺额判定，要么 `STALE_VIEW`；从不出现"执行了超预算提案" | T-22 |
| TC-VER-08 | L1+S | cv 只在 09 §9.1 的入口改变（调用图扫描 + 每入口单测） | I-06 |
| TC-VER-09 | L2 | 边界：降到恰好够当前提案 → carry-over，`awaiting_approval`，需重新批准 | 09 §9.8 |
| TC-VER-10 | L2 | 只改备注/软偏好/披露：cv 不变，批准仍有效 | 09 §9.2 |

## 16.11 执行（EXE）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-EXE-01 | L2 | 最后一票连续调用两次：一张变更单、一条承诺、N 个任务；第二次返回同一 changeOrderId 且 `duplicate: true`，无新事件 | T-13、AC-S6 |
| TC-EXE-02 | L3 | 对真实部署并发 5 次最后一票 + 两名审批人同时最后一票：各表只多一行 | T-13、AC-G5 |
| TC-EXE-03 | L4 | 三个浏览器，最后一位快速双击：只执行一次，其他窗口无刷新看到 CO-1 | AC-G6 |
| TC-EXE-04 | L2 | 执行后变更单、承诺、任务互相引用，任务数 = 条目数 | I-16 |
| TC-EXE-05 | L2 | 承诺快照：之后再有执行，旧变更单的前/后金额不变 | RA-B09、I-18 |
| TC-EXE-06 | L2 | 执行后 cv +1，不启动新 run；之后改预算不自动调用模型 | 09 §9.3 |

## 16.12 规则（RULE）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-RULE-01 | L1 | 价格、日期、延后项只由 `deriveTerms` 产生；`insertProposal` 不接受条款对象 | I-09、T-14 |
| TC-RULE-02 | L1 | 余量 $800、provider 发布 EXPORT-only 报价：同时报 `MISSING_REQUIRED_ITEM` 与 `AFTER_DEADLINE`，不可批准 | RA-B01 |
| TC-RULE-03 | L2 | 提案引用目录 v1 后 provider 发布 v2（改价）：旧提案 `CATALOG_STALE` | RA-B04 |
| TC-RULE-04 | L1 | 交付日早于今天 `DELIVERY_IN_PAST`；晚于截止 `AFTER_DEADLINE` 带 daysLate | RA-B11 |
| TC-RULE-05 | L1 | 预算 `≤` 判定与 shortfall 计算 | I-18 |
| TC-RULE-06 | L1 | 排名确定性与平局规则；可行性不依赖排名 | RA-B12 |
| TC-RULE-07 | L1 | 延后项 = 请求 − 选中；请求范围变化 → `DEFERRED_MISMATCH` | RA-B13 |
| TC-RULE-08 | L1 | 边界：余量 $750 时 LOGIN+REPORTS 标准通过 | 14 §14.13 |
| TC-RULE-09 | L2 | 上限低于已承诺 → `CAP_BELOW_COMMITTED` | I-19 |
| TC-RULE-10 | L1 | 金额：负数、小数、> 1 亿美分、非安全整数全部拒绝 | I-24 |
| TC-RULE-11 | L1 | 日期：`2026-02-30`、`2026-11-31` 拒绝，`2028-02-29` 接受；今天按房间时区 | RA-B10、I-25 |

## 16.13 运行时（RUN）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-RUN-01 | L2 | run 被取代后回合完成：`rejected_stale`，无提案，用量照记 | T-15、AC-S5 |
| TC-RUN-02 | L2 | 回合进行中降预算：迟到结果被拒；新 run 开始 | T-15 |
| TC-RUN-03 | L2 | 看门狗与完成同时：只有一个迁移生效 | T-15 |
| TC-RUN-04 | L2 | `stop_reason` 为 max_tokens/refusal、JSON 损坏、parsed 为空：都走失败分支，绝不视为"无动作" | F10.12 |
| TC-RUN-05 | L2 | 两个 review 同时完成：`resolveRound` 恰好执行一次 | 05 §5.5 |
| TC-RUN-06 | L2 | setup 期确认简报不递增 cv；激活时 cv = 1 | I-07 |
| TC-RUN-07 | L2 | 任意时刻至多一个非终态 run | I-10 |
| TC-RUN-08 | L2 | cv 递增取消取舍请求、保留披露请求 | I-27 |
| TC-RUN-09 | L2 | 无解变体：不调用模型、三方各收到本视图的放宽选项；finance 选项把系统带回可行 | AC-S2、AC-07 |

## 16.14 运维（OPS）

| 编号 | 层 | 用例 | 来源 |
| --- | --- | --- | --- |
| TC-OPS-01 | L3 | staging 日志金丝雀扫描零命中 | T-08 |
| TC-OPS-02 | L2 | 各限额与 `AGENTS_ENABLED=false` 生效；超限不调用模型 | T-17 |
| TC-OPS-03 | L2+L4 | 模拟房间、stub 回合、seed 记录全部带 `isSimulated` 与界面徽章 | T-19、核心 8 |
| TC-OPS-04 | L4 | 托管环境缺 Clerk key → 503；格式错误 key 不导致 500；issuer 缺失 → 推送失败 | T-20 |

## 16.15 原 README 验收的映射

AC-G1 → TC-AUTH-02/03、TC-PRIV-01；AC-G2 → L5 + TC-PRIV-04；AC-G3 → TC-RULE-*；AC-G4 → 14 主走查（L2 stub + L4）、TC-VER-03；AC-G5 → TC-EXE-01/02；AC-G6 → TC-EXE-03 与 L4 实时翻转；AC-G7 → TC-RUN-01、TC-PRIV-02、事件追溯检查。Required scenarios AC-S1–S6 分别对应 14 主走查、TC-RUN-09、TC-AUTH-03、TC-VER-03、TC-RUN-01、TC-EXE-01。
