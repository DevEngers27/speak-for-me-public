import { cents, isCents, wrapCatalogTitle, type CatalogDecl, type CatalogRow } from '../../engine';
import { ITEM_KEY_RE } from './fields';
import type { ValidationOutcome } from './protocol';

export const SCOPE_CHANGE_CATALOG: CatalogDecl = Object.freeze({
  ownerRole: 'provider',
  maxItemRows: 12,
  maxModifierRows: 2,
  maxRowCents: 8_000_000_000,
  maxLeadDays: 365,
  titleMaxCodePoints: 80,
  maxTaskTemplatesPerRow: 5,
});

export const CATALOG_TITLE_RE = /^[^<>\r\n]+$/u;

const INVISIBLE_AND_CONTROL_RE =
  /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFE00-\uFE0F\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E01EF}]/gu;

/**
 * Prompt delimiter words checked after NFKC normalization and invisible-character stripping
 * (05 §5.13.2, 06 §4, 12 §12.12 ⑤, 14 §5 / §9.6 A / §11 G1, CN-004 #8):
 * `untrusted_data | room_state | candidates | shared_facts | clarify_answers | principal_brief | principal_notes | turn_instruction | system`
 * (including `<`, `&lt;`, and `\u003c` forms, case-insensitive).
 * Note: `"SYSTEM NOTE:"` in 14 §9.6 B / §11 G2 is plain user prose (not a `<system>` tag or delimiter),
 * so `\bsystem\b(?!\s+note:)` blocks delimiter uses of `system` while preserving G2.
 */
const DELIMITER_WORD_RE =
  /(?:(?:<|&lt;|\\u003c)\s*\/?\s*)?(?:untrusted_data|room_state|candidates|shared_facts|clarify_answers|principal_brief|principal_notes|turn_instruction|\bsystem\b(?!\s+note:))|(?:<|&lt;|\\u003c)\s*\/?\s*system/iu;

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

export interface CatalogTaskTemplateInput {
  readonly title: string;
  readonly assigneeRole?: string;
}

export interface CatalogRowInput {
  readonly itemKey: string;
  readonly kind: 'item' | 'modifier';
  readonly title: string;
  readonly priceCents: number;
  readonly leadDays: number;
  readonly taskTemplates?: readonly CatalogTaskTemplateInput[];
  readonly status?: 'draft' | 'confirmed' | 'retired';
  readonly revision?: number;
  readonly editNo?: number;
  readonly provenance?: 'live' | 'seeded' | 'stub';
}

export interface CatalogRowRecord extends Omit<CatalogRow, 'status'> {
  readonly status: 'draft' | 'confirmed' | 'retired';
  readonly editNo?: number;
}

/**
 * Validate a catalog row or task template `title` against the canon D13, 05 §5.13.2, 06 §4,
 * 12 §12.12 ⑤, and 14 §5 / §9.6 / §11 G1 two-stage gate:
 * 1. Format & length: string, no lone surrogates, NFC, trimmed (`nfc.trim() === nfc`),
 *    `1 <= codePoints <= 80`, matches `/^[^<>\r\n]+$/u` -> failure returns `input.invalid { field }`.
 * 2. Delimiter check: after NFKC normalization and stripping invisible/control/bidi/tag characters,
 *    case-insensitively contains no prompt block delimiter word (`untrusted_data`, `room_state`,
 *    `candidates`, `shared_facts`, `clarify_answers`, `principal_brief`, `principal_notes`,
 *    `turn_instruction`, `system` or `<` / `&lt;` / `\u003c` forms) -> failure returns `disclosure.blocked { field }`.
 */
