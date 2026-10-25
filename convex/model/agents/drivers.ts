import {
  type AgentAction,
  type AgentTurn,
  type AgentTurnEnvelope,
  type AgentTurnInput,
  buildTurnSpec,
  type ClassifiedResponse,
  type ModelAction,
  renderPrompt,
  type Role,
  type ScenarioPromptPack,
  type SnapshotItem,
  type StubDecideInput,
  type TurnKind,
  type TurnSemanticsView,
  type TurnSpec,
} from '../../../core/engine';
import {
  protocol as scopeChangeProtocol,
  scopeChangePlugin,
  stubDecide as scopeChangeStubDecide,
} from '../../../core/scenarios/scope-change';
import {
  anthropicTransport,
  type AnthropicClientLike,
  buildNegotiationRequest,
  type CallAborted,
  type CallError,
  callModel,
  createLiveTransport,
  emptyUsageRecord,
  GatewayAPIError,
  GatewayConfigError,
  GatewayTimeoutError,
  type ModelCallResult,
  type ModelTransport,
  NEGOTIATION_MODEL,
  type RawAnthropicMessage,
  type StopReason,
  toUsageRecord,
  type TransportResponse,
  type UsageRecord,
} from './modelGateway';
import {
  classifyResponse,
  parseTurnEnvelope,
  selectOutputSchema,
} from './outputSchema';

export { buildNegotiationRequest };

// ---------------------------------------------------------------------------
// 1. Constants & Types (10 §10.17–10.18)
// ---------------------------------------------------------------------------

export const STUB_LATENCY_MS = 800 as const;

export const ZERO_USAGE: UsageRecord = emptyUsageRecord();

export interface NormalizedResponse {
  readonly stopReason: StopReason | string | null;
  readonly stopCategory: string | null;
  readonly textBlockCount: number;
  readonly firstText: string | null;
  readonly usage: UsageRecord;
  readonly responseModel: string;
  readonly requestId: string | null;
  readonly latencyMs: number;
}

export type StubFaultKind =
  | 'none'
  | 'refusal'
  | 'max_tokens'
  | 'not_json'
  | 'schema_violation'
  | 'semantic_invalid'
  | 'timeout'
  | 'http_529';

export type DeploymentTier = 'dev' | 'test' | 'staging' | 'prod';

export interface DriverCallCtx {
  readonly spec?: TurnSpec;
  readonly scenarioPack?: ScenarioPromptPack & {
    readonly stubDecide?: typeof scopeChangeStubDecide;
  };
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly totalBudgetMs?: number;
  readonly maxRetries?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly tier?: DeploymentTier;
  readonly stubFault?: StubFaultKind;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface AgentDriver {
  readonly mode: 'live' | 'stub' | 'scripted' | 'replay';
  runTurn(
    input: AgentTurnInput,
    ctx?: DriverCallCtx,
  ): Promise<NormalizedResponse>;
}

export class ScriptExhaustedError extends Error {
  readonly code = 'script_exhausted' as const;

  constructor(message = 'ScriptedDriver queue exhausted') {
    super(message);
    this.name = 'ScriptExhaustedError';
  }
}

export class DriverTransportError extends Error {
  readonly result: CallError | CallAborted;

