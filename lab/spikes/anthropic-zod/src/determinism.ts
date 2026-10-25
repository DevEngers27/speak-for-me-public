// Is the generated schema byte-stable (matters for the API's 24h schema/grammar cache and prompt cache)?
import { createHash } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ModelTurnOutput } from "./turn-schema.ts";
import { toStrictJsonSchema } from "./strict-format.ts";
const h = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const t0 = performance.now();
const a = zodOutputFormat(ModelTurnOutput).schema;
const t1 = performance.now();
const b = zodOutputFormat(ModelTurnOutput).schema;
const s1 = toStrictJsonSchema(ModelTurnOutput), s2 = toStrictJsonSchema(ModelTurnOutput);
console.log(`sdk hash ${h(a)} == ${h(b)}: ${h(a) === h(b)}; first build ${(t1 - t0).toFixed(1)}ms`);
console.log(`strict hash ${h(s1)} == ${h(s2)}: ${h(s1) === h(s2)}`);
