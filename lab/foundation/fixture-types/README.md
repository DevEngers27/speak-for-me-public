# @speak-for-me/fixture-types

Zod 4 schemas, TypeScript types and a validating, freezing loader for **scenario fixtures**: preset, simulated input that seeds a negotiation room and states what outcome each phase of a scripted run must produce. Ships one example fixture for the software scope-change scenario.

This is a foundation module. It knows nothing about tables, room states, proposal states or function names. Those come from the design documents (02 to 06, 14). It only fixes the representation rules that will not change: ids are slugs, money is integer cents, dates are calendar dates, briefs are opaque per-role JSON, constraint sets are versioned snapshots, and every fixture is marked simulated.

## Fixture shape

```text
ScenarioFixture
  schemaVersion       1
  id, scenarioId      slugs; scenarioId names the scenario plugin (e.g. "scope-change")
  title, description
  provenance          { simulated: true, label, notes? }          core rule 8
  asOf                YYYY-MM-DD, the fixture's notional "today"
  roles[]             { id, label, description? }
  participants[]      { id, roleId, displayName }
  privateBriefs       { [roleId]: JSON object }                   opaque, server-side only
  catalog             { currency, items[] }
    items[]           { id, label, description?, priceCents, earliestDate, sourceRoleId }
  constraintSets[]    { version, label?, constraints[] }          full snapshot per version
    constraints[]     { id, kind, ownerRoleId, visibility: "private" | "shared",
                        description?, amountCents?, date?, itemIds?, params? }
  phases[]            { id, label, description?, constraintSetVersion, expectations[] }
    expectations[]    { id, description,
                        candidate: { itemIds[], deliveryDate? },
                        outcome:   { feasible, itemsTotalCents, reasonCodes? } }
```

All objects are strict (unknown keys are rejected, so typos fail loudly).

### What the loader checks

| Layer | Checks |
| --- | --- |
| Primitives | Slugs `^[a-z][a-z0-9]*([-_.][a-z0-9]+)*$` (max 64); cents are non-negative safe integers (`z.int().nonnegative()`); dates are real calendar dates via `z.iso.date()` (rejects `2026-02-30`, `2026-02-29`, `2026/11/20`, date-times); currency `^[A-Z]{3}$`; opaque records must be JSON (`z.json()`: no `undefined`, `NaN`, `Infinity`, functions, `Date`) |
| Cross-references | Unique ids (roles, participants, items, phases; constraints and expectations within their parent; item references within a list); every `roleId` / `ownerRoleId` / `sourceRoleId` / brief key names a declared role; every role has a participant; every `itemIds` entry names a catalog item |
| Versions | Constraint set versions are exactly `1..n` in order; each phase references an existing version; phase versions never go backwards |
| Arithmetic | `outcome.itemsTotalCents` equals the sum of the candidate items' catalog prices (catches fixture typos) |
| Options | `expectedScenarioId` must match; `briefSchemas` validate each brief with the plugin's own schema and fail closed when a role has none |

Cross-reference issues carry `code: "custom"` and a stable `check` name from `FIXTURE_CHECK`.

## API

```ts
import {
  loadFixture,            // (input: unknown, options?) => ScenarioFixture; throws FixtureValidationError
  safeLoadFixture,        // (input: unknown, options?) => { ok: true, fixture } | { ok: false, issues }
  parseFixtureJson,       // (text: string, options?) => same as safeLoadFixture; invalid JSON -> "invalid_json"
  constraintSetForPhase,  // (fixture, phaseId) => the constraint set the phase runs under
  deepFreeze,             // recursive Object.freeze, returns DeepReadonly<T>
  formatIssuePath,        // ["catalog","items",2,"priceCents"] -> "catalog.items[2].priceCents"
  scenarioFixtureJsonSchema, // JSON Schema of the structure, for editor completion
  ScenarioFixtureSchema,  // full Zod schema (structure + cross-reference checks)
  ScenarioFixtureShape,   // structure only
  FIXTURE_CHECK,          // names of the cross-reference checks
  scopeChangeSimulatedInput,   // example input (plain data)
  scopeChangeSimulatedFixture, // example, loaded and frozen
} from "@speak-for-me/fixture-types";

type LoadFixtureOptions = {
  expectedScenarioId?: string;
  briefSchemas?: Readonly<Record<string, z.ZodType>>; // keyed by role id
};
type FixtureIssue = { path: string; code: string; check?: string; message: string };
```

