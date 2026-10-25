# errors-result

Domain-agnostic foundation for Speak for Me: a `Result<T, E>` type, a typed
error-code registry whose wire format is a ConvexError payload, and a
`reasonCode` builder for the deterministic rules engine.

This package defines **mechanisms only**. It contains no product error codes,
no reason codes, no table names and no business states. The design docs own
those (06 rules engine, 07 permissions/privacy, 12 API); every code in
`test/fixtures.ts` is illustrative.

- Zero runtime dependencies. Pure TypeScript, ESM, Node 24, strict mode.
- Safe to import from the engine/core layer, Convex functions and the browser
  (no `convex` import at runtime).

## API

### Result

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
ok(value) / ok()            // ok() is Ok<null>, never undefined (serializable)
err(error)
isOk, isErr, map, mapErr, andThen, orElse, match
unwrapOr, unwrapOrElse, unwrap / unwrapErr   // unwrap* for tests and scripts
all([...])        // first Err, tuple-typed values
collect([...])    // every Err, in order (what a rule engine wants)
partition([...]), fromNullable, tryCatch, tryCatchAsync, isResult
```

A Result is a plain object, so `Result<JsonValue, JsonValue>` is a valid
Convex `Value` and can be returned from a query/mutation or stored.

### Error registry

```ts
import { defineErrors, errorSpecs, mergeErrorSpecs, field } from "@speak-for-me/errors-result";

const engineErrors = errorSpecs({
  internal: { severity: "error", retryable: false, exposure: "public",
              message: "Something went wrong. Please try again." },
  rate_limited: { severity: "warning", retryable: true, exposure: "public",
                  message: "Too many requests. Please wait and retry.",
                  data: { retryAfterMs: field.client<number>(), bucket: field.log<string>() } },
  dependency_unavailable: { severity: "error", retryable: true, exposure: "internal",
                  message: "A required service is unavailable.",
                  data: { attempt: field.log<number>(), detail: field.secret<string>() } },
});
export const errors = defineErrors(mergeErrorSpecs(engineErrors, scenarioErrors), { fallback: "internal" });
```

Each code declares:

| Property | Meaning |
| --- | --- |
| `severity` | `info` (caller-caused) / `warning` (expected, watch it) / `error` (unexpected) / `critical` (invariant broken) |
| `retryable` | Whether retrying the same request can succeed. Surfaced to the client. |
| `exposure` | `public`: code + message + `client` fields may reach the browser. `internal`: the browser only ever sees the fallback code. |
| `message` | Static, user-safe text. Never interpolated. |
| `data` | Every field classified exactly once: `client` (browser + logs), `log` (logs only), `secret` (in-process only). |

Registry methods:

| Method | Use |
| --- | --- |
| `create(code, data?, { cause? })` | Typed `AppError`. Data is required iff the code declares fields; undeclared, missing or non-JSON fields throw `TypeError` (a bug). |
| `fail(code, data?)` | `err(create(...))` for Result-returning code. |
| `is(e, code?)` | Type guard; true only for errors built from this registry's spec objects. |
| `toPayload(thrown)` | Server boundary: `throw new ConvexError(errors.toPayload(e))`. Public code -> `{ code, message, data: clientFields }`; anything else -> fallback. |
| `toClientError(thrown)` | Client mapper. Accepts a ConvexError, its `.data`, an AppError or anything else. Returns `{ code, message, data, retryable, severity, isFallback }`, discriminated by `code`; internal codes are not in the type. |
| `toLogRecord(thrown)` | `{ code, severity, retryable, exposure, data: client+log fields, known, errorName? }`. Never an unknown error's message. |
| `match(e, handlers)` / `table(entries)` | Exhaustive dispatch / lookup (compile time and runtime). |
| `describe()` | JSON catalog of codes and field visibilities (docs, review). |

### Reason codes

```ts
import { defineReasonCodes, reasonSpecs, param } from "@speak-for-me/errors-result";

const reasons = defineReasonCodes(reasonSpecs({
  "limit.exceeded": { params: { overByMinor: param.restricted(param.cents()) }, meta: { blocking: true } },
  "item.unknown":   { params: { itemKey: param.key() }, meta: { blocking: true } },
  "mode.unsupported": { params: { mode: param.oneOf(["fast", "safe"]) } },
}));

