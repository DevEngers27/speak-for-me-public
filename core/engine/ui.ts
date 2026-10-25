// Browser-safe, pure-TypeScript UI subset of core/engine (11 §11.4, L10).
// Never exports ENGINE_CANARY, rule evaluators, candidate enumeration, or projections.

export const APP_NAME = "Speak for Me" as const;

export {
  API_ERROR_CODES,
  ERROR_CODES,
  isReasonCode,
  REASON_CODES,
  type ErrorCode,
  type ReasonCode,
} from "./reasonCodes";

export {
  cents,
  centsToDecimalString,
  centsToInputString,
  formatCents,
  isCents,
  MAX_CENTS,
  MoneyError,
  parseCents,
  parseCentsOrThrow,
  signedCents,
  ZERO_CENTS,
  type Cents,
  type CentsLimit,
  type FormatCentsOptions,
  type MoneyErrorCode,
  type ParseCentsErrorCode,
  type ParseCentsResult,
  type SignedCents,
} from "./money";

export {
  assertIsoDate,
  DateError,
  formatIsoDate,
  isIsoDate,
  isoDate,
  isoDateParts,
  MAX_ISO_DATE,
  MIN_ISO_DATE,
  parseIsoDate,
  type DateErrorCode,
  type DateFormatStyle,
  type IsoDate,
  type ParseIsoDateResult,
} from "./dates";

export { assertItemKey, ITEM_KEY_RE } from "./keys";

export const TEXT_LIMITS = {
  roomTitle: 120,
  catalogTitle: 80,
  taskTitle: 120,
  briefNote: 2_000,
  approvalNote: 500,
  rationale: 1_200,
} as const;

const UNSAFE_TITLE_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u115F\u1160\u180B-\u180E\u200B-\u200F\u2028-\u202F\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFF\u{E0000}-\u{E01EF}]/u;

/** Count Unicode scalar values (code points) rather than UTF-16 code units. */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    void _;
    count += 1;
  }
  return count;
}

/** Validate a single-line plain-text catalog item title (07 §7.14, 11 §11.4). */
export function isValidCatalogTitle(title: string): boolean {
  if (typeof title !== "string") return false;
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed !== title) return false;
  if (/[\uD800-\uDFFF]/u.test(title) || UNSAFE_TITLE_CHARS.test(title)) {
    return false;
  }
  const len = countCodePoints(title);
  return len >= 1 && len <= TEXT_LIMITS.catalogTitle;
}

export { uiStatusText, waitingText, passRequestText, disclosureConsentText } from './uiCopy';
