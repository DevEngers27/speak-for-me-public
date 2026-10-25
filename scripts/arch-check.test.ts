import { expect, test } from 'vitest';
import { checkArchitecture, findWriterViolations } from './arch-check';
test('SC-T4 unique writers and write facade in the repository', () => {
  expect(checkArchitecture()).toEqual([]);
});
test('SC-T4 rejects a second users/event writer and direct database patch', () => {
  for (const source of ["await tx.insert('users', {});", "await tx.insert('events', {});", 'await ctx.db.patch(id, {});', 'const row = {commitTs: 1n};']) {
    expect(findWriterViolations('convex/model/rogue.ts', source)).not.toEqual([]);
  }
  expect(findWriterViolations('convex/model/events.ts', "await tx.insert('events', {});")).toEqual([]);
});
