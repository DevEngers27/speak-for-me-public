import type { FullConfig } from "@playwright/test";
import { createAuthStrategy } from "./auth/index.ts";
import { loadHarnessConfig } from "./env.ts";

/**
 * Runs once in the runner process before workers start (not for --list).
 * With no BASE_URL there is nothing to authenticate against: specs that need
 * the app skip themselves, so setup is skipped too.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const config = loadHarnessConfig();
  if (config.baseUrl === undefined || config.auth.mode === "none") return;
  await createAuthStrategy(config.auth).globalSetup();
}