Types: `ScenarioFixtureInput` (what authors write), `ScenarioFixtureData` (parsed), `ScenarioFixture` (`DeepReadonly` of parsed, what the loader returns), plus per-part types such as `CatalogItemData` and `FixtureConstraintData`. Primitive schemas (`Slug`, `Cents`, `IsoDate`, `CurrencyCode`, `JsonRecord`, `Label`, `Text`) are exported for reuse.

## Example fixture: software scope change (simulated)

`src/fixtures/scope-change.simulated.ts`, `provenance.label = "Simulated example"`, `asOf = 2026-11-02`, roles `customer`, `provider`, `finance`.

| Item | Price | Earliest date |
| --- | --- | --- |
| `sso-login` Single sign-on (SAML) | 50000 | 2026-11-13 |
| `audit-export` Audit log CSV export | 40000 | 2026-11-20 |
| `usage-dashboard` Usage analytics dashboard | 50000 | 2026-12-04 |

Full request = 140000 ($1,400). Phase one (`sso-login`, `audit-export`) = 90000 ($900).

| Constraint (v1 / v2) | Owner | Visibility | Value |
| --- | --- | --- | --- |
| `budget-cap` | finance | shared | 500000 / **480000** |
| `committed-spend` | finance | shared | 400000 |
| `required-items` | customer | shared | `sso-login`, `audit-export` |
| `delivery-deadline` | customer | private | 2026-11-20 |

| Phase (set) | Expectation | Items total | Feasible | Why |
| --- | --- | --- | --- | --- |
| `initial` (v1) | `full-request` | 140000 | no | 400000 + 140000 = 540000 > 500000; delivery 2026-12-04 after deadline |
| `initial` (v1) | `phase-one` | 90000 | yes | 490000 <= 500000, delivered 2026-11-20 |
| `cap-lowered` (v2) | `phase-one-after-cap-cut` | 90000 | no | 490000 > 480000 |
| `cap-lowered` (v2) | `full-request-after-cap-cut` | 140000 | no | 540000 > 480000; after deadline |

Item names, dates and people are invented. Constraint `kind` values are illustrative scenario vocabulary until doc 14 fixes it. Reason codes are left out until doc 06 defines them.

## Design notes

- **Generic, not scenario-aware.** `kind` is an open slug vocabulary owned by the scenario plugin. Typed value slots (`amountCents`, `date`, `itemIds`) let the generic layer validate money, dates and references without knowing what a kind means. Anything else goes into `params` (opaque JSON).
- **Briefs are opaque.** The fixture layer only guarantees briefs are JSON objects keyed by declared roles. The plugin passes `briefSchemas` to validate its own shape. The stored brief stays the original record (validation only), so a plugin schema with transforms cannot change seed data.
- **Constraint sets are full snapshots**, not deltas. Snapshots are easier to validate and to replay as "constraints at version N". The engine can compute a diff when it needs one. Versions are dense and ordered, matching the rule that constraint versions only increase.
- **Simulated is not optional.** `provenance.simulated` is `z.literal(true)`. Fixtures are never real data, so anything seeded from one must carry the label (core rule 8).
- **Prices have a source.** `sourceRoleId` records whose confirmed information a price and date come from (core rule 4: prices only from confirmed information). The engine decides how that maps to its source and confirmation records.
- **Expected outcomes are self-checking.** `itemsTotalCents` must equal the catalog sum, so a wrong number in a fixture fails at load time, not in a confusing engine test.
- **Error discipline.** Issues contain a path, a code, an optional check name and a message, never the input value. Zod 4 does not include inputs in issues by default and the loader never adds them, so validation errors are safe to log even though fixtures contain private briefs. Invalid JSON text is never echoed.
- **Frozen output.** The loader validates, `structuredClone`s and deep-freezes, so the caller's input is never frozen or aliased and the engine cannot mutate seed data by accident. The `DeepReadonly` type enforces the same at compile time.
- **Calendar dates only.** `YYYY-MM-DD` without time or offset; same-format strings compare correctly with `<`. Time zone semantics are still an open design question.
- **Imports are extensionless** with `moduleResolution: "bundler"`, matching the skeleton repo (Next.js, Convex bundler, Vitest).

