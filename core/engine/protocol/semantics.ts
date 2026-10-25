import type { ReasonCode } from '../reasonCodes';
import type { AttemptErrorCode } from '../attemptErrors';
import { ROLES, type ModelAction } from '../actions';
import { resolveOptionKey } from '../candidates/resolve';
import type { SnapshotItem } from '../rules/types';
import {
  ALLOWED_PROPS,
  type AgentTurn,
  type ClarifyTargetSpec,
  RATIONALE_MAX_CODEPOINTS,
} from './turnSpec';

/**
 * Pure semantic move validation and response classification pipeline
 * (05 §5.6, 10 §10.21, INV-23, INV-40, INV-43).
 *
 * Pure TypeScript: zero runtime dependencies.
 */

export const MOVE_ISSUE_CODES = [
  'action.not_allowed_for_role',
  'action.option_not_in_snapshot',
  'action.repeats_blocked',
  'output.unknown_reference',
] as const;

export type MoveIssueCode = (typeof MOVE_ISSUE_CODES)[number];

export type OutputValidationCode =
  | 'output.truncated'
  | 'output.refusal'
  | 'output.not_json'
  | 'output.schema_violation'
  | MoveIssueCode;

export type MoveIssue = {
  readonly code: MoveIssueCode;
  readonly path: string;
};

export type TurnSemanticsView = {
  readonly role: string;
  readonly turnKind: 'propose' | 'evaluate';
  readonly allowedActions: readonly ModelAction[];
  readonly snapshot: readonly SnapshotItem[];
  readonly excludedCandidateKeys: readonly string[];
  readonly currentProposalVersion?: number;
  readonly escalationRoles?: readonly string[];
  readonly reasonKeys: readonly string[];
  readonly clarifyTargets: readonly ClarifyTargetSpec[];
};

function isProposalVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000;
}

/**
 * Collects all semantic move violations in strict 05 §5.6.2 table order:
 * 1. `action.not_allowed_for_role`
 * 2. `action.option_not_in_snapshot`
 * 3. `action.repeats_blocked`
 * 4. `output.unknown_reference`
 *
 * Does not short-circuit across categories.
 */
export function validateMoveSemantics(
  turn: AgentTurn,
  view: TurnSemanticsView,
): MoveIssue[] {
  const issues: MoveIssue[] = [];

  // 1. action.not_allowed_for_role
  if (!view.allowedActions.includes(turn.action)) {
    issues.push({
      code: 'action.not_allowed_for_role',
      path: 'turn.action',
    });
  }

  // 2. action.option_not_in_snapshot & 3. action.repeats_blocked
  if (turn.action === 'propose' || turn.action === 'counter') {
    const resolved = resolveOptionKey(view.snapshot, turn.optionKey);
    if (resolved === null) {
      issues.push({
        code: 'action.option_not_in_snapshot',
        path: 'turn.optionKey',
      });
    } else if (view.excludedCandidateKeys.includes(resolved.candidateKey)) {
      issues.push({
        code: 'action.repeats_blocked',
        path: 'turn.optionKey',
      });
    }
  }

  // 4. output.unknown_reference
  if (turn.action === 'recommend_accept') {
    if (
      !isProposalVersion(turn.proposalVersion) ||
      !isProposalVersion(view.currentProposalVersion) ||
      turn.proposalVersion !== view.currentProposalVersion
    ) {
      issues.push({
        code: 'output.unknown_reference',
        path: 'turn.proposalVersion',
      });
    }
  } else if (turn.action === 'counter') {
    if (
      !isProposalVersion(turn.baseProposalVersion) ||
      !isProposalVersion(view.currentProposalVersion) ||
      turn.baseProposalVersion !== view.currentProposalVersion
    ) {
      issues.push({
        code: 'output.unknown_reference',
        path: 'turn.baseProposalVersion',
      });
    }
  } else if (turn.action === 'reject') {
    if (
      view.turnKind === 'propose'
        ? turn.proposalVersion !== null
        : !isProposalVersion(turn.proposalVersion) ||
          !isProposalVersion(view.currentProposalVersion) ||
          turn.proposalVersion !== view.currentProposalVersion
    ) {
      issues.push({
        code: 'output.unknown_reference',
        path: 'turn.proposalVersion',
      });
    }
    if (!view.reasonKeys.includes(turn.reasonKey)) {
      issues.push({
        code: 'output.unknown_reference',
        path: 'turn.reasonKey',
      });
    }
  } else if (turn.action === 'escalate') {
    if (!(view.escalationRoles ?? ROLES as readonly string[]).includes(turn.toRole)) {
      issues.push({ code: 'output.unknown_reference', path: 'turn.toRole' });
    }
  } else if (turn.action === 'clarify') {
    const targetAllowed =
      turn.toRole !== view.role &&
      turn.topicKey !== 'option_fits_constraints' &&
      view.clarifyTargets.some(
        (t) =>
          t.toRole === turn.toRole && t.topicKeys.includes(turn.topicKey),
      );
    if (!targetAllowed) {
      issues.push({
        code: 'output.unknown_reference',
        path: 'turn.topicKey',
      });
    }
  }

  return issues;
}

