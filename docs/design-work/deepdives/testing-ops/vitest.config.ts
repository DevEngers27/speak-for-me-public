// 示例：新仓库根目录 vitest.config.ts（设计稿，未运行）。
// 待验证：所装 Vitest 版本是用 `test.projects` 还是 workspace 文件；convex-test 推荐的
// `environment: "edge-runtime"` 与 `server.deps.inline: ["convex-test"]` 写法（inputs/04 待验证 #14）。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
          // 被测 Convex 函数读取的环境变量；若 convex-test 中 process.env 不可见则改走
          // __setModelClientForTests 退路（testing-ops-part3 §3.3）。
          env: {
            DEPLOYMENT_TIER: "test",
            AGENT_MODE: "stub",
            AGENTS_ENABLED: "true",
          },
        },
      },
    ],
  },
});
