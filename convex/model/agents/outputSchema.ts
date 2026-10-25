import { protocol as scopeProtocol, SCOPE_CHANGE_ROLES } from '../../../core/scenarios/scope-change';
import { z } from 'zod';
import {
  ALLOWED_PROPS,
  type AgentTurn,
  type AgentTurnEnvelope,
  assertNoForbiddenPropertyNames,
  buildTurnSpec,
  canonicalJson,
  type ClassifiedResponse,
  classifyResponseCore,
  ESCALATION_KINDS,
  listAllTurnSpecVariants,
  listWarmTurnSpecs,
  OPTION_KEY_RE,
  type RawClassifierInput,
  type Role,
  toStrictOutputSchema,
  type TurnParseResult,
  type TurnSemanticsView,
  type TurnSpec,
  turnSpecKey,
} from '../../../core/engine';
import type { JsonSchemaObject } from './modelGateway';

/**
 * Dynamic per-turn Zod & strict JSON Schema builder, schema cache, flat-fallback
 * normalizer, and `classifyResponse` binding (05 §5.4–5.6, canon D09, INV-04).
 */

function nonEmptyTuple(items: readonly string[]): [string, ...string[]] {
  if (items.length === 0) {
    throw new Error('Enum branch requires at least one allowed value');
  }
  return [items[0]!, ...items.slice(1)];
}

/**
 * Builds the `{ turn }` Zod schema for `spec` (05 §5.4.3):
 * - Root is always `z.strictObject({ turn: ... })`.
 * - Every object uses `z.strictObject` (`additionalProperties: false`, all fields required).
 * - Never uses `z.record` or `.default()`.
 * - When `strict === true`: builds only branches in `spec.allowedActions` with closed `z.enum` / `z.literal` domains.
 * - When `strict === false`: builds all 6 `MODEL_ACTIONS` branches with syntactic regex/integer bounds so
 *   disallowed actions and out-of-snapshot references reach step 8 (`validateMoveSemantics`).
 */
export function buildTurnZod(
  spec: TurnSpec,
  strict: boolean,
): z.ZodType<AgentTurnEnvelope> {
  if (strict) {
    for (const action of spec.allowedActions) {
      const empty = (action === 'propose' || action === 'counter') ? spec.optionKeys.length === 0
        : action === 'reject' ? spec.reasonKeys.length === 0
        : action === 'clarify' ? !spec.clarifyTargets.some(t => t.toRole !== spec.role && t.topicKeys.some(k => k !== 'option_fits_constraints'))
        : action === 'escalate' ? spec.escalationRoles?.length === 0
        : false;
      if (empty) throw new Error(`Empty schema domain for allowed action: ${action}`);
    }
  }
  const rationale = z.string().min(1);
  const baseVer = z.number().int().min(1).max(1_000_000);

  const branches: z.ZodTypeAny[] = [];
  const actionsToInclude = strict
    ? spec.allowedActions
    : ([
        'propose',
        'counter',
        'recommend_accept',
        'reject',
        'clarify',
        'escalate',
      ] as const);

  if (
    actionsToInclude.includes('propose') &&
    (!strict || spec.optionKeys.length > 0)
  ) {
    branches.push(
      z.strictObject({
        action: z.literal('propose'),
        optionKey: strict
          ? z.enum(nonEmptyTuple(spec.optionKeys))
          : z.string().regex(OPTION_KEY_RE),
        rationale,
      }),
    );
  }

  if (
    actionsToInclude.includes('counter') &&
    (!strict || spec.optionKeys.length > 0)
  ) {
    branches.push(
      z.strictObject({
        action: z.literal('counter'),
        baseProposalVersion: baseVer,
        optionKey: strict
          ? z.enum(nonEmptyTuple(spec.optionKeys))
          : z.string().regex(OPTION_KEY_RE),
        rationale,
      }),
    );
  }

  if (actionsToInclude.includes('recommend_accept')) {
    branches.push(
      z.strictObject({
        action: z.literal('recommend_accept'),
        proposalVersion: baseVer,
        rationale,
      }),
    );
  }

  if (
    actionsToInclude.includes('reject') &&
    (!strict || spec.reasonKeys.length > 0)
  ) {
    branches.push(
      z.strictObject({
        action: z.literal('reject'),
        proposalVersion: strict && spec.turnKind === 'propose' ? z.null() : strict ? baseVer : baseVer.nullable(),
        reasonKey: strict
          ? z.enum(nonEmptyTuple(spec.reasonKeys))
          : z.string().min(1),
        rationale,
      }),
    );
  }

  if (actionsToInclude.includes('clarify')) {
    if (strict) {
      for (const target of spec.clarifyTargets) {
        const topics = target.topicKeys.filter(
          (k) => k !== 'option_fits_constraints',
        );
        if (target.toRole !== spec.role && topics.length > 0) {
          branches.push(
            z.strictObject({
              action: z.literal('clarify'),
              toRole: z.literal(target.toRole),
              topicKey: z.enum(nonEmptyTuple(topics)),
              rationale,
            }),
          );
        }
      }
    } else {
      branches.push(
        z.strictObject({
          action: z.literal('clarify'),
          toRole: z.string().min(1),
          topicKey: z.string().min(1),
          rationale,
        }),
      );
    }
  }

  if (actionsToInclude.includes('escalate')) {
    branches.push(
      z.strictObject({
        action: z.literal('escalate'),
        kind: z.enum(ESCALATION_KINDS),
        toRole: strict ? z.enum(nonEmptyTuple(spec.escalationRoles ?? ['customer', 'provider', 'finance'])) : z.string().min(1),
        rationale,
      }),
    );
  }

  if (branches.length === 0) {
    throw new Error(
      `buildTurnZod produced 0 action branches for ${turnSpecKey(spec)}`,
    );
  }

  const turnUnion =
    branches.length === 1
      ? branches[0]!
      : z.union(
          branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
        );

  return z.strictObject({
    turn: turnUnion,
  }) as unknown as z.ZodType<AgentTurnEnvelope>;
}

