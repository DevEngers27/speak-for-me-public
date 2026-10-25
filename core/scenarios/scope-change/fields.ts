import { ITEM_KEY_RE, addDays, isIsoDate, type IsoDate, cents, isCents, type Cents, validateCapChange as engineValidateCapChange, type FieldDecl } from '../../engine';
import { SCOPE_CHANGE_ROLES, SCOPE_CHANGE_TOPICS, type ScopeChangeRole, type ValidationOutcome } from './protocol';

export function codeUnitCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export { ITEM_KEY_RE };
export const MAX_BRIEF_ITEMS = 12;
export const MAX_NOTES_CODE_POINTS = 2000;

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
      } else {
        return true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Field declarations for `scope_change` (14 §4.1).
 *
 * Note: `defineScenario` enforces unique `key` across `fields`. The `notes`
 * field is a private note (`class: 'note'`, `disclosableTo: []`) available on
 * every role's `softFields.notes` (validated in `validateBriefFields` for all
 * three roles via `ROLE_NOTE_OWNERS`).
 */
export const SCOPE_CHANGE_FIELDS: readonly FieldDecl[] = [
  {
    key: 'requiredItemKeys',
    requiresAck: true,
    owner: 'customer',
    class: 'hard',
    valueKind: 'itemKeys',
    disclosableTo: ['provider', 'finance'],
  },
  {
    key: 'deadline',
    requiresAck: true,
    owner: 'customer',
    class: 'hard',
    valueKind: 'isoDate',
    disclosableTo: ['provider', 'finance'],
  },
  {
    key: 'preferredItemKeys',
    owner: 'customer',
    class: 'soft',
    valueKind: 'itemKeys',
    disclosableTo: ['provider', 'finance'],
  },
  {
    key: 'capCents',
    requiresAck: true,
    owner: 'finance',
    class: 'hard',
    valueKind: 'cents',
    disclosableTo: ['customer'],
    semantic: 'budget_cap',
  },
  {
    key: 'committedCents',
    requiresAck: true,
    owner: 'finance',
    class: 'derived',
    valueKind: 'cents',
    disclosableTo: ['customer'],
    semantic: 'ledger_committed',
  },
  {
    key: 'headroomCents',
    requiresAck: true,
    owner: 'finance',
    class: 'derived',
    valueKind: 'cents',
    disclosableTo: ['customer'],
    semantic: 'ledger_headroom',
  },
  {
    key: 'notes',
    owner: 'customer',
    owners: ['customer', 'provider', 'finance'],
    class: 'note',
    valueKind: 'text',
    disclosableTo: [],
  },
] as const;

export const ROLE_NOTE_OWNERS: readonly ScopeChangeRole[] = ['customer', 'provider', 'finance'] as const;

export interface CatalogItemSummary {
  readonly itemKey: string;
  readonly kind: 'item' | 'modifier' | string;
  readonly status: 'draft' | 'confirmed' | 'retired' | string;
}

function validateCatalogItemKeyList(
  keys: readonly unknown[],
  catalog: readonly CatalogItemSummary[],
  options?: { readonly allowRetired?: boolean },
): ValidationOutcome {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  const unconfirmed: string[] = [];
  const retired: string[] = [];

  for (const raw of keys) {
    if (typeof raw !== 'string' || !ITEM_KEY_RE.test(raw)) {
      unknown.push(typeof raw === 'string' ? raw : '');
      continue;
    }
    if (seen.has(raw)) {
      if (!duplicates.includes(raw)) duplicates.push(raw);
      continue;
    }
    seen.add(raw);
    const row = catalog.find((r) => r.itemKey === raw && r.kind === 'item');
    if (!row) {
      unknown.push(raw);
    } else if (row.status === 'draft') {
      unconfirmed.push(raw);
    } else if (row.status === 'retired' && options?.allowRetired === false) {
      retired.push(raw);
    } else if (row.status !== 'confirmed' && row.status !== 'retired') {
      unknown.push(raw);
    }
  }

  if (unknown.length > 0) {
    return { ok: false, code: 'item.unknown', params: { itemKeys: unknown } };
  }
  if (unconfirmed.length > 0) {
    return { ok: false, code: 'item.unconfirmed', params: { itemKeys: unconfirmed } };
  }
  if (retired.length > 0) {
    return { ok: false, code: 'item.retired', params: { itemKeys: retired } };
  }
  if (duplicates.length > 0) {
    return { ok: false, code: 'item.duplicate', params: { itemKeys: duplicates } };
  }
  return { ok: true };
}

