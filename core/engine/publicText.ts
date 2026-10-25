import { assertCents, MAX_CENTS } from './money';
import { parseIsoDate, type IsoDate } from './dates';
import { ITEM_KEY_RE } from './keys';
export type { IsoDate } from './dates';
/**
 * Public text template engine (`core/engine/publicText.ts`).
 *
 * Pure, deterministic, zero-dependency whitelist template renderer for text
 * that crosses an audience boundary (`room | buyer | owner`).
 *
 * Security invariants (canon §7.16, D11, D13):
 * 1. Closed placeholder set — `{placeholder}` tokens are parsed at both the
 *    type level and runtime; every placeholder must have a matching slot
 *    validator and every declared slot must appear in the template.
 * 2. No free `string` slots on public templates — public templates only accept
 *    closed enums, branded/regex-validated tokens, integer cents, ISO dates,
 *    bounded integers, or nested validated `Fragment`s.
 * 3. Audience variants (`room | buyer | owner`) — every variant of a public
 *    template shares the same declared `reads` whitelist and slot validators.
 * 4. Proxy read-tracking compatibility — `renderPublicText` only reads keys
 *    declared in the template's `reads` / `slots` specification.
 * 5. Tamper-proof `Fragment` — validated fragments store their rendered text
 *    and canonical parts in a module-private `WeakMap` so post-construction
 *    mutation cannot bypass slot validation.
 */

// ---------------------------------------------------------------------------
// Audience variants (canon §7.16 / D13)
// ---------------------------------------------------------------------------

export const AUDIENCE_VARIANTS = ['room', 'buyer', 'owner'] as const;
export type AudienceVariant = (typeof AUDIENCE_VARIANTS)[number];

export function isAudienceVariant(value: unknown): value is AudienceVariant {
  return value === 'room' || value === 'buyer' || value === 'owner';
}

// ---------------------------------------------------------------------------
// Branded scalar primitives
// ---------------------------------------------------------------------------

declare const brandSymbol: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brandSymbol]: Name };

/** Non-negative integer cents approved for public display (`$1,234.56`). */
export type PublicCents = Brand<number, 'PublicCents'>;

/** Validated catalog / scope item key matching `^[a-z][a-z0-9_]{1,39}$`. */
export type ItemKey = Brand<string, 'ItemKey'>;

/** Safe max integer cents ($90,071,992,547,409.91). */
export const MAX_SAFE_CENTS = MAX_CENTS;




/**
 * Character classes forbidden inside any rendered literal or bounded text:
 * - C0 controls (`\u0000-\u001F`), DEL (`\u007F`), C1 controls (`\u0080-\u009F`)
 * - Soft hyphen (`\u00AD`), combining grapheme joiner (`\u034F`)
 * - Hangul fillers (`\u115F`, `\u1160`, `\u3164`, `\uFFA0`)
 * - Mongolian vowel separator & free variation selectors (`\u180B-\u180E`)
 * - Zero-width & bidi marks/isolates/overrides (`\u200B-\u200F`, `\u2028-\u202F`, `\u2060-\u206F`)
 * - BOM (`\uFEFF`), variation selectors (`\uFE00-\uFE0F`), specials (`\uFFF0-\uFFFF`)
 * - Plane 14 tags and variation selectors supplement (`\u{E0000}-\u{E01EF}`)
 */
const UNSAFE_TEXT_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u115F\u1160\u180B-\u180E\u200B-\u200F\u2028-\u202F\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFF\u{E0000}-\u{E01EF}]/u;

/**
 * Characters forbidden inside static template literal segments (allows `\n`
 * only if needed? No — public templates are single-line clean prose without
 * control characters or bidi overrides).
 */
const UNSAFE_LITERAL_CHARS = UNSAFE_TEXT_CHARS;

/** ES2023-compatible lone surrogate check (replaces ES2024 `isWellFormed()`). */
function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDFFF]/u.test(value);
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type TemplateErrorCode =
  | 'INVALID_TEMPLATE_SYNTAX'
  | 'TEMPLATE_SLOT_MISMATCH'
  | 'UNKNOWN_TEMPLATE'
  | 'UNKNOWN_AUDIENCE_VARIANT'
  | 'MISSING_SLOT_VALUE'
  | 'UNDECLARED_SLOT_VALUE'
  | 'UNDECLARED_READ_KEY'
  | 'INVALID_SLOT_VALUE'
  | 'DISALLOWED_PUBLIC_SLOT_KIND';

export class TemplateRenderError extends Error {
  readonly code: TemplateErrorCode;
  readonly templateId: string;
  readonly slot?: string;

  constructor(
    code: TemplateErrorCode,
    templateId: string,
    message: string,
    slot?: string,
  ) {
    super(
      `[${code}] template "${templateId}"${slot !== undefined ? ` slot "${slot}"` : ''}: ${message}`,
    );
    this.name = 'TemplateRenderError';
    this.code = code;
    this.templateId = templateId;
    this.slot = slot;
  }
}

// ---------------------------------------------------------------------------
// Branded value constructors & formatters
// ---------------------------------------------------------------------------

/** Validate and brand a non-negative safe integer cent amount. */
export function publicCents(value: number): PublicCents {
  assertCents(value);
  return value as unknown as PublicCents;
}

/** Validate a real Gregorian calendar `YYYY-MM-DD` date. */
export function isCalendarDate(value: string): boolean {
  return parseIsoDate(value).ok;
}

/** Validate and brand an ISO calendar date (`YYYY-MM-DD`). */
export function isoDate(value: string): IsoDate {
  if (typeof value !== 'string' || !isCalendarDate(value)) {
    throw new RangeError(
      'INVALID_DATE',
    );
  }
  return value as IsoDate;
}

/** Validate and brand a snake_case item key (`^[a-z][a-z0-9_]{1,39}$`). */
export function itemKey(value: string): ItemKey {
  if (typeof value !== 'string' || !ITEM_KEY_RE.test(value)) {
    throw new RangeError(
      'INVALID_ITEM_KEY',
    );
  }
  return value as ItemKey;
}

/**
 * Deterministic locale-independent USD formatter (`$1,234` or `$1,234.56`).
 * Does not use `Intl` so output is identical across every runtime.
 */
