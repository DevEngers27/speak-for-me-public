// Runtime probes against an IN-PROCESS FAKE fetch. No network, no real key:
// the client gets a dummy apiKey string and baseURL http://stub.invalid; every HTTP call
// is answered by `fakeFetch` below. Nothing leaves this process.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ModelTurnOutput } from "./turn-schema.ts";
import { toStrictJsonSchema } from "./strict-format.ts";
import { callModel } from "./call-model.ts";

type Captured = { url: string; headers: Record<string, string>; body: any };
const captured: Captured[] = [];
type Responder = (init?: any) => Response | Promise<Response>;
let nextResponses: Responder[] = [];

const fakeFetch = async (url: any, init?: any): Promise<Response> => {
  const h: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (h[k] = v));
  captured.push({ url: String(url), headers: h, body: init?.body ? JSON.parse(String(init.body)) : null });
  const next = nextResponses.shift();
  if (!next) throw new Error("no stub response queued");
  return next(init);
};

const usage = { input_tokens: 1200, output_tokens: 900, cache_creation_input_tokens: 6000, cache_read_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 6000, ephemeral_1h_input_tokens: 0 }, output_tokens_details: { thinking_tokens: 700 },
  server_tool_use: null, service_tier: "standard", speed: "standard", inference_geo: "global" };
