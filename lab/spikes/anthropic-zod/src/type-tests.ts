// Type-level probes. Never executed against the API: every call sits inside a function
// that is only type-checked (`tsc --noEmit`). `@ts-expect-error` lines MUST error,
// otherwise tsc reports "Unused '@ts-expect-error' directive".
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ModelTurnOutput } from "./turn-schema.ts";
import { ModelTurnOutput as TurnSchema } from "./turn-schema.ts";
import { strictZodOutputFormat, strictJsonOutputFormat } from "./strict-format.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const client: Anthropic;
const messages: Anthropic.MessageParam[] = [{ role: "user", content: "turn context" }];

export async function probes() {
  const format = zodOutputFormat(TurnSchema);

  // 1. The exact call from the task: compiles.
  const res = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    messages,
    output_config: { effort: "low", format },
  });
  type _parsed = Expect<Equal<typeof res.parsed_output, ModelTurnOutput | null>>;
  type _stop = Expect<Equal<typeof res.stop_reason, Anthropic.StopReason | null>>;
  type _stopEnum = Expect<
    Equal<Anthropic.StopReason, "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal" | "model_context_window_exceeded">
  >;
  type _cat = Expect<
    Equal<NonNullable<typeof res.stop_details>["category"], "cyber" | "bio" | "frontier_llm" | "reasoning_extraction" | "general_harms" | null>
  >;
  type _reqId = Expect<Equal<typeof res._request_id, string | null | undefined>>;

  // parsed_output narrows by discriminator.
  const out = res.parsed_output;
  if (out?.action === "counter") {
    const base: string = out.baseProposalId;
    void base;
  }
  // @ts-expect-error -- not on the propose branch
  if (out?.action === "propose") void out.baseProposalId;

  // Exhaustive switch over stop_reason (fails to compile if the SDK adds a member).
  switch (res.stop_reason) {
    case "end_turn": case "max_tokens": case "stop_sequence": case "tool_use":
    case "pause_turn": case "refusal": case "model_context_window_exceeded": case null:
      break;
    default: {
      const never: never = res.stop_reason;
      void never;
    }
  }

  // 2. thinking: adaptive compiles; disabled / budget_tokens ALSO compile (400 at runtime on Opus 5.5).
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "adaptive" } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "adaptive", display: "summarized" } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "disabled" } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "enabled", budget_tokens: 2048 } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "between_tools" } });
  // @ts-expect-error -- display 'updates' is beta-only, not in 1.1.0 non-beta types
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, thinking: { type: "adaptive", display: "updates" } });

  // 3. Sampling params are gone from the type (excess property check on literals).
  // @ts-expect-error -- temperature removed
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, temperature: 0 });
  // @ts-expect-error -- top_p removed
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, top_p: 0.9 });
  // @ts-expect-error -- top_k removed
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, top_k: 5 });
  // ...but a non-literal object bypasses the excess-property check (structural typing):
  const sneaky = { model: "claude-opus-5-5" as const, max_tokens: 16000, messages, temperature: 0 };
  await client.messages.create(sneaky);

  // 4. Forced tool_choice compiles (400 on Opus 5.5 at runtime).
  const tools: Anthropic.Tool[] = [{ name: "t", input_schema: { type: "object", properties: {} } }];
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, tools, tool_choice: { type: "any" } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, tools, tool_choice: { type: "tool", name: "t" } });
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, tools, tool_choice: { type: "auto", disable_parallel_tool_use: true } });

  // 5. effort enum is enforced; output_format (deprecated) is not in the type.
  // @ts-expect-error -- not an effort level
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, output_config: { effort: "minimal" } });
  // @ts-expect-error -- output_format removed from 1.1.0 params
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages, output_format: format });

  // 6. Model is `KnownModel | (string & {})`: a typo still compiles.
  await client.messages.create({ model: "claude-opus-5.5", max_tokens: 16000, messages });

  // 7. Prefill compiles (400 at runtime on Opus 5.5).
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages: [...messages, { role: "assistant", content: "{" }] });

  // 8. Mid-conversation system message is typed.
  await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages: [...messages, { role: "system", content: "operator note" }] });

  // 9. Strict format helper works with parse() and keeps the inferred type.
  const res2 = await client.messages.parse({ model: "claude-opus-5-5", max_tokens: 16000, messages, output_config: { effort: "medium", format: strictZodOutputFormat(TurnSchema) } });
  type _parsed2 = Expect<Equal<typeof res2.parsed_output, ModelTurnOutput | null>>;
  // Plain format (no parse fn) with parse(): parsed_output is typed `null`.
  const res3 = await client.messages.parse({ model: "claude-opus-5-5", max_tokens: 16000, messages, output_config: { format: strictJsonOutputFormat(TurnSchema) } });
  type _parsed3 = Expect<Equal<typeof res3.parsed_output, null>>;

  // 10. Server-side fallback ("default") + structured output: type-checks on beta.messages.
  const b = await client.beta.messages.create({
    model: "claude-opus-5-5", max_tokens: 16000, messages,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: format.schema } },
  });
  type _bstop = Expect<Equal<typeof b.stop_reason, Anthropic.Beta.BetaStopReason | null>>;
  const iters = b.usage.iterations; void iters;

  // 11. Usage fields used by callModel.
  const u = res.usage;
  const n: number | undefined = u.output_tokens_details?.thinking_tokens;
  const c5: number | undefined = u.cache_creation?.ephemeral_5m_input_tokens;
  void n; void c5;
}
