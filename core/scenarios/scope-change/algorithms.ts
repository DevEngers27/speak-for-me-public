import { addDays, isoDate, materializeTerms, normalizeCatalogRow, PluginContractError, type AgentAction, type AgentModelOutputRoot, type CandidateDraft, type CatalogRow, type ItemKey, type Materialized, type CatalogRowInput, type IsoDate, type ReasonCode, type StubDecideInput } from '../../engine';

import { SCOPE_CHANGE_CATALOG as catalog } from './catalog';

function codeUnitCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Effective lead days for `scope_change` (S-D2, 14 §6.2):
 * `Math.max(0, max(item.leadDays) - sum(modifier.leadDays))`.
 */
export function effectiveLeadDays(rows: readonly CatalogRow[]): number {
  const items = rows.filter((r) => r.kind === 'item');
  const mods = rows.filter((r) => r.kind === 'modifier');
  const maxItemLead = items.length > 0 ? Math.max(...items.map((r) => r.leadDays)) : 0;
  const modReduction = mods.reduce((sum, r) => sum + r.leadDays, 0);
  return Math.max(0, maxItemLead - modReduction);
}

/**
 * Materializes a candidate draft against confirmed catalog rows and the room's `localDate`
 * for `scope_change` (canon D10, D22, 06 §4, 14 §6.2).
 */
export function materialize(
  draft: CandidateDraft,
  catalogRows: readonly CatalogRowInput[],
  localDate: IsoDate,
): Materialized | null {
  const normalizedCatalog = catalogRows.map((r) => normalizeCatalogRow(r, catalog.ownerRole));
  return materializeTerms(draft, normalizedCatalog, isoDate(localDate), effectiveLeadDays);
}

/**
 * Generates the raw candidate space for a role's view in `scope_change` (14 §6.1, S-D3):
 * - Includes all non-empty subsets of confirmed items that contain `view.requiredItemKeys`.
 * - If any required item is missing from confirmed catalog items, returns `{ drafts: [], emptyReasons: ['item.required_missing'] }` without throwing.
 * - Rush/modifier variants are generated ONLY when `view.deadline === undefined || baseDeliveryDate > view.deadline` (S-D3).
 */
export function candidateSpace(view: {
  readonly localDate: IsoDate;
  readonly catalog: readonly CatalogRowInput[];
  readonly requiredItemKeys?: readonly ItemKey[] | undefined;
  readonly deadline?: IsoDate | undefined;
}): { drafts: CandidateDraft[]; emptyReasons: ReasonCode[] } {
  const normalizedCatalog = view.catalog.map((r) => normalizeCatalogRow(r, catalog.ownerRole));
  const liveItems = normalizedCatalog
    .filter((r) => r.kind === 'item' && r.status === 'confirmed')
    .map((r) => r.itemKey)
    .sort(codeUnitCmp);
  const liveMods = normalizedCatalog
    .filter((r) => r.kind === 'modifier' && r.status === 'confirmed')
    .map((r) => r.itemKey)
    .sort(codeUnitCmp);

  const req = [...new Set(view.requiredItemKeys ?? [])].sort(codeUnitCmp);
  if (req.some((k) => !liveItems.includes(k))) {
    return { drafts: [], emptyReasons: ['item.required_missing'] };
  }

  const optional = liveItems.filter((k) => !req.includes(k));
  const drafts: CandidateDraft[] = [];

  for (let mask = 0; mask < 1 << optional.length; mask++) {
    const itemKeys = [
      ...req,
      ...optional.filter((_, j) => (mask & (1 << j)) !== 0),
    ].sort(codeUnitCmp);
    if (itemKeys.length === 0) continue;

    drafts.push({ itemKeys, modifiers: [] });

    const maxLead = Math.max(
      ...itemKeys.map(
        (k) => normalizedCatalog.find((r) => r.itemKey === k && r.kind === 'item')!.leadDays,
      ),
    );
    const baseDeliveryDate = addDays(isoDate(view.localDate), maxLead);

    // S-D3: generate rush/modifier variants only when deadline is unknown in view or base variant misses deadline.
    if (view.deadline === undefined || baseDeliveryDate > view.deadline) {
      for (const m of liveMods) {
        drafts.push({ itemKeys, modifiers: [m] });
      }
    }
  }

  return { drafts, emptyReasons: [] };
}

