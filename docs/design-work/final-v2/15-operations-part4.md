# 15 · 运维（part4）：cron、seed / reset 授权、密钥与轮换、备份与 break-glass

## 15.8 cron（`convex/crons.ts`）

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.hourly("roll room local dates", { minuteUTC: 1 }, internal.clock.rollLocalDate, {});     // 无 roomId = 扇出
crons.hourly("expire human requests", { minuteUTC: 20 }, internal.humanRequests.expireDue, {}); // 无 requestId = 扇出
crons.interval("liveness sweep", { minutes: 5 }, internal.ops.livenessSweep, {});
crons.daily("purge raw model outputs", { hourUTC: 3, minuteUTC: 10 }, internal.ops.purgeRawOutputs, {});
export default crons;   // cronJobs 的确切方法签名以 convex 1.48 类型为准（待验证）
```

| cron | 频率 | 做什么 | 幂等与失败 |
| --- | --- | --- | --- |
| `clock.rollLocalDate` | 每小时（UTC :01） | 列出 `open` 房间中 `todayInTimeZone(now, timeZone) > localDate` 者，每个房间扇出一个单房间 mutation：推进 `rooms.localDate`；若当前 `pending_approval` 提案或 open 请求选项的时间结论翻转（如交付日已过），`constraints.bump(cause: "clock")` 走 D06；`localDate` 本身不在硬投影里，所以跨午夜不会作废任何审批（D22、09 §9.6.7） | 按 (房间, 日期) 幂等；每个房间一个小事务，互不 OCC 牵连（03 §3.3.1）；正常推进由每个房间在本地午夜登记的 `runAt` 单房间调用完成（09 §9.6.7、canon D22），本 cron 只在该调度丢失时兜底；物化条款前另由 `rollLocalDateTx` 同事务追平，所以不会按前一日物化 |
| `humanRequests.expireDue` | 每小时（UTC :20） | open 且 `expiresAt ≤ now` 的请求逐个扇出：→ `expired`；其 run → `ended_no_agreement`（`request_expired`）；创建者看到站内待办（D15，`HUMAN_REQUEST_TTL_DAYS = 7`） | 已处理的不再命中；每批 100 |
| `ops.livenessSweep` | 每 5 分钟；`ops.setDraining(false)` 后立即一次 | 对每个 `negotiating` run 扇出 `runs.reconcile`（无在途 attempt 且未停泊 / 延迟者被重新调度或转 `needs_input`）；超过 `deadlineAt` + 宽限仍 `running` 的 attempt → 看门狗逻辑；未接 Axiom 时顺带计算告警计数（§15.6.4） | 每次真实修复写 `opsLog("stuck_run")`；排空恢复之外的修复意味着代码缺陷，按 §15.13 排查（10 的故障表 F30 已同名） |
| `ops.purgeRawOutputs` | 每日（UTC 03:10） | 删除到期的 `rawOutputs`（模型原文）：dev 保留 30 天、prod 7 天（03 §3.8 由本章定值）；每批 500，`more` 时续跑 | 两个删除入口之一（另一个是 `seed.reset`，11 §11.7）；金丝雀扫描覆盖该表（它可能复述任何内容） |

可调用函数集合与 cron 只在部署时确定（Convex 环境变量文档）：不按环境变量条件注册 cron；三个 cron 在所有层级都存在，`preview` 与 `dev` 上同样运行（数据量小，无害）。

## 15.9 seed / reset 的授权

两层，缺一不可：

1. **客户端层**：dev-tooling `convex-ops` 守卫（`pnpm ops <operation>`），只执行固定参数的 `npx convex run <fn> <json>`，从不追加 `--prod` / `--deployment` / `--preview-name`（部署选择留在被检查过的环境里）。守卫顺序：操作已知 → 部署选择无歧义（`CONVEX_DEPLOY_KEY` 只看 `|` 之前的前缀；项目 key、预览 key、多来源一律拒绝）→ 破坏性操作在 prod 硬拒绝（解析器与规划器都执行，配置无法覆盖）→ 部署类型在该操作的允许清单内 → 破坏性操作要求 `--confirm-deployment <部署名>` → 无 `--yes` 时只打印计划（exit 3）。
2. **服务端层**：`seed.*` 入口 `await assertTier(["dev", "preview", "test"])`；`seed.reset` 另要求参数 `confirmDeployment` 等于 `(await ctx.meta.getDeploymentMetadata()).name`（D18）。即使有人拿着 prod 的 admin 会话绕过 CLI 守卫，函数本身也拒绝。

```jsonc
// convex-ops.config.json（仓库根；函数路径只在这里出现）
{ "operations": {
  "seed":     { "function": "seed:fromFixture",       "destructive": false, "allowedDeploymentTypes": ["dev", "preview"] },
  "reset":    { "function": "seed:reset",             "destructive": true,  "allowedDeploymentTypes": ["dev", "preview"] },
  "drain":    { "function": "ops:setDraining",        "destructive": false, "allowedDeploymentTypes": ["dev", "preview", "prod"] },
  "health":   { "function": "ops:configHealth",       "destructive": false, "allowedDeploymentTypes": ["dev", "preview", "prod"] },
  "inflight": { "function": "ops:activeAttemptCount", "destructive": false, "allowedDeploymentTypes": ["dev", "preview", "prod"] },
  "metrics":  { "function": "ops:metrics",            "destructive": false, "allowedDeploymentTypes": ["dev", "preview", "prod"] } } }
