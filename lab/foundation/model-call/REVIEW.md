# Review: model-call (`callStructured`)

Reviewer: code-review agent, 2026-10-24. Scope: everything under `foundation/model-call/` (src, test, README, package.json, tsconfig). Reference: `design/00-brief.md` §3, `design/inputs/04-platform-constraints*`, `design/inputs/05-spike-verified-facts.md`.

**Verdict: merge_after_fixes.** No blockers. Two medium issues (log-safety of `detail`, `totalBudgetMs` not bounding the first attempt), the rest are low. The core design is sound and matches the platform constraints.

## 1. Author claims re-verified

Node v24.21.0. Commands run in the module directory, unmodified:

```text
$ npm test
...
ℹ tests 43
ℹ suites 10
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 198.413708
test exit=0

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
typecheck exit=0
```

`tests_passed=true` and `typecheck_passed=true` are accurate. The test script unsets `ANTHROPIC_*` env vars; no test touches the network (fake transport, stub transport, or the real SDK client over an in-process fake `fetch`).

## 2. Compile-time type safety (probed)

A throwaway probe (`.review-probe/probe.ts`, extends the module tsconfig; deleted after the review) contained 8 misuses that must fail and 6 that the types cannot catch. `npx tsc --noEmit -p .review-probe/tsconfig.json` exited 2 with exactly the 8 expected errors:

```text
probe.ts(10,35): error TS2322: Type '"ultra"' is not assignable to type 'Effort'.
probe.ts(13,24): error TS2345: ... Property 'effort' is missing in type ...
probe.ts(15,35): error TS2322: Type '2' is not assignable to type '0 | 1'.
probe.ts(18,5):  error TS2339: Property 'output' does not exist on type 'CallStructuredResult<{ verdict: "yes" | "no"; count: number; }>'.
probe.ts(20,21): error TS2322: Type 'string' is not assignable to type 'number'.   (r.output.verdict -> number)
probe.ts(22,45): error TS2322: Type '"fake"' is not assignable to type '"anthropic" | "stub"'.
probe.ts(24,35): error TS2353: Object literal may only specify known properties, and 'temperature' does not exist ...
probe.ts(26,57): error TS2322: Type '"10m"' is not assignable to type 'CacheTtl'.
```

So: effort is a closed union and required, `retryBudget` is `0 | 1`, the result must be narrowed on `ok` before `output` is readable, `output` is inferred as `z.output<S>`, transport kind and cache TTL are closed, and excess keys on a literal are rejected.

These compile and are caught only at runtime (or not at all): a non-object root schema (`z.string()`), `maxTokens: 50_000`, an assistant prefill, `temperature` on a non-literal object, a stub fixture that does not match the schema, and schemas with transforms/`z.date()`/`z.bigint()`. The first four are correctly stopped by the runtime whitelist (spike fact 4 says tsc cannot catch them, so this is the right design). See r03 and r09 for the rest.

## 3. Domain-freeness, dependencies, brief alignment

- Domain-free: `grep -i` over `src/` for room/proposal/approval/budget/scenario/customer/provider/finance/party/negotiat/amount finds only "retry budget" and "price" (model list prices). No business tables, states or function names. Pass.
- Dependencies: runtime `@anthropic-ai/sdk` 1.1.0 (the mandated SDK) and `zod` 4.6.7 (SDK peer for `helpers/zod`); dev `typescript`, `@types/node`. No test framework (node:test). Minimal and justified in the README. Pass.
- Brief §3.8 (no fabrication): `meta.source` comes from `transport.kind`, stub output is still Zod-validated. Pass.
- Brief §3.4: README states that `ok: true` means shape-valid only and business checks stay in deterministic code. Pass.
- Brief §3.1 / logging discipline: `rawText` is returned for private storage only and nothing is logged, but `detail` can carry server-echoed request text (r01).
- Money: no business amounts here. The usage-cost estimate uses floating-point per-token prices (r05).
- Platform constraints: `messages.create` + own `stop_reason` handling + `safeParse` (inputs/04 §4.4, spike fact 3), SDK `maxRetries: 0`, explicit effort, no sampling/thinking/tool_choice/prefill, object-root check for discriminated unions (spike fact 2), mid-conversation system message placement, 4 breakpoints and longer-TTL-first. All consistent.

