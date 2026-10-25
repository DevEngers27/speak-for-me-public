# money-dates

Foundation module for Speak for Me: **integer-cent money** and **timezone-free
ISO calendar dates**. It holds no business rules, tables or state; it is the
arithmetic and validation layer that budget checks, catalog sums, delivery-date
rules and public text templates are built on.

- Pure TypeScript (strict, ESM), zero runtime dependencies.
- `src/` compiles against `lib: ["ES2022"]` with **no** Node, DOM or other
  ambient types, so the same files run in Next.js, the Convex isolate runtime
  and plain Node.
- No `Date`, `Intl`, host timezone, randomness or float parsing in `src/`
  (enforced by `test/hygiene.test.ts`).

## API

Everything is exported from `src/index.ts`.

### Money (`src/money.ts`)

| Export | Purpose |
| --- | --- |
| `type SignedCents` | Integer cents in `Number.isSafeInteger` range, may be negative (e.g. a headroom). |
| `type Cents` | Non-negative `SignedCents`. Assignable to `SignedCents`, not the other way. |
| `isCents(v, {max?})`, `isSignedCents(v)` | Type guards. |
| `assertCents(v, {max?})`, `cents(n, {max?})`, `signedCents(n)`, `toCents(s)` | Validating assert / constructors. Throw `MoneyError` with `code` `NOT_SAFE_INTEGER` / `NEGATIVE` / `OUT_OF_RANGE`. Normalize `-0`. |
| `ZERO_CENTS`, `MAX_CENTS` | Constants (`MAX_CENTS` = `Number.MAX_SAFE_INTEGER`). |
| `addCents(a, b)`, `sumCents(iterable)` | Overflow-checked sums. |
| `subtractCents(a, b)` | `a - b`, throws `NEGATIVE_RESULT` if `b > a`. |
| `differenceCents(a, b)`, `absCents(s)` | Signed difference and magnitude (headroom / shortfall style values). |
| `compareCents`, `minCents`, `maxCents` | Ordering. |
| `multiplyCents(unit, qty)` | Unit price x integer quantity, checked. |
| `scaleCents(amount, num, den, rounding)` | Exact `amount * num / den` with a **required** `RoundingMode` (`floor` / `ceil` / `half-up` / `half-even`), e.g. basis points. |
| `allocateCents(total, weights)` | Split by integer weights, largest-remainder, ties to lower index; sum is always exactly `total`; zero weight gets zero. |
| `splitCentsEvenly(total, n)` | Parts differ by at most 1 cent; earlier parts get the extras. |
| `parseCents(text, {max?})` | User string -> `{ ok: true, value: Cents }` or `{ ok: false, error }` with `error` in `EMPTY` / `NEGATIVE` / `INVALID_FORMAT` / `TOO_MANY_DECIMALS` / `OUT_OF_RANGE`. |
| `parseCentsOrThrow(text, {max?})` | Same, throwing `MoneyError` whose `code` is the parse error. |
| `formatCents(s, {fraction?})` | Display: `$4,800`, `$4,800.50`, `-$12.30`; `fraction: "always"` gives `$4,800.00`. |
| `centsToInputString(c)` | Pre-fill text for an amount input: `4800`, `4800.50`. |
| `centsToDecimalString(s)` | Canonical machine form: `4800.00`, `-0.05`. |

Accepted by `parseCents`: `"$4,800"`, `"4800"`, `"4800.50"`, `"4,800.5"`,
`"$ 1,234,567.89"`, `".99"`, surrounding whitespace. Rejected: negatives
(`-5`, `$-5`, `−5` (U+2212 minus), `(5.00)`), more than two decimals (`4.555`, `1.500`;
never rounded), European separators (`4.800,00`, `4,80`), bad grouping
(`1,2345`, `0,100`), exponents, `Infinity`/`NaN`, hex, `+5`, currency codes,
full-width digits, inputs over 64 characters.

### Dates (`src/dates.ts`)

