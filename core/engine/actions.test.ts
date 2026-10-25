import { describe, expect, expectTypeOf, test } from "vitest";
import {
  type AgentModelOutput,
  type AgentModelOutputRoot,
  type AllowedOutputFor,
  BASE_ACTIONS,
  type CustomerEvaluateOutput,
  ESCALATE_KINDS,
  type FinanceEvaluateOutput,
  MODEL_ACTIONS,
  type ModelAction,
  type ProviderProposeOutput,
  ROLES,
  type Role,
  TURN_KINDS,
  type TurnKind,
  actionAllowed,
  allowedActionsFor,
  isModelAction,
} from "./actions";

describe("core/engine/actions", () => {
  test("MODEL_ACTIONS matches canon §1.4 and excludes deprecated action names", () => {
    expect(MODEL_ACTIONS).toEqual([
      "propose",
      "counter",
      "clarify",
      "recommend_accept",
      "reject",
      "escalate",
    ]);
    expect(ROLES).toEqual(["customer", "provider", "finance"]);
    expect(TURN_KINDS).toEqual(["propose", "evaluate"]);
    expect(ESCALATE_KINDS).toEqual(["infeasible", "needs_tradeoff"]);

    for (const action of MODEL_ACTIONS) {
      expect(isModelAction(action)).toBe(true);
    }

    const deprecated = [
      "request_tradeoff",
      "approve",
      "accept",
      "decline",
      "object",
      "ask_principal",
    ];
    for (const bad of deprecated) {
      expect(MODEL_ACTIONS).not.toContain(bad);
      expect(isModelAction(bad)).toBe(false);
    }
  });

  test("exhaustive 3×2×6 actionAllowed(role, turnKind, action) matrix (canon §1.4, 05 §5.3.2)", () => {
    const expectedMatrix: Record<Role, Record<TurnKind, Record<ModelAction, boolean>>> = {
      provider: {
        propose: {
          propose: true,
          counter: false,
          clarify: true,
          recommend_accept: false,
          reject: true,
          escalate: true,
        },
        evaluate: {
          propose: false,
          counter: false,
          clarify: false,
          recommend_accept: false,
          reject: false,
          escalate: false,
        },
      },
      customer: {
        propose: {
          propose: false,
          counter: false,
          clarify: false,
          recommend_accept: false,
          reject: false,
          escalate: false,
        },
        evaluate: {
          propose: false,
          counter: true,
          clarify: true,
          recommend_accept: true,
          reject: true,
          escalate: true,
        },
      },
      finance: {
        propose: {
          propose: false,
          counter: false,
          clarify: false,
          recommend_accept: false,
          reject: false,
          escalate: false,
        },
        evaluate: {
          propose: false,
          counter: false, // canon §1.4: finance cannot counter
          clarify: true,
          recommend_accept: true,
          reject: true,
          escalate: true,
        },
      },
    };

    for (const role of ROLES) {
      for (const turnKind of TURN_KINDS) {
        const expectedList = MODEL_ACTIONS.filter((a) => expectedMatrix[role][turnKind][a]);
        expect([...allowedActionsFor(role, turnKind)].sort()).toEqual([...expectedList].sort());
        expect([...BASE_ACTIONS[role][turnKind]].sort()).toEqual([...expectedList].sort());

        for (const action of MODEL_ACTIONS) {
          expect(
            actionAllowed(role, turnKind, action),
            `${role} × ${turnKind} × ${action}`,
          ).toBe(expectedMatrix[role][turnKind][action]);
        }
      }
    }
  });

  test("provider reject in propose turn requires reasonKey === 'cannot_deliver' when provided", () => {
    expect(actionAllowed("provider", "propose", "reject")).toBe(true);
    expect(actionAllowed("provider", "propose", "reject", { reasonKey: "cannot_deliver" })).toBe(
      true,
    );
    expect(
      actionAllowed("provider", "propose", "reject", { reasonKey: "price_poor_value" }),
    ).toBe(false);
    expect(actionAllowed("provider", "propose", "reject", { reasonKey: "other" })).toBe(false);
  });

  test("payload types match canon §1.4 per role × turn kind", () => {
    expectTypeOf<AllowedOutputFor<"provider", "propose">>().toEqualTypeOf<ProviderProposeOutput>();
    expectTypeOf<AllowedOutputFor<"provider", "evaluate">>().toEqualTypeOf<never>();
    expectTypeOf<AllowedOutputFor<"customer", "propose">>().toEqualTypeOf<never>();
    expectTypeOf<AllowedOutputFor<"customer", "evaluate">>().toEqualTypeOf<CustomerEvaluateOutput>();
    expectTypeOf<AllowedOutputFor<"finance", "propose">>().toEqualTypeOf<never>();
    expectTypeOf<AllowedOutputFor<"finance", "evaluate">>().toEqualTypeOf<FinanceEvaluateOutput>();

    const sampleRoot: AgentModelOutputRoot = {
      turn: {
        action: "counter",
        optionKey: "O1",
        baseProposalVersion: 1,
        rationale: "Prefer lower scope option.",
      },
    };
    expect(sampleRoot.turn.action).toBe("counter");
    expectTypeOf(sampleRoot.turn).toExtend<AgentModelOutput>();
  });
});
