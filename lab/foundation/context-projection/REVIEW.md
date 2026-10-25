# Review: context-projection

Reviewed 2026-10-24 against `design/00-brief.md` (section 3 core), `design/inputs/04-platform-constraints*` (part 6: prompt caching, mid-conversation `system` messages, usage) and the `spikes/privacy-canary` report.

**Verdict: merge after fixes.** The module is small, domain-agnostic, has no runtime dependencies, and its compile-time claims hold up. Fix r01-r03 before other modules start depending on the API. r04-r09 are hardening and documentation items.

## 1. Author claims re-checked

Node v24.21.0, run from the module directory with the existing `node_modules`:

```text
$ npm test
 ✓ test/untrusted.test.ts (16 tests) 3ms
 ✓ test/projection.test.ts (16 tests) 3ms
 ✓ test/budget.test.ts (14 tests) 7ms
 ✓  TS  test/projection.test-d.ts (21 tests)
 Test Files  4 passed (4)
      Tests  67 passed (67)
Type Errors  no errors
EXIT=0

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
EXIT=0
```

`tests_passed=true` and `typecheck_passed=true` are both accurate. The README "Verification" section matches what I got.

## 2. Are the compile-time guarantees real?

**Expected compile errors (probe file in a temporary directory, extending the module tsconfig).** All six were rejected by `tsc`, with readable messages:

| Probe | Result |
| --- | --- |
| `const s: UntrustedBlockText = 'raw peer text'` | TS2322, rejected |
| `projectInto<Rec, { sharedNote: string }>` where the source field is optional | TS2345 `source field types are not assignable to the target type` |
| `project('peer', rec).privateNote` when the matrix grants it only to owner | TS2339, rejected |
| `projector.keys.push(...)` | TS2339 (readonly), rejected |
| `pickExact()(['id'])` with no type arguments | TS2322 (`never`), rejected |
| `pickExact<Rec, 'id' \| 'title' \| 'privateNote'>()(['id'])` | TS2345 `key list is missing keys`, with the missing keys `"title" \| "privateNote"` named in the message |

**Mutation check.** I copied `src/` and `test/` and made two changes: duplicate detection was disabled, and `VisibleKeys` was made distributive (union role = union of fields). `tsc` then failed with `Unused '@ts-expect-error'` and an `expectTypeOf` mismatch. So the `*.test-d.ts` proofs really depend on these guards.

**Gaps that compile but should not.** See r01 and r02.

## 3. Domain neutrality, dependencies, brief alignment

- **Domain neutrality.** `src/` contains no business table, state, role or function names (I grepped for customer, provider, finance, approval, proposal, room, scope, quote and order). The tests use placeholders (`owner`/`peer`/`auditor`, `privateNote`, `amountCents`). Block ids such as `self-brief` and `shared-facts` reuse generic engine terms from the brief, and the README marks them as illustrative. Pass.
- **Dependencies.** No runtime dependencies. The two dev dependencies (`typescript` 6.0.3, `vitest` 3.2.7) are pinned, match the spikes, and are justified in the README. `@types/node` is correctly left out (`types: []`). Pass.
- **Brief section 3.1 (private delegation, no "send then hide").** Projection is server-side, copies only an allowlist, and fails closed: an unknown role throws, an empty role list means nobody, and a union role gets the intersection. The canary and Proxy tests are good. The weak points are nested objects (r02) and widened types (r01).
- **Money must not be a float.** The module never touches money. The fixture uses integer cents. Token counts and priorities are plain numbers, which is fine, but see r06.
- **Private fields must not reach templates.** There is no template renderer here. The README correctly says that framing is not a privacy control. The privacy-canary spike (INJ-17) showed that leaks through shared facts need a write-time disclosure gate. That is out of scope for this module and is worth linking from the README.
- **Platform fit.** The `UNTRUSTED_TEXT_POLICY` cached prefix, the deterministic boundary for prefix caching, and per-turn operator instructions through mid-conversation `role: "system"` all match 04-platform-constraints part 6.

