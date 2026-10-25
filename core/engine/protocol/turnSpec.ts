import { allowedActions, type ActionCtx } from './allowedActions';
import { ROLES, type ModelAction, type Role, type TurnKind } from '../actions';

/**
 * TurnSpec and protocol version contract (05 §5.3–5.5, canon D09).
 *
 * Pure TypeScript: zero runtime dependencies.
 */

export const PROTOCOL_VERSION = 1 as const;

export const OPTION_KEY_RE = /^O([1-9]|1[0-2])$/;

export const RATIONALE_MAX_CODEPOINTS = 1_200 as const;

export const ESCALATION_KINDS = ['infeasible', 'needs_tradeoff'] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

/**
 * Closed whitelist of property names that may appear in `{ turn }` output schemas
 * and sanitized `attempts.issuePaths` (05 §5.4.3 & §5.6.1 step 7).
 */
export const ALLOWED_PROPS: ReadonlySet<string> = new Set<string>([
  'turn',
  'action',
  'optionKey',
  'baseProposalVersion',
  'proposalVersion',
  'reasonKey',
  'toRole',
  'topicKey',
  'kind',
  'rationale',
]);

export type AgentProposeTurn = {
  readonly action: 'propose';
  readonly optionKey: string;
  readonly rationale: string;
};

export type AgentCounterTurn = {
  readonly action: 'counter';
  readonly baseProposalVersion: number;
  readonly optionKey: string;
  readonly rationale: string;
};

export type AgentRecommendAcceptTurn = {
  readonly action: 'recommend_accept';
  readonly proposalVersion: number;
  readonly rationale: string;
};

export type AgentRejectTurn = {
  readonly action: 'reject';
  readonly proposalVersion: number | null;
  readonly reasonKey: string;
  readonly rationale: string;
};

export type AgentClarifyTurn = {
  readonly action: 'clarify';
  readonly toRole: string;
  readonly topicKey: string;
  readonly rationale: string;
};

export type AgentEscalateTurn = {
  readonly action: 'escalate';
  readonly kind: EscalationKind;
  readonly toRole: string;
  readonly rationale: string;
};

export type AgentTurn =
  | AgentProposeTurn
  | AgentCounterTurn
  | AgentRecommendAcceptTurn
  | AgentRejectTurn
  | AgentClarifyTurn
  | AgentEscalateTurn;

export type AgentTurnEnvelope = {
  readonly turn: AgentTurn;
};

export type ClarifyTargetSpec = {
  readonly toRole: string;
  readonly topicKeys: readonly string[];
};

export type TurnSpec = {
  readonly role: Role;
  readonly turnKind: TurnKind;
  readonly allowedActions: readonly ModelAction[];
  /** `['O1', ..., 'On']`, `0 <= n <= 12`. */
  readonly optionKeys: readonly string[];
  readonly scenarioKey?: string;
  readonly scenarioVersion?: number;
  readonly escalationRoles?: readonly string[];
  /** Filtered by `usableBy.includes(role) && usableBy.includes('agent')`. */
  readonly reasonKeys: readonly string[];
  /** Filtered by `askableBy.includes(role)` and undisclosed fields; never includes `'option_fits_constraints'`. */
  readonly clarifyTargets: readonly ClarifyTargetSpec[];
};

export type TurnActionCtx = {
  readonly snapshotLen: number;
  readonly proposalCount: number;
  readonly maxProposalsPerRole: number;
  readonly clarifyTargetCount: number;
  readonly providerRejectLocked?: boolean;
  readonly clarifyUsed?: boolean;
  readonly escalateUsed?: boolean;
};

export function makeOptionKeys(n: number): readonly string[] {
  if (!Number.isSafeInteger(n) || n < 0 || n > 12) {
    throw new RangeError(`Snapshot option count n must be in 0..12 (got ${String(n)})`);
  }
  return Array.from({ length: n }, (_, i) => `O${i + 1}`);
}