  constructor(result: CallError | CallAborted) {
    super(`Driver transport failed: ${result.errorCode}`);
    this.name = 'DriverTransportError';
    this.result = result;
  }
}

// ---------------------------------------------------------------------------
// 2. Message Normalization (10 §10.17, §10.21)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Anthropic message into `NormalizedResponse` (10 §10.17).
 * - Counts all `type: 'text'` blocks (`textBlockCount`).
 * - Extracts the first `type: 'text'` block's text (`firstText`), ignoring any
 *   preceding `thinking` or `redacted_thinking` blocks.
 * - Preserves `usage`, `stopReason`, `stopCategory`, `responseModel`, and `requestId`.
 */
export function normalizeAnthropicMessage(
  message: RawAnthropicMessage,
  options?: {
    readonly usage?: UsageRecord;
    readonly latencyMs?: number;
    readonly requestId?: string | null;
  },
): NormalizedResponse {
  const textBlocks = message.content.filter(
    (b): b is { readonly type: 'text'; readonly text: string } =>
      b.type === 'text' && typeof (b as { text?: unknown }).text === 'string',
  );
  const firstText = textBlocks.length > 0 ? textBlocks[0]!.text : null;
  const responseModel = message.model ?? NEGOTIATION_MODEL;
  const usage = options?.usage ?? toUsageRecord(responseModel, message.usage);
  const requestId =
    options?.requestId !== undefined
      ? options.requestId
      : (message._request_id ?? null);

  return Object.freeze({
    stopReason: message.stop_reason,
    stopCategory: message.stop_details?.category ?? null,
    textBlockCount: textBlocks.length,
    firstText,
    usage,
    responseModel,
    requestId,
    latencyMs: options?.latencyMs ?? 0,
  });
}

function resolveSpecForInput(
  input: AgentTurnInput,
  ctx?: DriverCallCtx,
): TurnSpec {
  if (ctx?.spec) return ctx.spec;
  const role = (input.role ?? input.protocol.role ?? 'provider') as Role;
  const turnKind = (input.protocol.turnKind ??
    (role === 'provider' ? 'propose' : 'evaluate')) as TurnKind;
  const optionKeys = input.candidates.map((c, idx) =>
    typeof c.optionKey === 'string' ? c.optionKey : `O${idx + 1}`,
  );
  const currentProposalVersion =
    input.currentProposal && typeof input.currentProposal.version === 'number'
      ? input.currentProposal.version
      : turnKind === 'evaluate'
        ? 1
        : undefined;

  return buildTurnSpec({
    role,
    turnKind,
    optionKeys,
    scenarioKey: input.protocol.scenarioKey,
    scenarioVersion: input.protocol.scenarioVersion,
    reasonKeys: scopeChangeProtocol.reasonKeys.filter(r => r.usableBy.includes(role)).map(r => r.reasonKey),
    clarifyTargets: scopeChangeProtocol.topics.filter(t => t.askableBy.includes(role)).map(t => ({ toRole: t.toRole, topicKeys: [t.topicKey] })),
    ...(currentProposalVersion !== undefined ? { currentProposalVersion } : {}),
    ...(input.clarifyTargets !== undefined
      ? { clarifyTargets: input.clarifyTargets }
      : {}),
    ...(input.protocol.allowedActions !== undefined
      ? { allowedActions: input.protocol.allowedActions as readonly ModelAction[] }
      : {}),
  });
}

function toStubDecideInput(
  input: AgentTurnInput,
  spec: TurnSpec,
): StubDecideInput {
  const role = (input.role ?? input.protocol.role ?? spec.role) as Role;
  const turnKind = (input.protocol.turnKind ?? spec.turnKind) as TurnKind;
  const snapshot = input.candidates as unknown as readonly SnapshotItem[];

  let currentProposal: StubDecideInput['currentProposal'] = null;
  if (input.currentProposal) {
    const cur = input.currentProposal;
    const terms =
      typeof cur.terms === 'object' && cur.terms !== null
        ? (cur.terms as Record<string, unknown>)
        : cur;
    const itemKeys = Array.isArray(terms.itemKeys)
      ? (terms.itemKeys as readonly string[])
      : [];
    currentProposal = {
      version: typeof cur.version === 'number' ? cur.version : 1,
      candidateKey:
        typeof cur.candidateKey === 'string'
          ? cur.candidateKey
          : itemKeys.join('+'),
      itemKeys,
      passesInMyView:
        cur.fit !== 'blocked' && cur.passesInMyView !== false,
    };
  }

  const ownSoft = (input.principal.soft ??
    input.principal.softFields ??
    (typeof input.principal.notes === 'string'
      ? { notes: input.principal.notes }
      : undefined)) as Readonly<Record<string, unknown>> | undefined;

  return {
    role,
    turnKind,
    snapshot,
    currentProposal,
    ...(ownSoft !== undefined ? { ownSoft } : {}),
    sharedSoft: Object.fromEntries(input.sharedFacts
      .filter(f => scopeChangePlugin.fields.some(d => d.owner === f.fromRole && d.key === f.field && d.class === 'soft'))
      .map(f => [f.field, f.value.kind === 'itemKeys' ? f.value.itemKeys : f.value.kind === 'date' ? f.value.date : f.value.kind === 'cents' ? f.value.cents : f.value.value])),
    allowedActions: spec.allowedActions as readonly AgentAction[],
  };
}

// ---------------------------------------------------------------------------
// 3. StubDriver (10 §10.18.1–10.18.2, 06 §12.1)
// ---------------------------------------------------------------------------

export interface StubDriverOptions {
  readonly stubDecide?: typeof scopeChangeStubDecide;
  readonly fault?: StubFaultKind;
  readonly tier?: DeploymentTier;
}

export class StubDriver implements AgentDriver {
  readonly mode = 'stub' as const;
  private readonly decideFn: typeof scopeChangeStubDecide;
  private readonly defaultFault: StubFaultKind;
  private readonly defaultTier: DeploymentTier;

