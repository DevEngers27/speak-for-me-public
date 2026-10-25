import { eachRole, expect, test } from "../../src/index.ts";

test.describe("smoke: three roles against BASE_URL", () => {
  test.skip(({ harnessConfig }) => harnessConfig.baseUrl === undefined, "BASE_URL is not set; smoke specs need a running app");

  test("every role loads the app root concurrently without errors", async ({ roles }) => {
    await eachRole(roles, async (role) => {
      const response = await role.page.goto("./", { waitUntil: "domcontentloaded" });
      expect(response, `role ${role.label}: no response`).not.toBeNull();
      expect(response?.status() ?? 0, `role ${role.label}: HTTP status`).toBeLessThan(400);
      expect(response?.headers()["content-type"] ?? "", `role ${role.label}: content-type`).toContain("text/html");
      await expect(role.page.locator("body")).toBeVisible();
      expect(role.pageErrors.map((e) => e.message), `role ${role.label}: uncaught page errors`).toEqual([]);
    });
  });

  test("signed-in roles are three distinct users", async ({ roles, harnessConfig }) => {
    test.skip(harnessConfig.auth.mode === "none", "E2E_AUTH=none: roles are anonymous");
    const ids = await eachRole(roles, async (role) => {
      await role.page.goto("./", { waitUntil: "domcontentloaded" });
      return role.userId();
    });
    expect(ids.A).not.toBeNull();
    expect(new Set([ids.A, ids.B, ids.C]).size).toBe(3);
  });
});
