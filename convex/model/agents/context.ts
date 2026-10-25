import { scopeChangePlugin } from '../../../core/scenarios/scope-change';
import type { MemberCtx } from '../../lib/functions';
import { scenarioOf } from '../../scenarios/registry';
import { currentCatalog } from '../common';
import { mineView } from '../views/briefView';
import { toRoomView } from '../views/roomView';
import {
  type AgentTurnInput,
  type AgentView,
  buildAgentContext,
  buildTurnSpec,
  type ClarifyTargetSpec,
  computeTurnAllowedActions,
  isProjected,
  type ModelAction,
  pickExact,
  type Projected,
  privacy,
  type ReasonCode,
  type Role,
  type SnapshotItem,
  type TurnKind,
  type TurnSpec,
} from '../../../core/engine';

const { projectForRole, projectSharedFacts, projectRequestOptions, ROLES } =
  privacy;
type CheckResult = privacy.CheckResult;
type Disclosures = privacy.Disclosures;
type SharedFact = privacy.SharedFact;

/**
 * Pure agent context assembly (`assembleAgentTurnInput`) over the documents loaded
 * by `loadTurnContext` (07 §7.14, 05 §5.12, INV-03, TC-PRIV-04).
 *
 * Every input document is projected exclusively through W1-4F's `projectForRole` /
 * `projectSharedFacts` / `pickExact` and `buildAgentContext`.
 */

export type LoadedRoomDoc = {
  readonly _id?: string;
  readonly id?: string;
  readonly status?: 'setup' | 'open' | 'executed' | 'closed';
  readonly constraintsVersion: number;
  readonly localDate: string;
  readonly timeZone?: string;
  readonly scenarioKey?: string;
  readonly scenarioVersion?: number;
  readonly [key: string]: unknown;
};

export type LoadedRunDoc = {
  readonly _id?: string;
  readonly id?: string;
  readonly status?: string;
  readonly roundNo: number;
  readonly maxRounds: number;
  readonly [key: string]: unknown;
};

export type LoadedTurnDoc = {
  readonly _id?: string;
  readonly id?: string;
  readonly role: Role;
  readonly turnSeq?: number;
  readonly roundNo?: number;
  readonly kind: TurnKind;
  readonly status?: string;
  readonly constraintsVersion?: number;
  readonly candidateSnapshot: readonly SnapshotItem[];
  readonly allowedActions?: readonly ModelAction[];
  readonly baseProposalId?: string;
  readonly baseProposalVersion?: number;
  readonly retryNote?: ReasonCode;
  readonly [key: string]: unknown;
};

export type LoadedBriefDoc = {
  readonly role: Role;
  readonly version?: number;
  readonly confirmed?: boolean;
  readonly confirmedAt?: number;
  readonly ownApprovalNotes?: readonly string[];
  readonly hardFields?: Readonly<Record<string, unknown>>;
  readonly softFields?: Readonly<Record<string, unknown>>;
  readonly disclosures?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
};

export type LoadedCatalogItemDoc = {
  readonly itemKey: string;
  readonly revision?: number;
  readonly editNo?: number;
  readonly kind: 'item' | 'modifier';
  readonly title: string;
  readonly priceCents: number;
  readonly leadDays: number;
  readonly status: 'draft' | 'confirmed' | 'retired' | string;
};

export type LoadedProposalDoc = {
  readonly _id?: string;
  readonly id?: string;
  readonly version: number;
  readonly authorRole?: Role;
  readonly origin?: 'agent' | 'human_choice';
  readonly status: 'active' | 'superseded' | 'rejected' | 'executed' | string;
  readonly terms: {
    readonly itemKeys: readonly string[];
    readonly modifiers?: readonly string[];
    readonly amountCents: number;
    readonly deliveryDate: string;
  };
  readonly checks?: readonly CheckResult[];
  readonly fit?: 'ok' | 'blocked';
  readonly [key: string]: unknown;
};

