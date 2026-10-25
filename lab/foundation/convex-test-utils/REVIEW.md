# Review: convex-test-utils

Reviewer: engineer agent (code review step). Date: 2026-10-24. Node v24.21.0.

## Verdict

**merge_after_fixes.** The module is domain-agnostic, small, well tested (35 tests incl.
anti-vacuity cases against a real `convexTest` backend), and its README is honest about
what convex-test cannot prove. No blocker. The fixes below are mostly type-level
hardening, making the "fail loudly" principle consistent, and packaging for consumption.

## Author claims re-run

```
$ npm test            -> Test Files 6 passed (6), Tests 35 passed (35)   exit=0
$ npm run typecheck   -> tsc (TypeScript 7.0.2) --noEmit -p .            exit=0
```

Both claims (`tests_passed=true`, `typecheck_passed=true`) hold.

## Compile-time type safety (probe)

A throwaway probe (`.review-probe/`, deleted afterwards) compiled misuse cases with the
module's own tsconfig. tsc rejected 8 of 10, as it should:

| Probe | Expected | Result |
| --- | --- | --- |
| `roles.identity("admin")` | error | TS2345 OK |
| bound `withRole(t, "admin")` | error | TS2345 OK |
| **unbound `withRole(t, roles, "admin")`** | error | **compiles** (r01) |
| `listScheduled(t, { fn: api.items.get })` (query ref) | error | TS2322 OK |
| `countRows(t, "nope")` | error | TS2345 OK |
| `expect(x).toHaveNoForbiddenFields(42)` | error | TS2345 OK (augmentation works) |
| `roleMatrix(...).admin` | error | TS2339 OK |
| `defineRoles({ a: { when: new Date() } })` | error | TS2322 OK |
| `idOf: (r) => r` where r is number | error | TS2322 OK |
| **`roleMatrix(..., { only: ["admin"] })`** | error | **compiles** (r01) |

Known gaps that also compile: `defineRoles({ anonymous: {} })` (runtime throw only),
and `roleMatrix(..., { includeAnonymous: false, only: ["owner"] })` still typed as
having `anonymous` and `member` keys (r07).

Runtime probes (same throwaway dir) confirmed:

```
R1 roleMatrix only:["owner","admin"] -> {"owner":"ok","admin":"error:Unknown role \"admin\""}
R2 findCanaries({secret:"CANARY"}, []) -> []                    (vacuous pass)
R3 findCanaries({total:4200000n, cap:42000}, ["42000"]) -> []  (numeric leak invisible)
R4 bypass step passes when the entry point throws "validator: unrelated bug"
R5 entry point that throws ALREADY_EXISTS on repeat -> recipe fails at serial (raw error)
R6 findForbiddenFields([{a:{secret:1}}], ["a.secret"]) -> []  (needs "*.a.secret")
R7 advanceScheduledBy over a failing job -> resolves; job state "failed", no throw
```

## Domain-agnosticism, dependencies, brief alignment

- `src/` contains no engine table, state, role or function names. The example app uses
  generic `items` / `itemMembers` / `notes` and example-only error codes. Good.
- The README section "How the engine will use it" names `customer/provider/finance` and
  invariants such as "one active run per room" and "one approval per version per person".
  These are design decisions not yet made (r10).
- Dependencies: 5 devDependencies, each justified (`@edge-runtime/vm` is required by the
  `edge-runtime` vitest environment). Nothing superfluous. Packaging is the problem (r04),
  not the choice of dependencies.
- No Claude API usage, no secrets, no floats in money paths (the module has no money).
  Core #1 (privacy) is the relevant one: forbidden-field and canary helpers are solid for
  keys and strings, but private numeric constraints (budget caps, which the brief makes
  integer or bigint amounts) are invisible to them (r03).

## Issues

### r01 (medium) Role typos compile through inference widening
`withRole(t, roles, role)` and `roleOutcomes/roleMatrix(..., { only })` infer `R` from
both the registry and the extra argument. `RoleRegistry<R>`'s method params are
bivariant, so `R` widens to include `"admin"`. Worse, in `roleOutcomes` the
`withRole(t, role)` call runs inside `outcomeOf`, so the harness error is recorded as an
outcome label `error:Unknown role "admin"` instead of failing the test setup.
Fix: `role: NoInfer<R> | Anonymous` and `only?: readonly NoInfer<R>[]`, then validate
`only` against `roles.names` before the loop and throw outside `outcomeOf`.

### r02 (medium) `advanceScheduledBy/To` swallow failed jobs
`drainScheduled` throws on failed jobs, but `advanceScheduledBy` only logs (convex-test
`console.error`). That contradicts the README's "fail loudly" principle and lets a
boundary test pass while the job it targets failed. Fix: snapshot states before/after
like `drainScheduled`, return a `DrainReport`, and throw on `failed` by default
(`failOnFailedJobs` option).

