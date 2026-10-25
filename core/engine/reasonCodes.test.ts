import { describe, expect, test } from "vitest";
import {
  ERROR_CODES,
  AUDIENCE_PARAMS,
  PARAM_AUDIENCE,
  REASON_CODES,
  REASON_CODES_BY_DOMAIN,
  REASON_CODE_META,
  REASON_DOMAINS,
  type ReasonCode,
  audienceParams,
  filterReasonParams,
  isReasonCode,
} from "./reasonCodes";

describe("core/engine/reasonCodes", () => {
  const canonByDomain = {
    output: [
      "output.not_json",
      "output.schema_violation",
      "output.truncated",
      "output.refusal",
      "output.unknown_reference",
    ],
    action: [
      "action.not_allowed_for_role",
      "action.option_not_in_snapshot",
      "action.repeats_blocked",
    ],
    item: [
      "item.unknown",
      "item.unconfirmed",
      "item.retired",
      "item.required_missing",
      "item.duplicate",
      "item.limit_exceeded",
    ],
    date: [
      "date.invalid",
      "date.in_past",
      "date.after_deadline",
      "date.before_lead_time",
      "date.out_of_range",
    ],
    budget: ["budget.over", "budget.below_committed"],
    amount: ["amount.claim_mismatch", "amount.out_of_range"],
    version: ["version.stale_constraints", "version.stale_source"],
    approval: [
      "approval.stale",
      "approval.missing_role",
      "approval.self_conflict",
      "approval.not_current",
      "approval.already_executed",
      "approval.not_executable",
    ],
    disclosure: ["disclosure.blocked", "disclosure.needs_own_confirmation"],
    run: ["run.call_limit", "run.draining", "run.invalid_state", "run.rate_limited"],
    private: ["private.constraint_unmet"],
  } as const;

  test("REASON_CODES_BY_DOMAIN and REASON_CODES match canon §1.5 exactly", () => {
    expect(REASON_DOMAINS).toEqual(Object.keys(canonByDomain));
    expect(REASON_CODES_BY_DOMAIN).toEqual(canonByDomain);

    const expectedFlat = Object.values(canonByDomain).flat();
    expect(REASON_CODES).toEqual(expectedFlat);
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
  });

  test("every reason code follows lowercase <domain>.<slug> format and excludes deprecated codes", () => {
    for (const code of REASON_CODES) {
      expect(code).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      const [domain] = code.split(".");
      expect(REASON_DOMAINS).toContain(domain);
    }

    const deprecatedCodes = [
      "OVER_BUDGET",
      "STALE_CATALOG",
      "DATE_MISMATCH",
      "OK",
      "FITS_BUDGET",
      "budget.within",
      "budget.fits",
      "PRIVATE_CONSTRAINT_UNMET",
      "ACTION_NOT_ALLOWED_FOR_ROLE",
      "OPTION_NOT_IN_SNAPSHOT",
      "OUTPUT_NOT_JSON",
      "OUTPUT_SCHEMA_VIOLATION",
      "OUTPUT_TRUNCATED",
      "internal",
    ];
    for (const legacy of deprecatedCodes) {
      expect(REASON_CODES).not.toContain(legacy);
      expect(isReasonCode(legacy)).toBe(false);
    }
  });

  test("isReasonCode narrows canonical codes and rejects non-canonical inputs", () => {
    for (const code of REASON_CODES) {
      expect(isReasonCode(code)).toBe(true);
    }
    expect(isReasonCode("")).toBe(false);
    expect(isReasonCode("budget")).toBe(false);
    expect(isReasonCode("budget.unknown")).toBe(false);
    expect(isReasonCode(null)).toBe(false);
    expect(isReasonCode(undefined)).toBe(false);
    expect(isReasonCode(123)).toBe(false);
    expect(isReasonCode({ code: "budget.over" })).toBe(false);
  });

  test("per-code metadata covers every ReasonCode and never exposes private params to provider", () => {
    expect(Object.keys(REASON_CODE_META)).toEqual([...REASON_CODES]);
    expect(Object.keys(AUDIENCE_PARAMS)).toEqual([...REASON_CODES]);
    expect(Object.keys(PARAM_AUDIENCE)).toEqual([...ERROR_CODES]);

    for (const code of REASON_CODES) {
      const meta = REASON_CODE_META[code];
      expect(meta.code).toBe(code);
      const callerKeys = Object.entries(PARAM_AUDIENCE[code]).filter(([, rule]) => rule === 'caller').map(([name]) => name);
      expect(meta.audienceParams.provider).toEqual(callerKeys);
      expect(audienceParams(code, "provider")).toEqual(callerKeys);

      const filteredForProvider = audienceParams(code, "provider", {
        overByCents: 10_000,
        headroomCents: 80_000,
        deadline: "2026-11-18",
        itemKeys: ["sso_login"],
        localDate: "2026-10-24",
        checkedAgainst: 2,
      });
      expect(Object.keys(filteredForProvider).every(name => callerKeys.includes(name))).toBe(true);
      expect(filteredForProvider).not.toHaveProperty('overByCents');
      expect(filteredForProvider).not.toHaveProperty('deadline');
    }
  });

  test("audienceParams drops unknown parameters (fail-closed) and unknown codes", () => {
    const raw = {
      overByCents: 10_000,
      headroomCents: 80_000,
      capCents: 480_000,
      secretNote: "leaked",
      checkId: "budget_check",
    };

    // Even the owner only receives declared params for budget.over; unknown keys are dropped.
    expect(audienceParams("budget.over", "owner", raw)).toEqual({
      overByCents: 10_000,
      headroomCents: 80_000,
    });
    expect(filterReasonParams("budget.over", raw, "finance")).toEqual({
      overByCents: 10_000,
      headroomCents: 80_000,
    });

    // Customer only receives budget.over params when headroomCents is explicitly disclosed (D11, 06 §6.3).
    // Omitted options and empty options fail closed (W0-3-r01).
    expect(filterReasonParams("budget.over", { overByCents: 100, headroomCents: 20 }, "customer")).toEqual({});
    expect(filterReasonParams("budget.over", { overByCents: 100, headroomCents: 20 }, "customer", {})).toEqual({});
    expect(audienceParams("budget.over", "customer")).toEqual([]);
    expect(audienceParams("budget.over", "customer", raw)).toEqual({});
    expect(audienceParams("budget.over", "customer", raw, {})).toEqual({});
    expect(audienceParams("budget.over", "customer", raw, { disclosedFields: [] })).toEqual({});
    expect(
      audienceParams("budget.over", "customer", raw, { disclosedFields: ["capCents"] }),
    ).toEqual({});
    expect(
      audienceParams("budget.over", "customer", raw, {
        disclosedFields: ["capCents", "headroomCents"],
      }),
    ).toEqual({
      overByCents: 10_000,
      headroomCents: 80_000,
    });
    expect(
      filterReasonParams("budget.over", { overByCents: 100, headroomCents: 20 }, "customer", {
        disclosedFields: ["headroomCents"],
      }),
    ).toEqual({
      overByCents: 100,
      headroomCents: 20,
    });

    // Room audience (without disclosure) receives no budget.over params.
    expect(audienceParams("budget.over", "room", raw)).toEqual({});

    // private.constraint_unmet never carries checkId or any params for any audience.
    for (const aud of ["owner", "buyer", "room", "provider", "customer", "finance"] as const) {
      expect(
        audienceParams("private.constraint_unmet", aud, {
          checkId: "budget_fit",
          overByCents: 100,
        }),
      ).toEqual({});
    }

    // Unknown reason code fails closed.
    expect(audienceParams("unknown.code" as ReasonCode, "owner")).toEqual([]);
    expect(audienceParams("unknown.code", "owner", { field: "x" })).toEqual({});
  });

  test("audienceParams enforces owner-only vs room vs ifDisclosed rules across domains", () => {
    // budget.below_committed: owner (finance) only
    expect(
      audienceParams("budget.below_committed", "finance", {
        belowByCents: 5_000,
        minAllowedCapCents: 400_000,
        extra: 1,
      }),
    ).toEqual({
      belowByCents: 5_000,
      minAllowedCapCents: 400_000,
    });
    expect(
      audienceParams("budget.below_committed", "customer", {
        belowByCents: 5_000,
        minAllowedCapCents: 400_000,
      }),
    ).toEqual({});

    // date.after_deadline: customer is owner; finance needs explicit deadline disclosure
    const deadlineParams = { deadline: "2026-11-18", daysLate: 4, extra: "drop" };
    expect(audienceParams("date.after_deadline", "customer", deadlineParams)).toEqual({
      deadline: "2026-11-18",
      daysLate: 4,
    });
    expect(filterReasonParams("date.after_deadline", deadlineParams, "finance")).toEqual({});
    expect(filterReasonParams("date.after_deadline", deadlineParams, "finance", {})).toEqual({});
    expect(audienceParams("date.after_deadline", "finance", deadlineParams)).toEqual({});
    expect(
      audienceParams("date.after_deadline", "finance", deadlineParams, { disclosedFields: [] }),
    ).toEqual({});
    expect(
      audienceParams("date.after_deadline", "finance", deadlineParams, {
        disclosedFields: ["deadline"],
      }),
    ).toEqual({
      deadline: "2026-11-18",
      daysLate: 4,
    });

    // item.required_missing: customer is owner; finance/buyer need explicit requiredItemKeys disclosure
    const reqMissingParams = {
      itemKeys: ["sso_login"],
      missingItemKeys: ["sso_login"],
      reason: "not_included",
    };
    expect(filterReasonParams("item.required_missing", reqMissingParams, "customer")).toEqual(
      reqMissingParams,
    );
    expect(filterReasonParams("item.required_missing", reqMissingParams, "finance")).toEqual({});
    expect(filterReasonParams("item.required_missing", reqMissingParams, "finance", {})).toEqual({});
    expect(filterReasonParams("item.required_missing", reqMissingParams, "buyer")).toEqual({});
    expect(
      filterReasonParams("item.required_missing", reqMissingParams, "finance", {
        disclosedFields: ["requiredItemKeys"],
      }),
    ).toEqual(reqMissingParams);

    // item.unknown / version.stale_constraints: room-visible to buyers, hidden from provider
    expect(
      audienceParams("item.unknown", "room", { itemKeys: ["sso_login"], extra: "drop" }),
    ).toEqual({ itemKeys: ["sso_login"] });
    expect(
      audienceParams("version.stale_constraints", "customer", { checkedAgainst: 2, extra: "x" }),
    ).toEqual({ checkedAgainst: 2 });
    expect(
      audienceParams("version.stale_constraints", "provider", { checkedAgainst: 2 }),
    ).toEqual({});
  });
});
