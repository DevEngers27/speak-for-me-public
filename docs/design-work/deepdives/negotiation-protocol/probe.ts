// Local probe only (no network). Setup: ln -s /Users/zhennn/cal-hack-2026-main/node_modules node_modules (in this dir). Run: node --experimental-strip-types probe.ts
import { createRequire } from "node:module";
import { z } from "zod/v4";
import { buildMoveSchema, AgentModelOutput, allowedActions } from "./model-output.ts";
import { toStrictOutputSchema } from "./strict-json-schema.ts";

const require = createRequire(import.meta.url);
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");

const spec = {
  allowedActions: allowedActions("customer", "evaluate"),
  optionKeys: ["O1", "O2", "O3"],
  clarifyTargets: ["provider", "finance"],
  itemKeys: ["LOGIN", "REPORTS", "EXPORT"],
  termIds: ["RUSH"],
  strictEnums: true,
} as const;
const strictSchema = buildMoveSchema(spec);
const ours = toStrictOutputSchema(strictSchema);
const sdk = zodOutputFormat(strictSchema).schema;

const s = (o: unknown) => JSON.stringify(o);
console.log("OURS bytes", s(ours).length, "SDK bytes", s(sdk).length);
console.log("OURS root keys", Object.keys(ours), "move keys", Object.keys((ours as any).properties.move));
const counterOurs = (ours as any).properties.move.anyOf.find((v: any) => v.properties.action.const === "counter");
const counterSdk = (sdk as any).properties.move.anyOf.find((v: any) => /counter/.test(v.properties.action.description ?? ""));
console.log("OURS counter", s(counterOurs));
console.log("SDK  counter", s(counterSdk));
const clarOurs = (ours as any).properties.move.anyOf.find((v: any) => v.properties.action.const === "clarify");
console.log("OURS clarify.question", s(clarOurs.properties.question).slice(0, 600));
const containsUnsupported = /"(minLength|maxLength|pattern|minimum|maximum|oneOf)"/.test(s(ours));
console.log("OURS has unsupported keywords:", containsUnsupported, "has $ref:", s(ours).includes("$ref"));

// post-parse validation cases
const cases: Record<string, unknown> = {
  ok_counter: { move: { action: "counter", optionKey: "O2", rationale: "Keeps REPORTS." } },
  echo_version: { move: { action: "recommend_accept", rationale: "ok", proposalVersion: 3 } },
  propose_with_amount: { move: { action: "propose", optionKey: "O1", rationale: "x", amountCents: 90000 } },
  bare_union_root: { action: "recommend_accept", rationale: "ok" },
  tradeoff_one_option: { move: { action: "request_tradeoff", axis: "scope_vs_date", optionKeys: ["O1"], rationale: "x" } },
  bad_date: { move: { action: "clarify", targetRole: "provider", question: { topic: "date_acceptable", deliveryDate: "2026-13-40" }, rationale: "x" } },
  long_rationale: { move: { action: "recommend_accept", rationale: "a".repeat(1300) } },
};
for (const [k, v] of Object.entries(cases)) {
  const r = AgentModelOutput.safeParse(v);
  console.log(k, r.success ? "PASS" : "FAIL " + r.error.issues.map((i) => `${i.path.join(".")}:${i.code}`).join(","));
}
const st = strictSchema.safeParse({ move: { action: "counter", optionKey: "O9", rationale: "x" } });
console.log("strict enum O9", st.success ? "PASS" : "FAIL");
const prov = toStrictOutputSchema(buildMoveSchema({ ...spec, allowedActions: allowedActions("provider", "draft") }));
console.log("provider draft actions", (prov as any).properties.move.anyOf.map((v: any) => v.properties.action.const));
