import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  addDays,
  daysBetween,
  fixtureForVariant,
  GOLDEN_ANCHOR,
  isoDate,
  main,
  materializeFixture,
  resolveDayOffset,
  variants,
} from "@core/scenarios/scope-change/fixtures";

describe("relative anchor", () => {
  test("golden localDate 2026-11-02 resolves the deadline to 2026-11-20", () => {
    expect(GOLDEN_ANCHOR).toBe("2026-11-02");
    expect(main.goldenAnchor).toBe(GOLDEN_ANCHOR);
    expect(main.briefs.customer.hardFields.deadline).toEqual({ offsetDays: 18 });
    expect(resolveDayOffset(GOLDEN_ANCHOR, main.briefs.customer.hardFields.deadline)).toBe("2026-11-20");
    const materialized = materializeFixture(main, GOLDEN_ANCHOR);
    expect(materialized.localDate).toBe("2026-11-02");
    expect(materialized.briefs.customer.hardFields.deadline).toBe("2026-11-20");
    expect(main.briefs.customer.hardFields.deadline).toEqual({ offsetDays: 18 });
  });

  test("a later anchor stays 18 days out (2027-02-20 → 2027-03-10)", () => {
    const anchor = isoDate("2027-02-20");
    expect(addDays(anchor, 18)).toBe("2027-03-10");
    expect(materializeFixture(main, anchor).briefs.customer.hardFields.deadline).toBe("2027-03-10");
    expect(daysBetween(anchor, addDays(anchor, 18))).toBe(18);
  });

  test("calendar arithmetic covers month ends and leap days", () => {
    expect(addDays(isoDate("2026-11-02"), 32)).toBe("2026-12-04");
    expect(addDays(isoDate("2026-11-02"), 14)).toBe("2026-11-16");
    expect(addDays(isoDate("2026-11-02"), 16)).toBe("2026-11-18");
    expect(addDays(isoDate("2026-11-02"), 10)).toBe("2026-11-12");
    expect(addDays(isoDate("2026-11-02"), 11)).toBe("2026-11-13");
    expect(addDays(isoDate("2026-11-20"), -18)).toBe("2026-11-02");
    expect(addDays(isoDate("2024-02-28"), 1)).toBe("2024-02-29");
    expect(addDays(isoDate("2024-02-29"), 1)).toBe("2024-03-01");
    expect(addDays(isoDate("1900-02-28"), 1)).toBe("1900-03-01");
    expect(() => isoDate("2026-02-29")).toThrow(/calendar day/);
    expect(() => isoDate("2026-11-31")).toThrow(/calendar day/);
    expect(() => addDays(GOLDEN_ANCHOR, 1.5)).toThrow(/safe integer/);
  });

  test("fixture sources store no absolute date except the golden anchor", () => {
    const fixturesDir = fileURLToPath(new URL("../../core/scenarios/scope-change/fixtures/", import.meta.url));
    const sources = readdirSync(fixturesDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    const dateRe = /\d{4}-\d{2}-\d{2}/g;
    for (const name of sources) {
      const text = readFileSync(join(fixturesDir, name), "utf8");
      const dates = text.match(dateRe) ?? [];
      if (name === "anchor.ts") {
        expect(dates).toEqual(["2026-11-02"]);
      } else {
        expect(dates, name).toEqual([]);
      }
      expect(text).not.toMatch(/from ["']zod["']/);
      expect(text).not.toMatch(/from ["']convex/);
      expect(text).not.toMatch(/\bnew Date\b/);
      expect(text).not.toMatch(/\bDate\b/);
      expect(text).not.toMatch(/Math\.random/);
      expect(text).not.toMatch(/\bIntl\b/);
    }
  });
});

describe("seed provenance", () => {
  test("room, catalog, briefs, ledger, and every variant are seeded", () => {
    expect(main.provenance).toBe("seeded");
    expect(main.room.provenance).toBe("seeded");
    expect(main.ledgerBaseline.provenance).toBe("seeded");
    expect(main.briefs.customer.provenance).toBe("seeded");
    expect(main.briefs.provider.provenance).toBe("seeded");
    expect(main.briefs.finance.provenance).toBe("seeded");
    expect(main.catalog.length).toBe(6);
    for (const row of main.catalog) expect(row.provenance).toBe("seeded");
    for (const variant of variants) {
      expect(variant.provenance).toBe("seeded");
      const fx = fixtureForVariant(variant.key);
      expect(fx.provenance).toBe("seeded");
      expect(fx.room.provenance).toBe("seeded");
      expect(fx.ledgerBaseline.provenance).toBe("seeded");
      for (const row of fx.catalog) expect(row.provenance).toBe("seeded");
      expect(fx.briefs.customer.provenance).toBe("seeded");
      expect(fx.briefs.provider.provenance).toBe("seeded");
      expect(fx.briefs.finance.provenance).toBe("seeded");
    }
  });
});
