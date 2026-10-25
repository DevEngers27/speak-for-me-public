import type { BrowserContext, Page } from "@playwright/test";
import type { AuthMode } from "../env";
import type { RoleSlot } from "../roles";

export interface AuthStrategy {
  readonly mode: AuthMode;
  globalSetup(): Promise<void>;
  prepareContext(context: BrowserContext): Promise<void>;
  signIn(page: Page, slot: RoleSlot): Promise<void>;
  currentUserId(page: Page): Promise<string | null>;
}

export const noAuthStrategy: AuthStrategy = {
  mode: "none",
  async globalSetup() {},
  async prepareContext() {},
  async signIn() {},
  async currentUserId() {
    return null;
  },
};
