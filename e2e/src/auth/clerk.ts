import type { BrowserContext, Page } from "@playwright/test";
import { checkClerkCredentials, type AuthConfig, type EnvRecord, type TestSignInStrategy } from "../env";
import type { AuthStrategy } from "./strategy";

type ClerkAuthConfig = Extract<AuthConfig, { mode: "clerk" }>;

export interface ClerkTestingApi {
  clerkSetup(options: { dotenv: false; publishableKey: string }): Promise<void>;
  setupClerkTestingToken(params: { context: BrowserContext }): Promise<void>;
  loaded(params: { page: Page }): Promise<void>;
  signIn(params: { page: Page; signInParams: { strategy: TestSignInStrategy; identifier: string } }): Promise<void>;
}

export async function loadClerkTestingApi(): Promise<ClerkTestingApi> {
  const mod = await import("@clerk/testing/playwright");
  return {
    clerkSetup: (options) => mod.clerkSetup(options),
    setupClerkTestingToken: (params) => mod.setupClerkTestingToken(params),
    loaded: (params) => mod.clerk.loaded(params),
    signIn: (params) => mod.clerk.signIn(params),
  };
}

export interface ClerkStrategyOptions {
  readonly api?: ClerkTestingApi | (() => Promise<ClerkTestingApi>);
  readonly env?: EnvRecord;
  readonly signedInTimeoutMs?: number;
}

function readClerkUserId(): string | null {
  const clerk = (window as unknown as { Clerk?: { user?: { id?: unknown } | null } }).Clerk;
  const id = clerk?.user?.id;
  return typeof id === "string" ? id : null;
}

function hasClerkUser(): boolean {
  const clerk = (window as unknown as { Clerk?: { user?: unknown } }).Clerk;
  return clerk?.user != null;
}

/**
 * Clerk testing-token strategy. See e2e/README.md.
 * `clerkSetup` receives the validated `pk_test_` key explicitly and `dotenv: false`,
 * so it cannot pick a different publishable key out of `.env`.
 */
export function createClerkStrategy(config: ClerkAuthConfig, options: ClerkStrategyOptions = {}): AuthStrategy {
  let apiPromise: Promise<ClerkTestingApi> | undefined;
  const api = (): Promise<ClerkTestingApi> => {
    if (apiPromise === undefined) {
      const source = options.api ?? loadClerkTestingApi;
      apiPromise = typeof source === "function" ? source() : Promise.resolve(source);
    }
    return apiPromise;
  };
  const timeout = options.signedInTimeoutMs ?? 15_000;
  return {
    mode: "clerk",
    async globalSetup() {
      const credentials = checkClerkCredentials(options.env ?? process.env);
      await (await api()).clerkSetup({ dotenv: false, publishableKey: credentials.publishableKey });
    },
    async prepareContext(context) {
      await (await api()).setupClerkTestingToken({ context });
    },
    async signIn(page, slot) {
      const identity = config.identities[slot];
      const clerk = await api();
      await page.goto(config.bootPath);
      await clerk.loaded({ page });
      await clerk.signIn({ page, signInParams: { strategy: identity.strategy, identifier: identity.identifier } });
      await page.waitForFunction(hasClerkUser, undefined, { timeout });
    },
    async currentUserId(page) {
      await (await api()).loaded({ page });
      return page.evaluate(readClerkUserId);
    },
  };
}
