import type { Locator, Page, Response } from "@playwright/test";

export interface GotoOptions {
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  readonly timeout?: number;
}

/**
 * Base class for page objects. A page object wraps one page (route) of the
 * app for one role's `Page`; every role gets its own instance.
 *
 * Subclasses provide `path` (relative to baseURL, no leading origin) and,
 * ideally, `readyTestId`: a `data-testid` that the app renders only once the
 * page is interactive *and* its realtime data has loaded. Waiting on an
 * explicit marker avoids `networkidle`, which never settles on a page holding
 * a live WebSocket subscription.
 */
export abstract class BasePage {
  readonly page: Page;

  /** Route relative to baseURL, e.g. "rooms/abc" or "/rooms/abc". */
  abstract readonly path: string;

  /** data-testid rendered when the page is ready; undefined = DOM ready only. */
  protected readonly readyTestId: string | undefined = undefined;

  constructor(page: Page) {
    this.page = page;
  }

  /** Navigate to `path` and wait until the page reports ready. */
  async goto(options: GotoOptions = {}): Promise<Response | null> {
    const response = await this.page.goto(this.path, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
    await this.waitForReady();
    return response;
  }

  /** Reload (e.g. to prove state survives a refresh) and wait until ready. */
  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.waitForReady();
  }

  /** Override for pages that need a richer readiness check. */
  async waitForReady(): Promise<void> {
    if (this.readyTestId === undefined) {
      await this.page.waitForLoadState("domcontentloaded");
      return;
    }
    await this.byTestId(this.readyTestId).waitFor({ state: "visible" });
  }

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /** True when the current URL's pathname ends with this page's path. */
  isCurrent(): boolean {
    const want = this.path.replace(/^\/+/, "").split(/[?#]/)[0] ?? "";
    const have = new URL(this.page.url()).pathname.replace(/^\/+/, "");
    return want === "" ? have === "" : have === want || have.endsWith(`/${want}`);
  }
}
