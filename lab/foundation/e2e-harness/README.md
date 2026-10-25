# e2e-harness

Playwright harness for **multi-role end-to-end tests**: every test gets three
simultaneous, fully isolated browser contexts (role slots `A`, `B`, `C`), a
page-object base class, a Clerk authentication strategy for CI that stores no
secrets, and a smoke spec that targets a configurable `BASE_URL` and skips
cleanly when it is unset.

It is a foundation module: it knows nothing about rooms, proposals, approvals
or scenario roles. The app repo maps its scenario roles onto slots A/B/C and
writes its own page objects on top of `BasePage`.

## Layout

```
playwright.config.ts        projects: self-test (in-process server), smoke (BASE_URL)
src/
  index.ts                  public API (re-exports)
  fixtures.ts               `test` with the `roles` fixture, `eachRole`
  page-object.ts            `BasePage`
  roles.ts                  slots A/B/C, PerRole<T>, mapRoles, mapRolesAsync
  env.ts                    pure, validated config from env (no .env loading)
  markers.ts                canary/marker scan over DOM + WebSocket frames
  auth/strategy.ts          AuthStrategy interface, no-op strategy
  auth/clerk.ts             Clerk testing-token + test-mode OTP strategy
  auth/index.ts             createAuthStrategy(config)
  global-setup.ts           mints/validates the Clerk testing token once
e2e/smoke/smoke.spec.ts     smoke against BASE_URL (skips when unset)
e2e/self-test/              harness self-tests against a tiny node:http server
test/*.test.ts              unit tests (node:test, no browser)
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm test` | unit tests (`node --test`) then `playwright test --list` |
| `npm run typecheck` | `tsc --noEmit` (strict) over src, tests, specs and config |
| `npm run test:self` | runs the self-test project (needs a Chromium build) |
| `npm run e2e` | runs the smoke project against `BASE_URL` |

Browsers: `npx playwright install chromium` (CI caches the default location).
Without a browser the self-test group skips itself with a clear reason.

## Environment

All harness configuration is non-secret. Parsing is pure (`loadHarnessConfig(env)`),
fails fast with `HarnessConfigError`, and never reads `.env` files.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | unset | Absolute http(s) URL of the app. Unset: smoke specs skip, global setup does nothing. Credentials, query and fragment are rejected. |
| `E2E_AUTH` | `none` | `none` (anonymous isolated contexts) or `clerk`. |
| `E2E_ROLE_{A,B,C}_IDENTIFIER` | required for `clerk` | Clerk **test** identifiers only: `name+clerk_test@domain` (email_code) or `+1XXX55501XX` (phone_code). Must be three different identities. |
| `E2E_CLERK_BOOT_PATH` | `/` | Public, unprotected path that loads Clerk JS before sign-in. |
| `E2E_AUTH_REUSE` | `1` | Sign each role in once per worker and reuse its storage state (in memory). |
| `CLERK_PUBLISHABLE_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | - | Must be a `pk_test_` key. |
| `CLERK_TESTING_TOKEN` or `CLERK_SECRET_KEY` | - | From the CI secret store only; secret key must be `sk_test_`. |

## API

```ts
import { test, expect, eachRole, BasePage } from "@speak-for-me/e2e-harness";