```

- **seed 的语义**（D18，12 §12.20）：与用户相同的 helper 链（建房 → 邀请并接受 → 基线 → 目录确认 → 简报确认），全部行 `provenance: "seeded"`，stub 代理产物 `provenance: "stub"`，界面统一显示 `SimulatedBadge`；seed 自身从不写提案 / 审批 / 执行；需要展示中间状态时用 stub 模式真实跑到那一步。演示前 seed 一个**新房间**，旧房间保留为历史（核心 6）。
- **seed 的终止状态**（只有两种，completeness-24）：① 缺省（`stopBeforeRole: null`）：第三份简报确认按生产路径在同一事务内 `openIfReady → bump(cv 1) → 开 run 1`，seed 返回时 run 1 已开始、首个 provider 回合已调度；preview 与缺省 dev 是 stub，之后的回合由调度器继续推进并标 `stub`，所以 `pr-e2e` 与演示以"run 1 已开始"为起点、按事件等待目标状态，不假设停在某一回合。② `stopBeforeRole = r`：`r` 的简报不确认，房间停在 `setup`、没有 run，由人在演示现场确认并触发首个 run。canon D18 原文的"停在三份简报已确认、首个 run 即将开始之前"不可达（第三份确认与开 run 同事务），已列 canon_objections（12 §12.25 Q17）。
- **reset 的语义**：dev / preview 才有；只删 `provenance !== "live"` 的房间及子行，按批调用直到 `more: false`；写 `opsLog("seed_reset", { rooms, rows })`。这是全仓唯一的硬删除路径（11 §11.7）。
- **生产**：没有 seed，没有 reset；`rooms.close` 归档是 `setup` / `open` 房间唯一的清理（`executed` 房间保持只读，canon D18、04 M6）；PII 抹除只经运维人工发起的 `privacy.redact`（只覆写、不删行，§15.11）。预跑的演示结果若要展示，必须来自真实运行的存档并标注 "Recorded run at {time}"（核心 8；v1 不提供回放，见 17）。
- **审计**：seed 写的事件带 `actorUserId`（fixture 身份）且行级 `provenance` 可查；`ops.setDraining` 与 reset 写 `opsLog`；环境变量变更进入 Convex `audit_log`（经日志流到 Axiom 并告警）。

## 15.10 密钥与轮换

| 密钥 | 唯一存放处 | 可读者 | 轮换做法（零停机） | 周期 |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY`（dev / prod 各一把；`ci-dev` 另一把低上限 key；preview 无） | 对应 Convex 部署环境变量 | 部署 admin | Console 新建 key → `npx convex env set`（交互输入，值不进 shell 历史；交互方式待验证）→ `live-smoke` / `runtime_smoke` 通过 → Console 停用旧 key → 确认无 401 | 90 天；泄露即换 |
| `CLERK_SECRET_KEY`（dev / prod 实例） | Vercel 环境变量（Preview / Production 分作用域，标记为敏感）；`pr-e2e` 用的 dev 实例 key 放 GitHub environment | Vercel 管理员 / CI | Clerk 支持多把 secret key 并存：新增 → 更新 Vercel → 重新部署 → 查看 Last used 后删除旧 key | 90 天 |
| `CONVEX_DEPLOY_KEY`（preview / prod / `ci-dev`） | Vercel 环境变量 + GitHub environment secret；prod key 只在受保护的 `production` environment 可读 | CI | `npx convex deployment token create <name> --deployment prod` → 更新 Vercel 与 GitHub → 发布一次 → `npx convex deployment token delete <旧名>` → 用旧 key 再发布应失败；预览 key 在项目设置页生成 | 90 天 |
| `SENTRY_AUTH_TOKEN` | Vercel 构建环境、CI | CI | Sentry 新建组织 token → 替换 → 撤销旧 | 90 天 |
| Axiom ingest token | Convex dashboard 集成配置 | 部署 admin | Axiom 新建 → 改集成 → 撤销旧 | 90 天 |
| Anthropic Admin key（仅有组织且需要对账时） | 管理员密码管理器；CI 用 `org:admin` 联合身份代替 | 组织管理员 | Console | 按需 |
| E2E 测试账号凭据 | GitHub environment secret | CI | Clerk dev 实例中重置 | 随人员变动 |