## 4. Issues

### r01 (medium): widened roles or fields silently drop the type-level guarantees
Two cases compile today. First, a `roles: string[]` variable disables the compile-time unknown-role check, so `project('stranger', rec)` type-checks and only throws at runtime. Second, a `fields` object typed `FieldRoles<T, string>` (not an inline literal) makes the projected type claim that every role sees every field: `const s: string = project('peer', rec).privateNote` compiles. At runtime the field is absent (`undefined`), so the types over-promise. Runtime stays fail-closed, but compile-time safety is the module's main claim.
**Fix:** reuse the `ExactKeyList` technique. Reject `number extends Roles['length']`, and reject any field whose role list is non-literal (`string extends F[K][number]` or `number extends F[K]['length']`). Add `@ts-expect-error` tests for both.

### r02 (medium): shallow projection lets nested private fields through without any compile-time signal
`pickExact<Outer, 'id' | 'brief'>()(['id', 'brief'])` compiles, and a matrix can grant an object-valued field to a non-owner role. The whole nested object, private subfields included, is copied by reference. Convex documents will have `v.object` fields, so this is the most likely real leak path. Today it is only documented.
**Fix:** at compile time, reject granting non-primitive fields (objects and arrays of objects) to any role unless the field type is branded as already projected. Or support nested projection (`fields: { brief: { roles, project: subProjector } }`). Add a canary test with a nested secret.

### r03 (medium): `verifyUntrustedBlock` is too lax for the canary role the README gives it
- It accepts inconsistent attributes. For example, `original-chars="1" chars="5" truncated="false"` returns `ok: true`, because only `original > chars` is compared with `truncated`.
- It accepts payloads that `sanitizeUntrustedText` would never produce: zero-width characters (U+200B), Unicode tag characters (U+E0069), `\r`. A hand-built block that skipped sanitisation therefore passes the "strict parser".
- It only accepts a string that is exactly one block. There is no helper that scans an assembled context for all blocks plus stray fence fragments, yet README item 5 says it lets a canary assert that every third-party string sits in one intact block.

**Fix:** when `truncated="false"`, require `original-chars === chars`. Require `sanitizeUntrustedText(decoded).text === decoded`. Add `scanUntrustedBlocks(context)` that returns every block, every verification failure and any unmatched `<untrusted-text` / `</untrusted-text` fragment.

### r04 (low): sanitiser coverage has gaps and one undocumented lossy step
These are kept: the variation selectors supplement U+E0100-E01EF (a known "emoji smuggling" channel), U+FE00-FE0E, U+034F, the Hangul fillers U+115F/U+1160/U+3164/U+FFA0, and U+2028/U+2029. Meanwhile ZWJ and ZWNJ (inside U+200B-U+200F) are stripped. That breaks emoji ZWJ sequences (a family emoji goes from 5 code points to 3) and Persian/Indic orthography. The README mentions only NFKC as lossy.
**Fix:** strip U+E0100-E01EF and the fillers, and map U+2028/U+2029 to `\n`. Then either keep ZWJ/ZWNJ or document the loss. Add tests.

### r05 (low): a role or field named `__proto__` breaks the matrix's internal maps
`keysByRole`, `frozenFields` and the role map are plain `{}` objects. With `roles: ['__proto__', 'peer']`, `defineDisclosureMatrix` succeeds, but `keysByRole` gets an array as its prototype, the declared role has no own entry, and `project('__proto__', …)` throws `RangeError`. This fails closed but is silent at definition time. (`copyListedKeys` itself handles `__proto__` correctly.)
**Fix:** build the maps with `Object.create(null)` / `Object.defineProperty`, or reject reserved names at define time.