const LOOSE_ROOT_SCHEMA = z.strictObject({
  turn: z.record(z.string(), z.unknown()),
});

const LOOSE_ACTION_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
  propose: z.strictObject({
    action: z.literal('propose'),
    optionKey: z.string().regex(OPTION_KEY_RE),
    rationale: z.string().min(1),
  }),
  counter: z.strictObject({
    action: z.literal('counter'),
    baseProposalVersion: z.number().int().min(1),
    optionKey: z.string().regex(OPTION_KEY_RE),
    rationale: z.string().min(1),
  }),
  recommend_accept: z.strictObject({
    action: z.literal('recommend_accept'),
    proposalVersion: z.number().int().min(1),
    rationale: z.string().min(1),
  }),
  reject: z.strictObject({
    action: z.literal('reject'),
    proposalVersion: z.number().int().min(1).max(1_000_000).nullable(),
    reasonKey: z.string().min(1),
    rationale: z.string().min(1),
  }),
  clarify: z.strictObject({
    action: z.literal('clarify'),
    toRole: z.string().min(1),
    topicKey: z.string().min(1),
    rationale: z.string().min(1),
  }),
  escalate: z.strictObject({
    action: z.literal('escalate'),
    kind: z.enum(ESCALATION_KINDS),
    toRole: z.string().min(1),
    rationale: z.string().min(1),
  }),
};

export type SelectedOutputSchema = {
  readonly schemaVersion: string;
  readonly schemaHash: string;
  readonly strict: JsonSchemaObject;
  readonly loose: z.ZodType<AgentTurnEnvelope>;
};

const SCHEMA_CACHE = new Map<string, SelectedOutputSchema>();

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function computeSchemaHash(strictSchema: JsonSchemaObject): string {
  return fnv1a32Hex(
    canonicalJson(
      strictSchema as unknown as Parameters<typeof canonicalJson>[0],
    ),
  );
}

/**
 * Selects and caches the strict JSON Schema and loose Zod validator for `spec` (05 §5.5).
 * Asserts zero forbidden property names (INV-04, 05 §5.4.4).
 */
export function selectOutputSchema(spec: TurnSpec): SelectedOutputSchema {
  const key = turnSpecKey(spec);
  const cacheKey = canonicalJson({ key, optionKeys: spec.optionKeys, reasonKeys: spec.reasonKeys, clarifyTargets: spec.clarifyTargets, escalationRoles: spec.escalationRoles ?? ['customer', 'provider', 'finance'] });
  const cached = SCHEMA_CACHE.get(cacheKey);
  if (cached) return cached;

  const strictZod = buildTurnZod(spec, true);
  const strict = toStrictOutputSchema(
    z.toJSONSchema(strictZod),
  ) as JsonSchemaObject;
  assertNoForbiddenPropertyNames(strict);

  const loose = buildTurnZod(spec, false);
  const schemaHash = computeSchemaHash(strict);

  const entry: SelectedOutputSchema = Object.freeze({
    schemaVersion: key,
    schemaHash,
    strict,
    loose,
  });
  SCHEMA_CACHE.set(cacheKey, entry);
  return entry;
}

/** Inject plugin-owned reference domains without engine -> scenario imports. */
export function scopeChangeTurnSpecDomains() {
  return Object.fromEntries((['provider', 'customer', 'finance'] as const).map(role => [role, {
    reasonKeys: scopeProtocol.reasonKeys.filter(r => r.usableBy.includes(role)).map(r => r.reasonKey),
    clarifyTargets: scopeProtocol.topics.filter(t => t.askableBy.includes(role)).map(t => ({ toRole: t.toRole, topicKeys: [t.topicKey] })),
    escalationRoles: SCOPE_CHANGE_ROLES.map(r => r.role),
  }]));
}

export function listScopeChangeWarmTurnSpecs(): readonly TurnSpec[] {
  return listWarmTurnSpecs(scopeChangeTurnSpecDomains());
}

export function listScopeChangeTurnSpecVariants(): readonly TurnSpec[] {
  return listAllTurnSpecVariants(scopeChangeTurnSpecDomains());
}

/**
 * Pre-warms the module-level schema cache with the 25 "all actions" variants
 * (`ops.warmSchemas`, 05 §5.5).
 */
