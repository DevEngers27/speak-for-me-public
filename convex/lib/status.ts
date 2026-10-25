import { assertTransition } from '../../core/engine';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutablePatch, RoomCtx } from './db';

const MACHINES = {
  rooms: 'room', runs: 'run', turns: 'turn', attempts: 'attempt',
  proposals: 'proposal', humanRequests: 'humanRequest', tasks: 'task', invites: 'invite',
} as const;
type StatusTable = keyof typeof MACHINES;

/** Internal state transitions: callers guard user errors before taking a lock. */
export async function setStatus<T extends StatusTable>(
  ctx: RoomCtx, table: T, id: Id<T>,
  from: Doc<T>['status'], to: Doc<T>['status'],
  extra?: Omit<MutablePatch<T>, 'status'>,
): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row || row.status !== from) throw new TypeError('State changed before transition');
  if (extra && Object.hasOwn(extra, 'status')) throw new TypeError('Status cannot be supplied as extra');
  if(table === 'invites') {
    if(from !== 'open' || !['accepted','superseded'].includes(to)) throw new TypeError('Illegal invite transition');
  } else assertTransition(MACHINES[table] as Exclude<typeof MACHINES[StatusTable], 'invite'>, from as never, to as never);
  await ctx.tx.patch(table, id, { ...extra, status: to } as unknown as MutablePatch<T>);
}
