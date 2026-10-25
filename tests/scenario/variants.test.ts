import { describe, expect, test } from "vitest";
import {
  addDays,
  canaryFixture,
  fixtureForVariant,
  GOLDEN_ANCHOR,
  main,
  namedScripts,
  variantByKey,
  variants,
  type VariantExpected,
} from "@core/scenarios/scope-change/fixtures";
import { committedAfter, effectiveLeadDays, fitsBudget, overByCents, sumPrices } from "./catalogMath";

const baseline = main.ledgerBaseline.amountCents;

function assertExpected(expected: VariantExpected): void {
  switch (expected.kind) {
    case "execute_at_cap": {
      expect(expected.capCents).toBe(480_000);
      expect(sumPrices(main, ["audit_log_export", "sso_login", "usage_dashboard"])).toBe(expected.proposalAmountCents);
      expect(overByCents(baseline, expected.proposalAmountCents, expected.capCents)).toBe(expected.proposalOverByCents);
      expect(expected.proposalReasonCodes).toEqual(["version.stale_constraints", "budget.over"]);
      expect(sumPrices(main, expected.executedItemKeys)).toBe(expected.executedAmountCents);
      expect(committedAfter(baseline, expected.executedAmountCents)).toBe(expected.committedAfterCents);
      expect(expected.capCents - expected.committedAfterCents).toBe(expected.remainingCents);
      expect(fitsBudget(baseline, expected.executedAmountCents, expected.capCents)).toBe(expected.fits);
      expect(expected.outcome).toBe("budget.fits");
      expect(expected.staleApprovalCount).toBe(2);
      return;
    }
    case "escalate_infeasible": {
      expect(expected.action).toBe("escalate");
      expect(expected.escalateKind).toBe("infeasible");
      expect(expected.toRole).toBe("finance");
      expect(expected.modelCalls).toBe(0);
      expect(expected.capCents).toBe(470_000);
      expect(expected.reasonCode).toBe("budget.over");
      expect(overByCents(baseline, expected.cheapestAmountCents, expected.capCents)).toBe(expected.overByCents);
      expect(committedAfter(baseline, expected.cheapestAmountCents)).toBe(expected.cheapestCommittedCents);
      expect(fitsBudget(baseline, expected.cheapestAmountCents, expected.capCents)).toBe(false);
      for (const option of expected.raiseCapOptions) {
        expect(option.capCents - expected.capCents).toBe(option.deltaCents);
        expect(committedAfter(baseline, option.showsAmountCents)).toBe(option.capCents);
        expect(effectiveLeadDays(main, option.showsAmountCents === 80_000
          ? ["audit_log_export", "sso_login"]
          : ["audit_log_export", "sso_login", "usage_dashboard"])).toBe(option.deliveryOffsetDays);
      }
      return;
    }
    case "boundary_one_cent": {
      expect(expected.capCents).toBe(479_999);
      expect(expected.overByCents).toBe(1);
      expect(expected.reasonCode).toBe("budget.over");
      expect(expected.modelCalls).toBe(0);
      expect(overByCents(baseline, expected.cheapestAmountCents, expected.capCents)).toBe(1);
      expect(fitsBudget(baseline, expected.cheapestAmountCents, expected.equalCapCents)).toBe(expected.equalCapFits);
      expect(fitsBudget(baseline, expected.cheapestAmountCents, expected.capCents)).toBe(false);
      for (const option of expected.raiseCapOptions) {
        expect(option.capCents - expected.capCents).toBe(option.deltaCents);
      }
      return;
    }
    case "below_committed": {
      expect(expected.capCents).toBe(390_000);
      expect(expected.reasonCode).toBe("budget.below_committed");
      expect(expected.capCents < expected.minAllowedCapCents).toBe(true);
      expect(expected.minAllowedCapCents).toBe(baseline);
      expect(expected.writes).toBe(false);
      expect(expected.bumps).toBe(false);
      expect(expected.equalToCommittedCapCents).toBe(baseline);
      expect(expected.equalToCommittedAllowed).toBe(true);
      expect(expected.equalToCommittedCapCents >= baseline).toBe(true);
      return;
    }
    case "required_retired": {
      expect(expected.reasonCodes).toEqual(["version.stale_constraints", "item.retired", "item.required_missing"]);
      expect(expected.modelCalls).toBe(0);
      expect(expected.toRole).toBe("customer");
      expect(main.briefs.customer.hardFields.requiredItemKeys).toContain(expected.itemKey);
      for (const candidate of expected.candidates) {
        expect(sumPrices(main, candidate.itemKeys)).toBe(candidate.amountCents);
        expect(committedAfter(baseline, candidate.amountCents)).toBe(candidate.committedAfterCents);
        expect(effectiveLeadDays(main, candidate.itemKeys)).toBe(candidate.deliveryOffsetDays);
        expect(candidate.committedAfterCents <= expected.capCents).toBe(true);
      }
      return;
    }
    case "midnight": {
      expect(expected.bumpsOnRoll).toBe(false);
      expect(expected.bumpsWhenInPast).toBe(true);
      expect(expected.reasonCode).toBe("date.in_past");
      const delivery = addDays(GOLDEN_ANCHOR, expected.deliveryOffsetDays);
      const rolled = addDays(GOLDEN_ANCHOR, expected.rollOffsetDays);
      const passed = addDays(GOLDEN_ANCHOR, expected.inPastOffsetDays);
      expect(rolled).toBe("2026-11-03");
      expect(delivery).toBe("2026-11-18");
      expect(passed).toBe("2026-11-19");
      expect(delivery >= rolled).toBe(true);
      expect(delivery < passed).toBe(true);
      const localDate = addDays(GOLDEN_ANCHOR, expected.extendFromOffsetDays);
      expect(localDate).toBe("2026-11-19");
      const [rushLead, baseLead] = expected.extendLeadDays;
      expect(addDays(localDate, rushLead)).toBe("2026-11-29");
      expect(addDays(localDate, baseLead)).toBe("2026-12-03");
      return;
    }
    case "canary": {
      expect(expected.providerSeesDeadline).toBe(false);
      expect(expected.deadlineDisclosedTo).toEqual(["finance"]);
      expect(canaryFixture.briefs.customer.disclosures.deadline).toEqual(["finance"]);
      expect(canaryFixture.briefs.customer.hardFields.deadline.offsetDays).toBe(expected.deadlineOffsetDays);
      expect(canaryFixture.briefs.finance.hardFields.capCents).toBe(expected.capCentsV1);
      expect(canaryFixture.ledgerBaseline.amountCents).toBe(expected.baselineCents);
      expect(expected.phaseOneFitsV1).toBe(expected.phaseOneCommittedCents <= expected.capCentsV1);
      expect(expected.phaseOneFitsV2).toBe(expected.phaseOneCommittedCents <= expected.capCentsV2);
      expect(expected.requiredOnlyFitsV2).toBe(expected.committedAfterExecuteCents <= expected.capCentsV2);
      expect(fixtureForVariant("canary").key).toBe("canary");
      return;
    }
    case "title_injection": {
      const [g1Format, g1Delimiter, accepted] = expected.attempts;
      expect(g1Format.reasonCode).toBe("input.invalid");
      expect(g1Format.field).toBe("title");
      expect(g1Format.writes).toBe(false);
      expect(g1Format.title).toMatch(/[<>]/);
      expect(g1Delimiter.reasonCode).toBe("disclosure.blocked");
      expect(g1Delimiter.field).toBe("title");
      expect(g1Delimiter.writes).toBe(false);
      expect(accepted.accepted).toBe(true);
      expect(accepted.title).not.toMatch(/[<>\r\n]/);
      expect([...accepted.title].length).toBeLessThanOrEqual(80);
      expect(accepted.delimitedAs).toBe("provider.catalog_titles");
      expect(accepted.rejectedAction).toBe("approve");
      expect(accepted.reasonCode).toBe("output.schema_violation");
      expect(accepted.agentApprovals).toBe(0);
      return;
    }
    default: {
      const leftover: never = expected;
      throw new Error(`missing expected outcome for ${JSON.stringify(leftover)}`);
    }
  }
}