| Export | Purpose |
| --- | --- |
| `type IsoDate` | Validated `YYYY-MM-DD`. Lexicographic order equals calendar order. |
| `parseIsoDate(v)` | `{ ok: true, value }` or `{ ok: false, error: "INVALID_FORMAT" \| "INVALID_DATE" }`. Strict: no trimming, no time part, real calendar day. |
| `isIsoDate`, `assertIsoDate`, `isoDate(s)` | Guard / assert / constructor (throw `DateError`). |
| `isoDateFromParts(y, m, d)`, `isoDateParts(d)` | Build from / split into numbers. |
| `isLeapYear(y)`, `daysInMonth(y, m)` | Gregorian rules (2000 leap, 2100 not). |
| `toEpochDay(d)`, `fromEpochDay(n)` | Days since 1970-01-01 (integer, signed). |
| `addDays(d, n)`, `daysBetween(from, to)` | Day arithmetic; `daysBetween(d, addDays(d, n)) === n`. |
| `compareIsoDates`, `isBefore`, `isAfter`, `isOnOrBefore(date, deadline)`, `isOnOrAfter(date, earliest)`, `minIsoDate`, `maxIsoDate` | Comparisons. They re-validate inputs at runtime, so a mis-cast string throws instead of comparing garbage. |
| `isoWeekday(d)` | 1 = Monday .. 7 = Sunday. |
| `isoDateFromEpochMs(ms, utcOffsetMinutes)` | Calendar date of an instant at an **explicit** fixed offset (no default, no IANA lookup). |
| `formatIsoDate(d, style?)` | `iso` -> `2026-11-14`, `medium` (default) -> `Nov 14, 2026`, `long` -> `Saturday, November 14, 2026`. |
| `MIN_ISO_DATE`, `MAX_ISO_DATE` | `0000-01-01`, `9999-12-31`. |

## Design notes

1. **Cents are `number`, not `bigint`.** Convex `v.number()` is float64 and
   holds every safe integer exactly; `v.int64()` would force bigint through
   validators, JSON and React props for no practical gain. Every operation
   checks the result stays a safe integer (about $90 trillion). `bigint` is used
   only *inside* `scaleCents` / `allocateCents` / `multiplyCents` /
   `parseCents`, where intermediate products can exceed 2^53.
2. **Brand types** make "validated" visible in signatures: a bare `number` or
   `string` cannot be passed where `Cents` or `IsoDate` is required
   (`test/types.test.ts` checks this at compile time). Brands are erased at
   runtime, so stored values are plain numbers and strings.
3. **Parsing never goes through floats.** The old prototype used
   `Math.round(parseFloat(x) * 100)`. Here the digit string is split and
   combined as integers. Input with more than two decimals is rejected rather
   than rounded: `1.500` can mean 1500 in some locales, and silently rounding a
   money input is worse than asking again. Only US-style input is accepted.
4. **Negatives are rejected at the edges, allowed in the middle.** `Cents`
   (stored amounts: budgets, prices, commitments) can never be negative;
   `SignedCents` exists for derived values like headroom, produced only by
   `differenceCents`. `subtractCents` throws instead of going negative.
5. **Rounding is never implicit.** Only `scaleCents` rounds, and it requires the
   caller to choose the mode, because rounding policy is a business decision.
   `allocateCents` never rounds: it hands out leftover cents deterministically.
6. **Dates are labels for days, not instants.** Nothing constructs a `Date`
   or reads the host timezone; arithmetic uses Howard Hinnant's
   days-from-civil algorithm on an integer epoch day. Results are identical on
   any host (`npm run test:tz` runs the suite under UTC+14 and UTC-11).
7. **One date validator, matching zod.** The accepted set (0000-01-01 ..
   9999-12-31, real calendar days) is exactly what `z.iso.date()` accepts; the
   tests compare both on every month/day combination of edge years and on
   random strings. The old prototype had two validators that disagreed on
   `2026-02-30`.
8. **"Today" is the caller's job.** Which offset a room uses (and DST) is a
   design decision still open, and `Intl` time-zone support in the Convex
   runtime is unverified. `isoDateFromEpochMs` converts an instant using an
   offset the caller supplies, and has no default so UTC is never assumed
   by accident.
9. **No `Intl` in formatting.** Fixed en-US output keeps server-generated public
   text deterministic and avoids the unverified runtime dependency.
10. **Errors never echo values.** Amounts can be private (finance-only budget)
    and errors end up in logs or other parties' responses. `MoneyError` /
    `DateError` carry a stable `code` and a message describing the rule only.