function msg(content: unknown[], stop_reason: string, stop_details: unknown = null) {
  return { id: "msg_stub", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, stop_details, usage, container: null, diagnostics: null };
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_stub_1", ...extra } });

const validTurn = { action: "propose", terms: { scopeItemIds: ["scope_sso"], deliveryDate: "2026-12-01" }, publicRationale: "SSO first.", sourceRefs: [{ kind: "catalog_item", refId: "scope_sso" }], noteToPrincipal: null };
const thinking = { type: "thinking", thinking: "", signature: "sig_stub" };
const text = (t: string) => ({ type: "text", text: t, citations: null });

const client = new Anthropic({ apiKey: "offline-dummy-not-a-key", baseURL: "http://stub.invalid", fetch: fakeFetch as any, maxRetries: 0 });
const messages: Anthropic.MessageParam[] = [{ role: "user", content: "ctx" }];
const fmt = zodOutputFormat(ModelTurnOutput);

async function tryParse(label: string, body: unknown) {
  nextResponses.push(json(body));
  try {
    const r = await client.messages.parse({ model: "claude-opus-5-5", max_tokens: 16000, messages, output_config: { effort: "low", format: fmt } });
    console.log(`[parse] ${label}: OK stop=${r.stop_reason} parsed_output=${r.parsed_output === null ? "null" : (r.parsed_output as any).action}`);
  } catch (e) {
    console.log(`[parse] ${label}: THROWS ${(e as Error).constructor.name}: ${(e as Error).message.split("\n")[0]!.slice(0, 140)}`);
  }
}

console.log("=== A. messages.parse() failure semantics");
await tryParse("end_turn + thinking + valid JSON", msg([thinking, text(JSON.stringify(validTurn))], "end_turn"));
await tryParse("max_tokens truncated JSON", msg([thinking, text(JSON.stringify(validTurn).slice(0, 40))], "max_tokens"));
await tryParse("refusal, empty content", msg([], "refusal", { type: "refusal", category: "cyber", explanation: "x" }));
await tryParse("refusal, partial text", msg([text('{"action":"pro')], "refusal", { type: "refusal", category: null, explanation: null }));
await tryParse("end_turn, schema mismatch (action=approve)", msg([text(JSON.stringify({ ...validTurn, action: "approve" }))], "end_turn"));
await tryParse("end_turn, two text blocks", msg([text(JSON.stringify(validTurn)), text("trailing note")], "end_turn"));

console.log("\n=== B. what goes on the wire");
const req = captured[0]!;
console.log("url:", req.url);
console.log("anthropic-version:", req.headers["anthropic-version"]);
console.log("header names:", Object.keys(req.headers).sort().join(","));
console.log("body keys:", Object.keys(req.body));
console.log("output_config keys:", Object.keys(req.body.output_config), "format keys:", Object.keys(req.body.output_config.format));
nextResponses.push(json(msg([text(JSON.stringify(validTurn))], "end_turn")));
const sneaky = { model: "claude-opus-5-5" as const, max_tokens: 1000, messages, temperature: 0 };
await client.messages.create(sneaky);
console.log("non-literal temperature forwarded to body:", "temperature" in captured.at(-1)!.body);

console.log("\n=== C. non-streaming max_tokens guard (fetch calls before/after)");
for (const mt of [21333, 21334, 64000]) {
  const before = captured.length;
  nextResponses.push(json(msg([text(JSON.stringify(validTurn))], "end_turn")));
  try {
    await client.messages.create({ model: "claude-opus-5-5", max_tokens: mt, messages });
    console.log(`max_tokens=${mt}: sent (fetch calls +${captured.length - before})`);
  } catch (e) {
    nextResponses = [];
    console.log(`max_tokens=${mt}: THROWS before fetch=${captured.length === before}: ${(e as Error).message.slice(0, 90)}`);
  }
}

console.log("\n=== D. callModel() classification (stubbed)");
const jsonSchema = toStrictJsonSchema(ModelTurnOutput);
const system: Anthropic.TextBlockParam[] = [{ type: "text", text: "protocol rules", cache_control: { type: "ephemeral" } }];
async function cm(label: string, responses: Responder[], opts: { timeoutMs?: number; maxRetries?: number } = {}) {
  nextResponses = responses;
  const before = captured.length;
  const r = await callModel({ client, schema: ModelTurnOutput, jsonSchema, system, messages, effort: "low", maxRetries: 0, ...opts });
  const attempts = captured.length - before;
  if (r.ok) console.log(`[callModel] ${label}: ok action=${r.output.action} cost=${r.usage.estimatedCostMicroUsd}µ$ thinking=${r.usage.thinkingTokens} reqId=${r.usage.requestId} attempts=${attempts}`);
  else console.log(`[callModel] ${label}: kind=${r.kind} retryable=${r.retryable} usage=${r.usage ? "kept" : "null"} status=${r.httpStatus ?? "-"} paths=${r.issuePaths?.join(",") ?? "-"} attempts=${attempts}`);
}
await cm("valid", [json(msg([thinking, text(JSON.stringify(validTurn))], "end_turn"))]);
await cm("max_tokens", [json(msg([text("{\"action\":")], "max_tokens"))]);
await cm("refusal", [json(msg([], "refusal", { type: "refusal", category: "bio", explanation: "x" }))]);
await cm("schema mismatch", [json(msg([text(JSON.stringify({ ...validTurn, action: "counter" }))], "end_turn"))]);
await cm("invalid json", [json(msg([text("not json")], "end_turn"))]);
await cm("tool_use stop", [json(msg([text("{}")], "tool_use"))]);
await cm("HTTP 400", [json({ type: "error", error: { type: "invalid_request_error", message: "temperature is not supported" } }, 400)]);
await cm("HTTP 429", [json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429)]);
await cm("HTTP 529", [json({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }, 529)]);
const hang: Responder = (init) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
await cm("timeout 50ms", [hang], { timeoutMs: 50 });
await cm("timeout 50ms, maxRetries=1", [hang, hang], { timeoutMs: 50, maxRetries: 1 });
await cm("500 x3 with maxRetries=2", [1, 2, 3].map(() => json({ type: "error", error: { type: "api_error", message: "boom" } }, 500, { "retry-after-ms": "1" })), { maxRetries: 2 });
const sentBody = captured.at(-1)!.body;
console.log("callModel body keys:", Object.keys(sentBody), "thinking" in sentBody ? "(has thinking)" : "(no thinking)");