const r = reasons.make("item.unknown", { itemKey: "EXPORT" });
// { reasonCode: "item.unknown", params: { itemKey: "EXPORT" } }  (frozen, canonical key order)
```

Param kinds: `int`, `count` (>= 0), `cents` (safe integer, minor units, may be
negative), `bool`, `date` (real calendar `YYYY-MM-DD`), `key` (letter first,
`[A-Za-z0-9_.:-]`, <= 64), `keys` (<= 256 keys), `id` (`[A-Za-z0-9_-]`, <= 128),
`oneOf([...])` (key-shaped literals). **There is no free-text kind.**
`param.restricted(spec)` marks a param that `project()` withholds.

| Method | Use |
| --- | --- |
| `make(code, params?)` | Build a reason; throws `ReasonCodeUsageError` (names only, never values). |
| `tryMake` | Same, as a Result. |
| `parse(unknown)` / `parseMany(unknown)` | Validate storage/wire data; `parseMany` reports every issue with its index. |
| `project(reason, { includeRestricted })` | Audience projection: `{ reasonCode, params, withheld: [names] }`. The caller decides who may see restricted params (07 matrix). |
| `restrictedParams(code)`, `meta(code)` | Introspection; `meta` is typed per code. |
| `match`, `table`, `describe` | Exhaustive dispatch, total lookup tables (text templates), JSON catalog. |

### Helpers

`assertNever(x, context?)`, `exhaustiveTable(keys, table)`, `isJsonValue`,
`isJsonObject`, `isValidCode`, `isIsoDate`.

## Design notes

1. **Wire shape is exactly `{ code, message, data }`.** It is what the reviews
   asked for (`ConvexError({ code })`, F06.7/F07.8) and it survives
   `convexToJson` -> `jsonToConvex` unchanged (tested against real
   `convex/values` 1.48.0). `ErrorPayload` is a type alias, not an interface,
   so it is assignable to Convex `Value` without casts.
2. **Messages are static.** A message never contains interpolated values, so
   it can be shown, logged and bundled into the client without review.
   Anything dynamic is a classified data field. Rejected: message templates
   with placeholders (one careless `{amount}` leaks a private budget).
3. **Three-level field classification, enforced exhaustively.** Every field is
   `client`, `log` or `secret`; adding a field without a visibility is a type
   error. `internal` codes may not have `client` fields (definition-time
   check). Rejected: a single `safeToShow` boolean, which cannot express
   "fine for logs, never for browsers" (ids, attempt counts).
4. **The client mapper re-derives, it does not trust.** For wire payloads the
   message comes from the local registry and only declared `client` fields
   are kept; unknown codes, internal codes, malformed payloads, plain
   `Error`s (including production's hidden "Server Error") and strings all
   become the fallback. A missing declared client field also falls back, so
   the `ClientError` type is never a lie about required fields.
5. **AppError hides its data.** `data` is non-enumerable and `toJSON()` returns
   the log record, so `JSON.stringify(e)` and `util.inspect(e)` do not leak
   `secret` fields (canary test). `message` is the static text, which matters
   because dev deployments forward non-ConvexError messages to clients.
   Limitation: Node prints `cause`; log with `toLogRecord`.
6. **Registries are composable and scoped.** `mergeErrorSpecs` /
   `mergeReasonSpecs` throw on duplicate codes (engine + scenario plug-in);
   `is()` checks spec identity so two registries with a same-named code do
   not confuse each other.
7. **Reason params carry no free text.** Only identifiers, integers, booleans,
   ISO dates and enum members. Keys must start with a letter and cannot
   contain spaces or currency, so `"over by $4,800"` and `"4800"` are rejected;
   amounts must be `cents`. Enum values are validated at definition time.
8. **Restricted params, not restricted codes.** The protocol-rules spike marked
   whole codes private (`PRIVATE_PARAM_CODES`). Per-param marking lets the
   code itself stay visible to everyone (the reviewed "minimal disclosure":
   others learn *that* a check failed) while amounts and private dates are
   withheld. `withheld` lists names, never values.
9. **Canonical serialization.** `make`/`parse` rebuild params in declaration
   order and freeze them, so equal reasons stringify identically (safe input
   for content hashes) and cannot be mutated after validation.
10. **`restricted` is a wrapper, not an option.** A generic
    `param.cents({ restricted: true })` was tried first: inside a `const`
    registry literal TypeScript widened `true` to `boolean`, silently turning
    every restricted param into "neither". `param.restricted(spec)` has a fixed
    return type; a test pins the literal.
11. **Mutable array types, frozen values.** `JsonArray` and `keys` are typed
    as mutable arrays because Convex `Value` uses `Value[]` and readonly
    arrays are not assignable to it; immutability is enforced at runtime.
12. **No codes shipped.** Even generic codes (`internal`, `not_found`) are left
    to the API design: naming convention (`UPPER_SNAKE` in the reviews,
    `domain.lower_snake` in the spike) is still open; `CODE_PATTERN` accepts
    both and rejects anything with spaces or punctuation.

## How the engine will use it

- **Rule checks** (pure functions in the engine/scenario packages) return
  `Result<T, Reason[]>` or a `Reason[]` built with `reasons.make(...)`, and use
  `collect` to report every failing check instead of the first.
  Scenario plug-ins contribute their own reason specs, merged with the
  engine's via `mergeReasonSpecs`; a duplicate code fails at startup.
- **Storage**: reasons are plain Convex values; persist them as-is and read
  them back through `reasons.parseMany` (schema drift surfaces as issues, not
  as `undefined` at render time). A Convex validator for the reason union can
  be generated from `reasons.describe()` (not built here).
- **Rendering per audience**: the query layer calls
  `reasons.project(reason, { includeRestricted: viewerMaySee })`, with the
  decision coming from the 07 disclosure matrix; text comes from
  `reasons.table({...})` templates, which must cover every code.
- **Function boundary** (app layer, not this package):

  ```ts
  import { ConvexError } from "convex/values";
  export function toClientThrow(e: unknown): never {
    console.error(JSON.stringify(errors.toLogRecord(e)));   // no briefs, no raw text
    throw new ConvexError(errors.toPayload(e));
  }
  ```

  The browser calls `errors.toClientError(caught)` and branches on `code`,
  `retryable` and `isFallback`.
- **Throw vs return**: a throwing mutation is rolled back by Convex; a
  mutation that *returns* `err(...)` commits whatever it already wrote. Use
  `fail()` / Result returns only for "rejected, nothing written" outcomes and
  throw an `AppError` once anything has been written.
- **Agent runtime**: model-output validation failures map to registry codes
  (`log` fields such as attempt numbers and token counts, never raw model text
  or prompts) and to `retryable` for the retry policy.

## Dependencies

Runtime: none.

| devDependency | Version | Why |
| --- | --- | --- |
| `typescript` | 6.0.3 | `tsc --noEmit` typecheck; same version as the skeleton and protocol-rules spikes. |
| `vitest` | 3.2.4 | Test runner with `expectTypeOf` for type-level tests; same as the spikes. |
| `@types/node` | 24.3.0 | Node 24 types (`node:util` in the canary test, `Error` `cause`). |
| `convex` | 1.48.0 | Tests only: real `ConvexError`, `convexToJson`, `jsonToConvex` and the `Value` type prove wire compatibility. Never imported from `src/`. |

## Known gaps

- Client field *types* are phantom: on the wire only presence and JSON-safety
  are checked, not that `retryAfterMs` is a number. Version skew between a
  newer backend and an older client degrades to the fallback for unknown
  codes, but a changed field type would pass through.
- No Convex validator generator for reason unions (`describe()` provides the
  input); no audience-aware projection for error `client` fields (errors
  should not carry audience-dependent data; use reasons for that).
- Whether Convex throws any retryable system error *inside* a mutation handler
  (so that a catch-all boundary wrapper would suppress a retry) is not
  verified; OCC conflicts are detected at commit, outside the handler.
- `cause` is printed by Node's `util.inspect`.
- No registry for i18n of messages; messages are single-language static text.

## Verification

Run on 2026-10-24T11:35Z, Node v24.21.0, npm 11.19.0, TypeScript 6.0.3.

Type-level tests (`expectTypeOf`, `// @ts-expect-error` on missing handlers,
incomplete tables, wrong param kinds, unknown codes) are compiled by
`tsc --noEmit` because `tsconfig.json` includes `test/`; an unused
`@ts-expect-error` would fail the typecheck.

