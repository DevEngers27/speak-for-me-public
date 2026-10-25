import { describe, expect, it } from "vitest";
import { FIXTURE_CHECK } from "./schema";
import { draftWith, expectIssue, expectLoads, issuesOf } from "./test-helpers";

const BAD_DATES = [
  "2026-02-30", // no such day
  "2026-02-29", // 2026 is not a leap year
  "2026-13-01", // month 13
  "2026-11-31", // November has 30 days
  "2026/11/20", // wrong separator
  "2026-11-20T00:00:00Z", // date-time, not a calendar date
  "26-11-20", // two-digit year
  "2026-1-2", // missing zero padding
  "", // empty
];

describe("negative and non-integer cents", () => {
  it("rejects a negative catalog price", () => {
    const issues = issuesOf(draftWith((d) => void (d.catalog.items[0]!.priceCents = -1)));
    expectIssue(issues, { path: "catalog.items[0].priceCents", code: "too_small" });
  });

  it("rejects a negative constraint amount", () => {
    const issues = issuesOf(draftWith((d) => void (d.constraintSets[1]!.constraints[0]!.amountCents = -480000)));
    expectIssue(issues, { path: "constraintSets[1].constraints[0].amountCents", code: "too_small" });
  });

  it("rejects a negative expected total", () => {
    const issues = issuesOf(draftWith((d) => void (d.phases[0]!.expectations[1]!.outcome.itemsTotalCents = -90000)));
    expectIssue(issues, { path: "phases[0].expectations[1].outcome.itemsTotalCents", code: "too_small" });
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-integer cents %s", (value) => {
    const issues = issuesOf(draftWith((d) => void (d.catalog.items[1]!.priceCents = value)));
    expectIssue(issues, { path: "catalog.items[1].priceCents", code: "invalid_type" });
  });

  it("rejects cents beyond the safe integer range", () => {
    const issues = issuesOf(draftWith((d) => void (d.catalog.items[2]!.priceCents = 2 ** 53)));
    expectIssue(issues, { path: "catalog.items[2].priceCents", code: "too_big" });
  });

  it("rejects cents given as a string", () => {
    const issues = issuesOf(
      draftWith((d) => void ((d.catalog.items[0] as unknown as { priceCents: unknown }).priceCents = "500.00")),
    );
    expectIssue(issues, { path: "catalog.items[0].priceCents", code: "invalid_type" });
  });

  it("accepts zero cents", () => {
    const draft = draftWith((d) => {
      d.catalog.items[0]!.priceCents = 0;
      d.phases.forEach((p) =>
        p.expectations.forEach((e) => {
          if (e.candidate.itemIds.includes("sso-login")) e.outcome.itemsTotalCents -= 50000;
        }),
      );
    });
    expectLoads(draft);
  });
});

describe("bad dates", () => {
  it.each(BAD_DATES)("rejects catalog earliestDate %j", (value) => {
    const issues = issuesOf(draftWith((d) => void (d.catalog.items[0]!.earliestDate = value)));
    expectIssue(issues, { path: "catalog.items[0].earliestDate", code: "invalid_format" });
  });

  it("rejects a bad asOf date", () => {
    expectIssue(issuesOf(draftWith((d) => void (d.asOf = "2026-02-30"))), { path: "asOf", code: "invalid_format" });
  });

  it("rejects a bad constraint date", () => {
    const issues = issuesOf(draftWith((d) => void (d.constraintSets[0]!.constraints[3]!.date = "2026-11-31")));
    expectIssue(issues, { path: "constraintSets[0].constraints[3].date", code: "invalid_format" });
  });

  it("rejects a bad candidate delivery date", () => {
    const issues = issuesOf(
      draftWith((d) => void (d.phases[1]!.expectations[0]!.candidate.deliveryDate = "2026-11-20T09:00")),
    );
    expectIssue(issues, { path: "phases[1].expectations[0].candidate.deliveryDate", code: "invalid_format" });
  });

  it("accepts a real leap day", () => {
    const draft = draftWith((d) => void (d.catalog.items[2]!.earliestDate = "2028-02-29"));
    expectLoads(draft);
  });
});

describe("unknown item references", () => {
  it("rejects an unknown item in a constraint", () => {
    const issues = issuesOf(
      draftWith((d) => void (d.constraintSets[0]!.constraints[2]!.itemIds = ["sso-login", "mobile-app"])),
    );
    const issue = expectIssue(issues, {
      path: "constraintSets[0].constraints[2].itemIds[1]",
      code: "custom",
      check: FIXTURE_CHECK.unknownItem,
    });
    expect(issue.message).toContain("mobile-app");
  });

  it("rejects an unknown item in an expectation candidate", () => {
    const issues = issuesOf(
      draftWith((d) => void (d.phases[0]!.expectations[0]!.candidate.itemIds = ["sso-login", "ghost-item"])),
    );
    expectIssue(issues, {
      path: "phases[0].expectations[0].candidate.itemIds[1]",
      check: FIXTURE_CHECK.unknownItem,
    });
  });

  it("does not report a total mismatch when the items are unknown", () => {
    const issues = issuesOf(draftWith((d) => void (d.phases[0]!.expectations[1]!.candidate.itemIds = ["ghost-item"])));
    expect(issues.some((i) => i.check === FIXTURE_CHECK.totalMismatch)).toBe(false);
  });

  it("rejects a duplicate item reference", () => {
    const issues = issuesOf(
      draftWith((d) => void (d.constraintSets[1]!.constraints[2]!.itemIds = ["sso-login", "sso-login"])),
    );
    expectIssue(issues, { path: "constraintSets[1].constraints[2].itemIds[1]", check: FIXTURE_CHECK.duplicateId });
  });
});