export type LoadedHumanRequestDoc = {
  readonly _id?: string;
  readonly id?: string;
  readonly toRole: Role;
  readonly kind: string;
  readonly status: 'open' | 'answered' | 'superseded' | 'expired' | string;
  readonly questionKey?: string;
  readonly options?: readonly {
    readonly optionKey: string;
    readonly templateKey: string;
    readonly effect?: { readonly type?: string; readonly kind?: string; readonly [k: string]: unknown };
  }[];
  readonly [key: string]: unknown;
};

export type LoadedLedgerEntryDoc = {
  readonly kind: 'baseline' | 'commit' | string;
  readonly amountCents: number;
  readonly [key: string]: unknown;
};

export type LoadedProviderFeedback =
  | { readonly fit: 'blocked'; readonly [key: string]: unknown }
  | {
      readonly kind: 'not_accepted';
      readonly counter?: {
        readonly optionKey: string;
        readonly itemKeys: readonly string[];
        readonly modifiers: readonly string[];
        readonly amountCents: number;
        readonly deliveryDate: string;
        readonly [key: string]: unknown;
      };
      readonly [key: string]: unknown;
    }
  | {
      readonly proposalVersion: number;
      readonly outcome: 'blocked' | 'not_accepted' | 'countered' | 'pending_approval';
      readonly [key: string]: unknown;
    };

export type TurnContextDocs = {
  readonly room: LoadedRoomDoc;
  readonly run: LoadedRunDoc;
  readonly turn: LoadedTurnDoc;
  /** Either the acting role's own brief or all room briefs (other roles' briefs are dropped). */
  readonly brief?: LoadedBriefDoc | null;
  readonly briefs?: readonly LoadedBriefDoc[];
  readonly sharedFacts?: readonly SharedFact[];
  readonly budget?: Readonly<Record<string, unknown>> | null;
  readonly ledgerEntries?: readonly LoadedLedgerEntryDoc[];
  readonly catalogItems: readonly LoadedCatalogItemDoc[];
  readonly currentProposal?: LoadedProposalDoc | null;
  readonly proposals?: readonly LoadedProposalDoc[];
  readonly humanRequests?: readonly LoadedHumanRequestDoc[];
  readonly openRequestForMe?: LoadedHumanRequestDoc | null;
  readonly feedback?: LoadedProviderFeedback | null;
  // Runner supplies persisted per-run consumed actions.
  readonly providerRejectLocked?: boolean;
  readonly clarifyUsed?: boolean;
  readonly escalateUsed?: boolean;
  readonly proposalCounts?: Readonly<Record<string, number>>;
  readonly maxProposalsPerRole?: number;
  readonly retryNote?: ReasonCode;
  readonly turnSalt?: string;
  readonly plugin?: typeof scopeChangePlugin;
  /** W2-1 per-role loader output; never raw shared-fact storage rows. */
  readonly roleView?: Awaited<ReturnType<typeof toRoomView>>;
};

const pickDynamic = pickExact as unknown as <T extends object>(
  source: T,
  keys: readonly string[],
) => Projected<T>;

function projectPlainObject<T extends Record<string, unknown>>(obj: T): Projected<T> {
  if (isProjected(obj)) return obj;
  return pickDynamic(obj, Object.keys(obj));
}

function resolveClarifyTargetsForRole(
  role: Role,
  projectedSharedFacts: readonly Projected<Record<string, unknown>>[],
  plugin: typeof scopeChangePlugin,
): readonly ClarifyTargetSpec[] {
  const disclosedKeys = new Set(projectedSharedFacts.map(f => `${String(f.fromRole)}:${String(f.field)}`));
  return plugin.protocol.topics
    .filter(t => t.askableBy.includes(role) && t.toRole !== role && t.topicKey !== 'option_fits_constraints' && !disclosedKeys.has(`${t.toRole}:${t.field}`))
    .map(t => ({ toRole: t.toRole, topicKeys: [t.topicKey] }));
}

/**
 * W2-4 scheduling seam: the runner supplies persisted run/turn/request metadata.
 * Scheduling and run-derived counts are supplied by the integrated runner.
 * W2-1 constructors supply the authorized MemberCtx; these reads never open a RoomTx.
 */
