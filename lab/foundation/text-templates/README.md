# @speak-for-me/text-templates

Whitelist text templating for room-visible text.

## Purpose

Speak for Me requires that anything one party can see about another party's
work is produced by **code templates over structured, allowlisted fields**,
never by passing model free text or private rows through. This package is the
mechanism for that rule. It is domain-agnostic: it knows nothing about rooms,
proposals or budgets. It only guarantees that:

1. Each template declares its slot names and slot kinds; the template text's
   `{placeholders}` must be exactly those slots (type error + runtime error).
2. Rendering requires a value for every slot and **rejects any other field**,
   at compile time (also for non-literal objects) and at runtime.
3. Every slot value is validated by kind (no "any string" slot exists) and its
   final string is passed through an output **encoder** exactly once.
4. Amounts, dates, integers and lists are rendered by **injected formatters**;
   the package never decides currency, locale or date style.
5. Rendering is a pure, deterministic function of (template, values,
   formatters, encoder).
6. Errors never contain slot values (they are safe to log).

Zero runtime dependencies.

## API

```ts
import { createReferenceFormatters, createRenderer, defineTemplate, emptyFragment, fragment, htmlEncoder, slot } from '@speak-for-me/text-templates';

const clause = defineTemplate({
  id: 'example.deferred_items',
  slots: { items: slot.list(slot.token({ pattern: /[A-Z][A-Z0-9_]{0,31}/ })) },
  text: '; {items} deferred',
});

const summary = defineTemplate({
  id: 'example.proposal_summary',
  slots: {
    actor: slot.enum({ customer: 'Customer', provider: 'Provider', finance: 'Finance' }),
    items: slot.list(slot.token()),
    amount: slot.amount(),
    deliveryDate: slot.date(),
    deferred: slot.optionalFragment([clause]),
  },
  text: '{actor} proposes {items} for {amount}, delivery {deliveryDate}{deferred}.',
});

const r = createRenderer({ formatters: createReferenceFormatters() /*, encoder: htmlEncoder */ });
r.render(summary, {
  actor: 'provider', items: ['LOGIN', 'REPORTS'], amount: 90000, deliveryDate: '2026-11-14',
  deferred: fragment(clause, { items: ['EXPORT'] }),
});
// "Provider proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred."
```

| Export | What it does |
| --- | --- |
| `defineTemplate({ id, slots, text })` | Validates and freezes a template. `text` must be a string literal whose placeholders equal the slot names. |
| `slot.text({ maxLength })` | Bounded free text from an allowlisted source. Rejects empty, control/bidi/zero-width chars, lone surrogates, surrounding whitespace. |
| `slot.token({ pattern })` | Identifier-like value; pattern matched against the whole value; `g`/`y` flags refused. |
| `slot.enum(labels)` | Closed vocabulary; keys are accepted values, values are code-authored display labels. |
| `slot.amount({ signed })` | Safe-integer minor units; rendered by `formatters.amount`. |
| `slot.date()` | Real calendar date `YYYY-MM-DD`; rendered by `formatters.date`. |
| `slot.integer({ min, max })` | Safe integer in range; rendered by `formatters.integer`. |
| `slot.list(itemSlot, { minItems, maxItems })` | List of text/token/enum items; rendered by `formatters.list`. |
| `slot.fragment([tpl...])` / `slot.optionalFragment([tpl...])` | A nested application of one of the listed templates (optional also accepts `emptyFragment`). |
| `fragment(tpl, values)` | Validates now, returns an unforgeable `Fragment` snapshot. |
| `createRenderer({ formatters, encoder? })` | Returns `{ render, renderFragment }`. Default encoder: `plainTextEncoder`. |
| `createReferenceFormatters(opts)` | Deterministic en-US-style formatters without `Intl` (tests, examples, a default). |
| `plainTextEncoder`, `htmlEncoder` | Output encoders. |
| `TemplateError` | `code` in `INVALID_TEMPLATE`, `NOT_A_TEMPLATE`, `INVALID_VALUES`, `MISSING_SLOT`, `UNKNOWN_SLOT`, `INVALID_SLOT_VALUE`, `FORMATTER_FAILED`; plus `templateId`, `slot`, `reason`. |
| `ValuesOf<typeof tpl>` | The exact payload type of a template (use it for stored event payloads). |

