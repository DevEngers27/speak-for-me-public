# End-to-end harness

Three isolated browser contexts per test, one for each canon role: `customer`, `provider`, and `finance`. Page objects extend `BasePage`. Authentication is Clerk's testing-token flow, or none.

## Clerk testing token

1. Development instance only. Every publishable-key variable Clerk reads (`NEXT_PUBLIC_`, `VITE_`, `CLERK_`, `REACT_APP_`, `EXPO_PUBLIC_`) must be a `pk_test_` key, and they must agree. A `pk_test_` key in one variable and a `pk_live_` key in another is refused.
2. `globalSetup` calls `clerkSetup({ dotenv: false, publishableKey })` with that validated key. `dotenv: false` stops `@clerk/testing` from loading `.env`. A pre-minted `CLERK_TESTING_TOKEN` is used when present; otherwise a `sk_test_` `CLERK_SECRET_KEY` mints a short-lived token. Values are never printed.
3. Each role context calls `setupClerkTestingToken` before navigation. Sign-in uses Clerk test emails (`+clerk_test`) or test phones (`+1XXX55501XX`) only. There is no password strategy.
4. `E2E_ROLE_CUSTOMER_IDENTIFIER`, `E2E_ROLE_PROVIDER_IDENTIFIER`, and `E2E_ROLE_FINANCE_IDENTIFIER` are the three identities. Session storage stays in memory. A project-level `storageState` is replaced with an empty state so roles cannot share a cookie jar.

`globalSetup` does nothing when every selected project forces `authModeOverride: "none"`, and it does not mint a token when there is no base URL. In CI, clerk mode without a base URL fails.

## Smoke

`e2e/smoke/smoke.spec.ts` skips when the Playwright `baseURL` fixture is unset, and fails instead of skipping when `CI` is set. `BASE_URL` is copied into `use.baseURL` by `playwright.config.ts`. A config that sets `use.baseURL` directly is not skipped.

## Privacy markers

`scanRoleMarkers` / `RoleSession.findMarkers` throw when the WebSocket capture was truncated. An empty result is not proof that a value stayed private: HTTP response bodies, cookies, `input.value`, and text removed before the scan are not covered. Use unique ASCII canaries, not amounts (amounts show up in several spellings).

## Browsers

`pnpm install` does not download browsers. CI sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Install Chromium only for a real run: `pnpm exec playwright install chromium`.
