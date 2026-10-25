# W0-F verification

Reviewer: grok. Lens: verification. Read-only over the uncommitted wave-0 fix. Source files were not modified.

Overall: accept with residuals. W0R-01 through W0R-08 and W0R-10 through W0R-13 are resolved and match canon D09. W0R-09 stays partial, as the implementer reported. `pnpm test` is green (254 passed, 220 todo). A deadline that expires before the next send, or during retry backoff, is still not reported as a non-retryable timeout. Runtime R11 and §10.11 need a design-change notice, because the code correctly follows canon D09 instead of the published SDK-retry budget.

Commands run this review: `pnpm install --frozen-lockfile` (already up to date), `lint` (exit 0), `typecheck` (five projects, exit 0), `pnpm test` (exit 0). The deadline and truncation tests in `convex/lib/modelGateway.test.ts` were run three times in a row and passed each time.

## Specific checks

### (a) D09 deadline and truncation — satisfied; R11 needs a notice

`callNegotiationModel` records `usage`, `requestId`, and `outcomeKind: 'output.truncated'` before it branches. The first `max_tokens` stop continues (`truncationRetries`); the second returns `output.truncated` with `retryable: false`. Refusal and `model_context_window_exceeded` return immediately. The test expects two attempts and `totalUsage.outputTokens === 32_000`.

There is one retry layer. `SDK_MAX_RETRIES` is 0, and `anthropicTransport` throws if a caller asks for SDK retries. The gateway's own `DEFAULT_MAX_RETRIES` is 1 and applies only to HTTP 429 and `APIConnectionError`. 408, 409, 5xx, 529, and timeouts are not retryable inside the gateway. Truncation uses a separate counter, so a 429 plus one truncation plus a success is three sends, which the new test locks in.

The total deadline is one budget. `totalBudgetMs` is capped at `CALL_DEADLINE_MS` (230_000). One `AbortSignal.timeout` covers the whole call; each send gets `min(timeout, remaining)` of that same budget, including a signal and a `withDeadline` race so a transport that ignores the signal still stops. 230s plus 40s of I/O is 270s, before `WATCHDOG_FIRST_MS` (275_000) and the 600s action limit. Module load asserts `WATCHDOG_FIRST_MS > CALL_DEADLINE_MS`.

That satisfies canon D09: record usage, retry `max_tokens` once, do not retry refusal or context overflow, `maxRetries: 1` only for 429 and connection errors, and an AbortSignal deadline before the watchdog.

It does not match runtime R11 or §10.11, and those sections need a design-change notice before the attempt layer is written:

- R11 and §10.10.1 give the SDK `maxRetries: 1` for 429, 529, 5xx, 408, 409, connection errors, and pre-stream timeout. The code disables SDK retries and does not retry 529, 5xx, 408, 409, or timeouts at all.
- §10.11 sets `CALL_DEADLINE_MS` to 448_000, which is after the 275_000 first watchdog. Its inequality I3 only requires the deadline before `WATCHDOG_FINAL` (935_000). The code requires the deadline before the first watchdog.
- §10.10.2 retries `output.truncated` as a new attempt row. The gateway now consumes D09's one truncation retry internally and returns `retryable: false`. An attempt-layer `decideRetry` copied from R11 would retry truncation a second time.

The code should stay on the D09 side. The design text should change.

### (b) TD-05 — satisfied

`drainDue` in `tests/helpers/convex.ts` loops `advanceTimersByTime(0)` and `finishInProgressScheduledFunctions` until nothing is in progress and no pending job has `scheduledTime <= now`. Failed jobs still throw. `runAllTimers` and `finishAllScheduledFunctions` are not on this helper. The example test schedules a job 5s out, calls `drainDue`, and asserts it did not run. Watchdog-style advancement stays on `advanceScheduledTo`. `lab/` still has the old `drainScheduled`; it was left untouched, which matches the instruction not to edit `lab/`.

### (c) Scenario key — one runtime spelling

`SCENARIO_KEY` is `"scope_change"`. The plugin id, the fixture's `room.scenarioKey`, and `health.ping` all use it. The directory and import paths stay `scope-change`, which is what D21 requires. `ScenarioFixtureShape` uses `SCENARIO_KEY_PATTERN` (`^[a-z][a-z0-9_]*$`), so the canonical key validates and a hyphenated key does not. `loadScopeChangeFixture` maps D27 `main` into `loadFixture` and passes `expectedScenarioKey: SCENARIO_KEY`. `tests/foundation/wave0.test.ts` loads `main` and checks the key. The only product string `"scope-change"` left as an identifier is the mock room id `scope-change-main`, which is not the scenario key. `lab/` still says `scope-change` and was not in scope.

The literal constant lives in `core/engine/plugin.ts`. §11.0 says the engine knows no scenario. See W0-F-r04.

### (d) Public templates — free strings rejected; rejected values are not echoed

`definePublicTemplate` allows only `enum`, `token`, `amount`, `date`, `integer`, `list`, and `fragment`. `slot.text` still exists for non-public templates, but its kind is `text`, and a list of text slots is also kind `text`, so both are rejected. `slot.token` accepts only `ITEM_KEY_RE`. That alphabet has no markup, so returning the matched string is not a free-string interpolation. Enum, amount, date, and integer render author text or a canonical format. Fragments return text the engine already rendered.

`publicCents` and `formatUsdCents` call `assertCents` (`MAX_CENTS` is 1e11) and the money errors do not include the amount. `isoDate` uses `parseIsoDate` and throws `INVALID_DATE`. `failSlot` throws `Invalid slot value` and discards the reason string that used to contain the rejected value. The second calendar in `publicText.ts` is gone. The wave-0 test rejects `PRIVATE_CANARY` and `100000000001` and asserts those strings are absent from the error.