export function formatUsdCents(cents: number): string {
  assertCents(cents);
  const wholeDollars = Math.trunc(cents / 100);
  const remainderCents = cents % 100;
  const digits = String(wholeDollars);
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      grouped += ',';
    }
    grouped += digits[i];
  }
  if (remainderCents === 0) {
    return `$${grouped}`;
  }
  return `$${grouped}.${String(remainderCents).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tamper-proof Fragment (resolves text-templates-r02)
// ---------------------------------------------------------------------------

interface FragmentInternal {
  readonly templateId: string;
  readonly text: string;
  readonly parts: {
    readonly template: string;
    readonly canonical: Readonly<Record<string, string>>;
  };
}

const fragmentStore = new WeakMap<Fragment, FragmentInternal>();
const fragmentConstructionToken: unique symbol = Symbol('Fragment.internal');

/**
 * An already-rendered, validated template fragment.
 *
 * Internal state is held in a module-private `WeakMap` and frozen on creation
 * so callers cannot forge or mutate a `Fragment` after validation.
 */
export class Fragment {
  declare private readonly [brandSymbol]: 'Fragment';

  constructor(token: typeof fragmentConstructionToken, internal: FragmentInternal) {
    if (token !== fragmentConstructionToken) {
      throw new TypeError(
        'Fragment cannot be instantiated directly; use renderFragment() or createRenderer().',
      );
    }
    const frozenCanonical = Object.freeze({ ...internal.parts.canonical });
    const frozenParts = Object.freeze({
      template: internal.parts.template,
      canonical: frozenCanonical,
    });
    fragmentStore.set(
      this,
      Object.freeze({
        templateId: internal.templateId,
        text: internal.text,
        parts: frozenParts,
      }),
    );
    Object.freeze(this);
  }

  get templateId(): string {
    const entry = fragmentStore.get(this);
    if (!entry) {
      throw new TypeError('Invalid or forged Fragment instance');
    }
    return entry.templateId;
  }

  get text(): string {
    const entry = fragmentStore.get(this);
    if (!entry) {
      throw new TypeError('Invalid or forged Fragment instance');
    }
    return entry.text;
  }

  get parts(): {
    readonly template: string;
    readonly canonical: Readonly<Record<string, string>>;
  } {
    const entry = fragmentStore.get(this);
    if (!entry) {
      throw new TypeError('Invalid or forged Fragment instance');
    }
    return entry.parts;
  }

  toString(): string {
    return this.text;
  }
}

function createFragmentInstance(
  templateId: string,
  text: string,
  parts: { template: string; canonical: Readonly<Record<string, string>> },
): Fragment {
  return new Fragment(fragmentConstructionToken, {
    templateId,
    text,
    parts,
  });
}

/** Runtime check that `value` is a genuine, un-forged `Fragment`. */
export function isFragment(value: unknown): value is Fragment {
  return typeof value === 'object' && value !== null && fragmentStore.has(value as Fragment);
}

// ---------------------------------------------------------------------------
// Slot specifications & builders
// ---------------------------------------------------------------------------

export type SlotKind =
  | 'enum'
  | 'token'
  | 'amount'
  | 'date'
  | 'integer'
  | 'text'
  | 'list'
  | 'fragment';

/** Slot kinds permitted in public audience templates (`text` is forbidden). */
export type PublicAllowedSlotKind = Exclude<SlotKind, 'text'>;

export interface AnySlotSpec<K extends SlotKind = SlotKind> {
  readonly kind: K;
  readonly description: string;
}

export interface SlotSpec<TInput, K extends SlotKind = SlotKind>
  extends AnySlotSpec<K> {
  render(value: TInput, ctx: { templateId: string; slotName: string }): string;
}

export type PublicSlotSpec<TInput> = SlotSpec<TInput, PublicAllowedSlotKind>;

export type SlotInput<S> = S extends SlotSpec<infer T, SlotKind> ? T : never;

function failSlot(
  ctx: { templateId: string; slotName: string },
  _reason: string,
): never {
  void _reason;
  throw new TemplateRenderError(
    'INVALID_SLOT_VALUE',
    ctx.templateId,
    'Invalid slot value',
    ctx.slotName,
  );
}

export interface TextSlotOptions {
  readonly minLength?: number;
  readonly maxLength: number;
  readonly pattern?: RegExp;
}

const NUMERIC_ENUM_KEY_RE = /^(?:0|[1-9]\d*)$/;

export const slot = {
  /**
   * Closed enum map (`Record<LiteralKey, RenderedText>`).
   * Only `Object.hasOwn(mapping, value)` keys are accepted.
   * Numeric-like keys (`"0"`, `"1"`, ...) are rejected at definition time so
   * key types (`keyof Map & string`) and `Object.keys` order never diverge.
   */
  enum<const Map extends Readonly<Record<string, string>>>(
    mapping: Map,
    description = 'enum',
  ): SlotSpec<keyof Map & string, 'enum'> {
    const keys = Object.keys(mapping);
    if (keys.length === 0) {
      throw new RangeError('slot.enum requires at least one mapping entry');
    }
    const frozen: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (const k of keys) {
      if (NUMERIC_ENUM_KEY_RE.test(k)) {
        throw new RangeError(
          `slot.enum key "${k}" must not be an integer index; use descriptive symbolic keys`,
        );
      }
      const rendered = mapping[k];
      if (
        typeof rendered !== 'string' ||
        hasLoneSurrogate(rendered) ||
        UNSAFE_TEXT_CHARS.test(rendered)
      ) {
        throw new RangeError(
          `slot.enum mapping for key "${k}" must be a safe, well-formed string`,
        );
      }
      frozen[k] = rendered;
    }
    Object.freeze(frozen);

    return {
      kind: 'enum',
      description: `${description} (${keys.join(' | ')})`,
      render(value, ctx) {
        if (typeof value !== 'string' || !Object.hasOwn(frozen, value)) {
          failSlot(
            ctx,
            `expected one of [${keys.join(', ')}], got ${JSON.stringify(value)}`,
          );
        }
        return frozen[value]!;
      },
    };
  },

  /**
   * Constrained identifier / token matching an anchored pattern (e.g. `ItemKey`).
   * Rejects stateful (`g`, `y`) and multiline (`m`) regex flags so `^`/`$`
   * always anchor the entire string.
   */
  token<T extends string = string>(
    pattern: RegExp = ITEM_KEY_RE,
    description = 'token',
  ): SlotSpec<T, 'token'> {
    if (
      pattern.flags.includes('g') ||
      pattern.flags.includes('y') ||
      pattern.flags.includes('m')
    ) {
      throw new RangeError(
        `slot.token regex must not use g, y, or m flags (got /${pattern.source}/${pattern.flags})`,
      );
    }
    if (pattern.source !== ITEM_KEY_RE.source || pattern.flags !== ITEM_KEY_RE.flags) {
      throw new RangeError("slot.token only permits the ItemKey pattern");
    }
    const src = pattern.source;
    if (!src.startsWith('^') || !src.endsWith('$')) {
      throw new RangeError(
        `slot.token regex must be anchored with ^ and $, got /${src}/`,
      );
    }
    return {
      kind: 'token',
      description: `${description} matching /${src}/`,
      render(value, ctx) {
        if (
          typeof value !== 'string' ||
          hasLoneSurrogate(value) ||
          UNSAFE_TEXT_CHARS.test(value) ||
          !pattern.test(value)
        ) {
          failSlot(
            ctx,
            `value ${JSON.stringify(value)} does not match /${src}/`,
          );
        }
        return value;
      },
    };
  },

  /**
   * Non-negative integer cents formatted as `$1,234` or `$1,234.56`.
   * Require `PublicCents` by default (`branded = true`) so raw unapproved
   * numbers fail at compile time.
   */
  amount<Branded extends boolean = true>(
    options?: { branded?: Branded; maxCents?: number },
  ): SlotSpec<Branded extends true ? PublicCents : number, 'amount'> {
    const maxCents = options?.maxCents ?? MAX_SAFE_CENTS;
    if (!Number.isSafeInteger(maxCents) || maxCents < 0) {
      throw new RangeError(`slot.amount maxCents must be a safe non-negative integer`);
    }
    return {
      kind: 'amount',
      description: `USD cents (0..${maxCents})`,
      render(value, ctx) {
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > maxCents
        ) {
          failSlot(
            ctx,
            `expected integer cents in 0..${maxCents}, got ${String(value)}`,
          );
        }
        return formatUsdCents(value);
      },
    };
  },

  /**
   * Calendar date (`YYYY-MM-DD`), branded as `IsoDate` by default.
   */
  date<Branded extends boolean = true>(
    options?: { branded?: Branded },
  ): SlotSpec<Branded extends true ? IsoDate : string, 'date'> {
    void options;
    return {
      kind: 'date',
      description: 'ISO date (YYYY-MM-DD)',
      render(value, ctx) {
        if (typeof value !== 'string' || !isCalendarDate(value)) {
          failSlot(
            ctx,
            `expected valid YYYY-MM-DD date, got ${JSON.stringify(value)}`,
          );
        }
        return value;
      },
    };
  },

  /**
   * Safe integer within `[min, max]`, with an optional unit inflection.
   */
  integer(options: {
    min: number;
    max: number;
    unit?: { singular: string; plural: string };
  }): SlotSpec<number, 'integer'> {
    const { min, max, unit } = options;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError(`Invalid integer slot bounds [${min}, ${max}]`);
    }
    if (unit !== undefined) {
      if (
        hasLoneSurrogate(unit.singular) ||
        UNSAFE_TEXT_CHARS.test(unit.singular) ||
        hasLoneSurrogate(unit.plural) ||
        UNSAFE_TEXT_CHARS.test(unit.plural)
      ) {
        throw new RangeError('slot.integer unit strings must be safe, well-formed text');
      }
    }
    return {
      kind: 'integer',
      description: `integer in [${min}, ${max}]`,
      render(value, ctx) {
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < min ||
          value > max
        ) {
          failSlot(
            ctx,
            `expected integer in [${min}, ${max}], got ${String(value)}`,
          );
        }
        // Normalize -0 to 0
        const normalized = value === 0 ? 0 : value;
        const num = String(normalized);
        if (!unit) return num;
        return `${num} ${normalized === 1 ? unit.singular : unit.plural}`;
      },
    };
  },

  /**
   * Length-bounded, control-char-free single-line text slot.
   * Note: `slot.text` is rejected by `definePublicTemplates` (which enforces
   * the canon D13 ban on free `string` slots in public templates). It is
   * provided for low-level `defineTemplate` callers that require a pattern-
   * and length-bounded label.
   */
  text(options: TextSlotOptions): SlotSpec<string, 'text'> {
    const minLength = options.minLength ?? 1;
    const maxLength = options.maxLength;
    const pattern = options.pattern;
    if (
      !Number.isSafeInteger(minLength) ||
      !Number.isSafeInteger(maxLength) ||
      minLength < 0 ||
      maxLength < minLength ||
      maxLength > 240
    ) {
      throw new RangeError(
        `slot.text bounds must satisfy 0 <= minLength <= maxLength <= 240`,
      );
    }
    if (
      pattern &&
      (pattern.flags.includes('g') ||
        pattern.flags.includes('y') ||
        pattern.flags.includes('m'))
    ) {
      throw new RangeError('slot.text pattern must not use g, y, or m flags');
    }
    return {
      kind: 'text',
      description: `text (${minLength}..${maxLength} chars)`,
      render(value, ctx) {
        if (typeof value !== 'string') {
          failSlot(ctx, `expected string, got ${typeof value}`);
        }
        if (hasLoneSurrogate(value)) {
          failSlot(ctx, 'text contains unpaired UTF-16 surrogate');
        }
        if (value.length < minLength || value.length > maxLength) {
          failSlot(
            ctx,
            `length ${value.length} outside [${minLength}, ${maxLength}]`,
          );
        }
        if (value.trim() !== value && value.length > 0) {
          failSlot(ctx, 'text must not have leading or trailing whitespace');
        }
        if (UNSAFE_TEXT_CHARS.test(value)) {
          failSlot(
            ctx,
            'text contains control, newline, or bidirectional formatting characters',
          );
        }
        if (pattern && !pattern.test(value)) {
          failSlot(ctx, `text does not match /${pattern.source}/`);
        }
        return value;
      },
    };
  },

  /**
   * Bounded list of items validated by an inner `PublicSlotSpec` (or `SlotSpec`).
   * Snapshots `value.length` once (resolves `text-templates-r09`).
   */
  list<T, K extends SlotKind>(
    itemSlot: SlotSpec<T, K>,
    options?: {
      minItems?: number;
      maxItems?: number;
      separator?: string;
      lastSeparator?: string;
      emptyText?: string;
    },
  ): SlotSpec<readonly T[], K extends 'text' ? 'text' : 'list'> {
    const minItems = options?.minItems ?? 1;
    const maxItems = options?.maxItems ?? 16;
    const separator = options?.separator ?? ', ';
    const lastSeparator = options?.lastSeparator ?? separator;
    const emptyText = options?.emptyText ?? 'none';

    if (
      !Number.isSafeInteger(minItems) ||
      !Number.isSafeInteger(maxItems) ||
      minItems < 0 ||
      maxItems < minItems ||
      maxItems > 64
    ) {
      throw new RangeError(
        `slot.list bounds must satisfy 0 <= minItems <= maxItems <= 64`,
      );
    }
    if (
      hasLoneSurrogate(separator) ||
      UNSAFE_TEXT_CHARS.test(separator) ||
      hasLoneSurrogate(lastSeparator) ||
      UNSAFE_TEXT_CHARS.test(lastSeparator) ||
      hasLoneSurrogate(emptyText) ||
      UNSAFE_TEXT_CHARS.test(emptyText)
    ) {
      throw new RangeError(
        'slot.list separator and emptyText must be safe, well-formed strings',
      );
    }

    const effectiveKind = (itemSlot.kind === 'text' ? 'text' : 'list') as K extends 'text'
      ? 'text'
      : 'list';

    return {
      kind: effectiveKind,
      description: `list of (${itemSlot.description}) [${minItems}..${maxItems}]`,
      render(value, ctx) {
        if (!Array.isArray(value)) {
          failSlot(ctx, 'expected an array');
        }
        const len = value.length;
        if (len < minItems || len > maxItems) {
          failSlot(
            ctx,
            `list length ${len} outside [${minItems}, ${maxItems}]`,
          );
        }
        if (len === 0) return emptyText;
        const rendered: string[] = new Array<string>(len);
        for (let i = 0; i < len; i++) {
          rendered[i] = itemSlot.render(value[i] as T, {
            templateId: ctx.templateId,
            slotName: `${ctx.slotName}[${i}]`,
          });
        }
        if (len === 1) return rendered[0]!;
        if (len === 2) return `${rendered[0]!}${lastSeparator}${rendered[1]!}`;
        return `${rendered.slice(0, -1).join(separator)}${lastSeparator}${rendered[len - 1]!}`;
      },
    };
  },

  /**
   * Nested pre-validated `Fragment` from an explicit whitelist of template IDs.
   */
  fragment(
    allowedTemplateIds: readonly string[],
  ): SlotSpec<Fragment, 'fragment'> {
    if (allowedTemplateIds.length === 0) {
      throw new RangeError(
        'slot.fragment requires at least one allowed templateId',
      );
    }
    const allowed = new Set(allowedTemplateIds);
    return {
      kind: 'fragment',
      description: `fragment from [${allowedTemplateIds.join(', ')}]`,
      render(value, ctx) {
        if (!isFragment(value)) {
          failSlot(ctx, 'expected a rendered Fragment instance');
        }
        if (!allowed.has(value.templateId)) {
          failSlot(
            ctx,
            `fragment templateId "${value.templateId}" is not in allowed set [${allowedTemplateIds.join(', ')}]`,
          );
        }
        return value.text;
      },
    };
  },

  /**
   * Optional nested `Fragment` — renders `fallback` when `null` or `undefined`.
   */
  optionalFragment(
    allowedTemplateIds: readonly string[],
    fallback = '',
  ): SlotSpec<Fragment | null | undefined, 'fragment'> {
    if (hasLoneSurrogate(fallback) || UNSAFE_TEXT_CHARS.test(fallback)) {
      throw new RangeError(
        'slot.optionalFragment fallback must be a safe, well-formed string',
      );
    }
    const inner = slot.fragment(allowedTemplateIds);
    return {
      kind: 'fragment',
      description: `optional ${inner.description}`,
      render(value, ctx) {
        if (value === null || value === undefined) return fallback;
        return inner.render(value, ctx);
      },
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Compile-time placeholder extraction (tail-recursive — resolves r07)
// ---------------------------------------------------------------------------

type ExtractPlaceholders<
  T extends string,
  Acc extends string = never,
> = T extends `${string}{${infer Key}}${infer Rest}`
  ? Key extends ''
    ? never
    : Key extends `${string}{${string}` | `${string}}${string}`
      ? never
      : ExtractPlaceholders<Rest, Acc | Key>
  : Acc;

/** Union of `{slot}` placeholder names inside template literal `T`. */
export type Placeholders<T extends string> = ExtractPlaceholders<T>;

export type SlotRecord = Readonly<Record<string, AnySlotSpec<SlotKind>>>;

export type PublicSlotRecord = Readonly<
  Record<string, AnySlotSpec<PublicAllowedSlotKind>>
>;

/**
 * Enforces at compile time that `Slots` has the exact keys of `{...}` in `T`.
 */
export type ValidatedSlots<
  T extends string,
  Slots extends SlotRecord,
> = [keyof Slots & string] extends [Placeholders<T>]
  ? [Placeholders<T>] extends [keyof Slots & string]
    ? Slots
    : {
        readonly __error__: 'Missing slot validator for placeholder';
        readonly __missing__: Exclude<Placeholders<T>, keyof Slots & string>;
      }
  : {
      readonly __error__: 'Declared slot does not appear in template string';
      readonly __extra__: Exclude<keyof Slots & string, Placeholders<T>>;
    };

/** Input parameter object type for a `SlotRecord`. */
export type TemplateParams<Slots extends SlotRecord> = [keyof Slots] extends [
  never,
]
  ? Readonly<Record<string, never>>
  : {
      readonly [K in keyof Slots]: SlotInput<Slots[K]>;
    };

// ---------------------------------------------------------------------------
// Template AST & parser
// ---------------------------------------------------------------------------

type Segment =
  | { readonly type: 'literal'; readonly text: string }
  | { readonly type: 'slot'; readonly name: string };

const SLOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

function parseTemplate(
  id: string,
  template: string,
): { readonly segments: readonly Segment[]; readonly slotNames: ReadonlySet<string> } {
  if (hasLoneSurrogate(template) || UNSAFE_LITERAL_CHARS.test(template)) {
    throw new TemplateRenderError(
      'INVALID_TEMPLATE_SYNTAX',
      id,
      'Template literal contains control, newline, lone surrogate, or bidirectional formatting characters',
    );
  }

  const segments: Segment[] = [];
  const slotNames = new Set<string>();
  let cursor = 0;

  while (cursor < template.length) {
    const openIdx = template.indexOf('{', cursor);
    const closeIdx = template.indexOf('}', cursor);

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        id,
        `Unmatched "}" at index ${closeIdx}`,
      );
    }

    if (openIdx === -1) {
      segments.push({ type: 'literal', text: template.slice(cursor) });
      break;
    }

    if (openIdx > cursor) {
      segments.push({ type: 'literal', text: template.slice(cursor, openIdx) });
    }

    const matchingClose = template.indexOf('}', openIdx + 1);
    if (matchingClose === -1) {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        id,
        `Unclosed "{" at index ${openIdx}`,
      );
    }

    const name = template.slice(openIdx + 1, matchingClose);
    if (!SLOT_NAME_RE.test(name)) {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        id,
        `Invalid placeholder name "${name}" at index ${openIdx}`,
      );
    }

    segments.push({ type: 'slot', name });
    slotNames.add(name);
    cursor = matchingClose + 1;
  }

  return { segments: Object.freeze(segments), slotNames };
}

// ---------------------------------------------------------------------------
// Single-template definition & renderer (backwards-compatible with lab module)
// ---------------------------------------------------------------------------

export interface TemplateDefinition<
  Id extends string = string,
  T extends string = string,
  Slots extends SlotRecord = SlotRecord,
> {
  readonly id: Id;
  readonly template: T;
  readonly slots: Slots;
  readonly slotNames: readonly string[];
  readonly segments: readonly Segment[];
}

export function defineTemplate<
  const Id extends string,
  const T extends string,
  const Slots extends SlotRecord,
>(
  id: Id,
  template: T,
  slots: Slots & ValidatedSlots<T, Slots>,
): TemplateDefinition<Id, T, Slots> {
  if (!id || typeof id !== 'string') {
    throw new TemplateRenderError(
      'INVALID_TEMPLATE_SYNTAX',
      String(id),
      'Template id must be a non-empty string',
    );
  }

  const { segments, slotNames } = parseTemplate(id, template);
  const declaredNames = Object.keys(slots);

  for (const placeholder of slotNames) {
    if (!Object.hasOwn(slots, placeholder)) {
      throw new TemplateRenderError(
        'TEMPLATE_SLOT_MISMATCH',
        id,
        `Placeholder "{${placeholder}}" has no declared slot validator`,
        placeholder,
      );
    }
  }

  for (const declared of declaredNames) {
    if (!slotNames.has(declared)) {
      throw new TemplateRenderError(
        'TEMPLATE_SLOT_MISMATCH',
        id,
        `Declared slot "${declared}" does not appear in template string`,
        declared,
      );
    }
  }

  const frozenSlots = Object.freeze({ ...slots });
  const frozenSlotNames = Object.freeze(
    declaredNames.slice() as (keyof Slots & string)[],
  );

  return Object.freeze({
    id,
    template,
    slots: frozenSlots,
    slotNames: frozenSlotNames,
    segments,
  });
}

function renderParsedSegments<Slots extends SlotRecord>(
  templateId: string,
  templateText: string,
  segments: readonly Segment[],
  slots: Slots,
  slotNames: readonly (keyof Slots & string)[],
  params: Readonly<Record<string, unknown>>,
  options?: { allowExtraFields?: boolean },
): Fragment {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new TemplateRenderError(
      'INVALID_SLOT_VALUE',
      templateId,
      'params must be a non-null plain object',
    );
  }

  if (!options?.allowExtraFields) {
    const allowedSet = new Set<string>(slotNames);
    for (const providedKey of Object.keys(params)) {
      if (!allowedSet.has(providedKey)) {
        throw new TemplateRenderError(
          'UNDECLARED_SLOT_VALUE',
          templateId,
          `Unexpected slot "${providedKey}" is not declared in template whitelist`,
          providedKey,
        );
      }
    }
  }

  // Validate and render each declared slot AT MOST ONCE so Proxy read-tracking
  // sees strictly the declared keys and stateful getters cannot return different
  // values across repeated `{slot}` occurrences.
  const canonical = Object.create(null) as Record<string, string>;
  for (const slotName of slotNames) {
    if (!Object.hasOwn(params, slotName)) {
      throw new TemplateRenderError(
        'MISSING_SLOT_VALUE',
        templateId,
        `Missing required slot "${slotName}"`,
        slotName,
      );
    }
    const spec = slots[slotName] as unknown as SlotSpec<unknown, SlotKind>;
    const rawValue = params[slotName];
    canonical[slotName] = spec.render(rawValue, {
      templateId,
      slotName,
    });
  }

  let output = '';
  for (const seg of segments) {
    if (seg.type === 'literal') {
      output += seg.text;
    } else {
      output += canonical[seg.name]!;
    }
  }

  return createFragmentInstance(templateId, output, {
    template: templateText,
    canonical,
  });
}

export type CatalogMap = Readonly<
  Record<string, TemplateDefinition<string, string, SlotRecord>>
>;

export type ParamsFor<
  C extends CatalogMap,
  Id extends keyof C & string,
> = C[Id] extends TemplateDefinition<string, string, infer Slots>
  ? TemplateParams<Slots>
  : never;

export interface TemplateRenderer<C extends CatalogMap> {
  readonly catalog: C;
  render<Id extends keyof C & string>(
    id: Id,
    params: ParamsFor<C, Id>,
  ): string;
  renderFragment<Id extends keyof C & string>(
    id: Id,
    params: ParamsFor<C, Id>,
  ): Fragment;
}

export function createRenderer<const C extends CatalogMap>(
  catalog: C,
): TemplateRenderer<C> {
  const byId = new Map<string, TemplateDefinition<string, string, SlotRecord>>();
  for (const [key, def] of Object.entries(catalog)) {
    if (def.id !== key) {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        def.id,
        `Catalog key "${key}" does not match template.id "${def.id}"`,
      );
    }
    byId.set(key, def);
  }

  function renderFragment<Id extends keyof C & string>(
    id: Id,
    params: ParamsFor<C, Id>,
  ): Fragment {
    const def = byId.get(id);
    if (!def) {
      throw new TemplateRenderError(
        'UNKNOWN_TEMPLATE',
        String(id),
        `Unknown template "${String(id)}"`,
      );
    }
    return renderParsedSegments(
      def.id,
      def.template,
      def.segments,
      def.slots,
      def.slotNames,
      params as Readonly<Record<string, unknown>>,
    );
  }

  function render<Id extends keyof C & string>(
    id: Id,
    params: ParamsFor<C, Id>,
  ): string {
    return renderFragment(id, params).text;
  }

  return Object.freeze({
    catalog: Object.freeze({ ...catalog }),
    render,
    renderFragment,
  });
}

// ---------------------------------------------------------------------------
// Multi-variant Public Templates (`room | buyer | owner`) — canon §7.16 & D13
// ---------------------------------------------------------------------------

export type AudienceVariantTemplates<
  RoomT extends string = string,
  BuyerT extends string = string,
  OwnerT extends string = string,
> = {
  readonly room: RoomT;
  readonly buyer: BuyerT;
  readonly owner: OwnerT;
};

export type VariantPlaceholders<
  Variants extends AudienceVariantTemplates,
> =
  | Placeholders<Variants['room']>
  | Placeholders<Variants['buyer']>
  | Placeholders<Variants['owner']>;

/**
 * Compile-time verification that:
 * 1. Every slot in `Slots` is a `PublicAllowedSlotKind` (no `slot.text` free string slots).
 * 2. Every placeholder across `room | buyer | owner` has a validator in `Slots`.
 * 3. Every validator in `Slots` is used in at least one audience variant.
 * 4. Every audience variant uses every declared slot (or `reads` matches `keyof Slots`).
 */
export type ValidatedPublicSlots<
  Variants extends AudienceVariantTemplates,
  Slots extends PublicSlotRecord,
> = [keyof Slots & string] extends [VariantPlaceholders<Variants>]
  ? [VariantPlaceholders<Variants>] extends [keyof Slots & string]
    ? Slots
    : {
        readonly __error__: 'Missing slot validator for placeholder in audience variant';
        readonly __missing__: Exclude<
          VariantPlaceholders<Variants>,
          keyof Slots & string
        >;
      }
  : {
      readonly __error__: 'Declared slot does not appear in any audience variant';
      readonly __extra__: Exclude<
        keyof Slots & string,
        VariantPlaceholders<Variants>
      >;
    };

export interface PublicTemplateSpec<
  Variants extends AudienceVariantTemplates = AudienceVariantTemplates,
  Slots extends PublicSlotRecord = PublicSlotRecord,
> {
  readonly variants: Variants;
  readonly slots: Slots;
  /**
   * Optional explicit `reads` declaration (canon §7.16). When provided, must
   * contain the exact set of slot keys in `slots`. Defaults to `Object.keys(slots)`.
   */
  readonly reads?: readonly (keyof Slots & string)[];
}

export interface PublicTemplateDefinition<
  Key extends string = string,
  Variants extends AudienceVariantTemplates = AudienceVariantTemplates,
  Slots extends PublicSlotRecord = PublicSlotRecord,
> {
  readonly key: Key;
  readonly variants: Readonly<Variants>;
  readonly slots: Readonly<Slots>;
  readonly reads: readonly (keyof Slots & string)[];
  readonly parsedVariants: Readonly<
    Record<
      AudienceVariant,
      {
        readonly template: string;
        readonly segments: readonly Segment[];
        readonly slotNames: readonly (keyof Slots & string)[];
      }
    >
  >;
}

export type PublicTemplateCatalogSpec = Readonly<
  Record<
    string,
    PublicTemplateSpec<AudienceVariantTemplates, PublicSlotRecord>
  >
>;

export type ValidatedPublicCatalogSpec<
  Spec extends PublicTemplateCatalogSpec,
> = {
  readonly [K in keyof Spec & string]: Spec[K] extends PublicTemplateSpec<
    infer Variants,
    infer Slots
  >
    ? {
        readonly variants: Variants;
        readonly slots: Slots & ValidatedPublicSlots<Variants, Slots>;
        readonly reads?: readonly (keyof Slots & string)[];
      }
    : never;
};

export type PublicTemplateCatalog<
  Spec extends PublicTemplateCatalogSpec = PublicTemplateCatalogSpec,
> = {
  readonly [K in keyof Spec & string]: Spec[K] extends PublicTemplateSpec<
    infer Variants,
    infer Slots
  >
    ? PublicTemplateDefinition<K, Variants, Slots>
    : never;
};

export type PublicTemplateFields<D> = D extends PublicTemplateDefinition<
  string,
  AudienceVariantTemplates,
  infer Slots
>
  ? TemplateParams<Slots>
  : D extends PublicTemplateSpec<AudienceVariantTemplates, infer Slots>
    ? TemplateParams<Slots>
    : never;

/**
 * Define a single multi-variant (`room | buyer | owner`) public template.
 * Rejects `slot.text` (free string slots) at both compile time and runtime.
 */
export function definePublicTemplate<
  const Key extends string,
  const Variants extends AudienceVariantTemplates,
  const Slots extends PublicSlotRecord,
>(
  key: Key,
  spec: {
    readonly variants: Variants;
    readonly slots: Slots & ValidatedPublicSlots<Variants, Slots>;
    readonly reads?: readonly (keyof Slots & string)[];
  },
): PublicTemplateDefinition<Key, Variants, Slots> {
  if (!key || typeof key !== 'string') {
    throw new TemplateRenderError(
      'INVALID_TEMPLATE_SYNTAX',
      String(key),
      'Public template key must be a non-empty string',
    );
  }

  const rawSlots = spec.slots as PublicSlotRecord;
  const slotEntries = Object.entries(rawSlots);
  const declaredSlotSet = new Set<string>();
  for (const [slotName, slotValidator] of slotEntries) {
    const specCandidate = slotValidator as unknown as
      | SlotSpec<unknown, PublicAllowedSlotKind>
      | undefined;
    if (!specCandidate || typeof specCandidate.render !== 'function') {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        key,
        `Slot "${slotName}" is missing a valid SlotSpec`,
        slotName,
      );
    }
    if (!['enum', 'token', 'amount', 'date', 'integer', 'list', 'fragment'].includes(specCandidate.kind as string)) {
      throw new TemplateRenderError(
        'DISALLOWED_PUBLIC_SLOT_KIND',
        key,
        `Public templates forbid free-text slot "${slotName}" (kind "text")`,
        slotName,
      );
    }
    declaredSlotSet.add(slotName);
  }

  if (spec.reads !== undefined) {
    const readsSet = new Set<string>(spec.reads);
    if (readsSet.size !== spec.reads.length) {
      throw new TemplateRenderError(
        'UNDECLARED_READ_KEY',
        key,
        'Duplicate key in template reads list',
      );
    }
    for (const r of readsSet) {
      if (!declaredSlotSet.has(r)) {
        throw new TemplateRenderError(
          'UNDECLARED_READ_KEY',
          key,
          `reads key "${r}" has no matching slot validator`,
          r,
        );
      }
    }
    for (const s of declaredSlotSet) {
      if (!readsSet.has(s)) {
        throw new TemplateRenderError(
          'UNDECLARED_READ_KEY',
          key,
          `Slot "${s}" is missing from explicit reads declaration`,
          s,
        );
      }
    }
  }

  const allVariantPlaceholders = new Set<string>();
  const parsedVariants = Object.create(null) as Record<
    AudienceVariant,
    {
      readonly template: string;
      readonly segments: readonly Segment[];
      readonly slotNames: readonly (keyof Slots & string)[];
    }
  >;

  for (const variant of AUDIENCE_VARIANTS) {
    const variantTemplate = spec.variants[variant];
    if (typeof variantTemplate !== 'string') {
      throw new TemplateRenderError(
        'INVALID_TEMPLATE_SYNTAX',
        key,
        `Missing "${variant}" audience template string`,
      );
    }
    const { segments, slotNames } = parseTemplate(
      `${key}:${variant}`,
      variantTemplate,
    );
    for (const placeholder of slotNames) {
      if (!declaredSlotSet.has(placeholder)) {
        throw new TemplateRenderError(
          'TEMPLATE_SLOT_MISMATCH',
          key,
          `Placeholder "{${placeholder}}" in variant "${variant}" has no declared slot validator`,
          placeholder,
        );
      }
      allVariantPlaceholders.add(placeholder);
    }
    parsedVariants[variant] = Object.freeze({
      template: variantTemplate,
      segments,
      slotNames: Object.freeze(
        Array.from(slotNames) as (keyof Slots & string)[],
      ),
    });
  }

  for (const declared of declaredSlotSet) {
    if (!allVariantPlaceholders.has(declared)) {
      throw new TemplateRenderError(
        'TEMPLATE_SLOT_MISMATCH',
        key,
        `Declared slot "${declared}" does not appear in any audience variant`,
        declared,
      );
    }
  }

  const reads = Object.freeze(
    (spec.reads
      ? spec.reads.slice()
      : Array.from(declaredSlotSet)) as (keyof Slots & string)[],
  );

  return Object.freeze({
    key,
    variants: Object.freeze({
      room: spec.variants.room,
      buyer: spec.variants.buyer,
      owner: spec.variants.owner,
    }) as Readonly<Variants>,
    slots: Object.freeze({ ...spec.slots }) as Readonly<Slots>,
    reads,
    parsedVariants: Object.freeze(parsedVariants),
  });
}

/**
 * Define a catalog of multi-variant public templates.
 */
export function definePublicTemplates<
  const Spec extends PublicTemplateCatalogSpec,
>(spec: Spec & ValidatedPublicCatalogSpec<Spec>): PublicTemplateCatalog<Spec> {
  const result = Object.create(null) as Record<
    string,
    PublicTemplateDefinition<string, AudienceVariantTemplates, PublicSlotRecord>
  >;
  for (const [key, entry] of Object.entries(spec)) {
    result[key] = definePublicTemplate(
      key,
      entry as unknown as {
        readonly variants: AudienceVariantTemplates;
        readonly slots: PublicSlotRecord &
          ValidatedPublicSlots<AudienceVariantTemplates, PublicSlotRecord>;
        readonly reads?: readonly string[];
      },
    );
  }
  return Object.freeze(result) as PublicTemplateCatalog<Spec>;
}

/**
 * Render a single `PublicTemplateDefinition` for an `AudienceVariant` (`room` default).
 *
 * Strictly reads ONLY the keys used by the requested variant (a subset of `def.reads`)
 * and validates them through the declared slot specs. Any undeclared own key on
 * `fields` is rejected unless `options.allowExtraFields` is set (e.g. when a caller
 * passes a full state object under a read-tracking Proxy).Wait: in canon §7.16 / spike,
 * does `renderPublicText(key, fields)` accept a state object with extra keys while
 * ONLY reading `reads`, or does it reject extra keys?
 * Let's support BOTH:
 * - Only read keys referenced by the variant (`variantParsed.slotNames`, which are all in `def.reads`).
 * - Never call `Object.keys(fields)` on `fields` during `renderPublicText` so a Proxy over a larger DTO (like `PrivateOverlay` + `reads` in the privacy-canary spike!) does NOT trigger proxy traps on unreferenced private keys!
 */
export function renderPublicTemplateFragment<
  Key extends string,
  Variants extends AudienceVariantTemplates,
  Slots extends PublicSlotRecord,
>(
  def: PublicTemplateDefinition<Key, Variants, Slots>,
  fields: TemplateParams<Slots>,
  variant: AudienceVariant = 'room',
): Fragment {
  if (!isAudienceVariant(variant)) {
    throw new TemplateRenderError(
      'UNKNOWN_AUDIENCE_VARIANT',
      def.key,
      `Unknown audience variant ${JSON.stringify(variant)}; expected room | buyer | owner`,
    );
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new TemplateRenderError(
      'INVALID_SLOT_VALUE',
      def.key,
      'fields must be a non-null object',
    );
  }

  const variantParsed = def.parsedVariants[variant];
  const canonical = Object.create(null) as Record<string, string>;

  // Crucial privacy invariant: iterate ONLY over `variantParsed.slotNames`
  // (which is a subset of `def.reads`) and read `fields[slotName]` directly
  // once. Never enumerate `Object.keys(fields)` or touch any key outside `reads`.
  const record = fields as Readonly<Record<string, unknown>>;
  for (const slotName of variantParsed.slotNames) {
    const rawValue = record[slotName];
    if (rawValue === undefined && !(slotName in record)) {
      throw new TemplateRenderError(
        'MISSING_SLOT_VALUE',
        def.key,
        `Missing required slot "${slotName}"`,
        slotName,
      );
    }
    const spec = def.slots[slotName] as unknown as SlotSpec<
      unknown,
      PublicAllowedSlotKind
    >;
    canonical[slotName] = spec.render(rawValue, {
      templateId: `${def.key}:${variant}`,
      slotName,
    });
  }

  let output = '';
  for (const seg of variantParsed.segments) {
    if (seg.type === 'literal') {
      output += seg.text;
    } else {
      output += canonical[seg.name]!;
    }
  }

  return createFragmentInstance(`${def.key}:${variant}`, output, {
    template: variantParsed.template,
    canonical,
  });
}

// ---------------------------------------------------------------------------
// Generic Canon-Aligned Example Public Templates (room | buyer | owner)
// ---------------------------------------------------------------------------

const SEVERITY_ENUM = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const;

const PROPOSAL_STATUS_ENUM = {
  active: 'active',
  executed: 'executed',
  superseded: 'superseded',
  rejected: 'rejected',
  stale: 'stale',
} as const;

const DECISION_OUTCOME_ENUM = {
  approve: 'approve',
  reject: 'reject',
  withdraw: 'withdraw',
} as const;

/**
 * Canon-aligned generic public templates (`room | buyer | owner` variants).
 * Zero free-text slots; no `deferredItemKeys` (canon D11).
 */
export const PUBLIC_TEMPLATES = definePublicTemplates({
  constraints_updated: {
    reads: ['changedItemKeys', 'severity', 'effectiveDate'],
    slots: {
      changedItemKeys: slot.list(slot.token<ItemKey>(ITEM_KEY_RE, 'itemKey'), {
        minItems: 1,
        maxItems: 8,
        lastSeparator: ' and ',
      }),
      severity: slot.enum(SEVERITY_ENUM, 'severity'),
      effectiveDate: slot.date(),
    },
    variants: {
      room: 'Updated constraints for {changedItemKeys} ({severity} priority, effective {effectiveDate}).',
      buyer:
        'Counterparty updated constraints for {changedItemKeys} ({severity} priority, effective {effectiveDate}).',
      owner:
        'Your updated constraints for {changedItemKeys} ({severity} priority, effective {effectiveDate}) were shared.',
    },
  },

  proposal_summary: {
    reads: [
      'roundNumber',
      'status',
      'totalPriceCents',
      'durationDays',
      'includedItemKeys',
    ],
    slots: {
      roundNumber: slot.integer({ min: 1, max: 99 }),
      status: slot.enum(PROPOSAL_STATUS_ENUM, 'proposalStatus'),
      totalPriceCents: slot.amount(),
      durationDays: slot.integer({
        min: 0,
        max: 365,
        unit: { singular: 'day', plural: 'days' },
      }),
      includedItemKeys: slot.list(slot.token<ItemKey>(ITEM_KEY_RE, 'itemKey'), {
        minItems: 1,
        maxItems: 16,
        lastSeparator: ', and ',
      }),
    },
    variants: {
      room: 'Round {roundNumber} proposal ({status}): {totalPriceCents} over {durationDays} covering {includedItemKeys}.',
      buyer:
        'Round {roundNumber} offer to review ({status}): {totalPriceCents} over {durationDays} covering {includedItemKeys}.',
      owner:
        'Round {roundNumber} proposal sent ({status}): {totalPriceCents} over {durationDays} covering {includedItemKeys}.',
    },
  },

  decision_recorded: {
    reads: ['roundNumber', 'outcome', 'approvedTotalCents', 'decidedDate'],
    slots: {
      roundNumber: slot.integer({ min: 1, max: 99 }),
      outcome: slot.enum(DECISION_OUTCOME_ENUM, 'decisionOutcome'),
      approvedTotalCents: slot.amount(),
      decidedDate: slot.date(),
    },
    variants: {
      room: 'Round {roundNumber} decision ({decidedDate}): {outcome} at {approvedTotalCents}.',
      buyer:
        'Round {roundNumber} counterparty decision ({decidedDate}): {outcome} at {approvedTotalCents}.',
      owner:
        'Round {roundNumber} decision recorded ({decidedDate}): {outcome} at {approvedTotalCents}.',
    },
  },
});

export type DefaultPublicTemplateCatalog = typeof PUBLIC_TEMPLATES;
export type PublicTemplateKey = keyof DefaultPublicTemplateCatalog & string;

export interface PublicTextRenderer<
  C extends PublicTemplateCatalog<PublicTemplateCatalogSpec>,
> {
  readonly catalog: C;
  renderPublicText<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
    variant?: AudienceVariant,
  ): string;
  renderFragment<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
    variant?: AudienceVariant,
  ): Fragment;
  renderAllVariants<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
  ): Readonly<Record<AudienceVariant, string>>;
}

/**
 * Create a bound public-text renderer over a `PublicTemplateCatalog`.
 */
export function createPublicTextRenderer<
  const C extends PublicTemplateCatalog<PublicTemplateCatalogSpec>,
>(catalog: C): PublicTextRenderer<C> {
  function lookup<K extends keyof C & string>(
    templateKey: K,
  ): PublicTemplateDefinition<string, AudienceVariantTemplates, PublicSlotRecord> {
    if (
      typeof templateKey !== 'string' ||
      !Object.hasOwn(catalog, templateKey)
    ) {
      throw new TemplateRenderError(
        'UNKNOWN_TEMPLATE',
        String(templateKey),
        `Unknown public template "${String(templateKey)}"`,
      );
    }
    return catalog[templateKey]!;
  }

  function renderFragment<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
    variant: AudienceVariant = 'room',
  ): Fragment {
    const def = lookup(templateKey);
    return renderPublicTemplateFragment(def, fields, variant);
  }

  function renderPublicText<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
    variant: AudienceVariant = 'room',
  ): string {
    return renderFragment(templateKey, fields, variant).text;
  }

  function renderAllVariants<K extends keyof C & string>(
    templateKey: K,
    fields: PublicTemplateFields<C[K]>,
  ): Readonly<Record<AudienceVariant, string>> {
    const def = lookup(templateKey);
    return Object.freeze({
      room: renderPublicTemplateFragment(def, fields, 'room').text,
      buyer: renderPublicTemplateFragment(def, fields, 'buyer').text,
      owner: renderPublicTemplateFragment(def, fields, 'owner').text,
    });
  }

  return Object.freeze({
    catalog,
    renderPublicText,
    renderFragment,
    renderAllVariants,
  });
}

const defaultPublicRenderer = createPublicTextRenderer(PUBLIC_TEMPLATES);

/**
 * Render a public template by key (from `PUBLIC_TEMPLATES`) or directly from a
 * `PublicTemplateDefinition` for the target `AudienceVariant` (`'room'` default).
 */
export function renderPublicText<K extends PublicTemplateKey>(
  templateKey: K,
  fields: PublicTemplateFields<DefaultPublicTemplateCatalog[K]>,
  variant?: AudienceVariant,
): string;
export function renderPublicText<
  Key extends string,
  Variants extends AudienceVariantTemplates,
  Slots extends PublicSlotRecord,
>(
  templateDef: PublicTemplateDefinition<Key, Variants, Slots>,
  fields: TemplateParams<Slots>,
  variant?: AudienceVariant,
): string;
export function renderPublicText(
  keyOrDef:
    | PublicTemplateKey
    | PublicTemplateDefinition<
        string,
        AudienceVariantTemplates,
        PublicSlotRecord
      >,
  fields: Record<string, unknown>,
  variant: AudienceVariant = 'room',
): string {
  if (typeof keyOrDef === 'string') {
    return defaultPublicRenderer.renderPublicText(
      keyOrDef,
      fields as never,
      variant,
    );
  }
  if (
    typeof keyOrDef === 'object' &&
    keyOrDef !== null &&
    'parsedVariants' in keyOrDef
  ) {
    return renderPublicTemplateFragment(
      keyOrDef,
      fields as never,
      variant,
    ).text;
  }
  throw new TemplateRenderError(
    'UNKNOWN_TEMPLATE',
    String(keyOrDef),
    `Expected a public template key or PublicTemplateDefinition`,
  );
}

/**
 * Proxy read-tracking helper (canon §7.16 / privacy canary test harness):
 * wraps `state` in a `Proxy` that records every property access and throws if
 * any property outside `allowedReads` is touched during `fn(proxied)`.
 */
export function trackReads<T extends object, R>(
  state: T,
  allowedReads: readonly string[],
  fn: (proxied: T) => R,
): { readonly result: R; readonly accessedKeys: readonly string[] } {
  const allowed = new Set<string>(allowedReads);
  const accessed: string[] = [];

  const proxy = new Proxy(state, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      accessed.push(prop);
      if (!allowed.has(prop)) {
        throw new TemplateRenderError(
          'UNDECLARED_READ_KEY',
          'trackReads',
          `Template accessed undeclared property "${prop}"`,
          prop,
        );
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string') {
        accessed.push(prop);
        if (!allowed.has(prop)) {
          throw new TemplateRenderError(
            'UNDECLARED_READ_KEY',
            'trackReads',
            `Template checked existence of undeclared property "${prop}"`,
            prop,
          );
        }
      }
      return Reflect.has(target, prop);
    },
    ownKeys() {
      throw new TemplateRenderError(
        'UNDECLARED_READ_KEY',
        'trackReads',
        `Template attempted to enumerate all keys via Object.keys / Reflect.ownKeys`,
      );
    },
  });

  const result = fn(proxy);
  return Object.freeze({
    result,
    accessedKeys: Object.freeze(accessed),
  });
}
