/**
 * Template definition, fragments and rendering.
 *
 * A template is `{ id, slots, text }`. `text` is a string literal whose
 * `{placeholder}`s must be exactly the declared slot names (checked by the
 * type system in defineTemplate and again at runtime). Rendering requires a
 * value for every slot and rejects any other field, both at compile time
 * (`Exact<>`) and at runtime.
 */
import { describeKey, TemplateError } from './errors.ts';
import { plainTextEncoder, UNSAFE_TEXT_CHARS, type Encoder } from './encoders.ts';
import type { Formatters } from './formatters.ts';
import { canonicalize, isMintedSlotSpec, type Canonical, type FragmentSlot, type SlotMap, type SlotValue } from './slots.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Template<Id extends string = string, S extends SlotMap = SlotMap> {
  readonly id: Id;
  readonly slots: S;
  readonly text: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTemplate = Template<string, any>;

/** Every `{name}` placeholder in a string literal type. */
export type Placeholders<T extends string> = T extends `${string}{${infer K}}${infer R}` ? K | Placeholders<R> : never;

/**
 * Resolves to `T` when the placeholders of `T` are exactly the keys of `S`;
 * otherwise to a readable error string, which makes the call fail to compile.
 */
export type CheckText<T extends string, S> = string extends T
  ? 'ERROR: template text must be a string literal'
  : [Exclude<Placeholders<T>, keyof S & string>] extends [never]
    ? [Exclude<keyof S & string, Placeholders<T>>] extends [never]
      ? T
      : `ERROR: slot "${Exclude<keyof S & string, Placeholders<T>>}" is declared but not used in the text`
    : `ERROR: placeholder "{${Exclude<Placeholders<T>, keyof S & string>}}" is not a declared slot`;

/** The exact field set `render` accepts for a template's slots. */
export type SlotValues<S extends SlotMap> = { readonly [K in keyof S]: SlotValue<S[K]> };
/** Values accepted for a given template. */
export type ValuesOf<T extends AnyTemplate> = SlotValues<T['slots']>;

/** Adds `never` for every key of V not in Allowed, so extra fields fail to compile even for non-literal objects. */
export type Exact<V, Allowed> = V & { readonly [K in Exclude<keyof V, keyof Allowed>]: never };

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

type Segment = { readonly literal: string } | { readonly slot: string };

const ID_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SLOT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const parsed = new WeakMap<object, readonly Segment[]>();

function parseText(text: string, id: string): Segment[] {
  const segments: Segment[] = [];
  let literal = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '}') throw new TemplateError('INVALID_TEMPLATE', 'unmatched "}" in text', id);
    if (c !== '{') {
      literal += c;
      i++;
      continue;
    }
    const close = text.indexOf('}', i + 1);
    const name = close === -1 ? '' : text.slice(i + 1, close);
    if (!SLOT_NAME_RE.test(name)) throw new TemplateError('INVALID_TEMPLATE', 'malformed placeholder in text', id);
    if (literal) segments.push({ literal });
    literal = '';
    segments.push({ slot: name });
    i = close + 1;
  }
  if (literal) segments.push({ literal });
  return segments;
}

export interface TemplateDefinition<Id extends string, S extends SlotMap, T extends string> {
  /** Stable identifier, e.g. "negotiation.proposal_summary". Lowercase, dot/underscore/dash separated. */
  readonly id: Id;
  readonly slots: S;
  /** Trusted literal text. Placeholders are `{slotName}`; braces are not allowed otherwise. */
  readonly text: CheckText<T, S>;
}