/**
 * Validate `customer.hardFields.requiredItemKeys` at write entry (14 §4.1–§4.3; 12 §12.9).
 * Must be a non-empty, deduplicated, lexicographically sorted array of 1..12 confirmed/retired catalog item keys.
 */
export function validateRequiredItemKeys(
  keys: unknown,
  catalog: readonly CatalogItemSummary[],
  options?: { readonly allowRetired?: boolean },
): ValidationOutcome {
  if (!Array.isArray(keys)) {
    return { ok: false, code: 'input.invalid', params: { field: 'requiredItemKeys' } };
  }
  if (keys.length === 0) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'requiredItemKeys', min: 1 },
    };
  }
  if (keys.length > MAX_BRIEF_ITEMS) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'requiredItemKeys', reason: 'item.limit_exceeded', max: MAX_BRIEF_ITEMS },
    };
  }

  const membership = validateCatalogItemKeyList(keys, catalog, options);
  if (!membership.ok) return membership;

  for (let i = 1; i < keys.length; i++) {
    if (codeUnitCmp(keys[i - 1] as string, keys[i] as string) > 0) {
      return {
        ok: false,
        code: 'input.invalid',
        params: { field: 'requiredItemKeys', reason: 'unsorted' },
      };
    }
  }
  return { ok: true };
}

/**
 * Validate `customer.hardFields.deadline` or `extend_deadline.date` at write entry (14 §4.2, §4.3; INV-18).
 */
export function validateDeadline(date: unknown, localDate: IsoDate): ValidationOutcome {
  if (typeof date !== 'string' || !isIsoDate(date) || date.startsWith('0000-')) {
    return { ok: false, code: 'date.invalid', params: { field: 'deadline' } };
  }
  if (date < localDate) {
    return { ok: false, code: 'date.in_past', params: { localDate } };
  }
  const max = addDays(localDate, 365);
  if (date > max) {
    return { ok: false, code: 'date.out_of_range', params: { field: 'deadline', min: localDate, max } };
  }
  return { ok: true };
}

/**
 * Validate `customer.softFields.preferredItemKeys` at write entry (14 §4.2, §4.3).
 */
export function validatePreferredItemKeys(
  keys: unknown,
  requiredItemKeys: readonly string[],
  catalog: readonly CatalogItemSummary[],
  options?: { readonly allowRetired?: boolean },
): ValidationOutcome {
  if (keys === undefined) return { ok: true };
  if (!Array.isArray(keys)) {
    return { ok: false, code: 'input.invalid', params: { field: 'preferredItemKeys' } };
  }
  if (keys.length > MAX_BRIEF_ITEMS) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'preferredItemKeys', reason: 'item.limit_exceeded', max: MAX_BRIEF_ITEMS },
    };
  }
  const baseCheck = validateCatalogItemKeyList(keys, catalog, options);
  if (!baseCheck.ok) return baseCheck;

  const overlap = (keys as string[]).filter((k) => requiredItemKeys.includes(k));
  if (overlap.length > 0) {
    return { ok: false, code: 'item.duplicate', params: { itemKeys: overlap } };
  }
  return { ok: true };
}

/**
 * Validate `softFields.notes` for any role (14 §4.1, 12 §12.9).
 * Normalizes with NFC before checking <= 2,000 code points.
 */
export function validateNotes(notes: unknown): ValidationOutcome {
  if (notes === undefined) return { ok: true };
  if (typeof notes !== 'string' || hasLoneSurrogate(notes)) {
    return { ok: false, code: 'input.invalid', params: { field: 'notes' } };
  }
  const nfc = notes.normalize('NFC');
  if ([...nfc].length > MAX_NOTES_CODE_POINTS) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'notes', max: MAX_NOTES_CODE_POINTS },
    };
  }
  return { ok: true };
}

/**
 * Validate `finance.hardFields.capCents` / `budget.setCap` (14 §4.3, §4.4, §11 C).
 */
export function validateCapCents(capCents: unknown, committedCents: Cents): ValidationOutcome {
  if (typeof capCents !== 'number' || !isCents(capCents)) {
    return { ok: false, code: 'amount.out_of_range', params: { field: 'capCents' } };
  }
  return engineValidateCapChange(cents(capCents), committedCents);
}

