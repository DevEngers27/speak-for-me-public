# idempotency-ids

Foundation module for Speak for Me: deterministic operation ids (idempotency keys),
canonical JSON, stable slugs and short random public ids. Pure TypeScript, no runtime
dependencies, no domain knowledge: it names no tables, states or business functions.
It is meant to live under `core/` (pure TS, no framework imports) in the new repository.

## Why

The core requires execution to be idempotent and atomic: double clicks, client
reconnect resends, OCC retries and concurrent duplicates must not produce duplicate
records. Convex has no unique indexes, so dedup is "derive a key on the server, look
it up through an index, insert only on miss" inside one mutation. That only works if
the key is a pure function of the logical operation. This module provides that
function, plus the other id-shaped utilities that need the same discipline
(canonical serialisation for hashing, stable slugs, unguessable public handles).

## API

All exports come from `src/index.ts`.

### Canonical JSON (`src/canonical-json.ts`)

| Export | Description |
| --- | --- |
| `canonicalJson(value, { maxDepth? })` | One exact string per JSON value: keys sorted by UTF-16 code units, no whitespace, numbers/strings as `JSON.stringify`. Agrees with RFC 8785 (JCS) on every accepted value. |
| `canonicalEquals(a, b)` | Compare canonical forms. |
| `CanonicalJsonError` | Thrown with a `path` such as `$.terms[2]` for values without a canonical form. |
| `JsonValue` (+ `JsonPrimitive`, `JsonArray`, `JsonObject`) | Accepted input types. |

Rejected (instead of silently coerced like `JSON.stringify`): NaN/Infinity, bigint,
functions, symbols, `undefined` as a value or array element, sparse arrays,
symbol keys, non-plain objects (Date, Map, Set, class instances, typed arrays), cycles,
nesting deeper than `maxDepth` (default 64). Object properties whose value is
`undefined` are omitted, matching JSON.stringify and Convex. Strings are not
Unicode-normalised: NFC and NFD forms are different values.

### Hashing and encodings (`src/hash.ts`, `src/encoding.ts`, `src/runtime.ts`)

| Export | Description |
| --- | --- |
| `sha256(data, { sha256? })` / `sha256Hex` | SHA-256 over bytes or UTF-8 text via Web Crypto `crypto.subtle.digest`; implementation injectable. |
| `canonicalDigest(value, opts?)` | `sha256(canonicalJson(value))`. |
| `encodeBase32(bytes)` / `BASE32_ALPHABET` | Unpadded lowercase Crockford base32 (`0-9a-z` minus `i l o u`). |
| `encodeHex(bytes)` | Lowercase hex. |
| `webCryptoSha256`, `webCryptoRandomBytes`, `utf8Encode`, `Sha256Fn`, `RandomBytesFn` | Runtime adapters; the package compiles against `lib: ["ES2022"]` with no DOM or Node types, so these are the only doors to platform globals. |

### Operation ids (`src/operation-id.ts`)

```ts
const key = defineOperationKey({ kind: "demo-exec", schemeVersion: 1, fields: ["targetId"] });
await key.derive({ targetId: "t1" }); // "demo-exec:v1:6azdt0y2w2c7jrzjj3p0j2fy2ep7669s"
key.owns(id);                          // prefix + digest shape check
parseOperationId(id);                  // { kind, schemeVersion, digest } | null

composeKey("exec", someId);            // "exec:<someId>"  (readable form)
parseComposedKey("exec:a%3Ab");        // { kind: "exec", segments: ["a:b"] }
```

- **Hashed form** `<kind>:v<scheme>:<digest>`: digest = first 160 bits of
  SHA-256(canonicalJson(`{ k: kind, v: schemeVersion, f: values }`)), base32 (32 chars).
  Kind and scheme version are inside the hashed payload (domain separation), so two
  kinds with identical fields never share a digest.
- **Typed tuples**: `fields` is a `const` type parameter, so `derive` requires exactly
  those properties at compile time (missing, extra and `undefined` values are type
  errors; see the `@ts-expect-error` tests). The same checks run at runtime for
  values that bypass the type system. Field values are any `JsonValue`; `null` is a
  value, a missing field is an error.
- **Readable form** `composeKey(kind, ...segments)`: `%` and `:` inside segments are
  percent-escaped, so the mapping is injective. Integers are written in decimal, so
  `1` and `"1"` give the same key: use one type per position. Convex document ids
  contain neither character, so `composeKey("exec", id) === "exec:" + id`.
- Kinds match `^[a-z][a-z0-9-]{0,39}$`; field names `^[A-Za-z][A-Za-z0-9_]{0,63}$`;
  `schemeVersion` is an integer in `[1, 9999]`. Specs are validated when defined, so a
  bad spec fails at module load rather than at the first write.

### Slugs (`src/slug.ts`)

| Export | Description |
| --- | --- |
| `slugify(input, { maxLength?, script?, fallbackPrefix? })` | `script: "ascii"` (default) gives `[a-z0-9-]`; `"unicode"` keeps letters/marks/digits of all scripts. |
| `truncateSlug(slug, max)` | Code-point-aware truncation, prefers the last hyphen if it keeps at least half the budget. |
| `isAsciiSlug(value, max?)` | Shape check. |
| `slugCandidate(base, attempt, max?)` / `uniqueSlug(base, isTaken, opts?)` | `base`, `base-2`, `base-3`, ... always within `maxLength`; `isTaken` may be async. |