/** Delegate all action policy to the canonical run-aware filter. */
export function computeTurnAllowedActions(
  role: Role,
  turnKind: TurnKind,
  ctx: ActionCtx | TurnActionCtx,
): readonly ModelAction[] {
  if ('snapshotSize' in ctx) return allowedActions(role, turnKind, ctx);
  // Compatibility for callers using TurnActionCtx; the runner supplies canonical ActionCtx.
  const count = ctx.proposalCount >= Math.min(ctx.maxProposalsPerRole, 4) ? 4 : ctx.proposalCount;
  return allowedActions(role, turnKind, {
    snapshotSize: ctx.snapshotLen,
    proposeCountInRun: count,
    counterCountInRun: count,
    clarifyUsedInRun: ctx.clarifyUsed ?? false,
    escalateUsedInRun: ctx.escalateUsed ?? false,
    providerRejectLocked: ctx.providerRejectLocked ?? false,
    topicKeys: Array.from({ length: ctx.clarifyTargetCount }, () => 'available'),
  });
}

export type BuildTurnSpecInput = {
  readonly role: Role;
  readonly turnKind: TurnKind;
  readonly optionCount?: number;
  readonly optionKeys?: readonly string[];
  /** Legacy caller compatibility; never stored in TurnSpec. */
  readonly currentProposalVersion?: number;
  readonly scenarioKey?: string;
  readonly scenarioVersion?: number;
  readonly escalationRoles?: readonly string[];
  readonly providerRejectLocked?: boolean;
  readonly clarifyUsed?: boolean;
  readonly escalateUsed?: boolean;
  readonly proposalCount?: number;
  readonly maxProposalsPerRole?: number;
  readonly reasonKeys?: readonly string[];
  readonly clarifyTargets?: readonly ClarifyTargetSpec[];
  readonly allowedActions?: readonly ModelAction[];
};

export function buildTurnSpec(input: BuildTurnSpecInput): TurnSpec {
  const optionKeys =
    input.optionKeys ?? makeOptionKeys(input.optionCount ?? 0);
  const rawTargets =
    input.clarifyTargets ?? [];
  // Enforce D12 ③: option_fits_constraints is never askable by any role.
  const clarifyTargets = rawTargets
    .map((t) => ({
      toRole: t.toRole,
      topicKeys: t.topicKeys.filter((k) => k !== 'option_fits_constraints'),
    }))
    .filter((t) => t.toRole !== input.role && t.topicKeys.length > 0);
  const clarifyTargetCount = clarifyTargets.reduce(
    (sum, t) => sum + t.topicKeys.length,
    0,
  );
  const reasonKeys =
    input.reasonKeys ?? [];
  const allowedActions =
    input.allowedActions ??
    computeTurnAllowedActions(input.role, input.turnKind, {
      snapshotLen: optionKeys.length,
      proposalCount: input.proposalCount ?? 0,
      maxProposalsPerRole: input.maxProposalsPerRole ?? 4,
      clarifyTargetCount,
      providerRejectLocked: input.providerRejectLocked,
      clarifyUsed: input.clarifyUsed,
      escalateUsed: input.escalateUsed,
    });

  return {
    role: input.role,
    turnKind: input.turnKind,
    allowedActions,
    optionKeys,
    scenarioKey: input.scenarioKey ?? 'scope_change',
    scenarioVersion: input.scenarioVersion ?? 1,
    escalationRoles: input.escalationRoles ?? ROLES,
    reasonKeys,
    clarifyTargets,
  };
}

/**
 * Canonical cache key and `attempts.schemaVersion` identifier (05 §5.5).
 */
export function turnSpecKey(s: TurnSpec): string {
  return `p${PROTOCOL_VERSION}:${s.scenarioKey ?? 'scope_change'}@${s.scenarioVersion ?? 1}:${s.role}:${s.turnKind}:n${s.optionKeys.length}:${[...s.allowedActions].sort().join(',')}`;
}

/**
 * Lists the 25 "all actions" `TurnSpec` variants pre-warmed by `ops.warmSchemas` (05 §5.5):
 * - `(provider, propose)` with `n = 1..12` (12 variants)
 * - `(customer, evaluate)` with `n = 0..11` (12 variants)
 * - `(finance, evaluate)` with `n = 0` (1 variant)
 * Total: 25 variants.
 */
export type TurnSpecDomains = Readonly<Partial<Record<Role, Pick<BuildTurnSpecInput, 'reasonKeys' | 'clarifyTargets' | 'scenarioKey' | 'scenarioVersion' | 'escalationRoles'>>>>;

