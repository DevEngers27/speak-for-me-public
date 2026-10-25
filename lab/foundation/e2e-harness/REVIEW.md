# Review: e2e-harness (Playwright multi-role harness)

Reviewer: engineer agent (code review step). Date: 2026-10-24. Node v24.21.0.
No real Claude or Clerk calls were made; no keys were read. All Clerk values
used below are fabricated (`pk_test_`/`pk_live_` prefixes over made-up hosts,
`CLERK_TESTING_TOKEN=fake-token`), run under `env -i` so nothing from the
shell leaked in. Probe files live outside the module, in
`scratchpad/review-tmp/e2e-harness/` (neg.ts, pos.ts, probe.ts, pw*.config.ts).

**Verdict: merge_after_fixes.** The structure is sound and the author's claims
check out. Six of the ten issues were confirmed by experiment. One (r01) is a
fail-open bug in the privacy-marker primitive and must be fixed before anyone
relies on it for core invariant #1.

## 1. Re-run of the author's claims

| Claim | Result |
| --- | --- |
| `npm test` (unit + `playwright test --list`) | pass: 24/24 unit tests, 7 tests listed, exit 0 |
| `npm run typecheck` | pass: exit 0 |
| `npm run test:self` (local `.browsers/`) | pass: 5/5 in 1.0s, exit 0 |

```
ℹ tests 24  ℹ suites 6  ℹ pass 24  ℹ fail 0
Total: 7 tests in 2 files            exit=0
> tsc --noEmit -p tsconfig.json      exit=0
  5 passed (1.0s)                    exit=0
```

(I deleted the `test-results/` directory my self-test run created, so the
module directory is as I found it.)

## 2. Compile-time type safety (checked, not assumed)

I compiled `review-tmp/e2e-harness/neg.ts` under the module's own tsconfig.
Every one of the 12 misuses below is rejected by tsc (exit 2). The positive
file `pos.ts` compiles with no errors.

| # | Misuse | tsc |
| --- | --- | --- |
| N1 | `roles.D` | TS2339 |
| N2 | `test.use({ roleLabels: { A, B } })` (C missing) | TS2322 |
| N3 | `test.use({ signInRoles: "yes" })` | TS2322 |
| N4 | `test.use({ authModeOverride: "password" })` | TS2322 |
| N5 | `roles.A.slot = "B"` | TS2540 |
| N6 | `roles.A.pageErrors.push(...)` | TS2339 (readonly array) |
| N7 | `class X extends BasePage {}` (no `path`) | TS2515 |
| N8 | `createAuthStrategy({ mode: "clerk" })` | TS2345 |
| N9 | `loadHarnessConfig({}).auth.identities` without narrowing | TS2339 |
| N10 | `eachRole(...)` result `.A` assigned to `number` | TS2322 |
| N11 | `mapRoles(...).A = ...` | TS2540 |
| N12 | `new SubPage()` without a `Page` | TS2554 |

Positive check: with `noUncheckedIndexedAccess` on, `roles[slot]` for
`slot: RoleSlot` has type `RoleSession`, not `RoleSession | undefined`, and
`eachRole` keeps `PerRole<T>`.

## 3. Domain neutrality, dependencies, brief alignment

- **Domain neutrality: OK.** The code has no business tables, states or role
  names. Slots are positional (A/B/C) and display labels are injected. The
  words "room" and "rooms/abc" appear only in comments and README prose, as
  examples. The self-test models shared state as a "space".
- **Dependencies: justified.** `@playwright/test` is the reason the module
  exists. `@clerk/testing` is loaded lazily and only in clerk mode, and it
  pulls in `@clerk/backend` and `dotenv`, which is acceptable. `typescript`
  6.0.3 matches the spike skeleton baseline. Unit tests use `node:test`, so
  there is no extra test runner. See r09 for a packaging nit.
- **Brief core #1 (no private fields sent to the browser):** this is the only
  core invariant the harness touches, through `findMarkers`. See r01, r02
  and r10.
- **Money / templates:** not applicable. The module handles no amounts and
  renders no templates, and I found no floats.