### r03 (medium) Canaries cannot catch numeric leaks
`findCanaries` only inspects strings and keys. Private constraints in this system are
largely numbers (budget ceilings as integer minor units or bigint). A projection that
copies `maxBudget` into a public field under an innocent key is undetected. Fix: accept
`string | number | bigint` canaries, matching numbers and bigints by exact value (and
optionally their decimal string inside strings). Document that formatted amounts
(for example `$42,000`) still need a string canary.

### r04 (medium) Packaging: peer deps and runner coupling
- `convex`, `convex-test` and `vitest` are devDependencies only. Consumers get no install
  or version contract. If a workspace resolves a second `vitest` copy, `vi.useFakeTimers()`
  in `scheduler.ts` acts on a different instance than the test file's. `isConvexError`
  already works around the same duplicate-package problem for `convex`. Make all three
  `peerDependencies` (keep them in devDependencies for local dev).
- README says the non-scheduler helpers "work with any runner", but the only export `"."`
  re-exports `scheduler.ts`, which imports `vitest` at runtime. Add subpath exports
  (`./scheduler`, `./matchers`) or drop the claim.
- `exports` points at `./src/index.ts`, so consumers need a TS-aware loader (fine under
  vitest). State this in the README.

### r05 (medium) Dedup recipe hard-codes "return existing id" semantics
The recipe requires every repeat call to return the first id (R5). An entry point that
dedups by rejecting duplicates with a coded error, which is plausible for approvals and
still undecided in the design, cannot use it. Fix: `mode: "returnExisting" |
"rejectDuplicate"` with an `expectDuplicateError?: (e) => boolean` for the latter.

### r06 (low-medium) Dedup `bypass` and `burst` steps prove less than they claim
- `bypass` accepts any thrown error (R4), including unrelated bugs. Add
  `expectBypassError?: (e: unknown) => boolean`, and re-check `countRows() === 2`
  afterwards (no third row).
- `burst` runs after the row already exists, so even against a real deployment it would
  never exercise the empty-index create race. Run a burst on a fresh key before `first`
  (or add a `burstFirst` step). This is cheap and makes the recipe reusable against the
  real-deployment concurrency harness that the README says is required.

### r07 (low) `roleMatrix` return type claims keys that are absent
With `only` or `includeAnonymous: false` the result is still
`Record<R | "anonymous", ...>`. Type it as `Partial<...>`, or overload so the key set
follows the options.

### r08 (low) Inconsistent anti-vacuity and silent overrides
- `findCanaries(payload, [])` returns `[]` (R2), while `findForbiddenFields` throws on an
  empty list. Throw on an empty canary list too.
- `RoleSpec`'s index signature accepts `issuer` / `tokenIdentifier` claims that are then
  silently overwritten, and an explicit `name: undefined` leaks as a key. Reject the
  reserved claims, and exclude `"anonymous"` from `R` at the type level
  (`R extends string` with an `Exclude` check).
- `DrainReport.ran` counts `canceled` jobs as "ran". Split them out or rename the field.

### r09 (low) Toolchain drift from the verified stack
TypeScript `^7.0.2` while every sibling foundation module and `05-spike-verified-facts`
pin `6.0.3`. The README table lists exact versions, but `package.json` uses caret ranges.
`tsconfig` `types: ["vite/client"]` relies on a hoisted transitive `vite`. Pin
`typescript` to the team version (re-run tsc under it) and pin exact versions or fix the
README table.

### r10 (low) README gaps
- Add a "Consuming this package" section: workspace dependency, peer deps, the vitest
  config it needs (`environment: "edge-runtime"`, `server.deps.inline`), registering
  `convexTestMatchers` in `setupFiles`, and where `test.setup.ts` must live (inside the
  functions dir, next to `_generated`).
- Pattern docs: anchored dotted paths start at the payload root, so array results need a
  leading `*` (R6). `assertPatternsMatch` on raw rows does not guard this when the
  projection's shape differs from the raw rows.
- Mark the "How the engine will use it" invariants as illustrative until the design
  lands, or move them to the design's testing doc.
- Example test `privacy.test.ts` filters "others' notes" by the server's own `mine` flag.
  Filtering by known ids would avoid trusting the code under test.

## What is good

- Deterministic `iss|sub` identities with collision checks. `ANONYMOUS` handling is
  documented, including the footgun where a non-root accessor keeps its identity.
- Scheduler guards turn convex-test's silent behaviours (logged failures, skipped
  real-timer jobs) into errors, backed by tests.
- Forbidden-field walker: key presence counts, cycles terminate, depth fails closed, and
  `g`/`y` regex flags are neutralised. Error messages never echo canary context.
- The dedup suite proves non-vacuity (naive insert fails at `serial`, `.first()` fails at
  `bypass`). The "What convex-test cannot verify" section is accurate and consistent with
  platform constraints 1.12 and the spike facts.