/**
 * Sanitizes an issue path against `ALLOWED_PROPS` (05 §5.6.1 step 7):
 * - Known schema property names in `ALLOWED_PROPS` are kept.
 * - Numeric array indices are formatted as `[i]`.
 * - Any unknown property name (e.g. from `unrecognized_keys`) is replaced with `'*'`.
 * Never echoes model-supplied keys or values.
 */
export function sanitizeIssuePath(
  segments: readonly PropertyKey[] | string | undefined,
): string {
  if (segments === undefined) return '<root>';
  const parts: readonly PropertyKey[] =
    typeof segments === 'string'
      ? segments.length === 0
        ? []
        : segments.split('.')
      : segments;
  if (parts.length === 0) return '<root>';

  let out = '';
  for (const seg of parts) {
    if (typeof seg === 'number' || /^\d+$/.test(String(seg))) {
      out += `[${String(seg)}]`;
    } else if (typeof seg === 'string' && ALLOWED_PROPS.has(seg)) {
      out += out.length === 0 ? seg : `.${seg}`;
    } else {
      out += out.length === 0 ? '*' : '.*';
    }
  }
  return out;
}

/**
 * Normalizes `rationale` to NFC and truncates to `<= 1,200` Unicode code points
 * (05 §5.6.1 step 9, INV-43, CE-075).
 */
export function normalizeRationale(rationale: string): {
  readonly rationale: string;
  readonly rationaleTruncated: boolean;
} {
  const nfc = rationale.normalize('NFC');
  const codepoints = [...nfc];
  if (codepoints.length > RATIONALE_MAX_CODEPOINTS) {
    return {
      rationale: codepoints.slice(0, RATIONALE_MAX_CODEPOINTS).join(''),
      rationaleTruncated: true,
    };
  }
  return {
    rationale: nfc,
    rationaleTruncated: false,
  };
}

export type ClassifierUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thinkingTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreation5mTokens?: number;
  readonly cacheCreation1hTokens?: number;
  readonly totalPromptTokens?: number;
  readonly estimatedCostMicroUsd?: number;
};

export type RawClassifierInput = {
  readonly stopReason?: string | null;
  readonly stop_reason?: string | null;
  readonly stopCategory?: string | null;
  readonly stop_details?: { readonly category?: string | null } | null;
  readonly text?: string | null;
  readonly firstText?: string | null;
  readonly textBlockCount?: number;
  readonly content?: readonly {
    readonly type: string;
    readonly text?: string;
    readonly [key: string]: unknown;
  }[];
  readonly usage?: ClassifierUsage | {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly output_tokens_details?: { readonly thinking_tokens?: number | null } | null;
    readonly cache_creation_input_tokens?: number | null;
    readonly cache_read_input_tokens?: number | null;
  } | null;
  readonly requestId?: string | null;
  readonly _request_id?: string | null;
  readonly responseModel?: string | null;
  readonly model?: string | null;
};

export type TurnParseResult =
  | { readonly ok: true; readonly turn: AgentTurn }
  | {
      readonly ok: false;
      readonly issues: readonly {
        readonly path?: readonly PropertyKey[] | string;
        readonly code?: string;
        readonly keys?: readonly string[];
      }[];
    };

