import { describe, expect, it } from "vitest";
import { z } from "zod";
import { scopeChangeSimulatedFixture, scopeChangeSimulatedInput } from "./fixtures/scope-change.simulated";
import {
  constraintSetForPhase,
  deepFreeze,
  formatIssuePath,
  FixtureValidationError,
  loadFixture,
  parseFixtureJson,
} from "./loader";
import { draftWith, expectIssue, expectLoads, issuesOf } from "./test-helpers";

const SECRET = "private-deadline-marker-7f3a";

function allValuesFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(allValuesFrozen);
}

describe("example fixture: software scope change", () => {
  const fixture = scopeChangeSimulatedFixture;

  it("is marked simulated", () => {
    expect(fixture.provenance.simulated).toBe(true);
    expect(fixture.provenance.label).toMatch(/simulated/i);
    expect(fixture.title).toMatch(/simulated/i);
  });

  it("carries the brief's numbers in integer cents", () => {
    const amount = (version: number, id: string) =>
      fixture.constraintSets[version - 1]!.constraints.find((c) => c.id === id)?.amountCents;
    expect(amount(1, "budget-cap")).toBe(500_000);
    expect(amount(1, "committed-spend")).toBe(400_000);
    expect(amount(2, "budget-cap")).toBe(480_000);
    expect(amount(2, "committed-spend")).toBe(400_000);

    const totals = Object.fromEntries(
      fixture.phases.flatMap((p) => p.expectations.map((e) => [e.id, e.outcome.itemsTotalCents])),
    );
    expect(totals["full-request"]).toBe(140_000);
    expect(totals["phase-one"]).toBe(90_000);
  });

  it("only phase one in the initial phase is expected to be feasible", () => {
    const feasible = fixture.phases.flatMap((p) =>
      p.expectations.filter((e) => e.outcome.feasible).map((e) => `${p.id}/${e.id}`),
    );
    expect(feasible).toEqual(["initial/phase-one"]);
  });

  it("maps phases to constraint sets", () => {
    expect(constraintSetForPhase(fixture, "initial").version).toBe(1);
    expect(constraintSetForPhase(fixture, "cap-lowered").version).toBe(2);
    expect(() => constraintSetForPhase(fixture, "nope")).toThrow(/Unknown phase/);
  });

  it("keeps the deadline constraint private", () => {
    for (const set of fixture.constraintSets) {
      expect(set.constraints.find((c) => c.kind === "delivery-deadline")?.visibility).toBe("private");
    }
  });
});

describe("loadFixture", () => {
  it("returns a deeply frozen fixture", () => {
    const fixture = loadFixture(scopeChangeSimulatedInput);
    expect(allValuesFrozen(fixture)).toBe(true);
    expect(() => {
      (fixture.catalog.items[0] as { priceCents: number }).priceCents = 1;
    }).toThrow(TypeError);
    expect(() => {
      (fixture.phases as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it("does not freeze or alias the caller's input", () => {
    const input = draftWith(() => {});
    const fixture = loadFixture(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.catalog.items[0])).toBe(false);
    input.catalog.items[0]!.priceCents = 1;
    expect(fixture.catalog.items[0]!.priceCents).toBe(50_000);
  });

  it("throws FixtureValidationError with structured issues", () => {
    const bad = draftWith((d) => void (d.catalog.items[0]!.priceCents = -5));
    let caught: unknown;
    try {
      loadFixture(bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FixtureValidationError);
    const error = caught as FixtureValidationError;
    expect(error.message).toContain("catalog.items[0].priceCents");
    expectIssue(error.issues, { path: "catalog.items[0].priceCents", code: "too_small" });
  });

  it("rejects non-object input", () => {
    expectIssue(issuesOf(null), { path: "", code: "invalid_type" });
    expectIssue(issuesOf([]), { path: "", code: "invalid_type" });
  });

  it("checks the expected scenario id", () => {
    const issues = issuesOf(scopeChangeSimulatedInput, { expectedScenarioId: "event-budget" });
    expectIssue(issues, { path: "scenarioId", code: "scenario_mismatch" });
  });
});

describe("brief schemas", () => {
  const Brief = z.strictObject({ summary: z.string().min(1), notes: z.array(z.string()) });

  it("validates opaque briefs with plugin-supplied schemas", () => {
    expectLoads(scopeChangeSimulatedInput, { briefSchemas: { customer: Brief, provider: Brief, finance: Brief } });
  });

  it("fails closed when a role has no brief schema", () => {
    const issues = issuesOf(scopeChangeSimulatedInput, { briefSchemas: { customer: Brief, provider: Brief } });
    expectIssue(issues, { path: "privateBriefs.finance", code: "missing_brief_schema" });
  });

  it("reports brief schema failures without echoing private values", () => {
    const input = draftWith((d) => {
      (d.privateBriefs.customer as Record<string, unknown>)["deadline"] = SECRET;
      (d.privateBriefs.provider as Record<string, unknown>)["notes"] = SECRET;
    });
    const issues = issuesOf(input, { briefSchemas: { customer: Brief, provider: Brief, finance: Brief } });
    expectIssue(issues, { path: "privateBriefs.customer", code: "unrecognized_keys" });
    expectIssue(issues, { path: "privateBriefs.provider.notes", code: "invalid_type" });
    expect(JSON.stringify(issues)).not.toContain(SECRET);
    try {
      loadFixture(input, { briefSchemas: { customer: Brief, provider: Brief, finance: Brief } });
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
    }
  });

  it("does not echo private values from structural failures", () => {
    const input = draftWith((d) => {
      (d.privateBriefs.customer as Record<string, unknown>)["bad"] = Number.NaN;
      d.constraintSets[0]!.constraints[3]!.date = SECRET;
    });
    const issues = issuesOf(input);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(SECRET);
  });
});

describe("parseFixtureJson", () => {
  it("loads a JSON round trip of the example", () => {
    const result = parseFixtureJson(JSON.stringify(scopeChangeSimulatedInput));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixture).toEqual(scopeChangeSimulatedFixture);
  });

  it("reports invalid JSON without echoing the text", () => {
    const result = parseFixtureJson(`{"asOf": "${SECRET}"`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([{ path: "", code: "invalid_json", message: "Fixture text is not valid JSON" }]);
    }
  });
});

describe("helpers", () => {
  it("formats issue paths", () => {
    expect(formatIssuePath(["catalog", "items", 2, "priceCents"])).toBe("catalog.items[2].priceCents");
    expect(formatIssuePath(["privateBriefs", "customer"])).toBe("privateBriefs.customer");
    expect(formatIssuePath(["params", "odd key"])).toBe('params["odd key"]');
    expect(formatIssuePath([])).toBe("");
  });

  it("deepFreeze freezes nested arrays and objects", () => {
    const value = deepFreeze({ a: [{ b: 1 }], c: { d: [2] } });
    expect(allValuesFrozen(value)).toBe(true);
  });

  it("deepFreeze descends into already-frozen parents and survives cycles", () => {
    const inner = { x: 1 };
    const outer = Object.freeze({ inner });
    deepFreeze(outer);
    expect(Object.isFrozen(inner)).toBe(true);

    const cyclic: { self?: unknown; list: number[] } = { list: [1] };
    cyclic.self = cyclic;
    deepFreeze(cyclic);
    expect(Object.isFrozen(cyclic.list)).toBe(true);
  });
});
