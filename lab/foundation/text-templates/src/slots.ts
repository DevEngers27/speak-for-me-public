/**
 * Slot kinds: the closed set of value types a template may interpolate.
 *
 * There is deliberately no "any string" slot. Free text exists (`text`) but is
 * length-bounded and character-restricted; identifiers use `token`; closed
 * vocabularies (roles, reason codes) use `enum`, whose display labels are
 * authored in code. Each builder takes an optional type parameter so callers
 * can demand a branded type (e.g. `slot.amount<PublicAmountCents>()`), which
 * lets the engine forbid a private number from reaching an amount slot.
 */
import { TemplateError } from './errors.ts';
import { UNSAFE_TEXT_CHARS } from './encoders.ts';
import type { AnyTemplate, EmptyFragment, Fragment } from './template.ts';

declare const valueType: unique symbol;

/** Phantom carrier of the slot's accepted value type (type-level only; never present at runtime). */
interface SlotBase<K extends string, V> {
  readonly kind: K;
  readonly [valueType]?: V;
}

export interface TextSlot<V extends string = string> extends SlotBase<'text', V> {
  readonly maxLength: number;
}
export interface TokenSlot<V extends string = string> extends SlotBase<'token', V> {
  readonly pattern: RegExp;
}
export interface EnumSlot<V extends string = string> extends SlotBase<'enum', V> {
  readonly labels: Readonly<Record<V, string>>;
}
export interface AmountSlot<V extends number = number> extends SlotBase<'amount', V> {
  readonly signed: boolean;
}
export interface DateSlot<V extends string = string> extends SlotBase<'date', V> {}
export interface IntegerSlot<V extends number = number> extends SlotBase<'integer', V> {
  readonly min: number;
  readonly max: number;
}
export type ListItemSlot = TextSlot<string> | TokenSlot<string> | EnumSlot<string>;
export interface ListSlot<I extends ListItemSlot = ListItemSlot>
  extends SlotBase<'list', readonly SlotValue<I>[]> {
  readonly item: I;
  readonly minItems: number;
  readonly maxItems: number;
}
export interface FragmentSlot<T extends AnyTemplate = AnyTemplate, Optional extends boolean = boolean>
  extends SlotBase<'fragment', Fragment<T['id']> | (Optional extends true ? EmptyFragment : never)> {
  readonly of: readonly T[];
  readonly optional: Optional;
}

export type SlotSpec =
  | TextSlot<string>
  | TokenSlot<string>
  | EnumSlot<string>
  | AmountSlot<number>
  | DateSlot<string>
  | IntegerSlot<number>
  | ListSlot<ListItemSlot>
  | FragmentSlot<AnyTemplate, boolean>;

export type SlotMap = Readonly<Record<string, SlotSpec>>;

/** The value type a slot accepts. */
export type SlotValue<S> = S extends SlotBase<string, infer V> ? V : never;

/** Specs minted by the builders below. defineTemplate rejects anything else at runtime. */
const mintedSpecs = new WeakSet<object>();
function mint<T extends object>(spec: T): T {
  Object.freeze(spec);
  mintedSpecs.add(spec);
  return spec;
}
export function isMintedSlotSpec(value: unknown): value is SlotSpec {
  return typeof value === 'object' && value !== null && mintedSpecs.has(value);
}

function invalidSpec(reason: string): TemplateError {
  return new TemplateError('INVALID_TEMPLATE', reason);
}

function boundedInt(value: number | undefined, fallback: number, name: string): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v)) throw invalidSpec(`${name} must be a safe integer`);
  return v;
}

const DEFAULT_TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}/;
const anchoredPatterns = new WeakMap<RegExp, RegExp>();

export interface TextOptions { readonly maxLength?: number }
export interface TokenOptions { readonly pattern?: RegExp }
export interface AmountOptions { readonly signed?: boolean }
export interface IntegerOptions { readonly min?: number; readonly max?: number }
export interface ListOptions { readonly minItems?: number; readonly maxItems?: number }