### r06 (low): `trimToBudget` accumulates floating-point error
Costs are subtracted one at a time from a running total. With a fractional custom estimator (0.1 and 0.2 against a budget of 0.3), it drops block `b` even though both fit. The result is `usedTokens: 0.10000000000000003`.
**Fix:** require `Number.isSafeInteger` for estimator output and `perBlockOverheadTokens`, or `Math.ceil` them, so all token arithmetic is integer.

### r07 (low): the estimator's "stays under the real limit" claim is not supported
`budget.ts` says the conservative estimate keeps a trimmed context under the real limit. In practice, high-entropy ASCII (base64, ids, hex) is estimated at about 2.9 chars per token (64 base64 chars become 22 tokens). Emoji and rare CJK can cost more than one token per code point. Per-message and role framing tokens are not counted.
**Fix:** reword this as a heuristic. Recommend a safety margin (or add a `marginRatio` option) and calibration against `count_tokens` and recorded `usage`, which are already listed in 04 part 6 and part 7.

### r08 (low): untyped escape hatches are exported from the public entry
`copyListedKeys(source, string[])` and `assertValidKeyList` are re-exported from `index.ts`. Any caller can project with an arbitrary runtime key list and skip the exactness proofs, which undoes "one reviewed place decides what leaves".
**Fix:** stop exporting them from `.`, or move them to an explicitly named `./internal` / `unsafe` export and document them that way.

### r09 (low): integration not verified, and naming not aligned with the spike
- `exports` points at raw `.ts` sources that use `.ts`-extension imports. Whether the Convex bundler and Next.js (`transpilePackages`) can consume this is not verified. The README's to-verify list covers only NFKC and lookbehind.
- The block tag is `<untrusted-text>`, while the privacy-canary spike uses `<untrusted_data>`. Design docs 07 and 10 need to pick one, so prompts and canary scanners agree.
- The README has no end-to-end example (matrix → own-brief projection → `wrapUntrusted` → `trimToBudget`). A new user has to assemble one from the separate sections.

**Fix:** add these to "Known limitations / to verify", align the tag name with the design, and add a 15-line end-to-end snippet.

## 5. What is good and should stay

- The curried `pickExact<T, K>()(keys)` with `ExactKeyList`. Error messages name the missing keys, and a 60-key record still type-checks.
- The runtime copy reads only own properties that are listed, and it is proven with a recording `Proxy`. `__proto__` stays an own data property.
- Escape-not-strip, with the length cap applied before escaping, so an entity is never cut in half. Attributes are generated by code only, and the `source` pattern blocks attribute injection.
- `trimToBudget` returns an explicit `REQUIRED_BLOCKS_EXCEED_BUDGET` instead of truncating silently. The strict-priority invariant is property-tested.
- Strict tsconfig (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`). The type proofs run both in vitest and in `tsc`.

## 6. Probe log (temporary files, removed after the review)

```text
type probes (should fail): 6/6 rejected by tsc (TS2322, TS2345 x2, TS2339 x2, TS2322)
type gaps (compiled, should not): widened roles -> unknown role accepted; non-literal fields -> peer.privateNote typed string
mutation: HasDuplicate disabled -> "Unused '@ts-expect-error'"; distributive VisibleKeys -> expectTypeOf mismatch
R1  roles ['__proto__','peer'] -> own keys ["peer"], prototype is an array, project('__proto__') throws RangeError
R2a original-chars="1" chars="5" truncated="false" -> ok: true
R2b hand-built block with U+200B in payload -> ok: true
R2c hand-built block with U+E0069 in payload -> ok: true
R3  kept: U+E0100.., U+FE00/FE01, U+2028/2029, U+034F, U+3164; ZWJ family emoji 5 -> 3 code points
R4  estimate 0.1/0.2, budget 0.3 -> dropped ["b"], usedTokens 0.10000000000000003
R5  64-char base64 -> 22 tokens; 10 emoji -> 10 tokens
R6  role named "constructor" works (own property assignment)
R8  wrapUntrusted on a 5 MB string -> 26 ms (no DoS concern)
```
