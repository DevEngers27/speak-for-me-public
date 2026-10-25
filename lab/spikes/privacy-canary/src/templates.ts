// Public text templates: rendered only from allowlisted, format-checked structured slots.
import type { CatalogItem } from './fixture.ts';
import type { Role } from './types.ts';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** An itemKey that exists in the confirmed catalog. Only `catalogKeys` can mint it. */
export type ItemKey = Brand<string, 'ItemKey'>;
/** An amount that was computed by summing confirmed catalog prices. Only `sumCatalog` can mint it. */
export type PublicCents = Brand<number, 'PublicCents'>;
/** A validated YYYY-MM-DD calendar date. Only `isoDate` can mint it. */
export type IsoDate = Brand<string, 'IsoDate'>;

const ITEM_KEY_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class TemplateInputError extends Error {
  constructor(public readonly code: 'UNKNOWN_ITEM' | 'INVALID_DATE' | 'INVALID_AMOUNT' | 'INVALID_ROLE') { super(code); }
}

export function catalogKeys(catalog: readonly CatalogItem[], keys: readonly string[]): ItemKey[] {
  const confirmed = new Set(catalog.filter((i) => i.status === 'confirmed').map((i) => i.itemKey));
  return keys.map((k) => {
    if (!ITEM_KEY_RE.test(k) || !confirmed.has(k)) throw new TemplateInputError('UNKNOWN_ITEM');
    return k as ItemKey;
  });
}

export function sumCatalog(catalog: readonly CatalogItem[], keys: readonly ItemKey[]): PublicCents {
  const total = keys.reduce((acc, k) => acc + catalog.find((i) => i.itemKey === k)!.priceCents, 0);
  return total as PublicCents;
}

export function isoDate(s: string): IsoDate {
  const m = DATE_RE.exec(s);
  if (!m) throw new TemplateInputError('INVALID_DATE');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new TemplateInputError('INVALID_DATE');
  return s as IsoDate;
}

export function formatCents(c: number): string {
  if (!Number.isSafeInteger(c) || c < 0) throw new TemplateInputError('INVALID_AMOUNT');
  const d = Math.floor(c / 100), r = c % 100;
  return '$' + d.toLocaleString('en-US') + (r ? '.' + String(r).padStart(2, '0') : '');
}

const ROLE_LABEL: Record<Role, string> = { customer: 'Customer', provider: 'Provider', finance: 'Finance' };

// ---------------------------------------------------------------------------
// Proposal summary template
// ---------------------------------------------------------------------------

export interface ProposalSlots {
  actorRole: Role;
  itemKeys: readonly ItemKey[];
  amountCents: PublicCents;
  deliveryDate: IsoDate;
  deferredItemKeys: readonly ItemKey[];
}

/** Placeholders the template may use, each bound to exactly one formatter over ProposalSlots. */
const PROPOSAL_FORMATTERS = {
  actor: (s: ProposalSlots) => ROLE_LABEL[s.actorRole],
  items: (s: ProposalSlots) => s.itemKeys.join(' + '),
  amount: (s: ProposalSlots) => formatCents(s.amountCents),
  date: (s: ProposalSlots) => s.deliveryDate,
  deferredClause: (s: ProposalSlots) => (s.deferredItemKeys.length ? `; ${s.deferredItemKeys.join(' + ')} deferred` : ''),
} as const;

export const PROPOSAL_TEMPLATE = '{actor} proposes {items} for {amount}, delivery {date}{deferredClause}.' as const;

/** Type-level: every {placeholder} in a template string literal. */
export type Placeholders<S extends string> = S extends `${string}{${infer K}}${infer R}` ? K | Placeholders<R> : never;
/** Compile error unless template placeholders are a subset of the formatter keys. */
export type CheckedTemplate<S extends string, F> = [Placeholders<S>] extends [keyof F] ? S : never;

export function defineTemplate<F extends Record<string, unknown>, S extends string>(_formatters: F, tpl: CheckedTemplate<S, F>): S {
  return tpl;
}

const PROPOSAL_TPL = defineTemplate(PROPOSAL_FORMATTERS, PROPOSAL_TEMPLATE);

