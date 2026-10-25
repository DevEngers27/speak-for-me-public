import { loadRuleInput } from './model/runtimeSources';
import { v } from 'convex/values';
import { sysQuery } from './lib/functions';
import { assertTier } from './lib/config';
import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { RUN_TERMINAL, TURN_TERMINAL, canonicalJson } from '@core/engine';
import { checkStored } from './model/_parallelStubs.w2-4';
export type Finding = { invariant: string; id: string };
export async function livenessFindings(ctx: Pick<QueryCtx, 'db'>, roomId: Id<'rooms'>): Promise<Finding[]> {
  const room = await ctx.db.get(roomId);
  if (!room) return [];
  const findings: Finding[] = [];
  const add = (invariant: string, id: string) => findings.push({ invariant, id });
  const runs = await ctx.db.query('runs').withIndex('by_room_runNo', q => q.eq('roomId', roomId)).collect();
  const active = runs.filter(r => !RUN_TERMINAL.has(r.status));
  if (active.length > 1 || active.some(r => r._id !== room.currentRunId)) add('LV-3', roomId);
  const flags = await ctx.db.query('opsFlags').withIndex('by_key', q => q.eq('key', 'global')).unique();
  for (const run of runs) {
    const turns = await ctx.db.query('turns').withIndex('by_run_turnSeq', q => q.eq('runId', run._id)).collect();
    const liveTurns = turns.filter(t => !TURN_TERMINAL.has(t.status));
    const attempts = await ctx.db.query('attempts').withIndex('by_run', q => q.eq('runId', run._id)).collect();
    const running = attempts.filter(a => a.status === 'running');
    const requests = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', run._id).eq('status', 'open')).collect();
    if ((run.status === 'needs_input' ? requests.length !== 1 : requests.length !== 0) || requests.some(r => r.runId !== room.currentRunId)) add('LV-2', run._id);
    // Old attempts may still run after a constraint bump; only current run seriality is relevant.
    if (!RUN_TERMINAL.has(run.status) && (running.length > 1 || liveTurns.length > 1)) add('LV-4', run._id);
    if (!RUN_TERMINAL.has(run.status) && run.constraintsVersionAtStart !== room.constraintsVersion) add('INV-SM-02', run._id);
    if (run.status === 'negotiating') {
      const turn = liveTurns[0];
      let scheduled = false;
      if (turn?.beginFnId) {
        const id = ctx.db.system.normalizeId('_scheduled_functions', turn.beginFnId);
        const fn = id ? await ctx.db.system.get(id) : null;
        scheduled = fn?.state.kind === 'pending' || fn?.state.kind === 'inProgress';
      }
      const parked = turn?.waitingReason === 'draining' && flags?.draining === true && run.agentMode === 'live';
      if (liveTurns.length !== 1 || turn?.turnSeq !== run.activeTurnSeq || !(running.some(a => a.turnId === turn?._id) || scheduled || parked)) add('LV-1', run._id);
    }
    for (const turn of turns) {
      const own = attempts.filter(a => a.turnId === turn._id);
      if (turn.currentAttemptNo !== Math.max(0, ...own.map(a => a.attemptNo)) || own.filter(a => a.status === 'running').length > 1) add('INV-SM-08', turn._id);
    }
    if (run.status === 'pending_approval') {
      const p = run.currentProposalId ? await ctx.db.get(run.currentProposalId) : null;
      if (!p || p.status !== 'active' || !checkStored((await loadRuleInput(ctx, room)).full, p).passesChecks) add('INV-SM-05', run._id);
    }
  }
  const proposals = await ctx.db.query('proposals').withIndex('by_room_version', q => q.eq('roomId', roomId)).collect();
  const activeProposals = proposals.filter(p => p.status === 'active');
  if (activeProposals.length > 1 || activeProposals.some(p => !active.some(r => r.currentProposalId === p._id))) add('INV-SM-06', roomId);
  const events = await ctx.db.query('events').withIndex('by_room_order', q => q.eq('roomId', roomId)).collect();
  const revisions = await ctx.db.query('constraintRevisions').withIndex('by_room_version', q => q.eq('roomId', roomId)).collect();
  if (proposals.some(p => !events.some(e => e.payload.type === 'proposal_created' && e.payload.proposalVersion === p.version)) || revisions.some(r => !events.some(e => e.payload.type === 'constraints_changed' && e.payload.toVersion === r.version))) add('EV-1', roomId);
  for (const proposal of proposals) {
    const approvals = await ctx.db.query('approvals').withIndex('by_proposal_user', q => q.eq('proposalId', proposal._id)).collect();
    if (approvals.some(a => !events.some(e => e.payload.type === 'approval_recorded' && e.payload.proposalVersion === proposal.version && e.payload.role === a.role && e.payload.decision === a.decision && e.payload.boundConstraintsVersion === a.boundConstraintsVersion))) add('EV-1', proposal._id);
  }
  const executions = await ctx.db.query('executions').withIndex('by_room', q => q.eq('roomId', roomId)).collect();
  if (executions.some(x => !events.some(e => e.payload.type === 'room_executed' && e.payload.proposalVersion === x.proposalVersion))) add('EV-1', roomId);
  const groups = new Map<string, number[]>();
  for (const event of events) { const key = String(event.commitTs); const group = groups.get(key) ?? []; group.push(event.seq); groups.set(key, group); }
  if ([...groups.values()].some(g => g.some((seq, i) => seq !== i))) add('EV-1', roomId);
  for (const fact of await ctx.db.query('sharedFacts').withIndex('by_room_from_field', q => q.eq('roomId', roomId)).collect()) {
    if (!fact.value) continue;
    const brief = await ctx.db.query('briefs').withIndex('by_room_role_version', q => q.eq('roomId', roomId).eq('role', fact.fromRole).eq('version', fact.briefVersion)).unique();
    const fields = brief ? { ...brief.hardFields, ...brief.softFields } as Record<string, unknown> : {};
    if (fact.fromRole === 'finance' && ['committedCents', 'headroomCents'].includes(fact.field)) {
      const ledger = await ctx.db.query('ledgerEntries').withIndex('by_room_kind', q => q.eq('roomId', roomId)).collect();
      const committed = ledger.filter(e => e.createdAt <= fact.createdAt).reduce((n, e) => n + e.amountCents, 0);
      fields.committedCents = committed;
      if (typeof fields.capCents === 'number') fields.headroomCents = fields.capCents - committed;
    }
    const value = fact.value.kind === 'cents' ? fact.value.cents : fact.value.kind === 'date' ? fact.value.date : fact.value.kind === 'itemKeys' ? fact.value.itemKeys : fact.value.value;
    if (fields[fact.field] === undefined || canonicalJson(fields[fact.field] as string | number | string[]) !== canonicalJson(value)) add('SF-1', fact._id);
  }
  return findings;
}
export const listRoomIds = sysQuery('testing.listRoomIds')({ returns:v.array(v.id('rooms')), args: {}, handler: async ctx => { await assertTier(ctx, ['dev', 'preview', 'test']); return (await ctx.db.query('rooms').collect()).map(r => r._id); } });
export const checkLiveness = sysQuery('testing.checkLiveness')({returns:v.array(v.object({invariant:v.string(),id:v.string()})), args: { roomId: v.id('rooms') }, handler: async (ctx, { roomId }) => { await assertTier(ctx, ['dev', 'preview', 'test']); return livenessFindings(ctx, roomId); } });