  constructor(options?: StubDriverOptions) {
    this.decideFn = options?.stubDecide ?? scopeChangeStubDecide;
    this.defaultFault = options?.fault ?? 'none';
    this.defaultTier = resolveCurrentTier(options?.tier);
  }

  async runTurn(
    input: AgentTurnInput,
    ctx?: DriverCallCtx,
  ): Promise<NormalizedResponse> {
    const tier = ctx?.tier ?? this.defaultTier;
    const fault =
      tier === 'prod' || process.env.ALLOW_FAULT_INJECTION !== 'true' ? 'none' : (ctx?.stubFault ?? this.defaultFault);

    if (fault === 'timeout') {
      throw new GatewayTimeoutError();
    }
    if (fault === 'http_529') {
      throw new GatewayAPIError(
        529,
        { type: 'overloaded_error' },
        'HTTP 529',
      );
    }
    if (fault === 'refusal') {
      return Object.freeze({
        stopReason: 'refusal',
        stopCategory: 'cyber',
        textBlockCount: 0,
        firstText: null,
        usage: ZERO_USAGE,
        responseModel: 'stub:v1',
        requestId: null,
        latencyMs: STUB_LATENCY_MS,
      });
    }
    if (fault === 'max_tokens') {
      return Object.freeze({
        stopReason: 'max_tokens',
        stopCategory: null,
        textBlockCount: 1,
        firstText: '{"turn":{"action":',
        usage: ZERO_USAGE,
        responseModel: 'stub:v1',
        requestId: null,
        latencyMs: STUB_LATENCY_MS,
      });
    }
    if (fault === 'not_json') {
      return Object.freeze({
        stopReason: 'end_turn',
        stopCategory: null,
        textBlockCount: 1,
        firstText: 'not valid json',
        usage: ZERO_USAGE,
        responseModel: 'stub:v1',
        requestId: null,
        latencyMs: STUB_LATENCY_MS,
      });
    }
    if (fault === 'schema_violation') {
      return Object.freeze({
        stopReason: 'end_turn',
        stopCategory: null,
        textBlockCount: 1,
        firstText: JSON.stringify({ turn: { action: 'unknown_action' } }),
        usage: ZERO_USAGE,
        responseModel: 'stub:v1',
        requestId: null,
        latencyMs: STUB_LATENCY_MS,
      });
    }
    if (fault === 'semantic_invalid') {
      return Object.freeze({
        stopReason: 'end_turn',
        stopCategory: null,
        textBlockCount: 1,
        firstText: JSON.stringify({
          turn: {
            action: 'propose',
            optionKey: 'O12',
            rationale: 'semantic invalid test turn',
          },
        }),
        usage: ZERO_USAGE,
        responseModel: 'stub:v1',
        requestId: null,
        latencyMs: STUB_LATENCY_MS,
      });
    }

    const spec = resolveSpecForInput(input, ctx);
    const stubInput = toStubDecideInput(input, spec);
    const decide = ctx?.scenarioPack?.stubDecide ?? this.decideFn;
    const envelope = decide(stubInput);

    return Object.freeze({
      stopReason: 'end_turn',
      stopCategory: null,
      textBlockCount: 1,
      firstText: JSON.stringify(envelope),
      usage: ZERO_USAGE,
      responseModel: 'stub:v1',
      requestId: null,
      latencyMs: STUB_LATENCY_MS,
    });
  }
}

// ---------------------------------------------------------------------------
// 4. LiveDriver (10 §10.18.1, RQ-01, TC-OPS-05)
// ---------------------------------------------------------------------------

export interface LiveDriverOptions {
  readonly transport?: ModelTransport;
  readonly client?: AnthropicClientLike;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly scenarioPack?: ScenarioPromptPack;
}

export class LiveDriver implements AgentDriver {
  readonly mode = 'live' as const;
  private readonly options: LiveDriverOptions;

