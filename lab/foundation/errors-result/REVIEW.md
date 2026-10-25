# Review: errors-result

Reviewer: foundation code-review agent, 2026-10-24.
Verdict: **merge_after_fixes**. The design is solid. It has no domain leakage and no runtime dependencies, and its type-level guarantees really are enforced by `tsc`. The issues below are small and local. Fix r01-r05 before other packages build on this one.

## 1. Author claims re-verified

| Claim | Result |
| --- | --- |
| `tests_passed=true` | **True.** `npm test`: 4 files, 60/60 passed, exit 0 (vitest 3.2.4, Node v24.21.0). |
| `typecheck_passed=true` | **True.** `npx tsc --noEmit`: exit 0, no diagnostics (TypeScript 6.0.3). `tsconfig.json` includes `test/`, so the type-level tests (`expectTypeOf`, `@ts-expect-error`) are checked too. |

`node_modules` was already present, so `npm install` was not needed.

## 2. Compile-time safety: negative probes

Probe file: `scratchpad/review-probes/errors-result/compile-probe.ts`. It is compiled with the module's own `tsc` and strict flags and imports `src/` and `test/fixtures.ts`. Every case below **should** fail. **All 14 produced a diagnostic**:

| # | Misuse | tsc |
| --- | --- | --- |
| P1 | `create("rate_limited", { retryAfterMs: "soon", ... })` | TS2322 |
| P2 | `create("rate_limited")` with no required data | TS2554 |
| P3 | undeclared data field | TS2353 |
| P4 | reading a `secret` field from `toClientError(...).data` | TS2339 |
| P5 | comparing a client error's `code` to an `internal` code | TS2367 |
| P6 | `defineErrors(..., { fallback: "undeclared" })` | TS2322 |
| P7 | `field.client<Date>()` | TS2344 |
| P8 / P9 | `registry.table` with a missing key / an extra key | TS2345 / TS2353 |
| P10 / P11 | standalone `exhaustiveTable` with an extra key / a missing key | TS2353 / TS2345 |
| P12 | `oneOf` value outside the list | TS2322 |
| P13 | string where `cents` is expected | TS2322 |
| P14 | unknown reason code | TS2345 |

The same file also has cases that **compile but arguably should not**. They back up r02 and r03 below:

- G1: `R.project(r, { includeRestricted: false }).params.limitMinor` is typed `number | undefined`, so it can be read.
- G2: `make(..., { overByMinor: 1.5 })` compiles. The runtime rejects it, which is acceptable.
- G3: `field.client<string>()` / `field.client<number>()` let an error carry free text or a float amount to the browser.

## 3. Runtime probes

Probe file: `scratchpad/review-probes/errors-result/runtime-probe.ts`. It is bundled with the module's esbuild and run on Node 24. Selected output:

```text
R1   {"result":{"reasonCode":"item.required_missing","params":{"itemKeys":[null,null]}},"hasUndefined":true,"isJson":false}
R1b  "THROWS Error: undefined is not a valid Convex value (present at path .params.itemKeys[0] ..."
R2   {"isJsonValue":true,"convex":"THROWS Error: Field name café has invalid character 'é' ..."}
R2b  {"isJsonValue":true,"convex":"THROWS Error: Field name a\nb has invalid character '\n' ..."}
R3   {"code":"rate_limited","message":"Too many requests. Please wait and retry.","data":{"retryAfterMs":"CANARY_TEXT"}}
R4   {"before":"fb","after":"hidden","frozenInner":false}
R5   {"code":"x","message":"x","data":{"v":480017}}
R6   {"nestedFrozen":false}
R7   {"y0050":false,"y2026":false,"y2028":true}
R9   {"isJson":true,"json":"0","convex":{"$float":"AAAAAAAAAIA="}}
R10  {"code":"internal",...,"known":false,"errorName":"TypeError"}   (message not leaked: good)
R11  {"reasonCode":"limit.exceeded","params":{},"withheld":["limitMinor","overByMinor"]}  (good)
```

Plain Node import: `node -e "import('./src/index.ts')"` fails with `ERR_MODULE_NOT_FOUND .../src/result.js`.

## 4. Issues

### errors-result-r01 (medium): sparse arrays pass `keys` validation
`reasonParams.ts:100` uses `value.every(isKey)`, and `every` skips holes. As a result, `make("...", { itemKeys: new Array(2) })` is accepted. `reasons.ts:190` (`[...v]`) then turns the holes into `undefined`, which gives a frozen reason that looks valid but is rejected by `convexToJson` and by `isJsonValue` (R1/R1b). `make` exists to catch rule-code bugs at the point of creation, and here the bug surfaces later at storage instead.
**Fix:** use an index loop with `i in value` (as `isJsonValue` already does) and add a regression test.

### errors-result-r02 (medium): `project()` does not enforce the restricted split at compile time
`PublicReasonParamsOf` is defined and tested (`reasons.ts:37`) but never used. `project()` returns `ProjectedReason` with `Partial<ReasonParamsOf>`, so a template for another party's audience can still read `params.limitMinor` with no type error (G1). At runtime the value is withheld correctly, but brief core #1 (private fields never reach templates) is only half guaranteed.
**Fix:** add overloads. `includeRestricted: false` returns params typed `PublicReasonParamsOf`, and `true` returns full params. Ideally also add a `publicTable`/template helper whose handlers receive only public params. Pin both with `expectTypeOf` / `@ts-expect-error`.

