import { describe, expect, test } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  FIXTURE_CATALOG as CAT, FIXTURE_CONSTRAINTS_V1 as C1, FIXTURE_CONSTRAINTS_V2_CUT as C2, FIXTURE_CONSTRAINTS_V3_INFEASIBLE as C3,
} from "../src/fixtures.js";
import { apiSubsetViolations, countConstraintKeywords, toStrictOutputSchema } from "../src/jsonSchema.js";
import { AgentModelOutput, AgentModelOutputRoot, type ScopeChangeConstraints } from "../src/protocol.js";
import { checkProposal } from "../src/rules.js";
import { findBestCombination, stubAgentTurn, wrapStubTurn } from "../src/stubAgent.js";

const ctx = { envelopeId: "env_s1", roomId: "room_1", runId: "run_1", turnIndex: 0, round: 1, fromParticipantId: "p_provider", fromRole: "provider" as const, createdAt: 0 };

describe("stub agent (deterministic, shared schema)", () => {
  test("v1 budget: proposes required + usage_dashboard ($900), not slack_alerts", () => {
    const out = stubAgentTurn({ catalog: CAT, constraints: C1 });
    expect(out).toMatchObject({ action: "propose", includedItemKeys: ["audit_log_export", "sso_login", "usage_dashboard"], deliveryDate: null });
    expect(findBestCombination(CAT, C1)?.result.terms?.additionalCostCents).toBe(90_000);
  });

  test("after cut to $4,800 the stub counters the old proposal with required only (== cap)", () => {
    const out = stubAgentTurn({ catalog: CAT, constraints: C2, currentProposal: { version: 1, includedItemKeys: ["audit_log_export", "sso_login", "usage_dashboard"] } });
    expect(out).toMatchObject({ action: "counter", baseProposalVersion: 1, includedItemKeys: ["audit_log_export", "sso_login"] });
    const b = findBestCombination(CAT, C2)?.result.budget;
    expect(b).toMatchObject({ reasonCode: "budget.within", projectedCommittedCents: 480_000, overByCents: 0 });
  });

  test("current proposal equal to best -> recommend_accept bound to that version", () => {
    const out = stubAgentTurn({ catalog: CAT, constraints: C2, currentProposal: { version: 2, includedItemKeys: ["sso_login", "audit_log_export"] } });
    expect(out).toEqual({ action: "recommend_accept", proposalVersion: 2, publicRationale: expect.any(String) });
  });

  test("no feasible option -> escalate infeasible to finance, never invents agreement", () => {
    const out = stubAgentTurn({ catalog: CAT, constraints: C3 });
    expect(out).toMatchObject({ action: "escalate", kind: "infeasible", toRole: "finance" });
  });

  test("deadline-driven infeasibility escalates to customer", () => {
    const c: ScopeChangeConstraints = { ...C1, constraintsVersion: 4, hardDeadline: "2026-11-14" };
    expect(stubAgentTurn({ catalog: CAT, constraints: c })).toMatchObject({ action: "escalate", toRole: "customer" });
  });

  test("tie-break: equal count prefers higher cost, then lexicographic keys", () => {
    const mk = (total: number): ScopeChangeConstraints => ({ ...C1, hardDeadline: "2026-12-31", budget: { totalBudgetCents: total, committedCents: 400_000 }, preferredItemKeys: ["usage_dashboard", "slack_alerts", "custom_theme"] });
    // headroom 120_000: pairs dashboard+slack = dashboard+theme = 115_000 (tie on count & cost) -> lexicographic picks custom_theme
    expect(findBestCombination(CAT, mk(520_000))?.includedItemKeys).toEqual(["audit_log_export", "custom_theme", "sso_login", "usage_dashboard"]);
    // headroom 110_000: no pair fits; singles dashboard 90_000 < slack = theme 105_000 -> higher cost, then lexicographic
    expect(findBestCombination(CAT, mk(510_000))?.includedItemKeys).toEqual(["audit_log_export", "custom_theme", "sso_login"]);
    // headroom 200_000: all three preferred fit (140_000) -> count wins
    expect(findBestCombination(CAT, mk(600_000))?.includedItemKeys).toHaveLength(5);
  });

  test("determinism: 200 runs produce byte-identical output", () => {
    const first = JSON.stringify(stubAgentTurn({ catalog: CAT, constraints: C1 }));
    for (let i = 0; i < 200; i++) expect(JSON.stringify(stubAgentTurn({ catalog: CAT, constraints: C1 }))).toBe(first);
  });

  test("every stub proposal passes checkProposal when the server derives terms", () => {
    for (const c of [C1, C2]) {
      const out = stubAgentTurn({ catalog: CAT, constraints: c });
      if (out.action !== "propose" && out.action !== "counter") throw new Error("expected proposal");
      expect(checkProposal({ catalog: CAT, constraints: c, draft: { includedItemKeys: out.includedItemKeys, deliveryDate: out.deliveryDate } }).ok).toBe(true);
    }
  });

  test("envelope marks stub output as simulated and carries server versions", () => {
    const env = wrapStubTurn(ctx, { catalog: CAT, constraints: C2 });
    expect(env.source).toEqual({ kind: "stub", stubName: "max-required-preferred-v1", isSimulated: true });
    expect(env.constraintsVersion).toBe(2);
    expect(JSON.stringify(env.output)).not.toMatch(/Cents|price/i);
  });
});

