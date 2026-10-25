// packages/engine/src/protocol/call-model.ts — create + classify; never messages.parse (see D6).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildMoveSchema, AgentModelOutput, type AgentMove, type MoveSchemaSpec } from "./model-output.ts";
import { toStrictOutputSchema } from "./strict-json-schema.ts";

export const MODEL = "claude-opus-5-5" as const; // whitelist; no silent downgrade
export const EFFORT = "medium" as const;
export const MAX_TOKENS = 8000;
export const MAX_TOKENS_RETRY = 12000; // still < 21,333; our own cap since explicit timeout skips the SDK guard
export const AUTO_RETRY_INVALID_OUTPUT = 1;

export type UsageRecord = {
  attempt: number; model: string; requestId?: string; stopReason: string | null;
  inputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number;
  outputTokens: number; thinkingTokens?: number; latencyMs: number; effort: string;
};
export type Classified =
  | { kind: "ok"; move: AgentMove }
  | { kind: "invalid_output"; errorCode: string; issues: string[]; raiseMaxTokens?: boolean }
  | { kind: "failed"; errorCode: string; retryable: false; refusalCategory?: string | null };

export function outputSchemaFor(spec: MoveSchemaSpec, mode: "strict_enum" | "sdk_transform") {
  const s = buildMoveSchema({ ...spec, strictEnums: true });
  return mode === "strict_enum" ? toStrictOutputSchema(s) : zodOutputFormat(s).schema;
}

/** Pure: classify a Message. `semantic` = validateMoveSemantics bound to the turn input. */
export function classifyResponse(msg: Anthropic.Message, semantic: (m: AgentMove) => string[]): Classified {
  switch (msg.stop_reason) {
    case "end_turn": break;
    case "max_tokens": return { kind: "invalid_output", errorCode: "OUTPUT_TRUNCATED", issues: [], raiseMaxTokens: true };
    case "refusal":
      return { kind: "failed", errorCode: "MODEL_REFUSAL", retryable: false, refusalCategory: msg.stop_details?.category ?? null };
    case "model_context_window_exceeded": return { kind: "failed", errorCode: "CONTEXT_OVERFLOW", retryable: false };
    default: return { kind: "failed", errorCode: "UNEXPECTED_STOP", retryable: false };
  }
  const texts = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text" && b.text.trim() !== "");
  const text = texts.at(-1)?.text;
  if (!text) return { kind: "invalid_output", errorCode: "EMPTY_OUTPUT", issues: [] };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { kind: "invalid_output", errorCode: "INVALID_JSON", issues: [] }; }
  const parsed = AgentModelOutput.safeParse(json);
  if (!parsed.success) {
    return { kind: "invalid_output", errorCode: "SCHEMA_MISMATCH",
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}:${i.code}`) };
  }
  const issues = semantic(parsed.data.move);
  if (issues.length) return { kind: "invalid_output", errorCode: `SEMANTIC_${issues[0]}`, issues };
  return { kind: "ok", move: parsed.data.move };
}

/** One logical turn: up to 1 + AUTO_RETRY_INVALID_OUTPUT HTTP calls, each usage-recorded. */
export async function callModel(args: {
  client: Anthropic; // constructed with explicit { timeout, maxRetries } (10-agent-runtime)
  system: Anthropic.TextBlockParam[];
  context: Anthropic.MessageParam; // role:"user", tagged blocks
  turnInstruction: (retryFeedback: string[]) => string; // rendered into messages[1] role:"system"
  schema: Record<string, unknown>;
  semantic: (m: AgentMove) => string[];
  recordUsage: (u: UsageRecord) => Promise<void>;
}): Promise<{ result: Classified; attempts: number; model?: string }> {
  let feedback: string[] = [];
  let maxTokens = MAX_TOKENS;
  let last: Classified = { kind: "failed", errorCode: "NOT_RUN", retryable: false };
  let model: string | undefined;
  for (let attempt = 1; attempt <= 1 + AUTO_RETRY_INVALID_OUTPUT; attempt++) {
    const t0 = Date.now();
    const msg = await args.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: args.system,
      messages: [args.context, { role: "system", content: args.turnInstruction(feedback) }],
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: args.schema } },
      // no thinking / temperature / top_p / top_k / prefill / forced tool_choice (04 §4.3)
    }); // transport errors propagate to runTurn's catch -> failTurn(TRANSPORT_*)
    model = msg.model;
    const u = msg.usage;
    await args.recordUsage({
      attempt, model: msg.model, requestId: (msg as { _request_id?: string })._request_id ?? undefined,
      stopReason: msg.stop_reason, inputTokens: u.input_tokens,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0, cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      outputTokens: u.output_tokens, thinkingTokens: u.output_tokens_details?.thinking_tokens ?? undefined,
      latencyMs: Date.now() - t0, effort: EFFORT,
    });
    last = classifyResponse(msg, args.semantic);
    if (last.kind !== "invalid_output") return { result: last, attempts: attempt, model };
    feedback = [last.errorCode, ...last.issues];
    if (last.raiseMaxTokens) maxTokens = MAX_TOKENS_RETRY;
  }
  return { result: last, attempts: 1 + AUTO_RETRY_INVALID_OUTPUT, model };
}