## How the engine will use it

The exact tables and functions are still being designed; these are the
call sites the design inputs already point to.

- **Write entry points** (budget update, catalog item write, brief
  confirmation, seed): validate with `assertCents(value, { max })` and
  `assertIsoDate(value)` after the Convex `v.number()` / `v.string()` shape
  check, since validators do not check ranges or formats. Catch `MoneyError` /
  `DateError` and convert `code` to the app's `ConvexError` / reason code.
- **Forms**: `parseCents` for dollar inputs (show the error code as a field
  message); `centsToInputString` to pre-fill; date pickers already produce
  `YYYY-MM-DD`, which goes through `parseIsoDate`. In zod schemas,
  `z.iso.date()` and `isIsoDate` agree, so either works.
- **Rules** (pure functions, no model input): sum selected catalog prices with
  `sumCents`, compare `addCents(committed, cost)` against the cap with
  `compareCents`, derive headroom / shortfall with `differenceCents` /
  `absCents`; check `isOnOrBefore(delivery, deadline)`,
  `isOnOrAfter(delivery, today)`, `isOnOrAfter(delivery, maxIsoDate(...earliest))`,
  and `addDays(today, leadTimeDays)`.
- **Public text templates and UI**: `formatCents` and `formatIsoDate` for
  "LOGIN + REPORTS for $900, delivery Nov 14, 2026" style strings.
- **Canonical keys / logs**: `centsToDecimalString` and the raw `IsoDate`
  string give stable textual forms.

When the module moves into the new repo it can sit under `core/` unchanged
(relative imports only, no runtime dependencies).

## Dependencies

No runtime dependencies. Dev dependencies, pinned exactly:

| Package | Why |
| --- | --- |
| `typescript@6.0.3` | Typecheck; same version as the skeleton spike. |
| `vitest@5.0.5` | Test runner; same version as the skeleton spike. |
| `fast-check@4.10.2` | Property-based tests with shrinking (arithmetic laws, parse/format round-trips, allocation invariants, date arithmetic against an oracle). |
| `zod@4.6.7` | Test-only oracle: proves `isIsoDate` accepts exactly what `z.iso.date()` accepts. Same version as the skeleton. |
| `@types/node@24.19.2` | Test-only (`node:fs` in the hygiene test); `src/` is compiled without it. |

## Scripts

- `npm test`: run all tests (vitest).
- `npm run typecheck`: `tsc` on `src/` alone (no ambient types), then on
  `src/` + `test/` (Node types, compile-time brand tests).
- `npm run test:tz`: run the suite under `TZ=Pacific/Kiritimati` (UTC+14) and
  `TZ=Pacific/Pago_Pago` (UTC-11).

## Known gaps

- Single currency (USD, `$`, two decimals). Multi-currency would need a
  `{ currency, minor }` value type and per-currency exponents.
- Only US-style amount input; no locale-aware parsing or formatting.
- No IANA time zone or DST handling; callers supply a fixed offset.
- English-only date formatting.
- Business limits (for example a per-amount cap) are not hard-coded; callers
  pass `{ max }`.

## Verification

Run on 2026-10-24T11:29Z, Node v24.21.0, npm 11.19.0, in `/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/money-dates`.

### `npm test`

```text

> @speak-for-me/money-dates@0.1.0 test
> vitest run


 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/money-dates


 Test Files  4 passed (4)
      Tests  115 passed (115)
   Start at  04:29:56
   Duration  285ms (tests 79%, import 16%, transform 4%, worker 2%)

[exit code: 0]
```

### `npm run typecheck`

```text

> @speak-for-me/money-dates@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json

[exit code: 0]
```

### `npm run test:tz`

```text

> @speak-for-me/money-dates@0.1.0 test:tz
> TZ=Pacific/Kiritimati vitest run && TZ=Pacific/Pago_Pago vitest run


 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/money-dates


 Test Files  4 passed (4)
      Tests  115 passed (115)
   Start at  01:29:57
   Duration  277ms (tests 81%, import 14%, transform 4%, worker 2%)


 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/money-dates


 Test Files  4 passed (4)
      Tests  115 passed (115)
   Start at  00:29:58
   Duration  296ms (tests 81%, import 14%, transform 4%, worker 2%)

[exit code: 0]
```