test("a change by A is seen by B and C", async ({ roles }) => {
  const pages = await eachRole(roles, async (role) => {
    const p = new SomePage(role.page);   // subclass of BasePage
    await p.goto();
    return p;
  });
  await pages.A.doSomething();
  await eachRole(pages, (p) => expect(p.status()).toHaveText("updated"));
});
```

- **`test`**: Playwright `test` extended with:
  - `roles: PerRole<RoleSession>` (test-scoped). Three contexts created
    concurrently from the shared `browser`, inheriting `baseURL`,
    `contextOptions`, `viewport`, `locale`, `timezoneId`. Closed after the test
    even on failure. On failure it attaches a role-labelled full-page
    screenshot and the role's page/console errors.
  - options: `roleLabels` (labels for reports, e.g. scenario role names),
    `signInRoles` (default `true`; set `false` for signed-out tests),
    worker option `authModeOverride` (`"none"` forces anonymous, used by self-test).
  - worker fixtures: `harnessConfig`, `authStrategy`, `sessionCache`.
- **`RoleSession`**: `slot`, `label`, `context`, `page`, `pageErrors`,
  `consoleErrors`, `transport` (bounded WebSocket frame log),
  `findMarkers(markers)` (scan DOM + frames), `userId()`.
- **`eachRole(items, fn, { concurrent = true })`**: runs `fn` for each slot's
  item (sessions, page objects, anything `PerRole`). Concurrent mode awaits all
  slots and throws one `AggregateError` naming every failing slot.
- **`BasePage`**: abstract `path` (relative to `baseURL`), optional
  `readyTestId`, `goto()`, `reload()`, `waitForReady()`, `byTestId()`,
  `isCurrent()`.
- **`findMarkers(samples, markers)`**, `domSample(page)`,
  `recordWebSocketFrames(page, maxBytes)`: canary scanning primitives.
- **`loadHarnessConfig(env)`**, **`checkClerkCredentials(env)`**,
  **`createAuthStrategy(auth, { api?, env? })`**, `AuthStrategy`,
  `ClerkTestingApi` (injectable stub surface of `@clerk/testing`).

## Clerk in CI without storing secrets

1. **Development instance only.** The harness refuses anything but `pk_test_`
   / `sk_test_` keys (prefix check only; values are never logged or echoed).
2. **Test users have no secrets.** Identifiers must be Clerk test identities:
   emails with the `+clerk_test` subaddress or phone numbers in the
   `+1 XXX 555-0100..0199` range. Clerk dev instances accept the fixed OTP
   for these, which `@clerk/testing` submits. The harness has **no password
   strategy at all**, so a real credential cannot be configured by mistake.
   The three identifiers are plain CI variables, not secrets.
3. **Testing token, not a session secret.** `globalSetup` calls
   `clerkSetup({ dotenv: false })` once in the runner process. With
   `CLERK_SECRET_KEY` (from the CI secret store) it mints a short-lived
   testing token; if `CLERK_TESTING_TOKEN` is already set it uses that and the
   secret key is not needed. The token and Frontend API host are exported to
   workers via `process.env`. `dotenv: false` matters: by default the Clerk
   helper silently loads `.env.local` and `.env` from the working directory.
4. **Bot protection.** For every role context, `prepareContext` installs
   Clerk's route that appends `__clerk_testing_token` to Frontend API
   (`https://<fapi>/v1/*`) requests, before the first navigation.
5. **Sign-in.** Navigate to `E2E_CLERK_BOOT_PATH`, wait for `Clerk.loaded`,
   sign in with `email_code` / `phone_code`, then wait for `Clerk.user`
   (the Clerk helper returns silently when `Clerk.client` is missing, so
   success is verified explicitly).
6. **No auth state on disk.** With `E2E_AUTH_REUSE=1` each worker signs each
   role in once and keeps `context.storageState()` in a worker-scoped
   in-memory map; nothing is written under `playwright/.auth`.
7. **Provisioning** the three test users (and enabling the email/phone code
   factor) is a one-time step in the Clerk dev instance; it is not automated here.

Minimal GitHub Actions shape:

```yaml
env:
  CI: "1"
  BASE_URL: http://localhost:3000
  E2E_AUTH: clerk
  E2E_ROLE_A_IDENTIFIER: e2e-role-a+clerk_test@example.com
  E2E_ROLE_B_IDENTIFIER: e2e-role-b+clerk_test@example.com
  E2E_ROLE_C_IDENTIFIER: e2e-role-c+clerk_test@example.com
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ vars.CLERK_DEV_PUBLISHABLE_KEY }}
  CLERK_SECRET_KEY: ${{ secrets.CLERK_DEV_SECRET_KEY }}   # dev instance only
  CLERK_TELEMETRY_DISABLED: "1"
steps:
  - run: npx playwright install --with-deps chromium
  - run: npx playwright test --project=smoke
```

## Design notes

- **Positional slots, not business roles.** The design docs are still being
  written; slots A/B/C plus `roleLabels` let the engine attach its own role
  names without the harness inventing any.
- **One test, three contexts, one browser.** Contexts share a browser process
  (cheap) but no cookies/storage. Contexts are opened concurrently;
  `mapRolesAsync` uses `allSettled` so one slot's failure never hides another's.
- **Readiness markers over `networkidle`.** A page holding a realtime
  WebSocket never reaches network idle; `BasePage.readyTestId` waits on an
  explicit `data-testid` the app renders once data has loaded.
- **Per-test isolation of shared state** is the app's job: each test should
  create its own room/space (the self-test models this with `?space=<testId>`).
- **Artifacts.** Built-in screenshots are off in favour of role-labelled ones.
  Observed in the self-test run: Playwright's own failure screenshots and trace
  covered all three contexts created via `browser.newContext()`.
