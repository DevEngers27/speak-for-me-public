import { publicText, wrapCatalogTitle, type IsoDate } from '../../engine';
import { SCOPE_CHANGE_HUMAN_REASON_KEYS } from './protocol';
import { validateCatalogTitle } from './catalog';

const {
  createPublicTextRenderer,
  createRenderer,
  definePublicTemplates,
  defineTemplate,
  isFragment,
  isoDate,
  publicCents,
  slot,
  TemplateRenderError,
  trackReads,
} = publicText;
type AudienceVariant = publicText.AudienceVariant;
type Fragment = publicText.Fragment;
type PublicCents = publicText.PublicCents;
type SlotSpec<TInput, K extends publicText.SlotKind = publicText.SlotKind> = publicText.SlotSpec<
  TInput,
  K
>;

/**
 * Validated catalog-title slot (`kind: 'token'`).
 * Enforces the single canon D13 & 14 §4 / §5.1 / §9.6 catalog-title contract via `validateCatalogTitle`
 * (1..80 Unicode code points, trimmed, no `<`, `>`, CR/LF, no lone surrogates) and sanitizes/escapes
 * via `wrapCatalogTitle` (`wrapUntrusted`).
 */
export function catalogTitleSlot(description = 'catalogTitle'): SlotSpec<string | Fragment, 'token'> {
  return {
    kind: 'token',
    description,
    render(value, ctx) {
      if (isFragment(value) && value.templateId === 'catalog_title') {
        return value.text;
      }
      const check = validateCatalogTitle(value, 'title');
      if (!check.ok || typeof value !== 'string') {
        throw new TemplateRenderError(
          'INVALID_SLOT_VALUE',
          ctx.templateId,
          `Invalid catalog title ${JSON.stringify(value)}`,
          ctx.slotName,
        );
      }
      // Public text consumes a title fragment, not the JSON string envelope used in prompts.
      // Keep encodeBlock's escaping and remove only its enclosing string quotes.
      return wrapCatalogTitle(value.normalize('NFC'), 'provider.catalog_titles').escaped.slice(1, -1);
    },
  };
}

const fragmentSubTemplates = {
  catalog_title: defineTemplate('catalog_title', '{title}', {
    title: catalogTitleSlot('catalogTitle'),
  }),
  task_due_entry: defineTemplate('task_due_entry', '{title} — due {dueDate}', {
    title: catalogTitleSlot('taskTitle'),
    dueDate: slot.date(),
  }),
  infeasible_finance_question: defineTemplate(
    'infeasible_finance_question',
    'No option fits a {capCents} cap. The cheapest option ({itemTitles}, {cheapestAmountCents}) needs a cap of {neededCapCents}.',
    {
      capCents: slot.amount(),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      cheapestAmountCents: slot.amount(),
      neededCapCents: slot.amount(),
    },
  ),
  drop_items_question: defineTemplate(
    'drop_items_question',
    'Make {droppedTitles} optional. Enables, for example, {enabledTitles} for {amountCents}, delivery {deliveryDate}.',
    {
      droppedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
      enabledTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
    },
  ),
} as const;

export const scopeChangeFragmentRenderer = createRenderer(fragmentSubTemplates);

export function renderCatalogTitleFragment(title: string): Fragment {
  return scopeChangeFragmentRenderer.renderFragment('catalog_title', { title });
}

export function renderTaskDueFragment(title: string, dueDate: IsoDate | string): Fragment {
  return scopeChangeFragmentRenderer.renderFragment('task_due_entry', {
    title,
    dueDate: isoDate(String(dueDate)),
  });
}

const ROLE_LABEL_ENUM = {
  customer: 'Customer',
  provider: 'Provider',
  finance: 'Finance',
} as const;

const ROLE_LOWER_ENUM = {
  customer: 'customer',
  provider: 'provider',
  finance: 'finance',
} as const;

const WAITING_DOMAIN_ENUM = {
  budget: 'the budget',
  scope: 'the scope',
  terms: 'the terms',
} as const;

const DISCLOSE_FIELD_LABEL_ENUM = {
  requiredItemKeys: 'required items',
  deadline: 'deadline',
  preferredItemKeys: 'wishlist',
  capCents: 'budget cap',
  committedCents: 'committed spend',
  headroomCents: 'budget headroom',
} as const;