  constructor(options?: LiveDriverOptions) {
    this.options = options ?? {};
  }

  private resolveTransport(
    env?: Readonly<Record<string, string | undefined>>,
  ): ModelTransport {
    if (this.options.transport) {
      return this.options.transport;
    }
    if (this.options.client) {
      return anthropicTransport(this.options.client);
    }
    return createLiveTransport({
      apiKey:
        this.options.apiKey ?? (env ?? process.env).ANTHROPIC_API_KEY,
      ...(this.options.fetch !== undefined
        ? { fetch: this.options.fetch }
        : {}),
      ...(this.options.baseURL !== undefined
        ? { baseURL: this.options.baseURL }
        : {}),
    });
  }

  async runTurn(
    input: AgentTurnInput,
    ctx?: DriverCallCtx,
  ): Promise<NormalizedResponse> {
    const pack =
      ctx?.scenarioPack ??
      this.options.scenarioPack ??
      {
        roleCharters: scopeChangeProtocol.roleCharters,
        scenarioRules: 'Catalog items add scope; modifiers adjust delivery lead time. The system checks required items, deadline, and budget. Ask only listed topics; reject only with a reason available to your role.\n' + JSON.stringify({ topics: scopeChangeProtocol.topics, reasonKeys: scopeChangeProtocol.reasonKeys }),
      };
    const spec = resolveSpecForInput(input, ctx);
    const rendered = renderPrompt(input, pack);
    const { strict } = selectOutputSchema(spec);

    const requestBody = buildNegotiationRequest({
      system: rendered.system,
      user: rendered.user,
      turnInstruction: rendered.turnInstruction,
      schema: strict,
      ...(ctx?.env !== undefined ? { env: ctx.env } : {}),
    });

    const baseTransport = this.resolveTransport(ctx?.env);
    let lastTransportResponse: TransportResponse | null = null;

    const capturingTransport: ModelTransport = {
      provenance: baseTransport.provenance,
      async send(body, sendOpts) {
        const res = await baseTransport.send(body, sendOpts);
        lastTransportResponse = res;
        return res;
      },
    };

    const result: ModelCallResult<AgentTurn> = await callModel<AgentTurn>({
      transport: capturingTransport,
      model: requestBody.model,
      maxTokens: requestBody.max_tokens,
      effort: requestBody.output_config.effort,
      system: requestBody.system,
      messages: requestBody.messages,
      schema: requestBody.output_config.format.schema,
      validate: (raw) => {
        const parsed = parseTurnEnvelope(raw, spec);
        if (parsed.ok) {
          return { ok: true, data: parsed.turn };
        }
        return {
          ok: false,
          issues: parsed.issues.map((i) => ({ path: i.path, code: i.code })),
        };
      },
      ...(ctx?.signal !== undefined ? { signal: ctx.signal } : {}),
      ...(ctx?.timeoutMs !== undefined ? { timeoutMs: ctx.timeoutMs } : {}),
      ...(ctx?.totalBudgetMs !== undefined
        ? { totalBudgetMs: ctx.totalBudgetMs }
        : {}),
      ...(ctx?.maxRetries !== undefined ? { maxRetries: ctx.maxRetries } : {}),
      ...(ctx?.now !== undefined ? { now: ctx.now } : {}),
      ...(ctx?.sleep !== undefined ? { sleep: ctx.sleep } : {}),
      ...(ctx?.env !== undefined ? { env: ctx.env } : {}),
    });

    if (result.kind === 'error' || result.kind === 'aborted') {
      throw new DriverTransportError(result);
    }

    if (lastTransportResponse !== null) {
      const captured = lastTransportResponse as TransportResponse;
      return normalizeAnthropicMessage(captured.message, {
        usage: result.totalUsage,
        latencyMs: result.durationMs,
        requestId: result.requestId ?? captured.requestId,
      });
    }

    // callModel is the supported test seam. A substituted successful gateway may
    // return validated data without driving the capture transport.
    if (result.ok) {
      const envelope = result.data && typeof result.data === 'object' && 'turn' in result.data ? result.data : { turn: result.data };
      return Object.freeze({stopReason:result.stopReason,stopCategory:result.stopCategory,textBlockCount:1,firstText:JSON.stringify(envelope),usage:result.totalUsage,responseModel:result.responseModel??result.servedModel,requestId:result.requestId,latencyMs:result.durationMs});
    }
    throw new GatewayConfigError('Unexpected callModel exit without message');
  }
}

// ---------------------------------------------------------------------------
// 5. ScriptedDriver & ReplayDriver (10 §10.18, 16 §16.4.5)
// ---------------------------------------------------------------------------

export type ScriptedReplyItem =
  | AgentTurn
  | AgentTurnEnvelope
  | NormalizedResponse
  | {
      readonly rawText: string;
      readonly stopReason?: StopReason | string | null;
      readonly textBlockCount?: number;
      readonly stopCategory?: string | null;
    }
  | { readonly throwError: unknown }
  | ((
      input: AgentTurnInput,
      ctx?: DriverCallCtx,
    ) =>
      | AgentTurn
      | AgentTurnEnvelope
      | NormalizedResponse
      | Promise<AgentTurn | AgentTurnEnvelope | NormalizedResponse>);

function isNormalizedResponse(val: unknown): val is NormalizedResponse {
  return (
    typeof val === 'object' &&
    val !== null &&
    'stopReason' in val &&
    'textBlockCount' in val &&
    'firstText' in val &&
    'usage' in val
  );
}

function toNormalizedScriptReply(
  item: Exclude<
    ScriptedReplyItem,
    { readonly throwError: unknown } | ((...args: never[]) => unknown)
  >,
): NormalizedResponse {
  if (isNormalizedResponse(item)) {
    return item;
  }
  if (typeof item === 'object' && item !== null && 'rawText' in item) {
    return Object.freeze({
      stopReason: item.stopReason === undefined ? 'end_turn' : item.stopReason,
      stopCategory: item.stopCategory ?? null,
      textBlockCount: item.textBlockCount ?? 1,
      firstText: item.rawText,
      usage: ZERO_USAGE,
      responseModel: 'scripted:v1',
      requestId: null,
      latencyMs: 0,
    });
  }
  const envelope =
    typeof item === 'object' && item !== null && 'turn' in item
      ? item
      : { turn: item };
  return Object.freeze({
    stopReason: 'end_turn',
    stopCategory: null,
    textBlockCount: 1,
    firstText: JSON.stringify(envelope),
    usage: ZERO_USAGE,
    responseModel: 'scripted:v1',
    requestId: null,
    latencyMs: 0,
  });
}

export class ScriptedDriver implements AgentDriver {
  readonly mode = 'scripted' as const;
  private readonly queue: ScriptedReplyItem[];

