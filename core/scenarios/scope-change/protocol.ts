import { allowedActionsFor, type AgentAction, type TurnKind, type ClarifyTopicDecl, type HumanReasonKeyDecl, type ProtocolDecl, type RelaxEntry, type RoleDecl, type ErrorCode } from '../../engine';
import { SCENARIO_KEY } from './constants';

export const SCOPE_CHANGE_ID = {
  key: SCENARIO_KEY,
  version: 1,
} as const;

export type ScopeChangeRole = 'customer' | 'provider' | 'finance';

export const SCOPE_CHANGE_ROLES: readonly RoleDecl[] = [
  { role: 'customer', label: 'Customer', side: 'buyer', approvalKind: 'terms' },
  { role: 'provider', label: 'Service provider', side: 'seller', approvalKind: 'terms' },
  { role: 'finance', label: 'Finance', side: 'buyer', approvalKind: 'budget', budgetOwner: true },
] as const;

export type ScopeChangeTopicKey = 'item_required' | 'deadline_value' | 'budget_room';

export interface ScopeChangeTopicDecl extends ClarifyTopicDecl {
  readonly topicKey: ScopeChangeTopicKey;
  readonly toRole: ScopeChangeRole;
  readonly askableBy: readonly ScopeChangeRole[];
  readonly field: 'requiredItemKeys' | 'deadline' | 'headroomCents';
  readonly answer: 'human';
  readonly questionTemplateKey:
    | 'request.clarify.item_required'
    | 'request.clarify.deadline_value'
    | 'request.clarify.budget_room';
}

export const SCOPE_CHANGE_TOPICS: readonly ScopeChangeTopicDecl[] = [
  {
    topicKey: 'item_required',
    toRole: 'customer',
    askableBy: ['provider', 'finance'],
    field: 'requiredItemKeys',
    answer: 'human',
    questionTemplateKey: 'request.clarify.item_required',
  },
  {
    topicKey: 'deadline_value',
    toRole: 'customer',
    askableBy: ['provider', 'finance'],
    field: 'deadline',
    answer: 'human',
    questionTemplateKey: 'request.clarify.deadline_value',
  },
  {
    topicKey: 'budget_room',
    toRole: 'finance',
    askableBy: ['customer'],
    field: 'headroomCents',
    answer: 'human',
    questionTemplateKey: 'request.clarify.budget_room',
  },
] as const;

export type ScopeChangeAgentReasonKey =
  | 'cannot_deliver'
  | 'missing_required_item'
  | 'after_deadline'
  | 'preference_not_met'
  | 'over_budget'
  | 'price_too_high';

export type ScopeChangeHumanReasonKey =
  | 'terms_not_acceptable'
  | 'scope_insufficient'
  | 'needs_earlier_delivery'
  | 'other'
  | 'over_our_limit';

export type ScopeChangeReasonKey = ScopeChangeAgentReasonKey | ScopeChangeHumanReasonKey;

export interface ScopeChangeReasonKeyDecl {
  readonly reasonKey: ScopeChangeAgentReasonKey;
  readonly usableBy: readonly ScopeChangeRole[];
}

export const SCOPE_CHANGE_REASON_KEYS: readonly ScopeChangeReasonKeyDecl[] = [
  { reasonKey: 'cannot_deliver', usableBy: ['provider'] },
  { reasonKey: 'missing_required_item', usableBy: ['customer'] },
  { reasonKey: 'after_deadline', usableBy: ['customer'] },
  { reasonKey: 'preference_not_met', usableBy: ['customer'] },
  { reasonKey: 'over_budget', usableBy: ['finance'] },
  { reasonKey: 'price_too_high', usableBy: ['finance', 'customer'] },
] as const;

export interface ScopeChangeHumanReasonKeyDecl extends HumanReasonKeyDecl {
  readonly key: ScopeChangeHumanReasonKey;
  readonly audience: 'room' | 'buyers';
  readonly usableBy: readonly ScopeChangeRole[];
}

export const SCOPE_CHANGE_HUMAN_REASON_KEYS: readonly ScopeChangeHumanReasonKeyDecl[] = [
  { key: 'terms_not_acceptable', audience: 'room', usableBy: ['customer', 'provider', 'finance'] },
  { key: 'scope_insufficient', audience: 'room', usableBy: ['customer', 'provider', 'finance'] },
  { key: 'needs_earlier_delivery', audience: 'room', usableBy: ['customer', 'provider', 'finance'] },
  { key: 'other', audience: 'room', usableBy: ['customer', 'provider', 'finance'] },
  { key: 'over_our_limit', audience: 'buyers', usableBy: ['finance'] },
] as const;

/**
 * Static English role charters (14 §3.5).
 * Must contain zero digits and zero private values.
 */
export const SCOPE_CHANGE_ROLE_CHARTERS: Readonly<Record<ScopeChangeRole, string>> = Object.freeze({
  customer:
    'Represent the buyer scope and delivery priorities. Evaluate whether the current proposal includes every required item and meets the delivery deadline, prefer wishlist items when feasible, counter with a better candidate from the snapshot when allowed, or escalate when no candidate satisfies requirements.',
  provider:
    'Represent the service provider catalog and delivery schedule. Propose a candidate package from the current snapshot that covers known required items and disclosed preferences at the lowest feasible price and delivery lead time, or escalate when no deliverable candidate exists.',
  finance:
    'Represent buyer budget governance. Evaluate whether the current proposal fits within the budget cap above committed spend, recommend acceptance when all checks pass, or reject when the proposal exceeds the budget cap.',
});

