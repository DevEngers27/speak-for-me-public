import { describe, expect, test } from 'vitest';
import {
  AUDIENCE_VARIANTS,
  TemplateRenderError,
  isoDate,
  publicCents,
  trackReads,
} from '@core/engine/publicText';
import {
  SCOPE_CHANGE_TEMPLATES,
  scopeChangePlugin,
  delimitCatalogTitle,
  renderCatalogTitleFragment,
  renderScopeChangeTemplate,
  renderScopeChangeTemplateWithReads,
  renderTaskDueFragment,
  scopeChangeFragmentRenderer,
  scopeChangeTemplateRenderer,
  validateCatalogTitle,
  type ScopeChangeTemplateKey,
} from '@core/scenarios/scope-change';

const sampleQuestionFragment = scopeChangeFragmentRenderer.renderFragment(
  'infeasible_finance_question',
  {
    capCents: publicCents(470_000),
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    cheapestAmountCents: publicCents(80_000),
    neededCapCents: publicCents(480_000),
  },
);

const sampleFieldsByTemplate: Readonly<Record<ScopeChangeTemplateKey, Record<string, unknown>>> = {
  'proposal.created': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)', 'Usage dashboard'],
    amountCents: publicCents(90_000),
    deliveryDate: isoDate('2026-11-18'),
    committedCents: publicCents(400_000),
    committedAfterCents: publicCents(490_000),
    capCents: publicCents(500_000),
    headroomAfterCents: publicCents(10_000),
    missingPreferredTitles: ['Slack alerts'],
  },
  'proposal.created.cap_only': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)', 'Usage dashboard'],
    amountCents: publicCents(90_000),
    deliveryDate: isoDate('2026-11-18'),
    capCents: publicCents(500_000),
    missingPreferredTitles: ['Slack alerts'],
  },
  'proposal.created.no_budget': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)', 'Usage dashboard'],
    amountCents: publicCents(90_000),
    deliveryDate: isoDate('2026-11-18'),
    missingPreferredTitles: ['Slack alerts'],
  },
  'proposal.created.with_modifier': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    modifierTitles: ['Rush delivery'],
    amountCents: publicCents(95_000),
    deliveryDate: isoDate('2026-11-12'),
    capCents: publicCents(500_000),
    missingPreferredTitles: ['Slack alerts', 'Usage dashboard'],
  },
  'proposal.created.with_modifier.no_budget': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    modifierTitles: ['Rush delivery'],
    amountCents: publicCents(95_000),
    deliveryDate: isoDate('2026-11-12'),
    missingPreferredTitles: ['Slack alerts', 'Usage dashboard'],
  },
  'proposal.created.with_modifier.full_budget': {
    actorRole: 'provider',
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    modifierTitles: ['Rush delivery'],
    amountCents: publicCents(95_000),
    deliveryDate: isoDate('2026-11-12'),
    committedCents: publicCents(400_000),
    committedAfterCents: publicCents(495_000),
    capCents: publicCents(500_000),
    headroomAfterCents: publicCents(5_000),
    missingPreferredTitles: ['Slack alerts', 'Usage dashboard'],
  },
  'proposal.fit': {
    fit: 'ok',
  },
  'proposal.diff': {
    fromVersion: 1,
    changeVerb: 'removed',
    changedTitles: ['Usage dashboard'],
    fromAmountCents: publicCents(90_000),
    toAmountCents: publicCents(80_000),
    fromDeliveryDate: isoDate('2026-11-18'),
    toDeliveryDate: isoDate('2026-11-16'),
  },
  'constraints_changed.finance_cap': {
    fromCapCents: publicCents(500_000),
    toCapCents: publicCents(480_000),
    toVersion: 2,
    staleApprovalsCount: 2,
  },
  'constraints_changed.finance_cap.short': {
    fromCapCents: publicCents(470_000),
    toCapCents: publicCents(480_000),
    toVersion: 3,
  },
  'constraints_changed.finance_cap.undisclosed': {
    fromCapCents: publicCents(500_000),
    toCapCents: publicCents(480_000),
    toVersion: 2,
    staleApprovalsCount: 2,
  },
  'constraints_changed.customer_deadline': {
    fromDeadline: isoDate('2026-11-20'),
    toDeadline: isoDate('2026-11-29'),
    toVersion: 3,
  },
  'constraints_changed.customer_deadline.undisclosed': {
    fromDeadline: isoDate('2026-11-20'),
    toDeadline: isoDate('2026-11-29'),
    toVersion: 3,
  },
  'constraints_changed.customer_items': {
    droppedTitles: ['Audit log export'],
    toVersion: 2,
  },
  'constraints_changed.customer_items.undisclosed': {
    droppedTitles: ['Audit log export'],
    toVersion: 2,
  },
  'constraints_changed.catalog_changed': {
    toVersion: 2,
  },
  'constraints_changed.clock': {
    deliveryDate: isoDate('2026-11-18'),
    proposalVersion: 1,
    toVersion: 2,
  },
  'catalog.item_retired': {
    itemTitle: 'Audit log export',
  },
  'catalog.price_changed': {
    itemTitle: 'Usage dashboard',
    fromPriceCents: publicCents(10_000),
    toPriceCents: publicCents(12_000),
  },
  'catalog.item_confirmed': {
    itemCount: 5,
    modifierCount: 1,
  },
  'check.budget.over': {
    overByCents: publicCents(10_000),
    committedAfterCents: publicCents(490_000),
    capCents: publicCents(480_000),
  },
  'check.private.constraint_unmet': {
    viewerRole: 'customer',
  },
  'check.date.after_deadline': {
    deliveryDate: isoDate('2026-12-04'),
    daysLate: 14,
    deadline: isoDate('2026-11-20'),
  },
  'check.item.required_missing': {
    missingTitles: ['Audit log export'],
  },
  'check.item.required_not_offered': {
    missingTitles: ['Audit log export'],
  },
  'check.version.stale_constraints': {
    checkedAgainst: 2,
  },
  'check.item.retired': {
    retiredTitles: ['Audit log export'],
  },
  'check.version.stale_source': {
    changedTitles: ['Usage dashboard'],
  },
  'run.waiting': {
    toRole: 'finance',
    domain: 'budget',
    question: sampleQuestionFragment,
  },
  'request.infeasible.finance': {
    capCents: publicCents(470_000),
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    cheapestAmountCents: publicCents(80_000),
    neededCapCents: publicCents(480_000),
  },
  'request.raise_cap': {
    newCapCents: publicCents(480_000),
    deltaCents: publicCents(10_000),
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    amountCents: publicCents(80_000),
    deliveryDate: isoDate('2026-11-16'),
  },
  'request.drop_items': {
    droppedTitles: ['Audit log export'],
    enabledTitles: ['SSO login (SAML)'],
    amountCents: publicCents(50_000),
    deliveryDate: isoDate('2026-11-13'),
  },
  'request.extend_deadline': {
    newDeadline: isoDate('2026-11-29'),
    enabledTitles: ['Audit log export', 'SSO login (SAML)'],
    modifierTitles: ['Rush delivery'],
    amountCents: publicCents(95_000),
  },
  'request.extend_deadline.base': {
    newDeadline: isoDate('2026-12-03'),
    enabledTitles: ['Audit log export', 'SSO login (SAML)'],
    amountCents: publicCents(80_000),
  },
  'request.choose_candidate': {
    itemTitles: ['Audit log export', 'SSO login (SAML)'],
    amountCents: publicCents(80_000),
    deliveryDate: isoDate('2026-11-16'),
  },
  'request.disclose': {
    field: 'deadline',
    toRole: 'finance',
    targetReason: 'finance',
  },
  'request.keep_as_is': {
    toRole: 'customer',
  },
  'request.end_run': {
    toRole: 'customer',
  },
  'request.retry_turn': {
    toRole: 'provider',
  },
  'request.pass_to_next': {
    toRole: 'finance',
  },
  'request.clarify.item_required': {
    toRole: 'provider',
  },
  'request.clarify.deadline_value': {
    toRole: 'provider',
  },
  'request.clarify.budget_room': {
    toRole: 'customer',
  },
  'agent.recommended': {
    proposalVersion: 1,
  },
  'approval.recorded.approve': {
    actorRole: 'customer',
    proposalVersion: 2,
    constraintsVersion: 2,
  },
  'approval.recorded.withdraw': {
    actorRole: 'customer',
    proposalVersion: 2,
  },
  'approval.recorded.reject': {
    actorRole: 'customer',
    proposalVersion: 3,
    reasonKey: 'terms_not_acceptable',
  },
  'approval.recorded.reject.buyers_only': {
    actorRole: 'finance',
    proposalVersion: 3,
    reasonKey: 'over_our_limit',
  },
  'execution.recorded': {
    changeOrderNo: 1,
    proposalVersion: 2,
    constraintsVersion: 2,
    amountCents: publicCents(80_000),
    taskCount: 2,
    baselineCents: publicCents(400_000),
    previousChangesCents: publicCents(0),
    committedBeforeCents: publicCents(400_000),
    committedAfterCents: publicCents(480_000),
    capCents: publicCents(480_000),
  },
  'execution.tasks': {
    tasks: [
      renderTaskDueFragment('Build audit log CSV export', '2026-11-16'),
      renderTaskDueFragment('Implement SAML SSO login', '2026-11-16'),
    ],
  },
  'ledger.baseline_recorded': {
    actorRole: 'finance',
    baselineCents: publicCents(400_000),
  },
  'catalog.confirmed': {
    itemCount: 5,
    modifierCount: 1,
  },
  'turn.blocked': {
    roundNo: 1,
  },
  'budget.below_committed.warning': {
    committedCents: publicCents(400_000),
  },
};