- **No secrets:** good. Test identities are restricted to Clerk test
  identifiers, there is no password strategy, the dev-key checks look at
  prefixes only, errors never echo values, `dotenv: false` is set, and
  storage state is held in memory only. r02 is a hole in the "dev instance
  only" guard.

## 4. Issues

### e2e-harness-r01 (high): marker scan fails open when frames are dropped
`RoleSession.findMarkers` (`src/fixtures.ts:118-120`) scans
`transport.samples` and ignores `transport.truncated`. Once a role's
WebSocket traffic passes the 4M budget (`src/markers.ts:56-58`), later frames
are silently dropped. An assertion like
`expect(await roles.B.findMarkers([canaryA])).toEqual([])` then passes even
if the leak was in a dropped frame. Long multi-role runs with Convex
subscriptions resend full query results on every update, so hitting the
budget is realistic. This turns a privacy check (core #1) into a false green.

**Fix:** make `RoleSession.findMarkers` throw (or return a result carrying
`truncated`) whenever `transport.truncated` is true. For example, return
`{ hits, complete }` and make `complete: false` an assertion failure in a
helper such as `expectNoMarkers(role, markers)`. Add a unit test that drives
`recordWebSocketFrames` over the budget.

### e2e-harness-r02 (medium): "dev instance only" guard checks a different key than Clerk uses
`checkClerkCredentials` (`src/env.ts:173`) reads
`CLERK_PUBLISHABLE_KEY ?? NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
`@clerk/testing` `clerkSetup` reads, in this order, `NEXT_PUBLIC_…`,
`VITE_…`, `CLERK_…`, `REACT_APP_…`, `EXPO_PUBLIC_…`. Reproduced in
`probe.ts` with `CLERK_PUBLISHABLE_KEY=pk_test_…` and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`: the harness returns
`preminted-testing-token` (accepted), and `clerkSetup` then sets
`CLERK_FAPI=clerk.prod.example.com`, the production instance. On the
pre-minted-token path, this prefix check is the only guard.

**Fix:** pass the validated value explicitly:
`clerkSetup({ dotenv: false, publishableKey })`. In addition, either check
every env name Clerk reads or refuse to run when two of them are set and
differ. Add a unit test for the conflict.

### e2e-harness-r03 (medium): smoke specs silently skip when baseURL comes from the config
The smoke skip (`e2e/smoke/smoke.spec.ts:4`) and `globalSetup`
(`src/global-setup.ts:12`) both look only at the `BASE_URL` environment
variable, never at the effective `baseURL` option. The README's integration
path ("the app repo adds a `webServer` entry") normally sets `use.baseURL`
in the config. Reproduced with `pw.config.ts`
(`use.baseURL = http://127.0.0.1:9/`, `BASE_URL` unset): `2 skipped`,
exit 0. That is a green CI run that tested nothing. In clerk mode the same
gap also skips minting the testing token, and the failure only surfaces
later in `prepareContext`.

**Fix:** skip on the `baseURL` fixture (`test.skip(({ baseURL }) => !baseURL)`).
In `globalSetup`, derive the URL from `config.projects[*].use.baseURL` /
`config.webServer`, or always run Clerk setup in clerk mode. Fail rather
than skip when `CI` is set.

### e2e-harness-r04 (medium): project-level `storageState` breaks role isolation
Playwright merges every `use` option into each `browser.newContext()` call
whose options lack that key (`runBeforeCreateBrowserContext` in
`playwright/lib/index.js`). That includes `storageState`. The fixture only
passes `storageState` when it has a cached session
(`src/fixtures.ts:91`). Reproduced with `pw-storage.config.ts` (a project
`use.storageState` holding cookie `who=role-X`): the self-test "isolated
browser context" failed with role C showing `role-X` instead of
`anonymous`. All three roles became the same user, with no warning.

**Fix:** always set the key, e.g. `storageState: cached` with `cached`
possibly `undefined`, so the merge cannot inject a shared identity.
Document that per-project `storageState` is ignored. Add a self-test for it.

### e2e-harness-r05 (low): boot path check can be bypassed with a backslash; prefix ignored
`parseBootPath` (`src/env.ts:118-124`) rejects `//host` but accepts
`/\evil.example/x`, which WHATWG URL parsing resolves to
`http://evil.example/x` (probe.ts). The unit test claims the cross-origin
case is covered. Separately, the boot path has to be absolute, so under a
path-prefixed `BASE_URL` (which the trailing-slash normalisation exists to
support) it resolves to the origin root and drops the prefix.

**Fix:** resolve with `new URL(path, base)`, require the same origin, and
reject backslashes. Consider allowing relative boot paths so they resolve
under the prefix.

### e2e-harness-r06 (low): `BasePage.isCurrent()` is wrong for `./` paths and trailing slashes
`src/page-object.ts:61-65`. A page whose `path` is `./?space=t1`, the form
the self-test itself uses, returns `false` on its own URL. `rooms/` against
`/rooms` also returns `false` (probe.ts). Neither case is tested. The
`endsWith` matching also accepts `/x/abc` for path `abc`.

**Fix:** resolve `path` against `baseURL` with `new URL` and compare
normalised pathnames. Add unit tests.

### e2e-harness-r07 (low): global setup ignores project selection and `authModeOverride`
With `E2E_AUTH=clerk` and `BASE_URL` set, `npm run test:self` still runs
Clerk `globalSetup`: it validates keys and may mint a token over the
network, then fails when the keys are absent, even though self-test forces
auth `none`.

**Fix:** skip when no selected project resolves to clerk mode. `FullConfig`
exposes `projects[].use`. Alternatively, document the behaviour.

### e2e-harness-r08 (low): recorder limits and coverage
- `maxBytes` counts UTF-16 code units, not bytes.
- `pageErrors` and `consoleErrors` grow without bound.
- Only the first page of each context gets the error, console and
  WebSocket listeners. Popups and later `context.newPage()` pages are not
  recorded.

**Fix:** rename the parameter or count with `Buffer.byteLength`, cap the
arrays, and attach listeners through `context.on("page")`.

### e2e-harness-r09 (low): packaging
`exports` points at `src/index.ts` for consumers, but `@playwright/test` and
`@clerk/testing` are listed as devDependencies. If the module is consumed
as a package rather than copied, two copies of `@playwright/test` break
fixtures.

**Fix:** declare them as `peerDependencies` (keeping them as devDependencies
too), or state in the README that the module must be vendored.

### e2e-harness-r10 (low): README gaps for privacy canaries
`findMarkers` does a plain substring match over the DOM snapshot and the
WebSocket frames. It does not see:
- HTTP response bodies: Next RSC `?_rsc=` navigations, server-action
  responses, JS chunks;
- Web Storage and cookies;
- `input.value` set as a property (not reflected in `outerHTML`);
- values rendered and then removed before the scan.

The README lists only the HTTP gap, under "Known gaps". The privacy-canary
spike also found that amounts appear in several spellings and that JSON may
escape non-ASCII text.

**Fix:** state in the README that callers must use unique ASCII canaries
(never amounts) and that an empty result is not proof of non-disclosure
until response bodies and storage are scanned. Add a bounded
`page.on("response")` text recorder and a `localStorage`/`sessionStorage`
sample, or point to the spike's `scan`/`lintCanaries`.

## 5. What is good

- Clean `PerRole<T>` and `mapRolesAsync` built on `allSettled`: every failing
  slot is reported, and contexts are closed in `finally` even when opening a
  context fails partway.
- The Clerk strategy is injectable and lazily loaded. The author caught
  that `clerk.signIn` returns silently when `Clerk.client` is missing and
  verifies `Clerk.user` explicitly. Strict regexes allow test identifiers
  only, there is no password path, and duplicate identities are refused
  (case-insensitively).
- Readiness via `data-testid` instead of `networkidle` is the right choice
  for live subscriptions.
- The README is thorough. It covers env vars, the API, the CI flow, design
  notes and known gaps, and it ends with an honest Verification section. A
  newcomer can use it once r03 and r04 are documented or fixed.
