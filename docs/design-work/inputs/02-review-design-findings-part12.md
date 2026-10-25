# 02 审查设计发现 · part12：14 首个场景、15 运维

> 分片清单见 part1。

## 14 首个场景：软件服务范围变更

### F14.1 原数字没有结局，必须有带明细的目录
- 问题：README 只给 $5,000 / $4,000 / $1,400 / $900 / $4,800 几个总额（README.md:241、:243、:245），没有行项目、日期、可延后项；"$900 一期"与"$4,900 方案"口径混用；降到 $4,800（余量 $800）后没有任何 ≤ $800 的已确认选项，结局（重谈还是升级）无法预先确定（Role A 的 `fixture.ts:48-51` 也只有 full / phase-1 两档）。
- 来源：product-03、docs-02、security-13、process-05、gap4-02（P7）。

### F14.2 审查给出的三套候选目录（都标 simulated，设计时选一套并只在代码里定义一次）
1. 带加急费行项目（product-03 修正版）：A 登录改造 required $450；B 报表 should $350；C 导出 deferrable $500；R 加急费 $100（按 customer 首选日期交付时收取）。全量 A+B+C+R = $1,400；一期 A+B+R = $900，承诺后 $4,900。cap 降到 $4,800 后两个合法选项：A+B 标准交付、晚一周、免 R = $800（恰好等于余量，校验必须用 ≤，本身是边界测试）；A+R 按时 = $550 但没有 B。customer 简报写首选日 X（soft）、硬截止 X+14（hard），"要日期还是要 B"交给 customer 取舍。真正无解的挑战值：cap $4,400（余量 $400 < A 的 $450）。注意 $4,500 在这套目录下仍可行（A 不加急 $450）。
2. 简化版 B'（docs-02 / security-13）：A $500、B $400、C $500；降预算后 A + 简化版 B' $250 = $750；另备"所有单项都超过 $800"的不可行变体。
3. 三条目（architecture-09）：LOGIN $500 / 5 天、REPORTS $400 / 4 天、EXPORT $500 / 5 天；requiredItemKeys = [LOGIN]，deferrable = [REPORTS, EXPORT]；最优一期 LOGIN+REPORTS $900；降到 $4,800 后可行组合只剩 {LOGIN $500}；若把 REPORTS 设为 required，则代码判定无解并生成人工请求。
- 共同约束：主线用不落在边界上的值，$800 = 余量留作测试；预算总额 $5,000，基线已承诺 $4,000（一条 simulated 的 baseline commitment）；fixture 是可被 Next、Convex、测试共同 import 的 TS 模块（如 `convex/fixtures/scopeChange.ts`），测试里的数字从 fixture 推出，不另写一份。
- 来源：product-03、docs-02、security-13、architecture-09、红队复核记录第 11、13 条。

### F14.3 金额口径统一
- 区分"本次变更金额"（+$900）与"批准后的已承诺总额"（$4,900）；界面同时显示二者与上限、差额。完整分解只给买方，provider 只看到变更金额与阻断原因（F07.1）。
- 来源：docs-02、security-13、P7 第 2 点。

### F14.4 一个场景要覆盖的路径
- 可行重谈（降预算后仍有合法组合）、需要取舍（两个合法选项交给 customer）、不可行（交给 finance 或 customer 做取舍）、总额低于已承诺。这些既是走查，也是回归用例（README.md:409-410 的前两行 Required scenarios）。
- 约束变化要有原因字段（F01.5）。
- 来源：security-13、P18 第 5 点、product-15。

### F14.5 公共文本模板示例
- "Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred."；"Finance constraint changed; proposal v3 blocked"（不带数字）；provider 侧 "+$900 · Blocked: exceeds the finance limit"；买方侧 "+$900 change / $4,900 committed after approval / $4,800 cap / over by $100"。
- 来源：P10、P5、P7。

## 15 运维

### F15.1 seed 与 reset
- seed / reset 只写成 internalMutation，经 CLI 调用（`npx convex run`，对生产加 `--prod`），不提供公共端点；确需界面按钮时用环境变量里的管理员 tokenIdentifier 名单控制。
- `seed.demoRoom` 一次创建：房间（fixtureKey）、budgets、baseline commitment、目录、三份预填的 draft brief、三个邀请码，返回 roomId 与邀请码；为已知账号直接写 members 时，账号 ID 先由各账号登录后调用 health.viewer 取得。
- 推荐"每次排练 seed 一个新房间、旧房间留作历史"，完全不删除，与"历史不可篡改"一致；若仍需删除式重置，只按 fixtureKey 删除，子表经 by_room 级联。
- 阶段快照（initial / proposalReady / awaitingFinance / afterTwist，或"v2 待批且 customer 已批"）可以加速演练，但预置的待批提案必须来自一次真实运行的存档并标注 "seeded from run <id>"；若原地 patch 要保留 _id 或改用稳定 slug 路由，否则已打开的 `/rooms/[roomId]` 全部失效。
- 来源：architecture-23、security-20、gap4-03（P12 第 3 点）、code-10（被推翻条目中保留的建议）。

### F15.2 用量、成本、上限
- 用量来自 agentTurns 的结构化字段；可观测指标：调用次数、p50/p95 延迟、token、被校验器拒绝次数、人工介入次数，报样本量；成本只写 token 及其估算。
- 开发与生产分 key、分 workspace，各设花费上限（建议至少留 3 倍余量）；AGENTS_ENABLED 总开关；每房间调用上限（F10.5）。
- 来源：security-12、M5（measurable usefulness 部分）、P14、P18 第 6 点。

### F15.3 日志与隐私核查
- 上线前与例行检查：在 Convex 日志里搜索 canary 字符串和预算数字，应零命中；评审/生产用 `convex deploy` 出来的部署（隐藏非 ConvexError 消息）。
- 来源：security-17、P10。

### F15.4 密钥与部署纪律
- Clerk secret 走密码管理器，不进聊天；`CONVEX_DEPLOY_KEY` 只放托管平台；环境检查脚本只报存在性，不在脚本里运行会打印值的命令（如 `npx convex env list`）。
- 有活动 run 时不部署（action 会被打断；Workflow 下改 step 会触发确定性错误）。
- 依赖纪律：新依赖选择已发布一段时间的精确版本，pnpm 的发布年龄豁免要有评审理由；CI 加超时与并发控制，actions 锁 SHA（L3，审查建议赛后再做，【改写】从第一天做）。
- 来源：P6 第 3 点、security-21、L3、P14 第 2 点。