/**
 * Validate field-level disclosure map for a role at `briefs.confirm` (14 §4.1, §4.3, 12 §12.9).
 */
export function validateFieldDisclosures(
  role: string,
  disclosures: Readonly<Record<string, readonly string[]>> | undefined,
): ValidationOutcome {
  if (!disclosures) return { ok: true };
  const validRoles = new Set(SCOPE_CHANGE_ROLES.map((r) => r.role));
  if (!validRoles.has(role)) {
    return { ok: false, code: 'auth.role_forbidden', params: { role } };
  }

  for (const [fieldKey, targets] of Object.entries(disclosures)) {
    if (!Array.isArray(targets)) {
      return { ok: false, code: 'input.invalid', params: { field: 'disclosures', path: `disclosures.${fieldKey}` } };
    }
    if (fieldKey === 'notes') {
      if (targets.length > 0) {
        return { ok: false, code: 'input.invalid', params: { field: 'disclosures' } };
      }
      continue;
    }
    const decl = SCOPE_CHANGE_FIELDS.find((f) => f.key === fieldKey);
    if (!decl || decl.owner !== role) {
      return { ok: false, code: 'input.invalid', params: { field: 'disclosures' } };
    }
    for (const targetRole of targets) {
      if (typeof targetRole !== 'string' || !decl.disclosableTo.includes(targetRole)) {
        return { ok: false, code: 'input.invalid', params: { field: 'disclosures', toRole: targetRole } };
      }
    }
  }
  return { ok: true };
}

/**
 * Validate a role's brief (`hardFields`, `softFields`, `disclosures`) at `briefs.confirm` (14 §4.2, §4.3, 12 §12.9).
 */
export function validateBriefFields(
  role: string,
  brief: {
    readonly hardFields?: Readonly<Record<string, unknown>>;
    readonly softFields?: Readonly<Record<string, unknown>>;
    readonly disclosures?: Readonly<Record<string, readonly string[]>>;
  },
  ctx: {
    readonly localDate: IsoDate;
    readonly committedCents: Cents;
    readonly catalog: readonly CatalogItemSummary[];
    readonly allowRetiredItems?: boolean;
  },
): ValidationOutcome {
  const validRoles = new Set(SCOPE_CHANGE_ROLES.map((r) => r.role));
  if (!validRoles.has(role)) {
    return { ok: false, code: 'auth.role_forbidden', params: { role } };
  }

  const hard = brief.hardFields ?? {};
  const soft = brief.softFields ?? {};

  // Derived fields (`committedCents`, `headroomCents`) can never be written via briefs
  for (const derived of ['committedCents', 'headroomCents']) {
    if (derived in hard || derived in soft) {
      return {
        ok: false,
        code: 'input.invalid',
        params: { field: 'hardFields', path: `fields.${derived}`, reason: 'derived_field_not_writable' },
      };
    }
  }

  const discRes = validateFieldDisclosures(role, brief.disclosures);
  if (!discRes.ok) return discRes;

  const notesRes = validateNotes(soft.notes);
  if (!notesRes.ok) return notesRes;

  if (role === 'provider') {
    if (Object.keys(hard).length > 0) {
      return {
        ok: false,
        code: 'input.invalid',
        params: { field: 'hardFields', reason: 'provider_has_no_hard_fields' },
      };
    }
    for (const k of Object.keys(soft)) {
      if (k !== 'notes') {
        return { ok: false, code: 'input.invalid', params: { field: 'softFields', path: `softFields.${k}` } };
      }
    }
    return { ok: true };
  }

  if (role === 'customer') {
    for (const k of Object.keys(hard)) {
      if (k !== 'requiredItemKeys' && k !== 'deadline') {
        return { ok: false, code: 'input.invalid', params: { field: 'hardFields', path: `hardFields.${k}` } };
      }
    }
    for (const k of Object.keys(soft)) {
      if (k !== 'preferredItemKeys' && k !== 'notes') {
        return { ok: false, code: 'input.invalid', params: { field: 'softFields', path: `softFields.${k}` } };
      }
    }
    const reqRes = validateRequiredItemKeys(hard.requiredItemKeys, ctx.catalog, {
      allowRetired: ctx.allowRetiredItems,
    });
    if (!reqRes.ok) return reqRes;

    const dlRes = validateDeadline(hard.deadline, ctx.localDate);
    if (!dlRes.ok) return dlRes;

    const prefRes = validatePreferredItemKeys(
      soft.preferredItemKeys,
      hard.requiredItemKeys as readonly string[],
      ctx.catalog,
      { allowRetired: ctx.allowRetiredItems },
    );
    if (!prefRes.ok) return prefRes;

    return { ok: true };
  }

  if (role === 'finance') {
    for (const k of Object.keys(hard)) {
      if (k !== 'capCents') {
        return { ok: false, code: 'input.invalid', params: { field: 'hardFields', path: `hardFields.${k}` } };
      }
    }
    for (const k of Object.keys(soft)) {
      if (k !== 'notes') {
        return { ok: false, code: 'input.invalid', params: { field: 'softFields', path: `softFields.${k}` } };
      }
    }
    return validateCapCents(hard.capCents, ctx.committedCents);
  }

  return { ok: false, code: 'auth.role_forbidden', params: { role } };
}

