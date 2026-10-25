import type { BrowserContext, Page } from "@playwright/test";
import { checkClerkCredentials, type AuthConfig, type EnvRecord, type TestSignInStrategy } from "../env.ts";
import type { RoleSlot } from "../roles.ts";
import type { AuthStrategy } from "./strategy.ts";

type ClerkAuthConfig = Extract<AuthConfig, { mode: "clerk" }>;

/**
 * The subset of `@clerk/testing/playwright` the harness uses. Injected so the
 * strategy can be unit-tested without a browser or a Clerk instance, and so
 * the Clerk package is only loaded when E2E_AUTH=clerk.
 */
export interface ClerkTestingApi {
  clerkSetup(options: { dotenv: false; debug?: boolean }): Promise<void>;
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
  /** Max time to wait for `window.Clerk.user` after sign-in. */
  readonly signedInTimeoutMs?: number;
}

/** Read the Clerk user id in the page; erased TS casts keep this serialisable. */
function readClerkUserId(): string | null {
  const w = window as unknown as { Clerk?: { user?: { id?: unknown } | null } };
  const id = w.Clerk?.user?.id;
  return typeof id === "string" ? id : null;
}

function hasClerkUser(): boolean {
  const w = window as unknown as { Clerk?: { user?: unknown } };
  return w.Clerk?.user != null;
}

/**
 * Clerk "testing tokens" + test-mode identifiers.
 *
 * - globalSetup: validates credentials (development keys only) and calls
 *   `clerkSetup({ dotenv: false })`, which mints a short-lived testing token
 *   (or reuses a pre-minted CLERK_TESTING_TOKEN) and exports CLERK_FAPI and
 *   CLERK_TESTING_TOKEN to worker processes via process.env. `dotenv: false`
 *   stops the Clerk helper from silently reading `.env`/`.env.local`.
 * - prepareContext: routes Frontend API requests through the testing token so
 *   bot protection does not block automated browsers.
 * - signIn: email_code / phone_code with Clerk's fixed test OTP; no passwords.
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
      checkClerkCredentials(options.env ?? process.env);
      await (await api()).clerkSetup({ dotenv: false });
    },
    async prepareContext(context) {
      await (await api()).setupClerkTestingToken({ context });
    },
    async signIn(page: Page, slot: RoleSlot) {
      const identity = config.identities[slot];
      const clerk = await api();
      await page.goto(config.bootPath);
      await clerk.loaded({ page });
      await clerk.signIn({ page, signInParams: { strategy: identity.strategy, identifier: identity.identifier } });
      // The Clerk helper returns silently when `Clerk.client` is missing, so
      // verify the session actually exists before reporting success.
      await page.waitForFunction(hasClerkUser, undefined, { timeout });
    },
    async currentUserId(page) {
      // Caller must have navigated to a page that loads Clerk.
      await (await api()).loaded({ page });
      return page.evaluate(readClerkUserId);
    },
  };
}