Builders take an optional type parameter for branded values, e.g.
`slot.amount<PublicAmountCents>()`: then a plain number read from a private
row does not compile in that slot (see `test/types.check.ts`).

## Design notes

- **Exactness at compile time.** `render<T, V extends ValuesOf<T>>(t, values: V & {[K in Exclude<keyof V, keyof ValuesOf<T>>]: never})`.
  The intersection closes TypeScript's structural-typing hole: a wider
  *non-literal* object (e.g. a DB row with `capCents`) is rejected, not only
  fresh literals.
- **Exactness at runtime.** Values must be a plain (or null-prototype) object;
  symbol keys and accessor properties are refused (a getter could return
  different values per read); unknown keys -> `UNKNOWN_SLOT`, missing ->
  `MISSING_SLOT`. Unknown key names are reported only if they look like
  identifiers.
- **No logic in templates.** Text has only `{slot}`; stray braces are errors.
  Conditional clauses are fragments chosen in code
  (`deferred.length ? fragment(clause, ...) : emptyFragment`). Fragment slots
  list the templates they accept, so a finance-only template cannot be nested
  into a room-visible one.
- **Escaping model.** Literal template text is trusted (authored in code) and
  never encoded. Every slot's final string, including formatter output and
  enum labels, goes through the encoder exactly once; fragments are rendered
  with the outer encoder and not re-encoded. Substitution is single-pass over
  segments parsed at definition time, so a value like `"{b}"` cannot inject a
  placeholder. `plainTextEncoder` replaces control/bidi/zero-width characters
  with U+FFFD (data slots already reject them); `htmlEncoder` additionally
  entity-escapes `& < > " '`.
- **Determinism.** No clock, randomness, `Intl` or locale lookups in the
  renderer or reference formatters (a test stubs `Date.now`, `Math.random` and
  `Number.prototype.toLocaleString` to throw). Amount formatting uses BigInt
  integer arithmetic. Fragments snapshot their validated values.
- **Fragment slot optionality** is two builders, not a type parameter: a
  defaulted `O extends boolean = false` was widened to `boolean` by contextual
  return-type inference inside `defineTemplate({ slots })`, silently making
  every fragment optional (caught by the type tests).
- **Minted specs.** `defineTemplate` accepts only slot specs created by
  `slot.*` (WeakSet), and `render` only templates created by `defineTemplate`.

## How the engine will use it

This follows the design inputs (public text only from templates; store
`{type, payload}` and render per viewer; integer cents; `YYYY-MM-DD` dates in
UTC; engine templates in the engine, scenario templates in the scenario
plugin). Exact event names and the disclosure matrix are not decided yet.

1. The engine and each scenario plugin export their templates as module
   constants; `ValuesOf<typeof tpl>` types the stored event payload.
2. A mutation that appends an event stores the template id and a payload built
   field by field from validated, server-computed values (catalog sums, item
   keys, version numbers, reason codes), never by spreading a row.
3. A query renders for the viewer: the disclosure layer picks the
   audience-specific template (e.g. a finance variant with amounts vs. a
   room variant with a reason code only) and calls
   `createRenderer({ formatters: formattersForRoom(room), encoder })`, where
   the room binds currency and time zone.
4. Model prompts that quote other parties use the same rendered text, so an
   agent never sees more than a human in that role would.

`src/examples/negotiation.ts` contains ILLUSTRATIVE templates (proposal
summary, blocked by constraint, approval recorded, execution completed). They
use no free-text slots, the blocked template has no amount slot, and tests show
that `capCents`, `budgetCents`, `floorCents` and brief text are rejected.

## Scripts

- `npm test`: `node --test` (Node 24 native type stripping), files `test/**/*.test.ts`.
- `npm run typecheck`: `tsc --noEmit`, including `test/types.check.ts`, whose
  `@ts-expect-error` lines are the compile-time proofs (an unused directive
  fails the build).

## Dependencies

Runtime: none. Dev only:

- `typescript@6.0.3`: type checking; the compile-time guarantees are the point of this package.
- `@types/node@24.19.2`: types for `node:test` / `node:assert` used by tests.