### `npm test -- --reporter=verbose` (exit 0)

```text

> @speak-for-me/errors-result@0.1.0 test
> vitest run --reporter=verbose


 RUN  v3.2.4 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/errors-result

 ✓ test/result.test.ts > Result basics > has a plain, serializable shape 1ms
 ✓ test/result.test.ts > Result basics > narrows with isOk / isErr and the ok discriminant 0ms
 ✓ test/result.test.ts > Result basics > maps and chains 0ms
 ✓ test/result.test.ts > Result basics > unwrap throws a fixed message and keeps the error only as cause 0ms
 ✓ test/result.test.ts > combinators > all short-circuits on the first error and preserves tuple types 0ms
 ✓ test/result.test.ts > combinators > collect returns every error in order 0ms
 ✓ test/result.test.ts > combinators > fromNullable and tryCatch 0ms
 ✓ test/result.test.ts > combinators > isResult recognises results after a serialization round trip 0ms
 ✓ test/convex-compat.test.ts > ConvexError compatibility > a server payload round-trips into the same client error 1ms
 ✓ test/convex-compat.test.ts > ConvexError compatibility > the ConvexError message (what Convex logs and forwards) carries no secrets 0ms
 ✓ test/convex-compat.test.ts > ConvexError compatibility > ConvexErrors not built by the registry map to the fallback or are re-derived 0ms
 ✓ test/convex-compat.test.ts > ConvexError compatibility > errors thrown from a nested function (action -> runMutation) re-map cleanly 0ms
 ✓ test/convex-compat.test.ts > ConvexError compatibility > generic Errors (what production Convex hides as 'Server Error') become the fallback 0ms
 ✓ test/convex-compat.test.ts > Convex Value compatibility of reasons and results > payloads, client errors and reasons are assignable to Convex Value (compile time) 0ms
 ✓ test/convex-compat.test.ts > Convex Value compatibility of reasons and results > reasons and Results of reasons survive convexToJson / jsonToConvex 0ms
 ✓ test/convex-compat.test.ts > Convex Value compatibility of reasons and results > every value isJsonValue accepts is accepted by convexToJson 0ms
 ✓ test/convex-compat.test.ts > Convex Value compatibility of reasons and results > isJsonValue is stricter than Convex where Convex would change the value 0ms
 ✓ test/reasons.test.ts > make > builds typed, frozen, plain reasons 1ms
 ✓ test/reasons.test.ts > make > serializes canonically regardless of input key order 0ms
 ✓ test/reasons.test.ts > make > rejects bad params at compile time 0ms
 ✓ test/reasons.test.ts > make > runtime rejects unsafe integer without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects fractional cents without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects negative count without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects impossible date without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects non-ISO date without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects prose in a key without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects digits-first key without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects prose in keys without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects too many keys without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects bad id without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects string bool without echoing the value 0ms
 ✓ test/reasons.test.ts > make > runtime rejects extra param without echoing the value 0ms
 ✓ test/reasons.test.ts > make > accepts negative cents deltas and boundary values 0ms
 ✓ test/reasons.test.ts > parse (untrusted input) > round-trips through JSON 0ms
 ✓ test/reasons.test.ts > parse (untrusted input) > reports structured issues without values 0ms
 ✓ test/reasons.test.ts > parse (untrusted input) > parseMany returns every issue with its index 0ms
 ✓ test/reasons.test.ts > audience projection > withholds restricted params unless allowed 0ms
 ✓ test/reasons.test.ts > audience projection > keeps the restricted flag as a literal type inside a registry 0ms
 ✓ test/reasons.test.ts > audience projection > exposes typed meta 0ms
 ✓ test/reasons.test.ts > exhaustiveness > switch + assertNever covers every code 0ms
 ✓ test/reasons.test.ts > exhaustiveness > match gives typed params per code and requires all handlers 0ms
 ✓ test/reasons.test.ts > exhaustiveness > table must be total; describe covers every code and is JSON-safe 0ms
 ✓ test/reasons.test.ts > definition-time validation > rejects codes, params and enums that could carry free text 0ms
 ✓ test/errors.test.ts > definition-time validation > rejects malformed registries 1ms
 ✓ test/errors.test.ts > definition-time validation > refuses to merge groups that redefine a code 0ms
 ✓ test/errors.test.ts > create / fail / is > creates typed AppErrors with a static message 0ms
 ✓ test/errors.test.ts > create / fail / is > enforces data at compile time 0ms
 ✓ test/errors.test.ts > create / fail / is > enforces data at runtime (undeclared, missing, non-JSON) 0ms
 ✓ test/errors.test.ts > create / fail / is > fail returns an Err; is() narrows and is registry-scoped 0ms
 ✓ test/errors.test.ts > create / fail / is > keeps the cause for debugging without serializing it 2ms
 ✓ test/errors.test.ts > toPayload (server boundary, ConvexError data) > public code: static message + client fields only 0ms
 ✓ test/errors.test.ts > toPayload (server boundary, ConvexError data) > internal codes, foreign errors and garbage all become the fallback 0ms
 ✓ test/errors.test.ts > toPayload (server boundary, ConvexError data) > re-derives message and fields from the registry for wire payloads 0ms
 ✓ test/errors.test.ts > toClientError (client-side mapper) > maps known public errors with flags and narrows data by code 0ms
 ✓ test/errors.test.ts > toClientError (client-side mapper) > never offers internal codes to the UI type 0ms
 ✓ test/errors.test.ts > logging and the privacy canary > log records keep client + log fields and drop secrets 0ms
 ✓ test/errors.test.ts > logging and the privacy canary > secret fields never appear in any serialized or printed form 0ms
 ✓ test/errors.test.ts > exhaustiveness > match requires a handler for every code 0ms
 ✓ test/errors.test.ts > exhaustiveness > table must cover every code, at compile time and runtime 0ms
 ✓ test/errors.test.ts > exhaustiveness > describe is a JSON-safe catalog with field visibilities 0ms

 Test Files  4 passed (4)
      Tests  60 passed (60)
   Start at  04:35:30
   Duration  221ms (transform 106ms, setup 0ms, collect 252ms, tests 17ms, environment 0ms, prepare 132ms)

```

### `npm run typecheck` (exit 0, no diagnostics)

```text

> @speak-for-me/errors-result@0.1.0 typecheck
> tsc --noEmit

```
