import { describe, expect, test } from "vitest";
import { AgentEnvelope, AgentModelOutput, AgentModelOutputRoot, PROTOCOL_VERSION, ProposalTerms } from "../src/protocol.js";

const ok: Record<string, unknown>[] = [
  { action: "propose", includedItemKeys: ["sso_login"], deliveryDate: null, publicRationale: "r" },
  { action: "counter", baseProposalVersion: 1, includedItemKeys: ["sso_login"], deliveryDate: "2026-11-18", publicRationale: "r" },
  { action: "clarify", toRole: "provider", topic: "date", question: "q?" },
  { action: "recommend_accept", proposalVersion: 2, publicRationale: "r" },
  { action: "reject", proposalVersion: 2, reason: "missing_required_scope", publicRationale: "r" },
  { action: "escalate", kind: "needs_tradeoff", toRole: "finance", question: "q?", options: [{ label: "A", includedItemKeys: ["sso_login"] }] },
];

const bad: [string, Record<string, unknown>][] = [
  ["model tries to state a price", { action: "propose", includedItemKeys: ["sso_login"], deliveryDate: null, publicRationale: "r", priceCents: 90_000 }],
  ["model tries to set constraintsVersion", { action: "recommend_accept", proposalVersion: 2, publicRationale: "r", constraintsVersion: 9 }],
  ["unknown action", { action: "accept", proposalVersion: 2 }],
  ["counter without base version", { action: "counter", includedItemKeys: ["sso_login"], deliveryDate: null, publicRationale: "r" }],
  ["propose with empty scope", { action: "propose", includedItemKeys: [], deliveryDate: null, publicRationale: "r" }],
  ["deliveryDate omitted (must be explicit null)", { action: "propose", includedItemKeys: ["sso_login"], publicRationale: "r" }],
  ["calendar-invalid date", { action: "propose", includedItemKeys: ["sso_login"], deliveryDate: "2026-02-30", publicRationale: "r" }],
  ["itemKey not a slug", { action: "propose", includedItemKeys: ["SSO Login"], deliveryDate: null, publicRationale: "r" }],
  ["version 0", { action: "recommend_accept", proposalVersion: 0, publicRationale: "r" }],
  ["fractional version", { action: "recommend_accept", proposalVersion: 1.5, publicRationale: "r" }],
  ["clarify to unknown role", { action: "clarify", toRole: "ceo", topic: "date", question: "q" }],
  ["rationale too long", { action: "recommend_accept", proposalVersion: 1, publicRationale: "x".repeat(1001) }],
];

describe("AgentModelOutput", () => {
  test.each(ok)("accepts $action", (o) => {
    expect(AgentModelOutput.safeParse(o).success).toBe(true);
    expect(AgentModelOutputRoot.safeParse({ turn: o }).success).toBe(true);
  });
  test.each(bad)("rejects: %s", (_n, o) => {
    expect(AgentModelOutput.safeParse(o).success).toBe(false);
  });
});

const envelope = {
  protocolVersion: PROTOCOL_VERSION, envelopeId: "env_1", roomId: "room_1", runId: "run_1", turnIndex: 0, round: 1,
  fromParticipantId: "p_provider", fromRole: "provider", constraintsVersion: 1, catalogVersion: 1, observedProposalVersion: null,
  createdAt: 1_793_000_000_000, source: { kind: "model", model: "claude-opus-5-5", isSimulated: false }, output: ok[0],
};

describe("AgentEnvelope", () => {
  test("valid model envelope", () => expect(AgentEnvelope.safeParse(envelope).success).toBe(true));
  test.each<[string, Record<string, unknown>]>([
    ["stub output must be marked simulated", { source: { kind: "stub", stubName: "s", isSimulated: false } }],
    ["model output cannot claim simulated", { source: { kind: "model", model: "m", isSimulated: true } }],
    ["wrong protocol version", { protocolVersion: "v0" }],
    ["round starts at 1", { round: 0 }],
    ["unknown extra field", { debug: true }],
  ])("rejects: %s", (_n, patch) => {
    expect(AgentEnvelope.safeParse({ ...envelope, ...patch }).success).toBe(false);
  });
});

describe("ProposalTerms", () => {
  test("rejects fractional cents and empty scope", () => {
    const base = { catalogVersion: 1, includedItemKeys: ["sso_login"], deferredItemKeys: [], lineItems: [{ itemKey: "sso_login", priceCents: 50_000, earliestDeliveryDate: "2026-11-13" }],
      additionalCostCents: 50_000, earliestDeliveryDate: "2026-11-13", deliveryDate: "2026-11-13" };
    expect(ProposalTerms.safeParse(base).success).toBe(true);
    expect(ProposalTerms.safeParse({ ...base, additionalCostCents: 500.25 }).success).toBe(false);
    expect(ProposalTerms.safeParse({ ...base, includedItemKeys: [] }).success).toBe(false);
  });
});
