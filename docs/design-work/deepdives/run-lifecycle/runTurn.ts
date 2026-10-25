// convex/agentRuntimeAction.ts (sketch). Default runtime first; move to a "use node" file only if
// inputs/04 pending #4 fails (then internal mutations must live in another file).
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { TURN_BUDGET, sdkRequestOptions } from "./agentRuntime/budget";
import { buildTurnRequest } from "./agentRuntime/prompt"; // 10: pure, depends only on zod + sdk types
import { agentModelOutput } from "./lib/protocol"; // 05: Zod schema for model output
import { stubAgent } from "./agentRuntime/stub"; // pure deterministic stub (F10.7)
import type { TurnErrorCode } from "./lib/state";

const MODEL = "claude-opus-5-5"; // whitelisted in modelConfig (F10.10); effort is explicit per call site

export const runTurn = internalAction({
  args: { turnId: v.id("agentTurns") },
  returns: v.null(),
  handler: async (ctx, { turnId }) => {
    // 1) Early-out: returns null if the turn is no longer running or guards already fail (replaces scheduler.cancel, D7).
    //    Returns only the context 07 allows for THIS role (private brief of this role, shared facts, candidates).
    const tc = await ctx.runQuery(internal.agentRuntime.loadTurnContext, { turnId });
    if (tc === null) return null;

    const startedAt = Date.now();
    try {
      // 2) Mode + kill switch (re-checked here so flipping AGENTS_ENABLED takes effect mid-run).
      if (tc.agentMode === "stub") {
        const output = stubAgent(tc); // same schema as live output
        await ctx.runMutation(internal.agentRuntime.completeTurn, {
          turnId, output, usage: { mode: "stub", modelRequested: "stub:v1", maxTokens: 0, latencyMs: Date.now() - startedAt },
        });
        return null;
      }
      if (process.env.AGENTS_ENABLED !== "true") {
        await fail(ctx, turnId, "agents_disabled");
        return null;
      }

      // 3) One logical call. SDK owns transport retries; AbortSignal bounds the whole call (D3).
      const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: TURN_BUDGET.sdkMaxRetries, timeout: TURN_BUDGET.sdkTimeoutMs,
      });
      const req = buildTurnRequest(tc, { model: MODEL, maxTokens: TURN_BUDGET.turnMaxTokens }); // output_config.effort + format; no temperature/prefill/tool_choice
      let msg: Anthropic.Message;
      try {
        msg = await client.messages.create(req, sdkRequestOptions());
      } catch (e) {
        await fail(ctx, turnId, classifySdkError(e), { latencyMs: Date.now() - startedAt }, httpStatusOf(e));
        return null;
      }
      const usage = usageFromMessage(msg, req.max_tokens, Date.now() - startedAt);

      // 4) stop_reason first (04 §4.5), then our own safeParse — never messages.parse() (it throws and loses usage).
      if (msg.stop_reason === "refusal") return void (await fail(ctx, turnId, "refusal", usage));
      if (msg.stop_reason === "max_tokens") return void (await fail(ctx, turnId, "max_tokens", usage));
      if (msg.stop_reason !== "end_turn") return void (await fail(ctx, turnId, "schema_invalid", usage));
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      let json: unknown;
      try { json = JSON.parse(text); } catch { return void (await fail(ctx, turnId, "schema_invalid", usage)); }
      const parsed = agentModelOutput.safeParse(json);
      if (!parsed.success) return void (await fail(ctx, turnId, "schema_invalid", usage));

      // 5) Single commit. Business validation + guards happen inside completeTurn (one transaction).
      await ctx.runMutation(internal.agentRuntime.completeTurn, { turnId, output: parsed.data, usage });
    } catch (e) {
      // completeTurn/failTurn threw (bug, schema mismatch). Do NOT call the model again in this action.
      // If this failTurn also throws, the watchdog will fail the turn later.
      await ctx.runMutation(internal.agentRuntime.failTurn, { turnId, errorCode: "internal_error" }).catch(() => {});
    }
    return null;
  },
});

async function fail(ctx: any, turnId: any, errorCode: TurnErrorCode, usage?: object, httpStatus?: number) {
  await ctx.runMutation(internal.agentRuntime.failTurn, { turnId, errorCode, usage, httpStatus });
}

function classifySdkError(e: unknown): TurnErrorCode {
  if (e instanceof Anthropic.BadRequestError) return "bad_request"; // 400: programming error, never retried
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "auth_error";
  return "api_error"; // 429/5xx/timeout/connection after SDK retries, or AbortSignal fired
}
function httpStatusOf(e: unknown): number | undefined {
  return e instanceof Anthropic.APIError ? e.status : undefined;
}

function usageFromMessage(msg: Anthropic.Message, maxTokens: number, latencyMs: number) {
  const u = msg.usage;
  return {
    mode: "live" as const,
    modelRequested: MODEL,
    modelActual: msg.model,
    maxTokens,
    stopReason: msg.stop_reason ?? undefined,
    requestId: (msg as any)._request_id ?? undefined, // non-enumerable on the returned object (04 §4.6)
    messageId: msg.id,
    inputTokens: u.input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: u.cache_read_input_tokens ?? undefined,
    outputTokens: u.output_tokens,
    thinkingTokens: (u as any).output_tokens_details?.thinking_tokens ?? undefined,
    latencyMs,
  };
}
