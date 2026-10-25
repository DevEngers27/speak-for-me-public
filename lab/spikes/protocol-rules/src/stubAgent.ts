// Deterministic stub agent. Shares the exact output schema with the real model
// (AgentModelOutput) and uses the same rules engine to judge feasibility.
// It never emits amounts or dates it did not get from the catalog.
import { AgentEnvelope, AgentModelOutput, PROTOCOL_VERSION, type Catalog, type Role, type ScopeChangeConstraints } from "./protocol.js";
import { checkProposal, type CheckProposalResult } from "./rules.js";
import type { ReasonCode } from "./reasonCodes.js";

export const MAX_PREFERRED_FOR_ENUMERATION = 12; // 2^12 = 4096 rule evaluations, still trivial

export interface StubInput {
  catalog: Catalog;
  constraints: ScopeChangeConstraints;
  /** Current proposal the stub sees (only its version and scope). */
  currentProposal?: { version: number; includedItemKeys: readonly string[] };
}

export interface BestCombination {
  includedItemKeys: string[];
  result: CheckProposalResult;
}

/**
 * Largest feasible required ∪ subset(preferred), ranked by
 *   1) number of preferred items (desc), 2) additional cost (desc, use the budget),
 *   3) lexicographic order of the sorted key list (asc) as the final tie-break.
 */
export function findBestCombination(catalog: Catalog, constraints: ScopeChangeConstraints): BestCombination | null {
  const required = [...new Set(constraints.requiredItemKeys)].sort();
  const preferred = [...new Set(constraints.preferredItemKeys)].filter((k) => !required.includes(k)).sort();
  if (preferred.length > MAX_PREFERRED_FOR_ENUMERATION) {
    throw new Error(`stub: too many preferred items (${preferred.length})`);
  }
  let best: { keys: string[]; count: number; cost: number; result: CheckProposalResult } | null = null;
  for (let mask = 0; mask < 1 << preferred.length; mask++) {
    const subset = preferred.filter((_, i) => (mask & (1 << i)) !== 0);
    const keys = [...required, ...subset].sort();
    if (keys.length === 0) continue;
    const result = checkProposal({ catalog, constraints, draft: { includedItemKeys: keys, deliveryDate: null } });
    if (!result.ok || result.terms === null) continue;
    const cand = { keys, count: subset.length, cost: result.terms.additionalCostCents, result };
    if (
      best === null ||
      cand.count > best.count ||
      (cand.count === best.count && cand.cost > best.cost) ||
      (cand.count === best.count && cand.cost === best.cost && cand.keys.join(",") < best.keys.join(","))
    ) {
      best = cand;
    }
  }
  return best ? { includedItemKeys: best.keys, result: best.result } : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = [...new Set(a)].sort().join(",");
  const sb = [...new Set(b)].sort().join(",");
  return sa === sb;
}

function escalationTarget(codes: readonly ReasonCode[]): Role {
  if (codes.includes("budget.over") || codes.includes("budget.total_below_committed")) return "finance";
  if (codes.includes("date.after_deadline") || codes.includes("scope.required_missing")) return "customer";
  return "provider";
}

/** One deterministic turn. Output is parsed through the shared schema before returning. */
export function stubAgentTurn(input: StubInput): AgentModelOutput {
  const { catalog, constraints, currentProposal } = input;
  const best = findBestCombination(catalog, constraints);

  let out: AgentModelOutput;
  if (best === null) {
    const requiredOnly = checkProposal({
      catalog,
      constraints,
      draft: { includedItemKeys: [...new Set(constraints.requiredItemKeys)].sort(), deliveryDate: null },
    });
    const codes = requiredOnly.issues.map((i) => i.reasonCode);
    const toRole = escalationTarget(codes);
    out = {
      action: "escalate",
      kind: "infeasible",
      toRole,
      question:
        toRole === "finance"
          ? "No confirmed option including all required items fits the current budget. Can the budget be raised, or should required scope be renegotiated?"
          : "No confirmed option satisfies all hard constraints. Which constraint can be relaxed?",
      options:
        constraints.requiredItemKeys.length > 0
          ? [{ label: "Required items only", includedItemKeys: [...new Set(constraints.requiredItemKeys)].sort() }]
          : [],
    };
  } else if (currentProposal === undefined) {
    out = {
      action: "propose",
      includedItemKeys: best.includedItemKeys,
      deliveryDate: null,
      publicRationale: "Largest confirmed combination of required and preferred items that passes all checks.",
    };
  } else if (sameSet(currentProposal.includedItemKeys, best.includedItemKeys)) {
    out = {
      action: "recommend_accept",
      proposalVersion: currentProposal.version,
      publicRationale: "Current proposal equals the best feasible combination under current constraints.",
    };
  } else {
    out = {
      action: "counter",
      baseProposalVersion: currentProposal.version,
      includedItemKeys: best.includedItemKeys,
      deliveryDate: null,
      publicRationale: "Counter with the largest combination that passes all checks under current constraints.",
    };
  }
  return AgentModelOutput.parse(out); // same gate as the real model output
}

export interface EnvelopeContext {
  envelopeId: string;
  roomId: string;
  runId: string;
  turnIndex: number;
  round: number;
  fromParticipantId: string;
  fromRole: Role;
  createdAt: number;
}

/** Server-side envelope construction for a stub turn (isSimulated is forced true). */
export function wrapStubTurn(ctx: EnvelopeContext, input: StubInput): AgentEnvelope {
  return AgentEnvelope.parse({
    protocolVersion: PROTOCOL_VERSION,
    ...ctx,
    constraintsVersion: input.constraints.constraintsVersion,
    catalogVersion: input.catalog.catalogVersion,
    observedProposalVersion: input.currentProposal?.version ?? null,
    source: { kind: "stub", stubName: "max-required-preferred-v1", isSimulated: true },
    output: stubAgentTurn(input),
  });
}
