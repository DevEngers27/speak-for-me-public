# model-call

`callStructured()` makes **one** structured-output call to Claude through `@anthropic-ai/sdk` 1.1.0 and gives back a closed, typed result. It does not know about the domain: there are no rooms, proposals, scenarios or business enums here. The negotiation engine supplies the system text, the messages and a Zod schema. This module handles everything between those inputs and a validated object or a classified failure.

What it handles:

- Building the request: model, explicit `effort`, `max_tokens`, system blocks with `cache_control` placement, messages, and `output_config.format` built from the Zod schema with `zodOutputFormat`.
- Handling `stop_reason`: `end_turn`, `max_tokens`, `refusal`, `model_context_window_exceeded`, and unexpected or unknown stop reasons.
- Parsing and validation: the `parsed_output === null` case (no text block), invalid JSON, and a Zod mismatch (only the issue paths are reported, never the values).
- Error classification using the SDK's typed errors. `BadRequestError` and other 4xx config errors are not retried. Rate limits, 5xx/529, 409, timeouts and connection errors are retried within a **single retry budget**.
- Usage capture: input, output, cache read, cache write (5m/1h), and thinking tokens; per-attempt and total latency; request id; served model; a schema fingerprint.
- An injectable `Transport`. One implementation goes through the real SDK client. The other is a **deterministic stub**, and its results are always labelled `source: "stub"`.

What it never sends: `temperature`, `top_p`, `top_k`, `thinking`, `tool_choice`, `tools`, `stream`, or an assistant prefill. On `claude-opus-5-5` with API version `2026-10-21`, each of these is a 400 or unsupported. The request body is always a fresh literal built inside the module and never a spread of caller input, so these fields cannot leak through. Tests check this against the real SDK's wire output.

## API

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicTransport, callStructured, stubTransport } from "@speak-for-me/model-call";

const Output = z.strictObject({ verdict: z.enum(["yes", "no"]), reasons: z.array(z.string()).min(1) });

const transport = anthropicTransport(new Anthropic()); // credentials come from the deployment env
const result = await callStructured(
  {
    model: "claude-opus-5-5",          // optional, this is the default
    effort: "medium",                  // required, never left to the model default
    maxTokens: 16_000,                 // 1..21,333 (non-streaming SDK limit); thinking counts toward it
    system: [
      { text: STABLE_PROTOCOL_TEXT, cache: "1h" }, // breakpoint at the end of this block
      { text: PER_PARTY_CONTEXT, cache: "5m" },
    ],
    messages: [{ role: "user", content: turnInput }],
    schema: Output,                    // authoritative validator; the root must be an object
    cacheTail: "5m",                   // optional request-level automatic caching (1 slot)
    timeoutMs: 120_000,                // per attempt
    retryBudget: 1,                    // 0 | 1, in-process retries for transient errors
    totalBudgetMs: 280_000,            // optional: never start a retry that cannot finish in time
    signal,                            // optional AbortSignal
  },
  { transport },                       // optionally { transport, clock } for tests
);

if (result.ok) {
  result.output;   // z.output<typeof Output>
} else {
  result.kind;     // closed FailureKind union
  result.retryable;
  result.usage;    // null only if no response arrived
}
result.meta;       // source, requested/served model, stopReason, messageId, requestId,
                   // schemaFingerprint, attempts[], totalLatencyMs