/**
 * Renders the room-visible proposal summary. Explicitly picks allowlisted fields (never spreads)
 * and re-validates them at runtime, because TS structural typing lets a wider object through.
 */
export function renderProposalSummary(input: ProposalSlots, catalog: readonly CatalogItem[]): string {
  const picked: ProposalSlots = {
    actorRole: input.actorRole,
    itemKeys: catalogKeys(catalog, input.itemKeys),
    amountCents: input.amountCents,
    deliveryDate: isoDate(input.deliveryDate),
    deferredItemKeys: catalogKeys(catalog, input.deferredItemKeys),
  };
  if (!(picked.actorRole in ROLE_LABEL)) throw new TemplateInputError('INVALID_ROLE');
  if (sumCatalog(catalog, picked.itemKeys) !== picked.amountCents) throw new TemplateInputError('INVALID_AMOUNT');
  return PROPOSAL_TPL.replace(/\{(\w+)\}/g, (_, k: keyof typeof PROPOSAL_FORMATTERS) => PROPOSAL_FORMATTERS[k](picked));
}

// ---------------------------------------------------------------------------
// Per-audience event templates (stored as {type,payload}; rendered for the viewer)
// ---------------------------------------------------------------------------

export interface ConstraintsChangedPayload {
  fromCapCents: number; // private to finance (+customer if allowed)
  toCapCents: number;
  committedCents: number;
  constraintsVersion: number;
  blockedProposalVersion: number | null;
  blockedAmountCents: number | null; // public (catalog sum)
}

export interface AudienceTemplate<P> {
  id: string;
  reads: readonly (keyof P)[]; // declared payload fields; enforced by tests with a Proxy
  render: (p: P) => string;
}

export const CONSTRAINTS_CHANGED: Record<'finance' | 'customerWithBudget' | 'others', AudienceTemplate<ConstraintsChangedPayload>> = {
  finance: {
    id: 'constraints_changed.finance',
    reads: ['fromCapCents', 'toCapCents', 'constraintsVersion', 'blockedProposalVersion'],
    render: (p) => `Finance cap changed ${formatCents(p.fromCapCents)} → ${formatCents(p.toCapCents)} (constraints v${p.constraintsVersion})` +
      (p.blockedProposalVersion !== null ? `; proposal v${p.blockedProposalVersion} blocked` : ''),
  },
  customerWithBudget: {
    id: 'constraints_changed.customer',
    reads: ['toCapCents', 'committedCents', 'blockedAmountCents'],
    render: (p) => {
      const after = p.committedCents + (p.blockedAmountCents ?? 0);
      return `+${formatCents(p.blockedAmountCents ?? 0)} change / ${formatCents(after)} committed after approval / ${formatCents(p.toCapCents)} cap / over by ${formatCents(Math.max(0, after - p.toCapCents))}`;
    },
  },
  others: {
    id: 'constraints_changed.others',
    reads: ['constraintsVersion', 'blockedProposalVersion'],
    render: (p) => `Finance constraint changed (v${p.constraintsVersion})` +
      (p.blockedProposalVersion !== null ? `; proposal v${p.blockedProposalVersion} blocked` : ''),
  },
};

export function renderConstraintsChanged(p: ConstraintsChangedPayload, viewer: Role, customerSeesBudget: boolean): string {
  if (viewer === 'finance') return CONSTRAINTS_CHANGED.finance.render(p);
  if (viewer === 'customer' && customerSeesBudget) return CONSTRAINTS_CHANGED.customerWithBudget.render(p);
  return CONSTRAINTS_CHANGED.others.render(p);
}

/** Role-A style leaky template (RA-B08), kept ONLY as a negative control for the scanner. */
export function leakyRoleAConstraintsChanged(p: ConstraintsChangedPayload): string {
  return `Constraints changed: cap ${formatCents(p.fromCapCents)} -> ${formatCents(p.toCapCents)}; proposal v${p.blockedProposalVersion} blocked (total ${formatCents(p.committedCents + (p.blockedAmountCents ?? 0))}).`;
}
