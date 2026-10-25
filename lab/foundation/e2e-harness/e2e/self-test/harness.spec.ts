import { chromium, type Page } from "@playwright/test";
import { BasePage, eachRole, expect, test as harnessTest } from "../../src/index.ts";
import { startSelfTestServer, type SelfTestServer } from "./server.ts";

const test = harnessTest.extend<{ space: string }, { selfTestServer: SelfTestServer }>({
  selfTestServer: [
    async ({}, use) => {
      const server = await startSelfTestServer();
      await use(server);
      await server.close();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ selfTestServer }, use) => use(selfTestServer.url),
  // Each test gets its own shared-state space, as real tests get their own room.
  space: async ({}, use, testInfo) => use(`t-${testInfo.testId}-${testInfo.retry}`),
});

class SpacePage extends BasePage {
  protected override readonly readyTestId = "ready";
  readonly path: string;

  constructor(page: Page, space: string) {
    super(page);
    this.path = `./?space=${encodeURIComponent(space)}`;
  }

  async loginAs(identity: string, space: string): Promise<void> {
    await this.page.goto(`./login?as=${encodeURIComponent(identity)}&space=${encodeURIComponent(space)}`);
    await this.waitForReady();
  }
  who() {
    return this.byTestId("who");
  }
  counter() {
    return this.byTestId("counter");
  }
  async increment(): Promise<void> {
    await this.byTestId("increment").click();
  }
}

test.describe("harness self-test (in-process server)", () => {
  test.beforeAll(async () => {
    const reason = await chromium.launch().then(
      async (browser) => {
        await browser.close();
        return undefined;
      },
      (error: unknown) => `chromium is not installed (npx playwright install chromium): ${String(error).split("\n")[0]}`,
    );
    test.skip(reason !== undefined, reason);
  });

  test("each role has an isolated browser context", async ({ roles, space }) => {
    const pages = await eachRole(roles, async (role) => new SpacePage(role.page, space));
    await pages.A.loginAs("role-A", space);
    await pages.B.loginAs("role-B", space);
    await pages.C.goto();

    await expect(pages.A.who()).toHaveText("role-A");
    await expect(pages.B.who()).toHaveText("role-B");
    await expect(pages.C.who()).toHaveText("anonymous");
    const bCookies = await roles.B.context.cookies();
    expect(bCookies.map((c) => `${c.name}=${c.value}`)).toEqual(["who=role-B"]);
    expect(await roles.C.context.cookies()).toEqual([]);
    expect(new Set([roles.A.context, roles.B.context, roles.C.context]).size).toBe(3);
  });

  test("a change made by one role reaches the others without reload, and survives reload", async ({ roles, space }) => {
    const pages = await eachRole(roles, async (role) => {
      const p = new SpacePage(role.page, space);
      await p.goto();
      return p;
    });
    await eachRole(pages, async (p) => expect(p.counter()).toHaveText("0"));

    await pages.A.increment();
    await eachRole(pages, async (p) => expect(p.counter()).toHaveText("1"));

    await pages.B.increment();
    await eachRole(pages, async (p) => expect(p.counter()).toHaveText("2"));

    await pages.C.reload();
    await expect(pages.C.counter()).toHaveText("2");
  });

  test("marker scan finds a private marker only in the role it belongs to", async ({ roles, space }) => {
    const pages = await eachRole(roles, async (role) => new SpacePage(role.page, space));
    await pages.A.loginAs("role-A", space);
    await pages.B.loginAs("role-B", space);
    await pages.C.goto();

    const marker = "PRIVATE-MARKER-role-A";
    const hits = await eachRole(roles, (role) => role.findMarkers([marker]));
    expect(hits.A).toHaveLength(1);
    expect(hits.A[0]?.source).toMatch(/^dom /);
    expect(hits.B).toEqual([]);
    expect(hits.C).toEqual([]);
  });

  test("uncaught page errors are captured per role", async ({ roles }) => {
    await roles.C.page.goto("./boom");
    await expect.poll(() => roles.C.pageErrors.map((e) => e.message)).toEqual(["boom from page"]);
    expect(roles.A.pageErrors).toEqual([]);
    expect(roles.B.pageErrors).toEqual([]);
  });

  test("eachRole reports every failing role, not just the first", async ({ roles }) => {
    await expect(
      eachRole(roles, async (role) => {
        if (role.slot !== "B") throw new Error(`failed in ${role.slot}`);
      }),
    ).rejects.toThrow("role slot(s) failed: A: failed in A; C: failed in C");
  });
});
