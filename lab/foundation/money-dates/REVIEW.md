# Review: money-dates

Reviewer: engineer agent (code review step), 2026-10-24.
Scope: `src/`, `test/`, `package.json`, `tsconfig*.json`, `README.md`.
Verdict: **merge after fixes** (one medium issue, the rest low / nits).

## 1. Author claims re-run

Re-run in this directory with Node v24.21.0 (node_modules already present, no reinstall needed):

| Command | Result |
| --- | --- |
| `npm test` | 4 files, 115/115 tests passed, exit 0 |
| `npm run typecheck` (`tsc -p tsconfig.json` and `tsc -p tsconfig.test.json`, each run on its own) | both exit 0 |
| `npm run test:tz` (UTC+14 and UTC-11) | 115/115 passed under each TZ |

`tests_passed=true` and `typecheck_passed=true` both hold.

## 2. Compile-time safety: checked with a negative probe

Probe: `scratchpad/review-probes/money-dates/should-fail.ts` (outside this module), compiled with this module's
`tsc` using the same strict flags. All 13 misuse lines failed to compile, each with the expected error
(exit 2). The 3 control lines compiled:

- E1 `const x: Cents = 100`: TS2322
- E2 `const x: Cents = a + a` (arithmetic result is a plain number): TS2322
- E3 `SignedCents` assigned to `Cents`: TS2322 (missing `nonNegativeBrand`)
- E4 `addCents(a, 1.5)`, E5 `sumCents([1,2,3])`, E6 `formatCents(4800)`: TS2345
- E7 `const d: IsoDate = "2026-02-30"`, E8 `addDays("2026-11-14", 1)`, E9 `isOnOrBefore(d, "2026-11-15")`: TS2322 / TS2345
- E10/E11/E12 cross-brand (`IsoDate` <-> `Cents`): TS2322 / TS1360
- E13 `subtractCents(signedCents(5), a)`: TS2345
- Controls that compile, as expected for brands: `const n: number = a`, `5 as Cents`, and
  **`const c: Cents = JSON.parse("5")`**. Any `any` value (JSON, `v.any()`, unparsed model output) passes
  silently. See r01 and r05.

The `@ts-expect-error` lines in `test/types.test.ts` are covered by `tsconfig.test.json`, so if a brand
regressed, `npm run typecheck` would fail. The brands do work at compile time.

## 3. What is good

- Money is integer cents in `number`, checked against `Number.isSafeInteger`. bigint is used only for
  intermediate results. Parsing never touches floats (`parseFloat` / `toFixed` are banned by the hygiene
  test). More than two decimals is rejected, never rounded. This matches core #4 and fixes the old
  `Math.round(parseFloat(x)*100)`.
- Rounding happens only in `scaleCents`, and the caller must pass the mode. `allocateCents` uses largest
  remainder with deterministic ties. Property tests show no cent is lost or invented.
- `SignedCents` lets the design express credits and negative deltas (GAP-25) without letting stored
  amounts go negative.
- Dates: no `Date`, `Intl` or host TZ. Hinnant's algorithm runs on epoch days and is checked against a UTC
  oracle. Accepted dates match `z.iso.date()` exactly, both exhaustively on edge years and on random
  input. "Today" is left to the caller, and the offset is explicit with no default.
- Error messages never echo values. I checked `assertCents`, `parseCentsOrThrow` and `isoDate` by hand.
  This supports core #1, because private amounts never reach logs or other parties' error text.
- The API is domain-agnostic. `src/` has no table, state or function names from the domain. Only one
  comment mentions a "finance-only budget", as an example. `deadline` is used only as a generic
  parameter name.
- Dependencies are minimal. There are zero runtime deps. The dev deps (typescript, vitest, fast-check,
  zod as a test oracle, @types/node) are pinned and each one has its reason written in the README.
- The README is good enough for another engineer to use the module. It has an API table, accepted and
  rejected input lists, design notes with reasons, intended call sites, known gaps, and real verification
  output.

## 4. Issues

### money-dates-r01 (medium): money operations do not re-validate their operands at runtime

`addCents`, `subtractCents`, `differenceCents`, `absCents`, `multiplyCents`, `scaleCents`, `compareCents`,
`minCents` and `maxCents` trust the brand. `sumCents` and `allocateCents` do assert, and every date
function re-validates (the README calls this out as a feature). Brands disappear at runtime. Convex
`v.number()` fields come back as `number`, and model output or JSON comes back as `any`, so a
`doc.amount as Cents` or an `any` slips through. Probe results (`review-probes/money-dates/runtime.mjs`):

```text
multiplyCents(-5 as Cents, 3)          => -15        (negative value typed Cents)
scaleCents(-100 as Cents, 1, 3, floor) => -33        (negative AND wrong floor; bigint truncates)
addCents(-500 as Cents, 1000 as Cents) => 500        (accepted)
scaleCents(1.5 as Cents, 1, 1, floor)  => RangeError (not MoneyError, no code)
compareCents(NaN, 5)                   => 0
minCents(NaN, 1)                       => NaN
```

