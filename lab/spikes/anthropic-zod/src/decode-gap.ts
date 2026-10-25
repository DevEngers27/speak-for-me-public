// Offline approximation of "what the constrained decoder would allow": validate candidate
// payloads with Ajv (draft 2020-12) against each generated schema, then with Zod.
// A payload that passes a schema but fails Zod is a guaranteed client-side schema_mismatch.
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ModelTurnOutput } from "./turn-schema.ts";
import { toStrictJsonSchema } from "./strict-format.ts";

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
const vSdk = ajv.compile(zodOutputFormat(ModelTurnOutput).schema);
const vStrict = ajv.compile(toStrictJsonSchema(ModelTurnOutput));

const terms = { scopeItemIds: ["scope_sso"], deliveryDate: "2026-12-01" };
const refs = [{ kind: "catalog_item", refId: "scope_sso" }];
const payloads: Record<string, unknown> = {
  "valid propose": { action: "propose", terms, publicRationale: "SSO first.", sourceRefs: refs, noteToPrincipal: null },
  "counter missing baseProposalId": { action: "counter", terms, publicRationale: "x", sourceRefs: refs, noteToPrincipal: null },
  "unknown action 'approve'": { action: "approve", proposalId: "prop_1", publicRationale: "ok", noteToPrincipal: null },
  "reject with bad reasonCode": { action: "reject", proposalId: "prop_1", reasonCode: "too_expensive", publicRationale: "x", noteToPrincipal: null },
  "clarify addressee 'cfo'": { action: "clarify", addressee: "cfo", questions: [{ topic: "budget", question: "?" }], noteToPrincipal: null },
  "tradeoff with 1 option": { action: "request_tradeoff", addressee: "finance", question: "?", options: [{ label: "A", terms, consequence: "c" }], noteToPrincipal: null },
  "publicRationale 2000 chars": { action: "recommend_accept", proposalId: "prop_1", publicRationale: "y".repeat(2000), noteToPrincipal: null },
  "amount smuggled as extra key": { action: "propose", terms: { ...terms, priceUsd: 9000 }, publicRationale: "x", sourceRefs: refs, noteToPrincipal: null },
};

for (const [name, p] of Object.entries(payloads)) {
  const zod = ModelTurnOutput.safeParse(p);
  console.log(
    `${name.padEnd(34)} sdkSchema=${vSdk(p) ? "ACCEPT" : "reject"}  strictSchema=${vStrict(p) ? "ACCEPT" : "reject"}  zod=${zod.success ? "ok" : "FAIL(" + zod.error.issues.map((i) => i.path.join(".") || "<root>").join(",") + ")"}`,
  );
}
