import { ROLE_SLOTS, mapRoles, type PerRole, type RoleSlot } from "./roles.ts";

/**
 * Non-secret harness configuration parsed from environment variables.
 *
 * This module is pure: it takes an env record and never touches the file
 * system, never loads `.env` files, and never reads secret values (secret
 * presence/prefix checks live in `checkClerkCredentials`, which inspects only
 * prefixes and never returns or logs the values).
 */

export type AuthMode = "none" | "clerk";

/** Clerk test-mode sign-in strategies; both use the fixed test OTP, no password. */
export type TestSignInStrategy = "email_code" | "phone_code";

export interface RoleIdentity {
  readonly slot: RoleSlot;
  /** A Clerk *test* identifier: `name+clerk_test@domain` or `+1XXX55501XX`. */
  readonly identifier: string;
  readonly strategy: TestSignInStrategy;
}

export type AuthConfig =
  | { readonly mode: "none" }
  | {
      readonly mode: "clerk";
      readonly identities: PerRole<RoleIdentity>;
      /** Public, unprotected path that loads Clerk JS before sign-in. */
      readonly bootPath: string;
      /** Sign in once per worker per role and reuse storage state in memory. */
      readonly reuseSession: boolean;
    };

export interface HarnessConfig {
  /** Absolute http(s) URL of the app under test, or undefined (smoke specs skip). */
  readonly baseUrl: string | undefined;
  readonly auth: AuthConfig;
}

export class HarnessConfigError extends Error {
  override readonly name = "HarnessConfigError";
}

export type EnvRecord = Readonly<Record<string, string | undefined>>;

export const ENV = {
  baseUrl: "BASE_URL",
  authMode: "E2E_AUTH",
  bootPath: "E2E_CLERK_BOOT_PATH",
  reuseSession: "E2E_AUTH_REUSE",
  roleIdentifier: (slot: RoleSlot) => `E2E_ROLE_${slot}_IDENTIFIER`,
} as const;

/** Clerk's documented test phone range: +1 XXX 555-0100 .. 555-0199. */
const TEST_PHONE = /^\+1\d{3}55501\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmpty(env: EnvRecord, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HarnessConfigError(`${ENV.baseUrl} must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HarnessConfigError(`${ENV.baseUrl} must use http or https, got "${url.protocol}"`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new HarnessConfigError(`${ENV.baseUrl} must not embed credentials`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new HarnessConfigError(`${ENV.baseUrl} must not contain a query string or fragment`);
  }
  // Keep a trailing slash so relative paths resolve under a path prefix.
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

export function parseAuthMode(raw: string | undefined): AuthMode {
  if (raw === undefined || raw === "none") return "none";
  if (raw === "clerk") return "clerk";
  throw new HarnessConfigError(`${ENV.authMode} must be "none" or "clerk", got "${raw}"`);
}

/**
 * Accept only Clerk test identifiers. There is deliberately no password
 * strategy: test users never have a secret, so nothing secret can leak from
 * test configuration.
 */
export function parseTestIdentifier(slot: RoleSlot, raw: string | undefined): RoleIdentity {
  const key = ENV.roleIdentifier(slot);
  if (raw === undefined) {
    throw new HarnessConfigError(`${key} is required when ${ENV.authMode}=clerk`);
  }
  if (TEST_PHONE.test(raw)) return { slot, identifier: raw, strategy: "phone_code" };
  if (EMAIL.test(raw)) {
    const local = raw.slice(0, raw.lastIndexOf("@"));
    if (!local.includes("+clerk_test")) {
      throw new HarnessConfigError(
        `${key} must be a Clerk test email (local part contains "+clerk_test"), got "${raw}"`,
      );
    }
    return { slot, identifier: raw.toLowerCase(), strategy: "email_code" };
  }
  throw new HarnessConfigError(
    `${key} must be a Clerk test email (x+clerk_test@domain) or test phone (+1XXX55501XX), got "${raw}"`,
  );
}

export function parseBootPath(raw: string | undefined): string {
  const path = raw ?? "/";
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new HarnessConfigError(`${ENV.bootPath} must be an absolute path like "/", got "${path}"`);
  }
  return path;
}

export function parseBooleanFlag(key: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new HarnessConfigError(`${key} must be 1/0/true/false, got "${raw}"`);
}

export function loadHarnessConfig(env: EnvRecord = process.env): HarnessConfig {
  const baseUrl = parseBaseUrl(nonEmpty(env, ENV.baseUrl));
  const mode = parseAuthMode(nonEmpty(env, ENV.authMode));
  if (mode === "none") return { baseUrl, auth: { mode } };

  const identities = mapRoles((slot) => parseTestIdentifier(slot, nonEmpty(env, ENV.roleIdentifier(slot))));
  const seen = new Map<string, RoleSlot>();
  for (const slot of ROLE_SLOTS) {
    const id = identities[slot].identifier;
    const previous = seen.get(id);
    if (previous !== undefined) {
      // One person must never hold two roles in the same test.
      throw new HarnessConfigError(`role ${previous} and role ${slot} share the identifier "${id}"`);
    }
    seen.set(id, slot);
  }
  return {
    baseUrl,
    auth: {
      mode,
      identities,
      bootPath: parseBootPath(nonEmpty(env, ENV.bootPath)),
      reuseSession: parseBooleanFlag(ENV.reuseSession, nonEmpty(env, ENV.reuseSession), true),
    },
  };
}

/** How the Clerk testing token will be obtained in this process. */
export type ClerkCredentialSource =
  /** A previous CI step minted the token; this process never sees the secret key. */
  | "preminted-testing-token"
  /** globalSetup mints a short-lived testing token with a development secret key. */
  | "dev-secret-key";

/**
 * Validate (by presence and prefix only) that Clerk credentials are usable for
 * testing and belong to a development instance. Values are never returned,
 * logged, or included in error messages.
 */
export function checkClerkCredentials(env: EnvRecord = process.env): ClerkCredentialSource {
  const publishableKey = nonEmpty(env, "CLERK_PUBLISHABLE_KEY") ?? nonEmpty(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  if (publishableKey === undefined) {
    throw new HarnessConfigError("CLERK_PUBLISHABLE_KEY or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required for E2E_AUTH=clerk");
  }
  if (!publishableKey.startsWith("pk_test_")) {
    throw new HarnessConfigError("the Clerk publishable key is not a development key (expected pk_test_ prefix); refusing to run");
  }
  if (nonEmpty(env, "CLERK_TESTING_TOKEN") !== undefined) return "preminted-testing-token";
  const secretKey = nonEmpty(env, "CLERK_SECRET_KEY");
  if (secretKey === undefined) {
    throw new HarnessConfigError("CLERK_TESTING_TOKEN or CLERK_SECRET_KEY must be provided by the CI secret store for E2E_AUTH=clerk");
  }
  if (!secretKey.startsWith("sk_test_")) {
    throw new HarnessConfigError("the Clerk secret key is not a development key (expected sk_test_ prefix); refusing to run");
  }
  return "dev-secret-key";
}
