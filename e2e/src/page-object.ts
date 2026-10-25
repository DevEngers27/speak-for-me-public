import type { Locator, Page, Response } from "@playwright/test";

export interface GotoOptions {
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  readonly timeout?: number;
}

export function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Compare a page URL to a page-object path resolved against baseURL. */
export function pathsMatch(currentHref: string, pagePath: string, baseUrl: string): boolean {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const expected = new URL(pagePath, base);
  const current = new URL(currentHref);
  return current.origin === expected.origin && normalizePathname(current.pathname) === normalizePathname(expected.pathname) && current.search === expected.search;
}

export abstract class BasePage {
  readonly page: Page;
  readonly baseUrl: string | undefined;
  abstract readonly path: string;
  protected readonly readyTestId: string | undefined = undefined;

  constructor(page: Page, baseUrl?: string) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async goto(options: GotoOptions = {}): Promise<Response | null> {
    const response = await this.page.goto(this.path, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
    await this.waitForReady();
    return response;
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.waitForReady();
  }

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

  isCurrent(): boolean {
    const base = this.baseUrl ?? `${new URL(this.page.url()).origin}/`;
    return pathsMatch(this.page.url(), this.path, base);
  }
}
