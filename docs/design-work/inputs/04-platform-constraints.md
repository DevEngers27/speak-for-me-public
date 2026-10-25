# 04 平台约束与推荐模式（索引）

正文分 7 个分片，按任务书 §4 的 5 节组织，每节末尾有"对设计的直接含义"：

| 分片 | 内容 |
| --- | --- |
| 04-platform-constraints-part1.md | 约定与引用缩写；§1 Convex：函数类型、运行时、事务与 OCC、action、调度器 |
| 04-platform-constraints-part2.md | §1 Convex：唯一性、认证、validator、查询分页、1.48 新能力、客户端语义、convex-test；§1 含义 |
| 04-platform-constraints-part3.md | §2 Convex 官方组件（workflow / workpool / action-retrier / agent / rate-limiter）与比较表；§2 含义 |
| 04-platform-constraints-part4.md | §3 Clerk 7.9 + convex/react-clerk + Next 16 proxy；§3 含义 |
| 04-platform-constraints-part5.md | §4 Claude（上）：模型、thinking/effort、会 400 的参数、结构化输出与 SDK 1.1.0 实测 |
| 04-platform-constraints-part6.md | §4 Claude（下）：stop_reason、超时重试、缓存、用量、流式、成本；§4 含义 |
| 04-platform-constraints-part7.md | §5 Next 16 + React 19；§5 含义；待验证总表 |

## 20 条要点速查（细节与文件级引用见各分片）

1. 被调度的 mutation exactly-once 且自动重试；被调度的 action **at-most-once、不重试**；`cancel` 不能中止在途 action（`convex/src/server/scheduler.ts:37-40, 141-160`）。
2. 在 mutation 里写状态并 `runAfter(0, internal…)` 是"状态迁移 + 启动外部调用"的唯一原子组合；action 内每次 `runQuery/runMutation` 都是独立事务。
3. Convex 索引**没有唯一约束**；唯一性只能靠"单一写入口 mutation 内按索引先查后写"，依赖 OCC 冲突重试；convex-test 不模拟并发，需在真实部署上测。
4. action 的超时/丢失没有回调：重试与超时检测要么自建（attempt 表 + watchdog mutation），要么用 workpool/workflow 组件；无论哪种，提交结果的 mutation 都要做过期拒绝。
5. `v.*` 只表达形状（含字面量枚举、判别联合、`v.id`、optional vs nullable），不表达范围/长度/格式；金额等规则在代码中校验。
6. `ctx.auth.getUserIdentity()` 只保证 `tokenIdentifier`（全局唯一）与 `issuer`；`auth.config.ts` 的 `applicationID` 必须在 JWT `aud` 中。
7. Convex 1.48 新增 `v.commitTs()` / `db.vars.commitTs`（按提交顺序的全序字段）、`ctx.meta`、mutation 内 `ctx.runQuery/runMutation`、`ctx.auth.signJwt`。
8. 客户端：在途 mutation 重连后安全重发，在途 action 直接失败；用户连点仍需业务幂等。
9. workflow 组件要求 handler 确定性，改代码会让在途实例失败，日志 1 MB/8 MiB；agent 组件要求改用 Vercel AI SDK v7，与已定技术栈冲突。
10. `ConvexProviderWithClerk` 支持两种取 token 模式：会话 token `aud === "convex"`（原生集成）或 `convex` JWT 模板。
11. 房间角色是应用数据，不用 Clerk Organizations；proxy 的 `auth.protect()` 只做乐观登录检查（未登录的 API 请求得到 404）。
12. Next 16：`proxy.ts` 取代 middleware，**运行时固定 nodejs**，不能作为完整授权方案。
13. 默认模型 `claude-opus-5-5`（$4/$20，缓存读 $0.20，effort 默认 `medium`）；技能规定不得自行为省钱降级，Sonnet 5.5 / Haiku 5.5 只能作为用户决策选项。
14. Opus 5.5 thinking 始终开启，`disabled` 与 `budget_tokens` 都 400；用 `output_config.effort` 控制；thinking 计入 `max_tokens`。
15. SDK 1.1.0 默认发送 `anthropic-version: 2026-10-21`：`temperature/top_p/top_k` 任意值都 400；prefill 400；强制 `tool_choice` 在 Opus/Sonnet 5.5 上 400。
16. 结构化输出用 `output_config.format`；SDK 1.1.0 的 `zodOutputFormat` 会把 `enum`、`const`、数值/长度约束降级成描述文字（实测），这些字段不受解码约束。
17. SDK 1.1.0 的 `messages.parse()` 解析失败直接抛错（非返回 null），会丢掉 `usage`；推荐 `create` + 先查 `stop_reason` + 自行 `safeParse`。
18. SDK 默认 `timeout` 10 分钟、`maxRetries` 2（超时也重试）；非流式 `max_tokens` 超过约 21,333 会被 SDK 拒绝；必须显式配置以低于 Convex action 上限。
19. 缓存是前缀匹配（`tools → system → messages`），Opus 5.5 最小 512 token，按 workspace 与模型隔离；动态运营者指令用中途 `role: "system"` 消息，它也是不可被用户内容伪造的通道；Citations 与结构化输出互斥。
20. 只有 `NEXT_PUBLIC_` 变量进入浏览器且构建期内联；预取结果与 props 都会到达浏览器，字段裁剪必须在 Convex query 内完成。

待验证事项共 17 条，集中列在 part7 末尾。