This breaks the module's own invariant: "`Cents` (stored amounts) can never be negative" (README note 4).
It also weakens core #4, where code does the checking and a mis-cast gives a confident wrong number.

**Fix:** call `assertCents` on every `Cents` operand and `isSignedCents`/`signedCents` on every
`SignedCents` operand in each exported function (the cost is a few comparisons). Then add tests that pass
cast-in invalid values and expect `MoneyError`.

### money-dates-r02 (low): `isoDateFromEpochMs` rejects fractional milliseconds

It requires `Number.isSafeInteger(epochMs)`. Convex `_creationTime` is float64 milliseconds and in
practice usually has a fractional part. Platform constraints describe it only as "wall clock", so this
needs to be verified. `isoDateFromEpochMs(1729700000000.123, 0)` throws `INVALID_ARGUMENT`. The first
caller who passes `doc._creationTime` will hit a confusing error.

**Fix:** accept any finite number and `Math.floor` it first. Or document that callers must pass an
integer such as `Date.now()`. Add a test either way.

### money-dates-r03 (low): README says the files run in "plain Node", but they do not

`src/index.ts` uses extensionless relative imports (`./money`). Running
`node -e "import('<module>/src/index.ts')"` fails with `ERR_MODULE_NOT_FOUND .../src/money`. The files
only work through a bundler or a transformer (vitest, Next, Convex's esbuild). `erasableSyntaxOnly` is
already on, so Node's native type stripping is one step away.

**Fix:** either write `./money.ts` / `./dates.ts` and turn on `allowImportingTsExtensions` (with
`noEmit` already set), or change the README to "runs through a bundler (Next.js, Convex, vitest)". Also
note that `exports: "./src/index.ts"` assumes consumers transpile TypeScript, for example Next
`transpilePackages` when the module is not copied into `core/`.

### money-dates-r04 (low): `splitCentsEvenly` allocates an array of size `count` with no bound

`splitCentsEvenly(100, 2**32)` throws `RangeError: Invalid array length` (not `MoneyError`). A count like
`1e8` would allocate about 800 MB before anything fails. This is harmless while counts come from code. It
is a DoS risk if a count ever comes from user or model input.

**Fix:** reject `count > total` with a `MoneyError` when parts must be non-zero, or set a documented upper
bound such as `count <= 10_000`. In either case throw `MoneyError("INVALID_ARGUMENT")`.

### money-dates-r05 (low): README does not say how to read untrusted values back

The README explains how to validate on writes. It never says that values read from Convex (`number` /
`string`), from model output or from JSON must go through `cents()` / `assertCents()` / `isoDate()`, and
must never be cast with `as Cents` / `as IsoDate`. The compiler cannot catch either `as` or `any` (see
section 2).

**Fix:** add a "Reading stored or untrusted values" section to the README. Optionally recommend a lint
rule that bans `as Cents` / `as IsoDate` outside this module, or a small `zod` `z.custom<Cents>(isCents)`
recipe in the docs (as text only, so no new dependency).

### money-dates-r06 (low): the README should say that formatting does not mean a value may be disclosed

The README suggests `formatCents` / `formatIsoDate` for public text templates, and its example names
scenario items ("LOGIN + REPORTS for $900"). A `Cents` value carries no visibility information.
Formatting a private budget gives a string that looks just as harmless as a public price. Core #1 needs
the disclosure decision to happen before any template sees the value.

**Fix:** add one sentence to the README: "This module has no notion of visibility; only pass values that
the disclosure layer already released to a template". Replace the scenario-specific example with a
neutral one.

### money-dates-r07 (low, nits)

- `formatIsoDate("0005-01-01")` gives `"Jan 1, 5"`. Years below 1000 are not padded. This is cosmetic and
  inside the accepted range.
- `engines: ">=24 <25"`: the upper bound will block Node 25/26 for no reason. Use `>=24`.
- The hygiene test only checks static `from "..."` imports and drops comments line by line. `import()`,
  `require`, and `globalThis.Date` would get through. Add `/\bimport\s*\(|\brequire\s*\(|globalThis\.Date/`.
- `test:tz` uses POSIX `VAR=value cmd` syntax, which does not work on Windows shells. This is fine for
  macOS/Linux CI, but the README should say so.
- `parseCents("-0")` returns `NEGATIVE`, and `"$\n5"` is accepted. Both are acceptable, but neither is
  documented.

## 5. Consistency with the brief's core

| Core item | Status |
| --- | --- |
| #4 code checks values, no float money, no invented amounts | Holds for parsing and arithmetic. r01 is the gap. |
| #1 private fields never leak | Errors never echo values. The module cannot enforce what templates receive (r06, documentation only). |
| #6 / #8 determinism, no fabrication | No clock, randomness, host TZ or Intl, and the hygiene test enforces this. "Today" is the caller's job. |
| "No invented business tables / states / functions" | Holds: `src/` is domain-agnostic. |

## 6. Verdict

**merge_after_fixes.** Fix r01 before merge. It is small: add operand asserts and a few tests. r02–r06 are
small README or code changes that can land together. r07 is optional. No rewrite is needed. The design
choices (number cents, brands, explicit rounding, epoch-day dates, no Intl) are sound and well argued.