export interface DiscloseValidationInput {
  readonly fromRole: string;
  readonly field?: string;
  readonly topicKey?: string;
  readonly toRole?: string;
  readonly audience?: readonly string[];
  readonly confirmOwnDisclosure?: boolean;
  readonly [extraKey: string]: unknown;
}

/**
 * Validate a `sharedFacts.add` or clarify `disclose` write (05 §5.9, 07 LP-3, 12 §12.11, 14 §3.3 / §4):
 * - No caller-supplied `value` parameter is accepted (values are copied from the owner's confirmed brief/ledger).
 * - `field` (or `topicKey.field` where `budget_room -> 'headroomCents'`) must be owned by `fromRole` and not `'note'`.
 * - Every target role in `audience` / `[toRole]` must be in `decl.disclosableTo` and `!== fromRole`.
 * - Zero fit oracle (`{ fits: boolean }` does not exist).
 */
export function validateDisclose(args: DiscloseValidationInput): ValidationOutcome {
  if ('value' in args && args.value !== undefined) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'value', reason: 'caller_supplied_value_forbidden' },
    };
  }

  const validRoles = new Set(SCOPE_CHANGE_ROLES.map((r) => r.role));
  if (!validRoles.has(args.fromRole)) {
    return { ok: false, code: 'auth.role_forbidden', params: { role: args.fromRole } };
  }

  let resolvedField = args.field;
  if (resolvedField === undefined && args.topicKey !== undefined) {
    const topic = SCOPE_CHANGE_TOPICS.find((t) => t.topicKey === args.topicKey);
    if (!topic) {
      return { ok: false, code: 'input.invalid', params: { field: 'topicKey', value: args.topicKey } };
    }
    if (topic.toRole !== args.fromRole) {
      return {
        ok: false,
        code: 'disclosure.blocked',
        params: { field: topic.field, fromRole: args.fromRole },
      };
    }
    resolvedField = topic.field;
  }

  if (typeof resolvedField !== 'string' || resolvedField.length === 0) {
    return { ok: false, code: 'input.invalid', params: { field: 'field' } };
  }

  const decl = SCOPE_CHANGE_FIELDS.find((f) => f.key === resolvedField);
  if (!decl || decl.owner !== args.fromRole || decl.class === 'note' || decl.disclosableTo.length === 0) {
    return {
      ok: false,
      code: 'disclosure.blocked',
      params: { field: resolvedField, fromRole: args.fromRole },
    };
  }

  const targets =
    args.audience !== undefined
      ? args.audience
      : args.toRole !== undefined
        ? [args.toRole]
        : null;

  if (targets === null || !Array.isArray(targets)) {
    return { ok: false, code: 'input.invalid', params: { field: 'audience' } };
  }

  for (const target of targets) {
    if (
      typeof target !== 'string' ||
      target === args.fromRole ||
      !(decl.disclosableTo as readonly string[]).includes(target)
    ) {
      return {
        ok: false,
        code: 'disclosure.blocked',
        params: { field: resolvedField, fromRole: args.fromRole, toRole: target },
      };
    }
  }

  if (decl.requiresAck && args.confirmOwnDisclosure !== true) {
    return {
      ok: false,
      code: 'disclosure.needs_own_confirmation',
      params: { field: resolvedField },
    };
  }

  return { ok: true };
}

/** Alias for `validateDisclose` (07 LP-3, 12 §12.11). */
export const validateSharedFact = validateDisclose;