```

### Result kinds

| kind | response received | `retryable` | retried in-process |
| --- | --- | --- | --- |
| `refusal` | yes (usage kept, `refusal.category/explanation`) | no | no |
| `max_tokens` | yes | yes (raise `maxTokens` or lower `effort`) | no |
| `context_window_exceeded` | yes | no | no |
| `unexpected_stop` (`tool_use`, `pause_turn`, `stop_sequence`, `null`, unknown) | yes | no | no |
| `no_output` (end_turn, no text block; the SDK's `parsed_output === null`) | yes | yes | no |
| `invalid_json` | yes | yes | no |
| `schema_mismatch` (`issuePaths` only) | yes | yes | no |
| `rate_limited` (429), `overloaded` (529), `server_error` (5xx), `conflict` (409), `timeout` (client or 408), `connection` | no | yes | **once**, within `retryBudget` |
| `bad_request` (400/413/422), `auth` (401/403), `not_found` (404), `api_error` (other) | no | no | no |
| `aborted` | no | no | no |

Programming errors in the parameters throw `ModelCallConfigError` before any request is sent. These include `maxTokens` out of range, an unknown effort, a prefill, a first message that is not from the user, a misplaced mid-conversation system message, more than 4 cache breakpoints, a 1h breakpoint after a 5m one, and a non-object schema root. Non-SDK errors thrown by a transport, such as a `TypeError`, are rethrown rather than disguised as API failures.

### Other exports

- `anthropicTransport(client)` accepts any object with `messages.create(body, options)`, either an `Anthropic` instance or a fake. It always sends `maxRetries: 0`, so the wrapper alone owns the retry budget.
- `stubTransport(responder)` and `sequenceResponder([...])` provide the deterministic stub mode. The responder receives the fully built request and returns `{type:"output"}`, `{type:"text", stopReason}`, `{type:"refusal"}` or `{type:"message"}`. To simulate a transport error, it throws an SDK error. Message ids are derived from the request bytes and the call index. The stub uses no clock and no randomness, and its usage is zero unless the reply sets it.
- Helpers: `buildRequest`, `jsonSchemaFor`, `schemaFingerprint`, `validateCacheBreakpoints`, `classifyError`, `retryAfterMsFrom`, `isRetryable`, `toUsageRecord`, `estimateCostMicroUsd` / `LIST_PRICES`. The prices are list prices from the claude-api skill, cached 2026-10-06. They are an estimate, not a bill.

## Design notes

1. **`messages.create` instead of `messages.parse`.** The request still uses `zodOutputFormat(schema)`: its `.schema` goes into `output_config.format`. What changed is the call itself. In SDK 1.1.0, `parse()` throws on truncated JSON, partial refusal text, multiple text blocks and Zod mismatches, and the thrown error discards the whole `Message`, including `usage` and the request id. Source: inputs/04 §4.4 and spikes/anthropic-zod §4.1.5. We check `stop_reason` first, then run `JSON.parse` and `schema.safeParse` ourselves. That way usage is recorded for every response, and the engine can tell `invalid_json` apart from `schema_mismatch`.
2. **Decoding constraints are weaker than the Zod schema.** `zodOutputFormat` moves `enum`, `const`, min/max and similar constraints into description text. This was measured in the spike. The Zod check after the call is therefore the authority. A stricter generator, such as the spike's `toStrictJsonSchema`, can be plugged in through `jsonSchema` without changing this module. `schemaFingerprint` (SHA-256 prefix) records which schema a call used.
3. **One retry budget, owned here.** SDK retries are turned off per request. By default the SDK retries twice, and it retries timeouts too, which would silently triple the worst-case wall clock. Only transient transport failures are retried, at most once, after a jittered `retryBaseDelayMs` or the server's `retry-after`. If `retry-after` is longer than `maxRetryDelayMs`, or if `totalBudgetMs` cannot fit the delay plus another full attempt, no retry happens; the failure is returned with `retryAfterMs` so the caller's scheduler can retry later. Output failures are never retried in-process. They cost a full model call and usually need changed inputs, so `retryable` is only a hint for the engine's attempt layer.
4. **Cache placement is validated, not guessed.** `system[i].cache` puts a breakpoint at the end of that block. Breakpoints that the caller placed inside message content are counted too, along with the optional `cacheTail`. The module enforces the API's limit of 4 breakpoints and its rule that longer-TTL entries come first. Keeping cached text stable (no timestamps or ids) is the caller's job.
5. **Stub results are always labelled.** `meta.source` comes from `transport.kind`, so simulated output cannot be stored as if it were a real model answer (brief core rule 8). Stub output still goes through the same Zod validation.
6. **Log-safe failures.** `detail` never contains model text, prompt text or credentials. Zod failures report only issue paths. `rawText` is returned so it can go to private storage, and must never be logged.
7. **Portable runtime.** The module uses only `fetch`-era globals (`crypto.subtle`, `TextEncoder`, `Headers`) and has no `node:` imports in `src/`. It can therefore run in the default Convex runtime as well as in a Node action.

## How the engine will use it

The design documents are still being written, so this section describes interfaces only.

- A model-calling action builds the prompt from stable to volatile: protocol and scenario rules (`cache: "1h"` or `"5m"`), then the party's private context, then the turn input in `messages`. It calls `callStructured` with the protocol's output schema wrapped in an object envelope.
- It stores `usage`, `meta` (including `servedModel`, `requestId`, `schemaFingerprint` and `attempts`) and `estimateCostMicroUsd(...)` in its usage records whatever the outcome. `rawText` goes to private storage only.
- On `ok: true`, the output is only *shape-valid*. Business rules still run in deterministic code before anything is committed: ids must exist, amounts come from confirmed data, dates must be feasible.
- On failure, the engine's attempt or scheduler layer decides what to do from `kind` and `retryable`. It can reschedule with `retryAfterMs`, change `maxTokens` or `effort` after `max_tokens`, or escalate to a human after `refusal`. Set `timeoutMs` and `totalBudgetMs` so that one call, including its retry, fits inside the hosting action's time limit.
- Tests and the stub mode use `stubTransport` with scenario fixtures, and no network is involved.

## Development

```bash
npm install
npm test          # node:test, Node 24 native type stripping; credentials env vars unset
npm run typecheck # tsc --noEmit, strict
```

Dependencies:

| package | kind | why |
| --- | --- | --- |
| `@anthropic-ai/sdk` 1.1.0 | runtime | The target SDK: typed errors, `zodOutputFormat`, the `Message` and `Usage` types, the real transport. Pinned because the parse and transform behaviour was verified on this exact version. |
| `zod` 4.6.7 | runtime | Schema type and validator. `zodOutputFormat` requires zod v4. Same version as the spike. |
| `typescript` 6.0.3 | dev | strict typecheck |
| `@types/node` 24 | dev | `node:test` / `node:assert` types for tests |

There is no test framework dependency: `node:test` runs `.ts` files directly through Node 24 type stripping.

## Verification

Run on Node v24.21.0, npm 11.19.0, 2026-10-24. No network: every test uses a fake transport, the stub transport, or the real SDK client with an in-process fake `fetch` (`baseURL: http://stub.invalid`, placeholder apiKey).