function extractWishlist(input: StubDecideInput): ReadonlySet<ItemKey> {
  if (input.role === 'finance') {
    return new Set<ItemKey>();
  }
  const source = input.role === 'customer' ? input.ownSoft : input.sharedSoft;
  const raw = source?.preferredItemKeys;
  if (!Array.isArray(raw)) {
    return new Set<ItemKey>();
  }
  return new Set<ItemKey>(raw.filter((k): k is ItemKey => typeof k === 'string'));
}

function formatRationale(base: string, input: StubDecideInput): string {
  const ownNotes = input.ownSoft?.notes;
  const isCanary =
    input.canary === true ||
    (typeof ownNotes === 'string' && ownNotes.includes('CANARY-'));
  return isCanary ? `${base} CANARY-RAT-${input.role}` : base;
}

/**
 * Pure deterministic stub decision driver for `scope_change` per 14 §6.3 (`stubDecide`).
 * Returns a plain `{ turn }` (`AgentModelOutputRoot`) with no hidden top-level properties (D26, INV-66).
 */
export function stubDecide(input: StubDecideInput): AgentModelOutputRoot {
  const wish = extractWishlist(input);
  const score = (keys: readonly ItemKey[]): number =>
    keys.filter((k) => wish.has(k)).length;

  const best = [...input.snapshot].sort(
    (a, b) =>
      score(b.itemKeys) - score(a.itemKeys) ||
      a.amountCents - b.amountCents ||
      codeUnitCmp(a.optionKey, b.optionKey),
  )[0];

  if (input.turnKind === 'propose') {
    if (best) {
      return {
        turn: {
          action: 'propose',
          optionKey: best.optionKey,
          rationale: formatRationale('stub: most wishlist items, then lowest price', input),
        },
      };
    }
    return {
      turn: {
        action: 'escalate',
        kind: 'infeasible',
        toRole: 'customer',
        rationale: formatRationale('stub: no candidate in my view', input),
      },
    };
  }

  const cur = input.currentProposal;
  if (!cur) {
    throw new PluginContractError('missing_current_proposal');
  }

  if (input.role === 'finance') {
    if (cur.passesInMyView) {
      return {
        turn: {
          action: 'recommend_accept',
          proposalVersion: cur.version,
          rationale: formatRationale('stub: passes my checks', input),
        },
      };
    }
    return {
      turn: {
        action: 'reject',
        proposalVersion: cur.version,
        reasonKey: 'over_budget',
        rationale: formatRationale('stub: fails my checks', input),
      },
    };
  }

  if (cur.passesInMyView && (!best || score(cur.itemKeys) >= score(best.itemKeys))) {
    return {
      turn: {
        action: 'recommend_accept',
        proposalVersion: cur.version,
        rationale: formatRationale('stub: as good as my best option', input),
      },
    };
  }

  const effectiveAllowed: readonly AgentAction[] =
    input.allowedActions ?? []; // A missing run-derived whitelist must not enable counters.

  if (best && effectiveAllowed.includes('counter')) {
    return {
      turn: {
        action: 'counter',
        optionKey: best.optionKey,
        baseProposalVersion: cur.version,
        rationale: formatRationale('stub: prefer my best option', input),
      },
    };
  }

  return {
    turn: {
      action: 'reject',
      proposalVersion: cur.version,
      reasonKey: 'preference_not_met',
      rationale: formatRationale('stub: no better option', input),
    },
  };
}

