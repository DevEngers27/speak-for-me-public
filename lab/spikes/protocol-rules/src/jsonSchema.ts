// Generate a JSON Schema for output_config.format that KEEPS enum/const
// (zodOutputFormat in SDK 1.1.0 moves them into description text) and strips
// keywords outside the documented structured-output subset.
import { z } from "zod";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

const KEEP = new Set([
  "type", "anyOf", "allOf", "description", "title", "properties", "required",
  "additionalProperties", "format", "items", "minItems", "$ref", "$defs", "enum", "const",
]);
export const SUPPORTED_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
]);

export interface StrictSchemaResult {
  schema: JsonObject;
  /** JSON pointers of keywords removed (still enforced by zod safeParse afterwards). */
  dropped: string[];
}

function isObj(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitize(node: Json, path: string, dropped: string[]): Json {
  if (Array.isArray(node)) return node.map((n, i) => sanitize(n, `${path}/${i}`, dropped));
  if (!isObj(node)) return node;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(node)) {
    const p = `${path}/${k}`;
    if (k === "$schema") continue;
    if (k === "oneOf") {
      out.anyOf = sanitize(v, p, dropped);
      continue;
    }
    if (k === "properties" || k === "$defs") {
      const props: JsonObject = {};
      if (isObj(v)) for (const [pk, pv] of Object.entries(v)) props[pk] = sanitize(pv, `${p}/${pk}`, dropped);
      out[k] = props;
      continue;
    }
    if (k === "format") {
      if (typeof v === "string" && SUPPORTED_FORMATS.has(v)) out.format = v;
      else dropped.push(p);
      continue;
    }
    if (k === "minItems") {
      if (v === 0 || v === 1) out.minItems = v;
      else dropped.push(p);
      continue;
    }
    if (!KEEP.has(k)) {
      dropped.push(p);
      continue;
    }
    out[k] = sanitize(v, p, dropped);
  }
  if (out.type === "object" || "properties" in out) out.additionalProperties = false;
  return out;
}

export function toStrictOutputSchema(schema: z.ZodType): StrictSchemaResult {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw", io: "output" }) as Json;
  const dropped: string[] = [];
  const out = sanitize(raw, "", dropped);
  if (!isObj(out)) throw new Error("schema root is not an object");
  return { schema: out, dropped };
}

/** Static check against the documented subset. Returns human-readable violations. */
export function apiSubsetViolations(schema: Json, path = ""): string[] {
  const v: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => v.push(...apiSubsetViolations(s, `${path}/${i}`)));
    return v;
  }
  if (!isObj(schema)) return v;
  for (const k of Object.keys(schema)) if (!KEEP.has(k)) v.push(`${path}: unsupported keyword ${k}`);
  if (schema.type === "object" || "properties" in schema) {
    if (schema.additionalProperties !== false) v.push(`${path}: additionalProperties must be false`);
    const props = isObj(schema.properties) ? Object.keys(schema.properties) : [];
    const req = Array.isArray(schema.required) ? schema.required : [];
    for (const p of props) if (!req.includes(p)) v.push(`${path}: optional property ${p} (API acceptance unverified)`);
  }
  if (typeof schema.minItems === "number" && schema.minItems > 1) v.push(`${path}: minItems > 1`);
  if (typeof schema.format === "string" && !SUPPORTED_FORMATS.has(schema.format)) v.push(`${path}: format ${schema.format}`);
  for (const [k, child] of Object.entries(schema)) {
    if (k === "enum" || k === "const" || k === "required") continue;
    if ((k === "properties" || k === "$defs") && isObj(child)) {
      for (const [pk, pv] of Object.entries(child)) v.push(...apiSubsetViolations(pv, `${path}/${k}/${pk}`));
      continue;
    }
    v.push(...apiSubsetViolations(child, `${path}/${k}`));
  }
  return v;
}

/** Count enum/const keywords (to compare generators). */
export function countConstraintKeywords(schema: Json): { enum: number; const: number } {
  const acc = { enum: 0, const: 0 };
  const walk = (n: Json): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObj(n)) return;
    if ("enum" in n) acc.enum++;
    if ("const" in n) acc.const++;
    for (const [k, c] of Object.entries(n)) if (k !== "enum" && k !== "const") walk(c);
  };
  walk(schema);
  return acc;
}