ASCII pipeline: lowercase, NFKD, drop combining marks, transliterate letters without
decompositions (ß ss, æ ae, œ oe, ø o, đ/ð d, ł l, þ th, ı i, ...), drop apostrophes,
collapse every other run to one hyphen, trim, truncate. When nothing ASCII remains
(CJK, Cyrillic, emoji, punctuation-only, empty) the result is
`<fallbackPrefix>-<7-char FNV-1a base36 of the NFC input>`: stable and distinct per
input instead of every non-Latin title collapsing to the same slug. `maxLength` is in
`[8, 256]` code points (default 64). Output is idempotent: `slugify(slugify(x)) === slugify(x)`.

### Public ids (`src/public-id.ts`)

| Export | Description |
| --- | --- |
| `createPublicId({ prefix?, length?, randomBytes? })` | `rm_8f3k2q9x0a7b1c4d`-style ids; default 16 base32 chars = 80 bits. |
| `isPublicId(value, { prefix?, length? })` | Strict canonical (lowercase) shape check. |
| `normalizePublicId(value)` | For human-typed input: trim, lowercase, drop spaces/hyphens, Crockford aliases (i, l to 1; o to 0). |

Characters come from slicing the base32 encoding of `ceil(5 * length / 8)` random
bytes, so each character carries exactly 5 uniform bits (no modulo bias). At 80 bits
the collision probability is about 4e-7 after 1e9 ids. Length range `[10, 64]`;
prefix `^[a-z][a-z0-9]{0,11}$`.

## Design notes

- **Server-derived keys, never client-supplied.** A client-generated uuid per click
  defeats dedup (two clicks, two uuids). Keys are derived from ids the server
  already trusts, inside the mutation that writes.
- **Hashed vs readable.** Both are deterministic. Readable keys are synchronous and
  self-describing in logs; hashed keys bound the length of long or free-form tuples
  and do not leak values into logs or ids. Choose one per kind and never mix.
- **Scheme version is a migration lever.** Changing kind, fields or `schemeVersion`
  changes every key of that kind, so dedup against rows written under the old scheme
  stops working. Golden-value tests pin the format; they were computed independently
  with `node:crypto` over hand-written canonical payloads.
- **160-bit truncation.** Birthday bound around 2^80: collisions are not a practical
  concern for idempotency keys, and 20 bytes encode to exactly 32 base32 characters.
- **Sets are the caller's job.** Arrays are ordered; sort set-like values before
  deriving. Strings are compared by code units; normalise user text first if two
  spellings must mean the same operation.
- **Randomness is not idempotency.** Public ids are identity handles only. Inside a
  Convex mutation an OCC retry re-runs the handler, so a generated id is regenerated
  and only the committed one survives; that is fine for identity, wrong for dedup.
- **Determinism of slugs** depends on the runtime's Unicode tables (normalisation,
  `\p{...}`). Persist a slug once created instead of recomputing it from the title.
- **Dependencies**: none at runtime. Dev only: `typescript@6.0.3` (typecheck; same
  version as the skeleton spike) and `vitest@5.0.5` (test runner; same as the skeleton).

## How the engine will use it

1. Each side effect that must happen at most once declares its key next to the code
   that performs it, e.g. `const key = defineOperationKey({ kind, fields })` or a
   `composeKey(kind, id)` call (a draft design keys execution as `exec:<id>`, which is
   exactly `composeKey("exec", id)`).
2. The writing mutation derives the key from server-side state, reads its table
   through an index on the stored key, returns the existing record on a hit and
   inserts on a miss. Convex OCC serialises concurrent attempts, so the read-then-write
   is the uniqueness guarantee; an invariant check can assert there is at most one row
   per key.
3. The same key is passed to any future external integration as its idempotency key.
4. Room or scenario handles visible in URLs use `createPublicId({ prefix })` or a
   stored `slugify(title)` resolved with `uniqueSlug` inside the inserting mutation.
5. Hashes of canonical JSON can fingerprint immutable payloads (e.g. "what exactly was
   approved") for audit, since the hash does not depend on key order.

## Open items

- Verify on a real Convex deployment that `crypto.subtle.digest`, `crypto.getRandomValues`
  and `TextEncoder` are available in queries and mutations (expected, not yet proven).
  `sha256` and `randomBytes` are injectable so a pure-JS fallback can be dropped in.
- The `@convex-dev/workflow` component forbids `crypto` inside workflow handlers;
  derive keys in mutation steps, not in the workflow body.

## Layout

```
src/canonical-json.ts  src/hash.ts  src/encoding.ts  src/runtime.ts
src/operation-id.ts    src/slug.ts  src/public-id.ts src/index.ts
test/*.test.ts         test/prng.ts (seeded byte source for reproducible tests)
```

Run `npm install`, then `npm test` and `npm run typecheck`.

## Verification

Node v24.21.0, npm 11.19.0, run on 2026-10-24 in this directory.

`npm test`:

```text

> @speak-for-me/idempotency-ids@0.0.0 test
> vitest run


 RUN  v5.0.5 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/idempotency-ids


 Test Files  5 passed (5)
      Tests  109 passed (109)
   Start at  04:30:08
   Duration  115ms (tests 61%, import 19%, transform 16%, worker 4%)

exit code: 0
```

`npm run typecheck`:

```text

> @speak-for-me/idempotency-ids@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json

exit code: 0
```