describe('T14-T01: scope_change public templates & Proxy read-tracking (14 §8)', () => {
  test('every template variant reads strictly its declared slotNames under Proxy read-tracking and union equals def.reads', () => {
    const templateKeys = Object.keys(SCOPE_CHANGE_TEMPLATES) as ScopeChangeTemplateKey[];
    expect(templateKeys.length).toBe(Object.keys(sampleFieldsByTemplate).length);

    for (const key of templateKeys) {
      const def = SCOPE_CHANGE_TEMPLATES[key];
      const baseFields = sampleFieldsByTemplate[key];
      const unionAccessed = new Set<string>();

      const stateWithPrivateCanaries = {
        ...baseFields,
        __privateCanaryNote: 'CANARY-CUS-2219',
        __privateSecretCap: 512_347,
        __privateRationale: 'CANARY-RAT-finance',
      };

      const variants =
        key === 'budget.below_committed.warning'
          ? (['owner'] as const)
          : AUDIENCE_VARIANTS;

      for (const variant of variants) {
        const { text, accessedKeys, declaredReads } = renderScopeChangeTemplateWithReads(
          key,
          stateWithPrivateCanaries,
          variant,
        );
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain('CANARY');
        expect(text).not.toContain('512,347');
        expect(new Set(accessedKeys)).toEqual(new Set(declaredReads));
        for (const k of accessedKeys) {
          unionAccessed.add(k);
        }
      }

      expect(unionAccessed).toEqual(new Set(def.reads));
    }
  });

  test('renders every §8.2–§8.6 example sentence word-for-word', () => {
    // §8.2 proposal.created
    expect(
      renderScopeChangeTemplate('proposal.created', sampleFieldsByTemplate['proposal.created'], 'room'),
    ).toBe(
      'Provider agent proposes Audit log export + SSO login (SAML) + Usage dashboard for $900, delivery 2026-11-18.',
    );
    expect(
      renderScopeChangeTemplate('proposal.created', sampleFieldsByTemplate['proposal.created'], 'buyer'),
    ).toBe('+$900 change · committed $4,000 → $4,900 · cap $5,000 · headroom after $100.');
    expect(
      renderScopeChangeTemplate('proposal.created', sampleFieldsByTemplate['proposal.created'], 'owner'),
    ).toBe('Not included from your wishlist: Slack alerts.');

    // §8.2 proposal.created.cap_only (main customer view: cap-only without modifiers, r04)
    expect(
      renderScopeChangeTemplate(
        'proposal.created.cap_only',
        sampleFieldsByTemplate['proposal.created.cap_only'],
        'room',
      ),
    ).toBe(
      'Provider agent proposes Audit log export + SSO login (SAML) + Usage dashboard for $900, delivery 2026-11-18.',
    );
    expect(
      renderScopeChangeTemplate(
        'proposal.created.cap_only',
        sampleFieldsByTemplate['proposal.created.cap_only'],
        'buyer',
      ),
    ).toBe('+$900 change · finance cap $5,000.');
    expect(
      renderScopeChangeTemplate(
        'proposal.created.cap_only',
        sampleFieldsByTemplate['proposal.created.cap_only'],
        'owner',
      ),
    ).toBe('Not included from your wishlist: Slack alerts.');

    // §8.2 proposal.created.with_modifier & customer cap-only buyer variant
    expect(
      renderScopeChangeTemplate(
        'proposal.created.with_modifier',
        sampleFieldsByTemplate['proposal.created.with_modifier'],
        'room',
      ),
    ).toBe(
      'Provider agent proposes Audit log export + SSO login (SAML) with Rush delivery for $950, delivery 2026-11-12.',
    );
    expect(
      renderScopeChangeTemplate(
        'proposal.created.with_modifier',
        { ...sampleFieldsByTemplate['proposal.created.with_modifier'], amountCents: publicCents(90_000) },
        'buyer',
      ),
    ).toBe('+$900 change · finance cap $5,000.');

    // §8.2 proposal.created.with_modifier.full_budget (rush finance view: full budget chain with modifiers, r04)
    expect(
      renderScopeChangeTemplate(
        'proposal.created.with_modifier.full_budget',
        sampleFieldsByTemplate['proposal.created.with_modifier.full_budget'],
        'room',
      ),
    ).toBe(
      'Provider agent proposes Audit log export + SSO login (SAML) with Rush delivery for $950, delivery 2026-11-12.',
    );
    expect(
      renderScopeChangeTemplate(
        'proposal.created.with_modifier.full_budget',
        sampleFieldsByTemplate['proposal.created.with_modifier.full_budget'],
        'buyer',
      ),
    ).toBe('+$950 change · committed $4,000 → $4,950 · cap $5,000 · headroom after $50.');
    expect(
      renderScopeChangeTemplate(
        'proposal.created.with_modifier.full_budget',
        sampleFieldsByTemplate['proposal.created.with_modifier.full_budget'],
        'owner',
      ),
    ).toBe('Not included from your wishlist: Slack alerts, Usage dashboard.');

    // §8.2 proposal.fit & proposal.diff
    expect(renderScopeChangeTemplate('proposal.fit', { fit: 'ok' }, 'room')).toBe('Fit: ok');
    expect(renderScopeChangeTemplate('proposal.fit', { fit: 'blocked' }, 'room')).toBe(
      'Blocked under the current constraints.',
    );
    expect(
      renderScopeChangeTemplate('proposal.diff', sampleFieldsByTemplate['proposal.diff'], 'room'),
    ).toBe('Changes from v1: removed Usage dashboard; $900 → $800; delivery 2026-11-18 → 2026-11-16.');

    // §8.3 constraints_changed
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.finance_cap',
        sampleFieldsByTemplate['constraints_changed.finance_cap'],
        'owner',
      ),
    ).toBe(
      'You changed the budget cap from $5,000 to $4,800 (constraints v2). 2 approvals no longer apply.',
    );
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.finance_cap',
        sampleFieldsByTemplate['constraints_changed.finance_cap'],
        'buyer',
      ),
    ).toBe(
      'Finance updated the budget cap to $4,800 (constraints v2). Proposals are being re-checked.',
    );
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.finance_cap.undisclosed',
        sampleFieldsByTemplate['constraints_changed.finance_cap.undisclosed'],
        'buyer',
      ),
    ).toBe('Finance updated the budget (constraints v2). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.finance_cap',
        sampleFieldsByTemplate['constraints_changed.finance_cap'],
        'room',
      ),
    ).toBe('Constraints changed (v2). Proposals are being re-checked.');

    expect(
      renderScopeChangeTemplate(
        'constraints_changed.customer_deadline',
        sampleFieldsByTemplate['constraints_changed.customer_deadline'],
        'owner',
      ),
    ).toBe('You moved your deadline from 2026-11-20 to 2026-11-29 (constraints v3).');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.customer_deadline',
        sampleFieldsByTemplate['constraints_changed.customer_deadline'],
        'buyer',
      ),
    ).toBe('Customer moved the deadline to 2026-11-29 (constraints v3). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.customer_deadline.undisclosed',
        sampleFieldsByTemplate['constraints_changed.customer_deadline.undisclosed'],
        'buyer',
      ),
    ).toBe('Customer updated a private constraint (constraints v3). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.customer_deadline',
        sampleFieldsByTemplate['constraints_changed.customer_deadline'],
        'room',
      ),
    ).toBe('Constraints changed (v3). Proposals are being re-checked.');

    expect(
      renderScopeChangeTemplate(
        'constraints_changed.catalog_changed',
        sampleFieldsByTemplate['constraints_changed.catalog_changed'],
        'room',
      ),
    ).toBe('Constraints changed (v2). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.catalog_changed',
        sampleFieldsByTemplate['constraints_changed.catalog_changed'],
        'buyer',
      ),
    ).toBe('Provider changed the catalog (constraints v2). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'catalog.item_retired',
        sampleFieldsByTemplate['catalog.item_retired'],
        'room',
      ),
    ).toBe('Provider retired Audit log export from the catalog.');
    expect(
      renderScopeChangeTemplate(
        'catalog.price_changed',
        sampleFieldsByTemplate['catalog.price_changed'],
        'room',
      ),
    ).toBe('Provider changed the price of Usage dashboard from $100 to $120.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.clock',
        sampleFieldsByTemplate['constraints_changed.clock'],
        'room',
      ),
    ).toBe('Constraints changed (v2). Proposals are being re-checked.');
    expect(
      renderScopeChangeTemplate(
        'constraints_changed.clock',
        sampleFieldsByTemplate['constraints_changed.clock'],
        'buyer',
      ),
    ).toBe('Delivery date 2026-11-18 of v1 has passed (constraints v2).');

    // §8.4 check results
    expect(
      renderScopeChangeTemplate('check.budget.over', sampleFieldsByTemplate['check.budget.over'], 'owner'),
    ).toBe('Over budget by $100 ($4,900 > $4,800).');
    expect(
      renderScopeChangeTemplate('check.budget.over', sampleFieldsByTemplate['check.budget.over'], 'buyer'),
    ).toBe('Over the available budget by $100.');
    expect(
      renderScopeChangeTemplate(
        'check.private.constraint_unmet',
        sampleFieldsByTemplate['check.private.constraint_unmet'],
        'buyer',
      ),
    ).toBe('A constraint private to another participant is not met.');
    expect(
      renderScopeChangeTemplate(
        'check.date.after_deadline',
        sampleFieldsByTemplate['check.date.after_deadline'],
        'buyer',
      ),
    ).toBe("Delivery is 14 days after the customer's deadline (2026-11-20).");
    expect(
      renderScopeChangeTemplate(
        'check.date.after_deadline',
        sampleFieldsByTemplate['check.date.after_deadline'],
        'owner',
      ),
    ).toBe('Delivery 2026-12-04 is 14 days after your deadline 2026-11-20.');
    expect(
      renderScopeChangeTemplate(
        'check.item.required_missing',
        sampleFieldsByTemplate['check.item.required_missing'],
        'owner',
      ),
    ).toBe('Missing a required item: Audit log export.');
    expect(
      renderScopeChangeTemplate(
        'check.item.required_not_offered',
        sampleFieldsByTemplate['check.item.required_not_offered'],
        'owner',
      ),
    ).toBe("Audit log export is no longer in the provider's confirmed catalog.");
    expect(
      renderScopeChangeTemplate(
        'check.version.stale_constraints',
        sampleFieldsByTemplate['check.version.stale_constraints'],
        'buyer',
      ),
    ).toBe('This version no longer applies (constraints v2).');
    expect(
      renderScopeChangeTemplate('check.item.retired', sampleFieldsByTemplate['check.item.retired'], 'buyer'),
    ).toBe('Audit log export was retired from the catalog.');
    expect(
      renderScopeChangeTemplate(
        'check.version.stale_source',
        sampleFieldsByTemplate['check.version.stale_source'],
        'buyer',
      ),
    ).toBe('The catalog changed since this version: Usage dashboard.');

    // §8.5 waiting, requests, recommendations, approvals
    expect(
      renderScopeChangeTemplate('run.waiting', sampleFieldsByTemplate['run.waiting'], 'room'),
    ).toBe('Waiting on another participant.');
    expect(
      renderScopeChangeTemplate('run.waiting', sampleFieldsByTemplate['run.waiting'], 'buyer'),
    ).toBe('Waiting on Finance to decide on the budget.');
    expect(
      renderScopeChangeTemplate('run.waiting', sampleFieldsByTemplate['run.waiting'], 'owner'),
    ).toBe(
      'Your decision is needed: No option fits a $4,700 cap. The cheapest option (Audit log export + SSO login (SAML), $800) needs a cap of $4,800.',
    );

    expect(
      renderScopeChangeTemplate(
        'request.infeasible.finance',
        sampleFieldsByTemplate['request.infeasible.finance'],
        'owner',
      ),
    ).toBe(
      'No option fits a $4,700 cap. The cheapest option (Audit log export + SSO login (SAML), $800) needs a cap of $4,800.',
    );
    expect(
      renderScopeChangeTemplate(
        'request.raise_cap',
        sampleFieldsByTemplate['request.raise_cap'],
        'owner',
      ),
    ).toBe(
      'Raise the cap to $4,800 (+$100). Makes Audit log export + SSO login (SAML) ($800, delivery 2026-11-16) fit.',
    );
    expect(
      renderScopeChangeTemplate(
        'request.drop_items',
        sampleFieldsByTemplate['request.drop_items'],
        'owner',
      ),
    ).toBe(
      'Make Audit log export optional. Enables, for example, SSO login (SAML) for $500, delivery 2026-11-13.',
    );
    expect(
      renderScopeChangeTemplate(
        'request.extend_deadline',
        sampleFieldsByTemplate['request.extend_deadline'],
        'owner',
      ),
    ).toBe(
      'Move your deadline to 2026-11-29. Enables Audit log export + SSO login (SAML) with Rush delivery for $950.',
    );
    expect(
      renderScopeChangeTemplate(
        'request.choose_candidate',
        sampleFieldsByTemplate['request.choose_candidate'],
        'owner',
      ),
    ).toBe(
      'Go with Audit log export + SSO login (SAML) for $800, delivery 2026-11-16. This creates a new version for everyone to approve; it approves nothing by itself.',
    );
    expect(
      renderScopeChangeTemplate(
        'request.disclose',
        sampleFieldsByTemplate['request.disclose'],
        'owner',
      ),
    ).toBe('Share your deadline with Finance so the budget owner can see the conflict.');
    expect(
      renderScopeChangeTemplate(
        'request.keep_as_is',
        sampleFieldsByTemplate['request.keep_as_is'],
        'owner',
      ),
    ).toBe('Give the agents one more round.');
    expect(
      renderScopeChangeTemplate(
        'request.end_run',
        sampleFieldsByTemplate['request.end_run'],
        'owner',
      ),
    ).toBe('End this negotiation without agreement.');
    expect(
      renderScopeChangeTemplate(
        'request.retry_turn',
        sampleFieldsByTemplate['request.retry_turn'],
        'owner',
      ),
    ).toBe("Retry your agent's turn.");
    expect(
      renderScopeChangeTemplate(
        'request.pass_to_next',
        sampleFieldsByTemplate['request.pass_to_next'],
        'owner',
      ),
    ).toBe(
      'Pass this to Finance. Finance will get their own version of this question; nothing changes until someone acts.',
    );

    expect(
      renderScopeChangeTemplate(
        'agent.recommended',
        sampleFieldsByTemplate['agent.recommended'],
        'room',
      ),
    ).toBe('v1 is ready for approval.');
    expect(
      renderScopeChangeTemplate(
        'agent.recommended',
        sampleFieldsByTemplate['agent.recommended'],
        'buyer',
      ),
    ).toBe('v1 is ready for approval.');
    expect(
      renderScopeChangeTemplate(
        'agent.recommended',
        sampleFieldsByTemplate['agent.recommended'],
        'owner',
      ),
    ).toBe('Your agent recommends accepting v1. Suggestion only, never counted as approval.');

    expect(
      renderScopeChangeTemplate(
        'approval.recorded.approve',
        sampleFieldsByTemplate['approval.recorded.approve'],
        'room',
      ),
    ).toBe('Customer approved v2 under constraints v2.');
    expect(
      renderScopeChangeTemplate(
        'approval.recorded.withdraw',
        sampleFieldsByTemplate['approval.recorded.withdraw'],
        'room',
      ),
    ).toBe('Customer withdrew approval of v2.');
    // Room-audience reason (`terms_not_acceptable`) renders Reason in room, buyer, and owner
    expect(
      renderScopeChangeTemplate(
        'approval.recorded.reject',
        sampleFieldsByTemplate['approval.recorded.reject'],
        'room',
      ),
    ).toBe('Customer rejected v3. Reason: terms not acceptable.');
    // Buyers-only reason (`over_our_limit`) hides Reason in room (provider) and shows it in buyer/owner
    expect(
      renderScopeChangeTemplate(
        'approval.recorded.reject',
        { actorRole: 'finance', proposalVersion: 3, reasonKey: 'over_our_limit' },
        'room',
      ),
    ).toBe('Finance rejected v3.');
    expect(
      renderScopeChangeTemplate(
        'approval.recorded.reject',
        { actorRole: 'finance', proposalVersion: 3, reasonKey: 'over_our_limit' },
        'buyer',
      ),
    ).toBe('Finance rejected v3. Reason: over our limit.');

    // §8.6 execution and setup
    expect(
      renderScopeChangeTemplate(
        'execution.recorded',
        sampleFieldsByTemplate['execution.recorded'],
        'room',
      ),
    ).toBe(
      'Change order CO-1 recorded: v2 under constraints v2, $800, 2 tasks for the provider. Internal record only — no payment, transfer or signature happens in this system.',
    );
    expect(
      renderScopeChangeTemplate(
        'execution.recorded',
        sampleFieldsByTemplate['execution.recorded'],
        'buyer',
      ),
    ).toBe('+$800 recorded in the change order.');
    expect(
      renderScopeChangeTemplate(
        'execution.recorded',
        sampleFieldsByTemplate['execution.recorded'],
        'owner',
      ),
    ).toBe(
      'Baseline $4,000 · previously approved changes $0 · committed before $4,000 · this change +$800 · committed after $4,800 · cap $4,800.',
    );
    expect(
      renderScopeChangeTemplate('execution.tasks', sampleFieldsByTemplate['execution.tasks'], 'owner'),
    ).toBe('Build audit log CSV export — due 2026-11-16 · Implement SAML SSO login — due 2026-11-16.');
    expect(
      renderScopeChangeTemplate(
        'ledger.baseline_recorded',
        sampleFieldsByTemplate['ledger.baseline_recorded'],
        'room',
      ),
    ).toBe('Finance recorded existing commitments (simulated).');
    expect(
      renderScopeChangeTemplate(
        'ledger.baseline_recorded',
        sampleFieldsByTemplate['ledger.baseline_recorded'],
        'owner',
      ),
    ).toBe('Baseline commitments: $4,000 (simulated).');
    expect(
      renderScopeChangeTemplate(
        'catalog.confirmed',
        sampleFieldsByTemplate['catalog.confirmed'],
        'room',
      ),
    ).toBe('Provider confirmed the catalog: 5 items and 1 option (simulated).');
    expect(
      renderScopeChangeTemplate('turn.blocked', sampleFieldsByTemplate['turn.blocked'], 'room'),
    ).toBe('A provider option was blocked by the current constraints.');
    expect(
      renderScopeChangeTemplate('turn.blocked', sampleFieldsByTemplate['turn.blocked'], 'owner'),
    ).toBe('Round 1: your option was blocked under the current constraints.');
    expect(
      renderScopeChangeTemplate(
        'budget.below_committed.warning',
        sampleFieldsByTemplate['budget.below_committed.warning'],
        'owner',
      ),
    ).toBe('The new cap is below the $4,000 already committed.');
    expect(() =>
      renderScopeChangeTemplate(
        'budget.below_committed.warning',
        sampleFieldsByTemplate['budget.below_committed.warning'],
        'room',
      ),
    ).toThrow(TemplateRenderError);
    expect(() =>
      renderScopeChangeTemplate(
        'budget.below_committed.warning',
        sampleFieldsByTemplate['budget.below_committed.warning'],
        'buyer',
      ),
    ).toThrow(TemplateRenderError);
  });

  test('i01 (blocker): provider (room) renderings of all constraints_changed.* templates are byte-identical across causes', () => {
    const constraintChangedKeys = (
      Object.keys(SCOPE_CHANGE_TEMPLATES) as ScopeChangeTemplateKey[]
    ).filter((k) => k.startsWith('constraints_changed.'));
    expect(constraintChangedKeys.length).toBeGreaterThanOrEqual(8);

    const renderedRoomTexts = constraintChangedKeys.map((key) =>
      renderScopeChangeTemplate(
        key,
        { ...sampleFieldsByTemplate[key], toVersion: 2 },
        'room',
      ),
    );
    for (const text of renderedRoomTexts) {
      expect(text).toBe('Constraints changed (v2). Proposals are being re-checked.');
    }
    expect(new Set(renderedRoomTexts).size).toBe(1);
  });

  test('i02 (blocker): provider (room) and finance/customer (buyer) texts never contain "recommends" or "agent declined"', () => {
    for (const [key, fields] of Object.entries(sampleFieldsByTemplate) as Array<
      [ScopeChangeTemplateKey, Record<string, unknown>]
    >) {
      if (key === 'budget.below_committed.warning') continue;
      for (const variant of ['room', 'buyer'] as const) {
        const text = renderScopeChangeTemplate(key, fields, variant);
        expect(text, `${key}:${variant}`).not.toContain('recommends');
        expect(text.toLowerCase(), `${key}:${variant}`).not.toContain('agent declined');
      }
    }
  });

  test('room variant never leaks private budget numbers ($5,000, $4,800, $4,700, $4,000) or private deadline (2026-11-20)', () => {
    for (const [key, fields] of Object.entries(sampleFieldsByTemplate) as Array<
      [ScopeChangeTemplateKey, Record<string, unknown>]
    >) {
      if (key === 'budget.below_committed.warning') continue;
      const roomText = renderScopeChangeTemplate(key, fields, 'room');
      expect(roomText, key).not.toContain('$5,000');
      expect(roomText, key).not.toContain('$4,800');
      expect(roomText, key).not.toContain('$4,700');
      expect(roomText, key).not.toContain('$4,000');
      expect(roomText, key).not.toContain('$4,900');
      expect(roomText, key).not.toContain('2026-11-20');
      expect(roomText, key).not.toContain('over our limit');
    }
  });

  test('r03 property test: validateCatalogTitle and template renderer accept the exact same set of titles', () => {
    const alphabet = [
      'a',
      'Z',
      '0',
      ' ',
      '-',
      '_',
      '$',
      '&',
      '"',
      "'",
      '(',
      ')',
      ':',
      '/',
      '审',
      '计',
      '🚀',
      'é',
      '<',
      '>',
      '\n',
      '\r',
    ];
    let seed = 0x12345678;
    const nextInt = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };

    const candidates: string[] = [
      'A',
      'z',
      'sso login',
      'ﬃ'.repeat(27),
      'line\u2028break',
      'sys\u{1D173}tem',
      'sys\u{1BCA0}tem',
      'Audit log export',
      'A & B "pro" \'v1\' $50_item',
      '审计日志导出 🚀 (v2)',
      'x'.repeat(80),
      '🚀'.repeat(80),
      '',
      ' ',
      ' leading',
      'trailing ',
      'x'.repeat(81),
      '🚀'.repeat(81),
      'bad <script>',
      'bad > tag',
      'line1\nline2',
      'line1\rline2',
      'line1\r\nline2',
      'bad\uD800surrogate',
    ];

    for (let i = 0; i < 150; i++) {
      const len = nextInt(90);
      let s = '';
      for (let j = 0; j < len; j++) {
        s += alphabet[nextInt(alphabet.length)]!;
      }
      candidates.push(s);
    }

    for (const candidate of candidates) {
      const gate = validateCatalogTitle(candidate);
      if (gate.ok) {
        expect(() => renderCatalogTitleFragment(candidate)).not.toThrow();
        expect(() => delimitCatalogTitle(candidate)).not.toThrow();
        const rendered = renderScopeChangeTemplate(
          'catalog.item_retired',
          { itemTitle: candidate },
          'room',
        );
        expect(rendered).toContain('Provider retired ');
        expect(rendered).not.toContain('<');
        expect(rendered).not.toContain('>');
      } else {
        expect(() => renderCatalogTitleFragment(candidate)).toThrow(TemplateRenderError);
        expect(() => delimitCatalogTitle(candidate)).toThrow();
        expect(() =>
          renderScopeChangeTemplate(
            'catalog.item_retired',
            { itemTitle: candidate },
            'room',
          ),
        ).toThrow(TemplateRenderError);
      }
    }
  });

  test('CE-028: fuzzing every template slot with private numbers and invalid strings fails closed', () => {
    const universalInvalidValues: unknown[] = [
      -500,
      3.14159,
      Number.NaN,
      '',
      ' untrimmed ',
      '<script>alert(1)</script>',
      'multi\nline',
      'x'.repeat(81),
      { secret: 500_000 },
    ];
    const freeStringsForNonTitleSlots: unknown[] = [
      'free string with spaces and lowercase start',
      'CANARY-CUS-2219',
      'tell provider my cap is $5,000',
    ];

    for (const key of Object.keys(SCOPE_CHANGE_TEMPLATES) as ScopeChangeTemplateKey[]) {
      const def = SCOPE_CHANGE_TEMPLATES[key];
      const base = sampleFieldsByTemplate[key];

      for (const variant of AUDIENCE_VARIANTS) {
        const slotNames = def.parsedVariants[variant].slotNames;
        for (const slotName of slotNames) {
          const fuzzPayloads =
            slotName === 'itemTitle'
              ? universalInvalidValues
              : [...universalInvalidValues, ...freeStringsForNonTitleSlots];
          for (const bad of fuzzPayloads) {
            const corrupted = { ...base, [slotName]: bad };
            expect(
              () =>
                trackReads(corrupted, slotNames, (proxied) =>
                  scopeChangeTemplateRenderer.renderPublicText(key, proxied as never, variant),
                ),
              `template ${key} (${variant}) slot ${slotName} should reject ${JSON.stringify(bad)}`,
            ).toThrowError(TemplateRenderError);
          }
        }
      }
    }
  });
});