export function defineTemplate<const Id extends string, const S extends SlotMap, const T extends string>(
  definition: TemplateDefinition<Id, S, T>,
): Template<Id, S> {
  const { id, slots, text } = definition as { id: unknown; slots: unknown; text: unknown };
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new TemplateError('INVALID_TEMPLATE', 'id must match ' + ID_RE.source);
  if (typeof text !== 'string' || text.length === 0) throw new TemplateError('INVALID_TEMPLATE', 'text must be a non-empty string', id);
  if (UNSAFE_TEXT_CHARS.test(text.replaceAll('\n', ''))) {
    throw new TemplateError('INVALID_TEMPLATE', 'text contains control, bidi or zero-width characters', id);
  }
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) {
    throw new TemplateError('INVALID_TEMPLATE', 'slots must be an object', id);
  }
  const frozenSlots: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(slots)) {
    if (typeof key !== 'string' || !SLOT_NAME_RE.test(key)) {
      throw new TemplateError('INVALID_TEMPLATE', 'slot names must be identifiers', id, typeof key === 'string' ? describeKey(key) : undefined);
    }
    const spec = (slots as Record<string, unknown>)[key];
    if (!isMintedSlotSpec(spec)) throw new TemplateError('INVALID_TEMPLATE', 'slot spec must come from a slot.* builder', id, key);
    if (spec.kind === 'fragment' && !spec.of.every((t) => isTemplate(t))) {
      throw new TemplateError('INVALID_TEMPLATE', 'fragment slot lists a non-template', id, key);
    }
    frozenSlots[key] = spec;
  }
  const segments = parseText(text, id);
  const used = new Set(segments.flatMap((s) => ('slot' in s ? [s.slot] : [])));
  for (const name of used) {
    if (!Object.hasOwn(frozenSlots, name)) throw new TemplateError('INVALID_TEMPLATE', 'placeholder is not a declared slot', id, name);
  }
  for (const name of Object.keys(frozenSlots)) {
    if (!used.has(name)) throw new TemplateError('INVALID_TEMPLATE', 'slot is declared but not used in the text', id, name);
  }
  const template = Object.freeze({ id, slots: Object.freeze(frozenSlots), text }) as unknown as Template<Id, S>;
  parsed.set(template, Object.freeze(segments));
  return template;
}

export function isTemplate(value: unknown): value is AnyTemplate {
  return typeof value === 'object' && value !== null && parsed.has(value);
}

// ---------------------------------------------------------------------------
// Validation of a values object
// ---------------------------------------------------------------------------

type CanonicalSlot = Canonical | { readonly kind: 'fragment'; readonly value: Fragment<string> };
type CanonicalMap = ReadonlyMap<string, CanonicalSlot>;

function validateValues(template: unknown, values: unknown): { template: AnyTemplate; canonical: CanonicalMap } {
  if (!isTemplate(template)) throw new TemplateError('NOT_A_TEMPLATE', 'object was not created by defineTemplate');
  const id = template.id;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new TemplateError('INVALID_VALUES', 'values must be a plain object', id);
  }
  const proto: unknown = Object.getPrototypeOf(values);
  if (proto !== Object.prototype && proto !== null) throw new TemplateError('INVALID_VALUES', 'values must be a plain object', id);

  const slots = template.slots as SlotMap;
  const supplied = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== 'string') throw new TemplateError('INVALID_VALUES', 'symbol keys are not allowed', id);
    if (!Object.hasOwn(slots, key)) throw new TemplateError('UNKNOWN_SLOT', 'field is not a declared slot', id, describeKey(key));
    const desc = Object.getOwnPropertyDescriptor(values, key);
    if (desc === undefined || !('value' in desc)) throw new TemplateError('INVALID_VALUES', 'accessor properties are not allowed', id, key);
    supplied.set(key, desc.value);
  }

  const canonical = new Map<string, CanonicalSlot>();
  for (const name of Object.keys(slots)) {
    if (!supplied.has(name)) throw new TemplateError('MISSING_SLOT', 'no value supplied', id, name);
    const spec = slots[name]!;
    const value = supplied.get(name);
    if (spec.kind === 'fragment') {
      canonical.set(name, { kind: 'fragment', value: checkFragment(spec, value, id, name) });
    } else {
      canonical.set(name, canonicalize(spec, value, id, name));
    }
  }
  return { template, canonical };
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/** A validated, not-yet-rendered template application. Unforgeable: only `fragment()` creates one. */
export class Fragment<Id extends string = string> {
  readonly templateId: Id;
  readonly #template: AnyTemplate | null;
  readonly #canonical: CanonicalMap;

  /** @internal use `fragment()` or `emptyFragment`. */
  constructor(token: typeof FRAGMENT_TOKEN, templateId: Id, template: AnyTemplate | null, canonical: CanonicalMap) {
    if (token !== FRAGMENT_TOKEN) throw new TemplateError('INVALID_VALUES', 'use fragment() to build fragments');
    this.templateId = templateId;
    this.#template = template;
    this.#canonical = canonical;
    Object.freeze(this);
  }

  static isFragment(value: unknown): value is Fragment<string> {
    return typeof value === 'object' && value !== null && #template in value;
  }

