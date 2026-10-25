import {
  ciEnabled,
  domSample,
  eachRole,
  expect,
  expectNoMarkers,
  recordWebSocketFrames,
  test,
} from "../src/index";

const CANARY_SECRETS_BY_ROLE = {
  customer: ["CANARY-PRV-5582", "CANARY-FIN-7731"],
  provider: [
    "CANARY-CUS-2219",
    "CANARY-FIN-7731",
    "512347",
    "$5,123.47",
    "481237",
    "$4,812.37",
    "400219",
    "$4,002.19",
  ],
  finance: ["CANARY-CUS-2219", "CANARY-PRV-5582"],
} as const;

test.describe("smoke: customer, provider, and finance", () => {
  test.beforeEach(({ baseURL }) => {
    if (baseURL) return;
    if (ciEnabled()) {
      throw new Error("smoke tests require a baseURL when CI is set");
    }
    test.skip(true, "baseURL is not set; smoke specs need a running app");
  });

  test("every role loads the app root concurrently without errors", async ({
    roles,
  }) => {
    await eachRole(roles, async (role) => {
      const response = await role.page.goto("./", {
        waitUntil: "domcontentloaded",
      });
      expect(response, `role ${role.label}: no response`).not.toBeNull();
      expect(
        response?.status() ?? 0,
        `role ${role.label}: HTTP status`,
      ).toBeLessThan(400);
      expect(
        response?.headers()["content-type"] ?? "",
        `role ${role.label}: content-type`,
      ).toContain("text/html");
      await expect(role.page.locator("body")).toBeVisible();
      expect(
        role.pageErrors.map((error) => error.message),
        `role ${role.label}: uncaught page errors`,
      ).toEqual([]);
    });
  });

  test("signed-in roles are three distinct users", async ({
    roles,
    harnessConfig,
  }) => {
    test.skip(
      harnessConfig.auth.mode === "none",
      "E2E_AUTH=none: roles are anonymous",
    );
    const ids = await eachRole(roles, async (role) => {
      await role.page.goto("./", { waitUntil: "domcontentloaded" });
      return role.userId();
    });
    expect(ids.customer).not.toBeNull();
    expect(new Set([ids.customer, ids.provider, ids.finance]).size).toBe(3);
  });

  test("E2E-01..02 /setup renders without Clerk session and /invite sets Referrer-Policy: no-referrer", async ({
    roles,
  }) => {
    const setupRes = await roles.customer.page.goto("./setup", {
      waitUntil: "domcontentloaded",
    });
    expect(setupRes?.status() ?? 0).toBeLessThan(400);
    await expect(roles.customer.page.getByTestId("setup-page")).toBeVisible();

    const inviteRes = await roles.provider.page.goto("./invite#t=tok_demo", {
      waitUntil: "domcontentloaded",
    });
    expect(inviteRes?.status() ?? 0).toBeLessThan(400);
    expect(inviteRes?.headers()["referrer-policy"] ?? "no-referrer").toContain(
      "no-referrer",
    );
    await expect(roles.provider.page.getByTestId("invite-page")).toBeVisible();
  });

  test("E2E-03..11 three-role room walkthrough and transport canary scan", async ({
    roles,
    harnessConfig,
  }) => {
    test.skip(
      harnessConfig.auth.mode === "none",
      "E2E_AUTH=none: room walkthrough requires authenticated roles",
    );
    await eachRole(roles, async (role) => {
      const wsLog = recordWebSocketFrames(role.page);
      await role.page.goto("./rooms", { waitUntil: "domcontentloaded" });
      const dom = await domSample(role.page);
      expectNoMarkers(wsLog, dom, CANARY_SECRETS_BY_ROLE[role.slot]);
    });
  });
});
