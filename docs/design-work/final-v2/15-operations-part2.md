# 15 · 运维（part2）：构建、发布与 CI，排空

## 15.4 构建、发布与 CI

### 15.4.1 构建与发布顺序

- **每个环境单独构建**：前端构建一律由 Convex CLI 包住，`npx convex deploy --cmd "<build>" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`，CLI 把目标部署的 URL 注入构建环境，前端不可能指向别的部署。禁止把一个环境的构建产物提升到另一个环境（11 §11.10）。
- `--cmd` 在 `runPush` **之前**执行（`deploy.ts` 源码，testing-ops review r17）：它只保证 URL 正确，不保证"前后端同一次发布"。因此发布顺序写死为：①推送向后兼容的后端（schema 只做扩展 → 回填 → 收缩，techstack D10）→ ②发布已构建好的前端；回滚顺序相反（先回前端，再回后端；后端只做向后兼容变更，代码回滚不需要数据回滚）。
- **Vercel**：Git 集成只负责 PR 预览；`vercel.json` 设 `"git": { "deploymentEnabled": { "main": false } }`，main 不自动发生产。生产由 GitHub Actions 的 release 工作流用 Vercel CLI 预构建发布：`vercel pull --environment=production` → `npx convex deploy --cmd "vercel build --prod" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`（先构建、后推送后端）→ 配置自检与冒烟 → `vercel deploy --prebuilt --prod`（发布前端）。这串命令的跨工具行为列入上线前验证（§15.14 V1、V2）。
- 不使用 Vercel 专有存储与开关（Edge Config、KV、Flags），保证可平移到 Netlify（同一构建命令，deploy key 按 deploy context 分值）。

### 15.4.2 CI 工作流

| 工作流 | 触发 | 步骤 | 需要的密钥 | 超时 |
| --- | --- | --- | --- | --- |
| `ci` | pull_request、push main | 11 §11.9 的 PR 闸门：install → codegen 漂移检查 → `deps:check` → lint → `lint:fixtures` → `arch:check` → typecheck → test → build | 无 | 15 min |
| `pr-e2e` | 同仓库 PR（fork PR 跳过） | Vercel 预览构建执行 `npx convex deploy --cmd "pnpm build" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run seed:fromFixture` → `ops.configHealth` → Playwright（三个隔离上下文，e2e-harness）对预览 URL 跑 → 金丝雀扫描 E2E 收集的 HTML 与 WebSocket 帧 → 上传 trace | 预览 deploy key；Clerk dev 实例 secret key 与 publishable key；E2E 测试账号（放在受保护的 GitHub environment；登录优先用 Clerk 测试 token + 测试邮箱验证码，具体机制待验证） | 25 min |
| `nightly` | schedule | 对 CI 专用 dev 部署 `ci-dev` 推送当前 main → 真实部署探针（并发、OCC、唯一性、节流、cron；单进程多个 `ConvexHttpClient` + `setAdminAuth` 发起，`maxOverlap ≥ 2` 才算有效样本，testing-ops review r16 / r08）→ `log_scan`（§15.6.5）→ 上传证据 | `ci-dev` deploy key（dev 部署 deploy key 的形态待验证） | 45 min |
| `live-smoke` | 每周 + 改提示 / schema / 模型 / effort 的 PR 合并后 | 对 `ci-dev` 设 `AGENT_MODE=live` 跑一次 `runtime_smoke`（一轮完整协商），断言 `stop_reason`、usage 非零、schema 通过率 | `ci-dev` deploy key；dev workspace 的低上限 key 只存在 `ci-dev` 的 Convex 环境变量里 | 30 min |
| `eval` | 手动 | 离线评测（vitest project `evals`，16），带花费护栏 | 同上 | 60 min |
| `release` | 手动 + GitHub `production` environment 保护（指定审批人） | §15.5 的排空 → 备份 → 推送后端 → 自检与只读冒烟 → 发布前端 → 解除排空 | prod deploy key、Vercel token | 30 min |

- 每个工作流 `permissions: contents: read`；第三方 Action 锁完整 commit SHA；`concurrency` 按分支分组，`release` 与 `nightly` 的部署 job 不取消进行中的运行（防止部署被拦腰中断）。
- `minimumReleaseAge` 例外清单由脚本从 lockfile 生成、每条带到期日，`deps:check` 在 CI 检查过期（D20、techstack X1）；pnpm 11 安装时会自动把过新的包写进例外清单，PR 评审必须审查这部分差异（spikes §7 15 段）。
- SDK 从 1.1.0 升级到 1.3.x 之前，`live-smoke` 与 SDK 类型契约测试必须先通过（D20）。

