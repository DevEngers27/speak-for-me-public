// Minimal turn pipeline: model output -> validation -> append-only records -> per-role projections.
import { createHash } from 'node:crypto';
import { ACTIONS_BY_ROLE, buildAgentContext, ServerOutputSchema, type AgentContext } from './agent.ts';
import type { Fixture } from './fixture.ts';
import { catalogKeys, formatCents, isoDate, renderConstraintsChanged, renderProposalSummary, sumCatalog, TemplateInputError, type ConstraintsChangedPayload } from './templates.ts';
import { ROOM_ROLES, type Role, type Surface } from './types.ts';

export const TODAY = '2026-10-24';

export type ReasonCode =
  | 'OK' | 'FITS_BUDGET' | 'OVER_BUDGET' | 'MISSING_REQUIRED_ITEM' | 'DATE_CONFLICT' | 'UNKNOWN_ITEM'
  | 'INVALID_DATE' | 'DATE_OUT_OF_RANGE' | 'OUTPUT_NOT_JSON' | 'OUTPUT_SCHEMA_VIOLATION' | 'ACTION_NOT_ALLOWED_FOR_ROLE'
  | 'MISSING_TERMS' | 'OVERLAPPING_ITEMS';

export interface ProposalRecord {
  version: number; actorRole: Role; itemKeys: string[]; deferredItemKeys: string[];
  amountCents: number; deliveryDate: string; constraintsVersion: number; reasonCodes: ReasonCode[]; publicSummary: string;
}
export type EventRecord =
  | { type: 'proposal_created'; actorRole: Role; payload: { version: number } }
  | { type: 'agent_signal'; actorRole: Role; payload: { action: string; proposalVersion: number | null } }
  | { type: 'agent_turn_rejected'; actorRole: Role; payload: { reasonCode: ReasonCode } }
  | { type: 'constraints_changed'; actorRole: 'finance'; payload: ConstraintsChangedPayload };
export interface AgentTurnRecord { role: Role; status: 'committed' | 'rejected'; reasonCodes: ReasonCode[]; rationale: string | null; outputSha256: string }
export interface LogLine { level: 'info' | 'warn'; msg: string; [k: string]: string | number | boolean | string[] | null }

export interface RoomState {
  fx: Fixture;
  proposals: ProposalRecord[];
  events: EventRecord[];
  agentTurns: AgentTurnRecord[];
  approvals: { proposalVersion: number; role: Role; byHumanUserId: string }[];
  commitments: { changeOrderId: string; amountCents: number; itemKeys: string[] }[];
  tasks: { changeOrderId: string; itemKey: string; title: string }[];
  logs: LogLine[];
}

export const newRoom = (fx: Fixture): RoomState => ({ fx, proposals: [], events: [], agentTurns: [], approvals: [], commitments: [], tasks: [], logs: [] });

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export interface TurnResult { status: 'committed' | 'rejected'; reasonCodes: ReasonCode[]; proposal?: ProposalRecord }

