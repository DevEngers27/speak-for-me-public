// Illustrative registries for tests only. Codes here are NOT the product's
// codes; the design docs (06 rules engine, 07 permissions, 12 api) own those.
import {
  defineErrors,
  defineReasonCodes,
  errorSpecs,
  field,
  mergeErrorSpecs,
  param,
  reasonSpecs,
} from "../src/index.js";

/** A privacy canary: must never appear in anything serialized. */
export const CANARY_TEXT = "CANARY_7f3a_private_note";
export const CANARY_NUMBER = 480017;

export const coreSpecs = errorSpecs({
  internal: {
    severity: "error",
    retryable: false,
    exposure: "public",
    message: "Something went wrong. Please try again.",
  },
  not_found: {
    severity: "info",
    retryable: false,
    exposure: "public",
    message: "That item could not be found.",
  },
  rate_limited: {
    severity: "warning",
    retryable: true,
    exposure: "public",
    message: "Too many requests. Please wait and retry.",
    data: { retryAfterMs: field.client<number>(), bucket: field.log<string>() },
  },
  dependency_unavailable: {
    severity: "error",
    retryable: true,
    exposure: "internal",
    message: "A required service is unavailable.",
    data: { attempt: field.log<number>(), detail: field.secret<string>() },
  },
});

export const exampleScenarioSpecs = errorSpecs({
  "example.limit_exceeded": {
    severity: "info",
    retryable: false,
    exposure: "public",
    message: "This exceeds an allowed limit.",
    data: {
      resource: field.client<string>(),
      limitMinor: field.secret<number>(),
      note: field.secret<string>(),
    },
  },
});

export const E = defineErrors(mergeErrorSpecs(coreSpecs, exampleScenarioSpecs), {
  fallback: "internal",
});

export const ruleReasonSpecs = reasonSpecs({
  "limit.within": {
    params: { headroomMinor: param.restricted(param.cents()) },
    meta: { blocking: false },
  },
  "limit.exceeded": {
    params: {
      overByMinor: param.restricted(param.cents()),
      limitMinor: param.restricted(param.cents()),
    },
    meta: { blocking: true },
  },
  "item.unknown": { params: { itemKey: param.key() }, meta: { blocking: true } },
  "item.required_missing": { params: { itemKeys: param.keys() }, meta: { blocking: true } },
  "date.too_late": {
    params: { proposed: param.date(), latestAllowed: param.restricted(param.date()) },
    meta: { blocking: true },
  },
  "version.stale": { params: { expected: param.count(), actual: param.count() } },
  "mode.unsupported": { params: { mode: param.oneOf(["fast", "safe"]) } },
  "doc.flagged": { params: { docId: param.id(), confirmed: param.bool(), delta: param.int() } },
  empty: {},
});

export const R = defineReasonCodes(ruleReasonSpecs);