- **Marker scanning** supports privacy-canary checks: seed a unique string in
  one role's private input, assert `role.findMarkers([...])` is empty for the
  others (DOM incl. hidden nodes and attributes, plus WebSocket frames).
- **Fail closed.** Malformed env fails config load (even `--list`); missing or
  production Clerk keys fail `globalSetup` before any Clerk call.
- **Lazy Clerk.** `@clerk/testing` is imported dynamically only in `clerk`
  mode; unit tests inject a stub `ClerkTestingApi`.
- **TypeScript without a build step.** `erasableSyntaxOnly` +
  `allowImportingTsExtensions` let Node 24 run unit tests by type stripping
  and Playwright load the same `.ts` files.

## How the engine will use it

The app repo copies this module into its e2e package and adds a `webServer`
entry (e.g. `next start`) to the config. Specs import `test`, set
`test.use({ roleLabels })` from the scenario, create a fresh room per test
through whatever seed path the design defines, and wrap each route in a
`BasePage` subclass. The review findings name the first targets: three
identities online at once seeing live updates, a concurrent double-approve
executing once (two roles clicking inside one `eachRole`), progress surviving
reload (`BasePage.reload()`), and canary markers never reaching another role.

## Dependencies

| Package | Why |
| --- | --- |
| `@playwright/test` 1.64.0 | The test runner and browser automation this module exists to configure. |
| `@clerk/testing` 2.2.45 | Clerk's official testing-token and test-mode sign-in helpers; reimplementing the FAPI route and sign-in flow would track a private protocol. Loaded lazily, only for `E2E_AUTH=clerk`. |
| `typescript` 6.0.3 | Strict typecheck; same major as the app stack baseline. |
| `@types/node` 24.19.2 | Node 24 typings (TS 6 defaults `types` to `[]`). |

Versions are pinned exactly and were at least two weeks old when chosen.
Unit tests use the built-in `node:test`, so no extra test runner.

## Known gaps

- Clerk mode is unit-tested against a stubbed `@clerk/testing` only; no real
  Clerk dev instance was used (no keys were read). Real sign-in, testing-token
  lifetime, and storage-state reuse across Clerk's dev-browser handshake are
  to be verified in the first CI run with a dev instance.
- Test-user provisioning in the Clerk dev instance is manual (not scripted).
- Clerk multi-session mode is assumed off (see platform constraints); with it
  on, storage-state reuse may need per-slot session selection.
- `webServer` (starting the app) is left to the app repo's config.
- WebSocket frames are recorded; HTTP response bodies and server logs are
  not scanned by `findMarkers`.

## Verification

Run on macOS, Node v24.21.0, npm 11.19.0. No real Claude API or Clerk calls.

### `npm test` (BASE_URL and E2E_AUTH unset)