- 公开值不需要轮换：`NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、Sentry DSN、`CLERK_JWT_ISSUER_DOMAIN`、`E2E_*_SUBJECT`。
- 主副本放团队密码管理器；不进仓库、截图、聊天。CI 日志里不运行会打印值的命令（`npx convex env list` 对人类会打印值）。
- 人员离开：当天轮换其可读的全部密钥，并从 Convex 团队、Vercel 团队、Clerk、Anthropic workspace 移除。
- 上线前解码一次生产 session token，核对 `iss` 与 `aud = "convex"`（identity review r10；§8 #12）。

## 15.11 备份、恢复与 break-glass（techstack D39）

- **备份**：prod 开启 Convex 周期备份（Pro 功能，D32）+ 每次发布前 Backup Now（§15.5 第 3 步）。无 Pro 时的退路（techstack X5）：CI 定时 `npx convex export --prod` 导出到加密存储（30 天保留），每次发布前再手动导出一次；非 Pro 计划能否导出待验证。
- **自动化禁令**：CI 用 grep 检查工作流与 `scripts/` 中不得出现 `--replace` / `--replace-all`（只在自动化脚本里禁，不禁止人工恢复）。
- **break-glass 恢复手册**（人工、双人）：
  1. 先 Backup Now（保存当前状态，便于回退恢复本身）；
  2. 双人确认并在事故记录里登记；
  3. `ops.setDraining(true)`；
  4. 平台备份用 dashboard 恢复；只有离线 ZIP 才用 `npx convex import --prod --replace`（import 缺省 `requireEmpty`，必须显式确认）；
  5. 写 `opsLog("restore", { backupRef })`（只记备份标识的哈希）；
  6. 恢复后立即重放备份之后执行过的抹除（D38 / D39）：`pii_redacted` 事件只带 `table` / `field`，且 `users` 不属于任何房间，不能作为重放依据；以第 1 步的恢复前快照为抹除清单——扫描其中 `REDACTABLE_FIELDS`（03 §3.16.2）值为 `"[redacted]"` 的 `(table, rowId, field)`，对恢复后仍存在、且该字段当前值不是 `"[redacted]"` 的行逐一调用 `privacy.redact`（已是固定串的字段跳过，不重复写 `pii_redacted` 事件；覆盖本身幂等，中途中断后重跑无害）；在第 9 步解除排空之前完成；
  7. 调度表不随快照迁移：恢复后立即运行 `ops.livenessSweep`，由 `reconcile` 为 `negotiating` 的 run 重新调度；
  8. 运行 08 的对账检查器（R1–R11）覆盖全部房间，确认执行、台账、任务的一致性；
  9. `ops.setDraining(false)`。
- 首次上线前完整演练一次恢复（V5 只做一次）；退出到自托管 Convex（L0）的手册沿用同一排空与游标单调断言（techstack D01 / stack-review r03），触发条件出现时再演练。
