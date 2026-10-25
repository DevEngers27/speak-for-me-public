// Compile-time checks for the brand types: `npm run typecheck` fails if any
// expect-error directive below stops matching a real type error.
import { describe, expect, test } from "vitest";
import {
  addCents,
  cents,
  differenceCents,
  formatCents,
  isoDate,
  isOnOrBefore,
  parseCents,
  type Cents,
  type IsoDate,
  type SignedCents,
} from "../src";

describe("brand types", () => {
  test("plain numbers and strings are not accepted where brands are required", () => {
    const a = cents(100);
    // @ts-expect-error a bare number is not Cents
    const bad: Cents = 100;
    // @ts-expect-error SignedCents is not Cents (may be negative)
    const narrowed: Cents = differenceCents(a, a);
    const widened: SignedCents = a; // Cents is a SignedCents
    // @ts-expect-error a bare string is not an IsoDate
    const day: IsoDate = "2026-11-14";
    // @ts-expect-error addCents needs Cents, not number
    addCents(a, 5);
    // @ts-expect-error isOnOrBefore needs validated dates
    isOnOrBefore("2026-11-14", isoDate("2026-11-15"));
    const parsed = parseCents("$4,800");
    if (parsed.ok) {
      const ok: Cents = parsed.value;
      expect(formatCents(ok)).toBe("$4,800");
    } else {
      // @ts-expect-error no value on the failure branch
      void parsed.value;
    }
    expect([bad, narrowed, widened, day]).toHaveLength(4);
  });
});