function reject(st: RoomState, role: Role, code: ReasonCode, raw: string): TurnResult {
  st.agentTurns.push({ role, status: 'rejected', reasonCodes: [code], rationale: null, outputSha256: sha(raw) });
  st.events.push({ type: 'agent_turn_rejected', actorRole: role, payload: { reasonCode: code } });
  // log discipline: ids, codes, hash and size only; never the raw model text
  st.logs.push({ level: 'warn', msg: 'agent_turn_rejected', role, reasonCode: code, outputSha256: sha(raw), outputBytes: raw.length });
  return { status: 'rejected', reasonCodes: [code] };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Process one raw model output for `role`. Assumes the model may be fully compromised. */
export function processTurn(st: RoomState, role: Role, raw: string): TurnResult {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return reject(st, role, 'OUTPUT_NOT_JSON', raw); }
  const parsed = ServerOutputSchema.safeParse(json);
  if (!parsed.success) return reject(st, role, 'OUTPUT_SCHEMA_VIOLATION', raw);
  const out = parsed.data;
  if (!ACTIONS_BY_ROLE[role].includes(out.action)) return reject(st, role, 'ACTION_NOT_ALLOWED_FOR_ROLE', raw);

  const fx = st.fx;
  if (out.action === 'propose' || out.action === 'counter') {
    if (!out.itemKeys.length || !out.deliveryDate) return reject(st, role, 'MISSING_TERMS', raw);
    let keys, deferred, date;
    try {
      keys = catalogKeys(fx.catalog, out.itemKeys);
      deferred = catalogKeys(fx.catalog, out.deferredItemKeys);
      date = isoDate(out.deliveryDate);
    } catch (e) {
      return reject(st, role, e instanceof TemplateInputError && e.code === 'INVALID_DATE' ? 'INVALID_DATE' : 'UNKNOWN_ITEM', raw);
    }
    if (keys.some((k) => deferred.includes(k))) return reject(st, role, 'OVERLAPPING_ITEMS', raw);
    const lead = Math.max(...keys.map((k) => fx.catalog.find((i) => i.itemKey === k)!.leadTimeDays));
    if (date < addDays(TODAY, lead) || date > addDays(TODAY, 365)) return reject(st, role, 'DATE_OUT_OF_RANGE', raw);

    const amount = sumCatalog(fx.catalog, keys); // never from the model
    const codes: ReasonCode[] = [];
    const c = fx.briefs.customer.fields;
    codes.push(fx.constraints.committedCents + amount <= fx.constraints.capCents ? 'FITS_BUDGET' : 'OVER_BUDGET');
    if ((c.requiredItemKeys as string[]).some((k) => !keys.includes(k as never))) codes.push('MISSING_REQUIRED_ITEM');
    if (date > (c.hardDeadline as string)) codes.push('DATE_CONFLICT');

    const version = st.proposals.length + 1;
    const proposal: ProposalRecord = {
      version, actorRole: role, itemKeys: [...keys], deferredItemKeys: [...deferred], amountCents: amount,
      deliveryDate: date, constraintsVersion: fx.constraints.version, reasonCodes: codes,
      publicSummary: renderProposalSummary({ actorRole: role, itemKeys: keys, amountCents: amount, deliveryDate: date, deferredItemKeys: deferred }, fx.catalog),
    };
    st.proposals.push(proposal);
    st.events.push({ type: 'proposal_created', actorRole: role, payload: { version } });
    st.agentTurns.push({ role, status: 'committed', reasonCodes: codes, rationale: out.rationale, outputSha256: sha(raw) });
    st.logs.push({ level: 'info', msg: 'proposal_created', role, version, reasonCodes: codes, outputSha256: sha(raw) });
    return { status: 'committed', reasonCodes: codes, proposal };
  }
  // clarify / recommend_accept / reject / escalate: a signal only; never an approval
  const latest = st.proposals.at(-1)?.version ?? null;
  st.events.push({ type: 'agent_signal', actorRole: role, payload: { action: out.action, proposalVersion: latest } });
  st.agentTurns.push({ role, status: 'committed', reasonCodes: ['OK'], rationale: out.rationale, outputSha256: sha(raw) });
  st.logs.push({ level: 'info', msg: 'agent_signal', role, action: out.action, outputSha256: sha(raw) });
  return { status: 'committed', reasonCodes: ['OK'] };
}

const LABEL: Record<Role, string> = { customer: 'Customer', provider: 'Provider', finance: 'Finance' };