const DISCLOSE_TARGET_REASON_ENUM = {
  finance: 'the budget owner can see the conflict',
  provider: 'the provider can adjust the package',
  customer: 'the customer can evaluate the budget',
} as const;

const REJECT_REASON_LABEL_ENUM = {
  cannot_deliver: 'cannot deliver',
  missing_required_item: 'missing required item',
  after_deadline: 'after deadline',
  preference_not_met: 'preference not met',
  over_budget: 'over budget',
  price_too_high: 'price too high',
  terms_not_acceptable: 'terms not acceptable',
  scope_insufficient: 'scope insufficient',
  needs_earlier_delivery: 'needs earlier delivery',
  other: 'other',
  over_our_limit: 'over our limit',
} as const;

const humanReasonEnum = (audience: 'room' | 'buyers') => Object.fromEntries(
  SCOPE_CHANGE_HUMAN_REASON_KEYS.filter(r => r.audience === audience).map(r => [r.key, REJECT_REASON_LABEL_ENUM[r.key]]),
);

const FIT_STATUS_ENUM = {
  ok: 'Fit: ok',
  blocked: 'Blocked under the current constraints.',
} as const;

const DIFF_VERB_ENUM = {
  removed: 'removed',
  added: 'added',
} as const;

/**
 * Public text templates for `scope_change` (14 §8.1–§8.6).
 * Every template is registered via `definePublicTemplates` with zero free-text (`slot.text`) slots.
 */
