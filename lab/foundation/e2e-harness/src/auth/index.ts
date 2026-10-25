import type { AuthConfig, EnvRecord } from "../env.ts";
import { createClerkStrategy, type ClerkStrategyOptions } from "./clerk.ts";
import { noAuthStrategy, type AuthStrategy } from "./strategy.ts";

export type { AuthStrategy } from "./strategy.ts";
export { noAuthStrategy } from "./strategy.ts";
export { createClerkStrategy, loadClerkTestingApi, type ClerkTestingApi, type ClerkStrategyOptions } from "./clerk.ts";

export function createAuthStrategy(
  auth: AuthConfig,
  options: ClerkStrategyOptions & { env?: EnvRecord } = {},
): AuthStrategy {
  switch (auth.mode) {
    case "none":
      return noAuthStrategy;
    case "clerk":
      return createClerkStrategy(auth, options);
  }
}
