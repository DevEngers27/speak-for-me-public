import { describe, expect, test } from "vitest";
import type { Page } from "@playwright/test";
import { createClerkStrategy, type ClerkTestingApi } from "./src/auth/clerk";
import { HarnessConfigError, checkClerkCredentials, loadHarnessConfig, parseBootPath } from "./src/env";
import { projectWantsClerk, selectedBaseUrl } from "./src/global-setup";
import { createTransportLog, expectNoMarkers, pushCapped, scanRoleMarkers } from "./src/markers";
import { BasePage, pathsMatch } from "./src/page-object";
import { mapRolesAsync } from "./src/roles";
import { storageStateForRole } from "./src/fixtures";

const clerkEnv = {
  E2E_AUTH: "clerk",
  E2E_ROLE_CUSTOMER_IDENTIFIER: "customer+clerk_test@example.com",
  E2E_ROLE_PROVIDER_IDENTIFIER: "provider+clerk_test@example.com",
  E2E_ROLE_FINANCE_IDENTIFIER: "+15555550100",
};

describe("harness config", () => {
  test("defaults to no base URL and no auth", () => {
    expect(loadHarnessConfig({})).toEqual({ baseUrl: undefined, auth: { mode: "none" } });
  });

  test("parses canon role identifiers", () => {
    const config = loadHarnessConfig(clerkEnv);
    expect(config.auth.mode).toBe("clerk");
    if (config.auth.mode !== "clerk") return;
    expect(config.auth.identities.customer.strategy).toBe("email_code");
    expect(config.auth.identities.finance.strategy).toBe("phone_code");
    expect(config.auth.bootPath).toBe("/");
  });

  test("rejects a backslash boot path and keeps a relative path under a prefix", () => {
    expect(() => parseBootPath("/\\evil.example/x", "https://app.example/prefix/")).toThrow(HarnessConfigError);
    expect(parseBootPath("sign-in", "https://app.example/prefix/")).toBe("sign-in");
    expect(parseBootPath("/sign-in", "https://app.example/prefix/")).toBe("/sign-in");
  });

  test("refuses disagreeing publishable keys and does not echo them", () => {
    const pk = "pk_test_ZmFrZS5leGFtcGxlJA";
    expect(() =>
      checkClerkCredentials({
        CLERK_PUBLISHABLE_KEY: pk,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_OTHER",
        CLERK_TESTING_TOKEN: "t",
      }),
    ).toThrow(/disagree/);
    try {
      checkClerkCredentials({ CLERK_PUBLISHABLE_KEY: pk, CLERK_SECRET_KEY: "sk_live_SENTINEL123" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessConfigError);
      expect((error as Error).message).not.toContain("SENTINEL123");
    }
    expect(checkClerkCredentials({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk, CLERK_PUBLISHABLE_KEY: pk, CLERK_TESTING_TOKEN: "t" })).toEqual({
      source: "preminted-testing-token",
      publishableKey: pk,
    });
  });
});

describe("clerk strategy", () => {
  test("passes the validated publishable key and disables dotenv", async () => {
    const pk = "pk_test_ZmFrZS5leGFtcGxlJA";
    const calls: unknown[] = [];
    const api: ClerkTestingApi = {
      async clerkSetup(options) {
        calls.push(options);
      },
      async setupClerkTestingToken() {},
      async loaded() {},
      async signIn() {},
    };
    const loaded = loadHarnessConfig(clerkEnv);
    if (loaded.auth.mode !== "clerk") throw new Error("expected clerk");
    const strategy = createClerkStrategy(loaded.auth, {
      api,
      env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk, CLERK_TESTING_TOKEN: "t" },
    });
    await strategy.globalSetup();
    expect(calls).toEqual([{ dotenv: false, publishableKey: pk }]);
  });
});

describe("markers", () => {
  test("a truncated capture fails the leak scan", () => {
    const recorder = createTransportLog(4);
    recorder.push("ws:received", "abcd");
    recorder.push("ws:received", "LEAK");
    expect(recorder.log.truncated).toBe(true);
    expect(recorder.log.samples.map((sample) => sample.text)).toEqual(["abcd"]);
    expect(() => scanRoleMarkers(recorder.log, { source: "dom", text: "" }, ["LEAK"])).toThrow(/truncated/);
    expect(() => expectNoMarkers(recorder.log, { source: "dom", text: "" }, ["LEAK"])).toThrow(/truncated/);
  });

  test("counts UTF-8 bytes and caps observed errors", () => {
    const recorder = createTransportLog(3);
    recorder.push("ws:received", "éé");
    expect(recorder.log.truncated).toBe(true);
    const items: number[] = [];
    pushCapped(items, 1, 1);
    pushCapped(items, 2, 1);
    expect(items).toEqual([1]);
  });
});

describe("page objects and role isolation", () => {
  test("isCurrent resolves relative paths and trailing slashes", () => {
    expect(pathsMatch("http://127.0.0.1:9/?space=t1", "./?space=t1", "http://127.0.0.1:9/")).toBe(true);
    expect(pathsMatch("http://127.0.0.1:9/rooms", "rooms/", "http://127.0.0.1:9/")).toBe(true);
    expect(pathsMatch("http://127.0.0.1:9/x/abc", "abc", "http://127.0.0.1:9/")).toBe(false);
    const page = { url: () => "http://127.0.0.1:9/rooms" } as Page;
    class RoomsPage extends BasePage {
      readonly path = "rooms/";
    }
    expect(new RoomsPage(page, "http://127.0.0.1:9/").isCurrent()).toBe(true);
  });

  test("missing session state is an empty storage state, not an absent key", () => {
    expect(storageStateForRole(undefined)).toEqual({ cookies: [], origins: [] });
  });

  test("mapRolesAsync reports every failed slot", async () => {
    await expect(
      mapRolesAsync(async (slot) => {
        if (slot !== "provider") throw new Error(slot);
        return slot;
      }),
    ).rejects.toThrow(/customer: customer/);
  });
});

describe("global setup selection", () => {
  test("skips clerk when the selected project forces none", () => {
    expect(projectWantsClerk({ authModeOverride: "none" }, "clerk")).toBe(false);
    expect(projectWantsClerk({}, "clerk")).toBe(true);
    expect(selectedBaseUrl({ projects: [{ use: { baseURL: "http://127.0.0.1:9/" } }] } as never, undefined)).toBe("http://127.0.0.1:9/");
  });
});
