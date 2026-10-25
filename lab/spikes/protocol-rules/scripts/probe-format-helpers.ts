// Offline only: inspects SDK helper behavior, no network.
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AgentModelOutput, AgentModelOutputRoot } from "../src/protocol.js";
import { countConstraintKeywords, toStrictOutputSchema } from "../src/jsonSchema.js";

const strict = toStrictOutputSchema(AgentModelOutputRoot).schema;
const fDefault = jsonSchemaOutputFormat(strict as any) as any;
const fNoTransform = jsonSchemaOutputFormat(strict as any, { transform: false } as any) as any;
console.log("jsonSchemaOutputFormat(default) enum/const:", countConstraintKeywords(fDefault.schema));
console.log("jsonSchemaOutputFormat(transform:false) enum/const:", countConstraintKeywords(fNoTransform.schema));
try { jsonSchemaOutputFormat(toStrictOutputSchema(AgentModelOutput).schema as any); console.log("bare union accepted by jsonSchemaOutputFormat"); }
catch (e) { console.log("bare union rejected by jsonSchemaOutputFormat:", (e as Error).message); }
const z = zodOutputFormat(AgentModelOutputRoot) as any;
const good = JSON.stringify({ turn: { action: "recommend_accept", proposalVersion: 1, publicRationale: "r" } });
const forged = JSON.stringify({ turn: { action: "recommend_accept", proposalVersion: 1, publicRationale: "r", priceCents: 1 } });
console.log("zodOutputFormat.parse(good):", JSON.stringify(z.parse(good)));
try { z.parse(forged); console.log("forged accepted"); } catch (e) { console.log("zodOutputFormat.parse(forged) throws:", (e as Error).constructor.name, (e as Error).message.slice(0, 120)); }
