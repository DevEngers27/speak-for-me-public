import { describe, expect, test } from "vitest";
import {
  addDays,
  daysBetween,
  GOLDEN_ANCHOR,
  main,
  proposalExpectations,
  resolveDayOffset,
} from "@core/scenarios/scope-change/fixtures";
import { committedAfter, effectiveLeadDays, fitsBudget, overByCents, priceOf, sumPrices } from "./catalogMath";

const baseline = main.ledgerBaseline.amountCents;
const capV1 = main.briefs.finance.hardFields.capCents;
const deadline = resolveDayOffset(GOLDEN_ANCHOR, main.briefs.customer.hardFields.deadline);

describe("§12 arithmetic", () => {
  test("five items total $1,400 and the modifier is extra", () => {
    const items = main.catalog.filter((row) => row.kind === "item");
    expect(items).toHaveLength(5);
    const total = items.reduce((sum, row) => sum + row.priceCents, 0);
    expect(total).toBe(140_000);
    expect(priceOf(main, "rush")).toBe(15_000);
    expect(total + priceOf(main, "rush")).toBe(155_000);
    for (const row of main.catalog) {
      if (row.kind === "item") expect(row.priceCents % 5_000).toBe(0);
    }
  });

  test("full scope is $40,000 over the $5,000 cap and 14 days past the deadline", () => {
    const full = proposalExpectations.find((row) => row.id === "full-request");
    if (!full) throw new Error("missing full-request");
    expect(sumPrices(main, full.itemKeys, full.modifierKeys)).toBe(140_000);
    expect(committedAfter(baseline, 140_000)).toBe(540_000);
    expect(overByCents(baseline, 140_000, capV1)).toBe(40_000);
    expect(fitsBudget(baseline, 140_000, capV1)).toBe(false);
    const delivery = addDays(GOLDEN_ANCHOR, effectiveLeadDays(main, full.itemKeys, full.modifierKeys));
    expect(delivery).toBe("2026-12-04");
    expect(daysBetween(deadline, delivery)).toBe(14);
    expect(capV1 - baseline).toBe(100_000);
  });

  test("phase one is $900 with $100 of room, and $100 over after the cut to $4,800", () => {
    expect(sumPrices(main, ["audit_log_export", "sso_login", "usage_dashboard"])).toBe(90_000);
    expect(committedAfter(baseline, 90_000)).toBe(490_000);
    expect(capV1 - 490_000).toBe(10_000);
    expect(fitsBudget(baseline, 90_000, capV1)).toBe(true);
    expect(overByCents(baseline, 90_000, 480_000)).toBe(10_000);
    expect(fitsBudget(baseline, 90_000, 480_000)).toBe(false);
    expect(addDays(GOLDEN_ANCHOR, 16)).toBe("2026-11-18");
  });

  test("required scope is $800: equal to $4,800 fits, one cent over does not, $4,700 is $100 over", () => {
    expect(sumPrices(main, ["audit_log_export", "sso_login"])).toBe(80_000);
    expect(committedAfter(baseline, 80_000)).toBe(480_000);
    expect(fitsBudget(baseline, 80_000, 480_000)).toBe(true);
    expect(overByCents(baseline, 80_000, 480_000)).toBe(0);
    expect(fitsBudget(baseline, 80_000, 479_999)).toBe(false);
    expect(overByCents(baseline, 80_000, 479_999)).toBe(1);
    expect(overByCents(baseline, 80_000, 470_000)).toBe(10_000);
    expect(480_000 - baseline).toBe(80_000);
    expect(addDays(GOLDEN_ANCHOR, 14)).toBe("2026-11-16");
  });

  test("required plus rush is $950 and delivers in 10 days", () => {
    expect(sumPrices(main, ["audit_log_export", "sso_login"], ["rush"])).toBe(95_000);
    expect(effectiveLeadDays(main, ["audit_log_export", "sso_login"], ["rush"])).toBe(10);
    expect(addDays(GOLDEN_ANCHOR, 10)).toBe("2026-11-12");
    expect(fitsBudget(baseline, 95_000, capV1)).toBe(true);
  });

  test("raise-cap targets are baseline plus $800 and baseline plus $900", () => {
    expect(committedAfter(baseline, 80_000)).toBe(480_000);
    expect(committedAfter(baseline, 90_000)).toBe(490_000);
    expect(480_000 - 470_000).toBe(10_000);
    expect(480_000 - 479_999).toBe(1);
    expect(490_000 - 470_000).toBe(20_000);
    expect(490_000 - 479_999).toBe(10_001);
  });

  test("retired required item leaves SSO at $500 and SSO plus dashboard at $600", () => {
    expect(priceOf(main, "sso_login")).toBe(50_000);
    expect(sumPrices(main, ["sso_login", "usage_dashboard"])).toBe(60_000);
    expect(committedAfter(baseline, 50_000)).toBe(450_000);
    expect(committedAfter(baseline, 60_000)).toBe(460_000);
    expect(fitsBudget(baseline, 50_000, capV1)).toBe(true);
    expect(fitsBudget(baseline, 60_000, capV1)).toBe(true);
    expect(addDays(GOLDEN_ANCHOR, 11)).toBe("2026-11-13");
    expect(addDays(GOLDEN_ANCHOR, 16)).toBe("2026-11-18");
  });

  test("a localDate of 2026-11-19 pushes required delivery to 12-03 and rush to 11-29", () => {
    const localDate = addDays(GOLDEN_ANCHOR, 17);
    expect(localDate).toBe("2026-11-19");
    expect(addDays(localDate, 14)).toBe("2026-12-03");
    expect(addDays(localDate, 10)).toBe("2026-11-29");
  });

  test("execution of the required scope leaves zero headroom at the $4,800 cap", () => {
    expect(committedAfter(baseline, 80_000)).toBe(480_000);
  });
});

describe("proposal expectations", () => {
  test("every stated total and delivery offset matches the catalog", () => {
    expect(proposalExpectations).toHaveLength(7);
    for (const expected of proposalExpectations) {
      expect(sumPrices(main, expected.itemKeys, expected.modifierKeys)).toBe(expected.itemsTotalCents);
      expect(effectiveLeadDays(main, expected.itemKeys, expected.modifierKeys)).toBe(expected.deliveryOffsetDays);
      const delivery = addDays(GOLDEN_ANCHOR, expected.deliveryOffsetDays);
      const late = delivery > deadline;
      const over = !fitsBudget(baseline, expected.itemsTotalCents, expected.capCents);
      const reasons: string[] = [];
      if (late) reasons.push("date.after_deadline");
      if (over) reasons.push("budget.over");
      expect(expected.reasonCodes).toEqual(reasons);
      expect(expected.feasible).toBe(reasons.length === 0);
      if (expected.id === "required-rush") {
        expect(expected.notEnumeratedBecause).toBe("base_meets_deadline");
        expect(delivery <= deadline).toBe(true);
      }
    }
  });
});
