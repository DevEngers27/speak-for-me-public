# convex-test-utils

Domain-agnostic test helpers on top of [`convex-test`](https://www.npmjs.com/package/convex-test)
(convex@1.48.0, convex-test@0.0.65, vitest@5). They encode the testing patterns the
engine needs (named actors, permission matrices, scheduler draining, "this field must
never leave the server", single-entry-point dedup) without knowing any engine table,
state or function name. A tiny example app (`items` / `itemMembers` / `notes`) proves
every helper against a real `convexTest` backend.

## Layout

```
src/
  identities.ts        defineRoles, makeIdentity, bindRoles / withRole, ANONYMOUS
  roleMatrix.ts        roleMatrix / roleOutcomes: action x role matrices in one assertion
  errors.ts            isConvexError, defaultCodeOf, rejectionOf, expectConvexErrorCode, outcomeOf
  scheduler.ts         useFakeTimersForEachTest, drainScheduled, advanceScheduledBy/To,
                       listScheduled, expectNoPendingScheduled
  forbiddenFields.ts   findForbiddenFields, assertNoForbiddenFields, assertPatternsMatch,
                       findCanaries, assertNoCanaries
  matchers.ts          convexTestMatchers for expect.extend (+ vitest type augmentation)
  recipes/dedupInsert.ts  verifyQueryThenInsertDedup (query-then-insert recipe)
  tables.ts            countRows, readAll
  index.ts             public entry point
example/convex/        generic example schema + functions (+ hand-written _generated stand-ins)
test/                  vitest suites (pure + convex-test integration)
```

Scripts: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit, strict).

## API

### Identities and roles

```ts
const roles = defineRoles({ owner: {}, member: {}, outsider: { email: "o@x.test" } },
                          { issuer: "https://issuer.convex-test.invalid" /* default */ });
roles.identity("owner");        // { name:"owner", subject:"user_owner", issuer, tokenIdentifier:"<issuer>|user_owner" }
roles.tokenIdentifier("member"); roles.roleOf(token); roles.names;  // declaration order
const withRole = bindRoles(roles);
await withRole(t, "owner").mutation(api.items.create, { key: "k", title: "T" });
await withRole(t, ANONYMOUS).query(...);   // returns t unchanged (no identity)
withRole(t, roles, "owner");               // unbound form (src/identities.ts `withRole`)
makeIdentity("user_x", { name: "X" });     // one-off identity
```

- `tokenIdentifier` is always derived as `iss|sub`, the format Convex and convex-test use,
  so fixtures can reference it (`roles.tokenIdentifier("member")`) before any call.
- `defineRoles` rejects the reserved name `anonymous`, empty registries and two roles
  sharing a tokenIdentifier. Identities are frozen.

### Role matrices

```ts
expect(await roleMatrix(t, roles, (as) => as.mutation(api.items.rename, { itemId, title: "x" })))
  .toEqual({ owner: "ok", member: "FORBIDDEN", outsider: "FORBIDDEN", anonymous: "UNAUTHENTICATED" });
const out = await roleOutcomes(t, roles, call);  // { ok:true, value } | { ok:false, code, message, error }
```

Options: `only` (subset/order of roles), `includeAnonymous` (default true), `codeOf`
(custom error-code extractor). Calls run sequentially against the same state.

### Errors

`defaultCodeOf(e)` reads `ConvexError("CODE")` or `ConvexError({ code: "CODE" })`; pass a
custom extractor if the engine settles on another shape. `isConvexError` also recognises
ConvexErrors from a second copy of `convex` (brand `Symbol.for("ConvexError")`).
`expectConvexErrorCode(promise, code)` returns the error for further assertions.

### Scheduler

```ts
useFakeTimersForEachTest();                         // beforeEach useFakeTimers / afterEach useRealTimers
await withRole(t, "owner").mutation(api.items.requestProcessing, { itemId });
const report = await drainScheduled(t);             // { ran, failed, stillPending }
const [job] = await listScheduled(t, { fn: internal.items.archive, state: "pending" });
await advanceScheduledTo(t, job.scheduledTime - 1); // still pending
await advanceScheduledTo(t, job.scheduledTime);     // ran
await advanceScheduledBy(t, 500);                   // relative advance + finishInProgress
await expectNoPendingScheduled(t);
```

`drainScheduled` wraps `t.finishAllScheduledFunctions(vi.runAllTimers)` and adds three
guards: it throws if fake timers are off, if any job that ran ended `failed`
(`failOnFailedJobs`, default true; convex-test only logs these), and if jobs remain
`pending` (`requireEmptyQueue`, default true; convex-test silently skips jobs scheduled
under real timers whose real-clock time has not arrived).

### Forbidden fields and canaries

```ts
assertNoForbiddenFields(payload, ["privateMemo", "notes.*.authorToken", "a.**.secret", /^internal/i],
                        { label: "member view" });
findForbiddenFields(payload, patterns);    // [{ path: "$.list[1].privateMemo", key, pattern }]
assertPatternsMatch(rawDocs, patterns);    // anti-vacuity: every pattern must hit the raw rows
assertNoCanaries(payload, ["CANARY-7f3a"]);// private VALUE copied into an innocent field
expect.extend(convexTestMatchers);
expect(result).toHaveNoForbiddenFields(["privateMemo"]);
expect(result).toContainNoCanaries([canary]);
```

Pattern language: a bare key matches at any depth; a dotted path is anchored at the
root; `*` matches one segment (object key or array index); `**` matches zero or more
segments; a RegExp is tested against every key name. Key presence counts even when the
value is `undefined` (opt out with `ignoreUndefinedValues`). Cycles terminate;
nesting beyond `maxDepth` (64) throws, i.e. fails closed. Canary errors report paths
only and never echo the surrounding private text.

### Dedup recipe: query-then-insert in one mutation

```ts
await verifyQueryThenInsertDedup({
  callSameKey: () => owner.mutation(api.items.create, { key: "k", title: "T" }),
  callOtherKey: () => owner.mutation(api.items.create, { key: "other", title: "T" }), // optional
  countRows: () => t.run(async (ctx) => (await ctx.db.query("items")
                 .withIndex("by_ownerToken_and_key", (q) => q.eq("ownerToken", tok).eq("key", "k")).collect()).length),
  idOf: (r) => r.itemId,
  bypassInsert: () => t.run(async (ctx) => { await ctx.db.insert("items", { ...sameKey }); }), // optional
});
```

Steps: `clean` (0 rows) -> `first` (1 row) -> `serial` (same id, still 1 row) -> `burst`
(`Promise.all`, same id) -> `scoping` (other key, other id) -> `bypass` (a duplicate
inserted behind the entry point must make it fail closed, which requires reading the
key with `.unique()`, not `.first()`). Failures throw `DedupRecipeError` with `.step`.
The suite proves the recipe is not vacuous: a naive insert fails at `serial`, a `.first()`
entry point fails at `bypass`.

## Design notes

- **No engine knowledge.** Roles, error codes and tables are parameters. The example app
  uses generic names and example-only codes (`UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND`).
- **Deterministic identities.** `t.withIdentity({ name })` makes convex-test invent a
  subject, so tokenIdentifiers are unpredictable; registries fix that.
- **Fail loudly instead of silently.** Scheduler failures, skipped jobs, misspelled
  forbidden patterns, deep payloads and lenient dedup all become thrown errors.
- **Allowlist projections.** The example `notes.listForItem` builds return objects field
  by field; the tests pair a positive control (`readAll` raw rows contain the field) with
  the negative check on the query output.
- **Framework coupling is minimal.** Only `scheduler.ts` and `matchers.ts` import vitest;
  the other helpers throw plain errors and work with any runner.
- **`_generated/` stand-ins.** `npx convex codegen` needs a deployment, so the example
  ships hand-written `_generated/{api,dataModel,server}.ts` (pattern from the convex-test
  spike). The real repo commits codegen output instead. convex-test locates the function
  root through the `_generated` path segment, so the directory must exist.
- **Module glob.** `import.meta.glob(["./**/*.*s", "!./**/*.*.*s"])`; the extglob in the
  convex-test docs matches nothing under vitest 5 (spike finding).
- **Clock drift.** convex-test pins each transaction's time to
  max(fake now, last commit time). Observed in this suite: a `runAfter(1000)` after two
  seed commits was due at `now + 1001`. From the source, the drift grows with commits
  made while the fake clock is frozen (inference, not measured beyond this case). Use
  `advanceScheduledTo(job.scheduledTime)` for exact boundaries.

## How the engine will use it

- One `test/roles.ts` per scenario: `defineRoles({ customer: {}, provider: {}, finance: {}, outsider: {} })`
  plus `bindRoles`, so fixtures reference tokenIdentifiers directly.
- The permissions-privacy action x role matrix becomes one `roleMatrix` assertion per
  public function; the field x role disclosure matrix becomes `assertNoForbiddenFields`
  on every public query result per role, with `assertPatternsMatch` against raw rows and
  canaries seeded into private briefs (`assertNoCanaries`).
- Every "one X per Y" invariant (one approval per version per person, one execution per
  execution key, one active run per room) gets a `verifyQueryThenInsertDedup` test
  against its single write entry point, including the `bypass` step.
- Agent runs: the mutation that writes run state and calls `runAfter(0, ...)` is tested
  with `drainScheduled` (model calls replaced by an injected stub); stale-result
  rejection is tested by calling the internal commit mutation directly with an old attempt.

## What convex-test cannot verify

1. **OCC / real concurrency.** convex-test runs one function at a time, so the `burst`
   step is serialized. Whether two concurrent mutations reading the same empty index range
   conflict and retry must be tested against a real dev deployment with parallel clients.
2. **Scheduler delivery semantics.** Scheduled mutations' exactly-once retry on transient
   errors and actions' at-most-once/no-retry: convex-test has no transient errors; a throw
   is simply `failed`.
3. **Production identity.** Real Clerk JWTs (`aud`/`applicationID`, issuer domain) and
   `auth.config.ts`; convex-test accepts any identity object. Scheduled functions run
   without identity in convex-test (source: `runScheduledFunction` uses a fresh
   `AuthFake`); production behaviour is still to be confirmed.
4. **Limits and timeouts.** Transaction limits are off by default (`transactionLimits`),
   action timeouts are not enforced, error messages differ from production.
5. **Wire behaviour.** Client reconnect/resend, reactive subscription pushes, what a
   browser actually receives (serialization of `undefined`), `"use node"` runtime
   differences, `_creationTime` vs commit order and `commitTs` semantics.
6. **Exact timing.** Scheduled due times can drift by milliseconds (see design notes).

## Dependencies (all devDependencies)

| Package | Why |
| --- | --- |
| `convex@1.48.0` | The platform version the brief fixes; schema/function builders and types. |
| `convex-test@0.0.65` | The in-memory Convex backend these helpers wrap. |
| `vitest@^5.0.5` | Test runner; fake timers for scheduler control; matcher extension. |
| `@edge-runtime/vm@^5.0.0` | Required by vitest's `edge-runtime` environment recommended by convex-test. |
| `typescript@^7.0.2` | Strict typechecking (`npm run typecheck`). |

No other runtime dependencies. No Claude API calls and no secrets are used anywhere.

## Verification

Run on 2026-10-24 04:31 PDT, Node v24.21.0, from this directory. Output pasted verbatim (absolute scratchpad path shortened to `<scratchpad>`).

```
$ npm test -- --reporter=verbose   # vitest run --reporter=verbose

 RUN  v5.0.5 <scratchpad>/foundation/convex-test-utils

 ✓ test/forbiddenFields.test.ts > findForbiddenFields > bare key matches at any depth, including inside arrays 1ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > anchored dotted paths with * and ** 0ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > RegExp matches key names; stateful flags are neutralised 0ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > odd keys are quoted in paths; ArrayBuffers are not walked 0ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > key presence counts even when the value is undefined, unless opted out 0ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > cycles terminate; excessive depth fails closed 0ms
 ✓ test/forbiddenFields.test.ts > findForbiddenFields > primitives and null are clean; bad patterns are rejected 0ms
 ✓ test/forbiddenFields.test.ts > assertNoForbiddenFields > throws with every violating path 0ms
 ✓ test/forbiddenFields.test.ts > assertNoForbiddenFields > assertPatternsMatch catches misspelled patterns 0ms
 ✓ test/forbiddenFields.test.ts > canaries > finds canaries in values and keys without echoing them in errors 0ms
 ✓ test/identities.test.ts > defineRoles > identities are deterministic and use the iss|sub tokenIdentifier format 1ms
 ✓ test/identities.test.ts > defineRoles > custom issuer, subject and extra claims 0ms
 ✓ test/identities.test.ts > defineRoles > rejects reserved, empty and colliding definitions 0ms
 ✓ test/identities.test.ts > withRole against a real convex-test backend > the backend sees exactly the registry identity 3ms
 ✓ test/identities.test.ts > withRole against a real convex-test backend > ANONYMOUS returns the accessor unchanged; root t stays anonymous 0ms
 ✓ test/privacy.test.ts > forbidden fields on real query output > other people's privateMemo and authorToken never leave the query 9ms
 ✓ test/privacy.test.ts > forbidden fields on real query output > the author does see their own privateMemo (the check is not just 'field absent everywhere') 1ms
 ✓ test/roleMatrix.test.ts > roleMatrix > read permission matrix in one assertion 7ms
 ✓ test/roleMatrix.test.ts > roleMatrix > write permission matrix; `only` and includeAnonymous narrow the run 2ms
 ✓ test/roleMatrix.test.ts > roleMatrix > roleOutcomes keeps values and errors for detailed assertions 1ms
 ✓ test/roleMatrix.test.ts > roleMatrix > uncoded errors are labelled with their message 0ms
 ✓ test/roleMatrix.test.ts > error helpers > expectConvexErrorCode passes on match and explains mismatches 1ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > items.create: one row per (owner, key), fails closed on a bypass duplicate 7ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > the same key under a different owner is a different row 1ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > items.addMember: one membership per (item, member) 1ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > anti-vacuity: the recipe catches an entry point WITHOUT the read-before-insert 0ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > anti-vacuity: the recipe flags entry points that tolerate duplicates via .first() 1ms
 ✓ test/dedup.test.ts > query-then-insert dedup recipe > precondition: the key must start clean 1ms
 ✓ test/scheduler.test.ts > with fake timers > drainScheduled runs mutation -> action -> mutation -> delayed mutation chains 10ms
 ✓ test/scheduler.test.ts > with fake timers > advanceScheduledTo: nothing before the due time, done exactly at it 2ms
 ✓ test/scheduler.test.ts > with fake timers > advanceScheduledBy moves relative time; due time may drift past now+delay 1ms
 ✓ test/scheduler.test.ts > with fake timers > a failed scheduled function is surfaced, not just logged 1ms
 ✓ test/scheduler.test.ts > with fake timers > failOnFailedJobs: false returns the failure in the report instead 1ms
 ✓ test/scheduler.test.ts > guards > drainScheduled / advanceScheduledBy refuse to run without fake timers 0ms
 ✓ test/scheduler.test.ts > guards > jobs scheduled under real timers with a future time are reported, not silently skipped 51ms

 Test Files  6 passed (6)
      Tests  35 passed (35)
   Start at  04:31:45
   Duration  216ms (transform 38%, environment 23%, import 20%, tests 18%, worker 2%)

vitest exit=0
```

```
$ npm run typecheck   # tsc --noEmit -p .
tsc exit=0
```

```
$ npm ls --depth=0
@speak-for-me/convex-test-utils@0.1.0 <scratchpad>/foundation/convex-test-utils
+-- @edge-runtime/vm@5.0.0
+-- convex-test@0.0.65
+-- convex@1.48.0
+-- typescript@7.0.2
`-- vitest@5.0.5

```
