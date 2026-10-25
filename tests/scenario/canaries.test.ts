import { describe, expect, test } from "vitest";
import {
  addDays,
  CANARY_CUSTOMER,
  CANARY_FINANCE,
  CANARY_PROVIDER,
  CANARY_RATIONALE,
  canaryAmounts,
  canaryFixture,
  canarySecrets,
  GOLDEN_ANCHOR,
  lintCanaries,
  main,
  materializeFixture,
  publicMoneyText,
  type CanarySecret,
  type PublicText,
} from "@core/scenarios/scope-change/fixtures";
import { effectiveLeadDays, subsets, sumPrices } from "./catalogMath";

function catalogPublicTexts(): PublicText[] {
  const texts: PublicText[] = main.catalog.map((row) => ({
    label: `catalog.${row.itemKey}`,
    text: `${row.itemKey} ${row.title} ${publicMoneyText(row.priceCents)}`,
  }));
  const itemKeys = main.catalog.filter((row) => row.kind === "item").map((row) => row.itemKey);
  const sums = new Set<number>();
  for (const subset of subsets(itemKeys)) {
    sums.add(sumPrices(main, subset));
    sums.add(sumPrices(main, subset, ["rush"]));
  }
  sums.add(main.ledgerBaseline.amountCents);
  sums.add(main.briefs.finance.hardFields.capCents);
  for (const cents of sums) {
    texts.push({ label: `public.${cents}`, text: publicMoneyText(cents) });
  }
  return texts;
}

function deliveryDates(): string[] {
  const itemKeys = main.catalog.filter((row) => row.kind === "item").map((row) => row.itemKey);
  const dates = new Set<string>([GOLDEN_ANCHOR]);
  for (const subset of subsets(itemKeys)) {
    dates.add(addDays(GOLDEN_ANCHOR, effectiveLeadDays(main, subset)));
    dates.add(addDays(GOLDEN_ANCHOR, effectiveLeadDays(main, subset, ["rush"])));
  }
  return [...dates];
}