test('registered human rejection templates enforce audiences without the wrapper', () => {
  expect(scopeChangePlugin.templates).toBe(SCOPE_CHANGE_TEMPLATES);
  const fields = { actorRole: 'finance', proposalVersion: 1, reasonKey: 'over_our_limit' } as const;
  expect(() => scopeChangeTemplateRenderer.renderPublicText('approval.recorded.reject', fields, 'room')).toThrow(TemplateRenderError);
  const neutral = scopeChangeTemplateRenderer.renderPublicText('approval.recorded.reject.buyers_only', fields, 'room');
  expect(neutral).toBe('Finance rejected v1.');
  expect(neutral).not.toContain('over');
  for (const reasonKey of ['over_budget', 'cannot_deliver', 'price_too_high']) {
    for (const variant of ['room', 'buyer', 'owner'] as const) expect(() => scopeChangeTemplateRenderer.renderPublicText('approval.recorded.reject', { ...fields, reasonKey }, variant)).toThrow(TemplateRenderError);
  }
  expect(() => renderScopeChangeTemplate('turn.blocked', {}, 'owner')).toThrow(TemplateRenderError);
});


test('W2-GW merge preserves JSON escaping in catalog title fragments without string quotes', () => {
  expect(renderCatalogTitleFragment('A & B').text).toBe('A \\u0026 B');
  expect(delimitCatalogTitle('A & B')).toContain('"A \\u0026 B"');
  for (const title of ['ﬃ'.repeat(27), 'line\u2028break']) {
    expect(validateCatalogTitle(title)).toMatchObject({ok: false, code: 'input.invalid'});
    expect(() => renderCatalogTitleFragment(title)).toThrow(TemplateRenderError);
    expect(() => delimitCatalogTitle(title)).toThrow();
  }
  for (const title of ['sys\u{1D173}tem', 'sys\u{1BCA0}tem']) {
    expect(validateCatalogTitle(title)).toMatchObject({ok: false, code: 'disclosure.blocked'});
  }
});