export function validateCatalogTitle(
  title: unknown,
  field: 'title' | 'taskTemplates.title' = 'title',
): ValidationOutcome {
  if (typeof title !== 'string' || hasLoneSurrogate(title)) {
    return { ok: false, code: 'input.invalid', params: { field } };
  }
  const nfc = title.normalize('NFC');
  if (nfc.trim() !== nfc) {
    return { ok: false, code: 'input.invalid', params: { field } };
  }
  const codePoints = [...nfc].length;
  if (
    codePoints < 1 ||
    codePoints > SCOPE_CHANGE_CATALOG.titleMaxCodePoints ||
    !CATALOG_TITLE_RE.test(nfc) ||
    /[\u2028\u2029]/u.test(nfc) ||
    [...nfc.normalize('NFKC')].length > SCOPE_CHANGE_CATALOG.titleMaxCodePoints
  ) {
    return { ok: false, code: 'input.invalid', params: { field } };
  }
  const nfkcStripped = nfc.normalize('NFKC').replace(INVISIBLE_AND_CONTROL_RE, '');
  if (DELIMITER_WORD_RE.test(nfkcStripped)) {
    return { ok: false, code: 'disclosure.blocked', params: { field } };
  }
  return { ok: true };
}

/**
 * Validate a single catalog row against 14 §5 & 12 §12.12 rules.
 */
export function validateCatalogRow(
  row: CatalogRowInput,
  existingRows: readonly CatalogRowInput[] = [],
  actorRole = 'provider',
): ValidationOutcome {
  if (actorRole !== SCOPE_CHANGE_CATALOG.ownerRole) {
    return { ok: false, code: 'auth.role_forbidden', params: { actorRole } };
  }
  if (!row || typeof row !== 'object') {
    return { ok: false, code: 'input.invalid', params: { field: 'row' } };
  }
  if (typeof row.itemKey !== 'string' || !ITEM_KEY_RE.test(row.itemKey)) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'itemKey', itemKeys: [typeof row.itemKey === 'string' ? row.itemKey : ''] },
    };
  }
  if (row.kind !== 'item' && row.kind !== 'modifier') {
    return { ok: false, code: 'input.invalid', params: { field: 'kind' } };
  }

  const existing = existingRows.find((r) => r.itemKey === row.itemKey);
  if (existing && existing.kind !== row.kind) {
    return {
      ok: false,
      code: 'item.duplicate',
      params: { itemKeys: [row.itemKey], reason: 'kind_immutable' },
    };
  }

  const titleCheck = validateCatalogTitle(row.title, 'title');
  if (!titleCheck.ok) return titleCheck;

  if (
    typeof row.priceCents !== 'number' ||
    !isCents(row.priceCents) ||
    row.priceCents > SCOPE_CHANGE_CATALOG.maxRowCents
  ) {
    return { ok: false, code: 'amount.out_of_range', params: { field: 'priceCents' } };
  }

  const minLead = row.kind === 'modifier' ? 1 : 0;
  if (
    typeof row.leadDays !== 'number' ||
    !Number.isSafeInteger(row.leadDays) ||
    row.leadDays < minLead ||
    row.leadDays > SCOPE_CHANGE_CATALOG.maxLeadDays
  ) {
    return {
      ok: false,
      code: 'date.out_of_range',
      params: { field: 'leadDays', min: minLead, max: SCOPE_CHANGE_CATALOG.maxLeadDays },
    };
  }

  if (row.kind === 'modifier') {
    if (
      row.taskTemplates !== undefined &&
      (!Array.isArray(row.taskTemplates) || row.taskTemplates.length > 0)
    ) {
      return {
        ok: false,
        code: 'input.invalid',
        params: { field: 'taskTemplates', reason: 'modifier_cannot_have_task_templates' },
      };
    }
  } else {
    const templates = row.taskTemplates ?? [];
    if (!Array.isArray(templates) || templates.length > SCOPE_CHANGE_CATALOG.maxTaskTemplatesPerRow) {
      return {
        ok: false,
        code: 'input.invalid',
        params: { field: 'taskTemplates', max: SCOPE_CHANGE_CATALOG.maxTaskTemplatesPerRow },
      };
    }
    for (const t of templates) {
      const tCheck = validateCatalogTitle(t?.title, 'taskTemplates.title');
      if (!tCheck.ok) return tCheck;
      if (
        t !== null &&
        typeof t === 'object' &&
        'assigneeRole' in t &&
        t.assigneeRole !== undefined &&
        t.assigneeRole !== SCOPE_CHANGE_CATALOG.ownerRole
      ) {
        return {
          ok: false,
          code: 'input.invalid',
          params: {
            field: 'taskTemplates',
            assigneeRole: t.assigneeRole,
            ownerRole: SCOPE_CHANGE_CATALOG.ownerRole,
          },
        };
      }
    }
  }

  const nextStatus = row.status ?? existing?.status ?? 'confirmed';
  if (nextStatus !== 'retired') {
    const activeSameKind =
      existingRows.filter(
        (r) => r.kind === row.kind && r.status !== 'retired' && r.itemKey !== row.itemKey,
      ).length + 1;
    const limit =
      row.kind === 'item'
        ? SCOPE_CHANGE_CATALOG.maxItemRows
        : SCOPE_CHANGE_CATALOG.maxModifierRows;
    if (activeSameKind > limit) {
      return {
        ok: false,
        code: 'item.limit_exceeded',
        params: {
          field: row.kind === 'item' ? 'catalog.items' : 'catalog.modifiers',
          limit,
        },
      };
    }
  }

  return { ok: true };
}

