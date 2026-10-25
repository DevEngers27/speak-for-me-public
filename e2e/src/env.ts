import { ROLE_SLOTS, mapRoles, type PerRole, type RoleSlot } from "./roles";

export type AuthMode = "none" | "clerk";
export type TestSignInStrategy = "email_code" | "phone_code";

export interface RoleIdentity {
  readonly slot: RoleSlot;
  readonly identifier: string;
  readonly strategy: TestSignInStrategy;
}

export type AuthConfig =
  | { readonly mode: "none" }
  | {
      readonly mode: "clerk";
      readonly identities: PerRole<RoleIdentity>;
      readonly bootPath: string;
      readonly reuseSession: boolean;
    };

export interface HarnessConfig {
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
  roleIdentifier: (slot: RoleSlot) => `E2E_ROLE_${slot.toUpperCase()}_IDENTIFIER`,
} as const;

/** Names Clerk's clerkSetup reads, in Clerk's order. */
export const CLERK_PUBLISHABLE_KEY_NAMES = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "REACT_APP_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

const TEST_PHONE = /^\+1\d{3}55501\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmpty(env: EnvRecord, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function ciEnabled(env: EnvRecord = process.env): boolean {
  const value = env.CI;
  return value !== undefined && value !== "" && value !== "0";
}

export function parseBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HarnessConfigError(`${ENV.baseUrl} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HarnessConfigError(`${ENV.baseUrl} must use http or https`);
  }
  if (url.username !== "" || url.password !== "") throw new HarnessConfigError(`${ENV.baseUrl} must not embed credentials`);
  if (url.search !== "" || url.hash !== "") throw new HarnessConfigError(`${ENV.baseUrl} must not contain a query string or fragment`);
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

export function parseAuthMode(raw: string | undefined): AuthMode {
  if (raw === undefined || raw === "none") return "none";
  if (raw === "clerk") return "clerk";
  throw new HarnessConfigError(`${ENV.authMode} must be "none" or "clerk"`);
}

export function parseTestIdentifier(slot: RoleSlot, raw: string | undefined): RoleIdentity {
  const key = ENV.roleIdentifier(slot);
  if (raw === undefined) throw new HarnessConfigError(`${key} is required when ${ENV.authMode}=clerk`);
  if (TEST_PHONE.test(raw)) return { slot, identifier: raw, strategy: "phone_code" };
  if (EMAIL.test(raw)) {
    const local = raw.slice(0, raw.lastIndexOf("@"));
    if (!local.includes("+clerk_test")) {
      throw new HarnessConfigError(`${key} must be a Clerk test email (local part contains "+clerk_test")`);
    }
    return { slot, identifier: raw.toLowerCase(), strategy: "email_code" };
  }
  throw new HarnessConfigError(`${key} must be a Clerk test email or test phone (+1XXX55501XX)`);
}

/**
 * Absolute paths stay on the app origin. Relative paths are kept relative so
 * Playwright resolves them under a path-prefixed baseURL. Backslashes are rejected.
 */
export function parseBootPath(raw: string | undefined, baseUrl?: string): string {
  const bootPath = raw ?? "/";
  if (bootPath.includes("\\")) throw new HarnessConfigError(`${ENV.bootPath} must not contain backslashes`);
  if (baseUrl !== undefined) {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    let url: URL;
    try {
      url = new URL(bootPath, base);
    } catch {
      throw new HarnessConfigError(`${ENV.bootPath} is not a valid path`);
    }
    if (url.origin !== new URL(base).origin) throw new HarnessConfigError(`${ENV.bootPath} must stay on the app origin`);
    if (!bootPath.startsWith("/")) return bootPath;
    return `${url.pathname}${url.search}`;
  }
  if (!bootPath.startsWith("/") || bootPath.startsWith("//")) {
    throw new HarnessConfigError(`${ENV.bootPath} must be an absolute path like "/"`);
  }
  return bootPath;
}

export function parseBooleanFlag(key: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new HarnessConfigError(`${key} must be 1/0/true/false`);
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
    if (previous !== undefined) throw new HarnessConfigError(`role ${previous} and role ${slot} share an identifier`);
    seen.set(id, slot);
  }
  return {
    baseUrl,
    auth: {
      mode,
      identities,
      bootPath: parseBootPath(nonEmpty(env, ENV.bootPath), baseUrl),
      reuseSession: parseBooleanFlag(ENV.reuseSession, nonEmpty(env, ENV.reuseSession), true),
    },
  };
}

export type ClerkCredentialSource = "preminted-testing-token" | "dev-secret-key";

export interface ClerkCredentialCheck {
  readonly source: ClerkCredentialSource;
  /** Passed to clerkSetup. Never logged. */
  readonly publishableKey: string;
}

export function checkClerkCredentials(env: EnvRecord = process.env): ClerkCredentialCheck {
  const present = CLERK_PUBLISHABLE_KEY_NAMES.flatMap((name) => {
    const value = nonEmpty(env, name);
    return value === undefined ? [] : [{ name, value }];
  });
  if (present.length === 0) {
    throw new HarnessConfigError("a Clerk publishable key is required for E2E_AUTH=clerk");
  }
  const distinct = new Set(present.map((item) => item.value));
  if (distinct.size > 1) {
    throw new HarnessConfigError("Clerk publishable key env vars disagree; refusing to guess which instance to use");
  }
  const publishableKey = present[0]?.value;
  if (publishableKey === undefined || !publishableKey.startsWith("pk_test_")) {
    throw new HarnessConfigError("the Clerk publishable key is not a development key (expected pk_test_ prefix); refusing to run");
  }
  if (nonEmpty(env, "CLERK_TESTING_TOKEN") !== undefined) return { source: "preminted-testing-token", publishableKey };
  const secretKey = nonEmpty(env, "CLERK_SECRET_KEY");
  if (secretKey === undefined) {
    throw new HarnessConfigError("CLERK_TESTING_TOKEN or CLERK_SECRET_KEY must be provided for E2E_AUTH=clerk");
  }
  if (!secretKey.startsWith("sk_test_")) {
    throw new HarnessConfigError("the Clerk secret key is not a development key (expected sk_test_ prefix); refusing to run");
  }
  return { source: "dev-secret-key", publishableKey };
}