export type ClassifiedResponse =
  | {
      readonly status: 'completed';
      readonly turn: AgentTurn;
      readonly rationaleTruncated: boolean;
      readonly retryable: false;
      readonly usage: ClassifierUsage;
      readonly stopReason: 'end_turn';
      readonly stopCategory: string | null;
      readonly requestId: string | null;
      readonly responseModel: string | null;
    }
  | {
      readonly status: 'refused';
      readonly reasonCode: 'output.refusal';
      readonly retryable: false;
      readonly usage: ClassifierUsage;
      readonly stopReason: 'refusal';
      readonly stopCategory: string | null;
      readonly requestId: string | null;
      readonly responseModel: string | null;
    }
  | {
      readonly status: 'invalid_output';
      readonly reasonCode: Exclude<OutputValidationCode, 'output.refusal'>;
      readonly codes: readonly Exclude<OutputValidationCode, 'output.refusal'>[];
      readonly retryable: boolean;
      readonly retryNote: ReasonCode;
      readonly issuePaths: readonly string[];
      readonly usage: ClassifierUsage;
      readonly stopReason: string | null;
      readonly stopCategory: string | null;
      readonly requestId: string | null;
      readonly responseModel: string | null;
    }
  | {
      readonly status: 'error';
      readonly errorCode: AttemptErrorCode;
      readonly retryable: false;
      readonly usage: ClassifierUsage;
      readonly stopReason: string | null;
      readonly stopCategory: string | null;
      readonly requestId: string | null;
      readonly responseModel: string | null;
    };