  /** @internal */
  static parts(f: Fragment<string>): { template: AnyTemplate | null; canonical: CanonicalMap } {
    return { template: f.#template, canonical: f.#canonical };
  }
}
const FRAGMENT_TOKEN: unique symbol = Symbol('fragment-token');

export type EmptyFragment = Fragment<'@empty'>;
/** Renders to "". Accepted only by fragment slots declared with `optional: true`. */
export const emptyFragment: EmptyFragment = new Fragment(FRAGMENT_TOKEN, '@empty', null, new Map());

/** Validates `values` against `template` now and returns a fragment to place in a fragment slot. */
export function fragment<const T extends AnyTemplate, const V extends ValuesOf<T>>(
  template: T,
  values: Exact<V, ValuesOf<T>>,
): Fragment<T['id']> {
  const { canonical } = validateValues(template, values);
  return new Fragment(FRAGMENT_TOKEN, template.id as T['id'], template, canonical);
}

function checkFragment(spec: FragmentSlot, value: unknown, id: string, name: string): Fragment<string> {
  if (!Fragment.isFragment(value)) throw new TemplateError('INVALID_SLOT_VALUE', 'expected a fragment', id, name);
  if (value === emptyFragment) {
    if (!spec.optional) throw new TemplateError('INVALID_SLOT_VALUE', 'slot is not optional', id, name);
    return value;
  }
  const { template } = Fragment.parts(value);
  if (template === null || !spec.of.includes(template)) {
    throw new TemplateError('INVALID_SLOT_VALUE', 'fragment template is not allowed in this slot', id, name);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderContext {
  readonly formatters: Formatters;
  /** Defaults to the plain-text encoder. */
  readonly encoder?: Encoder;
}

export interface Renderer {
  readonly encoder: Encoder;
  render<const T extends AnyTemplate, const V extends ValuesOf<T>>(template: T, values: Exact<V, ValuesOf<T>>): string;
  /** Renders a fragment built with `fragment()`. */
  renderFragment(f: Fragment<string>): string;
}

function callFormatter<A>(fn: (a: A) => string, arg: A, id: string, name: string): string {
  let out: unknown;
  try {
    out = fn(arg);
  } catch {
    throw new TemplateError('FORMATTER_FAILED', 'formatter threw', id, name);
  }
  if (typeof out !== 'string') throw new TemplateError('FORMATTER_FAILED', 'formatter returned a non-string', id, name);
  return out;
}

function renderCanonical(template: AnyTemplate, canonical: CanonicalMap, f: Formatters, encoder: Encoder): string {
  const id = template.id;
  const outputs = new Map<string, string>();
  for (const [name, c] of canonical) {
    let raw: string;
    switch (c.kind) {
      case 'fragment': {
        const parts = Fragment.parts(c.value);
        // Already encoded slot-by-slot with this same encoder; its literal text is trusted.
        outputs.set(name, parts.template === null ? '' : renderCanonical(parts.template, parts.canonical, f, encoder));
        continue;
      }
      case 'string':
        raw = c.value;
        break;
      case 'amount':
        raw = callFormatter(f.amount, c.value, id, name);
        break;
      case 'date':
        raw = callFormatter(f.date, c.value, id, name);
        break;
      case 'integer':
        raw = callFormatter(f.integer, c.value, id, name);
        break;
      case 'list':
        raw = callFormatter(f.list, c.value, id, name);
        break;
    }
    outputs.set(name, encoder.encode(raw));
  }
  let out = '';
  for (const seg of parsed.get(template) ?? []) out += 'literal' in seg ? seg.literal : (outputs.get(seg.slot) ?? '');
  return out;
}

/** Creates a renderer bound to injected formatters and an output encoder. */
export function createRenderer(context: RenderContext): Renderer {
  const formatters = context.formatters;
  for (const k of ['amount', 'date', 'integer', 'list'] as const) {
    if (typeof formatters?.[k] !== 'function') throw new TypeError(`formatters.${k} must be a function`);
  }
  const encoder = context.encoder ?? plainTextEncoder;
  return Object.freeze({
    encoder,
    render(template: AnyTemplate, values: unknown): string {
      const v = validateValues(template, values);
      return renderCanonical(v.template, v.canonical, formatters, encoder);
    },
    renderFragment(f: Fragment<string>): string {
      if (!Fragment.isFragment(f)) throw new TemplateError('INVALID_VALUES', 'expected a fragment');
      const parts = Fragment.parts(f);
      return parts.template === null ? '' : renderCanonical(parts.template, parts.canonical, formatters, encoder);
    },
  }) as Renderer;
}
