// packages/engine/src/protocol/agent.ts — one interface for live / stub / replay (D9).
import type { AgentMove, AgentRole, AgentAction, TurnKind } from "./model-output.ts";

export type Candidate = {
  optionKey: string; itemKeys: string[]; deferredItemKeys: string[]; termIds: string[];
  deliveryDate: string; amountCents: number; termsKey: string; rank: number;
};

/** Built by internalQuery buildAgentTurnInput(turnId) — the ONLY context entry point (07). */
export type AgentTurnInput = {
  envelope: { round: number; maxRounds: number; turnKind: TurnKind; sourceRole: AgentRole;
              baseProposalVersion: number; constraintsVersion: number; promptVersion: string };
  allowedActions: readonly AgentAction[];
  principal: { brief: Record<string, unknown>; notes?: string }; // own confirmed brief, role-specific
  sharedFacts: { role: AgentRole; field: string; value: string }[]; // others' explicit disclosures
  roomState: { today: string; baseProposal?: { optionKey?: string; termsKey: string; reasonCodes: string[] } };
  candidates: Candidate[]; // the frozen snapshot, role-projected (D3)
  counterpartyRecord: { round: number; role: AgentRole; action: AgentAction; termsKey?: string; objection?: string; topic?: string }[];
  clarifyAnswers: { topic: string; answer: string }[];
  retryFeedback: string[];
  // stub-only hints derived by code from the principal's own brief (never from others)
  hints?: { requiredItemKeys?: string[]; preferredDate?: string; fits?: Record<string, boolean> };
};

export type Provenance = { mode: "live" | "stub" | "replay"; model?: string; attempts: number };
export type AgentDecision =
  | { kind: "ok"; move: AgentMove; provenance: Provenance }
  | { kind: "failed"; errorCode: string; retryable: boolean; provenance: Provenance };

export interface NegotiationAgent {
  readonly mode: Provenance["mode"];
  decide(input: AgentTurnInput): Promise<AgentDecision>;
}

const ok = (move: AgentMove): AgentDecision => ({ kind: "ok", move, provenance: { mode: "stub", attempts: 1 } });

/** Deterministic rules; never clarifies or requests tradeoffs (ScriptedAgent covers those paths). */
export class StubAgent implements NegotiationAgent {
  readonly mode = "stub" as const;
  async decide(i: AgentTurnInput): Promise<AgentDecision> {
    const byRank = [...i.candidates].sort((a, b) => a.rank - b.rank);
    const role = i.envelope.sourceRole;
    if (role === "provider") {
      const blocked = new Set(i.counterpartyRecord.filter((r) => r.role === "provider" && r.objection === "BLOCKED").map((r) => r.termsKey));
      const pick = byRank.find((c) => !blocked.has(c.termsKey));
      return pick
        ? ok({ action: "propose", optionKey: pick.optionKey, rationale: "Stub: best-ranked unblocked option." })
        : ok({ action: "reject", objection: "CAPACITY_CONFLICT", rationale: "Stub: no unblocked option left." });
    }
    const base = i.roomState.baseProposal;
    const baseCand = base && i.candidates.find((c) => c.termsKey === base.termsKey);
    const meets = (c: { itemKeys: string[]; deliveryDate: string }) =>
      (i.hints?.requiredItemKeys ?? []).every((k) => c.itemKeys.includes(k)) &&
      (!i.hints?.preferredDate || c.deliveryDate <= i.hints.preferredDate);
    if (role === "customer") {
      if (baseCand && meets(baseCand)) return ok({ action: "recommend_accept", rationale: "Stub: meets required scope and date." });
      const alt = byRank.find((c) => meets(c) && c.termsKey !== base?.termsKey);
      return alt
        ? ok({ action: "counter", optionKey: alt.optionKey, rationale: "Stub: counter with best option meeting requirements." })
        : ok({ action: "reject", objection: "SCOPE_INSUFFICIENT", rationale: "Stub: no option meets requirements." });
    }
    const fits = base ? i.hints?.fits?.[base.termsKey] : false;
    return fits
      ? ok({ action: "recommend_accept", rationale: "Stub: rules engine reports FITS." })
      : ok({ action: "reject", objection: "PRICE_POOR_VALUE", rationale: "Stub: rules engine reports not fitting." });
  }
}

/** Live: renderPrompt (prompt.ts) + callModel (call-model.ts); same downstream as stub. */
export type LiveAgentDeps = {
  render: (i: AgentTurnInput) => { system: unknown[]; context: unknown; turnInstruction: (fb: string[]) => string };
  call: (rendered: ReturnType<LiveAgentDeps["render"]>, i: AgentTurnInput) =>
    Promise<{ result: { kind: string; move?: AgentMove; errorCode?: string }; attempts: number; model?: string }>;
};
export class LiveAgent implements NegotiationAgent {
  readonly mode = "live" as const;
  constructor(private deps: LiveAgentDeps) {}
  async decide(i: AgentTurnInput): Promise<AgentDecision> {
    const r = await this.deps.call(this.deps.render(i), i);
    const provenance: Provenance = { mode: "live", model: r.model, attempts: r.attempts };
    if (r.result.kind === "ok" && r.result.move) return { kind: "ok", move: r.result.move, provenance };
    // invalid_output after auto-retry, or a non-retryable failure: surface to failTurn
    return { kind: "failed", errorCode: r.result.errorCode ?? "UNKNOWN", retryable: r.result.kind === "invalid_output", provenance };
  }
}