export function renderEvent(e: EventRecord, viewer: Role, fx: Fixture): string {
  switch (e.type) {
    case 'proposal_created': return `${LABEL[e.actorRole]} agent created proposal v${e.payload.version}.`;
    case 'agent_signal': return `${LABEL[e.actorRole]} agent: ${e.payload.action}${e.payload.proposalVersion ? ` on v${e.payload.proposalVersion}` : ''} (suggestion only, not an approval).`;
    case 'agent_turn_rejected': return e.actorRole === viewer
      ? `Your agent's turn was rejected (${e.payload.reasonCode}).`
      : `${LABEL[e.actorRole]} agent turn was rejected.`;
    case 'constraints_changed': return renderConstraintsChanged(e.payload, viewer, fx.customerSeesBudget);
  }
}

/** Per-role DTO: what rooms.view would send over the WebSocket. Field-picked, never spread. */
export function projectRoomFor(st: RoomState, viewer: Role) {
  const fx = st.fx;
  const seesBudget = viewer === 'finance' || (viewer === 'customer' && fx.customerSeesBudget);
  return {
    roomId: fx.roomId,
    simulated: fx.simulated,
    proposals: st.proposals.map((p) => ({
      version: p.version, actorRole: p.actorRole, itemKeys: p.itemKeys, deferredItemKeys: p.deferredItemKeys,
      amount: formatCents(p.amountCents), deliveryDate: p.deliveryDate, publicSummary: p.publicSummary, reasonCodes: p.reasonCodes,
    })),
    events: st.events.map((e) => renderEvent(e, viewer, fx)),
    myTurns: st.agentTurns.filter((t) => t.role === viewer).map((t) => ({ status: t.status, reasonCodes: t.reasonCodes, rationale: t.rationale })),
    myBrief: { version: fx.briefs[viewer].version, freeText: fx.briefs[viewer].freeText, fields: fx.briefs[viewer].fields },
    budget: seesBudget ? { cap: formatCents(fx.constraints.capCents), committed: formatCents(fx.constraints.committedCents) } : null,
    commitments: st.commitments.map((c) => ({ changeOrderId: c.changeOrderId, amount: formatCents(c.amountCents), itemKeys: c.itemKeys })),
    tasks: st.tasks.map((t) => ({ itemKey: t.itemKey, title: t.title })),
  };
}

/** Deterministic execution of an approved proposal: change order + commitment + tasks. */
export function execute(st: RoomState, version: number): void {
  const p = st.proposals.find((x) => x.version === version)!;
  const changeOrderId = `co_${version}`;
  if (st.commitments.some((c) => c.changeOrderId === changeOrderId)) return; // idempotent
  st.commitments.push({ changeOrderId, amountCents: p.amountCents, itemKeys: p.itemKeys });
  for (const k of p.itemKeys) st.tasks.push({ changeOrderId, itemKey: k, title: `Deliver ${k} by ${p.deliveryDate}` });
  st.logs.push({ level: 'info', msg: 'executed', changeOrderId, proposalVersion: version });
}

/** Everything any audience can observe, as scanner surfaces. */
export function collectSurfaces(st: RoomState, contexts: AgentContext[] = ROOM_ROLES.map((r) => buildAgentContext(st.fx, r))): Surface[] {
  const s: Surface[] = [];
  for (const r of ROOM_ROLES) s.push({ id: `rooms.view:${r}`, kind: 'room_view_dto', audience: [r], content: projectRoomFor(st, r) });
  for (const p of st.proposals) s.push({ id: `proposal:v${p.version}.publicSummary`, kind: 'proposal_public_summary', audience: 'room', content: p.publicSummary });
  for (const c of st.commitments) s.push({ id: `commitment:${c.changeOrderId}`, kind: 'commitment', audience: 'room', content: c });
  for (const t of st.tasks) s.push({ id: `task:${t.changeOrderId}:${t.itemKey}`, kind: 'task', audience: 'room', content: t });
  for (const ctx of contexts) s.push({ id: `agentContext:${ctx.role}`, kind: 'agent_context', audience: [ctx.role], content: ctx });
  st.logs.forEach((l, i) => s.push({ id: `log:${i}`, kind: 'log', audience: 'ops', content: l }));
  return s;
}