### `npm test`

```text

> @speak-for-me/model-call@0.1.0 test
> env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_PROFILE -u ANTHROPIC_BASE_URL node --test test/*.test.ts

▶ callStructured: response handling
  ✔ parses the text block after thinking blocks and captures usage (4.791416ms)
  ✔ max_tokens: kept usage and raw text, retryable hint, no in-process retry (0.158167ms)
  ✔ refusal with empty content (parsed_output null case) and with partial text (0.136167ms)
  ✔ end_turn without a text block is no_output (0.068625ms)
  ✔ invalid JSON and schema mismatch are distinguished; issue paths carry no values (0.41225ms)
  ✔ unexpected stop reasons (0.16225ms)
✔ callStructured: response handling (6.218875ms)
▶ callStructured: errors and the single retry budget
  ✔ BadRequestError is not retried (7.73775ms)
  ✔ auth, not_found and 413 are not retried (0.242167ms)
  ✔ rate limit then success: one retry with jittered delay (0.160958ms)
  ✔ 529 twice exhausts the budget and reports retryable overloaded (0.127292ms)
  ✔ 5xx and timeout are retried; retryBudget 0 disables the retry (0.179834ms)
  ✔ honours retry-after when within the cap, otherwise hands it back (0.191459ms)
  ✔ skips the retry when totalBudgetMs cannot fit delay + another attempt (0.060666ms)
  ✔ abort before sending and during the retry wait (0.134667ms)
  ✔ non-SDK errors propagate instead of being disguised as API failures (0.166542ms)
  ✔ config errors reject before the transport is called (0.046792ms)
✔ callStructured: errors and the single retry budget (9.22975ms)
▶ buildRequest: body shape
  ✔ emits only the expected top-level keys (no thinking, sampling, tools, tool_choice) (3.243041ms)
  ✔ uses the zodOutputFormat schema by default, and a provided jsonSchema verbatim (0.294916ms)
  ✔ rejects a non-object schema root (unions must be wrapped) (0.521958ms)
  ✔ copies messages instead of aliasing the caller's array (0.085708ms)
  ✔ omits system when no system blocks are given (0.062833ms)
✔ buildRequest: body shape (4.886542ms)
▶ buildRequest: cache_control placement
  ✔ places breakpoints on the marked system blocks only (0.121083ms)
  ✔ adds request-level cache_control for cacheTail (0.057875ms)
  ✔ allows at most 4 breakpoints, counting system, messages and tail (0.251916ms)
  ✔ enforces longer TTL before shorter TTL in render order (0.137875ms)
✔ buildRequest: cache_control placement (0.781625ms)
▶ buildRequest: validation
  ✔ rejects prefill, empty messages and a non-user first message (0.136958ms)
  ✔ checks mid-conversation system message placement (0.094125ms)
  ✔ bounds maxTokens to the non-streaming limit (0.105875ms)
  ✔ rejects unknown effort, empty model and empty system text (0.0735ms)
✔ buildRequest: validation (0.49125ms)
▶ schemaFingerprint
  ✔ is 16 hex chars and stable for identical schemas (4.287541ms)
✔ schemaFingerprint (4.369667ms)
▶ real SDK client + fake fetch
  ✔ sends exactly the expected body and captures request id and usage (16.795917ms)
  ✔ 400 maps to bad_request with a single HTTP call (0.883375ms)
  ✔ 429 with retry-after is retried once by the wrapper, not by the SDK (0.678667ms)
  ✔ 500 twice: exactly two HTTP calls in total (SDK retries are off) (0.528958ms)
  ✔ 529 maps to overloaded (0.291292ms)
  ✔ client-side timeout maps to timeout (52.900167ms)
✔ real SDK client + fake fetch (72.681667ms)
▶ stubTransport (deterministic stub mode)
  ✔ labels results as stub and derives a stable id from the request (6.05325ms)
  ✔ gives the responder the fully built request (system, messages, schema) (0.403333ms)
  ✔ still validates stub output with Zod and supports refusal/text/error replies (9.155833ms)
  ✔ sequenceResponder fails loudly when the script runs out (0.239333ms)
✔ stubTransport (deterministic stub mode) (16.457458ms)
▶ anthropicTransport with a fake client
  ✔ disables SDK retries and forwards timeout and signal (0.168541ms)
✔ anthropicTransport with a fake client (0.226334ms)
▶ usage helpers
  ✔ falls back to attributing cache writes to 5m when no TTL breakdown is present (0.051792ms)
  ✔ estimates cost in integer micro-USD at list price (0.063417ms)
✔ usage helpers (0.18325ms)
ℹ tests 43
ℹ suites 10
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 191.077833
test exit=0
```

### `npm run typecheck`

```text

> @speak-for-me/model-call@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

typecheck exit=0
```