export const SCOPE_CHANGE_PROTOCOL: ProtocolDecl = Object.freeze({
  proposerRole: 'provider',
  evaluatorOrder: ['customer', 'finance'],
  counterRoles: ['customer'],
  maxRounds: 3,
  maxCandidates: 12,
  maxProposalsPerRolePerRun: 4,
  tradeoffOwner: 'customer',
  topics: SCOPE_CHANGE_TOPICS.map(({ topicKey, toRole, askableBy, field, answer, questionTemplateKey }) => ({
    topicKey,
    toRole,
    askableBy: [...askableBy],
    field,
    answer,
    questionTemplateKey,
  })),
  reasonKeys: [...SCOPE_CHANGE_REASON_KEYS, ...SCOPE_CHANGE_HUMAN_REASON_KEYS.map(({ key }) => ({ reasonKey: key, usableBy: ['human'] }))].map(({ reasonKey, usableBy }) => ({
    reasonKey,
    usableBy: [...usableBy],
  })),
  roleCharters: SCOPE_CHANGE_ROLE_CHARTERS,
});

export const SCOPE_CHANGE_RELAXATION_ORDER: readonly RelaxEntry[] = [
  'customer.drop_items',
  'finance.raise_cap',
] as const;

export type ValidationOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: ErrorCode | 'item.limit_exceeded' | 'approval.not_executable';
      readonly params?: Readonly<Record<string, unknown>>;
    };

/**
 * Validate a `clarify` action against the `scope_change` topic matrix (05 §5.9, 14 §3.3).
 * Takes `{ fromRole?, toRole, topicKey, rationale? }` (no `itemKey` parameter).
 */
export function validateClarifyTopic(args: {
  readonly fromRole?: string;
  readonly toRole: string;
  readonly topicKey: string;
  readonly rationale?: string;
  readonly [extraKey: string]: unknown;
}): ValidationOutcome {
  if ('itemKey' in args && args.itemKey !== undefined) {
    return {
      ok: false,
      code: 'output.schema_violation',
      params: { path: 'itemKey' },
    };
  }
  const topic = SCOPE_CHANGE_TOPICS.find((t) => t.topicKey === args.topicKey);
  if (!topic) {
    return {
      ok: false,
      code: 'output.unknown_reference',
      params: { field: 'topicKey', value: args.topicKey },
    };
  }
  if (
    topic.toRole !== args.toRole ||
    (args.fromRole !== undefined && !topic.askableBy.includes(args.fromRole as ScopeChangeRole))
  ) {
    return {
      ok: false,
      code: 'action.not_allowed_for_role',
      params: { fromRole: args.fromRole, toRole: args.toRole, topicKey: args.topicKey },
    };
  }
  if (args.rationale !== undefined && typeof args.rationale !== 'string') {
    return {
      ok: false,
      code: 'output.schema_violation',
      params: { path: 'rationale' },
    };
  }
  return { ok: true };
}

/**
 * Validate a human rejection `reasonKey` at `approvals.record` (14 §3.4, 12 §12.4):
 * - Unknown `reasonKey` -> `input.invalid { field: 'reasonKey' }`
 * - Disallowed role -> `auth.role_forbidden`
 */
export function validateHumanReasonKey(args: {
  readonly role: ScopeChangeRole | 'human' | string;
  readonly reasonKey: unknown;
}): ValidationOutcome {
  if (typeof args.reasonKey !== 'string') {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'reasonKey' },
    };
  }
  const decl = SCOPE_CHANGE_HUMAN_REASON_KEYS.find((r) => r.key === args.reasonKey);
  if (!decl) {
    return {
      ok: false,
      code: 'input.invalid',
      params: { field: 'reasonKey', value: args.reasonKey },
    };
  }
  if (args.role !== 'human' && !decl.usableBy.includes(args.role as ScopeChangeRole)) {
    return {
      ok: false,
      code: 'auth.role_forbidden',
      params: { role: args.role, reasonKey: args.reasonKey },
    };
  }
  return { ok: true };
}

/**
 * Validate an agent `reject` or human approval rejection `reasonKey` against 14 §3.4.
 */
export function validateReasonKey(args: {
  readonly actor: ScopeChangeRole | 'human';
  readonly reasonKey: string;
  readonly kind?: 'agent' | 'human';
}): ValidationOutcome {
  if (args.kind === 'human' || args.actor === 'human') {
    return validateHumanReasonKey({ role: args.actor, reasonKey: args.reasonKey });
  }
  const decl = SCOPE_CHANGE_REASON_KEYS.find((r) => r.reasonKey === args.reasonKey);
  if (!decl) {
    const humanDecl = SCOPE_CHANGE_HUMAN_REASON_KEYS.find((r) => r.key === args.reasonKey);
    if (humanDecl) {
      return {
        ok: false,
        code: 'action.not_allowed_for_role',
        params: { actor: args.actor, reasonKey: args.reasonKey },
      };
    }
    return {
      ok: false,
      code: 'output.unknown_reference',
      params: { field: 'reasonKey', value: args.reasonKey },
    };
  }
  if (!decl.usableBy.includes(args.actor)) {
    return {
      ok: false,
      code: 'action.not_allowed_for_role',
      params: { actor: args.actor, reasonKey: args.reasonKey },
    };
  }
  return { ok: true };
}

/**
 * Compute the allowed agent actions for `(role, turnKind, snapshotCount)` in `scope_change`
 * (05 §5.3.2, 14 §3.2).
 */
export function allowedActionsForTurn(
  role: ScopeChangeRole,
  turnKind: TurnKind,
  snapshotCount: number,
): readonly AgentAction[] {
  const base = allowedActionsFor(role, turnKind);
  return base.filter((action) => {
    if (action === 'propose' && snapshotCount <= 0) return false;
    if (
      action === 'counter' &&
      (snapshotCount <= 0 || !SCOPE_CHANGE_PROTOCOL.counterRoles.includes(role))
    ) {
      return false;
    }
    return true;
  });
}