describe("canary lint", () => {
  test("odd-cent secrets do not collide with catalog prices, totals, or delivery dates", () => {
    const deadline = materializeFixture(canaryFixture, GOLDEN_ANCHOR).briefs.customer.hardFields.deadline;
    expect(deadline).toBe("2026-11-20");
    const dates = deliveryDates();
    expect(dates).not.toContain(deadline);
    const publicTexts: PublicText[] = [
      ...catalogPublicTexts(),
      ...dates.map((date) => ({ label: `delivery.${date}`, text: `delivery ${date}` })),
    ];
    const secrets = canarySecrets(deadline);
    expect(lintCanaries(secrets, publicTexts)).toEqual([]);
    for (const secret of secrets) expect(secret.provenance).toBe("seeded");
  });

  test("seeded canary amounts are odd cents off the $50 catalog grid", () => {
    const seeded = [canaryAmounts.capCentsV1, canaryAmounts.capCentsV2, canaryAmounts.baselineCents];
    expect(seeded).toEqual([512_347, 481_237, 400_219]);
    for (const cents of seeded) {
      expect(cents % 2).toBe(1);
      expect(cents % 100).not.toBe(0);
      expect(cents % 5_000).not.toBe(0);
    }
    for (const row of main.catalog) {
      if (row.kind === "item") expect(row.priceCents % 5_000).toBe(0);
    }
  });

  test("derived canary cents match the §12 ledger arithmetic", () => {
    const { capCentsV1, capCentsV2, baselineCents } = canaryAmounts;
    expect(capCentsV1 - baselineCents).toBe(canaryAmounts.headroomV1Cents);
    expect(capCentsV2 - baselineCents).toBe(canaryAmounts.headroomV2Cents);
    expect(baselineCents + 90_000).toBe(canaryAmounts.phaseOneCommittedCents);
    expect(baselineCents + 80_000).toBe(canaryAmounts.committedAfterExecuteCents);
    expect(canaryAmounts.phaseOneCommittedCents - capCentsV2).toBe(canaryAmounts.overByCentsAfterCut);
    expect(canaryAmounts.phaseOneCommittedCents <= capCentsV1).toBe(true);
    expect(canaryAmounts.phaseOneCommittedCents > capCentsV2).toBe(true);
    expect(canaryAmounts.committedAfterExecuteCents <= capCentsV2).toBe(true);
    expect(capCentsV2 - canaryAmounts.committedAfterExecuteCents).toBe(canaryAmounts.remainingAfterExecuteCents);
    expect(canaryAmounts.headroomV1Cents).toBe(112_128);
    expect(canaryAmounts.headroomV2Cents).toBe(81_018);
    expect(canaryAmounts.overByCentsAfterCut).toBe(8_982);
    expect(canaryAmounts.remainingAfterExecuteCents).toBe(1_018);
  });

  test("canary strings sit only in that role's notes", () => {
    expect(canaryFixture.briefs.customer.softFields.notes).toContain(CANARY_CUSTOMER);
    expect(canaryFixture.briefs.provider.softFields.notes).toContain(CANARY_PROVIDER);
    expect(canaryFixture.briefs.finance.softFields.notes).toContain(CANARY_FINANCE);
    expect(canaryFixture.briefs.customer.softFields.notes).not.toContain(CANARY_FINANCE);
    expect(canaryFixture.briefs.provider.softFields.notes).not.toContain(CANARY_CUSTOMER);
    expect(canaryFixture.briefs.finance.softFields.notes).not.toContain(CANARY_PROVIDER);
    const publicBlob = main.catalog.map((row) => `${row.itemKey} ${row.title} ${row.priceCents}`).join("\n");
    for (const token of [CANARY_CUSTOMER, CANARY_PROVIDER, CANARY_FINANCE, ...Object.values(CANARY_RATIONALE)]) {
      expect(publicBlob).not.toContain(token);
    }
  });

  test("a public $900 and a round $800 are rejected by the ported lint", () => {
    const nineHundred: CanarySecret = {
      id: "provider.floor900",
      ownerRole: "provider",
      kind: "money",
      value: 90_000,
      allowedRoles: [],
      origin: "brief",
      provenance: "seeded",
    };
    const collided = lintCanaries([nineHundred], [{ label: "proposal", text: "Provider proposes usage dashboard for $900" }]);
    expect(collided.some((issue) => issue.code === "COLLIDES_WITH_PUBLIC_VALUE")).toBe(true);
    const round: CanarySecret = {
      id: "finance.headroomCents",
      ownerRole: "finance",
      kind: "money",
      value: 80_000,
      allowedRoles: [],
      origin: "derived",
      provenance: "seeded",
    };
    expect(lintCanaries([round], []).map((issue) => issue.code)).toContain("LOW_ENTROPY");
  });

  test("duplicate secrets and a deadline equal to a delivery date are rejected", () => {
    const deadline = "2026-11-16" as const;
    const left: CanarySecret = {
      id: "a.canary", ownerRole: "customer", kind: "string", value: CANARY_CUSTOMER, allowedRoles: [], origin: "brief", provenance: "seeded",
    };
    const right: CanarySecret = { ...left, id: "b.canary" };
    expect(lintCanaries([left, right], []).some((issue) => issue.code === "COLLIDES_WITH_OTHER_SECRET")).toBe(true);
    const dateSecret: CanarySecret = {
      id: "customer.deadline", ownerRole: "customer", kind: "date", value: deadline, allowedRoles: ["finance"], origin: "brief", provenance: "seeded",
    };
    const issues = lintCanaries([dateSecret], [{ label: "delivery", text: "delivery 2026-11-16" }]);
    expect(issues.some((issue) => issue.code === "COLLIDES_WITH_PUBLIC_VALUE")).toBe(true);
    expect(lintCanaries([dateSecret], [{ label: "other", text: "delivery 2026-11-18" }])).toEqual([]);
  });
});
