import { v } from 'convex/values';
import { memberQuery } from './lib/functions';
import { buildProposalDetail, proposalDetailV } from './model/views/roomView';
export const get = memberQuery('proposals.get')({ args: { proposalId: v.id('proposals') }, returns: v.union(v.null(), proposalDetailV), handler: async (ctx, { proposalId }) => {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) return null;
  const member = await ctx.db.get(ctx.member.memberId);
  return member ? buildProposalDetail(ctx, proposal, member) : null;
} });