export const SCOPE_CHANGE_TEMPLATES = definePublicTemplates({
  // §8.2 Proposal created (base, without modifiers)
  'proposal.created': {
    reads: [
      'actorRole',
      'itemTitles',
      'amountCents',
      'deliveryDate',
      'committedCents',
      'committedAfterCents',
      'capCents',
      'headroomAfterCents',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      committedCents: slot.amount(),
      committedAfterCents: slot.amount(),
      capCents: slot.amount(),
      headroomAfterCents: slot.amount(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer:
        '+{amountCents} change · committed {committedCents} → {committedAfterCents} · cap {capCents} · headroom after {headroomAfterCents}.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal created (without modifiers, customer cap-only buyer variant)
  'proposal.created.cap_only': {
    reads: [
      'actorRole',
      'itemTitles',
      'amountCents',
      'deliveryDate',
      'capCents',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      capCents: slot.amount(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer: '+{amountCents} change · finance cap {capCents}.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal created (without modifiers, budget undisclosed to buyer)
  'proposal.created.no_budget': {
    reads: [
      'actorRole',
      'itemTitles',
      'amountCents',
      'deliveryDate',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer: '+{amountCents} change.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal created (with modifier, e.g. Rush delivery, and customer cap-only buyer variant)
  'proposal.created.with_modifier': {
    reads: [
      'actorRole',
      'itemTitles',
      'modifierTitles',
      'amountCents',
      'deliveryDate',
      'capCents',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      modifierTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 2,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      capCents: slot.amount(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} with {modifierTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer: '+{amountCents} change · finance cap {capCents}.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal created (with modifier, budget undisclosed to buyer)
  'proposal.created.with_modifier.no_budget': {
    reads: [
      'actorRole',
      'itemTitles',
      'modifierTitles',
      'amountCents',
      'deliveryDate',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      modifierTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 2,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} with {modifierTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer: '+{amountCents} change.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal created (with modifier, finance full budget chain buyer variant)
  'proposal.created.with_modifier.full_budget': {
    reads: [
      'actorRole',
      'itemTitles',
      'modifierTitles',
      'amountCents',
      'deliveryDate',
      'committedCents',
      'committedAfterCents',
      'capCents',
      'headroomAfterCents',
      'missingPreferredTitles',
    ],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      modifierTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 2,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
      committedCents: slot.amount(),
      committedAfterCents: slot.amount(),
      capCents: slot.amount(),
      headroomAfterCents: slot.amount(),
      missingPreferredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{actorRole} agent proposes {itemTitles} with {modifierTitles} for {amountCents}, delivery {deliveryDate}.',
      buyer:
        '+{amountCents} change · committed {committedCents} → {committedAfterCents} · cap {capCents} · headroom after {headroomAfterCents}.',
      owner: 'Not included from your wishlist: {missingPreferredTitles}.',
    },
  },

  // §8.2 Proposal fit (provider view)
  'proposal.fit': {
    reads: ['fit'],
    slots: {
      fit: slot.enum(FIT_STATUS_ENUM, 'fit'),
    },
    variants: {
      room: '{fit}',
      buyer: '{fit}',
      owner: '{fit}',
    },
  },

  // §8.2 Proposal diff
  'proposal.diff': {
    reads: [
      'fromVersion',
      'changeVerb',
      'changedTitles',
      'fromAmountCents',
      'toAmountCents',
      'fromDeliveryDate',
      'toDeliveryDate',
    ],
    slots: {
      fromVersion: slot.integer({ min: 1, max: 999 }),
      changeVerb: slot.enum(DIFF_VERB_ENUM, 'changeVerb'),
      changedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
      fromAmountCents: slot.amount(),
      toAmountCents: slot.amount(),
      fromDeliveryDate: slot.date(),
      toDeliveryDate: slot.date(),
    },
    variants: {
      room: 'Changes from v{fromVersion}: {changeVerb} {changedTitles}; {fromAmountCents} → {toAmountCents}; delivery {fromDeliveryDate} → {toDeliveryDate}.',
      buyer:
        'Changes from v{fromVersion}: {changeVerb} {changedTitles}; {fromAmountCents} → {toAmountCents}; delivery {fromDeliveryDate} → {toDeliveryDate}.',
      owner:
        'Changes from v{fromVersion}: {changeVerb} {changedTitles}; {fromAmountCents} → {toAmountCents}; delivery {fromDeliveryDate} → {toDeliveryDate}.',
    },
  },

  // §8.3 Constraints changed: finance cap change (with stale approvals & re-check notice)
  'constraints_changed.finance_cap': {
    reads: ['fromCapCents', 'toCapCents', 'toVersion', 'staleApprovalsCount'],
    slots: {
      fromCapCents: slot.amount(),
      toCapCents: slot.amount(),
      toVersion: slot.integer({ min: 1, max: 999 }),
      staleApprovalsCount: slot.integer({
        min: 1,
        max: 99,
        unit: { singular: 'approval', plural: 'approvals' },
      }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Finance updated the budget cap to {toCapCents} (constraints v{toVersion}). Proposals are being re-checked.',
      owner:
        'You changed the budget cap from {fromCapCents} to {toCapCents} (constraints v{toVersion}). {staleApprovalsCount} no longer apply.',
    },
  },

  // §8.3 Constraints changed: finance cap change (short / no stale approvals, e.g. A1/A2)
  'constraints_changed.finance_cap.short': {
    reads: ['fromCapCents', 'toCapCents', 'toVersion'],
    slots: {
      fromCapCents: slot.amount(),
      toCapCents: slot.amount(),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Finance updated the budget cap to {toCapCents} (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'You changed the budget cap from {fromCapCents} to {toCapCents} (constraints v{toVersion}).',
    },
  },

  // §8.3 Constraints changed: finance cap change when capCents is undisclosed to customer
  'constraints_changed.finance_cap.undisclosed': {
    reads: ['fromCapCents', 'toCapCents', 'toVersion', 'staleApprovalsCount'],
    slots: {
      fromCapCents: slot.amount(),
      toCapCents: slot.amount(),
      toVersion: slot.integer({ min: 1, max: 999 }),
      staleApprovalsCount: slot.integer({
        min: 1,
        max: 99,
        unit: { singular: 'approval', plural: 'approvals' },
      }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer: 'Finance updated the budget (constraints v{toVersion}). Proposals are being re-checked.',
      owner:
        'You changed the budget cap from {fromCapCents} to {toCapCents} (constraints v{toVersion}). {staleApprovalsCount} no longer apply.',
    },
  },

  // §8.3 Constraints changed: customer deadline change (disclosed to finance)
  'constraints_changed.customer_deadline': {
    reads: ['fromDeadline', 'toDeadline', 'toVersion'],
    slots: {
      fromDeadline: slot.date(),
      toDeadline: slot.date(),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Customer moved the deadline to {toDeadline} (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'You moved your deadline from {fromDeadline} to {toDeadline} (constraints v{toVersion}).',
    },
  },

  // §8.3 Constraints changed: customer deadline change (undisclosed to finance)
  'constraints_changed.customer_deadline.undisclosed': {
    reads: ['fromDeadline', 'toDeadline', 'toVersion'],
    slots: {
      fromDeadline: slot.date(),
      toDeadline: slot.date(),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Customer updated a private constraint (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'You moved your deadline from {fromDeadline} to {toDeadline} (constraints v{toVersion}).',
    },
  },

  // §8.3 Constraints changed: customer required items change (disclosed to finance)
  'constraints_changed.customer_items': {
    reads: ['droppedTitles', 'toVersion'],
    slots: {
      droppedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Customer updated the required items (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'You made {droppedTitles} optional (constraints v{toVersion}).',
    },
  },

  // §8.3 Constraints changed: customer required items change (undisclosed to finance)
  'constraints_changed.customer_items.undisclosed': {
    reads: ['droppedTitles', 'toVersion'],
    slots: {
      droppedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer:
        'Customer updated a private constraint (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'You made {droppedTitles} optional (constraints v{toVersion}).',
    },
  },

  // §8.3 Constraints changed: provider changed catalog (`constraints_changed.catalog_changed`)
  'constraints_changed.catalog_changed': {
    reads: ['toVersion'],
    slots: {
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer: 'Provider changed the catalog (constraints v{toVersion}). Proposals are being re-checked.',
      owner: 'Provider changed the catalog (constraints v{toVersion}). Proposals are being re-checked.',
    },
  },

  // §8.3 Constraints changed: clock passed delivery date
  'constraints_changed.clock': {
    reads: ['deliveryDate', 'proposalVersion', 'toVersion'],
    slots: {
      deliveryDate: slot.date(),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
      toVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Constraints changed (v{toVersion}). Proposals are being re-checked.',
      buyer: 'Delivery date {deliveryDate} of v{proposalVersion} has passed (constraints v{toVersion}).',
      owner: 'Delivery date {deliveryDate} of v{proposalVersion} has passed (constraints v{toVersion}).',
    },
  },

  // §8.3 Catalog event: provider retired catalog item (`catalog.item_retired`)
  'catalog.item_retired': {
    reads: ['itemTitle'],
    slots: {
      itemTitle: catalogTitleSlot(),
    },
    variants: {
      room: 'Provider retired {itemTitle} from the catalog.',
      buyer: 'Provider retired {itemTitle} from the catalog.',
      owner: 'Provider retired {itemTitle} from the catalog.',
    },
  },

  // §8.3 Catalog event: provider changed catalog price (`catalog.price_changed`)
  'catalog.price_changed': {
    reads: ['itemTitle', 'fromPriceCents', 'toPriceCents'],
    slots: {
      itemTitle: catalogTitleSlot(),
      fromPriceCents: slot.amount(),
      toPriceCents: slot.amount(),
    },
    variants: {
      room: 'Provider changed the price of {itemTitle} from {fromPriceCents} to {toPriceCents}.',
      buyer: 'Provider changed the price of {itemTitle} from {fromPriceCents} to {toPriceCents}.',
      owner: 'Provider changed the price of {itemTitle} from {fromPriceCents} to {toPriceCents}.',
    },
  },

  // §8.3 Catalog event: provider confirmed catalog (`catalog.item_confirmed`)
  'catalog.item_confirmed': {
    reads: ['itemCount', 'modifierCount'],
    slots: {
      itemCount: slot.integer({
        min: 1,
        max: 12,
        unit: { singular: 'item', plural: 'items' },
      }),
      modifierCount: slot.integer({
        min: 0,
        max: 2,
        unit: { singular: 'option', plural: 'options' },
      }),
    },
    variants: {
      room: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
      buyer: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
      owner: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
    },
  },

  // §8.4 Check result: budget.over
  'check.budget.over': {
    reads: ['overByCents', 'committedAfterCents', 'capCents'],
    slots: {
      overByCents: slot.amount(),
      committedAfterCents: slot.amount(),
      capCents: slot.amount(),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: 'Over the available budget by {overByCents}.',
      owner: 'Over budget by {overByCents} ({committedAfterCents} > {capCents}).',
    },
  },

  // §8.4 Check result: private.constraint_unmet
  'check.private.constraint_unmet': {
    reads: ['viewerRole'],
    slots: {
      viewerRole: slot.enum(ROLE_LOWER_ENUM, 'viewerRole'),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: 'A constraint private to another participant is not met.',
      owner: 'A constraint private to another participant is not met for {viewerRole}.',
    },
  },

  // §8.4 Check result: date.after_deadline
  'check.date.after_deadline': {
    reads: ['deliveryDate', 'daysLate', 'deadline'],
    slots: {
      deliveryDate: slot.date(),
      daysLate: slot.integer({
        min: 1,
        max: 3650,
        unit: { singular: 'day', plural: 'days' },
      }),
      deadline: slot.date(),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: "Delivery is {daysLate} after the customer's deadline ({deadline}).",
      owner: 'Delivery {deliveryDate} is {daysLate} after your deadline {deadline}.',
    },
  },

  // §8.4 Check result: item.required_missing (not_included)
  'check.item.required_missing': {
    reads: ['missingTitles'],
    slots: {
      missingTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: 'Missing a required item: {missingTitles}.',
      owner: 'Missing a required item: {missingTitles}.',
    },
  },

  // §8.4 Check result: item.required_missing (not_offered)
  'check.item.required_not_offered': {
    reads: ['missingTitles'],
    slots: {
      missingTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: "{missingTitles} is no longer in the provider's confirmed catalog.",
      owner: "{missingTitles} is no longer in the provider's confirmed catalog.",
    },
  },

  // §8.4 Check result: version.stale_constraints
  'check.version.stale_constraints': {
    reads: ['checkedAgainst'],
    slots: {
      checkedAgainst: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'Blocked under the current constraints.',
      buyer: 'This version no longer applies (constraints v{checkedAgainst}).',
      owner: 'This version no longer applies (constraints v{checkedAgainst}).',
    },
  },

  // §8.4 Check result: item.retired
  'check.item.retired': {
    reads: ['retiredTitles'],
    slots: {
      retiredTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: '{retiredTitles} was retired from the catalog.',
      buyer: '{retiredTitles} was retired from the catalog.',
      owner: '{retiredTitles} was retired from the catalog.',
    },
  },

  // §8.4 Check result: version.stale_source
  'check.version.stale_source': {
    reads: ['changedTitles'],
    slots: {
      changedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
    },
    variants: {
      room: 'The catalog changed since this version: {changedTitles}.',
      buyer: 'The catalog changed since this version: {changedTitles}.',
      owner: 'The catalog changed since this version: {changedTitles}.',
    },
  },

  // §8.5 Run waiting (`run.waiting`)
  'run.waiting': {
    reads: ['toRole', 'domain', 'question'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
      domain: slot.enum(WAITING_DOMAIN_ENUM, 'domain'),
      question: slot.fragment(['infeasible_finance_question', 'drop_items_question']),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole} to decide on {domain}.',
      owner: 'Your decision is needed: {question}',
    },
  },

  // §8.5 Infeasible finance prompt (`request.infeasible.finance`)
  'request.infeasible.finance': {
    reads: ['capCents', 'itemTitles', 'cheapestAmountCents', 'neededCapCents'],
    slots: {
      capCents: slot.amount(),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      cheapestAmountCents: slot.amount(),
      neededCapCents: slot.amount(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Finance to decide on the budget.',
      owner:
        'No option fits a {capCents} cap. The cheapest option ({itemTitles}, {cheapestAmountCents}) needs a cap of {neededCapCents}.',
    },
  },

  // §8.5 Raise cap option (`request.raise_cap` / `raise_cap`)
  'request.raise_cap': {
    reads: ['newCapCents', 'deltaCents', 'itemTitles', 'amountCents', 'deliveryDate'],
    slots: {
      newCapCents: slot.amount(),
      deltaCents: slot.amount(),
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Finance to decide on the budget.',
      owner:
        'Raise the cap to {newCapCents} (+{deltaCents}). Makes {itemTitles} ({amountCents}, delivery {deliveryDate}) fit.',
    },
  },

  // §8.5 Drop items option (`request.drop_items` / `drop_items`)
  'request.drop_items': {
    reads: ['droppedTitles', 'enabledTitles', 'amountCents', 'deliveryDate'],
    slots: {
      droppedTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ', ',
        lastSeparator: ', ',
      }),
      enabledTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Customer to decide on the scope.',
      owner:
        'Make {droppedTitles} optional. Enables, for example, {enabledTitles} for {amountCents}, delivery {deliveryDate}.',
    },
  },

  // §8.5 Extend deadline option (with modifier)
  'request.extend_deadline': {
    reads: ['newDeadline', 'enabledTitles', 'modifierTitles', 'amountCents'],
    slots: {
      newDeadline: slot.date(),
      enabledTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      modifierTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 2,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Customer to decide on the scope.',
      owner:
        'Move your deadline to {newDeadline}. Enables {enabledTitles} with {modifierTitles} for {amountCents}.',
    },
  },

  // §8.5 Extend deadline option (without modifier)
  'request.extend_deadline.base': {
    reads: ['newDeadline', 'enabledTitles', 'amountCents'],
    slots: {
      newDeadline: slot.date(),
      enabledTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Customer to decide on the scope.',
      owner: 'Move your deadline to {newDeadline}. Enables {enabledTitles} for {amountCents}.',
    },
  },

  // §8.5 Choose candidate option (`request.choose_candidate`)
  'request.choose_candidate': {
    reads: ['itemTitles', 'amountCents', 'deliveryDate'],
    slots: {
      itemTitles: slot.list(catalogTitleSlot(), {
        minItems: 1,
        maxItems: 12,
        separator: ' + ',
        lastSeparator: ' + ',
      }),
      amountCents: slot.amount(),
      deliveryDate: slot.date(),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on Customer to decide on the scope.',
      owner:
        'Go with {itemTitles} for {amountCents}, delivery {deliveryDate}. This creates a new version for everyone to approve; it approves nothing by itself.',
    },
  },

  // §8.5 Disclose option (`request.disclose` / `disclose`)
  'request.disclose': {
    reads: ['field', 'toRole', 'targetReason'],
    slots: {
      field: slot.enum(DISCLOSE_FIELD_LABEL_ENUM, 'field'),
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
      targetReason: slot.enum(DISCLOSE_TARGET_REASON_ENUM, 'targetReason'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on another participant.',
      owner: 'Share your {field} with {toRole} so {targetReason}.',
    },
  },

  // §8.5 Simple options (`request.keep_as_is`, `request.end_run`, `request.retry_turn`, `request.pass_to_next`)
  'request.keep_as_is': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: 'Give the agents one more round.',
    },
  },

  'request.end_run': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: 'End this negotiation without agreement.',
    },
  },

  'request.retry_turn': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: "Retry your agent's turn.",
    },
  },

  'request.pass_to_next': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner:
        'Pass this to {toRole}. {toRole} will get their own version of this question; nothing changes until someone acts.',
    },
  },

  // §8.5 Clarify question templates (`request.clarify.*`)
  'request.clarify.item_required': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: 'Share your required items with {toRole} so they can check package scope.',
    },
  },

  'request.clarify.deadline_value': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: 'Share your deadline with {toRole} so they can check delivery timing.',
    },
  },

  'request.clarify.budget_room': {
    reads: ['toRole'],
    slots: {
      toRole: slot.enum(ROLE_LABEL_ENUM, 'toRole'),
    },
    variants: {
      room: 'Waiting on another participant.',
      buyer: 'Waiting on {toRole}.',
      owner: 'Share your budget headroom with {toRole} so they can evaluate the budget.',
    },
  },

  // §8.5 Agent recommendation (`agent.recommended`) — room & buyer show only round outcome
  'agent.recommended': {
    reads: ['proposalVersion'],
    slots: {
      proposalVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: 'v{proposalVersion} is ready for approval.',
      buyer: 'v{proposalVersion} is ready for approval.',
      owner:
        'Your agent recommends accepting v{proposalVersion}. Suggestion only, never counted as approval.',
    },
  },

  // §8.5 Approval recorded: approve
  'approval.recorded.approve': {
    reads: ['actorRole', 'proposalVersion', 'constraintsVersion'],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
      constraintsVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: '{actorRole} approved v{proposalVersion} under constraints v{constraintsVersion}.',
      buyer: '{actorRole} approved v{proposalVersion} under constraints v{constraintsVersion}.',
      owner: '{actorRole} approved v{proposalVersion} under constraints v{constraintsVersion}.',
    },
  },

  // §8.5 Approval recorded: withdraw
  'approval.recorded.withdraw': {
    reads: ['actorRole', 'proposalVersion'],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
    },
    variants: {
      room: '{actorRole} withdrew approval of v{proposalVersion}.',
      buyer: '{actorRole} withdrew approval of v{proposalVersion}.',
      owner: '{actorRole} withdrew approval of v{proposalVersion}.',
    },
  },

  // §8.5 Approval recorded: reject (room-audience reasons: terms_not_acceptable, scope_insufficient, needs_earlier_delivery, other)
  'approval.recorded.reject': {
    reads: ['actorRole', 'proposalVersion', 'reasonKey'],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
      reasonKey: slot.enum(humanReasonEnum('room'), 'reasonKey'),
    },
    variants: {
      room: '{actorRole} rejected v{proposalVersion}. Reason: {reasonKey}.',
      buyer: '{actorRole} rejected v{proposalVersion}. Reason: {reasonKey}.',
      owner: '{actorRole} rejected v{proposalVersion}. Reason: {reasonKey}.',
    },
  },

  // §8.5 Approval recorded: reject (`over_our_limit` reason hidden from room/provider)
  'approval.recorded.reject.buyers_only': {
    reads: ['actorRole', 'proposalVersion', 'reasonKey'],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
      reasonKey: slot.enum(humanReasonEnum('buyers'), 'reasonKey'),
    },
    variants: {
      room: '{actorRole} rejected v{proposalVersion}.',
      buyer: '{actorRole} rejected v{proposalVersion}. Reason: {reasonKey}.',
      owner: '{actorRole} rejected v{proposalVersion}. Reason: {reasonKey}.',
    },
  },

  // §8.6 Execution recorded (`execution.recorded`)
  'execution.recorded': {
    reads: [
      'changeOrderNo',
      'proposalVersion',
      'constraintsVersion',
      'amountCents',
      'taskCount',
      'baselineCents',
      'previousChangesCents',
      'committedBeforeCents',
      'committedAfterCents',
      'capCents',
    ],
    slots: {
      changeOrderNo: slot.integer({ min: 1, max: 999 }),
      proposalVersion: slot.integer({ min: 1, max: 999 }),
      constraintsVersion: slot.integer({ min: 1, max: 999 }),
      amountCents: slot.amount(),
      taskCount: slot.integer({
        min: 0,
        max: 99,
        unit: { singular: 'task', plural: 'tasks' },
      }),
      baselineCents: slot.amount(),
      previousChangesCents: slot.amount(),
      committedBeforeCents: slot.amount(),
      committedAfterCents: slot.amount(),
      capCents: slot.amount(),
    },
    variants: {
      room: 'Change order CO-{changeOrderNo} recorded: v{proposalVersion} under constraints v{constraintsVersion}, {amountCents}, {taskCount} for the provider. Internal record only — no payment, transfer or signature happens in this system.',
      buyer: '+{amountCents} recorded in the change order.',
      owner:
        'Baseline {baselineCents} · previously approved changes {previousChangesCents} · committed before {committedBeforeCents} · this change +{amountCents} · committed after {committedAfterCents} · cap {capCents}.',
    },
  },

  // §8.6 Execution tasks (`execution.tasks`)
  'execution.tasks': {
    reads: ['tasks'],
    slots: {
      tasks: slot.list(slot.fragment(['task_due_entry']), {
        minItems: 1,
        maxItems: 36,
        separator: ' · ',
        lastSeparator: ' · ',
      }),
    },
    variants: {
      room: '{tasks}.',
      buyer: '{tasks}.',
      owner: '{tasks}.',
    },
  },

  // §8.6 Ledger baseline recorded (`ledger.baseline_recorded`)
  'ledger.baseline_recorded': {
    reads: ['actorRole', 'baselineCents'],
    slots: {
      actorRole: slot.enum(ROLE_LABEL_ENUM, 'actorRole'),
      baselineCents: slot.amount(),
    },
    variants: {
      room: '{actorRole} recorded existing commitments (simulated).',
      buyer: '{actorRole} recorded existing commitments (simulated).',
      owner: 'Baseline commitments: {baselineCents} (simulated).',
    },
  },

  // §8.6 Catalog confirmed (`catalog.confirmed`)
  'catalog.confirmed': {
    reads: ['itemCount', 'modifierCount'],
    slots: {
      itemCount: slot.integer({
        min: 1,
        max: 12,
        unit: { singular: 'item', plural: 'items' },
      }),
      modifierCount: slot.integer({
        min: 0,
        max: 2,
        unit: { singular: 'option', plural: 'options' },
      }),
    },
    variants: {
      room: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
      buyer: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
      owner: 'Provider confirmed the catalog: {itemCount} and {modifierCount} (simulated).',
    },
  },

  // §10 S8 / §11 A3 Turn blocked notice (`turn.blocked`)
  'turn.blocked': {
    reads: ['roundNo'],
    slots: {
      roundNo: slot.integer({ min: 1, max: 99 }),
    },
    variants: {
      room: 'A provider option was blocked by the current constraints.',
      buyer: 'A provider option was blocked by the current constraints.',
      owner: 'Round {roundNo}: your option was blocked under the current constraints.',
    },
  },

  // §11 C Below-committed cap warning (`budget.below_committed.warning`, owner-only)
  'budget.below_committed.warning': {
    reads: ['committedCents'],
    slots: {
      committedCents: slot.amount(),
    },
    variants: {
      room: 'Validation warning.',
      buyer: 'Validation warning.',
      owner: 'The new cap is below the {committedCents} already committed.',
    },
  },
});

export type ScopeChangeTemplateKey = keyof typeof SCOPE_CHANGE_TEMPLATES & string;

export const scopeChangeTemplateRenderer = createPublicTextRenderer(SCOPE_CHANGE_TEMPLATES);

/**
 * Render a `scope_change` public template with Proxy read-tracking verification (`trackReads`).
 * Guarantees at runtime that only the keys declared for the target `variant` (`parsedVariants[variant].slotNames`)
 * are accessed on `fields`, and returns `{ text, accessedKeys, declaredReads }`.
 */
export function renderScopeChangeTemplateWithReads<K extends ScopeChangeTemplateKey>(
  templateKey: K,
  fields: Readonly<Record<string, unknown>>,
  variant: AudienceVariant = 'room',
): {
  readonly text: string;
  readonly accessedKeys: readonly string[];
  readonly declaredReads: readonly string[];
} {
  if (templateKey === 'budget.below_committed.warning' && variant !== 'owner') {
    throw new TemplateRenderError(
      'UNKNOWN_AUDIENCE_VARIANT',
      templateKey,
      'budget.below_committed.warning is owner-only and cannot be rendered for room or buyer audiences',
    );
  }
  const effectiveKey: ScopeChangeTemplateKey =
    templateKey === 'approval.recorded.reject' &&
    Reflect.getOwnPropertyDescriptor(fields, 'reasonKey')?.value === 'over_our_limit'
      ? 'approval.recorded.reject.buyers_only'
      : templateKey;
  const def = SCOPE_CHANGE_TEMPLATES[effectiveKey];
  const declaredReads = def.parsedVariants[variant].slotNames;
  const { result, accessedKeys } = trackReads(
    fields,
    declaredReads,
    (proxied) =>
      scopeChangeTemplateRenderer.renderPublicText(effectiveKey, proxied as never, variant),
  );
  return {
    text: result,
    accessedKeys,
    declaredReads,
  };
}

/**
 * Render a `scope_change` public template string (enforcing Proxy read-tracking).
 */
export function renderScopeChangeTemplate<K extends ScopeChangeTemplateKey>(
  templateKey: K,
  fields: Readonly<Record<string, unknown>>,
  variant: AudienceVariant = 'room',
): string {
  return renderScopeChangeTemplateWithReads(templateKey, fields, variant).text;
}

export { isoDate, publicCents, type IsoDate, type PublicCents };
