import { defineConfig, devices } from "@playwright/test";
import { loadHarnessConfig } from "./e2e/src/env";
import type { HarnessWorkerOptions } from "./e2e/src/fixtures";

const harness = loadHarnessConfig();
const ci = process.env.CI !== undefined && process.env.CI !== "" && process.env.CI !== "0";

/**
 * Smoke project only. Browsers are not downloaded by `pnpm install` or CI
 * unless an e2e job has its secrets and runs `playwright install` itself.
 * Project-level `storageState` is ignored: each role context sets its own.
 */
export default defineConfig<HarnessWorkerOptions>({
  globalSetup: "./e2e/src/global-setup.ts",
  outputDir: "e2e/test-results",
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "stage-b", testDir: "./e2e/stage-b", use: { ...devices["Desktop Chrome"], ...(harness.baseUrl === undefined ? {} : { baseURL: harness.baseUrl }) } },
    {
      name: "smoke",
      testDir: "./e2e/smoke",
      use: {
        ...devices["Desktop Chrome"],
        ...(harness.baseUrl === undefined ? {} : { baseURL: harness.baseUrl }),
      },
    },
  ],
});