export function warmOutputSchemas(
  specs: readonly TurnSpec[] = listScopeChangeWarmTurnSpecs(),
): readonly SelectedOutputSchema[] {
  return specs.map((spec) => selectOutputSchema(spec));
}

/**
 * Fallback normalizer from flat single-object `{ action, ..., rationale }` (with `null`
 * on unused branch fields) into `{ turn: AgentTurn }` (05 §5.4.5, V1 fallback).
 */
export function fromFlat(raw: Record<string, unknown>): AgentTurnEnvelope {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'turn' in raw &&
    typeof raw.turn === 'object' &&
    raw.turn !== null
  ) {
    return raw as unknown as AgentTurnEnvelope;
  }

  const action = raw.action;
  const rationale = raw.rationale;
  const clean: Record<string, unknown> = { action, rationale };

  switch (action) {
    case 'propose':
      clean.optionKey = raw.optionKey;
      break;
    case 'counter':
      clean.baseProposalVersion = raw.baseProposalVersion;
      clean.optionKey = raw.optionKey;
      break;
    case 'recommend_accept':
      clean.proposalVersion = raw.proposalVersion;
      break;
    case 'reject':
      clean.proposalVersion = raw.proposalVersion;
      clean.reasonKey = raw.reasonKey;
      break;
    case 'clarify':
      clean.toRole = raw.toRole;
      clean.topicKey = raw.topicKey;
      break;
    case 'escalate':
      clean.kind = raw.kind;
      clean.toRole = raw.toRole;
      break;
    default:
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null && v !== undefined) {
          clean[k] = v;
        }
      }
      break;
  }

  return { turn: clean as unknown as AgentTurn };
}

/**
 * Runs step 7 (`buildTurnZod(spec, false).safeParse`) and extracts branch-precise
 * issue paths so unrecognized property names (e.g. `turn.amountCents` -> `'turn.*'`)
 * and field violations (e.g. `turn.optionKey`) are preserved accurately.
 */
export function parseTurnEnvelope(
  parsedJson: unknown,
  spec?: TurnSpec,
): TurnParseResult {
  const looseSchema = spec ? selectOutputSchema(spec).loose : buildTurnZod(
    buildTurnSpec({ role: 'provider', turnKind: 'propose', optionCount: 1 }),
    false,
  );

  const res = looseSchema.safeParse(parsedJson);
  if (res.success) {
    return { ok: true, turn: res.data.turn };
  }

  // Extract precise branch issues when root has { turn: { action: ... } }
  const rootCheck = LOOSE_ROOT_SCHEMA.safeParse(parsedJson);
  if (!rootCheck.success) {
    return {
      ok: false,
      issues: rootCheck.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        keys:
          'keys' in issue && Array.isArray(issue.keys)
            ? (issue.keys as string[])
            : undefined,
      })),
    };
  }

  const turnObj = rootCheck.data.turn;
  const actionVal = turnObj.action;
  if (typeof actionVal === 'string' && Object.hasOwn(LOOSE_ACTION_SCHEMAS, actionVal)) {
    const branchSchema = LOOSE_ACTION_SCHEMAS[actionVal]!;
    const branchRes = branchSchema.safeParse(turnObj);
    if (!branchRes.success) {
      return {
        ok: false,
        issues: branchRes.error.issues.map((issue) => ({
          path: ['turn', ...issue.path],
          code: issue.code,
          keys:
            'keys' in issue && Array.isArray(issue.keys)
              ? (issue.keys as string[])
              : undefined,
        })),
      };
    }
  }

  // Invalid or missing action discriminator
  return {
    ok: false,
    issues: [{ path: ['turn', 'action'], code: 'invalid_value' }],
  };
}

/**
 * Full 9-step response classification pipeline (05 §5.6.1, 10 §10.21):
 * - Combines pure steps 2–6 and 8–9 from `core/engine/protocol/semantics.ts`
 *   with step 7 (`buildTurnZod(spec, false).safeParse`) in `convex/model/agents/`.
 * - Records `usage` in every branch; never throws or logs raw text.
 */
export function classifyResponse(
  raw: RawClassifierInput,
  view: TurnSemanticsView,
  spec?: TurnSpec,
): ClassifiedResponse {
  const resolvedSpec: TurnSpec =
    spec ??
    buildTurnSpec({
      role: view.role as Role,
      turnKind: view.turnKind,
      optionKeys: view.snapshot.map((s) => s.optionKey),
      currentProposalVersion: view.currentProposalVersion,
      reasonKeys: view.reasonKeys,
      clarifyTargets: view.clarifyTargets,
      allowedActions: view.allowedActions,
    });

  return classifyResponseCore(raw, view, (parsedJson) =>
    parseTurnEnvelope(parsedJson, resolvedSpec),
  );
}

export {
  ALLOWED_PROPS,
  buildTurnSpec,
  listAllTurnSpecVariants,
  listWarmTurnSpecs,
  OPTION_KEY_RE,
  turnSpecKey,
};
export type { AgentTurn, AgentTurnEnvelope, TurnSpec };
