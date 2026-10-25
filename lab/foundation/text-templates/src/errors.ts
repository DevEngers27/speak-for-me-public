/**
 * Error type for every failure in this package.
 *
 * Log discipline: messages and fields NEVER contain slot values. Values may be
 * private (a budget, a brief excerpt) and errors end up in logs. Only the
 * template id, the slot name and a fixed reason code are reported.
 */
export type TemplateErrorCode =
  /** defineTemplate: text/slot declaration mismatch, bad syntax, bad slot spec. */
  | 'INVALID_TEMPLATE'
  /** render/fragment: the template object was not produced by defineTemplate. */
  | 'NOT_A_TEMPLATE'
  /** render/fragment: values is not a plain data object (array, class instance, accessor, symbol key...). */
  | 'INVALID_VALUES'
  /** render/fragment: a declared slot has no value. */
  | 'MISSING_SLOT'
  /** render/fragment: a value was supplied for a slot the template does not declare. */
  | 'UNKNOWN_SLOT'
  /** render/fragment: a value does not satisfy its slot kind. */
  | 'INVALID_SLOT_VALUE'
  /** render: an injected formatter threw or returned a non-string. */
  | 'FORMATTER_FAILED';

const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Returns the key itself only if it looks like a code identifier; never echoes arbitrary data. */
export function describeKey(key: string): string {
  return IDENT_RE.test(key) ? key : '<non-identifier key>';
}

export class TemplateError extends Error {
  override readonly name = 'TemplateError';
  readonly code: TemplateErrorCode;
  readonly templateId: string | undefined;
  readonly slot: string | undefined;
  /** Short fixed reason, e.g. "not an integer". Never contains the offending value. */
  readonly reason: string;

  constructor(code: TemplateErrorCode, reason: string, templateId?: string, slot?: string) {
    const where = [templateId === undefined ? '' : `template "${templateId}"`, slot === undefined ? '' : `slot "${slot}"`]
      .filter(Boolean)
      .join(' ');
    super(`${code}${where ? ` (${where})` : ''}: ${reason}`);
    this.code = code;
    this.reason = reason;
    this.templateId = templateId;
    this.slot = slot;
  }
}