  constructor(replies: readonly ScriptedReplyItem[]) {
    this.queue = [...replies];
  }

  get remaining(): number {
    return this.queue.length;
  }

  async runTurn(
    input: AgentTurnInput,
    ctx?: DriverCallCtx,
  ): Promise<NormalizedResponse> {
    if (this.queue.length === 0) {
      const roundNo = input.protocol.roundNo ?? 1;
      const role = input.role ?? input.protocol.role ?? 'unknown';
      throw new ScriptExhaustedError(
        `ScriptedDriver exhausted on round ${roundNo} (${role}/${input.protocol.turnKind ?? 'unknown'})`,
      );
    }
    const next = this.queue.shift()!;
    if (typeof next === 'function') {
      const produced = await next(input, ctx);
      return toNormalizedScriptReply(produced);
    }
    if (typeof next === 'object' && next !== null && 'throwError' in next) {
      throw next.throwError;
    }
    return toNormalizedScriptReply(next);
  }
}

export interface ReplayEntry {
  readonly roundNo?: number;
  readonly role?: string;
  readonly turnKind?: string;
  readonly response: AgentTurn | AgentTurnEnvelope | NormalizedResponse;
}

export class ReplayDriver implements AgentDriver {
  readonly mode = 'replay' as const;
  private readonly entries: ReplayEntry[];