describe("other cross-reference checks", () => {
  it("rejects an expected total that does not match catalog prices", () => {
    const issues = issuesOf(draftWith((d) => void (d.phases[0]!.expectations[1]!.outcome.itemsTotalCents = 80000)));
    expectIssue(issues, {
      path: "phases[0].expectations[1].outcome.itemsTotalCents",
      check: FIXTURE_CHECK.totalMismatch,
    });
  });

  it("rejects unknown role references", () => {
    const issues = issuesOf(
      draftWith((d) => {
        d.participants[0]!.roleId = "auditor";
        d.catalog.items[0]!.sourceRoleId = "vendor";
        d.constraintSets[0]!.constraints[0]!.ownerRoleId = "cfo";
        (d.privateBriefs as Record<string, unknown>)["legal"] = { summary: "x" };
      }),
    );
    expectIssue(issues, { path: "participants[0].roleId", check: FIXTURE_CHECK.unknownRole });
    expectIssue(issues, { path: "catalog.items[0].sourceRoleId", check: FIXTURE_CHECK.unknownRole });
    expectIssue(issues, { path: "constraintSets[0].constraints[0].ownerRoleId", check: FIXTURE_CHECK.unknownRole });
    expectIssue(issues, { path: "privateBriefs.legal", check: FIXTURE_CHECK.unknownRole });
    expectIssue(issues, { path: "roles[0].id", check: FIXTURE_CHECK.roleWithoutParticipant });
  });

  it("rejects duplicate ids", () => {
    const issues = issuesOf(
      draftWith((d) => {
        d.catalog.items[2]!.id = "sso-login";
        d.phases[1]!.id = "initial";
        d.constraintSets[0]!.constraints[1]!.id = "budget-cap";
      }),
    );
    expectIssue(issues, { path: "catalog.items[2].id", check: FIXTURE_CHECK.duplicateId });
    expectIssue(issues, { path: "phases[1].id", check: FIXTURE_CHECK.duplicateId });
    expectIssue(issues, { path: "constraintSets[0].constraints[1].id", check: FIXTURE_CHECK.duplicateId });
  });

  it("requires constraint set versions 1..n in order", () => {
    const issues = issuesOf(draftWith((d) => void (d.constraintSets[1]!.version = 3)));
    expectIssue(issues, { path: "constraintSets[1].version", check: FIXTURE_CHECK.constraintVersionSequence });
  });

  it("rejects a phase that references a missing constraint set version", () => {
    const issues = issuesOf(draftWith((d) => void (d.phases[1]!.constraintSetVersion = 7)));
    expectIssue(issues, { path: "phases[1].constraintSetVersion", check: FIXTURE_CHECK.unknownConstraintVersion });
  });

  it("rejects phases whose constraint version goes backwards", () => {
    const issues = issuesOf(draftWith((d) => d.phases.reverse()));
    expectIssue(issues, { path: "phases[1].constraintSetVersion", check: FIXTURE_CHECK.constraintVersionRegression });
  });

  it("requires the fixture to be marked simulated", () => {
    const issues = issuesOf(draftWith((d) => void ((d.provenance as { simulated: boolean }).simulated = false)));
    expectIssue(issues, { path: "provenance.simulated", code: "invalid_value" });
    const missing = issuesOf(draftWith((d) => void delete (d as Partial<typeof d>).provenance));
    expectIssue(missing, { path: "provenance", code: "invalid_type" });
  });

  it("rejects unknown keys (typos) and bad slugs", () => {
    const issues = issuesOf(
      draftWith((d) => {
        (d.catalog.items[0] as Record<string, unknown>)["price"] = 50000;
        d.roles[0]!.id = "Customer Role";
      }),
    );
    expectIssue(issues, { path: "catalog.items[0]", code: "unrecognized_keys" });
    expectIssue(issues, { path: "roles[0].id", code: "invalid_format" });
  });

  it("rejects non-JSON values inside opaque records", () => {
    const issues = issuesOf(
      draftWith((d) => void ((d.privateBriefs.customer as Record<string, unknown>)["when"] = new Date(0))),
    );
    expect(issues.some((i) => i.path.startsWith("privateBriefs.customer"))).toBe(true);
  });
});
