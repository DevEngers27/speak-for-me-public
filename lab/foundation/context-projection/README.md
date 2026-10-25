# context-projection

Domain-agnostic building blocks for the two places where Speak for Me can leak
private data or let one party steer another party's agent:

1. **Read models / DTOs** returned to a browser or handed to an agent: fields
   must be copied from an explicit allowlist, decided per role, never spread.
2. **Model context assembly**: other parties' free text must enter a prompt only
   inside clearly labeled, escaped, length-capped blocks, and the whole context
   must fit a token budget without silently dropping something essential.

The module contains no business tables, states, roles or function names. Field
and role names in the tests are placeholders (`owner` / `peer` / `auditor`,
`privateNote`, ...). The real records and roles come from the design documents
(07 permissions & privacy, 10 agent runtime).

Zero runtime dependencies; pure TypeScript (no Node built-ins), so it can run in
Convex queries, mutations and actions as well as in Next.js server code.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | `vitest run --typecheck`: runtime tests plus compile-time proofs in `test/*.test-d.ts` |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` (strict; every `@ts-expect-error` must fire) |

## API

### `pickExact<T, K>()(keys)` -> `(source: T) => Pick<T, K>`

```ts
const toSummary = pickExact<Doc, 'id' | 'title'>()(['id', 'title']);
pickExact<Doc, 'id' | 'title'>()(['id']);                 // compile error: missing "title"
pickExact<Doc, 'id' | 'title'>()(['id', 'title', 'note']); // compile error: "note" not in K
pickExact<Doc, 'id' | 'title'>()(['id', 'title', 'id']);   // compile error: duplicate
pickExact<Doc, 'id' | 'title'>()(someWidenedArray);        // compile error: not a literal tuple
```

`K` is the reviewed declaration of what may leave the boundary; the tuple is its
runtime counterpart, and the compiler keeps them identical. The projector has a
frozen `.keys` list for audits.

### `projectInto<Source, Target>()(keys)` -> `(source: Source) => Target`

DTO form. The tuple must be exactly `keyof Target`; every target key must exist
on the source, and each source field type must be assignable to the target's.
Use it when the output type is declared elsewhere (for example inferred from a
Convex `returns` validator) so a drift between the validator and the projection
is a compile error.

### `defineDisclosureMatrix<T>()({ roles, fields })` and `projectByRole(matrix)`

```ts
const matrix = defineDisclosureMatrix<Example>()({
  roles: ['owner', 'peer', 'auditor'],
  fields: {
    id: ['owner', 'peer', 'auditor'],
    sharedNote: ['owner', 'peer'],
    privateNote: ['owner'],
    internalScore: [],            // nobody
  },
});
const project = projectByRole(matrix);
const view = project('peer', record);   // type: Pick<Example, 'id' | 'sharedNote'>
view.privateNote;                       // compile error
const forPeer = project.forRole('peer'); // pre-bound projector
```

Compile-time guarantees: every field of `T` has an entry (adding a field forces a
disclosure decision), no entry for a field `T` lacks, no undeclared role in an
entry, no duplicate role. Helper types: `ProjectedFor<T, F, Role>`,
`ProjectionOf<typeof matrix, Role>`, `VisibleKeys<...>`.

Runtime guarantees: only granted own properties are read and copied (verified
with a recording `Proxy`); an unknown role throws `RangeError` (including
`"toString"` / `"__proto__"`); the matrix and per-role key lists are frozen.

### `wrapUntrusted(text, { source, maxChars?, boundary? })`

```text
<untrusted-text source="peer.note" boundary="9f2c4e1a0b7d3c55" chars="42" original-chars="42" truncated="false">
...escaped payload...
</untrusted-text boundary="9f2c4e1a0b7d3c55">
```

Returns `{ text: UntrustedBlockText, source, boundary, keptChars, originalChars,
truncated, removedChars }`. `UntrustedBlockText` is a branded string that only
`wrapUntrusted` produces, so a context type can demand it for third-party slots.

Pipeline: lone surrogates -> U+FFFD; `\r\n`/`\r` -> `\n`; NFKC (folds full-width
and small-form look-alike brackets); strip invisible / control / bidi
characters and Unicode tag characters (U+E0000-E007F, "ASCII smuggling"); cap
at `maxChars` code points (default 4000) before escaping; entity-escape
`& < >`; frame with a boundary token.

Related exports: `UNTRUSTED_TEXT_POLICY` (byte-stable instruction text for the
system prompt), `verifyUntrustedBlock(s)` (strict parser for tests and canary
scans: format, matching boundary, no raw brackets, attribute consistency),
`sanitizeUntrustedText`, `escapeUntrustedPayload`, `SOURCE_PATTERN`.

### `estimateTokens(text, opts?)` and `trimToBudget(blocks, { budgetTokens, perBlockOverheadTokens?, estimate? })`

`estimateTokens` charges `ceil(ascii / 3 + nonAsciiCodePoints * 1)` by default,
which over-counts typical English (about 4 chars/token) on purpose.

`trimToBudget` takes `{ id, text, priority, required? }[]` and returns
`{ ok, kept, dropped, usedTokens, budgetTokens, costById }`:

- drops non-required blocks lowest priority first (ties: later block first)
  until the estimate fits; `kept` keeps input order; blocks are never split;
- invariant: every kept optional block has priority >= every dropped block
  (property-tested over 200 random cases);
- if required blocks alone exceed the budget it returns
  `ok: false, reason: 'REQUIRED_BLOCKS_EXCEED_BUDGET'` instead of throwing or
  silently truncating, so the caller can fail the turn explicitly.

## Design notes

- **Why a curried `pickExact<T, K>()(keys)`**: TypeScript cannot partially
  infer type arguments. Currying lets `T` and `K` be written explicitly while
  the key tuple is still inferred as a `const` literal, which is what makes the
  missing / duplicate / non-tuple checks possible.
- **The structural-typing hole is closed at runtime.** TS accepts a wider,
  non-literal object where `T` is expected, so private fields can travel in an
  object typed as public. Every projector copies only listed own properties
  into a fresh object; the tests pass objects carrying a canary in unlisted
  fields and scan the JSON output.
- **Projection is shallow.** A picked field that holds an object is copied by
  reference. Pick primitives or values that were themselves projected; nested
  records need their own projector or matrix.
- **Fail closed everywhere.** An empty role list means nobody; a new role sees
  nothing until named; a union role gets the intersection of visible fields
  (non-distributive conditional), never the union; an unknown role throws.
- **Escape, do not strip.** Stripping tag-like text is a blacklist that misses
  variants. Escaping `& < >` makes it impossible for the payload to contain any
  tag, while staying lossless for ordinary text (`verifyUntrustedBlock` decodes
  back to the sanitized input). The boundary token is a second, independent
  layer.
- **Deterministic boundary.** FNV-1a 64 over `source + NUL + payload`. Same
  input gives byte-identical prompts, which keeps prompt caching (prefix match)
  and tests stable. It is not a secret and not cryptographic; escaping is the
  primary defence. Pass `boundary` to use a random per-request token instead.
- **Attribute values are code-generated only.** `source` must match
  `SOURCE_PATTERN`; counts and flags come from code; nothing from the payload
  is ever placed in the opening or closing fence.
- **Framing is not a guarantee.** It makes injected instructions easy for the
  model to recognise as data. The actual guarantees are elsewhere: an agent's
  context never contains another party's private data (projection), and model
  output is validated by deterministic code before anything happens.
- **Trimming is strict-priority, not knapsack.** Greedy refill could keep a
  low-priority block while dropping a higher one; strict ordering is easier to
  reason about and to explain in a turn record.

## How the engine will use it

Names below are illustrative; the binding names come from the design docs.

1. **Role-projected read models (Convex queries).** For each record kind that
   reaches a browser, the design's field x role disclosure matrix is written as
   a `defineDisclosureMatrix` literal. Every public query resolves the caller's
   role server-side and returns `project(role, doc)`; nothing is filtered in the
   browser. With `projectInto`, the DTO type can be tied to the query's
   `returns` validator.
2. **Agent context assembly (single entry point).** The context builder for one
   party uses `pickExact` / `projectInto` to copy only that party's own brief
   fields plus other parties' explicitly shared facts. Any free text written by
   someone else goes through `wrapUntrusted` with a code-chosen `source` label,
   and the context type requires `UntrustedBlockText` for those slots.
3. **Prompt layout.** `UNTRUSTED_TEXT_POLICY` goes into the stable system prompt
   (cached prefix). Wrapped blocks go into `user` messages. Operator
   instructions that change per turn use the mid-conversation `system` message
   channel, never text inside user content.
4. **Budget.** Context sections become `ContextBlock`s (policy and own brief
   `required`; history and optional reference material with priorities) and go
   through `trimToBudget`. `ok: false` becomes an explicit turn failure; the
   dropped ids can be recorded on the turn for traceability. The estimator
   constants should be calibrated against recorded `usage` numbers.
5. **Tests.** `verifyUntrustedBlock` lets a privacy canary assert that every
   third-party string inside an assembled context sits in exactly one intact
   block.

## Dependencies

| Package | Kind | Why |
| --- | --- | --- |
| `typescript` 6.0.3 | dev | Strict type checking; the compile-time proofs are the core deliverable. Same version as the spikes. |
| `vitest` 3.2.7 | dev | Test runner plus `expectTypeOf` and `--typecheck` for `*.test-d.ts`. Same version as the spikes. |

No runtime dependencies. `@types/node` is not needed: the source uses no Node
APIs (`tsconfig` sets `types: []`).

## Known limitations

- `String.prototype.normalize('NFKC')` and regex lookbehind must exist in the
  Convex default runtime (they do in Node 24 and standard V8 with ICU); to
  verify on a real deployment.
- The token estimator is a heuristic, not Claude's tokenizer.
- Projection is shallow (see design notes).
- `trimToBudget` drops whole blocks only; it does not shorten a block.
- NFKC changes compatibility characters (ligatures, full-width forms) in the
  payload; acceptable for model input, not for display.

## Verification

Run on 2026-10-24T11:29Z with Node v24.21.0, npm 11.19.0, TypeScript 6.0.3.

`npm test` (exit code 0):

```text

> @speak-for-me/context-projection@0.1.0 test
> vitest run --typecheck

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 RUN  v3.2.7 /private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/foundation/context-projection

 ✓ test/untrusted.test.ts (16 tests) 4ms
 ✓ test/projection.test.ts (16 tests) 4ms
 ✓ test/budget.test.ts (14 tests) 9ms
 ✓  TS  test/projection.test-d.ts (21 tests)

 Test Files  4 passed (4)
      Tests  67 passed (67)
Type Errors  no errors
   Start at  04:29:39
   Duration  282ms (transform 40ms, setup 0ms, collect 98ms, tests 17ms, environment 0ms, prepare 111ms, typecheck 243ms)
```

`npm run typecheck` (exit code 0; no output from tsc means no errors):

```text

> @speak-for-me/context-projection@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
```
