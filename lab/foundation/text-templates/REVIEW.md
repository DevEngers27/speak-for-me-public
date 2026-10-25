# Review: @speak-for-me/text-templates

Reviewer run: 2026-10-24, Node v24.21.0, same `node_modules` (typescript 6.0.3, @types/node 24.19.2).
Probes live outside the module in `scratchpad/review-probes/text-templates/` (nothing in the module was changed except adding this file).

**Verdict: merge_after_fixes.** The core design is sound and the author's claims hold: 34/34 tests pass,
`tsc` exits 0, and the compile-time exactness really works (also for non-literal objects). Two real
guarantee breaks (r01, r02) and one integration blocker against the planned Convex tsconfig (r03) are
small fixes; the exported domain examples (r04) should move out of the public surface.

## Author claims re-checked

| Claim | Result |
| --- | --- |
| `npm test` passes | Yes: tests 34, pass 34, fail 0, exit 0 |
| `npm run typecheck` passes | Yes: exit 0 |
| Misuse fails to compile | Yes. Without `@ts-expect-error`, tsc reports TS2345 for a non-literal row with `capCents`, TS2345 for a variable whose type has optional `capCents?`, TS2345 for a missing slot, TS2322 for a free-text reason code, TS2322 `"ERROR: placeholder \"{amout}\" is not a declared slot"` for a typo |
| Amounts never use floats | Yes. `Number.isSafeInteger` gate; 1.5, 0.1+0.2, NaN, Infinity rejected; BigInt formatting correct up to +/-MAX_SAFE_INTEGER; -0 normalised |
| Dates are real calendar dates | Yes. 2024-02-29 ok, 2100-02-29 rejected, full-width digits rejected |
| Errors never echo values | Yes for values; unknown field *names* are echoed only if identifier-like (acceptable) |
| Domain-agnostic API | Core `src/*.ts`: yes (only comments mention budgets/cents). `src/examples/negotiation.ts` is domain vocabulary and is a public export (r04) |
| Dependencies minimal | Yes. Zero runtime deps; dev deps pinned exactly and justified; `node:test` instead of a framework |
| "18 compile-time proofs" | 17 `@ts-expect-error` directives; the 18th grep hit is the explanatory comment (r11) |

## Issues

### text-templates-r01 (medium) Token pattern with the `m` flag loses whole-value anchoring
`slot.token` refuses `g`/`y` but copies other flags into `^(?:src)$`. With `m`, `^`/`$` match at line
breaks, so any value whose first line matches passes. Probe: `slot.token({ pattern: /[A-Z]+/m })` accepted
`'LOGIN\nprivate cap is $4,800 CANARY'` and rendered `key=LOGIN�private cap is $4,800 CANARY`.
This breaks the README promise "pattern matched against the whole value", and token is the slot the
examples rely on to keep free text out. Location: `src/slots.ts:119-123`.
Fix: also refuse `m` (or check `exec` result `index === 0 && [0].length === value.length`); add a test.

### text-templates-r02 (medium) Fragments are not tamper-proof after validation
`Fragment` is exported as a value, `Fragment.parts()` is a public static (marked only `@internal` in a
comment) and returns the live, unfrozen canonical `Map`. Probe: after `fragment(clause, { items: ['EXPORT'] })`,
`Fragment.parts(f).canonical.set('items', { kind: 'string', value: 'cap is $4,800 (CANARY-FIN-7731)' })`
made `render(outer, { d: f })` return `summary; cap is $4,800 (CANARY-FIN-7731) deferred` with no
validation. README calls fragments "unforgeable" snapshots. Location: `src/template.ts:178-200`,
`src/index.ts:24`. Fix: keep `{template, canonical}` in a module-private `WeakMap<Fragment, ...>`, export
`Fragment` as a type only plus an `isFragment()` function, freeze the stored structure; add a test.

### text-templates-r03 (medium) Does not typecheck under the planned Convex tsconfig
The package ships raw `.ts` with `.ts` relative specifiers and calls `String.prototype.isWellFormed`
(lib ES2024). A consumer using the tsconfig that `convex codegen --init` produced in
`spikes/skeleton/convex/tsconfig.json` (`lib: ["ES2023","dom"]`, no `allowImportingTsExtensions`) fails:
TS2550 `isWellFormed` at `src/slots.ts:212` plus TS5097 on every internal import (10 in package files).
With `lib: ES2024` + `allowImportingTsExtensions: true` it passes. Runtime availability of `isWellFormed`
in the Convex isolate is unverified (待验证).
Fix: replace `isWellFormed()` with `/[\uD800-\uDFFF]/u.test(value)` (with `u`, paired surrogates are one
code point, so only lone ones match; verified); add a "Consuming" README section stating the tsconfig
requirement, or add a build that emits `.js` + `.d.ts` (`rewriteRelativeImportExtensions`).

