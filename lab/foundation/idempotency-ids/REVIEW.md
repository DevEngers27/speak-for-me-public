# Review: idempotency-ids

Reviewer: foundation code review agent, 2026-10-24. Scope: everything under this
directory (`src/`, `test/`, configs, README). Verdict: **merge after fixes**.

## Summary

Small, careful, dependency-free module. The author's claims hold: 109/109 tests pass,
`tsc --noEmit` is clean, and the compile-time checks are real (verified with
independent probes, see below). The golden operation ids were recomputed by the
reviewer with `node:crypto` from hand-written canonical payloads and match. The whole
suite also passes under vitest's `edge-runtime` environment (the environment the
convex-test spike uses), which is partial evidence for the README's open item about
Web Crypto in the Convex runtime. The public API names no business tables, states or
functions. Most findings are low severity; one (r01) is a documentation claim that
contradicts brief core 1 (private delegation) and must be fixed before other modules
rely on it.

## Verification performed by the reviewer

| Check | Result |
| --- | --- |
| `npm test` (node_modules already present) | `Test Files 5 passed (5)`, `Tests 109 passed (109)`, exit 0 |
| `npm run typecheck` | exit 0, no output |
| Golden ids recomputed with `node:crypto` | `demo-exec:v1:6azdt0y2…`, `demo-commit:v2:gsbfvr08…`, `demo-once:v1:1f9f6xy4…` all match `test/operation-id.test.ts` |
| Copy of `src/` + `test/` run with `environment: "edge-runtime"` (using the convex-test spike's installed `@edge-runtime/vm`, read only, via a temporary symlink outside this directory) | `Tests 109 passed (109)` |
| Dependencies | runtime: none. dev: `typescript@6.0.3`, `vitest@5.0.5`, exact pins, same as the skeleton spike, reasons stated in README |
| Domain-term grep over `src/` | only `"rm" for rooms` in a doc comment (example prefix). README "How the engine will use it" mentions rooms/execution as usage guidance, which is fine |

### Compile-time probes (`tsc` against `src/index.ts`, same strict flags)

Should fail, and does (all reported by tsc):

```ts
const commit = defineOperationKey({ kind: "demo-commit", fields: ["scopeId", "revision"] });
commit.derive({ scopeId: "s" });                          // TS2345 missing 'revision'
commit.derive({ scopeId: "s", revision: 1, extra: 2 });   // TS2353 excess property
commit.derive({ scopeId: "s", revision: undefined });     // TS2322 undefined -> JsonValue
commit.derive({ scopeId: "s", revision: new Date() });    // TS2322 Date -> JsonValue
commit.derive({ scopeId: "s", revision: 1n });            // TS2322 bigint -> JsonValue
composeKey("k", true);                                    // TS2345 boolean -> KeySegment
canonicalJson(new Map());                                 // TS2345
const maybe: { scopeId: string; revision?: number } = { scopeId: "s" };
commit.derive(maybe);                                     // TS2345 optional vs required
```

Compiles although it arguably should not (see r04):

```ts
const withExtra = { scopeId: "s", revision: 1, extra: 2 };
commit.derive(withExtra);                 // excess props only checked on fresh literals
const spec = { kind: "demo-wide", fields: ["a"] };
defineOperationKey(spec).derive({ totallyWrong: 1 });   // F widens to string
const b: string = await commit.derive(/* ... */);        // ids are plain string, no kind brand
```

And the reverse friction: a payload typed with `interface Terms { scopeId: string; priceMinor: number }`
is rejected by `canonicalJson` (TS2345, "Index signature for type 'string' is missing"),
while the same shape as a `type` alias is accepted.

### Runtime probes (vitest, outside this directory)

```text
R1 defineOperationKey({ fields: ["constructor","toString"] }).derive({})  -> OK demo-c:v1:63g3t9k9…   (no "Missing field")
R2 composeKey("demo-exec","v1", <digest of real id>) === real id          -> true; execKey.owns(composeKey("demo-exec","v1","0"*32)) -> true
R3 slugCandidate("abcdefghijkl", 123456789, 8)                             -> "abcdefghi-123456789" (19 > 8)
   truncateSlug("abcdefghij", -3) -> "abcdef";  truncateSlug("abc-def", NaN) -> ""
R4 normalizePublicId("  RM_8F3K-2Q9X 0A7B-1C4D ")                           -> "rm_8f3k2q9x0a7b1c4d" (prefix lowercased)
R5 slugify("预算 120000") -> "120000";  slugify("秘密") -> "untitled-0ztntfp"
R6 canonicalJson(0.1 + 0.2) -> "0.30000000000000004"
```

## Findings

### r01 (medium) Hashing is presented as hiding values; it is not

README "Design notes" says hashed keys "do not leak values into logs or ids". An
unsalted SHA-256 over a low-entropy tuple (a Convex id, a revision number, a budget in
minor units, a date) is reversible by enumeration once the kind and field names are
known, and they are public in source. The same applies to `canonicalDigest`
fingerprints ("what exactly was approved", README item 5) if the payload contains a
private field, to the 32-bit FNV fallback slug (`slugify("秘密")`), and to ASCII slugs,
which keep digits verbatim (`slugify("预算 120000") === "120000"`). Brief core 1 says
nothing private may reach another party except through an explicit disclosure
decision; a key or slug that ends up in a shared record, URL or log is such a channel.

Fix: remove the "do not leak" claim; add a "Privacy" section stating that key fields,
digest payloads and slug sources must contain only values already visible to every
reader of the resulting id, that hashing is not a confidentiality mechanism, and that
if a private value ever must be bound into an id it needs a keyed HMAC with a server
secret (out of scope for this module). Keep the slug note: build slugs only from text
that is already public in that context.

### r02 (low) Runtime presence check misses inherited property names

`derive` checks `record[field] === undefined`. For declared fields named like
`Object.prototype` members (`constructor`, `toString`, `valueOf`, `hasOwnProperty`,
`isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`), a missing value reads the
inherited function, passes the check, and canonical JSON then omits it: R1 derives a
key for `f: {}`. The README says "the same checks run at runtime for values that bypass
the type system", which is false for these names. The type system still catches it.

Fix: use `Object.hasOwn(record, field) && record[field] !== undefined`, or reject such
field names in `defineOperationKey`. Add a test.

### r03 (low) Hashed and readable forms can produce the same string

`composeKey(kind, "v1", <32 base32 chars>)` is byte-identical to a hashed id of that
kind, and `parseOperationId` and `owns()` accept it (R2). "Choose one per kind and never
mix" is only a README rule. If one kind is ever written both ways, or `owns()` is used
as a guard on untrusted input, a readable key can impersonate a hashed one.

Fix (any one): give the hashed form a shape `composeKey` cannot emit (e.g. reject a
first segment matching `/^v[1-9][0-9]{0,3}$/` in `composeKey`, or use a separator that
`composeKey` escapes); or return branded types (see r04) so the two cannot be compared
at compile time. Add a test.

### r04 (low) Compile-time guarantees are narrower than the README says

README: "missing, extra and `undefined` values are type errors". Verified: missing and
`undefined` always; extra only on fresh object literals. Also: a spec stored in a
non-`as const` variable widens `F` to `string` and disables checking silently; derived
ids are plain `string`, so ids of different kinds can be passed to each other's lookup;
and `interface`-declared payloads are rejected by `JsonValue`, which pushes callers to
`as unknown as` casts that silence real errors.

Fix: reword the README claim; document "declare specs inline or `as const`"; consider
`OperationKey<K extends string, F>` returning a template-literal or branded type such as
`` `${K}:v${number}:${string}` & { __op: K } ``; note the interface vs `type` caveat
(Convex `Doc`/`Infer` and `z.infer` produce aliases, so they work).

### r05 (low) `slugCandidate` can exceed `maxLength`; `truncateSlug` accepts any number

When `-${attempt}` is longer than `maxLength`, `truncateSlug` is called with a negative
limit and `Array.prototype.slice(0, negative)` keeps the head, so the result is longer
than the documented bound (R3). `truncateSlug` is exported and does not validate its
limit (negative slices from the end, `NaN` returns `""`). Unreachable with default
`maxAttempts` (100) and `maxLength >= 8`, but both functions are public.

Fix: validate `maxLength` in `truncateSlug` (safe integer >= 0); in `slugCandidate`
throw when `suffix.length >= maxLength`. Add tests.

### r06 (low) Numbers: floats accepted, Convex int64/bytes rejected without guidance

Canonical JSON follows JCS and accepts any finite float (R6). That is correct for a
generic module, but brief core 4 and the money-dates module use integer minor units;
a float sneaking into a key or approval fingerprint gives a deterministic but
surprising digest. Conversely, Convex `v.int64()` / `v.commitTs()` values are `bigint`
and `v.bytes()` is `ArrayBuffer`; both are rejected, so hashing a document containing
them throws at runtime.

Fix: README note ("put integers or strings in keys; convert int64 with `String()` and
bytes with `encodeHex` before hashing"). Optionally a `numbers: "safe-integer"` option
on `canonicalJson` / `defineOperationKey` that rejects non-integers.

### r07 (low) README and doc-comment gaps

- `normalizePublicId` doc says the prefix is returned "untouched"; it is lowercased (R4).
- README should state that this module supersedes the protocol-rules spike's
  `stableStringify` / `contentHash`: outputs are byte-identical for every value this
  module accepts, and `"sha256:" + encodeHex(await canonicalDigest(v))` reproduces
  `contentHash`. Otherwise the final repo risks two canonicalisers.
- The dedup pattern is described in prose only. A ten-line pseudo-code snippet
  (derive, `withIndex(...).unique()`, return existing or insert) would make the
  intended use unambiguous; keep table names generic.
- Record the edge-runtime result above next to the open item on Convex Web Crypto
  (still unproven on a real deployment).

## Not issues (checked)

- Base32 encoder: RFC 4648 vectors translated to Crockford; public-id slicing uses only
  real random bits (`length * 5 <= byteLength * 8` for every allowed length), so no bias.
- Canonical JSON: lone surrogates escaped (no collapse), `-0` to `0`, cycles vs shared
  references distinguished, sparse arrays and non-plain objects rejected, own
  `__proto__` keys from `JSON.parse` serialised.
- Domain separation: kind and scheme version are inside the hashed payload.
- `lib: ["ES2022"]`, `types: []`: no DOM/Node globals leak into `src/`.
- Determinism under OCC retry: derivation is pure; README correctly warns that random
  public ids are not idempotency keys.
