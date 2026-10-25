import { describe, expect, test } from "vitest";
import { checkBudget, type BudgetInput } from "../src/rules.js";

type Row = [name: string, input: BudgetInput, expected: Record<string, unknown>];

const rows: Row[] = [
  ["phase one fits (USD 4,000 + USD 900 <= USD 5,000)", { totalBudgetCents: 500_000, committedCents: 400_000, additionalCostCents: 90_000 },
    { ok: true, reasonCode: "budget.within", headroomCents: 100_000, projectedCommittedCents: 490_000, overByCents: 0 }],
  ["exactly equal to cap is within", { totalBudgetCents: 500_000, committedCents: 400_000, additionalCostCents: 100_000 },
    { ok: true, reasonCode: "budget.within", headroomCents: 100_000, projectedCommittedCents: 500_000, overByCents: 0 }],
  ["one cent over the cap", { totalBudgetCents: 500_000, committedCents: 400_000, additionalCostCents: 100_001 },
    { ok: false, reasonCode: "budget.over", overByCents: 1, headroomCents: 100_000 }],
  ["full change over (USD 1,400)", { totalBudgetCents: 500_000, committedCents: 400_000, additionalCostCents: 140_000 },
    { ok: false, reasonCode: "budget.over", overByCents: 40_000 }],
  ["old USD 4,900 after cut to USD 4,800", { totalBudgetCents: 480_000, committedCents: 400_000, additionalCostCents: 90_000 },
    { ok: false, reasonCode: "budget.over", overByCents: 10_000, headroomCents: 80_000 }],
  ["zero additional with zero headroom", { totalBudgetCents: 400_000, committedCents: 400_000, additionalCostCents: 0 },
    { ok: true, reasonCode: "budget.within", headroomCents: 0 }],
  ["total below committed, zero additional", { totalBudgetCents: 380_000, committedCents: 400_000, additionalCostCents: 0 },
    { ok: false, reasonCode: "budget.total_below_committed", headroomCents: -20_000, overByCents: 20_000 }],
  ["total below committed, with additional", { totalBudgetCents: 380_000, committedCents: 400_000, additionalCostCents: 10_000 },
    { ok: false, reasonCode: "budget.total_below_committed", overByCents: 30_000 }],
  ["fractional cents rejected", { totalBudgetCents: 500_000, committedCents: 400_000, additionalCostCents: 100.5 },
    { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["additionalCostCents"] }],
  ["negative amount rejected", { totalBudgetCents: 500_000, committedCents: -1, additionalCostCents: 0 },
    { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["committedCents"] }],
  ["NaN rejected", { totalBudgetCents: Number.NaN, committedCents: 0, additionalCostCents: 0 },
    { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["totalBudgetCents"] }],
  ["unsafe integer rejected", { totalBudgetCents: 2 ** 53, committedCents: 0, additionalCostCents: 0 },
    { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["totalBudgetCents"] }],
  ["sum overflow rejected", { totalBudgetCents: Number.MAX_SAFE_INTEGER, committedCents: Number.MAX_SAFE_INTEGER, additionalCostCents: 1 },
    { ok: false, reasonCode: "budget.invalid_amount", invalidFields: ["sum"] }],
];

describe("checkBudget", () => {
  test.each(rows)("%s", (_name, input, expected) => {
    expect(checkBudget(input)).toMatchObject(expected);
  });
});