/**
 * Validate a batch of catalog rows (atomic batch validation: if any row fails,
 * the entire batch is rejected without partial writes, 12 §12.12, 14 §9.6 / §11 G1).
 */
export function validateCatalogBatch(
  rows: readonly CatalogRowInput[],
  existingRows: readonly CatalogRowInput[] = [],
  actorRole = 'provider',
): ValidationOutcome {
  if (actorRole !== SCOPE_CHANGE_CATALOG.ownerRole) {
    return { ok: false, code: 'auth.role_forbidden', params: { actorRole } };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, code: 'input.invalid', params: { field: 'rows' } };
  }
  const accumulated: CatalogRowInput[] = [...existingRows];
  const seenInBatch = new Set<string>();
  for (const row of rows) {
    if (seenInBatch.has(row.itemKey)) {
      return { ok: false, code: 'item.duplicate', params: { itemKeys: [row.itemKey] } };
    }
    seenInBatch.add(row.itemKey);
    const check = validateCatalogRow(row, accumulated, actorRole);
    if (!check.ok) return check;
    const idx = accumulated.findIndex((r) => r.itemKey === row.itemKey);
    if (idx >= 0) accumulated[idx] = row;
    else accumulated.push(row);
  }
  return { ok: true };
}

function taskTemplatesEqual(
  a: readonly { readonly title: string; readonly assigneeRole: string }[],
  b: readonly { readonly title: string; readonly assigneeRole: string }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.title !== b[i]!.title || a[i]!.assigneeRole !== b[i]!.assigneeRole) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the next catalog row state (`revision`, `editNo`) and whether `constraintsVersion` bumps
 * (03 §3.7, 12 §12.12, 14 §5, INV-R8):
 * - First confirmation of a new or `draft` (`revision 0`) row sets `revision: 1, editNo: 0`
 *   and bumps constraints when the room is open.
 * - Editing only `title` or `taskTemplates` on a confirmed row keeps `revision` unchanged,
 *   increments `editNo`, and does NOT bump constraints.
 * - Changing `priceCents`, `leadDays`, or `status` increments `revision`, resets `editNo: 0`,
 *   and bumps constraints.
 */
