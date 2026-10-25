// Test-only functions registered explicitly by the schema tests.
import { query } from '../../convex/_generated/server';
import schema, { revisionCauseV, requestEffectV, eventPayloadV } from '../../convex/schema';
export const revision = query({args: {value: revisionCauseV}, handler: async () => null});
export const effect = query({args: {value: requestEffectV}, handler: async () => null});
export const waiting = query({args: {value: schema.tables.turns.validator.fields.waitingReason}, handler: async () => null});
export const stale = query({args: {value: schema.tables.attempts.validator.fields.staleGuard}, handler: async () => null});
export const event = query({args: {value: eventPayloadV}, handler: async () => null});
