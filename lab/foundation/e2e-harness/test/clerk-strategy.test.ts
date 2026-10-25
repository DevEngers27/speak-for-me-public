import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrowserContext, Page } from "@playwright/test";
import { createAuthStrategy, noAuthStrategy, type ClerkTestingApi } from "../src/auth/index.ts";
import { loadHarnessConfig } from "../src/env.ts";

const env = {
  E2E_AUTH: "clerk",
  E2E_ROLE_A_IDENTIFIER: "role-a+clerk_test@example.com",
  E2E_ROLE_B_IDENTIFIER: "role-b+clerk_test@example.com",
  E2E_ROLE_C_IDENTIFIER: "+15555550199",
  E2E_CLERK_BOOT_PATH: "/public",
};

function fakeApi(calls: string[]): ClerkTestingApi {
  return {
    async clerkSetup(options) {
      calls.push(`clerkSetup dotenv=${String(options.dotenv)}`);
    },
    async setupClerkTestingToken() {
      calls.push("setupClerkTestingToken");
    },
    async loaded() {
      calls.push("loaded");
    },
    async signIn({ signInParams }) {
      calls.push(`signIn ${signInParams.strategy} ${signInParams.identifier}`);
    },
  };
}

function fakePage(calls: string[]): Page {
  return {
    async goto(url: string) {
      calls.push(`goto ${url}`);
      return null;
    },
    async waitForFunction() {
      calls.push("waitForFunction");
      return undefined;
    },
    async evaluate() {
      return "user_fake";
    },
  } as unknown as Page;
}

describe("auth strategy selection", () => {
  it("uses the no-op strategy when auth is off", async () => {
    const strategy = createAuthStrategy({ mode: "none" });
    assert.equal(strategy, noAuthStrategy);
    assert.equal(await strategy.currentUserId({} as Page), null);
  });
});

describe("clerk strategy (stubbed @clerk/testing)", () => {
  const config = loadHarnessConfig(env);
  if (config.auth.mode !== "clerk") throw new Error("expected clerk config");

  it("globalSetup validates dev credentials, then calls clerkSetup with dotenv disabled", async () => {
    const calls: string[] = [];
    const strategy = createAuthStrategy(config.auth, {
      api: fakeApi(calls),
      env: { CLERK_PUBLISHABLE_KEY: "pk_test_ZmFrZQ", CLERK_TESTING_TOKEN: "fake" },
    });
    await strategy.globalSetup();
    assert.deepEqual(calls, ["clerkSetup dotenv=false"]);
  });

  it("globalSetup fails closed before touching Clerk when credentials are missing", async () => {
    const calls: string[] = [];
    const strategy = createAuthStrategy(config.auth, { api: fakeApi(calls), env: {} });
    await assert.rejects(strategy.globalSetup(), /PUBLISHABLE_KEY/);
    assert.deepEqual(calls, []);
  });

  it("signIn boots Clerk on the public path, uses the role's OTP strategy, then verifies a user exists", async () => {
    const calls: string[] = [];
    const strategy = createAuthStrategy(config.auth, { api: fakeApi(calls), env: {} });
    await strategy.prepareContext({} as BrowserContext);
    await strategy.signIn(fakePage(calls), "C");
    assert.deepEqual(calls, ["setupClerkTestingToken", "goto /public", "loaded", "signIn phone_code +15555550199", "waitForFunction"]);
  });

  it("loads the Clerk API lazily and only once", async () => {
    let loads = 0;
    const calls: string[] = [];
    const strategy = createAuthStrategy(config.auth, {
      api: async () => {
        loads++;
        return fakeApi(calls);
      },
      env: {},
    });
    assert.equal(loads, 0);
    await strategy.prepareContext({} as BrowserContext);
    await strategy.prepareContext({} as BrowserContext);
    assert.equal(loads, 1);
    assert.equal(await strategy.currentUserId(fakePage(calls)), "user_fake");
  });
});
