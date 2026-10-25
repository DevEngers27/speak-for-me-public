// packages/engine/src/protocol/strict-json-schema.ts
// Our own Zod -> JSON Schema transform for output_config.format.
// Differs from SDK 1.1.0 transformJSONSchema in ONE way: it keeps `enum` and
// `const` (listed as supported by the API's structured-output subset) so the
// action discriminator and per-turn optionKeys are decoder-constrained.
// Everything the API does not support is moved into `description`, like the SDK.
// Fallback: OUTPUT_SCHEMA_MODE=sdk_transform uses zodOutputFormat(...).schema.
import { z } from "zod/v4";

const SUPPORTED_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
]);

type Json = Record<string, unknown>;

export function toStrictOutputSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { reused: "ref", target: "draft-2020-12" }) as Json;
  delete raw.$schema;
  return strict(raw);
}

function strict(node: Json): Json {
  const src: Json = { ...node };
  const out: Json = {};
  const take = (k: string) => { const v = src[k]; delete src[k]; return v; };

  const defs = take("$defs") as Record<string, Json> | undefined;
  if (defs) out.$defs = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, strict(v)]));
  const ref = take("$ref");
  if (ref !== undefined) { out.$ref = ref; return out; }

  const anyOf = (take("anyOf") ?? take("oneOf")) as Json[] | undefined;
  const allOf = take("allOf") as Json[] | undefined;
  const type = take("type");
  if (anyOf) out.anyOf = anyOf.map(strict);
  else if (allOf) out.allOf = allOf.map(strict);
  else out.type = type;

  for (const k of ["description", "title", "enum", "const"]) {
    const v = take(k);
    if (v !== undefined) out[k] = v;
  }
  if (type === "object") {
    const props = (take("properties") ?? {}) as Record<string, Json>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strict(v)]));
    take("additionalProperties");
    out.additionalProperties = false;
    const req = take("required");
    if (req !== undefined) out.required = req;
  } else if (type === "string") {
    const f = take("format") as string | undefined;
    if (f && SUPPORTED_FORMATS.has(f)) { out.format = f; delete src.pattern; } // format already implies the pattern
    else if (f) src.format = f;
  } else if (type === "array") {
    const items = take("items") as Json | undefined;
    if (items) out.items = strict(items);
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) src.minItems = minItems;
  }
  const rest = Object.entries(src);
  if (rest.length > 0) {
    const extra = "{" + rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") + "}";
    out.description = out.description ? `${out.description}\n\n${extra}` : extra;
  }
  return out;
}