### errors-result-r03 (medium): error data fields have no runtime kind, so free text and float amounts can reach the client
`FieldSpec<T>` is phantom-only. `create()` checks presence and JSON-safety but not type. R3 shows a string arriving in a `number` client field and passing straight into the browser payload. On top of that, `field.client<string>()` and `field.client<number>()` are allowed at all (G3). This breaks the discipline that reasons get right (no free-text kind, money as safe-integer `cents`). The README's "Known gaps" mentions only the wire side.
**Fix:** give `FieldSpec` a runtime `kind` and reuse `ParamKind` (`int/count/cents/bool/date/key/keys/id/enum`). Validate it in `create()` and when re-deriving client payloads. At minimum, restrict `client` fields to non-free-text kinds. Then free-form strings stay `log`/`secret` only.

### errors-result-r04 (medium): `isJsonValue` accepts object keys that Convex rejects
`json.ts:35-62` documents the accepted set as "a strict subset of ... Convex `Value`". It isn't: keys with non-ASCII or control characters (and keys over 1024 chars) pass `isJsonValue`, but `convexToJson` throws on them (R2/R2b, `convex/values/value.js validateObjectField`). Error data containing such a nested key passes `create()`, and then `throw new ConvexError(toPayload(e))` fails at the boundary and degrades to a generic Server Error. The test named "every value isJsonValue accepts is accepted by convexToJson" only checks samples, so the name claims more than the test proves.
**Fix:** validate keys with `/^[\x20-\x7E]{0,1024}$/` (in addition to the existing `$` check). Add the counterexamples to the test, or rename the test.

### errors-result-r05 (medium): consumers can't load the package as shipped, and the README doesn't say how
`package.json` exports `./src/index.ts`, whose imports use `.js` specifiers. Plain Node 24 (type stripping) fails with `ERR_MODULE_NOT_FOUND`. Vitest, Vite and esbuild (the Convex bundler) resolve `.js`→`.ts`. Next.js needs `transpilePackages` for a TypeScript workspace package. The README says "Node 24 ... safe to import from ... Convex functions and the browser" but has no install or consumption section.
**Fix:** either add a `tsc` build to `dist/` with `exports` conditions (`types`/`import`), or switch to `.ts` specifiers plus `rewriteRelativeImportExtensions`. Then document workspace usage: the Next `transpilePackages` entry, Convex bundling, and the test and typecheck commands.

### errors-result-r06 (low): spec objects are not frozen
`defineErrors` and `defineReasonCodes` freeze only the outer map. Mutating an inner spec after definition (it takes a cast) flips `internal` to `public` in a live registry (R4). `deepFreeze` already exists in `reasons.ts`.
**Fix:** deep-freeze specs in both `define*` functions.

### errors-result-r07 (low): foreign AppErrors are read through `payloadCandidate`
For an AppError that this registry didn't create, `payloadCandidate` (`appError.ts:105`) reads its own non-enumerable `data`, secret fields included, and then picks fields using *this* registry's visibilities. R5 shows another registry's `secret` value 480017 being emitted as `client`. That needs two registries with conflicting specs, which is unlikely. Still, README design note 6 ("two registries ... do not confuse each other") is true only for `is()`.
**Fix:** in `payloadCandidate`, return `null` for `thrown instanceof AppError` (foreign means fallback), and add a test.

### errors-result-r08 (low): comments overstate what code and key patterns rule out
`json.ts:82-87` says a code "can never smuggle free text or an amount", and `reasonParams.ts:1-6` says "an amount can never hide inside prose". But `CODE_PATTERN` and `KEY_PATTERN` allow digits after the first character (`budget_120000`, `over_4800`). Separately, `ReasonIssue` for `unknown_code` echoes the untrusted identifier back, and that issue may end up in logs.
**Fix:** soften the wording ("cannot carry spaces, currency or punctuation; keys must come from catalogs") and drop `reasonCode` from `unknown_code` issues that originate in `parse`.

### errors-result-r09 (low, nits): immutability and value edge cases
- AppError `data` is frozen only one level deep, so nested arrays and objects stay mutable (R6), even though design note 11 says "immutability is enforced at runtime".
- `isIsoDate` rejects years 0000-0099 because `Date.UTC` maps them to 19xx (R7). That's harmless, but document it.
- `isJsonValue(-0)` is true, yet JSON changes it to `0` and Convex encodes it as `$float` (R9). Either reject it or normalise to `0`.

**Fix:** deep-freeze in `AppError`, and document or patch the edge cases.

## 5. Checklist

- **Domain-agnostic API:** pass. Grepping `src/` for budget/proposal/approval/room/customer/provider/finance/order/quote/scope/task/brief/price finds nothing. Fixtures say they are illustrative, and `cents` is described generically as minor units.
- **Dependencies:** pass. There are no runtime dependencies. Each dev dependency has a stated reason. `convex` is heavy but is used only to prove wire compatibility.
- **Brief core:** money as safe-integer `cents` is enforced for reasons but not for error data (r03). Static messages and non-enumerable data protect the privacy of errors well. Restricted reason params are withheld correctly at runtime but not by type (r02). Unknown thrown values never leak their message (R10).
- **Convex semantics:** the README's "throw vs return" guidance is correct (a returned `err` commits earlier writes, a throw rolls back). `ConvexError` is detected with `Symbol.for("ConvexError")`, which matches convex 1.48.
- **README:** a strong API reference, rationale and known-gaps section. What's missing is consumption and setup (r05) and corrections to the overstated claims (r04, r07, r08).
