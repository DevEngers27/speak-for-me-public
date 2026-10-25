// Per-construct matrix: Zod 4 construct -> SDK zodOutputFormat output vs strict generator output.
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { toStrictJsonSchema } from "./strict-format.ts";

const cases: Record<string, z.ZodType> = {
  "literal": z.literal("propose"),
  "enum": z.enum(["a", "b"]),
  "string.min(1).max(600)": z.string().min(1).max(600),
  "string.regex": z.string().regex(/^[a-z]+$/),
  "iso.date": z.iso.date(),
  "iso.datetime": z.iso.datetime(),
  "string.nullable": z.string().nullable(),
  "optional field": z.object({ a: z.string(), b: z.string().optional() }),
  "array.min(2).max(3)": z.array(z.string()).min(2).max(3),
  "array.min(1)": z.array(z.string()).min(1),
  "int.min(0)": z.number().int().min(0),
  "record(string,string)": z.record(z.string(), z.string()),
  "object (non-strict)": z.object({ a: z.string() }),
  "union of literals": z.union([z.literal("x"), z.literal("y")]),
  "default('x')": z.object({ a: z.string().default("x") }),
};

for (const [name, schema] of Object.entries(cases)) {
  const wrapped = z.object({ v: schema });
  let sdk: unknown;
  try {
    sdk = (zodOutputFormat(wrapped).schema as { properties: Record<string, unknown> }).properties["v"];
  } catch (e) {
    sdk = `THROWS: ${(e as Error).message}`;
  }
  const strict = (toStrictJsonSchema(wrapped) as { properties: Record<string, unknown> }).properties["v"];
  console.log(`## ${name}\n  sdk:    ${JSON.stringify(sdk)}\n  strict: ${JSON.stringify(strict)}`);
}
