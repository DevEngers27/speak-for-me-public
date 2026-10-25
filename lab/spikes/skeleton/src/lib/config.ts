import "server-only";

/**
 * Service configuration as seen by the Next server. Values never leave the server
 * except the two NEXT_PUBLIC_ ones, which are public by definition.
 */
export type ServiceConfig =
  | { mode: "configured"; convexUrl: string; clerkPublishableKey: string }
  | { mode: "unconfigured"; missing: readonly string[] };

export function getServiceConfig(): ServiceConfig {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();
  const missing = [
    !convexUrl && "NEXT_PUBLIC_CONVEX_URL",
    !clerkPublishableKey && "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    !clerkSecretKey && "CLERK_SECRET_KEY",
  ].filter((name): name is string => Boolean(name));
  if (convexUrl && clerkPublishableKey && missing.length === 0) {
    return { mode: "configured", convexUrl, clerkPublishableKey };
  }
  return { mode: "unconfigured", missing };
}