export function listWarmTurnSpecs(domains: TurnSpecDomains = {}): readonly TurnSpec[] {
  const out: TurnSpec[] = [];
  for (let n = 1; n <= 12; n++) {
    out.push(
      buildTurnSpec({
        ...domains.provider,
        role: 'provider',
        turnKind: 'propose',
        optionCount: n,
      }),
    );
  }
  for (let n = 0; n <= 11; n++) {
    out.push(
      buildTurnSpec({
        ...domains.customer,
        role: 'customer',
        turnKind: 'evaluate',
        optionCount: n,
        currentProposalVersion: 1,
      }),
    );
  }
  out.push(
    buildTurnSpec({
      ...domains.finance,
        role: 'finance',
      turnKind: 'evaluate',
      optionCount: 0,
      currentProposalVersion: 1,
    }),
  );
  return out;
}

/**
 * Lists every `(role, turnKind, n, allowedActions)` `TurnSpec` variant (05 §5.5, <= 152):
 * - `(provider, propose)`: `n = 1..12` × 4 action subsets = 48
 * - `(customer, evaluate)`: `n = 0` × 4 action subsets + `n = 1..11` × 8 action subsets = 92
 * - `(finance, evaluate)`: `n = 0..2` × 4 action subsets = 12
 * Total: 48 + 92 + 12 = 152 variants.
 */
export function listAllTurnSpecVariants(domains: TurnSpecDomains): readonly TurnSpec[] {
  const out: TurnSpec[] = [];

  const providerActionSubsets: readonly (readonly ModelAction[])[] = [
    ['propose', 'clarify', 'reject', 'escalate'],
    ['propose', 'reject', 'escalate'],
    ['clarify', 'reject', 'escalate'],
    ['reject', 'escalate'],
  ];
  for (let n = 1; n <= 12; n++) {
    for (const actions of providerActionSubsets) {
      out.push(
        buildTurnSpec({
          ...domains.provider,
          role: 'provider',
          turnKind: 'propose',
          optionCount: n,
          allowedActions: actions,
          clarifyTargets: actions.includes('clarify')
            ? domains.provider?.clarifyTargets ?? []
            : [],
        }),
      );
    }
  }

  const evalBaseSubsets: readonly (readonly ModelAction[])[] = [
    ['clarify', 'recommend_accept', 'reject', 'escalate'],
    ['recommend_accept', 'reject', 'escalate'],
    ['clarify', 'reject', 'escalate'],
    ['reject', 'escalate'],
  ];

  // customer, evaluate: n = 0 (4 subsets without counter) + n = 1..11 (8 subsets: with/without counter) = 92
  for (const actions of evalBaseSubsets) {
    out.push(
      buildTurnSpec({
        ...domains.customer,
          role: 'customer',
        turnKind: 'evaluate',
        optionCount: 0,
        currentProposalVersion: 1,
        allowedActions: actions,
        clarifyTargets: actions.includes('clarify')
          ? domains.customer?.clarifyTargets ?? []
          : [],
      }),
    );
  }
  for (let n = 1; n <= 11; n++) {
    for (const baseActions of evalBaseSubsets) {
      for (const withCounter of [true, false]) {
        const actions: readonly ModelAction[] = withCounter
          ? ['counter', ...baseActions]
          : baseActions;
        out.push(
          buildTurnSpec({
            ...domains.customer,
          role: 'customer',
            turnKind: 'evaluate',
            optionCount: n,
            currentProposalVersion: 1,
            allowedActions: actions,
            clarifyTargets: actions.includes('clarify')
              ? domains.customer?.clarifyTargets ?? []
              : [],
          }),
        );
      }
    }
  }

  // finance, evaluate: n = 0..2 × 4 subsets = 12
  for (let n = 0; n <= 2; n++) {
    for (const actions of evalBaseSubsets) {
      out.push(
        buildTurnSpec({
          ...domains.finance,
          role: 'finance',
          turnKind: 'evaluate',
          optionCount: n,
          currentProposalVersion: 1,
          allowedActions: actions,
          clarifyTargets: actions.includes('clarify')
            ? domains.finance?.clarifyTargets ?? []
            : [],
        }),
      );
    }
  }

  return out;
}