## How the engine will use it

1. Each scenario plugin ships its fixtures as modules (like `scope-change.simulated.ts`) or JSON, and loads them with `loadFixture(input, { expectedScenarioId: plugin.id, briefSchemas: plugin.briefSchemas })`.
2. The seed/reset mutation (doc 15) takes a loaded `ScenarioFixture` and writes rooms, participants, briefs, catalog entries and constraint versions through the same validated write paths as production, flagging every row as simulated with `provenance.label`. Fixtures never go to the browser whole: they contain private briefs.
3. Rules-engine tests (doc 06/16) iterate `fixture.phases`, get `constraintSetForPhase(fixture, phase.id)`, evaluate each `expectation.candidate` against it with the catalog, and assert `outcome.feasible` (and later `outcome.reasonCodes`).
4. The constraint-change walkthrough (doc 09/14) replays phase by phase: moving from `initial` (v1) to `cap-lowered` (v2) must turn the previously feasible phase-one candidate non-executable.

## Dependencies

| Package | Kind | Why |
| --- | --- | --- |
| `zod` 4.6.7 | runtime | Schemas, parsing and JSON Schema export; the version pinned by the platform baseline |
| `typescript` 6.0.3 | dev | Strict type checking (`npm run typecheck`); platform baseline version |
| `vitest` 5.0.5 | dev | Test runner used by the skeleton repo, so these tests move over unchanged |
| `@types/node` 24.19.2 | dev | Types for `structuredClone` and Node globals; matches Node 24 |

## Scripts

```bash
npm install
npm test           # vitest run
npm run typecheck  # tsc --noEmit -p tsconfig.json
```

## Verification

Run on Node v24.21.0, npm 11.19.0, 2026-10-24. No network calls, no model calls, no secrets read.

### `npm test`

```text

> @speak-for-me/fixture-types@0.1.0 test
> vitest run


 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/fixture-types


 Test Files  3 passed (3)
      Tests  57 passed (57)
   Start at  04:28:52
   Duration  104ms (import 59%, transform 26%, tests 12%, worker 3%)

test exit: 0
```

### `npx vitest run --reporter=verbose` (test names)

