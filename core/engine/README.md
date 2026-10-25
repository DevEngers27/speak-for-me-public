# Foundation modules

These modules are pure TypeScript, consumed through the repository's bundlers
(Next.js, Convex and Vitest). Extensionless imports assume bundling; they are not
standalone Node packages. No additional runtime or development dependencies were
needed. Backend schemas and error handling live in `convex/lib/`.

## Money and dates

`money.ts` uses branded number cents, not floating dollar values. Stored `Cents`
are safe integers from 0 through 100,000,000,000; callers may choose a lower `max`.
`SignedCents` supports derived differences and has the safe-integer range.
Construct with `cents` / `signedCents`, validate with `assertCents` / `isCents`, and
read untrusted JSON or stored numbers through those constructors, never a cast.
Every arithmetic operand is revalidated. Errors describe rules without values.

Arithmetic includes checked sums, subtraction, signed differences, comparisons,
minimum/maximum, multiplication, explicit floor/ceil/half-up/half-even scaling,
and largest-remainder allocation (ties favor earlier indices). Bigint is used
only for exact intermediates. `splitCentsEvenly` accepts 1 through 10,000 parts,
including zero-value parts, and rejects the bound before allocating.
`parseCents` accepts US decimal strings such as `$4,800.50`, `.99` and grouped
thousands. It rejects negative inputs (including `-0`), exponents, malformed
grouping and more than two decimal places instead of rounding. Whitespace after
`$`, including newlines, is accepted. Formatting is fixed USD/en-US without Intl;
input and decimal-string helpers preserve exact cents.

`dates.ts` brands real `YYYY-MM-DD` strings from `0000-01-01` to `9999-12-31`.
Validate untrusted strings with `isoDate` / `assertIsoDate`. Same-format strings
sort chronologically. Gregorian arithmetic uses integer epoch days, never Date
or host timezone. Helpers cover parts, day addition/differences, weekday,
comparisons and deterministic English formatting. `isoDateFromEpochMs` accepts
finite fractional milliseconds, floors them, and requires an explicit fixed
UTC offset within ±18 hours. IANA zones, DST and choosing today belong to callers.
This layer has no visibility policy: templates receive only values already
released by the disclosure layer.

## Canonical JSON and keys

`canonicalJson` replaces ad hoc stable serialization as the basis of `termsKey`.
It sorts own object keys by UTF-16 code units and preserves array order, omits
undefined object properties, and follows JSON.stringify for strings, numbers and
negative zero. It rejects non-finite numbers, bigint, functions, sparse arrays,
undefined array elements, symbol object keys, non-plain objects, cycles and depth
above the configurable default 64. Shared references without cycles are allowed.
Use integer cents in terms; generic JSON still permits finite fractional numbers.
Convert int64 values to strings and bytes to an explicitly chosen encoding before
canonicalizing. Interface types without an index signature may need a JSON-shaped
projection rather than a cast. Canonical errors include key paths.

`executionKey(id)` is `exec:${id}`; `taskKey(executionId, itemKey, index)` joins
three segments with colons. `candidateKey(items, modifiers)` sorts both lists,
joins each with `+`, and uses `@` before modifiers. Duplicate or ambiguous segments
are rejected. Inputs are nonempty ASCII letters/digits/underscore/hyphen; the
item list must be nonempty and the task index a nonnegative safe integer.
No hashing, slugs, random public ids or generic operation-key registry migrated.
Keys and canonical payloads are visible data, and hashing would not provide
confidentiality either. Use only values visible to every reader of the key.
Derive the key inside the writing mutation, query its index, return an existing
row on a hit, and insert on a miss; Convex OCC supplies concurrent uniqueness.

## Results and backend errors

`result.ts` retains the discriminated plain-object `Result<T,E>` API: `ok/err`,
guards, map/mapErr, andThen/orElse, match, unwrap variants, tuple-preserving `all`,
error-collecting `collect`, partition, nullable conversion and sync/async tryCatch.
`ok()` contains null so it can cross JSON boundaries. Serialization still requires
JSON-safe contained values. Unwrap helpers are for tests/scripts; causes can carry
private values and must not be logged indiscriminately.

`convex/lib/errors.ts` supplies a small registry rather than migrating the obsolete
message/data wire format or a second reason-code catalog. Define dotted lowercase
codes with runtime param kinds (`int`, `count`, `cents`, `bool`, `date`, `key`,
`keys`, `id`) and explicit role audiences. There is no free-text client param.
Identifiers must come from trusted catalogs: syntax alone is not a privacy policy.
Unmarked params are omitted. Provider never receives overByCents, headroomCents or
deadline. `project` types omit inaccessible fields as well. `create` checks every
param, rejects sparse lists and freezes its cloned values. Definitions are cloned
and frozen. `toPayload` / `toClientError` rebuild `{code, params}` from declarations;
unknown/internal/malformed/foreign-registry errors map to `run.invalid_state`
with no params. `toConvexError` wraps that projection using the real Convex class.
Throw after writes to roll back; returning an Err commits earlier writes.

## Fixture schemas and loader

`convex/lib/fixtureSchema.ts` keeps Zod outside the engine. Fixtures use
`scenarioKey`, `localDate`, `members` (`userId`, `role`), structured per-role
`briefs.hardFields/softFields/disclosures`, `catalogItems`, baseline
`ledgerEntries` and `provenance: seeded | stub`. Catalog rows use canon's
itemKey/kind/title/priceCents/leadDays/taskTemplates plus optional revision/status.
Priced catalog rows are required by this task's canon contract; optional delivery
and outcome-total fields and script `steps` avoid the old phase terminology.
An empty catalog and omitted expected total allow non-priced scenarios.
No scenario example is imported or loaded as a module side effect.

The schema checks unique identities, role/item references, dense constraint
versions, existing and nonregressing step versions, stable constraint identity
across snapshots, and optional expected totals. Unknown references or duplicates
skip downstream arithmetic diagnostics. CentsSchema/IsoDateSchema output the
engine brands. Only the loader returns a branded, deeply readonly ScenarioFixture;
it clones and freezes data without freezing the author's input.

Use `loadFixture(input, {expectedScenarioKey: 'example', briefSchemas})`, where
briefSchemas maps role names to synchronous Zod schemas for the entire structured
brief. Registered roles must have briefs and every supplied brief needs a schema
when the option is present. Schemas validate without applying their transforms
to stored data. Throwing or async plugin schemas produce fixed safe diagnostics.
`safeLoadFixture` and `parseFixtureJson` return issues instead of throwing;
`loadFixture` throws FixtureValidationError. Loader diagnostics suppress private
key names and input values. Invalid Convex object keys and __proto__ are rejected.

Fixtures are server-only private data. `privateValuesOf` collects brief/private
constraint leaves and optional per-role canaries for scanners; it is not a public
projection. Descriptions in steps/expectations are test metadata and must never
render in room views. `constraintSetForStep` finds the snapshot for a script step.
`scenarioFixtureJsonSchema()` exports input JSON Schema for an editor's `$schema`
association; JSON Schema cannot express cross-reference checks, so always load.

The test config under `tests/` extends the skeleton projects with backend
foundation tests in edge-runtime; engine tests stay in the skeleton core project.
`pnpm typecheck` also compiles regression type checks in `tests/`.
