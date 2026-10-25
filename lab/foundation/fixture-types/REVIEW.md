# Review: @speak-for-me/fixture-types

Reviewer: engineering agent (code review step). Date: 2026-10-24. Scope: everything under this directory except `node_modules`.

**Verdict: merge after fixes.** The author's claims hold: tests and typecheck pass on a fresh rerun, and the readonly guarantees really are enforced by `tsc`. The money and date rules are sound (safe-integer, non-negative cents; real calendar dates; a check that sums stay safe integers), and issue reporting does not echo values. The main problems are about boundaries. The generic package exports a scope-change example and runs it at import time, and its "generic" schema has scope-change concepts built in. Privacy, branding and key echo need follow-up once design docs 07 and 14 and the `money-dates` module are settled.

Must fix before merge: r01, r02, r05. The rest can be tracked as follow-ups.

## 1. Claims re-verified

Rerun on Node v24.21.0, npm 11.19.0. `node_modules` was already present, so `npm install` was not needed.

```text
> @speak-for-me/fixture-types@0.1.0 test
> vitest run

 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/fixture-types

 Test Files  3 passed (3)
      Tests  57 passed (57)
   Start at  04:30:41
   Duration  106ms (import 76%, tests 11%, transform 10%, worker 4%)

test exit: 0

> @speak-for-me/fixture-types@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

typecheck exit: 0
```

`tests_passed=true` and `typecheck_passed=true` are both accurate.

## 2. Compile-time probes

The probe files are in `/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/review-probes/fixture-types/`, outside this module. They are compiled with the same strict flags.

`should-error.ts`: all 9 intended misuses are rejected (`tsc exit: 2`).

| # | Misuse | tsc result |
| --- | --- | --- |
| E1 | `fixture.catalog.items[0]!.priceCents = 1` | TS2540 read-only property |
| E2 | `fixture.phases.push(...)` | TS2339 no `push` on readonly array |
| E3 | `fixture.privateBriefs["customer"]!["summary"] = "x"` | TS2542 index signature only permits reading |
| E4 | pass `ScenarioFixture` where mutable `ScenarioFixtureData` is expected | TS2345 readonly not assignable |
| E5 | `provenance: { simulated: false }` with `satisfies ScenarioFixtureInput` | TS2322 `false` not assignable to `true` |
| E6 | `schemaVersion: 2` | TS2322 |
| E7 | `priceCents: "500.00"` | TS2322 string not assignable to number |
| E8 | typo key `simulted` in an authored literal | TS2561 excess property |
| E9 | `visibility: "public"` | TS2322 |

`should-compile.ts` compiles cleanly, which shows where the compile-time guarantees stop:

- C1: `priceCents: 12.5`, `earliestDate: "not-a-date"` and `sourceRoleId: "Not A Slug"` in a typed input. These are caught only at runtime, which is expected for Zod input types.
- C2: a hand-built `const forged: ScenarioFixture = {...}` with a negative price, `currency: "usd"`, no roles and a phase pointing at version 9. It type-checks and is accepted by `constraintSetForPhase` (see r04).
- C3: `fixture.catalog.items[0]!.priceCents + 12.5` type-checks, because output money is plain `number`.

## 3. Runtime probes

From `probe.test.ts`, run through vitest because the package cannot be imported by plain `node` (see r11).

| # | Input | Observed |
| --- | --- | --- |
| R1 | `"__proto__": {...}` key inside a brief (JSON text) | Loads. The key is silently dropped; no prototype pollution. |
| R2 | phase 0 version 5 (unknown), phase 1 version 2 (valid) | Two issues: the correct `unknown_constraint_version`, plus a spurious "goes back from 5 to 2" `constraint_version_regression` on the valid phase |
| R3 | brief key `"Bad SECRET-..."` | `invalid_key` with the key in `path` |
| R4 | bad enum, currency, empty label, unknown key | Values are not echoed. The unknown key name is echoed in the message. |
| R5 | strict plugin brief schema, extra key | Message lists private brief key names: `Unrecognized keys: "notes", "SECRET-7f3a"` |
| R6 | candidate `["sso-login","sso-login"]` | `duplicate_id` plus a `total_mismatch` that counts the duplicate twice |
| R7 | delivery date 2020-01-01 (before item earliest date and `asOf`) | Loads. This is semantic, so out of scope, but `asOf` is never used. |
| R8 | constraint `budget-cap` changes kind, owner and visibility between v1 and v2 | Loads, with no issue |
| R9 | `briefSchemas` registered for finance, but finance has no brief | Loads |
| R11 | every price `MAX_SAFE_INTEGER` | Correctly rejected as `total_mismatch`, but the message prints an unsafe sum `27021597764222972` |
| R12 | plugin brief schema whose refinement throws | `safeLoadFixture` throws (`Error: boom SECRET-7f3a`), despite "Never throws on bad input" |
| R13 | async plugin brief schema | Throws "Encountered Promise during synchronous parse" |

