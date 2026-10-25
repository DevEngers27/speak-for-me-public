// Offline only: generates JSON schemas, never calls the API.
import { writeFileSync } from "node:fs";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AgentModelOutput, AgentModelOutputRoot } from "../src/protocol.js";
import { apiSubsetViolations, countConstraintKeywords, toStrictOutputSchema } from "../src/jsonSchema.js";

const sdkRoot = zodOutputFormat(AgentModelOutputRoot) as unknown as { type: string; schema: Record<string, unknown> };
const strictRoot = toStrictOutputSchema(AgentModelOutputRoot);
writeFileSync("out/sdk-zodOutputFormat.root.json", JSON.stringify(sdkRoot.schema, null, 2));
writeFileSync("out/strict.root.json", JSON.stringify(strictRoot.schema, null, 2));
console.log("sdk format type:", sdkRoot.type);
console.log("sdk root keys:", Object.keys(sdkRoot.schema));
console.log("sdk enum/const count:", countConstraintKeywords(sdkRoot.schema as never));
console.log("strict enum/const count:", countConstraintKeywords(strictRoot.schema));
console.log("strict dropped keywords:", strictRoot.dropped.length, strictRoot.dropped.slice(0, 8));
console.log("strict subset violations:", apiSubsetViolations(strictRoot.schema));
console.log("sdk subset violations:", apiSubsetViolations(sdkRoot.schema as never).slice(0, 5));
try {
  const bare = zodOutputFormat(AgentModelOutput) as unknown as { schema: Record<string, unknown> };
  console.log("sdk bare-union root keys:", Object.keys(bare.schema), "type" in bare.schema ? bare.schema.type : "(no type)");
} catch (e) {
  console.log("sdk bare-union threw:", (e as Error).message);
}
const turnSchema = (sdkRoot.schema as any).properties.turn;
console.log("sdk propose.action:", JSON.stringify(turnSchema.anyOf?.[0]?.properties?.action));
console.log("strict propose.action:", JSON.stringify((strictRoot.schema as any).properties.turn.anyOf?.[0]?.properties?.action));
console.log("strict propose.deliveryDate:", JSON.stringify((strictRoot.schema as any).properties.turn.anyOf?.[0]?.properties?.deliveryDate));
console.log("sdk counter.baseProposalVersion:", JSON.stringify(turnSchema.anyOf?.[1]?.properties?.baseProposalVersion));
console.log("strict size bytes:", JSON.stringify(strictRoot.schema).length, "sdk size bytes:", JSON.stringify(sdkRoot.schema).length);