// Separate builders instead of an `optional` type parameter: a defaulted type
// parameter would be widened to `boolean` by contextual return-type inference
// inside defineTemplate({ slots: {...} }), silently making every fragment optional.
function mintFragment(of: readonly AnyTemplate[], optional: boolean): FragmentSlot {
  if (!Array.isArray(of) || of.length === 0) throw invalidSpec('fragment slot needs at least one template');
  return mint({ kind: 'fragment', of: Object.freeze([...of]), optional } as FragmentSlot);
}

export const slot = Object.freeze({
  /**
   * Bounded free text from an allowlisted source (e.g. a catalog label a human
   * confirmed). Rejects control/bidi/zero-width characters, lone surrogates,
   * empty strings, surrounding whitespace and anything over `maxLength` (default 120).
   */
  text<V extends string = string>(options: TextOptions = {}): TextSlot<V> {
    const maxLength = boundedInt(options.maxLength, 120, 'maxLength');
    if (maxLength < 1 || maxLength > 2000) throw invalidSpec('maxLength must be in [1, 2000]');
    return mint({ kind: 'text', maxLength } as TextSlot<V>);
  },

  /** An identifier-like string (item keys, codes). The pattern is matched against the whole value. */
  token<V extends string = string>(options: TokenOptions = {}): TokenSlot<V> {
    const pattern = options.pattern ?? DEFAULT_TOKEN_PATTERN;
    if (pattern.global || pattern.sticky) throw invalidSpec('token pattern must not use the g or y flag (stateful)');
    anchoredPatterns.set(pattern, new RegExp(`^(?:${pattern.source})$`, pattern.flags));
    return mint({ kind: 'token', pattern } as TokenSlot<V>);
  },

  /** A closed vocabulary. Keys are the accepted values; values are the display labels. */
  enum<const L extends Readonly<Record<string, string>>>(labels: L): EnumSlot<keyof L & string> {
    const entries = Object.entries(labels);
    if (entries.length === 0) throw invalidSpec('enum needs at least one value');
    for (const [, label] of entries) {
      if (typeof label !== 'string' || label.length === 0 || UNSAFE_TEXT_CHARS.test(label)) {
        throw invalidSpec('enum labels must be non-empty strings without control characters');
      }
    }
    const frozen = Object.freeze(Object.assign(Object.create(null) as object, labels)) as L;
    return mint({ kind: 'enum', labels: frozen } as unknown as EnumSlot<keyof L & string>);
  },

  /** Integer minor units (cents). Rendered by `formatters.amount`. Negative only if `signed`. */
  amount<V extends number = number>(options: AmountOptions = {}): AmountSlot<V> {
    return mint({ kind: 'amount', signed: options.signed ?? false } as AmountSlot<V>);
  },

  /** A real calendar date `YYYY-MM-DD` (years 0001-9999). Rendered by `formatters.date`. */
  date<V extends string = string>(): DateSlot<V> {
    return mint({ kind: 'date' } as DateSlot<V>);
  },

  /** A safe integer in [min, max] (defaults [0, MAX_SAFE_INTEGER]). Rendered by `formatters.integer`. */
  integer<V extends number = number>(options: IntegerOptions = {}): IntegerSlot<V> {
    const min = boundedInt(options.min, 0, 'min');
    const max = boundedInt(options.max, Number.MAX_SAFE_INTEGER, 'max');
    if (min > max) throw invalidSpec('min must be <= max');
    return mint({ kind: 'integer', min, max } as IntegerSlot<V>);
  },

  /** A list of text/token/enum items. Rendered by `formatters.list` after per-item validation. */
  list<const I extends ListItemSlot>(item: I, options: ListOptions = {}): ListSlot<I> {
    if (!isMintedSlotSpec(item) || !(item.kind === 'text' || item.kind === 'token' || item.kind === 'enum')) {
      throw invalidSpec('list item must be a text, token or enum slot');
    }
    const minItems = boundedInt(options.minItems, 1, 'minItems');
    const maxItems = boundedInt(options.maxItems, 50, 'maxItems');
    if (minItems < 0 || minItems > maxItems) throw invalidSpec('list bounds must satisfy 0 <= minItems <= maxItems');
    return mint({ kind: 'list', item, minItems, maxItems } as ListSlot<I>);
  },

  /**
   * A nested, already-validated rendering of one of the listed templates
   * (built with `fragment()`). This is how conditional clauses are expressed
   * without putting logic in template text. Does not accept `emptyFragment`.
   */
  fragment<const T extends AnyTemplate>(of: readonly [T, ...T[]]): FragmentSlot<T, false> {
    return mintFragment(of, false) as FragmentSlot<T, false>;
  },

  /** Like `fragment`, but also accepts `emptyFragment` (renders as ""). */
  optionalFragment<const T extends AnyTemplate>(of: readonly [T, ...T[]]): FragmentSlot<T, true> {
    return mintFragment(of, true) as FragmentSlot<T, true>;
  },
});