/** Counts for the L2 probes (16 §16.8.2). Refuses prod. */
export const roomCounts = sysQuery("testing.roomCounts")({
  args: { roomId: v.id("rooms") },
  returns: v.object({
    members: v.number(),
    invites: v.number(),
    briefs: v.number(),
    runs: v.number(),
    proposals: v.number(),
    approvals: v.number(),
    executions: v.number(),
    tasks: v.number(),
    ledgerCommits: v.number(),
  }),
  handler: async (ctx, args) => {
    await assertTier(ctx, ["dev", "preview", "test"]);
    const roomId = args.roomId;
    const proposals = await ctx.db.query("proposals").withIndex("by_room_version", (q) => q.eq("roomId", roomId)).collect();
    let approvals = 0;
    for (const proposal of proposals) {
      approvals += (await ctx.db.query("approvals").withIndex("by_proposal_user", (q) => q.eq("proposalId", proposal._id)).collect()).length;
    }
    return {
      members: (await ctx.db.query("members").withIndex("by_room_role", (q) => q.eq("roomId", roomId)).collect()).length,
      invites: (await ctx.db.query("invites").withIndex("by_room_role", (q) => q.eq("roomId", roomId)).collect()).length,
      briefs: (await ctx.db.query("briefs").withIndex("by_room_role_version", (q) => q.eq("roomId", roomId)).collect()).length,
      runs: (await ctx.db.query("runs").withIndex("by_room_runNo", (q) => q.eq("roomId", roomId)).collect()).length,
      proposals: proposals.length,
      approvals,
      executions: (await ctx.db.query("executions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()).length,
      tasks: (await ctx.db.query("tasks").withIndex("by_room_assignee", (q) => q.eq("roomId", roomId)).collect()).length,
      ledgerCommits: (await ctx.db.query("ledgerEntries").withIndex("by_room_kind", (q) => q.eq("roomId", roomId).eq("kind", "commit")).collect()).length,
    };
  },
});
