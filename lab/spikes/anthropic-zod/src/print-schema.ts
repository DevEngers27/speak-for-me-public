// Prints the JSON Schemas produced by (a) SDK zodOutputFormat and (b) strictJsonOutputFormat,
// then audits which constraint keywords survive as real keywords vs. get folded into description.
import { writeFileSync } from "node:fs";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ModelTurnOutput, ModelTurnEnvelope, FORBIDDEN_PROPERTY_PATTERN } from "./turn-schema.ts";
import { toStrictJsonSchema } from "./strict-format.ts";

const OUT = new URL("../out/", import.meta.url);
const KEYWORDS = ["enum", "const", "minLength", "maxLength", "pattern", "minItems", "maxItems", "format", "discriminator", "oneOf", "anyOf", "$ref", "$defs", "$schema", "additionalProperties"] as const;

type Json = Record<string, unknown>;
function audit(schema: unknown) {
  const asKeyword: Record<string, number> = {};
  const inDescription: Record<string, number> = {};
  const propNames = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Json;
    for (const k of KEYWORDS) if (k in o) asKeyword[k] = (asKeyword[k] ?? 0) + 1;
    if (typeof o["description"] === "string") {
      for (const k of KEYWORDS) if (o["description"].includes(`${k}:`)) inDescription[k] = (inDescription[k] ?? 0) + 1;
    }
    if (o["properties"] && typeof o["properties"] === "object") for (const p of Object.keys(o["properties"] as Json)) propNames.add(p);
    Object.values(o).forEach(walk);
  };
  walk(schema);
  const forbidden = [...propNames].filter((p) => FORBIDDEN_PROPERTY_PATTERN.test(p));
  const root = schema as Json;
  return { rootType: root["type"] ?? null, rootHasAnyOf: Array.isArray(root["anyOf"]), asKeyword, inDescription, forbiddenPropertyNames: forbidden, bytes: JSON.stringify(schema).length };
}

const variants = {
  "zod-raw-union": z.toJSONSchema(ModelTurnOutput, { reused: "ref" }),
  "sdk-zodOutputFormat-union": zodOutputFormat(ModelTurnOutput).schema,
  "sdk-zodOutputFormat-envelope": zodOutputFormat(ModelTurnEnvelope).schema,
  "strict-union": toStrictJsonSchema(ModelTurnOutput),
  "strict-envelope": toStrictJsonSchema(ModelTurnEnvelope),
};

for (const [name, schema] of Object.entries(variants)) {
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(schema, null, 2));
  console.log(`== ${name}`, JSON.stringify(audit(schema)));
}

// Show the propose branch as emitted by the SDK helper, to read the degradation directly.
const sdk = variants["sdk-zodOutputFormat-union"] as Json;
const branches = (sdk["anyOf"] ?? []) as Json[];
console.log("\n== SDK root keys:", Object.keys(sdk));
console.log("== SDK root description:", JSON.stringify(sdk["description"] ?? null));
console.log("== SDK $defs keys:", Object.keys((sdk["$defs"] ?? {}) as Json));
console.log("== SDK propose branch:\n" + JSON.stringify(branches[0], null, 2));
console.log("== SDK $defs:\n" + JSON.stringify(sdk["$defs"] ?? null, null, 2));
const strict = variants["strict-union"] as Json;
console.log("== STRICT propose branch:\n" + JSON.stringify(((strict["anyOf"] ?? []) as Json[])[0], null, 2));
