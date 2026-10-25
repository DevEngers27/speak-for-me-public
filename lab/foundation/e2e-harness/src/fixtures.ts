import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { createAuthStrategy, type AuthStrategy } from "./auth/index.ts";
import { loadHarnessConfig, type AuthMode, type HarnessConfig } from "./env.ts";
import { domSample, findMarkers, recordWebSocketFrames, type MarkerHit, type TransportLog } from "./markers.ts";
import { ROLE_SLOTS, mapRoles, mapRolesAsync, type PerRole, type RoleSlot } from "./roles.ts";

type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

/** One role's isolated browser session inside a test. */
export interface RoleSession {
  readonly slot: RoleSlot;
  /** Human-readable label for reports (defaults to the slot letter). */
  readonly label: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Uncaught page exceptions observed so far. */
  readonly pageErrors: readonly Error[];
  /** `console.error` messages observed so far. */
  readonly consoleErrors: readonly string[];
  /** WebSocket frames received/sent (bounded), for marker scans. */
  readonly transport: TransportLog;
  /** Scan this role's current DOM and recorded transport for markers. */
  findMarkers(markers: readonly string[]): Promise<MarkerHit[]>;
  /** Signed-in user id according to the auth strategy (null when anonymous). */
  userId(): Promise<string | null>;
}

export interface HarnessOptions {
  /** Labels shown in attachments and errors, e.g. scenario role names. */
  roleLabels: PerRole<string>;
  /** Sign roles in before the test body (ignored when auth mode is "none"). */
  signInRoles: boolean;
}

export interface HarnessWorkerOptions {
  /** Override the auth mode from E2E_AUTH (e.g. force "none" for self-tests). */
  authModeOverride: AuthMode | undefined;
}

interface HarnessWorkerFixtures extends HarnessWorkerOptions {
  harnessConfig: HarnessConfig;
  authStrategy: AuthStrategy;
  /** In-memory storage state per role, per worker. Never written to disk. */
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
      const config: HarnessConfig =
        authModeOverride === "none" ? { ...loaded, auth: { mode: "none" } } : loaded;
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

  roles: async (
    { browser, baseURL, contextOptions, viewport, locale, timezoneId, harnessConfig, authStrategy, sessionCache, roleLabels, signInRoles },
    use,
    testInfo,
  ) => {
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
        ...(cached === undefined ? {} : { storageState: cached }),
      });
      contexts.push(context);
      await authStrategy.prepareContext(context);
      const page = await context.newPage();

      const pageErrors: Error[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const transport = recordWebSocketFrames(page);

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
          return findMarkers([await domSample(page), ...transport.samples], markers);
        },
        userId: () => authStrategy.currentUserId(page),
      };
    };

    try {
      const roles = await mapRolesAsync(open);
      await use(roles);

      if (testInfo.status !== testInfo.expectedStatus) {
        for (const slot of ROLE_SLOTS) {
          const role = roles[slot];
          const name = `role-${slot}${role.label === slot ? "" : `-${role.label}`}`;
          const shot = await role.page.screenshot({ fullPage: true }).catch(() => undefined);
          if (shot !== undefined) await testInfo.attach(`${name}-screenshot`, { body: shot, contentType: "image/png" });
          const errors = [...role.pageErrors.map((e) => `pageerror: ${e.message}`), ...role.consoleErrors.map((m) => `console: ${m}`)];
          if (errors.length > 0) await testInfo.attach(`${name}-errors`, { body: errors.join("\n"), contentType: "text/plain" });
        }
      }
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  },
});

export { expect };

/**
 * Run `fn` for every role's item (sessions, page objects, ...) concurrently
 * (default) or in slot order. Concurrent mode awaits all roles and reports
 * every failing slot, so a failure in role A does not mask one in role C.
 */
export async function eachRole<R, T>(
  items: PerRole<R>,
  fn: (item: R, slot: RoleSlot) => Promise<T>,
  options: { concurrent?: boolean } = {},
): Promise<PerRole<T>> {
  if (options.concurrent ?? true) return mapRolesAsync((slot) => fn(items[slot], slot));
  const out: Partial<Record<RoleSlot, T>> = {};
  for (const slot of ROLE_SLOTS) out[slot] = await fn(items[slot], slot);
  return out as PerRole<T>;
}
