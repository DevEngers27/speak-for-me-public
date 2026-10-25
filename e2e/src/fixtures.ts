import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { createAuthStrategy, type AuthStrategy } from "./auth/index";
import { loadHarnessConfig, type AuthMode, type HarnessConfig } from "./env";
import { domSample, pushCapped, recordWebSocketFrames, scanRoleMarkers, type MarkerHit, type TransportLog } from "./markers";
import { ROLE_SLOTS, mapRoles, mapRolesAsync, type PerRole, type RoleSlot } from "./roles";

type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

/** Always pass a concrete storage state so a project-level storageState cannot leak across roles. */
export function storageStateForRole(cached: StorageState | undefined): StorageState {
  return cached ?? { cookies: [], origins: [] };
}

export interface RoleSession {
  readonly slot: RoleSlot;
  readonly label: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly pageErrors: readonly Error[];
  readonly consoleErrors: readonly string[];
  readonly transport: TransportLog;
  findMarkers(markers: readonly string[]): Promise<MarkerHit[]>;
  userId(): Promise<string | null>;
}

export interface HarnessOptions {
  roleLabels: PerRole<string>;
  signInRoles: boolean;
}

export interface HarnessWorkerOptions {
  authModeOverride: AuthMode | undefined;
}

interface HarnessWorkerFixtures extends HarnessWorkerOptions {
  harnessConfig: HarnessConfig;
  authStrategy: AuthStrategy;
  sessionCache: Map<RoleSlot, StorageState>;
}

export interface HarnessTestFixtures extends HarnessOptions {
  roles: PerRole<RoleSession>;
}

export const test = base.extend<HarnessTestFixtures, HarnessWorkerFixtures>({
  authModeOverride: [undefined, { scope: "worker", option: true }],
  harnessConfig: [
    async ({ authModeOverride }, use) => {
      const loaded = loadHarnessConfig();
      const config: HarnessConfig = authModeOverride === "none" ? { ...loaded, auth: { mode: "none" } } : loaded;
      if (authModeOverride === "clerk" && config.auth.mode !== "clerk") {
        throw new Error("authModeOverride=clerk requires E2E_AUTH=clerk and role identifiers in the environment");
      }
      await use(config);
    },
    { scope: "worker" },
  ],
  authStrategy: [async ({ harnessConfig }, use) => use(createAuthStrategy(harnessConfig.auth)), { scope: "worker" }],
  sessionCache: [async ({}, use) => use(new Map()), { scope: "worker" }],
  roleLabels: [mapRoles((slot) => slot), { option: true }],
  signInRoles: [true, { option: true }],
  roles: async ({ browser, baseURL, contextOptions, viewport, locale, timezoneId, harnessConfig, authStrategy, sessionCache, roleLabels, signInRoles }, run, testInfo) => {
    const reuse = harnessConfig.auth.mode === "clerk" && harnessConfig.auth.reuseSession;
    const shouldSignIn = harnessConfig.auth.mode !== "none" && signInRoles;
    const contexts: BrowserContext[] = [];
    const open = async (slot: RoleSlot): Promise<RoleSession> => {
      const cached = shouldSignIn && reuse ? sessionCache.get(slot) : undefined;
      const context = await browser.newContext({
        ...contextOptions,
        ...(baseURL === undefined ? {} : { baseURL }),
        ...(viewport === undefined ? {} : { viewport }),
        ...(locale === undefined ? {} : { locale }),
        ...(timezoneId === undefined ? {} : { timezoneId }),
        // Overrides any project-level storageState. Per-role identity stays isolated.
        storageState: storageStateForRole(cached),
      });
      contexts.push(context);
      await authStrategy.prepareContext(context);
      const page = await context.newPage();
      const pageErrors: Error[] = [];
      const consoleErrors: string[] = [];
      const transport = recordWebSocketFrames(page);
      const observe = (target: Page) => {
        target.on("pageerror", (error) => pushCapped(pageErrors, error));
        target.on("console", (message) => {
          if (message.type() === "error") pushCapped(consoleErrors, message.text());
        });
      };
      observe(page);
      context.on("page", (next) => {
        if (next !== page) observe(next);
      });
      if (shouldSignIn && cached === undefined) {
        await authStrategy.signIn(page, slot);
        if (reuse) sessionCache.set(slot, await context.storageState());
      }
      return {
        slot,
        label: roleLabels[slot],
        context,
        page,
        pageErrors,
        consoleErrors,
        transport,
        async findMarkers(markers) {
          return scanRoleMarkers(transport, await domSample(page), markers);
        },
        userId: () => authStrategy.currentUserId(page),
      };
    };
    try {
      const roles = await mapRolesAsync(open);
      await run(roles);
      if (testInfo.status !== testInfo.expectedStatus) {
        for (const slot of ROLE_SLOTS) {
          const role = roles[slot];
          const name = `role-${slot}`;
          const shot = await role.page.screenshot({ fullPage: true }).catch(() => undefined);
          if (shot !== undefined) await testInfo.attach(`${name}-screenshot`, { body: shot, contentType: "image/png" });
          const errors = [...role.pageErrors.map((error) => `pageerror: ${error.message}`), ...role.consoleErrors.map((message) => `console: ${message}`)];
          if (errors.length > 0) await testInfo.attach(`${name}-errors`, { body: errors.join("\n"), contentType: "text/plain" });
        }
      }
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  },
});

export { expect };

export async function eachRole<R, T>(items: PerRole<R>, fn: (item: R, slot: RoleSlot) => Promise<T>, options: { concurrent?: boolean } = {}): Promise<PerRole<T>> {
  if (options.concurrent ?? true) return mapRolesAsync((slot) => fn(items[slot], slot));
  const out: Partial<Record<RoleSlot, T>> = {};
  for (const slot of ROLE_SLOTS) out[slot] = await fn(items[slot], slot);
  return out as PerRole<T>;
}