```text

 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/fixture-types

 ✓ src/json-schema.test.ts > scenarioFixtureJsonSchema > is closed and requires provenance 1ms
 ✓ src/json-schema.test.ts > scenarioFixtureJsonSchema > keeps integer cents and calendar dates 0ms
 ✓ src/json-schema.test.ts > scenarioFixtureJsonSchema > is deterministic 1ms
 ✓ src/loader.test.ts > example fixture: software scope change > is marked simulated 1ms
 ✓ src/loader.test.ts > example fixture: software scope change > carries the brief's numbers in integer cents 0ms
 ✓ src/loader.test.ts > example fixture: software scope change > only phase one in the initial phase is expected to be feasible 0ms
 ✓ src/loader.test.ts > example fixture: software scope change > maps phases to constraint sets 1ms
 ✓ src/loader.test.ts > example fixture: software scope change > keeps the deadline constraint private 0ms
 ✓ src/loader.test.ts > loadFixture > returns a deeply frozen fixture 1ms
 ✓ src/loader.test.ts > loadFixture > does not freeze or alias the caller's input 0ms
 ✓ src/loader.test.ts > loadFixture > throws FixtureValidationError with structured issues 1ms
 ✓ src/loader.test.ts > loadFixture > rejects non-object input 0ms
 ✓ src/loader.test.ts > loadFixture > checks the expected scenario id 0ms
 ✓ src/loader.test.ts > brief schemas > validates opaque briefs with plugin-supplied schemas 0ms
 ✓ src/loader.test.ts > brief schemas > fails closed when a role has no brief schema 0ms
 ✓ src/loader.test.ts > brief schemas > reports brief schema failures without echoing private values 0ms
 ✓ src/loader.test.ts > brief schemas > does not echo private values from structural failures 0ms
 ✓ src/loader.test.ts > parseFixtureJson > loads a JSON round trip of the example 0ms
 ✓ src/loader.test.ts > parseFixtureJson > reports invalid JSON without echoing the text 0ms
 ✓ src/loader.test.ts > helpers > formats issue paths 0ms
 ✓ src/loader.test.ts > helpers > deepFreeze freezes nested arrays and objects 0ms
 ✓ src/loader.test.ts > helpers > deepFreeze descends into already-frozen parents and survives cycles 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects a negative catalog price 2ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects a negative constraint amount 1ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects a negative expected total 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects non-integer cents 12.5 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects non-integer cents NaN 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects non-integer cents Infinity 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects cents beyond the safe integer range 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > rejects cents given as a string 0ms
 ✓ src/validation.test.ts > negative and non-integer cents > accepts zero cents 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-02-30" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-02-29" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-13-01" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-11-31" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026/11/20" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-11-20T00:00:00Z" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "26-11-20" 0ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "2026-1-2" 1ms
 ✓ src/validation.test.ts > bad dates > rejects catalog earliestDate "" 0ms
 ✓ src/validation.test.ts > bad dates > rejects a bad asOf date 0ms
 ✓ src/validation.test.ts > bad dates > rejects a bad constraint date 0ms
 ✓ src/validation.test.ts > bad dates > rejects a bad candidate delivery date 0ms
 ✓ src/validation.test.ts > bad dates > accepts a real leap day 0ms
 ✓ src/validation.test.ts > unknown item references > rejects an unknown item in a constraint 0ms
 ✓ src/validation.test.ts > unknown item references > rejects an unknown item in an expectation candidate 0ms
 ✓ src/validation.test.ts > unknown item references > does not report a total mismatch when the items are unknown 0ms
 ✓ src/validation.test.ts > unknown item references > rejects a duplicate item reference 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects an expected total that does not match catalog prices 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects unknown role references 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects duplicate ids 0ms
 ✓ src/validation.test.ts > other cross-reference checks > requires constraint set versions 1..n in order 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects a phase that references a missing constraint set version 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects phases whose constraint version goes backwards 0ms
 ✓ src/validation.test.ts > other cross-reference checks > requires the fixture to be marked simulated 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects unknown keys (typos) and bad slugs 0ms
 ✓ src/validation.test.ts > other cross-reference checks > rejects non-JSON values inside opaque records 0ms

 Test Files  3 passed (3)
      Tests  57 passed (57)
   Start at  04:28:54
   Duration  99ms (import 72%, tests 15%, transform 9%, worker 4%)

```

### `npm run typecheck`

```text

> @speak-for-me/fixture-types@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

typecheck exit: 0
```

### Negative control

Disabling the unknown-item report in `checkFixture` (temporarily, then restored) made 3 tests fail (`rejects an unknown item in a constraint`, `rejects an unknown item in an expectation candidate`, `does not report a total mismatch when the items are unknown`; `Tests  3 failed | 50 passed (53)` at the time), confirming the tests exercise the checks.
