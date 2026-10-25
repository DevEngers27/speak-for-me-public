/** Immutable execution provenance, independent of timeline pagination. */
import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { privacy } from '@core/engine';
import { scenarioOf } from '../../scenarios/registry';
import { renderTimelineEvent, constraintRoleDetail, constraintBudgetDetail } from './timelineTemplates';

export type WhyStep = { step: string; constraintsVersion: number | null; proposalVersion: number | null; text: string; href: string | null };
export async function executionWhy(ctx: QueryCtx, room: Doc<'rooms'>, execution: Doc<'executions'>, member: Doc<'members'>, revisions: readonly Doc<'constraintRevisions'>[], order: Doc<'changeOrders'>, taskCount: number): Promise<WhyStep[]> {
  const out: WhyStep[] = [];
  const plugin = scenarioOf(room);
  const proposalHref = (proposal: Doc<'proposals'>) => `/rooms/${room._id}/proposals/${proposal._id}`;
  const text = (payload: Doc<'events'>['payload'], owner = false, cause: string | null = null, constraintDetail: ReturnType<typeof constraintRoleDetail> | null = null) => renderTimelineEvent(payload, member.role, { owner, fact: null, amount: null, cause, requestKind: null, constraintDetail });
  const add = (step: string, constraintsVersion: number | null, proposalVersion: number | null, label: string, href: string | null = null) => out.push({ step, constraintsVersion, proposalVersion, text: label, href });
  const bounded = revisions.filter(row => row.version <= execution.constraintsVersion).sort((a,b) => a.version-b.version);
  if (bounded.length > 20) add('earlier_history', null, null, 'Earlier constraint history');
  for (const revision of bounded.slice(-20)) {
    // The same disclosure-family projection and role-neutral template as timeline.page.
    const projected = privacy.projectForRole(member.role, {family:'constraintRevisions',data:revision}, {plugin});
    const source = revision.sourceRefs.find(ref => ref.kind === 'brief');
    let detail = member.role !== 'provider' && source?.kind === 'brief' ? constraintRoleDetail(source.role) : null;
    if (member.role !== 'provider' && source?.kind === 'brief' && source.role === 'finance') {
      const after = await ctx.db.get(source.briefId);
      const before = await ctx.db.query('briefs').withIndex('by_room_role_version',q=>q.eq('roomId',room._id).eq('role','finance').lt('version',source.version)).order('desc').first();
      const facts = await ctx.db.query('sharedFacts').withIndex('by_room_from_field',q=>q.eq('roomId',room._id).eq('fromRole','finance')).collect();
      const capAt = (brief: Doc<'briefs'> | null): number | undefined => {
        if (!brief || brief.roomId !== room._id || brief.hardFields.schemaKey !== 'scope_change.finance.v1') return undefined;
        if (member.role === 'finance') return brief.hardFields.capCents;
        const projectedFacts = privacy.projectSharedFacts(member.role, facts.filter(fact=>fact.createdAt<=revision.createdAt),brief.version,plugin);
        const value = projectedFacts.find(fact=>fact.field==='capCents')?.value as Doc<'sharedFacts'>['value'] | undefined;
        return value?.kind === 'cents' ? value.cents : undefined;
      };
      detail = constraintBudgetDetail(capAt(before),capAt(after)) ?? detail;
    }
    add('constraints_changed', revision.version, null, text({type:'constraints_changed',fromVersion:revision.previousVersion,toVersion:revision.version}, false, typeof projected?.cause === 'string' ? projected.cause : null, detail));
    if (revision.staleProposalId) {
      const stale = await ctx.db.get(revision.staleProposalId);
      if (stale?.roomId === room._id) {
        add('proposal_superseded', revision.version, stale.version, text({type:'proposal_status_changed',proposalVersion:stale.version,to:'stale'}), proposalHref(stale));
        const oldApprovals = await ctx.db.query('approvals').withIndex('by_proposal_user', q=>q.eq('proposalId',stale._id)).collect();
        const latest = new Map<string,Doc<'approvals'>>();
        for (const approval of oldApprovals) if (approval.boundConstraintsVersion < revision.version && (!latest.has(approval.userId) || latest.get(approval.userId)!.seq < approval.seq)) latest.set(approval.userId,approval);
        for (const approval of latest.values()) if (approval.decision === 'approve') add('approval_invalidated',revision.version,stale.version,text({type:'reapproval_required',proposalVersion:stale.version,constraintsVersion:revision.version}),proposalHref(stale));
      }
    }
  }
  const proposal = await ctx.db.get(execution.proposalId);
  const run = await ctx.db.get(execution.runId);
  if (run?.roomId === room._id) {
    add('run_started', run.constraintsVersionAtStart, proposal?.version ?? null, text({type:'run_started',runNo:run.runNo,cause:run.cause}));
    const requests = await ctx.db.query('humanRequests').withIndex('by_run_status', q=>q.eq('runId',run._id)).collect();
    for (const request of requests.filter(row=>row.status==='answered').sort((a,b)=>(a.answeredAt??a.createdAt)-(b.answeredAt??b.createdAt))) {
      const projected = privacy.projectForRole(member.role,{family:'humanRequests',data:{kind:request.kind,toRole:request.toRole,status:request.status}},{plugin});
      const mayOpen = member.role !== 'provider' || request.toRole === member.role;
      add('request_answered',request.constraintsVersion,proposal?.version??null,text({type:'human_request_answered',runNo:run.runNo},request.toRole===member.role),mayOpen && projected?.kind !== 'run_waiting' ? `/rooms/${room._id}/requests/${request._id}` : null);
    }
  }
  if (proposal?.roomId === room._id) add('proposal_created',proposal.createdAtConstraintsVersion,proposal.version,text({type:'proposal_created',proposalVersion:proposal.version,origin:proposal.origin,authorRole:proposal.authorRole,itemKeys:proposal.terms.itemKeys,modifiers:proposal.terms.modifiers,amountCents:proposal.terms.amountCents,deliveryDate:proposal.terms.deliveryDate}),proposalHref(proposal));
  for (const id of execution.approvalIds) {
    const approval = await ctx.db.get(id);
    if (approval?.roomId === room._id && approval.proposalId === execution.proposalId) add('approval_recorded',approval.boundConstraintsVersion,execution.proposalVersion,text({type:'approval_recorded',proposalVersion:execution.proposalVersion,role:approval.role,decision:approval.decision,boundConstraintsVersion:approval.boundConstraintsVersion},approval.userId===member.userId),proposal ? proposalHref(proposal) : null);
  }
  add('room_executed',execution.constraintsVersion,execution.proposalVersion,text({type:'room_executed',proposalVersion:execution.proposalVersion,amountCents:execution.amountCents,taskCount,changeOrderNumber:order.number}));
  return out;
}