## 4. Issues

### r01 (medium): scenario example exported from the generic index, with an import-time side effect

`src/index.ts:4` re-exports `scopeChangeSimulatedFixture` and `scopeChangeSimulatedInput`. `src/fixtures/scope-change.simulated.ts:178` calls `loadFixture(...)` at module top level. As a result:

- every importer of the engine-level package (Convex functions, the app) parses the example on import, and a bad example makes the whole package fail to import;
- scenario-specific names (`scopeChange*`) and constraint kinds (`budget-cap`, `committed-spend`, `required-items`, `delivery-deadline`) become part of the generic package's public surface. The brief separates the engine package from the scenario package, and doc 14 has not fixed this vocabulary.

Fix: drop the example from `index.ts`. Keep it as test data (`src/fixtures/` imported only by tests), or expose it through a subpath export such as `"./examples/scope-change"`. Load it lazily, for example with `export function scopeChangeSimulatedFixture()`. Once the scenario package exists, move it there.

### r02 (medium): the "generic" schema has scope-change concepts built in

`CatalogItem` requires `priceCents` and `earliestDate` (`src/schema.ts:37-46`). `Catalog` is required, with a single currency. `ExpectationCandidate` is `itemIds + deliveryDate`, and `ExpectedOutcome` requires `itemsTotalCents` and `feasible` (`src/schema.ts:80-92`). These are first-scenario concepts. A second scenario without dated, priced items would have to fake values. The brief says the engine interface must fit a second scenario, and the task says not to invent domain names that docs 02, 06 and 14 will define (for example, `feasible` versus the brief's "derived executability"). The example also overloads "phase": `phases[]` are script steps, while `phase-one` is a delivery phase.

Fix: make `earliestDate`, `deliveryDate` and `itemsTotalCents` optional, and run the total check only when `itemsTotalCents` is present. Alternatively, move scenario-only slots into `params`. Rename `phases` to `steps` to avoid the clash. Add a README note that `catalog`, `candidate` and `outcome` are provisional until docs 02, 06 and 14 land. The spike fixture has an unconfirmed catalog item, which this schema cannot express yet.

### r03 (medium): private and shared data are mixed with no separation helper

The loaded `ScenarioFixture` holds `privateBriefs`, private constraints and free text in one object. Core rule 1 then depends on every consumer remembering to strip fields. The privacy-canary spike (`spikes/privacy-canary-report.md`) recommends `secretsOf(fixture)` and per-role canaries, but briefs are opaque, so this module cannot list private values. In the example, expectation descriptions mention "lands after the deadline" (`scope-change.simulated.ts:142,168`), and the deadline is a private customer constraint. Nothing says which text fields are safe to show.

Fix: keep this generic, keyed only on the existing `visibility` flag. Add `privateValuesOf(fixture)`, which collects brief leaves plus the values and descriptions of private constraints, for the canary scanner. Add an optional `canaries: Record<roleId, string>` to the schema. Document that phase and expectation `description` fields are test metadata and must never be rendered. Leave a full public projection to doc 07.

### r04 (medium): money, dates and the loaded fixture are unbranded; name clash with `foundation/money-dates`

Sibling module `foundation/money-dates/src/money.ts:19` and `dates.ts:16` export branded `type Cents` and `type IsoDate`. This module exports Zod *values* with the same names (`src/primitives.ts:35,42`) that output plain `number` and `string`, so the two modules collide on import and consumers must re-brand by hand (C3). `ScenarioFixture` is also structural, so forged, unvalidated objects type-check (C2). That contradicts the README's statement that every fixture enters through the loader.

Fix: agree on one `Cents` and `IsoDate` with `money-dates`. For example, rename the schemas `CentsSchema` and `IsoDateSchema` and have them output the branded types with `.transform(v => v as Cents)` or `.brand()`. Brand the loader output with a `unique symbol` so only `loadFixture` can produce a `ScenarioFixture`.

### r05 (low, must fix): compile-time guarantees are not pinned by tests

E1 to E9 hold today, but nothing in `npm run typecheck` asserts them. If `DeepReadonly` is weakened, or `simulated: z.literal(true)` becomes `z.boolean()` in the input type, nothing fails. Fix: add `src/types.check.ts`, which `tsconfig` already includes, with `// @ts-expect-error` lines for E1 to E9. This is a small change.

### r06 (low): constraint identity across versions is not checked

R8: the same constraint `id` can change `kind`, `ownerRoleId` or `visibility` between snapshots, and no issue is raised. Snapshots are meant to be the history of the same constraints (core rule 6). An owner or kind change is almost certainly a fixture typo, and a visibility flip is a disclosure decision that should be deliberate. Fix: add a `constraint_identity_changed` check in which `kind` and `ownerRoleId` must stay the same per `id` across sets. Either allow visibility to change only through an explicit field, or report it too.

### r07 (low): diagnostic noise in the cross-reference pass

- R2: `src/schema.ts:233` runs `previousVersion = Math.max(previousVersion, phase.constraintSetVersion)` even when the version was reported as unknown, so later valid phases get a false regression issue. Fix: update `previousVersion` only when the version exists.
- R6: `checkItems` returns `allKnown = true` for duplicates, so the total check also fires with the duplicate counted twice. Fix: skip the total check when the candidate list has duplicates.
- R11: when the sum is not a safe integer, the message prints the unsafe float. Fix: say "sum exceeds the safe integer range".

### r08 (low): edge cases in `briefSchemas`

- R9: fail-closed covers only briefs that have no schema. A role whose schema is registered but whose brief is missing passes. Fix: report `missing_brief` for every key in `briefSchemas` with no brief. Alternatively, document that a missing brief is allowed.
- R12 and R13: a throwing or async plugin schema escapes `safeLoadFixture`, whose comment says it never throws. A thrown message can carry private data. Fix: wrap `schema.safeParse` in try/catch, turn failures into a `brief_schema_error` issue with a fixed message, and document that brief schemas must be synchronous.
- R1: a `__proto__` key inside a brief is silently dropped. Fix: reject the key (for example with a refinement on `JsonRecord` keys) so authors notice.

### r09 (low): the "never echoes input" claim does not cover keys

R3, R4 and R5: record keys appear in `path`, and `unrecognized_keys` messages list key names, including keys inside private briefs when a plugin schema is strict. Values are never echoed, as the README says, but key names are input too. Fix: either document that key names may appear in issues, or, for issues under `privateBriefs`, replace `unrecognized_keys` messages with a count and cut the path at `privateBriefs.<roleId>`.

### r10 (low): `Slug` is not compatible with the plugin-id rule

`src/primitives.ts:15` says `Slug` is "compatible with" `^[a-z][a-z0-9-]*$`, the rule in `spikes/skeleton/core/engine/plugin.ts:12`. It is not. `Slug` accepts `scope_change` and `scope.change`, which that rule rejects, and rejects `a--b`, which that rule accepts. `scenarioId: Slug` can therefore name a plugin id that cannot exist. Fix: give `scenarioId` its own `PluginId` schema that uses the plugin rule exactly, or share one regex, and correct the comment.

### r11 (low): import constraint and README gaps

- `exports` points at `./src/index.ts` with extensionless relative imports. Plain `node` (type stripping) fails with `ERR_MODULE_NOT_FOUND`, verified with this module's own `src/index`. That is fine inside Next, Convex and Vitest, but a seed/reset CLI run with plain Node cannot import it. Fix: state this in the README, or use `.ts` extensions with `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`.
- The README is otherwise good: shape, checks table, API list, design notes, dependency reasons and verification. It is missing a short plugin-side example (`loadFixture(json, { expectedScenarioId, briefSchemas })` with a brief schema). It also does not say that brief schemas must be synchronous, that `ScenarioFixture` is not branded, or how to connect `scenarioFixtureJsonSchema()` to an editor (`$schema`).

## 5. Areas checked with no issue

- **Dependencies.** One runtime dependency (`zod` 4.6.7) and three dev dependencies (`typescript` 6.0.3, `vitest` 5.0.5, `@types/node` 24.19.2). All are pinned exactly, each has a stated reason, and they match the platform baseline (`inputs/04-platform-constraints-part1.md:19`) and the skeleton spike. The lockfile has 64 packages, all from vitest's toolchain. Nothing is unnecessary.
- **Money (core rule 4).** `z.int().nonnegative()` gives safe, non-negative integer cents, compatible with Convex `v.number()` (part2:27). Floats, NaN, Infinity, strings and 2^53 are rejected and tested. The catalog-sum check guards against unsafe sums. `sourceRoleId` records where prices come from.
- **Dates.** `z.iso.date()` rejects impossible days, non-leap Feb 29, date-times and unpadded values (tested).
- **Simulated data (core rule 8).** `provenance.simulated: z.literal(true)` plus a required label, enforced at both runtime and compile time (E5).
- **History (core rule 6).** Full snapshots, dense ordered versions, no backwards phase steps.
- **Immutability.** `structuredClone` then deep-freeze. The caller's input is neither frozen nor aliased (tested), and `DeepReadonly` is enforced by tsc (E1 to E4).
- **No model calls, no secrets, no domain tables or state machines.** No Convex table names, no room or proposal states, no function names from the domain design.
- **Tests.** 57 focused cases with a documented negative control. Each check has positive and negative coverage, and private values are tested for non-echo.