describe("structured output JSON schema (offline)", () => {
  const strict = toStrictOutputSchema(AgentModelOutputRoot);
  const sdk = zodOutputFormat(AgentModelOutputRoot) as unknown as { schema: Record<string, unknown> };
  const samples = [
    stubAgentTurn({ catalog: CAT, constraints: C1 }),
    stubAgentTurn({ catalog: CAT, constraints: C2, currentProposal: { version: 1, includedItemKeys: ["sso_login"] } }),
    stubAgentTurn({ catalog: CAT, constraints: C2, currentProposal: { version: 2, includedItemKeys: ["sso_login", "audit_log_export"] } }),
    stubAgentTurn({ catalog: CAT, constraints: C3 }),
  ].map((turn) => ({ turn }));

  test("SDK 1.1.0 zodOutputFormat drops enum/const into description; strict generator keeps them", () => {
    expect(countConstraintKeywords(sdk.schema as never)).toEqual({ enum: 0, const: 0 });
    expect(countConstraintKeywords(strict.schema)).toEqual({ enum: 5, const: 6 });
  });

  test("jsonSchemaOutputFormat re-strips enum/const unless transform:false", () => {
    const dflt = jsonSchemaOutputFormat(strict.schema as never) as unknown as { schema: Record<string, unknown> };
    const raw = jsonSchemaOutputFormat(strict.schema as never, { transform: false }) as unknown as { schema: Record<string, unknown> };
    expect(countConstraintKeywords(dflt.schema as never)).toEqual({ enum: 0, const: 0 });
    expect(countConstraintKeywords(raw.schema as never)).toEqual({ enum: 5, const: 6 });
  });

  test("strict schema stays inside the documented subset (static check)", () => {
    expect(apiSubsetViolations(strict.schema)).toEqual([]);
    expect(strict.schema.type).toBe("object");
  });

  test("bare discriminated union yields a root without type:object (needs wrapper)", () => {
    const bare = zodOutputFormat(AgentModelOutput) as unknown as { schema: Record<string, unknown> };
    expect(bare.schema.type).toBeUndefined();
    expect(bare.schema.anyOf).toBeDefined();
  });

  test("stub outputs validate against both JSON schemas and zod", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const vStrict = ajv.compile(strict.schema);
    const vSdk = ajv.compile(sdk.schema);
    for (const s of samples) {
      expect(vStrict(s), JSON.stringify(vStrict.errors)).toBe(true);
      expect(vSdk(s), JSON.stringify(vSdk.errors)).toBe(true);
      expect(AgentModelOutputRoot.safeParse(s).success).toBe(true);
    }
  });

  test("strict schema rejects a wrong action literal at decode level; SDK schema does not", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const forged = { turn: { action: "approve", proposalVersion: 1, publicRationale: "r" } };
    expect(ajv.compile(strict.schema)(forged)).toBe(false);
    expect(ajv.compile(sdk.schema)(forged)).toBe(true); // only zod catches it afterwards
    expect(AgentModelOutputRoot.safeParse(forged).success).toBe(false);
  });
});
