import type { FullConfig } from "@playwright/test";
import { createAuthStrategy } from "./auth/index";
import { ciEnabled, loadHarnessConfig, type AuthMode } from "./env";

export function projectWantsClerk(use: { authModeOverride?: AuthMode | undefined }, envMode: AuthMode): boolean {
  if (use.authModeOverride === "none") return false;
  if (use.authModeOverride === "clerk") return true;
  return envMode === "clerk";
}

export function selectedBaseUrl(config: FullConfig, fallback: string | undefined): string | undefined {
  for (const project of config.projects) {
    const value = project.use.baseURL;
    if (typeof value === "string" && value.length > 0) return value;
  }
  const servers = config.webServer === undefined ? [] : Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  for (const server of servers) {
    if (typeof server.url === "string" && server.url.length > 0) return server.url;
  }
  return fallback;
}

/**
 * Mint a Clerk testing token only when a selected project actually uses clerk
 * mode and a base URL is known. Self-tests that force authModeOverride=none do
 * not hit the network. In CI, clerk mode without a URL fails instead of skipping.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const loaded = loadHarnessConfig();
  const clerkProjects = config.projects.filter((project) =>
    projectWantsClerk(project.use as { authModeOverride?: AuthMode }, loaded.auth.mode),
  );
  if (clerkProjects.length === 0 || loaded.auth.mode !== "clerk") return;
  const baseURL = selectedBaseUrl({ ...config, projects: clerkProjects }, loaded.baseUrl);
  if (baseURL === undefined) {
    if (ciEnabled()) throw new Error("E2E clerk mode requires a baseURL when CI is set");
    return;
  }
  await createAuthStrategy(loaded.auth).globalSetup();
}