## 4. Issues

| id | sev | summary |
| --- | --- | --- |
| model-call-r01 | medium | `detail` is documented as log-safe, but for 400/413/422 and 404 it embeds the server error message (truncated to 200 chars). |
| model-call-r02 | medium | `totalBudgetMs` does not bound the first attempt; with `totalBudgetMs < timeoutMs` one call can overrun the budget. |
| model-call-r03 | low | Unrepresentable schemas throw a plain `Error` from `zodOutputFormat`, not `ModelCallConfigError` as the README promises. |
| model-call-r04 | low | Haiku long-context price tier only applies when `prices === LIST_PRICES` (identity), so a copied table underestimates 5x. |
| model-call-r05 | low | Cost math multiplies by fractional per-token prices and rounds per call. |
| model-call-r06 | low | `retryBaseDelayMs`, `maxRetryDelayMs`, `totalBudgetMs` are not validated; NaN silently disables the delay cap or the budget. |
| model-call-r07 | low | An abort that coincides with a transient error is reported as that transient kind (`retryable: true`), not `aborted`. |
| model-call-r08 | low | Transport failures drop the SDK `requestID`, so `meta.requestId` is null exactly when support needs it. |
| model-call-r09 | low | No type-level regression tests; non-object root and stub fixtures are not checked at compile time. |
| model-call-r10 | low | The 21,333 `maxTokens` cap is described as an SDK refusal, but the SDK check never runs because the wrapper always passes `timeout`. |
| model-call-r11 | low | README/packaging gaps: raw `.ts` export requirements, no example of a strict custom `jsonSchema`, `lib: dom` weakens the portability claim. |

### Evidence and fixes

**r01** (`src/classify.ts:72`, `:78`). Probe: a 400 whose body message was `messages.0.content: SECRET-PROMPT-FRAGMENT is invalid` produced `detail = "bad request (400): 400 {\"type\":\"error\",\"error\":{...\"SECRET-PROMPT-FRAGMENT is invalid\"}}"`. API validation and "prompt too long" messages can quote request content. The type comment says `detail` "never contains model text, prompt text or credentials", and callers will log it. Fix: build `detail` from status plus `error.type` only (`err.error?.error?.type`). If the message is useful, return it in a separate `serverMessage` field that is documented as private (same rule as `rawText`). Add a test with a sentinel string.

**r02** (`src/call-structured.ts:66`, `:105`, `:120`). Probe: `timeoutMs: 120_000, totalBudgetMs: 10_000` sent a 120 s per-attempt timeout. `types.ts` says the budget covers "all attempts + delay", and the README pitches it as the guard for the Convex action time limit. Fix: either reject `totalBudgetMs < timeoutMs` in `buildRequest` (simplest), or pass `min(timeoutMs, totalBudgetMs - elapsed)` to each attempt. Add a test.

**r03** (`src/request.ts:24`, `:142`). Probe: `z.string().transform(...)`, `z.date()` and `z.bigint()` threw `Error: Transforms/Date/BigInt cannot be represented in JSON Schema` (not `instanceof ModelCallConfigError`). Callers that separate config bugs from other errors will mis-route these. Fix: wrap `zodOutputFormat` in try/catch and rethrow `new ModelCallConfigError(msg, { cause })`. Add a test.

**r04** (`src/usage.ts:52`). Probe: 200K-token Haiku prompt gives 100,000 µUSD with the built-in table and 20,000 µUSD with `{ ...LIST_PRICES }`. Fix: put the tier into the data, e.g. `ModelPrice.longContext?: { aboveTokens: number; price: ... }`, and drop the identity check.