```

> @speak-for-me/e2e-harness@0.1.0 test
> npm run test:unit && npm run test:list


> @speak-for-me/e2e-harness@0.1.0 test:unit
> node --test "test/**/*.test.ts"

▶ auth strategy selection
  ✔ uses the no-op strategy when auth is off (0.230916ms)
✔ auth strategy selection (0.605167ms)
▶ clerk strategy (stubbed @clerk/testing)
  ✔ globalSetup validates dev credentials, then calls clerkSetup with dotenv disabled (0.355ms)
  ✔ globalSetup fails closed before touching Clerk when credentials are missing (0.507042ms)
  ✔ signIn boots Clerk on the public path, uses the role's OTP strategy, then verifies a user exists (0.102417ms)
  ✔ loads the Clerk API lazily and only once (0.074125ms)
✔ clerk strategy (stubbed @clerk/testing) (1.137959ms)
▶ loadHarnessConfig
  ✔ defaults to no base URL and no auth (0.570792ms)
  ✔ treats blank values as unset (0.051834ms)
  ✔ normalises BASE_URL with a trailing slash (0.42875ms)
  ✔ rejects malformed or unsafe BASE_URL values (0.168584ms)
  ✔ rejects unknown auth modes (0.047459ms)
  ✔ parses clerk mode with test identifiers and picks the OTP strategy (0.162375ms)
  ✔ requires an identifier for every role in clerk mode (0.04725ms)
  ✔ refuses non-test identifiers (real emails, real phone numbers) (0.070542ms)
  ✔ refuses two roles sharing one identity (case-insensitive email) (0.061917ms)
  ✔ validates boot path and reuse flag (0.114375ms)
✔ loadHarnessConfig (2.232125ms)
▶ checkClerkCredentials (fake values only)
  ✔ requires a publishable key and refuses production keys (0.08225ms)
  ✔ prefers a pre-minted testing token (no secret key in the test process) (0.031416ms)
  ✔ falls back to a development secret key and refuses live secrets (0.0555ms)
  ✔ never echoes key material in error messages (0.03175ms)
✔ checkClerkCredentials (fake values only) (0.272209ms)
▶ roles
  ✔ has exactly three positional slots (0.486084ms)
  ✔ mapRolesAsync runs slots concurrently (21.232ms)
  ✔ mapRolesAsync reports every failing slot and waits for all (30.15225ms)
✔ roles (52.407375ms)
▶ findMarkers
  ✔ reports each marker per source with an excerpt (0.10775ms)
  ✔ returns nothing when no marker occurs (0.046875ms)
✔ findMarkers (0.226875ms)
ℹ tests 24
ℹ suites 6
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 103.850917

> @speak-for-me/e2e-harness@0.1.0 test:list
> playwright test --list

Listing tests:
  [self-test] › e2e/self-test/harness.spec.ts:55:3 › harness self-test (in-process server) › each role has an isolated browser context
  [self-test] › e2e/self-test/harness.spec.ts:70:3 › harness self-test (in-process server) › a change made by one role reaches the others without reload, and survives reload
  [self-test] › e2e/self-test/harness.spec.ts:88:3 › harness self-test (in-process server) › marker scan finds a private marker only in the role it belongs to
  [self-test] › e2e/self-test/harness.spec.ts:102:3 › harness self-test (in-process server) › uncaught page errors are captured per role
  [self-test] › e2e/self-test/harness.spec.ts:109:3 › harness self-test (in-process server) › eachRole reports every failing role, not just the first
  [smoke] › e2e/smoke/smoke.spec.ts:6:3 › smoke: three roles against BASE_URL › every role loads the app root concurrently without errors
  [smoke] › e2e/smoke/smoke.spec.ts:17:3 › smoke: three roles against BASE_URL › signed-in roles are three distinct users
Total: 7 tests in 2 files
exit=0
```

### `npm run typecheck`

```

> @speak-for-me/e2e-harness@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

exit=0
```

### Smoke project with BASE_URL unset (skips cleanly, no browser needed)

```
$ npx playwright test --project=smoke

Running 2 tests using 1 worker

  -  1 [smoke] › e2e/smoke/smoke.spec.ts:6:3 › smoke: three roles against BASE_URL › every role loads the app root concurrently without errors
  -  2 [smoke] › e2e/smoke/smoke.spec.ts:17:3 › smoke: three roles against BASE_URL › signed-in roles are three distinct users

  2 skipped
exit=0
```

### Self-test project (Chromium headless shell installed to a local, git-ignored `.browsers/`)

```
$ PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright test --project=self-test

Running 5 tests using 1 worker

  ✓  1 [self-test] › e2e/self-test/harness.spec.ts:55:3 › harness self-test (in-process server) › each role has an isolated browser context (114ms)
  ✓  2 [self-test] › e2e/self-test/harness.spec.ts:70:3 › harness self-test (in-process server) › a change made by one role reaches the others without reload, and survives reload (307ms)
  ✓  3 [self-test] › e2e/self-test/harness.spec.ts:88:3 › harness self-test (in-process server) › marker scan finds a private marker only in the role it belongs to (91ms)
  ✓  4 [self-test] › e2e/self-test/harness.spec.ts:102:3 › harness self-test (in-process server) › uncaught page errors are captured per role (44ms)
  ✓  5 [self-test] › e2e/self-test/harness.spec.ts:109:3 › harness self-test (in-process server) › eachRole reports every failing role, not just the first (36ms)

  5 passed (938ms)
exit=0
```

### Smoke project against a running server (the self-test server, auth none)

```
$ BASE_URL=http://127.0.0.1:57464/ PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright test --project=smoke

Running 2 tests using 1 worker

  ✓  1 [smoke] › e2e/smoke/smoke.spec.ts:6:3 › smoke: three roles against BASE_URL › every role loads the app root concurrently without errors (81ms)
  -  2 [smoke] › e2e/smoke/smoke.spec.ts:17:3 › smoke: three roles against BASE_URL › signed-in roles are three distinct users

  1 skipped
  1 passed (365ms)
exit=0
```

### Fail-fast on malformed auth config

```
$ E2E_AUTH=clerk npx playwright test --list
HarnessConfigError: E2E_ROLE_A_IDENTIFIER is required when E2E_AUTH=clerk
    at parseTestIdentifier (.../src/env.ts:101:11)
    ...
```