Tests use the built-in `node:test` runner, so no test framework dependency.

## Known gaps

- No Markdown encoder (contextual escaping; add when a Markdown sink exists).
- No pluralisation / ICU message support; templates avoid counted nouns.
- Event names, slot vocabularies and wording in the examples are placeholders.
- Branded "public value" types (who may mint a public amount) belong to the
  rules engine; this package only provides the type-parameter hook.
- Template ids are not checked for global uniqueness (no global registry by design).

## Verification

Run on 2026-10-24T11:32Z, Node v24.21.0, npm 11.19.0.

### `npm test` (exit 0)

```text

> @speak-for-me/text-templates@0.1.0 test
> node --test --test-reporter=spec "test/**/*.test.ts"

▶ determinism
  ✔ same input gives byte-identical output across repeated renders and fresh renderers (3.924458ms)
  ✔ field insertion order does not matter (0.096542ms)
  ✔ does not read the clock, randomness or locale while rendering (0.064625ms)
  ✔ a fragment is a snapshot: mutating the source array afterwards has no effect (0.053167ms)
  ✔ formatters receive canonical values and are called once per slot (0.103375ms)
  ✔ injected formatters change presentation only (0.08325ms)
✔ determinism (4.800708ms)
▶ reference formatters
  ✔ format amounts with integer arithmetic (0.06325ms)
✔ reference formatters (0.114834ms)
▶ example negotiation templates
  ✔ render the expected room-visible text (0.701042ms)
  ✔ reject every private field at runtime, without echoing the value (0.248167ms)
  ✔ reject private text smuggled into a vocabulary slot (0.117292ms)
  ✔ have no free-text slots and the blocked template has no amount slot (structural guarantee) (0.0835ms)
✔ example negotiation templates (1.62075ms)
▶ defineTemplate
  ✔ returns a frozen template (0.25775ms)
  ✔ rejects text/slot mismatches at runtime (for JS callers or casts) (0.153083ms)
  ✔ rejects malformed text, bad ids and hand-made slot specs (0.12075ms)
  ✔ rejects stateful token patterns (0.050958ms)
✔ defineTemplate (0.979625ms)
▶ render: field set is exact
  ✔ renders when every slot is supplied (0.26925ms)
  ✔ rejects unknown fields at runtime without echoing their value (0.062167ms)
  ✔ does not echo a non-identifier unknown key (0.051917ms)
  ✔ rejects missing fields (0.061291ms)
  ✔ rejects non-plain value objects, symbol keys and accessors (0.279084ms)
  ✔ accepts null-prototype value objects (0.204584ms)
  ✔ rejects objects that were not created by defineTemplate (0.099ms)
✔ render: field set is exact (1.230709ms)
▶ render: slot validation
  ✔ text: bounds and unsafe characters, value never echoed (0.251708ms)
  ✔ integer, amount and date (0.333667ms)
  ✔ enum renders the authored label and rejects prototype keys (0.110209ms)
  ✔ token and list (0.141625ms)
✔ render: slot validation (0.925416ms)
▶ render: escaping
  ✔ html encoder escapes slot output but not the trusted literal text (0.086917ms)
  ✔ slot values cannot inject placeholders (single-pass substitution) (0.03275ms)
  ✔ formatter output is encoded too (0.064041ms)
  ✔ formatter failures are reported without values (0.091291ms)
✔ render: escaping (0.390167ms)
▶ fragments
  ✔ renders nested fragments and the empty fragment (0.250375ms)
  ✔ validates fragment values eagerly (0.057667ms)
  ✔ rejects fragments of unlisted templates, forged fragments and strings (0.105709ms)
  ✔ encodes fragment slots exactly once with the outer encoder (0.077292ms)
✔ fragments (0.581958ms)
ℹ tests 34
ℹ suites 8
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 69.292583
```

### `npm run typecheck` (exit 0)

```text

> @speak-for-me/text-templates@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

```

The typecheck covers `test/types.check.ts`: 18 `@ts-expect-error` compile-time proofs (unknown placeholder, unused slot, missing field, extra field on literal and non-literal objects, wrong enum value, wrong fragment template, non-optional empty fragment, branded amount), all of which must fail to compile for tsc to exit 0.
