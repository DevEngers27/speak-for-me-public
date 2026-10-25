import { defineConfig, devices } from "@playwright/test";
import type { HarnessWorkerOptions } from "./src/fixtures.ts";
import { loadHarnessConfig } from "./src/env.ts";

// Fails fast on malformed E2E_* / BASE_URL values (even for --list).
const harness = loadHarnessConfig();
const ci = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "0";

export default defineConfig<HarnessWorkerOptions>({
  globalSetup: "./src/global-setup.ts",
  outputDir: "test-results",
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Multi-role tests share one backend; keep worker count modest.
  workers: ci ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    // The roles fixture attaches role-labelled screenshots on failure instead.
    screenshot: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // Self-contained harness tests against an in-process HTTP server.
      name: "self-test",
      testDir: "./e2e/self-test",
      use: { ...devices["Desktop Chrome"], authModeOverride: "none" },
    },
    {
      // Targets the deployed/running app at BASE_URL; skips when unset.
      name: "smoke",
      testDir: "./e2e/smoke",
      use: { ...devices["Desktop Chrome"], ...(harness.baseUrl === undefined ? {} : { baseURL: harness.baseUrl }) },
    },
  ],
});