### text-templates-r04 (medium) Domain vocabulary is part of the public package surface
`package.json` exports `./examples/negotiation`, which defines roles (`customer/provider/finance`),
reason codes (`OVER_BUDGET`, ...), ids `example.negotiation.*`, "change order", and the wording
"exceeds the finance limit" (itself an undecided disclosure decision: it tells the room the cap is below
the proposal). The file is labelled illustrative, but an exported subpath invites imports and turns
placeholders into a de facto contract, against the rule not to invent business names before the
design is final. `src/template.ts:85` doc comment also uses `negotiation.proposal_summary`.
Fix: move to `test/fixtures/`, drop the `exports` entry, use neutral ids (`example.*`) in doc comments.

### text-templates-r05 (low) Several invisible characters pass the text slot and the plain-text encoder
Accepted by `slot.text()` in probes: U+00AD, U+180E, U+2060, U+FE0F, U+FFF9, U+3164 and tag characters
U+E0001..E007F (the last are a known invisible-instruction vector, and README lists model prompts as a
sink). Location: `src/encoders.ts:16-29`. Fix:
`/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u` (verified: catches all of the above, not
ASCII/CJK/emoji). Examples have no text slot, hence low.

### text-templates-r06 (low) Compile-time guarantees end where the template is not statically known
All of these compile (verified): `render(t, { anything: 'goes', capCents: 1 })` with `t: AnyTemplate`
from a registry, which is exactly the planned "render stored `{type, payload}` per viewer" path;
`render(tpl, row as ValuesOf<typeof tpl>)`; and `amount: capFromPrivateBrief` in any unbranded
`slot.amount()`. Runtime still enforces the field set, but nothing checks value provenance unless a
brand is used, and the examples do not use one. README's "tests show capCents ... are rejected" proves
name filtering only. Fix: a short "What types do not catch" README section; brand the example amount
slots; optionally a typed registry helper whose stored-payload path is explicitly `unknown` -> runtime.

### text-templates-r07 (low) `Placeholders<>` hits TS2589 at 48 placeholders
Non-tail-recursive (`K | Placeholders<R>`): 45 ok, 48 gives "Type instantiation is excessively deep".
Location: `src/template.ts:28`. Fix: accumulator form (tail-recursive) or document the limit.

### text-templates-r08 (low) Numeric-like enum keys type the slot as `never`
`slot.enum({ 1: 'One' })` gives `EnumSlot<never>` (`keyof L & string`), so `'1'` fails to compile while
runtime accepts it. Location: `src/slots.ts:127`. Fix: use `` `${keyof L & (string | number)}` `` or refuse
numeric-like keys at definition.

### text-templates-r09 (low) List bounds can be bypassed by a Proxy array
`value.length` is re-read in the loop after the bounds check; a Proxy reporting length 2 then 5 rendered
5 items in a `maxItems: 2` slot. Location: `src/slots.ts:255-264`. Fix: read `length` once into a local.

### text-templates-r10 (low) `htmlEncoder` leaves literal template text raw
`'R&D <b>{a}</b>'` renders as `R&D <b>1</b>` under `htmlEncoder`. Templates are plain text by contract,
so literal `&`/`<` produce malformed HTML. Fix: give `Encoder` an `encodeLiteral` (identity for plain
text, entity escape for HTML) applied once per renderer, or refuse `& < > " '` in literal text.

### text-templates-r11 (low) README accuracy and consumer guidance
Proof count is 17 not 18; no section on how a Next.js/Convex package consumes raw `.ts` exports (see r03);
the escaping and branding limits (r06, r10) are not stated. Otherwise the README is sufficient: the API
table, design notes and the runnable example (verified output matches) let another engineer use it.

## Consistency with the brief's core

- Integer minor units only, BigInt formatting, injected formatters: consistent with core 4.
- Exact field sets at compile and run time, enum vocabularies, no template logic: good support for core 1
  (only allowlisted fields reach room-visible text). r01/r02 are the holes in that support.
- Deterministic rendering (clock/random/locale stubbed in tests): supports core 6 (re-render from stored payload).
- No model calls, no secrets, no I/O.

## Verification (reviewer rerun)

```text
$ npm test
ℹ tests 34
ℹ suites 8
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 66.640083
npm test exit=0

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
typecheck exit=0

$ tsc on review-probes/strict (misuse without @ts-expect-error)
compile-probe.ts(8,30):  TS2345 non-literal row with capCents rejected
compile-probe.ts(10,104): TS2322 '"cap $4,800"' not assignable to reason enum
compile-probe.ts(12,30): TS2345 missing deliveryDate
compile-probe.ts(15,30): TS2345 optional capCents? rejected
compile-probe.ts(17,66): TS2322 "ERROR: placeholder \"{amout}\" is not a declared slot"
compile-probe.ts(31,21): TS2322 numeric enum key -> never (r08)
(AnyTemplate dispatch, cast to ValuesOf, unbranded private amount: no error, r06)

$ tsc on review-probes/consumer-convex (lib ES2023, no allowImportingTsExtensions)
src/slots.ts(212,18): TS2550 'isWellFormed' does not exist on type 'string'
src/*.ts: TS5097 x10 (".ts" import paths)
with lib ES2024 + allowImportingTsExtensions: exit 0
```