  constructor(entries: readonly ReplayEntry[]) {
    this.entries = [...entries];
  }

  async runTurn(input: AgentTurnInput): Promise<NormalizedResponse> {
    const roundNo = input.protocol.roundNo ?? 1;
    const role = String(input.role ?? input.protocol.role ?? 'provider');
    const turnKind = String(input.protocol.turnKind ?? 'propose');
    const matchIdx = this.entries.findIndex(
      (e) =>
        (e.roundNo === undefined || e.roundNo === roundNo) &&
        (e.role === undefined || e.role === role) &&
        (e.turnKind === undefined || e.turnKind === turnKind),
    );
    if (matchIdx === -1) {
      throw new ScriptExhaustedError(
        `ReplayDriver has no matching entry for roundNo=${roundNo} role=${role} turnKind=${turnKind}`,
      );
    }
    const [matched] = this.entries.splice(matchIdx, 1);
    return toNormalizedScriptReply(matched!.response);
  }
}

// ---------------------------------------------------------------------------
// 6. Driver Registry & Downstream Pipeline Helper (`driverFor`, `setDriverForTests`)
// ---------------------------------------------------------------------------

let testDriverOverride: AgentDriver | null = null;

function resolveCurrentTier(explicitTier?: DeploymentTier): DeploymentTier {
  if (explicitTier) return explicitTier;
  const envTier = process.env.CONVEX_TIER ?? process.env.DEPLOYMENT_TIER;
  if (
    envTier === 'prod' ||
    envTier === 'staging' ||
    envTier === 'dev' ||
    envTier === 'test'
  ) {
    return envTier;
  }
  return 'prod';
}

/**
 * Override the active `AgentDriver` in tests (10 §10.18).
 * Throws if invoked outside the `'test'` deployment tier.
 */
export function setDriverForTests(
  driver: AgentDriver | null,
  options?: { readonly tier?: DeploymentTier },
): void {
  const tier = resolveCurrentTier(options?.tier);
  if (tier !== 'test' || process.env.DEPLOYMENT_TIER !== 'test') {
    throw new GatewayConfigError(
      `setDriverForTests is forbidden outside the "test" tier (current tier: "${tier}")`,
    );
  }
  testDriverOverride = driver;
}

export function resetDriverForTests(): void {
  testDriverOverride = null;
}

export function driverFor(
  mode: 'live' | 'stub',
  options?: {
    readonly tier?: DeploymentTier;
    readonly liveOptions?: LiveDriverOptions;
    readonly stubOptions?: StubDriverOptions;
  },
): AgentDriver {
  const tier = resolveCurrentTier(options?.tier);
  if (tier === 'test' && testDriverOverride !== null) {
    return testDriverOverride;
  }
  if (mode === 'stub') {
    return new StubDriver({ ...options?.stubOptions, tier });
  }
  return new LiveDriver(options?.liveOptions);
}

/**
 * Execute a driver turn and feed its `NormalizedResponse` into the identical
 * downstream `classifyResponse` pipeline (`10.18 stub and live feed the same downstream input`).
 */
export async function executeDriverTurn(
  driver: AgentDriver,
  input: AgentTurnInput,
  semanticsView: TurnSemanticsView,
  driverCtx?: DriverCallCtx,
): Promise<{
  readonly raw: NormalizedResponse;
  readonly decision: ClassifiedResponse;
  readonly spec: TurnSpec;
}> {
  const spec = resolveSpecForInput(input, driverCtx);
  const raw = await driver.runTurn(input, { ...driverCtx, spec });
  const decision = classifyResponse(raw, semanticsView, spec);
  return Object.freeze({ raw, decision, spec });
}