## 15.5 排空（`opsFlags.draining`）

`opsFlags` 是单行表（`key: "global"`），`ops.setDraining` 是唯一写入口，全部层级可用、只经 CLI 与部署 admin 权限调用（12 §12.20）。语义（D17、10 §10.12.3）：置位后公开的 `runs.start` / `runs.requestRenegotiation` / 需要新 attempt 的回答抛 `run.draining`；`turns.beginAttempt` 对 live 回合返回 `parked`（回合停泊，run 保持 `negotiating`）；约束变化引起的新 run 照常建立（拒绝建 run 会回滚约束变更本身），只是首个回合停泊；在途 attempt 照常提交；解除时 `ops.livenessSweep` 对每个 `negotiating` run 调度 `runs.reconcile` 恢复停泊的回合。stub 不受排空影响（canon D17）：它不发外部请求，部署打断的 stub attempt 由看门狗兜底。

**发布步骤**（release 工作流；人工执行时用 `pnpm ops`，见 §15.9）：

1. `npx convex run ops:setDraining '{"draining":true,"reason":"release <sha>"}' --prod`。界面上新 run 与"重试"显示"Maintenance in progress"。
2. 每 10 秒 `npx convex run ops:activeAttemptCount --prod`，直到 `runningLive === 0`。等待上限 = `ACTION_WALL_MAX_MS`（10 §10.11 由 SDK 时间预算推导的单个 action 最长墙钟，含落库余量）+ 60 秒；超时则继续，把仍在途的 attemptId 写进发布记录——它们会被看门狗判 `error`，由 `turns.fail` 的策略与 `reconcile` 接手，用户最多看到一次 `agent_failed` 请求。
3. 备份：Pro 用 dashboard / CLI 的 Backup Now；无 Pro 用 `npx convex export --prod`（§15.11）。
4. 推送后端（`npx convex deploy`）。schema 变更遵循扩展 → 回填 → 收缩；大表索引用 staged 索引；`@convex-dev/migrations` 在首个需要回填的变更时才安装（techstack D10）。
5. `ops.configHealth` 必须 `configValid`；`ops.checkModelConfig`（live 缺 key 或模型不可用即失败）；只读冒烟：`health.ping`、`users.viewer`（测试账号）、`rooms.listMine`；失败即回滚（重新部署上一个 SHA 的后端）。v1 不做付费的 schema 预热：首个真实回合承担一次编译开销（12 §12.24）。
6. 发布前端（`vercel deploy --prebuilt --prod`）。
7. `npx convex run ops:setDraining '{"draining":false,"reason":"release <sha> done"}' --prod`；`ops.livenessSweep` 扇出 `runs.reconcile` 恢复停泊的回合；查看其返回的 `scheduled` 数是否与步骤 1 时的 `negotiatingRuns` 相符。

### 15.5.1 场景版本迁移纪律

房间在建房时钉住 `scenarioKey@scenarioVersion`（03 §3.2 第 7 条），Convex 侧只经 `scenarioOf(room)` 取插件（11 §11.3）。v1 的规则：

1. **注册表只增不删**：新场景版本以新的 `scenarioVersion` 注册，旧版本插件保留在 `convex/scenarios/registry.ts`，直到没有任何非终态房间钉住它；新房间由 `rooms.create` 经 `latestScenarioVersion` 钉最新版本。
2. **删除旧版本前的发布检查**：release 工作流在步骤 4 之前读 `ops.metrics` 的 `liveRoomsByScenarioVersion`（§15.6.6），不为 0 则禁止移除该版本（CI 对 registry 的删除 diff 要求附上这条检查的输出）。
3. **必须迁移在途房间时**（v1 不提供迁移脚本）：对每个房间同事务执行 `constraints.bump(cause: 'scenario_migrated')` 并改钉新版本，走 D06 把旧 run supersede、旧审批自然失效、由新 run 重新协商与重批（canon D05 的第三种强制递增）；该操作是 internal、经 CLI 人工发起。
4. **违反纪律时的兜底**：approve 被 08 S5 拦下（`run.invalid_state{ guard: 'scenario_version' }`）；reject 照常写入，但下一回合由 04 U1 的场景版本前置拦住，run 进入 `needs_input` + `agent_failed`（只有 `end_run`，10 F33）。这两条只是兜底，正常发布永远不应触发。

**紧急止血**：`npx convex env set AGENTS_ENABLED false --prod` 只在成本失控或模型侧事故时用：live attempt 在调模型前直接 `error(agents_disabled)`，对应 run 进入 `needs_input`（`agent_failed`）。环境变量变更对在途与新调用的生效时机未验证（observability V10），所以它不承担排空职责。