export function computeCatalogRowMutation(
  incoming: CatalogRowInput,
  existing: CatalogRowRecord | undefined,
  actorRole = 'provider',
):
  | { readonly ok: true; readonly row: CatalogRowRecord; readonly bumpsConstraints: boolean }
  | Extract<ValidationOutcome, { readonly ok: false }> {
  const valid = validateCatalogRow(incoming, existing ? [existing] : [], actorRole);
  if (!valid.ok) return valid;

  const nextStatus = incoming.status ?? existing?.status ?? 'confirmed';
  const normalizedTitle = incoming.title.normalize('NFC');
  const taskTemplates = (incoming.taskTemplates ?? []).map((t) => ({
    title: t.title.normalize('NFC'),
    assigneeRole: SCOPE_CHANGE_CATALOG.ownerRole,
  }));
  const provenance = incoming.provenance ?? existing?.provenance ?? 'live';

  if (!existing || existing.status === 'draft') {
    const confirmedNow = nextStatus === 'confirmed';
    const nextRevision = confirmedNow ? Math.max(1, existing?.revision ?? 1) : existing?.revision ?? 0;
    return {
      ok: true,
      row: {
        itemKey: incoming.itemKey,
        kind: existing?.kind ?? incoming.kind,
        title: normalizedTitle,
        priceCents: cents(incoming.priceCents),
        leadDays: incoming.leadDays,
        taskTemplates,
        status: nextStatus,
        revision: nextRevision,
        editNo: 0,
        provenance,
      },
      bumpsConstraints: confirmedNow,
    };
  }

  const ruleRelevantChanged =
    existing.priceCents !== incoming.priceCents ||
    existing.leadDays !== incoming.leadDays ||
    existing.status !== nextStatus;

  const textOrTemplatesChanged =
    existing.title !== normalizedTitle ||
    !taskTemplatesEqual(existing.taskTemplates, taskTemplates);

  const nextRevision = ruleRelevantChanged ? existing.revision + 1 : existing.revision;
  const prevEditNo = existing.editNo ?? 0;
  const nextEditNo =
    ruleRelevantChanged ? 0 : textOrTemplatesChanged ? prevEditNo + 1 : prevEditNo;

  return {
    ok: true,
    row: {
      itemKey: existing.itemKey,
      kind: existing.kind,
      title: normalizedTitle,
      priceCents: cents(incoming.priceCents),
      leadDays: incoming.leadDays,
      taskTemplates,
      status: nextStatus,
      revision: nextRevision,
      editNo: nextEditNo,
      provenance,
    },
    bumpsConstraints: ruleRelevantChanged,
  };
}

/**
 * Retire a confirmed catalog row (`catalog.retire`, 12 §12.12, 14 §5 & §11 D).
 */
export function retireCatalogRow(
  itemKey: string,
  existingRows: readonly CatalogRowRecord[],
  actorRole = 'provider',
):
  | { readonly ok: true; readonly rows: CatalogRowRecord[]; readonly retiredRow: CatalogRowRecord; readonly bumpsConstraints: boolean }
  | Extract<ValidationOutcome, { readonly ok: false }> {
  if (actorRole !== SCOPE_CHANGE_CATALOG.ownerRole) {
    return { ok: false, code: 'auth.role_forbidden', params: { actorRole } };
  }
  const existing = existingRows.find((r) => r.itemKey === itemKey);
  if (!existing) {
    return { ok: false, code: 'item.unknown', params: { itemKeys: [itemKey] } };
  }
  const wasConfirmed = existing.status === 'confirmed';
  const retiredRow: CatalogRowRecord = {
    ...existing,
    status: 'retired',
    revision: wasConfirmed ? existing.revision + 1 : existing.revision,
    editNo: 0,
  };
  const rows = existingRows.map((r) => (r.itemKey === itemKey ? retiredRow : r));
  return {
    ok: true,
    rows,
    retiredRow,
    bumpsConstraints: wasConfirmed,
  };
}

/**
 * Delimit a provider catalog title for inclusion in another role's agent context
 * (`<untrusted_data source="provider.catalog_titles" ...>`, 05 §5.13.2, 07 §7.14.3, 14 §9.6 / §11 G2).
 */
export function delimitCatalogTitle(title: string): string {
  const check = validateCatalogTitle(title, 'title');
  if (!check.ok) {
    throw new TypeError('INVALID_CATALOG_TITLE');
  }
  return wrapCatalogTitle(title.normalize('NFC'), 'provider.catalog_titles').block;
}