export async function loadTurnContext(
  ctx: MemberCtx,
  turnContext: Pick<TurnContextDocs, 'run' | 'turn' | 'currentProposal' | 'proposals' | 'humanRequests' | 'openRequestForMe' | 'feedback' | 'proposalCounts' | 'maxProposalsPerRole' | 'providerRejectLocked' | 'clarifyUsed' | 'escalateUsed' | 'retryNote' | 'turnSalt'>,
) {
  if (turnContext.turn.role !== ctx.member.role) throw new TypeError('Turn role must match the loaded role view');
  const [own, roleView] = await Promise.all([mineView(ctx), toRoomView(ctx)]);
  return assembleAgentTurnInput({
    ...turnContext,
    room: ctx.room,
    brief: own.latest ? { role: own.role, ...own.latest, confirmed: true } : null,
    catalogItems: roleView.catalog.map(row => ({ ...row, status: 'confirmed' as const })),
    roleView,
    plugin: scenarioOf(ctx.room),
  });
}

/**
 * Purely assembles `AgentTurnInput` and `TurnSpec` for `docs.turn.role` from the documents
 * loaded by `loadTurnContext` (07 §7.14.1, 05 §5.12).
 */
export function assembleAgentTurnInput(docs: TurnContextDocs): AgentTurnInput & {
  readonly spec: TurnSpec;
  readonly agentContext: ReturnType<typeof buildAgentContext>;
} {
  const role = docs.turn.role;
  if (!ROLES.includes(role)) {
    throw new TypeError(`Invalid turn role: ${String(role)}`);
  }

  const plugin = docs.plugin ?? scopeChangePlugin;
  if (docs.roleView && docs.roleView.header.viewingAs !== role) throw new TypeError('Agent view role mismatch');
  const roundNo = docs.turn.roundNo ?? docs.run.roundNo;
  const maxRounds = docs.run.maxRounds;
  const turnKind = docs.turn.kind;

  // 1. Own brief only — never read other parties' briefs or disclosures switches!
  const ownBriefRaw: LoadedBriefDoc | undefined =
    docs.brief && docs.brief.role === role
      ? docs.brief
      : docs.briefs?.find((b) => b.role === role);

  const rawHard = (ownBriefRaw?.hardFields ?? {}) as Record<string, unknown>;
  const rawSoft = (ownBriefRaw?.softFields ?? {}) as Record<string, unknown>;

  const allowedHardKeys = plugin.fields.filter(f => f.owner === role && f.class === 'hard').map(f => f.key);
  const projectedHard = pickDynamic(
    rawHard,
    allowedHardKeys.filter((k) => k in rawHard),
  );

  const allowedSoftKeys = plugin.fields.filter(f => f.owner === role && f.class === 'soft').map(f => f.key);
  const projectedSoft = pickDynamic(
    rawSoft,
    allowedSoftKeys.filter((k) => k in rawSoft),
  );

  const ownNotes =
    typeof rawSoft.notes === 'string' && rawSoft.notes.length > 0
      ? rawSoft.notes
      : undefined;

  const customerRequiredItems =
    role === 'customer' && Array.isArray(rawHard.requiredItemKeys)
      ? (rawHard.requiredItemKeys as readonly string[])
      : undefined;

  const disclosures: Disclosures = {
    plugin,
    sharedFacts: docs.sharedFacts ?? [],
    roomStatus: docs.room.status ?? 'open',
    ...(customerRequiredItems !== undefined
      ? { requiredItemKeys: customerRequiredItems }
      : {}),
  };

  const projectedOwnBrief = ownBriefRaw
    ? projectForRole(
        role,
        {
          family: 'briefs',
          data: {
            role,
            version: ownBriefRaw.version ?? 1,
            confirmed: ownBriefRaw.confirmed ?? true,
            hardFields: projectedHard as AgentTurnInput['principal']['hardFields'],
            softFields: projectedSoft as AgentTurnInput['principal']['softFields'],
          },
        },
        disclosures,
      )
    : undefined;

  // 2. Shared facts projected through W1-4F's projectSharedFacts
  const projectedSharedFacts = docs.roleView
    ? docs.roleView.sharedFacts.map(f => pickDynamic(f, ['fromRole', 'field', 'value', 'asOfBriefVersion']))
    : projectSharedFacts(role, docs.sharedFacts ?? [], undefined, plugin);

  // 3. Clarify targets & allowedActions
  const clarifyTargets = resolveClarifyTargetsForRole(
    role,
    projectedSharedFacts,
    plugin,
  );
  const clarifyTopics = [
    ...new Set(clarifyTargets.flatMap((t) => t.topicKeys)),
  ].filter((k) => k !== 'option_fits_constraints');

  const snapshotItems = docs.turn.candidateSnapshot ?? [];
  const proposalCount = docs.proposalCounts?.[role] ?? 0;
  const maxProposalsPerRole = docs.maxProposalsPerRole ?? 4;
  const clarifyTargetCount = clarifyTargets.reduce(
    (sum, t) => sum + t.topicKeys.length,
    0,
  );

  const allowedActions =
    docs.turn.allowedActions ??
    computeTurnAllowedActions(role, turnKind, {
      snapshotLen: snapshotItems.length,
      proposalCount,
      maxProposalsPerRole,
      clarifyTargetCount,
      providerRejectLocked: docs.providerRejectLocked,
      clarifyUsed: docs.clarifyUsed,
      escalateUsed: docs.escalateUsed,
    });

  // 4. Budget projected through W1-4F's projectForRole('budget')
  // Note: for customer, projectForRole('customer', { family: 'budget', ... }) reads ONLY sharedFacts;
  // for provider, projectForRole('provider', { family: 'budget', ... }) returns undefined.
  let rawBudgetData: Record<string, unknown> = {};
  if (role === 'finance') {
    const capCents =
      typeof rawHard.capCents === 'number'
        ? rawHard.capCents
        : typeof docs.budget?.capCents === 'number'
          ? docs.budget.capCents
          : undefined;
    const committedCents =
      typeof docs.budget?.committedCents === 'number'
        ? docs.budget.committedCents
        : docs.ledgerEntries
          ? docs.ledgerEntries
              .filter((e) => e.kind === 'baseline' || e.kind === 'commit')
              .reduce((sum, e) => sum + e.amountCents, 0)
          : undefined;
    const headroomCents =
      typeof docs.budget?.headroomCents === 'number'
        ? docs.budget.headroomCents
        : capCents !== undefined && committedCents !== undefined
          ? capCents - committedCents
          : undefined;
    rawBudgetData = {
      ...(capCents !== undefined ? { capCents } : {}),
      ...(committedCents !== undefined
        ? { committedCents, minAllowedCapCents: committedCents }
        : {}),
      ...(headroomCents !== undefined ? { headroomCents } : {}),
    };
  }
  const visibleBudget = docs.roleView?.budget;
  const projectedBudget = visibleBudget
    ? visibleBudget.visibility === 'none' ? undefined : projectPlainObject(Object.fromEntries(
      Object.entries(visibleBudget).filter(([key, value]) => ['capCents', 'committedCents', 'headroomCents'].includes(key) && typeof value === 'number'),
    ))
    : projectForRole(role, { family: 'budget', data: rawBudgetData }, disclosures);
  const nonEmptyBudget =
    projectedBudget && Object.keys(projectedBudget).length > 0
      ? projectedBudget
      : undefined;

  // 5. Confirmed catalog items projected through projectForRole('catalogItems')
  const confirmedCatalog = currentCatalog(docs.catalogItems.map(row => ({ ...row, revision: row.revision ?? 1, editNo: row.editNo ?? 0 })))
    .filter((item) => item.status === 'confirmed')
    .sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0))
    .map((item) => {
      const projected = projectForRole(
        role,
        {
          family: 'catalogItems',
          data: {
            itemKey: item.itemKey,
            revision: item.revision ?? 1,
            kind: item.kind,
            priceCents: item.priceCents,
            leadDays: item.leadDays,
            status: 'confirmed',
            title: item.title,
          },
        },
        disclosures,
      );
      return {
        itemKey: String(projected?.itemKey ?? item.itemKey),
        revision: Number(projected?.revision ?? item.revision ?? 1),
        kind: (projected?.kind ?? item.kind) as 'item' | 'modifier',
        priceCents: Number(projected?.priceCents ?? item.priceCents),
        leadDays: Number(projected?.leadDays ?? item.leadDays),
        title: item.title,
        status: 'confirmed',
      };
    });

  // 6. Current proposal & recentProposals projected through projectForRole('proposals')
  const allProposals = docs.proposals ?? [];
  const rawCurrentProposal =
    docs.currentProposal !== undefined
      ? docs.currentProposal
      : (allProposals.find(
          (p) =>
            (docs.turn.baseProposalId !== undefined &&
              (p._id === docs.turn.baseProposalId ||
                p.id === docs.turn.baseProposalId)) ||
            (docs.turn.baseProposalVersion !== undefined &&
              p.version === docs.turn.baseProposalVersion) ||
            p.status === 'active',
        ) ?? null);

  const projectProposalDoc = (
    p: LoadedProposalDoc,
    forceStatus?: string,
  ): Projected<Record<string, unknown>> => {
    const termsProjected = pickExact(
      {
        itemKeys: [...p.terms.itemKeys],
        modifiers: [...(p.terms.modifiers ?? [])],
        amountCents: p.terms.amountCents,
        deliveryDate: p.terms.deliveryDate,
      },
      ['itemKeys', 'modifiers', 'amountCents', 'deliveryDate'],
    );
    const data: Record<string, unknown> = {
      version: p.version,
      ...(p.authorRole !== undefined ? { authorRole: p.authorRole } : {}),
      ...(p.origin !== undefined ? { origin: p.origin } : {}),
      status: forceStatus ?? p.status,
      terms: termsProjected,
      ...(p.checks !== undefined ? { checks: p.checks } : {}),
      ...(p.fit !== undefined ? { fit: p.fit } : {}),
    };
    return projectForRole(role, { family: 'proposals', data }, disclosures)!;
  };

  const projectedCurrentProposal = rawCurrentProposal
    ? projectProposalDoc(rawCurrentProposal, 'active')
    : null;

  const projectedRecentProposals = allProposals
    .filter((p) => p !== rawCurrentProposal && p.version !== rawCurrentProposal?.version)
    .sort((a, b) => b.version - a.version)
    .slice(0, 5)
    .map((p) => {
      const projected = projectProposalDoc(p);
      return pickDynamic(
        {
          version: projected.version as number,
          status: projected.status as string,
          ...(projected.authorRole !== undefined
            ? { authorRole: projected.authorRole as string }
            : {}),
          ...(projected.origin !== undefined
            ? { origin: projected.origin as string }
            : {}),
          terms: projected.terms,
          itemKeys: [...p.terms.itemKeys],
          amountCents: p.terms.amountCents,
        },
        [
          'version',
          'status',
          ...(projected.authorRole !== undefined ? (['authorRole'] as const) : []),
          ...(projected.origin !== undefined ? (['origin'] as const) : []),
          'terms',
          'itemKeys',
          'amountCents',
        ],
      );
    });

  // 7. Candidates projected from turn.candidateSnapshot
  const projectedCandidates = snapshotItems.map((item) =>
    pickExact(
      {
        optionKey: item.optionKey,
        candidateKey: item.candidateKey,
        itemKeys: [...item.itemKeys],
        modifiers: [...item.modifiers],
        amountCents: item.amountCents,
        deliveryDate: item.deliveryDate,
      },
      [
        'optionKey',
        'candidateKey',
        'itemKeys',
        'modifiers',
        'amountCents',
        'deliveryDate',
      ],
    ),
  );

  // 8. Open humanRequest targeting this role only
  const rawOpenReq =
    docs.openRequestForMe !== undefined
      ? docs.openRequestForMe
      : (docs.humanRequests?.find(
          (r) => r.status === 'open' && r.toRole === role,
        ) ?? null);

  let projectedOpenReq: Projected<Record<string, unknown>> | null = null;
  if (rawOpenReq && rawOpenReq.status === 'open' && rawOpenReq.toRole === role) {
    const safeOptions = (rawOpenReq.options ?? []).map((o) => ({
      optionKey: o.optionKey,
      templateKey: o.templateKey,
      effect: { type: 'end_run' as const },
    }));
    const optionView = pickExact({ role }, ['role']);
    const projectedOpts = projectRequestOptions(
      role,
      safeOptions,
      optionView,
      plugin,
    );
    projectedOpenReq = projectForRole(
      role,
      {
        family: 'humanRequests',
        data: {
          toRole: role,
          kind: rawOpenReq.kind,
          status: 'open',
          ...(rawOpenReq.questionKey !== undefined
            ? { questionKey: rawOpenReq.questionKey }
            : {}),
          options: projectedOpts,
        },
      },
      disclosures,
    )!;
  }

  // 9. Build AgentView and pass through W1-4F's buildAgentContext
  const protocolProjected = projectPlainObject({
    scenarioKey: docs.room.scenarioKey ?? 'scope_change',
    scenarioVersion: docs.room.scenarioVersion ?? 1,
    role,
    turnKind,
    roundNo,
    maxRounds,
    constraintsVersion:
      docs.turn.constraintsVersion ?? docs.room.constraintsVersion,
    localDate: docs.room.localDate,
    allowedActions: [...allowedActions],
    clarifyTopics,
  });

  const principalProjected = projectPlainObject({
    briefVersion: projectedOwnBrief?.version ?? 1,
    hard: projectedHard as AgentTurnInput['principal']['hard'],
    soft: projectedSoft as AgentTurnInput['principal']['soft'],
    ...(ownNotes !== undefined ? { notes: ownNotes } : {}),
    ownApprovalNotes: ownBriefRaw?.ownApprovalNotes ?? [],
  });

  const legacyFeedback: AgentView['feedback'] =
    role === 'provider' && docs.feedback
      ? 'outcome' in docs.feedback && typeof docs.feedback.outcome === 'string'
        ? {
            proposalVersion: Number(docs.feedback.proposalVersion ?? 1),
            outcome: docs.feedback.outcome as
              | 'blocked'
              | 'not_accepted'
              | 'countered'
              | 'pending_approval',
          }
        : 'fit' in docs.feedback && docs.feedback.fit === 'blocked'
          ? { proposalVersion: 1, outcome: 'blocked' as const }
          : {
              proposalVersion: 1,
              outcome:
                'counter' in docs.feedback && docs.feedback.counter
                  ? ('countered' as const)
                  : ('not_accepted' as const),
            }
      : null;

  const agentView: AgentView = {
    role,
    protocol: protocolProjected,
    principal: principalProjected,
    sharedFacts: projectedSharedFacts,
    ...(nonEmptyBudget ? { budget: nonEmptyBudget } : {}),
    catalog: confirmedCatalog,
    currentProposal: projectedCurrentProposal,
    recentProposals: projectedRecentProposals,
    feedback: legacyFeedback,
    candidates: projectedCandidates,
    openRequestForMe: projectedOpenReq,
  };

  const agentContext = buildAgentContext(role, agentView, plugin);

  // 10. Project provider feedback per 05 §5.12 (only fit: 'blocked' or kind: 'not_accepted' + public counter)
  let projectedFeedback: Readonly<Record<string, unknown>> | null = null;
  if (role === 'provider' && docs.feedback) {
    if ('fit' in docs.feedback && docs.feedback.fit === 'blocked') {
      projectedFeedback = pickExact({ fit: 'blocked' as const }, ['fit']);
    } else if ('kind' in docs.feedback && docs.feedback.kind === 'not_accepted') {
      const rawCounter = docs.feedback.counter as
        | {
            readonly optionKey: string;
            readonly itemKeys: readonly string[];
            readonly modifiers: readonly string[];
            readonly amountCents: number;
            readonly deliveryDate: string;
          }
        | undefined;
      if (rawCounter && typeof rawCounter === 'object') {
        const cleanCounter = pickExact(
          {
            optionKey: String(rawCounter.optionKey),
            itemKeys: [...rawCounter.itemKeys],
            modifiers: [...rawCounter.modifiers],
            amountCents: Number(rawCounter.amountCents),
            deliveryDate: String(rawCounter.deliveryDate),
          },
          ['optionKey', 'itemKeys', 'modifiers', 'amountCents', 'deliveryDate'] as const,
        );
        projectedFeedback = pickExact(
          { kind: 'not_accepted' as const, counter: cleanCounter },
          ['kind', 'counter'] as const,
        );
      } else {
        projectedFeedback = pickExact({ kind: 'not_accepted' as const }, [
          'kind',
        ] as const);
      }
    } else if (agentContext.feedback) {
      projectedFeedback = agentContext.feedback as Projected<
        Record<string, unknown>
      >;
    }
  }

  const spec = buildTurnSpec({
    role,
    turnKind,
    optionKeys: snapshotItems.map((s) => s.optionKey),
    scenarioKey: docs.room.scenarioKey,
    scenarioVersion: docs.room.scenarioVersion,
    proposalCount,
    maxProposalsPerRole,
    reasonKeys: plugin.protocol.reasonKeys.filter(r => r.usableBy.includes(role)).map(r => r.reasonKey),
    clarifyTargets,
    allowedActions,
  });

  const retryNote = docs.retryNote ?? docs.turn.retryNote;
  const turnSalt =
    docs.turnSalt ??
    String(docs.turn._id ?? docs.turn.id ?? `turn_${docs.turn.turnSeq ?? 1}`);

  return Object.freeze({
    role,
    protocol: pickDynamic(
      {
        ...(agentContext.protocol as Record<string, unknown>),
        constraintsVersion:
          docs.turn.constraintsVersion ?? docs.room.constraintsVersion,
        localDate: docs.room.localDate,
      },
      [
        'scenarioKey',
        'scenarioVersion',
        'role',
        'turnKind',
        'roundNo',
        'maxRounds',
        'constraintsVersion',
        'localDate',
        'allowedActions',
        'clarifyTopics',
      ],
    ),
    principal: pickDynamic(
      {
        briefVersion: (agentContext.principal as Record<string, unknown>)
          .briefVersion as number | null,
        ownApprovalNotes: ownBriefRaw?.ownApprovalNotes ?? [],
        hardFields: projectedHard as AgentTurnInput['principal']['hardFields'],
        softFields: projectedSoft as AgentTurnInput['principal']['softFields'],
        hard: projectedHard as AgentTurnInput['principal']['hard'],
        soft: projectedSoft as AgentTurnInput['principal']['soft'],
        ...(ownNotes !== undefined ? { notes: ownNotes } : {}),
      },
      [
        'briefVersion',
        'ownApprovalNotes',
        'hardFields',
        'softFields',
        'hard',
        'soft',
        ...(ownNotes !== undefined ? (['notes'] as const) : []),
      ],
    ),
    sharedFacts: agentContext.sharedFacts as unknown as AgentTurnInput['sharedFacts'],
    ...('budget' in agentContext && agentContext.budget !== undefined
      ? { budget: agentContext.budget as AgentTurnInput['budget'] }
      : {}),
    catalog: confirmedCatalog.map((item) =>
      pickExact(
        {
          itemKey: item.itemKey,
          revision: item.revision,
          kind: item.kind,
          priceCents: item.priceCents,
          leadDays: item.leadDays,
          status: 'confirmed' as const,
        },
        ['itemKey', 'revision', 'kind', 'priceCents', 'leadDays', 'status'],
      ),
    ),
    catalogTitles: agentContext.catalogTitles,
    catalogTitlesMap: Object.freeze(
      Object.fromEntries(
        confirmedCatalog.map((item) => [item.itemKey, item.title]),
      ),
    ),
    currentProposal: agentContext.currentProposal as AgentTurnInput['currentProposal'],
    recentProposals: agentContext.recentProposals as AgentTurnInput['recentProposals'],
    ...(role === 'provider' ? { feedback: projectedFeedback as AgentTurnInput['feedback'] } : {}),
    candidates: agentContext.candidates as AgentTurnInput['candidates'],
    openRequestForMe: agentContext.openRequestForMe as AgentTurnInput['openRequestForMe'],
    clarifyTargets: clarifyTargets.map((t) =>
      pickExact({ toRole: t.toRole, topicKeys: [...t.topicKeys] }, [
        'toRole',
        'topicKeys',
      ]),
    ),
    ...(retryNote !== undefined ? { retryNote } : {}),
    turnSalt,
    spec,
    agentContext,
  });
}