/** Internal: canonical, validated form of a slot value, before formatting. */
export type Canonical =
  | { readonly kind: 'string'; readonly value: string } // text, token, enum label
  | { readonly kind: 'amount'; readonly value: number }
  | { readonly kind: 'date'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'list'; readonly value: readonly string[] };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

/** Returns a fixed reason string if invalid, or the canonical item string. */
function checkItem(spec: ListItemSlot, value: unknown): string | { readonly reason: string } {
  if (typeof value !== 'string') return { reason: 'expected a string' };
  switch (spec.kind) {
    case 'text':
      if (value.length === 0) return { reason: 'empty text' };
      if (value.length > spec.maxLength) return { reason: `text longer than ${spec.maxLength}` };
      if (!value.isWellFormed()) return { reason: 'text is not well-formed Unicode' };
      if (UNSAFE_TEXT_CHARS.test(value)) return { reason: 'text contains control, bidi or zero-width characters' };
      if (value.trim() !== value) return { reason: 'text has leading or trailing whitespace' };
      return value;
    case 'token': {
      const anchored = anchoredPatterns.get(spec.pattern);
      if (anchored === undefined || !anchored.test(value)) return { reason: 'token does not match its pattern' };
      return value;
    }
    case 'enum':
      if (!Object.hasOwn(spec.labels, value)) return { reason: 'value is not in the enum' };
      return (spec.labels as Readonly<Record<string, string>>)[value] as string;
  }
}

/**
 * Validates a non-fragment slot value. Throws INVALID_SLOT_VALUE with a fixed
 * reason (never the value). Fragment slots are validated by the template module.
 */
export function canonicalize(spec: Exclude<SlotSpec, FragmentSlot>, value: unknown, templateId: string, slotName: string): Canonical {
  const fail = (reason: string): never => {
    throw new TemplateError('INVALID_SLOT_VALUE', reason, templateId, slotName);
  };
  switch (spec.kind) {
    case 'text':
    case 'token':
    case 'enum': {
      const r = checkItem(spec, value);
      return typeof r === 'string' ? { kind: 'string', value: r } : fail(r.reason);
    }
    case 'amount':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fail('amount must be a safe integer of minor units');
      if (!spec.signed && value < 0) return fail('amount must not be negative');
      return { kind: 'amount', value: value === 0 ? 0 : value };
    case 'date':
      if (typeof value !== 'string' || !isCalendarDate(value)) return fail('date must be a real calendar date YYYY-MM-DD');
      return { kind: 'date', value };
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fail('expected a safe integer');
      if (value < spec.min || value > spec.max) return fail(`integer outside [${spec.min}, ${spec.max}]`);
      return { kind: 'integer', value: value === 0 ? 0 : value };
    case 'list': {
      if (!Array.isArray(value)) return fail('expected an array');
      if (value.length < spec.minItems || value.length > spec.maxItems) {
        return fail(`list length outside [${spec.minItems}, ${spec.maxItems}]`);
      }
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) return fail('list must not be sparse');
        const r = checkItem(spec.item, value[i]);
        if (typeof r !== 'string') return fail(`list item ${i}: ${r.reason}`);
        items.push(r);
      }
      return { kind: 'list', value: Object.freeze(items) };
    }
  }
}
