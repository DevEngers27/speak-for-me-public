import { describe, expect, it } from "vitest";
import { cents, isoDate } from "../../../core/engine";
import {
  GOLDEN_ANCHOR,
  canaryFixture,
  main,
  validateBriefFields,
  validateCapCents,
  variants,
} from "../../../core/scenarios/scope-change";

function ce155() {
  const committed = cents(main.ledgerBaseline.amountCents);
  expect(validateCapCents(390_000, committed)).toEqual({
    ok: false,
    code: "budget.below_committed",
    params: { minAllowedCapCents: 400_000 },
  });
  expect(
    validateBriefFields(
      "finance",
      { hardFields: { capCents: 390_000 } },
      {
        localDate: isoDate(GOLDEN_ANCHOR),
        committedCents: committed,
        catalog: main.catalog,
      },
    ),
  ).toEqual({
    ok: false,
    code: "budget.below_committed",
    params: { minAllowedCapCents: 400_000 },
  });
  expect(main.briefs.finance.hardFields.capCents).toBeGreaterThanOrEqual(
    main.ledgerBaseline.amountCents,
  );
  expect(canaryFixture.briefs.finance.hardFields.capCents).toBeGreaterThanOrEqual(
    canaryFixture.ledgerBaseline.amountCents,
  );
  for (const v of variants) {
    if (v.key === "below_committed") {
      expect(v.expected.kind).toBe("below_committed");
    } else if ("capCents" in v.expected) {
      expect(v.expected.capCents).toBeGreaterThanOrEqual(main.ledgerBaseline.amountCents);
    }
  }
}

describe("P · 08-no-fabrication", () => {
  it("CE-155 fixture 变体用 seed 伪造 `capCents < committedCents`", ce155);
});