function extractUsage(raw: RawClassifierInput): ClassifierUsage {
  const u = raw.usage;
  if (!u || typeof u !== 'object') {
    return Object.freeze({
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  }
  if ('inputTokens' in u && typeof u.inputTokens === 'number') {
    return Object.freeze({
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      thinkingTokens: u.thinkingTokens ?? 0,
      cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
      ...(u.cacheCreation5mTokens !== undefined
        ? { cacheCreation5mTokens: u.cacheCreation5mTokens }
        : {}),
      ...(u.cacheCreation1hTokens !== undefined
        ? { cacheCreation1hTokens: u.cacheCreation1hTokens }
        : {}),
      ...(u.totalPromptTokens !== undefined
        ? { totalPromptTokens: u.totalPromptTokens }
        : {}),
      ...(u.estimatedCostMicroUsd !== undefined
        ? { estimatedCostMicroUsd: u.estimatedCostMicroUsd }
        : {}),
    });
  }
  const sdkUsage = u as {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly output_tokens_details?: { readonly thinking_tokens?: number | null } | null;
    readonly cache_creation_input_tokens?: number | null;
    readonly cache_read_input_tokens?: number | null;
  };
  return Object.freeze({
    inputTokens: sdkUsage.input_tokens ?? 0,
    outputTokens: sdkUsage.output_tokens ?? 0,
    thinkingTokens: sdkUsage.output_tokens_details?.thinking_tokens ?? 0,
    cacheCreationInputTokens: sdkUsage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: sdkUsage.cache_read_input_tokens ?? 0,
  });
}

function extractSingleTextBlock(raw: RawClassifierInput): string | null {
  if (typeof raw.textBlockCount === 'number' && raw.textBlockCount !== 1) {
    return null;
  }
  if (typeof raw.firstText === 'string') {
    return raw.firstText;
  }
  if (typeof raw.text === 'string') {
    return raw.text;
  }
  if (Array.isArray(raw.content)) {
    const textBlocks = raw.content.filter(
      (block): block is { readonly type: 'text'; readonly text: string } =>
        Boolean(
          block &&
            typeof block === 'object' &&
            block.type === 'text' &&
            typeof block.text === 'string',
        ),
    );
    if (textBlocks.length !== 1) {
      return null;
    }
    return textBlocks[0]!.text;
  }
  return null;
}

/**
 * Pure core response classification (05 §5.6.1 steps 2–9, 10 §10.21).
 * Never throws or logs raw text; records `usage` in every branch.
 * Step 7 (`parseTurn`) is injected from `convex/model/agents/outputSchema.ts`.
 */
export function classifyResponseCore(
  raw: RawClassifierInput,
  view: TurnSemanticsView,
  parseTurn: (parsedJson: unknown) => TurnParseResult,
): ClassifiedResponse {
  // Step 1: Extract usage, stopReason, stopCategory, requestId, responseModel first.
  const usage = extractUsage(raw);
  const stopReason =
    raw.stopReason !== undefined ? raw.stopReason : (raw.stop_reason ?? null);
  const stopCategory =
    raw.stopCategory !== undefined
      ? raw.stopCategory
      : (raw.stop_details?.category ?? null);
  const requestId =
    raw.requestId !== undefined ? raw.requestId : (raw._request_id ?? null);
  const responseModel =
    raw.responseModel !== undefined ? raw.responseModel : (raw.model ?? null);

  // Step 2: stop_reason === 'refusal' -> refused (output.refusal, not retryable)
  if (stopReason === 'refusal') {
    return Object.freeze({
      status: 'refused',
      reasonCode: 'output.refusal',
      retryable: false,
      usage,
      stopReason: 'refusal',
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 3: stop_reason === 'max_tokens' -> invalid_output (output.truncated, not retryable after gateway)
  if (stopReason === 'max_tokens') {
    return Object.freeze({
      status: 'invalid_output' as const,
      reasonCode: 'output.truncated' as const,
      codes: Object.freeze(['output.truncated'] as const),
      retryable: false as const,
      retryNote: 'output.truncated',
      issuePaths: Object.freeze([] as const),
      usage,
      stopReason: 'max_tokens' as const,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 4: stop_reason === 'model_context_window_exceeded' -> error (context_overflow, not retryable)
  if (stopReason === 'model_context_window_exceeded') {
    return Object.freeze({
      status: 'error' as const,
      errorCode: 'context_overflow' as const,
      retryable: false as const,
      usage,
      stopReason: 'model_context_window_exceeded' as const,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 5: Any other stop_reason !== 'end_turn' -> error (unexpected_stop, not retryable)
  if (stopReason !== 'end_turn') {
    return Object.freeze({
      status: 'error' as const,
      errorCode: 'unexpected_stop' as const,
      retryable: false as const,
      usage,
      stopReason,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 6: stop_reason === 'end_turn' -> extract single text block & JSON.parse
  const firstText = extractSingleTextBlock(raw);
  if (firstText === null) {
    return Object.freeze({
      status: 'invalid_output' as const,
      reasonCode: 'output.not_json' as const,
      codes: Object.freeze(['output.not_json'] as const),
      retryable: true as const,
      retryNote: 'output.not_json',
      issuePaths: Object.freeze([] as const),
      usage,
      stopReason: 'end_turn' as const,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(firstText);
  } catch {
    return Object.freeze({
      status: 'invalid_output' as const,
      reasonCode: 'output.not_json' as const,
      codes: Object.freeze(['output.not_json'] as const),
      retryable: true as const,
      retryNote: 'output.not_json',
      issuePaths: Object.freeze([] as const),
      usage,
      stopReason: 'end_turn' as const,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 7: Loose Zod safeParse (injected from convex/model/agents/)
  const parsedTurn = parseTurn(parsedJson);
  if (!parsedTurn.ok) {
    const issuePaths = parsedTurn.issues.flatMap((issue) => {
      if (Array.isArray(issue.keys) && issue.keys.length > 0) {
        const baseParts = Array.isArray(issue.path)
          ? issue.path
          : typeof issue.path === 'string' && issue.path.length > 0
            ? issue.path.split('.')
            : [];
        return issue.keys.map((k) => sanitizeIssuePath([...baseParts, k]));
      }
      return [sanitizeIssuePath(issue.path)];
    });
    return Object.freeze({
      status: 'invalid_output' as const,
      reasonCode: 'output.schema_violation' as const,
      codes: Object.freeze(['output.schema_violation'] as const),
      retryable: true as const,
      retryNote: 'output.schema_violation',
      issuePaths: Object.freeze(issuePaths),
      usage,
      stopReason: 'end_turn' as const,
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 8: validateMoveSemantics
  const semanticIssues = validateMoveSemantics(parsedTurn.turn, view);
  if (semanticIssues.length > 0) {
    const firstCode = semanticIssues[0]!.code;
    return Object.freeze({
      status: 'invalid_output',
      reasonCode: firstCode,
      codes: Object.freeze(semanticIssues.map((i) => i.code)),
      retryable: true,
      retryNote: firstCode,
      issuePaths: Object.freeze(
        semanticIssues.map((i) => sanitizeIssuePath(i.path)),
      ),
      usage,
      stopReason: 'end_turn',
      stopCategory,
      requestId,
      responseModel,
    });
  }

  // Step 9: Normalize rationale to NFC & truncate to <= 1,200 codepoints
  const { rationale, rationaleTruncated } = normalizeRationale(
    parsedTurn.turn.rationale,
  );
  const normalizedTurn: AgentTurn = Object.freeze({
    ...parsedTurn.turn,
    rationale,
  });

  return Object.freeze({
    status: 'completed',
    turn: normalizedTurn,
    rationaleTruncated,
    retryable: false,
    usage,
    stopReason: 'end_turn',
    stopCategory,
    requestId,
    responseModel,
  });
}
