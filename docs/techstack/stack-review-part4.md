# 整体栈复核与退出策略（第 4/4 部分）

> 本文件：§8 来源列表。

## 8. 来源列表（访问日期均为 2026-10-24）

- S1 已安装包元数据：`NM:convex/package.json`（1.48.0，Apache-2.0，peer react ^18‖^19）、`NM:next/package.json`（16.4.3，MIT）、`NM:react/package.json`（19.3.1）、`NM:@clerk/nextjs/package.json`（7.9.20，MIT，peer next ^16.0.10‖^16.1.0-0、react ~19.3.0-0）、`NM:@anthropic-ai/sdk/package.json`（1.1.0，Apache-2.0）、`NM:zod/package.json`（4.6.7）
- S2 https://raw.githubusercontent.com/get-convex/convex-backend/main/LICENSE.md（FSL-1.1-Apache-2.0，两周年转 Apache-2.0，禁止竞争性使用）
- S3 https://github.com/get-convex/convex-backend 与 https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/README.md（自托管，默认 SQLite，可用 Postgres / MySQL；"supports all the free-tier features"）
- S4 https://docs.convex.dev/production/state/limits（action 30 分钟 / Node 10 分钟；事务 32,000 扫描 / 16,000 写 / 16 MiB；文档 1 MiB；并发上限按计划）
- S5 https://www.convex.dev/pricing（免费档与 Pro $25/开发者/月；流式导出、日志流、每日备份仅 Pro 及以上）
- S6 https://docs.convex.dev/database/import-export/export（ZIP 导出、CLI、Data Sync API 流式导出）
- S7 https://supabase.com/docs/guides/realtime/postgres-changes（逐订阅者 RLS 授权、单线程、`DELETE` 不受 RLS、约 3,000 订阅者以上建议 Broadcast）
- S8 https://supabase.com/pricing（Free / Pro $25 / Team $599；免费项目闲置 1 周暂停；Realtime 与 Edge Function 配额）
- S9 https://supabase.com/docs/guides/functions/limits（墙钟 150 / 400 秒，CPU 2 秒，内存 256 MB）
- S10 https://supabase.com/docs/guides/auth/third-party/clerk（Clerk 第三方认证；JWT 模板方式 2025-04-01 起弃用）
- S11 二手资料：https://www.bitdoze.com/convex-self-host/ 、https://railway.com/deploy/convex-self-hosted.md（自托管资源需求与 CLI 支持有限，仅作参考）
- S12 https://trpc.io/docs/server/subscriptions（v11 支持 SSE 与 WebSocket 订阅；示例为进程内 EventEmitter）
- S13 https://vercel.com/docs/functions/limitations（Fluid compute：Hobby 300 秒；Pro 默认 300 秒、最长 800 秒，1800 秒为 Beta）
- S14 https://clerk.com/pricing（Hobby 免费 5 万 MRU；Pro $25/月）
- S15 `npm view`（2026-10-24）：@supabase/supabase-js 2.118.0、@supabase/ssr 0.12.7、supabase 2.122.0、drizzle-orm 0.45.4、prisma dist-tags（latest 8.0.0-rc.27，prev 7.10.1）、@trpc/server 11.19.0、pg-boss 12.38.0、graphile-worker 0.18.0、@rocicorp/zero 1.11.3、convex-test 0.0.65、convex-helpers 0.1.129、@anthropic-ai/sdk 最新 1.3.0
- S16 Convex CLI 源码：`CVX:cli/convexExport.ts`（导出命令）、`CVX:cli/lib/command.ts:490-518`（导入模式与 ZIP 目录格式）、`CVX:cli/lib/convexImport.ts:102-104`、`CVX:cli/lib/localDeployment/download.ts:251-277`（本地后端二进制）、`CVX:cli/lib/utils/utils.ts:45-46`（自托管环境变量名）
- 设计输入：`design/00-brief.md` §2–§3、§6；`design/inputs/04-platform-constraints*.md`（PC-1..PC-7）；`design/deepdives/frontend-ia-part3.md`、`testing-ops-part4.md`（三窗口断言）；`design/candidates2/minimal/11-architecture.md`（模块边界）
