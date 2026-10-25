/** Date advancement depends on a caller-supplied constraint-change callback. */
import { nowMs, todayInTimeZone } from '../lib/time';
import { addDays, cents, isoDate, type View } from '@core/engine';
import type { ScopeChangeRuleInput } from '@core/scenarios/scope-change';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { openRoomTx, type RoomCtx } from '../lib/db';
import { currentRunProposal, evaluateProposal, loadRuleInput, loadRuleInputForRole, materializeCandidate } from './constraintInput';
type DateChange = (ctx: RoomCtx, roomId: Id<'rooms'>, today: string) => Promise<void>;
function optionVerdict(input: View<ScopeChangeRuleInput>, effect: Doc<'humanRequests'>['options'][number]['effect']): boolean {
  switch (effect.type) {
    case 'choose_candidate': {
      const proposal = materializeCandidate(input, effect.candidateKey);
      return proposal !== null && proposal.terms.deliveryDate >= input.localDate &&
        proposal.terms.deliveryDate <= addDays(input.localDate, 365) &&
        (input.deadline === undefined || proposal.terms.deliveryDate <= input.deadline);
    }
    case 'extend_deadline': return effect.date >= input.localDate;
    case 'raise_cap':
    case 'drop_items':
    case 'pass_to_next':
    case 'disclose':
    case 'retry_turn':
    case 'keep_as_is':
    case 'end_run': return true;
    case 'blocked': return false;
  }
}

async function timeVerdicts(ctx: MutationCtx, roomId: Id<'rooms'>, date: string): Promise<boolean[]> {
  const { run, proposal } = await currentRunProposal(ctx, roomId);
  if (!run || (run.status !== 'pending_approval' && run.status !== 'needs_input')) return [];
  if (run.status === 'pending_approval') {
    const input = { ...await loadRuleInput(ctx, roomId), localDate: isoDate(date) };
    if (!proposal) return [false];
    const storedProposal = { terms: { ...proposal.terms, deliveryDate: isoDate(proposal.terms.deliveryDate), amountCents: cents(proposal.terms.amountCents) },
      lines: proposal.lines.map(line => ({ ...line, priceCents: cents(line.priceCents) })) };
    return [evaluateProposal(input, storedProposal).passesChecks];
  }
  const requests = await ctx.db.query('humanRequests').withIndex('by_run_status', q => q.eq('runId', run._id).eq('status', 'open')).collect();
  const verdicts = await Promise.all(requests.map(async request => {
    const input = await loadRuleInputForRole(ctx, roomId, request.toRole, date);
    return request.options.map(option => optionVerdict(input, option.effect));
  }));
  return verdicts.flat();
}

/** Step 2b helper shared by clock.rollLocalDate and materializing mutations.
 * lockHeld=true when the caller already owns its one RoomTx write lock. */
export async function rollLocalDateWith(onDateChange: DateChange, ctx: MutationCtx|RoomCtx, roomId: Id<'rooms'>, now = nowMs(ctx), lockHeld = false, options: { midnightPath?: boolean } = {}): Promise<boolean> {
  const room = await ctx.db.get(roomId);
  if (!room || (room.status !== 'setup' && room.status !== 'open')) return false;
  const today = todayInTimeZone(now, room.timeZone);
  if (today <= room.localDate) return false; // no lock, scheduler read/write or verdict evaluation
  void lockHeld;
  const tx='tx'in ctx?(ctx as RoomCtx).tx:await openRoomTx(ctx,roomId,{allow:['setup','open']});
  const roomCtx={...ctx,tx};
  const before = room.status === 'open' ? await timeVerdicts(ctx, roomId, room.localDate) : [];
  const after = room.status === 'open' ? await timeVerdicts(ctx, roomId, today) : [];
  await tx.patch('rooms',roomId, { localDate: today });
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
    await onDateChange(roomCtx, roomId, today);
  }
  // Step-2b callers never deduplicate timers. A changed date queues the single-
  // room clock handler to register the successor outside this hot transaction.
  if (!options.midnightPath) await ctx.scheduler.runAfter(0, internal.clock.rollLocalDate, { roomId });
  return true;
}
