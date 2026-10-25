import { MODEL_ACTIONS, TURN_KINDS, type ModelAction, type TurnKind } from '../actions';
import type { ReasonCode } from '../reasonCodes';

/** Closed subset of ReasonCode used by the design's retry instruction channel. */
type RetryReasonCode = Extract<ReasonCode,
  | 'output.not_json'
  | 'output.schema_violation'
  | 'output.truncated'
  | 'action.not_allowed_for_role'
  | 'action.option_not_in_snapshot'
  | 'action.repeats_blocked'
  | 'output.unknown_reference'
>;

/** §5.6.2 fixed retry prompts: never interpolate model output or user text. */
const RETRY_NOTES = {
  'output.not_json': 'Your previous response was not a single JSON object matching the schema. Respond again with only the JSON object.',
  'output.schema_violation': 'Your previous response was not a single JSON object matching the schema. Respond again with only the JSON object.',
  'output.truncated': 'Your previous response was cut off. Keep reasoning brief and the rationale under three sentences.',
  'action.not_allowed_for_role': 'That action is not allowed in this turn. Allowed actions are listed above.',
  'action.option_not_in_snapshot': 'Choose an optionKey that is listed in <candidates>.',
  'action.repeats_blocked': 'Choose an optionKey that is listed in <candidates>.',
  'output.unknown_reference': 'Reference only the proposal version, topics, reasons and roles listed for this turn.',
} as const satisfies Record<RetryReasonCode, string>;

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const actionPattern = `(?:${MODEL_ACTIONS.map(escapePattern).join('|')})`;
const INSTRUCTION_PATTERN = new RegExp(
  `^This turn: kind (?:${TURN_KINDS.join('|')})\\. Allowed actions: ${actionPattern}(?:, ${actionPattern})*\\.` +
  '(?: Base proposal version: [1-9][0-9]*\\.)?' +
  `(?: (?:${Object.values(RETRY_NOTES).map(escapePattern).join('|')}))?(?![\\s\\S])`,
);

export interface TurnInstructionInput {
  readonly turnKind: TurnKind;
  readonly allowedActions: readonly ModelAction[];
  /** Trusted protocol metadata only; never titles, notes, or arbitrary text. */
  readonly extra?: { readonly baseProposalVersion?: number; readonly retryCode?: RetryReasonCode };
}

/** §5.13: keep untrusted prose out of the system instruction entirely. */
export function turnInstruction(input: TurnInstructionInput): string {
  if (Object.keys(input).some(key => !['turnKind', 'allowedActions', 'extra'].includes(key)) ||
      !TURN_KINDS.includes(input.turnKind) || !Array.isArray(input.allowedActions) ||
      input.allowedActions.length === 0 || input.allowedActions.some(action => !MODEL_ACTIONS.includes(action))) {
    throw new Error('Invalid turn instruction protocol fields');
  }
  const extra = input.extra;
  if (extra !== undefined && (!extra || Object.keys(extra).some(key => !['baseProposalVersion', 'retryCode'].includes(key)) ||
      (extra.baseProposalVersion !== undefined && (!Number.isSafeInteger(extra.baseProposalVersion) || extra.baseProposalVersion < 1)) ||
      (extra.retryCode !== undefined && !Object.hasOwn(RETRY_NOTES, extra.retryCode)))) {
    throw new Error('Invalid turn instruction metadata');
  }
  const text = `This turn: kind ${input.turnKind}. Allowed actions: ${input.allowedActions.join(', ')}.` +
    (extra?.baseProposalVersion !== undefined ? ` Base proposal version: ${extra.baseProposalVersion}.` : '') +
    (extra?.retryCode !== undefined ? ` ${RETRY_NOTES[extra.retryCode]}` : '');
  // Trusted templates must preserve literal protocol tags such as <candidates>.
  // Validate the complete fixed grammar rather than sanitizing it as user text.
  if (!INSTRUCTION_PATTERN.test(text)) throw new Error('Invalid turn instruction template');
  return text;
}
