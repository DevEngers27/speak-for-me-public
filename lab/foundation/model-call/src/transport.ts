// Transports: the real SDK-backed one and a deterministic stub. Nothing else in this module
// touches the network.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelRequest, Transport } from "./types.ts";

/** The slice of the SDK client we use; an `Anthropic` instance satisfies it, and so does a fake. */
export interface MessagesClient {
  readonly messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions): PromiseLike<Anthropic.Message>;
  };
}

/**
 * Real transport. SDK-level retries are disabled (`maxRetries: 0`) so that the wrapper owns the
 * single retry budget; otherwise SDK retries (default 2, timeouts included) would multiply the
 * worst-case wall clock invisibly. Credentials are the client's business: construct the client
 * elsewhere from the deployment environment.
 */
export function anthropicTransport(client: MessagesClient): Transport {
  return {
    kind: "anthropic",
    async create(request, options) {
      return await client.messages.create(request, {
        timeout: options.timeoutMs,
        maxRetries: 0,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    },
  };
}

type RefusalCategory = Anthropic.RefusalStopDetails["category"];

/** What a stub responder returns for one call. Throw from the responder to simulate a transport error. */
export type StubReply =
  /** end_turn with `JSON.stringify(output)` as the single text block. */
  | { readonly type: "output"; readonly output: unknown; readonly usage?: Partial<Anthropic.Usage> }
  /** Raw text with an explicit stop_reason (e.g. truncated JSON with "max_tokens"). */
  | {
      readonly type: "text";
      readonly text: string;
      readonly stopReason?: Anthropic.StopReason | null;
      readonly usage?: Partial<Anthropic.Usage>;
    }
  /** stop_reason "refusal"; content empty unless `text` is given. */
  | {
      readonly type: "refusal";
      readonly category?: RefusalCategory;
      readonly explanation?: string | null;
      readonly text?: string;
      readonly usage?: Partial<Anthropic.Usage>;
    }
  /** Full control over the Message (used to test odd shapes). */
  | { readonly type: "message"; readonly message: Anthropic.Message };

export interface StubCall {
  /** 0-based index of this call on this transport instance. */
  readonly index: number;
}

export type StubResponder = (request: ModelRequest, call: StubCall) => StubReply | Promise<StubReply>;

const ZERO_USAGE: Anthropic.Usage = {
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: null,
  input_tokens: 0,
  output_tokens: 0,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: null,
  speed: null,
};

async function stableId(request: ModelRequest, index: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${index}\n${JSON.stringify(request)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

function message(
  id: string,
  model: string,
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason | null,
  usage: Partial<Anthropic.Usage> | undefined,
  stopDetails: Anthropic.RefusalStopDetails | null = null,
): Anthropic.Message {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    container: null,
    diagnostics: null,
    content,
    stop_reason: stopReason,
    stop_details: stopDetails,
    stop_sequence: null,
    usage: { ...ZERO_USAGE, ...usage },
  };
}

function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null };
}

/**
 * Deterministic stub transport: no clock, no randomness, no network. The message id is derived
 * from the request bytes and call index, and usage is zero unless the reply sets it. Every result
 * produced through it is labelled `source: "stub"` by callStructured.
 */
export function stubTransport(responder: StubResponder): Transport {
  let calls = 0;
  return {
    kind: "stub",
    async create(request) {
      const index = calls++;
      const reply = await responder(request, { index });
      if (reply.type === "message") return reply.message;
      const id = `msg_stub_${await stableId(request, index)}`;
      switch (reply.type) {
        case "output":
          return message(id, request.model, [textBlock(JSON.stringify(reply.output))], "end_turn", reply.usage);
        case "text":
          return message(
            id,
            request.model,
            [textBlock(reply.text)],
            reply.stopReason === undefined ? "end_turn" : reply.stopReason,
            reply.usage,
          );
        case "refusal":
          return message(
            id,
            request.model,
            reply.text === undefined ? [] : [textBlock(reply.text)],
            "refusal",
            reply.usage,
            { type: "refusal", category: reply.category ?? null, explanation: reply.explanation ?? null },
          );
      }
    },
  };
}

/** Responder that plays back replies in order; Error items are thrown. Fails loudly when exhausted. */
export function sequenceResponder(items: ReadonlyArray<StubReply | Error>): StubResponder {
  return (_request, { index }) => {
    const item = items[index];
    if (item === undefined) throw new Error(`sequenceResponder: no reply scripted for call #${index}`);
    if (item instanceof Error) throw item;
    return item;
  };
}
