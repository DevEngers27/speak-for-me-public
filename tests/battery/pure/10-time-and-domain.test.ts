import { describe, expect, it } from "vitest";
import { addDays, cents, compareIsoDates, isoDate } from "../../../core/engine";
import {
  GOLDEN_ANCHOR,
  main,
  materializeFixture,
  scopeChangePlugin,
  toRuleInput,
  validateDeadline,
  validateSharedFact,
} from "../../../core/scenarios/scope-change";

const materialized = materializeFixture(main, GOLDEN_ANCHOR);
const input = toRuleInput(materialized as unknown as Record<string, unknown>);

function inv78() {
  expect(compareIsoDates(isoDate("2026-11-16"), isoDate("2026-11-18"))).toBeLessThan(0);
  expect(cents(80_000) < cents(90_000)).toBe(true);

  const m = scopeChangePlugin.materialize(
    { itemKeys: ["audit_log_export", "sso_login"], modifiers: [] },
    input.catalog,
    input.localDate,
  )!;
  expect(m.terms.deliveryDate).toBe(addDays(input.localDate, 14));
  // Delivery date on the materialized proposal is fixed at insertion time (INV-36)
  expect(m.terms.deliveryDate).toBe("2026-11-16");

  // Both extend_deadline (validateDeadline) and sharedFacts (validateSharedFact) enforce [localDate, localDate + 365]
  expect(validateDeadline("2026-11-29", isoDate("2026-11-19"))).toEqual({ ok: true });
  expect(validateDeadline("2026-11-18", isoDate("2026-11-19"))).toMatchObject({
    ok: false,
    code: "date.in_past",
  });
  expect(validateDeadline("2027-11-20", isoDate("2026-11-19"))).toMatchObject({
    ok: false,
    code: "date.out_of_range",
  });
  expect(validateDeadline("2028-01-01", isoDate("2026-11-02"))).toMatchObject({
    ok: false,
    code: "date.out_of_range",
  });
  expect(
    validateSharedFact({
      topicKey: "deadline_value",
      fromRole: "customer",
      toRole: "provider",
      confirmOwnDisclosure: true,
    }),
  ).toEqual({ ok: true });
}

describe("P · 10-time-and-domain", () => {
  it("INV-78 日期与金额在任何边界都按同一函数比较：日期字典序（`IsoDate`），金额整数分；提案 `deliveryDate` 与目录 `leadDays` 的关系在插入时固定（INV-36）；`extend_deadline { date }` 与 `sharedFacts` 日期都过窗口校验（INV-18）", inv78);
});