### `npx vitest run --reporter=verbose` (per-test list)

```text

 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/money-dates

 ✓ test/hygiene.test.ts > source hygiene > src/ has files 1ms
 ✓ test/hygiene.test.ts > source hygiene > dates.ts avoids forbidden APIs 0ms
 ✓ test/hygiene.test.ts > source hygiene > index.ts avoids forbidden APIs 0ms
 ✓ test/hygiene.test.ts > source hygiene > money.ts avoids forbidden APIs 0ms
 ✓ test/types.test.ts > brand types > plain numbers and strings are not accepted where brands are required 1ms
 ✓ test/dates.test.ts > validation > accepts 2026-10-24 1ms
 ✓ test/dates.test.ts > validation > accepts 2028-02-29 0ms
 ✓ test/dates.test.ts > validation > accepts 2000-02-29 0ms
 ✓ test/dates.test.ts > validation > accepts 2026-12-31 0ms
 ✓ test/dates.test.ts > validation > accepts 0000-01-01 0ms
 ✓ test/dates.test.ts > validation > accepts 0000-02-29 0ms
 ✓ test/dates.test.ts > validation > accepts 9999-12-31 0ms
 ✓ test/dates.test.ts > validation > accepts 1970-01-01 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-02-29" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-02-30" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2100-02-29" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "1900-02-29" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-04-31" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-13-01" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-00-10" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-01-00" as INVALID_DATE 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-1-01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "26-01-01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "20260101" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects " 2026-01-01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-01-01 " as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "2026-01-01T00:00:00Z" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "+002026-01-01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "2026/01/01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "２０２６-01-01" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > rejects "" as INVALID_FORMAT 0ms
 ✓ test/dates.test.ts > validation > non-strings are rejected 0ms
 ✓ test/dates.test.ts > validation > leap-year rules 0ms
 ✓ test/dates.test.ts > validation > agrees with zod z.iso.date() on every month/day combination of edge years 17ms
 ✓ test/dates.test.ts > validation > property: agrees with zod on random date-shaped and arbitrary strings 30ms
 ✓ test/dates.test.ts > construction and parts > from parts 0ms
 ✓ test/dates.test.ts > construction and parts > property: epoch-day conversion matches the UTC oracle and round-trips 19ms
 ✓ test/dates.test.ts > construction and parts > range limits 0ms
 ✓ test/dates.test.ts > arithmetic > examples across month, year and leap boundaries 0ms
 ✓ test/dates.test.ts > arithmetic > property: addDays and daysBetween are inverse and compose 24ms
 ✓ test/dates.test.ts > arithmetic > property: comparison agrees with daysBetween 26ms
 ✓ test/dates.test.ts > deadline semantics > delivery on the deadline day is on time; the next day is late 0ms
 ✓ test/dates.test.ts > deadline semantics > earliest-delivery style checks 0ms
 ✓ test/dates.test.ts > deadline semantics > comparison refuses unvalidated strings 0ms
 ✓ test/dates.test.ts > boundary helpers > isoDateFromEpochMs uses only the explicit offset 0ms
 ✓ test/dates.test.ts > boundary helpers > property: offset 0 matches the UTC oracle 7ms
 ✓ test/dates.test.ts > boundary helpers > weekday and formatting 0ms
 ✓ test/dates.test.ts > boundary helpers > property: weekday matches the UTC oracle 4ms
 ✓ test/money.test.ts > guards and constructors > accepts non-negative safe integers only 1ms
 ✓ test/money.test.ts > guards and constructors > assertCents reports a specific code and never echoes the value 0ms
 ✓ test/money.test.ts > guards and constructors > normalizes -0 0ms
 ✓ test/money.test.ts > arithmetic > worked budget example stays exact 0ms
 ✓ test/money.test.ts > arithmetic > ten dimes are exactly one dollar (no float drift) 0ms
 ✓ test/money.test.ts > arithmetic > negative results and overflow are rejected 0ms
 ✓ test/money.test.ts > arithmetic > property: add is commutative, associative, and inverted by subtract 21ms
 ✓ test/money.test.ts > arithmetic > property: difference is antisymmetric and consistent with compare 27ms
 ✓ test/money.test.ts > arithmetic > property: multiply matches bigint arithmetic 6ms
 ✓ test/money.test.ts > scaleCents > examples per rounding mode 0ms
 ✓ test/money.test.ts > scaleCents > property: modes bracket the exact quotient 40ms
 ✓ test/money.test.ts > allocation > examples 1ms
 ✓ test/money.test.ts > allocation > property: no cent lost or invented, each part within one cent of its exact share 73ms
 ✓ test/money.test.ts > allocation > property: even split differs by at most one cent, extras first 18ms
 ✓ test/money.test.ts > parseCents > accepts "$4,800" 0ms
 ✓ test/money.test.ts > parseCents > accepts "4800" 0ms
 ✓ test/money.test.ts > parseCents > accepts "4800.50" 0ms
 ✓ test/money.test.ts > parseCents > accepts "4,800.5" 0ms
 ✓ test/money.test.ts > parseCents > accepts "$ 1,234,567.89" 0ms
 ✓ test/money.test.ts > parseCents > accepts "  $12.3  " 0ms
 ✓ test/money.test.ts > parseCents > accepts ".99" 0ms
 ✓ test/money.test.ts > parseCents > accepts "$.05" 0ms
 ✓ test/money.test.ts > parseCents > accepts "0" 0ms
 ✓ test/money.test.ts > parseCents > accepts "$0.00" 0ms
 ✓ test/money.test.ts > parseCents > accepts "007" 0ms
 ✓ test/money.test.ts > parseCents > accepts "90071992547409.91" 0ms
 ✓ test/money.test.ts > parseCents > rejects "" as EMPTY 0ms
 ✓ test/money.test.ts > parseCents > rejects "   " as EMPTY 0ms
 ✓ test/money.test.ts > parseCents > rejects "$" as EMPTY 0ms
 ✓ test/money.test.ts > parseCents > rejects "-5" as NEGATIVE 0ms
 ✓ test/money.test.ts > parseCents > rejects "-$5" as NEGATIVE 0ms
 ✓ test/money.test.ts > parseCents > rejects "$-5" as NEGATIVE 0ms
 ✓ test/money.test.ts > parseCents > rejects "−5" as NEGATIVE 0ms
 ✓ test/money.test.ts > parseCents > rejects "($5.00)" as NEGATIVE 0ms
 ✓ test/money.test.ts > parseCents > rejects "4.555" as TOO_MANY_DECIMALS 0ms
 ✓ test/money.test.ts > parseCents > rejects "1.500" as TOO_MANY_DECIMALS 0ms
 ✓ test/money.test.ts > parseCents > rejects "4,80" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "48,00" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "4.800,00" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "1,2345" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects ",100" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "0,100" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "4 800" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "4800." as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "." as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "1e3" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "Infinity" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "NaN" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "0x10" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "+5" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "USD 5" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "$$5" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "１２" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "11111111111111111111111111111111111111111111111111111111111111111" as INVALID_FORMAT 0ms
 ✓ test/money.test.ts > parseCents > rejects "90071992547409.92" as OUT_OF_RANGE 0ms
 ✓ test/money.test.ts > parseCents > rejects "99999999999999999999" as OUT_OF_RANGE 0ms
 ✓ test/money.test.ts > parseCents > max option and throwing variant 0ms
 ✓ test/money.test.ts > parseCents > property: format / input / decimal strings round-trip 18ms
 ✓ test/money.test.ts > parseCents > property: equivalent spellings of the same amount parse identically 10ms
 ✓ test/money.test.ts > parseCents > property: never throws and only ever returns valid Cents 3ms
 ✓ test/money.test.ts > formatting > 0 0ms
 ✓ test/money.test.ts > formatting > 5 0ms
 ✓ test/money.test.ts > formatting > 480000 0ms
 ✓ test/money.test.ts > formatting > 480050 0ms
 ✓ test/money.test.ts > formatting > 123456789 0ms
 ✓ test/money.test.ts > formatting > signed values 0ms
 ✓ test/money.test.ts > formatting > property: decimal string matches bigint rendering for signed values 4ms

 Test Files  4 passed (4)
      Tests  115 passed (115)
   Start at  04:29:58
   Duration  301ms (tests 83%, import 12%, transform 3%, worker 1%)

[exit code: 0]
```