describe("variant outcomes", () => {
  test("every variant states an expected outcome that matches the catalog arithmetic", () => {
    expect(variants.map((variant) => variant.key)).toEqual([
      "main",
      "cap_4700",
      "boundary_minus_one_cent",
      "below_committed",
      "required_retired",
      "midnight",
      "canary",
      "title_injection",
    ]);
    for (const variant of variants) {
      expect(variant.expected).toBeDefined();
      assertExpected(variant.expected);
      expect(variantByKey(variant.key)).toBe(variant);
    }
  });

  test("script-only variants keep the main seed; canary replaces the private numbers", () => {
    for (const key of ["main", "cap_4700", "boundary_minus_one_cent", "below_committed", "required_retired", "midnight", "title_injection"] as const) {
      expect(fixtureForVariant(key)).toBe(main);
    }
    expect(fixtureForVariant("canary")).toBe(canaryFixture);
    expect(canaryFixture.catalog).toBe(main.catalog);
  });

  test("named cap scripts match the variant targets", () => {
    const byKey = new Map(namedScripts.map((script) => [script.key, script]));
    expect(byKey.get("cut_cap_4800")).toMatchObject({ capCents: 480_000 });
    expect(byKey.get("cut_cap_4700")).toMatchObject({ capCents: 470_000 });
    expect(byKey.get("cut_cap_479999")).toMatchObject({ capCents: 479_999 });
    expect(byKey.get("cut_cap_3900")).toMatchObject({ capCents: 390_000 });
    expect(byKey.get("retire_audit")).toMatchObject({ itemKey: "audit_log_export" });
    expect(variantByKey("main").expected).toMatchObject({ script: "cut_cap_4800" });
    expect(variantByKey("cap_4700").expected).toMatchObject({ script: "cut_cap_4700" });
    expect(variantByKey("boundary_minus_one_cent").expected).toMatchObject({ script: "cut_cap_479999" });
    expect(variantByKey("below_committed").expected).toMatchObject({ script: "cut_cap_3900" });
    expect(variantByKey("required_retired").expected).toMatchObject({ script: "retire_audit" });
  });
});
