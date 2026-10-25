// Alternative to the SDK's zodOutputFormat(): keeps `enum` and `const` (both are in the
// API's supported JSON Schema subset) so the decoder can enforce them, and moves only
// truly unsupported keywords into `description` (same convention as the SDK).
// Validation of the moved keywords still happens client-side via Zod safeParse.
import { z } from "zod";
import { AnthropicError } from "@anthropic-ai/sdk";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";

const SUPPORTED_STRING_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
]);

type Json = Record<string, unknown>;

function strictify(input: Json, isRoot: boolean): Json {
  const s: Json = { ...input };
  const out: Json = {};
  const take = (k: string) => {
    const v = s[k];
    delete s[k];
    return v;
  };
  if (isRoot) delete s["$schema"]; // meta keyword, not a constraint
  const defs = take("$defs") as Record<string, Json> | undefined;
  if (defs) out["$defs"] = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, strictify(v, false)]));
  const ref = take("$ref");
  if (ref !== undefined) {
    out["$ref"] = ref;
    return out;
  }
  const type = take("type");
  const anyOf = take("anyOf") as Json[] | undefined;
  const oneOf = take("oneOf") as Json[] | undefined;
  const allOf = take("allOf") as Json[] | undefined;
  if (anyOf) out["anyOf"] = anyOf.map((v) => strictify(v, false));
  else if (oneOf) out["anyOf"] = oneOf.map((v) => strictify(v, false));
  else if (allOf) out["allOf"] = allOf.map((v) => strictify(v, false));
  if (type !== undefined) out["type"] = type;
  for (const k of ["enum", "const", "description", "title"]) {
    const v = take(k);
    if (v !== undefined) out[k] = v;
  }
  if (type === "object") {
    const props = (take("properties") ?? {}) as Record<string, Json>;
    out["properties"] = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictify(v, false)]));
    take("additionalProperties");
    out["additionalProperties"] = false;
    const required = take("required");
    if (required !== undefined) out["required"] = required;
  } else if (type === "string") {
    const format = take("format");
    if (typeof format === "string" && SUPPORTED_STRING_FORMATS.has(format)) {
      out["format"] = format;
      delete s["pattern"]; // zod emits a redundant regex next to format; the format already constrains it
    } else if (format !== undefined) s["format"] = format;
  } else if (type === "array") {
    const items = take("items") as Json | undefined;
    if (items) out["items"] = strictify(items, false);
    const minItems = take("minItems");
    if (minItems === 0 || minItems === 1) out["minItems"] = minItems;
    else if (minItems !== undefined) s["minItems"] = minItems;
  }
  const rest = Object.entries(s);
  if (rest.length > 0) {
    const hint = "{" + rest.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") + "}";
    out["description"] = out["description"] ? `${String(out["description"])}\n\n${hint}` : hint;
  }
  return out;
}

/** JSON Schema for output_config.format, keeping enum/const. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", reused: "inline", unrepresentable: "throw" });
  return strictify(raw as Json, true);
}

/** Plain format object for messages.create() (no parse function attached). */
export function strictJsonOutputFormat(schema: z.ZodType): { type: "json_schema"; schema: Json } {
  return { type: "json_schema", schema: toStrictJsonSchema(schema) };
}

/** Same, but with a Zod-backed parse() so it can be used with messages.parse(). */
export function strictZodOutputFormat<T extends z.ZodType>(schema: T): AutoParseableOutputFormat<z.infer<T>> {
  return {
    type: "json_schema",
    schema: toStrictJsonSchema(schema),
    parse(content: string): z.infer<T> {
      const r = schema.safeParse(JSON.parse(content));
      if (!r.success) throw new AnthropicError(`structured output failed validation: ${r.error.issues.length} issue(s)`);
      return r.data;
    },
  };
}
