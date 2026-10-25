import "server-only";

/**
 * Service configuration as seen by the Next server. Values never leave the server
 * except the two NEXT_PUBLIC_ ones, which are public by definition.
 */
export type ServiceConfig =
  | {
      mode: "configured";
      convexUrl: string;
      clerkPublishableKey: string;
      clerkFrontendApiHost: string | null;
    }
  | {
      mode: "unconfigured";
      missing: readonly string[];
      clerkFrontendApiHost: string | null;
    };

/**
 * Decode the Clerk Frontend API hostname from `pk_test_...` / `pk_live_...`
 * for the `/setup` issuer diagnostic without touching secret keys (13 §13.3.1).
 */
export function decodeClerkFrontendApiHost(
  publishableKey: string | undefined,
): string | null {
  if (!publishableKey) return null;
  const trimmed = publishableKey.trim();
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(trimmed);
  if (!match?.[1]) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const host = decoded.endsWith("$") ? decoded.slice(0, -1) : decoded;
    return /^[a-zA-Z0-9.-]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function getServiceConfig(): ServiceConfig {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const clerkPublishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();
  const clerkFrontendApiHost =
    decodeClerkFrontendApiHost(clerkPublishableKey);
  const missing = [
    !convexUrl && "NEXT_PUBLIC_CONVEX_URL",
    !clerkPublishableKey && "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    !clerkSecretKey && "CLERK_SECRET_KEY",
  ].filter((name): name is string => Boolean(name));
  if (convexUrl && clerkPublishableKey && missing.length === 0) {
    return {
      mode: "configured",
      convexUrl,
      clerkPublishableKey,
      clerkFrontendApiHost,
    };
  }
  return { mode: "unconfigured", missing, clerkFrontendApiHost };
}
