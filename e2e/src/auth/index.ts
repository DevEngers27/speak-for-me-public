import type { AuthConfig, EnvRecord } from "../env";
import { createClerkStrategy, type ClerkStrategyOptions } from "./clerk";
import { noAuthStrategy, type AuthStrategy } from "./strategy";

export type { AuthStrategy } from "./strategy";
export { noAuthStrategy } from "./strategy";
export { createClerkStrategy, loadClerkTestingApi, type ClerkTestingApi, type ClerkStrategyOptions } from "./clerk";

export function createAuthStrategy(auth: AuthConfig, options: ClerkStrategyOptions & { env?: EnvRecord } = {}): AuthStrategy {
  switch (auth.mode) {
    case "none":
      return noAuthStrategy;
    case "clerk":
      return createClerkStrategy(auth, options);
  }
}