### (e) Battery reconciliation — todos count as uncovered; the bodies are still todos

`reconcileBattery` takes `executedIds`, defaulting to an empty set. `ok` is true only when every registry id was executed and the structural checks pass. `structureOk` keeps the old structural result. The reconciliation test expects `ok === false`, `structureOk === true`, and 253 untested ids. The `Math.max(14, 11) - 4` and `480000 - 480000` assertions are gone.

The `it.todo` bodies were not replaced with failing assertions, so a green Vitest run still does not prove the counterexamples. That is the partial the implementer recorded. The default `pnpm test` now reports 220 todo, not 253, because real-deploy and e2e specs are no longer collected. The registry untested count remains 253.

### (f) The r02 retry test is deterministic

`r02: totalBudgetMs bounds the first attempt timeout` freezes time with `vi.useFakeTimers` and `setSystemTime` before `callModel`. Both clocks in the remaining-budget calculation are `Date.now` (`params.now` defaults to `Date.now`, and `wallStart` is `Date.now()`), so elapsed time is 0 and the observed timeout is exactly 15_000. The stub returns immediately, so the assertion does not wait on `AbortSignal.timeout`. Three consecutive runs passed, and the same test passed again inside the full suite. The sibling test that forces a deadline mocks `AbortSignal.timeout` onto the fake clock and also passed three times.

## Finding status

| Id | Status | What the code does now |
| --- | --- | --- |
| W0R-01 | resolved | One in-call truncation retry after recording `output.truncated` and usage. |
| W0R-02 | resolved | One gateway retry layer (429 and connection only), total deadline 230s before the 275s watchdog. Residual labels: W0-F-r01. Design notice: W0-F-r02. |
| W0R-03 | resolved | `drainDue` advances only due work. |
| W0R-04 | resolved | Runtime key `scope_change`; directory `scope-change`; adapter test loads `main`. |
| W0R-05 | resolved | Public slot kinds are a closed allowlist; token regex is ItemKey only. |
| W0R-06 | resolved | Cents, dates, and slot failures do not echo the rejected value. |
| W0R-07 | resolved | Effort and `max_tokens` are pinned; extra wire fields throw; HTTP errors keep status only. |
| W0R-08 | resolved | `callNegotiationModel` at `convex/agents/modelGateway.ts`; `completed`; storage enums; transport `reasonCode` is null. |
| W0R-09 | partial | Registry `ok` is false until ids are executed. `it.todo` bodies remain. |
| W0R-10 | resolved | Probes out of the default project; watch uses the suite config; `.ts` import. |
| W0R-11 | resolved | Test helper left `convex/`; raw query import is lint-banned; barrel is the engine exit. |
| W0R-12 | resolved | `markProjected` accepts only projection output; titles use `wrapCatalogTitle`. |
| W0R-13 | resolved | README and per-package expiries. The horizon is only 1–7 days: W0-F-r03. |

## Changes beyond the findings

| Change | Justified? |
| --- | --- |
| `convex/lib/modelGateway.ts` moved to `convex/agents/modelGateway.ts`, two-line re-export left behind | Yes. TD-03 and W0R-08 name `convex/agents/modelGateway.ts`. The re-export keeps the old import path as one implementation. §11 forbids `convex/agents.ts` beside `convex/agents/`; `convex/agents.ts` does not exist yet, and the testing mock path is this file. |
| `convex/test/helpers.ts` moved to `tests/helpers/convex.ts` | Yes. W0R-11. `api.d.ts` no longer mentions `test/helpers`. |
| `convex/lib/functions.ts` sanitized `query` / `mutation` / `action` | Yes. W0R-11 and D16. It is a subset of architecture A3: there are no `anonQuery` / `userQuery` / `sys*` constructors yet, so authorization is still inside the handler. Wave 0 only has `ping` and `whoami`. `example.fixture.ts` still imports raw builders and is eslint-ignored, which is how the two-dot convex-test modules stay out of codegen. |
| `convex/lib/scopeChangeFixture.ts` | Yes. W0R-04 asked for an adapter. It is in the Convex module list because it sits under `convex/`, and it registers no function. |
| Engine barrel re-exports | Yes. W0R-11. Lint now rejects `engine/` deep imports from Convex, `src`, and scenarios. |
| Vitest `evals` and `web` projects, probes removed, `tests/watch.config.ts`, `.ts` import | Yes. W0R-10 and TD-01. `tests/evals/` has no files; the run still exits 0. |
| `scripts/check-dependency-policy.mjs` and `scripts/cooldown-exceptions.json` | Yes. W0R-13. The stagger itself is the problem in W0-F-r03. |
| `scripts/lib/layer-imports.mjs` allows `tests/helpers` from test files only | Yes. Required by the helper move. |

No other behavior change stood out as an unjustified rewrite. The moved gateway diff against `HEAD:convex/lib/modelGateway.ts` is 119 insertions and 100 deletions, not a rewrite of the 2,700-line file. The helper diff is 13 insertions and 12 deletions.

## Verification commands

- `npx --yes pnpm@11.25.0 install --frozen-lockfile` — already up to date.
- `lint` — exit 0.
- `typecheck` — exit 0.
- `pnpm test` — main suite 27 files passed, 21 skipped, 254 passed, 220 todo; boundary check rejected 14 deliberate violations; scripts 9 passed; e2e harness 11 passed.
- The r02, deadline, and combined-retry tests — three consecutive runs, 3 passed each time.
