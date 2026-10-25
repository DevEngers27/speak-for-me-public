/** Test-only registered boundary for the W2-4 agent-context scheduling seam. */
import { v } from 'convex/values';
import { memberQuery } from '../../convex/lib/functions';
import { loadTurnContext } from '../../convex/model/agents/context';
import { StubDriver } from '../../convex/model/agents/drivers';
import { cents, isoDate, renderPrompt } from '../../core/engine/index';

export const load = memberQuery('agents.loadTurnContext')({
  args: { roomId: v.id('rooms') },
  returns: v.union(v.null(), v.object({ inputJson: v.string(), promptJson: v.string(), optionKey: v.union(v.null(), v.string()) })),
  async handler(ctx) {
    const input = await loadTurnContext(ctx, {
      run: { roundNo: 1, maxRounds: 3 },
      turn: {
        role: ctx.member.role, kind: ctx.member.role === 'provider' ? 'propose' : 'evaluate',
        candidateSnapshot: [
          { optionKey: 'O1', candidateKey: 'audit_log_export+sso_login', itemKeys: ['audit_log_export', 'sso_login'], modifiers: [], amountCents: cents(80_000), deliveryDate: isoDate(ctx.room.localDate) },
          { optionKey: 'O2', candidateKey: 'audit_log_export+sso_login+usage_dashboard', itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'], modifiers: [], amountCents: cents(100_000), deliveryDate: isoDate(ctx.room.localDate) },
        ],
      },
    });
    const reply = ctx.member.role === 'provider' ? await new StubDriver().runTurn(input) : null;
    const turn = reply ? JSON.parse(reply.firstText!) as { turn: { optionKey?: string } } : null;
    return { inputJson: JSON.stringify(input), promptJson: JSON.stringify(renderPrompt(input)), optionKey: turn?.turn.optionKey ?? null };
  },
});
