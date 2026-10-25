import type { BrowserContext, Page } from "@playwright/test";
import type { AuthMode } from "../env.ts";
import type { RoleSlot } from "../roles.ts";

/**
 * How a role's browser context becomes an authenticated user.
 *
 * Lifecycle per test (driven by the `roles` fixture):
 *   globalSetup()           once, in the runner process, before workers start
 *   prepareContext(ctx)     every new context, before the first navigation
 *   signIn(page, slot)      only when no reusable session exists for the slot
 *   currentUserId(page)     optional probe used by specs to assert identity
 */
export interface AuthStrategy {
  readonly mode: AuthMode;
  globalSetup(): Promise<void>;
  prepareContext(context: BrowserContext): Promise<void>;
  signIn(page: Page, slot: RoleSlot): Promise<void>;
  /** The signed-in user id as seen by the browser, or null when signed out. */
  currentUserId(page: Page): Promise<string | null>;
}

/** No authentication: every role is an anonymous, isolated browser context. */
export const noAuthStrategy: AuthStrategy = {
  mode: "none",
  async globalSetup() {},
  async prepareContext() {},
  async signIn() {},
  async currentUserId() {
    return null;
  },
};