**r05** (`src/usage.ts:37-59`). Prices such as 0.01 and 0.125 µUSD/token are floats, and the result is rounded per call (probe: 3 input + 7 cache-read Haiku tokens gives 0.37 µUSD, returned as 0). It is an estimate, not a business amount, but the project rule is "no floats for money", and these values will be summed into cost dashboards and budgets. Fix: store integer prices in µUSD per million tokens (Opus output = 20_000_000, Haiku cache read = 10_000), compute `Σ tokens × price` as an integer (max about 2e13, well below 2^53) and divide once. Alternatively return integer nano-USD and round only at aggregation.

**r06** (`src/call-structured.ts:67-68`, `:118-120`; `src/request.ts:127`). Probe: `retryBaseDelayMs: -500` called `sleep(-500)`. NaN `maxRetryDelayMs` makes `delay > maxDelay` always false, and NaN `totalBudgetMs` makes the budget check always false. Fix: validate these like `timeoutMs` (finite, ≥ 0 or > 0) in `buildRequest`. Optionally also check at runtime that `retryBudget` is 0 or 1.

**r07** (`src/call-structured.ts:117`). Probe: the signal aborted while the transport threw a 500, and the result was `kind: "server_error"` with `retryable: true`. An attempt layer may then reschedule work the caller cancelled. Fix: when `params.signal?.aborted`, return `{ kind: "aborted" }`.

**r08** (`src/classify.ts`, `src/call-structured.ts:81`, `:96`). `APIError.requestID` exists in SDK 1.1.0 (`core/error.d.ts:11`). Fix: add `requestId` to `ClassifiedError` and to `meta` on transport failures.

**r09** (`src/types.ts:60`, `src/transport.ts:37`). The compile-time guarantees in §2 hold today but nothing in the suite keeps them that way. Fix: add `test/types.test-d.ts` with `@ts-expect-error` cases (as in §2), included in `npm run typecheck`. Consider `S extends z.ZodObject` so the object-root rule is also checked at compile time. Add a typed fixture helper such as `outputReply<S>(schema: S, value: z.input<S>)` so stub fixtures drift-check against the schema while `{ type: "output", output: unknown }` stays available for mismatch tests.

**r10** (`src/types.ts:9-13`). The SDK `messages.create` computes the non-streaming guard only when `options.timeout ?? client._options.timeout` is null (`resources/messages/messages.js`). `anthropicTransport` always sends `timeout`, so the SDK never refuses. The cap is still reasonable as policy: it keeps one attempt inside a Convex action and avoids long idle non-streaming connections. Fix: reword the comment and README as a deliberate policy, and note that streaming (`messages.stream().finalMessage()`) is the extension point for larger budgets at high effort.

**r11** (`package.json` `exports`, `tsconfig.json`, `README.md`). `exports: "./src/index.ts"` and `.ts` import specifiers require consumers to use a TS-aware bundler and `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`. The README does not say so. It also lacks an example of passing a strict `jsonSchema` (the spike-recommended way to keep `enum`/`const` constrained) and of catching `ModelCallConfigError`. Separately, `lib: ["es2023", "dom"]` lets browser-only globals typecheck, so the "portable, no `node:`" claim is not enforced by the compiler. Fix: add a short "Consuming" section and the two examples. Consider dropping `dom` (Node types already declare `crypto`, `TextEncoder`, `Headers`).

## 5. Minor notes (no action required)

- `fingerprintCache` is an unbounded module-level `Map` keyed by the full schema text. That is fine with a fixed schema set. Use a small LRU if schemas are ever generated per request.
- `max_tokens` with complete JSON is still a failure. This is conservative and correct.
- The README's result-kind table matches `classify.ts` and `interpret()` exactly.

## 6. What is good

The `create` + own `stop_reason` handling keeps usage on every response. The request body is always a fresh literal, so nothing leaks onto the wire, and this is proven against the real SDK over a fake `fetch`. There is one owned retry budget with SDK retries off. Cache placement is validated against the documented API rules. Stub results are always labelled. Failures are a closed union with a retry hint. Tests are deterministic through an injected clock.
